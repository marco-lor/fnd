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
const DEFAULT_REPORT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'performance-results',
  'task07-media-temporary-cleanup-plan.json'
);
const requireFromFunctions = createRequire(path.resolve(
  __dirname,
  '..',
  '..',
  'functions',
  'package.json'
));
const TEMPORARY_OBJECT_PATTERN = /^(media_assets\/v1\/(signed-in|owner-manager|dm-only)\/([^/]+)\/(m_[a-f0-9]{40})\/([1-9][0-9]*)\/(original|thumbnail|thumbnail2x|card|card2x|gallery|gallery2x|poster|poster2x))\.tmp-([A-Za-z0-9_-]{1,96})$/;
const ACCEPTED_MANIFEST_STATES = new Set([
  'ready',
  'attached',
  'superseded',
  'cleanup-pending',
]);

const asString = (value) => typeof value === 'string' ? value.trim() : '';

const parseTemporaryObjectName = (value) => {
  const match = TEMPORARY_OBJECT_PATTERN.exec(asString(value));
  return match ? {
    temporaryPath: match[0],
    finalPath: match[1],
    audienceScope: match[2],
    ownerKey: match[3],
    assetId: match[4],
    sourceGeneration: match[5],
    role: match[6],
    eventId: match[7],
  } : null;
};

const normalizeStorageObject = (value) => ({
  name: asString(value?.name),
  generation: asString(value?.generation),
  metageneration: asString(value?.metageneration),
  bytes: Number(value?.bytes ?? value?.size),
  contentType: asString(value?.contentType).toLowerCase(),
  md5Hash: asString(value?.md5Hash),
  crc32c: asString(value?.crc32c),
  metadata: Object.fromEntries([
    'task07AssetId',
    'task07Checksum',
    'task07ContractVersion',
    'task07EntityId',
    'task07Kind',
    'task07OwnerUid',
    'task07Role',
  ].map((key) => [key, asString(value?.metadata?.[key])])),
});

const generatedDescriptors = (data) => {
  const generated = data?.generated;
  if (!generated || typeof generated !== 'object') return [];
  const variants = generated.variants && typeof generated.variants === 'object' ?
    Object.values(generated.variants) : [];
  return [generated.original, ...variants]
    .filter((value) => value && typeof value === 'object');
};

