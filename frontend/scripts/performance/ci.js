#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const { assertPerformanceProject, frontendRoot, projectId } = require('./common');
const { withEmulatorPortCleanup } = require('./emulators');

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
  run(process.execPath, [path.join(__dirname, 'preflight.js')]);
  run(process.execPath, ['--test',
    path.join(frontendRoot, 'scripts', 'verify-start.test.js'),
    path.join(__dirname, 'common.test.js'),
    path.join(__dirname, 'emulator-control.test.js'),
    path.join(__dirname, 'emulators.test.js'),
    path.join(__dirname, 'fixtures.test.js'),
    path.join(__dirname, 'compare.test.js'),
    path.join(__dirname, 'report.test.js'),
    path.join(__dirname, 'repeatability.test.js'),
    path.join(__dirname, 'authoritative.test.js'),
    path.join(frontendRoot, 'performance', 'global-setup.test.js'),
    path.join(frontendRoot, 'performance', 'tests', 'browser', 'helpers.test.js'),
  ]);
  run(process.execPath, [path.join(__dirname, 'fixtures.js'), 'determinism']);
  run(process.execPath, [path.join(frontendRoot, 'scripts', 'build-production.js')]);
  run(process.execPath, [path.join(__dirname, 'verify-disabled-build.js')]);
  run(process.execPath, [path.join(__dirname, 'build.js')]);
  await withEmulatorPortCleanup(() => {
    run(process.execPath, [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config',
      'performance/playwright.config.js',
      '--project',
      'chromium',
    ]);
  }, { label: 'Performance CI Playwright run' });
  run(process.execPath, [path.join(__dirname, 'compare.js')]);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = { main, run };
