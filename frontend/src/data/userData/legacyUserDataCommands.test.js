import {
  legacyMutateInventory,
  legacyPurchaseItem,
  legacySetEquipment,
} from './legacyUserDataCommands';
import { buildLegacyInventoryBindings } from './legacyInventoryProjection';
import { doc, runTransaction, updateDoc } from '../../performance/firestore';

jest.mock('../../components/firebaseConfig', () => ({ db: {} }));

jest.mock('../../performance/firestore', () => ({
  doc: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  increment: jest.fn((value) => ({ __increment: value })),
  runTransaction: jest.fn(),
  updateDoc: jest.fn(),
}));

const executeWithUserData = async (userData, command) => {
  let written;
  runTransaction.mockImplementationOnce(async (_db, callback) => callback({
    get: jest.fn(async () => ({ exists: () => true, data: () => userData })),
    update: jest.fn((_ref, patch) => { written = patch; }),
  }));
  await command();
  return written;
};

describe('legacy inventory compatibility mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
  });

  test('removes only the selected raw duplicate row', async () => {
    const inventory = [
      { id: 'torch', item_type: 'tool', General: { Nome: 'Torch' } },
      { id: 'torch', item_type: 'tool', General: { Nome: 'Torch' } },
    ];
    const [first] = buildLegacyInventoryBindings(inventory);
    const written = await executeWithUserData({ inventory, equipped: {} }, () => (
      legacyMutateInventory({
        uid: 'user-1',
        action: 'remove',
        inventoryId: first.inventoryId,
        legacyIndex: first.legacyIndex,
      })
    ));

    expect(written.inventory).toHaveLength(1);
    expect(written.inventory[0]).toEqual(inventory[1]);
  });

  test('decrements one non-Varie unit instead of dropping a quantity row', async () => {
    const inventory = [{ id: 'arrow', item_type: 'ammo', qty: 3 }];
    const [, secondUnit] = buildLegacyInventoryBindings(inventory);
    const written = await executeWithUserData({ inventory, equipped: {} }, () => (
      legacyMutateInventory({
        uid: 'user-1',
        action: 'remove',
        inventoryId: secondUnit.inventoryId,
        legacyIndex: 0,
      })
    ));

    expect(written.inventory).toEqual([{ id: 'arrow', item_type: 'ammo', qty: 2 }]);
  });

  test('removeMany still removes every projected unit of a row', async () => {
    const inventory = [{ id: 'arrow', item_type: 'ammo', qty: 3 }];
    const inventoryIds = buildLegacyInventoryBindings(inventory).map(({ inventoryId }) => inventoryId);
    const written = await executeWithUserData({ inventory, equipped: {} }, () => (
      legacyMutateInventory({ uid: 'user-1', action: 'removeMany', inventoryIds })
    ));

    expect(written.inventory).toEqual([]);
  });

  test('fails closed when a stale stable ID points at a still-valid legacy index', async () => {
    const inventory = [{ id: 'arrow', item_type: 'ammo' }];
    await expect(executeWithUserData({ inventory, equipped: {} }, () => (
      legacyMutateInventory({
        uid: 'user-1',
        action: 'remove',
        inventoryId: 'stale-inventory-id',
        legacyIndex: 0,
      })
    ))).rejects.toThrow('Inventory item not found');
  });

  test('rejects a partial quantity-row removal while a sibling unit is equipped', async () => {
    const inventory = [{
      id: 'arrow',
      item_type: 'ammo',
      qty: 2,
      _instance: { instanceId: 'arrow-base' },
    }];
    const [first, second] = buildLegacyInventoryBindings(inventory);
    await expect(executeWithUserData({
      inventory,
      equipped: {
        weaponMain: {
          id: 'arrow',
          item_type: 'ammo',
          _instance: { instanceId: second.inventoryId },
        },
      },
    }, () => legacyMutateInventory({
      uid: 'user-1',
      action: 'remove',
      inventoryId: first.inventoryId,
    }))).rejects.toThrow('stessa riga di quantita');
  });

  test('equipment persistence strips adapter-only metadata but keeps the stable instance ID', async () => {
    await legacySetEquipment({
      uid: 'user-1',
      slot: 'weaponMain',
      item: {
        id: 'sword',
        _instance: { instanceId: 'legacy-sword-1' },
        _task05: { inventoryId: 'legacy-sword-1', legacyIndex: 0, legacyUnit: 0 },
      },
    });

    expect(updateDoc.mock.calls[0][1]).toEqual({
      'equipped.weaponMain': {
        id: 'sword',
        _instance: { instanceId: 'legacy-sword-1' },
      },
    });
  });
});

describe('legacy purchase compatibility mutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
  });

  test('derives authorization, price, and acquired data from the current catalog document', async () => {
    let written;
    runTransaction.mockImplementationOnce(async (_db, callback) => callback({
      get: jest.fn(async (ref) => {
        if (ref.path === 'items/weapon-1') {
          return {
            id: 'weapon-1',
            exists: () => true,
            data: () => ({
              visibility: 'all',
              General: { Nome: 'Fresh Sword', prezzo: 25 },
              item_type: 'weapon',
            }),
          };
        }
        return {
          id: 'user-1',
          exists: () => true,
          data: () => ({ role: 'player', stats: { gold: 100 }, inventory: [] }),
        };
      }),
      update: jest.fn((_ref, patch) => { written = patch; }),
    }));

    const result = await legacyPurchaseItem({
      uid: 'user-1',
      item: {
        id: 'weapon-1',
        visibility: 'all',
        General: { Nome: 'Stale Sword', prezzo: 1 },
      },
    });

    expect(result).toEqual(expect.objectContaining({ success: true, price: 25, newGold: 75 }));
    expect(written['stats.gold']).toBe(75);
    expect(written.inventory[0]).toEqual(expect.objectContaining({
      id: 'weapon-1',
      General: { Nome: 'Fresh Sword', prezzo: 25 },
      _instance: expect.objectContaining({ pricePaid: 25, source: 'bazaar' }),
    }));
  });

  test('rejects a stale custom-visible item when the current catalog no longer authorizes the user', async () => {
    const update = jest.fn();
    runTransaction.mockImplementationOnce(async (_db, callback) => callback({
      get: jest.fn(async (ref) => (ref.path === 'items/weapon-1'
        ? {
          id: 'weapon-1',
          exists: () => true,
          data: () => ({
            visibility: 'custom',
            allowed_users: ['another-user'],
            General: { Nome: 'Private Sword', prezzo: 10 },
          }),
        }
        : {
          id: 'user-1',
          exists: () => true,
          data: () => ({ role: 'player', stats: { gold: 100 }, inventory: [] }),
        })),
      update,
    }));

    const result = await legacyPurchaseItem({
      uid: 'user-1',
      item: {
        id: 'weapon-1',
        visibility: 'custom',
        allowed_users: ['user-1'],
        General: { prezzo: 1 },
      },
    });

    expect(result).toEqual({ error: 'Oggetto non disponibile.', price: 10, gold: 100 });
    expect(update).not.toHaveBeenCalled();
  });
});
