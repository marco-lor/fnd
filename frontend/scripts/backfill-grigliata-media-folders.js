#!/usr/bin/env node

const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const shouldShowHelp = args.includes('--help') || args.includes('-h');
const projectArgIndex = args.indexOf('--project');
const authArgIndex = args.indexOf('--auth');
const projectId = projectArgIndex >= 0 ? args[projectArgIndex + 1] : '';
const authMode = authArgIndex >= 0 ? args[authArgIndex + 1] : 'admin';

const MEDIA_DEFINITIONS = [
  {
    label: 'gallery backgrounds',
    mediaCollection: 'grigliata_backgrounds',
    folderCollection: 'grigliata_gallery_folders',
    folderField: 'galleryFolderId',
  },
  {
    label: 'music tracks',
    mediaCollection: 'grigliata_music_tracks',
    folderCollection: 'grigliata_music_folders',
    folderField: 'musicFolderId',
  },
];

const printHelp = () => {
  console.log([
    'Backfill Grigliata media folder fields.',
    '',
    'Usage:',
    '  node scripts/backfill-grigliata-media-folders.js [--project <project-id>] [--auth admin|firebase-cli] [--write]',
    '',
    'Default mode is a dry run. Pass --write to persist missing or invalid folder ids as an empty string.',
    'Default auth is admin, which uses Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.',
    'Use --auth firebase-cli to reuse the local Firebase CLI login for REST writes.',
  ].join('\n'));
};

if (shouldShowHelp) {
  printHelp();
  process.exit(0);
}

if (projectArgIndex >= 0 && !projectId) {
  console.error('Missing value for --project.');
  process.exit(1);
}

if (authArgIndex >= 0 && !authMode) {
  console.error('Missing value for --auth.');
  process.exit(1);
}

if (!['admin', 'firebase-cli'].includes(authMode)) {
  console.error(`Unsupported --auth value "${authMode}". Use "admin" or "firebase-cli".`);
  process.exit(1);
}

const getDocumentIdFromName = (name = '') => name.split('/').pop() || '';

const decodeRestDocument = (document = {}) => {
  const fields = document.fields || {};
  const data = {};

  Object.entries(fields).forEach(([fieldName, fieldValue]) => {
    if (Object.prototype.hasOwnProperty.call(fieldValue, 'stringValue')) {
      data[fieldName] = fieldValue.stringValue;
    } else if (Object.prototype.hasOwnProperty.call(fieldValue, 'integerValue')) {
      data[fieldName] = Number(fieldValue.integerValue);
    } else if (Object.prototype.hasOwnProperty.call(fieldValue, 'doubleValue')) {
      data[fieldName] = Number(fieldValue.doubleValue);
    } else if (Object.prototype.hasOwnProperty.call(fieldValue, 'booleanValue')) {
      data[fieldName] = fieldValue.booleanValue;
    } else if (Object.prototype.hasOwnProperty.call(fieldValue, 'nullValue')) {
      data[fieldName] = null;
    }
  });

  return {
    id: getDocumentIdFromName(document.name),
    name: document.name,
    data,
  };
};

const createAdminBackend = () => {
  const admin = require('firebase-admin');

  admin.initializeApp(projectId ? { projectId } : undefined);
  const db = admin.firestore();

  return {
    label: 'Admin SDK',
    listDocuments: async (collectionName) => {
      const snapshot = await db.collection(collectionName).get();
      return snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ref: docSnap.ref,
        data: docSnap.data() || {},
      }));
    },
    updateFolderFields: async (invalidDocs, folderField) => {
      const batchSize = 450;
      let updatedCount = 0;

      for (let index = 0; index < invalidDocs.length; index += batchSize) {
        const batch = db.batch();
        const slice = invalidDocs.slice(index, index + batchSize);

        slice.forEach(({ ref }) => {
          batch.update(ref, { [folderField]: '' });
        });

        await batch.commit();
        updatedCount += slice.length;
      }

      return updatedCount;
    },
  };
};

