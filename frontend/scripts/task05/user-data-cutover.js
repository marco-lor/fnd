#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {canonicalHash} = require('./user-data-model');

const CUTOVER_SCHEMA_VERSION = 1;
const MIGRATION_REPORT_SCHEMA_VERSION = 2;
const MODEL_VERSION = 2;
const CONFIG_PATH = 'app_config/user_data_v2';
const COMPLETION_LOCK_FIELD = 'userDataCompletionLock';
const ATTESTATION_COLLECTION_PATH = 'migration_state/user-data-v2/cutovers';
const DRAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ACTIONS = new Set(['open', 'seal', 'complete', 'abort']);
const SCOPES = new Set(['global', 'user']);
const CUTOVER_STAGES = new Set(['new-read-dual-write', 'new-only']);
const ROLLOUT_STAGES = new Set([
  'legacy-read',
  'shadow-verify',
  'dual-write',
  ...CUTOVER_STAGES,
]);
const ATTESTATION_STATUSES = new Set([
  'frozen',
  'sealed',
  'finalizing',
  'rollback-frozen',
  'completed',
  'aborted',
]);
const DEFAULT_RESULTS_DIRECTORY = path.resolve(__dirname, '..', '..', 'performance-results');

const defaultPath = (name) => path.join(DEFAULT_RESULTS_DIRECTORY, `task05-${name}.json`);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isValidFirestoreDocumentId = (value) => (
  typeof value === 'string'
  && value.length > 0
  && value !== '.'
  && value !== '..'
  && !value.includes('/')
  && Buffer.byteLength(value, 'utf8') <= 1500
);

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

const sameTimestamp = (left, right) => canonicalHash(timestampParts(left)) === canonicalHash(timestampParts(right));
const subjectHash = (projectId, uid) => canonicalHash({projectId, uid});

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
    throw new Error(`${label} is not valid JSON.`, {cause: error});
  }
};

const printHelp = () => console.log([
  'Task 05 user-data cutover controller.',
  '',
  'Usage:',
  '  node scripts/task05/user-data-cutover.js --project <project>',
  '    --action open|seal|complete|abort --scope global|user --drain-id <id>',
  '    [--drain-user <uid>] [--verification-report <path>]',
  '    [--approve-verification-fingerprint <sha256>] [--report <path>]',
  '    [--execute --approve-fingerprint <sha256> --result <path>]',
  '    [--allow-live-project --confirm-project <project>]',
  '',
  'Safety:',
  '  - Default mode is a read-only plan. Admin SDK loading happens only after target checks.',
  '  - Execution requires the exact reviewed plan fingerprint and transactional state checks.',
  '  - Seal and complete require exact, completed, error-free migration verification reports.',
  '  - Complete locks sanctioned migration writes, reruns verification, then removes the drain.',
  '  - Abort from sealed state restores the frozen state; a second abort removes the drain.',
  '  - Reports contain subject hashes only. A raw user ID is never written to a report.',
].join('\n'));

const parseArguments = (args = []) => {
  const options = {
    action: '',
    allowLiveProject: false,
    approveFingerprint: '',
    approveVerificationFingerprint: '',
    confirmProject: '',
    drainId: '',
    drainUserId: '',
    execute: false,
    help: false,
    projectId: '',
    reportPath: '',
    resultPath: '',
    scope: '',
    verificationReportPath: '',
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--execute') options.execute = true;
    else if (argument === '--allow-live-project') options.allowLiveProject = true;
    else if ([
      '--action',
      '--approve-fingerprint',
      '--approve-report-fingerprint',
      '--approve-verification-fingerprint',
      '--confirm-project',
      '--drain-id',
      '--drain-user',
      '--project',
      '--report',
      '--result',
      '--scope',
      '--verification-report',
    ].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === '--action') options.action = value;
      if (argument === '--approve-fingerprint') options.approveFingerprint = value;
      if (argument === '--approve-report-fingerprint' || argument === '--approve-verification-fingerprint') {
        options.approveVerificationFingerprint = value;
      }
      if (argument === '--confirm-project') options.confirmProject = value;
      if (argument === '--drain-id') options.drainId = value;
      if (argument === '--drain-user') options.drainUserId = value;
      if (argument === '--project') options.projectId = value;
      if (argument === '--report') options.reportPath = path.resolve(value);
      if (argument === '--result') options.resultPath = path.resolve(value);
      if (argument === '--scope') options.scope = value;
      if (argument === '--verification-report') options.verificationReportPath = path.resolve(value);
    } else throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.help) return options;
  if (!options.projectId) throw new Error('Explicit --project is required.');
  if (!ACTIONS.has(options.action)) throw new Error('--action must be exactly open, seal, complete, or abort.');
  if (!SCOPES.has(options.scope)) throw new Error('--scope must be exactly global or user.');
  if (!DRAIN_ID_PATTERN.test(options.drainId)) {
    throw new Error('--drain-id must be an exact 8-100 character URL-safe drain identifier.');
  }
  if (options.scope === 'user') {
    if (!isValidFirestoreDocumentId(options.drainUserId)) {
      throw new Error('--drain-user must be one exact Firestore user document ID.');
    }
  } else if (options.drainUserId) {
    throw new Error('--drain-user is only valid with --scope user.');
  }
  if (['seal', 'complete'].includes(options.action)) {
    if (!options.verificationReportPath) {
      throw new Error(`${options.action} requires --verification-report.`);
    }
    if (!SHA256_PATTERN.test(options.approveVerificationFingerprint)) {
      throw new Error(`${options.action} requires an exact --approve-verification-fingerprint.`);
    }
  } else if (options.verificationReportPath || options.approveVerificationFingerprint) {
    throw new Error('Verification report arguments are valid only for seal and complete.');
  }
  if (options.execute && !SHA256_PATTERN.test(options.approveFingerprint)) {
    throw new Error('--execute requires an exact --approve-fingerprint.');
  }
  options.reportPath ||= defaultPath(`cutover-${options.action}-${options.scope}-dry-run`);
  options.resultPath ||= defaultPath(`cutover-${options.action}-${options.scope}-execute`);
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
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[variable] && env[variable] !== options.projectId) {
      throw new Error(`${variable} does not match the explicit --project.`);
    }
  }
  const emulator = parseEmulatorHost(env.FIRESTORE_EMULATOR_HOST);
  const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (emulator && loopback.has(emulator.hostname)) {
    if (!options.projectId.startsWith('demo-')) throw new Error('Emulator operations require a demo-* project ID.');
    return {live: false, emulatorHost: env.FIRESTORE_EMULATOR_HOST, projectId: options.projectId};
  }
  if (env.FIRESTORE_EMULATOR_HOST) throw new Error('Non-loopback Firestore emulator hosts are refused.');
  if (!options.allowLiveProject || options.confirmProject !== options.projectId) {
    throw new Error(
      'Live Firestore access is refused without --allow-live-project and an exact --confirm-project value.'
    );
  }
  return {live: true, emulatorHost: null, projectId: options.projectId};
};

