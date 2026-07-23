#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const {
  assertPerformanceProject,
  ensureDirectory,
  frontendRoot,
  projectId,
  resolvePortableJavaHome,
  resultsDir,
} = require('./common');

const EMULATOR_HARNESS_PORTS = Object.freeze([
  4000,
  4400,
  4500,
  5000,
  5001,
  8080,
  9099,
  9150,
  9199,
]);
const PREVIOUS_LOG_TAIL_BYTES = 64 * 1024;
// Windows can keep the Firestore/UI sockets unavailable for a short period
// after their listeners disappear. This wait is lifecycle-only: route and
// Firestore client deadlines remain unchanged.
const EMULATOR_PORT_RELEASE_TIMEOUT_MS = 60 * 1000;
const EMULATOR_PORT_RELEASE_INTERVAL_MS = 250;
const EMULATOR_PORT_RELEASE_STABLE_SAMPLES = 2;

const firebaseDebugLogPaths = (root = frontendRoot) => [
  path.join(root, 'firebase-debug.log'),
  ...Array.from(
    { length: 9 },
    (_unused, index) => path.join(root, `firebase-debug.${index + 1}.log`)
  ),
];

const previousLogPaths = (root = frontendRoot) => [
  ...firebaseDebugLogPaths(root),
  path.join(root, 'firestore-debug.log'),
  path.join(root, '.perf-emulator-data', 'emulator.log'),
];

const canBindPort = (port, host = '127.0.0.1') => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      resolve(false);
      return;
    }
    reject(error);
  });
  server.listen({ host, port, exclusive: true }, () => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(true);
    });
  });
});

const assertEmulatorPortsFree = async ({
  ports = EMULATOR_HARNESS_PORTS,
  probe = canBindPort,
} = {}) => {
  const results = await Promise.all(ports.map(async (port) => ({
    port,
    free: await probe(port),
  })));
  const occupiedPorts = results.filter(({ free }) => !free).map(({ port }) => port);
  if (occupiedPorts.length) {
    throw new Error(
      `Performance emulator harness ports are already occupied: ${occupiedPorts.join(', ')}. `
      + 'Stop the owning processes before retrying; this command will not terminate them.'
    );
  }
  return results;
};

const waitForEmulatorPortsFree = async ({
  ports = EMULATOR_HARNESS_PORTS,
  probe = canBindPort,
  timeoutMs = EMULATOR_PORT_RELEASE_TIMEOUT_MS,
  intervalMs = EMULATOR_PORT_RELEASE_INTERVAL_MS,
  stableSamples = EMULATOR_PORT_RELEASE_STABLE_SAMPLES,
  now = Date.now,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('Emulator port release timeout must be a non-negative finite number.');
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('Emulator port release interval must be a positive finite number.');
  }
  if (!Number.isInteger(stableSamples) || stableSamples < 1) {
    throw new Error('Emulator port release stable sample count must be a positive integer.');
  }

  const startedAt = now();
  let consecutiveFreeSamples = 0;
  let lastOccupiedPorts = [];

  while (true) {
    const results = await Promise.all(ports.map(async (port) => ({
      port,
      free: await probe(port),
    })));
    lastOccupiedPorts = results.filter(({ free }) => !free).map(({ port }) => port);
    consecutiveFreeSamples = lastOccupiedPorts.length === 0
      ? consecutiveFreeSamples + 1
      : 0;

    if (consecutiveFreeSamples >= stableSamples) return results;

    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      const occupiedDescription = lastOccupiedPorts.length
        ? lastOccupiedPorts.join(', ')
        : `none, but only ${consecutiveFreeSamples}/${stableSamples} stable samples completed`;
      throw new Error(
        `Performance emulator harness ports did not become stably free within ${timeoutMs} ms. `
        + `Last occupied ports: ${occupiedDescription}. No processes were terminated.`
      );
    }

    await sleep(Math.min(intervalMs, timeoutMs - elapsedMs));
  }
};

const withEmulatorPortCleanup = async (operation, {
  waitForPorts = waitForEmulatorPortsFree,
  label = 'Performance emulator run',
} = {}) => {
  if (typeof operation !== 'function' || typeof waitForPorts !== 'function') {
    throw new TypeError('Emulator operation and port cleanup must be functions.');
  }
  let result;
  let operationError;
  try {
    result = await operation();
  } catch (error) {
    operationError = error instanceof Error ? error : new Error(String(error));
  }

  let cleanupError;
  try {
    await waitForPorts();
  } catch (error) {
    cleanupError = error instanceof Error ? error : new Error(String(error));
  }

  if (operationError && cleanupError) {
    throw new global.AggregateError(
      [operationError, cleanupError],
      `${label} failed and its owned emulator ports did not become free.`
    );
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return result;
};

const readBoundedTail = (filePath, maximumBytes = PREVIOUS_LOG_TAIL_BYTES) => {
  const stats = fs.statSync(filePath);
  const tailBytes = Math.min(stats.size, maximumBytes);
  if (tailBytes === 0) return { sizeBytes: stats.size, tailBytes, tail: '' };

  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(tailBytes);
    const bytesRead = fs.readSync(
      descriptor,
      buffer,
      0,
      tailBytes,
      stats.size - tailBytes
    );
    return {
      sizeBytes: stats.size,
      tailBytes: bytesRead,
      tail: buffer.subarray(0, bytesRead).toString('utf8'),
    };
  } finally {
    fs.closeSync(descriptor);
  }
};

