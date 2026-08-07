import {
  __configurePrivateMediaAssetsForTests,
  __resetPrivateMediaAssetsForTests,
  acquirePrivateAudioAsset,
  acquirePrivateMediaAsset,
  acquirePrivateVideoAsset,
  getPrivateMediaAssetCacheSnapshot,
  getPrivateAudioAssetKey,
  getPrivateMediaAssetKey,
  getPrivateVideoAssetKey,
  normalizePrivateAudioDescriptor,
  normalizePrivateMediaDescriptor,
  normalizePrivateVideoDescriptor,
  PRIVATE_AUDIO_CONTENT_TYPES,
  PRIVATE_MEDIA_MAX_ACTIVE_FETCHES,
  PRIVATE_MEDIA_MAX_CACHE_BYTES,
  PRIVATE_MEDIA_MAX_DECODED_BYTES,
  PRIVATE_MEDIA_MAX_TOTAL_DECODED_BYTES,
  PRIVATE_MEDIA_MAX_RECORDS,
  PRIVATE_MEDIA_FAILURE_BACKOFF_MS,
  PRIVATE_VIDEO_CONTENT_TYPES,
} from './privateMediaAssets';

const canonicalAssetId = (id) => {
  const hex = Array.from(String(id))
    .map((character) => character.charCodeAt(0).toString(16))
    .join('')
    .padEnd(40, '0')
    .slice(0, 40);
  return `m_${hex}`;
};
const canonicalGeneration = (id) => String(
  Array.from(String(id)).reduce((total, character) => total + character.charCodeAt(0), 1)
);

const descriptor = (id, bytes = 2, overrides = {}) => ({
  path: `media_assets/v1/signed-in/user/${canonicalAssetId(id)}/${canonicalGeneration(id)}/thumbnail`,
  generation: canonicalGeneration(id),
  bytes,
  contentType: 'image/webp',
  width: 96,
  height: 96,
  ...overrides,
});

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const createRuntime = ({
  getBlobImplementation,
  maxActiveFetches = PRIVATE_MEDIA_MAX_ACTIVE_FETCHES,
  maxCacheBytes = PRIVATE_MEDIA_MAX_CACHE_BYTES,
  maxDecodedBytes = PRIVATE_MEDIA_MAX_DECODED_BYTES,
  maxTotalDecodedBytes = PRIVATE_MEDIA_MAX_TOTAL_DECODED_BYTES,
  maxRecords = PRIVATE_MEDIA_MAX_RECORDS,
  now = () => Date.now(),
} = {}) => {
  const storage = { name: 'authenticated-storage' };
  const ref = jest.fn((_storage, path) => ({ path }));
  const getBlob = jest.fn(getBlobImplementation || (async (objectRef, bytes) => (
    new Blob(['x'.repeat(bytes)], { type: 'image/webp' })
  )));
  const loadStorageApi = jest.fn(async () => ({ storage, ref, getBlob }));
  const createObjectURL = jest.fn((blob) => `blob:private-${blob.size}-${createObjectURL.mock.calls.length}`);
  const revokeObjectURL = jest.fn();

  __configurePrivateMediaAssetsForTests({
    maxActiveFetches,
    maxCacheBytes,
    maxDecodedBytes,
    maxTotalDecodedBytes,
    maxRecords,
    now,
    loadStorageApi,
    createObjectURL,
    revokeObjectURL,
  });

  return {
    storage,
    ref,
    getBlob,
    loadStorageApi,
    createObjectURL,
    revokeObjectURL,
  };
};

