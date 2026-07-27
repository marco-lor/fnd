const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;
const SOURCE_GENERATION_PATTERN = /^[1-9][0-9]*$/;
const AUDIENCES = new Set(['signed-in', 'owner-manager', 'dm-only']);
const GENERATED_NAMES = new Set([
  'original',
  'thumbnail',
  'thumbnail2x',
  'card',
  'card2x',
  'gallery',
  'gallery2x',
  'poster',
  'poster2x',
]);

export const buildTask07GeneratedFamilyPrefix = ({
  audience,
  ownerKey,
  assetId,
  sourceGeneration,
}) => {
  const generation = String(sourceGeneration || '');
  if (
    !AUDIENCES.has(audience)
    || !SAFE_SEGMENT_PATTERN.test(ownerKey || '')
    || !ASSET_ID_PATTERN.test(assetId || '')
    || !SOURCE_GENERATION_PATTERN.test(generation)
  ) {
    throw new TypeError('Task 07 generated media identity is invalid.');
  }
  return `media_assets/v1/${audience}/${ownerKey}/${assetId}/${generation}/`;
};

export const isTask07GeneratedMediaPath = (value) => {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('://')) {
    return false;
  }
  const parts = value.split('/');
  return (
    parts.length === 7
    && parts[0] === 'media_assets'
    && parts[1] === 'v1'
    && AUDIENCES.has(parts[2])
    && SAFE_SEGMENT_PATTERN.test(parts[3])
    && ASSET_ID_PATTERN.test(parts[4])
    && SOURCE_GENERATION_PATTERN.test(parts[5])
    && GENERATED_NAMES.has(parts[6])
  );
};
