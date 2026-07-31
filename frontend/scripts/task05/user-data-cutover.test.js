const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {canonicalHash} = require('./user-data-model');
const {
  assertApprovedPlan,
  assertSafeTarget,
  attestationForCompletionLock,
  attestationForPlan,
  buildCutoverPlan,
  completionLockForPlan,
  configPatchForPlan,
  parseArguments,
  runCutover,
  scopeFingerprint,
  subjectHash,
  validateRolloutConfig,
} = require('./user-data-cutover');
const {
  assertMigrationWritesUnlocked,
  assertSafeTarget: assertMigrationSafeTarget,
} = require('./user-data-migration');

const PROJECT_ID = 'demo-task05-cutover';
const DRAIN_ID = 'drain_test_0001';
const USER_ID = 'raw-user-id@example.com';
const CLOSED_AT = {seconds: 1234, nanoseconds: 5678};
const HASH = (label) => canonicalHash({label});

const makeConfig = ({scope = 'global', stage = 'new-read-dual-write', drain = false} = {}) => ({
  mode: scope === 'global' ? stage : 'new-read-dual-write',
  userOverrides: scope === 'user' ? {[USER_ID]: stage} : {},
  legacyDrain: {
    ...(scope === 'global' && drain ? {global: {drainId: DRAIN_ID, closedAt: CLOSED_AT}} : {}),
    users: scope === 'user' && drain
      ? {[USER_ID]: {drainId: DRAIN_ID, closedAt: CLOSED_AT}}
      : {},
  },
});

const fingerprintFor = (config, scope) => {
  const validated = validateRolloutConfig(config);
  return scopeFingerprint({
    scope,
    globalStage: validated.globalStage,
    overrides: validated.overrides,
    userId: scope === 'user' ? USER_ID : '',
  });
};

const makeAttestation = ({
  config,
  scope = 'global',
  status = 'frozen',
  sealed = false,
} = {}) => ({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  scope,
  drainId: DRAIN_ID,
  scopeFingerprint: fingerprintFor(config, scope),
  originalStage: 'new-read-dual-write',
  status,
  closedAt: CLOSED_AT,
  openedAt: CLOSED_AT,
  ...(scope === 'user' ? {subjectHash: subjectHash(PROJECT_ID, USER_ID)} : {}),
  ...(sealed ? {
    sealVerificationFingerprint: HASH('seal-plan'),
    sealReportDigest: HASH('seal-report'),
    sealSubjectsFingerprint: HASH('seal-subjects'),
  } : {}),
});

const makeVerification = ({config, scope = 'global'} = {}) => {
  const stage = scope === 'global' ? config.mode : config.userOverrides[USER_ID];
  const planFingerprint = HASH(`verification-${scope}-${stage}`);
  const subject = {
    subjectHash: scope === 'user' ? subjectHash(PROJECT_ID, USER_ID) : HASH('global-subject'),
    sourceHash: HASH('source'),
    sourceVersionHash: HASH('source-version'),
    legacyProjectionHash: HASH('legacy-projection'),
    targetHash: HASH('target'),
    currentHash: HASH('target'),
    cleanupFingerprint: HASH('cleanup'),
    counts: {documents: 6},
    issues: {errors: 0, warnings: 0},
  };
  return {
    schemaVersion: 2,
    modelVersion: 2,
    mode: 'dry-run',
    operation: 'verify',
    projectId: PROJECT_ID,
    drain: {
      scope,
      drainId: DRAIN_ID,
      closedAt: CLOSED_AT,
      rolloutStage: stage,
      scopeFingerprint: fingerprintFor(config, scope),
      ...(scope === 'user' ? {subjectHash: subjectHash(PROJECT_ID, USER_ID)} : {}),
    },
    drainEvidence: {
      deletionConflicts: 0,
      deletionJobFingerprint: HASH('no-deletions'),
      codes: [],
    },
    complete: true,
    generatedAt: '2026-07-23T00:00:00.000Z',
    planFingerprint,
    counts: {
      users: 1,
      writesRequired: 0,
      unchanged: 1,
      errors: 0,
      warnings: 0,
      cleanupDocuments: 0,
      deletionConflicts: 0,
    },
    subjects: [subject],
  };
};

const makePlan = ({
  action,
  config,
  scope = 'global',
  attestation = null,
  verificationReport = null,
} = {}) => buildCutoverPlan({
  action,
  attestation,
  config,
  drainId: DRAIN_ID,
  generatedAt: '2026-07-23T01:00:00.000Z',
  projectId: PROJECT_ID,
  scope,
  userId: scope === 'user' ? USER_ID : '',
  verificationApprovedFingerprint: verificationReport?.planFingerprint || '',
  verificationReport,
});