const validateDrainRecord = (value, label) => {
  if (!isRecord(value)) throw new Error(`${label} must be an immutable drain record.`);
  const unexpected = Object.keys(value).filter((key) => !['drainId', 'closedAt'].includes(key));
  const drainId = typeof value.drainId === 'string' ? value.drainId.trim() : '';
  const closedAt = timestampParts(value.closedAt);
  if (unexpected.length || !DRAIN_ID_PATTERN.test(drainId) || !closedAt) {
    throw new Error(`${label} must contain only a valid drainId and Firestore closedAt timestamp.`);
  }
  return {drainId, closedAt};
};

const validateRolloutConfig = (config) => {
  if (!isRecord(config)) throw new Error('The server-owned user-data rollout config is missing or malformed.');
  const configuredMode = hasOwn(config, 'mode') ? config.mode : undefined;
  const configuredStage = hasOwn(config, 'stage') ? config.stage : undefined;
  if (configuredMode !== undefined && configuredStage !== undefined && configuredMode !== configuredStage) {
    throw new Error('The user-data rollout config has conflicting mode and stage values.');
  }
  const globalStage = configuredMode ?? configuredStage ?? 'legacy-read';
  if (!ROLLOUT_STAGES.has(globalStage)) throw new Error('The user-data rollout config has an invalid stage.');

  const rawOverrides = config.userOverrides ?? {};
  if (!isRecord(rawOverrides)) throw new Error('The user-data rollout overrides map is malformed.');
  const overrides = new Map();
  for (const [uid, stage] of Object.entries(rawOverrides)) {
    if (!isValidFirestoreDocumentId(uid) || !ROLLOUT_STAGES.has(stage)) {
      throw new Error('The user-data rollout config contains an invalid user override.');
    }
    overrides.set(uid, stage);
  }

  const rawLegacyDrain = config.legacyDrain ?? {};
  if (!isRecord(rawLegacyDrain)) throw new Error('The rollout legacyDrain map is malformed.');
  if (Object.keys(rawLegacyDrain).some((key) => !['global', 'users'].includes(key))) {
    throw new Error('The rollout legacyDrain map contains unsupported fields.');
  }
  const globalDrain = hasOwn(rawLegacyDrain, 'global')
    ? validateDrainRecord(rawLegacyDrain.global, 'The global drain')
    : null;
  const rawUserDrains = rawLegacyDrain.users ?? {};
  if (!isRecord(rawUserDrains)) throw new Error('The rollout user drains map is malformed.');
  const userDrains = new Map();
  for (const [uid, drain] of Object.entries(rawUserDrains)) {
    if (!isValidFirestoreDocumentId(uid)) throw new Error('A user drain has an invalid scope key.');
    userDrains.set(uid, validateDrainRecord(drain, 'A user drain'));
  }
  return {globalDrain, globalStage, overrides, rawLegacyDrain, userDrains};
};

const scopeFingerprint = ({scope, globalStage, overrides, userId = ''}) => {
  const orderedOverrides = [...overrides.entries()].sort(([left], [right]) => left.localeCompare(right));
  return scope === 'global'
    ? canonicalHash({scope, globalStage, userOverrides: orderedOverrides})
    : canonicalHash({scope, userId, overrideStage: overrides.get(userId)});
};

const scopedState = ({config, scope, drainId, userId = ''}) => {
  const validated = validateRolloutConfig(config);
  if (scope === 'user' && !validated.overrides.has(userId)) {
    throw new Error('A user cutover requires an explicit valid rollout override for that exact user.');
  }
  const stage = scope === 'global' ? validated.globalStage : validated.overrides.get(userId);
  if (!CUTOVER_STAGES.has(stage)) {
    throw new Error('Cutover is allowed only from new-read-dual-write or new-only.');
  }
  const drain = scope === 'global' ? validated.globalDrain : validated.userDrains.get(userId);
  if (drain && drain.drainId !== drainId) {
    throw new Error('The requested drainId does not match the exact server-owned drain record.');
  }
  let state;
  if (stage === 'new-read-dual-write' && !drain) state = 'A';
  else if (stage === 'new-read-dual-write' && drain) state = 'F';
  else if (stage === 'new-only' && drain) state = 'S';
  else state = 'O';
  return {
    ...validated,
    drain: drain || null,
    fingerprint: scopeFingerprint({
      scope,
      globalStage: validated.globalStage,
      overrides: validated.overrides,
      userId,
    }),
    stage,
    state,
  };
};

const validateAttestation = ({
  attestation,
  projectId,
  scope,
  drainId,
  userId,
  expectedDrain,
  expectedScopeFingerprint,
}) => {
  if (!isRecord(attestation)) return null;
  if (
    attestation.schemaVersion !== CUTOVER_SCHEMA_VERSION
    || attestation.projectId !== projectId
    || attestation.scope !== scope
    || attestation.drainId !== drainId
    || !ATTESTATION_STATUSES.has(attestation.status)
    || attestation.scopeFingerprint !== expectedScopeFingerprint
    || attestation.originalStage !== 'new-read-dual-write'
  ) {
    throw new Error('The durable cutover attestation does not match this exact request and scope.');
  }
  if (scope === 'user' && attestation.subjectHash !== subjectHash(projectId, userId)) {
    throw new Error('The durable cutover attestation does not match the exact user scope.');
  }
  if (expectedDrain && !sameTimestamp(attestation.closedAt, expectedDrain.closedAt)) {
    throw new Error('The durable cutover attestation does not match the immutable drain cutoff.');
  }
  return attestation;
};

