const MEBIBYTE = 1024 * 1024;

export const IMAGE_ASSET_REGISTRY_LIMITS = Object.freeze({
  maxDecodedBytes: 96 * MEBIBYTE,
  maxConcurrentRequests: 4,
  maxRecords: 192,
  failureBackoffBaseMs: 1000,
  failureBackoffMaxMs: 30_000,
  // Covers the current one-second board/narration crossfades plus scheduling slack.
  releaseProtectionMs: 2000,
});

const imageAssetRecords = new Map();
const pendingImageAssetRequests = [];
const scheduledImageAssetPreloads = new Set();

let imageAssetRegistryConfig = { ...IMAGE_ASSET_REGISTRY_LIMITS };
let imageAssetRegistryGeneration = 0;
let imageAssetAccessSequence = 0;
let activeImageAssetRequestCount = 0;
let evictionTimerHandle = null;
let evictionTimerDueAt = 0;
let nowProvider = () => Date.now();

const EMPTY_IMAGE_ASSET_SNAPSHOT = {
  status: 'idle',
  image: null,
  error: null,
};

const normalizeImageAssetSrc = (src) => (
  typeof src === 'string' ? src.trim() : ''
);

const buildImageAssetSnapshot = (record) => record?.snapshot || EMPTY_IMAGE_ASSET_SNAPSHOT;

const updateImageAssetRecord = (record, { status, image, error }) => {
  record.status = status;
  record.image = image;
  record.error = error;
  record.snapshot = { status, image, error };
};

const notifyImageAssetListeners = (record) => {
  const snapshot = buildImageAssetSnapshot(record);
  record.listeners.forEach((subscription) => {
    subscription.listener(snapshot);
  });
};

const getImageConstructor = () => {
  if (typeof window !== 'undefined' && typeof window.Image === 'function') {
    return window.Image;
  }

  if (typeof Image === 'function') {
    return Image;
  }

  return null;
};

const getCurrentTime = () => {
  const currentTime = Number(nowProvider());
  return Number.isFinite(currentTime) ? currentTime : Date.now();
};

const touchImageAssetRecord = (record) => {
  if (!record) {
    return;
  }

  imageAssetAccessSequence += 1;
  record.lastAccessSequence = imageAssetAccessSequence;
};

const getOrCreateImageAssetRecord = (src) => {
  const normalizedSrc = normalizeImageAssetSrc(src);
  if (!normalizedSrc) {
    return null;
  }

  const existingRecord = imageAssetRecords.get(normalizedSrc);
  if (existingRecord) {
    touchImageAssetRecord(existingRecord);
    return existingRecord;
  }

  const nextRecord = {
    src: normalizedSrc,
    status: 'idle',
    image: null,
    error: null,
    snapshot: EMPTY_IMAGE_ASSET_SNAPSHOT,
    promise: null,
    request: null,
    listeners: new Set(),
    refCount: 0,
    decodedBytes: 0,
    failureCount: 0,
    retryAt: 0,
    protectedUntil: 0,
    lastAccessSequence: 0,
  };
  touchImageAssetRecord(nextRecord);
  imageAssetRecords.set(normalizedSrc, nextRecord);
  return nextRecord;
};

const estimateDecodedImageBytes = (image) => {
  const width = Number(
    image?.naturalWidth
    || image?.videoWidth
    || image?.width
    || 0
  );
  const height = Number(
    image?.naturalHeight
    || image?.videoHeight
    || image?.height
    || 0
  );

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 0;
  }

  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.ceil(width) * Math.ceil(height) * 4
  );
};

const getImageAssetFailureBackoffMs = (failureCount) => {
  const exponent = Math.max(0, Math.min(20, failureCount - 1));
  return Math.min(
    imageAssetRegistryConfig.failureBackoffMaxMs,
    imageAssetRegistryConfig.failureBackoffBaseMs * (2 ** exponent)
  );
};

