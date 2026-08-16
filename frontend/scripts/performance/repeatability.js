#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  assertSchemaVersion,
  median,
  PERFORMANCE_MEASUREMENT_CONTRACT_VERSION,
  readJson,
  resultsDir,
  scenariosPath,
  sha256,
  writeJson,
} = require('./common');
const { buildMetricMap } = require('./report');

const DEFAULT_MAX_VARIANCE_PERCENT = 15;
const TTFB_ABSOLUTE_JITTER_MS = 5;

const argumentValue = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
};

const stableJson = (value) => JSON.stringify(stableValue(value));

const relativeDifferencePercent = (left, right) => {
  const denominator = Math.max(Math.abs(left), Math.abs(right), 1);
  return (Math.abs(left - right) / denominator) * 100;
};

// INP and CLS remain advisory Task 22 budget signals; browser APIs can omit them for short interactions.
// Task 06 repeatability gates only timing series that every retained scenario deterministically emits.
const isTimingMetric = (key) => (
  /:web-vital\.(LCP|TTFB)$/.test(key)
  || /:runtime\.(maxLongTaskMs|peerConvergenceMs)$/.test(key)
  || /:microbenchmark\..*\.(median|p95)$/.test(key)
);

const isResourceFingerprintMetric = (key) => (
  /:resource\.(javascript|css|image|font|other)\.uniqueFingerprint$/.test(key)
);

const isValidScenarioMetricValue = (key, value) => {
  if (isResourceFingerprintMetric(key)) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
  }
  return Number.isFinite(value);
};

const isDeterministicMetric = (key) => (
  /:runtime\.(consoleErrors|unhandledErrors|failedRequests|synchronousNetworkCalls|resourceTimingBufferOverflows|explainedFirestoreEmulatorStartupWarnings|activeListenersAfterCleanup|activeResourcesAfterCleanup|activeTimeoutsAfterCleanup|activeMediaAfterCleanup)$/.test(key)
  || (/:firestore\./.test(key) && !/:firestore\.documentsDelivered$/.test(key))
  || /:resource\.(javascript|css|image|font)\.(uniqueCount|uniqueGzipBytes|uniqueFingerprint)$/.test(key)
  || /:resource\.other\.(uniqueCount|uniqueFingerprint)$/.test(key)
  || /:task07\.(attachedImages|audioNodes|farOffscreenAttachedImages|managedImages|musicStreamListeners|reducedMotionMeteors|uniqueFixtureImageRequests)$/.test(key)
  || /:task07\.(registryRequestConcurrencyLimit|unpinnedRegistryRecords|unpinnedEstimatedDecodedBytes|totalEstimatedDecodedBytes|lowPriorityQueuedPreloads)$/.test(key)
  || key.startsWith('build:')
);

const absoluteJitterToleranceMs = (key) => (
  /:web-vital\.TTFB$/.test(key) ? TTFB_ABSOLUTE_JITTER_MS : 0
);

const buildFingerprint = (report) => (report.build?.assets || [])
  .map((asset) => ({
    path: asset.path,
    category: asset.category,
    classification: asset.classification,
    rawBytes: asset.rawBytes,
    gzipBytes: asset.gzipBytes,
    brotliBytes: asset.brotliBytes,
    sha256: asset.sha256,
  }))
  .sort((left, right) => left.path.localeCompare(right.path));

const browserFingerprint = (report) => (report.browser?.environment?.browsers || [])
  .map(({ browserName, browserVersion, projectName }) => ({ browserName, browserVersion, projectName }))
  .sort((left, right) => `${left.browserName}:${left.browserVersion}`.localeCompare(`${right.browserName}:${right.browserVersion}`));

const scenarioManifestFingerprint = (report) => {
  const manifest = report.scenarioManifest || {};
  return {
    ...manifest,
    scenarios: (manifest.scenarios || [])
      .map((scenario) => ({ ...scenario, scheduledOnly: scenario.scheduledOnly === true })),
  };
};

