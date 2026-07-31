'use strict';

const USER_DIRECTORY_PAGE_SIZE = 50;
const USER_DIRECTORY_QUERY_KEYS = Object.freeze({
  all: 'directory.users.page.v1',
  byRole: Object.freeze({
    player: 'directory.users.by-role.player.page.v1',
    dm: 'directory.users.by-role.dm.page.v1',
    webmaster: 'directory.users.by-role.webmaster.page.v1',
  }),
});
const ALLOWED_ROLES = new Set(['player', 'dm', 'webmaster']);

const normalizeRole = (role) => {
  if (role === null || role === undefined) return null;
  if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
    throw new TypeError('Directory role must be player, dm, webmaster, or null.');
  }
  return role;
};

const queryKeyForRole = (role) => (
  role === null ? USER_DIRECTORY_QUERY_KEYS.all : USER_DIRECTORY_QUERY_KEYS.byRole[role]
);

const cursorValues = (cursor, queryKey) => {
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw new TypeError('Cursor must be an object.');
  }
  if (cursor.version !== 1) throw new TypeError(`Unsupported cursor version: ${String(cursor.version)}`);
  if (cursor.queryKey !== queryKey) throw new TypeError(`Cursor queryKey does not match ${queryKey}.`);
  if (
    !Array.isArray(cursor.sortValues)
    || cursor.sortValues.length !== 1
    || typeof cursor.sortValues[0] !== 'string'
    || typeof cursor.documentId !== 'string'
    || !cursor.documentId
  ) {
    throw new TypeError(`Cursor for ${queryKey} requires normalizedLabel and documentId values.`);
  }
  return [cursor.sortValues[0], cursor.documentId];
};

/**
 * Shared by the React repository and the emulator role matrix. `sdk` is
 * explicit so production still imports Firestore exclusively through the
 * telemetry facade while the rules test uses its authenticated context.
 */
const buildUserDirectoryQuery = ({
  firestore,
  role = null,
  cursor = null,
  pageSize = USER_DIRECTORY_PAGE_SIZE,
  sdk,
} = {}) => {
  if (!firestore) throw new TypeError('Directory queries require a Firestore instance.');
  if (!sdk || typeof sdk.query !== 'function') throw new TypeError('Directory queries require Firestore query helpers.');
  const normalizedRole = normalizeRole(role);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > USER_DIRECTORY_PAGE_SIZE) {
    throw new TypeError(`Directory pageSize must be between 1 and ${USER_DIRECTORY_PAGE_SIZE}.`);
  }
  const queryKey = queryKeyForRole(normalizedRole);
  const constraints = [];
  if (normalizedRole !== null) constraints.push(sdk.where('role', '==', normalizedRole));
  constraints.push(
    sdk.orderBy('normalizedLabel', 'asc'),
    sdk.orderBy(sdk.documentId(), 'asc')
  );
  if (cursor !== null && cursor !== undefined) {
    constraints.push(sdk.startAfter(...cursorValues(cursor, queryKey)));
  }
  constraints.push(sdk.limit(pageSize));
  return {
    queryKey,
    role: normalizedRole,
    target: sdk.query(sdk.collection(firestore, 'user_directory'), ...constraints),
  };
};

module.exports = {
  USER_DIRECTORY_PAGE_SIZE,
  USER_DIRECTORY_QUERY_KEYS,
  buildUserDirectoryQuery,
};
