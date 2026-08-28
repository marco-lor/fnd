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
}) => ({
  command: name,
  explicitOperationId: Boolean(operationId),
  retryKeyProvided: Boolean(retryKey),
  ...(holdId ? { holdId, invocationSequence } : {}),
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

const releaseOtherRetainedOperations = (retryScope, activeCacheKey) => {
  if (!retryScope) return;
  retainedOperationIds.forEach((entry, cacheKey) => {
    if (cacheKey !== activeCacheKey && entry.retryScope === retryScope) {
      retainedOperationIds.delete(cacheKey);
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
}) => {
  const explicitOperationId = operationId ? requireOperationId(operationId) : null;
  const cacheKey = !explicitOperationId && retryKey
    ? `${name}:${requireRetryKey(retryKey)}`
    : null;
  const resolvedRetryScope = cacheKey && retryScope
    ? `${name}:${requireRetryScope(retryScope)}`
    : null;
  if (cacheKey && resolvedRetryScope) {
    releaseOtherRetainedOperations(resolvedRetryScope, cacheKey);
  }
  const retainedEntry = cacheKey ? retainedOperationIds.get(cacheKey) : null;
  if (retainedEntry && retainedEntry.retryScope !== resolvedRetryScope) {
    retainedOperationIds.delete(cacheKey);
  }
  const resolvedOperationId = explicitOperationId
    || (cacheKey ? retainedOperationIds.get(cacheKey)?.operationId : null)
    || createUserOperationId(prefix);
  if (cacheKey) {
    retainedOperationIds.set(cacheKey, {
      operationId: resolvedOperationId,
      retryScope: resolvedRetryScope,
    });
  }
  const holdId = typeof getTask08ResourceHoldId === 'function'
    ? getTask08ResourceHoldId()
    : null;
  const invocationSequence = holdId ? ++task08InvocationSequence : null;
  const measurementTags = task08CommandTags({
    name,
    payload,
    operationId,
    retryKey,
    holdId,
    invocationSequence,
  });
  recordTask08Event({ metric: 'command-start', tags: measurementTags });
  try {
    const result = await call(name, {
      ...payload,
      operationId: requireOperationId(resolvedOperationId),
    });
    if (cacheKey) retainedOperationIds.delete(cacheKey);
    recordTask08Event({ metric: 'command-success', tags: measurementTags });
    if (result?.replayed === false) {
      recordTask08Event({ metric: 'command-applied', tags: measurementTags });
    } else if (result?.replayed !== true) {
      // The initialize callable predates the idempotent response envelope and
      // does not return replayed=false. Keep that success visible for
      // diagnostics, but do not mislabel it as a physical application.
      recordTask08Event({
        metric: 'command-non-replayed-success',
        tags: measurementTags,
      });
    }
    return result;
  } catch (error) {
    if (cacheKey && isDefinitiveUserDataCommandError(error)) {
      retainedOperationIds.delete(cacheKey);
    }
    recordTask08Event({
      metric: 'command-failure',
      tags: { ...measurementTags, code: task08ErrorCode(error) },
    });
    throw error;
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

export const updateResource = ({ userId, resource, mode, value, operationId, retryKey, retryScope, ...options }) => callWithOperation({
  name: 'task05UpdateResource',
  prefix: 'resource',
  payload: { ...options, ...(userId ? { userId } : {}), resource, mode, value },
  operationId,
  retryKey,
  retryScope,
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

export const updateCharacterCreation = ({ operationId, retryKey, ...payload }) => callWithOperation({
  name: 'task05CharacterCreation',
  prefix: 'character-creation',
  payload,
  operationId,
  retryKey,
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
    task08InvocationSequence = 0;
    __resetCallableRegistryForTests();
  }
};
