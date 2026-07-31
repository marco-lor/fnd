import { Timestamp } from '../performance/firestore';

export const FIRESTORE_CURSOR_VERSION = 1;
export const FIRESTORE_TIMESTAMP_CURSOR_TYPE = 'firestore-timestamp';

const isCursorScalar = (value) => (
  value === null
  || typeof value === 'string'
  || (typeof value === 'number' && Number.isFinite(value))
  || typeof value === 'boolean'
);

const isEncodedTimestamp = (value) => (
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && value.type === FIRESTORE_TIMESTAMP_CURSOR_TYPE
  && Number.isSafeInteger(value.seconds)
  && Number.isInteger(value.nanoseconds)
  && value.nanoseconds >= 0
  && value.nanoseconds < 1_000_000_000
  && Object.keys(value).length === 3
);

const encodeCursorValue = (value) => {
  if (isCursorScalar(value)) return value;
  if (isEncodedTimestamp(value)) {
    return Object.freeze({
      type: FIRESTORE_TIMESTAMP_CURSOR_TYPE,
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    });
  }
  if (
    value
    && typeof value === 'object'
    && Number.isSafeInteger(value.seconds)
    && Number.isInteger(value.nanoseconds)
    && typeof value.toDate === 'function'
  ) {
    return encodeCursorValue({
      type: FIRESTORE_TIMESTAMP_CURSOR_TYPE,
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    });
  }
  throw new TypeError('Cursor sortValues must contain JSON scalars or Firestore Timestamps.');
};

export const decodeCursorValue = (value) => {
  if (isCursorScalar(value)) return value;
  if (!isEncodedTimestamp(value)) {
    throw new TypeError('Cursor value is not a supported scalar or tagged Firestore Timestamp.');
  }
  return new Timestamp(value.seconds, value.nanoseconds);
};

const cloneSortValues = (values) => {
  if (!Array.isArray(values)) {
    throw new TypeError('Cursor sortValues must be an array.');
  }
  return values.map(encodeCursorValue);
};

const assertQueryKey = (queryKey) => {
  if (typeof queryKey !== 'string' || !queryKey.trim()) {
    throw new TypeError('Cursor queryKey must be a non-empty string.');
  }
  return queryKey;
};

const assertDocumentId = (documentId) => {
  if (typeof documentId !== 'string' || !documentId) {
    throw new TypeError('Cursor documentId must be a non-empty string.');
  }
  return documentId;
};

/**
 * @typedef {Object} FirestorePageCursorV1
 * @property {1} version
 * @property {string} queryKey
 * @property {Array<string|number|boolean|null|{type: 'firestore-timestamp', seconds: number, nanoseconds: number}>} sortValues
 * @property {string} documentId
 */

/**
 * Creates a serializable cursor containing scalar sort values rather than a
 * DocumentSnapshot. It remains usable if the cursor document is deleted.
 *
 * @param {{queryKey: string, sortValues: Array<unknown>, documentId: string}} value
 * @returns {FirestorePageCursorV1}
 */
export const createPageCursor = ({ queryKey, sortValues, documentId }) => Object.freeze({
  version: FIRESTORE_CURSOR_VERSION,
  queryKey: assertQueryKey(queryKey),
  sortValues: Object.freeze(cloneSortValues(sortValues)),
  documentId: assertDocumentId(documentId),
});

/**
 * Validates an externally supplied cursor against the exact query contract.
 *
 * @param {unknown} cursor
 * @param {{queryKey: string, sortValueCount: number}} contract
 * @returns {FirestorePageCursorV1}
 */