const completionLockCore = ({planFingerprint, verificationFingerprint, projectId, scope, drainId, scopeFingerprint: fingerprint, userId = ''}) => ({
  schemaVersion: CUTOVER_SCHEMA_VERSION,
  projectId,
  scope,
  drainId,
  scopeFingerprint: fingerprint,
  verificationFingerprint,
  cutoverPlanFingerprint: planFingerprint,
  ...(scope === 'user' ? {subjectHash: subjectHash(projectId, userId)} : {}),
});

const completionLockForPlan = ({plan, serverTimestamp}) => {
  const core = completionLockCore({
    planFingerprint: plan.report.planFingerprint,
    verificationFingerprint: plan.internal.verification.planFingerprint,
    projectId: plan.report.projectId,
    scope: plan.report.scope,
    drainId: plan.report.drainId,
    scopeFingerprint: plan.report.scopeFingerprint,
    userId: plan.internal.userId,
  });
  return {
    ...core,
    lockFingerprint: canonicalHash(core),
    lockedAt: serverTimestamp,
  };
};

const validateCompletionLock = ({lock, approvedReport, projectId, scope, drainId, userId = ''}) => {
  if (!isRecord(lock)) throw new Error('The completion lock is missing or malformed.');
  const allowed = new Set([
    'schemaVersion',
    'projectId',
    'scope',
    'drainId',
    'scopeFingerprint',
    'verificationFingerprint',
    'cutoverPlanFingerprint',
    'subjectHash',
    'lockFingerprint',
    'lockedAt',
  ]);
  const core = completionLockCore({
    planFingerprint: lock.cutoverPlanFingerprint,
    verificationFingerprint: lock.verificationFingerprint,
    projectId: lock.projectId,
    scope: lock.scope,
    drainId: lock.drainId,
    scopeFingerprint: lock.scopeFingerprint,
    userId,
  });
  if (
    Object.keys(lock).some((key) => !allowed.has(key))
    || lock.schemaVersion !== CUTOVER_SCHEMA_VERSION
    || lock.projectId !== projectId
    || lock.scope !== scope
    || lock.drainId !== drainId
    || lock.cutoverPlanFingerprint !== approvedReport?.planFingerprint
    || lock.verificationFingerprint !== approvedReport?.verification?.planFingerprint
    || lock.scopeFingerprint !== approvedReport?.scopeFingerprint
    || lock.lockFingerprint !== canonicalHash(core)
    || !timestampParts(lock.lockedAt)
    || (scope === 'user' && lock.subjectHash !== subjectHash(projectId, userId))
    || (scope === 'global' && hasOwn(lock, 'subjectHash'))
  ) {
    throw new Error('The completion lock does not match the exact approved cutover plan.');
  }
  return lock;
};

const summarizeVerificationSubjects = (subjects) => canonicalHash(
  subjects
    .map((entry) => ({
      cleanupFingerprint: entry.cleanupFingerprint,
      currentHash: entry.currentHash,
      issues: entry.issues,
      legacyProjectionHash: entry.legacyProjectionHash,
      sourceHash: entry.sourceHash,
      sourceVersionHash: entry.sourceVersionHash,
      subjectHash: entry.subjectHash,
      targetHash: entry.targetHash,
    }))
    .sort((left, right) => left.subjectHash.localeCompare(right.subjectHash))
);

const validateVerificationReport = ({
  report,
  approvedFingerprint,
  projectId,
  scope,
  drainId,
  userId,
  scoped,
}) => {
  if (
    !isRecord(report)
    || report.schemaVersion !== MIGRATION_REPORT_SCHEMA_VERSION
    || report.modelVersion !== MODEL_VERSION
    || report.mode !== 'dry-run'
    || report.operation !== 'verify'
    || report.projectId !== projectId
    || report.complete !== true
    || !SHA256_PATTERN.test(report.planFingerprint)
    || report.planFingerprint !== approvedFingerprint
    || !Array.isArray(report.subjects)
    || report.counts?.errors !== 0
    || report.counts?.writesRequired !== 0
    || Number(report.counts?.cleanupDocuments || 0) !== 0
    || Number(report.counts?.deletionConflicts || 0) !== 0
    || report.counts?.users !== report.subjects.length
  ) {
    throw new Error('Cutover requires an exact completed, clean, read-only V2 verification report.');
  }
  const expectedDrain = scoped.drain;
  if (
    !expectedDrain
    || report.drain?.scope !== scope
    || report.drain?.drainId !== drainId
    || report.drain?.rolloutStage !== scoped.stage
    || report.drain?.scopeFingerprint !== scoped.fingerprint
    || !sameTimestamp(report.drain?.closedAt, expectedDrain.closedAt)
  ) {
    throw new Error('The verification report is not bound to the current exact drain fence and rollout scope.');
  }
  if (
    report.drainEvidence?.deletionConflicts !== 0
    || (Array.isArray(report.drainEvidence?.codes) && report.drainEvidence.codes.length > 0)
  ) {
    throw new Error('The verification report contains an active deletion conflict.');
  }
  for (const entry of report.subjects) {
    if (
      !isRecord(entry)
      || !SHA256_PATTERN.test(entry.subjectHash)
      || !SHA256_PATTERN.test(entry.sourceHash)
      || !SHA256_PATTERN.test(entry.sourceVersionHash)
      || !SHA256_PATTERN.test(entry.legacyProjectionHash)
      || !SHA256_PATTERN.test(entry.targetHash)
      || !SHA256_PATTERN.test(entry.currentHash)
      || entry.currentHash !== entry.targetHash
      || entry.issues?.errors !== 0
    ) {
      throw new Error('The verification report contains an unverified or malformed subject.');
    }
  }
  if (scope === 'user') {
    const expectedSubjectHash = subjectHash(projectId, userId);
    if (
      report.subjects.length !== 1
      || report.subjects[0].subjectHash !== expectedSubjectHash
      || report.drain.subjectHash !== expectedSubjectHash
    ) {
      throw new Error('The verification report does not match the exact user cutover scope.');
    }
  }
  return {
    planFingerprint: report.planFingerprint,
    reportDigest: canonicalHash(report),
    subjectsFingerprint: summarizeVerificationSubjects(report.subjects),
    subjects: report.subjects.length,
  };
};

