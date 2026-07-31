const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TASK06_FUNCTION_TEST_PATTERN_ENV,
  TASK06_TEST_FILES,
  run,
  runTestFile,
} = require('./run-integration-tests');

const ownedEnvironment = () => ({
  FND_PERF_PROJECT_ID: 'demo-fnd-perf',
  GCLOUD_PROJECT: 'demo-fnd-perf',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  FND_TASK06_INTEGRATION: '1',
  FND_TASK06_CONSOLIDATED_OWNER: '1',
});

test('Task 06 sequence suppresses rule probes then runs Functions', async () => {
  const calls = [];
  const env = ownedEnvironment();
  await run({
    env,
    runTestFileImpl: async (testFile, options) => {
      assert.equal(options.env, env);
      calls.push(`test:${testFile}`);
    },
    withBackgroundTriggersDisabledImpl: async (operation, options) => {
      assert.deepEqual(options, {projectId: 'demo-fnd-perf'});
      calls.push('triggers:disable');
      try {
        return await operation();
      } finally {
        calls.push('triggers:enable');
      }
    },
  });
  assert.deepEqual(calls, [
    'triggers:disable',
    `test:${TASK06_TEST_FILES[0]}`,
    'triggers:enable',
    `test:${TASK06_TEST_FILES[1]}`,
  ]);
  assert.deepEqual(TASK06_TEST_FILES, [
    'performance/tests/task06-rules.test.js',
    'performance/tests/task06-functions.test.js',
  ]);
});

test('Task 06 sequence refuses direct or unconsolidated execution', async () => {
  await assert.rejects(
    run({env: {...ownedEnvironment(), FND_TASK06_INTEGRATION: ''}}),
    /must run through npm run perf:functions-integration/
  );
  await assert.rejects(
    run({
      env: {
        ...ownedEnvironment(),
        FND_TASK06_CONSOLIDATED_OWNER: '',
      },
    }),
    /consolidated demo owner is not enabled/
  );
});

test('Task 06 diagnostic pattern filters only the Functions test file', () => {
  const calls = [];
  const env = {
    ...ownedEnvironment(),
    [TASK06_FUNCTION_TEST_PATTERN_ENV]: 'derived state|lock-all',
  };
  const spawnSyncImpl = (command, args, options) => {
    calls.push({args, command, options});
    return {status: 0};
  };

  runTestFile(TASK06_TEST_FILES[0], {env, spawnSyncImpl});
  runTestFile(TASK06_TEST_FILES[1], {env, spawnSyncImpl});

  assert.deepEqual(calls[0].args.slice(0, 2), [
    '--test',
    calls[0].args[1],
  ]);
  assert.equal(calls[0].args.includes('--test-name-pattern'), false);
  assert.deepEqual(calls[1].args.slice(0, 3), [
    '--test',
    '--test-name-pattern',
    'derived state|lock-all',
  ]);
});
