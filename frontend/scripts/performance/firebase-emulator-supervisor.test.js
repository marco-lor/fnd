const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('events');
const {
  FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
  FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
  requestOwnedPosixSupervisorProcessGroupTermination,
  requestOwnedSupervisorTreeTermination,
  requestOwnedWindowsSupervisorTreeTermination,
  retainExactSupervisorRootOwnership,
  runFirebaseEmulatorSupervisor,
} = require('./firebase-emulator-supervisor');

const createProcess = () => {
  const processImpl = new EventEmitter();
  processImpl.connected = true;
  processImpl.sentMessages = [];
  processImpl.send = (message) => processImpl.sentMessages.push(message);
  return processImpl;
};

const delay = (timeoutMs) => new Promise((resolve) => setTimeout(resolve, timeoutMs));

const waitFor = async (predicate, {
  timeoutMs = 20_000,
  intervalMs = 50,
  description = 'condition',
} = {}) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await delay(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}.`);
};

const reserveOwnedLoopbackPort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
    const address = server.address();
    server.close((error) => {
      if (error) reject(error);
      else resolve(address.port);
    });
  });
});

const isExactProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
};

const canBindOwnedLoopbackPort = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
    server.close((error) => resolve(!error));
  });
});

const waitForStableOwnedPort = async (port) => {
  await waitFor(async () => {
    if (!await canBindOwnedLoopbackPort(port)) return false;
    await delay(100);
    return canBindOwnedLoopbackPort(port);
  }, { description: `owned loopback port ${port} to become stably free` });
};

const runOwnedParentLossProbe = async (mode, { requestBeforeDisconnect = false } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `fnd-supervisor-${mode}-`));
  const statePath = path.join(root, 'owned-tree.json');
  const port = await reserveOwnedLoopbackPort();
  const supervisorPath = path.join(__dirname, 'firebase-emulator-supervisor.js');
  const fixturePath = path.join(__dirname, 'firebase-emulator-supervisor-probe-fixture.js');
  const stderr = [];
  const child = childProcess.fork(
    supervisorPath,
    [fixturePath, mode, statePath, String(port)],
    {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    }
  );
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  let state = null;
  const startedAt = Date.now();
  try {
    state = await waitFor(() => {
      if (!fs.existsSync(statePath)) return false;
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return parsed.ready ? parsed : false;
    }, { description: `${mode} owned descendant readiness` });
    assert.equal(state.mode, mode);
    assert.equal(state.supervisorPid, child.pid);
    assert.ok(Number.isInteger(state.descendantPid) && state.descendantPid > 0);
    assert.equal(state.port, port);
    assert.equal(await canBindOwnedLoopbackPort(port), false);

    if (requestBeforeDisconnect) {
      const requestId = `connected-rejection-${mode}`;
      const acknowledgement = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${mode} connected rejection.`)),
          5_000
        );
        const handleMessage = (message) => {
          if (
            message?.type !== FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE
            || message.requestId !== requestId
          ) return;
          clearTimeout(timeout);
          child.removeListener('message', handleMessage);
          resolve(message);
        };
        child.on('message', handleMessage);
        child.send({
          type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
          requestId,
        }, (error) => {
          if (!error) return;
          clearTimeout(timeout);
          child.removeListener('message', handleMessage);
          reject(error);
        });
      });
      assert.equal(acknowledgement.accepted, false);
      assert.match(acknowledgement.reason, /controlled Firebase CLI SIGINT failure/);
    }

    child.disconnect();

    await waitFor(
      () => !isExactProcessAlive(state.supervisorPid) && !isExactProcessAlive(state.descendantPid),
      {
        description: `${mode} exact owned tree to disappear`,
        timeoutMs: requestBeforeDisconnect ? 5_000 : 20_000,
      }
    );
    await waitForStableOwnedPort(port);
    const evidence = {
      case: mode,
      supervisorPid: state.supervisorPid,
      descendantPid: state.descendantPid,
      port,
      boundedMs: Date.now() - startedAt,
      supervisorGone: !isExactProcessAlive(state.supervisorPid),
      descendantGone: !isExactProcessAlive(state.descendantPid),
      portStablyFree: await canBindOwnedLoopbackPort(port),
    };
    console.log(`OWNED_PARENT_LOSS_PROBE ${JSON.stringify(evidence)}`);
    assert.deepEqual({
      supervisorGone: evidence.supervisorGone,
      descendantGone: evidence.descendantGone,
      portStablyFree: evidence.portStablyFree,
    }, {
      supervisorGone: true,
      descendantGone: true,
      portStablyFree: true,
    });
    assert.match(stderr.join(''), /bounded exact-tree taskkill fallback/);
    return evidence;
  } finally {
    if (child.connected) {
      try {
        child.disconnect();
      } catch (_error) {
        // The exact tree cleanup below remains authoritative.
      }
    }
    if (Number.isInteger(child.pid) && isExactProcessAlive(child.pid)) {
      childProcess.spawnSync(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { encoding: 'utf8', windowsHide: true, timeout: 10_000 }
      );
    }
    child.stderr.destroy();
    if (state?.descendantPid && isExactProcessAlive(state.descendantPid)) {
      throw new Error(
        `Owned ${mode} descendant PID ${state.descendantPid} survived exact supervisor-tree cleanup.`
      );
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('Windows terminal fallback keeps a no-other-ref caller alive until helper settlement', () => {
  const fixturePath = path.join(
    __dirname,
    'firebase-emulator-supervisor-liveness-probe-fixture.js'
  );
  const startedAt = Date.now();
  const probe = childProcess.spawnSync(
    process.execPath,
    [fixturePath, 'helper-exit', '750', '5000'],
    {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    }
  );
  const elapsedMs = Date.now() - startedAt;
  const evidenceLine = String(probe.stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith('FALLBACK_LIVENESS '));

  assert.equal(probe.error, undefined);
  assert.equal(probe.status, 23, probe.stderr || probe.stdout);
  assert.ok(evidenceLine, `Missing liveness settlement evidence; elapsedMs=${elapsedMs}`);
  const evidence = JSON.parse(evidenceLine.slice('FALLBACK_LIVENESS '.length));
  assert.equal(evidence.settlement, 'helper-exit');
  assert.match(evidence.diagnostic, /taskkill exited with code 0/);
  assert.ok(evidence.elapsedMs >= 650, `helper settled too early: ${evidence.elapsedMs} ms`);
  assert.ok(elapsedMs >= 650, `caller exited naturally too early: ${elapsedMs} ms`);
  console.log(`CONTROLLED_FALLBACK_LIVENESS ${JSON.stringify({
    ...evidence,
    callerElapsedMs: elapsedMs,
    exitCode: probe.status,
  })}`);
});

test('Windows terminal fallback deadline kills and releases its exact long-lived helper promptly', () => {
  const fixturePath = path.join(
    __dirname,
    'firebase-emulator-supervisor-liveness-probe-fixture.js'
  );
  const probe = childProcess.spawnSync(
    process.execPath,
    [fixturePath, 'deadline', '1200', '50'],
    {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }
  );
  const evidenceLine = String(probe.stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith('FALLBACK_DEADLINE '));

  assert.equal(probe.error, undefined);
  assert.equal(probe.status, 24, probe.stderr || probe.stdout);
  assert.ok(evidenceLine, 'Missing deadline helper-cleanup evidence.');
  const evidence = JSON.parse(evidenceLine.slice('FALLBACK_DEADLINE '.length));
  assert.equal(evidence.settlement, 'deadline');
  assert.match(evidence.diagnostic, /did not terminate/);
  assert.equal(evidence.helperGone, true);
  assert.ok(evidence.elapsedMs < 600, `deadline helper survived too long: ${evidence.elapsedMs} ms`);
  console.log(`CONTROLLED_FALLBACK_DEADLINE ${JSON.stringify(evidence)}`);
});

test('Windows terminal fallback async error kills and releases its exact helper handle promptly', () => {
  const fixturePath = path.join(
    __dirname,
    'firebase-emulator-supervisor-liveness-probe-fixture.js'
  );
  const probe = childProcess.spawnSync(
    process.execPath,
    [fixturePath, 'helper-error', '1200', '5000'],
    {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }
  );
  const evidenceLine = String(probe.stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith('FALLBACK_HELPER_ERROR '));

  assert.equal(probe.error, undefined);
  assert.equal(probe.status, 25, probe.stderr || probe.stdout);
  assert.ok(evidenceLine, 'Missing async-error helper-cleanup evidence.');
  const evidence = JSON.parse(evidenceLine.slice('FALLBACK_HELPER_ERROR '.length));
  assert.equal(evidence.settlement, 'helper-error');
  assert.match(evidence.diagnostic, /controlled async helper failure/);
  assert.equal(evidence.helperGone, true);
  assert.ok(evidence.elapsedMs < 600, `errored helper survived too long: ${evidence.elapsedMs} ms`);
  console.log(`CONTROLLED_FALLBACK_HELPER_ERROR ${JSON.stringify(evidence)}`);
});

test('supervisor relays a parent-owned shutdown request to Firebase CLI SIGINT in-process', () => {
  const processImpl = createProcess();
  const argv = ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start', '--only', 'firestore'];
  let requiredCli;
  let receivedSigint = 0;

  runFirebaseEmulatorSupervisor({
    argv,
    processImpl,
    requireImpl: (firebaseCli) => {
      requiredCli = firebaseCli;
      processImpl.on('SIGINT', () => { receivedSigint += 1; });
    },
  });

  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-1',
  });

  assert.equal(requiredCli, 'firebase-cli.js');
  assert.deepEqual(processImpl.argv, ['node', 'firebase-cli.js', 'emulators:start', '--only', 'firestore']);
  assert.equal(receivedSigint, 1);
  assert.deepEqual(processImpl.sentMessages, [{
    type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
    requestId: 'request-1',
    accepted: true,
    handler: 'firebase-cli-sigint',
  }]);
});

