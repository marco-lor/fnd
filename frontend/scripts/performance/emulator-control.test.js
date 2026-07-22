const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_LOG_BUDGET_BYTES,
  DEFAULT_TRIGGER_CONTROL_TIMEOUT_MS,
  assertLogWithinBudget,
  disableBackgroundTriggersWithRecovery,
  setBackgroundTriggersEnabled,
  waitForEmulatorHealth,
  withBackgroundTriggersDisabled,
} = require('./emulator-control');

test('background-trigger control allows the Functions emulator reload lifecycle budget', () => {
  assert.equal(DEFAULT_TRIGGER_CONTROL_TIMEOUT_MS, 60_000);
});

const okResponse = ({ body = {}, status = 200 } = {}) => ({
  ok: true,
  status,
  json: async () => body,
  text: async () => '',
});

test('setBackgroundTriggersEnabled uses the documented loopback PUT endpoints without a body', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return okResponse({ body: { enabled: url.endsWith('enableBackgroundTriggers') } });
  };

  await setBackgroundTriggersEnabled(false, { fetchImpl, projectId: 'demo-control' });
  await setBackgroundTriggersEnabled(true, { fetchImpl, projectId: 'demo-control' });

  assert.deepEqual(calls.map(({ url }) => url), [
    'http://127.0.0.1:4400/functions/disableBackgroundTriggers',
    'http://127.0.0.1:4400/functions/enableBackgroundTriggers',
  ]);
  calls.forEach(({ init }) => {
    assert.equal(init.method, 'PUT');
    assert.equal(Object.hasOwn(init, 'body'), false);
    assert.ok(init.signal instanceof AbortSignal);
  });
});

test('emulator control refuses non-demo projects and non-loopback Hub URLs', async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return okResponse();
  };

  await assert.rejects(
    setBackgroundTriggersEnabled(false, { fetchImpl, projectId: 'production-project' }),
    /refuse non-demo Firebase project/
  );
  await assert.rejects(
    setBackgroundTriggersEnabled(false, {
      fetchImpl,
      projectId: 'demo-control',
      hubBaseUrl: 'https://emulator.example.test:4400',
    }),
    /loopback host/
  );
  assert.equal(fetchCalls, 0);
});

test('setBackgroundTriggersEnabled requires the Hub to confirm the requested state', async () => {
  await assert.rejects(
    setBackgroundTriggersEnabled(false, {
      fetchImpl: async () => okResponse({ body: { enabled: true } }),
      projectId: 'demo-control',
    }),
    /did not confirm background triggers were disabled/
  );
});

test('setBackgroundTriggersEnabled times out and aborts when trigger-control JSON stalls', async () => {
  let requestSignal;
  await assert.rejects(
    setBackgroundTriggersEnabled(false, {
      fetchImpl: async (_url, init) => {
        requestSignal = init.signal;
        return {
          ...okResponse(),
          json: async () => new Promise(() => {}),
        };
      },
      projectId: 'demo-control',
      timeoutMs: 10,
    }),
    /disable request failed: timed out after 10 ms/
  );
  assert.equal(requestSignal.aborted, true);
});

test('setBackgroundTriggersEnabled times out and aborts when non-OK detail text stalls', async () => {
  let requestSignal;
  await assert.rejects(
    setBackgroundTriggersEnabled(false, {
      fetchImpl: async (_url, init) => {
        requestSignal = init.signal;
        return {
          ok: false,
          status: 503,
          text: async () => new Promise(() => {}),
        };
      },
      projectId: 'demo-control',
      timeoutMs: 10,
    }),
    /disable request failed: timed out after 10 ms/
  );
  assert.equal(requestSignal.aborted, true);
});

test('withBackgroundTriggersDisabled preserves disable-operation-enable ordering and returns the result', async () => {
  const events = [];
  const fetchImpl = async (url) => {
    events.push(url.endsWith('disableBackgroundTriggers') ? 'disable' : 'enable');
    return okResponse({ body: { enabled: url.endsWith('enableBackgroundTriggers') } });
  };

  const result = await withBackgroundTriggersDisabled(async () => {
    events.push('operation');
    return 'seeded';
  }, { fetchImpl, projectId: 'demo-control' });

  assert.equal(result, 'seeded');
  assert.deepEqual(events, ['disable', 'operation', 'enable']);
});

test('withBackgroundTriggersDisabled re-enables after an operation failure', async () => {
  const operationError = new Error('seed failed');
  const events = [];
  const fetchImpl = async (url) => {
    events.push(url.endsWith('disableBackgroundTriggers') ? 'disable' : 'enable');
    return okResponse({ body: { enabled: url.endsWith('enableBackgroundTriggers') } });
  };

  await assert.rejects(
    withBackgroundTriggersDisabled(async () => {
      events.push('operation');
      throw operationError;
    }, { fetchImpl, projectId: 'demo-control' }),
    (error) => error === operationError
  );
  assert.deepEqual(events, ['disable', 'operation', 'enable']);
});

