const {test} = require('node:test');
const assert = require('node:assert/strict');
const {foeOrderSeconds} = require('../lib/foeOrder');
test('foe order preserves legacy seconds fallback rather than camel-case dates or nanoseconds', () => {
  assert.equal(foeOrderSeconds({}), 0);
  assert.equal(foeOrderSeconds({createdAt: '2026-01-01'}), 0);
  assert.equal(foeOrderSeconds({updated_at: {seconds: 0}, created_at: {seconds: 12}}), 12);
  assert.equal(foeOrderSeconds({updated_at: {seconds: 7, nanoseconds: 99}, created_at: {seconds: 12}}), 7);
});