test('supervisor relays parent IPC disconnect to Firebase CLI SIGINT in-process exactly once', () => {
  const processImpl = createProcess();
  let receivedSigint = 0;
  processImpl.send = () => {
    throw new Error('supervisor must not send after parent IPC disconnect');
  };

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => { receivedSigint += 1; });
    },
  });

  processImpl.connected = false;
  processImpl.emit('disconnect');
  processImpl.emit('disconnect');

  assert.equal(receivedSigint, 1);
  assert.deepEqual(processImpl.sentMessages, []);
});

test('supervisor settles a parent disconnect observed during Firebase CLI initialization after its SIGINT handler registers', () => {
  const processImpl = createProcess();
  let receivedSigint = 0;

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.connected = false;
      processImpl.emit('disconnect');
      processImpl.on('SIGINT', () => { receivedSigint += 1; });
    },
  });

  assert.equal(receivedSigint, 1);
  assert.deepEqual(processImpl.sentMessages, []);
  assert.equal(processImpl.listenerCount('disconnect'), 0);
});

test('supervisor keeps accepted explicit shutdown idempotent across disconnect and late messages', () => {
  const processImpl = createProcess();
  let receivedSigint = 0;

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => { receivedSigint += 1; });
    },
  });

  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-accepted',
  });
  processImpl.connected = false;
  processImpl.emit('disconnect');
  processImpl.emit('disconnect');
  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-late',
  });

  assert.equal(receivedSigint, 1);
  assert.deepEqual(processImpl.sentMessages, [{
    type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
    requestId: 'request-accepted',
    accepted: true,
    handler: 'firebase-cli-sigint',
  }]);
  assert.equal(processImpl.listenerCount('disconnect'), 0);
});

