const normalizeStoragePath = (path) => {
  const normalized = String(path || '').trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) return '';
  return normalized;
};

export function extractFirebaseStoragePath(fileUrl) {
  const value = String(fileUrl || '').trim();
  const marker = '/o/';
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return '';

  const encodedPath = value.slice(markerIndex + marker.length).split('?')[0];
  if (!encodedPath) return '';

  try {
    return normalizeStoragePath(decodeURIComponent(encodedPath));
  } catch {
    return '';
  }
}

export function createDeferredStorageCleanup(deletePath, options = {}) {
  if (typeof deletePath !== 'function') {
    throw new TypeError('deletePath must be a function.');
  }

  const { onError } = options || {};
  const pendingPaths = new Set();

  const addPath = (path) => {
    const normalizedPath = normalizeStoragePath(path);
    if (!normalizedPath) return false;
    pendingPaths.add(normalizedPath);
    return true;
  };

  const addUrl = (fileUrl) => addPath(extractFirebaseStoragePath(fileUrl));

  const flush = async () => {
    const paths = Array.from(pendingPaths);
    if (paths.length === 0) {
      return { deleted: [], failed: [], pendingPaths: [] };
    }

    const results = await Promise.allSettled(
      paths.map((path) => Promise.resolve().then(() => deletePath(path)))
    );
    const deleted = [];
    const failed = [];

    results.forEach((result, index) => {
      const path = paths[index];
      if (result.status === 'fulfilled') {
        pendingPaths.delete(path);
        deleted.push(path);
        return;
      }

      const failure = { path, error: result.reason };
      failed.push(failure);
      if (typeof onError === 'function') {
        try {
          onError(failure);
        } catch {
          // Cleanup reporting must never turn a committed save into a failure.
        }
      }
    });

    return {
      deleted,
      failed,
      pendingPaths: Array.from(pendingPaths),
    };
  };

  return {
    addPath,
    addUrl,
    flush,
    get pendingCount() {
      return pendingPaths.size;
    },
  };
}
