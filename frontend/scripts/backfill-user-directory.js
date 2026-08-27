#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const {
  createFirebaseCliAdcFile,
} = require('./firebase-cli-admin-credential');
const {
  resolveCurrentBranchName,
  resolveEnvironmentSelection,
} = require('./firebase-environment');

const BATCH_SIZE = 200;
const REPORT_SCHEMA_VERSION = 2;
const USER_DIRECTORY_SCHEMA_VERSION = 1;
const UNNAMED_CHARACTER_LABEL = 'Unnamed character';
const CANONICAL_ROLES = new Set(['player', 'dm', 'webmaster']);
const AUTH_MODES = new Set(['admin', 'firebase-cli']);
const DEFAULT_CHECKPOINT_PATH = path.resolve(
  __dirname,
  '..',
  'performance-results',
  'user-directory-backfill-checkpoint.json'
);
const DEFAULT_REPORT_PATH = path.resolve(
  __dirname,
  '..',
  'performance-results',
  'user-directory-backfill-dry-run.json'
);
const DEFAULT_VERIFY_REPORT_PATH = path.resolve(
  __dirname,
  '..',
  'performance-results',
  'user-directory-backfill-verification.json'
);

const trimString = (value) => (typeof value === 'string' ? value.trim() : '');

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
};

const canonicalHash = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

const planFingerprintFor = ({projectId, subjects}) => canonicalHash({
  batchSize: BATCH_SIZE,
  projectId,
  subjects,
});

const normalizeDirectoryRole = (value) => {
  const normalizedRole = trimString(value).toLowerCase();
  if (normalizedRole === 'players') return 'player';
  return CANONICAL_ROLES.has(normalizedRole) ? normalizedRole : 'player';
};

const normalizeDirectoryLabel = (value) => String(value)
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const buildUserDirectoryProjection = (sourceData = {}) => {
  const characterId = trimString(sourceData?.characterId);
  const label = characterId || UNNAMED_CHARACTER_LABEL;
  return {
    schemaVersion: USER_DIRECTORY_SCHEMA_VERSION,
    characterId,
    label,
    normalizedLabel: normalizeDirectoryLabel(label),
    role: normalizeDirectoryRole(sourceData?.role),
  };
};

const PROJECTION_KEYS = Object.freeze([
  'characterId',
  'label',
  'normalizedLabel',
  'role',
  'schemaVersion',
]);

const projectionMatches = (existingData, projection) => (
  existingData != null
  && Object.keys(existingData).sort().join('\0') === PROJECTION_KEYS.join('\0')
  && PROJECTION_KEYS.every((key) => existingData[key] === projection[key])
);

const printHelp = () => {
  console.log([
    'Backfill server-owned user_directory projections.',
    '',
    'Usage:',
    '  node scripts/backfill-user-directory.js --environment production|staging|performance',
    '    --project <project> --site <hosting-site> --bucket <storage-bucket>',
    '    [--auth admin|firebase-cli]',
    '    [--verify | --write --approve-fingerprint <sha256>] [--resume]',
    '    [--checkpoint <path>] [--report <path>] [--max-batches <count>]',
    '    [--allow-live-project --confirm-project <project>]',
    '',
    'Safety:',
    '  - Default mode is read-only and writes a local dry-run report.',
    '  - --verify is read-only and fails on missing, stale, or orphaned projections.',
    '  - --write requires the exact completed dry-run fingerprint.',
    '  - Performance access requires the loopback Firestore emulator and demo-fnd-perf.',
    '  - Live access requires Firebase CLI auth and exact project confirmation.',
  ].join('\n'));
};

