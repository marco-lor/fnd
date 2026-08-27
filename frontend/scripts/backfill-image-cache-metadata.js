#!/usr/bin/env node

const admin = require('firebase-admin');
const path = require('node:path');
const {
  resolveCurrentBranchName,
  resolveEnvironmentSelection,
} = require('./firebase-environment');

const LEGACY_IMAGE_CACHE_CONTROL = 'private, max-age=604800';
const IMMUTABLE_IMAGE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const shouldShowHelp = args.includes('--help') || args.includes('-h');

const readArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || '' : '';
};

const projectId = readArg('--project') || process.env.FND_FIREBASE_PROJECT_ID || '';
const bucketName = readArg('--bucket') || process.env.FND_FIREBASE_STORAGE_BUCKET || '';
const environmentName = readArg('--environment') || process.env.FND_FIREBASE_ENVIRONMENT || '';
const hostingSite = readArg('--site') || process.env.FND_FIREBASE_HOSTING_SITE || '';
const prefix = readArg('--prefix');
const authMode = readArg('--auth') || 'admin';
const allowLiveProject = args.includes('--allow-live-project');
const confirmProject = readArg('--confirm-project');

const printHelp = () => {
  console.log([
    'Backfill browser-cache metadata on existing Firebase Storage images.',
    '',
    'Usage:',
    '  npm run images:backfill-cache -- --environment production|staging',
    '    --project <project-id> --site <hosting-site> --bucket <bucket-name>',
    '    [--auth admin|firebase-cli] [--prefix <path>] [--write]',
    '',
    'The default is a dry run. Only image/* objects whose cacheControl differs are selected.',
    `Write mode sets Cache-Control to: ${LEGACY_IMAGE_CACHE_CONTROL}`,
    'Default authentication uses Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.',
    'Use --auth firebase-cli to reuse the local Firebase CLI login.',
    'Write mode also requires --allow-live-project and exact --confirm-project.',
  ].join('\n'));
};

const requireArgValue = (name) => {
  if (args.includes(name) && !readArg(name)) {
    throw new Error(`Missing value for ${name}.`);
  }
};

async function listAllFiles(bucket, pathPrefix = '') {
  const files = [];
  let pageToken;

  do {
    const [pageFiles, nextQuery] = await bucket.getFiles({
      autoPaginate: false,
      maxResults: 1000,
      ...(pathPrefix ? { prefix: pathPrefix } : {}),
      ...(pageToken ? { pageToken } : {}),
    });
    files.push(...pageFiles);
    pageToken = nextQuery?.pageToken;
  } while (pageToken);

  return files;
}

async function inspectImage(file) {
  const [metadata] = await file.getMetadata();
  const contentType = String(metadata?.contentType || '').toLowerCase();

  return {
    file,
    name: file.name,
    contentType,
    currentCacheControl: metadata?.cacheControl || '',
    isImage: contentType.startsWith('image/'),
  };
}