const validateRecordedVerificationReport = ({
  report,
  approvedFingerprint,
  attestation,
  action,
  projectId,
  scope,
  userId,
}) => {
  const prefix = action === 'seal' ? 'seal' : 'completion';
  if (
    !isRecord(report)
    || report.schemaVersion !== MIGRATION_REPORT_SCHEMA_VERSION
    || report.modelVersion !== MODEL_VERSION
    || report.mode !== 'dry-run'
    || report.operation !== 'verify'
    || report.projectId !== projectId
    || report.complete !== true
    || report.planFingerprint !== approvedFingerprint
    || attestation?.[`${prefix}VerificationFingerprint`] !== report.planFingerprint
    || attestation?.[`${prefix}ReportDigest`] !== canonicalHash(report)
    || !Array.isArray(report.subjects)
    || attestation?.[`${prefix}SubjectsFingerprint`] !== summarizeVerificationSubjects(report.subjects)
  ) {
    throw new Error('The already-applied transition requires its exact durably recorded verification report.');
  }
  if (scope === 'user') {
    const expectedSubjectHash = subjectHash(projectId, userId);
    if (
      report.drain?.subjectHash !== expectedSubjectHash
      || report.subjects.length !== 1
      || report.subjects[0]?.subjectHash !== expectedSubjectHash
    ) {
      throw new Error('The recorded verification report does not match the exact user scope.');
    }
  }
  return {
    planFingerprint: report.planFingerprint,
    reportDigest: canonicalHash(report),
    subjectsFingerprint: summarizeVerificationSubjects(report.subjects),
    subjects: report.subjects.length,
  };
};

const transitionFor = ({action, state, attestation}) => {
  if (action === 'open') {
    if (state === 'F' && attestation?.status === 'frozen') return {after: 'F', idempotent: true, kind: 'none'};
    if (state !== 'A') throw new Error('Open requires active new-read-dual-write state with no drain.');
    if (attestation) throw new Error('This drain identifier is already durably tombstoned and cannot be reused.');
    return {after: 'F', idempotent: false, kind: 'open'};
  }
  if (action === 'seal') {
    if (state === 'S' && attestation?.status === 'sealed') return {after: 'S', idempotent: true, kind: 'none'};
    if (state !== 'F' || !['frozen', 'rollback-frozen'].includes(attestation?.status)) {
      throw new Error('Seal requires the exact frozen drain and its durable attestation.');
    }
    return {after: 'S', idempotent: false, kind: 'seal'};
  }
  if (action === 'complete') {
    if (state === 'O' && attestation?.status === 'completed') return {after: 'O', idempotent: true, kind: 'none'};
    if (state !== 'S' || attestation?.status !== 'sealed') {
      throw new Error('Complete requires the exact sealed drain and its durable attestation.');
    }
    return {after: 'O', idempotent: false, kind: 'complete'};
  }
  if (state === 'S' && ['sealed', 'finalizing'].includes(attestation?.status)) {
    return {after: 'F', idempotent: false, kind: 'rollback-to-frozen'};
  }
  if (state === 'F' && ['frozen', 'rollback-frozen'].includes(attestation?.status)) {
    return {after: 'A', idempotent: false, kind: 'abort-frozen'};
  }
  if (state === 'A' && attestation?.status === 'aborted') return {after: 'A', idempotent: true, kind: 'none'};
  throw new Error('Abort is valid only for a frozen or sealed transition owned by this drain identifier.');
};

const mutationLabels = (kind) => ({
  open: ['install-immutable-drain', 'write-frozen-attestation'],
  seal: ['set-scope-new-only', 'seal-verification-attestation'],
  complete: [
    'install-completion-lock',
    'rerun-scope-verification',
    'remove-exact-drain',
    'complete-verification-attestation',
  ],
  'rollback-to-frozen': ['restore-scope-new-read-dual-write', 'retain-exact-drain'],
  'abort-frozen': ['remove-exact-drain', 'tombstone-aborted-transition'],
  none: [],
}[kind]);

