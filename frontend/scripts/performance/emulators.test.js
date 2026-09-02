const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
  FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
  EMULATOR_HARNESS_PORTS,
  EMULATOR_PORT_RELEASE_TIMEOUT_MS,
  FIREBASE_HOSTING_UPSTREAM_PORT,
  PERFORMANCE_FIREBASE_CONFIG_FILENAME,
  PERFORMANCE_STATIC_SERVER_PORT,
  archiveAndDeletePreviousLogs,
  assertEmulatorPortsFree,
  createFirebaseEmulatorArguments,
  createFirebaseCliEnvironment,
  createOwnedFirebaseEmulatorSpawnOptions,
  previousLogPaths,
  readBoundedTail,
  removePerformanceFirebaseConfig,
  requestOwnedPosixProcessGroupTermination,
  requestOwnedWindowsGracefulShutdown,
  shutdownOwnedWindowsEmulator,
  requestOwnedWindowsProcessTreeTermination,
  waitForEmulatorPortsFree,
  waitForOwnedChildExit,
  withEmulatorPortCleanup,
  writePerformanceFirebaseConfig,
} = require('./emulators');

const createIpcChild = () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  return child;
};

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

test('Playwright lets the emulator wrapper relay POSIX shutdown before force killing it', () => {
  const playwrightConfig = require('../../performance/playwright.config');
  const gracefulShutdown = playwrightConfig.webServer?.gracefulShutdown;

  assert.ok(gracefulShutdown, 'the performance web server must opt into graceful shutdown');
  assert.equal(gracefulShutdown.signal, 'SIGTERM');
  assert.ok(
    gracefulShutdown.timeout >= 80_000,
    'the graceful window must cover child TERM/KILL waits and stable port release'
  );
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
    options: { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
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

test('Firebase CLI child normalizes Windows PATH casing so portable Java does not hide node', () => {
  const environment = createFirebaseCliEnvironment(
    {
      PATH: 'C:\\stale-java-8',
      Path: 'C:\\Windows\\System32;C:\\Program Files\\nodejs',
      KEEP_ME: 'inherited-value',
    },
    {
      PATH: 'C:\\Program Files\\JetBrains\\PyCharm\\jbr\\bin;C:\\Windows\\System32;C:\\Program Files\\nodejs',
    }
  );

  const pathEntries = Object.entries(environment)
    .filter(([key]) => key.toLowerCase() === 'path');
  assert.deepEqual(pathEntries, [[
    'PATH',
    'C:\\Program Files\\JetBrains\\PyCharm\\jbr\\bin;C:\\Windows\\System32;C:\\Program Files\\nodejs',
  ]]);
  assert.equal(environment.KEEP_ME, 'inherited-value');
});

test('Windows graceful cleanup requires an accepted owned IPC shutdown acknowledgement', async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  const messages = [];
  child.send = (message, callback) => {
    messages.push(message);
    setImmediate(() => {
      child.emit('message', {
        type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
        requestId: message.requestId,
        accepted: true,
        handler: 'firebase-cli-sigint',
      });
      callback?.();
    });
    return true;
  };

  const acknowledgement = await requestOwnedWindowsGracefulShutdown(child, { timeoutMs: 100 });
  assert.deepEqual(messages.map(({ type, requestId }) => ({ type, requestId: typeof requestId })), [{
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'string',
  }]);
  assert.deepEqual(acknowledgement, {
    accepted: true,
    handler: 'firebase-cli-sigint',
    pid: 4321,
  });
  await assert.rejects(
    requestOwnedWindowsGracefulShutdown({ pid: 0 }, { timeoutMs: 1 }),
    /cannot receive an owned IPC shutdown request/
  );
});

test('Windows taskkill fallback is bounded and retains timeout diagnostics for the captured child tree', () => {
  let invocation;
  const result = requestOwnedWindowsProcessTreeTermination({ pid: 4321 }, {
    timeoutMs: 25,
    spawnSyncImpl: (command, args, options) => {
      invocation = { command, args, options };
      const error = new Error('spawnSync taskkill.exe ETIMEDOUT');
      error.code = 'ETIMEDOUT';
      return {
        status: null,
        signal: 'SIGTERM',
        stdout: 'partial stdout',
        stderr: 'partial stderr',
        error,
      };
    },
  });

  assert.deepEqual(invocation, {
    command: 'taskkill.exe',
    args: ['/PID', '4321', '/T', '/F'],
    options: { encoding: 'utf8', windowsHide: true, timeout: 25 },
  });
  assert.deepEqual(result, {
    status: null,
    signal: 'SIGTERM',
    stdout: 'partial stdout',
    stderr: 'partial stderr',
    timedOut: true,
    error: 'spawnSync taskkill.exe ETIMEDOUT',
  });
});

test('Windows supervisor uses an isolated console group so a parent Ctrl+C leaves IPC as its only shutdown path', () => {
  const options = createOwnedFirebaseEmulatorSpawnOptions({
    cwd: 'C:\\workspace\\frontend',
    env: { KEEP_ME: 'value' },
    stdio: ['ignore', 1, 2, 'ipc'],
    platform: 'win32',
  });

  assert.deepEqual(options, {
    cwd: 'C:\\workspace\\frontend',
    env: { KEEP_ME: 'value' },
    stdio: ['ignore', 1, 2, 'ipc'],
    shell: false,
    detached: true,
    windowsHide: true,
  });
});

test('Windows IPC backpressure keeps the acknowledged graceful shutdown ahead of exact-tree fallback', async () => {
  const child = createIpcChild();
  let fallbackCalls = 0;
  child.send = (message, callback) => {
    setImmediate(() => {
      callback?.(null);
      child.emit('message', {
        type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
        requestId: message.requestId,
        accepted: true,
        handler: 'firebase-cli-sigint',
      });
    });
    return false;
  };

  const result = await shutdownOwnedWindowsEmulator({
    child,
    requestTreeTermination: () => { fallbackCalls += 1; },
    waitForChildExit: async () => { child.exitCode = 0; },
    waitForPorts: async () => {},
  });

  assert.equal(fallbackCalls, 0);
  assert.deepEqual(result.graceful, {
    accepted: true,
    handler: 'firebase-cli-sigint',
    pid: 4321,
  });
});

test('Windows graceful IPC shutdown fails closed on send callback error and removes lifecycle listeners', async () => {
  const child = createIpcChild();
  let sendCallback;
  child.send = (_message, callback) => {
    sendCallback = callback;
    return true;
  };

  const pending = requestOwnedWindowsGracefulShutdown(child, { timeoutMs: 100 });
  sendCallback(new Error('IPC channel closed'));

  await assert.rejects(
    pending,
    /graceful shutdown request could not be delivered: IPC channel closed/
  );
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('disconnect'), 0);
});

test('Windows graceful IPC shutdown fails closed when its IPC channel disconnects before acknowledgement', async () => {
  const child = createIpcChild();
  child.send = () => true;

  const pending = requestOwnedWindowsGracefulShutdown(child, { timeoutMs: 100 });
  child.connected = false;
  child.emit('disconnect');

  await assert.rejects(pending, /IPC channel disconnected before graceful shutdown acknowledgement/);
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('disconnect'), 0);
});