function needsBackfill(entry) {
  return entry.isImage
    && entry.currentCacheControl !== LEGACY_IMAGE_CACHE_CONTROL
    && entry.currentCacheControl !== IMMUTABLE_IMAGE_CACHE_CONTROL;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

function createAdminBackend() {
  admin.initializeApp({ projectId, storageBucket: bucketName });
  const bucket = admin.storage().bucket(bucketName);

  return {
    label: 'Admin SDK',
    listFiles: () => listAllFiles(bucket, prefix),
  };
}

async function createFirebaseCliBackend() {
  const api = require('firebase-tools/lib/api');
  const apiv2 = require('firebase-tools/lib/apiv2');
  const auth = require('firebase-tools/lib/auth');
  const { requireAuth } = require('firebase-tools/lib/requireAuth');
  const options = { cwd: process.cwd(), project: projectId };
  const account = auth.selectAccount(undefined, process.cwd());

  if (!account) {
    throw new Error('No Firebase CLI account is logged in. Run firebase login first.');
  }

  auth.setActiveAccount(options, account);
  await requireAuth(options, true);

  const client = new apiv2.Client({
    auth: true,
    urlPrefix: api.storageOrigin(),
  });
  const objectPath = (name) => `/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(name)}`;

  return {
    label: `Firebase CLI (${account.user?.email || 'logged-in account'})`,
    listFiles: async () => {
      const objects = [];
      let pageToken = '';

      do {
        const response = await client.get(`/storage/v1/b/${encodeURIComponent(bucketName)}/o`, {
          queryParams: {
            maxResults: 1000,
            ...(prefix ? { prefix } : {}),
            ...(pageToken ? { pageToken } : {}),
          },
        });
        objects.push(...(response.body.items || []).map((metadata) => ({
          name: metadata.name,
          getMetadata: async () => [metadata],
          setMetadata: async (nextMetadata) => {
            await client.patch(objectPath(metadata.name), nextMetadata);
          },
        })));
        pageToken = response.body.nextPageToken || '';
      } while (pageToken);

      return objects;
    },
  };
}

async function main() {
  if (shouldShowHelp) {
    printHelp();
    return;
  }

  requireArgValue('--project');
  requireArgValue('--bucket');
  requireArgValue('--environment');
  requireArgValue('--site');
  requireArgValue('--prefix');
  requireArgValue('--auth');

  if (!projectId || !bucketName || !environmentName || !hostingSite) {
    throw new Error('Explicit --environment, --project, --site, and --bucket are required.');
  }

  if (!['admin', 'firebase-cli'].includes(authMode)) {
    throw new Error(`Unsupported --auth value "${authMode}". Use "admin" or "firebase-cli".`);
  }

  const target = resolveEnvironmentSelection({
    branchName: resolveCurrentBranchName({cwd: path.resolve(__dirname, '..')}),
    environmentName,
    hostingSite,
    projectId,
    storageBucket: bucketName,
  });
  if (!target.deployable) {
    throw new Error(`Image cache backfill cannot target ${target.name}.`);
  }
  if (shouldWrite && (!allowLiveProject || confirmProject !== projectId)) {
    throw new Error(
      `Write mode requires --allow-live-project and exact --confirm-project ${projectId}.`
    );
  }

  const backend = authMode === 'firebase-cli'
    ? await createFirebaseCliBackend()
    : createAdminBackend();
  const files = await backend.listFiles();
  const inspected = await mapWithConcurrency(files, 12, inspectImage);
  const images = inspected.filter((entry) => entry.isImage);
  const pending = images.filter(needsBackfill);

  console.log(`Image cache metadata backfill (${shouldWrite ? 'write' : 'dry-run'} mode, ${backend.label})`);
  console.log(`Bucket: ${bucketName}${prefix ? `, prefix: ${prefix}` : ''}`);
  console.log(`Objects scanned: ${files.length}`);
  console.log(`Images found: ${images.length}`);
  console.log(`Images requiring update: ${pending.length}`);

  pending.slice(0, 20).forEach((entry) => {
    console.log(`  - ${entry.name}: ${JSON.stringify(entry.currentCacheControl)} -> ${JSON.stringify(LEGACY_IMAGE_CACHE_CONTROL)}`);
  });
  if (pending.length > 20) {
    console.log(`  ... ${pending.length - 20} more`);
  }

  if (!shouldWrite || !pending.length) {
    console.log(shouldWrite ? 'No updates required.' : 'No writes performed. Re-run with --write after reviewing the dry run.');
    return;
  }

  const failures = [];
  await mapWithConcurrency(pending, 8, async (entry) => {
    try {
      await entry.file.setMetadata({ cacheControl: LEGACY_IMAGE_CACHE_CONTROL });
    } catch (error) {
      failures.push({ name: entry.name, error });
    }
  });

  console.log(`Images updated: ${pending.length - failures.length}`);
  if (failures.length) {
    failures.forEach(({ name, error }) => console.error(`  failed: ${name}: ${error?.message || error}`));
    throw new Error(`${failures.length} image metadata update(s) failed. Re-run the command to retry.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  LEGACY_IMAGE_CACHE_CONTROL,
  IMMUTABLE_IMAGE_CACHE_CONTROL,
  inspectImage,
  listAllFiles,
  mapWithConcurrency,
  needsBackfill,
};
