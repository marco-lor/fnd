#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {
  createFirebaseCliAdcFile,
} = require('../firebase-cli-admin-credential');
const {
  PRODUCTION_PROJECT_ID,
  PRODUCTION_STORAGE_BUCKET,
} = require('../production-target');
const {canonicalHash} = require('./media-derivative-backfill');

const REPORT_SCHEMA_VERSION = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_REPORT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'performance-results',
  'task07-media-storage-inventory.json'
);
const requireFromFunctions = createRequire(path.resolve(
  __dirname,
  '..',
  '..',
  'functions',
  'package.json'
));

const asString = (value) => typeof value === 'string' ? value.trim() : '';

const inventoryFingerprint = (report) => canonicalHash({
  schemaVersion: report.schemaVersion,
  projectId: report.projectId,
  storageBucket: report.storageBucket,
  complete: report.complete,
  counts: report.counts,
  objects: report.objects,
});

const normalizeInventoryObject = (value) => ({
  name: asString(value?.name),
  generation: asString(value?.generation),
  metageneration: asString(value?.metageneration),
  bytes: Number(value?.bytes ?? value?.size),
  contentType: asString(value?.contentType).toLowerCase(),
  md5Hash: asString(value?.md5Hash),
  crc32c: asString(value?.crc32c),
});

const buildInventoryReport = ({
  projectId,
  storageBucket,
  objects,
}) => {
  const normalized = objects.map(normalizeInventoryObject)
    .sort((left, right) => left.name.localeCompare(right.name));
  const invalid = normalized.filter((object) => (
    !object.name || !/^[1-9][0-9]*$/.test(object.generation) ||
    !/^[1-9][0-9]*$/.test(object.metageneration) ||
    !Number.isSafeInteger(object.bytes) || object.bytes < 0 ||
    (!object.md5Hash && !object.crc32c)
  ));
  const duplicateNames = normalized.filter((object, index) => (
    index > 0 && normalized[index - 1].name === object.name
  ));
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    projectId,
    storageBucket,
    complete: invalid.length === 0 && duplicateNames.length === 0,
    counts: {
      objects: normalized.length,
      bytes: normalized.reduce((sum, object) => sum + object.bytes, 0),
      invalid: invalid.length,
      duplicateNames: duplicateNames.length,
    },
    objects: normalized,
  };
  return {...report, fingerprint: inventoryFingerprint(report)};
};

const validateInventoryReport = (report, {
  projectId = PRODUCTION_PROJECT_ID,
  storageBucket = PRODUCTION_STORAGE_BUCKET,
} = {}) => {
  if (!report || typeof report !== 'object' ||
    report.schemaVersion !== REPORT_SCHEMA_VERSION ||
    report.projectId !== projectId ||
    report.storageBucket !== storageBucket ||
    report.complete !== true ||
    report.counts?.objects !== report.objects?.length ||
    report.counts?.invalid !== 0 ||
    report.counts?.duplicateNames !== 0 ||
    !Array.isArray(report.objects) ||
    report.fingerprint !== inventoryFingerprint(report)) {
    throw new Error('Storage inventory is incomplete, malformed, or stale.');
  }
  return report;
};

const compareInventoryReports = ({before, after}) => {
  validateInventoryReport(before, {
    projectId: after.projectId,
    storageBucket: after.storageBucket,
  });
  validateInventoryReport(after, {
    projectId: before.projectId,
    storageBucket: before.storageBucket,
  });
  const afterByName = new Map(after.objects.map((object) => [
    object.name,
    object,
  ]));
  const missing = [];
  const changed = [];
  for (const object of before.objects) {
    const current = afterByName.get(object.name);
    if (!current) {
      missing.push(object.name);
      continue;
    }
    if (canonicalHash(current) !== canonicalHash(object)) {
      changed.push({
        name: object.name,
        beforeFingerprint: canonicalHash(object),
        afterFingerprint: canonicalHash(current),
      });
    }
  }
  const beforeNames = new Set(before.objects.map(({name}) => name));
  const additions = after.objects
    .map(({name}) => name)
    .filter((name) => !beforeNames.has(name));
  return {
    preserved: missing.length === 0 && changed.length === 0,
    beforeFingerprint: before.fingerprint,
    afterFingerprint: after.fingerprint,
    counts: {
      before: before.objects.length,
      after: after.objects.length,
      missing: missing.length,
      changed: changed.length,
      additions: additions.length,
    },
    missing,
    changed,
    additions,
  };
};

const parsePositiveInteger = (value, name, maximum) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return parsed;
};

