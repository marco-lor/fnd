// file: ./frontend/src/components/bazaar/elements/acquireItem.js
// Helper to acquire an item: checks user gold against item price and, if sufficient,
// atomically subtracts gold and appends a full snapshot of the item to the user's inventory
// (1:1 copy per purchase, not just an id pointer). Uses a Firestore transaction
// to avoid race conditions on concurrent purchases.

import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

/**
 * Attempts to purchase an item for a user.
 * Contract:
 *  - Reads user doc (expects stats.gold (number) & inventory (array))
 *  - Validates: sufficient gold, non-negative price
 *  - Appends a deep copy of the item into inventory for each purchase, with metadata
 *    (instanceId, acquiredAt, pricePaid). No stacking is performed; UI can still
 *    aggregate by item.id if desired.
 *  - On success: decrements gold and pushes the new snapshot entry
 *  - Returns status object (no throw for business rule failures)
 * @param {string} userId Firestore user document id
 * @param {object} item Item object (must contain id and General.prezzo)
 * @returns {Promise<{success?:boolean, alreadyOwned?:boolean, insufficient?:boolean, newGold?:number, price:number, gold:number, error?:string}>}
 */
export async function acquireItem(userId, item) {
  if (!userId) return { error: 'Utente non valido.', price: 0, gold: 0 };
  if (!item || !item.id) return { error: 'Oggetto non valido.', price: 0, gold: 0 };

  const rawPrice = item?.General?.prezzo ?? item?.General?.Prezzo ?? 0;
  const price = typeof rawPrice === 'number' ? rawPrice : parseInt(rawPrice, 10) || 0;
  if (price < 0) return { error: 'Prezzo non valido.', price: 0, gold: 0 };

  const userRef = doc(db, 'users', userId);

  try {
    const result = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) return { error: 'Utente non trovato.', price, gold: 0 };
      const data = snap.data();
      const gold = data?.stats?.gold ?? 0;
      const inventory = Array.isArray(data?.inventory) ? [...data.inventory] : [];

      if (price > gold) {
        return { insufficient: true, price, gold };
      }

      // Count how many of this item (by id) the user owns before purchase
      let qtyBefore = 0;
      for (let i = 0; i < inventory.length; i++) {
        const entry = inventory[i];
        const entryId = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? entry.id : undefined);
        if (entryId && entryId === item.id) qtyBefore += (typeof entry === 'object' && entry.qty ? entry.qty : 1);
      }

      // Deep copy item snapshot and add minimal metadata for the instance
      const instanceId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const snapshot = JSON.parse(JSON.stringify(item));
      // Ensure base id is preserved so UI can aggregate, plus store instance metadata
      snapshot.id = item.id;
      snapshot._instance = { instanceId, acquiredAt: new Date(), pricePaid: price, source: 'bazaar' };

      // Push a new entry (no stacking)
      inventory.push(snapshot);

      const newGold = gold - price;
      transaction.update(userRef, {
        'stats.gold': newGold,
        inventory
      });

      const newQty = qtyBefore + 1;
      return { success: true, newGold, price, gold, newQty };
    });
    return result;
  } catch (e) {
    console.error('Errore transazione acquisto:', e);
    return { error: e.message || 'Errore sconosciuto.', price: 0, gold: 0 };
  }
}
