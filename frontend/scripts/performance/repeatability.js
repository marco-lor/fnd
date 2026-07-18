#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  assertSchemaVersion,
  readJson,
  resultsDir,
  sha256,
  writeJson,
} = require('./common');
const { buildMetricMap } = require('./report');

const DEFAULT_MAX_VARIANCE_PERCENT = 15;

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

const baseMetricKey = (key) => key.endsWith('.p95') ? key.slice(0, -4) : key;

const isTimingMetric = (key) => {
  const base = baseMetricKey(key);
  return /:web-vital\.(LCP|INP|TTFB)$/.test(base)
    || /:runtime\.(maxLongTaskMs|peerConvergenceMs)$/.test(base)
    || /:microbenchmark\..*\.(median|p95)$/.test(base);
};

const isDeterministicMetric = (key) => {
  const base = baseMetricKey(key);
  return /:runtime\.(consoleErrors|unhandledErrors|failedRequests|synchronousNetworkCalls|activeListenersAfterCleanup|activeResourcesAfterCleanup|activeTimeoutsAfterCleanup|activeMediaAfterCleanup)$/.test(base)
    || /:firestore\./.test(base)
    || /:resource\.[^.]+\.(gzipBytes|count)$/.test(base)
    || base.startsWith('build:');
};

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
      runIds: repeatability.runIds,
    },
  };
  aggregate.metrics = buildMetricMap({ buildReport: aggregate.build, browserReport: aggregate.browser });
  return aggregate;
};

const compareReports = (left, right, maximumVariancePercent = DEFAULT_MAX_VARIANCE_PERCENT) => {
  const compatibility = [];
  const compareExact = (id, leftValue, rightValue) => compatibility.push({
    id,
    status: stableJson(leftValue) === stableJson(rightValue) ? 'pass' : 'fail',
    left: leftValue,
    right: rightValue,
  });
  compareExact('schema-version', left.schemaVersion, right.schemaVersion);
  compareExact('commit', left.commit, right.commit);
  compareExact('project', left.projectId, right.projectId);
  compareExact('fixture-hash', left.fixture?.hash, right.fixture?.hash);
  compareExact('fixture-version', left.fixtureManifest?.version, right.fixtureManifest?.version);
  for (const field of ['platform', 'architecture', 'node', 'referenceMachine', 'cpuModel', 'cpuCount']) {
    compareExact(`environment-${field}`, left.environment?.[field], right.environment?.[field]);
  }
  compareExact('browser', browserFingerprint(left), browserFingerprint(right));
  compareExact('build-assets', buildFingerprint(left), buildFingerprint(right));
  compareExact(
    'scenario-set',
    [...new Set((left.browser?.scenarios || []).map((entry) => entry.scenarioId || entry.id))].sort(),
    [...new Set((right.browser?.scenarios || []).map((entry) => entry.scenarioId || entry.id))].sort()
  );

  const metricKeys = [...new Set([
    ...Object.keys(left.metrics || {}),
    ...Object.keys(right.metrics || {}),
  ])].sort();
  const deterministic = [];
  const timing = [];
  for (const key of metricKeys) {
    const leftValue = left.metrics?.[key];
    const rightValue = right.metrics?.[key];
    if (isTimingMetric(key)) {
      const variancePercent = Number.isFinite(leftValue) && Number.isFinite(rightValue)
        ? relativeDifferencePercent(leftValue, rightValue)
        : null;
      timing.push({
        key,
        left: leftValue ?? null,
        right: rightValue ?? null,
        variancePercent,
        status: Number.isFinite(variancePercent) && variancePercent <= maximumVariancePercent ? 'pass' : 'fail',
      });
    } else if (isDeterministicMetric(key)) {
      deterministic.push({
        key,
        left: leftValue ?? null,
        right: rightValue ?? null,
        status: leftValue === rightValue ? 'pass' : 'fail',
      });
    }
  }
  const observedMaximumVariancePercent = Math.max(0, ...timing
    .map((entry) => entry.variancePercent)
    .filter(Number.isFinite));
  const status = [...compatibility, ...deterministic, ...timing]
    .some((entry) => entry.status !== 'pass') ? 'fail' : 'pass';
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    maximumVariancePercent,
    observedMaximumVariancePercent,
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
  console.log(`${repeatability.status.toUpperCase()} repeatability (maximum observed variance ${repeatability.observedMaximumVariancePercent.toFixed(2)}%).`);
  if (repeatability.status !== 'pass') process.exitCode = 1;
  return { repeatability, aggregate };
};

if (require.main === module) runRepeatability();

module.exports = {
  DEFAULT_MAX_VARIANCE_PERCENT,
  aggregateReports,
  compareReports,
  isDeterministicMetric,
  isTimingMetric,
  relativeDifferencePercent,
  runRepeatability,
};
