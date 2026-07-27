export const PRIVATE_MEDIA_MAX_CACHE_BYTES = 32 * 1024 * 1024;
export const PRIVATE_MEDIA_MAX_DECODED_BYTES = 96 * 1024 * 1024;
export const PRIVATE_MEDIA_MAX_RECORDS = 128;
export const PRIVATE_MEDIA_MAX_DELAYED_RELEASES = 256;
export const PRIVATE_MEDIA_CROSSFADE_PROTECTION_MS = 2000;
export const PRIVATE_MEDIA_MAX_RELEASE_DELAY_MS = 2000;
export const PRIVATE_MEDIA_MAX_ACTIVE_FETCHES = 4;
export const PRIVATE_MEDIA_FAILURE_BACKOFF_BASE_MS = 1000;
export const PRIVATE_MEDIA_FAILURE_BACKOFF_MAX_MS = 30000;
export const PRIVATE_MEDIA_ALLOWED_CONTENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
export const PRIVATE_VIDEO_CONTENT_TYPE = 'video/mp4';

const allowedPrivateImageContentTypes = new Set(PRIVATE_MEDIA_ALLOWED_CONTENT_TYPES);
const allowedPrivateVideoContentTypes = new Set([PRIVATE_VIDEO_CONTENT_TYPE]);
const supportedPrivateMediaContentTypes = new Set([
  ...PRIVATE_MEDIA_ALLOWED_CONTENT_TYPES,
  PRIVATE_VIDEO_CONTENT_TYPE,
]);

const CANONICAL_MEDIA_ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;
const PRIVATE_IMAGE_SOURCE_KINDS = new Set([
  'avatar', 'item', 'npc', 'foe', 'map',
]);
const PRIVATE_IMAGE_VARIANTS_BY_KIND = Object.freeze({
  avatar: new Set(['thumbnail', 'card']),
  item: new Set(['thumbnail', 'card']),
  npc: new Set(['thumbnail', 'card']),
  foe: new Set(['thumbnail', 'card']),
  map: new Set(['thumbnail', 'card', 'board']),
  'map-video': new Set(['poster']),
});
const PRIVATE_IMAGE_EXTENSION_BY_CONTENT_TYPE = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
});

const records = new Map();
const delayedReleaseHandles = new Set();
const pendingRecords = [];

let activeFetches = 0;
let cachedBytes = 0;
let cachedDecodedBytes = 0;
let accessSequence = 0;
let dependencyPromise = null;
let runtimeEpoch = 0;

const createPrivateMediaError = (code, message, cause) => {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
};

const createAbortError = () => {
  if (typeof DOMException === 'function') {
    return new DOMException('The private media request was released.', 'AbortError');
  }
  const error = new Error('The private media request was released.');
  error.name = 'AbortError';
  return error;
};

const defaultLoadStorageApi = async () => {
  if (!dependencyPromise) {
    dependencyPromise = Promise.all([
      import(/* webpackChunkName: "feature-private-media" */ '../firebaseStorage'),
      import(/* webpackChunkName: "feature-private-media" */ 'firebase/storage'),
    ]).then(([storageModule, storageApi]) => {
      if (
        !storageModule?.storage
        || typeof storageApi?.ref !== 'function'
        || typeof storageApi?.getBlob !== 'function'
      ) {
        throw createPrivateMediaError(
          'private-media-storage-unavailable',
          'Authenticated private media storage is unavailable.'
        );
      }
      return {
        storage: storageModule.storage,
        ref: storageApi.ref,
        getBlob: storageApi.getBlob,
      };
    }).catch((error) => {
      dependencyPromise = null;
      throw error;
    });
  }
  return dependencyPromise;
};

