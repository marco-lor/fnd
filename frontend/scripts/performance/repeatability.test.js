const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateReports, compareReports, relativeDifferencePercent } = require('./repeatability');

const scenario = (id, timing, delivered = 10) => ({
  scenarioId: id,
  environment: { browserName: 'chromium', browserVersion: '123', projectName: 'chromium' },
  metrics: {
    'web-vital.LCP': timing,
    'runtime.consoleErrors': 0,
    'runtime.unhandledErrors': 0,
    'runtime.failedRequests': 0,
    'runtime.activeResourcesAfterCleanup': 0,
    'firestore.documentsDelivered': delivered,
  },
});

const report = (id, timing, delivered = 10) => ({
  schemaVersion: 1,
  commit: 'abc123',
  projectId: 'demo-fnd-perf',
  run: { id, authoritative: true, retainedIterations: 3 },
  environment: {
    platform: 'win32', architecture: 'x64', node: '22.0.0', referenceMachine: 'test-machine',
    cpuModel: 'test-cpu', cpuCount: 8,
  },
  fixture: { hash: 'fixture-hash' },
  fixtureManifest: { version: 'fixture-v1' },
  build: {
    assets: [{
      path: 'static/js/main.js', category: 'javascript', classification: 'entry',
      rawBytes: 100, gzipBytes: 50, brotliBytes: 40, sha256: 'asset-hash',
    }],
  },
  browser: {
    environment: {
      runId: id,
      authoritative: true,
      retainedIterations: 3,
      browsers: [{ browserName: 'chromium', browserVersion: '123', projectName: 'chromium' }],
    },
    scenarios: [scenario('home', timing, delivered)],
  },
  metrics: {
    'build:javascript.entry.gzipBytes': 50,
    'home:web-vital.LCP': timing,
    'home:runtime.consoleErrors': 0,
    'home:firestore.documentsDelivered': delivered,
  },
});

test('relative timing variance is symmetric and bounded', () => {
  assert.equal(relativeDifferencePercent(100, 110), relativeDifferencePercent(110, 100));
  assert.ok(relativeDifferencePercent(100, 110) < 10);
});

test('matching authoritative reports pass and aggregate retained scenarios', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1100);
  const repeatability = compareReports(left, right, 15);
  assert.equal(repeatability.status, 'pass');
  const aggregate = aggregateReports(left, right, repeatability);
  assert.equal(aggregate.browser.scenarios.length, 2);
  assert.equal(aggregate.run.retainedIterations, 6);
  assert.equal(aggregate.metrics['home:web-vital.LCP'], 1100);
});

test('timing instability and deterministic drift fail repeatability', () => {
  const timingFailure = compareReports(report('run-a', 1000), report('run-b', 1300), 15);
  assert.equal(timingFailure.status, 'fail');
  assert.equal(timingFailure.timing.find(({ key }) => key === 'home:web-vital.LCP').status, 'fail');

  const deterministicFailure = compareReports(report('run-a', 1000, 10), report('run-b', 1000, 11), 15);
  assert.equal(deterministicFailure.status, 'fail');
  assert.equal(
    deterministicFailure.deterministic.find(({ key }) => key === 'home:firestore.documentsDelivered').status,
    'fail'
  );
});

test('explained Firestore startup warning drift fails repeatability', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  const metricKey = 'home:runtime.explainedFirestoreEmulatorStartupWarnings';
  left.metrics[metricKey] = 1;
  right.metrics[metricKey] = 0;

  const result = compareReports(left, right, 15);

  assert.equal(result.status, 'fail');
  assert.deepEqual(
    result.deterministic.find(({ key }) => key === metricKey),
    { key: metricKey, left: 1, right: 0, status: 'fail' }
  );
});

test('different commits, browsers, or build assets cannot be compared', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  right.commit = 'different';
  right.browser.environment.browsers[0].browserVersion = '124';
  right.build.assets[0].sha256 = 'different-asset';
  const result = compareReports(left, right, 15);
  assert.equal(result.status, 'fail');
  assert.equal(result.compatibility.find(({ id }) => id === 'commit').status, 'fail');
  assert.equal(result.compatibility.find(({ id }) => id === 'browser').status, 'fail');
  assert.equal(result.compatibility.find(({ id }) => id === 'build-assets').status, 'fail');
});
