import { resolveFoeMediaBinding } from './foeMediaLifecycle';

const isRecord = (value) => (
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
);

const recoveryError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeTimestamp = (value) => {
  const seconds = Number(value?.seconds);
  const nanoseconds = Number(value?.nanoseconds || 0);
  if (!Number.isSafeInteger(seconds)
    || !Number.isSafeInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds >= 1_000_000_000) {
    throw recoveryError(
      'The foe recovery timestamp is invalid.',
      'foe-recovery-fence-invalid'
    );
  }
  return { seconds, nanoseconds };
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
};

const valuesMatch = (left, right) => (
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
);

const payloadAlreadyApplied = (current, payload) => (
  Object.entries(payload || {})
    .filter(([key]) => key !== 'updated_at')
    .every(([key, value]) => valuesMatch(current?.[key], value))
);

const assertRecoverableFoe = ({ exists, current }) => {
  if (!exists) {
    throw recoveryError(
      'The foe no longer exists. Reload before saving.',
      'foe-recovery-missing'
    );
  }
  if (resolveFoeMediaBinding(current).status !== 'none') {
    throw recoveryError(
      'The foe media changed while recovery was in progress. Reload before saving.',
      'foe-recovery-media-conflict'
    );
  }
};

const timestampsMatch = (left, right) => {
  const normalizedLeft = normalizeTimestamp(left);
  const normalizedRight = normalizeTimestamp(right);
  return normalizedLeft.seconds === normalizedRight.seconds
    && normalizedLeft.nanoseconds === normalizedRight.nanoseconds;
};

export const assertFoeRecoveryFence = ({
  current,
  exists,
  expectedUpdatedAt,
}) => {
  assertRecoverableFoe({ current, exists });
  if (!timestampsMatch(current?.updated_at, expectedUpdatedAt)) {
    throw recoveryError(
      'The foe changed in another session. Reload before saving.',
      'foe-recovery-edit-conflict'
    );
  }
};

export const planFencedFoeRecoveryWrite = ({
  current,
  exists,
  expectedUpdatedAt,
  payload,
}) => {
  assertRecoverableFoe({ current, exists });
  normalizeTimestamp(expectedUpdatedAt);
  if (payloadAlreadyApplied(current, payload)) return 'already-applied';
  assertFoeRecoveryFence({ current, exists, expectedUpdatedAt });
  return 'update';
};

export const runFencedFoeRecoveryWrite = async ({
  db,
  expectedUpdatedAt,
  foeRef,
  payload,
  runTransaction,
}) => runTransaction(db, async (transaction) => {
  const snapshot = await transaction.get(foeRef);
  const action = planFencedFoeRecoveryWrite({
    current: snapshot.exists() ? snapshot.data() : null,
    exists: snapshot.exists(),
    expectedUpdatedAt,
    payload,
  });
  if (action === 'update') transaction.update(foeRef, payload);
  return action;
});

export const persistFoeRecoveryWithMarker = async ({
  marker,
  markerRef,
  persist,
}) => {
  if (markerRef.current !== marker) {
    throw recoveryError(
      'The foe recovery state changed. Retry from the current form.',
      'foe-recovery-marker-conflict'
    );
  }
  const result = await persist();
  if (markerRef.current === marker) markerRef.current = null;
  return result;
};
