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

const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const createControlledResumableTask = () => {
  const subscription = deferred();
  let handlers = null;
  const unsubscribe = jest.fn();
  const task = {
    snapshot: {},
    cancel: jest.fn(),
    on: jest.fn((_event, progress, error, complete) => {
      handlers = { progress, error, complete };
      subscription.resolve();
      return unsubscribe;
    }),
  };
  return {
    task,
    subscribed: subscription.promise,
    unsubscribe,
    progress: (bytesTransferred, totalBytes = file.size) => {
      if (!handlers) throw new Error('Task is not subscribed.');
      handlers.progress({ bytesTransferred, totalBytes });
    },
    complete: (snapshot = task.snapshot) => {
      task.snapshot = snapshot;
      if (!handlers) throw new Error('Task is not subscribed.');
      handlers.complete();
    },
    fail: (error = new Error('upload failed')) => {
      if (!handlers) throw new Error('Task is not subscribed.');
      handlers.error(error);
    },
    cancel: () => {
      if (!handlers) throw new Error('Task is not subscribed.');
      handlers.error({ code: 'storage/canceled' });
    },
  };
};

const activeControllers = new Set();
const activePromises = new Set();

const trackedUpload = (args, options) => {
  const controller = new AbortController();
  activeControllers.add(controller);
  const promise = uploadTask07Source({
    ...args,
    signal: controller.signal,
  }, options);
  activePromises.add(promise);
  promise.catch(() => {}).finally(() => activePromises.delete(promise));
  return { controller, promise };
};

const waitForQueueState = async (expected) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = getTask07UploadQueueStats();
    if (Object.entries(expected).every(([key, value]) => current[key] === value)) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `Upload queue did not reach ${JSON.stringify(expected)}; `
      + `last state ${JSON.stringify(getTask07UploadQueueStats())}`
  );
};

afterEach(async () => {
  activeControllers.forEach((controller) => {
    if (!controller.signal.aborted) controller.abort('test-cleanup');
  });
  await Promise.allSettled([...activePromises]);
  activeControllers.clear();
  activePromises.clear();
  expect(getTask07UploadQueueStats()).toEqual({
    active: 0,
    pending: 0,
    concurrency: 1,
  });
});

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
    const controlled = createControlledResumableTask();
    controlled.task.snapshot = { ref: storageRef };
    const ref = jest.fn(() => storageRef);
    const uploadBytesResumable = jest.fn(() => controlled.task);
    const progress = [];
    const running = trackedUpload({
      upload,
      file,
      onProgress: (value) => progress.push(value),
    }, {
      loadApi: async () => ({ storage, ref, uploadBytesResumable }),
    });

    await controlled.subscribed;
    controlled.progress(2);
    controlled.complete();
    await expect(running.promise).resolves.toEqual({
      entries: [{ role: 'source', path: upload.sourcePath }],
      snapshot: { ref: storageRef },
    });

    expect(ref).toHaveBeenCalledWith(storage, upload.sourcePath);
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
    expect(controlled.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('cancels the resumable source task when the caller aborts', async () => {
    const controlled = createControlledResumableTask();
    const running = trackedUpload({ upload, file }, {
      loadApi: async () => ({
        storage: {},
        ref: jest.fn(() => ({})),
        uploadBytesResumable: jest.fn(() => controlled.task),
      }),
    });

    await controlled.subscribed;
    running.controller.abort('view-unmounted');

    await expect(running.promise).rejects.toMatchObject({
      name: 'AbortError',
      code: 'aborted',
    });
    expect(controlled.task.cancel).toHaveBeenCalledTimes(1);
    expect(controlled.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('serializes concurrent sources and releases the slot after completion', async () => {
    const tasks = [];
    const uploadBytesResumable = jest.fn(() => {
      const controlled = createControlledResumableTask();
      tasks.push(controlled);
      return controlled.task;
    });
    const loadApi = async () => ({
      storage: {},
      ref: jest.fn(() => ({})),
      uploadBytesResumable,
    });
    const first = trackedUpload({ upload, file }, { loadApi });
    const second = trackedUpload({ upload, file }, { loadApi });

    await waitForQueueState({ active: 1, pending: 1 });
    await tasks[0].subscribed;
    expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
    tasks[0].complete();
    await first.promise;
    await waitForQueueState({ active: 1, pending: 0 });
    await tasks[1].subscribed;
    expect(uploadBytesResumable).toHaveBeenCalledTimes(2);
    tasks[1].complete();
    await second.promise;
  });

  test('aborts a queued source without starting another network task', async () => {
    const controlled = createControlledResumableTask();
    const uploadBytesResumable = jest.fn(() => controlled.task);
    const loadApi = async () => ({
      storage: {},
      ref: jest.fn(() => ({})),
      uploadBytesResumable,
    });
    const first = trackedUpload({ upload, file }, { loadApi });
    const queued = trackedUpload({ upload, file }, { loadApi });

    await controlled.subscribed;
    await waitForQueueState({ active: 1, pending: 1 });
    queued.controller.abort('dialog-closed');
    await expect(queued.promise).rejects.toMatchObject({
      name: 'AbortError',
      code: 'aborted',
    });
    expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
    await waitForQueueState({ active: 1, pending: 0 });
    controlled.complete();
    await first.promise;
  });

  test('recovers after cancelling one active and one queued upload', async () => {
    const tasks = [];
    const uploadBytesResumable = jest.fn(() => {
      const controlled = createControlledResumableTask();
      tasks.push(controlled);
      return controlled.task;
    });
    const loadApi = async () => ({
      storage: {},
      ref: jest.fn(() => ({})),
      uploadBytesResumable,
    });
    const active = trackedUpload({ upload, file }, { loadApi });
    const queued = trackedUpload({ upload, file }, { loadApi });

    await waitForQueueState({ active: 1, pending: 1 });
    await tasks[0].subscribed;
    active.controller.abort('active-cancelled');
    queued.controller.abort('queued-cancelled');
    await Promise.allSettled([active.promise, queued.promise]);
    await waitForQueueState({ active: 0, pending: 0 });

    const fresh = trackedUpload({ upload, file }, { loadApi });
    await waitForQueueState({ active: 1, pending: 0 });
    await tasks[1].subscribed;
    tasks[1].complete();
    await expect(fresh.promise).resolves.toEqual(expect.objectContaining({
      entries: [{ role: 'source', path: upload.sourcePath }],
    }));
    expect(uploadBytesResumable).toHaveBeenCalledTimes(2);
  });
});
