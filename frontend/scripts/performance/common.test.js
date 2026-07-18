const test = require('node:test');
const assert = require('node:assert/strict');
const { assertDemoProject, assertSchemaVersion, median, percentile } = require('./common');

test('demo-project safety guard rejects live-looking projects', () => {
  assert.equal(assertDemoProject('demo-fnd-perf'), 'demo-fnd-perf');
  assert.throws(() => assertDemoProject('fatins'), /refuse non-demo/i);
});

test('median and percentile use deterministic nearest-rank ordering', () => {
  assert.equal(median([7, 1, 3, 5]), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5);
  assert.equal(percentile([], 0.95), null);
});

test('versioned performance contracts reject unsupported schemas', () => {
  assert.equal(assertSchemaVersion({ schemaVersion: 1 }).schemaVersion, 1);
  assert.throws(() => assertSchemaVersion({ schemaVersion: 2 }, 'fixture'), /unsupported schemaVersion 2/i);
  assert.throws(() => assertSchemaVersion({}, 'fixture'), /schemaVersion missing/i);
});
