import {
  buildTask07UploadEntries,
  buildTask07UploadMetadata,
  TASK07_MEDIA_UPLOAD_CONCURRENCY,
  TASK07_PRIVATE_IMMUTABLE_CACHE_CONTROL,
  uploadGeneratedTask07Media,
} from './mediaUpload';

const createFixture = () => {
  const original = new Blob(['original'], { type: 'image/jpeg' });
  const thumbnail = new Blob(['thumbnail'], { type: 'image/webp' });
  const card = new Blob(['card'], { type: 'image/webp' });
  const board = new Blob(['board'], { type: 'image/webp' });
  const upload = {
    assetId: 'm_asset',
    contractVersion: 1,
    entityId: 'map-1',
    kind: 'map',
    ownerUid: 'user-1',
    sourceContentType: 'image/jpeg',
    originalPath: 'media/v1/map/user-1/m_asset/original/source.jpg',
    variants: {
      thumbnail: 'media/v1/map/user-1/m_asset/derivatives/v1/thumbnail.webp',
      card: 'media/v1/map/user-1/m_asset/derivatives/v1/card.webp',
      board: 'media/v1/map/user-1/m_asset/derivatives/v1/board.webp',
    },
  };
  const generated = {
    original: { blob: original, contentType: 'image/jpeg' },
    variants: {
      thumbnail: { blob: thumbnail, contentType: 'image/webp' },
      card: { blob: card, contentType: 'image/webp' },
      board: { blob: board, contentType: 'image/webp' },
    },
  };
  return { upload, generated };
};

describe('Task 07 bounded resumable media uploads', () => {
  test('uploads the original and exact declared variants with concurrency capped at three', async () => {
    const { upload, generated } = createFixture();
    let active = 0;
    let maximumActive = 0;
    const uploadOne = jest.fn(async (entry, { onProgress }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      onProgress({
        bytesTransferred: Math.floor(entry.blob.size / 2),
        totalBytes: entry.blob.size,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return { path: entry.path };
    });
    const progress = [];
    const result = await uploadGeneratedTask07Media({
      upload,
      generated,
      concurrency: 99,
      onProgress: (value) => progress.push(value),
    }, { uploadOne });

    expect(uploadOne).toHaveBeenCalledTimes(4);
    expect(maximumActive).toBe(TASK07_MEDIA_UPLOAD_CONCURRENCY);
    expect(result.entries.map((entry) => entry.path)).toEqual([
      upload.originalPath,
      upload.variants.board,
      upload.variants.card,
      upload.variants.thumbnail,
    ]);
    expect(progress.at(-1)).toMatchObject({
      stage: 'upload',
      fraction: 1,
    });
  });

  test('uses private immutable metadata and never creates a download URL', () => {
    const { upload, generated } = createFixture();
    const [entry] = buildTask07UploadEntries(upload, generated);
    expect(buildTask07UploadMetadata(upload, entry)).toEqual({
      contentType: 'image/jpeg',
      cacheControl: TASK07_PRIVATE_IMMUTABLE_CACHE_CONTROL,
      contentDisposition: 'inline',
      customMetadata: {
        task07AssetId: 'm_asset',
        task07ContractVersion: '1',
        task07EntityId: 'map-1',
        task07Kind: 'map',
        task07OwnerUid: 'user-1',
        task07Role: 'original',
      },
    });
    expect(buildTask07UploadMetadata(upload, entry)).not.toHaveProperty('downloadURL');
    expect(buildTask07UploadMetadata(upload, entry)).not.toHaveProperty('authorization');
  });

  test('rejects variant mismatch before starting storage work and propagates cancellation', async () => {
    const { upload, generated } = createFixture();
    delete generated.variants.card;
    const uploadOne = jest.fn();
    await expect(uploadGeneratedTask07Media({
      upload,
      generated,
    }, { uploadOne })).rejects.toMatchObject({
      code: 'variant-set-mismatch',
    });
    expect(uploadOne).not.toHaveBeenCalled();

    const fresh = createFixture();
    const controller = new AbortController();
    const waitingUpload = jest.fn((_entry, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));
    const promise = uploadGeneratedTask07Media({
      ...fresh,
      signal: controller.signal,
    }, { uploadOne: waitingUpload });
    controller.abort('user-cancelled');
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
