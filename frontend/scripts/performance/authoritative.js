#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const { authoritativeResultsDir, frontendRoot } = require('./common');

const run = (command, args, environment = {}) => {
  const result = childProcess.spawnSync(command, args, {
    cwd: frontendRoot,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
};

const runBase = process.env.FND_PERF_RUN_ID
  || new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '');
const commonEnvironment = {
  FND_PERF_AUTHORITATIVE: '1',
  FND_PERF_ITERATIONS: '3',
};

run(process.execPath, [path.join(__dirname, 'preflight.js')]);
run(process.execPath, [path.join(frontendRoot, 'scripts', 'build-production.js')]);
run(process.execPath, [path.join(__dirname, 'verify-disabled-build.js')]);

const snapshots = [];
for (const suffix of ['a', 'b']) {
  const runId = `${runBase}-${suffix}`;
  const environment = { ...commonEnvironment, FND_PERF_RUN_ID: runId };
  run(process.execPath, [path.join(__dirname, 'build.js')], environment);
  run(process.execPath, [
    require.resolve('@playwright/test/cli'),
    'test',
    '--config',
    'performance/playwright.config.js',
    '--project',
    'chromium',
  ], environment);
  run(process.execPath, [path.join(__dirname, 'snapshot-authoritative.js'), '--run-id', runId], environment);
  snapshots.push(path.join(authoritativeResultsDir, `${runId}.json`));
}

run(process.execPath, [
  path.join(__dirname, 'repeatability.js'),
  '--run-a', snapshots[0],
  '--run-b', snapshots[1],
]);
run(process.execPath, [path.join(__dirname, 'compare.js')]);
