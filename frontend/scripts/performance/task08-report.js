const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  frontendRoot,
  projectId,
  readJson,
  repoRoot: defaultRepoRoot,
  resultsDir,
  sha256,
  writeJson,
} = require('./common');
const {
  TASK08_MEASUREMENT_CONTRACT_VERSION,
  TASK08_SCENARIO_IDS,
} = require('./task08-contract');

const TASK08_REPORT_SCHEMA_VERSION = 2;
const SOURCE_FILE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
]);
const IGNORED_SOURCE_PATH = /^(?:build|node_modules|performance-results|test-results|playwright-report|\.perf-emulator-data|\.codex)(?:\/|$)/i;

const normalizeRelativePath = (value) => String(value || '')
  .replace(/\\/g, '/')
  .replace(/^\.\//, '')
  .trim();

const isSourceOrTestPath = (relativePath) => {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || IGNORED_SOURCE_PATH.test(normalized)) return false;
  const extension = path.posix.extname(normalized).toLowerCase();
  if (!SOURCE_FILE_EXTENSIONS.has(extension)) return false;
  return /(?:^|\/)(?:src|scripts|performance|functions|test|tests|__tests__)(?:\/|$)/i.test(normalized)
    || /(?:\.test|\.spec)\.[^.]+$/i.test(normalized);
};

const gitOutput = (execFileSync, repoRoot, args, options = {}) => execFileSync(
  'git',
  ['-c', `safe.directory=${String(repoRoot).replace(/\\/g, '/')}`, ...args],
  {
    cwd: repoRoot,
    ...options,
  }
);

