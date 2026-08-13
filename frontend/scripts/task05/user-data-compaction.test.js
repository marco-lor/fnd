'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  LEGACY_ROOT_FIELDS,
  approvalCore,
  assertApprovedReport,
  assertCheckpoint,
  assertSafeTarget,
  buildCompactionArchiveDocuments,
  buildCompactionPlan,
  compactedShellData,
  configIssues,
  executeCompactionPlan,
  hashDocumentSet,
  legacyRootData,
  parseArguments,
  parseCompactionArchive,
  summarizeVerificationSubjects,
  validateCompletedCutoverEvidence,
  v2StructureIssues,
} = require('./user-data-compaction');
const {canonicalHash} = require('./user-data-model');
const {scopeFingerprint} = require('./user-data-cutover');
const reportSchema = require('./user-data-compaction-report.schema.json');

const PROJECT = 'fatins';
const UID = 'private-user-id';
const CUTOVER_ID = 'completed-cutover-0001';
const ARCHIVE_PATH = `migration_state/user-data-v2/root_compaction_archives/${UID}`;
const CLOSED_AT = {seconds: 1234, nanoseconds: 5678};
const HASH = (label) => canonicalHash({label});
const CLI_EVIDENCE = [
  '--cutover-id', CUTOVER_ID,
  '--cutover-verification-report', 'verification.json',
];