test('parseArguments defaults to dry-run and requires exact user scope', () => {
  const options = parseArguments([
    '--project', PROJECT_ID,
    '--action', 'open',
    '--scope', 'user',
    '--drain-id', DRAIN_ID,
    '--drain-user', USER_ID,
  ]);
  assert.equal(options.execute, false);
  assert.match(options.reportPath, /performance-results/);
  assert.throws(() => parseArguments([
    '--project', PROJECT_ID,
    '--action', 'open',
    '--scope', 'global',
    '--drain-id', DRAIN_ID,
    '--drain-user', USER_ID,
  ]), /only valid with --scope user/);
});

test('seal parsing requires both a verification report and its exact approval', () => {
  assert.throws(() => parseArguments([
    '--project', PROJECT_ID,
    '--action', 'seal',
    '--scope', 'global',
    '--drain-id', DRAIN_ID,
  ]), /requires --verification-report/);
  assert.throws(() => parseArguments([
    '--project', PROJECT_ID,
    '--action', 'seal',
    '--scope', 'global',
    '--drain-id', DRAIN_ID,
    '--verification-report', 'verification.json',
  ]), /requires an exact --approve-verification-fingerprint/);
});

test('safe target accepts only loopback demo emulators without live confirmation', () => {
  assert.deepEqual(
    assertSafeTarget(
      {projectId: PROJECT_ID, allowLiveProject: false, confirmProject: ''},
      {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}
    ),
    {live: false, emulatorHost: '127.0.0.1:8080', projectId: PROJECT_ID}
  );
  assert.throws(() => assertSafeTarget(
    {projectId: 'production', allowLiveProject: false, confirmProject: ''},
    {}
  ), /Live Firestore access is refused/);
  assert.throws(() => assertSafeTarget(
    {projectId: PROJECT_ID, allowLiveProject: false, confirmProject: ''},
    {FIRESTORE_EMULATOR_HOST: '192.168.1.2:8080'}
  ), /Non-loopback/);
});

test('open deterministically plans A to F without exposing a raw user ID', () => {
  const config = makeConfig({scope: 'user'});
  const first = makePlan({action: 'open', config, scope: 'user'});
  const second = buildCutoverPlan({
    action: 'open',
    config,
    drainId: DRAIN_ID,
    generatedAt: '2030-01-01T00:00:00.000Z',
    projectId: PROJECT_ID,
    scope: 'user',
    userId: USER_ID,
  });
  assert.equal(first.report.stateBefore, 'A');
  assert.equal(first.report.stateAfter, 'F');
  assert.equal(first.report.planFingerprint, second.report.planFingerprint);
  assert.equal(JSON.stringify(first.report).includes(USER_ID), false);

  const serverTimestamp = {serverTimestamp: true};
  const patch = configPatchForPlan({config, plan: first, serverTimestamp});
  assert.deepEqual(patch.legacyDrain.users[USER_ID], {drainId: DRAIN_ID, closedAt: serverTimestamp});
  const attestation = attestationForPlan({plan: first, serverTimestamp});
  assert.equal(attestation.status, 'frozen');
  assert.equal(attestation.subjectHash, subjectHash(PROJECT_ID, USER_ID));
  assert.equal(Object.prototype.hasOwnProperty.call(attestation, 'userId'), false);
});

test('open refuses drain identifier reuse after a durable tombstone', () => {
  const config = makeConfig();
  const aborted = makeAttestation({config, status: 'aborted'});
  assert.throws(() => makePlan({action: 'open', config, attestation: aborted}), /already durably tombstoned/);
});

test('seal accepts only a clean verification bound to F and plans F to S', () => {
  const config = makeConfig({drain: true});
  const attestation = makeAttestation({config});
  const verification = makeVerification({config});
  const plan = makePlan({action: 'seal', config, attestation, verificationReport: verification});
  assert.equal(plan.report.stateBefore, 'F');
  assert.equal(plan.report.stateAfter, 'S');
  assert.equal(plan.report.verification.planFingerprint, verification.planFingerprint);
  assert.equal(configPatchForPlan({config, plan, serverTimestamp: {}}).mode, 'new-only');
  const sealed = attestationForPlan({plan, serverTimestamp: {seconds: 2, nanoseconds: 0}});
  assert.equal(sealed.status, 'sealed');
  assert.equal(sealed.scopeFingerprint, plan.report.scopeFingerprintAfter);
});