const buildCutoverPlan = ({
  action,
  attestation = null,
  config,
  drainId,
  generatedAt = new Date().toISOString(),
  projectId,
  scope,
  userId = '',
  verificationApprovedFingerprint = '',
  verificationReport = null,
}) => {
  if (!ACTIONS.has(action) || !SCOPES.has(scope) || !DRAIN_ID_PATTERN.test(drainId) || !projectId) {
    throw new Error('A valid action, project, scope, and drain identifier are required.');
  }
  if (scope === 'user' && !isValidFirestoreDocumentId(userId)) {
    throw new Error('A valid exact user document ID is required for user scope.');
  }
  const scoped = scopedState({config, scope, drainId, userId});
  const durableAttestation = validateAttestation({
    attestation,
    projectId,
    scope,
    drainId,
    userId,
    expectedDrain: scoped.drain,
    expectedScopeFingerprint: scoped.fingerprint,
  });
  const completionLockPresent = hasOwn(config, COMPLETION_LOCK_FIELD);
  if (completionLockPresent && !(action === 'abort' && durableAttestation?.status === 'finalizing')) {
    throw new Error(
      'This scope has a completion lock. Retry the original approved complete execution or abort it first.'
    );
  }
  if (!completionLockPresent && durableAttestation?.status === 'finalizing') {
    throw new Error('The durable finalization attestation lost its matching completion lock.');
  }
  if (completionLockPresent) {
    const lock = validateCompletionLock({
      lock: config[COMPLETION_LOCK_FIELD],
      approvedReport: {
        planFingerprint: durableAttestation.completionPlanFingerprint,
        scopeFingerprint: scoped.fingerprint,
        verification: {
          planFingerprint: durableAttestation.completionApprovedVerificationFingerprint,
        },
      },
      projectId,
      scope,
      drainId,
      userId,
    });
    if (durableAttestation.completionLockFingerprint !== lock.lockFingerprint) {
      throw new Error('Abort requires the exact durable completion lock attestation.');
    }
  }
  const transition = transitionFor({action, state: scoped.state, attestation: durableAttestation});
  let verification = null;
  if (['seal', 'complete'].includes(action)) {
    verification = transition.idempotent
      ? validateRecordedVerificationReport({
        report: verificationReport,
        approvedFingerprint: verificationApprovedFingerprint,
        attestation: durableAttestation,
        action,
        projectId,
        scope,
        userId,
      })
      : validateVerificationReport({
        report: verificationReport,
        approvedFingerprint: verificationApprovedFingerprint,
        projectId,
        scope,
        drainId,
        userId,
        scoped,
      });
  }
  if (action === 'complete') {
    if (
      durableAttestation?.sealVerificationFingerprint == null
      || !SHA256_PATTERN.test(durableAttestation.sealVerificationFingerprint)
      || !SHA256_PATTERN.test(durableAttestation.sealReportDigest)
      || !SHA256_PATTERN.test(durableAttestation.sealSubjectsFingerprint)
    ) {
      throw new Error('Complete requires a prior durable sealed verification attestation.');
    }
  }

  const afterOverrides = new Map(scoped.overrides);
  let afterGlobalStage = scoped.globalStage;
  if (transition.kind === 'seal') {
    if (scope === 'global') afterGlobalStage = 'new-only';
    else afterOverrides.set(userId, 'new-only');
  }
  if (transition.kind === 'rollback-to-frozen') {
    if (scope === 'global') afterGlobalStage = 'new-read-dual-write';
    else afterOverrides.set(userId, 'new-read-dual-write');
  }
  const scopeFingerprintAfter = scopeFingerprint({
    scope,
    globalStage: afterGlobalStage,
    overrides: afterOverrides,
    userId,
  });

  const core = {
    schemaVersion: CUTOVER_SCHEMA_VERSION,
    kind: 'task05-user-data-cutover-plan',
    projectId,
    action,
    scope,
    drainId,
    ...(scope === 'user' ? {subjectHash: subjectHash(projectId, userId)} : {}),
    stateBefore: scoped.state,
    stateAfter: transition.after,
    idempotent: transition.idempotent,
    configFingerprint: canonicalHash(config),
    attestationFingerprint: canonicalHash(attestation || null),
    scopeFingerprint: scoped.fingerprint,
    scopeFingerprintAfter,
    mutations: mutationLabels(transition.kind),
    ...(verification ? {verification} : {}),
  };
  return {
    internal: {
      action,
      attestation: durableAttestation,
      kind: transition.kind,
      scoped,
      userId,
      verification,
    },
    report: {
      ...core,
      mode: 'dry-run',
      generatedAt,
      planFingerprint: canonicalHash(core),
    },
  };
};

const planCoreFromReport = (report) => {
  if (!isRecord(report)) return null;
  const {
    mode: _mode,
    generatedAt: _generatedAt,
    planFingerprint: _planFingerprint,
    ...core
  } = report;
  return core;
};

const assertApprovedPlanReport = ({approvedReport, approvedFingerprint}) => {
  if (
    !isRecord(approvedReport)
    || approvedReport.schemaVersion !== CUTOVER_SCHEMA_VERSION
    || approvedReport.kind !== 'task05-user-data-cutover-plan'
    || approvedReport.mode !== 'dry-run'
    || !SHA256_PATTERN.test(approvedFingerprint)
    || approvedReport.planFingerprint !== approvedFingerprint
    || canonicalHash(planCoreFromReport(approvedReport)) !== approvedReport.planFingerprint
  ) {
    throw new Error('Execution requires the exact current reviewed cutover plan and fingerprint.');
  }
  return true;
};

const assertApprovedPlan = ({approvedReport, approvedFingerprint, currentPlan}) => {
  assertApprovedPlanReport({approvedReport, approvedFingerprint});
  if (currentPlan.report.planFingerprint !== approvedReport.planFingerprint) {
    throw new Error('Execution requires the exact current reviewed cutover plan and fingerprint.');
  }
  return true;
};

const configPatchForPlan = ({config, deleteField, plan, serverTimestamp}) => {
  if (plan.internal.kind === 'none') return null;
  const {kind, scoped} = plan.internal;
  const patch = {};
  const setStage = (stage) => {
    if (plan.report.scope === 'global') {
      if (hasOwn(config, 'mode')) patch.mode = stage;
      if (hasOwn(config, 'stage')) patch.stage = stage;
      if (!hasOwn(config, 'mode') && !hasOwn(config, 'stage')) patch.mode = stage;
    } else {
      patch.userOverrides = {...(config.userOverrides || {}), [plan.internal.userId]: stage};
    }
  };
  const legacyDrain = {
    ...(isRecord(config.legacyDrain) ? config.legacyDrain : {}),
    users: {...(isRecord(config.legacyDrain?.users) ? config.legacyDrain.users : {})},
  };
  const setDrain = (value) => {
    if (plan.report.scope === 'global') {
      if (value) legacyDrain.global = value;
      else delete legacyDrain.global;
    } else if (value) legacyDrain.users[plan.internal.userId] = value;
    else delete legacyDrain.users[plan.internal.userId];
    patch.legacyDrain = legacyDrain;
  };

  if (kind === 'open') setDrain({drainId: plan.report.drainId, closedAt: serverTimestamp});
  if (kind === 'seal') setStage('new-only');
  if (kind === 'complete') setDrain(null);
  if (kind === 'rollback-to-frozen') {
    setStage('new-read-dual-write');
    if (hasOwn(config, COMPLETION_LOCK_FIELD)) patch[COMPLETION_LOCK_FIELD] = deleteField;
  }
  if (kind === 'abort-frozen') setDrain(null);
  if (kind === 'seal' && scoped.stage !== 'new-read-dual-write') throw new Error('Unexpected seal source stage.');
  return patch;
};