const subjectIssues = (subject) => {
  const issues = [];
  const parsed = parseTemporaryObjectName(subject.temporary?.name);
  const temporary = normalizeStorageObject(subject.temporary);
  const final = subject.final ? normalizeStorageObject(subject.final) : null;
  const manifest = subject.manifest || {};
  const cleanup = subject.cleanup || {};
  const data = manifest.data || {};
  const plan = data.plan || {};
  const descriptor = final ? generatedDescriptors(data)
    .find((value) => asString(value.path) === final.name) : null;
  if (!parsed) issues.push('temporary-path-invalid');
  if (!manifest.exists) issues.push('media-manifest-missing');
  const manifestState = asString(data.state);
  const committed = ACCEPTED_MANIFEST_STATES.has(manifestState);
  const deleted = manifestState === 'deleted';
  if (!committed && !deleted) {
    issues.push('media-manifest-state-not-committed');
  }
  if (parsed && (
    asString(plan.assetId) !== parsed.assetId ||
    asString(plan.audienceScope) !== parsed.audienceScope ||
    asString(plan.ownerKey) !== parsed.ownerKey ||
    asString(data.generation) !== parsed.sourceGeneration
  )) issues.push('media-manifest-identity-mismatch');
  if (committed) {
    if (!final) issues.push('canonical-final-missing');
    if (!descriptor) issues.push('canonical-descriptor-missing');
    if (final && parsed && final.name !== parsed.finalPath) {
      issues.push('canonical-final-path-mismatch');
    }
  }
  if (deleted) {
    if (final) issues.push('deleted-manifest-final-still-present');
    if (!cleanup.exists ||
      asString(cleanup.data?.state) !== 'complete' ||
      asString(cleanup.data?.assetId) !== parsed?.assetId) {
      issues.push('deleted-manifest-cleanup-not-complete');
    }
  }
  if (final && (
    temporary.bytes !== final.bytes ||
    temporary.contentType !== final.contentType ||
    temporary.md5Hash !== final.md5Hash ||
    temporary.crc32c !== final.crc32c ||
    temporary.metadata.task07Checksum !== final.metadata.task07Checksum
  )) issues.push('temporary-copy-content-mismatch');
  if (parsed && [temporary, ...(final ? [final] : [])].some((object) => (
    object.metadata.task07AssetId !== parsed.assetId ||
    object.metadata.task07Role !== parsed.role ||
    object.metadata.task07OwnerUid !== asString(plan.ownerUid) ||
    object.metadata.task07Kind !== asString(plan.kind) ||
    !/^[a-f0-9]{64}$/.test(object.metadata.task07Checksum)
  ))) issues.push('storage-private-metadata-mismatch');
  if (descriptor && final && (
    asString(descriptor.path) !== final.name ||
    asString(descriptor.generation) !== final.generation ||
    Number(descriptor.bytes) !== final.bytes ||
    asString(descriptor.contentType).toLowerCase() !== final.contentType ||
    asString(descriptor.checksum) !== final.metadata.task07Checksum
  )) issues.push('canonical-descriptor-object-mismatch');
  if (!/^[1-9][0-9]*$/.test(temporary.generation) ||
    !/^[1-9][0-9]*$/.test(temporary.metageneration)) {
    issues.push('temporary-generation-invalid');
  }
  return [...new Set(issues)].sort();
};

const planFingerprint = (report) => canonicalHash({
  schemaVersion: report.schemaVersion,
  projectId: report.projectId,
  storageBucket: report.storageBucket,
  expectedCandidates: report.expectedCandidates,
  complete: report.complete,
  counts: report.counts,
  entries: report.entries,
  issues: report.issues,
});

const buildCleanupPlan = ({
  projectId,
  storageBucket,
  scannedObjects,
  subjects,
  expectedCandidates = null,
}) => {
  const entries = [];
  const issues = [];
  [...subjects]
    .sort((left, right) => asString(left.temporary?.name).localeCompare(
      asString(right.temporary?.name)
    ))
    .forEach((subject) => {
      const subjectErrors = subjectIssues(subject);
      const temporary = normalizeStorageObject(subject.temporary);
      if (subjectErrors.length) {
        issues.push({name: temporary.name, codes: subjectErrors});
        return;
      }
      const parsed = parseTemporaryObjectName(temporary.name);
      const final = subject.final ? normalizeStorageObject(subject.final) : null;
      const category = asString(subject.manifest.data.state) === 'deleted' ?
        'deleted-manifest-residue' : 'duplicate-staging-copy';
      const entry = {
        deletionId: canonicalHash({
          name: temporary.name,
          generation: temporary.generation,
        }),
        assetId: parsed.assetId,
        category,
        manifestState: asString(subject.manifest.data.state),
        manifestUpdateTime: asString(subject.manifest.updateTime),
        temporary,
        final,
      };
      entries.push(entry);
    });
  const counts = {
    scannedObjects,
    temporaryObjects: subjects.length,
    candidates: entries.length,
    duplicateStagingCopies: entries.filter(({category}) => (
      category === 'duplicate-staging-copy'
    )).length,
    deletedManifestResidues: entries.filter(({category}) => (
      category === 'deleted-manifest-residue'
    )).length,
    issues: issues.length,
  };
  const expectedMatches = expectedCandidates === null ||
    expectedCandidates === entries.length;
  if (!expectedMatches) {
    issues.push({
      name: '',
      codes: ['expected-candidate-count-mismatch'],
    });
    counts.issues = issues.length;
  }
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    projectId,
    storageBucket,
    expectedCandidates,
    complete: issues.length === 0 && expectedMatches,
    counts,
    entries,
    issues,
  };
  return {...report, fingerprint: planFingerprint(report)};
};

