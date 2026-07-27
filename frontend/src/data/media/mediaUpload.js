import {
  Task07MediaPipelineError,
  createTask07AbortError,
  throwIfTask07Aborted,
} from './mediaErrors';

export const TASK07_MEDIA_UPLOAD_CONCURRENCY = 1;
export const TASK07_STAGING_CACHE_CONTROL = 'private, no-store';

let activeTask07Uploads = 0;
const pendingTask07Uploads = [];

const dispatchTask07UploadQueue = () => {
  while (
    activeTask07Uploads < TASK07_MEDIA_UPLOAD_CONCURRENCY
    && pendingTask07Uploads.length > 0
  ) {
    const entry = pendingTask07Uploads.shift();
    entry.signal?.removeEventListener('abort', entry.handleAbort);
    if (entry.signal?.aborted) {
      entry.reject(createTask07AbortError(entry.signal.reason));
      continue;
    }
    activeTask07Uploads += 1;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      activeTask07Uploads = Math.max(0, activeTask07Uploads - 1);
      dispatchTask07UploadQueue();
    });
  }
};

const acquireTask07UploadSlot = (signal) => new Promise((resolve, reject) => {
  const entry = {
    signal,
    resolve,
    reject,
    handleAbort: null,
  };
  entry.handleAbort = () => {
    const index = pendingTask07Uploads.indexOf(entry);
    if (index >= 0) pendingTask07Uploads.splice(index, 1);
    reject(createTask07AbortError(signal?.reason));
  };
  signal?.addEventListener('abort', entry.handleAbort, { once: true });
  pendingTask07Uploads.push(entry);
  dispatchTask07UploadQueue();
});

export const getTask07UploadQueueStats = () => ({
  active: activeTask07Uploads,
  pending: pendingTask07Uploads.length,
  concurrency: TASK07_MEDIA_UPLOAD_CONCURRENCY,
});

const normalizeContentType = (value) => (
  typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : ''
);

export const isTask07StagingSourcePath = (value) => (
  typeof value === 'string'
  && /^media_uploads\/[A-Za-z0-9._~-]{1,128}\/m_[a-f0-9]{40}\/source$/.test(value)
);

const requirePlainStringMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Task07MediaPipelineError('Server staging metadata is invalid.', {
      code: 'invalid-staging-metadata',
      stage: 'upload',
    });
  }
  const entries = Object.entries(value);
  if (
    entries.length === 0
    || entries.some(([key, item]) => !key || typeof item !== 'string' || !item)
  ) {
    throw new Task07MediaPipelineError('Server staging metadata is invalid.', {
      code: 'invalid-staging-metadata',
      stage: 'upload',
    });
  }
  return Object.fromEntries(entries);
};

export const buildTask07SourceUpload = (upload, file) => {
  if (!isTask07StagingSourcePath(upload?.sourcePath)) {
    throw new Task07MediaPipelineError('Server staging source path is invalid.', {
      code: 'invalid-staging-path',
      stage: 'upload',
    });
  }
  if (
    !file
    || !Number.isSafeInteger(file.size)
    || file.size <= 0
    || file.size !== upload.sourceBytes
    || normalizeContentType(file.type) !== normalizeContentType(upload.sourceContentType)
  ) {
    throw new Task07MediaPipelineError('Selected media no longer matches its upload intent.', {
      code: 'staging-source-mismatch',
      stage: 'upload',
    });
  }
  if (
    upload.cacheControl !== TASK07_STAGING_CACHE_CONTROL
    || upload.contentDisposition !== 'inline'
  ) {
    throw new Task07MediaPipelineError('Server staging cache contract is invalid.', {
      code: 'invalid-staging-cache-contract',
      stage: 'upload',
    });
  }
  return {
    path: upload.sourcePath,
    blob: file,
    metadata: {
      contentType: normalizeContentType(upload.sourceContentType),
      cacheControl: TASK07_STAGING_CACHE_CONTROL,
      contentDisposition: 'inline',
      customMetadata: requirePlainStringMap(upload.sourceMetadata),
    },
  };
};

export const loadTask07FirebaseStorageUploadApi = async () => {
  const [{ storage }, storageApi] = await Promise.all([
    import('../../components/firebaseStorage'),
    import('firebase/storage'),
  ]);
  if (!storage) {
    throw new Task07MediaPipelineError('Firebase Storage is unavailable.', {
      code: 'storage-unavailable',
      stage: 'upload',
    });
  }
  return {
    storage,
    ref: storageApi.ref,
    uploadBytesResumable: storageApi.uploadBytesResumable,
  };
};

const observeResumableUpload = (task, signal, onProgress) => new Promise((resolve, reject) => {
  let settled = false;
  let unsubscribe = () => {};
  const cleanup = () => {
    signal?.removeEventListener('abort', handleAbort);
    unsubscribe?.();
  };
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    callback(value);
  };
  const handleAbort = () => {
    try {
      task.cancel?.();
    } catch (_error) {
      // Cancellation is best effort; the lifecycle callable owns cleanup.
    }
    finish(reject, createTask07AbortError(signal?.reason));
  };
  signal?.addEventListener('abort', handleAbort, { once: true });
  unsubscribe = task.on(
    'state_changed',
    (snapshot) => onProgress?.({
      bytesTransferred: Number(snapshot?.bytesTransferred || 0),
      totalBytes: Number(snapshot?.totalBytes || 0),
    }),
    (error) => {
      if (signal?.aborted || error?.code === 'storage/canceled') {
        finish(reject, createTask07AbortError(signal?.reason || error));
      } else {
        finish(reject, error);
      }
    },
    () => finish(resolve, task.snapshot)
  );
  if (settled) unsubscribe?.();
  else if (signal?.aborted) handleAbort();
});

export const uploadTask07Source = async ({
  upload,
  file,
  signal,
  onProgress,
}, {
  loadApi = loadTask07FirebaseStorageUploadApi,
} = {}) => {
  throwIfTask07Aborted(signal);
  const source = buildTask07SourceUpload(upload, file);
  const { storage, ref, uploadBytesResumable } = await loadApi();
  throwIfTask07Aborted(signal);
  const release = await acquireTask07UploadSlot(signal);
  try {
    throwIfTask07Aborted(signal);
    const task = uploadBytesResumable(
      ref(storage, source.path),
      source.blob,
      source.metadata
    );
    const snapshot = await observeResumableUpload(task, signal, (progress) => {
      const totalBytes = progress.totalBytes || source.blob.size;
      onProgress?.({
        stage: 'upload',
        path: source.path,
        role: 'source',
        bytesTransferred: progress.bytesTransferred,
        totalBytes,
        fraction: totalBytes > 0 ? progress.bytesTransferred / totalBytes : 0,
      });
    });
    onProgress?.({
      stage: 'upload',
      path: source.path,
      role: 'source',
      bytesTransferred: source.blob.size,
      totalBytes: source.blob.size,
      fraction: 1,
    });
    return {
      entries: [{ role: 'source', path: source.path }],
      snapshot,
    };
  } finally {
    release();
  }
};