const sourceTreeIdentity = ({
  repoRoot = defaultRepoRoot,
  execFileSync = childProcess.execFileSync,
  readFileSync = fs.readFileSync,
  existsSync = fs.existsSync,
} = {}) => {
  const head = String(gitOutput(execFileSync, repoRoot, ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })).trim();
  const statusPorcelain = String(gitOutput(
    execFileSync,
    repoRoot,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ));
  const trackedDiff = gitOutput(
    execFileSync,
    repoRoot,
    ['diff', '--binary', '--no-ext-diff', 'HEAD', '--'],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const untrackedSourceTestFiles = String(gitOutput(
    execFileSync,
    repoRoot,
    ['ls-files', '--others', '--exclude-standard'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  )).split(/\r?\n/)
    .map(normalizeRelativePath)
    .filter(isSourceOrTestPath)
    .sort((left, right) => left.localeCompare(right));

  const diffBuffer = Buffer.isBuffer(trackedDiff)
    ? trackedDiff
    : Buffer.from(String(trackedDiff));
  const material = [Buffer.from('task08-source-tree-v1\0'), diffBuffer];
  for (const relativePath of untrackedSourceTestFiles) {
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Untracked source/test file disappeared while fingerprinting: ${relativePath}`);
    }
    const contents = readFileSync(absolutePath);
    material.push(
      Buffer.from(`\0${relativePath}\0`),
      Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents))
    );
  }

  return {
    head,
    dirty: statusPorcelain.trim().length > 0,
    statusPorcelain: statusPorcelain.trim(),
    trackedDiffFingerprint: sha256(diffBuffer),
    sourceTreeFingerprint: sha256(Buffer.concat(material)),
    untrackedSourceTestFiles,
  };
};

const reportPathDefault = path.join(resultsDir, 'task08-baseline.json');

const asTimestamp = (now) => {
  const value = typeof now === 'function' ? now() : now;
  return value instanceof Date ? value.toISOString() : new Date(value || Date.now()).toISOString();
};

const randomRunId = () => (
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`
);

const stableIdentity = (identity) => JSON.parse(JSON.stringify(identity || {}));

const assertIdentity = (expected, actual) => {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Task 08 scenario identity does not match the active run source/build/fixture/browser identity.');
  }
};

const assertReportShape = (report) => {
  if (!report || report.schemaVersion !== TASK08_REPORT_SCHEMA_VERSION) {
    throw new Error(`Task 08 report must use schemaVersion ${TASK08_REPORT_SCHEMA_VERSION}.`);
  }
  if (!report.runId || !Array.isArray(report.scenarios)) {
    throw new Error('Task 08 report is missing its run identity or scenario list.');
  }
  if (report.complete === true || report.status === 'complete') {
    if (report.complete !== true || report.status !== 'complete') {
      throw new Error('Task 08 complete reports must set status=complete and complete=true together.');
    }
  }
  return report;
};

const readTask08Report = (reportPath = reportPathDefault) => (
  assertReportShape(readJson(reportPath))
);

const createTask08Run = ({
  reportPath = reportPathDefault,
  runId = randomRunId(),
  identity,
  now = Date.now,
  reason = 'started',
  fsImpl = fs,
} = {}) => {
  if (!runId) throw new TypeError('Task 08 runId is required.');
  if (!identity || typeof identity !== 'object') {
    throw new TypeError('Task 08 source/build/fixture/browser identity is required.');
  }
  const timestamp = asTimestamp(now);
  const report = {
    schemaVersion: TASK08_REPORT_SCHEMA_VERSION,
    measurementContractVersion: TASK08_MEASUREMENT_CONTRACT_VERSION,
    runId: String(runId),
    status: 'partial',
    complete: false,
    officialBaseline: false,
    startedAt: timestamp,
    updatedAt: timestamp,
    reason,
    identity: stableIdentity(identity),
    requiredScenarioIds: [...TASK08_SCENARIO_IDS],
    completedScenarioIds: [],
    scenarios: [],
    failure: null,
  };
  fsImpl.mkdirSync(path.dirname(reportPath), { recursive: true });
  fsImpl.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
};

const updateReport = (reportPath, mutate, fsImpl = fs) => {
  const report = assertReportShape(JSON.parse(fsImpl.readFileSync(reportPath, 'utf8')));
  mutate(report);
  report.updatedAt = new Date().toISOString();
  fsImpl.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
};

const recordTask08Scenario = ({
  reportPath = reportPathDefault,
  runId,
  identity,
  scenarioId,
  result = {},
  now,
  fsImpl = fs,
} = {}) => updateReport(reportPath, (report) => {
  if (report.complete || report.status === 'complete') {
    throw new Error('Cannot append a scenario to a complete Task 08 report.');
  }
  if (String(runId) !== report.runId) throw new Error('Task 08 scenario runId does not match the active report.');
  assertIdentity(report.identity, identity);
  if (!TASK08_SCENARIO_IDS.includes(scenarioId)) {
    throw new Error(`Unknown Task 08 scenario ID: ${String(scenarioId)}.`);
  }
  if (report.scenarios.some(({ id }) => id === scenarioId)) {
    throw new Error(`Task 08 scenario ${scenarioId} was already recorded for this run.`);
  }
  report.scenarios.push({
    id: scenarioId,
    runId: report.runId,
    identity: stableIdentity(report.identity),
    ...result,
    recordedAt: asTimestamp(now),
  });
  report.scenarios.sort((left, right) => left.id.localeCompare(right.id));
  report.completedScenarioIds = report.scenarios.map(({ id }) => id);
}, fsImpl);

const failTask08Run = ({
  reportPath = reportPathDefault,
  error,
  now,
  fsImpl = fs,
} = {}) => updateReport(reportPath, (report) => {
  report.status = 'partial';
  report.complete = false;
  report.failure = {
    message: String(error?.message || error || 'Task 08 run failed').slice(0, 2000),
    recordedAt: asTimestamp(now),
  };
}, fsImpl);

const completeTask08Run = ({
  reportPath = reportPathDefault,
  now,
  fsImpl = fs,
} = {}) => updateReport(reportPath, (report) => {
  const expected = [...TASK08_SCENARIO_IDS].sort();
  const actual = [...new Set(report.completedScenarioIds || [])].sort();
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(
      `Task 08 report cannot be complete until every required scenario finishes; `
      + `expected ${expected.join(', ')}, observed ${actual.join(', ') || 'none'}.`
    );
  }
  if (report.scenarios.some((scenario) => scenario.runId !== report.runId)) {
    throw new Error('Task 08 report contains a scenario from a different run.');
  }
  report.status = 'complete';
  report.complete = true;
  report.officialBaseline = false;
  report.completedAt = asTimestamp(now);
  report.failure = null;
}, fsImpl);

const buildIdentityFromReport = (buildReport) => {
  if (!buildReport || buildReport.buildMode !== 'performance' || buildReport.projectId !== projectId) {
    return null;
  }
  const mainAsset = (buildReport.assets || []).find((asset) => (
    asset.classification === 'entry' && asset.logicalName === 'main'
  ));
  if (!mainAsset) return null;
  return {
    identity: sha256(JSON.stringify({
      schemaVersion: buildReport.schemaVersion,
      buildMode: buildReport.buildMode,
      projectId: buildReport.projectId,
      sourceTreeIdentity: buildReport.sourceTreeIdentity || null,
      mainAsset,
      webpackModuleEvidence: buildReport.webpackModuleEvidence || null,
    })),
    sourceTreeFingerprint: buildReport.sourceTreeIdentity?.sourceTreeFingerprint || null,
    generatedAt: buildReport.generatedAt || null,
    mainAsset,
  };
};

module.exports = {
  TASK08_REPORT_SCHEMA_VERSION,
  buildIdentityFromReport,
  completeTask08Run,
  createTask08Run,
  failTask08Run,
  isSourceOrTestPath,
  randomRunId,
  readTask08Report,
  recordTask08Scenario,
  sourceTreeIdentity,
};