const getImageAssetRecordRetentionDeadline = (record) => Math.max(
  record.protectedUntil || 0,
  record.status === 'error' ? record.retryAt || 0 : 0
);

const clearImageAssetEvictionTimer = () => {
  if (evictionTimerHandle === null) {
    return;
  }

  getTimerApi()?.clearTimeout(evictionTimerHandle);
  evictionTimerHandle = null;
  evictionTimerDueAt = 0;
};

const getImageAssetRegistryTotals = () => {
  let decodedBytes = 0;
  let loadedRecordCount = 0;
  let referencedRecordCount = 0;

  imageAssetRecords.forEach((record) => {
    decodedBytes += record.decodedBytes || 0;
    loadedRecordCount += record.status === 'loaded' && !!record.image ? 1 : 0;
    referencedRecordCount += record.refCount > 0 ? 1 : 0;
  });

  return {
    decodedBytes,
    loadedRecordCount,
    referencedRecordCount,
  };
};

const scheduleImageAssetCacheTrim = (dueAt) => {
  const timerApi = getTimerApi();
  if (!timerApi || !Number.isFinite(dueAt)) {
    return;
  }

  if (evictionTimerHandle !== null && evictionTimerDueAt <= dueAt) {
    return;
  }

  clearImageAssetEvictionTimer();
  evictionTimerDueAt = dueAt;
  evictionTimerHandle = timerApi.setTimeout(() => {
    evictionTimerHandle = null;
    evictionTimerDueAt = 0;
    trimImageAssetCache();
  }, Math.max(0, dueAt - getCurrentTime()));
};

const trimImageAssetCache = () => {
  clearImageAssetEvictionTimer();

  const now = getCurrentTime();
  let { decodedBytes } = getImageAssetRegistryTotals();
  let recordCount = imageAssetRecords.size;
  let needsDecodedByteTrim = decodedBytes > imageAssetRegistryConfig.maxDecodedBytes;
  let needsRecordTrim = recordCount > imageAssetRegistryConfig.maxRecords;

  if (!needsDecodedByteTrim && !needsRecordTrim) {
    return;
  }

  const candidates = [...imageAssetRecords.values()]
    .filter((record) => (
      record.refCount === 0
      && !record.request
      && getImageAssetRecordRetentionDeadline(record) <= now
    ))
    .sort((left, right) => left.lastAccessSequence - right.lastAccessSequence);

  for (const record of candidates) {
    needsDecodedByteTrim = decodedBytes > imageAssetRegistryConfig.maxDecodedBytes;
    needsRecordTrim = recordCount > imageAssetRegistryConfig.maxRecords;
    if (!needsDecodedByteTrim && !needsRecordTrim) {
      break;
    }
    if (!needsRecordTrim && (record.decodedBytes || 0) <= 0) {
      continue;
    }

    if (imageAssetRecords.get(record.src) !== record) {
      continue;
    }

    imageAssetRecords.delete(record.src);
    decodedBytes = Math.max(0, decodedBytes - (record.decodedBytes || 0));
    recordCount -= 1;
  }

  needsDecodedByteTrim = decodedBytes > imageAssetRegistryConfig.maxDecodedBytes;
  needsRecordTrim = recordCount > imageAssetRegistryConfig.maxRecords;
  if (!needsDecodedByteTrim && !needsRecordTrim) {
    return;
  }

  const nextRetentionDeadline = [...imageAssetRecords.values()]
    .filter((record) => (
      record.refCount === 0
      && !record.request
      && (
        needsRecordTrim
        || (record.decodedBytes || 0) > 0
      )
    ))
    .map(getImageAssetRecordRetentionDeadline)
    .filter((deadline) => deadline > now)
    .sort((left, right) => left - right)[0];

  if (Number.isFinite(nextRetentionDeadline)) {
    scheduleImageAssetCacheTrim(nextRetentionDeadline);
  }
};