const archiveAndDeletePreviousLogs = ({
  root = frontendRoot,
  reportDirectory = resultsDir,
  now = () => new Date(),
  maximumTailBytes = PREVIOUS_LOG_TAIL_BYTES,
} = {}) => {
  const logPaths = previousLogPaths(root);
  const logs = logPaths.map((filePath) => {
    const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
    if (!fs.existsSync(filePath)) {
      return {
        path: relativePath,
        existed: false,
        sizeBytes: 0,
        tailBytes: 0,
        tail: '',
      };
    }
    return {
      path: relativePath,
      existed: true,
      ...readBoundedTail(filePath, maximumTailBytes),
    };
  });
  const report = {
    schemaVersion: 1,
    capturedAt: now().toISOString(),
    maximumTailBytes,
    totalSizeBytes: logs.reduce((total, log) => total + log.sizeBytes, 0),
    logs,
  };
  ensureDirectory(reportDirectory);
  fs.writeFileSync(
    path.join(reportDirectory, 'previous-emulator-logs.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );

  logPaths.forEach((filePath) => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  return report;
};

const requestOwnedWindowsProcessTreeTermination = (child, {
  spawnSyncImpl = childProcess.spawnSync,
} = {}) => {
  if (!Number.isInteger(child?.pid) || child.pid <= 0) {
    throw new Error('Owned Firebase emulator child PID is unavailable.');
  }
  const result = spawnSyncImpl('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Failed to request owned Firebase emulator process-tree termination: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
};

const requestOwnedPosixProcessGroupTermination = (child, signal = 'SIGTERM', {
  killImpl = process.kill,
} = {}) => {
  if (!Number.isInteger(child?.pid) || child.pid <= 0) {
    throw new Error('Owned Firebase emulator child PID is unavailable.');
  }
  killImpl(-child.pid, signal);
  return { processGroupId: child.pid, signal };
};

const hasOwnedChildExited = (child) => (
  child.exitCode !== null || child.signalCode !== null
);

const waitForOwnedChildExit = (child, timeoutMs = 10_000) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error(`Owned Firebase emulator process did not exit within ${timeoutMs} ms.`));
    }, timeoutMs);
    timer.unref?.();
    child.once('exit', onExit);
  });
};