const attestationForPlan = ({plan, serverTimestamp}) => {
  if (plan.internal.kind === 'none') return null;
  const base = {
    ...(plan.internal.attestation || {}),
    schemaVersion: CUTOVER_SCHEMA_VERSION,
    projectId: plan.report.projectId,
    scope: plan.report.scope,
    drainId: plan.report.drainId,
    scopeFingerprint: plan.report.scopeFingerprintAfter,
    originalStage: 'new-read-dual-write',
    ...(plan.report.subjectHash ? {subjectHash: plan.report.subjectHash} : {}),
  };
  if (plan.internal.kind === 'open') return {
    ...base,
    status: 'frozen',
    closedAt: serverTimestamp,
    openedAt: serverTimestamp,
  };
  if (plan.internal.kind === 'seal') return {
    ...base,
    status: 'sealed',
    sealVerificationFingerprint: plan.internal.verification.planFingerprint,
    sealReportDigest: plan.internal.verification.reportDigest,
    sealSubjectsFingerprint: plan.internal.verification.subjectsFingerprint,
    sealedAt: serverTimestamp,
  };
  if (plan.internal.kind === 'complete') return {
    ...base,
    status: 'completed',
    completionVerificationFingerprint: plan.internal.verification.planFingerprint,
    completionReportDigest: plan.internal.verification.reportDigest,
    completionSubjectsFingerprint: plan.internal.verification.subjectsFingerprint,
    completedAt: serverTimestamp,
  };
  if (plan.internal.kind === 'rollback-to-frozen') return {
    ...Object.fromEntries(Object.entries(base).filter(([key]) => ![
      'completionLockFingerprint',
      'completionPlanFingerprint',
      'completionApprovedVerificationFingerprint',
      'finalizationStartedAt',
    ].includes(key))),
    status: 'rollback-frozen',
    rolledBackAt: serverTimestamp,
  };
  return {...base, status: 'aborted', abortedAt: serverTimestamp};
};

const attestationForCompletionLock = ({plan, lock, serverTimestamp}) => ({
  ...plan.internal.attestation,
  status: 'finalizing',
  completionLockFingerprint: lock.lockFingerprint,
  completionPlanFingerprint: plan.report.planFingerprint,
  completionApprovedVerificationFingerprint: plan.internal.verification.planFingerprint,
  finalizationStartedAt: serverTimestamp,
});

const sealedAttestationFromFinalizing = (attestation) => {
  const restored = {...attestation, status: 'sealed'};
  delete restored.completionLockFingerprint;
  delete restored.completionPlanFingerprint;
  delete restored.completionApprovedVerificationFingerprint;
  delete restored.finalizationStartedAt;
  return restored;
};

const configWithoutCompletionLock = (config) => {
  const result = {...config};
  delete result[COMPLETION_LOCK_FIELD];
  return result;
};

const assertCompletionResumeState = ({
  approvedFingerprint,
  approvedReport,
  attestation,
  config,
  request,
}) => {
  assertApprovedPlanReport({approvedReport, approvedFingerprint});
  if (
    approvedReport.action !== 'complete'
    || approvedReport.projectId !== request.projectId
    || approvedReport.scope !== request.scope
    || approvedReport.drainId !== request.drainId
    || approvedReport.verification?.planFingerprint !== request.verificationApprovedFingerprint
    || (request.scope === 'user'
      && approvedReport.subjectHash !== subjectHash(request.projectId, request.userId))
  ) {
    throw new Error('The finalizing transition does not match the exact approved complete request.');
  }
  const scoped = scopedState({
    config,
    scope: request.scope,
    drainId: request.drainId,
    userId: request.userId,
  });
  if (scoped.state !== 'S') throw new Error('Completion resume requires the sealed new-only drain state.');
  const durableAttestation = validateAttestation({
    attestation,
    projectId: request.projectId,
    scope: request.scope,
    drainId: request.drainId,
    userId: request.userId,
    expectedDrain: scoped.drain,
    expectedScopeFingerprint: scoped.fingerprint,
  });
  if (durableAttestation?.status !== 'finalizing') {
    throw new Error('Completion resume requires the durable finalizing attestation.');
  }
  const lock = validateCompletionLock({
    lock: config[COMPLETION_LOCK_FIELD],
    approvedReport,
    projectId: request.projectId,
    scope: request.scope,
    drainId: request.drainId,
    userId: request.userId,
  });
  if (
    durableAttestation.completionLockFingerprint !== lock.lockFingerprint
    || durableAttestation.completionPlanFingerprint !== approvedReport.planFingerprint
    || durableAttestation.completionApprovedVerificationFingerprint
      !== approvedReport.verification.planFingerprint
    || canonicalHash(configWithoutCompletionLock(config)) !== approvedReport.configFingerprint
    || canonicalHash(sealedAttestationFromFinalizing(durableAttestation))
      !== approvedReport.attestationFingerprint
  ) {
    throw new Error('The durable completion lock or attestation changed after approval.');
  }
  const verification = validateVerificationReport({
    report: request.verificationReport,
    approvedFingerprint: request.verificationApprovedFingerprint,
    projectId: request.projectId,
    scope: request.scope,
    drainId: request.drainId,
    userId: request.userId,
    scoped,
  });
  if (
    verification.reportDigest !== approvedReport.verification.reportDigest
    || verification.subjectsFingerprint !== approvedReport.verification.subjectsFingerprint
  ) {
    throw new Error('The approved complete plan is not bound to this exact verification report.');
  }
  return {attestation: durableAttestation, lock, scoped, verification};
};

const assertFreshCompletionVerification = ({approvedVerificationReport, freshReport, request, config}) => {
  const scoped = scopedState({
    config,
    scope: request.scope,
    drainId: request.drainId,
    userId: request.userId,
  });
  const fresh = validateVerificationReport({
    report: freshReport,
    approvedFingerprint: freshReport?.planFingerprint,
    projectId: request.projectId,
    scope: request.scope,
    drainId: request.drainId,
    userId: request.userId,
    scoped,
  });
  if (
    fresh.planFingerprint !== approvedVerificationReport.planFingerprint
    || fresh.subjectsFingerprint !== summarizeVerificationSubjects(approvedVerificationReport.subjects)
  ) {
    throw new Error(
      'Fresh completion verification changed after approval; the sealed drain and completion lock remain installed.'
    );
  }
  return fresh;
};