const retainedIterationDetails = (report) => {
  const run = Number(report.run?.retainedIterations);
  const browser = Number(report.browser?.environment?.retainedIterations);
  return {
    run,
    browser,
    valid: run === 3 && browser === 3,
  };
};

const scenarioCoverageDetails = (report, manifestScenario) => {
  if (!manifestScenario) {
    return {
      expected: null,
      actual: 0,
      expectedIterations: [],
      actualIterations: [],
      valid: false,
    };
  }
  const retainedIterations = Number(report.browser?.environment?.retainedIterations);
  const expected = manifestScenario.scheduledOnly === true ? 1 : retainedIterations;
  const records = (report.browser?.scenarios || [])
    .filter((entry) => (entry.scenarioId || entry.id) === manifestScenario.id);
  const actualIterations = records
    .map(({ iteration }) => Number(iteration))
    .sort((left, right) => left - right);
  const expectedIterations = Number.isInteger(expected) && expected > 0
    ? Array.from({ length: expected }, (_value, index) => index + 1)
    : [];
  return {
    expected,
    actual: records.length,
    expectedIterations,
    actualIterations,
    valid: records.length === expected
      && stableJson(actualIterations) === stableJson(expectedIterations),
  };
};

const COMMON_REQUIRED_SCENARIO_METRICS = [
  'runtime.consoleErrors',
  'runtime.unhandledErrors',
  'runtime.failedRequests',
  'firestore.activeListenersAfterCleanup',
  'runtime.activeResourcesAfterCleanup',
  'runtime.activeTimeoutsAfterCleanup',
  'runtime.activeMediaAfterCleanup',
];

const ROUTE_REQUIRED_SCENARIO_METRICS = [
  ...COMMON_REQUIRED_SCENARIO_METRICS,
  'runtime.synchronousNetworkCalls',
  'runtime.resourceTimingBufferOverflows',
  'firestore.routeDocumentsDelivered',
  'resource.javascript.uniqueCount',
  'resource.javascript.uniqueFingerprint',
  'resource.javascript.uniqueGzipBytes',
  'web-vital.LCP',
  'web-vital.TTFB',
  'runtime.maxLongTaskMs',
];

const SCHEDULED_REQUIRED_SCENARIO_METRICS = [
  ...COMMON_REQUIRED_SCENARIO_METRICS,
  'runtime.explainedFirestoreEmulatorStartupWarnings',
  'firestore.changedDocumentsDelivered',
  'runtime.peerConvergenceMs',
];

const scenarioMetadataDetails = (report, manifestScenario) => {
  if (!manifestScenario) return { expected: null, mismatches: [], valid: false };
  const expected = { route: manifestScenario.route, role: manifestScenario.role };
  const records = (report.browser?.scenarios || [])
    .filter((entry) => (entry.scenarioId || entry.id) === manifestScenario.id);
  const mismatches = records
    .filter((entry) => entry.route !== expected.route || entry.role !== expected.role)
    .map((entry) => ({
      iteration: entry.iteration ?? null,
      route: entry.route ?? null,
      role: entry.role ?? null,
    }));
  return { expected, mismatches, valid: records.length > 0 && mismatches.length === 0 };
};

const scenarioMetricCoverageDetails = (report, manifestScenario) => {
  if (!manifestScenario) return { required: [], missing: [], valid: false };
  const required = Array.isArray(manifestScenario.requiredMetrics)
    ? manifestScenario.requiredMetrics
    : (
      manifestScenario.scheduledOnly === true
        ? SCHEDULED_REQUIRED_SCENARIO_METRICS
        : ROUTE_REQUIRED_SCENARIO_METRICS
    );
  const records = (report.browser?.scenarios || [])
    .filter((entry) => (entry.scenarioId || entry.id) === manifestScenario.id);
  const missing = [];
  for (const record of records) {
    for (const metricName of required) {
      const key = `${manifestScenario.id}:${metricName}`;
      if (!isValidScenarioMetricValue(key, record.metrics?.[metricName])) {
        missing.push({ iteration: record.iteration ?? null, metric: metricName });
      }
    }
  }
  return { required, missing, valid: records.length > 0 && missing.length === 0 };
};

