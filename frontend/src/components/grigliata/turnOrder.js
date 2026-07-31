import { timestampToMillis } from './boardUtils';

const TURN_ORDER_CURSOR_TOKEN_ID = '__turn-order-cursor__';
export const TURN_EFFECT_KIND_SHIELD = 'shield';

export const normalizeTurnCounter = (value, fallback = 0) => (
  Number.isInteger(value) && value >= 0 ? value : fallback
);

const normalizeTurnEffectInteger = (value, fallback = 0) => (
  Number.isInteger(value) && value >= 0 ? value : fallback
);

export const normalizeTurnEffect = (effect = null) => {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
    return null;
  }

  const id = typeof effect.id === 'string' ? effect.id.trim() : '';
  const kind = typeof effect.kind === 'string' ? effect.kind.trim() : '';
  const totalTurns = normalizeTurnEffectInteger(effect.totalTurns, 0);
  const appliesFromTurnCounter = normalizeTurnCounter(effect.appliesFromTurnCounter, 0);
  if (!id || !kind || totalTurns < 1) {
    return null;
  }

  const remainingTurns = Math.min(
    totalTurns,
    normalizeTurnEffectInteger(effect.remainingTurns, totalTurns),
  );

  return {
    id,
    kind,
    totalTurns,
    remainingTurns,
    appliesFromTurnCounter,
  };
};

export const normalizeTurnEffects = (effects = []) => (
  Array.isArray(effects)
    ? effects
      .map((effect) => normalizeTurnEffect(effect))
      .filter(Boolean)
    : []
);

export const getTurnEffectByKind = (effects = [], kind = '') => (
  normalizeTurnEffects(effects).find((effect) => effect.kind === kind) || null
);

export const computeTurnEffectRemainingTurns = (effect, turnCounter) => {
  const normalizedEffect = normalizeTurnEffect(effect);
  if (!normalizedEffect) {
    return 0;
  }

  const normalizedTurnCounter = normalizeTurnCounter(turnCounter, 0);
  const consumedTurns = Math.max(
    0,
    normalizedTurnCounter - normalizedEffect.appliesFromTurnCounter,
  );
  return Math.max(0, normalizedEffect.totalTurns - consumedTurns);
};

export const reconcileTurnEffectsAtTurnCounter = ({
  turnCounter,
  turnEffects = [],
} = {}) => {
  const normalizedTurnCounter = normalizeTurnCounter(turnCounter, 0);
  const nextTurnEffects = [];
  const expiredEffects = [];

  normalizeTurnEffects(turnEffects).forEach((effect) => {
    const remainingTurns = computeTurnEffectRemainingTurns(effect, normalizedTurnCounter);
    if (remainingTurns < 1) {
      expiredEffects.push({
        ...effect,
        remainingTurns: 0,
      });
      return;
    }

    nextTurnEffects.push({
      ...effect,
      remainingTurns,
    });
  });

  return {
    turnEffects: nextTurnEffects,
    expiredEffects,
  };
};

export const resolveTurnEffectAppliesFromTurnCounter = ({
  totalTurns,
  remainingTurns,
  turnCounter,
} = {}) => {
  const normalizedTotalTurns = normalizeTurnEffectInteger(totalTurns, 0);
  const normalizedRemainingTurns = Math.min(
    normalizedTotalTurns,
    normalizeTurnEffectInteger(remainingTurns, normalizedTotalTurns),
  );
  const normalizedTurnCounter = normalizeTurnCounter(turnCounter, 0);
  if (normalizedTotalTurns < 1) {
    return normalizedTurnCounter;
  }

  return Math.max(
    0,
    normalizedTurnCounter - (normalizedTotalTurns - normalizedRemainingTurns),
  );
};

