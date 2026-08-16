const assert = require('node:assert/strict');
const test = require('node:test');

const { assertBaselineReferenceMachine } = require('./baseline-source');

test('baseline acceptance rejects hosted, unknown, and missing reference machines', () => {
  for (const referenceMachine of ['github-hosted-runner', 'unknown', '', '   ', undefined]) {
    assert.throws(
      () => assertBaselineReferenceMachine({ environment: { referenceMachine } }),
      /controlled reference machine/i
    );
  }
});

test('baseline acceptance allows a named controlled reference machine', () => {
  assert.equal(
    assertBaselineReferenceMachine({ environment: { referenceMachine: 'local-reference' } }),
    'local-reference'
  );
  assert.equal(
    assertBaselineReferenceMachine({ environment: { referenceMachine: 'fnd-perf-lab-01' } }),
    'fnd-perf-lab-01'
  );
});
