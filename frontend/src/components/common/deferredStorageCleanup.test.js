import {
  createDeferredStorageCleanup,
  extractFirebaseStoragePath,
} from './deferredStorageCleanup';

describe('deferredStorageCleanup', () => {
  it('extracts Firebase Storage object paths without retaining bearer query data', () => {
    expect(extractFirebaseStoragePath(
      'https://firebasestorage.googleapis.com/v0/b/demo/o/items%2Fportrait.webp?alt=media&token=secret'
    )).toBe('items/portrait.webp');
    expect(extractFirebaseStoragePath('https://example.test/not-storage')).toBe('');
    expect(extractFirebaseStoragePath('/o/%E0%A4%A')).toBe('');
  });

  it('does not delete until flush and deduplicates queued paths', async () => {
    const deletePath = jest.fn().mockResolvedValue(undefined);
    const cleanup = createDeferredStorageCleanup(deletePath);

    cleanup.addPath('items/old.webp');
    cleanup.addUrl(
      'https://firebasestorage.googleapis.com/v0/b/demo/o/items%2Fold.webp?alt=media'
    );

    expect(deletePath).not.toHaveBeenCalled();
    expect(cleanup.pendingCount).toBe(1);

    await expect(cleanup.flush()).resolves.toEqual({
      deleted: ['items/old.webp'],
      failed: [],
      pendingPaths: [],
    });
    expect(deletePath).toHaveBeenCalledTimes(1);
    expect(deletePath).toHaveBeenCalledWith('items/old.webp');
  });

  it('keeps failed paths queued so a caller can retry cleanup', async () => {
    const error = new Error('temporary storage failure');
    const deletePath = jest.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);
    const onError = jest.fn();
    const cleanup = createDeferredStorageCleanup(deletePath, { onError });
    cleanup.addPath('/items/retry.webp');

    await expect(cleanup.flush()).resolves.toEqual({
      deleted: [],
      failed: [{ path: 'items/retry.webp', error }],
      pendingPaths: ['items/retry.webp'],
    });
    expect(onError).toHaveBeenCalledWith({
      path: 'items/retry.webp',
      error,
    });
    expect(cleanup.pendingCount).toBe(1);

    await expect(cleanup.flush()).resolves.toEqual({
      deleted: ['items/retry.webp'],
      failed: [],
      pendingPaths: [],
    });
    expect(cleanup.pendingCount).toBe(0);
  });

  it('ignores invalid paths and shields committed saves from reporter failures', async () => {
    const cleanup = createDeferredStorageCleanup(
      jest.fn().mockRejectedValue(new Error('nope')),
      { onError: () => { throw new Error('reporter failed'); } }
    );

    expect(cleanup.addPath('')).toBe(false);
    expect(cleanup.addUrl('javascript:alert(1)')).toBe(false);
    cleanup.addPath('items/old.webp');
    await expect(cleanup.flush()).resolves.toMatchObject({
      failed: [{ path: 'items/old.webp' }],
    });
  });
});
