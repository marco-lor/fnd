const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UNNAMED_CHARACTER_LABEL,
  buildUserDirectoryProjection,
  normalizeDirectoryLabel,
  normalizeDirectoryRole,
  planUserDirectoryMutation,
  userDirectoryProjectionDataMatches,
} = require('../lib/userDirectoryProjection');

test('builds the exact private directory projection without identity fallbacks', () => {
  const projection = buildUserDirectoryProjection({
    characterId: '  Éowyn   d’Ithilien  ',
    role: 'players',
    email: 'private@example.test',
    inventory: [{ secret: true }],
  });

  assert.deepEqual(projection, {
    schemaVersion: 1,
    characterId: 'Éowyn   d’Ithilien',
    label: 'Éowyn   d’Ithilien',
    normalizedLabel: 'eowyn d’ithilien',
    role: 'player',
  });
  assert.deepEqual(Object.keys(projection).sort(), [
    'characterId',
    'label',
    'normalizedLabel',
    'role',
    'schemaVersion',
  ]);
});

test('uses an anonymous-safe fallback and canonical roles', () => {
  const projection = buildUserDirectoryProjection({
    characterId: '   ',
    email: 'must-not-be-used@example.test',
    uid: 'must-not-be-used',
    role: 'unexpected-role',
  });

  assert.equal(projection.characterId, '');
  assert.equal(projection.label, UNNAMED_CHARACTER_LABEL);
  assert.equal(projection.normalizedLabel, 'unnamed character');
  assert.equal(projection.role, 'player');
  assert.equal(normalizeDirectoryRole(' WEBMASTER '), 'webmaster');
  assert.equal(normalizeDirectoryLabel('  JÓSE\tÁLVAREZ  '), 'jose alvarez');
  assert.equal(userDirectoryProjectionDataMatches({...projection}, projection), true);
  assert.equal(userDirectoryProjectionDataMatches({...projection, email: 'leak'}, projection), false);
});

test('plans only projection-changing writes and source deletion cleanup', () => {
  const before = {
    characterId: 'Hero',
    role: 'player',
    inventory: [{ id: 'old' }],
  };

  assert.deepEqual(planUserDirectoryMutation(before, {
    ...before,
    inventory: [{ id: 'new' }],
  }), {type: 'none'});

  assert.deepEqual(planUserDirectoryMutation(before, {
    ...before,
    characterId: 'Renamed Hero',
  }), {
    type: 'set',
    projection: {
      schemaVersion: 1,
      characterId: 'Renamed Hero',
      label: 'Renamed Hero',
      normalizedLabel: 'renamed hero',
      role: 'player',
    },
  });

  assert.deepEqual(planUserDirectoryMutation(before, null), {type: 'delete'});
  assert.deepEqual(planUserDirectoryMutation(null, null), {type: 'none'});
});
