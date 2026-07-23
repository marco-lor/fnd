/* global globalThis */
import { createBackendOperationId } from './backendOperationClient';

export const TASK06_OPERATION_INTENT_STORAGE_KEY =
  'fnd.task06.operation-intents.v1';

const STORE_SCHEMA_VERSION = 1;
const MAX_INTENTS = 32;
const MAX_SERIALIZED_BYTES = 64 * 1024;
const INTENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const KIND_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const activeIntentRuns = new Map();

export class BackendOperationIntentError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'BackendOperationIntentError';
    if (cause) this.cause = cause;
  }
}

const canonicalJson = (value, seen = new Set()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BackendOperationIntentError(
        'Operation intent numbers must be finite.'
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new BackendOperationIntentError('Operation intent must not be cyclic.');
    }
    seen.add(value);
    const serialized = `[${value.map((entry) => canonicalJson(entry, seen)).join(',')}]`;
    seen.delete(value);
    return serialized;
  }
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new BackendOperationIntentError(
        'Operation intent must contain plain JSON objects only.'
      );
    }
    if (seen.has(value)) {
      throw new BackendOperationIntentError('Operation intent must not be cyclic.');
    }
    seen.add(value);
    const serialized = `{${Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) {
        throw new BackendOperationIntentError(
          'Operation intent must not contain undefined values.'
        );
      }
      return `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`;
    }).join(',')}}`;
    seen.delete(value);
    return serialized;
  }
  throw new BackendOperationIntentError(
    'Operation intent must contain JSON-safe values only.'
  );
};

const digestHex = async (value, cryptoImpl) => {
  if (!cryptoImpl?.subtle?.digest) {
    throw new BackendOperationIntentError(
      'Secure operation-intent hashing is unavailable.'
    );
  }
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const resolveStorage = (storage) => {
  if (storage) return storage;
  try {
    if (globalThis.sessionStorage) return globalThis.sessionStorage;
  } catch (error) {
    throw new BackendOperationIntentError(
      'Secure session operation storage is unavailable.',
      error
    );
  }
  throw new BackendOperationIntentError(
    'Secure session operation storage is unavailable.'
  );
};

const isValidEntry = (entry) => (
  entry
  && typeof entry === 'object'
  && entry.schemaVersion === STORE_SCHEMA_VERSION
  && KIND_PATTERN.test(entry.kind)
  && OPERATION_ID_PATTERN.test(entry.operationId)
  && DIGEST_PATTERN.test(entry.intentDigest)
  && Number.isSafeInteger(entry.createdAt)
  && entry.createdAt >= 0
);

const serializeStore = (entries) => JSON.stringify({
  schemaVersion: STORE_SCHEMA_VERSION,
  entries,
});

const writeStore = (storage, entries) => {
  const serialized = serializeStore(entries);
  if (serialized.length > MAX_SERIALIZED_BYTES) {
    throw new BackendOperationIntentError(
      'Operation intent storage exceeded its safe size limit.'
    );
  }
  try {
    storage.setItem(TASK06_OPERATION_INTENT_STORAGE_KEY, serialized);
  } catch (error) {
    throw new BackendOperationIntentError(
      'Unable to persist the operation intent safely.',
      error
    );
  }
};

const readStore = (storage, now) => {
  let serialized;
  try {
    serialized = storage.getItem(TASK06_OPERATION_INTENT_STORAGE_KEY);
  } catch (error) {
    throw new BackendOperationIntentError(
      'Unable to read secure operation intent storage.',
      error
    );
  }
  if (!serialized) return [];
  if (serialized.length > MAX_SERIALIZED_BYTES) {
    throw new BackendOperationIntentError(
      'Operation intent storage exceeded its safe size limit.'
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new BackendOperationIntentError(
      'Operation intent storage is malformed.',
      error
    );
  }
  if (
    parsed?.schemaVersion !== STORE_SCHEMA_VERSION
    || !Array.isArray(parsed.entries)
    || parsed.entries.length > MAX_INTENTS
    || !parsed.entries.every(isValidEntry)
  ) {
    throw new BackendOperationIntentError(
      'Operation intent storage failed validation.'
    );
  }

  const retained = parsed.entries.filter(({createdAt}) => (
    now - createdAt <= INTENT_TTL_MS
  ));
  if (retained.length !== parsed.entries.length) {
    writeStore(storage, retained);
  }
  return retained;
};

const acquireIntent = ({
  storage,
  kind,
  intentDigest,
  now,
  createOperationId,
}) => {
  const entries = readStore(storage, now);
  const existing = entries.find((entry) => (
    entry.kind === kind && entry.intentDigest === intentDigest
  ));
  if (existing) return existing.operationId;
  if (entries.length >= MAX_INTENTS) {
    throw new BackendOperationIntentError(
      'Too many unfinished operations are stored in this session.'
    );
  }

  const operationId = createOperationId(kind);
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new BackendOperationIntentError(
      'The generated operation ID is invalid.'
    );
  }
  writeStore(storage, [
    ...entries,
    {
      schemaVersion: STORE_SCHEMA_VERSION,
      kind,
      operationId,
      intentDigest,
      createdAt: now,
    },
  ]);
  return operationId;
};

const clearIntent = ({
  storage,
  kind,
  intentDigest,
  operationId,
  now,
}) => {
  const entries = readStore(storage, now);
  writeStore(storage, entries.filter((entry) => !(
    entry.kind === kind
    && entry.intentDigest === intentDigest
    && entry.operationId === operationId
  )));
};

export const runWithDurableOperationIntent = async ({
  actorUid,
  kind,
  intent,
  invoke,
  storage,
  cryptoImpl = globalThis.crypto,
  now = () => Date.now(),
  createOperationId = createBackendOperationId,
}) => {
  if (typeof actorUid !== 'string' || !actorUid.trim()) {
    throw new BackendOperationIntentError(
      'An authenticated actor is required for this operation.'
    );
  }
  if (!KIND_PATTERN.test(String(kind || ''))) {
    throw new BackendOperationIntentError('Operation intent kind is invalid.');
  }
  if (typeof invoke !== 'function') {
    throw new BackendOperationIntentError('Operation invocation is required.');
  }

  const canonicalIntent = {
    actorUid: actorUid.trim(),
    kind,
    immutableRequest: intent,
  };
  const activeKey = canonicalJson(canonicalIntent);
  if (activeIntentRuns.has(activeKey)) {
    return activeIntentRuns.get(activeKey);
  }

  const run = (async () => {
    const intentDigest = await digestHex(canonicalIntent, cryptoImpl);
    const resolvedStorage = resolveStorage(storage);
    const operationId = acquireIntent({
      storage: resolvedStorage,
      kind,
      intentDigest,
      now: now(),
      createOperationId,
    });
    const result = await invoke(operationId);
    clearIntent({
      storage: resolvedStorage,
      kind,
      intentDigest,
      operationId,
      now: now(),
    });
    return result;
  })();
  activeIntentRuns.set(activeKey, run);
  try {
    return await run;
  } finally {
    if (activeIntentRuns.get(activeKey) === run) {
      activeIntentRuns.delete(activeKey);
    }
  }
};
