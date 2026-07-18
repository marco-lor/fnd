const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateBudget, evaluateStructuralGates, worstBudgetEvaluation } = require('./compare');

test('relative budget uses the larger percentage or byte tolerance', () => {
  const budget = {
    scenario: 'build', metric: 'javascript.entry.gzipBytes', comparison: 'relative-to-baseline',
    tolerance: { percent: 10, absoluteBytes: 30 * 1024 },
  };
  const baseline = { metrics: { 'build:javascript.entry.gzipBytes': 100_000 } };
  const pass = evaluateBudget(budget, { metrics: { 'build:javascript.entry.gzipBytes': 130_000 } }, baseline);
  const fail = evaluateBudget(budget, { metrics: { 'build:javascript.entry.gzipBytes': 131_000 } }, baseline);
  assert.equal(pass.status, 'pass');
  assert.equal(fail.status, 'fail');
});

test('scorecards select the worst failing scenario rather than the first value', () => {
  const worst = worstBudgetEvaluation([
    { key: 'home:web-vital.LCP', actual: 2400, allowed: 2500, status: 'pass' },
    { key: 'codex:web-vital.LCP', actual: 3700, allowed: 2500, status: 'fail' },
    { key: 'admin:web-vital.LCP', actual: 2800, allowed: 2500, status: 'fail' },
  ]);
  assert.equal(worst.key, 'codex:web-vital.LCP');
});

test('a synthetic listener leak fails its blocking zero budget', () => {
  const result = evaluateBudget({
    scenario: 'all',
    metric: 'firestore.activeListenersAfterCleanup',
    comparison: 'absolute',
    maximum: 0,
    severity: 'blocking',
  }, {
    metrics: {
      'home:firestore.activeListenersAfterCleanup': 0,
      'codex:firestore.activeListenersAfterCleanup': 1,
    },
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.evaluations.find(({ key }) => key.startsWith('codex:')).status, 'fail');
});

test('structural gates reject missing scenarios and enabled normal builds', () => {
  const evaluations = evaluateStructuralGates({
    scenarioManifest: { scenarios: [{ id: 'login-cold' }, { id: 'home' }] },
    browser: { scenarios: [{ scenarioId: 'login-cold' }] },
    fixture: { hash: 'abc', projectId: 'demo-fnd-perf', documentCount: 1 },
    build: { sourceMapsPresent: false, instrumentationMarkerPresent: true },
    normalBuildVerification: { instrumentationAbsent: false },
  });
  assert.equal(evaluations.find((gate) => gate.id === 'scenario-completeness').status, 'fail');
  assert.equal(evaluations.find((gate) => gate.id === 'normal-build-instrumentation-absent').status, 'fail');
});
