#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const {
  assertDemoProject,
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

const previousLogPaths = (root = frontendRoot) => [
  path.join(root, 'firebase-debug.log'),
  ...Array.from(
    { length: 9 },
    (_unused, index) => path.join(root, `firebase-debug.${index + 1}.log`)
  ),
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

const run = async () => {
  assertDemoProject(projectId);

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
      },
      stdio: ['ignore', emulatorLog, emulatorLog],
      shell: false,
    }
  );

  let shuttingDown = false;
  const shutdown = (signal = 'SIGINT') => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (process.platform === 'win32') {
      childProcess.spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      process.exit(0);
    }
    if (!child.killed) child.kill(signal);
    const forceTimer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
      process.exit(0);
    }, 10_000);
    forceTimer.unref();
  };
  const webServerParentPid = process.ppid;
  const parentMonitor = setInterval(() => {
    if (process.env.FND_PERF_PLAYWRIGHT_WEBSERVER === '1' && !fs.existsSync(playwrightMarker)) {
      shutdown('SIGTERM');
      return;
    }
    try {
      process.kill(webServerParentPid, 0);
    } catch (_error) {
      shutdown('SIGTERM');
    }
  }, 1_000);
  parentMonitor.unref();
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('disconnect', () => shutdown('SIGTERM'));
  child.on('exit', (code) => {
    fs.closeSync(emulatorLog);
    process.exit(shuttingDown ? 0 : (code || 0));
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
  previousLogPaths,
  readBoundedTail,
  run,
  waitForEmulatorPortsFree,
};