test('Windows graceful IPC shutdown ignores mismatched acknowledgements and accepts only its matching valid acknowledgement', async () => {
  const child = createIpcChild();
  child.send = (message, callback) => {
    setImmediate(() => {
      child.emit('message', {
        type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
        requestId: 'another-request',
        accepted: false,
        reason: 'not-this-request',
      });
      child.emit('message', {
        type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
        requestId: message.requestId,
        accepted: true,
        handler: 'firebase-cli-sigint',
      });
      callback?.(null);
    });
    return true;
  };

  await assert.doesNotReject(requestOwnedWindowsGracefulShutdown(child, { timeoutMs: 100 }));
});

test('Windows graceful IPC shutdown rejects a matching supervisor rejection without accepting a later acknowledgement', async () => {
  const child = createIpcChild();
  let request;
  child.send = (message) => {
    request = message;
    return true;
  };

  const pending = requestOwnedWindowsGracefulShutdown(child, { timeoutMs: 100 });
  child.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
    requestId: request.requestId,
    accepted: false,
    reason: 'firebase-cli-sigint-handler-missing',
  });

  await assert.rejects(pending, /firebase-cli-sigint-handler-missing/);
  assert.doesNotThrow(() => child.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
    requestId: request.requestId,
    accepted: true,
    handler: 'firebase-cli-sigint',
  }));
});

