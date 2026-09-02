#!/usr/bin/env node

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { createDeterministicBuildServer } = require('./deterministic-static-server');
const {
  FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
  FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
} = require('./firebase-emulator-supervisor');
const {
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  ensureDirectory,
  frontendRoot,
  PERFORMANCE_AUTH_DOMAIN,
  PERFORMANCE_HOSTING_SITE,
  PERFORMANCE_STORAGE_BUCKET,
  projectId,
  resolvePortableJavaHome,
  resultsDir,
} = require('./common');

const PERFORMANCE_STATIC_SERVER_PORT = 5000;
const FIREBASE_HOSTING_UPSTREAM_PORT = 5002;
const PERFORMANCE_FIREBASE_CONFIG_FILENAME = '.firebase.performance.generated.json';
const EMULATOR_HARNESS_PORTS = Object.freeze([
  4000,
  4400,
  4500,
  PERFORMANCE_STATIC_SERVER_PORT,
  5001,
  FIREBASE_HOSTING_UPSTREAM_PORT,
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
const EMULATOR_GRACEFUL_SHUTDOWN_ACK_TIMEOUT_MS = 10 * 1000;
const EMULATOR_TASKKILL_TIMEOUT_MS = 10 * 1000;
const FIREBASE_CLI_OFFLINE_ENV_KEY = 'npm_config_offline';

const environmentPath = (environment = process.env) => (
  Object.entries(environment).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
);

const createFirebaseCliEnvironment = (
  inheritedEnvironment = process.env,
  overrides = {}
) => {
  const environment = {};
  const applyEntries = (entries) => entries.forEach(([key, value]) => {
    if (key.toLowerCase() !== FIREBASE_CLI_OFFLINE_ENV_KEY) {
      if (key.toLowerCase() === 'path') {
        for (const existingKey of Object.keys(environment)) {
          if (existingKey.toLowerCase() === 'path') delete environment[existingKey];
        }
        environment.PATH = value;
        return;
      }
      environment[key] = value;
    }
  });
  applyEntries(Object.entries(inheritedEnvironment));
  applyEntries(Object.entries(overrides));
  return {
    ...environment,
    // The demo harness must not let firebase-tools synchronously query npm
    // while its single CLI process is also serving the local emulators.
    [FIREBASE_CLI_OFFLINE_ENV_KEY]: 'true',
  };
};

const writePerformanceFirebaseConfig = ({
  sourcePath = path.join(frontendRoot, 'firebase.json'),
  outputPath = path.join(frontendRoot, PERFORMANCE_FIREBASE_CONFIG_FILENAME),
  hostingPort = FIREBASE_HOSTING_UPSTREAM_PORT,
  fsImpl = fs,
} = {}) => {
  if (!Number.isInteger(hostingPort) || hostingPort <= 0 || hostingPort > 65_535) {
    throw new TypeError('Performance Firebase Hosting port must be an integer from 1 to 65535.');
  }
  const source = JSON.parse(fsImpl.readFileSync(sourcePath, 'utf8'));
  if (!source?.emulators?.hosting) {
    throw new Error('Firebase config must define emulators.hosting.');
  }
  const generated = JSON.parse(JSON.stringify(source));
  generated.emulators.hosting = {
    ...generated.emulators.hosting,
    host: '127.0.0.1',
    port: hostingPort,
  };
  fsImpl.writeFileSync(outputPath, `${JSON.stringify(generated, null, 2)}\n`, 'utf8');
  return generated;
};

const removePerformanceFirebaseConfig = ({
  root = frontendRoot,
  fsImpl = fs,
} = {}) => {
  const resolvedRoot = path.resolve(root);
  const configPath = path.resolve(resolvedRoot, PERFORMANCE_FIREBASE_CONFIG_FILENAME);
  const relativePath = path.relative(resolvedRoot, configPath);
  if (
    !relativePath
    || path.isAbsolute(relativePath)
    || relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error('Performance Firebase config cleanup escaped the frontend root.');
  }
  fsImpl.rmSync(configPath, { force: true });
  return configPath;
};

const createFirebaseEmulatorArguments = ({
  firebaseCli,
  configPath,
  lifecycleProjectId = projectId,
} = {}) => {
  if (!firebaseCli || !configPath) {
    throw new TypeError('Firebase CLI and generated config paths are required.');
  }
  assertPerformanceProject(lifecycleProjectId);
  return [
    firebaseCli,
    'emulators:start',
    '--project', lifecycleProjectId,
    '--config', configPath,
    '--only', 'auth,firestore,storage,functions,hosting',
    '--log-verbosity', 'INFO',
  ];
};

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
  cleanupOwnedArtifacts = async () => {},
  label = 'Performance emulator run',
} = {}) => {
  if (
    typeof operation !== 'function'
    || typeof waitForPorts !== 'function'
    || typeof cleanupOwnedArtifacts !== 'function'
  ) {
    throw new TypeError('Emulator operation, port cleanup, and artifact cleanup must be functions.');
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

  let artifactCleanupError;
  try {
    await cleanupOwnedArtifacts();
  } catch (error) {
    artifactCleanupError = error instanceof Error ? error : new Error(String(error));
  }

  const errors = [operationError, cleanupError, artifactCleanupError].filter(Boolean);
  if (errors.length > 1) {
    throw new global.AggregateError(
      errors,
      `${label} failed or cleanup left owned resources unavailable.`
    );
  }
  if (errors.length === 1) throw errors[0];
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
  timeoutMs = EMULATOR_TASKKILL_TIMEOUT_MS,
} = {}) => {
  if (!Number.isInteger(child?.pid) || child.pid <= 0) {
    throw new Error('Owned Firebase emulator child PID is unavailable.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Owned Firebase emulator taskkill timeout must be positive.');
  }
  const result = spawnSyncImpl('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
  });
  const termination = {
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
  if (result.signal) termination.signal = result.signal;
  if (result.error) {
    termination.timedOut = result.error.code === 'ETIMEDOUT';
    termination.error = result.error.message;
  }
  return termination;
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

const requestOwnedWindowsGracefulShutdown = (child, {
  timeoutMs = EMULATOR_GRACEFUL_SHUTDOWN_ACK_TIMEOUT_MS,
  requestId = crypto.randomUUID(),
} = {}) => {
  if (
    !Number.isInteger(child?.pid)
    || child.pid <= 0
    || typeof child.send !== 'function'
    || child.connected === false
  ) {
    return Promise.reject(new Error(
      'Owned Firebase emulator child cannot receive an owned IPC shutdown request.'
    ));
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TypeError('Owned Firebase emulator shutdown acknowledgement timeout must be positive.'));
  }
  if (hasOwnedChildExited(child)) {
    return Promise.reject(new Error('Owned Firebase emulator child exited before graceful shutdown was requested.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, acknowledgement) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      child.removeListener('disconnect', onDisconnect);
      if (error) reject(error);
      else resolve(acknowledgement);
    };
    const onMessage = (message) => {
      if (message?.type !== FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE || message.requestId !== requestId) {
        return;
      }
      if (message.accepted !== true || message.handler !== 'firebase-cli-sigint') {
        finish(new Error(
          `Owned Firebase emulator graceful shutdown was rejected: ${message.reason || 'invalid acknowledgement'}.`
        ));
        return;
      }
      finish(null, { accepted: true, handler: message.handler, pid: child.pid });
    };
    const onExit = () => finish(new Error(
      'Owned Firebase emulator child exited before graceful shutdown acknowledgement.'
    ));
    const onError = (error) => finish(new Error(
      `Owned Firebase emulator IPC channel errored before graceful shutdown acknowledgement: ${
        error instanceof Error ? error.message : String(error)
      }.`
    ));
    const onDisconnect = () => finish(new Error(
      'Owned Firebase emulator IPC channel disconnected before graceful shutdown acknowledgement.'
    ));
    const timer = setTimeout(() => finish(new Error(
      `Owned Firebase emulator graceful shutdown acknowledgement did not arrive within ${timeoutMs} ms.`
    )), timeoutMs);
    timer.unref?.();
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
    child.once('disconnect', onDisconnect);
    try {
      child.send({
        type: FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
        requestId,
      }, (error) => {
        if (error) finish(new Error(
          `Owned Firebase emulator graceful shutdown request could not be delivered: ${error.message}.`
        ));
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
};

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

const shutdownOwnedWindowsEmulator = async ({
  child,
  requestGracefulShutdown = requestOwnedWindowsGracefulShutdown,
  requestTreeTermination = requestOwnedWindowsProcessTreeTermination,
  waitForChildExit = waitForOwnedChildExit,
  waitForPorts = waitForEmulatorPortsFree,
} = {}) => {
  if (!Number.isInteger(child?.pid) || child.pid <= 0) {
    throw new Error('Owned Firebase emulator child PID is unavailable.');
  }
  const errors = [];
  let graceful = null;
  let fallback = null;
  let exit = null;
  let ports = null;
  const diagnostics = {
    acknowledgement: null,
    exit: null,
    fallback: null,
    ports: null,
  };
  let acknowledgementError = null;
  try {
    graceful = await requestGracefulShutdown(child);
    diagnostics.acknowledgement = graceful;
  } catch (error) {
    acknowledgementError = error instanceof Error ? error : new Error(String(error));
    errors.push(acknowledgementError);
  }

  const requestFallback = async (priorExitError = null) => {
    if (hasOwnedChildExited(child)) return;
    try {
      fallback = requestTreeTermination(child);
      diagnostics.fallback = fallback;
      if (fallback.status !== 0) {
        const timeoutDetail = fallback.timedOut ? ' timed out.' : '';
        const errorDetail = fallback.error ? ` ${fallback.error}` : '';
        errors.push(new Error(
          `Owned Firebase emulator taskkill fallback failed with status ${fallback.status}: `
          + `${fallback.stderr || fallback.stdout || 'no diagnostic output'}.${timeoutDetail}${errorDetail}`
        ));
      }
    } catch (fallbackError) {
      errors.push(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
    }
    try {
      await waitForChildExit(child);
      exit = { exited: true, pid: child.pid };
      diagnostics.exit = exit;
    } catch (fallbackExitError) {
      errors.push(new global.AggregateError(
        [priorExitError, fallbackExitError].filter(Boolean),
        'Owned Firebase emulator process did not exit after exact-tree shutdown request.'
      ));
    }
  };

  if (acknowledgementError) {
    await requestFallback();
  } else {
    try {
      await waitForChildExit(child);
      exit = { exited: true, pid: child.pid };
      diagnostics.exit = exit;
    } catch (gracefulExitError) {
      await requestFallback(gracefulExitError);
    }
  }

  try {
    await waitForPorts();
    ports = { stable: true };
    diagnostics.ports = ports;
  } catch (portsError) {
    ports = { stable: false };
    diagnostics.ports = ports;
    errors.push(portsError instanceof Error ? portsError : new Error(String(portsError)));
  }
  if (errors.length) {
    const shutdownError = new global.AggregateError(errors, 'Owned Firebase emulator shutdown failed.');
    shutdownError.shutdownDiagnostics = diagnostics;
    throw shutdownError;
  }
  return { graceful, exit, fallback, ports };
};

const createOwnedFirebaseEmulatorSupervisorArguments = ({ firebaseCli, configPath } = {}) => {
  const firebaseArguments = createFirebaseEmulatorArguments({ firebaseCli, configPath });
  return [
    path.join(__dirname, 'firebase-emulator-supervisor.js'),
    ...firebaseArguments,
  ];
};

const createOwnedFirebaseEmulatorSpawnOptions = ({
  cwd,
  env,
  stdio,
  platform = process.platform,
} = {}) => ({
  cwd,
  env,
  stdio,
  shell: false,
  detached: true,
  ...(platform === 'win32' ? { windowsHide: true } : {}),
});

const run = async () => {
  assertPerformanceProject(projectId);
  const ownedEnvironment = configureOwnedPerformanceEnvironment({
    env: {...process.env},
    mode: 'strict',
  });

  const preflight = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, 'preflight.js'), '--skip-browser'],
    { cwd: frontendRoot, env: ownedEnvironment, stdio: 'inherit' }
  );
  if (preflight.status !== 0) process.exit(preflight.status || 1);

  await assertEmulatorPortsFree();
  archiveAndDeletePreviousLogs();

  const performanceFirebaseConfigPath = path.join(
    frontendRoot,
    PERFORMANCE_FIREBASE_CONFIG_FILENAME
  );
  removePerformanceFirebaseConfig();
  writePerformanceFirebaseConfig({ outputPath: performanceFirebaseConfigPath });

  const configRoot = path.join(frontendRoot, '.perf-emulator-data', 'config');
  ensureDirectory(configRoot);
  const functionsEnvironmentPath = path.join(frontendRoot, 'functions', `.env.${projectId}`);
  fs.writeFileSync(functionsEnvironmentPath, [
    'FATINS_FIREBASE_API_KEY=demo-api-key',
    `FATINS_FIREBASE_AUTH_DOMAIN=${PERFORMANCE_AUTH_DOMAIN}`,
    `FATINS_FIREBASE_PROJECT_ID=${projectId}`,
    `FATINS_FIREBASE_STORAGE_BUCKET=${PERFORMANCE_STORAGE_BUCKET}`,
    'FATINS_FIREBASE_MESSAGING_SENDER_ID=000000000000',
    'FATINS_FIREBASE_APP_ID=1:000000000000:web:performance',
    'FATINS_FIREBASE_MEASUREMENT_ID=',
    '',
  ].join('\n'), 'utf8');

  const firebaseCli = path.join(frontendRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  if (!fs.existsSync(firebaseCli)) throw new Error(`Firebase CLI not found: ${firebaseCli}`);
  const portableJavaHome = resolvePortableJavaHome();
  const deterministicStaticServer = createDeterministicBuildServer({
    buildDirectory: path.join(frontendRoot, 'build'),
    host: '127.0.0.1',
    port: PERFORMANCE_STATIC_SERVER_PORT,
    runtimeConfigUpstreamUrl:
      `http://127.0.0.1:${FIREBASE_HOSTING_UPSTREAM_PORT}/fatins-runtime/firebase-client`,
  });
  try {
    await deterministicStaticServer.start();
  } catch (error) {
    removePerformanceFirebaseConfig();
    throw error;
  }
  const emulatorLogPath = path.join(frontendRoot, '.perf-emulator-data', 'emulator.log');
  const emulatorLog = fs.openSync(emulatorLogPath, 'w');
  const playwrightMarker = path.join(frontendRoot, '.perf-emulator-data', 'playwright-webserver.active');
  if (process.env.FND_PERF_PLAYWRIGHT_WEBSERVER === '1') {
    fs.writeFileSync(playwrightMarker, String(process.pid), 'utf8');
  }

  const child = childProcess.spawn(
    process.execPath,
    createOwnedFirebaseEmulatorSupervisorArguments({
      firebaseCli,
      configPath: performanceFirebaseConfigPath,
    }),
    createOwnedFirebaseEmulatorSpawnOptions({
      cwd: frontendRoot,
      env: createFirebaseCliEnvironment(ownedEnvironment, {
        ...(portableJavaHome ? {
          JAVA_HOME: portableJavaHome,
          PATH: `${path.join(portableJavaHome, 'bin')}${path.delimiter}${environmentPath(process.env)}`,
        } : {}),
        XDG_CONFIG_HOME: configRoot,
        FATINS_FIREBASE_API_KEY: 'demo-api-key',
        FATINS_FIREBASE_AUTH_DOMAIN: PERFORMANCE_AUTH_DOMAIN,
        FATINS_FIREBASE_PROJECT_ID: projectId,
        FATINS_FIREBASE_STORAGE_BUCKET: PERFORMANCE_STORAGE_BUCKET,
        FATINS_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
        FATINS_FIREBASE_APP_ID: '1:000000000000:web:performance',
        FATINS_FIREBASE_MEASUREMENT_ID: '',
        FND_FIREBASE_ENVIRONMENT: 'performance',
        FND_FIREBASE_PROJECT_ID: projectId,
        FND_FIREBASE_HOSTING_SITE: PERFORMANCE_HOSTING_SITE,
        FND_FIREBASE_STORAGE_BUCKET: PERFORMANCE_STORAGE_BUCKET,
        FND_FIREBASE_AUTH_DOMAIN: PERFORMANCE_AUTH_DOMAIN,
        REACT_APP_FND_ENVIRONMENT: 'performance',
        REACT_APP_FND_FIREBASE_PROJECT_ID: projectId,
        REACT_APP_FND_FIREBASE_HOSTING_SITE: PERFORMANCE_HOSTING_SITE,
        REACT_APP_FND_FIREBASE_STORAGE_BUCKET: PERFORMANCE_STORAGE_BUCKET,
      }),
      stdio: ['ignore', emulatorLog, emulatorLog, 'ipc'],
    })
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
      try {
        await deterministicStaticServer.close();
      } catch (error) {
        errors.push(error);
      }
      if (process.platform === 'win32') {
        try {
          await shutdownOwnedWindowsEmulator({ child });
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

      if (process.platform !== 'win32') try {
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

      if (process.platform !== 'win32') try {
        await waitForEmulatorPortsFree();
      } catch (error) {
        errors.push(error);
      }

      fs.rmSync(playwrightMarker, { force: true });
      removePerformanceFirebaseConfig();
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
    shuttingDown = true;
    void (async () => {
      const errors = [];
      try {
        await deterministicStaticServer.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await waitForEmulatorPortsFree();
      } catch (error) {
        errors.push(error);
      }
      fs.rmSync(playwrightMarker, { force: true });
      removePerformanceFirebaseConfig();
      closeEmulatorLog();
      if (errors.length) {
        console.error(new global.AggregateError(
          errors,
          'Unexpected Firebase emulator exit left owned resources unavailable.'
        ));
      }
      process.exit(errors.length ? 1 : (code || 0));
    })();
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
  EMULATOR_TASKKILL_TIMEOUT_MS,
  EMULATOR_HARNESS_PORTS,
  FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
  FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
  FIREBASE_HOSTING_UPSTREAM_PORT,
  PERFORMANCE_FIREBASE_CONFIG_FILENAME,
  PERFORMANCE_STATIC_SERVER_PORT,
  PREVIOUS_LOG_TAIL_BYTES,
  archiveAndDeletePreviousLogs,
  assertEmulatorPortsFree,
  canBindPort,
  createOwnedFirebaseEmulatorSupervisorArguments,
  environmentPath,
  createFirebaseEmulatorArguments,
  createFirebaseCliEnvironment,
  createOwnedFirebaseEmulatorSpawnOptions,
  firebaseDebugLogPaths,
  previousLogPaths,
  readBoundedTail,
  removePerformanceFirebaseConfig,
  requestOwnedPosixProcessGroupTermination,
  requestOwnedWindowsGracefulShutdown,
  requestOwnedWindowsProcessTreeTermination,
  run,
  shutdownOwnedWindowsEmulator,
  waitForEmulatorPortsFree,
  waitForOwnedChildExit,
  withEmulatorPortCleanup,
  writePerformanceFirebaseConfig,
};
