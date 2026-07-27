const TASK07_CANONICAL_MEDIA_ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;

const resolveMediaManifest = (mediaOrEntity) => {
  if (!mediaOrEntity || typeof mediaOrEntity !== 'object' || Array.isArray(mediaOrEntity)) {
    return null;
  }
  if (mediaOrEntity.media && typeof mediaOrEntity.media === 'object') {
    return mediaOrEntity.media;
  }
  if (mediaOrEntity.General?.media && typeof mediaOrEntity.General.media === 'object') {
    return mediaOrEntity.General.media;
  }
  return mediaOrEntity;
};

export const getCanonicalTask07MediaAssetId = (mediaOrEntity) => {
  const media = resolveMediaManifest(mediaOrEntity);
  const assetId = typeof media?.assetId === 'string' ? media.assetId.trim() : '';
  return TASK07_CANONICAL_MEDIA_ASSET_ID_PATTERN.test(assetId) ? assetId : '';
};

export const hasCanonicalTask07MediaAssetId = (mediaOrEntity) => (
  Boolean(getCanonicalTask07MediaAssetId(mediaOrEntity))
);