export const buildShieldTurnEffect = ({
  totalTurns,
  remainingTurns,
  turnCounter,
} = {}) => {
  const normalizedTotalTurns = normalizeTurnEffectInteger(totalTurns, 0);
  if (normalizedTotalTurns < 1) {
    return null;
  }

  return normalizeTurnEffect({
    id: TURN_EFFECT_KIND_SHIELD,
    kind: TURN_EFFECT_KIND_SHIELD,
    totalTurns: normalizedTotalTurns,
    remainingTurns: Math.min(
      normalizedTotalTurns,
      normalizeTurnEffectInteger(remainingTurns, normalizedTotalTurns),
    ),
    appliesFromTurnCounter: resolveTurnEffectAppliesFromTurnCounter({
      totalTurns: normalizedTotalTurns,
      remainingTurns,
      turnCounter,
    }),
  });
};

export const resolveTurnOrderJoinedAtMs = (entry = {}) => {
  if (Number.isFinite(entry?.joinedAtMs)) {
    return entry.joinedAtMs;
  }

  if (entry?.joinedAt) {
    return timestampToMillis(entry.joinedAt);
  }

  return Number.MAX_SAFE_INTEGER;
};

export const compareTurnOrderEntries = (left = {}, right = {}) => {
  const leftInitiative = Number.isInteger(left?.initiative) ? left.initiative : 0;
  const rightInitiative = Number.isInteger(right?.initiative) ? right.initiative : 0;
  if (rightInitiative !== leftInitiative) {
    return rightInitiative - leftInitiative;
  }

  const leftJoinedAtMs = resolveTurnOrderJoinedAtMs(left);
  const rightJoinedAtMs = resolveTurnOrderJoinedAtMs(right);
  if (leftJoinedAtMs !== rightJoinedAtMs) {
    return leftJoinedAtMs - rightJoinedAtMs;
  }

  const labelComparison = String(left?.label || '').localeCompare(String(right?.label || ''));
  if (labelComparison !== 0) {
    return labelComparison;
  }

  return String(left?.tokenId || '').localeCompare(String(right?.tokenId || ''));
};

export const sortTurnOrderEntries = (entries = []) => [...entries].sort(compareTurnOrderEntries);

export const buildTurnOrderActiveState = (entry, startedAt) => {
  if (!entry?.tokenId) {
    return null;
  }

  return {
    tokenId: entry.tokenId,
    initiative: Number.isInteger(entry?.initiative) ? entry.initiative : 0,
    joinedAt: entry?.joinedAt || null,
    label: typeof entry?.label === 'string' ? entry.label : '',
    startedAt,
  };
};

export const getFirstTurnOrderEntry = (entries = []) => sortTurnOrderEntries(entries)[0] || null;

const buildCursorEntry = (cursor = {}) => ({
  tokenId: TURN_ORDER_CURSOR_TOKEN_ID,
  initiative: Number.isInteger(cursor?.initiative) ? cursor.initiative : 0,
  joinedAt: cursor?.joinedAt || null,
  joinedAtMs: resolveTurnOrderJoinedAtMs(cursor),
  label: typeof cursor?.label === 'string' ? cursor.label : '',
  __isTurnOrderCursor: true,
});

export const getNextTurnOrderEntry = (entries = [], cursor = null) => {
  const sortedEntries = sortTurnOrderEntries(entries);
  if (!sortedEntries.length) {
    return null;
  }

  if (!cursor?.tokenId) {
    return sortedEntries[0];
  }

  const currentIndex = sortedEntries.findIndex((entry) => entry?.tokenId === cursor.tokenId);
  if (currentIndex >= 0) {
    return sortedEntries[(currentIndex + 1) % sortedEntries.length];
  }

  const sortedEntriesWithCursor = sortTurnOrderEntries([
    ...sortedEntries,
    buildCursorEntry(cursor),
  ]);
  const cursorIndex = sortedEntriesWithCursor.findIndex((entry) => entry?.__isTurnOrderCursor === true);
  if (cursorIndex < 0) {
    return sortedEntries[0];
  }

  const nextEntry = sortedEntriesWithCursor[(cursorIndex + 1) % sortedEntriesWithCursor.length];
  return nextEntry?.__isTurnOrderCursor ? null : nextEntry;
};
