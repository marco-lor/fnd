import {
  __configurePrivateMediaAssetsForTests,
  __resetPrivateMediaAssetsForTests,
  acquirePrivateMediaAsset,
  getPrivateMediaAssetCacheSnapshot,
  getPrivateMediaDrawableIdentity,
  PRIVATE_MEDIA_MAX_CACHE_BYTES,
} from './privateMediaAssets';

const MiB = 1024 * 1024;
const PORTRAIT = { maxDrawableEdge: 512 };

const canonicalAssetId = (id) => `m_${Array.from(String(id))
  .map((character) => character.charCodeAt(0).toString(16))
  .join('')
  .padEnd(40, '0')
  .slice(0, 40)}`;

const descriptor = (id, bytes, overrides = {}) => ({
  path: `media_assets/v1/signed-in/owner/${canonicalAssetId(id)}/11/thumbnail`,
  generation: '11',
  bytes,
  contentType: 'image/webp',
  width: 96,
  height: 96,
  ...overrides,
});

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const configure = ({ deferred = false, session = { actor: 'user-a', generation: 1 }, ...overrides } = {}) => {
  const finishers = new Map();
  const authSession = { ...session };
  const getBlob = jest.fn((objectRef, size) => {
    if (!deferred) return Promise.resolve({ size, type: 'image/webp' });
    return new Promise((resolve, reject) => {
      const queue = finishers.get(objectRef.path) || [];
      queue.push({ resolve: () => resolve({ size, type: 'image/webp' }), reject });
      finishers.set(objectRef.path, queue);
    });
  });
  let urlCount = 0;
  const revokeObjectURL = jest.fn();
  __configurePrivateMediaAssetsForTests({
    loadStorageApi: jest.fn(async () => ({
      storage: {},
      ref: (_storage, path) => ({ path }),
      getBlob,
    })),
    createObjectURL: jest.fn((blob) => {
      urlCount += 1;
      return `blob:lifecycle-${blob.size}-${urlCount}`;
    }),
    revokeObjectURL,
    getAuthSession: () => ({ ...authSession }),
    ...overrides,
  });
  return {
    authSession,
    getBlob,
    revokeObjectURL,
    // Settles the oldest pending download of that path.
    finish: (value) => finishers.get(value.path).shift().resolve(),
    fail: (value, error) => finishers.get(value.path).shift().reject(error),
  };
};

const identityScopeOf = (value) => {
  const identity = getPrivateMediaDrawableIdentity(value);
  return identity ? JSON.parse(JSON.parse(identity)[7]) : null;
};

const recordFor = (value) => getPrivateMediaAssetCacheSnapshot().records
  .find((record) => record.path === value.path);