test('Windows graceful IPC shutdown fails closed when the owned child emits an IPC error before acknowledgement', async () => {
  const child = createIpcChild();
  child.send = () => true;

  const pending = requestOwnedWindowsGracefulShutdown(child, { timeoutMs: 100 });
  child.emit('error', new Error('write EPIPE'));

  await assert.rejects(pending, /IPC channel errored before graceful shutdown acknowledgement: write EPIPE/);
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('disconnect'), 0);
});

test('Windows graceful IPC shutdown rejects matching malformed acknowledgement and ignores late events after settlement', async () => {
  const child = createIpcChild();
  let request;
  let sendCallback;
  child.send = (message, callback) => {
    request = message;
    sendCallback = callback;
    return true;
  };

  const pending = requestOwnedWindowsGracefulShutdown(child, { timeoutMs: 100 });
  child.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
    requestId: request.requestId,
    accepted: true,
    handler: 'wrong-handler',
  });
  await assert.rejects(pending, /graceful shutdown was rejected/);
  assert.doesNotThrow(() => {
    sendCallback?.(null);
    child.emit('message', {
      type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
      requestId: request.requestId,
      accepted: true,
      handler: 'firebase-cli-sigint',
    });
  });
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('disconnect'), 0);
});

test('Windows graceful IPC shutdown fails when its wrapper exits before a valid acknowledgement', async () => {
  const child = createIpcChild();
  child.send = () => true;

  const pending = requestOwnedWindowsGracefulShutdown(child, { timeoutMs: 100 });
  child.exitCode = 1;
  child.emit('exit', 1, null);

  await assert.rejects(pending, /exited before graceful shutdown acknowledgement/);
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('disconnect'), 0);
});

test('Windows graceful IPC shutdown times out without acknowledgement and ignores late callback or acknowledgement', async () => {
  const child = createIpcChild();
  let request;
  let sendCallback;
  child.send = (message, callback) => {
    request = message;
    sendCallback = callback;
    return true;
  };

  const pending = requestOwnedWindowsGracefulShutdown(child, { timeoutMs: 10 });
  const keepAlive = setTimeout(() => {}, 20);
  try {
    await assert.rejects(pending, /acknowledgement did not arrive within 10 ms/);
  } finally {
    clearTimeout(keepAlive);
  }
  assert.doesNotThrow(() => {
    sendCallback?.(null);
    child.emit('message', {
      type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
      requestId: request.requestId,
      accepted: true,
      handler: 'firebase-cli-sigint',
    });
  });
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('disconnect'), 0);
});

test('Windows owned shutdown records acknowledgement, child exit, and stable ports before success', async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.signalCode = null;
  const calls = [];
  const result = await shutdownOwnedWindowsEmulator({
    child,
    requestGracefulShutdown: async (capturedChild) => {
      calls.push(['graceful', capturedChild.pid]);
      capturedChild.exitCode = 0;
      capturedChild.emit('exit', 0, null);
      return { accepted: true, handler: 'firebase-cli-sigint', pid: capturedChild.pid };
    },
    requestTreeTermination: () => {
      calls.push(['taskkill']);
      return { status: 0, stdout: '', stderr: '' };
    },
    waitForChildExit: async () => calls.push(['exit']),
    waitForPorts: async () => calls.push(['ports']),
  });

  assert.deepEqual(calls, [['graceful', 4321], ['exit'], ['ports']]);
  assert.equal(result.fallback, null);
  assert.deepEqual(result.graceful, { accepted: true, handler: 'firebase-cli-sigint', pid: 4321 });
  assert.deepEqual(result.exit, { exited: true, pid: 4321 });
  assert.deepEqual(result.ports, { stable: true });
});

test('Windows shutdown settles an early direct child SIGINT plus matching IPC acknowledgement through one exact-tree fallback', async () => {
  const child = createIpcChild();
  child.directSigintReceived = true;
  const calls = [];
  let exitWaits = 0;

  const result = await shutdownOwnedWindowsEmulator({
    child,
    requestGracefulShutdown: async (capturedChild) => {
      calls.push(['ipc', capturedChild.pid, capturedChild.directSigintReceived]);
      return { accepted: true, handler: 'firebase-cli-sigint', pid: capturedChild.pid };
    },
    requestTreeTermination: (capturedChild) => {
      calls.push(['taskkill', capturedChild.pid]);
      return { status: 0, stdout: 'SUCCESS', stderr: '' };
    },
    waitForChildExit: async (capturedChild) => {
      exitWaits += 1;
      if (exitWaits === 1) {
        throw new Error('Owned Firebase emulator process did not exit within 10000 ms.');
      }
      capturedChild.exitCode = 0;
      capturedChild.emit('exit', 0, null);
    },
    waitForPorts: async () => calls.push(['ports-free']),
  });

  assert.deepEqual(calls, [
    ['ipc', 4321, true],
    ['taskkill', 4321],
    ['ports-free'],
  ]);
  assert.equal(exitWaits, 2);
  assert.deepEqual(result.fallback, { status: 0, stdout: 'SUCCESS', stderr: '' });
  assert.deepEqual(result.exit, { exited: true, pid: 4321 });
  assert.deepEqual(result.ports, { stable: true });
});

