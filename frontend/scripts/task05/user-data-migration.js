#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  MODEL_VERSION,
  PERSONAL_CONTENT_ID_PATTERN,
  buildArchiveDocuments,
  buildUserV2Plan,
  canonicalHash,
  materializeLegacyUser,
} = require('./user-data-model');

const BATCH_SIZE = 100;
const WRITE_BATCH_SIZE = 400;
const REPORT_SCHEMA_VERSION = 2;
const OPERATIONS = new Set(['stabilize', 'backfill', 'verify', 'archive', 'reverse']);
const LEGACY_DRAIN_SCOPES = new Set(['global', 'user']);
const PRE_DRAIN_SCOPES = new Set(['global', 'user']);
const LEGACY_DRAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;
const USER_DATA_ROLLOUT_STAGES = new Set([
  'legacy-read',
  'shadow-verify',
  'dual-write',
  'new-read-dual-write',
  'new-only',
]);
const LEGACY_DRAIN_STAGES = new Set([
  'shadow-verify',
  'dual-write',
  'new-read-dual-write',
  // The immutable drain remains installed through the sealed verification
  // state. The bridge is off in new-only, while rules and callables remain
  // frozen until final verification removes this exact fence.
  'new-only',
]);
const USER_DATA_ROLLOUT_CONFIG_PATH = 'app_config/user_data_v2';
const USER_DATA_COMPLETION_LOCK_FIELD = 'userDataCompletionLock';
const FROZEN_LEGACY_PROJECTION_FIELDS = Object.freeze([
  'stats',
  'Parametri',
  'AltriParametri',
  'flags',
  'inventory',
  'equipped',
  'beltCapacity',
  'slotCintura',
  'spells',
  'tecniche',
  'lingue',
  'conoscenze',
  'professioni',
  'active_turn_effect',
  'settings',
  'parameterLocks',
  'paramLocks',
  'drawColorKey',
  'shareLiveInteractions',
  'grigliataMuted',
  'hiddenGrigliataBackgrounds',
  'hiddenGrigliataTokens',
]);
const DEFAULT_RESULTS_DIRECTORY = path.resolve(__dirname, '..', '..', 'performance-results');
const USER_V2_STATE_DOCUMENT_IDS = Object.freeze([
  'progression',
  'resources',
  'settings',
  'equipment',
  'profileContent',
]);
const USER_V2_DYNAMIC_COLLECTIONS = Object.freeze([
  'inventory',
  'spells',
  'tecniche',
  'content_names',
]);
const USER_V2_ENUMERATED_COLLECTIONS = Object.freeze([
  'state',
  ...USER_V2_DYNAMIC_COLLECTIONS,
]);
// These fields are server-maintained concurrency/audit metadata. Verification
// requires their presence when the model expects them, but deliberately ignores
// their values and allows them as top-level additions. No payload field is
// ignored recursively.
const USER_V2_OPERATIONAL_METADATA_FIELDS = new Set([
  'revision',
  'currentRevision',
  'createdAt',
  'updatedAt',
  'updatedBy',
  'legacySourceHash',
  'legacySourceUpdateTime',
]);

const defaultPath = (name) => path.join(DEFAULT_RESULTS_DIRECTORY, `task05-${name}.json`);

const isValidFirestoreDocumentId = (value) => (
  typeof value === 'string'
  && value.length > 0
  && value !== '.'
  && value !== '..'
  && !value.includes('/')
  && Buffer.byteLength(value, 'utf8') <= 1500
);

const printHelp = () => console.log([
  'Task 05 user-data V2 migration, verification, archive, and reverse materialization.',
  '',
  'Usage:',
  '  node scripts/task05/user-data-migration.js --project <project> [--operation stabilize|backfill|verify|archive|reverse]',
  '    [--report <path>] [--checkpoint <path>] [--execute --approve-fingerprint <sha256>]',
  '    [--resume] [--max-users <count>] [--allow-live-project --confirm-project <project>]',
  '    [--drain-scope global|user --drain-id <id> [--drain-user <uid>]]',
  '    [--pre-drain-scope global|user [--pre-drain-user <uid>]]',
  '',
  'Safety:',
  '  - Default operation is a read-only backfill plan; no Firebase write is made.',
  '  - Every write requires a completed matching dry-run report and exact fingerprint approval.',
  '  - Demo writes require a loopback Firestore emulator.',
  '  - Any live read/write requires both --allow-live-project and exact --confirm-project.',
  '  - Legacy fields are never deleted. Reverse materialization merges legacy domains back.',
  '  - Live archive/reverse execution is blocked until it has an exact compatible pause fence.',
  '  - A drain sweep is opt-in and binds scope, drain identity, cutoff, and frozen projection hashes.',
  '  - Pre-drain stabilize/backfill is allowed only in an exact server-owned shadow-verify scope.',
  '  - Stabilize stamps deterministic personal-content IDs into the legacy root before backfill/verification.',
  '  - --drain-user is required only for user scope and is never emitted in the dry-run report.',
  '  - Reports and console summaries contain hashes/counts only, never profile documents.',
].join('\n'));

const parseArguments = (args = []) => {
  const options = {
    allowLiveProject: false,
    approveFingerprint: '',
    checkpointPath: defaultPath('checkpoint'),
    confirmProject: '',
    execute: false,
    help: false,
    maxUsers: Number.POSITIVE_INFINITY,
    operation: 'backfill',
    projectId: '',
    reportPath: '',
    resume: false,
    drainId: '',
    drainScope: '',
    drainUserId: '',
    preDrainScope: '',
    preDrainUserId: '',
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--execute') options.execute = true;
    else if (argument === '--resume') options.resume = true;
    else if (argument === '--allow-live-project') options.allowLiveProject = true;
    else if ([
      '--project',
      '--operation',
      '--report',
      '--checkpoint',
      '--approve-fingerprint',
      '--confirm-project',
      '--max-users',
      '--drain-id',
      '--drain-scope',
      '--drain-user',
      '--pre-drain-scope',
      '--pre-drain-user',
    ].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === '--project') options.projectId = value;
      if (argument === '--operation') options.operation = value;
      if (argument === '--report') options.reportPath = path.resolve(value);
      if (argument === '--checkpoint') options.checkpointPath = path.resolve(value);
      if (argument === '--approve-fingerprint') options.approveFingerprint = value;
      if (argument === '--confirm-project') options.confirmProject = value;
      if (argument === '--drain-id') options.drainId = value;
      if (argument === '--drain-scope') options.drainScope = value;
      if (argument === '--drain-user') options.drainUserId = value;
      if (argument === '--pre-drain-scope') options.preDrainScope = value;
      if (argument === '--pre-drain-user') options.preDrainUserId = value;
      if (argument === '--max-users') {
        options.maxUsers = Number(value);
        if (!Number.isInteger(options.maxUsers) || options.maxUsers < 1) {
          throw new Error('--max-users must be a positive integer.');
        }
      }
    } else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.help && !options.projectId) throw new Error('Explicit --project is required.');
  if (!OPERATIONS.has(options.operation)) throw new Error(`Unsupported operation: ${options.operation}`);
  if (options.operation === 'verify' && options.execute) throw new Error('Verification is always read-only.');
  if (options.resume && !options.execute) throw new Error('--resume is only valid with --execute.');
  const hasDrainArgument = Boolean(options.drainScope || options.drainId || options.drainUserId);
  if (hasDrainArgument) {
    if (!LEGACY_DRAIN_SCOPES.has(options.drainScope)) {
      throw new Error('--drain-scope must be exactly global or user.');
    }
    if (!LEGACY_DRAIN_ID_PATTERN.test(options.drainId)) {
      throw new Error('--drain-id must be an exact 8-100 character URL-safe drain identifier.');
    }
    if (options.drainScope === 'user') {
      if (!isValidFirestoreDocumentId(options.drainUserId)) {
        throw new Error('--drain-user must be one exact Firestore user document ID.');
      }
    } else if (options.drainUserId) {
      throw new Error('--drain-user is only valid with --drain-scope user.');
    }
    if (!['backfill', 'verify'].includes(options.operation)) {
      throw new Error('Drain scope is only valid for backfill sweeps and verification.');
    }
    options.drain = {
      scope: options.drainScope,
      drainId: options.drainId,
      ...(options.drainScope === 'user' ? {userId: options.drainUserId} : {}),
    };
  } else {
    options.drain = null;
  }
  const hasPreDrainArgument = Boolean(options.preDrainScope || options.preDrainUserId);
  if (hasDrainArgument && hasPreDrainArgument) {
    throw new Error('Drain and pre-drain scopes are mutually exclusive.');
  }
  if (hasPreDrainArgument) {
    if (!PRE_DRAIN_SCOPES.has(options.preDrainScope)) {
      throw new Error('--pre-drain-scope must be exactly global or user.');
    }
    if (options.preDrainScope === 'user') {
      if (!isValidFirestoreDocumentId(options.preDrainUserId)) {
        throw new Error('--pre-drain-user must be one exact Firestore user document ID.');
      }
    } else if (options.preDrainUserId) {
      throw new Error('--pre-drain-user is only valid with --pre-drain-scope user.');
    }
    if (!['stabilize', 'backfill'].includes(options.operation)) {
      throw new Error('Pre-drain scope is only valid for stabilization and backfill.');
    }
    options.preDrain = {
      scope: options.preDrainScope,
      ...(options.preDrainScope === 'user' ? {userId: options.preDrainUserId} : {}),
    };
  } else {
    options.preDrain = null;
  }
  options.reportPath ||= defaultPath(`${options.operation}-dry-run`);
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

