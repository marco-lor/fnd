import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../components/firebaseConfig';

const performanceMode = process.env.REACT_APP_FND_PERF === '1';
export const task05Functions = getFunctions(app, 'europe-west8');

if (performanceMode) {
  connectFunctionsEmulator(task05Functions, '127.0.0.1', 5001);
}

const callableCache = new Map();
// Retry IDs are retained only when the caller supplies a key for one logical
// action. Deriving this key from a payload would merge distinct, intentional
// operations (for example, two identical long-press resource ticks).
const retainedOperationIds = new Map();
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

const getCallable = (name) => {
  if (!callableCache.has(name)) callableCache.set(name, httpsCallable(task05Functions, name));
  return callableCache.get(name);
};

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
  const response = await getCallable(name)(payload);
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

const callWithOperation = async ({ name, prefix, payload, operationId, retryKey }) => {
  const explicitOperationId = operationId ? requireOperationId(operationId) : null;
  const cacheKey = !explicitOperationId && retryKey
    ? `${name}:${requireRetryKey(retryKey)}`
    : null;
  const resolvedOperationId = explicitOperationId
    || (cacheKey ? retainedOperationIds.get(cacheKey) : null)
    || createUserOperationId(prefix);
  if (cacheKey) retainedOperationIds.set(cacheKey, resolvedOperationId);
  try {
    const result = await call(name, {
      ...payload,
      operationId: requireOperationId(resolvedOperationId),
    });
    if (cacheKey) retainedOperationIds.delete(cacheKey);
    return result;
  } catch (error) {
    if (cacheKey && isDefinitiveUserDataCommandError(error)) {
      retainedOperationIds.delete(cacheKey);
    }
    throw error;
  }
};

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

export const updateResource = ({ userId, resource, mode, value, operationId, retryKey, ...options }) => callWithOperation({
  name: 'task05UpdateResource',
  prefix: 'resource',
  payload: { ...options, ...(userId ? { userId } : {}), resource, mode, value },
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

export const updateUserSettings = ({ operationId, retryKey, ...payload }) => callWithOperation({
  name: 'task05UpdateSettings',
  prefix: 'settings',
  payload,
  operationId,
  retryKey,
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

export const __resetUserDataCommandsForTests = () => {
  if (process.env.NODE_ENV === 'test') {
    callableCache.clear();
    retainedOperationIds.clear();
  }
};
