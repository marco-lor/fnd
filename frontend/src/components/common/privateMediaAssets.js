import {
  getImageAssetRegistryRuntimeLimits,
  registerImageAssetSourceIdentity,
} from './imageAssets/imageAssetRegistry';
import { getRepositorySessionScope } from '../../data/repositoryRuntime';

const DESKTOP_IMAGE_ASSET_LIMITS = getImageAssetRegistryRuntimeLimits({ compact: false });

export const PRIVATE_MEDIA_MAX_CACHE_BYTES = 32 * 1024 * 1024;
export const PRIVATE_MEDIA_MAX_DECODED_BYTES = DESKTOP_IMAGE_ASSET_LIMITS.maxDecodedBytes;
export const PRIVATE_MEDIA_MAX_TOTAL_DECODED_BYTES = DESKTOP_IMAGE_ASSET_LIMITS.maxTotalDecodedBytes;
export const PRIVATE_MEDIA_MAX_RECORDS = DESKTOP_IMAGE_ASSET_LIMITS.maxRecords;
export const PRIVATE_MEDIA_MAX_DELAYED_RELEASES = 256;
export const PRIVATE_MEDIA_CROSSFADE_PROTECTION_MS = 2000;
export const PRIVATE_MEDIA_MAX_RELEASE_DELAY_MS = 2000;
export const PRIVATE_MEDIA_MAX_ACTIVE_FETCHES = DESKTOP_IMAGE_ASSET_LIMITS.maxConcurrentRequests;
export const PRIVATE_MEDIA_FAILURE_BACKOFF_MS = Object.freeze([1_000, 5_000, 30_000]);
// Referenced leases whose consumer draws a bounded drawable (Grigliata token
// portraits) may exceed the total decoded cap only when everything evictable is
// gone (e.g. one oversized active map), and only by this much in aggregate.
export const PRIVATE_MEDIA_MAX_BOUNDED_DECODE_OVERAGE_BYTES = 16 * 1024 * 1024;
// Small portraits can share 8 MiB while the cache is full. A larger valid
// portrait can use up to its own encoded size so at least one can finish.
const SHARED_TRANSIENT_PORTRAIT_BYTES = 8 * 1024 * 1024;
export const PRIVATE_MEDIA_MAX_TRANSIENT_PORTRAIT_BYTES = PRIVATE_MEDIA_MAX_CACHE_BYTES;
export const PRIVATE_MEDIA_ALLOWED_CONTENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const PRIVATE_VIDEO_CONTENT_TYPES = Object.freeze([
  'video/mp4',
  'video/webm',
]);
export const PRIVATE_AUDIO_CONTENT_TYPES = Object.freeze([
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
]);
// Retained as the default video MIME for callers that imported the old scalar.
export const PRIVATE_VIDEO_CONTENT_TYPE = PRIVATE_VIDEO_CONTENT_TYPES[0];

const allowedPrivateImageContentTypes = new Set(PRIVATE_MEDIA_ALLOWED_CONTENT_TYPES);
const allowedPrivateVideoContentTypes = new Set(PRIVATE_VIDEO_CONTENT_TYPES);
const allowedPrivateAudioContentTypes = new Set(PRIVATE_AUDIO_CONTENT_TYPES);
const supportedPrivateMediaContentTypes = new Set([
  ...PRIVATE_MEDIA_ALLOWED_CONTENT_TYPES,
  ...PRIVATE_VIDEO_CONTENT_TYPES,
  ...PRIVATE_AUDIO_CONTENT_TYPES,
]);

const CANONICAL_MEDIA_ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;
const PRIVATE_MEDIA_AUDIENCES = new Set([
  'signed-in', 'owner-manager', 'dm-only',
]);
const PRIVATE_MEDIA_DERIVATIVE_NAMES = new Set([
  'thumbnail', 'thumbnail2x', 'card', 'card2x',
  'gallery', 'gallery2x', 'poster', 'poster2x',
]);

const records = new Map();
// Successful authenticated fetches, keyed like records but kept after the
// compressed blob is evicted: [path, generation] -> { scope, descriptor }.
// Only the exact auth scope (actor + session generation) that downloaded the
// bytes may reuse a drawable decoded from them; any failure drops the entry.
const authorizations = new Map();
const PRIVATE_MEDIA_MAX_AUTHORIZATIONS = 1024;
// Scope of bytes whose auth scope is unknown or changed mid-download: it never
// equals a real scope key, so nobody else is ever served those bytes.
const UNSHAREABLE_AUTH_SCOPE = '\u0000unshareable-private-media-scope';
// Records fetched under an older auth scope that consumers of that scope still
// hold. They are out of `records` (never served again) and are freed, URL
// revoked, when their last holder releases or their in-flight fetch settles.
const detachedRecords = new Set();
const delayedReleaseHandles = new Set();
const pendingRecords = [];
const capacityListeners = new Set();

