import {
  __resetImageAssetRegistry,
  ensureImageAsset,
  getImageAssetSnapshot,
  preloadImageAssets,
  scheduleImageAssetPreload,
  subscribeToImageAsset,
} from './imageAssetRegistry';

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

    unsubscribe();
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
});