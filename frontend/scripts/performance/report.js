const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const {
  budgetsPath,
  fixtureManifestPath,
  projectId,
  median,
  percentile,
  readJson,
  resultsDir,
  scenariosPath,
  repoRoot,
} = require('./common');

const resolveGitCommit = ({
  environment = process.env,
  execFileSync = childProcess.execFileSync,
} = {}) => {
  let head;
  try {
    head = execFileSync(
      'git',
      ['-c', `safe.directory=${repoRoot.replace(/\\/g, '/')}`, 'rev-parse', 'HEAD'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch (_error) {
    return 'unknown';
  }
  const suppliedCommit = String(environment.GITHUB_SHA || '').trim();
  if (suppliedCommit && suppliedCommit !== head) {
    throw new Error(`GITHUB_SHA ${suppliedCommit} does not match the checked-out HEAD ${head}.`);
  }
  return head;
};

const readOptionalJson = (filePath) => (
  fs.existsSync(filePath) ? readJson(filePath) : null
);

const sumBuildAssets = (buildReport, predicate, property) => (
  (buildReport?.assets || [])
    .filter(predicate)
    .reduce((total, asset) => total + (Number(asset[property]) || 0), 0)
);

const WORST_CASE_METRICS = new Set([
  'runtime.consoleErrors',
  'runtime.explainedFirestoreEmulatorStartupWarnings',
  'runtime.unhandledErrors',
  'runtime.failedRequests',
  'runtime.synchronousNetworkCalls',
  'firestore.activeListenersAfterCleanup',
  'runtime.activeResourcesAfterCleanup',
  'runtime.activeTimeoutsAfterCleanup',
  'runtime.activeMediaAfterCleanup',
]);

const buildMetricMap = ({ buildReport, browserReport }) => {
  const metrics = {};
  if (buildReport) {
    metrics['build:javascript.entry.gzipBytes'] = sumBuildAssets(
      buildReport,
      (asset) => asset.category === 'javascript' && asset.classification === 'entry',
      'gzipBytes'
    );
  }
  const scenarioMetrics = new Map();
  for (const scenario of browserReport?.scenarios || []) {
    const scenarioId = scenario.scenarioId || scenario.id;
    if (!scenarioId) continue;
    for (const [metric, value] of Object.entries(scenario.metrics || {})) {
      if (!Number.isFinite(value)) continue;
      const key = `${scenarioId}:${metric}`;
      if (!scenarioMetrics.has(key)) scenarioMetrics.set(key, []);
      scenarioMetrics.get(key).push(value);
    }
  }
  for (const [key, values] of scenarioMetrics) {
    const metricName = key.slice(key.indexOf(':') + 1);
    metrics[key] = key.includes(':web-vital.')
      ? percentile(values, 0.75)
      : WORST_CASE_METRICS.has(metricName)
        ? Math.max(...values)
        : median(values);
    if (values.length > 1) metrics[`${key}.p95`] = percentile(values, 0.95);
  }
  return metrics;
};

const collectCurrentReport = () => {
  const buildReport = readOptionalJson(path.join(resultsDir, 'build-report.json'));
  const browserReport = readOptionalJson(path.join(resultsDir, 'browser-report.json'));
  const fixtureReport = readOptionalJson(path.join(resultsDir, 'fixture-report.json'));
  const normalBuildVerification = readOptionalJson(path.join(resultsDir, 'normal-build-verification.json'));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectId,
    commit: resolveGitCommit(),
    run: {
      id: process.env.FND_PERF_RUN_ID || browserReport?.environment?.runId || 'local',
      authoritative: process.env.FND_PERF_AUTHORITATIVE === '1'
        || browserReport?.environment?.authoritative === true,
      retainedIterations: Number(
        process.env.FND_PERF_ITERATIONS || browserReport?.environment?.retainedIterations || 1
      ),
    },
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      referenceMachine: process.env.FND_PERF_REFERENCE_MACHINE
        || (process.env.CI ? 'github-hosted-runner' : 'local-reference'),
      cpuModel: os.cpus()[0]?.model || 'unknown',
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    fixture: fixtureReport,
    fixtureManifest: readJson(fixtureManifestPath),
    normalBuildVerification,
    build: buildReport,
    browser: browserReport,
    scenarioManifest: readJson(scenariosPath),
    budgetConfiguration: readJson(budgetsPath),
  };
  report.metrics = buildMetricMap({ buildReport, browserReport });
  return report;
};

module.exports = { buildMetricMap, collectCurrentReport, resolveGitCommit };