test('withBackgroundTriggersDisabled attempts recovery when disable fails ambiguously', async () => {
  const events = [];
  let operationCalled = false;
  const fetchImpl = async (url) => {
    const action = url.endsWith('disableBackgroundTriggers') ? 'disable' : 'enable';
    events.push(action);
    if (action === 'disable') throw new Error('disable response lost');
    return okResponse({ body: { enabled: true } });
  };

  await assert.rejects(
    withBackgroundTriggersDisabled(async () => {
      operationCalled = true;
    }, { fetchImpl, projectId: 'demo-control' }),
    /disable request failed: disable response lost/
  );
  assert.equal(operationCalled, false);
  assert.deepEqual(events, ['disable', 'enable']);
});

test('disableBackgroundTriggersWithRecovery is safe for direct measurement-window setup', async () => {
  const events = [];
  const fetchImpl = async (url) => {
    const action = url.endsWith('disableBackgroundTriggers') ? 'disable' : 'enable';
    events.push(action);
    if (action === 'disable') throw new Error('disable response lost');
    return okResponse({ body: { enabled: true } });
  };

  await assert.rejects(
    disableBackgroundTriggersWithRecovery({ fetchImpl, projectId: 'demo-control' }),
    /disable request failed: disable response lost/
  );
  assert.deepEqual(events, ['disable', 'enable']);
});

test('withBackgroundTriggersDisabled reports disable and recovery failures together', async () => {
  const fetchImpl = async (url) => {
    throw new Error(url.endsWith('disableBackgroundTriggers')
      ? 'disable response lost'
      : 'recovery response lost');
  };

  await assert.rejects(
    withBackgroundTriggersDisabled(async () => {}, { fetchImpl, projectId: 'demo-control' }),
    (error) => {
      assert.ok(error instanceof global.AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[0].message, /disable response lost/);
      assert.match(error.errors[1].message, /recovery response lost/);
      return true;
    }
  );
});

test('withBackgroundTriggersDisabled reports operation and re-enable failures together', async () => {
  const operationError = new Error('seed failed');
  const cleanupError = new Error('enable failed');
  const fetchImpl = async (url) => {
    if (url.endsWith('enableBackgroundTriggers')) throw cleanupError;
    return okResponse({ body: { enabled: false } });
  };

  await assert.rejects(
    withBackgroundTriggersDisabled(async () => {
      throw operationError;
    }, { fetchImpl, projectId: 'demo-control' }),
    (error) => {
      assert.ok(error instanceof global.AggregateError);
      assert.equal(error.errors.length, 2);
      assert.equal(error.errors[0], operationError);
      assert.match(error.errors[1].message, /enable failed/);
      return true;
    }
  );
});

test('waitForEmulatorHealth resets after failure and requires three consecutive healthy samples', async () => {
  const requiredRegistrations = {
    auth: { port: 9099 },
    firestore: { port: 8080 },
    functions: { port: 5001 },
    hosting: { port: 5000 },
    storage: { port: 9199 },
  };
  let hubAttempt = 0;
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push({ url, method: init.method });
    if (url.endsWith('/emulators')) {
      hubAttempt += 1;
      return okResponse({
        body: (
          hubAttempt === 1
            ? { ...requiredRegistrations, storage: undefined }
            : requiredRegistrations
        ),
      });
    }
    return okResponse();
  };
  let fixtureReads = 0;
  const db = {
    doc(documentPath) {
      assert.equal(documentPath, 'perf_meta/fixture');
      return {
        async get() {
          fixtureReads += 1;
          return {
            exists: true,
            data: () => ({ version: 'fixture-v1', hash: 'fixture-hash' }),
          };
        },
      };
    },
  };
  const delays = [];

  const report = await waitForEmulatorHealth({
    fetchImpl,
    db,
    expectedManifest: { version: 'fixture-v1', hash: 'fixture-hash' },
    projectId: 'demo-control',
    sleepImpl: async (milliseconds) => delays.push(milliseconds),
  });

  assert.equal(report.healthy, true);
  assert.equal(report.consecutiveSamples, 3);
  assert.deepEqual(report.samples.map(({ healthy }) => healthy), [false, true, true, true]);
  assert.equal(fixtureReads, 3);
  assert.deepEqual(delays, [500, 500, 500]);
  assert.ok(urls.some(({ url }) => url === 'http://127.0.0.1:5000/'));
  assert.ok(urls.some(({ url }) => (
    url === 'http://127.0.0.1:5001/demo-control/europe-west1/clientFirebaseConfig'
  )));
  assert.ok(urls.every(({ method }) => method === 'GET'));
});

test('waitForEmulatorHealth exposes failed samples when the deadline expires', async () => {
  let now = 0;
  const fetchImpl = async () => okResponse({ body: { auth: {}, firestore: {} } });

  await assert.rejects(
    waitForEmulatorHealth({
      fetchImpl,
      db: { doc: () => ({ get: async () => ({ exists: false }) }) },
      expectedManifest: { version: 'fixture-v1', hash: 'fixture-hash' },
      projectId: 'demo-control',
      timeoutMs: 1_000,
      intervalMs: 500,
      nowImpl: () => now,
      sleepImpl: async (milliseconds) => { now += milliseconds; },
    }),
    (error) => {
      assert.match(error.message, /not healthy within 1000 ms/);
      assert.equal(error.samples.length, 3);
      assert.ok(error.samples.every(({ healthy }) => healthy === false));
      assert.match(error.samples[0].error, /missing registrations/);
      return true;
    }
  );
});

