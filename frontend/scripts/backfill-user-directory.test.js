const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BATCH_SIZE,
  assertCompletedDryRunReport,
  assertSafeTarget,
  buildUserDirectoryProjection,
  parseArguments,
  projectionMatches,
  runBackfill,
} = require('./backfill-user-directory');

test('requires an explicit project and defaults to dry-run mode', () => {
  assert.throws(() => parseArguments([]), /Explicit --project/);
  const parsed = parseArguments(['--project', 'demo-fnd-perf']);
  assert.equal(parsed.projectId, 'demo-fnd-perf');
  assert.equal(parsed.shouldWrite, false);
  assert.equal(parsed.resume, false);
});

test('hard-refuses production and non-loopback targets', () => {
  assert.throws(
    () => assertSafeTarget('fatins', {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}),
    /refuses non-demo/
  );
  assert.throws(
    () => assertSafeTarget('demo-fnd-perf', {}),
    /requires FIRESTORE_EMULATOR_HOST/
  );
  assert.throws(
    () => assertSafeTarget('demo-fnd-perf', {FIRESTORE_EMULATOR_HOST: 'firestore.example:8080'}),
    /requires FIRESTORE_EMULATOR_HOST/
  );
  assert.deepEqual(
    assertSafeTarget('demo-fnd-perf', {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      GCLOUD_PROJECT: 'demo-fnd-perf',
    }),
    {emulatorHost: '127.0.0.1:8080', projectId: 'demo-fnd-perf'}
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
  const valid = {
    schemaVersion: 1,
    mode: 'dry-run',
    projectId: 'demo-fnd-perf',
    batchSize: BATCH_SIZE,
    complete: true,
  };
  assert.equal(assertCompletedDryRunReport(valid, 'demo-fnd-perf'), valid);
  assert.throws(
    () => assertCompletedDryRunReport({...valid, complete: false}, 'demo-fnd-perf'),
    /requires a completed/
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