const validateCleanupPlan = (report, {
  projectId = PRODUCTION_PROJECT_ID,
  storageBucket = PRODUCTION_STORAGE_BUCKET,
  requireExecutable = false,
} = {}) => {
  if (!report || typeof report !== 'object' ||
    report.schemaVersion !== REPORT_SCHEMA_VERSION ||
    report.projectId !== projectId ||
    report.storageBucket !== storageBucket ||
    report.complete !== true ||
    !Array.isArray(report.entries) ||
    !Array.isArray(report.issues) ||
    report.issues.length !== 0 ||
    report.counts?.candidates !== report.entries.length ||
    report.counts?.temporaryObjects !== report.entries.length ||
    report.counts?.issues !== 0 ||
    report.fingerprint !== planFingerprint(report) ||
    new Set(report.entries.map(({deletionId}) => deletionId)).size !==
      report.entries.length ||
    report.entries.some((entry) => (
      entry.deletionId !== canonicalHash({
        name: entry.temporary?.name,
        generation: entry.temporary?.generation,
      }) ||
      !parseTemporaryObjectName(entry.temporary?.name) ||
      (entry.category === 'duplicate-staging-copy' &&
        parseTemporaryObjectName(entry.temporary?.name).finalPath !==
          entry.final?.name) ||
      (entry.category === 'deleted-manifest-residue' && entry.final !== null) ||
      !['duplicate-staging-copy', 'deleted-manifest-residue']
        .includes(entry.category)
    ))) {
    throw new Error('Temporary cleanup plan is incomplete, malformed, or stale.');
  }
  if (requireExecutable && (
    !Number.isSafeInteger(report.expectedCandidates) ||
    report.expectedCandidates < 1 ||
    report.expectedCandidates !== report.entries.length
  )) {
    throw new Error('Execution requires a positive bound candidate count.');
  }
  return report;
};

const parseNonNegativeInteger = (value, name) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
};

const parseArguments = (args = []) => {
  const options = {
    allowLiveProject: false,
    approveFingerprint: '',
    approvedReportPath: '',
    authMode: 'firebase-cli',
    confirmProject: '',
    execute: false,
    expectedCandidates: null,
    help: false,
    projectId: '',
    reportPath: DEFAULT_REPORT_PATH,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--allow-live-project') options.allowLiveProject = true;
    else if (argument === '--execute') options.execute = true;
    else if ([
      '--project',
      '--auth',
      '--confirm-project',
      '--expected-candidates',
      '--approved-report',
      '--approve-fingerprint',
      '--report',
    ].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--project') options.projectId = value;
      if (argument === '--auth') options.authMode = value;
      if (argument === '--confirm-project') options.confirmProject = value;
      if (argument === '--expected-candidates') {
        options.expectedCandidates = parseNonNegativeInteger(
          value,
          '--expected-candidates'
        );
      }
      if (argument === '--approved-report') {
        options.approvedReportPath = path.resolve(value);
      }
      if (argument === '--approve-fingerprint') {
        options.approveFingerprint = value;
      }
      if (argument === '--report') options.reportPath = path.resolve(value);
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
      `Cleanup requires exact project ${PRODUCTION_PROJECT_ID}, ` +
      '--auth firebase-cli, --allow-live-project, and matching confirmation.'
    );
  }
  if (options.execute && (
    !options.approvedReportPath ||
    !/^[a-f0-9]{64}$/.test(options.approveFingerprint) ||
    !Number.isSafeInteger(options.expectedCandidates) ||
    options.expectedCandidates < 1 ||
    options.approvedReportPath === options.reportPath
  )) {
    throw new Error(
      'Execution requires a separate approved report, positive expected count, ' +
      'exact fingerprint, and a distinct output report.'
    );
  }
  return options;
};

