// Dedicated logic for using an equipped consumable.
// Handles: determining dice count based on player level thresholds (1,4,7,10), rolling dice via overlay,
// applying Bonus Creazione multiplier, updating HP or Mana, decrementing inventory quantity, and clearing slot if empty.

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import React from 'react';
import { createRoot } from 'react-dom/client';
import DiceRoller from '../../common/DiceRoller';

const LEVEL_THRESHOLDS = [1,4,7,10];

// Resolve level key for item param tables.
const resolveLevelKey = (userLevel) => {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (userLevel >= LEVEL_THRESHOLDS[i]) return String(LEVEL_THRESHOLDS[i]);
  }
  return '1';
};

// Extract numeric dice count from Parametri.Special field for given key and level.
const getDiceCount = (item, fieldKey, levelKey) => {
  try {
    const special = item?.Parametri?.Special || {};
    const obj = special[fieldKey];
    if (!obj || typeof obj !== 'object') return 0;
    const raw = obj[levelKey];
    if (raw == null || String(raw).trim() === '') return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
};

// Get Bonus Creazione from Specific['Bonus Creazione'] (string/number). Non-numeric becomes 0.
export const getBonusCreazione = (item) => {
  const raw = item?.Specific?.['Bonus Creazione'];
  if (raw == null) return 0;
  // Allow values like "+2" or "2 " gracefully
  const cleaned = String(raw).trim().replace(/^\+/,'');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

// Compute final gain given raw dice total, bonusCreazione and diceCount.
export const computeFinalGain = (rawTotal, bonusCreazione, diceCount) => {
  const b = Number.isFinite(bonusCreazione) ? bonusCreazione : 0;
  const c = Number.isFinite(diceCount) ? diceCount : 0;
  return rawTotal + (b * c);
};

// Apply cap to a stat (HP/Mana) so it does not overflow the total.
export const applyCapToStat = (current, gain, total) => {
  const cur = Number(current) || 0;
  const g = Number(gain) || 0;
  const t = Number(total) || 0;
  if (t > 0) {
    return Math.min(t, cur + g);
  }
  return cur + g; // no cap when total missing or zero
};

// Mount a DiceRoller overlay, returning a promise resolved with { total, meta }.
// Pass forced user so DiceRoller internal logger can still function even though this root is outside provider.
const rollDiceOverlay = ({ faces, count, modifier, description, user }) => {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const handleComplete = (total, meta) => {
      // Cleanup React root
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
      resolve({ total, meta });
    };
    root.render(
      <DiceRoller
        faces={faces}
        count={count}
        modifier={modifier}
        description={description}
        onComplete={handleComplete}
        user={user}
      />
    );
  });
};