const cleanCutover = (verifiedUid = UID) => {
  const subject = {
    subjectHash: canonicalHash({projectId: PROJECT, uid: verifiedUid}),
    sourceHash: HASH(`source-${verifiedUid}`),
    sourceVersionHash: HASH(`source-version-${verifiedUid}`),
    legacyProjectionHash: HASH(`legacy-${verifiedUid}`),
    targetHash: HASH(`target-${verifiedUid}`),
    currentHash: HASH(`target-${verifiedUid}`),
    cleanupFingerprint: HASH(`cleanup-${verifiedUid}`),
    issues: {errors: 0, warnings: 0, codes: []},
  };
  const expectedScopeFingerprint = scopeFingerprint({
    scope: 'global',
    globalStage: 'new-only',
    overrides: new Map(),
  });
  const verificationReport = {
    schemaVersion: 2,
    modelVersion: 2,
    mode: 'dry-run',
    operation: 'verify',
    projectId: PROJECT,
    complete: true,
    generatedAt: '2026-08-01T00:00:00.000Z',
    planFingerprint: HASH(`verification-${verifiedUid}`),
    drain: {
      scope: 'global',
      drainId: CUTOVER_ID,
      closedAt: CLOSED_AT,
      rolloutStage: 'new-only',
      scopeFingerprint: expectedScopeFingerprint,
    },
    drainEvidence: {deletionConflicts: 0, deletionJobFingerprint: HASH('jobs'), codes: []},
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
  const attestation = {
    schemaVersion: 1,
    projectId: PROJECT,
    scope: 'global',
    drainId: CUTOVER_ID,
    status: 'completed',
    originalStage: 'new-read-dual-write',
    scopeFingerprint: expectedScopeFingerprint,
    closedAt: CLOSED_AT,
    completedAt: {seconds: 2345, nanoseconds: 0},
    sealVerificationFingerprint: HASH('seal-verification'),
    sealReportDigest: HASH('seal-report'),
    sealSubjectsFingerprint: HASH('seal-subjects'),
    completionVerificationFingerprint: verificationReport.planFingerprint,
    completionReportDigest: canonicalHash(verificationReport),
    completionSubjectsFingerprint: summarizeVerificationSubjects(verificationReport.subjects),
  };
  return {attestation, verificationReport};
};

const cleanConfig = () => ({
  mode: 'new-only',
  userOverrides: {},
  legacyDrain: {},
});

const rootData = () => ({
  modelVersion: 2,
  email: 'private@example.test',
  role: 'player',
  characterId: 'Private Character',
  flags: {characterCreationDone: true},
  summary: {level: 4},
  media: {assetId: 'm_0000000000000000000000000000000000000000'},
  stats: {level: 4, gold: 12, hpCurrent: 8},
  Parametri: {Base: {Forza: {Base: 2}}},
  AltriParametri: {Anima_1: 'Astuzia'},
  inventory: [{id: 'item-1', name: 'Private Item'}],
  equipped: {mainHand: null},
  spells: {PrivateSpell: {name: 'PrivateSpell'}},
  tecniche: {},
  lingue: {Comune: true},
  conoscenze: {},
  professioni: {},
  active_turn_effect: null,
  settings: {lock_param_base: true},
});

const emptyArchive = () => ({
  marker: {exists: false, path: ARCHIVE_PATH},
  fields: [],
});

const archiveSnapshot = (documents) => {
  const marker = documents.find(({path}) => path === ARCHIVE_PATH);
  const fields = documents.filter(({path}) => path.includes('/root_fields/'));
  return {
    marker: {exists: true, path: marker.path, data: marker.data},
    fields: fields.map((document) => ({exists: true, path: document.path, data: document.data})),
  };
};

const bundle = (root = rootData(), archive = emptyArchive()) => ({
  root: {exists: true, data: root},
  states: Object.fromEntries([
    'progression',
    'resources',
    'settings',
    'equipment',
    'profileContent',
  ].map((stateId) => [stateId, {exists: true, data: {schemaVersion: 2}}])),
  collections: Object.fromEntries([
    'inventory',
    'spells',
    'tecniche',
    'content_names',
  ].map((collectionId) => [collectionId, [{data: {schemaVersion: 2}}]])),
  archive,
  deletionJob: {exists: false},
});

const fakeBackend = ({config = cleanConfig(), cutover = cleanCutover(), userBundle = bundle()} = {}) => ({
  readConfig: async () => ({exists: true, data: config}),
  readCutoverAttestation: async () => ({exists: true, data: cutover.attestation}),
  listUsers: async () => [{id: UID}],
  readUserBundle: async () => userBundle,
});

const buildPlan = (options = {}) => buildCompactionPlan({
  cutoverId: CUTOVER_ID,
  cutoverVerificationReport: cleanCutover().verificationReport,
  ...options,
});

test('argument parsing defaults to a dry-run and requires exact execution approval', () => {
  const options = parseArguments(['--project', PROJECT, ...CLI_EVIDENCE]);
  assert.equal(options.execute, false);
  assert.match(options.reportPath, /task05-compaction-plan\.json$/);
  assert.throws(() => parseArguments([]), /Explicit --project/);
  assert.throws(
    () => parseArguments(['--project', PROJECT]),
    /--cutover-id and --cutover-verification-report/
  );
  assert.throws(
    () => parseArguments(['--project', PROJECT, ...CLI_EVIDENCE, '--execute']),
    /requires --approved-report/
  );
  assert.throws(
    () => parseArguments(['--project', PROJECT, ...CLI_EVIDENCE, '--verify', '--execute']),
    /cannot be combined/
  );
  const execute = parseArguments([
    '--project', PROJECT,
    ...CLI_EVIDENCE,
    '--execute',
    '--approved-report', 'plan.json',
    '--approve-fingerprint', 'a'.repeat(64),
  ]);
  assert.equal(execute.execute, true);
  assert.equal(execute.approveFingerprint, 'a'.repeat(64));
});

test('target safety accepts only loopback demo emulators or the exact live binding', () => {
  const base = {
    projectId: PROJECT,
    allowLiveProject: true,
    confirmProject: PROJECT,
    authMode: 'firebase-cli',
  };
  assert.deepEqual(assertSafeTarget(base, {}), {live: true});
  assert.throws(
    () => assertSafeTarget({...base, confirmProject: 'other'}, {}),
    /hard-locked/
  );
  assert.deepEqual(assertSafeTarget(
    {...base, projectId: 'demo-compaction', allowLiveProject: false, confirmProject: '', authMode: 'admin'},
    {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}
  ), {live: false});
  assert.throws(
    () => assertSafeTarget(base, {FIRESTORE_EMULATOR_HOST: 'remote.test:8080'}),
    /loopback/
  );
  assert.throws(
    () => assertSafeTarget(base, {FIRESTORE_EMULATOR_HOST: 'https://127.0.0.1:8080'}),
    /valid host:port/
  );
});

test('configuration gate requires clean global new-only without overrides, drains, or locks', () => {
  assert.deepEqual(configIssues(cleanConfig()), []);
  const withoutDrain = cleanConfig();
  delete withoutDrain.legacyDrain;
  assert.deepEqual(configIssues(withoutDrain), []);
  const withoutOverrides = cleanConfig();
  delete withoutOverrides.userOverrides;
  assert.deepEqual(configIssues(withoutOverrides), []);
  assert.ok(configIssues({...cleanConfig(), mode: 'new-read-dual-write'})
    .some(({code}) => code === 'rollout-not-new-only'));
  assert.ok(configIssues({...cleanConfig(), userOverrides: {private: 'new-only'}})
    .some(({code}) => code === 'rollout-user-overrides-present'));
  assert.ok(configIssues({...cleanConfig(), legacyDrain: {global: {drainId: 'active'}}})
    .some(({code}) => code === 'rollout-global-drain-present'));
  assert.ok(configIssues({...cleanConfig(), legacyDrain: {unexpected: true}})
    .some(({code}) => code === 'rollout-drain-unsupported-field'));
  assert.ok(configIssues({...cleanConfig(), userDataCompletionLock: {}})
    .some(({code}) => code === 'rollout-completion-lock-present'));
});

test('legacy allowlist removes only migrated domains and keeps the profile shell', () => {
  const root = rootData();
  const legacy = legacyRootData(root);
  const shell = compactedShellData(root);
  assert.deepEqual(Object.keys(legacy).sort(), [
    'AltriParametri',
    'Parametri',
    'active_turn_effect',
    'conoscenze',
    'equipped',
    'inventory',
    'lingue',
    'professioni',
    'settings',
    'spells',
    'stats',
    'tecniche',
  ]);
  assert.equal(shell.email, root.email);
  assert.deepEqual(shell.flags, root.flags);
  assert.deepEqual(shell.media, root.media);
  assert.equal(shell.stats, undefined);
  assert.ok(!LEGACY_ROOT_FIELDS.includes('flags'));
});

test('archive partitions every original root field and reconstructs exact private data', () => {
  const root = rootData();
  const archive = buildCompactionArchiveDocuments(UID, root);
  assert.equal(archive.oversized.length, 0);
  assert.equal(archive.documents.length, Object.keys(root).length + 1);
  const parsed = parseCompactionArchive(UID, archiveSnapshot(archive.documents));
  assert.equal(parsed.exists, true);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.root, root);
  assert.equal(parsed.marker.sourceHash, canonicalHash(root));
  assert.equal(hashDocumentSet(parsed.documents), hashDocumentSet(archive.documents));
});