const run = async () => {
  assertPerformanceProject(projectId);

  const preflight = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, 'preflight.js'), '--skip-browser'],
    { cwd: frontendRoot, stdio: 'inherit' }
  );
  if (preflight.status !== 0) process.exit(preflight.status || 1);

  await assertEmulatorPortsFree();
  archiveAndDeletePreviousLogs();

  const configRoot = path.join(frontendRoot, '.perf-emulator-data', 'config');
  ensureDirectory(configRoot);
  const functionsEnvironmentPath = path.join(frontendRoot, 'functions', `.env.${projectId}`);
  fs.writeFileSync(functionsEnvironmentPath, [
    'FATINS_FIREBASE_API_KEY=demo-api-key',
    `FATINS_FIREBASE_AUTH_DOMAIN=${projectId}.firebaseapp.com`,
    `FATINS_FIREBASE_PROJECT_ID=${projectId}`,
    `FATINS_FIREBASE_STORAGE_BUCKET=${projectId}.appspot.com`,
    'FATINS_FIREBASE_MESSAGING_SENDER_ID=000000000000',
    'FATINS_FIREBASE_APP_ID=1:000000000000:web:performance',
    'FATINS_FIREBASE_MEASUREMENT_ID=',
    'FND_TASK06_CONSOLIDATED_OWNER=1',
    '',
  ].join('\n'), 'utf8');

  const firebaseCli = path.join(frontendRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  if (!fs.existsSync(firebaseCli)) throw new Error(`Firebase CLI not found: ${firebaseCli}`);
  const portableJavaHome = resolvePortableJavaHome();
  const emulatorLogPath = path.join(frontendRoot, '.perf-emulator-data', 'emulator.log');
  const emulatorLog = fs.openSync(emulatorLogPath, 'w');
  const playwrightMarker = path.join(frontendRoot, '.perf-emulator-data', 'playwright-webserver.active');
  if (process.env.FND_PERF_PLAYWRIGHT_WEBSERVER === '1') {
    fs.writeFileSync(playwrightMarker, String(process.pid), 'utf8');
  }

  const child = childProcess.spawn(
    process.execPath,
    [
      firebaseCli,
      'emulators:start',
      '--project', projectId,
      '--only', 'auth,firestore,storage,functions,hosting',
      '--log-verbosity', 'INFO',
    ],
    {
      cwd: frontendRoot,
      env: {
        ...process.env,
        ...(portableJavaHome ? {
          JAVA_HOME: portableJavaHome,
          PATH: `${path.join(portableJavaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
        } : {}),
        XDG_CONFIG_HOME: configRoot,
        FATINS_FIREBASE_API_KEY: 'demo-api-key',
        FATINS_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
        FATINS_FIREBASE_PROJECT_ID: projectId,
        FATINS_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`,
        FATINS_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
        FATINS_FIREBASE_APP_ID: '1:000000000000:web:performance',
        FATINS_FIREBASE_MEASUREMENT_ID: '',
        FND_TASK06_CONSOLIDATED_OWNER: '1',
      },
      stdio: ['ignore', emulatorLog, emulatorLog],
      shell: false,
      detached: process.platform !== 'win32',
    }
  );

  let shuttingDown = false;
  let shutdownPromise = null;
  let emulatorLogClosed = false;
  const closeEmulatorLog = () => {
    if (emulatorLogClosed) return;
    emulatorLogClosed = true;
    fs.closeSync(emulatorLog);
  };
  const shutdown = (signal = 'SIGINT') => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    shutdownPromise = (async () => {
      const errors = [];
      let windowsTermination = null;
      if (process.platform === 'win32') {
        try {
          windowsTermination = requestOwnedWindowsProcessTreeTermination(child);
        } catch (error) {
          errors.push(error);
        }
      } else if (!hasOwnedChildExited(child)) {
        try {
          requestOwnedPosixProcessGroupTermination(child, signal);
        } catch (error) {
          if (!hasOwnedChildExited(child)) errors.push(error);
        }
      }

      try {
        await waitForOwnedChildExit(child);
      } catch (gracefulExitError) {
        if (process.platform === 'win32' || hasOwnedChildExited(child)) {
          errors.push(gracefulExitError);
        } else {
          try {
            requestOwnedPosixProcessGroupTermination(child, 'SIGKILL');
          } catch (error) {
            if (!hasOwnedChildExited(child)) errors.push(error);
          }
          try {
            await waitForOwnedChildExit(child);
          } catch (forcedExitError) {
            errors.push(new global.AggregateError(
              [gracefulExitError, forcedExitError],
              'Owned Firebase emulator process group ignored graceful and forced termination.'
            ));
          }
        }
      }

      try {
        await waitForEmulatorPortsFree();
      } catch (error) {
        const terminationDetail = windowsTermination && windowsTermination.status !== 0
          ? ` taskkill status=${windowsTermination.status}, stderr=${windowsTermination.stderr || 'none'}.`
          : '';
        errors.push(new Error(`${error.message}${terminationDetail}`, { cause: error }));
      }

      fs.rmSync(playwrightMarker, { force: true });
      closeEmulatorLog();
      if (errors.length) {
        console.error(new global.AggregateError(errors, 'Owned Firebase emulator shutdown failed.'));
        process.exit(1);
      }
      process.exit(0);
    })();
    return shutdownPromise;
  };
  const webServerParentPid = process.ppid;
  const parentMonitor = setInterval(() => {
    if (process.env.FND_PERF_PLAYWRIGHT_WEBSERVER === '1' && !fs.existsSync(playwrightMarker)) {
      void shutdown('SIGTERM');
      return;
    }
    try {
      process.kill(webServerParentPid, 0);
    } catch (_error) {
      void shutdown('SIGTERM');
    }
  }, 1_000);
  parentMonitor.unref();
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('disconnect', () => { void shutdown('SIGTERM'); });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    closeEmulatorLog();
    process.exit(code || 0);
  });
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  EMULATOR_PORT_RELEASE_INTERVAL_MS,
  EMULATOR_PORT_RELEASE_STABLE_SAMPLES,
  EMULATOR_PORT_RELEASE_TIMEOUT_MS,
  EMULATOR_HARNESS_PORTS,
  PREVIOUS_LOG_TAIL_BYTES,
  archiveAndDeletePreviousLogs,
  assertEmulatorPortsFree,
  canBindPort,
  firebaseDebugLogPaths,
  previousLogPaths,
  readBoundedTail,
  requestOwnedPosixProcessGroupTermination,
  requestOwnedWindowsProcessTreeTermination,
  run,
  waitForEmulatorPortsFree,
  waitForOwnedChildExit,
  withEmulatorPortCleanup,
};
