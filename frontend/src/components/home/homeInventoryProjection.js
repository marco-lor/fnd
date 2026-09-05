import {
  resolveInventoryCatalogMediaList,
} from '../../data/inventoryCatalogProjection';
import { stableDataJson } from '../../data/userData/stableDataJson';
import {
  buildAvailableEquipmentInventory,
  resolveEquippedInventoryIds,
} from './elements/equipmentInventoryProjection';
import {
  useOptionalHomeReadSelector,
  useOptionalHomeReadStore,
} from './homeReadStore';
import { useMemo } from 'react';

export const HOME_INVENTORY_INITIAL_WINDOW = 60;

const inventoryDocumentId = (entry, index) => (
  entry?._task05?.inventoryId
  || entry?._instance?.instanceId
  || (typeof entry === 'string' ? entry : entry?.id)
  || `item-${index}`
);

const comparableSnapshot = (entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  const snapshot = { ...entry };
  delete snapshot._instance;
  delete snapshot._task05;
  delete snapshot.qty;
  delete snapshot.quantity;
  return snapshot;
};

const resolveEquippedEntries = (inventory, equipment) => {
  const inventoryById = Object.fromEntries(inventory.map((entry) => [
    entry?._task05?.inventoryId || entry?._instance?.instanceId,
    entry,
  ]).filter(([id]) => id));
  const candidates = [...inventory];
  const usedIds = new Set();
  const resolveEntry = (value) => {
    if (typeof value === 'string') return inventoryById[value] || value;
    if (!value || typeof value !== 'object') return value;
    const requestedId = value?._task05?.inventoryId || value?._instance?.instanceId;
    if (requestedId && inventoryById[requestedId]) return inventoryById[requestedId];
    const serialized = stableDataJson(comparableSnapshot(value));
    let candidate = candidates.find((entry) => {
      const id = entry?._task05?.inventoryId || entry?._instance?.instanceId;
      return !usedIds.has(id) && stableDataJson(comparableSnapshot(entry)) === serialized;
    });
    if (!candidate) {
      const catalogId = value.id || value.itemId;
      candidate = candidates.find((entry) => {
        const id = entry?._task05?.inventoryId || entry?._instance?.instanceId;
        return !usedIds.has(id) && (entry.id === catalogId || entry.itemId === catalogId);
      });
    }
    const resolvedId = candidate?._task05?.inventoryId || candidate?._instance?.instanceId;
    if (resolvedId) usedIds.add(resolvedId);
    return candidate || value;
  };
  const equipped = Object.fromEntries(Object.entries(
    equipment?.slots || equipment?.equipped || {}
  ).map(([slot, value]) => [slot, resolveEntry(value)]));
  return { equipped, inventoryById };
};

