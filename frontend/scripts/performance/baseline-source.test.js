const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertBaselineReferenceMachine,
  assertBaselineRepeatability,
} = require('./baseline-source');

const passingRepeatability = () => ({
  status: 'pass',
  evidenceStatus: 'pass',
  timingStatus: 'pass',
  gateMode: 'strict',
  gateStatus: 'pass',
  maximumVariancePercent: 15,
});

const aggregateFor = (repeatability) => ({
  repeatability: { ...repeatability },
});

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

test('baseline acceptance requires matching strict passing repeatability evidence', () => {
  const repeatability = passingRepeatability();
  assert.equal(
    assertBaselineRepeatability(repeatability, aggregateFor(repeatability)),
    repeatability
  );

  for (const [field, value] of [
    ['status', 'fail'],
    ['evidenceStatus', 'fail'],
    ['timingStatus', 'fail'],
    ['gateMode', 'hosted-timing-advisory'],
    ['gateStatus', 'fail'],
  ]) {
    const candidate = { ...repeatability, [field]: value };
    assert.throws(
      () => assertBaselineRepeatability(candidate, aggregateFor(candidate)),
      /strict passing repeatability evidence/i
    );
  }
});

test('baseline acceptance rejects custom thresholds and aggregate disagreement', () => {
  const repeatability = passingRepeatability();
  const customThreshold = { ...repeatability, maximumVariancePercent: 100 };
  assert.throws(
    () => assertBaselineRepeatability(customThreshold, aggregateFor(customThreshold)),
    /15% timing variance contract/i
  );

  for (const field of [
    'status',
    'evidenceStatus',
    'timingStatus',
    'gateMode',
    'gateStatus',
    'maximumVariancePercent',
  ]) {
    const aggregate = aggregateFor(repeatability);
    aggregate.repeatability[field] = field === 'maximumVariancePercent' ? 14 : 'mismatch';
    assert.throws(
      () => assertBaselineRepeatability(repeatability, aggregate),
      /disagrees with the authoritative aggregate/i
    );
  }
});
