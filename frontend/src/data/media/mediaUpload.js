import {
  Task07MediaPipelineError,
  createTask07AbortError,
  throwIfTask07Aborted,
} from './mediaErrors';

export const TASK07_MEDIA_UPLOAD_CONCURRENCY = 3;
export const TASK07_PRIVATE_IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable';

const isCanonicalStoragePath = (value) => (
  typeof value === 'string'
  && value.startsWith('media/v')
  && !value.startsWith('/')
  && !value.includes('://')
  && !value.includes('\\')
);

export const mapTask07WithConcurrency = async (
  values,
  worker,
  concurrency = TASK07_MEDIA_UPLOAD_CONCURRENCY
) => {
  const items = Array.from(values || []);
  const limit = Math.max(
    1,
    Math.min(TASK07_MEDIA_UPLOAD_CONCURRENCY, Math.floor(Number(concurrency) || 1))
  );
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
};

export const buildTask07UploadEntries = (upload, generated) => {
  if (!isCanonicalStoragePath(upload?.originalPath)) {
    throw new Task07MediaPipelineError('Server original storage path is invalid.', {
      code: 'invalid-original-path',
      stage: 'upload',
    });
  }
  const declaredNames = Object.keys(upload?.variants || {}).sort();
  const generatedNames = Object.keys(generated?.variants || {}).sort();
  if (
    declaredNames.length !== generatedNames.length
    || declaredNames.some((name, index) => name !== generatedNames[index])
  ) {
    throw new Task07MediaPipelineError(
      'Generated variants do not exactly match the server upload plan.',
      {
        code: 'variant-set-mismatch',
        stage: 'upload',
      }
    );
  }
  if (!generated?.original?.blob) {
    throw new Task07MediaPipelineError('Generated upload is missing its original media.', {
      code: 'missing-original',
      stage: 'upload',
    });
  }
  const entries = [{
    role: 'original',
    variant: null,
    path: upload.originalPath,
    blob: generated.original.blob,
    contentType: generated.original.contentType || upload.sourceContentType,
  }];
  declaredNames.forEach((name) => {
    const path = upload.variants[name];
    const value = generated.variants[name];
    if (!isCanonicalStoragePath(path) || !value?.blob) {
      throw new Task07MediaPipelineError(`Generated ${name} upload is invalid.`, {
        code: 'invalid-variant-upload',
        stage: 'upload',
      });
    }
    entries.push({
      role: 'variant',
      variant: name,
      path,
      blob: value.blob,
      contentType: value.contentType,
    });
  });
  return entries;
};

export const buildTask07UploadMetadata = (upload, entry) => ({
  contentType: entry.contentType,
  cacheControl: TASK07_PRIVATE_IMMUTABLE_CACHE_CONTROL,
  contentDisposition: 'inline',
  customMetadata: {
    task07AssetId: upload.assetId,
    task07ContractVersion: String(upload.contractVersion),
    task07EntityId: upload.entityId,
    task07Kind: upload.kind,
    task07OwnerUid: upload.ownerUid,
    task07Role: entry.variant || 'original',
  },
});

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
      // Cancellation is best effort; the orchestration still abandons the asset.
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
  if (settled) {
    unsubscribe?.();
  } else if (signal?.aborted) {
    handleAbort();
  }
});

export const uploadTask07EntryWithFirebase = async (
  entry,
  {
    upload,
    signal,
    onProgress,
    loadApi = loadTask07FirebaseStorageUploadApi,
  }
) => {
  throwIfTask07Aborted(signal);
  const { storage, ref, uploadBytesResumable } = await loadApi();
  throwIfTask07Aborted(signal);
  const storageRef = ref(storage, entry.path);
  const task = uploadBytesResumable(
    storageRef,
    entry.blob,
    buildTask07UploadMetadata(upload, entry)
  );
  return observeResumableUpload(task, signal, onProgress);
};

export const uploadGeneratedTask07Media = async ({
  upload,
  generated,
  signal,
  onProgress,
  concurrency = TASK07_MEDIA_UPLOAD_CONCURRENCY,
}, {
  uploadOne = uploadTask07EntryWithFirebase,
} = {}) => {
  throwIfTask07Aborted(signal);
  const entries = buildTask07UploadEntries(upload, generated);
  const controller = new AbortController();
  const handleExternalAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', handleExternalAbort, { once: true });
  if (signal?.aborted) controller.abort(signal.reason);

  const totals = new Map(entries.map((entry) => [entry.path, {
    transferred: 0,
    total: Number(entry.blob?.size || 0),
  }]));
  const totalBytes = Array.from(totals.values())
    .reduce((sum, value) => sum + value.total, 0);
  const report = (entry, update = {}) => {
    const current = totals.get(entry.path);
    current.transferred = Math.max(
      current.transferred,
      Number(update.bytesTransferred || 0)
    );
    if (Number(update.totalBytes) > 0) current.total = Number(update.totalBytes);
    const bytesTransferred = Array.from(totals.values())
      .reduce((sum, value) => sum + Math.min(value.transferred, value.total), 0);
    onProgress?.({
      stage: 'upload',
      path: entry.path,
      role: entry.role,
      variant: entry.variant,
      bytesTransferred,
      totalBytes,
      fraction: totalBytes > 0 ? bytesTransferred / totalBytes : 0,
    });
  };

  try {
    const snapshots = await mapTask07WithConcurrency(
      entries,
      async (entry) => {
        throwIfTask07Aborted(controller.signal);
        const snapshot = await uploadOne(entry, {
          upload,
          signal: controller.signal,
          onProgress: (update) => report(entry, update),
        });
        report(entry, {
          bytesTransferred: Number(entry.blob?.size || 0),
          totalBytes: Number(entry.blob?.size || 0),
        });
        return snapshot;
      },
      concurrency
    );
    return {
      entries: entries.map(({ role, variant, path }) => ({ role, variant, path })),
      snapshots,
    };
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    signal?.removeEventListener('abort', handleExternalAbort);
  }
};
