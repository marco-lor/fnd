import {
  __resetCallableRegistryForTests,
  getCallable,
} from '../functions/callableRegistry';
import {
  getTask08ResourceHoldId,
  recordTask08Event,
} from '../../performance/task08';

const USER_DATA_CALLABLES = Object.freeze({
  spendCharacterPointV2: getCallable('spendCharacterPointV2'),
  task05PurchaseItem: getCallable('task05PurchaseItem'),
  task05AdjustGold: getCallable('task05AdjustGold'),
  task05UpdateResource: getCallable('task05UpdateResource'),
  task05UpdateGrigliataCharacterResources: getCallable('task05UpdateGrigliataCharacterResources'),
  task05UpdateProgression: getCallable('task05UpdateProgression'),
  task05MutateInventory: getCallable('task05MutateInventory'),
  task05SetEquipment: getCallable('task05SetEquipment'),
  task05MutatePersonalContent: getCallable('task05MutatePersonalContent'),
  task05UpdateSettings: getCallable('task05UpdateSettings'),
  task05UpdateProfileContent: getCallable('task05UpdateProfileContent'),
  task05PrepareConsumable: getCallable('task05PrepareConsumable'),
  task05CommitConsumable: getCallable('task05CommitConsumable'),
  task05CharacterCreation: getCallable('task05CharacterCreation'),
  task05ConsumeTurnEffects: getCallable('task05ConsumeTurnEffects'),
  task05ListAdminUsers: getCallable('task05ListAdminUsers'),
});
// Retry IDs are retained only when the caller supplies a key for one logical
// action. Deriving this key from a payload would merge distinct, intentional
// operations (for example, two identical long-press resource ticks).
const retainedOperationIds = new Map();
const inFlightOperations = new Map();
const inFlightOperationMetadata = new Map();
let task08InvocationSequence = 0;
export const USER_DATA_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const DEFINITIVE_CALLABLE_CODES = new Set([
  'already-exists',
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'out-of-range',
  'permission-denied',
  'resource-exhausted',
  'unauthenticated',
  'unimplemented',
]);