let activeFetches = 0;
let cachedBytes = 0;
// Compressed bytes admitted for in-flight fetches. Admission happens before the
// authenticated download, so a full cache never downloads bytes it must drop.
let reservedBytes = 0;
let cachedDecodedBytes = 0;
// Decoded bytes admitted for in-flight fetches. Like the compressed
// reservation it converts atomically on completion, so a fetch that was
// admitted is never re-judged against work that finished before it.
let reservedDecodedBytes = 0;
let accessSequence = 0;
let dependencyPromise = null;
let runtimeEpoch = 0;
let capacityNotificationScheduled = false;

const createPrivateMediaError = (code, message, cause) => {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
};

// Budget exhaustion caused by other referenced records is transient: the same
// valid asset can load once capacity frees. It is never a reason to treat the
// candidate as broken, and it never enters failure backoff.
const createCapacityPressureError = (code, message) => {
  const error = createPrivateMediaError(code, message);
  error.capacityPressure = true;
  return error;
};

export const isPrivateMediaCapacityPressureError = (error) => (
  error?.capacityPressure === true
);

// Coalesced, asynchronous wake-up for consumers waiting on capacity. Fired only
// when compressed/decoded capacity or record slots actually become reclaimable.
const notifyCapacityAvailable = () => {
  if (capacityNotificationScheduled || capacityListeners.size === 0) return;
  capacityNotificationScheduled = true;
  const epoch = runtimeEpoch;
  Promise.resolve().then(() => {
    capacityNotificationScheduled = false;
    if (epoch !== runtimeEpoch) return;
    Array.from(capacityListeners).forEach((listener) => {
      try {
        listener();
      } catch {
        // One waiter must not block the others.
      }
    });
  });
};

export const subscribePrivateMediaCapacity = (listener) => {
  if (typeof listener !== 'function') return () => {};
  const subscription = () => listener();
  capacityListeners.add(subscription);
  return () => {
    capacityListeners.delete(subscription);
  };
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

const readRepositoryAuthSession = () => {
  const session = getRepositorySessionScope();
  return {
    actor: typeof session?.actorUid === 'string' && session.actorUid ? session.actorUid : null,
    generation: Number.isSafeInteger(session?.generation) ? session.generation : 0,
  };
};

const createDefaultRuntime = () => {
  const limits = getImageAssetRegistryRuntimeLimits();
  return {
    profile: limits.profile,
    maxCacheBytes: PRIVATE_MEDIA_MAX_CACHE_BYTES,
    maxDecodedBytes: limits.maxDecodedBytes,
    maxTotalDecodedBytes: limits.maxTotalDecodedBytes,
    maxRecords: limits.maxRecords,
    maxActiveFetches: limits.maxConcurrentRequests,
    maxBoundedDecodeOverageBytes: PRIVATE_MEDIA_MAX_BOUNDED_DECODE_OVERAGE_BYTES,
    maxTransientPortraitBytes: PRIVATE_MEDIA_MAX_TRANSIENT_PORTRAIT_BYTES,
    failureBackoffMs: [...PRIVATE_MEDIA_FAILURE_BACKOFF_MS],
    now: () => Date.now(),
    getAuthSession: readRepositoryAuthSession,
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
  };
};

let runtime = createDefaultRuntime();

// Current authoritative auth session, or null when it cannot be determined
// (then nothing is recorded as authorized and no drawable is reused).
const readAuthSession = () => {
  try {
    const session = runtime.getAuthSession?.();
    if (!session || typeof session !== 'object') return null;
    const generation = Number(session.generation);
    if (!Number.isSafeInteger(generation)) return null;
    return {
      actor: typeof session.actor === 'string' && session.actor ? session.actor : null,
      generation,
    };
  } catch {
    return null;
  }
};

const getAuthScopeKey = (session) => (
  session ? JSON.stringify([session.actor, session.generation]) : ''
);

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
    parts.length !== 7
    || parts[0] !== 'media_assets'
    || parts[1] !== 'v1'
    || !PRIVATE_MEDIA_AUDIENCES.has(parts[2])
    || !CANONICAL_MEDIA_ASSET_ID_PATTERN.test(parts[4])
    || !/^[1-9][0-9]*$/.test(parts[5])
  ) return null;

  if (parts[6] === 'original') {
    return {
      audience: parts[2],
      ownerKey: parts[3],
      assetId: parts[4],
      sourceGeneration: parts[5],
      role: 'original',
      variant: '',
    };
  }

  if (PRIVATE_MEDIA_DERIVATIVE_NAMES.has(parts[6])) {
    return {
      audience: parts[2],
      ownerKey: parts[3],
      assetId: parts[4],
      sourceGeneration: parts[5],
      role: 'derivative',
      variant: parts[6],
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
    return normalized;
  }

  return (
    normalized.contentType === 'image/webp'
    && PRIVATE_MEDIA_DERIVATIVE_NAMES.has(parsed.variant)
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
    parsed?.role === 'original'
  ) ? normalized : null;
};

