import {
  __configureImageAssetRegistryForTests,
  __resetImageAssetRegistry,
  ensureImageAsset,
  getImageAssetSnapshot,
  registerImageAssetSourceIdentity,
  retainImageAssetDrawable,
  subscribeToImageAsset,
} from './imageAssetRegistry';

const BOUNDED = { maxEdge: 64 };

describe('imageAssetRegistry drawable identities', () => {
  const originalImage = window.Image;
  let revoked;
  let pending;
  let constructed;

  const settle = (image) => {
    if (revoked.has(image.src)) image.onerror?.(new Error('revoked'));
    else {
      image.naturalWidth = 256;
      image.naturalHeight = 256;
      image.onload?.();
    }
  };

  beforeEach(() => {
    revoked = new Set();
    pending = [];
    constructed = 0;
    window.Image = class {
      constructor() {
        constructed += 1;
      }

      set src(value) {
        this.currentSrc = value;
        pending.push(this);
      }

      get src() {
        return this.currentSrc;
      }

      removeAttribute() {
        this.currentSrc = '';
      }
    };
    __resetImageAssetRegistry();
    __configureImageAssetRegistryForTests({
      createBoundedDrawable: (_image, { maxEdge, src }) => ({
        width: maxEdge,
        height: maxEdge,
        dataset: {},
        key: `${src}@${maxEdge}`,
      }),
    });
    registerImageAssetSourceIdentity('blob:first', 'identity-1');
    registerImageAssetSourceIdentity('blob:second', 'identity-1');
  });

  afterEach(() => {
    __resetImageAssetRegistry();
    window.Image = originalImage;
  });

  test('bounded URLs of one identity share a drawable; full resolution stays per URL', async () => {
    const unsubscribe = subscribeToImageAsset('blob:first', () => {}, BOUNDED);
    const first = ensureImageAsset('blob:first', BOUNDED);
    pending.splice(0).forEach(settle);
    const drawable = await first;
    expect(drawable.dataset.fndDrawableIdentity).toBe('shared');

    revoked.add('blob:first');
    await expect(ensureImageAsset('blob:second', BOUNDED)).resolves.toBe(drawable);
    expect(getImageAssetSnapshot('blob:second', BOUNDED).image).toBe(drawable);
    expect(constructed).toBe(1);

    const retained = retainImageAssetDrawable('identity-1', BOUNDED);
    expect(retained).toEqual({ src: 'blob:first', release: expect.any(Function) });
    expect(retainImageAssetDrawable('identity-1', { maxEdge: 32 })).toBeNull();
    expect(retainImageAssetDrawable('identity-2', BOUNDED)).toBeNull();
    retained.release();

    // Full resolution is never shared across URLs by identity.
    expect(getImageAssetSnapshot('blob:second').status).toBe('idle');
    unsubscribe();
  });

  test('an in-flight decode of a revoked URL hands over to the newer URL without an error', async () => {
    const snapshots = [];
    const unsubscribe = subscribeToImageAsset(
      'blob:first',
      (snapshot) => snapshots.push(snapshot.status),
      BOUNDED
    );
    const loading = ensureImageAsset('blob:first', BOUNDED);
    revoked.add('blob:first');
    // A second consumer arrives with a newly authorized URL for the same bytes.
    subscribeToImageAsset('blob:second', () => {}, BOUNDED);
    pending.splice(0).forEach(settle);
    await Promise.resolve();
    expect(pending).toHaveLength(1);
    expect(pending[0].src).toBe('blob:second');
    pending.splice(0).forEach(settle);
    await expect(loading).resolves.toEqual(expect.objectContaining({ key: 'blob:second@64' }));
    expect(snapshots).not.toContain('error');
    unsubscribe();
  });

  test('a failed identity record retries a newer URL immediately, outside the old backoff', async () => {
    revoked.add('blob:first');
    const failed = ensureImageAsset('blob:first', BOUNDED);
    pending.splice(0).forEach(settle);
    await expect(failed).rejects.toThrow('revoked');
    // Within backoff the same URL is refused without a new decode.
    await expect(ensureImageAsset('blob:first', BOUNDED)).rejects.toThrow('revoked');
    expect(constructed).toBe(1);

    const retried = ensureImageAsset('blob:second', BOUNDED);
    pending.splice(0).forEach(settle);
    await expect(retried).resolves.toEqual(expect.objectContaining({ key: 'blob:second@64' }));
    expect(constructed).toBe(2);
  });
});