test('seal rejects stale cutoffs, verification writes, and deletion conflicts', () => {
  const config = makeConfig({drain: true});
  const attestation = makeAttestation({config});
  const stale = makeVerification({config});
  stale.drain.closedAt = {seconds: 1235, nanoseconds: 0};
  assert.throws(() => makePlan({action: 'seal', config, attestation, verificationReport: stale}), /exact drain fence/);

  const dirty = makeVerification({config});
  dirty.counts.writesRequired = 1;
  assert.throws(() => makePlan({action: 'seal', config, attestation, verificationReport: dirty}), /clean, read-only/);

  const deleting = makeVerification({config});
  deleting.drainEvidence.deletionConflicts = 1;
  assert.throws(() => makePlan({action: 'seal', config, attestation, verificationReport: deleting}), /deletion conflict/);
});

test('complete requires sealed evidence, plans S to O, and removes only the exact drain', () => {
  const config = makeConfig({stage: 'new-only', drain: true});
  const attestation = makeAttestation({config, status: 'sealed', sealed: true});
  const verification = makeVerification({config});
  const plan = makePlan({action: 'complete', config, attestation, verificationReport: verification});
  assert.equal(plan.report.stateBefore, 'S');
  assert.equal(plan.report.stateAfter, 'O');
  const patch = configPatchForPlan({config, plan, serverTimestamp: {}});
  assert.equal(Object.prototype.hasOwnProperty.call(patch.legacyDrain, 'global'), false);
  assert.deepEqual(patch.legacyDrain.users, {});
  const completed = attestationForPlan({plan, serverTimestamp: {seconds: 3, nanoseconds: 0}});
  assert.equal(completed.status, 'completed');
  assert.equal(completed.completionVerificationFingerprint, verification.planFingerprint);
});

test('complete rejects a sealed state without prior durable verification fields', () => {
  const config = makeConfig({stage: 'new-only', drain: true});
  const attestation = makeAttestation({config, status: 'sealed'});
  const verification = makeVerification({config});
  assert.throws(
    () => makePlan({action: 'complete', config, attestation, verificationReport: verification}),
    /prior durable sealed verification/
  );
});

test('completion lock blocks sanctioned migration writes and live unfenced reverse activation', () => {
  assert.equal(assertMigrationWritesUnlocked(makeConfig()), true);
  assert.throws(
    () => assertMigrationWritesUnlocked({...makeConfig(), userDataCompletionLock: {}}),
    /blocked by the server-owned user-data completion lock/
  );
  assert.throws(() => assertMigrationSafeTarget({
    projectId: 'production-project',
    allowLiveProject: true,
    confirmProject: 'production-project',
    execute: true,
    operation: 'reverse',
    drain: null,
  }, {}), /Live archive\/reverse execution is blocked/);
});

test('complete retains the sealed lock and refuses finalization when fresh verification is stale', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'task05-stale-complete-'));
  t.after(() => fs.rmSync(temporaryDirectory, {recursive: true, force: true}));
  const verificationPath = path.join(temporaryDirectory, 'verification.json');
  const planPath = path.join(temporaryDirectory, 'cutover-plan.json');
  const resultPath = path.join(temporaryDirectory, 'result.json');
  const config = makeConfig({stage: 'new-only', drain: true});
  const attestation = makeAttestation({config, status: 'sealed', sealed: true});
  const verification = makeVerification({config});
  const approvedPlan = makePlan({
    action: 'complete',
    config,
    attestation,
    verificationReport: verification,
  });
  fs.writeFileSync(verificationPath, `${JSON.stringify(verification)}\n`, 'utf8');
  fs.writeFileSync(planPath, `${JSON.stringify(approvedPlan.report)}\n`, 'utf8');

  let state = {config, attestation};
  let finalized = false;
  const events = [];
  const backend = {
    close: async () => {},
    readState: async () => state,
    acquireCompletionLock: async () => {
      events.push('lock');
      const lockedAt = {seconds: 4000, nanoseconds: 0};
      const lock = completionLockForPlan({plan: approvedPlan, serverTimestamp: lockedAt});
      state = {
        config: {...config, userDataCompletionLock: lock},
        attestation: attestationForCompletionLock({
          plan: approvedPlan,
          lock,
          serverTimestamp: lockedAt,
        }),
      };
    },
    finalizeCompletion: async () => {
      events.push('finalize');
      finalized = true;
      throw new Error('finalization must not be reached');
    },
  };
  const staleVerification = {
    ...verification,
    planFingerprint: HASH('verification-changed-after-approval'),
    subjects: verification.subjects.map((entry) => ({
      ...entry,
      sourceHash: HASH('source-changed-after-approval'),
      sourceVersionHash: HASH('source-version-changed-after-approval'),
    })),
  };
  const options = parseArguments([
    '--project', PROJECT_ID,
    '--action', 'complete',
    '--scope', 'global',
    '--drain-id', DRAIN_ID,
    '--verification-report', verificationPath,
    '--approve-verification-fingerprint', verification.planFingerprint,
    '--report', planPath,
    '--result', resultPath,
    '--execute',
    '--approve-fingerprint', approvedPlan.report.planFingerprint,
  ]);
  await assert.rejects(() => runCutover(options, {
    backendFactory: () => backend,
    env: {FIRESTORE_EMULATOR_HOST: 'localhost:8080'},
    freshVerifier: async () => {
      events.push('fresh-verify');
      return staleVerification;
    },
    generatedAt: () => '2026-07-23T03:00:00.000Z',
  }), /Fresh completion verification changed after approval/);
  assert.equal(finalized, false);
  assert.equal(state.attestation.status, 'finalizing');
  assert.equal(state.config.userDataCompletionLock.drainId, DRAIN_ID);
  assert.equal(fs.existsSync(resultPath), false);
  assert.deepEqual(events, ['lock', 'fresh-verify']);
});

