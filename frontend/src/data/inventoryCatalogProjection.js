const isRecord = (value) => (
  value != null && typeof value === 'object' && !Array.isArray(value)
);

const hasCanonicalMedia = (entity) => (
  isRecord(entity?.media)
  && typeof entity.media.assetId === 'string'
  && entity.media.assetId.trim().length > 0
);

export const inventoryCatalogItemId = (entry) => {
  const candidate = entry?._task05?.catalogItemId;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
};

export const collectInventoryCatalogItemIds = (entries) => Array.from(new Set(
  (Array.isArray(entries) ? entries : [])
    .map(inventoryCatalogItemId)
    .filter(Boolean)
)).sort();

export const resolveInventoryCatalogMedia = (entry, catalogItemsById = {}) => {
  if (!isRecord(entry) || hasCanonicalMedia(entry)) return entry;
  const catalogItemId = inventoryCatalogItemId(entry);
  const catalogItem = catalogItemId && isRecord(catalogItemsById)
    ? catalogItemsById[catalogItemId]
    : null;
  if (!hasCanonicalMedia(catalogItem)) return entry;

  return {
    ...entry,
    media: catalogItem.media,
    ...(Number.isSafeInteger(catalogItem.task07MediaRevision)
      ? { task07MediaRevision: catalogItem.task07MediaRevision }
      : {}),
    ...(catalogItem.mediaUpdatedAt !== undefined
      ? { mediaUpdatedAt: catalogItem.mediaUpdatedAt }
      : {}),
  };
};

export const resolveInventoryCatalogMediaList = (entries, catalogItemsById = {}) => {
  const source = Array.isArray(entries) ? entries : [];
  let changed = false;
  const projected = source.map((entry) => {
    const resolved = resolveInventoryCatalogMedia(entry, catalogItemsById);
    if (resolved !== entry) changed = true;
    return resolved;
  });
  return changed ? projected : source;
};
