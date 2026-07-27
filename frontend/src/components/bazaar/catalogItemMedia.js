const EMPTY_CATALOG_ITEM = Object.freeze({});

/**
 * Task 07 catalog attachments live on the item document root. Legacy URLs
 * remain nested under General as a rollback/fallback field.
 */
export const normalizeCatalogItemMedia = (item) => {
  const media = item && typeof item === 'object' && !Array.isArray(item)
    ? item
    : EMPTY_CATALOG_ITEM;
  const fallbackSrc = typeof media.General?.image_url === 'string'
    ? media.General.image_url
    : '';
  return { media, fallbackSrc };
};
