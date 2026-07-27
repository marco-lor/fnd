import { hasCanonicalTask07MediaAssetId } from '../common/canonicalMediaAsset';

const getPersistedStoragePath = (item) => {
  if (!item || typeof item !== 'object') return '';
  const explicitPath = typeof item.imagePath === 'string' ? item.imagePath.trim() : '';
  if (explicitPath) return explicitPath;
  const imageUrl = typeof item.imageUrl === 'string' ? item.imageUrl.trim() : '';
  const encodedPath = imageUrl.split('/o/')[1]?.split('?')[0] || '';
  if (!encodedPath) return '';
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return '';
  }
};

export const shouldClientDeleteFoeMainStorageObject = (foe) => (
  !hasCanonicalTask07MediaAssetId(foe)
);

export const collectClientDeletableFoeStoragePaths = (foe) => {
  const paths = new Set();
  const addPath = (item) => {
    const path = getPersistedStoragePath(item);
    if (path) paths.add(path);
  };

  // Canonical main media is retired by the server when the entity reference
  // disappears. Nested technique/spell images remain legacy client-owned data.
  if (shouldClientDeleteFoeMainStorageObject(foe)) {
    addPath(foe);
  }
  (Array.isArray(foe?.tecniche) ? foe.tecniche : []).forEach(addPath);
  (Array.isArray(foe?.spells) ? foe.spells : []).forEach(addPath);

  return [...paths];
};

export const buildCanonicalFoeImageRemovalPayload = (
  payload,
  currentFoe,
  deleteFieldValue
) => {
  const nextPayload = {
    ...(payload && typeof payload === 'object' ? payload : {}),
  };
  if (!hasCanonicalTask07MediaAssetId(currentFoe)) {
    return nextPayload;
  }

  // updateDoc must receive a deleteField sentinel. Merely omitting media would
  // preserve the old canonical reference and prevent lifecycle retirement.
  delete nextPayload.media;
  nextPayload.media = deleteFieldValue;
  return nextPayload;
};
