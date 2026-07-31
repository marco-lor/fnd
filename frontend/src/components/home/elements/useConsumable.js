// Dedicated logic for using an equipped consumable.
// Handles: determining dice count based on player level thresholds (1,4,7,10), rolling dice via overlay,
// applying Bonus Creazione multiplier, updating HP or Mana, decrementing inventory quantity, and clearing slot if empty.

import React from 'react';
import { createRoot } from 'react-dom/client';
import DiceRoller from '../../common/DiceRoller';
import { getVarie } from '../../../data/configRepository';
import {
  commitConsumable,
  isDefinitiveUserDataCommandError,
  prepareConsumable,
} from '../../../data/userData/userDataCommands';
import { runVersionedUserDataCommand } from '../../../data/userData/userDataCommandRouting';
import { legacyConsumeConsumable } from '../../../data/userData/legacyUserDataCommands';

const LEVEL_THRESHOLDS = [1, 4, 7, 10];
const pendingConsumptions = new Map();

export const __resetConsumableOperationsForTests = () => {
  if (process.env.NODE_ENV === 'test') pendingConsumptions.clear();
};

const resolveLevelKey = (userLevel) => {
  for (let index = LEVEL_THRESHOLDS.length - 1; index >= 0; index -= 1) {
    if (userLevel >= LEVEL_THRESHOLDS[index]) return String(LEVEL_THRESHOLDS[index]);
  }
  return '1';
};

const getDiceCount = (item, fieldKey, levelKey) => {
  const raw = item?.Parametri?.Special?.[fieldKey]?.[levelKey];
  if (raw == null || String(raw).trim() === '') return 0;
  const count = Number(raw);
  return Number.isFinite(count) ? count : 0;
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

const consumeLegacy = async ({ user, userData, item, slotKey, mode }) => {
  if (!user?.uid || !item) return;
  const level = Number(userData?.stats?.level || 1);
  const levelKey = resolveLevelKey(level);
  const isHP = mode === 'hp';
  const isMana = mode === 'mana';
  const consumeOnly = !isHP && !isMana;
  const fieldKey = isHP
    ? 'Rigenera Dado Anima HP'
    : isMana ? 'Rigenera Dado Anima Mana' : null;
  const diceCount = fieldKey ? getDiceCount(item, fieldKey, levelKey) : 0;

  let finalGain = null;
  if (!consumeOnly && diceCount > 0) {
    let animaDieFaces = 10;
    try {
      const varie = await getVarie();
      const diceByLevel = varie?.dadiAnimaByLevel || [];
      const diceType = diceByLevel[level] || diceByLevel[diceByLevel.length - 1];
      if (diceType && /^d\d+$/i.test(diceType)) {
        const parsed = parseInt(diceType.replace(/^d/i, ''), 10);
        if (!Number.isNaN(parsed)) animaDieFaces = parsed;
      }
    } catch (_error) {
      // Preserve the legacy d10 fallback when configuration is unavailable.
    }
    const modifier = getBonusCreazione(item) * diceCount;
    const description = `Lancio ${diceCount}d${animaDieFaces}${modifier ? `+${modifier}` : ''} Anima per ${isHP ? 'HP' : 'Mana'}`;
    const { total } = await rollDiceOverlay({
      faces: animaDieFaces,
      count: diceCount,
      modifier,
      description,
      user,
    });
    finalGain = total;
  }

  await legacyConsumeConsumable({
    uid: user.uid,
    item,
    slotKey,
    mode,
    gain: finalGain,
  });
};

// Core logic. Legacy-read and shadow-verify preserve the established aggregate
// mutation; activated rollout stages use only the authoritative command pair.
export default function useConsumable({ user, userData, item, slotKey, mode, stage }) {
  return runVersionedUserDataCommand({
    stage,
    legacy: () => consumeLegacy({ user, userData, item, slotKey, mode }),
    authoritative: () => consumeAuthoritatively({ user, item, mode }),
  });
}
