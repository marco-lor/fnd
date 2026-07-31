import {
  buildAvailableEquipmentInventory,
  resolveEquippedInventoryIds,
} from './equipmentInventoryProjection';

const sword = (inventoryId, quality) => ({
  id: 'sword',
  type: 'weapon',
  General: { Nome: 'Spada', Slot: 'Mano Principale' },
  quality,
  _instance: { instanceId: inventoryId },
  _task05: { inventoryId },
});

test('removes the exact equipped duplicate by stable inventory ID', () => {
  const first = sword('inventory-first', 'plain');
  const second = sword('inventory-second', 'enchanted');

  const available = buildAvailableEquipmentInventory({
    inventory: [first, second],
    equipped: { weaponMain: second },
  });

  expect(available).toHaveLength(1);
  expect(available[0]).toEqual(expect.objectContaining({
    quality: 'plain',
    displayName: 'Spada',
    _task05: { inventoryId: 'inventory-first' },
  }));
});

test('retains stable duplicate numbering when the first instance is equipped', () => {
  const first = sword('inventory-first', 'plain');
  const second = sword('inventory-second', 'enchanted');

  const available = buildAvailableEquipmentInventory({
    inventory: [first, second],
    equipped: { weaponMain: first },
  });

  expect(available).toHaveLength(1);
  expect(available[0]).toEqual(expect.objectContaining({
    quality: 'enchanted',
    displayName: 'Spada (2)',
    _task05: { inventoryId: 'inventory-second' },
  }));
});

test('keeps catalog-count fallback for unresolved legacy equipment', () => {
  const available = buildAvailableEquipmentInventory({
    inventory: ['torch', 'torch'],
    equipped: { weaponMain: 'torch' },
  });

  expect(available).toHaveLength(1);
  expect(available[0]).toEqual(expect.objectContaining({
    id: 'torch',
    displayName: 'torch (2)',
  }));
});

test('resolves an identity-free customized legacy duplicate to one stable candidate', () => {
  const first = sword('inventory-first', 'plain');
  const second = sword('inventory-second', 'enchanted');
  const legacyEquipped = { ...second };
  delete legacyEquipped._instance;
  delete legacyEquipped._task05;

  expect([...resolveEquippedInventoryIds({
    inventory: [first, second],
    equipped: { weaponMain: legacyEquipped },
  })]).toEqual(['inventory-second']);
});
