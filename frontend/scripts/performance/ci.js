#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const {
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  frontendRoot,
  PERFORMANCE_AUTH_DOMAIN,
  PERFORMANCE_HOSTING_SITE,
  PERFORMANCE_STORAGE_BUCKET,
  projectId,
} = require('./common');
const {
  removePerformanceFirebaseConfig,
  withEmulatorPortCleanup,
} = require('./emulators');

const run = (command, args, environment = {}) => {
  const result = childProcess.spawnSync(command, args, {
    cwd: frontendRoot,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    const error = new Error(`Performance command failed: ${command} ${args.join(' ')}`);
    error.exitCode = result.status || 1;
    throw error;
  }
};

const main = async () => {
  assertPerformanceProject(projectId);
  const performanceEnvironment = configureOwnedPerformanceEnvironment({
    env: {...process.env},
    mode: 'strict',
  });
  Object.assign(performanceEnvironment, {
    FND_FIREBASE_AUTH_DOMAIN: PERFORMANCE_AUTH_DOMAIN,
    FND_FIREBASE_ENVIRONMENT: 'performance',
    FND_FIREBASE_HOSTING_SITE: PERFORMANCE_HOSTING_SITE,
    FND_FIREBASE_PROJECT_ID: projectId,
    FND_FIREBASE_STORAGE_BUCKET: PERFORMANCE_STORAGE_BUCKET,
  });
  removePerformanceFirebaseConfig();
  run(process.execPath, [path.join(__dirname, 'preflight.js')], performanceEnvironment);
  run(process.execPath, [path.join(__dirname, 'migrate-firestore-imports.js'), '--check'], performanceEnvironment);
  run(process.execPath, [path.join(__dirname, 'check-shared-config-boundaries.js')], performanceEnvironment);
  run(process.execPath, [path.join(__dirname, 'check-user-data-boundaries.js')], performanceEnvironment);
  run(process.execPath, [path.join(__dirname, 'check-media-boundaries.js')], performanceEnvironment);
  run(process.execPath, [path.join(__dirname, 'check-query-contracts.js')], performanceEnvironment);
  run(process.execPath, ['--test', '--test-concurrency=1',
    path.join(frontendRoot, 'scripts', 'verify-start.test.js'),
    path.join(__dirname, 'common.test.js'),
    path.join(__dirname, 'emulator-control.test.js'),
    path.join(__dirname, 'emulators.test.js'),
    path.join(__dirname, 'deterministic-static-server.test.js'),
    path.join(__dirname, 'fixtures.test.js'),
    path.join(__dirname, 'compare.test.js'),
    path.join(__dirname, 'report.test.js'),
    path.join(__dirname, 'repeatability.test.js'),
    path.join(__dirname, 'authoritative.test.js'),
    path.join(__dirname, 'check-query-contracts.test.js'),
    path.join(__dirname, 'check-shared-config-boundaries.test.js'),
    path.join(__dirname, 'check-user-data-boundaries.test.js'),
    path.join(__dirname, 'check-media-boundaries.test.js'),
    path.join(__dirname, 'firestore-persistence-experiment.test.js'),
    path.join(__dirname, 'verify-disabled-build.test.js'),
    path.join(frontendRoot, 'scripts', 'backfill-user-directory.test.js'),
    path.join(frontendRoot, 'scripts', 'task05', 'user-data-migration.test.js'),
    path.join(frontendRoot, 'scripts', 'task05', 'user-data-cutover.test.js'),
    path.join(frontendRoot, 'scripts', 'task07', 'media-derivative-backfill.test.js'),
    path.join(frontendRoot, 'performance', 'global-setup.test.js'),
    path.join(frontendRoot, 'performance', 'tests', 'browser', 'helpers.test.js'),
  ], performanceEnvironment);
  run(process.execPath, [path.join(__dirname, 'fixtures.js'), 'determinism'], performanceEnvironment);
  run(process.execPath, [
    path.join(frontendRoot, 'scripts', 'build-production.js'),
    '--environment', 'performance',
    '--project', projectId,
    '--site', PERFORMANCE_HOSTING_SITE,
    '--bucket', PERFORMANCE_STORAGE_BUCKET,
  ], performanceEnvironment);
  run(process.execPath, [path.join(__dirname, 'verify-disabled-build.js')], performanceEnvironment);
  run(process.execPath, [path.join(__dirname, 'build.js')], performanceEnvironment);
  await withEmulatorPortCleanup(() => {
    run(process.execPath, [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config',
      'performance/playwright.config.js',
      '--project',
      'chromium',
      '--workers',
      '1',
    ], performanceEnvironment);
  }, {
    cleanupOwnedArtifacts: removePerformanceFirebaseConfig,
    label: 'Performance CI Playwright run',
  });
  run(process.execPath, [path.join(__dirname, 'compare.js')], performanceEnvironment);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = { main, run };