const collectScenarioMetricSamples = (report, predicate) => {
  const recordsByScenario = new Map();
  for (const scenario of report.browser?.scenarios || []) {
    const scenarioId = scenario.scenarioId || scenario.id;
    if (!scenarioId) continue;
    if (!recordsByScenario.has(scenarioId)) recordsByScenario.set(scenarioId, []);
    recordsByScenario.get(scenarioId).push(scenario);
  }

  const metrics = {};
  const recordCounts = {};
  for (const [scenarioId, scenarios] of recordsByScenario) {
    const orderedScenarios = [...scenarios]
      .sort((left, right) => Number(left.iteration) - Number(right.iteration));
    recordCounts[scenarioId] = orderedScenarios.length;
    const metricNames = [...new Set(orderedScenarios.flatMap(
      (scenario) => Object.keys(scenario.metrics || {})
    ))].sort();
    for (const metricName of metricNames) {
      const key = `${scenarioId}:${metricName}`;
      if (!predicate(key)) continue;
      const samples = orderedScenarios
        .filter((scenario) => isValidScenarioMetricValue(key, scenario.metrics?.[metricName]))
        .map((scenario) => ({
          iteration: Number(scenario.iteration),
          value: scenario.metrics[metricName],
        }));
      const iterations = samples.map(({ iteration }) => iteration);
      const expectedIterations = orderedScenarios.map(({ iteration }) => Number(iteration));
      metrics[key] = {
        values: samples.map(({ value }) => value),
        iterations,
        expectedSamples: orderedScenarios.length,
        complete: samples.length === orderedScenarios.length
          && stableJson(iterations) === stableJson(expectedIterations),
      };
    }
  }
  return { metrics, recordCounts };
};

const buildTimingMedianMetricMap = (report) => {
  const { metrics } = collectScenarioMetricSamples(report, isTimingMetric);
  return Object.fromEntries(Object.entries(metrics).map(([key, samples]) => [
    key,
    samples.complete ? median(samples.values) : null,
  ]));
};

const buildSampleComparison = (
  key,
  leftSamples,
  rightSamples,
  leftRecordCount = 0,
  rightRecordCount = 0
) => ({
  key,
  leftSamples: leftSamples?.values || [],
  rightSamples: rightSamples?.values || [],
  leftIterations: leftSamples?.iterations || [],
  rightIterations: rightSamples?.iterations || [],
  leftExpectedSamples: leftSamples?.expectedSamples ?? leftRecordCount,
  rightExpectedSamples: rightSamples?.expectedSamples ?? rightRecordCount,
  complete: leftSamples?.complete === true && rightSamples?.complete === true,
});

const aggregateReports = (left, right, repeatability) => {
  const aggregate = {
    ...right,
    generatedAt: new Date().toISOString(),
    run: {
      id: `${left.run?.id || 'run-a'}+${right.run?.id || 'run-b'}`,
      authoritative: true,
      sourceRunIds: [left.run?.id, right.run?.id],
      retainedIterations: Number(left.run?.retainedIterations || 0)
        + Number(right.run?.retainedIterations || 0),
    },
    browser: {
      ...right.browser,
      environment: {
        ...right.browser?.environment,
        runIds: [left.browser?.environment?.runId, right.browser?.environment?.runId],
        retainedIterations: Number(left.browser?.environment?.retainedIterations || 0)
          + Number(right.browser?.environment?.retainedIterations || 0),
      },
      scenarios: [
        ...(left.browser?.scenarios || []),
        ...(right.browser?.scenarios || []),
      ],
    },
    repeatability: {
      status: repeatability.status,
      maximumVariancePercent: repeatability.maximumVariancePercent,
      observedMaximumVariancePercent: repeatability.observedMaximumVariancePercent,
      maximumGatedVariancePercent: repeatability.maximumGatedVariancePercent,
      runIds: repeatability.runIds,
    },
  };
  aggregate.metrics = buildMetricMap({ buildReport: aggregate.build, browserReport: aggregate.browser });
  return aggregate;
};