const parseArguments = (args = []) => {
  const parsed = {
    allowLiveProject: false,
    approveFingerprint: '',
    authMode: 'admin',
    checkpointPath: DEFAULT_CHECKPOINT_PATH,
    confirmProject: '',
    environmentName: '',
    help: false,
    hostingSite: '',
    maxBatches: Number.POSITIVE_INFINITY,
    projectId: '',
    reportPath: DEFAULT_REPORT_PATH,
    reportPathExplicit: false,
    resume: false,
    shouldWrite: false,
    storageBucket: '',
    verifyOnly: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    if (argument === '--write') {
      parsed.shouldWrite = true;
      continue;
    }
    if (argument === '--verify') {
      parsed.verifyOnly = true;
      continue;
    }
    if (argument === '--allow-live-project') {
      parsed.allowLiveProject = true;
      continue;
    }
    if (argument === '--resume') {
      parsed.resume = true;
      continue;
    }

    if ([
      '--environment',
      '--project',
      '--site',
      '--bucket',
      '--auth',
      '--checkpoint',
      '--report',
      '--max-batches',
      '--confirm-project',
      '--approve-fingerprint',
    ].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--environment') parsed.environmentName = value;
      if (argument === '--project') parsed.projectId = value;
      if (argument === '--site') parsed.hostingSite = value;
      if (argument === '--bucket') parsed.storageBucket = value;
      if (argument === '--auth') parsed.authMode = value;
      if (argument === '--checkpoint') parsed.checkpointPath = path.resolve(value);
      if (argument === '--report') {
        parsed.reportPath = path.resolve(value);
        parsed.reportPathExplicit = true;
      }
      if (argument === '--confirm-project') parsed.confirmProject = value;
      if (argument === '--approve-fingerprint') parsed.approveFingerprint = value;
      if (argument === '--max-batches') {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) {
          throw new Error('--max-batches must be a positive integer.');
        }
        parsed.maxBatches = count;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!parsed.help && !parsed.projectId) {
    throw new Error('Explicit --project <project-id> is required.');
  }
  if (!AUTH_MODES.has(parsed.authMode)) {
    throw new Error('--auth must be exactly admin or firebase-cli.');
  }
  if (parsed.resume && !parsed.shouldWrite) {
    throw new Error('--resume is only valid with --write.');
  }
  if (parsed.verifyOnly && parsed.shouldWrite) {
    throw new Error('--verify and --write are mutually exclusive.');
  }
  if (parsed.verifyOnly && !parsed.reportPathExplicit) {
    parsed.reportPath = DEFAULT_VERIFY_REPORT_PATH;
  }
  return parsed;
};

const assertDirectoryVerification = (result) => {
  const counts = result?.counts ?? {};
  const create = Number(counts.create) || 0;
  const scanned = Number(counts.scanned) || 0;
  const update = Number(counts.update) || 0;
  const directoryDocuments = Number(result?.directoryDocuments);
  const failures = [];
  if (result?.complete !== true) failures.push('source scan is incomplete');
  if (create > 0 || update > 0) {
    failures.push(`${create} missing and ${update} stale projection(s)`);
  }
  if (!Number.isInteger(directoryDocuments) || directoryDocuments < 0) {
    failures.push('directory document count is unavailable');
  } else if (directoryDocuments !== scanned) {
    failures.push(
      `directory count ${directoryDocuments} does not match ${scanned} source user(s)`
    );
  }
  if (failures.length) {
    throw new Error(
      `User-directory verification failed: ${failures.join('; ')}.`
    );
  }
  return result;
};

const parseEmulatorHost = (value) => {
  if (!value || typeof value !== 'string' || value.includes('://')) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username
      || parsed.password
      || (parsed.pathname && parsed.pathname !== '/')
      || parsed.search
      || parsed.hash
      || !parsed.port
    ) {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
};

const assertSafeTarget = (options, env = process.env) => {
  const {projectId} = options;
  const emulator = parseEmulatorHost(env.FIRESTORE_EMULATOR_HOST);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  for (const variableName of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    const inheritedProject = env[variableName];
    if (inheritedProject && inheritedProject !== projectId) {
      throw new Error(
        `${variableName}=${inheritedProject} does not match --project ${projectId}.`
      );
    }
  }
  const target = resolveEnvironmentSelection({
    branchName: resolveCurrentBranchName({
      environment: env,
      cwd: path.resolve(__dirname, '..'),
    }),
    environmentName: options.environmentName,
    hostingSite: options.hostingSite,
    projectId,
    storageBucket: options.storageBucket,
  });
  if (emulator && loopbackHosts.has(emulator.hostname)) {
    if (target.name !== 'performance') {
      throw new Error('User-directory emulator access requires the performance environment.');
    }
    return {emulatorHost: env.FIRESTORE_EMULATOR_HOST, live: false, projectId};
  }
  if (env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Non-loopback Firestore emulator hosts are refused.');
  }
  if (!target.deployable) {
    throw new Error(`Live user-directory access cannot target ${target.name}.`);
  }
  if (!options.allowLiveProject || options.confirmProject !== projectId) {
    throw new Error(
      `Live Firestore access requires --allow-live-project and exact --confirm-project ${projectId}.`
    );
  }
  if (options.authMode !== 'firebase-cli') {
    throw new Error(`Live ${target.name} access requires --auth firebase-cli.`);
  }
  return {emulatorHost: null, live: true, projectId};
};

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
};

const readJson = (filePath, label) => {
  if (!fs.existsSync(filePath)) throw new Error(`${label} not found: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${filePath}`, {cause: error});
  }
};

const assertCompletedDryRunReport = (report, projectId, approvedFingerprint = '') => {
  if (
    report?.schemaVersion !== REPORT_SCHEMA_VERSION
    || report?.mode !== 'dry-run'
    || report?.projectId !== projectId
    || report?.batchSize !== BATCH_SIZE
    || report?.complete !== true
    || !Array.isArray(report?.subjects)
    || report?.planFingerprint !== planFingerprintFor({projectId, subjects: report.subjects})
  ) {
    throw new Error(
      'Write mode requires a completed, schema-compatible dry-run report for the same project.'
    );
  }
  if (
    !/^[a-f0-9]{64}$/.test(approvedFingerprint)
    || approvedFingerprint !== report.planFingerprint
  ) {
    throw new Error('--approve-fingerprint must exactly match the completed dry-run plan.');
  }
  return report;
};

