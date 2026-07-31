import { normalizeCatalogItemMedia } from './catalogItemMedia';

describe('Bazaar catalog media normalization', () => {
  test('keeps canonical media at the item root and the legacy URL as fallback', () => {
    const canonical = {
      assetId: `m_${'a'.repeat(40)}`,
      original: { path: 'media_assets/v1/catalog/original' },
    };
    const item = {
      id: 'catalog-item-1',
      media: canonical,
      task07MediaRevision: 3,
      General: {
        Nome: 'Spada',
        image_url: 'items/legacy-sword.png',
      },
    };

    expect(normalizeCatalogItemMedia(item)).toEqual({
      media: item,
      fallbackSrc: 'items/legacy-sword.png',
    });
    expect(normalizeCatalogItemMedia(item).media.media).toBe(canonical);
  });

  test('returns an empty safe model for a malformed catalog item', () => {
    expect(normalizeCatalogItemMedia(null)).toEqual({
      media: {},
      fallbackSrc: '',
    });
  });
});