test('supervisor rejects a repeated connected shutdown request without emitting SIGINT twice', () => {
  const processImpl = createProcess();
  let receivedSigint = 0;

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => { receivedSigint += 1; });
    },
  });

  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-first',
  });
  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-duplicate',
  });

  assert.equal(receivedSigint, 1);
  assert.deepEqual(processImpl.sentMessages, [{
    type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
    requestId: 'request-first',
    accepted: true,
    handler: 'firebase-cli-sigint',
  }, {
    type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
    requestId: 'request-duplicate',
    accepted: false,
    reason: 'duplicate-request',
  }]);
});

test('supervisor tolerates missing SIGINT handler on early disconnect and retries only after initialization', () => {
  const processImpl = createProcess();
  let receivedSigint = 0;

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.connected = false;
      processImpl.emit('disconnect');
      assert.equal(receivedSigint, 0);
      processImpl.on('SIGINT', () => { receivedSigint += 1; });
    },
  });

  assert.equal(receivedSigint, 1);
});

test('supervisor removes its lifecycle listeners when Firebase CLI initialization fails', () => {
  const processImpl = createProcess();
  const startupFailure = new Error('Firebase CLI startup failed');

  assert.throws(
    () => runFirebaseEmulatorSupervisor({
      argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
      processImpl,
      requireImpl: () => {
        processImpl.connected = false;
        processImpl.emit('disconnect');
        throw startupFailure;
      },
    }),
    startupFailure
  );

  assert.equal(processImpl.listenerCount('message'), 0);
  assert.equal(processImpl.listenerCount('disconnect'), 0);
  assert.deepEqual(processImpl.sentMessages, []);
});

