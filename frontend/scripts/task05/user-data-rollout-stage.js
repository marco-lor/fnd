#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {canonicalHash} = require('./user-data-model');
const {
  createFirebaseCliAdcFile,
} = require('../firebase-cli-admin-credential');
const {PRODUCTION_PROJECT_ID} = require('../production-target');
const {resolveOperatorTarget} = require('../firebase-operator-target');

const REPORT_SCHEMA_VERSION = 1;
const CONFIG_PATH = 'app_config/user_data_v2';
const AUTH_MODES = new Set(['admin', 'firebase-cli']);
const MANAGED_STAGES = new Set([
  'legacy-read',
  'shadow-verify',
  'dual-write',
  'new-read-dual-write',
]);
const VALID_TRANSITIONS = Object.freeze({
  'legacy-read': new Set(['shadow-verify']),
  'shadow-verify': new Set(['legacy-read', 'dual-write']),
  'dual-write': new Set(['legacy-read', 'shadow-verify', 'new-read-dual-write']),
  'new-read-dual-write': new Set(['dual-write']),
});
const DEFAULT_REPORT = path.resolve(
  __dirname,
  '..',
  '..',
  'performance-results',
  'task05-rollout-stage-plan.json'
);

const printHelp = () => console.log([
  `Task 05 guarded rollout-stage operator for production ${PRODUCTION_PROJECT_ID}.`,
  '',
  'Usage:',
  `  node scripts/task05/user-data-rollout-stage.js --environment production --project ${PRODUCTION_PROJECT_ID} --site ${PRODUCTION_PROJECT_ID} --bucket ${PRODUCTION_PROJECT_ID}.firebasestorage.app --stage <stage>`,
  '    [--auth admin|firebase-cli] [--report <path>]',
  '    [--execute --approve-fingerprint <sha256>]',
  `    --allow-live-project --confirm-project ${PRODUCTION_PROJECT_ID}`,
  '',
  'Safety:',
  '  - Dry-run is the default and writes only a local hash-only report.',
  '  - Execution requires the exact dry-run fingerprint and unchanged Firestore state.',
  `  - This production operator refuses every project except ${PRODUCTION_PROJECT_ID}.`,
  '  - Active drains, completion locks, overrides, direct jumps, and new-only are refused.',
].join('\n'));

const parseArguments = (args = []) => {
  const options = {
    allowLiveProject: false,
    approveFingerprint: '',
    authMode: 'admin',
    confirmProject: '',
    execute: false,
    help: false,
    projectId: '',
    reportPath: DEFAULT_REPORT,
    stage: '',
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--execute') options.execute = true;
    else if (argument === '--allow-live-project') options.allowLiveProject = true;
    else if ([
      '--project',
      '--environment',
      '--site',
      '--bucket',
      '--stage',
      '--auth',
      '--report',
      '--approve-fingerprint',
      '--confirm-project',
    ].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === '--project') options.projectId = value;
      if (argument === '--environment') options.environmentName = value;
      if (argument === '--site') options.hostingSite = value;
      if (argument === '--bucket') options.storageBucket = value;
      if (argument === '--stage') options.stage = value;
      if (argument === '--auth') options.authMode = value;
      if (argument === '--report') options.reportPath = path.resolve(value);
      if (argument === '--approve-fingerprint') options.approveFingerprint = value;
      if (argument === '--confirm-project') options.confirmProject = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  if (options.projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(`This production operator accepts only project ${PRODUCTION_PROJECT_ID}.`);
  }
  if (!MANAGED_STAGES.has(options.stage)) {
    throw new Error('--stage must be legacy-read, shadow-verify, dual-write, or new-read-dual-write.');
  }
  if (!AUTH_MODES.has(options.authMode)) {
    throw new Error('--auth must be exactly admin or firebase-cli.');
  }
  if (options.execute && !/^[a-f0-9]{64}$/i.test(options.approveFingerprint)) {
    throw new Error('--execute requires an exact SHA-256 --approve-fingerprint.');
  }
  return options;
};

const parseEmulatorHost = (value) => {
  if (!value || typeof value !== 'string' || value.includes('://')) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (!parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname && parsed.pathname !== '/') return null;
    return parsed;
  } catch (_error) {
    return null;
  }
};

const assertSafeTarget = (options, environment = process.env) => {
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (environment[variable] && environment[variable] !== options.projectId) {
      throw new Error(`${variable} does not match the explicit --project.`);
    }
  }
  const emulator = parseEmulatorHost(environment.FIRESTORE_EMULATOR_HOST);
  const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (emulator && loopback.has(emulator.hostname)) {
    if (!options.projectId.startsWith('demo-')) {
      throw new Error('Emulator operations require a demo-* project ID.');
    }
    return {live: false};
  }
  if (environment.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Non-loopback Firestore emulator hosts are refused.');
  }
  if (!options.allowLiveProject || options.confirmProject !== options.projectId) {
    throw new Error(
      'Live Firestore access is refused without --allow-live-project and exact --confirm-project.'
    );
  }
  return {live: true};
};

