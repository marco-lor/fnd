const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDocuments,
  buildManifest,
  FIXTURE_VERSION,
  runSeedFixture,
} = require('./fixtures');

test('fixture generation is stable and contains the required scale', () => {
  const firstDocuments = buildDocuments();
  const secondDocuments = buildDocuments();
  const first = buildManifest(firstDocuments);
  const second = buildManifest(secondDocuments);
  assert.deepEqual(first, second);
  assert.equal(first.version, FIXTURE_VERSION);
  assert.equal(first.counts.users, 200);
  assert.equal(first.counts.items, 1000);
  assert.equal(first.counts.foes, 500);
  assert.equal(first.counts.echi_npcs, 500);
  assert.equal(first.counts.map_markers, 2000);
  assert.equal(first.counts.encounters, 100);
  assert.equal(first.counts.grigliata_token_placements, 200);
  assert.equal(first.counts.grigliata_fog_memory_tiles, 1024);
  assert.equal(new Set(firstDocuments.map((entry) => entry.path)).size, firstDocuments.length);
});

test('fixture seeding suppresses bulk triggers and flushes sentinel work before verification', async () => {
  const calls = [];
  const documents = [{ path: 'fixture/doc', data: { stable: true } }];
  const manifest = { version: FIXTURE_VERSION, hash: 'fixture-hash', documentCount: 1 };
  const withBackgroundTriggersDisabledImpl = async (operation) => {
    calls.push('triggers:disable');
    try {
      return await operation();
    } finally {
      calls.push('triggers:enable');
    }
  };

  const result = await runSeedFixture({
    documents,
    manifest,
    waitForFunctionsReadyImpl: async () => calls.push('functions:ready'),
    withBackgroundTriggersDisabledImpl,
    clearEmulatorsImpl: async () => calls.push('emulators:clear'),
    seedAccountsImpl: async () => calls.push('accounts:seed'),
    writeDocumentsImpl: async (received) => calls.push(`documents:seed:${received.length}`),
    seedStorageImpl: async () => calls.push('storage:seed'),
    waitForDerivedStateImpl: async () => calls.push('derived:verify'),
    writeFixtureMetadataImpl: async (received) => calls.push(`metadata:write:${received.hash}`),
    verifyFixtureImpl: async () => {
      calls.push('fixture:verify');
      return { verified: true };
    },
  });

  assert.deepEqual(calls, [
    'functions:ready',
    'triggers:disable',
    'emulators:clear',
    'accounts:seed',
    'documents:seed:1',
    'storage:seed',
    'derived:verify',
    'metadata:write:fixture-hash',
    'triggers:enable',
    'functions:ready',
    'triggers:disable',
    'triggers:enable',
    'fixture:verify',
  ]);
  assert.deepEqual(result, { verified: true });
});
