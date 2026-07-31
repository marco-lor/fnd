const test = require('node:test');
const assert = require('node:assert/strict');
const { assertAuthoritativeCommit, snapshotAuthoritativeRun } = require('./snapshot-authoritative');

test('authoritative commit validation rejects missing and synthetic identities', () => {
  assert.doesNotThrow(() => assertAuthoritativeCommit('a'.repeat(40)));
  assert.throws(() => assertAuthoritativeCommit('unknown'), /require a real Git HEAD/);
  assert.throws(() => assertAuthoritativeCommit('a'.repeat(39)), /require a real Git HEAD/);
});

test('direct authoritative snapshots enforce cleanliness before collecting reports', () => {
  const dirtyError = new Error('dirty worktree');
  let collected = false;
  assert.throws(() => snapshotAuthoritativeRun('direct-snapshot', {
    assertClean: () => { throw dirtyError; },
    collectReport: () => {
      collected = true;
      return {};
    },
  }), (error) => error === dirtyError);
  assert.equal(collected, false);
});