const createDefaultRuntime = () => ({
  maxCacheBytes: PRIVATE_MEDIA_MAX_CACHE_BYTES,
  maxDecodedBytes: PRIVATE_MEDIA_MAX_DECODED_BYTES,
  maxRecords: PRIVATE_MEDIA_MAX_RECORDS,
  maxActiveFetches: PRIVATE_MEDIA_MAX_ACTIVE_FETCHES,
  failureBackoffBaseMs: PRIVATE_MEDIA_FAILURE_BACKOFF_BASE_MS,
  failureBackoffMaxMs: PRIVATE_MEDIA_FAILURE_BACKOFF_MAX_MS,
  now: () => Date.now(),
  loadStorageApi: defaultLoadStorageApi,
  createObjectURL: (blob) => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw createPrivateMediaError(
        'private-media-object-url-unavailable',
        'Private media object URLs are unavailable.'
      );
    }
    return URL.createObjectURL(blob);
  },
  revokeObjectURL: (url) => {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  },
});

let runtime = createDefaultRuntime();

const touch = (record) => {
  accessSequence += 1;
  record.lastAccess = accessSequence;
};

const normalizePositiveInteger = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const hasControlCharacter = (value) => Array.from(value).some((character) => {
  const codePoint = character.charCodeAt(0);
  return (
    codePoint <= 0x1f
    || codePoint === 0x7f
  );
});

const hasSafeStoragePathSegments = (path) => (
  !path.includes('\\')
  && path.split('/').every((part) => (
    part
    && part !== '.'
    && part !== '..'
    && part.length <= 128
    && !hasControlCharacter(part)
  ))
);

const parseCanonicalPrivateMediaPath = (path) => {
  if (!hasSafeStoragePathSegments(path)) return null;
  const parts = path.split('/');
  if (
    parts.length < 7
    || parts[0] !== 'media'
    || parts[1] !== 'v1'
    || !CANONICAL_MEDIA_ASSET_ID_PATTERN.test(parts[4])
  ) return null;

  if (parts.length === 7 && parts[5] === 'original') {
    const originalMatch = /^source\.(jpg|png|webp|gif|mp4)$/.exec(parts[6]);
    if (!originalMatch) return null;
    return {
      kind: parts[2],
      role: 'original',
      extension: originalMatch[1],
      variant: '',
    };
  }

  if (
    parts.length === 8
    && parts[5] === 'derivatives'
    && parts[6] === 'v1'
  ) {
    const derivativeMatch = /^(thumbnail|card|board|poster)\.webp$/.exec(parts[7]);
    if (!derivativeMatch) return null;
    return {
      kind: parts[2],
      role: 'derivative',
      extension: 'webp',
      variant: derivativeMatch[1],
    };
  }

  return null;
};

const normalizePrivateMediaDescriptorForTypes = (
  value,
  allowedContentTypes,
  { requireDimensions = false } = {}
) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const path = typeof value.path === 'string' ? value.path.trim() : '';
  const generation = (
    typeof value.generation === 'string'
    || typeof value.generation === 'number'
  ) ? String(value.generation).trim() : '';
  const bytes = normalizePositiveInteger(value.bytes);
  const contentType = typeof value.contentType === 'string'
    ? value.contentType.trim().toLowerCase()
    : '';
  const width = normalizePositiveInteger(value.width);
  const height = normalizePositiveInteger(value.height);

  if (
    !path
    || !generation
    || !/^[1-9][0-9]*$/.test(generation)
    || !bytes
    || bytes > PRIVATE_MEDIA_MAX_CACHE_BYTES
    || !allowedContentTypes.has(contentType)
    || (requireDimensions && (!width || !height))
    || !hasSafeStoragePathSegments(path)
    || /^(?:https?:|blob:|data:|gs:|\/)/i.test(path)
    || path.includes('\0')
  ) {
    return null;
  }

  return {
    path,
    generation,
    bytes,
    contentType,
    width,
    height,
  };
};

