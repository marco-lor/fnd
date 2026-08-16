const test = require('node:test');
const assert = require('node:assert/strict');
const { PERFORMANCE_MEASUREMENT_CONTRACT_VERSION } = require('./common');
const {
  TTFB_ABSOLUTE_JITTER_MS,
  aggregateReports,
  compareReports,
  relativeDifferencePercent,
} = require('./repeatability');

const scenario = (id, timing, delivered = 10, iteration = 1, extraMetrics = {}) => ({
  scenarioId: id,
  route: id === 'grigliata-five-peer' ? '/grigliata' : '/home',
  role: id === 'grigliata-five-peer' ? 'five-peer' : 'player',
  iteration,
  environment: { browserName: 'chromium', browserVersion: '123', projectName: 'chromium' },
  metrics: {
    'web-vital.LCP': timing,
    'web-vital.TTFB': 100,
    'runtime.maxLongTaskMs': 10,
    'runtime.consoleErrors': 0,
    'runtime.explainedFirestoreEmulatorStartupWarnings': 0,
    'runtime.unhandledErrors': 0,
    'runtime.failedRequests': 0,
    'runtime.synchronousNetworkCalls': 0,
    'runtime.resourceTimingBufferOverflows': 0,
    'runtime.activeResourcesAfterCleanup': 0,
    'runtime.activeTimeoutsAfterCleanup': 0,
    'runtime.activeMediaAfterCleanup': 0,
    'firestore.activeListenersAfterCleanup': 0,
    'firestore.documentsDelivered': delivered + 1,
    'firestore.routeDocumentsDelivered': delivered,
    'firestore.changedDocumentsDelivered': delivered,
    'resource.javascript.uniqueCount': 1,
    'resource.javascript.uniqueFingerprint': 'f'.repeat(64),
    'resource.javascript.uniqueGzipBytes': 100,
    ...extraMetrics,
  },
});

const repeatThree = (value) => (
  Array.isArray(value) ? value : [value, value, value]
);

const report = (id, timing, delivered = 10) => {
  const timings = repeatThree(timing);
  const deliveries = repeatThree(delivered);
  return {
    schemaVersion: 1,
    measurementContractVersion: PERFORMANCE_MEASUREMENT_CONTRACT_VERSION,
    commit: 'a'.repeat(40),
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
      scenarios: timings.map((value, index) => (
        scenario('home', value, deliveries[index], index + 1)
      )),
    },
    scenarioManifest: {
      schemaVersion: 1,
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      locale: 'en-US',
      timezoneId: 'Europe/Rome',
      scenarios: [{
        id: 'home', route: '/home', role: 'player', interaction: 'reversible-stat',
      }],
    },
    metrics: {
      'build:javascript.entry.gzipBytes': 50,
      'home:web-vital.LCP': timings[1],
      'home:runtime.consoleErrors': 0,
      'home:firestore.documentsDelivered': deliveries[1] + 1,
      'home:firestore.routeDocumentsDelivered': deliveries[1],
    },
  };
};

const setScenarioMetric = (currentReport, metric, value) => {
  const values = repeatThree(value);
  currentReport.browser.scenarios.forEach((entry, index) => {
    entry.metrics[metric] = values[index];
  });
};

const compare = (left, right, maximumVariancePercent = 15, canonical = left.scenarioManifest) => (
  compareReports(left, right, maximumVariancePercent, canonical)
);

test('relative timing variance is symmetric and bounded', () => {
  assert.equal(relativeDifferencePercent(100, 110), relativeDifferencePercent(110, 100));
  assert.ok(relativeDifferencePercent(100, 110) < 10);
});

test('tiny local TTFB jitter uses an explicit millisecond floor without relaxing LCP', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  setScenarioMetric(left, 'web-vital.TTFB', 6.8);
  setScenarioMetric(right, 'web-vital.TTFB', 8.7);

  const withinFloor = compare(left, right, 15);
  const ttfb = withinFloor.timing.find(({ key }) => key === 'home:web-vital.TTFB');
  assert.equal(withinFloor.status, 'pass');
  assert.equal(ttfb.absoluteToleranceMs, TTFB_ABSOLUTE_JITTER_MS);
  assert.ok(ttfb.variancePercent > 15);
  assert.equal(ttfb.gatedVariancePercent, 0);
  assert.equal(withinFloor.observedMaximumVariancePercent, ttfb.variancePercent);
  assert.equal(withinFloor.maximumGatedVariancePercent, 0);

  setScenarioMetric(left, 'web-vital.TTFB', 100);
  setScenarioMetric(right, 'web-vital.TTFB', 120);
  const outsideFloor = compare(left, right, 15);
  assert.equal(
    outsideFloor.timing.find(({ key }) => key === 'home:web-vital.TTFB').status,
    'fail'
  );
});

