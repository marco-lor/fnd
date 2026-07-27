/* global globalThis */
import { createTask07AbortError } from './mediaErrors';

export const TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY =
  'fnd.task07.media-operation-receipts.v2';

const STORE_SCHEMA_VERSION = 2;
const MAX_RECEIPTS = 24;
const MAX_SERIALIZED_BYTES = 32 * 1024;
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_ATTEMPT = 9999;
const MAX_ENTITY_REVISION = 0x7fffffff;
const KIND_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;
const activeReceiptRuns = new Map();
const normalizeTask07ErrorCode = (error) => (
  typeof error?.code === 'string'
    ? error.code.replace(/^functions\//, '')
    : ''
);

const DEFINITIVE_PRE_ATTACH_CODES = new Set([
  'aborted',
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'permission-denied',
  'unauthenticated',
  'unsupported-media',
]);
const DEFINITIVE_ATTACH_RESPONSE_CODES = new Set([
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'permission-denied',
  'unauthenticated',
  'unsupported-media',
]);

export class Task07MediaOperationReceiptError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'Task07MediaOperationReceiptError';
    if (cause) this.cause = cause;
  }
}

const normalizeRequired = (value, label) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Task07MediaOperationReceiptError(
      `Task 07 ${label} is required for durable operation identity.`
    );
  }
  return normalized;
};

export const buildTask07MediaStableRevision = ({
  expectedRevision,
  attempt = 0,
}) => {
  if (
    !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0
    || expectedRevision > MAX_ENTITY_REVISION
  ) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 expected revision must be an exact bounded server revision.'
    );
  }
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt > MAX_ATTEMPT) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 operation attempt is outside its bounded range.'
    );
  }
  return `r${expectedRevision}.a${attempt}`;
};