test('supervisor contains a closing-channel send error after accepting explicit shutdown', () => {
  const processImpl = createProcess();
  let receivedSigint = 0;
  processImpl.send = () => {
    processImpl.connected = false;
    throw new Error('IPC channel closed');
  };

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => { receivedSigint += 1; });
    },
  });

  assert.doesNotThrow(() => processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-send-race',
  }));
  assert.equal(receivedSigint, 1);
});

test('supervisor contains a Firebase CLI SIGINT listener error on disconnect without retrying or sending', () => {
  const processImpl = createProcess();
  let receivedSigint = 0;
  let terminalFallbacks = 0;

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => {
        receivedSigint += 1;
        throw new Error('Firebase CLI shutdown failed');
      });
    },
    terminateOwnedTreeImpl: () => { terminalFallbacks += 1; },
  });

  processImpl.connected = false;
  assert.doesNotThrow(() => processImpl.emit('disconnect'));
  assert.doesNotThrow(() => processImpl.emit('disconnect'));

  assert.equal(receivedSigint, 1);
  assert.equal(terminalFallbacks, 1);
  assert.deepEqual(processImpl.sentMessages, []);
  assert.equal(processImpl.listenerCount('disconnect'), 0);
});

test('supervisor makes parent loss terminal when Firebase CLI initialization finishes without a SIGINT handler', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const terminalFallbacks = [];
  const exitCodes = [];
  processImpl.exit = (code) => {
    exitCodes.push(code);
    processImpl.exitCode = code;
  };

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.connected = false;
      processImpl.emit('disconnect');
    },
    terminateOwnedTreeImpl: ({ processImpl: ownedProcess, reason }) => {
      terminalFallbacks.push({ rootPid: ownedProcess.pid, reason });
      ownedProcess.exit(1);
    },
  });

  processImpl.emit('disconnect');
  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'late-after-terminal-fallback',
  });

  assert.deepEqual(terminalFallbacks, [{
    rootPid: 4321,
    reason: 'firebase-cli-sigint-handler-missing',
  }]);
  assert.deepEqual(exitCodes, [1]);
  assert.equal(processImpl.exitCode, 1);
  assert.equal(processImpl.listenerCount('message'), 0);
  assert.equal(processImpl.listenerCount('disconnect'), 0);
  assert.deepEqual(processImpl.sentMessages, []);
});

test('supervisor makes parent loss terminal when the Firebase CLI SIGINT handler throws', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const terminalFallbacks = [];
  const exitCodes = [];
  let receivedSigint = 0;
  processImpl.exit = (code) => {
    exitCodes.push(code);
    processImpl.exitCode = code;
  };

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => {
        receivedSigint += 1;
        throw new Error('Firebase CLI shutdown failed');
      });
    },
    terminateOwnedTreeImpl: ({ processImpl: ownedProcess, reason }) => {
      terminalFallbacks.push({ rootPid: ownedProcess.pid, reason });
      ownedProcess.exit(1);
    },
  });

  processImpl.connected = false;
  assert.doesNotThrow(() => processImpl.emit('disconnect'));
  assert.doesNotThrow(() => processImpl.emit('disconnect'));

  assert.equal(receivedSigint, 1);
  assert.deepEqual(terminalFallbacks, [{
    rootPid: 4321,
    reason: 'Firebase CLI shutdown failed',
  }]);
  assert.deepEqual(exitCodes, [1]);
  assert.equal(processImpl.exitCode, 1);
  assert.equal(processImpl.listenerCount('message'), 0);
  assert.equal(processImpl.listenerCount('disconnect'), 0);
  assert.deepEqual(processImpl.sentMessages, []);
});