test('matching authoritative reports pass and aggregate all retained scenarios', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1100);
  const repeatability = compare(left, right, 15);
  assert.equal(repeatability.status, 'pass');
  assert.equal(
    repeatability.compatibility.find(({ id }) => id === 'scenario-cardinality:home').status,
    'pass'
  );
  const aggregate = aggregateReports(left, right, repeatability);
  assert.equal(aggregate.browser.scenarios.length, 6);
  assert.equal(aggregate.run.retainedIterations, 6);
  assert.equal(aggregate.metrics['home:web-vital.LCP'], 1100);
});

test('timing instability and raw deterministic drift fail repeatability', () => {
  const timingFailure = compare(report('run-a', 1000), report('run-b', 1300), 15);
  assert.equal(timingFailure.status, 'fail');
  assert.equal(timingFailure.timing.find(({ key }) => key === 'home:web-vital.LCP').status, 'fail');

  const deterministicFailure = compare(report('run-a', 1000, 10), report('run-b', 1000, 11), 15);
  const delivery = deterministicFailure.deterministic
    .find(({ key }) => key === 'home:firestore.routeDocumentsDelivered');
  assert.equal(deterministicFailure.status, 'fail');
  assert.equal(delivery.status, 'fail');
  assert.deepEqual(delivery.leftSamples, [10, 10, 10]);
  assert.deepEqual(delivery.rightSamples, [11, 11, 11]);
  assert.equal(
    deterministicFailure.deterministic.some(({ key }) => key === 'home:firestore.documentsDelivered'),
    false
  );
});

test('timing repeatability compares complete retained-sample medians', () => {
  const left = report('run-a', [100, 110, 1000]);
  const right = report('run-b', [105, 120, 900]);

  const result = compare(left, right, 15);
  const lcp = result.timing.find(({ key }) => key === 'home:web-vital.LCP');

  assert.equal(result.status, 'pass');
  assert.deepEqual(
    {
      left: lcp.left,
      right: lcp.right,
      leftSamples: lcp.leftSamples,
      rightSamples: lcp.rightSamples,
      status: lcp.status,
    },
    {
      left: 110,
      right: 120,
      leftSamples: [100, 110, 1000],
      rightSamples: [105, 120, 900],
      status: 'pass',
    }
  );
  assert.equal(result.timing.some(({ key }) => key.endsWith('.p95')), false);
});

test('advisory INP samples do not control the authoritative repeatability gate', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  setScenarioMetric(left, 'web-vital.INP', [50, 60, 70]);
  setScenarioMetric(right, 'web-vital.INP', [500, 600, 700]);
  delete right.browser.scenarios[1].metrics['web-vital.INP'];

  const result = compare(left, right, 15);

  assert.equal(result.status, 'pass');
  assert.equal(result.timing.some(({ key }) => key === 'home:web-vital.INP'), false);
});

test('missing timing samples fail instead of producing a partial median', () => {
  const left = report('run-a', [100, 110, 120]);
  const right = report('run-b', [100, 110, 120]);
  delete right.browser.scenarios[1].metrics['web-vital.LCP'];

  const result = compare(left, right, 15);
  const lcp = result.timing.find(({ key }) => key === 'home:web-vital.LCP');

  assert.equal(result.status, 'fail');
  assert.equal(lcp.status, 'fail');
  assert.equal(lcp.leftExpectedSamples, 3);
  assert.equal(lcp.rightExpectedSamples, 3);
  assert.deepEqual(lcp.rightSamples, [100, 120]);
});

