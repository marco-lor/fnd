import { db } from '../../components/firebaseConfig';
import {
  doc,
  getDoc,
  increment,
  runTransaction,
  updateDoc,
} from '../../performance/firestore';
import {
  buildLegacyInventoryBindings,
  stableUserDataJson,
} from './legacyInventoryProjection';

const RESOURCE_FIELDS = Object.freeze({
  hp: 'hpCurrent',
  mana: 'manaCurrent',
  essenza: 'essenzaCurrent',
  barriera: 'barrieraCurrent',
});

const requireUid = (uid) => {
  if (typeof uid !== 'string' || !uid.trim()) throw new TypeError('A user UID is required.');
  return uid;
};

const equippedInventoryIds = (equipped, bindings) => {
  const used = new Set();
  const ids = new Set();
  Object.values(equipped || {}).forEach((rawEntry) => {
    if (!rawEntry) return;
    const requestedId = typeof rawEntry === 'string'
      ? rawEntry
      : rawEntry?._instance?.instanceId;
    let binding = requestedId
      ? bindings.find((candidate) => candidate.inventoryId === requestedId)
      : null;
    if (!binding && rawEntry && typeof rawEntry === 'object') {
      const snapshot = { ...rawEntry };
      delete snapshot._instance;
      delete snapshot._task05;
      delete snapshot.qty;
      delete snapshot.quantity;
      const serialized = stableUserDataJson(snapshot);
      binding = bindings.find((candidate) => (
        !used.has(candidate.inventoryId)
        && stableUserDataJson(candidate.snapshot) === serialized
      ));
    }
    if (!binding && requestedId) {
      binding = bindings.find((candidate) => (
        !used.has(candidate.inventoryId)
        && (candidate.snapshot.id === requestedId || candidate.snapshot.itemId === requestedId)
      ));
    }
    if (binding) {
      used.add(binding.inventoryId);
      ids.add(binding.inventoryId);
    }
  });
  return ids;
};

export const legacyPurchaseItem = async ({ uid, item }) => {
  const userId = requireUid(uid);
  if (!item?.id) return { error: 'Oggetto non valido.', price: 0, gold: 0 };
  const userRef = doc(db, 'users', userId);
  const itemRef = doc(db, 'items', item.id);

  return runTransaction(db, async (transaction) => {
    // The current catalog document is the authority even in compatibility
    // mode. Never purchase a stale UI snapshot after a UID/role/visibility or
    // price change.
    const catalogSnapshot = await transaction.get(itemRef);
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists()) return { error: 'Utente non trovato.', price: 0, gold: 0 };
    const data = snapshot.data() || {};
    const gold = Number(data?.stats?.gold) || 0;
    if (!catalogSnapshot.exists()) {
      return { error: 'Oggetto non disponibile.', price: 0, gold };
    }
    const catalogData = catalogSnapshot.data() || {};
    const visibility = String(catalogData.visibility || '').trim().toLowerCase();
    const allowedUsers = Array.isArray(catalogData.allowed_users) ? catalogData.allowed_users : [];
    const role = String(data.role || '').trim().toLowerCase();
    const canPurchase = role === 'dm'
      || visibility === 'all'
      || (visibility === 'custom' && allowedUsers.includes(userId));
    const rawPrice = catalogData?.General?.prezzo ?? catalogData?.General?.Prezzo ?? 0;
    const price = typeof rawPrice === 'number' ? rawPrice : parseInt(rawPrice, 10) || 0;
    if (!canPurchase) return { error: 'Oggetto non disponibile.', price, gold };
    if (price < 0) return { error: 'Prezzo non valido.', price: 0, gold };
    if (price > gold) return { insufficient: true, price, gold };
    const inventory = Array.isArray(data.inventory) ? [...data.inventory] : [];
    const qtyBefore = inventory.reduce((total, entry) => {
      const id = typeof entry === 'string' ? entry : entry?.id;
      return id === catalogSnapshot.id ? total + (Number(entry?.qty) || 1) : total;
    }, 0);
    const instanceId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const acquiredSnapshot = JSON.parse(JSON.stringify({
      ...catalogData,
      id: catalogSnapshot.id,
    }));
    acquiredSnapshot._instance = {
      instanceId,
      acquiredAt: new Date(),
      pricePaid: price,
      source: 'bazaar',
    };
    inventory.push(acquiredSnapshot);
    const newGold = gold - price;
    transaction.update(userRef, { 'stats.gold': newGold, inventory });
    return { success: true, newGold, price, gold, newQty: qtyBefore + 1 };
  });
};

