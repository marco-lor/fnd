import { db } from '../components/firebaseConfig';
import {
  collection,
  documentId,
  getDocs,
  labelFirestoreTarget,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
} from '../performance/firestore';
import {
  createCursorFromDocument,
} from './pagination';
import {
  applyDocChanges,
  getCached,
  subscribeShared,
} from './repositoryRuntime';

const {
  buildUserDirectoryQuery,
  USER_DIRECTORY_PAGE_SIZE,
  USER_DIRECTORY_QUERY_KEYS,
} = require('./userDirectoryQueryFactory.cjs');

export { USER_DIRECTORY_PAGE_SIZE, USER_DIRECTORY_QUERY_KEYS };

const METRIC_KEYS = Object.freeze({
  list: 'directory.users.list.v1',
  subscribe: 'directory.users.subscribe.v1',
});
const ALLOWED_ROLES = new Set(['player', 'dm', 'webmaster']);
const PROJECTION_FIELDS = Object.freeze([
  'schemaVersion',
  'characterId',
  'label',
  'normalizedLabel',
  'role',
]);
const PROJECTION_FIELD_SET = new Set(PROJECTION_FIELDS);

/**
 * Runtime-validates the server-owned projection and deliberately returns only
 * its reviewed fields. Projection drift cannot leak a source user document.
 */
export const normalizeUserDirectoryDocument = (document) => {
  if (!document || typeof document.id !== 'string' || !document.id || typeof document.data !== 'function') {
    throw new TypeError('Directory results require Firestore-like documents with stable IDs.');
  }
  const source = document.data();
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError(`Directory projection ${document.id} must be an object.`);
  }
  const unexpectedFields = Object.keys(source).filter((field) => !PROJECTION_FIELD_SET.has(field));
  if (unexpectedFields.length > 0) {
    throw new TypeError(`Directory projection ${document.id} contains unexpected fields.`);
  }
  if (
    source.schemaVersion !== 1
    || typeof source.characterId !== 'string'
    || typeof source.label !== 'string'
    || !source.label.trim()
    || typeof source.normalizedLabel !== 'string'
    || !source.normalizedLabel
    || typeof source.role !== 'string'
    || !ALLOWED_ROLES.has(source.role)
  ) {
    throw new TypeError(`Directory projection ${document.id} is invalid.`);
  }
  return Object.freeze({
    id: document.id,
    schemaVersion: source.schemaVersion,
    characterId: source.characterId,
    label: source.label,
    normalizedLabel: source.normalizedLabel,
    role: source.role,
  });
};

/**
 * The single physical query builder used by both reads and listeners. Its
 * explicit document-ID tiebreaker matches the serialized cursor contract.
 */
export const __buildUserDirectoryQuery = ({
  role = null,
  cursor = null,
  pageSize = USER_DIRECTORY_PAGE_SIZE,
  firestore = db,
} = {}) => {
  return buildUserDirectoryQuery({
    firestore,
    role,
    cursor,
    pageSize,
    sdk: {
      collection,
      documentId,
      limit,
      orderBy,
      query,
      startAfter,
      where,
    },
  });
};

const privatePageInstanceKey = ({ role, cursor }) => (
  `directory:users:page:${role || 'all'}:${cursor ? JSON.stringify(cursor) : 'first'}`
);

const normalizePageSnapshot = (snapshot, queryKey) => {
  const documents = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
  const items = documents.map(normalizeUserDirectoryDocument);
  const lastDocument = documents[documents.length - 1];
  return Object.freeze({
    items: Object.freeze(items),
    cursor: lastDocument
      ? createCursorFromDocument(lastDocument, {
        queryKey,
        sortFields: ['normalizedLabel'],
      })
      : null,
    hasMore: documents.length === USER_DIRECTORY_PAGE_SIZE,
  });
};

/**
 * @param {{role?: 'player'|'dm'|'webmaster'|null, cursor?: import('./pagination').FirestorePageCursorV1|null}} options
 */
export const getUserDirectoryPage = ({ role = null, cursor = null } = {}) => {
  const built = __buildUserDirectoryQuery({ role, cursor });
  const instanceKey = privatePageInstanceKey({ role: built.role, cursor });
  return getCached({
    metricKey: METRIC_KEYS.list,
    instanceKey,
    load: async () => normalizePageSnapshot(
      await getDocs(labelFirestoreTarget(built.target, METRIC_KEYS.list)),
      built.queryKey
    ),
  });
};

/**
 * Shares the first 50-row listener and applies only document changes so every
 * unaffected directory entity preserves identity across revisions.
 */
export const subscribeUserDirectoryFirstPage = (observer, { role = null } = {}) => {
  const built = __buildUserDirectoryQuery({ role });
  let structuralResult = null;
  return subscribeShared({
    metricKey: METRIC_KEYS.subscribe,
    instanceKey: `directory:users:subscribe:first:${built.role || 'all'}`,
    listen: ({ next, error }) => onSnapshot(
      labelFirestoreTarget(built.target, METRIC_KEYS.subscribe),
      {
        next: (snapshot) => {
          structuralResult = applyDocChanges(
            structuralResult,
            snapshot,
            normalizeUserDirectoryDocument
          );
          next(structuralResult);
        },
        error,
      }
    ),
  }, observer);
};