export const parsePageCursor = (cursor, { queryKey, sortValueCount }) => {
  assertQueryKey(queryKey);
  if (!Number.isInteger(sortValueCount) || sortValueCount < 0) {
    throw new TypeError('Cursor sortValueCount must be a non-negative integer.');
  }
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw new TypeError('Cursor must be an object.');
  }
  if (cursor.version !== FIRESTORE_CURSOR_VERSION) {
    throw new TypeError(`Unsupported cursor version: ${String(cursor.version)}`);
  }
  if (cursor.queryKey !== queryKey) {
    throw new TypeError(`Cursor queryKey does not match ${queryKey}.`);
  }
  const sortValues = cloneSortValues(cursor.sortValues);
  if (sortValues.length !== sortValueCount) {
    throw new TypeError(`Cursor for ${queryKey} requires ${sortValueCount} sort values.`);
  }
  return createPageCursor({
    queryKey,
    sortValues,
    documentId: cursor.documentId,
  });
};

export const getStartAfterValues = (cursor, contract) => {
  const parsed = parsePageCursor(cursor, contract);
  return [...parsed.sortValues.map(decodeCursorValue), parsed.documentId];
};

/**
 * @param {{id: string, data: () => Record<string, unknown>}} document
 * @param {{queryKey: string, sortFields: string[]}} contract
 */
export const createCursorFromDocument = (document, { queryKey, sortFields }) => {
  if (!document || typeof document.data !== 'function') {
    throw new TypeError('A Firestore-like document is required to create a cursor.');
  }
  if (!Array.isArray(sortFields) || !sortFields.every((field) => typeof field === 'string' && field)) {
    throw new TypeError('Cursor sortFields must be non-empty field names.');
  }
  const data = document.data();
  const sortValues = sortFields.map((field) => {
    if (!data || !Object.prototype.hasOwnProperty.call(data, field)) {
      throw new TypeError(`Cursor document is missing the declared sort field: ${field}`);
    }
    return data[field];
  });
  return createPageCursor({ queryKey, sortValues, documentId: document.id });
};

/**
 * Merges retry/overlap pages without duplicating IDs. Existing entities retain
 * identity; newly returned versions replace only matching IDs.
 */
export const mergeUniquePage = (previous, incoming, { getId = (item) => item?.id } = {}) => {
  if (!Array.isArray(previous) || !Array.isArray(incoming) || typeof getId !== 'function') {
    throw new TypeError('Page merging requires two arrays and an ID selector.');
  }
  const result = [...previous];
  const indexById = new Map();
  result.forEach((item, index) => {
    const id = getId(item);
    if (typeof id !== 'string' || !id) throw new TypeError('Paged entities require stable string IDs.');
    if (!indexById.has(id)) indexById.set(id, index);
  });
  for (const item of incoming) {
    const id = getId(item);
    if (typeof id !== 'string' || !id) throw new TypeError('Paged entities require stable string IDs.');
    const existingIndex = indexById.get(id);
    if (existingIndex === undefined) {
      indexById.set(id, result.length);
      result.push(item);
    } else if (result[existingIndex] !== item) {
      result[existingIndex] = item;
    }
  }
  return result;
};

/**
 * Prevents an intended orderBy from silently omitting legacy documents. A new
 * query key becomes active only after an explicit 100% backfill signal.
 */
export const resolveCompatibleOrdering = ({
  compatibilityQueryKey,
  targetQueryKey,
  targetSortFields,
  backfillPercent,
}) => {
  assertQueryKey(compatibilityQueryKey);
  assertQueryKey(targetQueryKey);
  if (!Array.isArray(targetSortFields) || targetSortFields.length === 0) {
    throw new TypeError('Target ordering requires at least one sort field.');
  }
  if (typeof backfillPercent !== 'number' || backfillPercent < 0 || backfillPercent > 100) {
    throw new TypeError('backfillPercent must be between 0 and 100.');
  }
  if (backfillPercent < 100) {
    return Object.freeze({
      queryKey: compatibilityQueryKey,
      sortFields: Object.freeze([]),
      compatibilityMode: true,
    });
  }
  return Object.freeze({
    queryKey: targetQueryKey,
    sortFields: Object.freeze([...targetSortFields]),
    compatibilityMode: false,
  });
};
