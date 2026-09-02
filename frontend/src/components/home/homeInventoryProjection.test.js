import {
  HOME_INVENTORY_INITIAL_WINDOW,
  createHomeInventoryProjection,
  createHomeInventoryProjectionSelector,
  filterHomeInventoryItems,
  inventoryWindow,
} from './homeInventoryProjection';

const makeInventory = (count) => Array.from({ length: count }, (_, index) => ({
  id: `catalog-${index}`,
  type: index % 10 === 0 ? 'varie' : 'oggetto',
  General: { Nome: `Fixture Item ${index}` },
  _task05: { inventoryId: `inventory-${index}`, catalogItemId: `catalog-${index}` },
}));

describe('Home inventory read projection', () => {
  test('normalizes 500 items once and precomputes stable search fields', () => {
    const inventory = makeInventory(500);
    const equipment = {};
    const catalogItemsById = {};
    const select = createHomeInventoryProjectionSelector();
    const first = select({ inventory, equipment, catalogItemsById });
    const second = select({ inventory, equipment, catalogItemsById });

    expect(second).toBe(first);
    expect(first.items).toHaveLength(500);
    expect(first.searchItems.find((item) => item.id === 'catalog-315')).toEqual(expect.objectContaining({
      searchName: 'fixture item 315',
      searchType: 'oggetto',
    }));
    expect(filterHomeInventoryItems(first.searchItems, 'ITEM 315')).toHaveLength(1);
  });

  test('bounds the initial mount and exposes every match through expansion', () => {
    const projection = createHomeInventoryProjection({
      inventory: makeInventory(500),
      equipment: {},
      catalogItemsById: {},
    });
    const initial = inventoryWindow(projection.searchItems, HOME_INVENTORY_INITIAL_WINDOW);
    const expanded = inventoryWindow(projection.searchItems, 500);

    expect(initial.visibleItems).toHaveLength(HOME_INVENTORY_INITIAL_WINDOW);
    expect(initial.hasMore).toBe(true);
    expect(expanded.visibleItems).toHaveLength(500);
    expect(expanded.hasMore).toBe(false);
  });
});