describe('privateMediaAssets', () => {
  afterEach(() => {
    __resetPrivateMediaAssetsForTests();
    jest.useRealTimers();
  });

  test('normalizes only bounded immutable private image descriptors', () => {
    const value = descriptor('normalized', 4);
    expect(normalizePrivateMediaDescriptor(value)).toEqual({
      ...value,
      width: 96,
      height: 96,
    });
    expect(getPrivateMediaAssetKey(value)).toBe(JSON.stringify([
      value.path,
      value.generation,
    ]));
    const gallery2x = descriptor('gallery-density', 4, {
      path: `media_assets/v1/signed-in/user/${canonicalAssetId('gallery-density')}/${canonicalGeneration('gallery-density')}/gallery2x`,
      width: 768,
      height: 432,
    });
    expect(normalizePrivateMediaDescriptor(gallery2x)).toEqual(gallery2x);
    const thumbnail2x = descriptor('thumbnail-density', 4, {
      path: `media_assets/v1/owner-manager/user/${canonicalAssetId('thumbnail-density')}/${canonicalGeneration('thumbnail-density')}/thumbnail2x`,
      width: 192,
      height: 192,
    });
    expect(normalizePrivateMediaDescriptor(thumbnail2x)).toEqual(thumbnail2x);
    expect(normalizePrivateMediaDescriptor({
      ...value,
      path: 'https://example.test/bearer.webp',
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...value,
      contentType: 'video/mp4',
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...value,
      contentType: 'image/svg+xml',
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...value,
      bytes: PRIVATE_MEDIA_MAX_CACHE_BYTES + 1,
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...value,
      width: null,
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...value,
      generation: 'generation-invalid',
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...value,
      path: `media/v1/avatar/user/${canonicalAssetId('legacy')}/derivatives/v1/thumbnail.webp`,
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...value,
      path: `media_assets/v1/signed-in/user/asset/${canonicalGeneration('normalized')}/thumbnail`,
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...value,
      path: `media_assets/v1/signed-in/user/${canonicalAssetId('normalized')}/${canonicalGeneration('normalized')}/board`,
    })).toBeNull();
    expect(normalizePrivateVideoDescriptor({
      ...value,
      path: `media_assets/v1/signed-in/user/${canonicalAssetId('normalized')}/${canonicalGeneration('normalized')}/original`,
      contentType: 'video/mp4',
      generation: '0',
    })).toBeNull();
  });

  test('accepts the exact descriptors emitted by the server processor', () => {
    const assetId = `m_${'a'.repeat(40)}`;
    const original = {
      path: `media_assets/v1/signed-in/user-a/${assetId}/7/original`,
      generation: '1700000000000001',
      bytes: 10,
      contentType: 'image/png',
      width: 400,
      height: 300,
    };
    const thumbnail = {
      path: `media_assets/v1/signed-in/user-a/${assetId}/7/thumbnail`,
      generation: '1700000000000002',
      bytes: 14,
      contentType: 'image/webp',
      width: 64,
      height: 64,
    };

    expect(normalizePrivateMediaDescriptor(original)).toEqual(original);
    expect(normalizePrivateMediaDescriptor(thumbnail)).toEqual(thumbnail);
    expect(normalizePrivateMediaDescriptor({
      ...thumbnail,
      path: thumbnail.path.replace('/signed-in/', '/public/'),
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...thumbnail,
      path: thumbnail.path.replace('/7/', '/0/'),
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...thumbnail,
      contentType: 'image/png',
    })).toBeNull();
    expect(normalizePrivateMediaDescriptor({
      ...original,
      contentType: 'image/gif',
    })).toBeNull();
  });

  test('shares the desktop registry caps and deterministic failure schedule', () => {
    expect(PRIVATE_MEDIA_MAX_ACTIVE_FETCHES).toBe(4);
    expect(PRIVATE_MEDIA_MAX_RECORDS).toBe(96);
    expect(PRIVATE_MEDIA_MAX_DECODED_BYTES).toBe(128 * 1024 * 1024);
    expect(PRIVATE_MEDIA_MAX_TOTAL_DECODED_BYTES).toBe(384 * 1024 * 1024);
    expect(PRIVATE_MEDIA_FAILURE_BACKOFF_MS).toEqual([1000, 5000, 30000]);
  });

  test('normalizes server MP4 and WebM originals and acquires them through the shared bounded cache', async () => {
    const value = descriptor('video', 4, {
      path: `media_assets/v1/signed-in/user/${canonicalAssetId('video')}/${canonicalGeneration('video')}/original`,
      contentType: 'video/mp4',
      width: 3840,
      height: 2160,
    });
    const runtime = createRuntime({
      maxDecodedBytes: 1,
      getBlobImplementation: async () => new Blob(['data'], { type: 'video/mp4' }),
    });

    expect(normalizePrivateMediaDescriptor(value)).toBeNull();
    expect(normalizePrivateVideoDescriptor(value)).toEqual(value);
    expect(normalizePrivateVideoDescriptor({
      ...value,
      width: undefined,
      height: undefined,
    })).toEqual({
      ...value,
      width: null,
      height: null,
    });
    expect(getPrivateVideoAssetKey(value)).toBe(JSON.stringify([
      value.path,
      value.generation,
    ]));
    const webm = {
      ...value,
      path: `media_assets/v1/owner-manager/user/${canonicalAssetId('video')}/8/original`,
      generation: '901',
      contentType: 'video/webm',
    };
    expect(PRIVATE_VIDEO_CONTENT_TYPES).toEqual(['video/mp4', 'video/webm']);
    expect(normalizePrivateVideoDescriptor(webm)).toEqual(webm);
    expect(normalizePrivateVideoDescriptor({
      ...webm,
      path: webm.path.replace('/original', '/poster'),
    })).toBeNull();

    const lease = acquirePrivateVideoAsset(value);
    await expect(lease.promise).resolves.toEqual(expect.objectContaining({
      url: expect.stringMatching(/^blob:private-/),
    }));
    expect(runtime.getBlob).toHaveBeenCalledWith({ path: value.path }, value.bytes);
    expect(getPrivateMediaAssetCacheSnapshot().cachedDecodedBytes).toBe(0);
    lease.release();
  });

  test('normalizes and acquires canonical audio originals through the bounded cache', async () => {
    const value = descriptor('audio', 4, {
      path: `media_assets/v1/signed-in/user/${canonicalAssetId('audio')}/${canonicalGeneration('audio')}/original`,
      contentType: 'audio/mpeg',
      width: undefined,
      height: undefined,
    });
    const runtime = createRuntime({
      maxDecodedBytes: 1,
      getBlobImplementation: async () => new Blob(['data'], { type: 'audio/mpeg' }),
    });

    expect(PRIVATE_AUDIO_CONTENT_TYPES).toEqual([
      'audio/mpeg',
      'audio/mp4',
      'audio/aac',
      'audio/ogg',
      'audio/wav',
      'audio/x-wav',
    ]);
    expect(normalizePrivateMediaDescriptor(value)).toBeNull();
    expect(normalizePrivateVideoDescriptor(value)).toBeNull();
    expect(normalizePrivateAudioDescriptor(value)).toEqual({
      ...value,
      width: null,
      height: null,
    });
    expect(getPrivateAudioAssetKey(value)).toBe(JSON.stringify([
      value.path,
      value.generation,
    ]));
    expect(normalizePrivateAudioDescriptor({
      ...value,
      path: value.path.replace('/original', '/thumbnail'),
    })).toBeNull();

    const lease = acquirePrivateAudioAsset(value);
    await expect(lease.promise).resolves.toEqual(expect.objectContaining({
      url: expect.stringMatching(/^blob:private-/),
    }));
    expect(runtime.getBlob).toHaveBeenCalledWith({ path: value.path }, value.bytes);
    expect(getPrivateMediaAssetCacheSnapshot().cachedDecodedBytes).toBe(0);
    lease.release();
  });

  test('fetches through authenticated ref/getBlob and reuses one refcounted record', async () => {
    const runtime = createRuntime();
    const value = descriptor('shared', 3);
    const firstLease = acquirePrivateMediaAsset(value);
    const secondLease = acquirePrivateMediaAsset(value);

    const [first, second] = await Promise.all([
      firstLease.promise,
      secondLease.promise,
    ]);

    expect(runtime.loadStorageApi).toHaveBeenCalledTimes(1);
    expect(runtime.ref).toHaveBeenCalledWith(runtime.storage, value.path);
    expect(runtime.getBlob).toHaveBeenCalledWith({ path: value.path }, value.bytes);
    expect(first.url).toBe(second.url);
    expect(runtime.createObjectURL).toHaveBeenCalledTimes(1);
    expect(getPrivateMediaAssetCacheSnapshot().records[0].refCount).toBe(2);

    firstLease.release();
    expect(getPrivateMediaAssetCacheSnapshot().records[0].refCount).toBe(1);
    secondLease.release();
    expect(getPrivateMediaAssetCacheSnapshot().records[0].refCount).toBe(0);
    expect(runtime.revokeObjectURL).not.toHaveBeenCalled();
  });

  test('restores the manifest MIME after Firebase bounds a Blob with slice', async () => {
    const runtime = createRuntime({
      getBlobImplementation: async () => new Blob(['data']),
    });
    const value = descriptor('bounded-blob-type', 4);
    const lease = acquirePrivateMediaAsset(value);

    await expect(lease.promise).resolves.toEqual(expect.objectContaining({
      url: expect.stringMatching(/^blob:private-/),
    }));
    expect(runtime.getBlob).toHaveBeenCalledWith(
      { path: value.path },
      value.bytes
    );
    expect(runtime.createObjectURL.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        size: value.bytes,
        type: value.contentType,
      })
    );
    lease.release();
  });

  test('rejects conflicting raster dimensions for the same immutable generation', async () => {
    const runtime = createRuntime();
    const value = descriptor('dimension-conflict', 4);
    const lease = acquirePrivateMediaAsset(value);
    let conflict = null;

    try {
      acquirePrivateMediaAsset({
        ...value,
        width: value.width * 2,
      });
    } catch (error) {
      conflict = error;
    }

    expect(conflict).toMatchObject({
      code: 'private-media-descriptor-conflict',
    });
    await lease.promise;
    lease.release();
    expect(runtime.getBlob).toHaveBeenCalledTimes(1);
  });

  test('validates blob bytes and type and applies failure backoff before retry', async () => {
    let now = 100;
    const runtime = createRuntime({
      now: () => now,
      getBlobImplementation: jest.fn()
        .mockResolvedValueOnce(new Blob(['nope'], { type: 'image/svg+xml' }))
        .mockResolvedValueOnce(new Blob(['good'], { type: 'image/webp' })),
    });
    const value = descriptor('retry', 4);
    const firstLease = acquirePrivateMediaAsset(value);

    await expect(firstLease.promise).rejects.toMatchObject({
      code: 'private-media-type-mismatch',
    });
    firstLease.release();
    expect(getPrivateMediaAssetCacheSnapshot().records[0].retryAt).toBe(1100);

    const backedOffLease = acquirePrivateMediaAsset(value);
    await expect(backedOffLease.promise).rejects.toMatchObject({
      code: 'private-media-type-mismatch',
    });
    backedOffLease.release();
    expect(runtime.getBlob).toHaveBeenCalledTimes(1);

    now = 2000;
    const retryLease = acquirePrivateMediaAsset(value);
    await expect(retryLease.promise).resolves.toEqual(expect.objectContaining({
      url: expect.stringMatching(/^blob:private-/),
    }));
    retryLease.release();
    expect(runtime.getBlob).toHaveBeenCalledTimes(2);
  });

  test('rejects a decoded-budget newcomer, protects active LRU, then retries after release', async () => {
    let now = 0;
    const runtime = createRuntime({
      maxCacheBytes: 16,
      maxDecodedBytes: 64,
      maxTotalDecodedBytes: 64,
      maxRecords: 4,
      now: () => now,
    });
    const firstValue = descriptor('decoded-a', 4, {
      width: 4,
      height: 4,
    });
    const secondValue = descriptor('decoded-b', 4, {
      width: 4,
      height: 4,
    });
    const firstLease = acquirePrivateMediaAsset(firstValue);
    const firstResult = await firstLease.promise;
    const secondLease = acquirePrivateMediaAsset(secondValue);
    await expect(secondLease.promise).rejects.toMatchObject({
      code: 'private-media-decoded-budget-exceeded',
    });
    secondLease.release();

    expect(getPrivateMediaAssetCacheSnapshot()).toEqual(expect.objectContaining({
      cachedBytes: 4,
      cachedDecodedBytes: 64,
      recordCount: 2,
    }));
    expect(runtime.revokeObjectURL).not.toHaveBeenCalled();

    firstLease.release();
    now = 2000;
    const retryLease = acquirePrivateMediaAsset(secondValue);
    await expect(retryLease.promise).resolves.toEqual(expect.objectContaining({
      url: expect.stringMatching(/^blob:private-/),
    }));

    expect(runtime.revokeObjectURL).toHaveBeenCalledWith(firstResult.url);
    expect(getPrivateMediaAssetCacheSnapshot()).toEqual(expect.objectContaining({
      cachedBytes: 4,
      cachedDecodedBytes: 64,
      recordCount: 1,
    }));
    retryLease.release();
  });

  test('admits active and crossfade decoded leases above the settled unreferenced cap', async () => {
    const runtime = createRuntime({
      maxCacheBytes: 16,
      maxDecodedBytes: 64,
      maxTotalDecodedBytes: 128,
      maxRecords: 4,
    });
    const activeLease = acquirePrivateMediaAsset(descriptor('active-map', 4, {
      width: 4,
      height: 4,
    }));
    const crossfadeLease = acquirePrivateMediaAsset(descriptor('crossfade-map', 4, {
      width: 4,
      height: 4,
    }));
    const [activeResult] = await Promise.all([
      activeLease.promise,
      crossfadeLease.promise,
    ]);

    expect(getPrivateMediaAssetCacheSnapshot()).toEqual(expect.objectContaining({
      cachedDecodedBytes: 128,
      referencedDecodedBytes: 128,
      unreferencedDecodedBytes: 0,
      recordCount: 2,
    }));

    activeLease.release();
    crossfadeLease.release();
    expect(getPrivateMediaAssetCacheSnapshot()).toEqual(expect.objectContaining({
      cachedDecodedBytes: 64,
      unreferencedDecodedBytes: 64,
      unreferencedRecordCount: 1,
      recordCount: 1,
    }));
    expect(runtime.revokeObjectURL).toHaveBeenCalledWith(activeResult.url);
  });

  test('tracks one bounded delayed release and cancels it on an immediate release', async () => {
    jest.useFakeTimers();
    const value = descriptor('delayed-release', 4);
    createRuntime();
    const lease = acquirePrivateMediaAsset(value);
    await lease.promise;

    lease.release({ delayMs: 10000 });
    expect(getPrivateMediaAssetCacheSnapshot()).toEqual(expect.objectContaining({
      delayedReleaseCount: 1,
      records: [
        expect.objectContaining({ refCount: 1 }),
      ],
    }));

    lease.release();
    expect(getPrivateMediaAssetCacheSnapshot()).toEqual(expect.objectContaining({
      delayedReleaseCount: 0,
      records: [
        expect.objectContaining({ refCount: 0 }),
      ],
    }));
    jest.advanceTimersByTime(10000);
    expect(getPrivateMediaAssetCacheSnapshot().records[0].refCount).toBe(0);
  });

  test('never evicts an active record and revokes it after release when space is needed', async () => {
    let now = 0;
    const runtime = createRuntime({
      maxCacheBytes: 3,
      maxRecords: 2,
      now: () => now,
    });
    const firstValue = descriptor('active-a', 3);
    const secondValue = descriptor('active-b', 3);
    const firstLease = acquirePrivateMediaAsset(firstValue);
    const firstResult = await firstLease.promise;

    const blockedLease = acquirePrivateMediaAsset(secondValue);
    await expect(blockedLease.promise).rejects.toMatchObject({
      code: 'private-media-byte-budget-exceeded',
    });
    blockedLease.release();
    expect(getPrivateMediaAssetCacheSnapshot()).toEqual(expect.objectContaining({
      cachedBytes: 3,
      recordCount: 2,
    }));
    expect(runtime.revokeObjectURL).not.toHaveBeenCalled();

    firstLease.release();
    now = 2000;
    const retryLease = acquirePrivateMediaAsset(secondValue);
    await expect(retryLease.promise).resolves.toEqual(expect.objectContaining({
      url: expect.stringMatching(/^blob:private-/),
    }));
    retryLease.release();

    expect(runtime.revokeObjectURL).toHaveBeenCalledWith(firstResult.url);
    expect(getPrivateMediaAssetCacheSnapshot()).toEqual(expect.objectContaining({
      cachedBytes: 3,
      recordCount: 1,
    }));
  });

  test('caps concurrent authenticated fetches at four', async () => {
    let currentFetches = 0;
    let peakFetches = 0;
    const resolvers = [];
    const runtime = createRuntime({
      maxActiveFetches: 4,
      maxCacheBytes: 20,
      maxRecords: 10,
      getBlobImplementation: jest.fn((_objectRef, bytes) => new Promise((resolve) => {
        currentFetches += 1;
        peakFetches = Math.max(peakFetches, currentFetches);
        resolvers.push(() => {
          currentFetches -= 1;
          resolve(new Blob(['x'.repeat(bytes)], { type: 'image/webp' }));
        });
      })),
    });
    const leases = Array.from({ length: 6 }, (_, index) => (
      acquirePrivateMediaAsset(descriptor(`concurrent-${index}`, 1))
    ));

    await flushAsync();
    expect(runtime.getBlob).toHaveBeenCalledTimes(4);
    expect(getPrivateMediaAssetCacheSnapshot().activeFetches).toBe(4);

    resolvers.splice(0, 2).forEach((resolve) => resolve());
    await flushAsync();
    expect(runtime.getBlob).toHaveBeenCalledTimes(6);

    resolvers.splice(0).forEach((resolve) => resolve());
    await Promise.all(leases.map((lease) => lease.promise));
    leases.forEach((lease) => lease.release());

    expect(peakFetches).toBe(4);
    expect(getPrivateMediaAssetCacheSnapshot().activeFetches).toBe(0);
  });

  test('reaches a stable record and compressed-byte plateau under repeated churn', async () => {
    const runtime = createRuntime({
      maxCacheBytes: 6,
      maxRecords: 3,
    });

    for (let index = 0; index < 12; index += 1) {
      const lease = acquirePrivateMediaAsset(descriptor(`plateau-${index}`, 2));
      await lease.promise;
      lease.release();
      const snapshot = getPrivateMediaAssetCacheSnapshot();
      expect(snapshot.recordCount).toBeLessThanOrEqual(3);
      expect(snapshot.cachedBytes).toBeLessThanOrEqual(6);
    }

    expect(getPrivateMediaAssetCacheSnapshot()).toEqual(expect.objectContaining({
      recordCount: 3,
      cachedBytes: 6,
    }));
    expect(runtime.revokeObjectURL).toHaveBeenCalledTimes(9);
  });
});
