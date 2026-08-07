// Dedicated logic for using an equipped consumable.
// Handles: determining dice count based on player level thresholds (1,4,7,10), rolling dice via overlay,
// applying Bonus Creazione multiplier, updating HP or Mana, decrementing inventory quantity, and clearing slot if empty.

import React from 'react';
import { createRoot } from 'react-dom/client';
import DiceRoller from '../../common/DiceRoller';
import {
  commitConsumable,
  isDefinitiveUserDataCommandError,
  prepareConsumable,
} from '../../../data/userData/userDataCommands';

const pendingConsumptions = new Map();

export const __resetConsumableOperationsForTests = () => {
  if (process.env.NODE_ENV === 'test') pendingConsumptions.clear();
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
const rollDiceOverlay = ({ faces, count, modifier, description, user, finalRolls }) => {
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
        finalRolls={finalRolls}
      />
    );
  });
};

const consumeAuthoritatively = async ({ user, item, mode }) => {
  if (!user?.uid || !item) return;
  const isHP = mode === 'hp';
  const isMana = mode === 'mana';
  const inventoryId = item?._task05?.inventoryId || item?._instance?.instanceId;
  if (!inventoryId) throw new Error('Consumable is missing its stable inventory ID.');
  const resource = isHP ? 'hp' : isMana ? 'mana' : null;
  const consumptionKey = `${user.uid}:${inventoryId}:${resource || 'none'}`;
  let pending = pendingConsumptions.get(consumptionKey);
  try {
    if (!pending) {
      const preparation = await prepareConsumable({
        inventoryId,
        resource,
        retryKey: `${consumptionKey}:prepare`,
      });
      pending = { preparation, rollShown: false };
      pendingConsumptions.set(consumptionKey, pending);
    }
    const { preparation } = pending;
    const rolls = Array.isArray(preparation?.rolls) ? preparation.rolls : [];
    if (rolls.length > 0 && !pending.rollShown) {
      const faces = Number(preparation.faces) || Math.max(10, ...rolls);
      const modifier = Number(preparation.modifier) || 0;
      const description = `Lancio ${rolls.length}d${faces}${modifier ? `+${modifier}` : ''} Anima per ${isHP ? 'HP' : 'Mana'}`;
      await rollDiceOverlay({
        faces,
        count: rolls.length,
        modifier,
        description,
        user,
        finalRolls: rolls,
      });
      pending.rollShown = true;
    }
    await commitConsumable({
      preparationId: preparation.preparationId,
      retryKey: `${consumptionKey}:commit`,
    });
    pendingConsumptions.delete(consumptionKey);
  } catch (error) {
    if (isDefinitiveUserDataCommandError(error)) {
      pendingConsumptions.delete(consumptionKey);
    }
    throw error;
  }
};

// Every interactive consumption uses the canonical Task 05 preparation/commit pair.
export default function useConsumable({ user, item, mode }) {
  return consumeAuthoritatively({ user, item, mode });
}
