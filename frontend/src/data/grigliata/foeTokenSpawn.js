import { getCallable } from '../functions/callableRegistry';
import { runWithDurableOperationIntent } from '../functions/backendOperationIntentStore';

export const FOE_TOKEN_SPAWN_OPERATION_KIND = 'spawn-grigliata-foe-token';

const DEFINITIVE_SPAWN_CODES = new Set([
  'already-exists',
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'out-of-range',
  'permission-denied',
  'unauthenticated',
  'unimplemented',
]);

const errorCode = (error) => (
  typeof error?.code === 'string'
    ? error.code.replace(/^functions\//, '')
    : ''
);

export const isDefinitiveFoeTokenSpawnError = (error) => (
  DEFINITIVE_SPAWN_CODES.has(errorCode(error))
);

const spawnFoeTokenCallable = getCallable('spawnGrigliataFoeToken');

const requireSegment = (value, field) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.includes('/')) {
    throw new TypeError(`${field} is required.`);
  }
  return normalized;
};

const requireGridCoordinate = (value, field) => {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized)) {
    throw new TypeError(`${field} must be an integer.`);
  }
  return normalized;
};

export const spawnGrigliataFoeToken = async ({
  actorUid,
  foeId,
  backgroundId,
  col,
  row,
}, {
  invokeCallable = spawnFoeTokenCallable,
  runIntent = runWithDurableOperationIntent,
} = {}) => {
  const intent = {
    foeId: requireSegment(foeId, 'foeId'),
    backgroundId: requireSegment(backgroundId, 'backgroundId'),
    col: requireGridCoordinate(col, 'col'),
    row: requireGridCoordinate(row, 'row'),
  };
  return runIntent({
    actorUid,
    kind: FOE_TOKEN_SPAWN_OPERATION_KIND,
    intent,
    isDefinitiveError: isDefinitiveFoeTokenSpawnError,
    invoke: async (operationId) => {
      const response = await invokeCallable({...intent, operationId});
      return response?.data ?? response;
    },
  });
};
