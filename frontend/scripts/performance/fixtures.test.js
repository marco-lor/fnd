const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  buildDeterministicMediaObjects,
  buildDeterministicPng,
  buildDocuments,
  buildManifest,
  buildShortWav,
  clearEmulators,
  FIXTURE_VERSION,
  PERFORMANCE_STORAGE_BUCKET,
  runSeedFixture,
  TASK06_BACKEND_CONFIG,
  TASK07_MEDIA_CONTROL,
  TASK07_STORAGE_OBJECT_COUNT,
} = require('./fixtures');
const fixtureManifest = require('../../performance/fixture-manifest.json');

test('fixture generation is stable and contains the required scale', () => {
  const firstDocuments = buildDocuments();
  const secondDocuments = buildDocuments();
  const first = buildManifest(firstDocuments);
  const second = buildManifest(secondDocuments);
  assert.deepEqual(first, second);
  assert.equal(first.version, FIXTURE_VERSION);
  assert.equal(first.counts.users, 200);
  assert.equal(first.counts.user_directory, 200);
  assert.equal(first.counts.items, 1000);
  assert.equal(first.counts.foes, 500);
  assert.equal(first.counts.echi_npcs, 500);
  assert.equal(first.counts.map_markers, 2000);
  assert.equal(first.counts.encounters, 100);
  assert.equal(first.counts.grigliata_backgrounds, 50);
  assert.equal(first.counts.grigliata_gallery_folders, 2);
  assert.equal(first.counts.grigliata_music_stream, 1);
  assert.equal(first.counts.grigliata_token_placements, 200);
  assert.equal(first.counts.grigliata_fog_memory_tiles, 1024);
  assert.equal(first.counts.app_config, 1);
  assert.equal(first.storageObjectCount, TASK07_STORAGE_OBJECT_COUNT);
  assert.deepEqual(
    firstDocuments.find(({path: documentPath}) => (
      documentPath === 'app_config/task06_backend'
    ))?.data,
    TASK06_BACKEND_CONFIG
  );
  assert.deepEqual(
    firstDocuments.find(({path: documentPath}) => (
      documentPath === 'utils/task07_media'
    ))?.data,
    TASK07_MEDIA_CONTROL
  );
  const codex = firstDocuments.find(({path: documentPath}) => (
    documentPath === 'utils/codex'
  ))?.data;
  assert.equal(Array.isArray(codex), false);
  assert.equal(Object.keys(codex).length, 20);
  for (const category of Object.values(codex)) {
    assert.equal(Array.isArray(category), false);
    assert.equal(category && typeof category, 'object');
    assert.equal(Object.keys(category).length, 250);
    assert.equal(Object.values(category).every((value) => typeof value === 'string'), true);
  }
  const playerShell = firstDocuments.find(({path: documentPath}) => (
    documentPath === 'users/perf-player'
  ))?.data;
  assert.equal(playerShell.modelVersion, 2);
  assert.equal(playerShell.summary.level, 5);
  for (const legacyField of ['stats', 'Parametri', 'inventory', 'spells', 'tecniche', 'settings']) {
    assert.equal(Object.hasOwn(playerShell, legacyField), false);
  }
  for (const stateDocument of ['progression', 'resources', 'settings', 'equipment', 'profileContent']) {
    assert.ok(firstDocuments.some(({path: documentPath}) => (
      documentPath === `users/perf-player/state/${stateDocument}`
    )));
  }
  assert.equal(firstDocuments.filter(({path: documentPath}) => (
    documentPath.startsWith('users/perf-player/inventory/')
  )).length, 500);
  const musicStream = firstDocuments.find(({ path: documentPath }) => (
    documentPath === 'grigliata_music_stream/current'
  ))?.data;
  const expectedMusicProjection = {
    schemaVersion: 2,
    controlMode: 'derivative-read',
    volume: 0.65,
    sessions: [],
  };
  assert.deepEqual(musicStream, {
    ...expectedMusicProjection,
    revision: 1,
    sourceHash: createHash('sha256')
      .update(JSON.stringify(expectedMusicProjection))
      .digest('hex'),
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const galleryFolderIds = new Set(firstDocuments
    .filter(({ path: documentPath }) => documentPath.startsWith('grigliata_gallery_folders/'))
    .map(({ path: documentPath }) => documentPath.split('/')[1]));
  const galleryBackgrounds = firstDocuments
    .filter(({ path: documentPath }) => documentPath.startsWith('grigliata_backgrounds/'));
  assert.deepEqual(galleryFolderIds, new Set(['fixture-atlas-a', 'fixture-atlas-b']));
  for (const folderId of galleryFolderIds) {
    assert.equal(
      galleryBackgrounds.filter(({ data }) => data.galleryFolderId === folderId).length,
      25
    );
  }

  const boardState = firstDocuments.find(({ path: documentPath }) => (
    documentPath === 'grigliata_state/current'
  ))?.data;
  for (const field of [
    'legacyTokenPlacementCleanupCompletedAt',
    'legacyPlacementDeadStateCleanupCompletedAt',
    'legacyPlacementVisibilityCleanupCompletedAt',
  ]) {
    assert.equal(boardState?.[field], '2026-01-01T00:00:00.000Z');
  }
  const lightingMetadata = firstDocuments.find(({ path: documentPath }) => (
    documentPath === 'grigliata_background_lighting/perf-map'
  ))?.data;
  assert.equal(lightingMetadata?.backgroundId, boardState?.activeBackgroundId);

  assert.equal(new Set(firstDocuments.map((entry) => entry.path)).size, firstDocuments.length);
  assert.equal(fixtureManifest.documentCount, first.documentCount);
  assert.equal(fixtureManifest.storageObjectCount, first.storageObjectCount);
  assert.equal(fixtureManifest.canonicalHash, first.hash);
  assert.deepEqual(fixtureManifest.counts, Object.fromEntries(
    Object.entries(first.counts).filter(([collectionName]) => (
      fixtureManifest.counts[collectionName] !== undefined
    ))
  ));
});

test('Task 07 media catalog is deterministic, realistic, and format-complete', () => {
  const pngA = buildDeterministicPng({ width: 96, height: 64, seed: 7 });
  const pngB = buildDeterministicPng({ width: 96, height: 64, seed: 7 });
  assert.deepEqual(pngA, pngB);
  assert.equal(pngA.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(pngA.readUInt32BE(16), 96);
  assert.equal(pngA.readUInt32BE(20), 64);

  const wav = buildShortWav();
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');

  const objects = buildDeterministicMediaObjects();
  assert.equal(objects.length, TASK07_STORAGE_OBJECT_COUNT);
  assert.equal(objects.filter(({ caseId }) => caseId === 'valid-png').length, 128);
  assert.deepEqual(new Set(objects.map(({ caseId }) => caseId)), new Set([
    'valid-png',
    'valid-jpeg',
    'valid-webp',
    'exif-orientation-6',
    'corrupt-image',
    'unsupported-gif',
    'short-audio',
    'video-poster',
    'corrupt-video',
  ]));
  assert.equal(new Set(objects.map(({ path: objectPath }) => objectPath)).size, objects.length);
  const jpeg = objects.find(({ caseId }) => caseId === 'valid-jpeg').contents;
  assert.equal(jpeg.subarray(0, 2).toString('hex'), 'ffd8');
  assert.equal(jpeg.subarray(-2).toString('hex'), 'ffd9');
  const webp = objects.find(({ caseId }) => caseId === 'valid-webp').contents;
  assert.equal(webp.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(webp.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.match(
    objects.find(({ caseId }) => caseId === 'exif-orientation-6').contents.toString('latin1'),
    /Exif/
  );
});

test('emulator cleanup clears exact loopback services then the whole demo Storage bucket', async () => {
  const calls = [];
  const storageBucket = {
    name: PERFORMANCE_STORAGE_BUCKET,
    deleteFiles: async (...args) => calls.push({ args, operation: 'storage:deleteFiles' }),
  };

  await clearEmulators({
    initializeAdminImpl: () => calls.push({ operation: 'admin:initialize' }),
    getBucketImpl: () => storageBucket,
    fetchImpl: async (url, options) => {
      calls.push({ operation: 'fetch', options, url });
      return { ok: true, status: 200 };
    },
  });

  assert.equal(PERFORMANCE_STORAGE_BUCKET, 'demo-fnd-perf.appspot.com');
  assert.deepEqual(calls, [
    { operation: 'admin:initialize' },
    {
      operation: 'fetch',
      options: { method: 'DELETE' },
      url: 'http://127.0.0.1:9099/emulator/v1/projects/demo-fnd-perf/accounts',
    },
    {
      operation: 'fetch',
      options: { method: 'DELETE' },
      url: 'http://127.0.0.1:8080/emulator/v1/projects/demo-fnd-perf/databases/(default)/documents',
    },
    { args: [], operation: 'storage:deleteFiles' },
  ]);
});

test('fixture seeding suppresses bulk triggers and flushes directory sentinel work before verification', async () => {
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
    'metadata:write:fixture-hash',
    'triggers:enable',
    'functions:ready',
    'triggers:disable',
    'triggers:enable',
    'fixture:verify',
  ]);
  assert.deepEqual(result, { verified: true });
});
