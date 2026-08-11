const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LEGACY_IMAGE_CACHE_CONTROL,
  IMMUTABLE_IMAGE_CACHE_CONTROL,
  inspectImage,
  listAllFiles,
  mapWithConcurrency,
  needsBackfill,
} = require('./backfill-image-cache-metadata');

test('listAllFiles follows Storage pagination and forwards a prefix', async () => {
  const calls = [];
  const bucket = {
    getFiles: async (query) => {
      calls.push(query);
      if (!query.pageToken) {
        return [[{ name: 'items/one.png' }], { pageToken: 'next-page' }];
      }
      return [[{ name: 'items/two.png' }], null];
    },
  };

  const files = await listAllFiles(bucket, 'items/');

  assert.deepEqual(files.map(({ name }) => name), ['items/one.png', 'items/two.png']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].prefix, 'items/');
  assert.equal(calls[1].pageToken, 'next-page');
});

test('inspectImage selects image metadata without changing it', async () => {
  const image = {
    name: 'characters/hero.webp',
    getMetadata: async () => [{
      contentType: 'image/webp',
      cacheControl: 'no-cache',
      metadata: { firebaseStorageDownloadTokens: 'token' },
    }],
  };
  const video = {
    name: 'maps/scene.mp4',
    getMetadata: async () => [{ contentType: 'video/mp4' }],
  };

  const imageResult = await inspectImage(image);
  const videoResult = await inspectImage(video);

  assert.equal(imageResult.isImage, true);
  assert.equal(imageResult.currentCacheControl, 'no-cache');
  assert.equal(videoResult.isImage, false);
  assert.equal(LEGACY_IMAGE_CACHE_CONTROL, 'private, max-age=604800');
});

test('needsBackfill preserves both accepted cache policies', () => {
  assert.equal(needsBackfill({ isImage: true, currentCacheControl: '' }), true);
  assert.equal(needsBackfill({ isImage: true, currentCacheControl: LEGACY_IMAGE_CACHE_CONTROL }), false);
  assert.equal(needsBackfill({ isImage: true, currentCacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL }), false);
  assert.equal(needsBackfill({ isImage: false, currentCacheControl: '' }), false);
});

test('mapWithConcurrency preserves result order', async () => {
  const results = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
    await new Promise((resolve) => setTimeout(resolve, value));
    return value * 2;
  });

  assert.deepEqual(results, [6, 2, 4]);
});
