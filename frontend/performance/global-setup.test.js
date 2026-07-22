const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertMeasurementTriggerSuppression,
  summarizeTriggerActivityText,
  waitForEmulators,
} = require('./global-setup');
const { collectTeardownEvidence } = require('./global-teardown');
const playwrightConfig = require('./playwright.config');

const invocation = (name) => `Beginning execution of "${name}"`;

test('seed trigger summary allows only bounded readiness activity', () => {
  const summary = summarizeTriggerActivityText([
    invocation('europe-west8-updateTotParameters'),
    invocation('europe-west8-updateTotParameters'),
    invocation('europe-west1-clientFirebaseConfig'),
  ].join('\n'));

  assert.equal(summary.backgroundInvocations, 2);
  assert.equal(summary.cleanupInvocations, 0);
  assert.deepEqual(summary.counts, {
    'europe-west8-updateTotParameters': 2,
    'europe-west1-clientFirebaseConfig': 1,
  });
});

test('seed trigger summary rejects bulk token cleanup activity', () => {
  assert.throws(
    () => summarizeTriggerActivityText(
      invocation('europe-west1-cleanupReplacedGrigliataTokenImage')
    ),
    /invoked cleanupReplacedGrigliataTokenImage 1 times/
  );
});

test('seed trigger summary rejects non-sentinel background activity', () => {
  assert.throws(
    () => summarizeTriggerActivityText(
      invocation('europe-west1-cleanupGrigliataMusicTrack')
    ),
    (error) => {
      assert.match(error.message, /unexpected background triggers: europe-west1-cleanupGrigliataMusicTrack/);
      assert.equal(error.triggerActivity.backgroundInvocations, 1);
      assert.deepEqual(error.triggerActivity.counts, {
        'europe-west1-cleanupGrigliataMusicTrack': 1,
      });
      return true;
    }
  );
});

test('seed trigger summary rejects an unexpected background invocation storm', () => {
  const contents = Array.from(
    { length: 51 },
    () => invocation('europe-west8-updateTotParameters')
  ).join('\n');
  assert.throws(
    () => summarizeTriggerActivityText(contents),
    /produced 51 background invocations/
  );
});

test('measurement trigger suppression rejects any background invocation growth', () => {
  assert.deepEqual(
    assertMeasurementTriggerSuppression(
      { backgroundInvocations: 5 },
      { backgroundInvocations: 5 }
    ),
    { expected: 5, observed: 5 }
  );
  assert.throws(
    () => assertMeasurementTriggerSuppression(
      { backgroundInvocations: 5 },
      { backgroundInvocations: 6 }
    ),
    /ran during the measurement window/
  );
});

test('startup readiness consumes Hub and Functions bodies for the exact harness project', async () => {
  const registrations = {
    auth: {}, firestore: {}, functions: {}, hosting: {}, storage: {},
  };
  const calls = [];
  let functionBodyReads = 0;
  await waitForEmulators({
    lifecycleProjectId: 'demo-fnd-perf',
    fetchImpl: async (url, init) => {
      calls.push({ url, signal: init.signal });
      if (url.endsWith('/emulators')) {
        return { ok: true, status: 200, json: async () => registrations };
      }
      return {
        ok: true,
        status: 200,
        text: async () => {
          functionBodyReads += 1;
          return '{}';
        },
      };
    },
  });

  assert.deepEqual(calls.map(({ url }) => url), [
    'http://127.0.0.1:4400/emulators',
    'http://127.0.0.1:5001/demo-fnd-perf/europe-west1/clientFirebaseConfig',
  ]);
  assert.equal(functionBodyReads, 1);
  assert.ok(calls.every(({ signal }) => signal instanceof AbortSignal && !signal.aborted));
});

test('startup readiness refuses a different demo project before making requests', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    waitForEmulators({
      lifecycleProjectId: 'demo-other',
      fetchImpl: async () => {
        fetchCalls += 1;
      },
    }),
    /requires demo-fnd-perf; found demo-other/
  );
  assert.equal(fetchCalls, 0);
});

test('startup readiness aborts stalled response headers within its hard deadline', async () => {
  const signals = [];
  const startedAt = Date.now();
  await assert.rejects(
    waitForEmulators({
      lifecycleProjectId: 'demo-fnd-perf',
      timeoutMs: 35,
      requestTimeoutMs: 10,
      intervalMs: 0,
      fetchImpl: async (_url, init) => {
        signals.push(init.signal);
        return new Promise(() => {});
      },
    }),
    /not ready within 35 ms \(Firebase Emulator Hub startup probe timed out after/
  );
  assert.ok(Date.now() - startedAt < 1_000);
  assert.ok(signals.length >= 1);
  assert.ok(signals.every(({ aborted }) => aborted));
});

test('startup readiness aborts a stalled Hub JSON body within its hard deadline', async () => {
  const signals = [];
  const startedAt = Date.now();
  await assert.rejects(
    waitForEmulators({
      lifecycleProjectId: 'demo-fnd-perf',
      timeoutMs: 35,
      requestTimeoutMs: 10,
      intervalMs: 0,
      fetchImpl: async (_url, init) => {
        signals.push(init.signal);
        return {
          ok: true,
          status: 200,
          json: async () => new Promise(() => {}),
        };
      },
    }),
    /not ready within 35 ms \(Firebase Emulator Hub startup probe timed out after/
  );
  assert.ok(Date.now() - startedAt < 1_000);
  assert.ok(signals.length >= 1);
  assert.ok(signals.every(({ aborted }) => aborted));
});

test('teardown preserves raw trigger and log evidence when their assertions fail', () => {
  const triggerActivity = {
    counts: { 'europe-west1-unexpected': 6 },
    backgroundInvocations: 6,
    cleanupInvocations: 0,
  };
  const triggerError = new Error('unexpected trigger');
  triggerError.triggerActivity = triggerActivity;
  const logBudget = {
    logPath: 'firebase-debug.log',
    sizeBytes: 30 * 1024 * 1024,
    maxBytes: 25 * 1024 * 1024,
  };
  const logError = new Error('trigger storm');
  logError.logBudget = logBudget;

  const evidence = collectTeardownEvidence({
    healthReport: {
      measurementWindow: { triggerActivityBaseline: { backgroundInvocations: 6 } },
    },
    emulatorLogPath: 'emulator.log',
    firebaseDebugLogPath: 'firebase-debug.log',
    lifecycleProjectId: 'demo-fnd-perf',
    summarizeTriggerActivityImpl: () => { throw triggerError; },
    assertLogWithinBudgetImpl: () => { throw logError; },
  });

  assert.equal(evidence.measurementTriggerActivity, triggerActivity);
  assert.deepEqual(evidence.suppression, { expected: 6, observed: 6 });
  assert.equal(evidence.logBudget, logBudget);
  assert.deepEqual(evidence.errors, [triggerError, logError]);
});

test('Playwright always starts an owned emulator server instead of reusing port 5000', () => {
  assert.equal(playwrightConfig.webServer.reuseExistingServer, false);
});

test('Playwright keeps one worker and zero retries', () => {
  assert.equal(playwrightConfig.workers, 1);
  assert.equal(playwrightConfig.retries, 0);
});