export const normalizePrivateMediaDescriptor = (value) => {
  const normalized = normalizePrivateMediaDescriptorForTypes(
    value,
    allowedPrivateImageContentTypes,
    { requireDimensions: true }
  );
  if (!normalized) return null;
  const parsed = parseCanonicalPrivateMediaPath(normalized.path);
  if (!parsed) return null;

  if (parsed.role === 'original') {
    return (
      PRIVATE_IMAGE_SOURCE_KINDS.has(parsed.kind)
      && PRIVATE_IMAGE_EXTENSION_BY_CONTENT_TYPE[normalized.contentType]
        === parsed.extension
    ) ? normalized : null;
  }

  return (
    normalized.contentType === 'image/webp'
    && PRIVATE_IMAGE_VARIANTS_BY_KIND[parsed.kind]?.has(parsed.variant)
  ) ? normalized : null;
};

export const normalizePrivateVideoDescriptor = (value) => {
  const normalized = normalizePrivateMediaDescriptorForTypes(
    value,
    allowedPrivateVideoContentTypes
  );
  if (!normalized) return null;
  const parsed = parseCanonicalPrivateMediaPath(normalized.path);
  return (
    parsed?.kind === 'map-video'
    && parsed.role === 'original'
    && parsed.extension === 'mp4'
  ) ? normalized : null;
};

const getNormalizedPrivateMediaAssetKey = (descriptor) => (
  JSON.stringify([descriptor.path, descriptor.generation])
);

export const getPrivateMediaAssetKey = (descriptor) => {
  const normalized = normalizePrivateMediaDescriptor(descriptor);
  return normalized ? getNormalizedPrivateMediaAssetKey(normalized) : '';
};

export const getPrivateVideoAssetKey = (descriptor) => {
  const normalized = normalizePrivateVideoDescriptor(descriptor);
  return normalized ? getNormalizedPrivateMediaAssetKey(normalized) : '';
};

const safelyRevokeObjectUrl = (url) => {
  if (!url) return;
  try {
    runtime.revokeObjectURL(url);
  } catch {
    // Cache cleanup cannot change an already-settled consumer result.
  }
};

const settleRecord = (record, kind, value) => {
  if (record.attemptSettled) return;
  record.attemptSettled = true;
  const settle = kind === 'resolve' ? record.resolve : record.reject;
  record.resolve = null;
  record.reject = null;
  settle?.(value);
};

const removeRecord = (record) => {
  if (records.get(record.key) !== record) return false;
  if (
    record.refCount > 0
    || record.status === 'loading'
    || record.status === 'queued'
  ) {
    return false;
  }

  records.delete(record.key);
  if (record.status === 'ready') {
    cachedBytes = Math.max(0, cachedBytes - record.cachedBytes);
    cachedDecodedBytes = Math.max(0, cachedDecodedBytes - record.decodedBytes);
    safelyRevokeObjectUrl(record.url);
  }
  record.status = 'evicted';
  record.url = '';
  record.cachedBytes = 0;
  record.decodedBytes = 0;
  return true;
};

const findEvictionCandidate = (excludedKey = '') => (
  Array.from(records.values())
    .filter((record) => (
      record.key !== excludedKey
      && record.refCount === 0
      && (record.status === 'ready' || record.status === 'failed')
    ))
    .sort((left, right) => left.lastAccess - right.lastAccess)[0]
);

const reserveRecordCapacity = () => {
  while (records.size >= runtime.maxRecords) {
    const candidate = findEvictionCandidate();
    if (!candidate || !removeRecord(candidate)) {
      throw createPrivateMediaError(
        'private-media-record-budget-exceeded',
        'The private media record budget is exhausted.'
      );
    }
  }
};

const reserveByteCapacity = (bytes, protectedKey) => {
  if (bytes > runtime.maxCacheBytes) {
    throw createPrivateMediaError(
      'private-media-byte-budget-exceeded',
      'The private media asset exceeds the cache byte budget.'
    );
  }

  while (cachedBytes + bytes > runtime.maxCacheBytes) {
    const candidate = findEvictionCandidate(protectedKey);
    if (!candidate || !removeRecord(candidate)) {
      throw createPrivateMediaError(
        'private-media-byte-budget-exceeded',
        'The private media cache byte budget is exhausted.'
      );
    }
  }
};

