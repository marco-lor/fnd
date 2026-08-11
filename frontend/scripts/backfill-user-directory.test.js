const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BATCH_SIZE,
  DEFAULT_VERIFY_REPORT_PATH,
  assertCompletedDryRunReport,
  assertDirectoryVerification,
  assertSafeTarget,
  buildUserDirectoryProjection,
  parseArguments,
  planFingerprintFor,
  projectionMatches,
  runBackfill,
} = require('./backfill-user-directory');

test('requires an explicit project and defaults to dry-run mode', () => {
  assert.throws(() => parseArguments([]), /Explicit --project/);
  const parsed = parseArguments(['--project', 'demo-fnd-perf']);
  assert.equal(parsed.projectId, 'demo-fnd-perf');
  assert.equal(parsed.shouldWrite, false);
  assert.equal(parsed.resume, false);
  assert.equal(parsed.authMode, 'admin');
});

test('verification mode is read-only, uses a separate report, and cannot write', () => {
  const parsed = parseArguments(['--project', 'demo-fnd-perf', '--verify']);
  assert.equal(parsed.verifyOnly, true);
  assert.equal(parsed.shouldWrite, false);
  assert.equal(parsed.reportPath, DEFAULT_VERIFY_REPORT_PATH);
  assert.throws(
    () => parseArguments(['--project', 'demo-fnd-perf', '--verify', '--write']),
    /mutually exclusive/
  );
});

test('verification fails closed when a directory projection is missing or stale', () => {
  const ready = {
    complete: true,
    counts: {create: 0, scanned: 3, update: 0},
    directoryDocuments: 3,
  };
  assert.equal(assertDirectoryVerification(ready), ready);
  assert.throws(
    () => assertDirectoryVerification({
      complete: true,
      counts: {create: 1, scanned: 3, update: 2},
      directoryDocuments: 3,
    }),
    /1 missing and 2 stale/
  );
  assert.throws(
    () => assertDirectoryVerification({
      complete: false,
      counts: {create: 0, scanned: 3, update: 0},
      directoryDocuments: 3,
    }),
    /verification failed/
  );
  assert.throws(
    () => assertDirectoryVerification({
      complete: true,
      counts: {create: 0, scanned: 3, update: 0},
      directoryDocuments: 4,
    }),
    /directory count 4 does not match 3 source user/
  );
});

test('refuses production-through-emulator, nonproduction live, and non-loopback targets', () => {
  assert.throws(
    () => assertSafeTarget({projectId: 'fatins'}, {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    }),
    /requires a demo-/
  );
  assert.throws(
    () => assertSafeTarget({projectId: 'fatin-test'}, {}),
    /accepts only live project fatins/
  );
  assert.throws(
    () => assertSafeTarget({projectId: 'demo-fnd-perf'}, {
      FIRESTORE_EMULATOR_HOST: 'firestore.example:8080',
    }),
    /Non-loopback/
  );
  assert.deepEqual(
    assertSafeTarget({projectId: 'demo-fnd-perf'}, {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      GCLOUD_PROJECT: 'demo-fnd-perf',
    }),
    {emulatorHost: '127.0.0.1:8080', live: false, projectId: 'demo-fnd-perf'}
  );
});

test('live access is hard-locked to confirmed fatins Firebase CLI auth', () => {
  const base = {
    allowLiveProject: true,
    authMode: 'firebase-cli',
    confirmProject: 'fatins',
    projectId: 'fatins',
  };
  assert.deepEqual(assertSafeTarget(base, {}), {
    emulatorHost: null,
    live: true,
    projectId: 'fatins',
  });
  assert.throws(
    () => assertSafeTarget({...base, allowLiveProject: false}, {}),
    /allow-live-project/
  );
  assert.throws(
    () => assertSafeTarget({...base, confirmProject: 'fatin-test'}, {}),
    /confirm-project fatins/
  );
  assert.throws(
    () => assertSafeTarget({...base, authMode: 'admin'}, {}),
    /requires --auth firebase-cli/
  );
});

test('projection matches the Functions privacy and normalization contract', () => {
  const projection = buildUserDirectoryProjection({
    characterId: '  Éowyn   d’Ithilien  ',
    role: 'players',
    email: 'private@example.test',
    stats: {private: true},
  });
  assert.deepEqual(projection, {
    schemaVersion: 1,
    characterId: 'Éowyn   d’Ithilien',
    label: 'Éowyn   d’Ithilien',
    normalizedLabel: 'eowyn d’ithilien',
    role: 'player',
  });
  assert.equal(projectionMatches({...projection}, projection), true);
  assert.equal(projectionMatches({...projection, email: 'leak'}, projection), false);
});

test('write mode requires a completed matching dry-run report', () => {
  const subjects = [{
    action: 'create',
    currentHash: 'current',
    documentIdHash: 'id',
    projectionHash: 'projection',
  }];
  const valid = {
    schemaVersion: 2,
    mode: 'dry-run',
    projectId: 'demo-fnd-perf',
    batchSize: BATCH_SIZE,
    complete: true,
    subjects,
    planFingerprint: planFingerprintFor({projectId: 'demo-fnd-perf', subjects}),
  };
  assert.equal(
    assertCompletedDryRunReport(valid, 'demo-fnd-perf', valid.planFingerprint),
    valid
  );
  assert.throws(
    () => assertCompletedDryRunReport(
      {...valid, complete: false},
      'demo-fnd-perf',
      valid.planFingerprint
    ),
    /requires a completed/
  );
  assert.throws(
    () => assertCompletedDryRunReport(valid, 'demo-fnd-perf', '0'.repeat(64)),
    /approve-fingerprint/
  );
});

test('backfill is ordered, bounded, idempotent, and checkpoints after commit', async () => {
  const exact = buildUserDirectoryProjection({characterId: 'Alpha', role: 'player'});
  const users = [
    {id: 'a', data: {characterId: 'Alpha', role: 'player'}},
    {id: 'b', data: {characterId: 'Bravo', role: 'dm'}},
    {id: 'c', data: {characterId: 'Chloé', role: 'webmaster'}},
  ];
  const commits = [];
  const checkpoints = [];
  const fetchCalls = [];
  const backend = {
    fetchUserPage: async ({afterDocumentId, limit}) => {
      fetchCalls.push({afterDocumentId, limit});
      return afterDocumentId ? [] : users;
    },
    getDirectoryDocuments: async () => new Map([
      ['a', exact],
      ['b', {...buildUserDirectoryProjection(users[1].data), email: 'stale-private-field'}],
    ]),
    commitProjections: async (entries) => commits.push(entries),
  };

  const result = await runBackfill({
    backend,
    shouldWrite: true,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
  });

  assert.deepEqual(fetchCalls, [{afterDocumentId: '', limit: 200}]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.counts, {
    batches: 1,
    create: 1,
    scanned: 3,
    unchanged: 1,
    update: 1,
    written: 2,
  });
  assert.deepEqual(commits.map((entries) => entries.map(({id}) => id)), [['b', 'c']]);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].lastDocumentId, 'c');
  assert.equal(result.subjects.length, 3);
  assert.deepEqual(result.subjects.map(({action}) => action), [
    'unchanged',
    'update',
    'create',
  ]);
});

test('backfill rejects a page that is not strictly ordered by document ID', async () => {
  const backend = {
    fetchUserPage: async () => [
      {id: 'b', data: {}},
      {id: 'a', data: {}},
    ],
    getDirectoryDocuments: async () => new Map(),
    commitProjections: async () => {},
  };
  await assert.rejects(runBackfill({backend}), /strictly ordered/);
});