const compareReports = (
  left,
  right,
  maximumVariancePercent = DEFAULT_MAX_VARIANCE_PERCENT,
  canonicalScenarioManifest = readJson(scenariosPath)
) => {
  const compatibility = [];
  const compareExact = (id, leftValue, rightValue) => compatibility.push({
    id,
    status: stableJson(leftValue) === stableJson(rightValue) ? 'pass' : 'fail',
    left: leftValue,
    right: rightValue,
  });
  compareExact('schema-version', left.schemaVersion, right.schemaVersion);
  compatibility.push({
    id: 'measurement-contract',
    status: left.measurementContractVersion === PERFORMANCE_MEASUREMENT_CONTRACT_VERSION
      && right.measurementContractVersion === PERFORMANCE_MEASUREMENT_CONTRACT_VERSION
      ? 'pass' : 'fail',
    left: left.measurementContractVersion ?? null,
    right: right.measurementContractVersion ?? null,
    expected: PERFORMANCE_MEASUREMENT_CONTRACT_VERSION,
  });
  compareExact('commit', left.commit, right.commit);
  compareExact('project', left.projectId, right.projectId);
  compareExact('fixture-hash', left.fixture?.hash, right.fixture?.hash);
  compareExact('fixture-version', left.fixtureManifest?.version, right.fixtureManifest?.version);
  for (const field of ['platform', 'architecture', 'node', 'referenceMachine', 'cpuModel', 'cpuCount']) {
    compareExact(`environment-${field}`, left.environment?.[field], right.environment?.[field]);
  }
  compareExact('browser', browserFingerprint(left), browserFingerprint(right));
  compareExact('build-assets', buildFingerprint(left), buildFingerprint(right));
  const identityDetails = (report) => {
    const runId = report.run?.id;
    const browserRunId = report.browser?.environment?.runId;
    const commit = report.commit;
    return {
      runId: runId || null,
      browserRunId: browserRunId || null,
      commit: commit || null,
      valid: typeof runId === 'string'
        && /^[a-zA-Z0-9._-]+$/.test(runId)
        && runId === browserRunId
        && /^[0-9a-f]{40}$/i.test(String(commit || '')),
    };
  };
  const leftIdentity = identityDetails(left);
  const rightIdentity = identityDetails(right);
  compatibility.push({
    id: 'authoritative-identities',
    status: leftIdentity.valid && rightIdentity.valid
      && leftIdentity.runId !== rightIdentity.runId ? 'pass' : 'fail',
    left: leftIdentity,
    right: rightIdentity,
  });

  const authoritativeState = (report) => ({
    run: report.run?.authoritative === true,
    browser: report.browser?.environment?.authoritative === true,
  });
  const leftAuthoritative = authoritativeState(left);
  const rightAuthoritative = authoritativeState(right);
  compatibility.push({
    id: 'authoritative-flags',
    status: Object.values(leftAuthoritative).every(Boolean)
      && Object.values(rightAuthoritative).every(Boolean) ? 'pass' : 'fail',
    left: leftAuthoritative,
    right: rightAuthoritative,
  });

  const leftRetained = retainedIterationDetails(left);
  const rightRetained = retainedIterationDetails(right);
  compatibility.push({
    id: 'retained-iterations',
    status: leftRetained.valid && rightRetained.valid
      && leftRetained.run === rightRetained.run ? 'pass' : 'fail',
    left: leftRetained,
    right: rightRetained,
  });

  const leftManifest = scenarioManifestFingerprint(left);
  const rightManifest = scenarioManifestFingerprint(right);
  const canonicalManifest = scenarioManifestFingerprint({
    scenarioManifest: canonicalScenarioManifest,
  });
  const manifestIsValid = (manifest) => {
    const scenarios = manifest.scenarios || [];
    const viewport = manifest.viewport || {};
    return manifest.schemaVersion === 1
      && Number.isFinite(viewport.width) && viewport.width > 0
      && Number.isFinite(viewport.height) && viewport.height > 0
      && Number.isFinite(viewport.deviceScaleFactor) && viewport.deviceScaleFactor > 0
      && typeof manifest.locale === 'string' && manifest.locale.length > 0
      && typeof manifest.timezoneId === 'string' && manifest.timezoneId.length > 0
      && scenarios.length > 0
      && scenarios.every(({ id, requiredMetrics }) => (
        typeof id === 'string'
        && id.length > 0
        && (
          requiredMetrics == null
          || (
            Array.isArray(requiredMetrics)
            && requiredMetrics.length > 0
            && requiredMetrics.every((metric) => (
              typeof metric === 'string' && metric.length > 0
            ))
            && new Set(requiredMetrics).size === requiredMetrics.length
          )
        )
      ))
      && new Set(scenarios.map(({ id }) => id)).size === scenarios.length;
  };
  compatibility.push({
    id: 'scenario-manifest',
    status: manifestIsValid(leftManifest)
      && manifestIsValid(rightManifest)
      && manifestIsValid(canonicalManifest)
      && stableJson(leftManifest) === stableJson(rightManifest)
      && stableJson(leftManifest) === stableJson(canonicalManifest) ? 'pass' : 'fail',
    left: leftManifest,
    right: rightManifest,
    canonical: canonicalManifest,
  });

  const scenarioIds = [...new Set([
    ...leftManifest.scenarios.map(({ id }) => id),
    ...rightManifest.scenarios.map(({ id }) => id),
    ...canonicalManifest.scenarios.map(({ id }) => id),
  ])].sort();
  for (const scenarioId of scenarioIds) {
    const canonicalScenario = canonicalManifest.scenarios.find(({ id }) => id === scenarioId);
    const leftCoverage = scenarioCoverageDetails(left, canonicalScenario);
    const rightCoverage = scenarioCoverageDetails(right, canonicalScenario);
    compatibility.push({
      id: `scenario-cardinality:${scenarioId}`,
      status: leftCoverage.valid && rightCoverage.valid ? 'pass' : 'fail',
      left: leftCoverage,
      right: rightCoverage,
    });
    const leftMetadata = scenarioMetadataDetails(left, canonicalScenario);
    const rightMetadata = scenarioMetadataDetails(right, canonicalScenario);
    compatibility.push({
      id: `scenario-metadata:${scenarioId}`,
      status: leftMetadata.valid && rightMetadata.valid ? 'pass' : 'fail',
      left: leftMetadata,
      right: rightMetadata,
    });
    const leftMetricCoverage = scenarioMetricCoverageDetails(left, canonicalScenario);
    const rightMetricCoverage = scenarioMetricCoverageDetails(right, canonicalScenario);
    compatibility.push({
      id: `scenario-required-metrics:${scenarioId}`,
      status: leftMetricCoverage.valid && rightMetricCoverage.valid ? 'pass' : 'fail',
      left: leftMetricCoverage,
      right: rightMetricCoverage,
    });
  }

  const invalidScenarioRecords = (report) => (report.browser?.scenarios || [])
    .map((entry, index) => ({ index, id: entry.scenarioId || entry.id }))
    .filter(({ id }) => typeof id !== 'string' || id.length === 0);
  const leftInvalidRecords = invalidScenarioRecords(left);
  const rightInvalidRecords = invalidScenarioRecords(right);
  compatibility.push({
    id: 'scenario-record-identities',
    status: leftInvalidRecords.length === 0 && rightInvalidRecords.length === 0 ? 'pass' : 'fail',
    left: leftInvalidRecords,
    right: rightInvalidRecords,
  });

  const unexpectedScenarioIds = (report, manifest) => {
    const expected = new Set((manifest.scenarios || []).map(({ id }) => id));
    return [...new Set((report.browser?.scenarios || [])
      .map((entry) => entry.scenarioId || entry.id)
      .filter((id) => typeof id === 'string' && id.length > 0 && !expected.has(id)))].sort();
  };
  const leftUnexpected = unexpectedScenarioIds(left, canonicalManifest);
  const rightUnexpected = unexpectedScenarioIds(right, canonicalManifest);
  compatibility.push({
    id: 'unexpected-scenarios',
    status: leftUnexpected.length === 0 && rightUnexpected.length === 0 ? 'pass' : 'fail',
    left: leftUnexpected,
    right: rightUnexpected,
  });

  const buildKeys = [...new Set([
    ...Object.keys(left.metrics || {}),
    ...Object.keys(right.metrics || {}),
  ])].filter((key) => key.startsWith('build:') && isDeterministicMetric(key)).sort();
  const deterministic = buildKeys.map((key) => {
    const leftValue = left.metrics?.[key];
    const rightValue = right.metrics?.[key];
    return {
      key,
      left: leftValue ?? null,
      right: rightValue ?? null,
      status: leftValue === rightValue ? 'pass' : 'fail',
    };
  });

  const leftDeterministicCollection = collectScenarioMetricSamples(left, isDeterministicMetric);
  const rightDeterministicCollection = collectScenarioMetricSamples(right, isDeterministicMetric);
  const leftDeterministicMetrics = leftDeterministicCollection.metrics;
  const rightDeterministicMetrics = rightDeterministicCollection.metrics;
  const deterministicScenarioKeys = [...new Set([
    ...Object.keys(leftDeterministicMetrics),
    ...Object.keys(rightDeterministicMetrics),
  ])].sort();
  for (const key of deterministicScenarioKeys) {
    const scenarioId = key.slice(0, key.indexOf(':'));
    const comparison = buildSampleComparison(
      key,
      leftDeterministicMetrics[key],
      rightDeterministicMetrics[key],
      leftDeterministicCollection.recordCounts[scenarioId],
      rightDeterministicCollection.recordCounts[scenarioId]
    );
    deterministic.push({
      ...comparison,
      left: comparison.leftSamples,
      right: comparison.rightSamples,
      status: comparison.complete
        && stableJson(comparison.leftSamples) === stableJson(comparison.rightSamples)
        && stableJson(comparison.leftIterations) === stableJson(comparison.rightIterations)
        ? 'pass' : 'fail',
    });
  }

  const leftTimingCollection = collectScenarioMetricSamples(left, isTimingMetric);
  const rightTimingCollection = collectScenarioMetricSamples(right, isTimingMetric);
  const leftTimingMetrics = leftTimingCollection.metrics;
  const rightTimingMetrics = rightTimingCollection.metrics;
  const timingKeys = [...new Set([
    ...Object.keys(leftTimingMetrics),
    ...Object.keys(rightTimingMetrics),
  ])].sort();
  const timing = timingKeys.map((key) => {
    const scenarioId = key.slice(0, key.indexOf(':'));
    const comparison = buildSampleComparison(
      key,
      leftTimingMetrics[key],
      rightTimingMetrics[key],
      leftTimingCollection.recordCounts[scenarioId],
      rightTimingCollection.recordCounts[scenarioId]
    );
    const leftValue = comparison.complete ? median(comparison.leftSamples) : null;
    const rightValue = comparison.complete ? median(comparison.rightSamples) : null;
    const variancePercent = Number.isFinite(leftValue) && Number.isFinite(rightValue)
      ? relativeDifferencePercent(leftValue, rightValue)
      : null;
    const absoluteDifference = Number.isFinite(leftValue) && Number.isFinite(rightValue)
      ? Math.abs(leftValue - rightValue)
      : null;
    const absoluteToleranceMs = absoluteJitterToleranceMs(key);
    const withinAbsoluteTolerance = absoluteToleranceMs > 0
      && Number.isFinite(absoluteDifference)
      && absoluteDifference <= absoluteToleranceMs;
    const gatedVariancePercent = withinAbsoluteTolerance ? 0 : variancePercent;
    return {
      ...comparison,
      left: leftValue,
      right: rightValue,
      absoluteDifference,
      absoluteToleranceMs,
      variancePercent,
      gatedVariancePercent,
      status: comparison.complete
        && stableJson(comparison.leftIterations) === stableJson(comparison.rightIterations)
        && Number.isFinite(gatedVariancePercent)
        && gatedVariancePercent <= maximumVariancePercent ? 'pass' : 'fail',
    };
  });
  const observedMaximumVariancePercent = Math.max(0, ...timing
    .map((entry) => entry.variancePercent)
    .filter(Number.isFinite));
  const maximumGatedVariancePercent = Math.max(0, ...timing
    .map((entry) => entry.gatedVariancePercent)
    .filter(Number.isFinite));
  const status = [...compatibility, ...deterministic, ...timing]
    .some((entry) => entry.status !== 'pass') ? 'fail' : 'pass';
  return {
    schemaVersion: 1,
    measurementContractVersion: PERFORMANCE_MEASUREMENT_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    maximumVariancePercent,
    observedMaximumVariancePercent,
    maximumGatedVariancePercent,
    runIds: [left.run?.id || null, right.run?.id || null],
    compatibility,
    deterministic,
    timing,
  };
};

