const ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;

const isRecord = (value) => (
  value != null && typeof value === 'object' && !Array.isArray(value)
);

const readEntityMedia = (entity) => {
  if (isRecord(entity?.media)) return entity.media;
  if (isRecord(entity?.General?.media)) return entity.General.media;
  return null;
};

export const isTask07ReadyCanonicalMedia = (
  value,
  expectedKinds = []
) => {
  const media = isRecord(value) ? value : null;
  const allowedKinds = new Set(
    (Array.isArray(expectedKinds) ? expectedKinds : [expectedKinds])
      .filter(Boolean)
  );
  const originalPath = typeof media?.original?.path === 'string'
    ? media.original.path.trim()
    : '';

  return Boolean(
    media
    && media.schemaVersion === 1
    && media.contractVersion === 1
    && media.state === 'ready'
    && ASSET_ID_PATTERN.test(media.assetId || '')
    && originalPath
    && (!allowedKinds.size || allowedKinds.has(media.kind))
  );
};

const readyEntityMedia = (entity, expectedKinds) => {
  const media = readEntityMedia(entity);
  return isTask07ReadyCanonicalMedia(media, expectedKinds) ? media : null;
};

export const resolveTask07BoardTokenCanonicalMedia = ({
  tokenType,
  profile,
  foeSource,
  customTokenProjection,
  characterMedia,
}) => {
  if (tokenType === 'character') {
    if (isTask07ReadyCanonicalMedia(characterMedia, ['avatar'])) {
      return characterMedia;
    }
    return readyEntityMedia(profile, ['avatar']);
  }

  if (tokenType === 'foe') {
    return readyEntityMedia(profile, ['token', 'foe'])
      || readyEntityMedia(foeSource, ['foe']);
  }

  if (tokenType === 'custom') {
    const media = customTokenProjection?.media;
    return isTask07ReadyCanonicalMedia(media, ['token']) ? media : null;
  }

  return null;
};
