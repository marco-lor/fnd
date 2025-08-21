// file: ./frontend/src/components/bazaar/elements/acquireItem.js
// Helper to acquire an item: checks user gold against item price and, if sufficient,
// atomically subtracts gold and appends the item id to the inventory (by id only).
// Uses a Firestore transaction to avoid race conditions on concurrent purchases.

import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

/**
 * Attempts to purchase an item for a user.
 * Contract:
 *  - Reads user doc (expects stats.gold (number) & inventory (array))
 *  - Validates: sufficient gold, non-negative price
 *  - Supports stacking: if inventory already contains the item id (as a string or object {id, qty}),
 *    increments quantity instead of blocking purchase.
 *  - On success: decrements gold and updates inventory entry (new object shape: {id, qty})
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

      // Find existing entry (could be primitive string id, or object {id, qty})
      let foundIndex = -1;
      for (let i = 0; i < inventory.length; i++) {
        const entry = inventory[i];
        if ((typeof entry === 'string' && entry === item.id) || (entry && typeof entry === 'object' && entry.id === item.id)) {
          foundIndex = i;
          break;
        }
      }

      let newQty = 1;
      if (foundIndex === -1) {
        // Push new structured entry
        inventory.push({ id: item.id, qty: 1 });
      } else {
        const existing = inventory[foundIndex];
        if (typeof existing === 'string') {
          newQty = 2; // second copy
          inventory[foundIndex] = { id: existing, qty: newQty };
        } else {
          newQty = (existing.qty || 1) + 1;
          inventory[foundIndex] = { id: existing.id, qty: newQty };
        }
      }

      const newGold = gold - price;
      transaction.update(userRef, {
        'stats.gold': newGold,
        inventory
      });
      return { success: true, newGold, price, gold, newQty };
    });
    return result;
  } catch (e) {
    console.error('Errore transazione acquisto:', e);
    return { error: e.message || 'Errore sconosciuto.', price: 0, gold: 0 };
  }
}
