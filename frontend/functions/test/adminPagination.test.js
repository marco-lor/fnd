const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeAdminUserListPagination} = require('../lib/userDataV2');

test('Admin keeps legacy pagination and opts into ten normalized rows', () => {
  assert.deepEqual(normalizeAdminUserListPagination({}), {cursor: null, limit: 100});
  assert.deepEqual(normalizeAdminUserListPagination({cursor: 'user-1'}), {cursor: 'user-1', limit: 100});
  assert.deepEqual(normalizeAdminUserListPagination({schemaVersion: 2, search: '  ÉLÈNE   TEST '}), {
    schemaVersion: 2, search: 'elene test', cursor: null, limit: 10,
  });
});

test('Admin composite cursors bind label and UID to their normalized search', () => {
  const cursor = {normalizedLabel: 'elene test', uid: 'user-1', search: 'elene'};
  assert.deepEqual(normalizeAdminUserListPagination({schemaVersion: 2, search: 'ÉLÈNE', cursor}), {
    schemaVersion: 2, search: 'elene', cursor, limit: 10,
  });
  for (const input of [
    {schemaVersion: 3}, {schemaVersion: 2, limit: 11},
    {schemaVersion: 2, search: 12}, {schemaVersion: 2, search: 'a'.repeat(201)},
    {schemaVersion: 2, cursor: 'user-1'},
    {schemaVersion: 2, search: 'other', cursor},
    {schemaVersion: 2, search: 'elene', cursor: {...cursor, uid: '../bad'}},
    {schemaVersion: 2, search: 'elene', cursor: {...cursor, normalizedLabel: 'other'}},
  ]) assert.throws(() => normalizeAdminUserListPagination(input), TypeError);
});

test('Admin search upper bound includes Unicode supplementary characters', () => {
  const {adminSearchUpperBound} = require('../lib/userDataV2');
  assert.equal(adminSearchUpperBound('task11'), 'task12');
  assert.equal(adminSearchUpperBound('a'), 'b');
  assert.equal(adminSearchUpperBound('a\u{10ffff}'), 'b');
  assert.equal(adminSearchUpperBound('\u{10ffff}'), null);
});

test('Admin prefix successor skips the surrogate gap and preserves scalar suffixes', () => {
  const {adminSearchUpperBound} = require('../lib/userDataV2');
  assert.equal(adminSearchUpperBound('\uD7FF'), '\uE000');
  assert.equal(adminSearchUpperBound('prefix\uD7FF\u{10ffff}'), 'prefix\uE000');
  assert.equal(adminSearchUpperBound('\u{10000}'), '\u{10001}');
  const cursor = {normalizedLabel: '\uD7FF🔥', uid: 'user-🔥', search: '\uD7FF'};
  assert.deepEqual(normalizeAdminUserListPagination({schemaVersion: 2, search: '\uD7FF', cursor}), {
    schemaVersion: 2, limit: 10, search: '\uD7FF', cursor,
  });
});

test('Admin rejects unpaired surrogate search and cursor strings before SDK encoding', () => {
  const {adminSearchUpperBound} = require('../lib/userDataV2');
  for (const malformed of ['\uD800', '\uDFFF', 'a\uD800z', 'a\uDFFFz', '\uD800\uD800', '\uDC00\uD800']) {
    assert.throws(() => adminSearchUpperBound(malformed), TypeError);
    assert.throws(() => normalizeAdminUserListPagination({schemaVersion: 2, search: malformed}), TypeError);
    assert.throws(() => normalizeAdminUserListPagination({cursor: malformed}), TypeError);
    for (const field of ['normalizedLabel', 'uid', 'search']) {
      const cursor = {normalizedLabel: 'a', uid: 'user-1', search: ''};
      cursor[field] = malformed;
      assert.throws(() => normalizeAdminUserListPagination({schemaVersion: 2, cursor}), TypeError);
    }
  }
});
