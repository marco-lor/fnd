#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  assertDemoProject,
  ensureDirectory,
  frontendRoot,
  projectId,
  resolvePortableJavaHome,
} = require('./common');

assertDemoProject(projectId);

const preflight = childProcess.spawnSync(
  process.execPath,
  [path.join(__dirname, 'preflight.js'), '--skip-browser'],
  { cwd: frontendRoot, stdio: 'inherit' }
);
if (preflight.status !== 0) process.exit(preflight.status || 1);

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
const emulatorLog = fs.openSync(emulatorLogPath, 'a');
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