describe('private media holder lifecycle', () => {
  afterEach(() => {
    __resetPrivateMediaAssetsForTests();
  });

  test.each(['encoded', 'decoded'])('retains failed thumbnail backoff while reclaiming %s bytes', async (resource) => {
    const {getBlob} = configure({
      now: () => 0,
      maxCacheBytes: 64,
      maxDecodedBytes: resource === 'decoded' ? 256 : 1024,
      maxTotalDecodedBytes: resource === 'decoded' ? 256 : 1024,
    });
    const map = acquirePrivateMediaAsset(descriptor('map', resource === 'encoded' ? 64 : 8, {width: 8, height: 8}));
    await map.promise;
    const missing = descriptor('missing', 1, {width: 2, height: 2});
    getBlob.mockRejectedValueOnce(new Error('missing thumbnail'));
    const first = acquirePrivateMediaAsset(missing, PORTRAIT);
    await expect(first.promise).rejects.toThrow('missing thumbnail');
    first.release();

    const visible = acquirePrivateMediaAsset(descriptor('visible', 1, {width: 2, height: 2}), PORTRAIT);
    await visible.promise;
    const retry = acquirePrivateMediaAsset(missing, PORTRAIT);
    await expect(retry.promise).rejects.toThrow('missing thumbnail');
    expect(getBlob.mock.calls.filter(([ref]) => ref.path === missing.path)).toHaveLength(1);
    retry.release();
    visible.release();
    map.release();
  });

  describe('full-resolution holders never take over the transient portrait lane', () => {
    const map = descriptor('active-map', PRIVATE_MEDIA_MAX_CACHE_BYTES, {
      path: `media_assets/v1/signed-in/owner/${canonicalAssetId('active-map')}/11/original`,
    });
    const portrait = descriptor('turn-portrait', 8 * MiB, { width: 1024, height: 1024 });
    const nextPortrait = descriptor('next-portrait', 64 * 1024);

    const expectNextPortraitAdmitted = async (deferredRuntime = null) => {
      const next = acquirePrivateMediaAsset(nextPortrait, PORTRAIT);
      if (deferredRuntime) {
        await flushAsync();
        deferredRuntime.finish(nextPortrait);
      }
      await expect(next.promise).resolves.toHaveProperty('url');
      next.release();
    };

    test('portrait first: a chip for the same ready path waits instead of widening', async () => {
      configure();
      const mapLease = acquirePrivateMediaAsset(map);
      await mapLease.promise;
      const portraitLease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await portraitLease.promise;
      expect(getPrivateMediaAssetCacheSnapshot().transientOverageBytes).toBe(8 * MiB);

      const chip = acquirePrivateMediaAsset(portrait);
      await expect(chip.promise).rejects.toMatchObject({
        code: 'private-media-byte-budget-exceeded',
        capacityPressure: true,
      });
      chip.release();
      // The rejected chip did not join or widen the bounded record.
      expect(recordFor(portrait)).toMatchObject({
        refCount: 1,
        drawableEdge: 512,
        decodedBytes: 512 * 512 * 4,
      });

      portraitLease.release();
      await flushAsync();
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        cachedBytes: PRIVATE_MEDIA_MAX_CACHE_BYTES,
        transientOverageBytes: 0,
        reservedBytes: 0,
        reservedDecodedBytes: 0,
      });
      await expectNextPortraitAdmitted();
      mapLease.release();
    });

    test('chip first: the chip is refused ordinary admission, the portrait still uses the lane', async () => {
      const runtime = configure();
      const mapLease = acquirePrivateMediaAsset(map);
      await mapLease.promise;
      const chip = acquirePrivateMediaAsset(portrait);
      await expect(chip.promise).rejects.toMatchObject({ capacityPressure: true });
      chip.release();

      const portraitLease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await portraitLease.promise;
      const refusedChip = acquirePrivateMediaAsset(portrait);
      await expect(refusedChip.promise).rejects.toMatchObject({ capacityPressure: true });
      refusedChip.release();
      portraitLease.release();
      await expectNextPortraitAdmitted();
      // Pressure never downloads: one portrait fetch, one next-portrait fetch.
      expect(runtime.getBlob).toHaveBeenCalledTimes(3);
      mapLease.release();
    });

    test('a chip joining an in-flight lane portrait is refused without disturbing it', async () => {
      const runtime = configure({ deferred: true });
      const mapLease = acquirePrivateMediaAsset(map);
      await flushAsync();
      runtime.finish(map);
      await mapLease.promise;
      const portraitLease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await flushAsync();
      expect(getPrivateMediaAssetCacheSnapshot().reservedBytes).toBe(8 * MiB);

      const refusedChip = acquirePrivateMediaAsset(portrait);
      await expect(refusedChip.promise).rejects.toMatchObject({ capacityPressure: true });
      refusedChip.release();
      runtime.finish(portrait);
      await expect(portraitLease.promise).resolves.toHaveProperty('url');
      expect(recordFor(portrait)).toMatchObject({ refCount: 1, drawableEdge: 512 });
      portraitLease.release();
      await expectNextPortraitAdmitted(runtime);
      mapLease.release();
    });

    test('a chip shares the record when its normal budgets allow, and unmount order narrows it back', async () => {
      configure();
      const halfMap = descriptor('half-map', 16 * MiB, {
        path: `media_assets/v1/signed-in/owner/${canonicalAssetId('half-map')}/11/original`,
      });
      const mapLease = acquirePrivateMediaAsset(halfMap);
      await mapLease.promise;

      // Portrait, then chip, then the chip unmounts first.
      const portraitLease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await portraitLease.promise;
      const chip = acquirePrivateMediaAsset(portrait);
      await expect(chip.promise).resolves.toHaveProperty('url');
      expect(recordFor(portrait)).toMatchObject({
        refCount: 2,
        drawableEdge: 0,
        decodedBytes: 1024 * 1024 * 4,
      });
      chip.release();
      expect(recordFor(portrait)).toMatchObject({
        refCount: 1,
        drawableEdge: 512,
        decodedBytes: 512 * 512 * 4,
      });

      // Chip joins again, then the portrait unmounts first: the chip keeps an
      // ordinary, in-budget record and nothing is left in the transient lane.
      const secondChip = acquirePrivateMediaAsset(portrait);
      await secondChip.promise;
      portraitLease.release();
      expect(recordFor(portrait)).toMatchObject({ refCount: 1, drawableEdge: 0 });
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        cachedBytes: 24 * MiB,
        transientOverageBytes: 0,
      });
      await expectNextPortraitAdmitted();
      secondChip.release();
      mapLease.release();
      expect(getPrivateMediaAssetCacheSnapshot().records.every((record) => record.refCount === 0))
        .toBe(true);
    });

    test('a chip keeps exact immutable metadata checks', async () => {
      configure();
      const portraitLease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await portraitLease.promise;
      expect(() => acquirePrivateMediaAsset({ ...portrait, width: 1000 })).toThrow(
        expect.objectContaining({ code: 'private-media-descriptor-conflict' })
      );
      portraitLease.release();
    });

    test('widening during an admitted fetch moves the decoded reservation with the holders', async () => {
      const runtime = configure({ deferred: true });
      const portraitLease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await flushAsync();
      expect(getPrivateMediaAssetCacheSnapshot().reservedDecodedBytes).toBe(512 * 512 * 4);
      const chip = acquirePrivateMediaAsset(portrait);
      expect(getPrivateMediaAssetCacheSnapshot().reservedDecodedBytes).toBe(1024 * 1024 * 4);
      chip.release();
      expect(getPrivateMediaAssetCacheSnapshot().reservedDecodedBytes).toBe(512 * 512 * 4);
      runtime.finish(portrait);
      await portraitLease.promise;
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        reservedDecodedBytes: 0,
        cachedDecodedBytes: 512 * 512 * 4,
      });
      portraitLease.release();
    });
  });

  describe('decoded admissions are reservations', () => {
    // maxTotalDecodedBytes=256: an 8x8 map uses exactly the whole normal cap
    // and a 2x2 bounded portrait (16 bytes) shares the bounded overage.
    const decodedMap = descriptor('decoded-map', 4, {
      path: `media_assets/v1/signed-in/owner/${canonicalAssetId('decoded-map')}/11/original`,
      width: 8,
      height: 8,
    });
    const decodedPortrait = descriptor('decoded-portrait', 4, { width: 2, height: 2 });

    test('a previous session holding the same portrait still uses its decoded allowance', async () => {
      const runtime = configure({maxDecodedBytes: 256, maxTotalDecodedBytes: 256, maxBoundedDecodeOverageBytes: 16});
      const map = acquirePrivateMediaAsset(decodedMap);
      await map.promise;
      const previous = acquirePrivateMediaAsset(decodedPortrait, PORTRAIT);
      await previous.promise;
      runtime.authSession.generation += 1;
      const next = acquirePrivateMediaAsset(decodedPortrait, PORTRAIT);
      await expect(next.promise).rejects.toMatchObject({code: 'private-media-decoded-budget-exceeded'});
      expect(runtime.getBlob).toHaveBeenCalledTimes(2);
      next.release();
      previous.release();
      const retry = acquirePrivateMediaAsset(decodedPortrait, PORTRAIT);
      await expect(retry.promise).resolves.toHaveProperty('url');
      retry.release();
      map.release();
    });

    test.each(['portrait', 'map'])('keeps both admitted leases valid when the %s finishes first', async (first) => {
      const runtime = configure({
        deferred: true,
        maxDecodedBytes: 256,
        maxTotalDecodedBytes: 256,
      });
      const mapLease = acquirePrivateMediaAsset(decodedMap);
      const portraitLease = acquirePrivateMediaAsset(decodedPortrait, PORTRAIT);
      await flushAsync();
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        reservedDecodedBytes: 272,
        cachedDecodedBytes: 0,
      });

      // Other ordinary work is bounded by the reservations.
      const newcomer = acquirePrivateMediaAsset(descriptor('decoded-newcomer', 4, {
        width: 1,
        height: 1,
      }));
      await expect(newcomer.promise).rejects.toMatchObject({
        code: 'private-media-decoded-budget-exceeded',
        capacityPressure: true,
      });
      newcomer.release();

      const order = first === 'portrait'
        ? [[decodedPortrait, portraitLease], [decodedMap, mapLease]]
        : [[decodedMap, mapLease], [decodedPortrait, portraitLease]];
      for (const [value, lease] of order) {
        runtime.finish(value);
        // eslint-disable-next-line no-await-in-loop
        await expect(lease.promise).resolves.toHaveProperty('url');
      }
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        reservedDecodedBytes: 0,
        cachedDecodedBytes: 272,
        reservedBytes: 0,
      });
      expect(recordFor(decodedMap)).toMatchObject({ status: 'ready', refCount: 1, decodedBytes: 256 });
      expect(recordFor(decodedPortrait)).toMatchObject({ status: 'ready', refCount: 1, decodedBytes: 16 });
      portraitLease.release();
      mapLease.release();
    });

    test('a failed admitted fetch returns its decoded reservation', async () => {
      const runtime = configure({ deferred: true, maxDecodedBytes: 256, maxTotalDecodedBytes: 256 });
      const mapLease = acquirePrivateMediaAsset(decodedMap);
      await flushAsync();
      runtime.fail(decodedMap, new Error('network'));
      await expect(mapLease.promise).rejects.toThrow('network');
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        reservedDecodedBytes: 0,
        reservedBytes: 0,
      });
      mapLease.release();
    });
  });

  describe('drawable identity authorization', () => {
    const portrait = descriptor('identity-portrait', 4, { width: 1024, height: 1024 });

    test('is issued only for bytes downloaded under the current exact auth scope', async () => {
      const runtime = configure();
      expect(getPrivateMediaDrawableIdentity(portrait)).toBe('');
      const lease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await lease.promise;
      lease.release();
      const identity = getPrivateMediaDrawableIdentity(portrait);
      expect(identity).toContain(portrait.path);
      expect(getPrivateMediaDrawableIdentity({ ...portrait })).toBe(identity);

      // Changed metadata for the same immutable path is never matched.
      expect(getPrivateMediaDrawableIdentity({ ...portrait, width: 512 })).toBe('');
      expect(getPrivateMediaDrawableIdentity({ ...portrait, bytes: 5 })).toBe('');

      // Another session generation (e.g. a role change) or another actor.
      runtime.authSession.generation = 2;
      expect(getPrivateMediaDrawableIdentity(portrait)).toBe('');
      runtime.authSession.generation = 1;
      expect(getPrivateMediaDrawableIdentity(portrait)).toBe(identity);
      runtime.authSession.actor = 'user-b';
      expect(getPrivateMediaDrawableIdentity(portrait)).toBe('');
    });

    test('is not issued when the scope changed during the download', async () => {
      const runtime = configure({ deferred: true });
      const lease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await flushAsync();
      runtime.authSession.generation = 2;
      runtime.finish(portrait);
      await lease.promise;
      lease.release();
      expect(getPrivateMediaDrawableIdentity(portrait)).toBe('');
    });

    test('a failed fetch of the same bytes revokes reuse', async () => {
      const runtime = configure({ deferred: true, maxCacheBytes: 4 });
      const lease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await flushAsync();
      runtime.finish(portrait);
      await lease.promise;
      lease.release();
      expect(getPrivateMediaDrawableIdentity(portrait)).not.toBe('');

      // Evict the blob, then a new authenticated fetch is denied.
      const other = acquirePrivateMediaAsset(descriptor('identity-evictor', 4));
      await flushAsync();
      runtime.finish(descriptor('identity-evictor', 4));
      await other.promise;
      other.release();
      const denied = acquirePrivateMediaAsset(portrait);
      await flushAsync();
      runtime.fail(portrait, Object.assign(new Error('denied'), { code: 'storage/unauthorized' }));
      await expect(denied.promise).rejects.toThrow('denied');
      denied.release();
      expect(getPrivateMediaDrawableIdentity(portrait)).toBe('');
    });

    test.each([
      { label: 'another actor', next: { actor: 'user-b', generation: 2 } },
      { label: 'the same actor after an access-generation change', next: { actor: 'user-a', generation: 2 } },
    ])('never serves held ready bytes to $label', async ({ next }) => {
      const runtime = configure();
      const lease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      const firstUrl = (await lease.promise).url;

      Object.assign(runtime.authSession, next);
      // The old-scope holder keeps its URL; the new scope downloads anew.
      const nextLease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      const nextUrl = (await nextLease.promise).url;
      expect(nextUrl).not.toBe(firstUrl);
      expect(runtime.getBlob).toHaveBeenCalledTimes(2);
      expect(runtime.revokeObjectURL).not.toHaveBeenCalledWith(firstUrl);
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        detachedRecordCount: 1,
        cachedBytes: 8,
      });
      expect(identityScopeOf(portrait)).toEqual([next.actor, next.generation]);

      lease.release();
      expect(runtime.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        detachedRecordCount: 0,
        cachedBytes: 4,
      });
      nextLease.release();
    });

    test('drops idle ready bytes after a same-actor generation change', async () => {
      const runtime = configure();
      const lease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      const firstUrl = (await lease.promise).url;
      lease.release();

      runtime.authSession.generation = 2;
      const nextLease = acquirePrivateMediaAsset(portrait);
      await expect(nextLease.promise).resolves.not.toHaveProperty('url', firstUrl);
      expect(runtime.getBlob).toHaveBeenCalledTimes(2);
      expect(runtime.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
      nextLease.release();
    });

    test('does not join an in-flight download started under the previous generation', async () => {
      const runtime = configure({ deferred: true });
      const oldLease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await flushAsync();
      runtime.authSession.generation = 2;
      const newLease = acquirePrivateMediaAsset(portrait, PORTRAIT);
      await flushAsync();
      expect(runtime.getBlob).toHaveBeenCalledTimes(2);
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        detachedRecordCount: 1,
        reservedBytes: 8,
      });

      // The old-scope holder leaves while its download is in flight; when
      // that download settles its bytes are freed, never cached for anyone.
      oldLease.release();
      runtime.finish(portrait);
      await flushAsync();
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        detachedRecordCount: 0,
        cachedBytes: 0,
        reservedBytes: 4,
      });
      expect(runtime.revokeObjectURL).toHaveBeenCalledTimes(1);

      runtime.finish(portrait);
      const newUrl = (await newLease.promise).url;
      expect(runtime.revokeObjectURL).not.toHaveBeenCalledWith(newUrl);
      expect(identityScopeOf(portrait)).toEqual(['user-a', 2]);
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({ cachedBytes: 4, reservedBytes: 0 });
      newLease.release();
    });
  });
});