test('Windows shutdown reports a timed-out exact-tree fallback once and leaves no graceful IPC listeners', async () => {
  const child = createIpcChild();
  let fallbackCalls = 0;

  await assert.rejects(
    shutdownOwnedWindowsEmulator({
      child,
      requestGracefulShutdown: async () => ({
        accepted: true,
        handler: 'firebase-cli-sigint',
        pid: child.pid,
      }),
      requestTreeTermination: () => {
        fallbackCalls += 1;
        return {
          status: null,
          stdout: 'partial stdout',
          stderr: 'partial stderr',
          signal: 'SIGTERM',
          timedOut: true,
          error: 'spawnSync taskkill.exe ETIMEDOUT',
        };
      },
      waitForChildExit: async () => {
        throw new Error('Owned Firebase emulator process did not exit within 10000 ms.');
      },
      waitForPorts: async () => {},
    }),
    (error) => {
      assert.ok(error instanceof global.AggregateError);
      assert.match(error.errors.map((entry) => entry.message).join('\n'), /taskkill fallback failed with status null/);
      assert.match(error.errors.map((entry) => entry.message).join('\n'), /timed out/);
      assert.match(error.errors.map((entry) => entry.message).join('\n'), /ETIMEDOUT/);
      assert.deepEqual(error.shutdownDiagnostics.fallback, {
        status: null,
        stdout: 'partial stdout',
        stderr: 'partial stderr',
        signal: 'SIGTERM',
        timedOut: true,
        error: 'spawnSync taskkill.exe ETIMEDOUT',
      });
      return true;
    }
  );
  assert.equal(fallbackCalls, 1);
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('disconnect'), 0);
});

test('Windows owned shutdown never accepts a wrapper exit while its owned descendant ports remain occupied', async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.signalCode = null;
  await assert.rejects(
    shutdownOwnedWindowsEmulator({
      child,
      requestGracefulShutdown: async () => ({
        accepted: true,
        handler: 'firebase-cli-sigint',
        pid: 4321,
      }),
      waitForChildExit: async () => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
      },
      waitForPorts: async () => {
        throw new Error('owned descendant ports 8080 and 9150 remain occupied');
      },
    }),
    (error) => {
      assert.ok(error instanceof global.AggregateError);
      assert.match(error.message, /shutdown failed/);
      assert.deepEqual(error.shutdownDiagnostics, {
        acknowledgement: { accepted: true, handler: 'firebase-cli-sigint', pid: 4321 },
        exit: { exited: true, pid: 4321 },
        fallback: null,
        ports: { stable: false },
      });
      return true;
    }
  );
});

test('Windows owned shutdown fails closed when the exact-child taskkill fallback is denied and cleanup is not stable', async () => {
  const child = { pid: 4321, exitCode: null, signalCode: null };
  const calls = [];
  await assert.rejects(
    shutdownOwnedWindowsEmulator({
      child,
      requestGracefulShutdown: () => {
        throw new Error('graceful signal was not delivered');
      },
      requestTreeTermination: (capturedChild) => {
        calls.push(capturedChild.pid);
        return { status: 5, stdout: '', stderr: 'Access is denied.' };
      },
      waitForChildExit: async () => {
        throw new Error('Owned Firebase emulator process did not exit within 10000 ms.');
      },
      waitForPorts: async () => {
        throw new Error('Performance emulator harness ports did not become stably free.');
      },
    }),
    (error) => {
      assert.ok(error instanceof global.AggregateError);
      assert.match(error.message, /Owned Firebase emulator shutdown failed/);
      assert.match(error.errors.map((entry) => entry.message).join('\n'), /Access is denied/);
      return true;
    }
  );
  assert.deepEqual(calls, [4321]);
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