test('an entirely absent timing side reports zero of the full scenario count', () => {
  const left = report('run-a', [100, 110, 120]);
  const right = report('run-b', [100, 110, 120]);
  right.browser.scenarios.forEach((entry) => {
    delete entry.metrics['web-vital.LCP'];
  });

  const result = compare(left, right, 15);
  const lcp = result.timing.find(({ key }) => key === 'home:web-vital.LCP');

  assert.equal(result.status, 'fail');
  assert.equal(lcp.status, 'fail');
  assert.equal(lcp.rightExpectedSamples, 3);
  assert.deepEqual(lcp.rightSamples, []);
});

test('duplicate or missing iteration numbers fail authoritative cardinality', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  right.browser.scenarios[2].iteration = 2;

  const result = compare(left, right, 15);
  const coverage = result.compatibility
    .find(({ id }) => id === 'scenario-cardinality:home');

  assert.equal(result.status, 'fail');
  assert.equal(coverage.status, 'fail');
  assert.deepEqual(coverage.right.actualIterations, [1, 2, 2]);
  assert.deepEqual(coverage.right.expectedIterations, [1, 2, 3]);
});

test('scheduled-only scenarios require exactly one iteration-one record', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  for (const current of [left, right]) {
    current.scenarioManifest.scenarios.push({
      id: 'grigliata-five-peer',
      route: '/grigliata',
      role: 'five-peer',
      interaction: 'placement-convergence',
      scheduledOnly: true,
    });
    current.browser.scenarios.push(scenario(
      'grigliata-five-peer',
      500,
      5,
      1,
      { 'runtime.peerConvergenceMs': 500 }
    ));
  }

  const passing = compare(left, right, 15);
  assert.equal(passing.status, 'pass');
  assert.equal(
    passing.compatibility
      .find(({ id }) => id === 'scenario-cardinality:grigliata-five-peer').status,
    'pass'
  );

  right.browser.scenarios.push(scenario(
    'grigliata-five-peer',
    500,
    5,
    2,
    { 'runtime.peerConvergenceMs': 500 }
  ));
  const failing = compare(left, right, 15);
  assert.equal(failing.status, 'fail');
});

test('scheduled auxiliary scenarios use their explicit metric contract and remain deterministic', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  const manifestScenario = {
    id: 'task07-registry-desktop',
    route: '/grigliata',
    role: 'dm',
    interaction: 'desktop-registry-budget',
    scheduledOnly: true,
    requiredMetrics: [
      'task07.registryRequestConcurrencyLimit',
      'task07.unpinnedRegistryRecords',
    ],
  };
  for (const current of [left, right]) {
    current.scenarioManifest.scenarios.push(manifestScenario);
    current.browser.scenarios.push({
      scenarioId: manifestScenario.id,
      route: manifestScenario.route,
      role: manifestScenario.role,
      iteration: 1,
      environment: {
        browserName: 'chromium',
        browserVersion: '123',
        projectName: 'chromium',
      },
      metrics: {
        'task07.registryRequestConcurrencyLimit': 4,
        'task07.unpinnedRegistryRecords': 72,
      },
    });
  }

  const passing = compare(left, right, 15);
  assert.equal(passing.status, 'pass');
  assert.equal(
    passing.compatibility
      .find(({ id }) => id === 'scenario-required-metrics:task07-registry-desktop').status,
    'pass'
  );

  right.browser.scenarios.at(-1).metrics['task07.unpinnedRegistryRecords'] = 71;
  const drift = compare(left, right, 15);
  assert.equal(drift.status, 'fail');
  assert.equal(
    drift.deterministic
      .find(({ key }) => key === 'task07-registry-desktop:task07.unpinnedRegistryRecords').status,
    'fail'
  );

  delete right.browser.scenarios.at(-1).metrics['task07.unpinnedRegistryRecords'];
  const missing = compare(left, right, 15);
  assert.equal(
    missing.compatibility
      .find(({ id }) => id === 'scenario-required-metrics:task07-registry-desktop').status,
    'fail'
  );
});

test('authoritative identities require distinct run IDs, matching browser IDs, and real commits', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);

  const sameRun = compare(left, left, 15);
  assert.equal(sameRun.status, 'fail');
  assert.equal(
    sameRun.compatibility.find(({ id }) => id === 'authoritative-identities').status,
    'fail'
  );

  right.browser.environment.runId = 'mismatched-browser-run';
  const mismatched = compare(left, right, 15);
  assert.equal(mismatched.status, 'fail');
  assert.equal(
    mismatched.compatibility.find(({ id }) => id === 'authoritative-identities').status,
    'fail'
  );
});