test('Windows terminal fallback keeps its exact helper and deadline authoritative until settlement', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const helper = new EventEmitter();
  helper.refCalls = 0;
  helper.unrefCalls = 0;
  helper.ref = () => { helper.refCalls += 1; };
  helper.unref = () => { helper.unrefCalls += 1; };
  const spawnCalls = [];
  const timers = [];
  const clearedTimers = [];
  const diagnostics = [];
  const retainedRoots = [];

  const result = requestOwnedWindowsSupervisorTreeTermination({
    platform: 'win32',
    processImpl,
    reason: 'firebase-cli-sigint-handler-missing',
    timeoutMs: 25,
    spawnImpl: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return helper;
    },
    setTimeoutImpl: (callback, timeoutMs) => {
      const timer = { callback, timeoutMs, refCalls: 0, unrefCalls: 0 };
      timer.ref = () => { timer.refCalls += 1; };
      timer.unref = () => { timer.unrefCalls += 1; };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { clearedTimers.push(timer); },
    writeDiagnosticImpl: (diagnostic) => { diagnostics.push(diagnostic); },
    retainExactRootOwnershipImpl: (ownership) => { retainedRoots.push(ownership); },
  });

  assert.deepEqual(spawnCalls, [{
    command: 'taskkill.exe',
    args: ['/PID', '4321', '/T', '/F'],
    options: {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  }]);
  assert.deepEqual(result, {
    command: 'taskkill.exe',
    args: ['/PID', '4321', '/T', '/F'],
    rootPid: 4321,
    timeoutMs: 25,
  });
  assert.equal(helper.refCalls, 1);
  assert.equal(helper.unrefCalls, 0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].timeoutMs, 25);
  assert.equal(timers[0].refCalls, 1);
  assert.equal(timers[0].unrefCalls, 0);
  assert.deepEqual(retainedRoots, []);

  helper.emit('exit', 0, null);

  assert.equal(processImpl.exitCode, 1);
  assert.equal(retainedRoots.length, 1);
  assert.equal(retainedRoots[0].rootPid, 4321);
  assert.match(retainedRoots[0].diagnostic, /taskkill exited with code 0/);
  assert.deepEqual(clearedTimers, [timers[0]]);
  assert.equal(helper.unrefCalls, 1);
  assert.equal(helper.listenerCount('error'), 0);
  assert.equal(helper.listenerCount('exit'), 0);
  assert.match(diagnostics.join('\n'), /rootPid=4321/);
  assert.match(diagnostics.join('\n'), /firebase-cli-sigint-handler-missing/);
  assert.match(diagnostics.join('\n'), /taskkill exited with code 0/);
});

test('Windows terminal fallback retains the exact root when taskkill launch throws', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const timers = [];
  const clearedTimers = [];
  const diagnostics = [];
  const retainedRoots = [];

  assert.doesNotThrow(() => requestOwnedWindowsSupervisorTreeTermination({
    platform: 'win32',
    processImpl,
    reason: 'Firebase CLI shutdown failed',
    timeoutMs: 25,
    spawnImpl: () => { throw new Error('spawn taskkill EPERM'); },
    setTimeoutImpl: (callback, timeoutMs) => {
      const timer = { callback, timeoutMs, ref() {}, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => { clearedTimers.push(timer); },
    writeDiagnosticImpl: (diagnostic) => { diagnostics.push(diagnostic); },
    retainExactRootOwnershipImpl: (ownership) => { retainedRoots.push(ownership); },
  }));

  assert.equal(processImpl.exitCode, 1);
  assert.equal(retainedRoots.length, 1);
  assert.deepEqual(clearedTimers, [timers[0]]);
  assert.match(diagnostics.join('\n'), /Firebase CLI shutdown failed/);
  assert.match(diagnostics.join('\n'), /taskkill launch failed: spawn taskkill EPERM/);
});

test('Windows terminal fallback retains the exact root when launch returns no observable helper', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const retainedRoots = [];
  const diagnostics = [];

  requestOwnedWindowsSupervisorTreeTermination({
    platform: 'win32',
    processImpl,
    timeoutMs: 25,
    spawnImpl: () => null,
    setTimeoutImpl: (callback, timeoutMs) => ({ callback, timeoutMs, ref() {} }),
    clearTimeoutImpl: () => {},
    writeDiagnosticImpl: (diagnostic) => { diagnostics.push(diagnostic); },
    retainExactRootOwnershipImpl: (ownership) => { retainedRoots.push(ownership); },
  });

  assert.equal(processImpl.exitCode, 1);
  assert.equal(retainedRoots.length, 1);
  assert.match(diagnostics.join('\n'), /no observable child process/);
});

