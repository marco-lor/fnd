const path = require('path');
const { defineConfig } = require('@playwright/test');
const manifest = require('./scenarios.json');
const { ensureDirectory, frontendRoot, resolvePortableJavaHome } = require('../scripts/performance/common');

const isCI = Boolean(process.env.CI);
const portableJavaHome = resolvePortableJavaHome();
const emulatorConfigRoot = path.join(frontendRoot, '.perf-emulator-data', 'config');
ensureDirectory(emulatorConfigRoot);
const emulatorEnvironment = {
  ...process.env,
  XDG_CONFIG_HOME: emulatorConfigRoot,
  FATINS_FIREBASE_API_KEY: 'demo-api-key',
  FATINS_FIREBASE_AUTH_DOMAIN: 'demo-fnd-perf.firebaseapp.com',
  FATINS_FIREBASE_PROJECT_ID: 'demo-fnd-perf',
  FATINS_FIREBASE_STORAGE_BUCKET: 'demo-fnd-perf.appspot.com',
  FATINS_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  FATINS_FIREBASE_APP_ID: '1:000000000000:web:performance',
  FATINS_FIREBASE_MEASUREMENT_ID: '',
  FND_PERF_PLAYWRIGHT_WEBSERVER: '1',
  ...(portableJavaHome ? {
    JAVA_HOME: portableJavaHome,
    PATH: `${path.join(portableJavaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
  } : {}),
};

module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests', 'browser'),
  testMatch: /.*\.(performance|smoke|setup)\.js/,
  outputDir: path.join(__dirname, '..', 'test-results', 'performance'),
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['line'],
    ['html', { outputFolder: path.join(__dirname, '..', 'playwright-report', 'performance'), open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5000',
    viewport: manifest.viewport,
    deviceScaleFactor: manifest.viewport.deviceScaleFactor,
    locale: manifest.locale,
    timezoneId: manifest.timezoneId,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: 'node scripts/performance/emulators.js',
    cwd: path.join(__dirname, '..'),
    env: emulatorEnvironment,
    url: 'http://127.0.0.1:5000',
    reuseExistingServer: !isCI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'auth-setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'chromium',
      dependencies: ['auth-setup'],
      testIgnore: /auth\.setup\.js/,
      use: { browserName: 'chromium', launchOptions: { args: ['--js-flags=--expose-gc'] } },
    },
    {
      name: 'firefox-smoke',
      dependencies: ['auth-setup'],
      testMatch: /cross-browser\.smoke\.js/,
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit-smoke',
      dependencies: ['auth-setup'],
      testMatch: /cross-browser\.smoke\.js/,
      use: { browserName: 'webkit' },
    },
  ],
});
