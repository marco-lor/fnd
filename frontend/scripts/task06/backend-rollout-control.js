#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {canonicalHash} = require('../task05/user-data-model');
const {
  createFirebaseCliAdcFile,
} = require('../firebase-cli-admin-credential');
const {PRODUCTION_PROJECT_ID} = require('../production-target');
const {resolveOperatorTarget} = require('../firebase-operator-target');

const CONFIG_PATH = 'app_config/task06_backend';
const REPORT_SCHEMA_VERSION = 1;
const CONFIG_SCHEMA_VERSION = 1;
const AUTH_MODES = new Set(['admin', 'firebase-cli']);
const DERIVED_OWNER_MODES = new Set(['legacy', 'shadow', 'authoritative']);
const OPERATION_KINDS = new Set([
  'level-up-all',
  'set-parameter-locks',
  'delete-npc',
  'delete-encounter',
  'delete-grigliata-custom-token',
  'duplicate-foe',
]);
const CONFIG_KEYS = new Set([
  'schemaVersion',
  'derivedOwnerMode',
  'enabledOperationKinds',
]);
const DEFAULT_REPORT = path.resolve(
  __dirname,
  '..',
  '..',
  'performance-results',
  'task06-backend-rollout-plan.json'
);

const printHelp = () => console.log([
  `Task 06 guarded backend-control operator for production ${PRODUCTION_PROJECT_ID}.`,
  '',
  'Usage:',
  `  node scripts/task06/backend-rollout-control.js --environment production --project ${PRODUCTION_PROJECT_ID} --site ${PRODUCTION_PROJECT_ID} --bucket ${PRODUCTION_PROJECT_ID}.firebasestorage.app`,
  '    --derived-owner legacy|shadow|authoritative',
  '    --enabled-kinds <comma-separated operation kinds>',
  '    [--auth admin|firebase-cli] [--report <path>]',
  '    [--execute --approve-fingerprint <sha256>]',
  `    --allow-live-project --confirm-project ${PRODUCTION_PROJECT_ID}`,
  '',
  'Safety:',
  '  - Dry-run is the default and writes only a local control-only report.',
  '  - Execution requires the exact dry-run fingerprint and unchanged Firestore state.',
  `  - This production operator refuses every project except ${PRODUCTION_PROJECT_ID}.`,
  '  - Unknown config fields and unknown operation kinds are refused.',
].join('\n'));

const parseArguments = (args = []) => {
  const options = {
    allowLiveProject: false,
    approveFingerprint: '',
    authMode: 'admin',
    confirmProject: '',
    derivedOwnerMode: '',
    enabledOperationKinds: [],
    execute: false,
    help: false,
    projectId: '',
    reportPath: DEFAULT_REPORT,
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
      '--derived-owner',
      '--enabled-kinds',
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
      if (argument === '--derived-owner') options.derivedOwnerMode = value;
      if (argument === '--enabled-kinds') {
        options.enabledOperationKinds = value.split(',').map((entry) => entry.trim()).filter(Boolean);
      }
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
  if (!DERIVED_OWNER_MODES.has(options.derivedOwnerMode)) {
    throw new Error('--derived-owner must be legacy, shadow, or authoritative.');
  }
  if (!options.enabledOperationKinds.length) {
    throw new Error('--enabled-kinds must contain at least one operation kind.');
  }
  const uniqueKinds = [...new Set(options.enabledOperationKinds)];
  if (uniqueKinds.some((kind) => !OPERATION_KINDS.has(kind))) {
    throw new Error('--enabled-kinds contains an unknown operation kind.');
  }
  options.enabledOperationKinds = uniqueKinds.sort();
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
      schemaVersion: CONFIG_SCHEMA_VERSION,
      derivedOwnerMode: 'legacy',
      enabledOperationKinds: [],
    };
  }
  if (!isRecord(data)) throw new Error('The Task 06 control document is malformed.');
  const unknownKeys = Object.keys(data).filter((key) => !CONFIG_KEYS.has(key));
  if (unknownKeys.length) {
    throw new Error(`The Task 06 control document has unmanaged fields: ${unknownKeys.sort().join(', ')}.`);
  }
  if (data.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error('The Task 06 control document has an unsupported schemaVersion.');
  }
  if (!DERIVED_OWNER_MODES.has(data.derivedOwnerMode)) {
    throw new Error('The Task 06 control document has an invalid derivedOwnerMode.');
  }
  if (!Array.isArray(data.enabledOperationKinds)) {
    throw new Error('The Task 06 control document has malformed enabledOperationKinds.');
  }
  const enabledOperationKinds = [...new Set(data.enabledOperationKinds)];
  if (
    enabledOperationKinds.length !== data.enabledOperationKinds.length
    || enabledOperationKinds.some((kind) => !OPERATION_KINDS.has(kind))
  ) {
    throw new Error('The Task 06 control document contains duplicate or unknown operation kinds.');
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    derivedOwnerMode: data.derivedOwnerMode,
    enabledOperationKinds: enabledOperationKinds.sort(),
  };
};