const assertResumeCheckpoint = (checkpoint, projectId) => {
  if (
    checkpoint?.schemaVersion !== REPORT_SCHEMA_VERSION
    || checkpoint?.mode !== 'write'
    || checkpoint?.projectId !== projectId
    || checkpoint?.batchSize !== BATCH_SIZE
    || typeof checkpoint?.lastDocumentId !== 'string'
  ) {
    throw new Error('Resume checkpoint is incompatible with this project or backfill version.');
  }
  return checkpoint;
};

const emptyCounts = () => ({
  batches: 0,
  create: 0,
  scanned: 0,
  unchanged: 0,
  update: 0,
  written: 0,
});

const runBackfill = async ({
  backend,
  initialCounts = emptyCounts(),
  maxBatches = Number.POSITIVE_INFINITY,
  onCheckpoint = async () => {},
  shouldWrite = false,
  startAfter = '',
}) => {
  const counts = {...emptyCounts(), ...initialCounts};
  let cursor = startAfter;
  let complete = false;
  let batchesThisRun = 0;
  const subjects = [];

  while (batchesThisRun < maxBatches) {
    const users = await backend.fetchUserPage({
      afterDocumentId: cursor,
      limit: BATCH_SIZE,
    });
    if (!Array.isArray(users) || users.length > BATCH_SIZE) {
      throw new Error(`Backfill backend returned an invalid page larger than ${BATCH_SIZE}.`);
    }
    if (!users.length) {
      complete = true;
      break;
    }

    let previousId = cursor;
    for (const user of users) {
      if (!user?.id || (previousId && user.id <= previousId)) {
        throw new Error('User backfill page is not strictly ordered by document ID.');
      }
      previousId = user.id;
    }

    const existingById = await backend.getDirectoryDocuments(users.map(({id}) => id));
    const pending = [];
    for (const user of users) {
      const projection = buildUserDirectoryProjection(user.data);
      const existing = existingById.get(user.id) ?? null;
      counts.scanned += 1;
      const action = projectionMatches(existing, projection)
        ? 'unchanged'
        : existing == null ? 'create' : 'update';
      subjects.push({
        action,
        currentHash: canonicalHash(existing),
        documentIdHash: canonicalHash(user.id),
        projectionHash: canonicalHash(projection),
      });
      if (action === 'unchanged') {
        counts.unchanged += 1;
        continue;
      }
      if (action === 'create') counts.create += 1;
      else counts.update += 1;
      pending.push({id: user.id, projection});
    }

    if (shouldWrite && pending.length) {
      await backend.commitProjections(pending);
      counts.written += pending.length;
    }

    counts.batches += 1;
    batchesThisRun += 1;
    cursor = users[users.length - 1].id;
    complete = users.length < BATCH_SIZE;
    await onCheckpoint({
      batchSize: BATCH_SIZE,
      complete,
      counts: {...counts},
      lastDocumentId: cursor,
    });
    if (complete) break;
  }

  return {
    batchSize: BATCH_SIZE,
    complete,
    counts,
    lastDocumentId: cursor,
    subjects,
  };
};