const getDescriptorDecodedBytes = (descriptor) => {
  if (!allowedPrivateImageContentTypes.has(descriptor.contentType)) return 0;
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    descriptor.width * descriptor.height * 4
  );
};

const reserveDecodedCapacity = (decodedBytes, protectedKey) => {
  while (cachedDecodedBytes + decodedBytes > runtime.maxDecodedBytes) {
    const candidate = findEvictionCandidate(protectedKey);
    if (!candidate || !removeRecord(candidate)) {
      throw createPrivateMediaError(
        'private-media-decoded-budget-exceeded',
        'The private media decoded-image budget is exhausted.'
      );
    }
  }
};

const trimInactiveRecordsToBudgets = () => {
  while (
    cachedBytes > runtime.maxCacheBytes
    || cachedDecodedBytes > runtime.maxDecodedBytes
  ) {
    const candidate = findEvictionCandidate();
    if (!candidate || !removeRecord(candidate)) return;
  }
};

const validateFetchedBlob = (blob, descriptor) => {
  const blobBytes = Number(blob?.size);
  const blobType = typeof blob?.type === 'string'
    ? blob.type.trim().toLowerCase()
    : '';

  if (!Number.isSafeInteger(blobBytes) || blobBytes !== descriptor.bytes) {
    throw createPrivateMediaError(
      'private-media-byte-mismatch',
      'Private media bytes do not match the authoritative manifest.'
    );
  }
  if (
    !supportedPrivateMediaContentTypes.has(blobType)
    || blobType !== descriptor.contentType
  ) {
    throw createPrivateMediaError(
      'private-media-type-mismatch',
      'Private media type does not match the authoritative manifest.'
    );
  }
};

const getFailureBackoffMs = (failureCount) => Math.min(
  runtime.failureBackoffMaxMs,
  runtime.failureBackoffBaseMs * (2 ** Math.min(8, Math.max(0, failureCount - 1)))
);

const markRecordFailed = (record, error) => {
  const normalizedError = error instanceof Error
    ? error
    : createPrivateMediaError(
      'private-media-fetch-failed',
      'Private media loading failed.',
      error
    );
  record.status = 'failed';
  record.error = normalizedError;
  record.failureCount += 1;
  record.retryAt = runtime.now() + getFailureBackoffMs(record.failureCount);
  touch(record);
  settleRecord(record, 'reject', normalizedError);
};

const fetchRecord = async (record, epoch) => {
  try {
    const storageApi = await runtime.loadStorageApi();
    if (epoch !== runtimeEpoch || records.get(record.key) !== record) return;

    const objectRef = storageApi.ref(storageApi.storage, record.descriptor.path);
    const blob = await storageApi.getBlob(objectRef, record.descriptor.bytes);
    if (epoch !== runtimeEpoch || records.get(record.key) !== record) return;

    validateFetchedBlob(blob, record.descriptor);
    reserveByteCapacity(blob.size, record.key);
    const decodedBytes = getDescriptorDecodedBytes(record.descriptor);
    reserveDecodedCapacity(decodedBytes, record.key);
    const objectUrl = runtime.createObjectURL(blob);
    if (typeof objectUrl !== 'string' || !objectUrl) {
      throw createPrivateMediaError(
        'private-media-object-url-invalid',
        'Private media did not produce a usable object URL.'
      );
    }

    record.status = 'ready';
    record.url = objectUrl;
    record.cachedBytes = blob.size;
    record.decodedBytes = decodedBytes;
    record.error = null;
    record.retryAt = 0;
    cachedBytes += blob.size;
    cachedDecodedBytes += decodedBytes;
    touch(record);
    settleRecord(record, 'resolve', {
      key: record.key,
      url: objectUrl,
      descriptor: record.descriptor,
    });
    trimInactiveRecordsToBudgets();
  } catch (error) {
    if (epoch !== runtimeEpoch || records.get(record.key) !== record) return;
    markRecordFailed(record, error);
  }
};