const buildPlan = ({projectId, desiredConfig, snapshot}) => {
  const beforeConfig = resolveCurrentConfig(snapshot);
  const afterConfig = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    derivedOwnerMode: desiredConfig.derivedOwnerMode,
    enabledOperationKinds: [...desiredConfig.enabledOperationKinds].sort(),
  };
  const subject = {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    projectId,
    configPath: CONFIG_PATH,
    beforeExists: snapshot.exists,
    beforeUpdateTime: snapshot.updateTime || null,
    beforeConfigHash: canonicalHash(beforeConfig),
    afterConfig,
  };
  return {
    ...subject,
    noChange: snapshot.exists && canonicalHash(beforeConfig) === canonicalHash(afterConfig),
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
    throw new Error('Approved Task 06 plan no longer matches current Firestore state. Re-plan.');
  }
};

const createBackend = async ({projectId, authMode}) => {
  const {deleteApp, initializeApp} = require('firebase-admin/app');
  const {getFirestore} = require('firebase-admin/firestore');
  const previousAdcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const temporaryAdc = authMode === 'firebase-cli'
    ? await createFirebaseCliAdcFile({projectId})
    : null;
  if (temporaryAdc) process.env.GOOGLE_APPLICATION_CREDENTIALS = temporaryAdc.filePath;
  let app;
  try {
    app = initializeApp({projectId}, `task06-backend-control-${process.pid}-${Date.now()}`);
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
    write: async ({approvedPlan, desiredConfig}) => firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const currentPlan = buildPlan({
        projectId,
        desiredConfig,
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
      if (!currentPlan.noChange) transaction.set(reference, currentPlan.afterConfig);
      return currentPlan;
    }),
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return printHelp();
  resolveOperatorTarget({options, allowPerformance: true});
  const target = assertSafeTarget(options);
  const desiredConfig = {
    derivedOwnerMode: options.derivedOwnerMode,
    enabledOperationKinds: options.enabledOperationKinds,
  };
  const backend = await createBackend(options);
  try {
    const plan = buildPlan({
      projectId: options.projectId,
      desiredConfig,
      snapshot: await backend.read(),
    });
    if (!options.execute) {
      writeJsonAtomic(options.reportPath, plan);
      console.log(JSON.stringify({
        mode: 'dry-run',
        live: target.live,
        noChange: plan.noChange,
        afterConfig: plan.afterConfig,
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
    await backend.write({approvedPlan, desiredConfig});
    const verified = resolveCurrentConfig(await backend.read());
    if (canonicalHash(verified) !== canonicalHash(plan.afterConfig)) {
      throw new Error('Task 06 control verification failed after the write.');
    }
    console.log(JSON.stringify({
      mode: 'execute',
      live: target.live,
      noChange: plan.noChange,
      verifiedConfig: verified,
      planFingerprint: plan.planFingerprint,
      verifyFingerprint: canonicalHash(verified),
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