const createAdminBackend = async (projectId, authMode = 'admin') => {
  const {deleteApp, initializeApp} = require('firebase-admin/app');
  const {FieldPath, getFirestore} = require('firebase-admin/firestore');
  const previousAdcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const temporaryAdc = authMode === 'firebase-cli'
    ? await createFirebaseCliAdcFile({projectId})
    : null;
  if (temporaryAdc) process.env.GOOGLE_APPLICATION_CREDENTIALS = temporaryAdc.filePath;
  let app;
  try {
    app = initializeApp(
      {projectId},
      `user-directory-backfill-${process.pid}-${Date.now()}`
    );
  } catch (error) {
    if (previousAdcPath === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdcPath;
    temporaryAdc?.cleanup();
    throw error;
  }
  const db = getFirestore(app);

  return {
    close: async () => {
      try {
        await deleteApp(app);
      } finally {
        if (previousAdcPath === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdcPath;
        temporaryAdc?.cleanup();
      }
    },
    fetchUserPage: async ({afterDocumentId, limit}) => {
      let userQuery = db.collection('users')
        .orderBy(FieldPath.documentId())
        .limit(limit);
      if (afterDocumentId) userQuery = userQuery.startAfter(afterDocumentId);
      const snapshot = await userQuery.get();
      return snapshot.docs.map((documentSnapshot) => ({
        data: documentSnapshot.data() || {},
        id: documentSnapshot.id,
      }));
    },
    getDirectoryDocuments: async (documentIds) => {
      if (!documentIds.length) return new Map();
      const references = documentIds.map((id) => db.collection('user_directory').doc(id));
      const snapshots = await db.getAll(...references);
      return new Map(snapshots.map((snapshot) => [
        snapshot.id,
        snapshot.exists ? snapshot.data() : null,
      ]));
    },
    countDirectoryDocuments: async () => {
      const aggregate = await db.collection('user_directory').count().get();
      const count = Number(aggregate.data()?.count);
      if (!Number.isInteger(count) || count < 0) {
        throw new Error('Firestore returned an invalid user_directory document count.');
      }
      return count;
    },
    commitProjections: async (entries) => {
      if (entries.length > BATCH_SIZE) {
        throw new Error(`Refusing a write batch larger than ${BATCH_SIZE}.`);
      }
      const batch = db.batch();
      for (const entry of entries) {
        batch.set(db.collection('user_directory').doc(entry.id), entry.projection);
      }
      await batch.commit();
    },
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const target = assertSafeTarget(options);

  let startAfter = '';
  let initialCounts = emptyCounts();
  let approvedReport = null;
  if (options.shouldWrite) {
    approvedReport = assertCompletedDryRunReport(
      readJson(options.reportPath, 'Dry-run report'),
      options.projectId,
      options.approveFingerprint
    );
    if (options.resume) {
      const checkpoint = assertResumeCheckpoint(
        readJson(options.checkpointPath, 'Backfill checkpoint'),
        options.projectId
      );
      if (checkpoint.complete) {
        console.log('User-directory backfill checkpoint is already complete.');
        return;
      }
      startAfter = checkpoint.lastDocumentId;
      initialCounts = checkpoint.counts;
    } else if (fs.existsSync(options.checkpointPath)) {
      throw new Error(
        `Checkpoint already exists; use --resume or choose a new --checkpoint path: ${options.checkpointPath}`
      );
    }
  }

  const backend = await createAdminBackend(options.projectId, options.authMode);
  const mode = options.shouldWrite ? 'write' : options.verifyOnly ? 'verify' : 'dry-run';
  console.log(`User-directory backfill (${mode}, ${options.projectId}, batch size ${BATCH_SIZE})`);
  try {
    if (options.shouldWrite && !options.resume) {
      const currentPlan = await runBackfill({backend});
      const currentFingerprint = planFingerprintFor({
        projectId: options.projectId,
        subjects: currentPlan.subjects,
      });
      if (!currentPlan.complete || currentFingerprint !== approvedReport.planFingerprint) {
        throw new Error('Firestore state changed after the approved dry run. Re-plan before writing.');
      }
    }
    const result = await runBackfill({
      backend,
      initialCounts,
      maxBatches: options.maxBatches,
      shouldWrite: options.shouldWrite,
      startAfter,
      onCheckpoint: async (checkpoint) => {
        if (!options.shouldWrite) return;
        writeJsonAtomic(options.checkpointPath, {
          schemaVersion: REPORT_SCHEMA_VERSION,
          mode,
          projectId: options.projectId,
          ...checkpoint,
        });
      },
    });
    const directoryDocuments = options.verifyOnly
      ? await backend.countDirectoryDocuments()
      : undefined;

    const report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      mode,
      projectId: options.projectId,
      generatedAt: new Date().toISOString(),
      ...result,
      ...(options.verifyOnly ? {directoryDocuments} : {}),
      live: target.live,
      planFingerprint: options.shouldWrite
        ? approvedReport.planFingerprint
        : planFingerprintFor({projectId: options.projectId, subjects: result.subjects}),
    };
    if (options.shouldWrite) writeJsonAtomic(options.checkpointPath, report);
    else writeJsonAtomic(options.reportPath, report);

    console.log(JSON.stringify({
      complete: report.complete,
      counts: report.counts,
      ...(options.verifyOnly ? {directoryDocuments: report.directoryDocuments} : {}),
      mode: report.mode,
      planFingerprint: report.planFingerprint,
      reportPath: options.shouldWrite ? options.checkpointPath : options.reportPath,
    }, null, 2));
    if (options.verifyOnly) assertDirectoryVerification(report);
  } finally {
    await backend.close();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  BATCH_SIZE,
  DEFAULT_VERIFY_REPORT_PATH,
  REPORT_SCHEMA_VERSION,
  assertCompletedDryRunReport,
  assertDirectoryVerification,
  assertResumeCheckpoint,
  assertSafeTarget,
  buildUserDirectoryProjection,
  emptyCounts,
  normalizeDirectoryLabel,
  normalizeDirectoryRole,
  parseArguments,
  planFingerprintFor,
  projectionMatches,
  runBackfill,
};
