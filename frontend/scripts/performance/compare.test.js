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
    build: {
      sourceMapsPresent: false,
      instrumentationMarkerPresent: true,
      requiredChunks: { routes: ['route-login'], features: ['feature-editor'] },
      chunkInventory: [{ logicalName: 'route-login' }],
      webpackModuleEvidence: { moduleCount: 10, loginModuleViolations: [] },
    },
    normalBuildVerification: { instrumentationAbsent: false },
  });
  assert.equal(evaluations.find((gate) => gate.id === 'scenario-completeness').status, 'fail');
  assert.equal(evaluations.find((gate) => gate.id === 'normal-build-instrumentation-absent').status, 'fail');
  assert.deepEqual(
    evaluations.find((gate) => gate.id === 'route-feature-chunk-inventory').missing,
    ['feature-editor']
  );
});

test('structural gates require and reject every explained emulator startup warning', () => {
  const metricSet = (explainedStartupWarnings) => ({
    'runtime.consoleErrors': 0,
    'runtime.explainedFirestoreEmulatorStartupWarnings': explainedStartupWarnings,
    'runtime.unhandledErrors': 0,
    'runtime.failedRequests': 0,
    'firestore.activeListenersAfterCleanup': 0,
    'runtime.activeResourcesAfterCleanup': 0,
    'runtime.activeTimeoutsAfterCleanup': 0,
    'runtime.activeMediaAfterCleanup': 0,
  });
  const current = {
    scenarioManifest: { scenarios: [{ id: 'home' }, { id: 'grigliata-five-peer' }] },
    browser: {
      environment: {
        authSetupDiagnostics: {
          status: 'passed',
          expectedAccountCount: 8,
          completedAccountCount: 8,
          metrics: {
            consoleErrors: 0,
            explainedFirestoreEmulatorStartupWarnings: 0,
            unhandledErrors: 0,
            failedRequests: 0,
            cleanupErrors: 0,
          },
        },
      },
      scenarios: [
        { scenarioId: 'home', metrics: metricSet(0) },
        { scenarioId: 'grigliata-five-peer', metrics: metricSet(0) },
      ],
    },
    metrics: {
      ...Object.fromEntries(Object.entries(metricSet(0)).map(([key, value]) => [`home:${key}`, value])),
      ...Object.fromEntries(Object.entries(metricSet(0)).map(([key, value]) => [`grigliata-five-peer:${key}`, value])),
    },
    fixture: { hash: 'abc', projectId: 'demo-fnd-perf', documentCount: 1, counts: { users: 1 } },
    fixtureManifest: { canonicalHash: 'abc', documentCount: 1, counts: { users: 1 } },
    build: {
      sourceMapsPresent: false,
      instrumentationMarkerPresent: true,
      requiredChunks: { routes: ['route-home'], features: [] },
      chunkInventory: [{ logicalName: 'route-home' }],
      webpackModuleEvidence: { moduleCount: 1, loginModuleViolations: [] },
    },
    normalBuildVerification: { instrumentationAbsent: true },
  };

  let gate = evaluateStructuralGates(current)
    .find((evaluation) => evaluation.id === 'emulator-startup-warning-free');
  assert.equal(gate.status, 'pass');
  assert.equal(gate.actual, 0);

  current.browser.scenarios[1].metrics['runtime.explainedFirestoreEmulatorStartupWarnings'] = 1;
  gate = evaluateStructuralGates(current)
    .find((evaluation) => evaluation.id === 'emulator-startup-warning-free');
  assert.equal(gate.status, 'fail');
  assert.equal(gate.actual, 1);

  delete current.browser.scenarios[1].metrics['runtime.explainedFirestoreEmulatorStartupWarnings'];
  gate = evaluateStructuralGates(current)
    .find((evaluation) => evaluation.id === 'emulator-startup-warning-free');
  assert.equal(gate.status, 'fail');
  assert.equal(gate.complete, false);

  let authGate = evaluateStructuralGates(current)
    .find((evaluation) => evaluation.id === 'auth-setup-diagnostics');
  assert.equal(authGate.status, 'pass');
  current.browser.environment.authSetupDiagnostics.metrics.failedRequests = 1;
  authGate = evaluateStructuralGates(current)
    .find((evaluation) => evaluation.id === 'auth-setup-diagnostics');
  assert.equal(authGate.status, 'fail');
});