const assertSafeEnvironment = (environment = process.env) => {
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (environment[variable] && environment[variable] !== PRODUCTION_PROJECT_ID) {
      throw new Error(`${variable} does not match the explicit project.`);
    }
  }
  if (environment.FIRESTORE_EMULATOR_HOST ||
    environment.FIREBASE_STORAGE_EMULATOR_HOST ||
    environment.FUNCTIONS_EMULATOR_HOST) {
    throw new Error('Temporary cleanup refuses all emulator hosts.');
  }
  return true;
};

const normalizeMetadata = (file, value) => normalizeStorageObject({
  name: file.name,
  generation: value.generation,
  metageneration: value.metageneration,
  bytes: Number(value.size),
  contentType: value.contentType,
  md5Hash: value.md5Hash,
  crc32c: value.crc32c,
  metadata: value.metadata,
});

const createBackend = async ({projectId}) => {
  const {deleteApp, initializeApp} = requireFromFunctions('firebase-admin/app');
  const {getFirestore} = requireFromFunctions('firebase-admin/firestore');
  const {getStorage} = requireFromFunctions('firebase-admin/storage');
  const previousAdcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const temporaryAdc = await createFirebaseCliAdcFile({projectId});
  process.env.GOOGLE_APPLICATION_CREDENTIALS = temporaryAdc.filePath;
  let app;
  try {
    app = initializeApp(
      {projectId, storageBucket: PRODUCTION_STORAGE_BUCKET},
      `task07-temporary-cleanup-${process.pid}-${Date.now()}`
    );
  } catch (error) {
    if (previousAdcPath === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdcPath;
    temporaryAdc.cleanup();
    throw error;
  }
  const bucket = getStorage(app).bucket();
  const db = getFirestore(app);
  const readObject = async (name) => {
    try {
      const file = bucket.file(name);
      const [metadata] = await file.getMetadata();
      return normalizeMetadata(file, metadata);
    } catch (error) {
      if (Number(error?.code) === 404) return null;
      throw error;
    }
  };
  return {
    readState: async () => {
      const [files] = await bucket.getFiles({prefix: 'media_assets/v1/'});
      const temporaryFiles = files.filter((file) => (
        parseTemporaryObjectName(file.name)
      ));
      const subjects = await Promise.all(temporaryFiles.map(async (file) => {
        const parsed = parseTemporaryObjectName(file.name);
        const [temporary, final, manifest, cleanup] = await Promise.all([
          readObject(file.name),
          readObject(parsed.finalPath),
          db.doc(`media_assets/${parsed.assetId}`).get(),
          db.doc(`media_asset_cleanup/${parsed.assetId}`).get(),
        ]);
        return {
          temporary,
          final,
          manifest: {
            exists: manifest.exists,
            data: manifest.data() || {},
            updateTime: manifest.updateTime?.toDate().toISOString() || '',
          },
          cleanup: {
            exists: cleanup.exists,
            data: cleanup.data() || {},
            updateTime: cleanup.updateTime?.toDate().toISOString() || '',
          },
        };
      }));
      return {scannedObjects: files.length, subjects};
    },
    deleteExact: async ({name, generation}) => {
      await bucket.file(name, {generation}).delete({ignoreNotFound: false});
      const [exists] = await bucket.file(name).exists();
      if (exists) throw new Error(`Temporary object still exists: ${name}`);
    },
    verifyFinal: async (expected) => {
      const current = await readObject(expected.name);
      if (!current || canonicalHash(current) !== canonicalHash(expected)) {
        throw new Error(`Canonical final changed during cleanup: ${expected.name}`);
      }
    },
    close: async () => {
      try {
        await deleteApp(app);
      } finally {
        if (previousAdcPath === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdcPath;
        temporaryAdc.cleanup();
      }
    },
  };
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
};

const printHelp = () => console.log([
  `Generation-fenced Task 07 temporary-object cleanup for ${PRODUCTION_PROJECT_ID}.`,
  '',
  'Dry-run:',
  `  node scripts/task07/media-temporary-object-cleanup.js --project ${PRODUCTION_PROJECT_ID}`,
  `    --confirm-project ${PRODUCTION_PROJECT_ID} --allow-live-project`,
  '    --auth firebase-cli [--expected-candidates <n>] --report <plan.json>',
  '',
  'Execute only a separately reviewed bound plan:',
  '  add --execute --approved-report <plan.json>',
  '    --approve-fingerprint <sha256> --expected-candidates <positive n>',
  '    --report <execution.json>',
  '',
  'Eligible entries are either byte-identical copies beside a manifest-bound',
  'canonical final, or residues whose manifest is deleted and cleanup ledger',
  'is complete. Deletes target the reviewed temporary generation only.',
].join('\n'));

const main = async (argv = process.argv.slice(2)) => {
  const options = parseArguments(argv);
  if (options.help) return printHelp();
  assertSafeEnvironment();
  const backend = await createBackend(options);
  try {
    const state = await backend.readState();
    const plan = buildCleanupPlan({
      projectId: options.projectId,
      storageBucket: PRODUCTION_STORAGE_BUCKET,
      scannedObjects: state.scannedObjects,
      subjects: state.subjects,
      expectedCandidates: options.expectedCandidates,
    });
    writeJsonAtomic(options.reportPath, plan);
    if (!plan.complete) {
      throw new Error('Temporary cleanup plan has blocking issues or count drift.');
    }
    validateCleanupPlan(plan);
    if (!options.execute) {
      console.log(JSON.stringify({
        mode: 'dry-run',
        counts: plan.counts,
        fingerprint: plan.fingerprint,
        reportPath: options.reportPath,
      }, null, 2));
      return;
    }
    const approved = validateCleanupPlan(
      readJson(options.approvedReportPath),
      {requireExecutable: true}
    );
    if (approved.fingerprint !== options.approveFingerprint ||
      plan.fingerprint !== approved.fingerprint ||
      plan.expectedCandidates !== options.expectedCandidates) {
      throw new Error('Live temporary cleanup plan does not match approval.');
    }
    for (const entry of approved.entries) {
      await backend.deleteExact(entry.temporary);
      if (entry.final) await backend.verifyFinal(entry.final);
    }
    const after = await backend.readState();
    const remaining = buildCleanupPlan({
      projectId: options.projectId,
      storageBucket: PRODUCTION_STORAGE_BUCKET,
      scannedObjects: after.scannedObjects,
      subjects: after.subjects,
      expectedCandidates: 0,
    });
    if (!remaining.complete || remaining.counts.candidates !== 0) {
      throw new Error('Temporary objects remain after the approved deletion.');
    }
    const execution = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      projectId: options.projectId,
      storageBucket: PRODUCTION_STORAGE_BUCKET,
      approvedFingerprint: approved.fingerprint,
      deleted: approved.entries.map(({deletionId, temporary}) => ({
        deletionId,
        name: temporary.name,
        generation: temporary.generation,
      })),
      remainingCounts: remaining.counts,
      complete: true,
    };
    writeJsonAtomic(options.reportPath, execution);
    console.log(JSON.stringify({
      mode: 'execute',
      deleted: execution.deleted.length,
      approvedFingerprint: approved.fingerprint,
      remainingCounts: remaining.counts,
      reportPath: options.reportPath,
    }, null, 2));
  } finally {
    await backend.close();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error('Task 07 temporary cleanup failed:', error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  assertSafeEnvironment,
  buildCleanupPlan,
  parseArguments,
  parseTemporaryObjectName,
  planFingerprint,
  subjectIssues,
  validateCleanupPlan,
};