const parseArguments = (args = []) => {
  const options = {
    allowLiveProject: false,
    authMode: 'firebase-cli',
    comparePath: '',
    confirmProject: '',
    help: false,
    pageSize: DEFAULT_PAGE_SIZE,
    projectId: '',
    reportPath: DEFAULT_REPORT_PATH,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--allow-live-project') {
      options.allowLiveProject = true;
    } else if ([
      '--project',
      '--auth',
      '--confirm-project',
      '--compare',
      '--report',
      '--page-size',
    ].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--project') options.projectId = value;
      if (argument === '--auth') options.authMode = value;
      if (argument === '--confirm-project') options.confirmProject = value;
      if (argument === '--compare') options.comparePath = path.resolve(value);
      if (argument === '--report') options.reportPath = path.resolve(value);
      if (argument === '--page-size') {
        options.pageSize = parsePositiveInteger(
          value,
          '--page-size',
          MAX_PAGE_SIZE
        );
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.help) return options;
  if (options.projectId !== PRODUCTION_PROJECT_ID ||
    options.confirmProject !== PRODUCTION_PROJECT_ID ||
    options.allowLiveProject !== true ||
    options.authMode !== 'firebase-cli') {
    throw new Error(
      `Inventory requires exact project ${PRODUCTION_PROJECT_ID}, ` +
      '--auth firebase-cli, --allow-live-project, and matching confirmation.'
    );
  }
  if (options.reportPath === options.comparePath) {
    throw new Error('--report must not overwrite the comparison inventory.');
  }
  return options;
};

const assertSafeEnvironment = (environment = process.env) => {
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (environment[variable] &&
      environment[variable] !== PRODUCTION_PROJECT_ID) {
      throw new Error(`${variable} does not match the explicit project.`);
    }
  }
  if (environment.FIRESTORE_EMULATOR_HOST ||
    environment.FIREBASE_STORAGE_EMULATOR_HOST ||
    environment.FUNCTIONS_EMULATOR_HOST) {
    throw new Error('Storage inventory refuses all emulator hosts.');
  }
  return true;
};

const createBackend = async ({projectId, pageSize}) => {
  const {deleteApp, initializeApp} = requireFromFunctions('firebase-admin/app');
  const {getStorage} = requireFromFunctions('firebase-admin/storage');
  const previousAdcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const temporaryAdc = await createFirebaseCliAdcFile({projectId});
  process.env.GOOGLE_APPLICATION_CREDENTIALS = temporaryAdc.filePath;
  let app;
  try {
    app = initializeApp(
      {projectId, storageBucket: PRODUCTION_STORAGE_BUCKET},
      `task07-storage-inventory-${process.pid}-${Date.now()}`
    );
  } catch (error) {
    if (previousAdcPath === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdcPath;
    }
    temporaryAdc.cleanup();
    throw error;
  }
  const bucket = getStorage(app).bucket();
  return {
    readAll: async () => {
      const objects = [];
      let pageToken;
      do {
        const [files, nextQuery] = await bucket.getFiles({
          autoPaginate: false,
          maxResults: pageSize,
          ...(pageToken ? {pageToken} : {}),
        });
        const metadata = await Promise.all(files.map(async (file) => {
          const [value] = await file.getMetadata();
          return {
            name: file.name,
            generation: value.generation,
            metageneration: value.metageneration,
            bytes: Number(value.size),
            contentType: value.contentType,
            md5Hash: value.md5Hash,
            crc32c: value.crc32c,
          };
        }));
        objects.push(...metadata);
        pageToken = asString(nextQuery?.pageToken) || undefined;
      } while (pageToken);
      return objects;
    },
    close: async () => {
      try {
        await deleteApp(app);
      } finally {
        if (previousAdcPath === undefined) {
          delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        } else {
          process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdcPath;
        }
        temporaryAdc.cleanup();
      }
    },
  };
};

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read inventory ${filePath}.`, {cause: error});
  }
};

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
};

const printHelp = () => console.log([
  `Read-only Storage inventory for ${PRODUCTION_PROJECT_ID}.`,
  '',
  'Usage:',
  `  node scripts/task07/media-storage-inventory.js --project ${PRODUCTION_PROJECT_ID}`,
  `    --confirm-project ${PRODUCTION_PROJECT_ID} --allow-live-project`,
  '    --auth firebase-cli [--page-size 1..1000] [--report <path>]',
  '    [--compare <pre-cutover-inventory>]',
  '',
  'The command lists metadata only. It never downloads, changes, or deletes',
  'objects. Comparison fails if any pre-cutover object is absent or changed.',
].join('\n'));

const main = async (argv = process.argv.slice(2)) => {
  const options = parseArguments(argv);
  if (options.help) return printHelp();
  assertSafeEnvironment();
  const backend = await createBackend(options);
  try {
    const report = buildInventoryReport({
      projectId: options.projectId,
      storageBucket: PRODUCTION_STORAGE_BUCKET,
      objects: await backend.readAll(),
    });
    validateInventoryReport(report);
    writeJsonAtomic(options.reportPath, report);
    const comparison = options.comparePath ? compareInventoryReports({
      before: readJson(options.comparePath),
      after: report,
    }) : null;
    console.log(JSON.stringify({
      projectId: report.projectId,
      storageBucket: report.storageBucket,
      counts: report.counts,
      fingerprint: report.fingerprint,
      reportPath: options.reportPath,
      ...(comparison ? {comparison} : {}),
    }, null, 2));
    if (comparison && !comparison.preserved) {
      throw new Error(
        'Storage preservation check failed; do not accept the cutover.'
      );
    }
  } finally {
    await backend.close();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error('Task 07 storage inventory failed:', error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  assertSafeEnvironment,
  buildInventoryReport,
  compareInventoryReports,
  inventoryFingerprint,
  parseArguments,
  validateInventoryReport,
};
