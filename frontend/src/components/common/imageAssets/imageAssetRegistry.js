const imageAssetRecords = new Map();

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
  record.listeners.forEach((listener) => {
    listener(snapshot);
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

const getOrCreateImageAssetRecord = (src) => {
  const normalizedSrc = normalizeImageAssetSrc(src);
  if (!normalizedSrc) {
    return null;
  }

  const existingRecord = imageAssetRecords.get(normalizedSrc);
  if (existingRecord) {
    return existingRecord;
  }

  const nextRecord = {
    src: normalizedSrc,
    status: 'idle',
    image: null,
    error: null,
    snapshot: EMPTY_IMAGE_ASSET_SNAPSHOT,
    promise: null,
    listeners: new Set(),
  };
  imageAssetRecords.set(normalizedSrc, nextRecord);
  return nextRecord;
};

const loadImageAssetRecord = (record) => {
  if (!record) {
    return Promise.resolve(null);
  }

  if (record.image && record.status === 'loaded') {
    return record.promise || Promise.resolve(record.image);
  }

  if (record.promise) {
    return record.promise;
  }

  const ImageConstructor = getImageConstructor();
  if (!ImageConstructor) {
    const missingImageError = new Error('Image loading is not available in this environment.');
    updateImageAssetRecord(record, {
      status: 'error',
      image: null,
      error: missingImageError,
    });
    notifyImageAssetListeners(record);
    return Promise.reject(missingImageError);
  }

  updateImageAssetRecord(record, {
    status: 'loading',
    image: null,
    error: null,
  });
  notifyImageAssetListeners(record);

  const loadPromise = new Promise((resolve, reject) => {
    const nextImage = new ImageConstructor();

    const finalizeSuccess = () => {
      updateImageAssetRecord(record, {
        status: 'loaded',
        image: nextImage,
        error: null,
      });
      notifyImageAssetListeners(record);
      resolve(nextImage);
    };

    const finalizeError = (errorEvent) => {
      const nextError = errorEvent instanceof Error
        ? errorEvent
        : new Error(`Failed to load image asset: ${record.src}`);

      updateImageAssetRecord(record, {
        status: 'error',
        image: null,
        error: nextError,
      });
      record.promise = null;
      notifyImageAssetListeners(record);
      reject(nextError);
    };

    nextImage.onload = () => {
      nextImage.onload = null;
      nextImage.onerror = null;
      finalizeSuccess();
    };

    nextImage.onerror = (errorEvent) => {
      nextImage.onload = null;
      nextImage.onerror = null;
      finalizeError(errorEvent);
    };

    nextImage.src = record.src;
  });

  record.promise = loadPromise;
  return loadPromise;
};

export function getImageAssetSnapshot(src) {
  const normalizedSrc = normalizeImageAssetSrc(src);
  if (!normalizedSrc) {
    return EMPTY_IMAGE_ASSET_SNAPSHOT;
  }

  const record = imageAssetRecords.get(normalizedSrc);
  return buildImageAssetSnapshot(record);
}

export function subscribeToImageAsset(src, listener) {
  const record = getOrCreateImageAssetRecord(src);
  if (!record || typeof listener !== 'function') {
    return () => {};
  }

  record.listeners.add(listener);

  return () => {
    record.listeners.delete(listener);
  };
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

  return Promise.all(
    uniqueSrcs.map((src) => ensureImageAsset(src).catch(() => null))
  );
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

  let cancelled = false;
  const handle = requestIdleHandle(() => {
    if (cancelled) {
      return;
    }

    preloadImageAssets(uniqueSrcs);
  });

  return () => {
    cancelled = true;
    cancelIdleHandle(handle);
  };
}

export function __resetImageAssetRegistry() {
  imageAssetRecords.clear();
}