const runFreshMigrationVerification = (options, {env = process.env} = {}) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'task05-final-verification-'));
  const reportPath = path.join(temporaryDirectory, 'verification.json');
  const argumentsList = [
    path.join(__dirname, 'user-data-migration.js'),
    '--project', options.projectId,
    '--operation', 'verify',
    '--report', reportPath,
    '--drain-scope', options.scope,
    '--drain-id', options.drainId,
  ];
  if (options.scope === 'user') argumentsList.push('--drain-user', options.drainUserId);
  if (options.allowLiveProject) {
    argumentsList.push('--allow-live-project', '--confirm-project', options.confirmProject);
  }
  try {
    const result = childProcess.spawnSync(process.execPath, argumentsList, {
      cwd: path.resolve(__dirname, '..', '..'),
      env,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim().slice(-2000);
      throw new Error(`Fresh completion verification failed.${detail ? ` ${detail}` : ''}`);
    }
    return readJson(reportPath, 'Fresh completion verification report');
  } finally {
    fs.rmSync(temporaryDirectory, {recursive: true, force: true});
  }
};

const createAdminBackend = (projectId) => {
  // Deliberately lazy: parsing and safe-target checks run before Admin SDK is loaded.
  const {deleteApp, initializeApp} = require('firebase-admin/app');
  const {FieldValue, getFirestore} = require('firebase-admin/firestore');
  const app = initializeApp({projectId}, `task05-cutover-${process.pid}-${Date.now()}`);
  const firestore = getFirestore(app);
  const configReference = firestore.doc(CONFIG_PATH);

  const attestationReference = (drainId) => firestore.doc(`${ATTESTATION_COLLECTION_PATH}/${drainId}`);
  const readState = async (drainId) => {
    const [configSnapshot, attestationSnapshot] = await Promise.all([
      configReference.get(),
      attestationReference(drainId).get(),
    ]);
    return {
      config: configSnapshot.exists ? configSnapshot.data() : null,
      attestation: attestationSnapshot.exists ? attestationSnapshot.data() : null,
    };
  };

  const assertNoDeletionConflict = async (transaction, plan) => {
    if (plan.internal.kind === 'none' || plan.report.action === 'abort') return;
    if (plan.report.scope === 'user') {
      const uid = plan.internal.userId;
      const [userSnapshot, jobSnapshot] = await Promise.all([
        transaction.get(firestore.doc(`users/${uid}`)),
        transaction.get(firestore.doc(`user_deletion_jobs/${uid}`)),
      ]);
      if (userSnapshot.get('deletionState') === 'pending') {
        throw new Error('Cutover is blocked by a pending deletion in this exact user scope.');
      }
      if (jobSnapshot.exists && jobSnapshot.get('stage') !== 'completed') {
        throw new Error('Cutover is blocked by an active deletion job in this exact user scope.');
      }
      return;
    }
    const [pendingUsers, deletionJobs] = await Promise.all([
      transaction.get(firestore.collection('users').where('deletionState', '==', 'pending').limit(1)),
      transaction.get(firestore.collection('user_deletion_jobs')),
    ]);
    if (!pendingUsers.empty || deletionJobs.docs.some((document) => document.get('stage') !== 'completed')) {
      throw new Error('Global cutover is blocked by an active user deletion.');
    }
  };

  return {
    close: () => deleteApp(app),
    readState,
    acquireCompletionLock: async ({approvedFingerprint, approvedReport, request}) => firestore.runTransaction(
      async (transaction) => {
        const [configSnapshot, attestationSnapshot] = await Promise.all([
          transaction.get(configReference),
          transaction.get(attestationReference(request.drainId)),
        ]);
        const config = configSnapshot.exists ? configSnapshot.data() : null;
        const attestation = attestationSnapshot.exists ? attestationSnapshot.data() : null;
        if (hasOwn(config || {}, COMPLETION_LOCK_FIELD)) {
          assertCompletionResumeState({
            approvedFingerprint,
            approvedReport,
            attestation,
            config,
            request,
          });
          return {resumed: true};
        }
        const currentPlan = buildCutoverPlan({...request, config, attestation});
        assertApprovedPlan({approvedReport, approvedFingerprint, currentPlan});
        if (currentPlan.internal.kind !== 'complete' || currentPlan.internal.idempotent) {
          throw new Error('A new completion lock requires the exact sealed-to-open transition.');
        }
        await assertNoDeletionConflict(transaction, currentPlan);
        const serverTimestamp = FieldValue.serverTimestamp();
        const lock = completionLockForPlan({plan: currentPlan, serverTimestamp});
        transaction.update(configReference, {[COMPLETION_LOCK_FIELD]: lock});
        transaction.set(
          attestationReference(request.drainId),
          attestationForCompletionLock({plan: currentPlan, lock, serverTimestamp})
        );
        return {resumed: false};
      }
    ),
    finalizeCompletion: async ({
      approvedFingerprint,
      approvedReport,
      freshVerificationReport,
      request,
    }) => firestore.runTransaction(async (transaction) => {
      const [configSnapshot, attestationSnapshot] = await Promise.all([
        transaction.get(configReference),
        transaction.get(attestationReference(request.drainId)),
      ]);
      const config = configSnapshot.exists ? configSnapshot.data() : null;
      const attestation = attestationSnapshot.exists ? attestationSnapshot.data() : null;
      const resumed = assertCompletionResumeState({
        approvedFingerprint,
        approvedReport,
        attestation,
        config,
        request,
      });
      const fresh = assertFreshCompletionVerification({
        approvedVerificationReport: request.verificationReport,
        freshReport: freshVerificationReport,
        request,
        config,
      });
      const baseConfig = configWithoutCompletionLock(config);
      const baseAttestation = sealedAttestationFromFinalizing(attestation);
      const currentPlan = buildCutoverPlan({...request, config: baseConfig, attestation: baseAttestation});
      assertApprovedPlan({approvedReport, approvedFingerprint, currentPlan});
      await assertNoDeletionConflict(transaction, currentPlan);
      const serverTimestamp = FieldValue.serverTimestamp();
      const configPatch = configPatchForPlan({
        config: baseConfig,
        deleteField: FieldValue.delete(),
        plan: currentPlan,
        serverTimestamp,
      });
      configPatch[COMPLETION_LOCK_FIELD] = FieldValue.delete();
      transaction.update(configReference, configPatch);
      transaction.set(attestationReference(request.drainId), {
        ...attestationForPlan({plan: currentPlan, serverTimestamp}),
        finalizationLockFingerprint: resumed.lock.lockFingerprint,
        freshVerificationFingerprint: fresh.planFingerprint,
        freshVerificationReportDigest: canonicalHash(freshVerificationReport),
      });
      return {
        ...currentPlan.report,
        mode: 'execute',
        executed: true,
        freshVerificationFingerprint: fresh.planFingerprint,
      };
    }),
    execute: async ({approvedFingerprint, approvedReport, request}) => firestore.runTransaction(async (transaction) => {
      const [configSnapshot, attestationSnapshot] = await Promise.all([
        transaction.get(configReference),
        transaction.get(attestationReference(request.drainId)),
      ]);
      const currentPlan = buildCutoverPlan({
        ...request,
        config: configSnapshot.exists ? configSnapshot.data() : null,
        attestation: attestationSnapshot.exists ? attestationSnapshot.data() : null,
      });
      // Keep the raw user ID exclusively in transaction memory.
      currentPlan.internal.userId = request.userId;
      assertApprovedPlan({approvedReport, approvedFingerprint, currentPlan});
      await assertNoDeletionConflict(transaction, currentPlan);
      if (!currentPlan.internal.idempotent) {
        const serverTimestamp = FieldValue.serverTimestamp();
        const configPatch = configPatchForPlan({
          config: configSnapshot.data(),
          deleteField: FieldValue.delete(),
          plan: currentPlan,
          serverTimestamp,
        });
        transaction.update(configReference, configPatch);
        transaction.set(
          attestationReference(request.drainId),
          attestationForPlan({plan: currentPlan, serverTimestamp})
        );
      }
      return {
        ...currentPlan.report,
        mode: 'execute',
        executed: !currentPlan.internal.idempotent,
      };
    }),
  };
};