test('seal and complete can be safely re-planned after an acknowledged response is lost', () => {
  const frozenConfig = makeConfig({drain: true});
  const frozenAttestation = makeAttestation({config: frozenConfig});
  const sealVerification = makeVerification({config: frozenConfig});
  const sealPlan = makePlan({
    action: 'seal',
    config: frozenConfig,
    attestation: frozenAttestation,
    verificationReport: sealVerification,
  });
  const sealedConfig = makeConfig({stage: 'new-only', drain: true});
  const sealedAttestation = attestationForPlan({
    plan: sealPlan,
    serverTimestamp: {seconds: 2000, nanoseconds: 0},
  });
  const repeatedSeal = makePlan({
    action: 'seal',
    config: sealedConfig,
    attestation: sealedAttestation,
    verificationReport: sealVerification,
  });
  assert.equal(repeatedSeal.report.idempotent, true);
  assert.deepEqual(repeatedSeal.report.mutations, []);

  const completionVerification = makeVerification({config: sealedConfig});
  const completionPlan = makePlan({
    action: 'complete',
    config: sealedConfig,
    attestation: sealedAttestation,
    verificationReport: completionVerification,
  });
  const completedAttestation = attestationForPlan({
    plan: completionPlan,
    serverTimestamp: {seconds: 3000, nanoseconds: 0},
  });
  const openConfig = makeConfig({stage: 'new-only', drain: false});
  const repeatedComplete = makePlan({
    action: 'complete',
    config: openConfig,
    attestation: completedAttestation,
    verificationReport: completionVerification,
  });
  assert.equal(repeatedComplete.report.idempotent, true);
  assert.deepEqual(repeatedComplete.report.mutations, []);
});

test('abort from S returns to F while retaining the drain', () => {
  const config = makeConfig({stage: 'new-only', drain: true});
  const attestation = makeAttestation({config, status: 'sealed', sealed: true});
  const plan = makePlan({action: 'abort', config, attestation});
  assert.equal(plan.report.stateAfter, 'F');
  assert.deepEqual(plan.report.mutations, ['restore-scope-new-read-dual-write', 'retain-exact-drain']);
  const patch = configPatchForPlan({config, plan, serverTimestamp: {}});
  assert.equal(patch.mode, 'new-read-dual-write');
  assert.equal(patch.legacyDrain, undefined);
  const rolledBack = attestationForPlan({plan, serverTimestamp: {seconds: 4, nanoseconds: 0}});
  assert.equal(rolledBack.status, 'rollback-frozen');
  assert.equal(rolledBack.scopeFingerprint, plan.report.scopeFingerprintAfter);
});