test('archive validation fails closed on orphaned or tampered field documents', () => {
  const archive = buildCompactionArchiveDocuments(UID, rootData());
  const orphan = emptyArchive();
  orphan.fields = archiveSnapshot(archive.documents).fields;
  assert.ok(parseCompactionArchive(UID, orphan).issues
    .some(({code}) => code === 'compaction-archive-marker-missing'));

  const tampered = archiveSnapshot(archive.documents);
  tampered.fields[0].data.value = 'tampered';
  assert.ok(parseCompactionArchive(UID, tampered).issues.length > 0);
});

test('V2 structure gate rejects missing state, wrong schema, and active deletion', () => {
  const valid = bundle();
  assert.deepEqual(v2StructureIssues(valid), []);
  const invalid = bundle();
  invalid.states.resources = {exists: false};
  invalid.collections.inventory[0].data.schemaVersion = 1;
  invalid.deletionJob = {exists: true, data: {stage: 'processing', status: 'completed'}};
  const codes = v2StructureIssues(invalid).map(({code}) => code);
  assert.ok(codes.includes('v2-state-document-missing'));
  assert.ok(codes.includes('v2-collection-schema-invalid'));
  assert.ok(codes.includes('user-deletion-active'));
  const completed = bundle();
  completed.deletionJob = {exists: true, data: {stage: 'completed', state: 'processing'}};
  assert.deepEqual(v2StructureIssues(completed), []);
});