const canonicalJson = (value, seen = new Set()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Task07MediaOperationReceiptError(
        'Task 07 operation identity numbers must be finite.'
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Task07MediaOperationReceiptError(
        'Task 07 operation identity must not be cyclic.'
      );
    }
    seen.add(value);
    const serialized = `[${value.map((entry) => canonicalJson(entry, seen)).join(',')}]`;
    seen.delete(value);
    return serialized;
  }
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Task07MediaOperationReceiptError(
        'Task 07 operation identity must contain plain JSON objects only.'
      );
    }
    if (seen.has(value)) {
      throw new Task07MediaOperationReceiptError(
        'Task 07 operation identity must not be cyclic.'
      );
    }
    seen.add(value);
    const serialized = `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`
    )).join(',')}}`;
    seen.delete(value);
    return serialized;
  }
  throw new Task07MediaOperationReceiptError(
    'Task 07 operation identity must contain JSON-safe values only.'
  );
};

const digestHex = async (value, cryptoImpl) => {
  if (!cryptoImpl?.subtle?.digest || typeof TextEncoder !== 'function') {
    throw new Task07MediaOperationReceiptError(
      'Secure Task 07 operation hashing is unavailable.'
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
    throw new Task07MediaOperationReceiptError(
      'Secure session media-operation storage is unavailable.',
      error
    );
  }
  throw new Task07MediaOperationReceiptError(
    'Secure session media-operation storage is unavailable.'
  );
};

const RECEIPT_KEYS = [
  'attempt',
  'createdAt',
  'expectedRevision',
  'intentDigest',
  'kind',
  'operationId',
  'previousAssetId',
  'schemaVersion',
  'updatedAt',
];

const expectedOperationId = (entry) => {
  try {
    const stableRevision = buildTask07MediaStableRevision({
      expectedRevision: entry.expectedRevision,
      attempt: entry.attempt,
    });
    return `task07:${entry.kind}:${stableRevision}:${entry.intentDigest.slice(0, 40)}`;
  } catch (error) {
    return '';
  }
};

const isValidReceipt = (entry) => (
  entry
  && typeof entry === 'object'
  && Object.getPrototypeOf(entry) === Object.prototype
  && JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(RECEIPT_KEYS)
  && entry.schemaVersion === STORE_SCHEMA_VERSION
  && KIND_PATTERN.test(entry.kind)
  && DIGEST_PATTERN.test(entry.intentDigest)
  && OPERATION_ID_PATTERN.test(entry.operationId)
  && entry.operationId === expectedOperationId(entry)
  && Number.isSafeInteger(entry.attempt)
  && entry.attempt >= 0
  && entry.attempt <= MAX_ATTEMPT
  && Number.isSafeInteger(entry.expectedRevision)
  && entry.expectedRevision >= 0
  && entry.expectedRevision <= MAX_ENTITY_REVISION
  && (
    entry.previousAssetId === null
    || (
      typeof entry.previousAssetId === 'string'
      && ASSET_ID_PATTERN.test(entry.previousAssetId)
    )
  )
  && Number.isSafeInteger(entry.createdAt)
  && entry.createdAt >= 0
  && Number.isSafeInteger(entry.updatedAt)
  && entry.updatedAt >= entry.createdAt
);

const serializeStore = (receipts) => JSON.stringify({
  schemaVersion: STORE_SCHEMA_VERSION,
  receipts,
});

const writeStore = (storage, receipts) => {
  try {
    if (receipts.length === 0) {
      storage.removeItem(TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY);
      return;
    }
    const serialized = serializeStore(receipts);
    if (serialized.length > MAX_SERIALIZED_BYTES) {
      throw new Task07MediaOperationReceiptError(
        'Task 07 media-operation receipts exceeded their safe size limit.'
      );
    }
    storage.setItem(TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY, serialized);
  } catch (error) {
    if (error instanceof Task07MediaOperationReceiptError) throw error;
    throw new Task07MediaOperationReceiptError(
      'Unable to persist Task 07 media-operation receipts safely.',
      error
    );
  }
};

const readStore = (storage, now) => {
  let serialized;
  try {
    serialized = storage.getItem(TASK07_MEDIA_OPERATION_RECEIPT_STORAGE_KEY);
  } catch (error) {
    throw new Task07MediaOperationReceiptError(
      'Unable to read Task 07 media-operation receipts safely.',
      error
    );
  }
  if (!serialized) return [];
  if (serialized.length > MAX_SERIALIZED_BYTES) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 media-operation receipts exceeded their safe size limit.'
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 media-operation receipt storage is malformed.',
      error
    );
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || Object.getPrototypeOf(parsed) !== Object.prototype
    || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify([
      'receipts',
      'schemaVersion',
    ])
    || parsed.schemaVersion !== STORE_SCHEMA_VERSION
    || !Array.isArray(parsed.receipts)
    || parsed.receipts.length > MAX_RECEIPTS
    || !parsed.receipts.every(isValidReceipt)
    || parsed.receipts.some(({ updatedAt }) => updatedAt > now + MAX_CLOCK_SKEW_MS)
    || new Set(parsed.receipts.map(({ intentDigest }) => intentDigest)).size
      !== parsed.receipts.length
    || new Set(parsed.receipts.map(({ operationId }) => operationId)).size
      !== parsed.receipts.length
  ) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 media-operation receipt storage failed validation.'
    );
  }

  const retained = parsed.receipts.filter(({ updatedAt }) => (
    now - updatedAt <= RECEIPT_TTL_MS
  ));
  if (retained.length !== parsed.receipts.length) {
    writeStore(storage, retained);
  }
  return retained;
};

const buildOperationId = ({ kind, expectedRevision, attempt, intentDigest }) => {
  const stableRevision = buildTask07MediaStableRevision({
    expectedRevision,
    attempt,
  });
  const operationId = `task07:${kind}:${stableRevision}:${intentDigest.slice(0, 40)}`;
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 durable media operation identity is invalid.'
    );
  }
  return { operationId, stableRevision };
};

const acquireReceipt = ({
  storage,
  intentDigest,
  kind,
  expectedRevision,
  previousAssetId,
  now,
}) => {
  const receipts = readStore(storage, now);
  const existingIndex = receipts.findIndex((entry) => (
    entry.intentDigest === intentDigest
  ));
  if (existingIndex >= 0) {
    const existing = receipts[existingIndex];
    const refreshed = {
      ...existing,
      updatedAt: now,
    };
    writeStore(storage, receipts.map((entry, index) => (
      index === existingIndex ? refreshed : entry
    )));
    return refreshed;
  }
  if (receipts.length >= MAX_RECEIPTS) {
    throw new Task07MediaOperationReceiptError(
      'Too many unfinished Task 07 media operations are stored in this session.'
    );
  }

  const attempt = 0;
  const { operationId } = buildOperationId({
    kind,
    expectedRevision,
    attempt,
    intentDigest,
  });
  const receipt = {
    schemaVersion: STORE_SCHEMA_VERSION,
    kind,
    intentDigest,
    operationId,
    attempt,
    expectedRevision,
    previousAssetId,
    createdAt: now,
    updatedAt: now,
  };
  writeStore(storage, [...receipts, receipt]);
  return receipt;
};

const clearReceipt = ({ storage, receipt, now }) => {
  const receipts = readStore(storage, now);
  writeStore(storage, receipts.filter((entry) => !(
    entry.intentDigest === receipt.intentDigest
    && entry.operationId === receipt.operationId
  )));
};

const rotateReceipt = ({
  storage,
  receipt,
  expectedRevision,
  previousAssetId,
  now,
}) => {
  const receipts = readStore(storage, now);
  const index = receipts.findIndex((entry) => (
    entry.intentDigest === receipt.intentDigest
    && entry.operationId === receipt.operationId
  ));
  if (index < 0 || receipt.attempt >= MAX_ATTEMPT) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 media-operation receipt could not be rotated safely.'
    );
  }
  const attempt = receipt.attempt + 1;
  const { operationId } = buildOperationId({
    kind: receipt.kind,
    expectedRevision,
    attempt,
    intentDigest: receipt.intentDigest,
  });
  const rotated = {
    ...receipt,
    operationId,
    attempt,
    expectedRevision,
    previousAssetId,
    updatedAt: now,
  };
  writeStore(storage, receipts.map((entry, entryIndex) => (
    entryIndex === index ? rotated : entry
  )));
  return rotated;
};

const normalizeInput = ({
  actorUid,
  ownerUid,
  entityId,
  kind,
  file,
  expectedRevision,
  previousAssetId = null,
  referenceScope = null,
}) => {
  const normalizedKind = normalizeRequired(kind, 'media kind');
  if (!KIND_PATTERN.test(normalizedKind)) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 media kind is invalid for durable operation identity.'
    );
  }
  const normalizedOwnerUid = normalizeRequired(ownerUid, 'media owner');
  const normalizedActorUid = normalizeRequired(
    actorUid == null ? normalizedOwnerUid : actorUid,
    'media actor'
  );
  const normalizedEntityId = normalizeRequired(entityId, 'entity ID');
  buildTask07MediaStableRevision({ expectedRevision, attempt: 0 });
  if (
    !file
    || typeof file.type !== 'string'
    || !file.type.trim()
    || !Number.isSafeInteger(file.size)
    || file.size <= 0
  ) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 durable media operation requires a non-empty File or Blob.'
    );
  }
  const normalizedPreviousAssetId = previousAssetId == null || previousAssetId === ''
    ? null
    : String(previousAssetId).trim();
  if (
    normalizedPreviousAssetId !== null
    && !ASSET_ID_PATTERN.test(normalizedPreviousAssetId)
  ) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 previous media asset identity is invalid.'
    );
  }
  const normalizedReferenceScope = referenceScope == null || referenceScope === ''
    ? null
    : String(referenceScope).trim();
  if (normalizedReferenceScope && normalizedReferenceScope.length > 32) {
    throw new Task07MediaOperationReceiptError(
      'Task 07 media reference scope is too long.'
    );
  }

  return {
    actorUid: normalizedActorUid,
    entityId: normalizedEntityId,
    expectedRevision,
    file: {
      lastModified: Number.isSafeInteger(file.lastModified) && file.lastModified >= 0
        ? file.lastModified
        : 0,
      name: typeof file.name === 'string' ? file.name : '',
      size: file.size,
      type: file.type.trim().toLowerCase(),
    },
    kind: normalizedKind,
    ownerUid: normalizedOwnerUid,
    previousAssetId: normalizedPreviousAssetId,
    referenceScope: normalizedReferenceScope,
    schemaVersion: STORE_SCHEMA_VERSION,
  };
};

export const task07MediaReceiptOutcomeIsAmbiguous = (outcome) => (
  outcome?.status === 'attached-result-unknown'
  || outcome?.status === 'attach-acknowledgement-unknown'
);

export const task07MediaFailureCanRotateReceipt = (error) => {
  const code = normalizeTask07ErrorCode(error);
  if (error?.committed === true) return false;
  if (
    error?.commitAttempted === true
    && DEFINITIVE_ATTACH_RESPONSE_CODES.has(code)
  ) {
    return true;
  }
  if (error?.commitAttempted === true) return false;
  if (error?.definitive === true || error?.abandonment?.ok === true) return true;
  if (error instanceof TypeError) return true;
  return !error?.assetId && (
    error?.name === 'AbortError'
    || DEFINITIVE_PRE_ATTACH_CODES.has(code)
  );
};

/**
 * Persists only an opaque SHA-256 stable-intent digest, bounded operation
 * receipt, exact server revision, and optional opaque canonical asset ID.
 * Actor IDs, entity IDs, URLs, file names, and file metadata are never written
 * to browser storage. Mutable entity state is intentionally excluded from the
 * digest: after an acknowledgement-loss reload, the retained operation reuses
 * the original CAS inputs and exact operation ID instead of creating a second
 * upload against the entity's newly attached revision.
 */
export const runWithTask07MediaOperationReceipt = async ({
  actorUid,
  ownerUid,
  entityId,
  kind,
  file,
  expectedRevision,
  previousAssetId = null,
  referenceScope = null,
  invoke,
  signal,
  storage,
  cryptoImpl = globalThis.crypto,
  now = () => Date.now(),
}) => {
  if (typeof invoke !== 'function') {
    throw new Task07MediaOperationReceiptError(
      'Task 07 durable media operation requires an invocation.'
    );
  }
  if (signal?.aborted) throw createTask07AbortError(signal.reason);

  const normalized = normalizeInput({
    actorUid,
    ownerUid,
    entityId,
    kind,
    file,
    expectedRevision,
    previousAssetId,
    referenceScope,
  });
  const {
    expectedRevision: requestedExpectedRevision,
    previousAssetId: requestedPreviousAssetId,
    ...stableIntent
  } = normalized;
  const intentDigest = await digestHex(stableIntent, cryptoImpl);
  if (activeReceiptRuns.has(intentDigest)) {
    return activeReceiptRuns.get(intentDigest);
  }

  const run = (async () => {
    const resolvedStorage = resolveStorage(storage);
    const acquiredAt = now();
    if (!Number.isSafeInteger(acquiredAt) || acquiredAt < 0) {
      throw new Task07MediaOperationReceiptError(
        'Task 07 receipt clock is invalid.'
      );
    }
    const receipt = acquireReceipt({
      storage: resolvedStorage,
      intentDigest,
      kind: normalized.kind,
      expectedRevision: requestedExpectedRevision,
      previousAssetId: requestedPreviousAssetId,
      now: acquiredAt,
    });
    const stableRevision = buildTask07MediaStableRevision({
      expectedRevision: receipt.expectedRevision,
      attempt: receipt.attempt,
    });

    try {
      const result = await invoke({
        operationId: receipt.operationId,
        stableRevision,
        expectedRevision: receipt.expectedRevision,
        previousAssetId: receipt.previousAssetId,
        signal,
      });
      if (!task07MediaReceiptOutcomeIsAmbiguous(result)) {
        try {
          clearReceipt({
            storage: resolvedStorage,
            receipt,
            now: now(),
          });
        } catch (error) {
          error.committed = true;
          error.operationId = receipt.operationId;
          throw error;
        }
      }
      return result;
    } catch (error) {
      if (task07MediaFailureCanRotateReceipt(error)) {
        rotateReceipt({
          storage: resolvedStorage,
          receipt,
          expectedRevision: requestedExpectedRevision,
          previousAssetId: requestedPreviousAssetId,
          now: now(),
        });
      }
      throw error;
    }
  })();

  activeReceiptRuns.set(intentDigest, run);
  try {
    return await run;
  } finally {
    if (activeReceiptRuns.get(intentDigest) === run) {
      activeReceiptRuns.delete(intentDigest);
    }
  }
};
