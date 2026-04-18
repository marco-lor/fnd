import { useEffect, useState } from 'react';
import {
  ensureImageAsset,
  getImageAssetSnapshot,
  subscribeToImageAsset,
} from './imageAssetRegistry';

export function useImageAssetSnapshot(src) {
  const normalizedSrc = typeof src === 'string' ? src.trim() : '';
  const [snapshot, setSnapshot] = useState(() => getImageAssetSnapshot(normalizedSrc));

  useEffect(() => {
    if (!normalizedSrc) {
      setSnapshot(getImageAssetSnapshot(''));
      return undefined;
    }

    setSnapshot(getImageAssetSnapshot(normalizedSrc));
    const unsubscribe = subscribeToImageAsset(normalizedSrc, setSnapshot);
    ensureImageAsset(normalizedSrc).catch(() => null);

    return () => unsubscribe();
  }, [normalizedSrc]);

  return snapshot;
}

export default function useImageAsset(src) {
  const snapshot = useImageAssetSnapshot(src);

  return snapshot.image;
}
