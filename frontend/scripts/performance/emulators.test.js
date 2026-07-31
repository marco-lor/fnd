const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  EMULATOR_HARNESS_PORTS,
  EMULATOR_PORT_RELEASE_TIMEOUT_MS,
  FIREBASE_HOSTING_UPSTREAM_PORT,
  PERFORMANCE_FIREBASE_CONFIG_FILENAME,
  PERFORMANCE_STATIC_SERVER_PORT,
  archiveAndDeletePreviousLogs,
  assertEmulatorPortsFree,
  createFirebaseEmulatorArguments,
  createFirebaseCliEnvironment,
  previousLogPaths,
  readBoundedTail,
  removePerformanceFirebaseConfig,
  requestOwnedPosixProcessGroupTermination,
  requestOwnedWindowsProcessTreeTermination,
  waitForEmulatorPortsFree,
  waitForOwnedChildExit,
  withEmulatorPortCleanup,
  writePerformanceFirebaseConfig,
} = require('./emulators');

test('Firebase CLI child is forced offline without mutating or dropping inherited environment', () => {
  const inheritedEnvironment = {
    PATH: 'inherited-path',
    KEEP_ME: 'inherited-value',
    NPM_CONFIG_OFFLINE: 'false',
    npm_config_offline: 'false',
  };
  const overrides = {
    PATH: 'portable-java-path',
    EXTRA_VALUE: 'override-value',
  };

  const environment = createFirebaseCliEnvironment(inheritedEnvironment, overrides);

  assert.deepEqual(inheritedEnvironment, {
    PATH: 'inherited-path',
    KEEP_ME: 'inherited-value',
    NPM_CONFIG_OFFLINE: 'false',
    npm_config_offline: 'false',
  });
  assert.deepEqual(overrides, {
    PATH: 'portable-java-path',
    EXTRA_VALUE: 'override-value',
  });
  assert.equal(environment.PATH, 'portable-java-path');
  assert.equal(environment.KEEP_ME, 'inherited-value');
  assert.equal(environment.EXTRA_VALUE, 'override-value');
  assert.deepEqual(
    Object.entries(environment).filter(([key]) => key.toLowerCase() === 'npm_config_offline'),
    [['npm_config_offline', 'true']]
  );
});

test('performance host ports and Firebase CLI arguments keep Hosting registered off the public port', () => {
  assert.equal(PERFORMANCE_STATIC_SERVER_PORT, 5000);
  assert.equal(FIREBASE_HOSTING_UPSTREAM_PORT, 5002);
  assert.ok(EMULATOR_HARNESS_PORTS.includes(PERFORMANCE_STATIC_SERVER_PORT));
  assert.ok(EMULATOR_HARNESS_PORTS.includes(FIREBASE_HOSTING_UPSTREAM_PORT));
  assert.equal(PERFORMANCE_FIREBASE_CONFIG_FILENAME, '.firebase.performance.generated.json');
  assert.deepEqual(
    createFirebaseEmulatorArguments({
      firebaseCli: 'firebase-cli.js',
      configPath: 'generated-firebase.json',
      lifecycleProjectId: 'demo-fnd-perf',
    }),
    [
      'firebase-cli.js',
      'emulators:start',
      '--project', 'demo-fnd-perf',
      '--config', 'generated-firebase.json',
      '--only', 'auth,firestore,storage,functions,hosting',
      '--log-verbosity', 'INFO',
    ]
  );
});