test('embedded manifests and records must match every canonical scenario field', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  const canonical = JSON.parse(JSON.stringify(left.scenarioManifest));
  for (const current of [left, right]) {
    current.scenarioManifest.scenarios[0].route = '/wrong-route';
    current.scenarioManifest.scenarios[0].role = 'webmaster';
    current.scenarioManifest.scenarios[0].interaction = 'wrong';
    current.browser.scenarios.forEach((entry) => {
      entry.route = '/wrong-route';
      entry.role = 'webmaster';
    });
  }

  const result = compare(left, right, 15, canonical);

  assert.equal(result.status, 'fail');
  assert.equal(
    result.compatibility.find(({ id }) => id === 'scenario-manifest').status,
    'fail'
  );
  assert.equal(
    result.compatibility.find(({ id }) => id === 'scenario-metadata:home').status,
    'fail'
  );
});

test('both runs must use the current measurement contract and contain every required metric', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  for (const current of [left, right]) {
    current.browser.scenarios.forEach((entry) => {
      delete entry.metrics['runtime.resourceTimingBufferOverflows'];
    });
  }

  const missingMetric = compare(left, right, 15);
  const coverage = missingMetric.compatibility
    .find(({ id }) => id === 'scenario-required-metrics:home');
  assert.equal(missingMetric.status, 'fail');
  assert.equal(coverage.status, 'fail');
  assert.equal(
    coverage.left.missing.every(({ metric }) => metric === 'runtime.resourceTimingBufferOverflows'),
    true
  );

  left.measurementContractVersion = 1;
  right.measurementContractVersion = 1;
  const staleContract = compare(left, right, 15);
  assert.equal(
    staleContract.compatibility.find(({ id }) => id === 'measurement-contract').status,
    'fail'
  );
});

test('authoritative coverage requires exactly three retained measurements', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  for (const current of [left, right]) {
    current.run.retainedIterations = 4;
    current.browser.environment.retainedIterations = 4;
    current.browser.scenarios.push(scenario('home', 1000, 10, 4));
  }

  const result = compare(left, right, 15);

  assert.equal(result.status, 'fail');
  assert.equal(
    result.compatibility.find(({ id }) => id === 'retained-iterations').status,
    'fail'
  );
  assert.equal(
    result.compatibility.find(({ id }) => id === 'scenario-cardinality:home').status,
    'pass'
  );
});

test('scenario records without a nonempty known identity are rejected', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  left.browser.scenarios.push({ iteration: 1, metrics: {} });

  const result = compare(left, right, 15);

  assert.equal(result.status, 'fail');
  assert.equal(
    result.compatibility.find(({ id }) => id === 'scenario-record-identities').status,
    'fail'
  );
});

test('non-authoritative reports cannot pass even when both flags match', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  left.run.authoritative = false;
  right.run.authoritative = false;
  left.browser.environment.authoritative = false;
  right.browser.environment.authoritative = false;

  const result = compare(left, right, 15);

  assert.equal(result.status, 'fail');
  assert.equal(
    result.compatibility.find(({ id }) => id === 'authoritative-flags').status,
    'fail'
  );
});