test('Windows terminal fallback retains the exact root on timeout and ignores late helper events', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const helper = new EventEmitter();
  helper.refCalls = 0;
  helper.unrefCalls = 0;
  helper.killCalls = 0;
  helper.ref = () => { helper.refCalls += 1; };
  helper.unref = () => { helper.unrefCalls += 1; };
  helper.kill = () => { helper.killCalls += 1; return true; };
  let timer;
  const clearedTimers = [];
  const diagnostics = [];
  const retainedRoots = [];

  requestOwnedWindowsSupervisorTreeTermination({
    platform: 'win32',
    processImpl,
    reason: 'firebase-cli-sigint-handler-missing',
    timeoutMs: 25,
    spawnImpl: () => helper,
    setTimeoutImpl: (callback, timeoutMs) => {
      timer = { callback, timeoutMs, refCalls: 0 };
      timer.ref = () => { timer.refCalls += 1; };
      return timer;
    },
    clearTimeoutImpl: (ownedTimer) => { clearedTimers.push(ownedTimer); },
    writeDiagnosticImpl: (diagnostic) => { diagnostics.push(diagnostic); },
    retainExactRootOwnershipImpl: (ownership) => { retainedRoots.push(ownership); },
  });

  assert.equal(helper.refCalls, 1);
  assert.equal(helper.unrefCalls, 0);
  assert.equal(helper.killCalls, 0);
  assert.equal(timer.refCalls, 1);

  const lateError = helper.listeners('error')[0];
  const lateExit = helper.listeners('exit')[0];
  timer.callback();
  assert.doesNotThrow(() => {
    lateError(new Error('late helper error'));
    lateExit(5, null);
    timer.callback();
  });

  assert.equal(processImpl.exitCode, 1);
  assert.equal(retainedRoots.length, 1);
  assert.equal(helper.killCalls, 1);
  assert.equal(helper.unrefCalls, 1);
  assert.deepEqual(clearedTimers, [timer]);
  assert.equal(helper.listenerCount('error'), 0);
  assert.equal(helper.listenerCount('exit'), 0);
  assert.match(diagnostics.join('\n'), /did not terminate rootPid=4321 within 25 ms/);
  assert.doesNotMatch(diagnostics.join('\n'), /code 5/);
});

test('Windows terminal fallback retains the exact root once on async helper error', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const helper = new EventEmitter();
  helper.refCalls = 0;
  helper.unrefCalls = 0;
  helper.killCalls = 0;
  helper.ref = () => { helper.refCalls += 1; };
  helper.unref = () => { helper.unrefCalls += 1; };
  helper.kill = () => { helper.killCalls += 1; return true; };
  const retainedRoots = [];
  const diagnostics = [];
  const clearedTimers = [];
  let timer;

  requestOwnedWindowsSupervisorTreeTermination({
    platform: 'win32',
    processImpl,
    timeoutMs: 25,
    spawnImpl: () => helper,
    setTimeoutImpl: (callback, timeoutMs) => {
      timer = { callback, timeoutMs, ref() {} };
      return timer;
    },
    clearTimeoutImpl: (ownedTimer) => { clearedTimers.push(ownedTimer); },
    writeDiagnosticImpl: (diagnostic) => { diagnostics.push(diagnostic); },
    retainExactRootOwnershipImpl: (ownership) => { retainedRoots.push(ownership); },
  });

  const lateExit = helper.listeners('exit')[0];
  helper.emit('error', new Error('taskkill async EPERM'));
  assert.doesNotThrow(() => lateExit(5, null));

  assert.equal(processImpl.exitCode, 1);
  assert.equal(retainedRoots.length, 1);
  assert.equal(helper.refCalls, 1);
  assert.equal(helper.killCalls, 1);
  assert.equal(helper.unrefCalls, 1);
  assert.deepEqual(clearedTimers, [timer]);
  assert.equal(helper.listenerCount('error'), 0);
  assert.equal(helper.listenerCount('exit'), 0);
  assert.match(diagnostics.join('\n'), /taskkill failed: taskkill async EPERM/);
  assert.doesNotMatch(diagnostics.join('\n'), /code 5/);
});

test('Windows terminal fallback retains the exact root on an early nonzero helper exit', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const helper = new EventEmitter();
  helper.ref = () => {};
  const retainedRoots = [];
  const diagnostics = [];

  requestOwnedWindowsSupervisorTreeTermination({
    platform: 'win32',
    processImpl,
    timeoutMs: 25,
    spawnImpl: () => helper,
    setTimeoutImpl: (callback, timeoutMs) => ({ callback, timeoutMs, ref() {} }),
    clearTimeoutImpl: () => {},
    writeDiagnosticImpl: (diagnostic) => { diagnostics.push(diagnostic); },
    retainExactRootOwnershipImpl: (ownership) => { retainedRoots.push(ownership); },
  });

  helper.emit('exit', 5, null);

  assert.equal(processImpl.exitCode, 1);
  assert.equal(retainedRoots.length, 1);
  assert.match(diagnostics.join('\n'), /taskkill exited with code 5/);
});