export const normalizePrivateAudioDescriptor = (value) => {
  const normalized = normalizePrivateMediaDescriptorForTypes(
    value,
    allowedPrivateAudioContentTypes
  );
  if (!normalized) return null;
  const parsed = parseCanonicalPrivateMediaPath(normalized.path);
  return (
    parsed?.role === 'original'
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

export const getPrivateAudioAssetKey = (descriptor) => {
  const normalized = normalizePrivateAudioDescriptor(descriptor);
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

  const freedBytes = record.cachedBytes > 0 || record.decodedBytes > 0;
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
  if (freedBytes) notifyCapacityAvailable();
  return true;
};

const isLiveRecord = (record) => (
  records.get(record.key) === record || detachedRecords.has(record)
);

const detachRecord = (record) => {
  if (records.get(record.key) !== record) return;
  records.delete(record.key);
  detachedRecords.add(record);
};

const disposeDetachedRecord = (record) => {
  if (record.refCount > 0 || record.status === 'loading') return;
  if (!detachedRecords.delete(record)) return;
  const freedBytes = record.cachedBytes > 0 || record.decodedBytes > 0;
  if (record.status === 'ready') {
    cachedBytes = Math.max(0, cachedBytes - record.cachedBytes);
    cachedDecodedBytes = Math.max(0, cachedDecodedBytes - record.decodedBytes);
    safelyRevokeObjectUrl(record.url);
  }
  record.status = 'evicted';
  record.url = '';
  record.cachedBytes = 0;
  record.decodedBytes = 0;
  if (freedBytes) notifyCapacityAvailable();
};

const findEvictionCandidate = (excludedKey = '', reclaimsCapacity = () => true) => (
  Array.from(records.values())
    .filter((record) => (
      record.key !== excludedKey
      && record.refCount === 0
      && (record.status === 'ready' || record.status === 'failed')
      && reclaimsCapacity(record)
    ))
    .sort((left, right) => left.lastAccess - right.lastAccess)[0]
);

const getUnreferencedPrivateMediaTotals = () => {
  let decodedBytes = 0;
  let recordCount = 0;
  records.forEach((record) => {
    if (record.refCount > 0) return;
    decodedBytes += record.decodedBytes || 0;
    recordCount += 1;
  });
  return { decodedBytes, recordCount };
};

const reserveRecordCapacity = () => {
  while (getUnreferencedPrivateMediaTotals().recordCount >= runtime.maxRecords) {
    const candidate = findEvictionCandidate();
    if (!candidate || !removeRecord(candidate)) {
      throw createCapacityPressureError(
        'private-media-record-budget-exceeded',
        'The private media record budget is exhausted.'
      );
    }
  }
};

const getEvictableCachedBytes = (excludedKey) => {
  let bytes = 0;
  records.forEach((record) => {
    if (
      record.key !== excludedKey
      && record.refCount === 0
      && record.status === 'ready'
    ) {
      bytes += record.cachedBytes || 0;
    }
  });
  return bytes;
};

// Transient portrait lane: a referenced bounded-drawable lease (a token
// portrait, released as soon as its drawable is decoded) may exceed the byte
// budget by at most this much in aggregate, and only once every evictable
// record is gone, i.e. when long-lived referenced media (an on-screen map or
// video) leaves no room at all. Idle-record trimming drains the overage as soon
// as the portrait releases, so the budget is restored without a cache change.
const getTransientLaneBytes = (record) => (
  record && record.drawableEdge > 0 && record.refCount > 0
    ? Math.min(
      runtime.maxTransientPortraitBytes,
      runtime.maxCacheBytes,
      Math.max(SHARED_TRANSIENT_PORTRAIT_BYTES, record.descriptor.bytes)
    )
    : 0
);

const getTransientOverageBytes = () => Math.max(
  0,
  cachedBytes + reservedBytes - runtime.maxCacheBytes
);

const reserveByteCapacity = (
  bytes,
  record,
  { laneBytes = getTransientLaneBytes(record) } = {}
) => {
  const protectedKey = record?.key || '';
  if (bytes > runtime.maxCacheBytes) {
    throw createPrivateMediaError(
      'private-media-byte-budget-exceeded',
      'The private media asset exceeds the cache byte budget.'
    );
  }

  // Referenced records and in-flight admissions cannot be evicted. When they
  // alone leave no room (beyond the transient lane, for bounded portraits),
  // fail without evicting idle (still useful) records.
  const minimumCommittedBytes = cachedBytes + reservedBytes + bytes
    - getEvictableCachedBytes(protectedKey);
  if (minimumCommittedBytes > runtime.maxCacheBytes + laneBytes) {
    throw createCapacityPressureError(
      'private-media-byte-budget-exceeded',
      'The private media cache byte budget is exhausted.'
    );
  }

  while (cachedBytes + reservedBytes + bytes > runtime.maxCacheBytes) {
    const candidate = findEvictionCandidate(protectedKey, (entry) => entry.cachedBytes > 0);
    if (!candidate || !removeRecord(candidate)) {
      // Everything evictable is gone; the feasibility check above admitted
      // this bounded portrait into the transient lane.
      if (minimumCommittedBytes > runtime.maxCacheBytes) return;
      throw createCapacityPressureError(
        'private-media-byte-budget-exceeded',
        'The private media cache byte budget is exhausted.'
      );
    }
  }
};

const getBoundedDecodedBytes = (width, height, maxEdge) => {
  if (!maxEdge || Math.max(width, height) <= maxEdge) return width * height * 4;
  const scale = maxEdge / Math.max(width, height);
  return Math.max(1, Math.round(width * scale)) * Math.max(1, Math.round(height * scale)) * 4;
};

// Decoded cost of the drawable consumers build from this record: the full
// image, or the bounded drawable when every holder draws a bounded copy.
const getRecordDecodedBytes = (record) => {
  const { descriptor } = record;
  if (!allowedPrivateImageContentTypes.has(descriptor.contentType)) return 0;
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    getBoundedDecodedBytes(descriptor.width, descriptor.height, record.drawableEdge)
  );
};

const getReferencedBoundedDecodedBytes = (excludedRecord) => {
  let bytes = 0;
  const add = (record) => {
    if (record !== excludedRecord && record.refCount > 0 && record.drawableEdge > 0) {
      bytes += (record.decodedBytes || 0) + (record.reservedDecodedBytes || 0);
    }
  };
  records.forEach(add);
  detachedRecords.forEach(add);
  return bytes;
};

// `decodedBytes` is the additional charge; `ownDecodedBytes` is the record's
// whole charge once admitted (used by the oversized and bounded allowances).
const reserveDecodedCapacity = (decodedBytes, protectedRecord, {
  referenced = protectedRecord.refCount > 0,
  bounded = protectedRecord.drawableEdge > 0,
  ownDecodedBytes = decodedBytes,
} = {}) => {
  while (true) {
    const unreferencedDecodedBytes = getUnreferencedPrivateMediaTotals().decodedBytes;
    const exceedsUnreferencedBudget = unreferencedDecodedBytes
      + (referenced ? 0 : decodedBytes)
      > runtime.maxDecodedBytes;
    const exceedsTotalBudget = cachedDecodedBytes + reservedDecodedBytes + decodedBytes
      > runtime.maxTotalDecodedBytes;
    if (!exceedsUnreferencedBudget && !exceedsTotalBudget) return;

    const candidate = findEvictionCandidate(protectedRecord.key, (entry) => entry.decodedBytes > 0);
    if (!candidate || !removeRecord(candidate)) {
      // One explicitly referenced legacy map may itself exceed the total cap.
      // It remains usable and visible in stats; all unreferenced work has
      // already been evicted and low-priority image work is gated separately.
      if (
        referenced
        && ownDecodedBytes > runtime.maxTotalDecodedBytes
        && !exceedsUnreferencedBudget
      ) return;
      // A referenced bounded drawable (token portrait) may share the remaining
      // overage with other bounded drawables once nothing else is evictable;
      // its consumer releases the lease as soon as the drawable is decoded.
      if (
        referenced
        && bounded
        && !exceedsUnreferencedBudget
        && getReferencedBoundedDecodedBytes(protectedRecord) + ownDecodedBytes
          <= runtime.maxBoundedDecodeOverageBytes
      ) return;
      throw createCapacityPressureError(
        'private-media-decoded-budget-exceeded',
        'The private media decoded-image budget is exhausted.'
      );
    }
  }
};

const trimInactiveRecordsToBudgets = () => {
  while (true) {
    const unreferencedTotals = getUnreferencedPrivateMediaTotals();
    const overByteLimit = cachedBytes > runtime.maxCacheBytes;
    const overDecodedLimit = cachedDecodedBytes > runtime.maxTotalDecodedBytes
      || unreferencedTotals.decodedBytes > runtime.maxDecodedBytes;
    const overRecordLimit = unreferencedTotals.recordCount > runtime.maxRecords;
    if (!overByteLimit && !overDecodedLimit && !overRecordLimit) return;
    const candidate = findEvictionCandidate('', (entry) => (
      overRecordLimit || (overByteLimit && entry.cachedBytes > 0) || (overDecodedLimit && entry.decodedBytes > 0)
    ));
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

const restoreBoundedBlobContentType = (blob, descriptor) => {
  const blobType = typeof blob?.type === 'string'
    ? blob.type.trim().toLowerCase()
    : '';
  if (blobType || typeof blob?.slice !== 'function') return blob;

  // Firebase Storage bounds getBlob() with Blob.slice(), whose default type is
  // empty. Restore the already-validated manifest type without removing the
  // download-size bound or accepting a conflicting non-empty response type.
  return blob.slice(0, blob.size, descriptor.contentType);
};

const getFailureBackoffMs = (failureCount) => (
  runtime.failureBackoffMs[Math.max(
    0,
    Math.min(runtime.failureBackoffMs.length - 1, failureCount - 1)
  )]
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
  // A failed (possibly unauthorized) fetch revokes drawable reuse for it.
  authorizations.delete(record.key);
  touch(record);
  settleRecord(record, 'reject', normalizedError);
};

// Pressure is not a property of the asset: drop the attempt instead of putting
// the record into failure backoff, so a later acquisition can admit it as soon
// as capacity frees (admission is checked before any network access).
const discardPressuredRecord = (record, error) => {
  records.delete(record.key);
  record.status = 'pressured';
  record.error = error;
  settleRecord(record, 'reject', error);
};

const admitRecordFetch = (record, epoch) => {
  reserveByteCapacity(record.descriptor.bytes, record);
  const decodedBytes = getRecordDecodedBytes(record);
  reserveDecodedCapacity(decodedBytes, record);
  record.reservedBytes = record.descriptor.bytes;
  record.reservedDecodedBytes = decodedBytes;
  record.reservationEpoch = epoch;
  reservedBytes += record.reservedBytes;
  reservedDecodedBytes += decodedBytes;
  record.authScope = getAuthScopeKey(readAuthSession()) || UNSHAREABLE_AUTH_SCOPE;
};

const releaseRecordReservation = (record) => {
  const bytes = record.reservedBytes || 0;
  const decodedBytes = record.reservedDecodedBytes || 0;
  record.reservedBytes = 0;
  record.reservedDecodedBytes = 0;
  if ((!bytes && !decodedBytes) || record.reservationEpoch !== runtimeEpoch) return;
  reservedBytes = Math.max(0, reservedBytes - bytes);
  reservedDecodedBytes = Math.max(0, reservedDecodedBytes - decodedBytes);
};

const getDrawableIdentity = (descriptor, scope) => JSON.stringify([
  'private-media-drawable',
  descriptor.path,
  descriptor.generation,
  descriptor.bytes,
  descriptor.contentType,
  descriptor.width,
  descriptor.height,
  scope,
]);

// Records that these exact immutable bytes were downloaded under one auth
// scope. A scope change during the download records nothing and makes the
// bytes unshareable: only the holders that were already waiting receive them.
const recordAuthorization = (record, objectUrl) => {
  const scope = getAuthScopeKey(readAuthSession());
  if (!scope || scope !== record.authScope || detachedRecords.has(record)) {
    record.authScope = UNSHAREABLE_AUTH_SCOPE;
    return;
  }
  authorizations.delete(record.key);
  authorizations.set(record.key, { scope, descriptor: record.descriptor });
  while (authorizations.size > PRIVATE_MEDIA_MAX_AUTHORIZATIONS) {
    authorizations.delete(authorizations.keys().next().value);
  }
  if (allowedPrivateImageContentTypes.has(record.descriptor.contentType)) {
    // Bounded drawables decoded from this URL are shared by identity, so a
    // later URL for the same authorized bytes reuses them after eviction.
    registerImageAssetSourceIdentity(objectUrl, getDrawableIdentity(record.descriptor, scope));
  }
};

const fetchRecord = async (record, epoch) => {
  let admitted = false;
  try {
    admitRecordFetch(record, epoch);
    admitted = true;
    const storageApi = await runtime.loadStorageApi();
    if (epoch !== runtimeEpoch || !isLiveRecord(record)) return;

    const objectRef = storageApi.ref(storageApi.storage, record.descriptor.path);
    const fetchedBlob = await storageApi.getBlob(
      objectRef,
      record.descriptor.bytes
    );
    if (epoch !== runtimeEpoch || !isLiveRecord(record)) return;

    const blob = restoreBoundedBlobContentType(
      fetchedBlob,
      record.descriptor
    );
    validateFetchedBlob(blob, record.descriptor);
    const objectUrl = runtime.createObjectURL(blob);
    if (typeof objectUrl !== 'string' || !objectUrl) {
      throw createPrivateMediaError(
        'private-media-object-url-invalid',
        'Private media did not produce a usable object URL.'
      );
    }

    // Validation guarantees that the fetched bytes exactly match the existing
    // reservation, including if another portrait was admitted in the meantime.
    // The decoded reservation follows holder changes (see
    // applyRecordDrawableEdge), so both convert without a second admission.
    const decodedBytes = record.reservedDecodedBytes || 0;
    releaseRecordReservation(record);
    record.status = 'ready';
    record.url = objectUrl;
    record.cachedBytes = blob.size;
    record.decodedBytes = decodedBytes;
    record.error = null;
    record.retryAt = 0;
    cachedBytes += blob.size;
    cachedDecodedBytes += decodedBytes;
    touch(record);
    recordAuthorization(record, objectUrl);
    settleRecord(record, 'resolve', {
      key: record.key,
      url: objectUrl,
      descriptor: record.descriptor,
    });
    trimInactiveRecordsToBudgets();
  } catch (error) {
    if (epoch !== runtimeEpoch || !isLiveRecord(record)) return;
    if (detachedRecords.has(record)) {
      // Superseded by a newer-scope record: no backoff or authorization
      // bookkeeping for the key, just settle the old-scope holders.
      record.status = 'failed';
      record.error = error;
      settleRecord(record, 'reject', error);
    } else if (isPrivateMediaCapacityPressureError(error)) {
      discardPressuredRecord(record, error);
    } else {
      markRecordFailed(record, error);
    }
  } finally {
    releaseRecordReservation(record);
    if (admitted && record.status !== 'ready') notifyCapacityAvailable();
    if (detachedRecords.has(record) && record.status !== 'loading') {
      disposeDetachedRecord(record);
    }
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

const createRecord = (descriptor, key, drawableEdge) => ({
  key,
  descriptor,
  // 0 = some holder decodes the full image; N = every holder draws <= N px.
  // Derived from the live holders (see holderEdges); kept when none remain.
  drawableEdge,
  // Live holder count per requested edge (0 = full resolution).
  holderEdges: new Map(),
  status: 'idle',
  refCount: 0,
  cachedBytes: 0,
  reservedBytes: 0,
  reservedDecodedBytes: 0,
  reservationEpoch: -1,
  // Auth scope that downloaded the current bytes (null until admitted).
  authScope: null,
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

const normalizeDrawableEdge = (value) => {
  const edge = Math.floor(Number(value));
  return Number.isFinite(edge) && edge > 0 ? edge : 0;
};

// Effective drawable edge for the live holders (plus an optional joining one):
// any full-resolution holder means 0, otherwise the largest bound requested.
const getHolderDrawableEdge = (record, joiningEdge = null) => {
  let full = joiningEdge === 0;
  let maxEdge = joiningEdge > 0 ? joiningEdge : 0;
  record.holderEdges.forEach((count, edge) => {
    if (count < 1) return;
    if (edge === 0) full = true;
    else maxEdge = Math.max(maxEdge, edge);
  });
  if (full) return 0;
  return maxEdge > 0 ? maxEdge : record.drawableEdge;
};

const isWiderDrawableEdge = (nextEdge, currentEdge) => (
  currentEdge > 0 && (nextEdge === 0 || nextEdge > currentEdge)
);

const getRecordDecodedCharge = (record) => (
  record.status === 'ready' ? record.decodedBytes : record.reservedDecodedBytes
);

// Moves the record's decoded charge (cached when ready, reserved while the
// admitted fetch is in flight) to what its current holders decode.
const applyRecordDrawableEdge = (record, drawableEdge) => {
  if (record.drawableEdge === drawableEdge) return 0;
  record.drawableEdge = drawableEdge;
  const nextDecodedBytes = getRecordDecodedBytes(record);
  let delta = 0;
  if (record.status === 'ready') {
    delta = nextDecodedBytes - record.decodedBytes;
    cachedDecodedBytes = Math.max(0, cachedDecodedBytes + delta);
    record.decodedBytes = nextDecodedBytes;
  } else if (record.status === 'loading' && record.reservationEpoch === runtimeEpoch) {
    delta = nextDecodedBytes - record.reservedDecodedBytes;
    reservedDecodedBytes = Math.max(0, reservedDecodedBytes + delta);
    record.reservedDecodedBytes = nextDecodedBytes;
  }
  return delta;
};

// A holder that needs more than the record's admitted drawable must pay the
// difference under its own rules before sharing it. A full-resolution holder
// is ordinary media: the record's encoded bytes must fit the normal byte
// budget (never the transient portrait lane, which only bounded holders that
// release after decoding may use) and the full decode the normal decoded
// budgets. Throws a capacity-pressure error without joining otherwise.
const admitWiderHolder = (record, nextEdge) => {
  if (record.status !== 'ready' && record.status !== 'loading') return;
  const nextDecodedBytes = allowedPrivateImageContentTypes.has(record.descriptor.contentType)
    ? Math.min(
      Number.MAX_SAFE_INTEGER,
      getBoundedDecodedBytes(record.descriptor.width, record.descriptor.height, nextEdge)
    )
    : 0;
  if (nextEdge === 0) reserveByteCapacity(0, record, { laneBytes: 0 });
  reserveDecodedCapacity(
    Math.max(0, nextDecodedBytes - getRecordDecodedCharge(record)),
    record,
    { referenced: true, bounded: nextEdge > 0, ownDecodedBytes: nextDecodedBytes }
  );
};

const addRecordHolder = (record, drawableEdge) => {
  record.holderEdges.set(drawableEdge, (record.holderEdges.get(drawableEdge) || 0) + 1);
  record.refCount += 1;
};

const removeRecordHolder = (record, drawableEdge) => {
  const count = (record.holderEdges.get(drawableEdge) || 0) - 1;
  if (count > 0) record.holderEdges.set(drawableEdge, count);
  else record.holderEdges.delete(drawableEdge);
  record.refCount = Math.max(0, record.refCount - 1);
  // Narrow to the remaining holders; the last edge is kept once none remain.
  if (record.refCount > 0) return applyRecordDrawableEdge(record, getHolderDrawableEdge(record));
  return 0;
};

// A holder refused before joining (capacity pressure, another account's
// bytes) settles like a pressured fetch: through its promise, holding nothing.
const createRejectedLease = (key, descriptor, error) => {
  const promise = Promise.reject(error);
  void promise.catch(() => {});
  return {
    key,
    descriptor,
    promise,
    release: () => {},
  };
};

const acquireNormalizedPrivateMediaAsset = (descriptor, options = {}) => {
  const drawableEdge = allowedPrivateImageContentTypes.has(descriptor?.contentType)
    ? normalizeDrawableEdge(options.maxDrawableEdge)
    : 0;
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
    // Bytes (or a failure) obtained under another auth scope (another actor,
    // or the same actor before an access-generation change) are never served
    // to this one. An idle record is dropped; one still held or in flight for
    // the old scope is detached for its holders, and this scope fetches anew.
    if (
      record.authScope !== null
      && record.authScope !== getAuthScopeKey(readAuthSession())
    ) {
      if (!removeRecord(record)) detachRecord(record);
      record = null;
    }
  }

  if (record) {
    if (record.status === 'failed' && runtime.now() >= record.retryAt) {
      shouldBeginAttempt = true;
    }
    const nextEdge = getHolderDrawableEdge(record, drawableEdge);
    if (isWiderDrawableEdge(nextEdge, record.drawableEdge)) {
      try {
        admitWiderHolder(record, nextEdge);
      } catch (error) {
        return createRejectedLease(key, descriptor, error);
      }
    }
    addRecordHolder(record, drawableEdge);
    applyRecordDrawableEdge(record, nextEdge);
  } else {
    reserveRecordCapacity();
    record = createRecord(descriptor, key, drawableEdge);
    records.set(key, record);
    shouldBeginAttempt = true;
    addRecordHolder(record, drawableEdge);
  }

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
    if (detachedRecords.has(record)) {
      removeRecordHolder(record, drawableEdge);
      disposeDetachedRecord(record);
      return;
    }
    if (records.get(key) !== record) return;

    const decodedDelta = removeRecordHolder(record, drawableEdge);
    touch(record);
    if (record.refCount === 0 && record.status === 'queued') {
      record.status = 'cancelled';
      records.delete(key);
      settleRecord(record, 'reject', createAbortError());
      return;
    }
    trimInactiveRecordsToBudgets();
    if (
      (record.refCount === 0 && record.status === 'ready' && record.cachedBytes > 0)
      || decodedDelta < 0
    ) {
      notifyCapacityAvailable();
    }
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

// `maxDrawableEdge` declares that this holder only draws a drawable bounded to
// that many px (and releases its lease once decoded); it never relaxes the
// authenticated fetch or the exact per-file manifest validation.
export const acquirePrivateMediaAsset = (value, options) => (
  acquireNormalizedPrivateMediaAsset(normalizePrivateMediaDescriptor(value), options)
);

export const acquirePrivateVideoAsset = (value) => (
  acquireNormalizedPrivateMediaAsset(normalizePrivateVideoDescriptor(value))
);

export const acquirePrivateAudioAsset = (value) => (
  acquireNormalizedPrivateMediaAsset(normalizePrivateAudioDescriptor(value))
);

// Stable identity of a bounded drawable decoded from these exact immutable
// bytes, or '' unless they were downloaded under the current auth scope with
// identical metadata and no later fetch of them failed. The image registry
// keys bounded drawables by it, so consumers can reuse a drawable after the
// compressed blob (and its object URL) was evicted, without downloading.
export const getPrivateMediaDrawableIdentity = (value) => {
  const descriptor = normalizePrivateMediaDescriptor(value);
  if (!descriptor) return '';
  const key = getNormalizedPrivateMediaAssetKey(descriptor);
  const authorization = authorizations.get(key);
  const scope = getAuthScopeKey(readAuthSession());
  if (
    !authorization
    || !scope
    || authorization.scope !== scope
    || descriptorsConflict(authorization.descriptor, descriptor)
    || records.get(key)?.status === 'failed'
  ) return '';
  return getDrawableIdentity(descriptor, scope);
};

export const getPrivateMediaAssetCacheSnapshot = () => {
  const unreferencedTotals = getUnreferencedPrivateMediaTotals();
  return {
    profile: runtime.profile,
    activeFetches,
    cachedBytes,
    reservedBytes,
    reservedDecodedBytes,
    transientOverageBytes: getTransientOverageBytes(),
    maxTransientPortraitBytes: runtime.maxTransientPortraitBytes,
    capacityWaiterCount: capacityListeners.size,
    cachedDecodedBytes,
    referencedDecodedBytes: Math.max(0, cachedDecodedBytes - unreferencedTotals.decodedBytes),
    unreferencedDecodedBytes: unreferencedTotals.decodedBytes,
    unreferencedRecordCount: unreferencedTotals.recordCount,
    maxActiveFetches: runtime.maxActiveFetches,
    maxCacheBytes: runtime.maxCacheBytes,
    maxDecodedBytes: runtime.maxDecodedBytes,
    maxTotalDecodedBytes: runtime.maxTotalDecodedBytes,
    maxRecords: runtime.maxRecords,
    failureBackoffMs: [...runtime.failureBackoffMs],
    delayedReleaseCount: delayedReleaseHandles.size,
    queuedFetches: pendingRecords.filter((record) => record.status === 'queued').length,
    recordCount: records.size,
    detachedRecordCount: detachedRecords.size,
    records: Array.from(records.values()).map((record) => ({
      key: record.key,
      path: record.descriptor.path,
      generation: record.descriptor.generation,
      status: record.status,
      refCount: record.refCount,
      bytes: record.cachedBytes,
      decodedBytes: record.decodedBytes,
      drawableEdge: record.drawableEdge,
      retryAt: record.retryAt,
    })),
  };
};

export const __resetPrivateMediaAssetsForTests = () => {
  runtimeEpoch += 1;
  pendingRecords.splice(0, pendingRecords.length);
  delayedReleaseHandles.forEach((handle) => {
    clearTimeout(handle);
  });
  delayedReleaseHandles.clear();
  [...records.values(), ...detachedRecords].forEach((record) => {
    if (record.status === 'ready') safelyRevokeObjectUrl(record.url);
    if (record.status === 'queued' || record.status === 'loading') {
      settleRecord(record, 'reject', createAbortError());
    }
  });
  records.clear();
  detachedRecords.clear();
  authorizations.clear();
  cachedBytes = 0;
  reservedBytes = 0;
  reservedDecodedBytes = 0;
  capacityNotificationScheduled = false;
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
  runtime.maxTotalDecodedBytes = Math.max(
    runtime.maxDecodedBytes,
    Math.floor(runtime.maxTotalDecodedBytes)
  );
  runtime.maxRecords = Math.max(1, Math.floor(runtime.maxRecords));
  runtime.maxBoundedDecodeOverageBytes = Math.max(
    0,
    Math.floor(Number(runtime.maxBoundedDecodeOverageBytes) || 0)
  );
  runtime.maxTransientPortraitBytes = Math.max(
    0,
    Math.floor(Number(runtime.maxTransientPortraitBytes) || 0)
  );
  runtime.maxActiveFetches = Math.max(
    1,
    Math.min(PRIVATE_MEDIA_MAX_ACTIVE_FETCHES, Math.floor(runtime.maxActiveFetches))
  );
  runtime.failureBackoffMs = Array.isArray(runtime.failureBackoffMs)
    && runtime.failureBackoffMs.length > 0
    && runtime.failureBackoffMs.every((delayMs) => Number.isFinite(delayMs) && delayMs >= 1)
    ? runtime.failureBackoffMs.map((delayMs) => Math.floor(delayMs))
    : [...PRIVATE_MEDIA_FAILURE_BACKOFF_MS];
};