export const legacyUpdateResource = ({
  uid,
  resource,
  mode,
  value,
  totalValue,
  totalTurns,
  remainingTurns,
}) => {
  const userId = requireUid(uid);
  const field = RESOURCE_FIELDS[resource];
  if (!field || !['set', 'delta'].includes(mode) || !Number.isFinite(Number(value))) {
    throw new TypeError('A valid legacy resource mutation is required.');
  }
  const updates = {
    [`stats.${field}`]: mode === 'delta' ? increment(Number(value)) : Number(value),
  };
  if (resource === 'barriera' && totalValue !== undefined) {
    updates['stats.barrieraTotal'] = Number(totalValue);
  }
  if (resource === 'barriera' && totalTurns !== undefined) {
    updates['active_turn_effect.barriera.totalTurns'] = Number(totalTurns);
  }
  if (resource === 'barriera' && remainingTurns !== undefined) {
    updates['active_turn_effect.barriera.remainingTurns'] = Number(remainingTurns);
  }
  return updateDoc(doc(db, 'users', userId), updates);
};

export const legacyAdjustGold = async ({ uid, delta }) => {
  const userId = requireUid(uid);
  const amount = Number(delta);
  if (!Number.isFinite(amount)) throw new TypeError('Gold delta must be finite.');
  const userRef = doc(db, 'users', userId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists()) throw new Error('User not found.');
    const current = Number(snapshot.data()?.stats?.gold) || 0;
    const next = Math.max(0, current + amount);
    transaction.update(userRef, { 'stats.gold': next });
    return { success: true, previousGold: current, newGold: next };
  });
};

