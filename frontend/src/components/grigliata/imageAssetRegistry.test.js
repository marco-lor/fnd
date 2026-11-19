import {
  __configureImageAssetRegistryForTests,
  __getImageAssetRegistryStats,
  __resetImageAssetRegistry,
  IMAGE_ASSET_PIN_NAMES,
  IMAGE_ASSET_REGISTRY_LIMITS,
  ensureImageAsset,
  getImageAssetRegistryRuntimeLimits,
  getImageAssetSnapshot,
  preloadImageAssets,
  pinImageAsset,
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

  test('binds timer fallbacks to the browser window receiver', () => {
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    const timerReceivers = [];
    window.requestIdleCallback = undefined;
    window.cancelIdleCallback = undefined;
    window.setTimeout = function setTimeoutWithRequiredReceiver() {
      timerReceivers.push(this);
      if (this !== window) throw new TypeError('Illegal invocation');
      return 17;
    };
    window.clearTimeout = function clearTimeoutWithRequiredReceiver() {
      timerReceivers.push(this);
      if (this !== window) throw new TypeError('Illegal invocation');
    };

    try {
      const cancelPreload = scheduleImageAssetPreload([
        'https://example.com/window-bound-timer.png',
      ]);
      cancelPreload();
      expect(timerReceivers).toEqual([window, window]);
    } finally {
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
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
    expect(IMAGE_ASSET_REGISTRY_LIMITS).toMatchObject({
      profile: 'desktop',
      maxConcurrentRequests: 4,
      maxRecords: 96,
      maxDecodedBytes: 128 * 1024 * 1024,
      maxTotalDecodedBytes: 384 * 1024 * 1024,
      maxLowPriorityQueueSize: 32,
      failureBackoffMs: [1000, 5000, 30000],
    });
    expect(getImageAssetRegistryRuntimeLimits({ compact: true })).toMatchObject({
      profile: 'compact',
      maxConcurrentRequests: 2,
      maxRecords: 64,
      maxDecodedBytes: 64 * 1024 * 1024,
      maxTotalDecodedBytes: 320 * 1024 * 1024,
      maxLowPriorityQueueSize: 16,
      failureBackoffMs: [1000, 5000, 30000],
    });
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

  test('bounds the low-priority queue while preserving visible request priority', async () => {
    const instances = [];
    class DeferredImage {
      constructor() {
        imageConstructorCallCount += 1;
        this.naturalWidth = 20;
        this.naturalHeight = 10;
        instances.push(this);
      }

      set src(value) {
        this._src = value;
      }

      get src() {
        return this._src;
      }

      succeed() {
        this.onload?.();
      }
    }
    global.Image = DeferredImage;
    __configureImageAssetRegistryForTests({
      maxConcurrentRequests: 1,
      maxLowPriorityQueueSize: 2,
    });

    const first = ensureImageAsset('https://example.com/low-1.png', { priority: 'low' });
    const second = ensureImageAsset('https://example.com/low-2.png', { priority: 'low' });
    const third = ensureImageAsset('https://example.com/low-3.png', { priority: 'low' });
    await expect(
      ensureImageAsset('https://example.com/low-dropped.png', { priority: 'low' })
    ).resolves.toBeNull();
    const visible = ensureImageAsset('https://example.com/visible.png');

    expect(__getImageAssetRegistryStats()).toMatchObject({
      activeRequestCount: 1,
      queuedRequestCount: 3,
      lowPriorityQueuedRequestCount: 2,
      droppedLowPriorityRequestCount: 1,
    });

    instances[0].succeed();
    await flushPromiseJobs();
    expect(instances[1].src).toBe('https://example.com/visible.png');
    instances[1].succeed();
    await flushPromiseJobs();
    instances[2].succeed();
    await flushPromiseJobs();
    instances[3].succeed();

    await expect(Promise.all([first, second, third, visible])).resolves.toHaveLength(4);
    expect(__getImageAssetRegistryStats()).toMatchObject({
      activeRequestCount: 0,
      queuedRequestCount: 0,
      lowPriorityQueuedRequestCount: 0,
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

  test('excludes explicit active/crossfade pins from settled unpinned caps and exposes redacted pin stats', async () => {
    const decodedBytesPerImage = 240 * 160 * 4;
    __configureImageAssetRegistryForTests({
      maxDecodedBytes: decodedBytesPerImage,
      maxTotalDecodedBytes: decodedBytesPerImage * 3,
      maxRecords: 1,
      releaseProtectionMs: 0,
    });

    const activeSrc = 'https://example.com/pinned-active-map.png';
    const outgoingSrc = 'https://example.com/pinned-outgoing-map.png';
    const coldSrc = 'https://example.com/unpinned-cold-map.png';
    const releaseActivePin = pinImageAsset(activeSrc, IMAGE_ASSET_PIN_NAMES.ACTIVE_BOARD);
    const releaseOutgoingPin = pinImageAsset(outgoingSrc, IMAGE_ASSET_PIN_NAMES.CROSSFADE);

    await ensureImageAsset(activeSrc);
    await ensureImageAsset(outgoingSrc);
    await ensureImageAsset(coldSrc);

    expect(getImageAssetSnapshot(activeSrc).status).toBe('loaded');
    expect(getImageAssetSnapshot(outgoingSrc).status).toBe('loaded');
    expect(__getImageAssetRegistryStats()).toMatchObject({
      recordCount: 3,
      pinnedRecordCount: 2,
      unpinnedRecordCount: 1,
      pinnedDecodedBytes: decodedBytesPerImage * 2,
      unpinnedDecodedBytes: decodedBytesPerImage,
      namedPins: [
        IMAGE_ASSET_PIN_NAMES.ACTIVE_BOARD,
        IMAGE_ASSET_PIN_NAMES.CROSSFADE,
      ],
    });

    releaseActivePin();
    releaseOutgoingPin();
    expect(__getImageAssetRegistryStats().pinnedRecordCount).toBe(0);
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

  test('backs off repeated failures on the deterministic 1s/5s/30s schedule', async () => {
    let now = 0;
    __configureImageAssetRegistryForTests({
      failureBackoffMs: [100, 500, 1000],
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

    now = 599;
    await expect(ensureImageAsset(src)).rejects.toBe(secondError);
    expect(imageConstructorCallCount).toBe(2);

    now = 600;
    await expect(ensureImageAsset(src)).rejects.toThrow('broken image');
    expect(imageConstructorCallCount).toBe(3);
  });

  test.each([
    { profile: 'desktop', compact: false },
    { profile: 'compact', compact: true },
  ])('settles 200 distinct and 80 shared on-screen portraits under the $profile budget without reloads', async ({
    compact,
  }) => {
    jest.useFakeTimers();
    let now = 0;
    const limits = getImageAssetRegistryRuntimeLimits({ compact });
    __configureImageAssetRegistryForTests({ ...limits, now: () => now });
    const decodedBytesPerImage = 240 * 160 * 4;
    let inFlightLoads = 0;
    let maxInFlightLoads = 0;
    const loadedSrcs = [];

    class CountingImage {
      constructor() {
        imageConstructorCallCount += 1;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }

      set src(value) {
        this._src = value;
        if (!value) return;
        inFlightLoads += 1;
        maxInFlightLoads = Math.max(maxInFlightLoads, inFlightLoads);
        Promise.resolve().then(() => {
          inFlightLoads -= 1;
          this.naturalWidth = 240;
          this.naturalHeight = 160;
          loadedSrcs.push(value);
          this.onload?.();
        });
      }

      get src() {
        return this._src;
      }
    }
    global.Image = CountingImage;

    const distinctSrcs = Array.from(
      { length: 200 },
      (_, index) => `https://example.com/portrait-${index}.png`
    );
    const sharedSrc = 'https://example.com/shared-portrait.png';
    const portraitSrcs = [
      ...distinctSrcs,
      ...Array.from({ length: 80 }, () => sharedSrc),
    ];
    // Mirror useImageAssetSnapshot: each mounted token subscribes, then ensures.
    const unsubscribers = portraitSrcs.map((src) => subscribeToImageAsset(src, () => {}));
    const loads = portraitSrcs.map((src) => ensureImageAsset(src));
    expect(distinctSrcs.length + 1).toBeGreaterThan(limits.maxRecords);

    const images = await Promise.all(loads);
    expect(images.every(Boolean)).toBe(true);
    expect(maxInFlightLoads).toBe(limits.maxConcurrentRequests);
    expect(imageConstructorCallCount).toBe(201);
    expect(new Set(loadedSrcs).size).toBe(201);
    portraitSrcs.forEach((src) => {
      expect(getImageAssetSnapshot(src).status).toBe('loaded');
    });

    const settledStats = __getImageAssetRegistryStats();
    expect(settledStats).toMatchObject({
      recordCount: 201,
      loadedRecordCount: 201,
      referencedRecordCount: 201,
      unpinnedRecordCount: 201,
      idleRecordCount: 0,
      idleDecodedBytes: 0,
      decodedBytes: decodedBytesPerImage * 201,
      activeRequestCount: 0,
      queuedRequestCount: 0,
    });
    expect(settledStats.decodedBytes).toBeLessThanOrEqual(limits.maxDecodedBytes);

    // Repeated renders and time passing must not evict or re-request the working set.
    now += limits.releaseProtectionMs * 10;
    jest.advanceTimersByTime(limits.releaseProtectionMs * 10);
    await Promise.all(portraitSrcs.map((src) => ensureImageAsset(src)));
    expect(imageConstructorCallCount).toBe(201);
    expect(__getImageAssetRegistryStats().loadedRecordCount).toBe(201);

    // Panning away releases the leases: after the protection window, idle
    // retention falls back to the unpinned record cap, keeping the most recent.
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    expect(__getImageAssetRegistryStats().idleRecordCount).toBe(201);
    now += limits.releaseProtectionMs;
    jest.advanceTimersByTime(limits.releaseProtectionMs);
    const releasedStats = __getImageAssetRegistryStats();
    expect(releasedStats).toMatchObject({
      recordCount: limits.maxRecords,
      idleRecordCount: limits.maxRecords,
      referencedRecordCount: 0,
      idleDecodedBytes: decodedBytesPerImage * limits.maxRecords,
    });
    expect(getImageAssetSnapshot(sharedSrc).status).toBe('loaded');
    expect(getImageAssetSnapshot(distinctSrcs[0]).status).toBe('idle');

    const retainedSrc = distinctSrcs[distinctSrcs.length - 1];
    const constructorCountBeforeReturn = imageConstructorCallCount;
    await ensureImageAsset(retainedSrc);
    expect(imageConstructorCallCount).toBe(constructorCountBeforeReturn);
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

  describe('bounded token portrait drawables', () => {
    const MAX_EDGE = 512;
    let removedSources;
    let drawableFactory;

    const installSizedImage = (sizeForSrc) => {
      class SizedImage {
        constructor() {
          imageConstructorCallCount += 1;
          this.complete = false;
          this.naturalWidth = 0;
          this.naturalHeight = 0;
        }

        set src(value) {
          this._src = value;
          Promise.resolve().then(() => {
            const [width, height] = sizeForSrc(value);
            this.complete = true;
            this.naturalWidth = width;
            this.naturalHeight = height;
            this.onload?.();
          });
        }

        get src() {
          return this._src;
        }

        removeAttribute(name) {
          if (name !== 'src') return;
          removedSources.push(this._src);
          this._src = '';
        }
      }
      global.Image = SizedImage;
    };

    beforeEach(() => {
      removedSources = [];
      drawableFactory = jest.fn((image, { maxEdge }) => {
        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
        return {
          kind: 'bounded-canvas',
          width: Math.round(image.naturalWidth * scale),
          height: Math.round(image.naturalHeight * scale),
          dataset: {},
        };
      });
    });

    test('caps 100 visible 1024px legacy portraits at one shared bounded drawable each', async () => {
      installSizedImage(() => [1024, 1024]);
      __configureImageAssetRegistryForTests({ createBoundedDrawable: drawableFactory });
      const sources = Array.from(
        { length: 100 },
        (_, index) => `https://example.com/legacy-portrait-${index}.png`
      );
      // Two visible tokens per source share one record.
      const unsubscribes = [...sources, ...sources].map((src) => (
        subscribeToImageAsset(src, () => {}, { maxEdge: MAX_EDGE })
      ));
      await Promise.all(sources.map((src) => ensureImageAsset(src, { maxEdge: MAX_EDGE })));
      await flushPromiseJobs();

      const stats = __getImageAssetRegistryStats();
      expect(imageConstructorCallCount).toBe(100);
      expect(drawableFactory).toHaveBeenCalledTimes(100);
      expect(removedSources.sort()).toEqual([...sources].sort());
      expect(stats).toMatchObject({
        recordCount: 100,
        boundedRecordCount: 100,
        referencedRecordCount: 100,
        decodedBytes: 100 * MAX_EDGE * MAX_EDGE * 4,
      });
      // Previously 100 x 1024^2 x 4 = 400 MiB of referenced, never-evicted decodes.
      expect(stats.decodedBytes).toBeLessThanOrEqual(stats.limits.maxTotalDecodedBytes);
      sources.forEach((src) => {
        const snapshot = getImageAssetSnapshot(src, { maxEdge: MAX_EDGE });
        expect(snapshot.status).toBe('loaded');
        expect(snapshot.image).toMatchObject({
          kind: 'bounded-canvas',
          width: MAX_EDGE,
          height: MAX_EDGE,
          dataset: {
            fndSourceSrc: src,
            fndSourceWidth: '1024',
            fndSourceHeight: '1024',
            fndDrawable: 'bounded-canvas',
          },
        });
      });
      // A full-resolution consumer of the same URL never receives the canvas.
      expect(getImageAssetSnapshot(sources[0]).status).toBe('idle');
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    });

    test.each([
      ['unavailable context', () => null],
      ['drawing failure', () => { throw new Error('canvas allocation failed'); }],
    ])('keeps thumbnails and releases oversized images after a %s', async (_reason, createBoundedDrawable) => {
      installSizedImage((src) => (src.includes('thumb') ? [96, 96] : [2048, 1024]));
      __configureImageAssetRegistryForTests({ createBoundedDrawable });
      const thumb = 'blob:private-thumb';
      const original = 'blob:private-original';
      const thumbImage = await ensureImageAsset(thumb, { maxEdge: MAX_EDGE });
      await expect(ensureImageAsset(original, { maxEdge: MAX_EDGE })).rejects.toThrow('bounded portrait');
      expect(thumbImage).toMatchObject({ naturalWidth: 96, src: thumb });
      expect(removedSources).toEqual([original]);
      expect(__getImageAssetRegistryStats().decodedBytes).toBe(96 * 96 * 4);
    });

    test('downscales wide private originals preserving aspect ratio', async () => {
      installSizedImage(() => [2048, 1024]);
      __configureImageAssetRegistryForTests({ createBoundedDrawable: drawableFactory });
      const drawable = await ensureImageAsset('blob:private-wide', { maxEdge: MAX_EDGE });

      expect(drawable).toMatchObject({ width: 512, height: 256 });
      expect(__getImageAssetRegistryStats().decodedBytes).toBe(512 * 256 * 4);
      expect(removedSources).toEqual(['blob:private-wide']);
    });
  });

  test('starts visible art on screen now before work released by a pan, without cancelling it', async () => {
    const started = [];
    const startedSources = [];
    class ManualImage {
      constructor() {
        this.complete = false;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }

      set src(value) {
        this._src = value;
        // Eviction clears src; only a real URL starts a request.
        if (value) {
          started.push(this);
          startedSources.push(value);
        }
      }

      get src() {
        return this._src;
      }

      succeed() {
        this.complete = true;
        this.naturalWidth = 64;
        this.naturalHeight = 64;
        this.onload?.();
      }
    }
    global.Image = ManualImage;
    __configureImageAssetRegistryForTests({ maxConcurrentRequests: 1 });
    const subscribe = (src) => {
      const unsubscribe = subscribeToImageAsset(src, () => {});
      ensureImageAsset(src).catch(() => null);
      return unsubscribe;
    };

    const oldSources = Array.from({ length: 200 }, (_, index) => `https://example.com/old-${index}.png`);
    const oldUnsubscribes = oldSources.map(subscribe);
    const explicitPreload = ensureImageAsset('https://example.com/preload.png', { priority: 'low' });
    const pinnedSrc = 'https://example.com/pinned-map.png';
    const releasePin = pinImageAsset(pinnedSrc, IMAGE_ASSET_PIN_NAMES.ACTIVE_BOARD);
    ensureImageAsset(pinnedSrc).catch(() => null);
    // Pan: 199 queued old tokens leave the screen; one old token stays.
    oldUnsubscribes.slice(1, 199).forEach((unsubscribe) => unsubscribe());
    oldUnsubscribes[199]();
    const newSrc = 'https://example.com/new-visible.png';
    const unsubscribeNew = subscribe(newSrc);

    expect(startedSources).toEqual([oldSources[0]]);
    // The pinned map and the newly visible portrait run before released work.
    for (let index = 0; index < 2; index += 1) {
      started[index].succeed();
      // eslint-disable-next-line no-await-in-loop
      await flushPromiseJobs();
    }
    expect(startedSources).toEqual([oldSources[0], pinnedSrc, newSrc]);
    started[2].succeed();
    await flushPromiseJobs();

    // Released work is deferred, not cancelled: it still completes in order,
    // and the explicit low-priority preload still runs last.
    expect(startedSources[3]).toBe(oldSources[1]);
    expect(__getImageAssetRegistryStats().queuedRequestCount).toBe(199);
    for (let index = 3; index < started.length || index < 202; index += 1) {
      started[index].succeed();
      // eslint-disable-next-line no-await-in-loop
      await flushPromiseJobs();
    }
    expect(startedSources).toHaveLength(203);
    expect(startedSources.slice(-1)).toEqual(['https://example.com/preload.png']);
    await expect(explicitPreload).resolves.toBeTruthy();
    expect(getImageAssetSnapshot(newSrc).status).toBe('loaded');

    unsubscribeNew();
    oldUnsubscribes[0]();
    releasePin();
  });
});