test('waitForEmulatorHealth aborts stalled Hub JSON within its hard deadline', async () => {
  const requestSignals = [];
  const startedAt = Date.now();

  await assert.rejects(
    waitForEmulatorHealth({
      fetchImpl: async (_url, init) => {
        requestSignals.push(init.signal);
        return {
          ...okResponse(),
          json: async () => new Promise(() => {}),
        };
      },
      db: { doc: () => ({ get: async () => ({ exists: false }) }) },
      expectedManifest: { version: 'fixture-v1', hash: 'fixture-hash' },
      projectId: 'demo-control',
      timeoutMs: 35,
      requestTimeoutMs: 10,
      intervalMs: 0,
    }),
    (error) => {
      assert.match(error.message, /not healthy within 35 ms/);
      assert.ok(error.samples.length >= 1);
      assert.ok(error.samples.some(({ error: sampleError }) => (
        /Hub probe failed: timed out after/.test(sampleError)
      )));
      assert.ok(error.samples.every(({ error: sampleError }) => (
        /Hub probe failed: timed out after|health deadline expired/.test(sampleError)
      )));
      return true;
    }
  );

  assert.ok(Date.now() - startedAt < 1_000);
  assert.ok(requestSignals.length >= 1);
  assert.ok(requestSignals.every(({ aborted }) => aborted));
});

test('waitForEmulatorHealth rejects a healthy sample that completes after its deadline', async () => {
  let now = 0;
  const registrations = {
    auth: {}, firestore: {}, functions: {}, hosting: {}, storage: {},
  };
  const fetchImpl = async (url) => {
    now += 260;
    return okResponse({ body: url.endsWith('/emulators') ? registrations : {} });
  };
  const db = {
    doc: () => ({
      get: async () => {
        now += 260;
        return {
          exists: true,
          data: () => ({ version: 'fixture-v1', hash: 'fixture-hash' }),
        };
      },
    }),
  };

  await assert.rejects(
    waitForEmulatorHealth({
      fetchImpl,
      db,
      expectedManifest: { version: 'fixture-v1', hash: 'fixture-hash' },
      projectId: 'demo-control',
      timeoutMs: 1_000,
      requestTimeoutMs: 1_000,
      consecutiveSamples: 1,
      nowImpl: () => now,
      sleepImpl: async () => {},
    }),
    (error) => {
      assert.match(error.message, /not healthy within 1000 ms/);
      assert.match(error.samples[0].error, /completed after the health deadline/);
      return true;
    }
  );
});

test('assertLogWithinBudget reports size and rejects a possible trigger storm', () => {
  const fsImpl = {
    existsSync: () => true,
    statSync: () => ({ size: DEFAULT_LOG_BUDGET_BYTES }),
  };
  assert.deepEqual(
    assertLogWithinBudget({ logPath: 'firebase-debug.log', fsImpl, projectId: 'demo-control' }),
    {
      logPath: 'firebase-debug.log',
      sizeBytes: DEFAULT_LOG_BUDGET_BYTES,
      maxBytes: DEFAULT_LOG_BUDGET_BYTES,
    }
  );
  assert.throws(
    () => assertLogWithinBudget({
      logPath: 'firebase-debug.log',
      fsImpl: {
        existsSync: () => true,
        statSync: () => ({ size: DEFAULT_LOG_BUDGET_BYTES + 1 }),
      },
      projectId: 'demo-control',
    }),
    (error) => {
      assert.match(error.message, /possible background-trigger storm/);
      assert.deepEqual(error.logBudget, {
        logPath: 'firebase-debug.log',
        sizeBytes: DEFAULT_LOG_BUDGET_BYTES + 1,
        maxBytes: DEFAULT_LOG_BUDGET_BYTES,
      });
      return true;
    }
  );

  const fallbackEvidence = assertLogWithinBudget({
    logPaths: ['firebase-debug.log', 'firebase-debug.1.log'],
    fsImpl: {
      existsSync: (candidate) => candidate === 'firebase-debug.1.log',
      statSync: () => ({ size: 1234 }),
    },
    projectId: 'demo-control',
  });
  assert.deepEqual(fallbackEvidence, {
    logPath: 'firebase-debug.1.log',
    logPaths: ['firebase-debug.log', 'firebase-debug.1.log'],
    files: [{ logPath: 'firebase-debug.1.log', sizeBytes: 1234 }],
    sizeBytes: 1234,
    maxBytes: DEFAULT_LOG_BUDGET_BYTES,
  });

  assert.throws(
    () => assertLogWithinBudget({
      logPaths: ['firebase-debug.log', 'firebase-debug.1.log'],
      fsImpl: { existsSync: () => false },
      projectId: 'demo-control',
    }),
    (error) => {
      assert.match(error.message, /debug log is missing/);
      assert.equal(error.logBudget.missing, true);
      assert.equal(error.logBudget.sizeBytes, 0);
      return true;
    }
  );
});
