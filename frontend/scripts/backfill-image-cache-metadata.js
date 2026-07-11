#!/usr/bin/env node

const admin = require('firebase-admin');

const LEGACY_IMAGE_CACHE_CONTROL = 'private, max-age=604800';
const IMMUTABLE_IMAGE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const shouldShowHelp = args.includes('--help') || args.includes('-h');

const readArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || '' : '';
};

const projectId = readArg('--project') || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
const bucketName = readArg('--bucket') || process.env.FIREBASE_STORAGE_BUCKET || '';
const prefix = readArg('--prefix');

const printHelp = () => {
  console.log([
    'Backfill browser-cache metadata on existing Firebase Storage images.',
    '',
    'Usage:',
    '  npm run images:backfill-cache -- --project <project-id> --bucket <bucket-name> [--prefix <path>] [--write]',
    '',
    'The default is a dry run. Only image/* objects whose cacheControl differs are selected.',
    `Write mode sets Cache-Control to: ${LEGACY_IMAGE_CACHE_CONTROL}`,
    'Authentication uses Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.',
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

async function main() {
  if (shouldShowHelp) {
    printHelp();
    return;
  }

  requireArgValue('--project');
  requireArgValue('--bucket');
  requireArgValue('--prefix');

  if (!projectId || !bucketName) {
    throw new Error('Both --project and --bucket are required unless provided by environment variables.');
  }

  admin.initializeApp({ projectId, storageBucket: bucketName });
  const bucket = admin.storage().bucket(bucketName);
  const files = await listAllFiles(bucket, prefix);
  const inspected = await mapWithConcurrency(files, 12, inspectImage);
  const images = inspected.filter((entry) => entry.isImage);
  const pending = images.filter(needsBackfill);

  console.log(`Image cache metadata backfill (${shouldWrite ? 'write' : 'dry-run'} mode)`);
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