test('abort recovers a failed finalization by removing only its exact completion lock', () => {
  const config = makeConfig({stage: 'new-only', drain: true});
  const attestation = makeAttestation({config, status: 'sealed', sealed: true});
  const verification = makeVerification({config});
  const completePlan = makePlan({
    action: 'complete',
    config,
    attestation,
    verificationReport: verification,
  });
  const lockedAt = {seconds: 5000, nanoseconds: 0};
  const lock = completionLockForPlan({plan: completePlan, serverTimestamp: lockedAt});
  const lockedConfig = {...config, userDataCompletionLock: lock};
  const finalizing = attestationForCompletionLock({
    plan: completePlan,
    lock,
    serverTimestamp: lockedAt,
  });
  const abortPlan = makePlan({action: 'abort', config: lockedConfig, attestation: finalizing});
  const deleteField = {deleteField: true};
  const patch = configPatchForPlan({
    config: lockedConfig,
    deleteField,
    plan: abortPlan,
    serverTimestamp: {seconds: 5001, nanoseconds: 0},
  });
  assert.equal(patch.mode, 'new-read-dual-write');
  assert.equal(patch.userDataCompletionLock, deleteField);
  assert.equal(patch.legacyDrain, undefined);
  const rolledBack = attestationForPlan({
    plan: abortPlan,
    serverTimestamp: {seconds: 5001, nanoseconds: 0},
  });
  assert.equal(rolledBack.status, 'rollback-frozen');
  assert.equal(Object.prototype.hasOwnProperty.call(rolledBack, 'completionLockFingerprint'), false);
});

test('a second abort from F removes the drain and tombstones the transition', () => {
  const config = makeConfig({drain: true});
  const attestation = makeAttestation({config, status: 'rollback-frozen', sealed: true});
  const plan = makePlan({action: 'abort', config, attestation});
  assert.equal(plan.report.stateAfter, 'A');
  const patch = configPatchForPlan({config, plan, serverTimestamp: {}});
  assert.equal(Object.prototype.hasOwnProperty.call(patch.legacyDrain, 'global'), false);
  assert.equal(attestationForPlan({plan, serverTimestamp: {}}).status, 'aborted');
});

test('approved plan validation rejects report tampering and stale state', () => {
  const config = makeConfig();
  const plan = makePlan({action: 'open', config});
  assert.equal(assertApprovedPlan({
    approvedReport: plan.report,
    approvedFingerprint: plan.report.planFingerprint,
    currentPlan: plan,
  }), true);
  const tampered = {...plan.report, stateAfter: 'O'};
  assert.throws(() => assertApprovedPlan({
    approvedReport: tampered,
    approvedFingerprint: plan.report.planFingerprint,
    currentPlan: plan,
  }), /exact current reviewed/);

  const changedConfig = {...config, unrelatedConfigRevision: 2};
  const changedPlan = makePlan({action: 'open', config: changedConfig});
  assert.throws(() => assertApprovedPlan({
    approvedReport: plan.report,
    approvedFingerprint: plan.report.planFingerprint,
    currentPlan: changedPlan,
  }), /exact current reviewed/);
});

test('config validation rejects conflicting stage aliases and mismatched drain IDs', () => {
  assert.throws(() => makePlan({
    action: 'open',
    config: {...makeConfig(), stage: 'new-only'},
  }), /conflicting mode and stage/);
  assert.throws(() => makePlan({
    action: 'seal',
    config: {
      ...makeConfig({drain: true}),
      legacyDrain: {users: {}, global: {drainId: 'another_drain_01', closedAt: CLOSED_AT}},
    },
  }), /does not match/);
});

test('runCutover dry-run uses an injected backend and writes only the redacted plan', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'task05-cutover-'));
  t.after(() => fs.rmSync(temporaryDirectory, {recursive: true, force: true}));
  const reportPath = path.join(temporaryDirectory, 'plan.json');
  let closed = false;
  const result = await runCutover({
    action: 'open',
    allowLiveProject: false,
    approveFingerprint: '',
    approveVerificationFingerprint: '',
    confirmProject: '',
    drainId: DRAIN_ID,
    drainUserId: USER_ID,
    execute: false,
    projectId: PROJECT_ID,
    reportPath,
    resultPath: path.join(temporaryDirectory, 'result.json'),
    scope: 'user',
    verificationReportPath: '',
  }, {
    backendFactory: () => ({
      close: async () => { closed = true; },
      readState: async () => ({config: makeConfig({scope: 'user'}), attestation: null}),
    }),
    env: {FIRESTORE_EMULATOR_HOST: 'localhost:8080'},
    generatedAt: () => '2026-07-23T02:00:00.000Z',
  });
  assert.equal(closed, true);
  assert.equal(result.mode, 'dry-run');
  const written = fs.readFileSync(reportPath, 'utf8');
  assert.equal(written.includes(USER_ID), false);
  assert.equal(JSON.parse(written).planFingerprint, result.planFingerprint);
});