const retainImageAssetRecord = (record) => {
  if (!record) {
    return () => {};
  }

  record.refCount += 1;
  touchImageAssetRecord(record);
  trimImageAssetCache();

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    record.refCount = Math.max(0, record.refCount - 1);
    touchImageAssetRecord(record);

    if (record.refCount === 0) {
      record.protectedUntil = Math.max(
        record.protectedUntil || 0,
        getCurrentTime() + imageAssetRegistryConfig.releaseProtectionMs
      );
    }

    trimImageAssetCache();
  };
};

const normalizeImageAssetLoadError = (record, errorEvent) => (
  errorEvent instanceof Error
    ? errorEvent
    : new Error(`Failed to load image asset: ${record.src}`)
);

const startImageAssetRequest = (record, request) => {
  request.state = 'active';
  activeImageAssetRequestCount += 1;

  let nextImage = null;
  let settled = false;

  const detachImageHandlers = () => {
    if (!nextImage) {
      return;
    }
    nextImage.onload = null;
    nextImage.onerror = null;
  };

  const finalizeRequest = ({ image = null, error = null }) => {
    if (
      settled
      || record.request !== request
      || request.generation !== imageAssetRegistryGeneration
    ) {
      return;
    }
    settled = true;
    detachImageHandlers();
    activeImageAssetRequestCount = Math.max(0, activeImageAssetRequestCount - 1);
    record.request = null;
    record.promise = null;
    request.image = null;

    if (image) {
      record.failureCount = 0;
      record.retryAt = 0;
      record.decodedBytes = estimateDecodedImageBytes(image);
      updateImageAssetRecord(record, {
        status: 'loaded',
        image,
        error: null,
      });
      touchImageAssetRecord(record);
      notifyImageAssetListeners(record);
      request.resolve(image);
    } else {
      const nextError = normalizeImageAssetLoadError(record, error);
      record.failureCount += 1;
      record.retryAt = getCurrentTime() + getImageAssetFailureBackoffMs(record.failureCount);
      record.decodedBytes = 0;
      updateImageAssetRecord(record, {
        status: 'error',
        image: null,
        error: nextError,
      });
      touchImageAssetRecord(record);
      notifyImageAssetListeners(record);
      request.reject(nextError);
    }

    trimImageAssetCache();
    drainImageAssetRequestQueue();
  };

  try {
    const ImageConstructor = getImageConstructor();
    if (!ImageConstructor) {
      throw new Error('Image loading is not available in this environment.');
    }

    nextImage = new ImageConstructor();
    request.image = nextImage;
    nextImage.onload = () => finalizeRequest({ image: nextImage });
    nextImage.onerror = (errorEvent) => finalizeRequest({ error: errorEvent });
    nextImage.src = record.src;
  } catch (error) {
    finalizeRequest({ error });
  }
};

const drainImageAssetRequestQueue = () => {
  while (
    activeImageAssetRequestCount < imageAssetRegistryConfig.maxConcurrentRequests
    && pendingImageAssetRequests.length > 0
  ) {
    const record = pendingImageAssetRequests.shift();
    const request = record?.request;
    if (
      !record
      || !request
      || request.state !== 'queued'
      || request.generation !== imageAssetRegistryGeneration
      || imageAssetRecords.get(record.src) !== record
    ) {
      continue;
    }

    startImageAssetRequest(record, request);
  }
};

const loadImageAssetRecord = (record) => {
  if (!record) {
    return Promise.resolve(null);
  }

  touchImageAssetRecord(record);

  if (record.image && record.status === 'loaded') {
    return Promise.resolve(record.image);
  }

  if (record.request) {
    return record.request.promise;
  }

  if (
    record.status === 'error'
    && record.error
    && record.retryAt > getCurrentTime()
  ) {
    return Promise.reject(record.error);
  }

  updateImageAssetRecord(record, {
    status: 'loading',
    image: null,
    error: null,
  });
  notifyImageAssetListeners(record);

  let resolveRequest;
  let rejectRequest;
  const loadPromise = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const request = {
    generation: imageAssetRegistryGeneration,
    state: 'queued',
    image: null,
    promise: loadPromise,
    resolve: resolveRequest,
    reject: rejectRequest,
  };

  record.promise = loadPromise;
  record.request = request;
  pendingImageAssetRequests.push(record);
  trimImageAssetCache();
  drainImageAssetRequestQueue();
  return loadPromise;
};