const runRepeatability = ({
  runA = argumentValue('--run-a'),
  runB = argumentValue('--run-b'),
  maximumVariancePercent = Number(argumentValue('--maximum-variance') || DEFAULT_MAX_VARIANCE_PERCENT),
} = {}) => {
  if (!runA || !runB) throw new Error('Provide --run-a and --run-b authoritative report paths.');
  const left = readJson(path.resolve(runA));
  const right = readJson(path.resolve(runB));
  assertSchemaVersion(left, 'authoritative run A');
  assertSchemaVersion(right, 'authoritative run B');
  const repeatability = compareReports(left, right, maximumVariancePercent);
  const aggregate = aggregateReports(left, right, repeatability);
  const aggregatePath = path.join(resultsDir, 'authoritative-aggregate.json');
  writeJson(aggregatePath, aggregate);
  repeatability.aggregateSha256 = sha256(fs.readFileSync(aggregatePath));
  writeJson(path.join(resultsDir, 'repeatability-report.json'), repeatability);
  for (const entry of [...repeatability.compatibility, ...repeatability.deterministic, ...repeatability.timing]) {
    if (entry.status !== 'pass') console.error(`FAIL repeatability ${entry.id || entry.key}`);
  }
  console.log(
    `${repeatability.status.toUpperCase()} repeatability `
    + `(maximum gated variance ${repeatability.maximumGatedVariancePercent.toFixed(2)}%; `
    + `raw observed maximum ${repeatability.observedMaximumVariancePercent.toFixed(2)}%).`
  );
  if (repeatability.status !== 'pass') process.exitCode = 1;
  return { repeatability, aggregate };
};

if (require.main === module) runRepeatability();

module.exports = {
  DEFAULT_MAX_VARIANCE_PERCENT,
  TTFB_ABSOLUTE_JITTER_MS,
  aggregateReports,
  absoluteJitterToleranceMs,
  buildTimingMedianMetricMap,
  collectScenarioMetricSamples,
  compareReports,
  isDeterministicMetric,
  isTimingMetric,
  relativeDifferencePercent,
  runRepeatability,
};