test('generated performance Firebase config changes only the Hosting emulator port', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-performance-firebase-config-'));
  const sourcePath = path.join(root, 'firebase.json');
  const outputPath = path.join(root, 'firebase.performance.generated.json');
  const source = {
    firestore: { rules: 'firestore.rules' },
    hosting: { public: 'build', rewrites: [{ source: '**', destination: '/index.html' }] },
    functions: [{ source: 'functions' }],
    emulators: {
      auth: { host: '127.0.0.1', port: 9099 },
      firestore: { host: '127.0.0.1', port: 8080 },
      functions: { host: '127.0.0.1', port: 5001 },
      hosting: { host: '127.0.0.1', port: 5000 },
      storage: { host: '127.0.0.1', port: 9199 },
    },
  };
  try {
    const sourceContents = `${JSON.stringify(source, null, 2)}\n`;
    fs.writeFileSync(sourcePath, sourceContents, 'utf8');
    const generated = writePerformanceFirebaseConfig({ sourcePath, outputPath });
    const expected = JSON.parse(JSON.stringify(source));
    expected.emulators.hosting.port = 5002;

    assert.deepEqual(generated, expected);
    assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), expected);
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), sourceContents);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated performance Firebase config cleanup deletes only the exact owned artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-performance-firebase-cleanup-'));
  const generatedPath = path.join(root, PERFORMANCE_FIREBASE_CONFIG_FILENAME);
  const unrelatedPath = path.join(root, 'firebase.performance.preserve.json');
  try {
    fs.writeFileSync(generatedPath, 'generated', 'utf8');
    fs.writeFileSync(unrelatedPath, 'preserve-me', 'utf8');

    assert.equal(removePerformanceFirebaseConfig({ root }), generatedPath);
    assert.equal(fs.existsSync(generatedPath), false);
    assert.equal(fs.readFileSync(unrelatedPath, 'utf8'), 'preserve-me');
    assert.doesNotThrow(() => removePerformanceFirebaseConfig({ root }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authoritative cleanup wait allows the observed Windows socket-release window', () => {
  assert.equal(EMULATOR_PORT_RELEASE_TIMEOUT_MS, 60_000);
});

test('Windows emulator cleanup targets only the captured child tree and preserves taskkill status', () => {
  let invocation;
  const result = requestOwnedWindowsProcessTreeTermination({ pid: 4321 }, {
    spawnSyncImpl: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 128, stdout: '', stderr: 'process already exited' };
    },
  });
  assert.deepEqual(invocation, {
    command: 'taskkill.exe',
    args: ['/PID', '4321', '/T', '/F'],
    options: { encoding: 'utf8', windowsHide: true },
  });
  assert.deepEqual(result, { status: 128, stdout: '', stderr: 'process already exited' });
  assert.throws(
    () => requestOwnedWindowsProcessTreeTermination({ pid: 0 }),
    /child PID is unavailable/
  );
});

test('POSIX emulator cleanup signals only the captured detached process group and can escalate', () => {
  const calls = [];
  const child = { pid: 4321 };
  assert.deepEqual(requestOwnedPosixProcessGroupTermination(child, 'SIGTERM', {
    killImpl: (...args) => calls.push(args),
  }), { processGroupId: 4321, signal: 'SIGTERM' });
  assert.deepEqual(requestOwnedPosixProcessGroupTermination(child, 'SIGKILL', {
    killImpl: (...args) => calls.push(args),
  }), { processGroupId: 4321, signal: 'SIGKILL' });
  assert.deepEqual(calls, [
    [-4321, 'SIGTERM'],
    [-4321, 'SIGKILL'],
  ]);
  assert.throws(
    () => requestOwnedPosixProcessGroupTermination({ pid: 0 }),
    /child PID is unavailable/
  );
});

test('owned emulator cleanup waits for the captured child exit event', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const exited = waitForOwnedChildExit(child, 100);
  setImmediate(() => {
    child.exitCode = 0;
    child.emit('exit', 0, null);
  });
  await exited;
});

test('emulator port preflight reports occupied ports without terminating anything', async () => {
  const calls = [];
  await assert.rejects(
    assertEmulatorPortsFree({
      ports: [4400, 8080],
      probe: async (port) => {
        calls.push(port);
        return port !== 8080;
      },
    }),
    /already occupied: 8080/
  );
  assert.deepEqual(calls, [4400, 8080]);
});

test('authoritative cleanup wait requires consecutive free port samples', async () => {
  const samples = [false, true, false, true, true];
  const delays = [];
  let currentTime = 0;
  let probeCalls = 0;

  const results = await waitForEmulatorPortsFree({
    ports: [8080],
    probe: async () => samples[probeCalls++],
    timeoutMs: 1_000,
    intervalMs: 100,
    stableSamples: 2,
    now: () => currentTime,
    sleep: async (delayMs) => {
      delays.push(delayMs);
      currentTime += delayMs;
    },
  });

  assert.deepEqual(results, [{ port: 8080, free: true }]);
  assert.equal(probeCalls, 5);
  assert.deepEqual(delays, [100, 100, 100, 100]);
});

test('authoritative cleanup wait times out without terminating occupied port owners', async () => {
  const delays = [];
  let currentTime = 0;
  let probeCalls = 0;

  await assert.rejects(
    waitForEmulatorPortsFree({
      ports: [8080, 9150],
      probe: async (port) => {
        probeCalls += 1;
        return port !== 9150;
      },
      timeoutMs: 250,
      intervalMs: 100,
      stableSamples: 2,
      now: () => currentTime,
      sleep: async (delayMs) => {
        delays.push(delayMs);
        currentTime += delayMs;
      },
    }),
    /did not become stably free within 250 ms[\s\S]*Last occupied ports: 9150[\s\S]*No processes were terminated/
  );

  assert.equal(probeCalls, 8);
  assert.deepEqual(delays, [100, 100, 50]);
});