function finishRecordFetch() {
  activeFetches = Math.max(0, activeFetches - 1);
  pumpQueue();
}

function pumpQueue() {
  while (
    activeFetches < runtime.maxActiveFetches
    && pendingRecords.length > 0
  ) {
    const record = pendingRecords.shift();
    if (
      !record
      || records.get(record.key) !== record
      || record.status !== 'queued'
    ) {
      continue;
    }
    if (record.refCount < 1) {
      record.status = 'cancelled';
      records.delete(record.key);
      settleRecord(record, 'reject', createAbortError());
      continue;
    }

    record.status = 'loading';
    activeFetches += 1;
    const epoch = runtimeEpoch;
    void fetchRecord(record, epoch).finally(finishRecordFetch);
  }
}

const beginRecordAttempt = (record) => {
  record.status = 'queued';
  record.error = null;
  record.retryAt = 0;
  record.attemptSettled = false;
  record.promise = new Promise((resolve, reject) => {
    record.resolve = resolve;
    record.reject = reject;
  });
  // Keep released/abandoned attempts from becoming process-level rejections.
  void record.promise.catch(() => {});
  pendingRecords.push(record);
  pumpQueue();
};

const createRecord = (descriptor, key) => ({
  key,
  descriptor,
  status: 'idle',
  refCount: 0,
  cachedBytes: 0,
  decodedBytes: 0,
  url: '',
  error: null,
  retryAt: 0,
  failureCount: 0,
  lastAccess: 0,
  promise: null,
  resolve: null,
  reject: null,
  attemptSettled: true,
});

const descriptorsConflict = (left, right) => (
  left.path !== right.path
  || left.generation !== right.generation
  || left.bytes !== right.bytes
  || left.width !== right.width
  || left.height !== right.height
  || left.contentType !== right.contentType
);

const acquireNormalizedPrivateMediaAsset = (descriptor) => {
  if (!descriptor) {
    throw createPrivateMediaError(
      'private-media-descriptor-invalid',
      'The private media descriptor is invalid.'
    );
  }
  if (descriptor.bytes > runtime.maxCacheBytes) {
    throw createPrivateMediaError(
      'private-media-byte-budget-exceeded',
      'The private media asset exceeds the cache byte budget.'
    );
  }

  const key = getNormalizedPrivateMediaAssetKey(descriptor);
  let record = records.get(key);
  let shouldBeginAttempt = false;

  if (record) {
    if (descriptorsConflict(record.descriptor, descriptor)) {
      throw createPrivateMediaError(
        'private-media-descriptor-conflict',
        'The private media generation has conflicting metadata.'
      );
    }
    if (record.status === 'failed' && runtime.now() >= record.retryAt) {
      shouldBeginAttempt = true;
    }
  } else {
    reserveRecordCapacity();
    record = createRecord(descriptor, key);
    records.set(key, record);
    shouldBeginAttempt = true;
  }

  record.refCount += 1;
  touch(record);
  if (shouldBeginAttempt) beginRecordAttempt(record);

  let released = false;
  let delayedReleaseHandle = null;
  const finalizeRelease = () => {
    if (released) return;
    released = true;
    if (delayedReleaseHandle != null) {
      clearTimeout(delayedReleaseHandle);
      delayedReleaseHandles.delete(delayedReleaseHandle);
      delayedReleaseHandle = null;
    }
    if (records.get(key) !== record) return;

    record.refCount = Math.max(0, record.refCount - 1);
    touch(record);
    if (record.refCount === 0 && record.status === 'queued') {
      record.status = 'cancelled';
      records.delete(key);
      settleRecord(record, 'reject', createAbortError());
      return;
    }
    trimInactiveRecordsToBudgets();
  };
  const release = ({ delayMs = 0 } = {}) => {
    if (released) return;
    const boundedDelayMs = Math.min(
      PRIVATE_MEDIA_MAX_RELEASE_DELAY_MS,
      Math.max(0, Number(delayMs) || 0)
    );
    if (boundedDelayMs > 0) {
      if (delayedReleaseHandle != null) return;
      if (
        delayedReleaseHandles.size < PRIVATE_MEDIA_MAX_DELAYED_RELEASES
        && typeof setTimeout === 'function'
      ) {
        delayedReleaseHandle = setTimeout(() => {
          delayedReleaseHandles.delete(delayedReleaseHandle);
          delayedReleaseHandle = null;
          finalizeRelease();
        }, boundedDelayMs);
        delayedReleaseHandles.add(delayedReleaseHandle);
        return;
      }
    }
    finalizeRelease();
  };

  return {
    key,
    descriptor,
    promise: record.promise,
    release,
  };
};

