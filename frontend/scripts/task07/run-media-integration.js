const fs = require('node:fs');
const path = require('node:path');
const { runBoundedChildProcess } = require('../bounded-child-process');
const {
  PERFORMANCE_FIREBASE_CONFIG_FILENAME,
  assertEmulatorPortsFree,
  removePerformanceFirebaseConfig,
  waitForEmulatorPortsFree,
  withEmulatorPortCleanup,
} = require('../performance/emulators');

const DEFAULT_MEDIA_RUN_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_MEDIA_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const MEDIA_RUN_TIMEOUT_ENV = 'FND_TASK07_MEDIA_RUN_TIMEOUT_MS';

const getMediaRunTimeoutMs = (environment = process.env) => {
  const rawValue = environment[MEDIA_RUN_TIMEOUT_ENV];
  if (rawValue == null || rawValue === '') return DEFAULT_MEDIA_RUN_TIMEOUT_MS;
  const timeoutMs = Number(rawValue);
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > MAX_MEDIA_RUN_TIMEOUT_MS
  ) {
    throw new Error(
      `${MEDIA_RUN_TIMEOUT_ENV} must be an integer from 1 to ${MAX_MEDIA_RUN_TIMEOUT_MS}.`
    );
  }
  return timeoutMs;
};

const runMediaIntegration = async ({
  cwd = process.cwd(),
  environment = process.env,
  timeoutMs = getMediaRunTimeoutMs(environment),
  runChild = runBoundedChildProcess,
  assertPortsFree = assertEmulatorPortsFree,
  waitForPorts = waitForEmulatorPortsFree,
} = {}) => {
  await assertPortsFree();
  const playwrightCli = require.resolve('@playwright/test/cli');
  const generatedConfigPath = path.join(cwd, PERFORMANCE_FIREBASE_CONFIG_FILENAME);
  const playwrightMarkerPath = path.join(
    cwd,
    '.perf-emulator-data',
    'playwright-webserver.active'
  );

  const result = await withEmulatorPortCleanup(
    () => runChild({
      command: process.execPath,
      args: [
        playwrightCli,
        'test',
        '--config',
        'performance/playwright.config.js',
        '--project',
        'task07-chromium',
        '--workers',
        '1',
      ],
      cwd,
      environment: {
        ...environment,
        FND_TASK07_MEDIA_INTEGRATION: '1',
        JAVA_TOOL_OPTIONS: environment.JAVA_TOOL_OPTIONS || '-Xmx512m',
        NODE_OPTIONS: environment.NODE_OPTIONS || '--max-old-space-size=768',
      },
      timeoutMs,
      label: 'Task 07 Playwright and Firebase emulator integration',
      captureOutput: false,
    }),
    {
      waitForPorts,
      cleanupOwnedArtifacts: async () => {
        fs.rmSync(playwrightMarkerPath, { force: true });
        if (fs.existsSync(generatedConfigPath)) {
          removePerformanceFirebaseConfig({ root: cwd });
        }
      },
      label: 'Task 07 media integration',
    }
  );
  return result;
};

const main = async () => {
  const result = await runMediaIntegration();
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MEDIA_RUN_TIMEOUT_MS,
  MAX_MEDIA_RUN_TIMEOUT_MS,
  MEDIA_RUN_TIMEOUT_ENV,
  getMediaRunTimeoutMs,
  runMediaIntegration,
};
