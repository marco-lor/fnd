import {
  collectInventoryCatalogItemIds,
  resolveInventoryCatalogMedia,
  resolveInventoryCatalogMediaList,
} from './inventoryCatalogProjection';

const media = (letter) => ({ assetId: `m_${letter.repeat(40)}` });

describe('inventory catalog media projection', () => {
  test('joins canonical catalog media into a purchased instance without persisting a copy', () => {
    const purchased = {
      id: 'sword-1',
      General: { Nome: 'Spada' },
      _task05: {
        inventoryId: 'purchase-receipt-1',
        catalogItemId: 'sword-1',
      },
    };
    const catalogMedia = media('a');

    const projected = resolveInventoryCatalogMedia(purchased, {
      'sword-1': {
        id: 'sword-1',
        media: catalogMedia,
        task07MediaRevision: 7,
      },
    });

    expect(projected).not.toBe(purchased);
    expect(projected.media).toBe(catalogMedia);
    expect(projected.task07MediaRevision).toBe(7);
    expect(purchased).not.toHaveProperty('media');
  });

  test('keeps canonical private inventory media ahead of catalog media', () => {
    const privateMedia = media('b');
    const inventoryItem = {
      media: privateMedia,
      task07MediaRevision: 3,
      _task05: { catalogItemId: 'sword-1' },
    };

    expect(resolveInventoryCatalogMedia(inventoryItem, {
      'sword-1': { media: media('c'), task07MediaRevision: 8 },
    })).toBe(inventoryItem);
  });

  test('deduplicates referenced catalog IDs and preserves list identity without a join', () => {
    const entries = [
      { _task05: { catalogItemId: 'sword-1' } },
      { _task05: { catalogItemId: 'sword-1' } },
      { _task05: { catalogItemId: 'shield-1' } },
      { id: 'legacy-only' },
    ];

    expect(collectInventoryCatalogItemIds(entries)).toEqual(['shield-1', 'sword-1']);
    expect(resolveInventoryCatalogMediaList(entries, {})).toBe(entries);
  });

  test('never borrows catalog media for a custom item with an explicit null catalog reference', () => {
    const customVarie = {
      id: 'catalog-id-collision',
      name: 'Lanterna privata',
      _task05: {
        inventoryId: 'varie-receipt-1',
        catalogItemId: null,
      },
    };

    const projected = resolveInventoryCatalogMedia(customVarie, {
      'catalog-id-collision': { media: media('e') },
    });

    expect(projected).toBe(customVarie);
    expect(collectInventoryCatalogItemIds([customVarie])).toEqual([]);
  });});