test('emulator lifecycle reports primary and port-cleanup failures together', async () => {
  const operationError = new Error('Playwright disconnected');
  const cleanupError = new Error('ports 8080 and 9150 remain occupied');
  await assert.rejects(
    withEmulatorPortCleanup(
      async () => { throw operationError; },
      {
        waitForPorts: async () => { throw cleanupError; },
        label: 'Authoritative run test-a',
      }
    ),
    (error) => {
      assert.ok(error instanceof global.AggregateError);
      assert.match(error.message, /Authoritative run test-a failed/);
      assert.deepEqual(error.errors, [operationError, cleanupError]);
      return true;
    }
  );
});

test('emulator lifecycle preserves a lone primary failure after successful cleanup', async () => {
  const operationError = new Error('Playwright failed');
  let cleanupCalls = 0;
  await assert.rejects(
    withEmulatorPortCleanup(
      async () => { throw operationError; },
      { waitForPorts: async () => { cleanupCalls += 1; } }
    ),
    (error) => error === operationError
  );
  assert.equal(cleanupCalls, 1);
});

test('emulator lifecycle runs owned artifact cleanup even when the operation fails', async () => {
  const operationError = new Error('Playwright failed');
  const cleanupOrder = [];
  await assert.rejects(
    withEmulatorPortCleanup(
      async () => { throw operationError; },
      {
        waitForPorts: async () => { cleanupOrder.push('ports'); },
        cleanupOwnedArtifacts: async () => { cleanupOrder.push('artifacts'); },
      }
    ),
    (error) => error === operationError
  );
  assert.deepEqual(cleanupOrder, ['ports', 'artifacts']);
});

test('emulator lifecycle aggregates operation, port, and owned artifact cleanup failures', async () => {
  const operationError = new Error('Playwright failed');
  const portError = new Error('ports remain occupied');
  const artifactError = new Error('generated config remains');
  await assert.rejects(
    withEmulatorPortCleanup(
      async () => { throw operationError; },
      {
        waitForPorts: async () => { throw portError; },
        cleanupOwnedArtifacts: async () => { throw artifactError; },
        label: 'Performance CI Playwright run',
      }
    ),
    (error) => {
      assert.ok(error instanceof global.AggregateError);
      assert.match(error.message, /Performance CI Playwright run failed/);
      assert.deepEqual(error.errors, [operationError, portError, artifactError]);
      return true;
    }
  );
});

test('previous emulator logs are archived with bounded tails and only exact files are deleted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-emulator-logs-'));
  const reportDirectory = path.join(root, 'results');
  const emulatorDirectory = path.join(root, '.perf-emulator-data');
  fs.mkdirSync(emulatorDirectory, { recursive: true });
  const firebaseLog = path.join(root, 'firebase-debug.log');
  const firestoreLog = path.join(root, 'firestore-debug.log');
  const emulatorLog = path.join(emulatorDirectory, 'emulator.log');
  const unrelatedLog = path.join(root, 'unrelated-debug.log');

  try {
    fs.writeFileSync(firebaseLog, '0123456789', 'utf8');
    fs.writeFileSync(firestoreLog, 'firestore', 'utf8');
    fs.writeFileSync(emulatorLog, 'emulator', 'utf8');
    fs.writeFileSync(unrelatedLog, 'preserve-me', 'utf8');

    assert.deepEqual(readBoundedTail(firebaseLog, 4), {
      sizeBytes: 10,
      tailBytes: 4,
      tail: '6789',
    });

    const report = archiveAndDeletePreviousLogs({
      root,
      reportDirectory,
      maximumTailBytes: 4,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
    });

    assert.equal(report.totalSizeBytes, 27);
    assert.equal(report.capturedAt, '2026-07-21T00:00:00.000Z');
    assert.equal(report.logs.find(({ path: logPath }) => logPath === 'firebase-debug.log').tail, '6789');
    previousLogPaths(root).forEach((filePath) => assert.equal(fs.existsSync(filePath), false));
    assert.equal(fs.readFileSync(unrelatedLog, 'utf8'), 'preserve-me');
    assert.equal(
      JSON.parse(fs.readFileSync(
        path.join(reportDirectory, 'previous-emulator-logs.json'),
        'utf8'
      )).totalSizeBytes,
      27
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
