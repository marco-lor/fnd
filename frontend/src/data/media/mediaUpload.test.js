import {
  buildTask07SourceUpload,
  getTask07UploadQueueStats,
  isTask07StagingSourcePath,
  TASK07_MEDIA_UPLOAD_CONCURRENCY,
  TASK07_STAGING_CACHE_CONTROL,
  uploadTask07Source,
} from './mediaUpload';

const assetId = `m_${'a'.repeat(40)}`;
const file = new Blob(['source'], { type: 'image/jpeg' });
const upload = {
  assetId,
  purpose: 'avatar',
  targetKind: 'profile',
  sourcePath: `media_uploads/user-1/${assetId}/source`,
  sourceContentType: 'image/jpeg',
  sourceBytes: file.size,
  sourceMetadata: {
    task07AssetId: assetId,
    task07EntityId: 'user-1',
    task07Kind: 'avatar',
    task07OwnerUid: 'user-1',
    task07Role: 'source',
  },
  cacheControl: TASK07_STAGING_CACHE_CONTROL,
  contentDisposition: 'inline',
  expiresInSeconds: 3600,
};

describe('Task 07 staging source uploads', () => {
  test('accepts only the server-issued staging path and exact source contract', () => {
    expect(TASK07_MEDIA_UPLOAD_CONCURRENCY).toBe(1);
    expect(isTask07StagingSourcePath(upload.sourcePath)).toBe(true);
    expect(isTask07StagingSourcePath(
      `media_assets/v1/signed-in/user-1/${assetId}/1/original`
    )).toBe(false);
    expect(isTask07StagingSourcePath(
      `media/v1/avatar/user-1/${assetId}/original/source.jpg`
    )).toBe(false);

    expect(buildTask07SourceUpload(upload, file)).toEqual({
      path: upload.sourcePath,
      blob: file,
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: TASK07_STAGING_CACHE_CONTROL,
        contentDisposition: 'inline',
        customMetadata: upload.sourceMetadata,
      },
    });
  });

  test.each([
    ['path', { sourcePath: `media_assets/v1/signed-in/user-1/${assetId}/1/original` },
      'invalid-staging-path'],
    ['byte count', { sourceBytes: file.size + 1 }, 'staging-source-mismatch'],
    ['content type', { sourceContentType: 'image/png' }, 'staging-source-mismatch'],
    ['cache policy', { cacheControl: 'private, max-age=31536000, immutable' },
      'invalid-staging-cache-contract'],
    ['metadata', { sourceMetadata: {} }, 'invalid-staging-metadata'],
  ])('rejects a mismatched server %s before storage starts', (_label, patch, code) => {
    expect(() => buildTask07SourceUpload({ ...upload, ...patch }, file))
      .toThrow(expect.objectContaining({ code, stage: 'upload' }));
  });

  test('starts one resumable source upload and reports bounded progress', async () => {
    const storage = { name: 'storage' };
    const storageRef = { fullPath: upload.sourcePath };
    const snapshot = { ref: storageRef };
    const unsubscribe = jest.fn();
    const task = {
      snapshot,
      cancel: jest.fn(),
      on: jest.fn((_event, progress, _error, complete) => {
        progress({ bytesTransferred: 2, totalBytes: file.size });
        complete();
        return unsubscribe;
      }),
    };
    const ref = jest.fn(() => storageRef);
    const uploadBytesResumable = jest.fn(() => task);
    const progress = [];

    await expect(uploadTask07Source({
      upload,
      file,
      onProgress: (value) => progress.push(value),
    }, {
      loadApi: async () => ({ storage, ref, uploadBytesResumable }),
    })).resolves.toEqual({
      entries: [{ role: 'source', path: upload.sourcePath }],
      snapshot,
    });

    expect(ref).toHaveBeenCalledWith(storage, upload.sourcePath);
    expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
    expect(uploadBytesResumable).toHaveBeenCalledWith(
      storageRef,
      file,
      buildTask07SourceUpload(upload, file).metadata
    );
    expect(progress).toEqual([
      expect.objectContaining({
        stage: 'upload',
        role: 'source',
        path: upload.sourcePath,
        bytesTransferred: 2,
        totalBytes: file.size,
      }),
      expect.objectContaining({
        stage: 'upload',
        role: 'source',
        path: upload.sourcePath,
        fraction: 1,
      }),
    ]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('cancels the resumable source task when the caller aborts', async () => {
    const controller = new AbortController();
    let rejectUpload;
    const unsubscribe = jest.fn();
    const task = {
      snapshot: {},
      cancel: jest.fn(),
      on: jest.fn((_event, _progress, error) => {
        rejectUpload = error;
        return unsubscribe;
      }),
    };
    const promise = uploadTask07Source({
      upload,
      file,
      signal: controller.signal,
    }, {
      loadApi: async () => ({
        storage: {},
        ref: jest.fn(() => ({})),
        uploadBytesResumable: jest.fn(() => task),
      }),
    });

    await Promise.resolve();
    expect(rejectUpload).toEqual(expect.any(Function));
    controller.abort('view-unmounted');

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      code: 'aborted',
    });
    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('serializes concurrent sources and releases the slot after completion', async () => {
    const completions = [];
    const uploadBytesResumable = jest.fn(() => {
      const task = {
        snapshot: {},
        on: jest.fn((_event, _progress, _error, complete) => {
          completions.push(complete);
          return jest.fn();
        }),
      };
      return task;
    });
    const loadApi = async () => ({
      storage: {},
      ref: jest.fn(() => ({})),
      uploadBytesResumable,
    });

    const first = uploadTask07Source({ upload, file }, { loadApi });
    const second = uploadTask07Source({ upload, file }, { loadApi });
    await Promise.resolve();
    await Promise.resolve();
    expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
    expect(getTask07UploadQueueStats()).toEqual({
      active: 1,
      pending: 1,
      concurrency: 1,
    });

    completions.shift()();
    await first;
    await Promise.resolve();
    expect(uploadBytesResumable).toHaveBeenCalledTimes(2);
    expect(getTask07UploadQueueStats().active).toBe(1);
    completions.shift()();
    await second;
    expect(getTask07UploadQueueStats()).toEqual({
      active: 0,
      pending: 0,
      concurrency: 1,
    });
  });

  test('aborts a queued source without starting another network task', async () => {
    const completions = [];
    const uploadBytesResumable = jest.fn(() => ({
      snapshot: {},
      on: jest.fn((_event, _progress, _error, complete) => {
        completions.push(complete);
        return jest.fn();
      }),
    }));
    const loadApi = async () => ({
      storage: {},
      ref: jest.fn(() => ({})),
      uploadBytesResumable,
    });
    const first = uploadTask07Source({ upload, file }, { loadApi });
    const controller = new AbortController();
    const queued = uploadTask07Source({
      upload,
      file,
      signal: controller.signal,
    }, { loadApi });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort('dialog-closed');
    await expect(queued).rejects.toMatchObject({
      name: 'AbortError',
      code: 'aborted',
    });
    expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
    expect(getTask07UploadQueueStats().pending).toBe(0);
    completions.shift()();
    await first;
  });
});