export function getImageAssetSnapshot(src) {
  const normalizedSrc = normalizeImageAssetSrc(src);
  if (!normalizedSrc) {
    return EMPTY_IMAGE_ASSET_SNAPSHOT;
  }

  const record = imageAssetRecords.get(normalizedSrc);
  touchImageAssetRecord(record);
  return buildImageAssetSnapshot(record);
}

export function subscribeToImageAsset(src, listener) {
  const record = getOrCreateImageAssetRecord(src);
  if (!record || typeof listener !== 'function') {
    return () => {};
  }

  const subscription = { listener };
  record.listeners.add(subscription);
  const releaseRecord = retainImageAssetRecord(record);
  let unsubscribed = false;

  return () => {
    if (unsubscribed) {
      return;
    }
    unsubscribed = true;
    record.listeners.delete(subscription);
    releaseRecord();
  };
}

export function retainImageAsset(src) {
  return retainImageAssetRecord(getOrCreateImageAssetRecord(src));
}

export function ensureImageAsset(src) {
  const record = getOrCreateImageAssetRecord(src);
  return loadImageAssetRecord(record);
}

export function preloadImageAssets(srcs) {
  const uniqueSrcs = [...new Set((srcs || []).map(normalizeImageAssetSrc).filter(Boolean))];
  if (!uniqueSrcs.length) {
    return Promise.resolve([]);
  }

  const preloadGeneration = imageAssetRegistryGeneration;
  const results = new Array(uniqueSrcs.length);
  const workerCount = Math.min(
    imageAssetRegistryConfig.maxConcurrentRequests,
    uniqueSrcs.length
  );

  return new Promise((resolve) => {
    let nextIndex = 0;
    let completedCount = 0;
    let resolved = false;

    const resolveResults = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(Array.from(results, (result) => result || null));
    };

    const startNext = () => {
      if (preloadGeneration !== imageAssetRegistryGeneration) {
        resolveResults();
        return;
      }

      const resultIndex = nextIndex;
      nextIndex += 1;
      ensureImageAsset(uniqueSrcs[resultIndex])
        .then(
          (image) => {
            results[resultIndex] = image;
          },
          () => {
            results[resultIndex] = null;
          }
        )
        .then(() => {
          completedCount += 1;
          if (completedCount >= uniqueSrcs.length) {
            resolveResults();
            return;
          }
          if (nextIndex < uniqueSrcs.length) {
            startNext();
          }
        });
    };

    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
      startNext();
    }
  });
}

const getTimerApi = () => {
  if (
    typeof setTimeout === 'function'
    && typeof clearTimeout === 'function'
  ) {
    return {
      setTimeout,
      clearTimeout,
    };
  }

  return null;
};

const requestIdleHandle = (callback) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return {
      kind: 'idle',
      id: window.requestIdleCallback(callback),
    };
  }

  const timerApi = getTimerApi();
  if (!timerApi) {
    callback();
    return null;
  }

  return {
    kind: 'timeout',
    id: timerApi.setTimeout(() => callback(), 32),
  };
};

const cancelIdleHandle = (handle) => {
  if (!handle) {
    return;
  }

  if (handle.kind === 'idle' && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(handle.id);
    return;
  }

  getTimerApi()?.clearTimeout(handle.id);
};

