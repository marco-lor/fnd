import { stableUserDataJson } from '../../../data/userData/legacyInventoryProjection';

const stableInventoryId = (entry) => (
  entry?._task05?.inventoryId || entry?._instance?.instanceId || null
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

const catalogIdentity = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry.id || entry.itemId || entry.name || entry?.General?.Nome || null;
};

export const resolveEquippedInventoryIds = ({ inventory = [], equipped = {} } = {}) => {
  const candidates = inventory.map((entry) => ({
    entry,
    inventoryId: stableInventoryId(entry),
    catalogId: catalogIdentity(entry),
    snapshot: stableUserDataJson(comparableSnapshot(entry)),
  }));
  const usedIds = new Set();

  Object.values(equipped || {}).forEach((rawEntry) => {
    if (!rawEntry) return;
    const requestedId = typeof rawEntry === 'string'
      ? rawEntry
      : stableInventoryId(rawEntry);
    let candidate = requestedId
      ? candidates.find(({ inventoryId }) => inventoryId === requestedId && !usedIds.has(inventoryId))
      : null;
    if (!candidate && rawEntry && typeof rawEntry === 'object') {
      const requestedSnapshot = stableUserDataJson(comparableSnapshot(rawEntry));
      candidate = candidates.find(({ inventoryId, snapshot }) => (
        inventoryId && !usedIds.has(inventoryId) && snapshot === requestedSnapshot
      ));
    }
    if (!candidate) {
      const requestedCatalogId = catalogIdentity(rawEntry);
      candidate = candidates.find(({ inventoryId, catalogId }) => (
        inventoryId && !usedIds.has(inventoryId) && catalogId === requestedCatalogId
      ));
    }
    if (candidate?.inventoryId) usedIds.add(candidate.inventoryId);
  });

  return usedIds;
};

export const buildAvailableEquipmentInventory = ({ inventory = [], equipped = {} } = {}) => {
  const equippedStableIds = resolveEquippedInventoryIds({ inventory, equipped });
  const equippedCatalogCounts = {};

  Object.values(equipped || {}).forEach((entry) => {
    if (!entry) return;
    const catalogId = catalogIdentity(entry);
    if (catalogId) equippedCatalogCounts[catalogId] = (equippedCatalogCounts[catalogId] || 0) + 1;
  });
  const resolvedCatalogCounts = {};
  inventory.forEach((entry) => {
    const inventoryId = stableInventoryId(entry);
    const catalogId = catalogIdentity(entry);
    if (inventoryId && equippedStableIds.has(inventoryId) && catalogId) {
      resolvedCatalogCounts[catalogId] = (resolvedCatalogCounts[catalogId] || 0) + 1;
    }
  });
  const unresolvedEquippedCounts = Object.fromEntries(Object.entries(equippedCatalogCounts)
    .map(([catalogId, count]) => [
      catalogId,
      Math.max(0, count - (resolvedCatalogCounts[catalogId] || 0)),
    ]));

  const nonVarieInstances = [];
  const varieTotals = {};
  const ordinalByIdCounter = {};

  inventory.forEach((entry, inventoryIndex) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      const ordinal = (ordinalByIdCounter[entry] = (ordinalByIdCounter[entry] || 0) + 1);
      nonVarieInstances.push({
        id: entry,
        name: entry,
        qty: 1,
        type: 'oggetto',
        isVarie: false,
        invIndex: inventoryIndex,
        dupOrdinal: ordinal,
      });
      return;
    }

    const id = catalogIdentity(entry);
    const name = entry?.General?.Nome || entry.name || id;
    const type = String(entry.type || entry.item_type || '').toLowerCase();
    const quantity = typeof entry.qty === 'number' ? Math.max(1, entry.qty) : 1;
    if (type === 'varie') {
      if (!varieTotals[id]) {
        varieTotals[id] = { id, name, qty: 0, type: 'varie', isVarie: true };
      }
      varieTotals[id].qty += quantity;
      return;
    }

    for (let unit = 0; unit < quantity; unit += 1) {
      const ordinal = (ordinalByIdCounter[id] = (ordinalByIdCounter[id] || 0) + 1);
      nonVarieInstances.push({
        ...entry,
        id,
        name,
        qty: 1,
        type: type || 'oggetto',
        isVarie: false,
        invIndex: inventoryIndex,
        dupOrdinal: ordinal,
      });
    }
  });

  const usedFallbackCounts = {};
  const availableNonVarie = nonVarieInstances.filter((entry) => {
    const inventoryId = stableInventoryId(entry);
    if (inventoryId && equippedStableIds.has(inventoryId)) return false;
    const catalogId = catalogIdentity(entry);
    const used = usedFallbackCounts[catalogId] || 0;
    if (!inventoryId && used < (unresolvedEquippedCounts[catalogId] || 0)) {
      usedFallbackCounts[catalogId] = used + 1;
      return false;
    }
    return true;
  });

  const availableVarie = Object.values(varieTotals)
    .map((entry) => ({
      ...entry,
      qty: Math.max(0, entry.qty - (equippedCatalogCounts[entry.id] || 0)),
    }))
    .filter((entry) => entry.qty > 0)
    .sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id));

  const numberedNonVarie = availableNonVarie.map((entry) => {
    const baseName = entry.name || entry.id;
    return {
      ...entry,
      displayName: entry.dupOrdinal > 1 ? `${baseName} (${entry.dupOrdinal})` : baseName,
    };
  });

  return [...numberedNonVarie, ...availableVarie];
};
