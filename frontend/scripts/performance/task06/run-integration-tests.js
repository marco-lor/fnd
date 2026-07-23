#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const {
  PERFORMANCE_ENVIRONMENT_MODE,
  PERFORMANCE_PROJECT_ID,
  configureOwnedPerformanceEnvironment,
  frontendRoot,
} = require('../common');
const {
  withBackgroundTriggersDisabled,
} = require('../emulator-control');

const TASK06_TEST_FILES = Object.freeze([
  'performance/tests/task06-rules.test.js',
  'performance/tests/task06-functions.test.js',
]);
const TASK06_FUNCTIONS_TEST_FILE = TASK06_TEST_FILES[1];
const TASK06_FUNCTION_TEST_PATTERN_ENV =
  'FND_TASK06_FUNCTION_TEST_PATTERN';

const runTestFile = (
  testFile,
  {
    env = process.env,
    spawnSyncImpl = childProcess.spawnSync,
  } = {}
) => {
  const testArguments = ['--test'];
  const testNamePattern = testFile === TASK06_FUNCTIONS_TEST_FILE
    ? String(env[TASK06_FUNCTION_TEST_PATTERN_ENV] || '').trim()
    : '';
  if (testNamePattern) {
    testArguments.push('--test-name-pattern', testNamePattern);
  }
  testArguments.push(path.join(frontendRoot, testFile));
  const result = spawnSyncImpl(
    process.execPath,
    testArguments,
    {
      cwd: frontendRoot,
      env,
      stdio: 'inherit',
      shell: false,
    }
  );
  if (result.error) {
    throw new Error(
      `Task 06 test ${testFile} could not start: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    const error = new Error(
      `Task 06 test ${testFile} failed with exit code `
      + `${result.status ?? 'unknown'}.`
    );
    error.exitCode = result.status || 1;
    throw error;
  }
  return result;
};

const run = async ({
  env = process.env,
  runTestFileImpl = runTestFile,
  withBackgroundTriggersDisabledImpl = withBackgroundTriggersDisabled,
} = {}) => {
  if (env.FND_TASK06_INTEGRATION !== '1') {
    throw new Error(
      'Task 06 emulator tests must run through '
      + 'npm run perf:functions-integration.'
    );
  }
  configureOwnedPerformanceEnvironment({
    env,
    mode: PERFORMANCE_ENVIRONMENT_MODE.STRICT,
  });
  if (env.FND_TASK06_CONSOLIDATED_OWNER !== '1') {
    throw new Error('Task 06 consolidated demo owner is not enabled.');
  }

  // Rules create server-only work records as probes. Suppress Functions while
  // that isolated rules environment is active, then re-enable the worker for
  // the bounded-operation integration scenario.
  await withBackgroundTriggersDisabledImpl(
    async () => runTestFileImpl(TASK06_TEST_FILES[0], {env}),
    {projectId: PERFORMANCE_PROJECT_ID}
  );
  return runTestFileImpl(TASK06_TEST_FILES[1], {env});
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = {
  TASK06_FUNCTION_TEST_PATTERN_ENV,
  TASK06_TEST_FILES,
  run,
  runTestFile,
};
