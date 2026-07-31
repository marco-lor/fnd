#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  PERFORMANCE_ENVIRONMENT_MODE,
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  frontendRoot,
  projectId,
  resultsDir,
} = require('./common');
const { withEmulatorPortCleanup } = require('./emulators');

const reportPath = path.join(resultsDir, 'firestore-persistence-experiment.json');
const REQUIRED_CASES = Object.freeze([
  'account-switch-isolation',
  'two-tab-ownership',
  'offline-stale-read',
  'reconnect-convergence',
  'minimum-cache-eviction',
  'terminate-clear-cleanup',
]);

const run = (command, args, environment = process.env) => {
  const result = childProcess.spawnSync(command, args, {
    cwd: frontendRoot,
    env: environment,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    const error = new Error(`Persistence experiment command failed: ${command} ${args.join(' ')}`);
    error.exitCode = result.status || 1;
    throw error;
  }
};

const validateExperimentReport = (report) => {
  if (report?.schemaVersion !== 1) throw new Error('Persistence experiment report schemaVersion must be 1.');
  assertPerformanceProject(report.projectId);
  if (report.failure) throw new Error(`Persistence experiment failed: ${report.failure.message || 'unknown error'}`);
  const caseIds = Array.isArray(report.cases) ? report.cases.map(({ id }) => id) : [];
  for (const requiredCase of REQUIRED_CASES) {
    if (!caseIds.includes(requiredCase)) throw new Error(`Persistence experiment report is missing ${requiredCase}.`);
  }
  if (report.decision?.persistentCacheEnabled !== false) {
    throw new Error('Task 04 persistence decision must remain disabled.');
  }
  if (report.cache?.minimumBytes !== 1024 * 1024) {
    throw new Error('Persistence experiment must exercise the minimum 1 MiB cache.');
  }
  const casesById = new Map(report.cases.map((entry) => [entry.id, entry]));
  for (const requiredCase of REQUIRED_CASES) {
    if (casesById.get(requiredCase)?.status !== 'exercised') {
      throw new Error(`Persistence experiment case was not exercised: ${requiredCase}.`);
    }
  }
  if (casesById.get('two-tab-ownership')?.observations?.bothTabsInitialized !== true) {
    throw new Error('Persistence experiment did not initialize both ownership tabs.');
  }
  if (casesById.get('reconnect-convergence')?.observations?.converged !== true) {
    throw new Error('Persistence experiment did not converge after reconnect.');
  }
  const eviction = casesById.get('minimum-cache-eviction')?.observations;
  if (
    eviction?.configuredCacheBytes !== 1024 * 1024
    || eviction?.exceededConfiguredMinimum !== true
    || !(eviction?.loadedEstimatedBytes > 1024 * 1024)
  ) {
    throw new Error('Persistence experiment did not load more than the minimum 1 MiB cache.');
  }
  const cleanup = casesById.get('terminate-clear-cleanup')?.observations;
  if (
    cleanup?.firstTabTerminated !== true
    || cleanup?.secondTabTerminated !== true
    || cleanup?.finalClearSucceeded !== true
  ) {
    throw new Error('Persistence experiment did not complete terminate plus final clear cleanup.');
  }
  return report;
};

const main = async ({
  runCommand = run,
  withCleanup = withEmulatorPortCleanup,
  readReport = () => JSON.parse(fs.readFileSync(reportPath, 'utf8')),
  environment = process.env,
  build = true,
} = {}) => {
  assertPerformanceProject(projectId);
  configureOwnedPerformanceEnvironment({
    env: environment,
    mode: PERFORMANCE_ENVIRONMENT_MODE.STRICT,
  });
  runCommand(process.execPath, [path.join(__dirname, 'preflight.js')], environment);
  runCommand(process.execPath, [path.join(__dirname, 'check-query-contracts.js')], environment);
  if (build) runCommand(process.execPath, [path.join(__dirname, 'build.js')], environment);
  await withCleanup(() => {
    runCommand(process.execPath, [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config',
      'performance/playwright.config.js',
      '--project',
      'firestore-persistence-experiment',
    ], environment);
  }, { label: 'Firestore persistence experiment' });
  const report = validateExperimentReport(readReport());
  console.log(`Persistence experiment report verified at ${path.relative(frontendRoot, reportPath)}.`);
  return report;
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = {
  REQUIRED_CASES,
  main,
  reportPath,
  run,
  validateExperimentReport,
};