export const acquirePrivateMediaAsset = (value) => (
  acquireNormalizedPrivateMediaAsset(normalizePrivateMediaDescriptor(value))
);

export const acquirePrivateVideoAsset = (value) => (
  acquireNormalizedPrivateMediaAsset(normalizePrivateVideoDescriptor(value))
);

export const getPrivateMediaAssetCacheSnapshot = () => ({
  activeFetches,
  cachedBytes,
  cachedDecodedBytes,
  maxActiveFetches: runtime.maxActiveFetches,
  maxCacheBytes: runtime.maxCacheBytes,
  maxDecodedBytes: runtime.maxDecodedBytes,
  maxRecords: runtime.maxRecords,
  delayedReleaseCount: delayedReleaseHandles.size,
  queuedFetches: pendingRecords.filter((record) => record.status === 'queued').length,
  recordCount: records.size,
  records: Array.from(records.values()).map((record) => ({
    key: record.key,
    path: record.descriptor.path,
    generation: record.descriptor.generation,
    status: record.status,
    refCount: record.refCount,
    bytes: record.cachedBytes,
    decodedBytes: record.decodedBytes,
    retryAt: record.retryAt,
  })),
});

export const __resetPrivateMediaAssetsForTests = () => {
  runtimeEpoch += 1;
  pendingRecords.splice(0, pendingRecords.length);
  delayedReleaseHandles.forEach((handle) => {
    clearTimeout(handle);
  });
  delayedReleaseHandles.clear();
  records.forEach((record) => {
    if (record.status === 'ready') safelyRevokeObjectUrl(record.url);
    if (record.status === 'queued' || record.status === 'loading') {
      settleRecord(record, 'reject', createAbortError());
    }
  });
  records.clear();
  cachedBytes = 0;
  cachedDecodedBytes = 0;
  accessSequence = 0;
  dependencyPromise = null;
  runtime = createDefaultRuntime();
};

export const __configurePrivateMediaAssetsForTests = (overrides = {}) => {
  __resetPrivateMediaAssetsForTests();
  runtime = {
    ...createDefaultRuntime(),
    ...overrides,
  };
  runtime.maxCacheBytes = Math.max(1, Math.floor(runtime.maxCacheBytes));
  runtime.maxDecodedBytes = Math.max(1, Math.floor(runtime.maxDecodedBytes));
  runtime.maxRecords = Math.max(1, Math.floor(runtime.maxRecords));
  runtime.maxActiveFetches = Math.max(
    1,
    Math.min(PRIVATE_MEDIA_MAX_ACTIVE_FETCHES, Math.floor(runtime.maxActiveFetches))
  );
  runtime.failureBackoffBaseMs = Math.max(1, runtime.failureBackoffBaseMs);
  runtime.failureBackoffMaxMs = Math.max(
    runtime.failureBackoffBaseMs,
    runtime.failureBackoffMaxMs
  );
};
