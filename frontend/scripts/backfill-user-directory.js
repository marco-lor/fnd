#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BATCH_SIZE = 200;
const REPORT_SCHEMA_VERSION = 1;
const USER_DIRECTORY_SCHEMA_VERSION = 1;
const UNNAMED_CHARACTER_LABEL = 'Unnamed character';
const CANONICAL_ROLES = new Set(['player', 'dm', 'webmaster']);
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

const trimString = (value) => (typeof value === 'string' ? value.trim() : '');

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
    '  node scripts/backfill-user-directory.js --project demo-fnd-perf [--write] [--resume]',
    '    [--checkpoint <path>] [--report <path>] [--max-batches <count>]',
    '',
    'Safety:',
    '  - Default mode is read-only and writes a local dry-run report.',
    '  - --write requires a completed dry-run report for the same demo project.',
    '  - Firestore writes are refused unless FIRESTORE_EMULATOR_HOST is loopback.',
    '  - Every non-demo Firebase project is refused.',
  ].join('\n'));
};

const parseArguments = (args = []) => {
  const parsed = {
    checkpointPath: DEFAULT_CHECKPOINT_PATH,
    help: false,
    maxBatches: Number.POSITIVE_INFINITY,
    projectId: '',
    reportPath: DEFAULT_REPORT_PATH,
    resume: false,
    shouldWrite: false,
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
    if (argument === '--resume') {
      parsed.resume = true;
      continue;
    }

    if (['--project', '--checkpoint', '--report', '--max-batches'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === '--project') parsed.projectId = value;
      if (argument === '--checkpoint') parsed.checkpointPath = path.resolve(value);
      if (argument === '--report') parsed.reportPath = path.resolve(value);
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
    throw new Error('Explicit --project <demo-project-id> is required.');
  }
  if (parsed.resume && !parsed.shouldWrite) {
    throw new Error('--resume is only valid with --write.');
  }
  return parsed;
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

const assertSafeTarget = (projectId, env = process.env) => {
  if (!String(projectId).startsWith('demo-')) {
    throw new Error(`User-directory backfill refuses non-demo Firebase project: ${projectId}`);
  }

  const emulator = parseEmulatorHost(env.FIRESTORE_EMULATOR_HOST);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (!emulator || !loopbackHosts.has(emulator.hostname)) {
    throw new Error(
      'User-directory backfill requires FIRESTORE_EMULATOR_HOST on a loopback host.'
    );
  }

  for (const variableName of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    const inheritedProject = env[variableName];
    if (inheritedProject && inheritedProject !== projectId) {
      throw new Error(
        `${variableName}=${inheritedProject} does not match --project ${projectId}.`
      );
    }
  }
  return {emulatorHost: env.FIRESTORE_EMULATOR_HOST, projectId};
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

const assertCompletedDryRunReport = (report, projectId) => {
  if (
    report?.schemaVersion !== REPORT_SCHEMA_VERSION
    || report?.mode !== 'dry-run'
    || report?.projectId !== projectId
    || report?.batchSize !== BATCH_SIZE
    || report?.complete !== true
  ) {
    throw new Error(
      'Write mode requires a completed, schema-compatible dry-run report for the same project.'
    );
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
      if (projectionMatches(existing, projection)) {
        counts.unchanged += 1;
        continue;
      }
      if (existing == null) counts.create += 1;
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
  };
};

const createAdminBackend = (projectId) => {
  const {deleteApp, initializeApp} = require('firebase-admin/app');
  const {FieldPath, getFirestore} = require('firebase-admin/firestore');
  const app = initializeApp(
    {projectId},
    `user-directory-backfill-${process.pid}-${Date.now()}`
  );
  const db = getFirestore(app);

  return {
    close: () => deleteApp(app),
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

  assertSafeTarget(options.projectId);

  let startAfter = '';
  let initialCounts = emptyCounts();
  if (options.shouldWrite) {
    assertCompletedDryRunReport(
      readJson(options.reportPath, 'Dry-run report'),
      options.projectId
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

  const backend = createAdminBackend(options.projectId);
  const mode = options.shouldWrite ? 'write' : 'dry-run';
  console.log(`User-directory backfill (${mode}, ${options.projectId}, batch size ${BATCH_SIZE})`);
  try {
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

    const report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      mode,
      projectId: options.projectId,
      generatedAt: new Date().toISOString(),
      ...result,
    };
    if (options.shouldWrite) writeJsonAtomic(options.checkpointPath, report);
    else writeJsonAtomic(options.reportPath, report);

    console.log(JSON.stringify({
      complete: report.complete,
      counts: report.counts,
      mode: report.mode,
      reportPath: options.shouldWrite ? options.checkpointPath : options.reportPath,
    }, null, 2));
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
  REPORT_SCHEMA_VERSION,
  assertCompletedDryRunReport,
  assertResumeCheckpoint,
  assertSafeTarget,
  buildUserDirectoryProjection,
  emptyCounts,
  normalizeDirectoryLabel,
  normalizeDirectoryRole,
  parseArguments,
  projectionMatches,
  runBackfill,
};