const buildInventoryItems = (inventory, equipment) => {
  const equippedValues = Object.values(equipment?.slots || equipment?.equipped || {}).filter(Boolean);
  const equippedInventoryIds = resolveEquippedInventoryIds({
    inventory,
    equipped: Object.fromEntries(equippedValues.map((value, index) => [index, value])),
  });
  const nonVarieInstances = [];
  const varieMap = {};
  inventory.forEach((entry, index) => {
    if (!entry) return;
    const baseId = typeof entry === 'string'
      ? entry
      : entry.id || entry.name || entry?.General?.Nome || `item-${index}`;
    const baseName = typeof entry === 'string'
      ? entry
      : entry?.General?.Nome || entry.name || baseId;
    const type = typeof entry === 'string' ? '' : (entry.type || entry.item_type || '').toLowerCase();
    const rarity = typeof entry === 'object' ? entry.rarity : undefined;
    const quantity = typeof entry === 'object' && typeof entry.qty === 'number'
      ? Math.max(1, entry.qty)
      : 1;
    const stableInventoryId = inventoryDocumentId(entry, index);
    const docObj = typeof entry === 'object' ? { ...entry, id: baseId } : null;
    const isEquipped = equippedInventoryIds.has(stableInventoryId);
    if (type === 'varie') {
      if (!varieMap[baseId]) {
        varieMap[baseId] = {
          id: baseId,
          name: baseName,
          qty: 0,
          rarity,
          type: 'varie',
          doc: docObj,
          instances: [],
          isEquipped: false,
        };
      }
      varieMap[baseId].qty += quantity;
      varieMap[baseId].instances.push({
        inventoryId: stableInventoryId,
        legacyIndex: entry?._task05?.legacyIndex,
        quantity,
        doc: docObj,
      });
      varieMap[baseId].isEquipped = varieMap[baseId].isEquipped || isEquipped;
      return;
    }
    for (let ordinal = 0; ordinal < quantity; ordinal += 1) {
      nonVarieInstances.push({
        id: baseId,
        name: baseName,
        rarity,
        type: type || 'oggetto',
        doc: docObj,
        invIndex: index,
        inventoryId: stableInventoryId,
        legacyIndex: entry?._task05?.legacyIndex,
        isEquipped,
      });
    }
  });
  const seenCounts = {};
  const numberedNonVarie = nonVarieInstances.map((item) => {
    const count = (seenCounts[item.id] = (seenCounts[item.id] || 0) + 1);
    return { ...item, displayName: count > 1 ? `${item.name} (${count})` : item.name };
  });
  return [...numberedNonVarie, ...Object.values(varieMap)];
};

export const createHomeInventoryProjection = ({
  inventory = [],
  equipment = {},
  catalogItemsById = {},
} = {}) => {
  const resolvedInventory = resolveInventoryCatalogMediaList(inventory, catalogItemsById);
  const { equipped, inventoryById } = resolveEquippedEntries(resolvedInventory, equipment);
  const items = buildInventoryItems(resolvedInventory, equipment);
  const searchItems = items.map((item) => ({
    ...item,
    searchName: String(item.name || '').toLocaleLowerCase('it'),
    searchType: String(item.type || '').toLocaleLowerCase('it'),
  }));
  return Object.freeze({
    inventory: resolvedInventory,
    inventoryById: Object.freeze(inventoryById),
    equipped: Object.freeze(equipped),
    availableEquipment: Object.freeze(buildAvailableEquipmentInventory({
      inventory: resolvedInventory,
      equipped,
    })),
    items: Object.freeze(items),
    searchItems: Object.freeze(searchItems),
  });
};

export const createHomeInventoryProjectionSelector = () => {
  let previousInventory;
  let previousEquipment;
  let previousCatalog;
  let previousProjection;
  return ({ inventory, equipment, catalogItemsById }) => {
    if (
      previousProjection
      && previousInventory === inventory
      && previousEquipment === equipment
      && previousCatalog === catalogItemsById
    ) return previousProjection;
    previousInventory = inventory;
    previousEquipment = equipment;
    previousCatalog = catalogItemsById;
    previousProjection = createHomeInventoryProjection({ inventory, equipment, catalogItemsById });
    return previousProjection;
  };
};

export const filterHomeInventoryItems = (items, query) => {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('it');
  if (!normalizedQuery) return items;
  return items.filter((item) => (
    item.searchName.includes(normalizedQuery) || item.searchType.includes(normalizedQuery)
  ));
};

export const inventoryWindow = (items, requestedCount = HOME_INVENTORY_INITIAL_WINDOW) => {
  const count = Math.max(0, Math.min(items.length, Number(requestedCount) || 0));
  return {
    visibleItems: items.slice(0, count),
    totalCount: items.length,
    hasMore: count < items.length,
  };
};

export const useHomeInventoryProjection = (inputs) => {
  const homeStore = useOptionalHomeReadStore();
  const { catalogItemsById, equipment, inventory } = inputs;
  const localProjection = useMemo(
    () => (homeStore ? null : createHomeInventoryProjection({
      catalogItemsById,
      equipment,
      inventory,
    })),
    [catalogItemsById, equipment, homeStore, inventory]
  );
  return useOptionalHomeReadSelector(
    (state) => state.inventoryProjection,
    localProjection
  );
};