// Core logic
// params: { user, userData, item, slotKey, mode }
// mode: 'hp' or 'mana'
export default async function useConsumable({ user, userData, item, slotKey, mode }) {
  if (!user?.uid || !item) return;
  const level = Number(userData?.stats?.level || 1);
  const levelKey = resolveLevelKey(level);
  const isHP = mode === 'hp';
  const isMana = mode === 'mana';

  // Fetch latest user doc early for inventory operations (shared in both branches)
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() || {};

  const consumeOnly = !isHP && !isMana; // user confirmed with no regeneration available
  const fieldKey = isHP ? 'Rigenera Dado Anima HP' : (isMana ? 'Rigenera Dado Anima Mana' : null);
  const diceCount = (fieldKey ? getDiceCount(item, fieldKey, levelKey) : 0);

  if (consumeOnly || diceCount <= 0) {
    // Perform inventory decrement / slot clearing without stat changes or dice roll.
    const inv = Array.isArray(data.inventory) ? [...data.inventory] : [];
    const matchId = item.id || item.name || item?.General?.Nome;
    let updatedInventory = inv;
    let removedCompletely = false;
    for (let i = 0; i < updatedInventory.length; i++) {
      const entry = updatedInventory[i];
      if (!entry || typeof entry !== 'object') continue;
      const entryId = entry.id || entry.name || entry?.General?.Nome;
      if (entryId === matchId) {
        const qty = Number(entry.qty || 1);
        if (qty > 1) {
          updatedInventory[i] = { ...entry, qty: qty - 1 };
        } else {
          updatedInventory.splice(i, 1);
          removedCompletely = true;
        }
        break;
      }
    }
    const equippedUpdates = {};
    if (removedCompletely && slotKey) {
      equippedUpdates[`equipped.${slotKey}`] = null;
    } else if (slotKey && data.equipped && data.equipped[slotKey]) {
      const eqEntry = data.equipped[slotKey];
      if (eqEntry && typeof eqEntry === 'object' && eqEntry.qty != null) {
        const newEqQty = Math.max(0, Number(eqEntry.qty) - 1);
        equippedUpdates[`equipped.${slotKey}.qty`] = newEqQty;
        if (newEqQty === 0) equippedUpdates[`equipped.${slotKey}`] = null;
      }
    }
    await updateDoc(ref, { inventory: updatedInventory, ...equippedUpdates });
    return; // done
  }

  const bonusCreazione = getBonusCreazione(item);

  // Determine correct Anima die faces using the same method as the home page (paramTables.js):
  // Fetch 'utils/varie' document and read dadiAnimaByLevel[level]. Fallback to last element or d10.
  let animaDieFaces = 10; // fallback
  try {
    const varieSnap = await getDoc(doc(db, 'utils', 'varie'));
    if (varieSnap.exists()) {
      const arr = varieSnap.data()?.dadiAnimaByLevel || [];
      const diceTypeStr = arr[level] || arr[arr.length - 1];
      if (diceTypeStr && /^d\d+$/i.test(diceTypeStr)) {
        const parsed = parseInt(diceTypeStr.replace(/^d/i, ''), 10);
        if (!Number.isNaN(parsed)) animaDieFaces = parsed;
      }
    }
  } catch (e) {
    // silent fallback to default animaDieFaces
  }
  const modifier = 0; // no flat modifier in consumable regen; bonus applied after roll
  const potentialBonusAdd = bonusCreazione * diceCount;
  // Use DiceRoller modifier so the returned total already includes bonus; display full formula.
  const modifierValue = potentialBonusAdd; // bonusCreazione * diceCount
  const description = `Lancio ${diceCount}d${animaDieFaces}${modifierValue ? `+${modifierValue}` : ''} Anima per ${isHP ? 'HP' : 'Mana'}`;
  const { total: rawTotal } = await rollDiceOverlay({ faces: animaDieFaces, count: diceCount, modifier: modifierValue, description, user });

  // rawTotal already includes bonus via modifier.
  const finalGain = rawTotal; // already includes bonus modifier

  // data already fetched above

  // Update stat field.
  const stats = data.stats || {};
  const currentField = isHP ? 'hpCurrent' : 'manaCurrent';
  const totalField = isHP ? 'hpTotal' : 'manaTotal';
  const currentVal = Number(stats[currentField] || 0);
  const totalVal = Number(stats[totalField] || 0);
  const newValue = applyCapToStat(currentVal, finalGain, totalVal);

  // Adjust inventory: find matching item instance; if qty >1 decrement, else remove. Equipped slot may need clearing.
  const inv = Array.isArray(data.inventory) ? [...data.inventory] : [];
  const matchId = item.id || item.name || item?.General?.Nome;
  let updatedInventory = inv;
  let removedCompletely = false;
  for (let i = 0; i < updatedInventory.length; i++) {
    const entry = updatedInventory[i];
    if (!entry || typeof entry !== 'object') continue;
    const entryId = entry.id || entry.name || entry?.General?.Nome;
    if (entryId === matchId) {
      const qty = Number(entry.qty || 1);
      if (qty > 1) {
        updatedInventory[i] = { ...entry, qty: qty - 1 };
      } else {
        updatedInventory.splice(i, 1);
        removedCompletely = true;
      }
      break;
    }
  }

  // If removed completely, clear equipped slot.
  const equippedUpdates = {};
  if (removedCompletely && slotKey) {
    equippedUpdates[`equipped.${slotKey}`] = null;
  } else if (slotKey && data.equipped && data.equipped[slotKey]) {
    // Update the equipped entry qty if still present
    const eqEntry = data.equipped[slotKey];
    if (eqEntry && typeof eqEntry === 'object' && eqEntry.qty != null) {
      const newEqQty = Math.max(0, Number(eqEntry.qty) - 1);
      equippedUpdates[`equipped.${slotKey}.qty`] = newEqQty;
      if (newEqQty === 0) equippedUpdates[`equipped.${slotKey}`] = null;
    }
  }

  await updateDoc(ref, {
    [`stats.${currentField}`]: newValue,
    inventory: updatedInventory,
    ...equippedUpdates,
  });
}