const assertSafeTarget = (options, env = process.env) => {
  const {projectId} = options;
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[variable] && env[variable] !== projectId) {
      throw new Error(`${variable} does not match the explicit --project.`);
    }
  }
  const emulator = parseEmulatorHost(env.FIRESTORE_EMULATOR_HOST);
  const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const isLoopbackEmulator = emulator && loopback.has(emulator.hostname);
  if (isLoopbackEmulator) {
    if (!projectId.startsWith('demo-')) throw new Error('Emulator operations require a demo-* project ID.');
    return {live: false, emulatorHost: env.FIRESTORE_EMULATOR_HOST, projectId};
  }
  if (env.FIRESTORE_EMULATOR_HOST) throw new Error('Non-loopback Firestore emulator hosts are refused.');
  if (!options.allowLiveProject || options.confirmProject !== projectId) {
    throw new Error(
      'Live Firestore access is refused without --allow-live-project and an exact --confirm-project value.'
    );
  }
  if (options.execute && ['archive', 'reverse'].includes(options.operation)) {
    throw new Error(
      'Live archive/reverse execution is blocked until an exact compatible drain/pause protocol is implemented.'
    );
  }
  if (options.execute && options.operation === 'backfill' && !options.drain && !options.preDrain) {
    throw new Error('Live backfill execution requires an exact matching drain or pre-drain fence.');
  }
  if (options.execute && options.operation === 'stabilize' && !options.preDrain) {
    throw new Error('Live stabilization requires an exact matching shadow-verify pre-drain fence.');
  }
  return {live: true, emulatorHost: null, projectId};
};

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
};

