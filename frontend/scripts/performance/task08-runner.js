#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  frontendRoot,
  PERFORMANCE_ENVIRONMENT_MODE,
  projectId,
  repoRoot,
  resultsDir,
  resolvePortableJavaHome,
} = require('./common');
const fixtureManifest = require('../../performance/fixture-manifest.json');
const {
  buildIdentityFromReport,
  createTask08Run,
  failTask08Run,
  completeTask08Run,
  randomRunId,
  sourceTreeIdentity,
} = require('./task08-report');
const {
  validateTask08Prerequisites,
} = require('./task08-preflight');
const {
  waitForEmulatorPortsFree,
} = require('./emulators');

const BASELINE_RESULT_PATH = path.join(resultsDir, 'task08-baseline.json');
const BUILD_REPORT_PATH = path.join(resultsDir, 'build-report.json');
const TASK08_PROJECT = 'task08-chromium';
const TASK08_BROWSER_NAME = 'chromium';
const resolveTask08BrowserIdentity = async ({ chromiumImpl } = {}) => {
  const { chromium } = chromiumImpl ? { chromium: chromiumImpl } : require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const version = browser.version();
    if (!version || typeof version !== 'string') {
      throw new Error('Task 08 browser identity did not provide a Chromium version.');
    }
    return {
      project: TASK08_PROJECT,
      name: TASK08_BROWSER_NAME,
      version,
      playwrightVersion: require('@playwright/test/package.json').version,
    };
  } finally {
    await browser.close();
  }
};

const readBuildReport = ({ fsImpl = fs } = {}) => (
  fsImpl.existsSync(BUILD_REPORT_PATH)
    ? JSON.parse(fsImpl.readFileSync(BUILD_REPORT_PATH, 'utf8'))
    : null
);

const createTask08Identity = ({
  sourceIdentity,
  buildReport,
  fixture = fixtureManifest,
  browserIdentity,
} = {}) => ({
  head: sourceIdentity.head,
  dirty: sourceIdentity.dirty,
  statusPorcelain: sourceIdentity.statusPorcelain,
  sourceTreeFingerprint: sourceIdentity.sourceTreeFingerprint,
  trackedDiffFingerprint: sourceIdentity.trackedDiffFingerprint,
  untrackedSourceTestFiles: sourceIdentity.untrackedSourceTestFiles,
  fixture: {
    version: fixture.version,
    hash: fixture.canonicalHash || fixture.hash,
    documentCount: fixture.documentCount,
  },
  build: buildIdentityFromReport(buildReport),
  browser: browserIdentity,
});

const spawnPlaywright = ({
  env,
  spawnSyncImpl = childProcess.spawnSync,
} = {}) => spawnSyncImpl(
  process.execPath,
  [
    require.resolve('@playwright/test/cli'),
    'test',
    '--config',
    path.join('performance', 'playwright.config.js'),
    '--project',
    TASK08_PROJECT,
    '--workers=1',
  ],
  {
    cwd: frontendRoot,
    env,
    shell: false,
    stdio: 'inherit',
  }
);

const requireSuccessfulSpawn = (result) => {
  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    const error = new Error(`Task 08 Playwright run failed with exit code ${result?.status ?? 'unknown'}.`);
    error.exitCode = result?.status || 1;
    throw error;
  }
  return result;
};

const runTask08 = async ({
  reportPath = BASELINE_RESULT_PATH,
  env = process.env,
  sourceIdentity = sourceTreeIdentity({ repoRoot }),
  fixtureIdentity = {
    version: fixtureManifest.version,
    hash: fixtureManifest.canonicalHash,
    documentCount: fixtureManifest.documentCount,
  },
  browserIdentity,
  runId = randomRunId(),
  validatePrerequisitesImpl = validateTask08Prerequisites,
  spawnPlaywrightImpl = spawnPlaywright,
  waitForPortsImpl = waitForEmulatorPortsFree,
  fsImpl = fs,
} = {}) => {
  assertPerformanceProject(projectId);
  const taskEnvironment = configureOwnedPerformanceEnvironment({
    env: { ...env },
    mode: PERFORMANCE_ENVIRONMENT_MODE.STRICT,
  });
  taskEnvironment.FND_TASK08_RUN_ID = runId;
  if (resolvePortableJavaHome()) {
    taskEnvironment.FND_PERF_JAVA_HOME = resolvePortableJavaHome();
  }

  const resolvedBrowserIdentity = browserIdentity || await resolveTask08BrowserIdentity();

  const identity = createTask08Identity({
    sourceIdentity,
    buildReport: readBuildReport({ fsImpl }),
    fixture: fixtureIdentity,
    browserIdentity: resolvedBrowserIdentity,
  });
  createTask08Run({ reportPath, runId, identity, fsImpl });

  let playwrightStarted = false;
  let operationError = null;
  let cleanupError = null;
  try {
    const prerequisites = validatePrerequisitesImpl({
      sourceIdentity,
      env: taskEnvironment,
    });
    // The build report is read again after validation so the report identity
    // reflects the exact artifact used by this invocation.
    const report = JSON.parse(fsImpl.readFileSync(reportPath, 'utf8'));
    report.identity.build = prerequisites.performance.identity;
    fsImpl.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    playwrightStarted = true;
    requireSuccessfulSpawn(spawnPlaywrightImpl({ env: taskEnvironment }));
  } catch (error) {
    operationError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (playwrightStarted) {
      try {
        await waitForPortsImpl();
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  let failureError = null;
  if (operationError && cleanupError) {
    failureError = new AggregateError(
      [operationError, cleanupError],
      'Task 08 run failed and owned emulator cleanup was not verified.'
    );
  } else {
    failureError = operationError || cleanupError;
  }
  if (failureError) {
    try {
      failTask08Run({ reportPath, error: failureError, fsImpl });
    } catch (reportError) {
      throw new AggregateError([failureError, reportError], 'Task 08 run and report update failed.');
    }
    throw failureError;
  }

  try {
    completeTask08Run({ reportPath, fsImpl });
  } catch (error) {
    try {
      failTask08Run({ reportPath, error, fsImpl });
    } catch (reportError) {
      throw new AggregateError([error, reportError], 'Task 08 report completion failed and could not be recorded.');
    }
    throw error;
  }
  return JSON.parse(fsImpl.readFileSync(reportPath, 'utf8'));
};

if (require.main === module) {
  runTask08().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = {
  BASELINE_RESULT_PATH,
  TASK08_BROWSER_NAME,
  TASK08_PROJECT,
  createTask08Identity,
  requireSuccessfulSpawn,
  resolveTask08BrowserIdentity,
  runTask08,
  spawnPlaywright,
};