export function scheduleImageAssetPreload(srcs) {
  const uniqueSrcs = [...new Set((srcs || []).map(normalizeImageAssetSrc).filter(Boolean))];
  if (!uniqueSrcs.length) {
    return () => {};
  }

  const scheduledPreload = {
    cancelled: false,
    handle: null,
  };
  scheduledImageAssetPreloads.add(scheduledPreload);
  scheduledPreload.handle = requestIdleHandle(() => {
    scheduledImageAssetPreloads.delete(scheduledPreload);
    if (scheduledPreload.cancelled) {
      return;
    }

    preloadImageAssets(uniqueSrcs);
  });

  return () => {
    if (scheduledPreload.cancelled) {
      return;
    }
    scheduledPreload.cancelled = true;
    scheduledImageAssetPreloads.delete(scheduledPreload);
    cancelIdleHandle(scheduledPreload.handle);
  };
}

export function __getImageAssetRegistryStats() {
  const totals = getImageAssetRegistryTotals();
  return {
    recordCount: imageAssetRecords.size,
    loadedRecordCount: totals.loadedRecordCount,
    referencedRecordCount: totals.referencedRecordCount,
    decodedBytes: totals.decodedBytes,
    queuedRequestCount: pendingImageAssetRequests.filter((record) => (
      record?.request?.state === 'queued'
    )).length,
    activeRequestCount: activeImageAssetRequestCount,
    limits: { ...imageAssetRegistryConfig },
  };
}

const normalizeNonNegativeInteger = (value, fallback) => (
  Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
);

export function __configureImageAssetRegistryForTests({
  maxDecodedBytes,
  maxConcurrentRequests,
  maxRecords,
  failureBackoffBaseMs,
  failureBackoffMaxMs,
  releaseProtectionMs,
  now,
} = {}) {
  const nextFailureBackoffBaseMs = normalizeNonNegativeInteger(
    failureBackoffBaseMs,
    imageAssetRegistryConfig.failureBackoffBaseMs
  );

  imageAssetRegistryConfig = {
    maxDecodedBytes: normalizeNonNegativeInteger(
      maxDecodedBytes,
      imageAssetRegistryConfig.maxDecodedBytes
    ),
    maxConcurrentRequests: Math.max(
      1,
      normalizeNonNegativeInteger(
        maxConcurrentRequests,
        imageAssetRegistryConfig.maxConcurrentRequests
      )
    ),
    maxRecords: Math.max(
      1,
      normalizeNonNegativeInteger(maxRecords, imageAssetRegistryConfig.maxRecords)
    ),
    failureBackoffBaseMs: nextFailureBackoffBaseMs,
    failureBackoffMaxMs: Math.max(
      nextFailureBackoffBaseMs,
      normalizeNonNegativeInteger(
        failureBackoffMaxMs,
        imageAssetRegistryConfig.failureBackoffMaxMs
      )
    ),
    releaseProtectionMs: normalizeNonNegativeInteger(
      releaseProtectionMs,
      imageAssetRegistryConfig.releaseProtectionMs
    ),
  };

  if (typeof now === 'function') {
    nowProvider = now;
  }

  trimImageAssetCache();
  drainImageAssetRequestQueue();
  return __getImageAssetRegistryStats();
}

export function __resetImageAssetRegistry() {
  imageAssetRegistryGeneration += 1;
  clearImageAssetEvictionTimer();

  scheduledImageAssetPreloads.forEach((scheduledPreload) => {
    scheduledPreload.cancelled = true;
    cancelIdleHandle(scheduledPreload.handle);
  });
  scheduledImageAssetPreloads.clear();
  pendingImageAssetRequests.length = 0;

  imageAssetRecords.forEach((record) => {
    const request = record.request;
    if (request) {
      if (request.image) {
        request.image.onload = null;
        request.image.onerror = null;
      }
      request.state = 'cancelled';
      request.image = null;
      request.resolve(null);
    }
    record.request = null;
    record.promise = null;
    record.listeners.clear();
    record.refCount = 0;
  });

  imageAssetRecords.clear();
  activeImageAssetRequestCount = 0;
  imageAssetAccessSequence = 0;
  imageAssetRegistryConfig = { ...IMAGE_ASSET_REGISTRY_LIMITS };
  nowProvider = () => Date.now();
}