const isRecord = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const resolveCurrentConfig = ({exists, data}) => {
  if (!exists) {
    return {
      config: null,
      configHash: canonicalHash(null),
      mode: 'legacy-read',
    };
  }
  if (!isRecord(data)) throw new Error('The rollout document is malformed.');
  const mode = data.mode ?? data.stage ?? 'legacy-read';
  if (data.mode !== undefined && data.stage !== undefined && data.mode !== data.stage) {
    throw new Error('The rollout document has conflicting mode and stage values.');
  }
  if (mode === 'new-only') {
    throw new Error('new-only must be managed by the dedicated drain cutover controller.');
  }
  if (!MANAGED_STAGES.has(mode)) throw new Error('The rollout document has an invalid mode.');
  if (data.userOverrides !== undefined && !isRecord(data.userOverrides)) {
    throw new Error('The rollout document has malformed user overrides.');
  }
  if (Object.keys(data.userOverrides || {}).length > 0) {
    throw new Error('Global stage changes are refused while user overrides exist.');
  }
  const legacyDrain = data.legacyDrain ?? {};
  if (!isRecord(legacyDrain) || Object.keys(legacyDrain).length > 0) {
    throw new Error('Global stage changes are refused while a legacy drain exists.');
  }
  if (data.userDataCompletionLock !== undefined) {
    throw new Error('Global stage changes are refused while the completion lock exists.');
  }
  return {
    config: data,
    configHash: canonicalHash(data),
    mode,
  };
};

const buildPlan = ({projectId, stage, snapshot}) => {
  const current = resolveCurrentConfig({
    exists: snapshot.exists,
    data: snapshot.data,
  });
  if (current.mode === stage) throw new Error(`Rollout mode is already ${stage}.`);
  if (!VALID_TRANSITIONS[current.mode]?.has(stage)) {
    throw new Error(`Direct rollout transition ${current.mode} -> ${stage} is refused.`);
  }
  const subject = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    projectId,
    configPath: CONFIG_PATH,
    beforeExists: snapshot.exists,
    beforeUpdateTime: snapshot.updateTime || null,
    beforeConfigHash: current.configHash,
    beforeMode: current.mode,
    afterMode: stage,
  };
  return {
    ...subject,
    planFingerprint: canonicalHash(subject),
  };
};

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const assertApprovedPlan = ({approved, current, fingerprint}) => {
  if (
    approved?.planFingerprint !== fingerprint
    || canonicalHash(approved) !== canonicalHash(current)
  ) {
    throw new Error('Approved rollout plan no longer matches current Firestore state. Re-plan.');
  }
};

const createBackend = async ({projectId, authMode}) => {
  const {deleteApp, initializeApp} = require('firebase-admin/app');
  const {FieldValue, getFirestore} = require('firebase-admin/firestore');
  const previousAdcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const temporaryAdc = authMode === 'firebase-cli'
    ? await createFirebaseCliAdcFile({projectId})
    : null;
  if (temporaryAdc) process.env.GOOGLE_APPLICATION_CREDENTIALS = temporaryAdc.filePath;
  let app;
  try {
    app = initializeApp({projectId}, `task05-rollout-stage-${process.pid}-${Date.now()}`);
  } catch (error) {
    if (previousAdcPath === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousAdcPath;
    temporaryAdc?.cleanup();
    throw error;
  }
  const firestore = getFirestore(app);
  const reference = firestore.doc(CONFIG_PATH);
  const read = async () => {
    const snapshot = await reference.get();
    return {
      exists: snapshot.exists,
      data: snapshot.exists ? snapshot.data() : null,
      updateTime: snapshot.updateTime?.toDate?.().toISOString() || null,
    };
  };
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
    read,
    write: async ({approvedPlan, stage}) => firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const currentPlan = buildPlan({
        projectId,
        stage,
        snapshot: {
          exists: snapshot.exists,
          data: snapshot.exists ? snapshot.data() : null,
          updateTime: snapshot.updateTime?.toDate?.().toISOString() || null,
        },
      });
      assertApprovedPlan({
        approved: approvedPlan,
        current: currentPlan,
        fingerprint: approvedPlan.planFingerprint,
      });
      const existing = snapshot.exists ? snapshot.data() : {};
      transaction.set(reference, {
        mode: stage,
        ...(!snapshot.exists ? {legacyDrain: {}, userOverrides: {}} : {}),
        ...(Object.prototype.hasOwnProperty.call(existing, 'stage')
          ? {stage: FieldValue.delete()}
          : {}),
      }, {merge: true});
      return currentPlan;
    }),
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return printHelp();
  resolveOperatorTarget({options, allowPerformance: true});
  const target = assertSafeTarget(options);
  const backend = await createBackend(options);
  try {
    const plan = buildPlan({
      projectId: options.projectId,
      stage: options.stage,
      snapshot: await backend.read(),
    });
    if (!options.execute) {
      writeJsonAtomic(options.reportPath, plan);
      console.log(JSON.stringify({
        mode: 'dry-run',
        live: target.live,
        beforeMode: plan.beforeMode,
        afterMode: plan.afterMode,
        planFingerprint: plan.planFingerprint,
        reportPath: options.reportPath,
      }, null, 2));
      return;
    }
    const approvedPlan = readJson(options.reportPath);
    assertApprovedPlan({
      approved: approvedPlan,
      current: plan,
      fingerprint: options.approveFingerprint,
    });
    await backend.write({approvedPlan, stage: options.stage});
    console.log(JSON.stringify({
      mode: 'execute',
      live: target.live,
      beforeMode: plan.beforeMode,
      afterMode: plan.afterMode,
      planFingerprint: plan.planFingerprint,
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
  assertApprovedPlan,
  assertSafeTarget,
  buildPlan,
  parseArguments,
  resolveCurrentConfig,
};