test('request and streaming counts are reported while canonical finite inventory is exact-gated', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  setScenarioMetric(left, 'resource.other.count', 8);
  setScenarioMetric(right, 'resource.other.count', 9);
  setScenarioMetric(left, 'resource.stream.count', 2);
  setScenarioMetric(right, 'resource.stream.count', 3);
  setScenarioMetric(left, 'resource.image.count', 4);
  setScenarioMetric(right, 'resource.image.count', 5);
  setScenarioMetric(left, 'resource.other.uniqueCount', 2);
  setScenarioMetric(right, 'resource.other.uniqueCount', 2);
  setScenarioMetric(left, 'resource.other.uniqueGzipBytes', 20);
  setScenarioMetric(right, 'resource.other.uniqueGzipBytes', 21);
  setScenarioMetric(left, 'resource.other.uniqueFingerprint', 'b'.repeat(64));
  setScenarioMetric(right, 'resource.other.uniqueFingerprint', 'b'.repeat(64));
  setScenarioMetric(left, 'resource.image.uniqueCount', 1);
  setScenarioMetric(right, 'resource.image.uniqueCount', 1);
  setScenarioMetric(left, 'resource.image.uniqueGzipBytes', 100);
  setScenarioMetric(right, 'resource.image.uniqueGzipBytes', 100);
  setScenarioMetric(left, 'resource.image.uniqueFingerprint', 'c'.repeat(64));
  setScenarioMetric(right, 'resource.image.uniqueFingerprint', 'c'.repeat(64));

  const result = compare(left, right, 15);

  assert.equal(result.status, 'pass');
  for (const ignoredKey of [
    'home:resource.other.count',
    'home:resource.stream.count',
    'home:resource.image.count',
    'home:resource.other.uniqueGzipBytes',
  ]) {
    assert.equal(result.deterministic.some(({ key }) => key === ignoredKey), false);
  }
  assert.equal(
    result.deterministic.find(({ key }) => key === 'home:resource.other.uniqueCount').status,
    'pass'
  );
  assert.equal(
    result.deterministic.find(({ key }) => key === 'home:resource.other.uniqueFingerprint').status,
    'pass'
  );

  setScenarioMetric(right, 'resource.other.uniqueFingerprint', 'd'.repeat(64));
  const changedInventory = compare(left, right, 15);
  assert.equal(changedInventory.status, 'fail');
  assert.equal(
    changedInventory.deterministic
      .find(({ key }) => key === 'home:resource.other.uniqueFingerprint').status,
    'fail'
  );
});

test('deterministic metric types fail closed', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  setScenarioMetric(left, 'runtime.consoleErrors', '0');
  setScenarioMetric(right, 'runtime.consoleErrors', '0');

  const result = compare(left, right, 15);
  const errors = result.deterministic
    .find(({ key }) => key === 'home:runtime.consoleErrors');

  assert.equal(result.status, 'fail');
  assert.equal(errors.status, 'fail');
  assert.equal(errors.complete, false);
  assert.equal(errors.leftExpectedSamples, 3);
  assert.deepEqual(errors.leftSamples, []);

  const fingerprintLeft = report('run-c', 1000);
  const fingerprintRight = report('run-d', 1000);
  setScenarioMetric(fingerprintLeft, 'resource.image.uniqueFingerprint', 0);
  setScenarioMetric(fingerprintRight, 'resource.image.uniqueFingerprint', 0);
  const fingerprintResult = compare(fingerprintLeft, fingerprintRight, 15);
  const fingerprint = fingerprintResult.deterministic
    .find(({ key }) => key === 'home:resource.image.uniqueFingerprint');
  assert.equal(fingerprintResult.status, 'fail');
  assert.equal(fingerprint.complete, false);
  assert.deepEqual(fingerprint.leftSamples, []);
});

test('explained Firestore startup warning drift fails repeatability', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  const metricKey = 'runtime.explainedFirestoreEmulatorStartupWarnings';
  setScenarioMetric(left, metricKey, 1);
  setScenarioMetric(right, metricKey, 0);

  const result = compare(left, right, 15);
  const fullMetricKey = `home:${metricKey}`;

  assert.equal(result.status, 'fail');
  assert.equal(
    result.deterministic.find(({ key }) => key === fullMetricKey).status,
    'fail'
  );
});

test('Task 07 media cap drift fails deterministic repeatability', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  setScenarioMetric(left, 'task07.audioNodes', 0);
  setScenarioMetric(right, 'task07.audioNodes', 1);

  const result = compare(left, right, 15);
  const metric = result.deterministic
    .find(({ key }) => key === 'home:task07.audioNodes');
  assert.equal(result.status, 'fail');
  assert.equal(metric.status, 'fail');
});

test('different commits, browsers, or build assets cannot be compared', () => {
  const left = report('run-a', 1000);
  const right = report('run-b', 1000);
  right.commit = 'different';
  right.browser.environment.browsers[0].browserVersion = '124';
  right.build.assets[0].sha256 = 'different-asset';
  const result = compare(left, right, 15);
  assert.equal(result.status, 'fail');
  assert.equal(result.compatibility.find(({ id }) => id === 'commit').status, 'fail');
  assert.equal(result.compatibility.find(({ id }) => id === 'browser').status, 'fail');
  assert.equal(result.compatibility.find(({ id }) => id === 'build-assets').status, 'fail');
});