const readJson = (filePath, label) => {
  if (!fs.existsSync(filePath)) throw new Error(`${label} not found: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, {cause: error});
  }
};

const sourceVersion = (user) => String(user.updateTime || user.readTime || 'unknown');
const subjectHash = (projectId, uid) => canonicalHash({projectId, uid});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const assertMigrationWritesUnlocked = (config) => {
  if (isRecord(config) && hasOwn(config, USER_DATA_COMPLETION_LOCK_FIELD)) {
    throw new Error(
      'Migration writes are blocked by the server-owned user-data completion lock.'
    );
  }
  return true;
};

const timestampParts = (value) => {
  if (!value || typeof value !== 'object') return null;
  const seconds = Number(value.seconds ?? value._seconds);
  const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds);
  if (
    !Number.isInteger(seconds)
    || !Number.isInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds >= 1_000_000_000
  ) return null;
  return {seconds, nanoseconds};
};

const sameTimestamp = (left, right) => (
  left?.seconds === right?.seconds && left?.nanoseconds === right?.nanoseconds
);

const frozenLegacyProjection = (data = {}) => Object.fromEntries(
  FROZEN_LEGACY_PROJECTION_FIELDS
    .filter((field) => hasOwn(data || {}, field))
    .map((field) => [field, data[field]])
);

const frozenLegacyProjectionHash = (data = {}) => canonicalHash(frozenLegacyProjection(data));

const validateDrainRecord = (value, label) => {
  if (!isRecord(value)) throw new Error(`${label} must be an immutable drain record.`);
  const unexpected = Object.keys(value).filter((key) => !['drainId', 'closedAt'].includes(key));
  const drainId = typeof value.drainId === 'string' ? value.drainId.trim() : '';
  const closedAt = timestampParts(value.closedAt);
  if (unexpected.length || !LEGACY_DRAIN_ID_PATTERN.test(drainId) || !closedAt) {
    throw new Error(`${label} must contain only a valid drainId and Firestore closedAt timestamp.`);
  }
  return {drainId, closedAt};
};

const validateRolloutConfig = (config) => {
  if (!isRecord(config)) throw new Error('The server-owned user-data rollout config is missing or malformed.');
  const configuredMode = hasOwn(config, 'mode') ? config.mode : undefined;
  const configuredStage = hasOwn(config, 'stage') ? config.stage : undefined;
  if (
    configuredMode !== undefined
    && configuredStage !== undefined
    && configuredMode !== configuredStage
  ) {
    throw new Error('The user-data rollout config has conflicting mode and stage values.');
  }
  const globalStage = configuredMode ?? configuredStage ?? 'legacy-read';
  if (!USER_DATA_ROLLOUT_STAGES.has(globalStage)) {
    throw new Error('The user-data rollout config has an invalid global stage.');
  }

  const rawOverrides = config.userOverrides ?? {};
  if (!isRecord(rawOverrides)) throw new Error('The user-data rollout overrides map is malformed.');
  const overrides = new Map();
  for (const [uid, stage] of Object.entries(rawOverrides)) {
    if (!isValidFirestoreDocumentId(uid) || !USER_DATA_ROLLOUT_STAGES.has(stage)) {
      throw new Error('The user-data rollout config contains an invalid user override.');
    }
    overrides.set(uid, stage);
  }

  const legacyDrain = config.legacyDrain ?? {};
  if (!isRecord(legacyDrain)) {
    throw new Error('The server-owned user-data rollout config has no valid legacyDrain map.');
  }
  const unexpectedDrainFields = Object.keys(legacyDrain).filter((key) => !['global', 'users'].includes(key));
  if (unexpectedDrainFields.length) throw new Error('The legacyDrain map contains unsupported fields.');
  const globalDrain = hasOwn(legacyDrain, 'global')
    ? validateDrainRecord(legacyDrain.global, 'The global drain')
    : null;
  const rawUserDrains = legacyDrain.users ?? {};
  if (!isRecord(rawUserDrains)) throw new Error('The legacyDrain users map is malformed.');
  const userDrains = new Map();
  for (const [uid, record] of Object.entries(rawUserDrains)) {
    if (!isValidFirestoreDocumentId(uid)) throw new Error('A user drain has an invalid scope key.');
    userDrains.set(uid, validateDrainRecord(record, 'A user drain'));
  }
  return {globalStage, overrides, globalDrain, userDrains};
};

const drainScopeFingerprint = ({scope, globalStage, overrides, userId = ''}) => {
  const orderedOverrides = [...overrides.entries()].sort(([left], [right]) => left.localeCompare(right));
  return scope === 'global'
    ? canonicalHash({scope, globalStage, userOverrides: orderedOverrides})
    : canonicalHash({scope, userId, overrideStage: overrides.get(userId)});
};

const publicDrainBinding = (drainFence) => drainFence ? {
  scope: drainFence.scope,
  drainId: drainFence.drainId,
  closedAt: drainFence.closedAt,
  rolloutStage: drainFence.rolloutStage,
  scopeFingerprint: drainFence.scopeFingerprint,
  ...(drainFence.scope === 'user' ? {subjectHash: drainFence.userSubjectHash} : {}),
} : null;

const publicPreDrainBinding = (preDrainFence) => preDrainFence ? {
  scope: preDrainFence.scope,
  rolloutStage: preDrainFence.rolloutStage,
  scopeFingerprint: preDrainFence.scopeFingerprint,
  ...(preDrainFence.scope === 'user' ? {subjectHash: preDrainFence.userSubjectHash} : {}),
} : null;

const resolvePreDrainFenceFromConfig = ({config, preDrain, projectId}) => {
  const validated = validateRolloutConfig(config);
  let rolloutStage;
  if (preDrain.scope === 'global') {
    rolloutStage = validated.globalStage;
  } else {
    if (!validated.overrides.has(preDrain.userId)) {
      throw new Error('A user pre-drain scope requires an explicit valid rollout override.');
    }
    rolloutStage = validated.overrides.get(preDrain.userId);
  }
  if (rolloutStage !== 'shadow-verify') {
    throw new Error('Pre-drain migration writes require the exact shadow-verify rollout stage.');
  }
  const scopeFingerprint = drainScopeFingerprint({
    scope: preDrain.scope,
    globalStage: validated.globalStage,
    overrides: validated.overrides,
    userId: preDrain.userId,
  });
  return {
    scope: preDrain.scope,
    rolloutStage,
    scopeFingerprint,
    overrideUserIds: [...validated.overrides.keys()],
    ...(preDrain.scope === 'user' ? {
      userId: preDrain.userId,
      userSubjectHash: subjectHash(projectId, preDrain.userId),
    } : {}),
  };
};

const assertPreDrainConfigMatches = (config, preDrainFence) => {
  const current = resolvePreDrainFenceFromConfig({
    config,
    preDrain: {
      scope: preDrainFence.scope,
      ...(preDrainFence.scope === 'user' ? {userId: preDrainFence.userId} : {}),
    },
    projectId: '',
  });
  if (
    current.rolloutStage !== preDrainFence.rolloutStage
    || current.scopeFingerprint !== preDrainFence.scopeFingerprint
  ) {
    throw new Error('The exact pre-drain rollout scope changed after planning.');
  }
  return true;
};

const assertPreDrainFenceMatches = (config, uid, preDrainFence) => {
  assertPreDrainConfigMatches(config, preDrainFence);
  const validated = validateRolloutConfig(config);
  if (preDrainFence.scope === 'global' && validated.overrides.has(uid)) {
    throw new Error('The subject no longer inherits the global pre-drain scope.');
  }
  if (preDrainFence.scope === 'user' && uid !== preDrainFence.userId) {
    throw new Error('The subject does not match the exact user pre-drain scope.');
  }
  return true;
};

const resolveDrainFenceFromConfig = ({config, drain, projectId}) => {
  const validated = validateRolloutConfig(config);
  let record;
  let rolloutStage;
  if (drain.scope === 'global') {
    record = validated.globalDrain;
    rolloutStage = validated.globalStage;
  } else {
    if (!validated.overrides.has(drain.userId)) {
      throw new Error('A user drain requires an explicit valid rollout override for that exact scope.');
    }
    record = validated.userDrains.get(drain.userId);
    rolloutStage = validated.overrides.get(drain.userId);
  }
  if (!record || record.drainId !== drain.drainId) {
    throw new Error('The requested drainId does not match the exact server-owned drain record.');
  }
  if (!LEGACY_DRAIN_STAGES.has(rolloutStage)) {
    throw new Error('A drain sweep requires a bridge-active stage or the sealed new-only verification stage.');
  }
  const scopeFingerprint = drainScopeFingerprint({
    scope: drain.scope,
    globalStage: validated.globalStage,
    overrides: validated.overrides,
    userId: drain.userId,
  });
  return {
    scope: drain.scope,
    drainId: record.drainId,
    closedAt: record.closedAt,
    rolloutStage,
    scopeFingerprint,
    overrideUserIds: [...validated.overrides.keys()],
    ...(drain.scope === 'user' ? {
      userId: drain.userId,
      userSubjectHash: subjectHash(projectId, drain.userId),
    } : {}),
  };
};

const assertDrainConfigMatches = (config, drainFence) => {
  const request = {
    scope: drainFence.scope,
    drainId: drainFence.drainId,
    ...(drainFence.scope === 'user' ? {userId: drainFence.userId} : {}),
  };
  const current = resolveDrainFenceFromConfig({
    config,
    drain: request,
    projectId: '',
  });
  if (
    current.rolloutStage !== drainFence.rolloutStage
    || current.scopeFingerprint !== drainFence.scopeFingerprint
    || !sameTimestamp(current.closedAt, drainFence.closedAt)
  ) {
    throw new Error('The exact drain fence or rollout scope changed after planning.');
  }
  return true;
};

const assertDrainFenceMatches = (config, uid, drainFence) => {
  assertDrainConfigMatches(config, drainFence);
  const validated = validateRolloutConfig(config);
  if (drainFence.scope === 'global' && validated.overrides.has(uid)) {
    throw new Error('The subject no longer inherits the global drain scope.');
  }
  if (drainFence.scope === 'user' && uid !== drainFence.userId) {
    throw new Error('The subject does not match the exact user drain scope.');
  }
  return true;
};

const projectObject = (actual, expected) => {
  if (Array.isArray(expected)) return actual;
  if (!expected || typeof expected !== 'object') return actual;
  return Object.fromEntries(Object.keys(expected).map((key) => [
    key,
    projectObject(actual?.[key], expected[key]),
  ]));
};

const hashActualAgainstExpected = (actualDocuments, expectedDocuments) => {
  const actualByPath = actualDocuments instanceof Map
    ? actualDocuments
    : new Map((actualDocuments || []).map(({path: documentPath, data}) => [documentPath, data]));
  const projected = expectedDocuments.map((expected) => ({
    path: expected.path,
    data: projectObject(actualByPath.get(expected.path), expected.data),
  }));
  return canonicalHash(projected);
};

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const hashDocumentSet = (documents = []) => canonicalHash(
  [...documents]
    .map(({path: documentPath, data}) => ({path: documentPath, data}))
    .sort((left, right) => left.path.localeCompare(right.path))
);

const userV2PathDescriptor = (uid, documentPath) => {
  if (documentPath === `users/${uid}`) return {kind: 'root'};
  const prefix = `users/${uid}/`;
  if (!documentPath.startsWith(prefix)) return null;
  const parts = documentPath.slice(prefix.length).split('/');
  if (parts.length !== 2) return null;
  if (parts[0] === 'state') {
    return {
      kind: USER_V2_STATE_DOCUMENT_IDS.includes(parts[1]) ? 'state' : 'state-extra',
      collection: parts[0],
      id: parts[1],
    };
  }
  if (USER_V2_DYNAMIC_COLLECTIONS.includes(parts[0])) {
    return {kind: 'dynamic', collection: parts[0], id: parts[1]};
  }
  return null;
};

const normalizeActualAgainstExpected = (
  actual,
  expected,
  {allowedTopLevelFields = new Set(), topLevel = true} = {}
) => {
  if (Array.isArray(actual)) {
    if (!Array.isArray(expected)) return actual;
    return actual.map((entry, index) => normalizeActualAgainstExpected(
      entry,
      expected[index],
      {allowedTopLevelFields, topLevel: false}
    ));
  }
  if (!isPlainObject(actual) || !isPlainObject(expected)) return actual;
  const result = {};
  for (const [key, value] of Object.entries(actual)) {
    const expectedHasKey = Object.prototype.hasOwnProperty.call(expected, key);
    if (topLevel && USER_V2_OPERATIONAL_METADATA_FIELDS.has(key)) {
      if (expectedHasKey) result[key] = expected[key];
      continue;
    }
    if (topLevel && !expectedHasKey && allowedTopLevelFields.has(key)) continue;
    result[key] = normalizeActualAgainstExpected(
      value,
      expectedHasKey ? expected[key] : undefined,
      {allowedTopLevelFields, topLevel: false}
    );
  }
  return result;
};

const unexpectedFieldPaths = (
  actual,
  expected,
  {allowedTopLevelFields = new Set(), topLevel = true, prefix = ''} = {}
) => {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.flatMap((entry, index) => unexpectedFieldPaths(
      entry,
      expected[index],
      {allowedTopLevelFields, topLevel: false, prefix: `${prefix}[${index}]`}
    ));
  }
  if (!isPlainObject(actual) || !isPlainObject(expected)) return [];
  const result = [];
  for (const [key, value] of Object.entries(actual)) {
    const expectedHasKey = Object.prototype.hasOwnProperty.call(expected, key);
    if (topLevel && USER_V2_OPERATIONAL_METADATA_FIELDS.has(key)) continue;
    if (topLevel && !expectedHasKey && allowedTopLevelFields.has(key)) continue;
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (!expectedHasKey) result.push(fieldPath);
    else result.push(...unexpectedFieldPaths(value, expected[key], {
      allowedTopLevelFields,
      topLevel: false,
      prefix: fieldPath,
    }));
  }
  return result;
};

const inspectOwnedV2Projection = ({uid, actualDocuments, expectedDocuments, legacyRootData = {}}) => {
  const issues = [];
  const cleanupPaths = [];
  const actualByPath = new Map();
  for (const document of actualDocuments || []) {
    if (actualByPath.has(document.path)) {
      issues.push({severity: 'error', code: 'v2-duplicate-document-path'});
    }
    actualByPath.set(document.path, document.data);
  }
  const expectedByPath = new Map(expectedDocuments.map(({path: documentPath, data}) => [documentPath, data]));
  const comparisonDocuments = [];

  for (const expected of expectedDocuments) {
    const actual = actualByPath.get(expected.path);
    const descriptor = userV2PathDescriptor(uid, expected.path);
    if (actual === undefined) {
      issues.push({severity: 'error', code: 'v2-document-missing'});
      comparisonDocuments.push({path: expected.path, data: undefined});
      continue;
    }
    if (
      descriptor?.kind === 'dynamic'
      && expected.data?.legacyManaged === true
      && actual?.legacyManaged !== true
    ) {
      issues.push({severity: 'error', code: 'v2-unowned-path-conflict'});
    }
    const allowedTopLevelFields = descriptor?.kind === 'root'
      ? new Set(Object.keys(legacyRootData || {}))
      : new Set();
    const normalized = normalizeActualAgainstExpected(actual, expected.data, {allowedTopLevelFields});
    const unexpected = unexpectedFieldPaths(actual, expected.data, {allowedTopLevelFields});
    if (unexpected.length) {
      issues.push({
        severity: 'error',
        code: 'v2-unexpected-field',
        count: unexpected.length,
      });
    }
    if (canonicalHash(normalized) !== canonicalHash(expected.data)) {
      issues.push({severity: 'error', code: 'v2-data-mismatch'});
    }
    comparisonDocuments.push({path: expected.path, data: normalized});
  }

  const extraOwned = [];
  for (const [documentPath, data] of actualByPath) {
    if (expectedByPath.has(documentPath)) continue;
    const descriptor = userV2PathDescriptor(uid, documentPath);
    if (['dynamic', 'state-extra'].includes(descriptor?.kind) && data?.legacyManaged === true) {
      cleanupPaths.push(documentPath);
      extraOwned.push({pathHash: canonicalHash(documentPath), dataHash: canonicalHash(data)});
      issues.push({severity: 'error', code: 'v2-stale-owned-document'});
    }
  }

  const projectionHash = hashDocumentSet(comparisonDocuments);
  return {
    cleanupPaths: cleanupPaths.sort(),
    currentHash: extraOwned.length || issues.some(({code}) => code === 'v2-duplicate-document-path')
      ? canonicalHash({projectionHash, extraOwned: extraOwned.sort((left, right) => (
        left.pathHash.localeCompare(right.pathHash)
      ))})
      : projectionHash,
    issues,
    verified: issues.length === 0,
  };
};

const exactNameReservationId = (kind, exactName) => crypto.createHash('sha256')
  .update(`${kind}\0${exactName}`)
  .digest('hex');

const validateReversePersonalContent = (uid, documents = []) => {
  const issues = [];
  const byPath = new Map(documents.map(({path: documentPath, data}) => [documentPath, data]));
  const expectedReservations = new Set();
  for (const descriptor of [
    {collection: 'spells', kind: 'spell'},
    {collection: 'tecniche', kind: 'tecnica'},
  ]) {
    const exactNames = new Set();
    const prefix = `users/${uid}/${descriptor.collection}/`;
    for (const [documentPath, data] of byPath) {
      if (!documentPath.startsWith(prefix) || documentPath.slice(prefix.length).includes('/')) continue;
      const contentId = documentPath.slice(prefix.length);
      if (!PERSONAL_CONTENT_ID_PATTERN.test(contentId)) {
        issues.push({severity: 'error', code: 'reverse-content-id-invalid'});
      }
      const exactName = String(data?.displayName || data?.nome || data?.name || '').trim();
      if (!exactName) {
        issues.push({severity: 'error', code: 'reverse-content-name-missing'});
        continue;
      }
      if (exactNames.has(exactName)) {
        issues.push({severity: 'error', code: 'reverse-content-exact-name-duplicate'});
        continue;
      }
      exactNames.add(exactName);
      const reservationId = exactNameReservationId(descriptor.kind, exactName);
      const reservationPath = `users/${uid}/content_names/${reservationId}`;
      expectedReservations.add(reservationPath);
      const reservation = byPath.get(reservationPath);
      if (
        !reservation
        || reservation.kind !== descriptor.kind
        || reservation.contentId !== contentId
        || String(reservation.exactName || '').trim() !== exactName
      ) {
        issues.push({severity: 'error', code: 'reverse-content-reservation-missing'});
      }
    }
  }
  const reservationPrefix = `users/${uid}/content_names/`;
  for (const [documentPath, data] of byPath) {
    if (
      documentPath.startsWith(reservationPrefix)
      && !documentPath.slice(reservationPrefix.length).includes('/')
      && ['spell', 'tecnica'].includes(data?.kind)
      && !expectedReservations.has(documentPath)
    ) {
      issues.push({severity: 'error', code: 'reverse-content-reservation-stale'});
    }
  }
  return issues;
};

const summarizeIssues = (issues) => ({
  errors: issues.filter(({severity}) => severity === 'error').length,
  warnings: issues.filter(({severity}) => severity === 'warning').length,
  codes: [...new Set(issues.map(({code}) => code))].sort(),
});

const activeDeletionJobsInScope = (jobs, drainFence) => {
  const excluded = new Set(drainFence.overrideUserIds);
  return (Array.isArray(jobs) ? jobs : []).filter((job) => {
    const targetUid = typeof job?.targetUid === 'string' ? job.targetUid : '';
    if (!targetUid) return true;
    return drainFence.scope === 'user'
      ? targetUid === drainFence.userId
      : !excluded.has(targetUid);
  });
};

const activeDeletionJobFingerprint = (jobs) => canonicalHash((jobs || [])
  .map(({targetUid, stage}) => ({targetUid, stage}))
  .sort((left, right) => String(left.targetUid).localeCompare(String(right.targetUid))));

const buildMigrationPlan = async ({
  backend,
  operation,
  projectId,
  maxUsers = Number.POSITIVE_INFINITY,
  drain = null,
  preDrain = null,
}) => {
  if (drain && preDrain) throw new Error('Drain and pre-drain scopes are mutually exclusive.');
  if (drain && !['backfill', 'verify'].includes(operation)) {
    throw new Error('Drain scope is only valid for backfill sweeps and verification.');
  }
  if (preDrain && !['stabilize', 'backfill'].includes(operation)) {
    throw new Error('Pre-drain scope is only valid for stabilization and backfill.');
  }
  if ((drain || preDrain) && (
    typeof backend.readUserDataRolloutConfig !== 'function'
    || typeof backend.readActiveUserDeletionJobs !== 'function'
  )) {
    throw new Error('The migration adapter does not support rollout-fenced planning.');
  }
  if (drain && typeof backend.assertDrainFence !== 'function') {
    throw new Error('The migration adapter does not support drain-fenced planning.');
  }
  if (preDrain && typeof backend.assertPreDrainFence !== 'function') {
    throw new Error('The migration adapter does not support pre-drain-fenced planning.');
  }
  const initialConfig = (drain || preDrain) ? await backend.readUserDataRolloutConfig() : null;
  const drainFence = drain
    ? resolveDrainFenceFromConfig({config: initialConfig, drain, projectId})
    : null;
  const preDrainFence = preDrain
    ? resolvePreDrainFenceFromConfig({config: initialConfig, preDrain, projectId})
    : null;
  const scopeFence = drainFence || preDrainFence;
  const scopedDeletionJobs = [];
  if (scopeFence) {
    scopedDeletionJobs.push(...activeDeletionJobsInScope(
      await backend.readActiveUserDeletionJobs(),
      scopeFence
    ));
  }
  const scopedDeletionJobIds = new Set(scopedDeletionJobs.map((job) => job?.targetUid).filter(Boolean));
  const entries = [];
  let complete = false;

  const appendUser = async (user) => {
    const transformation = buildUserV2Plan(user.id, user.data || {});
    const legacyProjectionHash = frozenLegacyProjectionHash(user.data || {});
    const expectedSourceVersion = sourceVersion(user);
    const issues = [...transformation.issues];
    const deletionIssueCodes = new Set();
    const recordDeletionStatus = (status = {}) => {
      if (status.deletionStatePending) deletionIssueCodes.add('drain-deletion-state-pending');
      if (status.activeDeletionJob) deletionIssueCodes.add('drain-deletion-job-active');
    };
    if (scopedDeletionJobIds.has(user.id)) {
      deletionIssueCodes.add('drain-deletion-job-active');
    }
    if (user.data?.deletionState === 'pending') {
      deletionIssueCodes.add('drain-deletion-state-pending');
    }
    if (
      scopeFence
      && ['backfill', 'verify'].includes(operation)
      && !transformation.legacyContentIdentitiesStable
    ) {
      issues.push({severity: 'error', code: 'personal-content-identity-not-stabilized'});
    }
    const assertCurrentFence = async () => {
      if (!scopeFence) return;
      const assertFence = drainFence ? backend.assertDrainFence : backend.assertPreDrainFence;
      recordDeletionStatus(await assertFence({
        uid: user.id,
        ...(drainFence ? {drainFence} : {preDrainFence}),
        expectedSourceVersion,
        expectedLegacyProjectionHash: legacyProjectionHash,
        expectedSourceHash: transformation.sourceHash,
        allowDeletionConflict: true,
        allowCompletionLock: true,
      }));
    };
    await assertCurrentFence();

    let expectedDocuments = transformation.documents;
    let expectedLegacy = null;
    let currentHash = null;
    let v2PreconditionHash = null;
    let cleanupPaths = [];

    if (operation === 'stabilize') {
      expectedDocuments = [];
      currentHash = canonicalHash({
        spells: user.data?.spells,
        tecniche: user.data?.tecniche,
      });
    } else if (operation === 'reverse') {
      const currentV2 = await backend.readUserV2Documents(user.id);
      v2PreconditionHash = hashDocumentSet(currentV2);
      const reverseIssues = validateReversePersonalContent(user.id, currentV2);
      issues.push(...reverseIssues);
      expectedLegacy = reverseIssues.length
        ? null
        : materializeLegacyUser(user.id, currentV2);
      expectedDocuments = [];
      currentHash = expectedLegacy === null
        ? null
        : canonicalHash(projectObject(user.data || {}, expectedLegacy));
    } else {
      const currentV2 = await backend.readUserV2Documents(user.id);
      const inspection = inspectOwnedV2Projection({
        uid: user.id,
        actualDocuments: currentV2,
        expectedDocuments: transformation.documents,
        legacyRootData: user.data || {},
      });
      currentHash = inspection.currentHash;
      cleanupPaths = inspection.cleanupPaths;
      if (operation === 'backfill') {
        for (const issue of inspection.issues) {
          if (issue.code === 'v2-unowned-path-conflict') issues.push(issue);
          else if (['v2-stale-owned-document', 'v2-unexpected-field'].includes(issue.code)) {
            issues.push({
              severity: 'warning',
              code: `${issue.code}-repair-planned`,
            });
          }
        }
      } else {
        issues.push(...inspection.issues);
      }

      if (operation === 'archive') {
        if (!inspection.verified) issues.push({severity: 'error', code: 'v2-not-verified'});
        expectedDocuments = buildArchiveDocuments(user.id, user.data || {});
      }
    }

    if (operation === 'archive') {
      const currentArchive = await backend.readDocuments(expectedDocuments.map(({path: documentPath}) => documentPath));
      currentHash = hashDocumentSet(currentArchive);
    }
    await assertCurrentFence();
    deletionIssueCodes.forEach((code) => issues.push({severity: 'error', code}));

    const targetHash = operation === 'reverse'
      ? canonicalHash(expectedLegacy)
      : (operation === 'stabilize'
        ? canonicalHash(transformation.legacyContentIdentities)
        : canonicalHash(expectedDocuments));
    const stabilizedSourceData = operation === 'stabilize'
      ? {
        ...(user.data || {}),
        spells: transformation.legacyContentIdentities.spells,
        tecniche: transformation.legacyContentIdentities.tecniche,
      }
      : null;
    const cleanupFingerprint = canonicalHash(cleanupPaths.map((documentPath) => canonicalHash(documentPath)));
    entries.push({
      id: user.id,
      sourceData: user.data || {},
      sourceHash: transformation.sourceHash,
      sourceVersion: expectedSourceVersion,
      legacyProjectionHash,
      expectedDocuments,
      expectedLegacy,
      targetHash,
      currentHash,
      v2PreconditionHash,
      cleanupPaths,
      cleanupFingerprint,
      deletionConflict: deletionIssueCodes.size > 0,
      legacyContentIdentities: transformation.legacyContentIdentities,
      stabilizedLegacyProjectionHash: stabilizedSourceData
        ? frozenLegacyProjectionHash(stabilizedSourceData)
        : null,
      counts: {...transformation.counts, cleanupDocuments: cleanupPaths.length},
      issues,
    });
  };

  const validatePage = (page, cursor) => {
    if (!Array.isArray(page) || page.length > BATCH_SIZE) {
      throw new Error('Migration adapter returned an invalid page.');
    }
    let previousId = cursor;
    for (const user of page) {
      if (!user?.id || (previousId && user.id <= previousId)) {
        throw new Error('User pages must be strictly ordered by document ID.');
      }
      previousId = user.id;
    }
  };

  if (scopeFence?.scope === 'user') {
    if (typeof backend.fetchUserById !== 'function') {
      throw new Error('The migration adapter cannot fetch an exact user rollout scope.');
    }
    const user = await backend.fetchUserById(scopeFence.userId);
    if ((!user?.id || user.id !== scopeFence.userId) && !scopedDeletionJobIds.has(scopeFence.userId)) {
      throw new Error('The exact user rollout scope does not exist.');
    }
    if (user?.id === scopeFence.userId) await appendUser(user);
    complete = true;
  } else if (scopeFence?.scope === 'global') {
    const excluded = new Set(scopeFence.overrideUserIds);
    let cursor = '';
    let truncated = false;
    let scannedAll = false;
    while (!scannedAll) {
      const page = await backend.fetchUserPage({afterDocumentId: cursor, limit: BATCH_SIZE});
      validatePage(page, cursor);
      if (!page.length) {
        scannedAll = true;
        break;
      }
      for (const user of page) {
        if (excluded.has(user.id)) continue;
        if (entries.length < maxUsers) await appendUser(user);
        else truncated = true;
      }
      cursor = page[page.length - 1].id;
      scannedAll = page.length < BATCH_SIZE;
    }
    complete = scannedAll && !truncated;
  } else {
    let cursor = '';
    while (!complete && entries.length < maxUsers) {
      const page = await backend.fetchUserPage({afterDocumentId: cursor, limit: BATCH_SIZE});
      validatePage(page, cursor);
      if (!page.length) {
        complete = true;
        break;
      }
      for (const user of page) {
        if (entries.length >= maxUsers) break;
        await appendUser(user);
      }
      cursor = page[page.length - 1].id;
      complete = page.length < BATCH_SIZE;
    }
  }

  if (scopeFence) {
    const finalConfig = await backend.readUserDataRolloutConfig();
    if (drainFence) assertDrainConfigMatches(finalConfig, drainFence);
    else assertPreDrainConfigMatches(finalConfig, preDrainFence);
    const finalPlanningDeletionJobs = activeDeletionJobsInScope(
      await backend.readActiveUserDeletionJobs(),
      scopeFence
    );
    if (
      activeDeletionJobFingerprint(finalPlanningDeletionJobs)
      !== activeDeletionJobFingerprint(scopedDeletionJobs)
    ) {
      throw new Error('The active user deletion-job set changed during drain planning.');
    }
  }

  const entryIds = new Set(entries.map(({id}) => id));
  const unboundDeletionJobs = scopedDeletionJobs.filter(({targetUid}) => !entryIds.has(targetUid));
  const drainEvidence = scopeFence ? {
    deletionConflicts: entries.filter((entry) => entry.deletionConflict).length
      + unboundDeletionJobs.length,
    deletionJobFingerprint: activeDeletionJobFingerprint(scopedDeletionJobs),
    codes: [...new Set([
      ...entries.flatMap((entry) => entry.issues
        .filter(({code}) => code.startsWith('drain-deletion-'))
        .map(({code}) => code)),
      ...(unboundDeletionJobs.length ? ['drain-deletion-job-active'] : []),
    ])].sort(),
  } : null;

  const planFingerprint = canonicalHash({
    schemaVersion: REPORT_SCHEMA_VERSION,
    modelVersion: MODEL_VERSION,
    operation,
    projectId,
    ...(drainFence ? {drain: publicDrainBinding(drainFence)} : {}),
    ...(preDrainFence ? {preDrain: publicPreDrainBinding(preDrainFence)} : {}),
    ...(drainEvidence ? {drainEvidence} : {}),
    entries: entries.map((entry) => ({
      id: entry.id,
      sourceHash: entry.sourceHash,
      sourceVersion: entry.sourceVersion,
      ...(scopeFence ? {legacyProjectionHash: entry.legacyProjectionHash} : {}),
      targetHash: entry.targetHash,
      currentHash: entry.currentHash,
      v2PreconditionHash: entry.v2PreconditionHash,
      cleanupFingerprint: entry.cleanupFingerprint,
      issues: entry.issues.map(({severity, code}) => ({severity, code})),
    })),
  });
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    modelVersion: MODEL_VERSION,
    mode: 'dry-run',
    operation,
    projectId,
    ...(drainFence ? {drain: publicDrainBinding(drainFence)} : {}),
    ...(preDrainFence ? {preDrain: publicPreDrainBinding(preDrainFence)} : {}),
    ...(drainEvidence ? {drainEvidence} : {}),
    complete,
    generatedAt: new Date().toISOString(),
    planFingerprint,
    counts: {
      users: entries.length,
      writesRequired: entries.filter((entry) => entry.currentHash !== entry.targetHash).length,
      unchanged: entries.filter((entry) => entry.currentHash === entry.targetHash).length,
      errors: entries.reduce((total, entry) => total + summarizeIssues(entry.issues).errors, 0)
        + unboundDeletionJobs.length,
      warnings: entries.reduce((total, entry) => total + summarizeIssues(entry.issues).warnings, 0),
      cleanupDocuments: entries.reduce((total, entry) => total + entry.cleanupPaths.length, 0),
      ...(scopeFence ? {
        deletionConflicts: drainEvidence.deletionConflicts,
      } : {}),
    },
    subjects: entries.map((entry) => ({
      subjectHash: subjectHash(projectId, entry.id),
      sourceHash: entry.sourceHash,
      sourceVersionHash: canonicalHash(entry.sourceVersion),
      ...(scopeFence ? {legacyProjectionHash: entry.legacyProjectionHash} : {}),
      targetHash: entry.targetHash,
      currentHash: entry.currentHash,
      cleanupFingerprint: entry.cleanupFingerprint,
      counts: entry.counts,
      issues: summarizeIssues(entry.issues),
    })),
  };
  return {entries, report, drainFence, preDrainFence};
};

const assertApprovedReport = (report, plan, options) => {
  const resumed = Boolean(options.resumeCheckpoint?.lastDocumentId);
  const approvedDrainHash = canonicalHash(report?.drain ?? null);
  const currentDrainHash = canonicalHash(plan?.report?.drain ?? null);
  const approvedPreDrainHash = canonicalHash(report?.preDrain ?? null);
  const currentPreDrainHash = canonicalHash(plan?.report?.preDrain ?? null);
  const approvedDrainEvidenceHash = canonicalHash(report?.drainEvidence ?? null);
  const currentDrainEvidenceHash = canonicalHash(plan?.report?.drainEvidence ?? null);
  if (
    report?.schemaVersion !== REPORT_SCHEMA_VERSION
    || report?.modelVersion !== MODEL_VERSION
    || report?.mode !== 'dry-run'
    || report?.complete !== true
    || report?.operation !== options.operation
    || report?.projectId !== options.projectId
    || report?.counts?.errors !== 0
    || !Array.isArray(report?.subjects)
    || plan?.report?.schemaVersion !== REPORT_SCHEMA_VERSION
    || plan?.report?.modelVersion !== MODEL_VERSION
    || plan?.report?.complete !== true
    || plan?.report?.operation !== options.operation
    || plan?.report?.projectId !== options.projectId
    || approvedDrainHash !== currentDrainHash
    || approvedPreDrainHash !== currentPreDrainHash
    || approvedDrainEvidenceHash !== currentDrainEvidenceHash
    || Boolean(report?.drain || report?.preDrain) !== Boolean(report?.drainEvidence)
    || Boolean(plan?.report?.drain || plan?.report?.preDrain) !== Boolean(plan?.report?.drainEvidence)
    || Boolean(report?.drain && report?.preDrain)
    || Boolean(plan?.report?.drain && plan?.report?.preDrain)
    || !Array.isArray(plan?.report?.subjects)
  ) {
    throw new Error('Execution requires the exact completed, error-free dry-run report for this plan.');
  }
  if (!/^[a-f0-9]{64}$/.test(options.approveFingerprint)
      || options.approveFingerprint !== report.planFingerprint) {
    throw new Error('--approve-fingerprint must exactly match the approved dry-run plan fingerprint.');
  }
  if (!resumed && report.planFingerprint !== plan.report.planFingerprint) {
    throw new Error('Execution requires the exact completed, error-free dry-run report for this plan.');
  }
  if (resumed) {
    const checkpointIndex = plan.entries.findIndex(({id}) => id === options.resumeCheckpoint.lastDocumentId);
    if (
      checkpointIndex < 0
      || report.subjects.length !== plan.report.subjects.length
      || report.counts.users !== plan.report.counts.users
    ) {
      throw new Error('Resume requires the same ordered subject set as the approved dry run.');
    }
    for (let index = 0; index < plan.report.subjects.length; index += 1) {
      const approvedSubject = report.subjects[index];
      const currentSubject = plan.report.subjects[index];
      if (approvedSubject.subjectHash !== currentSubject.subjectHash) {
        throw new Error('Resume requires the same ordered subject set as the approved dry run.');
      }
      if (index > checkpointIndex && canonicalHash(approvedSubject) !== canonicalHash(currentSubject)) {
        throw new Error('An unprocessed subject changed after the approved dry run. Re-plan before resuming.');
      }
    }
  }
  return report;
};

const assertCheckpoint = (checkpoint, planOrReport, options) => {
  const report = planOrReport?.report || planOrReport;
  if (
    checkpoint?.schemaVersion !== REPORT_SCHEMA_VERSION
    || checkpoint?.modelVersion !== MODEL_VERSION
    || checkpoint?.mode !== 'execute'
    || checkpoint?.operation !== options.operation
    || checkpoint?.projectId !== options.projectId
    || checkpoint?.planFingerprint !== report?.planFingerprint
    || canonicalHash(checkpoint?.drain ?? null) !== canonicalHash(report?.drain ?? null)
    || canonicalHash(checkpoint?.preDrain ?? null) !== canonicalHash(report?.preDrain ?? null)
    || typeof checkpoint?.lastDocumentId !== 'string'
  ) throw new Error('Checkpoint does not match the exact approved migration plan.');
  return checkpoint;
};

const executeMigrationPlan = async ({backend, options, plan, onCheckpoint = async () => {}}) => {
  const blocking = plan.entries.flatMap((entry) => entry.issues).filter(({severity}) => severity === 'error');
  if (blocking.length || Number(plan.report?.counts?.errors) > 0) {
    throw new Error('Migration execution is blocked by unresolved plan errors.');
  }
  const scopeFence = plan.drainFence || plan.preDrainFence;
  if (scopeFence) {
    const currentDeletionJobs = activeDeletionJobsInScope(
      await backend.readActiveUserDeletionJobs(),
      scopeFence
    );
    if (
      currentDeletionJobs.length
      || activeDeletionJobFingerprint(currentDeletionJobs)
        !== plan.report.drainEvidence?.deletionJobFingerprint
    ) {
      throw new Error('The rollout scope has an active or changed user deletion job.');
    }
  }

  let startIndex = 0;
  let processed = 0;
  if (options.resumeCheckpoint?.lastDocumentId) {
    const checkpointIndex = plan.entries.findIndex(({id}) => id === options.resumeCheckpoint.lastDocumentId);
    if (checkpointIndex < 0) throw new Error('Checkpoint cursor is absent from the approved plan.');
    startIndex = checkpointIndex + 1;
    processed = Number(options.resumeCheckpoint.processed) || startIndex;
  }

  for (let index = startIndex; index < plan.entries.length; index += 1) {
    const entry = plan.entries[index];
    if (options.operation === 'stabilize') {
      await backend.writeLegacyContentIdentities({
        uid: entry.id,
        identities: entry.legacyContentIdentities,
        expectedSourceVersion: entry.sourceVersion,
        expectedSourceHash: entry.sourceHash,
        expectedLegacyProjectionHash: entry.legacyProjectionHash,
        preDrainFence: plan.preDrainFence,
      });
    } else if (options.operation === 'backfill') {
      await backend.writeUserV2Documents({
        uid: entry.id,
        documents: entry.expectedDocuments,
        cleanupPaths: entry.cleanupPaths,
        expectedSourceVersion: entry.sourceVersion,
        expectedLegacyProjectionHash: entry.legacyProjectionHash,
        drainFence: plan.drainFence,
        preDrainFence: plan.preDrainFence,
      });
    } else if (options.operation === 'archive') {
      await backend.writeArchiveDocuments({
        uid: entry.id,
        documents: entry.expectedDocuments,
        expectedSourceHash: entry.sourceHash,
      });
    } else if (options.operation === 'reverse') {
      await backend.mergeLegacyUser({
        uid: entry.id,
        legacyData: entry.expectedLegacy,
        expectedV2Hash: entry.v2PreconditionHash,
      });
    }

    const actual = options.operation === 'reverse' || options.operation === 'stabilize'
      ? await backend.readLegacyUser(entry.id)
      : (options.operation === 'backfill'
        ? await backend.readUserV2Documents(entry.id)
        : await backend.readDocuments(entry.expectedDocuments.map(({path: documentPath}) => documentPath)));
    if (scopeFence) {
      const assertFence = plan.drainFence
        ? backend.assertDrainFence
        : backend.assertPreDrainFence;
      await assertFence({
        uid: entry.id,
        ...(plan.drainFence
          ? {drainFence: plan.drainFence}
          : {preDrainFence: plan.preDrainFence}),
        expectedLegacyProjectionHash: options.operation === 'stabilize'
          ? entry.stabilizedLegacyProjectionHash
          : entry.legacyProjectionHash,
      });
    }
    let actualHash;
    if (options.operation === 'stabilize') {
      actualHash = canonicalHash({
        spells: actual?.spells,
        tecniche: actual?.tecniche,
      });
    } else if (options.operation === 'reverse') {
      actualHash = canonicalHash(projectObject(actual, entry.expectedLegacy));
    } else if (options.operation === 'backfill') {
      const inspection = inspectOwnedV2Projection({
        uid: entry.id,
        actualDocuments: actual,
        expectedDocuments: entry.expectedDocuments,
        legacyRootData: entry.sourceData,
      });
      if (!inspection.verified) throw new Error('Post-write V2 ownership verification failed.');
      actualHash = inspection.currentHash;
    } else {
      actualHash = hashDocumentSet(actual);
    }
    if (actualHash !== entry.targetHash) throw new Error('Post-write verification hash mismatch.');

    processed += 1;
    await onCheckpoint({
      schemaVersion: REPORT_SCHEMA_VERSION,
      modelVersion: MODEL_VERSION,
      mode: 'execute',
      operation: options.operation,
      projectId: options.projectId,
      planFingerprint: options.approvedPlanFingerprint || plan.report.planFingerprint,
      ...(plan.drainFence ? {drain: publicDrainBinding(plan.drainFence)} : {}),
      ...(plan.preDrainFence ? {preDrain: publicPreDrainBinding(plan.preDrainFence)} : {}),
      lastDocumentId: entry.id,
      processed,
      complete: processed === plan.entries.length,
    });
  }
  if (scopeFence) {
    const finalConfig = await backend.readUserDataRolloutConfig();
    if (plan.drainFence) assertDrainConfigMatches(finalConfig, plan.drainFence);
    else assertPreDrainConfigMatches(finalConfig, plan.preDrainFence);
    const finalDeletionJobs = activeDeletionJobsInScope(
      await backend.readActiveUserDeletionJobs(),
      scopeFence
    );
    if (
      finalDeletionJobs.length
      || activeDeletionJobFingerprint(finalDeletionJobs)
        !== plan.report.drainEvidence?.deletionJobFingerprint
    ) {
      throw new Error('The rollout scope changed deletion state during execution.');
    }
  }
  return {processed, complete: processed === plan.entries.length};
};

const createAdminBackend = (projectId) => {
  const {deleteApp, initializeApp} = require('firebase-admin/app');
  const {FieldPath, getFirestore} = require('firebase-admin/firestore');
  const app = initializeApp({projectId}, `task05-user-data-${process.pid}-${Date.now()}`);
  const firestore = getFirestore(app);
  const rolloutConfigReference = firestore.doc(USER_DATA_ROLLOUT_CONFIG_PATH);

  const versionOf = (snapshot) => {
    const exact = timestampParts(snapshot.updateTime);
    return exact
      ? `${exact.seconds}:${String(exact.nanoseconds).padStart(9, '0')}`
      : snapshot.updateTime?.toString?.() || 'unknown';
  };
  const assertFencedSnapshots = ({
    configSnapshot,
    sourceSnapshot,
    uid,
    drainFence,
    preDrainFence,
    expectedSourceVersion,
    expectedLegacyProjectionHash,
    expectedSourceHash,
    deletionJobSnapshot,
    allowDeletionConflict = false,
    allowCompletionLock = false,
  }) => {
    if (configSnapshot?.exists && !allowCompletionLock) {
      assertMigrationWritesUnlocked(configSnapshot.data());
    }
    const scopeFence = drainFence || preDrainFence;
    if (!scopeFence) return {deletionStatePending: false, activeDeletionJob: false};
    if (!configSnapshot?.exists) throw new Error('The exact rollout config disappeared during migration.');
    if (drainFence) assertDrainFenceMatches(configSnapshot.data(), uid, drainFence);
    else assertPreDrainFenceMatches(configSnapshot.data(), uid, preDrainFence);
    if (!sourceSnapshot?.exists) throw new Error('The rollout-scoped legacy source no longer exists.');
    if (expectedSourceVersion && versionOf(sourceSnapshot) !== expectedSourceVersion) {
      throw new Error('Legacy source changed after the approved dry run. Re-plan before writing.');
    }
    if (
      expectedLegacyProjectionHash
      && frozenLegacyProjectionHash(sourceSnapshot.data() || {}) !== expectedLegacyProjectionHash
    ) {
      throw new Error('Frozen legacy projection inputs changed after drain planning.');
    }
    if (expectedSourceHash && canonicalHash(sourceSnapshot.data() || {}) !== expectedSourceHash) {
      throw new Error('Legacy source changed after the approved dry run. Re-plan before writing.');
    }
    const status = {
      deletionStatePending: sourceSnapshot.get('deletionState') === 'pending',
      activeDeletionJob: Boolean(
        deletionJobSnapshot?.exists && deletionJobSnapshot.get('stage') !== 'completed'
      ),
    };
    if (!allowDeletionConflict && (status.deletionStatePending || status.activeDeletionJob)) {
      throw new Error('The drain-scoped subject has an active user deletion state or job.');
    }
    return status;
  };
  const getAllChunked = async (references) => {
    const snapshots = [];
    for (let index = 0; index < references.length; index += WRITE_BATCH_SIZE) {
      snapshots.push(...await firestore.getAll(...references.slice(index, index + WRITE_BATCH_SIZE)));
    }
    return snapshots;
  };
  const commitDocuments = async (documents, {mergeRootUid = ''} = {}) => {
    for (let index = 0; index < documents.length; index += WRITE_BATCH_SIZE) {
      const batch = firestore.batch();
      for (const document of documents.slice(index, index + WRITE_BATCH_SIZE)) {
        const merge = mergeRootUid && document.path === `users/${mergeRootUid}`;
        batch.set(firestore.doc(document.path), document.data, merge ? {merge: true} : undefined);
      }
      await batch.commit();
    }
  };

  return {
    close: () => deleteApp(app),
    fetchUserPage: async ({afterDocumentId, limit}) => {
      let query = firestore.collection('users').orderBy(FieldPath.documentId()).limit(limit);
      if (afterDocumentId) query = query.startAfter(afterDocumentId);
      const snapshot = await query.get();
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() || {},
        updateTime: versionOf(document),
      }));
    },
    fetchUserById: async (uid) => {
      const document = await firestore.doc(`users/${uid}`).get();
      return document.exists ? {
        id: document.id,
        data: document.data() || {},
        updateTime: versionOf(document),
      } : null;
    },
    readUserDataRolloutConfig: async () => {
      const snapshot = await rolloutConfigReference.get();
      return snapshot.exists ? snapshot.data() : null;
    },
    readActiveUserDeletionJobs: async () => {
      const snapshot = await firestore.collection("user_deletion_jobs").get();
      return snapshot.docs
        .filter((document) => document.get("stage") !== "completed")
        .map((document) => ({
          targetUid: typeof document.get("targetUid") === "string"
            ? document.get("targetUid")
            : document.id,
          stage: document.get("stage") ?? "unknown",
        }));
    },
    assertDrainFence: async ({
      uid,
      drainFence,
      expectedSourceVersion,
      expectedLegacyProjectionHash,
      allowDeletionConflict = false,
      allowCompletionLock = false,
    }) => firestore.runTransaction(async (transaction) => {
      const sourceReference = firestore.doc(`users/${uid}`);
      const deletionJobReference = firestore.doc(`user_deletion_jobs/${uid}`);
      const [configSnapshot, sourceSnapshot, deletionJobSnapshot] = await transaction.getAll(
        rolloutConfigReference,
        sourceReference,
        deletionJobReference
      );
      return assertFencedSnapshots({
        configSnapshot,
        sourceSnapshot,
        deletionJobSnapshot,
        uid,
        drainFence,
        expectedSourceVersion,
        expectedLegacyProjectionHash,
        allowDeletionConflict,
        allowCompletionLock,
      });
    }),
    assertPreDrainFence: async ({
      uid,
      preDrainFence,
      expectedSourceVersion,
      expectedLegacyProjectionHash,
      expectedSourceHash,
      allowDeletionConflict = false,
      allowCompletionLock = false,
    }) => firestore.runTransaction(async (transaction) => {
      const sourceReference = firestore.doc(`users/${uid}`);
      const deletionJobReference = firestore.doc(`user_deletion_jobs/${uid}`);
      const [configSnapshot, sourceSnapshot, deletionJobSnapshot] = await transaction.getAll(
        rolloutConfigReference,
        sourceReference,
        deletionJobReference
      );
      return assertFencedSnapshots({
        configSnapshot,
        sourceSnapshot,
        deletionJobSnapshot,
        uid,
        preDrainFence,
        expectedSourceVersion,
        expectedLegacyProjectionHash,
        expectedSourceHash,
        allowDeletionConflict,
        allowCompletionLock,
      });
    }),
    readDocuments: async (paths) => {
      const snapshots = await getAllChunked(paths.map((documentPath) => firestore.doc(documentPath)));
      return snapshots.map((snapshot) => ({
        path: snapshot.ref.path,
        data: snapshot.exists ? snapshot.data() : undefined,
      }));
    },
    readUserV2Documents: async (uid) => {
      const fixedPaths = [`users/${uid}`];
      const documents = await getAllChunked(fixedPaths.map((documentPath) => firestore.doc(documentPath)));
      const result = documents.filter(({exists}) => exists).map((snapshot) => ({path: snapshot.ref.path, data: snapshot.data()}));
      for (const collectionName of USER_V2_ENUMERATED_COLLECTIONS) {
        const snapshot = await firestore.collection(`users/${uid}/${collectionName}`).get();
        result.push(...snapshot.docs.map((document) => ({path: document.ref.path, data: document.data()})));
      }
      return result;
    },
    writeLegacyContentIdentities: async ({
      uid,
      identities,
      expectedSourceVersion,
      expectedSourceHash,
      expectedLegacyProjectionHash,
      preDrainFence,
    }) => {
      const rootReference = firestore.doc(`users/${uid}`);
      const deletionJobReference = firestore.doc(`user_deletion_jobs/${uid}`);
      await firestore.runTransaction(async (transaction) => {
        const snapshots = await transaction.getAll(
          rolloutConfigReference,
          rootReference,
          ...(preDrainFence ? [deletionJobReference] : [])
        );
        const configSnapshot = snapshots[0];
        const sourceSnapshot = snapshots[1];
        const deletionJobSnapshot = preDrainFence ? snapshots[2] : null;
        if (configSnapshot.exists) assertMigrationWritesUnlocked(configSnapshot.data());
        if (!sourceSnapshot.exists) throw new Error('Legacy source no longer exists.');
        if (versionOf(sourceSnapshot) !== expectedSourceVersion) {
          throw new Error('Legacy source changed after the approved dry run. Re-plan before writing.');
        }
        if (canonicalHash(sourceSnapshot.data() || {}) !== expectedSourceHash) {
          throw new Error('Legacy source changed after the approved dry run. Re-plan before writing.');
        }
        if (preDrainFence) {
          assertFencedSnapshots({
            configSnapshot,
            sourceSnapshot,
            deletionJobSnapshot,
            uid,
            preDrainFence,
            expectedSourceVersion,
            expectedLegacyProjectionHash,
            expectedSourceHash,
          });
        }
        const update = {};
        for (const field of ['spells', 'tecniche']) {
          if (
            identities?.[field] !== undefined
            && canonicalHash(sourceSnapshot.get(field)) !== canonicalHash(identities[field])
          ) update[field] = identities[field];
        }
        if (Object.keys(update).length) transaction.update(rootReference, update);
      });
    },
    writeUserV2Documents: async ({
      uid,
      documents,
      cleanupPaths = [],
      expectedSourceVersion,
      expectedLegacyProjectionHash,
      drainFence,
      preDrainFence,
    }) => {
      const scopeFence = drainFence || preDrainFence;
      const rootReference = firestore.doc(`users/${uid}`);
      const before = await rootReference.get();
      if (!before.exists || versionOf(before) !== expectedSourceVersion) {
        throw new Error('Legacy source changed after the approved dry run. Re-plan before writing.');
      }
      const nonRoot = documents.filter(({path: documentPath}) => documentPath !== `users/${uid}`);
      const mutations = [
        ...nonRoot.map((document) => ({kind: 'set', ...document})),
        ...cleanupPaths.map((documentPath) => ({kind: 'delete', path: documentPath})),
      ];
      for (let index = 0; index < mutations.length; index += WRITE_BATCH_SIZE) {
        const chunk = mutations.slice(index, index + WRITE_BATCH_SIZE);
        await firestore.runTransaction(async (transaction) => {
          const references = chunk.map(({path: documentPath}) => firestore.doc(documentPath));
          const deletionJobReference = firestore.doc(`user_deletion_jobs/${uid}`);
          const transactionSnapshots = await transaction.getAll(
            rootReference,
            rolloutConfigReference,
            ...(scopeFence ? [deletionJobReference] : []),
            ...references
          );
          const sourceSnapshot = transactionSnapshots[0];
          const configSnapshot = transactionSnapshots[1];
          const deletionJobSnapshot = scopeFence ? transactionSnapshots[2] : null;
          const snapshots = transactionSnapshots.slice(scopeFence ? 3 : 2);
          if (!sourceSnapshot.exists || versionOf(sourceSnapshot) !== expectedSourceVersion) {
            throw new Error('Legacy source changed while staging V2 documents. Re-plan before writing.');
          }
          assertFencedSnapshots({
            configSnapshot,
            sourceSnapshot,
            deletionJobSnapshot,
            uid,
            drainFence,
            preDrainFence,
            expectedSourceVersion,
            expectedLegacyProjectionHash,
          });
          chunk.forEach((mutation, mutationIndex) => {
            const snapshot = snapshots[mutationIndex];
            const descriptor = userV2PathDescriptor(uid, mutation.path);
            if (mutation.kind === 'delete') {
              if (snapshot.exists && snapshot.get('legacyManaged') !== true) {
                throw new Error('Refusing to delete a V2 document not owned by the migration.');
              }
              if (snapshot.exists) transaction.delete(snapshot.ref);
              return;
            }
            if (
              descriptor?.kind === 'dynamic'
              && snapshot.exists
              && snapshot.get('legacyManaged') !== true
            ) {
              throw new Error('Refusing to overwrite a V2 document not owned by the migration.');
            }
            transaction.set(snapshot.ref, mutation.data);
          });
        });
      }
      const root = documents.find(({path: documentPath}) => documentPath === `users/${uid}`);
      if (root) {
        await firestore.runTransaction(async (transaction) => {
          const deletionJobReference = firestore.doc(`user_deletion_jobs/${uid}`);
          const transactionSnapshots = await transaction.getAll(
            rootReference,
            rolloutConfigReference,
            ...(scopeFence ? [deletionJobReference] : [])
          );
          const beforeRootMerge = transactionSnapshots[0];
          const configSnapshot = transactionSnapshots[1];
          const deletionJobSnapshot = scopeFence ? transactionSnapshots[2] : null;
          if (!beforeRootMerge.exists || versionOf(beforeRootMerge) !== expectedSourceVersion) {
            throw new Error('Legacy source changed before the shell merge. Re-plan before writing.');
          }
          assertFencedSnapshots({
            configSnapshot,
            sourceSnapshot: beforeRootMerge,
            deletionJobSnapshot,
            uid,
            drainFence,
            preDrainFence,
            expectedSourceVersion,
            expectedLegacyProjectionHash,
          });
          transaction.set(rootReference, root.data, {merge: true});
        });
      }
    },
    writeArchiveDocuments: async ({uid, documents, expectedSourceHash}) => {
      const source = await firestore.doc(`users/${uid}`).get();
      if (!source.exists || canonicalHash(source.data() || {}) !== expectedSourceHash) {
        throw new Error('Legacy source no longer matches the approved archive plan.');
      }
      const existing = await getAllChunked(documents.map(({path: documentPath}) => firestore.doc(documentPath)));
      if (existing.some(({exists}) => exists)) {
        const actual = existing.map((snapshot) => ({path: snapshot.ref.path, data: snapshot.exists ? snapshot.data() : undefined}));
        if (hashDocumentSet(actual) !== hashDocumentSet(documents)) {
          throw new Error('Immutable archive documents already exist with different content.');
        }
        return;
      }
      await commitDocuments(documents);
    },
    mergeLegacyUser: async ({uid, legacyData, expectedV2Hash}) => {
      const rootReference = firestore.doc(`users/${uid}`);
      await firestore.runTransaction(async (transaction) => {
        const fixedReferences = [rolloutConfigReference, rootReference];
        const [fixedSnapshots, collectionSnapshots] = await Promise.all([
          Promise.all(fixedReferences.map((reference) => transaction.get(reference))),
          Promise.all(USER_V2_ENUMERATED_COLLECTIONS.map((collectionName) => (
            transaction.get(firestore.collection(`users/${uid}/${collectionName}`))
          ))),
        ]);
        if (fixedSnapshots[0].exists) assertMigrationWritesUnlocked(fixedSnapshots[0].data());
        const currentV2 = [
          ...fixedSnapshots.slice(1)
            .filter(({exists}) => exists)
            .map((snapshot) => ({path: snapshot.ref.path, data: snapshot.data()})),
          ...collectionSnapshots.flatMap((snapshot) => snapshot.docs.map((document) => ({
            path: document.ref.path,
            data: document.data(),
          }))),
        ];
        if (hashDocumentSet(currentV2) !== expectedV2Hash) {
          throw new Error('V2 data changed after the approved reverse dry run. Re-plan before writing.');
        }
        transaction.set(rootReference, legacyData, {merge: true});
      });
    },
    readLegacyUser: async (uid) => {
      const snapshot = await firestore.doc(`users/${uid}`).get();
      return snapshot.exists ? snapshot.data() : null;
    },
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return printHelp();
  const target = assertSafeTarget(options);
  const backend = createAdminBackend(options.projectId);
  try {
    const plan = await buildMigrationPlan({
      backend,
      operation: options.operation,
      projectId: options.projectId,
      maxUsers: options.maxUsers,
      drain: options.drain,
      preDrain: options.preDrain,
    });
    if (!options.execute) {
      writeJsonAtomic(options.reportPath, plan.report);
      console.log(JSON.stringify({
        mode: 'dry-run',
        operation: options.operation,
        live: target.live,
        complete: plan.report.complete,
        counts: plan.report.counts,
        planFingerprint: plan.report.planFingerprint,
        ...(plan.report.drain ? {drain: plan.report.drain} : {}),
        ...(plan.report.preDrain ? {preDrain: plan.report.preDrain} : {}),
        reportPath: options.reportPath,
      }, null, 2));
      return;
    }

    const approvedReport = readJson(options.reportPath, 'Dry-run report');
    if (options.resume) {
      options.resumeCheckpoint = assertCheckpoint(
        readJson(options.checkpointPath, 'Migration checkpoint'),
        approvedReport,
        options
      );
    } else if (fs.existsSync(options.checkpointPath)) {
      throw new Error('Checkpoint already exists; use --resume or select another checkpoint path.');
    }
    assertApprovedReport(approvedReport, plan, options);
    options.approvedPlanFingerprint = approvedReport.planFingerprint;
    const result = await executeMigrationPlan({
      backend,
      options,
      plan,
      onCheckpoint: async (checkpoint) => writeJsonAtomic(options.checkpointPath, checkpoint),
    });
    console.log(JSON.stringify({
      mode: 'execute',
      operation: options.operation,
      live: target.live,
      complete: result.complete,
      processed: result.processed,
      planFingerprint: plan.report.planFingerprint,
      ...(plan.report.drain ? {drain: plan.report.drain} : {}),
      ...(plan.report.preDrain ? {preDrain: plan.report.preDrain} : {}),
      checkpointPath: options.checkpointPath,
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
  assertApprovedReport,
  assertCheckpoint,
  assertDrainConfigMatches,
  assertDrainFenceMatches,
  assertPreDrainConfigMatches,
  assertPreDrainFenceMatches,
  assertMigrationWritesUnlocked,
  assertSafeTarget,
  buildMigrationPlan,
  executeMigrationPlan,
  hashDocumentSet,
  hashActualAgainstExpected,
  frozenLegacyProjectionHash,
  inspectOwnedV2Projection,
  parseArguments,
  projectObject,
  publicDrainBinding,
  publicPreDrainBinding,
  readJson,
  validateReversePersonalContent,
  writeJsonAtomic,
};