export const legacyMutateInventory = async ({
  uid,
  action,
  inventoryId,
  inventoryIds,
  quantity,
  snapshot,
}) => {
  const userId = requireUid(uid);
  const userRef = doc(db, 'users', userId);
  return runTransaction(db, async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists()) throw new Error('User not found.');
    const data = userSnapshot.data() || {};
    const inventory = Array.isArray(data.inventory) ? [...data.inventory] : [];
    const equipped = data.equipped && typeof data.equipped === 'object' ? data.equipped : {};

    if (action === 'createVarie') {
      const normalizedQuantity = Math.max(1, Math.trunc(Number(quantity) || 1));
      const instanceId = `varie_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      inventory.push({
        ...(snapshot || {}),
        id: snapshot?.id || instanceId,
        type: 'varie',
        qty: normalizedQuantity,
        _instance: { instanceId, acquiredAt: new Date(), source: 'custom-varie' },
      });
      transaction.update(userRef, { inventory });
      return { success: true, inventoryId: instanceId, quantity: normalizedQuantity };
    }

    const bindings = buildLegacyInventoryBindings(inventory);
    const requestedIds = action === 'removeMany'
      ? new Set(Array.isArray(inventoryIds) ? inventoryIds : [])
      : new Set([inventoryId]);
    if ([...requestedIds].some((id) => !id)) throw new TypeError('Stable inventory IDs are required.');
    const requestedBindings = bindings.filter(({ inventoryId: candidateId }) => requestedIds.has(candidateId));
    if (requestedBindings.length !== requestedIds.size) throw new Error('Inventory item not found.');
    const equippedIds = equippedInventoryIds(equipped, bindings);
    if ((action === 'remove' || action === 'removeMany') && [...requestedIds].some((id) => equippedIds.has(id))) {
      throw new Error('Prima rimuovi l\'oggetto equipaggiato.');
    }
    if (action === 'remove' && requestedBindings.some((binding) => (
      binding.kind !== 'varie' && bindings.some((candidate) => (
        candidate.legacyIndex === binding.legacyIndex
        && candidate.inventoryId !== binding.inventoryId
        && equippedIds.has(candidate.inventoryId)
      ))
    ))) {
      throw new Error('Prima rimuovi gli oggetti equipaggiati dalla stessa riga di quantita.');
    }

    if (action === 'remove' || action === 'removeMany') {
      const removalsByIndex = requestedBindings.reduce((result, binding) => {
        result.set(binding.legacyIndex, (result.get(binding.legacyIndex) || 0) + 1);
        return result;
      }, new Map());
      const next = inventory.flatMap((entry, index) => {
        const removeCount = removalsByIndex.get(index) || 0;
        if (!removeCount) return [entry];
        const bindingCount = bindings.filter((binding) => binding.legacyIndex === index).length;
        if (removeCount >= bindingCount) return [];
        if (!entry || typeof entry !== 'object') return [];
        const currentQuantity = Math.max(1, Math.trunc(Number(entry.qty ?? entry.quantity) || 1));
        const nextQuantity = Math.max(1, currentQuantity - removeCount);
        if (entry.qty !== undefined) return [{ ...entry, qty: nextQuantity }];
        if (entry.quantity !== undefined) return [{ ...entry, quantity: nextQuantity }];
        return [{ ...entry, qty: nextQuantity }];
      });
      transaction.update(userRef, { inventory: next });
      return { success: true, removed: requestedBindings.length };
    }

    if (action === 'setQuantity') {
      const binding = bindings.find((candidate) => candidate.inventoryId === inventoryId);
      const index = binding?.legacyIndex ?? -1;
      if (index < 0) throw new Error('Inventory item not found.');
      const nextQuantity = Math.max(1, Math.trunc(Number(quantity) || 1));
      inventory[index] = { ...inventory[index], qty: nextQuantity };
      transaction.update(userRef, { inventory });
      return { success: true, inventoryId, quantity: nextQuantity };
    }

    throw new TypeError(`Unsupported legacy inventory action: ${String(action)}`);
  });
};

export const legacySetEquipment = ({ uid, slot, item, parameterUpdates = {} }) => {
  const storedItem = item && typeof item === 'object' && !Array.isArray(item)
    ? { ...item }
    : item ?? null;
  if (storedItem && typeof storedItem === 'object') delete storedItem._task05;
  return updateDoc(doc(db, 'users', requireUid(uid)), {
    [`equipped.${slot}`]: storedItem,
    ...parameterUpdates,
  });
};

export const legacyUpdateProgression = ({ uid, patch }) => {
  const updates = {};
  Object.entries(patch || {}).forEach(([rootKey, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value).forEach(([field, fieldValue]) => {
        updates[`${rootKey}.${field}`] = fieldValue;
      });
    } else {
      updates[rootKey] = value;
    }
  });
  return updateDoc(doc(db, 'users', requireUid(uid)), updates);
};

export const legacyConsumeConsumable = async ({ uid, item, slotKey, mode, gain = null }) => {
  const userRef = doc(db, 'users', requireUid(uid));
  const userSnapshot = await getDoc(userRef);
  if (!userSnapshot.exists()) return { success: false, reason: 'user-not-found' };
  const data = userSnapshot.data() || {};
  const inventory = Array.isArray(data.inventory) ? [...data.inventory] : [];
  const matchId = item?.id || item?.name || item?.General?.Nome;
  let removedCompletely = false;
  for (let index = 0; index < inventory.length; index += 1) {
    const entry = inventory[index];
    if (!entry || typeof entry !== 'object') continue;
    const entryId = entry.id || entry.name || entry?.General?.Nome;
    if (entryId !== matchId) continue;
    const quantity = Number(entry.qty || 1);
    if (quantity > 1) inventory[index] = { ...entry, qty: quantity - 1 };
    else {
      inventory.splice(index, 1);
      removedCompletely = true;
    }
    break;
  }

  const updates = { inventory };
  if (gain !== null && (mode === 'hp' || mode === 'mana')) {
    const currentField = mode === 'hp' ? 'hpCurrent' : 'manaCurrent';
    const totalField = mode === 'hp' ? 'hpTotal' : 'manaTotal';
    const current = Number(data.stats?.[currentField]) || 0;
    const total = Number(data.stats?.[totalField]) || 0;
    updates[`stats.${currentField}`] = total > 0
      ? Math.min(total, current + (Number(gain) || 0))
      : current + (Number(gain) || 0);
  }
  if (removedCompletely && slotKey) {
    updates[`equipped.${slotKey}`] = null;
  } else if (slotKey && data.equipped?.[slotKey]?.qty != null) {
    const nextQuantity = Math.max(0, Number(data.equipped[slotKey].qty) - 1);
    updates[`equipped.${slotKey}.qty`] = nextQuantity;
    if (nextQuantity === 0) updates[`equipped.${slotKey}`] = null;
  }
  await updateDoc(userRef, updates);
  return { success: true };
};
