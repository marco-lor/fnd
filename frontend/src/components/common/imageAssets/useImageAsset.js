import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  ensureImageAsset,
  getImageAssetSnapshot,
  subscribeToImageAsset,
} from './imageAssetRegistry';

export function useImageAssetSnapshot(src) {
  const normalizedSrc = typeof src === 'string' ? src.trim() : '';
  const subscribe = useCallback(
    (listener) => subscribeToImageAsset(normalizedSrc, listener),
    [normalizedSrc]
  );
  const getSnapshot = useCallback(
    () => getImageAssetSnapshot(normalizedSrc),
    [normalizedSrc]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!normalizedSrc) {
      return undefined;
    }

    ensureImageAsset(normalizedSrc).catch(() => null);
    return undefined;
  }, [normalizedSrc]);

  return snapshot;
}

export default function useImageAsset(src) {
  const snapshot = useImageAssetSnapshot(src);

  return snapshot.image;
}