test('terminal fallback selects taskkill only on Windows and an exact process group on POSIX', () => {
  const routes = [];
  const windowsResult = requestOwnedSupervisorTreeTermination({
    platform: 'win32',
    reason: 'windows-route',
    windowsTerminationImpl: (options) => {
      routes.push(['windows', options.reason]);
      return 'windows-result';
    },
    posixTerminationImpl: () => assert.fail('POSIX route must not run on Windows'),
  });
  const posixResult = requestOwnedSupervisorTreeTermination({
    platform: 'linux',
    reason: 'posix-route',
    windowsTerminationImpl: () => assert.fail('taskkill route must not run on POSIX'),
    posixTerminationImpl: (options) => {
      routes.push(['posix', options.reason]);
      return 'posix-result';
    },
  });

  assert.equal(windowsResult, 'windows-result');
  assert.equal(posixResult, 'posix-result');
  assert.deepEqual(routes, [
    ['windows', 'windows-route'],
    ['posix', 'posix-route'],
  ]);
});

test('POSIX terminal fallback signals only the supervisor-owned detached process group', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const signals = [];
  const diagnostics = [];

  const result = requestOwnedPosixSupervisorProcessGroupTermination({
    platform: 'linux',
    processImpl,
    reason: 'firebase-cli-sigint-handler-missing',
    killImpl: (pid, signal) => { signals.push({ pid, signal }); },
    writeDiagnosticImpl: (diagnostic) => { diagnostics.push(diagnostic); },
  });

  assert.deepEqual(signals, [{ pid: -4321, signal: 'SIGKILL' }]);
  assert.deepEqual(result, { processGroupId: 4321, signal: 'SIGKILL' });
  assert.match(diagnostics.join('\n'), /process group 4321/);
});

test('POSIX terminal fallback retains the exact root when process-group signalling fails', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const retainedRoots = [];
  const diagnostics = [];

  requestOwnedPosixSupervisorProcessGroupTermination({
    platform: 'linux',
    processImpl,
    reason: 'firebase-cli-sigint-handler-missing',
    killImpl: () => { throw new Error('kill EPERM'); },
    writeDiagnosticImpl: (diagnostic) => { diagnostics.push(diagnostic); },
    retainExactRootOwnershipImpl: (ownership) => { retainedRoots.push(ownership); },
  });

  assert.equal(processImpl.exitCode, 1);
  assert.equal(retainedRoots.length, 1);
  assert.match(diagnostics.join('\n'), /process-group termination failed: kill EPERM/);
});

test('exact-root retention marks failure and keeps one referenced ownership handle', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  const intervals = [];

  const result = retainExactSupervisorRootOwnership({
    processImpl,
    rootPid: 4321,
    reason: 'taskkill-timeout',
    diagnostic: 'bounded taskkill failure',
    retentionIntervalMs: 25,
    setIntervalImpl: (callback, intervalMs) => {
      const interval = { callback, intervalMs, refCalls: 0 };
      interval.ref = () => { interval.refCalls += 1; };
      intervals.push(interval);
      return interval;
    },
  });

  assert.equal(processImpl.exitCode, 1);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].intervalMs, 25);
  assert.equal(intervals[0].refCalls, 1);
  assert.deepEqual(result, {
    diagnostic: 'bounded taskkill failure',
    reason: 'taskkill-timeout',
    retainer: intervals[0],
    rootPid: 4321,
  });
});

test('supervisor never launches the terminal fallback on the normal graceful parent-disconnect path', () => {
  const processImpl = createProcess();
  let receivedSigint = 0;
  let terminalFallbacks = 0;

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => { receivedSigint += 1; });
    },
    terminateOwnedTreeImpl: () => { terminalFallbacks += 1; },
  });

  processImpl.connected = false;
  processImpl.emit('disconnect');

  assert.equal(receivedSigint, 1);
  assert.equal(terminalFallbacks, 0);
});

