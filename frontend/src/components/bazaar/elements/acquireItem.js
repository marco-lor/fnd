// file: ./frontend/src/components/bazaar/elements/acquireItem.js
// The catalog ID is the only client-provided purchase fact. Price, visibility,
// inventory snapshot, and gold are validated atomically by the Task 05 command.
import {
  isDefinitiveUserDataCommandError,
  purchaseItem,
} from '../../../data/userData/userDataCommands';
import { legacyPurchaseItem } from '../../../data/userData/legacyUserDataCommands';
import { runVersionedUserDataCommand } from '../../../data/userData/userDataCommandRouting';

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
export async function acquireItem(userId, item, operationId, stage, retryKey) {
  if (!userId) return { error: 'Utente non valido.', price: 0, gold: 0 };
  if (!item || !item.id) return { error: 'Oggetto non valido.', price: 0, gold: 0 };

  const rawPrice = item?.General?.prezzo ?? item?.General?.Prezzo ?? 0;
  const price = typeof rawPrice === 'number' ? rawPrice : parseInt(rawPrice, 10) || 0;
  if (price < 0) return { error: 'Prezzo non valido.', price: 0, gold: 0 };

  try {
    return await runVersionedUserDataCommand({
      stage,
      legacy: () => legacyPurchaseItem({ uid: userId, item }),
      authoritative: () => purchaseItem({
        itemId: item.id,
        ...(operationId ? { operationId } : {}),
        ...(retryKey ? { retryKey } : {}),
      }),
    });
  } catch (e) {
    console.error('Errore comando acquisto:', e);
    return {
      error: e.message || 'Errore sconosciuto.',
      price,
      gold: 0,
      retryable: !isDefinitiveUserDataCommandError(e),
    };
  }
}
