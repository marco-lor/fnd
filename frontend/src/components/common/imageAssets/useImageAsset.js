import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  ensureImageAsset,
  getImageAssetSnapshot,
  subscribeToImageAsset,
} from './imageAssetRegistry';

// `maxEdge` (optional) asks the registry for a shared drawable bounded to that
// many px on its longest side; oversized sources drop their full decode.
export function useImageAssetSnapshot(src, { maxEdge = 0 } = {}) {
  const normalizedSrc = typeof src === 'string' ? src.trim() : '';
  const normalizedMaxEdge = Number(maxEdge) > 0 ? Math.floor(Number(maxEdge)) : 0;
  const subscribe = useCallback(
    (listener) => subscribeToImageAsset(normalizedSrc, listener, {
      maxEdge: normalizedMaxEdge,
    }),
    [normalizedMaxEdge, normalizedSrc]
  );
  const getSnapshot = useCallback(
    () => getImageAssetSnapshot(normalizedSrc, { maxEdge: normalizedMaxEdge }),
    [normalizedMaxEdge, normalizedSrc]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!normalizedSrc) {
      return undefined;
    }

    ensureImageAsset(normalizedSrc, { maxEdge: normalizedMaxEdge }).catch(() => null);
    return undefined;
  }, [normalizedMaxEdge, normalizedSrc]);

  return snapshot;
}

export default function useImageAsset(src, options) {
  const snapshot = useImageAssetSnapshot(src, options);

  return snapshot.image;
}