test('compaction binds the exact completed global cutover and its clean verification', () => {
  const cutover = cleanCutover();
  assert.deepEqual(validateCompletedCutoverEvidence({
    attestationSnapshot: {exists: true, data: cutover.attestation},
    cutoverId: CUTOVER_ID,
    projectId: PROJECT,
    verificationReport: cutover.verificationReport,
  }).issues, []);

  const wrongStatus = validateCompletedCutoverEvidence({
    attestationSnapshot: {exists: true, data: {...cutover.attestation, status: 'sealed'}},
    cutoverId: CUTOVER_ID,
    projectId: PROJECT,
    verificationReport: cutover.verificationReport,
  });
  assert.ok(wrongStatus.issues.some(({code}) => code === 'completed-cutover-attestation-invalid'));

  const tampered = structuredClone(cutover.verificationReport);
  tampered.subjects[0].currentHash = HASH('tampered');
  const tamperedEvidence = validateCompletedCutoverEvidence({
    attestationSnapshot: {exists: true, data: cutover.attestation},
    cutoverId: CUTOVER_ID,
    projectId: PROJECT,
    verificationReport: tampered,
  });
  assert.ok(tamperedEvidence.issues
    .some(({code}) => code === 'completed-cutover-verification-invalid'));
});

test('legacy-bearing subjects must be present in the completed cutover verification', async () => {
  const otherCutover = cleanCutover('another-user');
  const plan = await buildPlan({
    backend: fakeBackend({cutover: otherCutover}),
    cutoverVerificationReport: otherCutover.verificationReport,
    projectId: PROJECT,
  });
  assert.ok(plan.report.subjects[0].issues
    .some(({code}) => code === 'legacy-subject-not-in-completed-cutover'));
  assert.equal(plan.report.counts.errors, 1);
});

test('dry-run plan is redacted, complete, and stable across its own compaction', async () => {
  const currentBundle = bundle();
  const backend = fakeBackend({userBundle: currentBundle});
  const before = await buildPlan({backend, projectId: PROJECT});
  assert.equal(before.report.counts.pending, 1);
  assert.equal(before.report.counts.errors, 0);
  assert.equal(JSON.stringify(before.report).includes(UID), false);
  assert.equal(JSON.stringify(before.report).includes('private@example.test'), false);
  assert.equal(before.report.planFingerprint, canonicalHash(approvalCore(before.report)));
  assert.deepEqual(
    Object.keys(before.report).sort(),
    Object.keys(reportSchema.properties).sort()
  );
  assert.deepEqual(
    Object.keys(before.report.cutoverEvidence).sort(),
    Object.keys(reportSchema.properties.cutoverEvidence.properties).sort()
  );
  assert.deepEqual(
    Object.keys(before.report.subjects[0]).sort(),
    Object.keys(reportSchema.properties.subjects.items.properties).sort()
  );
  assert.deepEqual(
    Object.keys(before.report.counts).sort(),
    Object.keys(reportSchema.properties.counts.properties).sort()
  );

  const expectedArchive = before.entries[0].expectedArchiveDocuments;
  currentBundle.root.data = compactedShellData(currentBundle.root.data);
  currentBundle.archive = archiveSnapshot(expectedArchive);
  const after = await buildPlan({backend, projectId: PROJECT});
  assert.equal(after.report.counts.compacted, 1);
  assert.equal(after.report.counts.errors, 0);
  assert.equal(after.report.planFingerprint, before.report.planFingerprint);
});