export const createUserOperationId = (prefix = 'user-op') => {
  const randomId = (typeof window !== 'undefined' ? window.crypto?.randomUUID?.() : null)
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${randomId}`;
};

const requireOperationId = (operationId) => {
  if (typeof operationId !== 'string' || !USER_DATA_OPERATION_ID_PATTERN.test(operationId)) {
    throw new TypeError('Task 05 operationId must be 8-80 URL-safe characters.');
  }
  return operationId;
};

const call = async (name, payload) => {
  const callable = USER_DATA_CALLABLES[name];
  if (!callable) throw new TypeError(`Unknown Task 05 callable: ${String(name)}`);
  const response = await callable(payload);
  return response?.data ?? response;
};

export const isDefinitiveUserDataCommandError = (error) => {
  const code = typeof error?.code === 'string'
    ? error.code.replace(/^functions\//, '')
    : '';
  return DEFINITIVE_CALLABLE_CODES.has(code);
};

const requireRetryKey = (retryKey) => {
  if (typeof retryKey !== 'string' || retryKey.length === 0 || retryKey.length > 512) {
    throw new TypeError('Task 05 retryKey must be a non-empty string of at most 512 characters.');
  }
  return retryKey;
};

const requireRetryScope = (retryScope) => {
  if (typeof retryScope !== 'string' || retryScope.length === 0 || retryScope.length > 512) {
    throw new TypeError('Task 05 retryScope must be a non-empty string of at most 512 characters.');
  }
  return retryScope;
};

const task08CommandTags = ({
  name,
  payload,
  operationId,
  retryKey,
  holdId,
  invocationSequence,
  localSequence,
}) => ({
  command: name,
  explicitOperationId: Boolean(operationId),
  retryKeyProvided: Boolean(retryKey),
  ...(holdId ? { holdId, invocationSequence } : {}),
  ...(localSequence != null ? { localSequence } : {}),
  ...(name === 'task05UpdateResource' ? {
    resource: payload?.resource,
    mode: payload?.mode,
    value: payload?.value,
  } : {}),
  ...(name === 'task05CharacterCreation' ? {
    action: payload?.action,
  } : {}),
  ...(name === 'task05PrepareConsumable' || name === 'task05CommitConsumable' ? {
    resource: payload?.resource ?? 'none',
  } : {}),
});

const task08ErrorCode = (error) => {
  const code = typeof error?.code === 'string' ? error.code : 'unknown';
  return code.replace(/^functions\//, '').slice(0, 80) || 'unknown';
};

const canonicalRequestKey = (value, seen = new Set()) => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : `number:${String(value)}`;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[cyclic]';
    seen.add(value);
    const result = `[${value.map((entry) => canonicalRequestKey(entry, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '{cyclic}';
    seen.add(value);
    const result = `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalRequestKey(value[key], seen)}`
    )).join(',')}}`;
    seen.delete(value);
    return result;
  }
  return `${typeof value}:${String(value)}`;
};

const releaseOtherRetainedOperations = (retryScope, activeCacheKey) => {
  if (!retryScope) return;
  retainedOperationIds.forEach((entry, retainedKey) => {
    if (retainedKey !== activeCacheKey && entry.retryScope === retryScope) {
      retainedOperationIds.delete(retainedKey);
    }
  });
  inFlightOperationMetadata.forEach((entry, inFlightKey) => {
    if (entry.retainedKey !== activeCacheKey && entry.retryScope === retryScope) {
      inFlightOperations.delete(inFlightKey);
      inFlightOperationMetadata.delete(inFlightKey);
    }
  });
};

const callWithOperation = async ({
  name,
  prefix,
  payload,
  operationId,
  retryKey,
  retryScope,
  task08HoldId,
  task08LocalSequence,
}) => {
  const explicitOperationId = operationId ? requireOperationId(operationId) : null;
  const cacheKey = !explicitOperationId && retryKey
    ? `${name}:${requireRetryKey(retryKey)}`
    : null;
  const requestKey = canonicalRequestKey(payload);
  const retainedKey = cacheKey ? `${cacheKey}:${requestKey}` : null;
  const resolvedRetryScope = cacheKey && retryScope
    ? `${name}:${requireRetryScope(retryScope)}`
    : null;
  if (cacheKey && resolvedRetryScope) {
    releaseOtherRetainedOperations(resolvedRetryScope, retainedKey);
  }
  const candidateRetainedEntry = retainedKey
    ? retainedOperationIds.get(retainedKey)
    : null;
  const retainedEntry = candidateRetainedEntry
    && candidateRetainedEntry.retryScope === resolvedRetryScope
    ? candidateRetainedEntry
    : null;
  if (candidateRetainedEntry && !retainedEntry) {
    retainedOperationIds.delete(retainedKey);
  }
  const resolvedOperationId = explicitOperationId
    || retainedEntry?.operationId
    || createUserOperationId(prefix);
  if (retainedKey) {
    retainedOperationIds.set(retainedKey, {
      operationId: resolvedOperationId,
      retryScope: resolvedRetryScope,
      cacheKey,
    });
  }
  const inFlightKey = explicitOperationId
    ? `${name}:explicit:${explicitOperationId}:${requestKey}`
    : retainedKey
      ? `${retainedKey}:${resolvedRetryScope || ''}`
      : null;
  if (inFlightKey && inFlightOperations.has(inFlightKey)) {
    return inFlightOperations.get(inFlightKey);
  }
  const holdId = task08HoldId || (typeof getTask08ResourceHoldId === 'function'
    ? getTask08ResourceHoldId()
    : null);
  const invocationSequence = holdId ? ++task08InvocationSequence : null;
  const measurementTags = task08CommandTags({
    name,
    payload,
    operationId,
    retryKey,
    holdId,
    invocationSequence,
    localSequence: task08LocalSequence,
  });
  const run = (async () => {
    recordTask08Event({ metric: 'command-start', tags: measurementTags });
    const clearRetainedEntry = () => {
      if (!retainedKey) return;
      const current = retainedOperationIds.get(retainedKey);
      if (current?.operationId === resolvedOperationId) {
        retainedOperationIds.delete(retainedKey);
      }
    };
    try {
      const result = await call(name, {
        ...payload,
        operationId: requireOperationId(resolvedOperationId),
      });
      clearRetainedEntry();
      recordTask08Event({ metric: 'command-success', tags: measurementTags });
      if (result?.replayed === false) {
        recordTask08Event({
          metric: 'command-applied',
          tags: {
            ...measurementTags,
            ...(name === 'task05UpdateResource' ? {
              appliedDelta: result.appliedDelta,
              newValue: result.newValue,
              newRevision: result.newRevision,
            } : {}),
          },
        });
      } else if (result?.replayed !== true) {
        // A success without replay=false is not evidence of a physical write.
        recordTask08Event({
          metric: 'command-non-replayed-success',
          tags: measurementTags,
        });
      }
      return result;
    } catch (error) {
      if (retainedKey && isDefinitiveUserDataCommandError(error)) {
        clearRetainedEntry();
      }
      recordTask08Event({
        metric: 'command-failure',
        tags: { ...measurementTags, code: task08ErrorCode(error) },
      });
      throw error;
    }
  })();
  if (inFlightKey) {
    inFlightOperations.set(inFlightKey, run);
    inFlightOperationMetadata.set(inFlightKey, {
      retainedKey,
      retryScope: resolvedRetryScope,
    });
  }
  try {
    return await run;
  } finally {
    if (inFlightKey && inFlightOperations.get(inFlightKey) === run) {
      inFlightOperations.delete(inFlightKey);
      inFlightOperationMetadata.delete(inFlightKey);
    }
  }
};

export const getAdminUsersPage = ({ cursor, limit = 100 } = {}) => call(
  'task05ListAdminUsers',
  {
    ...(cursor ? { cursor } : {}),
    limit,
  }
);

export const spendCharacterPoint = ({ statName, statType, change, operationId, retryKey }) => callWithOperation({
  name: 'spendCharacterPointV2',
  prefix: 'spend-character-point',
  payload: { statName, statType, change },
  operationId,
  retryKey,
});

export const purchaseItem = ({ itemId, operationId, retryKey }) => callWithOperation({
  name: 'task05PurchaseItem',
  prefix: 'purchase',
  payload: { itemId },
  operationId,
  retryKey,
});

export const adjustGold = ({ userId, delta, operationId, retryKey }) => callWithOperation({
  name: 'task05AdjustGold',
  prefix: 'gold',
  payload: { ...(userId ? { userId } : {}), delta },
  operationId,
  retryKey,
});

export const updateResource = ({ userId, resource, mode, value, operationId, retryKey, retryScope, task08HoldId, task08LocalSequence, ...options }) => callWithOperation({
  name: 'task05UpdateResource',
  prefix: 'resource',
  payload: { ...options, ...(userId ? { userId } : {}), resource, mode, value },
  operationId,
  retryKey,
  retryScope,
  task08HoldId,
  task08LocalSequence,
});

export const updateGrigliataCharacterResources = ({ operationId, retryKey, ...payload }) => callWithOperation({
  name: 'task05UpdateGrigliataCharacterResources',
  prefix: 'grigliata-character-resources',
  payload,
  operationId,
  retryKey,
});

export const updateProgression = ({ userId, patch, operationId, retryKey }) => callWithOperation({
  name: 'task05UpdateProgression',
  prefix: 'progression',
  payload: { ...(userId ? { userId } : {}), patch },
  operationId,
  retryKey,
});

export const mutateInventory = ({ operationId, retryKey, ...payload }) => callWithOperation({
  name: 'task05MutateInventory',
  prefix: 'inventory',
  payload,
  operationId,
  retryKey,
});

export const setEquipment = ({ operationId, retryKey, ...payload }) => callWithOperation({
  name: 'task05SetEquipment',
  prefix: 'equipment',
  payload,
  operationId,
  retryKey,
});

export const mutatePersonalContent = ({ operationId, retryKey, ...payload }) => callWithOperation({
  name: 'task05MutatePersonalContent',
  prefix: 'content',
  payload,
  operationId,
  retryKey,
});

export const updateUserSettings = ({ operationId, retryKey, retryScope, ...payload }) => callWithOperation({
  name: 'task05UpdateSettings',
  prefix: 'settings',
  payload,
  operationId,
  retryKey,
  retryScope,
});

export const updateProfileContent = ({ operationId, retryKey, ...payload }) => callWithOperation({
  name: 'task05UpdateProfileContent',
  prefix: 'profile-content',
  payload,
  operationId,
  retryKey,
});

export const prepareConsumable = ({ operationId, retryKey, ...payload }) => callWithOperation({
  name: 'task05PrepareConsumable',
  prefix: 'consume-prepare',
  payload,
  operationId,
  retryKey,
});

export const commitConsumable = ({ operationId, retryKey, ...payload }) => callWithOperation({
  name: 'task05CommitConsumable',
  prefix: 'consume-commit',
  payload,
  operationId,
  retryKey,
});

export const updateCharacterCreation = ({ operationId, retryKey, retryScope, ...payload }) => callWithOperation({
  name: 'task05CharacterCreation',
  prefix: 'character-creation',
  payload,
  operationId,
  retryKey,
  retryScope,
});

export const consumeTurnEffects = ({ operationId, retryKey, retryScope, ...payload }) => callWithOperation({
  name: 'task05ConsumeTurnEffects',
  prefix: 'turn-effects',
  payload,
  operationId,
  retryKey,
  retryScope,
});

export const __resetUserDataCommandsForTests = () => {
  if (process.env.NODE_ENV === 'test') {
    retainedOperationIds.clear();
    inFlightOperations.clear();
    inFlightOperationMetadata.clear();
    task08InvocationSequence = 0;
    __resetCallableRegistryForTests();
  }
};