const createFirebaseCliBackend = async () => {
  if (!projectId) {
    throw new Error('The Firebase CLI auth backend requires --project <project-id>.');
  }

  const api = require('firebase-tools/lib/api');
  const apiv2 = require('firebase-tools/lib/apiv2');
  const auth = require('firebase-tools/lib/auth');
  const { requireAuth } = require('firebase-tools/lib/requireAuth');

  const options = {
    cwd: process.cwd(),
    project: projectId,
  };
  const account = auth.selectAccount(undefined, process.cwd());
  if (!account) {
    throw new Error('No Firebase CLI account is logged in. Run firebase login first.');
  }

  auth.setActiveAccount(options, account);
  await requireAuth(options, true);

  const client = new apiv2.Client({
    auth: true,
    apiVersion: 'v1',
    urlPrefix: api.firestoreOrigin(),
  });
  const basePath = `projects/${projectId}/databases/(default)/documents`;

  return {
    label: `Firebase CLI REST (${account.user?.email || 'logged-in account'})`,
    listDocuments: async (collectionName) => {
      const documents = [];
      let pageToken = '';

      do {
        const response = await client.get(`${basePath}/${collectionName}`, {
          queryParams: {
            pageSize: 1000,
            ...(pageToken ? { pageToken } : {}),
          },
        });

        documents.push(...(response.body.documents || []).map(decodeRestDocument));
        pageToken = response.body.nextPageToken || '';
      } while (pageToken);

      return documents;
    },
    updateFolderFields: async (invalidDocs, folderField) => {
      const batchSize = 450;
      let updatedCount = 0;

      for (let index = 0; index < invalidDocs.length; index += batchSize) {
        const slice = invalidDocs.slice(index, index + batchSize);
        const writes = slice.map(({ name }) => ({
          update: {
            name,
            fields: {
              [folderField]: { stringValue: '' },
            },
          },
          updateMask: {
            fieldPaths: [folderField],
          },
        }));

        const response = await client.post(`${basePath}:commit`, { writes }, {
          retries: 10,
          retryCodes: [429, 409, 503],
          retryMaxTimeout: 20 * 1000,
        });
        updatedCount += response.body.writeResults?.length || slice.length;
      }

      return updatedCount;
    },
  };
};

const createBackend = async () => (
  authMode === 'firebase-cli'
    ? createFirebaseCliBackend()
    : createAdminBackend()
);

const isValidFolderId = (value, validFolderIds) => (
  typeof value === 'string' && (value === '' || validFolderIds.has(value))
);

const findInvalidMediaDocs = async ({
  mediaCollection,
  folderCollection,
  folderField,
}, backend) => {
  const folders = await backend.listDocuments(folderCollection);
  const validFolderIds = new Set(folders.map((folder) => folder.id).filter(Boolean));
  const mediaDocs = await backend.listDocuments(mediaCollection);
  const invalidDocs = [];

  mediaDocs.forEach((docSnap) => {
    const data = docSnap.data || {};
    if (!isValidFolderId(data[folderField], validFolderIds)) {
      invalidDocs.push({
        ...docSnap,
        currentValue: data[folderField],
      });
    }
  });

  return {
    invalidDocs,
    totalDocs: mediaDocs.length,
    folderCount: validFolderIds.size,
  };
};

const main = async () => {
  const backend = await createBackend();
  console.log(`Grigliata media folder backfill (${shouldWrite ? 'write' : 'dry-run'} mode, ${backend.label})`);

  let totalInvalid = 0;
  let totalUpdated = 0;

  for (const definition of MEDIA_DEFINITIONS) {
    const result = await findInvalidMediaDocs(definition, backend);
    totalInvalid += result.invalidDocs.length;

    console.log([
      '',
      `${definition.label}:`,
      `  media docs: ${result.totalDocs}`,
      `  folders: ${result.folderCount}`,
      `  missing/invalid ${definition.folderField}: ${result.invalidDocs.length}`,
    ].join('\n'));

    result.invalidDocs.slice(0, 10).forEach(({ id, currentValue }) => {
      console.log(`  - ${id}: ${JSON.stringify(currentValue)} -> ""`);
    });

    if (result.invalidDocs.length > 10) {
      console.log(`  ... ${result.invalidDocs.length - 10} more`);
    }

    if (shouldWrite && result.invalidDocs.length) {
      const updatedCount = await backend.updateFolderFields(result.invalidDocs, definition.folderField);
      totalUpdated += updatedCount;
      console.log(`  updated: ${updatedCount}`);
    }
  }

  console.log([
    '',
    `Total missing/invalid docs: ${totalInvalid}`,
    shouldWrite
      ? `Total updated docs: ${totalUpdated}`
      : 'No writes performed. Re-run with --write to persist changes.',
  ].join('\n'));
};

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
});
