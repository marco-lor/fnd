import {
  __configureImageAssetRegistryForTests,
  __getImageAssetRegistryStats,
  __resetImageAssetRegistry,
  IMAGE_ASSET_REGISTRY_LIMITS,
  ensureImageAsset,
  getImageAssetSnapshot,
  preloadImageAssets,
  retainImageAsset,
  scheduleImageAssetPreload,
  subscribeToImageAsset,
} from '../common/imageAssets/imageAssetRegistry';

const flushPromiseJobs = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('imageAssetRegistry', () => {
  const originalImage = global.Image;
  const originalRequestIdleCallback = window.requestIdleCallback;
  const originalCancelIdleCallback = window.cancelIdleCallback;
  let imageConstructorCallCount = 0;

  beforeEach(() => {
    imageConstructorCallCount = 0;

    class MockImage {
      constructor() {
        imageConstructorCallCount += 1;
        this.complete = false;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }

      set src(value) {
        this._src = value;

        Promise.resolve().then(() => {
          if (value.includes('broken')) {
            this.onerror?.(new Error('broken image'));
            return;
          }

          this.complete = true;
          this.naturalWidth = 240;
          this.naturalHeight = 160;
          this.onload?.();
        });
      }

      get src() {
        return this._src;
      }
    }

    global.Image = MockImage;
    __resetImageAssetRegistry();
  });

  afterEach(() => {
    __resetImageAssetRegistry();
    global.Image = originalImage;
    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
    jest.useRealTimers();
  });

  test('reuses a single in-flight image load for duplicate URLs', async () => {
    const src = 'https://example.com/map.png';
    const firstPromise = ensureImageAsset(src);
    const secondPromise = ensureImageAsset(src);

    expect(imageConstructorCallCount).toBe(1);

    const [firstImage, secondImage] = await Promise.all([firstPromise, secondPromise]);

    expect(firstImage).toBe(secondImage);
    expect(getImageAssetSnapshot(src)).toEqual({
      status: 'loaded',
      image: firstImage,
      error: null,
    });
  });

  test('notifies subscribers during load and preserves the cached image for later preloads', async () => {
    const src = 'https://example.com/token.png';
    const statuses = [];
    const unsubscribe = subscribeToImageAsset(src, (snapshot) => {
      statuses.push(snapshot.status);
    });

    const firstImage = await ensureImageAsset(src);
    const [secondImage] = await preloadImageAssets([src]);

    expect(statuses).toEqual(['loading', 'loaded']);
    expect(secondImage).toBe(firstImage);
    expect(imageConstructorCallCount).toBe(1);
    expect(__getImageAssetRegistryStats().referencedRecordCount).toBe(1);

    unsubscribe();
    expect(__getImageAssetRegistryStats().referencedRecordCount).toBe(0);
  });

  test('keeps snapshots referentially stable until the asset state changes', async () => {
    const src = 'https://example.com/stable-map.png';
    const loadPromise = ensureImageAsset(src);
    const loadingSnapshot = getImageAssetSnapshot(src);

    expect(getImageAssetSnapshot(src)).toBe(loadingSnapshot);
    expect(loadingSnapshot.status).toBe('loading');

    await loadPromise;

    const loadedSnapshot = getImageAssetSnapshot(src);
    expect(loadedSnapshot).not.toBe(loadingSnapshot);
    expect(getImageAssetSnapshot(src)).toBe(loadedSnapshot);
    expect(loadedSnapshot.status).toBe('loaded');
  });

  test('falls back to timer-based deferred preloads when requestIdleCallback is unavailable', () => {
    jest.useFakeTimers();
    window.requestIdleCallback = undefined;
    window.cancelIdleCallback = undefined;

    scheduleImageAssetPreload(['https://example.com/deferred-map.png']);

    expect(imageConstructorCallCount).toBe(0);

    jest.advanceTimersByTime(32);

    expect(imageConstructorCallCount).toBe(1);
  });

  test('cancels timer-based deferred preloads before they start', () => {
    jest.useFakeTimers();
    window.requestIdleCallback = undefined;
    window.cancelIdleCallback = undefined;

    const cancelPreload = scheduleImageAssetPreload(['https://example.com/cancelled-map.png']);
    cancelPreload();

    jest.advanceTimersByTime(32);

    expect(imageConstructorCallCount).toBe(0);
  });

  test('publishes stable production limits and caps concurrent preload requests', async () => {
    const instances = [];
    let activeRequestCount = 0;
    let maximumActiveRequestCount = 0;

    class DeferredImage {
      constructor() {
        imageConstructorCallCount += 1;
        this.complete = false;
        this.naturalWidth = 20;
        this.naturalHeight = 10;
        this.settled = false;
        instances.push(this);
        activeRequestCount += 1;
        maximumActiveRequestCount = Math.max(maximumActiveRequestCount, activeRequestCount);
      }

      set src(value) {
        this._src = value;
      }

      get src() {
        return this._src;
      }

      succeed() {
        if (this.settled) {
          return;
        }
        this.settled = true;
        this.complete = true;
        activeRequestCount -= 1;
        this.onload?.();
      }
    }

    global.Image = DeferredImage;
    expect(__getImageAssetRegistryStats().limits).toEqual(IMAGE_ASSET_REGISTRY_LIMITS);
    __configureImageAssetRegistryForTests({ maxConcurrentRequests: 2 });

    const srcs = Array.from(
      { length: 5 },
      (_, index) => `https://example.com/concurrent-${index}.png`
    );
    const preloadPromise = preloadImageAssets(srcs);

    expect(instances).toHaveLength(2);
    expect(__getImageAssetRegistryStats()).toMatchObject({
      activeRequestCount: 2,
      queuedRequestCount: 0,
    });

    instances[0].succeed();
    instances[1].succeed();
    await flushPromiseJobs();
    expect(instances).toHaveLength(4);

    instances[2].succeed();
    instances[3].succeed();
    await flushPromiseJobs();
    expect(instances).toHaveLength(5);

    instances[4].succeed();
    const results = await preloadPromise;

    expect(results.map((image) => image.src)).toEqual(srcs);
    expect(maximumActiveRequestCount).toBe(2);
    expect(__getImageAssetRegistryStats()).toMatchObject({
      activeRequestCount: 0,
      queuedRequestCount: 0,
    });
  });

  test('evicts the least-recently-used unreferenced decoded image under its byte budget', async () => {
    const decodedBytesPerImage = 240 * 160 * 4;
    __configureImageAssetRegistryForTests({
      maxDecodedBytes: decodedBytesPerImage * 2,
    });

    const activeSrc = 'https://example.com/active-map.png';
    const staleSrc = 'https://example.com/stale-map.png';
    const newestSrc = 'https://example.com/newest-map.png';
    const releaseActive = retainImageAsset(activeSrc);

    await ensureImageAsset(activeSrc);
    await ensureImageAsset(staleSrc);
    await ensureImageAsset(newestSrc);

    expect(getImageAssetSnapshot(activeSrc).status).toBe('loaded');
    expect(getImageAssetSnapshot(staleSrc).status).toBe('idle');
    expect(getImageAssetSnapshot(newestSrc).status).toBe('loaded');
    expect(__getImageAssetRegistryStats()).toMatchObject({
      recordCount: 2,
      loadedRecordCount: 2,
      referencedRecordCount: 1,
      decodedBytes: decodedBytesPerImage * 2,
    });

    releaseActive();
  });

  test('keeps active and released crossfade images protected until the release grace expires', async () => {
    jest.useFakeTimers();
    let now = 0;
    const decodedBytesPerImage = 240 * 160 * 4;
    __configureImageAssetRegistryForTests({
      maxDecodedBytes: decodedBytesPerImage,
      releaseProtectionMs: 1000,
      now: () => now,
    });

    const outgoingSrc = 'https://example.com/outgoing-map.png';
    const incomingSrc = 'https://example.com/incoming-map.png';
    const releaseOutgoing = retainImageAsset(outgoingSrc);
    const releaseIncoming = retainImageAsset(incomingSrc);

    await ensureImageAsset(outgoingSrc);
    await ensureImageAsset(incomingSrc);
    expect(__getImageAssetRegistryStats().decodedBytes).toBe(decodedBytesPerImage * 2);

    releaseOutgoing();
    now = 999;
    jest.advanceTimersByTime(999);
    expect(getImageAssetSnapshot(outgoingSrc).status).toBe('loaded');

    now = 1000;
    jest.advanceTimersByTime(1);
    expect(getImageAssetSnapshot(outgoingSrc).status).toBe('idle');
    expect(getImageAssetSnapshot(incomingSrc).status).toBe('loaded');
    expect(__getImageAssetRegistryStats().decodedBytes).toBe(decodedBytesPerImage);

    releaseIncoming();
  });

  test('backs off repeated failures and retries only after the exponential deadline', async () => {
    let now = 0;
    __configureImageAssetRegistryForTests({
      failureBackoffBaseMs: 100,
      failureBackoffMaxMs: 1000,
      now: () => now,
    });

    const src = 'https://example.com/broken-map.png';
    await expect(ensureImageAsset(src)).rejects.toThrow('broken image');
    const firstError = getImageAssetSnapshot(src).error;
    expect(imageConstructorCallCount).toBe(1);

    await expect(ensureImageAsset(src)).rejects.toBe(firstError);
    now = 99;
    await expect(ensureImageAsset(src)).rejects.toBe(firstError);
    expect(imageConstructorCallCount).toBe(1);

    now = 100;
    await expect(ensureImageAsset(src)).rejects.toThrow('broken image');
    const secondError = getImageAssetSnapshot(src).error;
    expect(secondError).not.toBe(firstError);
    expect(imageConstructorCallCount).toBe(2);

    now = 299;
    await expect(ensureImageAsset(src)).rejects.toBe(secondError);
    expect(imageConstructorCallCount).toBe(2);

    now = 300;
    await expect(ensureImageAsset(src)).rejects.toThrow('broken image');
    expect(imageConstructorCallCount).toBe(3);
  });

  test('plateaus while cycling 50 maps and a large token list without redownloading the active map', async () => {
    __configureImageAssetRegistryForTests({
      maxConcurrentRequests: 4,
      maxDecodedBytes: Number.MAX_SAFE_INTEGER,
      maxRecords: 12,
    });
    const activeMap = 'https://example.com/active-soak-map.png';
    const releaseActiveMap = retainImageAsset(activeMap);
    await ensureImageAsset(activeMap);
    const mapSources = Array.from(
      { length: 50 },
      (_, index) => `https://example.com/map-cycle-${index}.png`
    );
    const tokenSources = Array.from(
      { length: 120 },
      (_, index) => `https://example.com/token-list-${index}.png`
    );

    const results = await preloadImageAssets([...mapSources, ...tokenSources]);
    expect(results).toHaveLength(mapSources.length + tokenSources.length);
    expect(results.every(Boolean)).toBe(true);
    expect(__getImageAssetRegistryStats()).toMatchObject({
      recordCount: 12,
      loadedRecordCount: 12,
      referencedRecordCount: 1,
      activeRequestCount: 0,
      queuedRequestCount: 0,
    });

    const constructorCountAfterPreload = imageConstructorCallCount;
    await ensureImageAsset(activeMap);
    expect(imageConstructorCallCount).toBe(constructorCountAfterPreload);

    await ensureImageAsset(mapSources[0]);
    expect(imageConstructorCallCount).toBe(constructorCountAfterPreload + 1);
    expect(__getImageAssetRegistryStats().recordCount).toBe(12);
    expect(getImageAssetSnapshot(activeMap).status).toBe('loaded');

    releaseActiveMap();
  });
});
