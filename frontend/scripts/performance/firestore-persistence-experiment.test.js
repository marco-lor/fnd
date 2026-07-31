const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REQUIRED_CASES,
  main,
  validateExperimentReport,
} = require('./firestore-persistence-experiment');

const validReport = () => ({
  schemaVersion: 1,
  projectId: 'demo-fnd-perf',
  cache: { minimumBytes: 1024 * 1024 },
  cases: REQUIRED_CASES.map((id) => ({
    id,
    status: 'exercised',
    observations: id === 'two-tab-ownership'
      ? { bothTabsInitialized: true }
      : id === 'reconnect-convergence'
        ? { converged: true }
        : id === 'minimum-cache-eviction'
          ? {
            configuredCacheBytes: 1024 * 1024,
            exceededConfiguredMinimum: true,
            loadedEstimatedBytes: (1024 * 1024) + 1,
          }
          : id === 'terminate-clear-cleanup'
            ? {
              firstTabTerminated: true,
              secondTabTerminated: true,
              finalClearSucceeded: true,
            }
            : {},
  })),
  decision: { persistentCacheEnabled: false },
});

test('accepts all six cases only while persistence remains disabled', () => {
  assert.equal(validateExperimentReport(validReport()).decision.persistentCacheEnabled, false);
  assert.throws(() => validateExperimentReport({
    ...validReport(),
    decision: { persistentCacheEnabled: true },
  }), /must remain disabled/);
  assert.throws(() => validateExperimentReport({
    ...validReport(),
    cases: validReport().cases.slice(1),
  }), /missing account-switch-isolation/);
  const nonConverged = validReport();
  nonConverged.cases.find(({ id }) => id === 'reconnect-convergence').observations.converged = false;
  assert.throws(() => validateExperimentReport(nonConverged), /did not converge/);
  const incompleteCleanup = validReport();
  incompleteCleanup.cases.find(({ id }) => id === 'terminate-clear-cleanup').observations.finalClearSucceeded = false;
  assert.throws(() => validateExperimentReport(incompleteCleanup), /terminate plus final clear/);
});

test('rejects every report outside the owned demo-fnd-perf project', () => {
  assert.throws(() => validateExperimentReport({
    ...validReport(),
    projectId: 'fatins',
  }), /refuse non-demo Firebase project/);
  assert.throws(() => validateExperimentReport({
    ...validReport(),
    projectId: 'demo-other',
  }), /requires demo-fnd-perf/);
});

test('orchestrates preflight, static check, build, and only the experiment project', async () => {
  const calls = [];
  const environment = {};
  const runCommand = (_command, args) => calls.push(args);
  const withCleanup = async (operation, options) => {
    calls.push(['cleanup', options.label]);
    return operation();
  };

  await main({
    runCommand,
    withCleanup,
    readReport: validReport,
    environment,
  });

  assert.match(calls[0][0], /preflight\.js$/);
  assert.match(calls[1][0], /check-query-contracts\.js$/);
  assert.match(calls[2][0], /build\.js$/);
  const playwright = calls.find((args) => args.includes('firestore-persistence-experiment'));
  assert.ok(playwright);
  assert.equal(environment.FND_PERF_PROJECT_ID, 'demo-fnd-perf');
  assert.equal(environment.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
});