test('supervisor preserves rejected shutdown ownership until disconnect then falls back once with the original diagnosis', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  let receivedSigint = 0;
  const terminalFallbacks = [];

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => {
        receivedSigint += 1;
        throw new Error('Firebase CLI shutdown failed while parent owns fallback');
      });
    },
    terminateOwnedTreeImpl: ({ processImpl: ownedProcess, reason }) => {
      terminalFallbacks.push({ rootPid: ownedProcess.pid, reason });
    },
  });

  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-throwing-handler',
  });

  assert.equal(receivedSigint, 1);
  assert.deepEqual(terminalFallbacks, []);
  assert.deepEqual(processImpl.sentMessages, [{
    type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
    requestId: 'request-throwing-handler',
    accepted: false,
    reason: 'Firebase CLI shutdown failed while parent owns fallback',
  }]);

  processImpl.connected = false;
  processImpl.emit('disconnect');
  processImpl.emit('disconnect');
  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'late-after-rejected-handoff',
  });

  assert.equal(receivedSigint, 1);
  assert.deepEqual(terminalFallbacks, [{
    rootPid: 4321,
    reason: 'Firebase CLI shutdown failed while parent owns fallback',
  }]);
  assert.equal(processImpl.listenerCount('message'), 0);
  assert.equal(processImpl.listenerCount('disconnect'), 0);
});

test('supervisor falls back with the original rejection when its negative acknowledgement callback fails', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  let acknowledgementCallback;
  let receivedSigint = 0;
  const terminalFallbacks = [];
  processImpl.send = (message, callback) => {
    processImpl.sentMessages.push(message);
    acknowledgementCallback = callback;
    return true;
  };

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => {
        receivedSigint += 1;
        throw new Error('original Firebase CLI rejection');
      });
    },
    terminateOwnedTreeImpl: ({ processImpl: ownedProcess, reason }) => {
      terminalFallbacks.push({ rootPid: ownedProcess.pid, reason });
    },
  });

  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-ack-callback-failure',
  });
  assert.equal(receivedSigint, 1);
  assert.deepEqual(terminalFallbacks, []);
  acknowledgementCallback(new Error('IPC channel closed before acknowledgement delivery'));
  acknowledgementCallback(new Error('late duplicate callback'));

  assert.deepEqual(terminalFallbacks, [{
    rootPid: 4321,
    reason: 'original Firebase CLI rejection',
  }]);
  assert.equal(processImpl.listenerCount('message'), 0);
  assert.equal(processImpl.listenerCount('disconnect'), 0);
});

test('supervisor falls back with the original rejection when the acknowledgement channel closes synchronously', () => {
  const processImpl = createProcess();
  processImpl.pid = 4321;
  let receivedSigint = 0;
  const terminalFallbacks = [];
  processImpl.send = (message) => {
    processImpl.sentMessages.push(message);
    processImpl.connected = false;
    throw new Error('IPC channel already closed');
  };

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {
      processImpl.on('SIGINT', () => {
        receivedSigint += 1;
        throw new Error('original synchronous rejection');
      });
    },
    terminateOwnedTreeImpl: ({ processImpl: ownedProcess, reason }) => {
      terminalFallbacks.push({ rootPid: ownedProcess.pid, reason });
    },
  });

  assert.doesNotThrow(() => processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-sync-channel-close',
  }));

  assert.equal(receivedSigint, 1);
  assert.deepEqual(terminalFallbacks, [{
    rootPid: 4321,
    reason: 'original synchronous rejection',
  }]);
  assert.equal(processImpl.listenerCount('message'), 0);
  assert.equal(processImpl.listenerCount('disconnect'), 0);
});

test('Windows parent loss without a Firebase CLI SIGINT handler removes the exact owned tree', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  await runOwnedParentLossProbe('no-handler');
});

test('Windows parent loss with a throwing Firebase CLI SIGINT handler removes the exact owned tree', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  await runOwnedParentLossProbe('throwing-handler');
});

test('Windows connected rejection followed by parent loss removes the exact owned tree', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  await runOwnedParentLossProbe('throwing-handler', { requestBeforeDisconnect: true });
});

test('supervisor rejects a shutdown request when Firebase CLI has no SIGINT handler', () => {
  const processImpl = createProcess();

  runFirebaseEmulatorSupervisor({
    argv: ['node', 'firebase-emulator-supervisor.js', 'firebase-cli.js', 'emulators:start'],
    processImpl,
    requireImpl: () => {},
  });

  processImpl.emit('message', {
    type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
    requestId: 'request-2',
  });

  assert.deepEqual(processImpl.sentMessages, [{
    type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
    requestId: 'request-2',
    accepted: false,
    reason: 'firebase-cli-sigint-handler-missing',
  }]);
});