const runCutover = async (options, {
  backendFactory = createAdminBackend,
  env = process.env,
  freshVerifier = runFreshMigrationVerification,
  generatedAt = () => new Date().toISOString(),
} = {}) => {
  assertSafeTarget(options, env);
  const verificationReport = options.verificationReportPath
    ? readJson(options.verificationReportPath, 'Verification report')
    : null;
  const approvedReport = options.execute
    ? readJson(options.reportPath, 'Approved cutover plan')
    : null;
  const backend = backendFactory(options.projectId);
  try {
    const state = await backend.readState(options.drainId);
    const request = {
      action: options.action,
      projectId: options.projectId,
      scope: options.scope,
      drainId: options.drainId,
      userId: options.drainUserId,
      verificationApprovedFingerprint: options.approveVerificationFingerprint,
      verificationReport,
      generatedAt: generatedAt(),
    };
    const resumingCompletion = (
      options.execute
      && options.action === 'complete'
      && state.attestation?.status === 'finalizing'
      && hasOwn(state.config || {}, COMPLETION_LOCK_FIELD)
    );
    const plan = resumingCompletion ? null : buildCutoverPlan({...request, ...state});
    if (!options.execute) {
      writeJsonAtomic(options.reportPath, plan.report);
      return plan.report;
    }
    if (resumingCompletion) {
      assertApprovedPlanReport({approvedReport, approvedFingerprint: options.approveFingerprint});
    } else {
      assertApprovedPlan({
        approvedReport,
        approvedFingerprint: options.approveFingerprint,
        currentPlan: plan,
      });
    }
    let result;
    if (options.action === 'complete' && (resumingCompletion || !plan.internal.idempotent)) {
      await backend.acquireCompletionLock({
        approvedFingerprint: options.approveFingerprint,
        approvedReport,
        request,
      });
      const lockedState = await backend.readState(options.drainId);
      assertCompletionResumeState({
        approvedFingerprint: options.approveFingerprint,
        approvedReport,
        ...lockedState,
        request,
      });
      const freshVerificationReport = await freshVerifier(options, {env});
      assertFreshCompletionVerification({
        approvedVerificationReport: verificationReport,
        freshReport: freshVerificationReport,
        request,
        config: lockedState.config,
      });
      result = await backend.finalizeCompletion({
        approvedFingerprint: options.approveFingerprint,
        approvedReport,
        freshVerificationReport,
        request,
      });
    } else {
      result = await backend.execute({
        approvedFingerprint: options.approveFingerprint,
        approvedReport,
        request,
      });
    }
    writeJsonAtomic(options.resultPath, result);
    return result;
  } finally {
    await backend.close();
  }
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await runCutover(options);
  console.log(JSON.stringify({
    action: report.action,
    executed: report.executed === true,
    idempotent: report.idempotent,
    mode: report.mode,
    planFingerprint: report.planFingerprint,
    projectId: report.projectId,
    scope: report.scope,
    stateAfter: report.stateAfter,
    stateBefore: report.stateBefore,
  }, null, 2));
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  ACTIONS,
  CUTOVER_SCHEMA_VERSION,
  DRAIN_ID_PATTERN,
  assertApprovedPlan,
  assertCompletionResumeState,
  assertFreshCompletionVerification,
  assertSafeTarget,
  attestationForCompletionLock,
  attestationForPlan,
  buildCutoverPlan,
  completionLockForPlan,
  configPatchForPlan,
  createAdminBackend,
  parseArguments,
  runFreshMigrationVerification,
  runCutover,
  scopeFingerprint,
  subjectHash,
  validateRolloutConfig,
  validateVerificationReport,
};