test('V2 collection counts are approval-bound and must not drift during compaction', async () => {
  const currentBundle = bundle();
  const backend = fakeBackend({userBundle: currentBundle});
  const before = await buildPlan({backend, projectId: PROJECT});
  currentBundle.collections.inventory.push({data: {schemaVersion: 2}});
  const after = await buildPlan({backend, projectId: PROJECT});
  assert.equal(after.report.counts.v2CollectionDocuments, before.report.counts.v2CollectionDocuments + 1);
  assert.notEqual(after.report.planFingerprint, before.report.planFingerprint);
});

test('verification blocks while legacy fields remain and passes once archived and removed', async () => {
  const currentBundle = bundle();
  const backend = fakeBackend({userBundle: currentBundle});
  const pending = await buildPlan({
    backend,
    projectId: PROJECT,
    requireCompacted: true,
  });
  assert.equal(pending.report.counts.errors, 1);
  const plan = await buildPlan({backend, projectId: PROJECT});
  currentBundle.archive = archiveSnapshot(plan.entries[0].expectedArchiveDocuments);
  currentBundle.root.data = compactedShellData(currentBundle.root.data);
  const complete = await buildPlan({
    backend,
    projectId: PROJECT,
    requireCompacted: true,
  });
  assert.equal(complete.report.counts.errors, 0);
  assert.equal(complete.report.counts.compacted, 1);
});

test('future native-V2 roots need no archive and are accepted as already compact', async () => {
  const native = bundle(compactedShellData(rootData()), emptyArchive());
  const plan = await buildPlan({
    backend: fakeBackend({userBundle: native}),
    projectId: PROJECT,
    requireCompacted: true,
  });
  assert.equal(plan.report.counts.errors, 0);
  assert.equal(plan.report.counts.nativeV2, 1);
  assert.equal(plan.entries[0].expectedArchiveDocuments.length, 0);
});

test('approval validation rejects tampering and checkpoint validation binds exact plan', async () => {
  const plan = await buildPlan({backend: fakeBackend(), projectId: PROJECT});
  assert.doesNotThrow(() => assertApprovedReport({
    approvedFingerprint: plan.report.planFingerprint,
    approvedReport: plan.report,
    projectId: PROJECT,
  }));
  assert.throws(() => assertApprovedReport({
    approvedFingerprint: plan.report.planFingerprint,
    approvedReport: {...plan.report, configFingerprint: 'b'.repeat(64)},
    projectId: PROJECT,
  }), /does not match/);
  const checkpoint = {
    schemaVersion: 1,
    kind: 'task05-user-data-legacy-root-compaction-checkpoint',
    projectId: PROJECT,
    planFingerprint: plan.report.planFingerprint,
    lastDocumentId: UID,
  };
  assert.deepEqual(assertCheckpoint({
    checkpoint,
    planFingerprint: plan.report.planFingerprint,
    projectId: PROJECT,
  }), checkpoint);
  assert.throws(() => assertCheckpoint({
    checkpoint: {...checkpoint, planFingerprint: 'c'.repeat(64)},
    planFingerprint: plan.report.planFingerprint,
    projectId: PROJECT,
  }), /does not match/);
});

test('execution processes only pending users and checkpoints after verification', async () => {
  const plan = await buildPlan({backend: fakeBackend(), projectId: PROJECT});
  const calls = [];
  const checkpoints = [];
  const backend = {
    compactUser: async ({entry}) => calls.push(`compact:${entry.uid}`),
    verifyUser: async ({entry}) => calls.push(`verify:${entry.uid}`),
  };
  const result = await executeCompactionPlan({
    backend,
    plan,
    projectId: PROJECT,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
  });
  assert.deepEqual(calls, [`compact:${UID}`]);
  assert.equal(result.complete, true);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].lastDocumentId, UID);
  assert.equal(checkpoints[0].complete, true);
});
