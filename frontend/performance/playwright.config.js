const path = require('path');
const { defineConfig } = require('@playwright/test');
const manifest = require('./scenarios.json');
const {
  ensureDirectory,
  frontendRoot,
  PERFORMANCE_AUTH_DOMAIN,
  PERFORMANCE_HOSTING_SITE,
  PERFORMANCE_PROJECT_ID,
  PERFORMANCE_STORAGE_BUCKET,
  resolvePortableJavaHome,
} = require('../scripts/performance/common');
const { resolveTask07SoakRuntime } = require('../scripts/performance/task07-soak-contract');

const portableJavaHome = resolvePortableJavaHome();
const task07SoakRuntime = resolveTask07SoakRuntime();
const emulatorConfigRoot = path.join(frontendRoot, '.perf-emulator-data', 'config');
ensureDirectory(emulatorConfigRoot);
const emulatorEnvironment = {
  ...process.env,
  XDG_CONFIG_HOME: emulatorConfigRoot,
  FATINS_FIREBASE_API_KEY: 'demo-api-key',
  FATINS_FIREBASE_AUTH_DOMAIN: PERFORMANCE_AUTH_DOMAIN,
  FATINS_FIREBASE_PROJECT_ID: PERFORMANCE_PROJECT_ID,
  FATINS_FIREBASE_STORAGE_BUCKET: PERFORMANCE_STORAGE_BUCKET,
  FATINS_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  FATINS_FIREBASE_APP_ID: '1:000000000000:web:performance',
  FATINS_FIREBASE_MEASUREMENT_ID: '',
  FND_FIREBASE_AUTH_DOMAIN: PERFORMANCE_AUTH_DOMAIN,
  FND_FIREBASE_ENVIRONMENT: 'performance',
  FND_FIREBASE_HOSTING_SITE: PERFORMANCE_HOSTING_SITE,
  FND_FIREBASE_PROJECT_ID: PERFORMANCE_PROJECT_ID,
  FND_FIREBASE_STORAGE_BUCKET: PERFORMANCE_STORAGE_BUCKET,
  FND_PERF_PLAYWRIGHT_WEBSERVER: '1',
  REACT_APP_FND_ENVIRONMENT: 'performance',
  REACT_APP_FND_FIREBASE_AUTH_DOMAIN: PERFORMANCE_AUTH_DOMAIN,
  REACT_APP_FND_FIREBASE_HOSTING_SITE: PERFORMANCE_HOSTING_SITE,
  REACT_APP_FND_FIREBASE_PROJECT_ID: PERFORMANCE_PROJECT_ID,
  REACT_APP_FND_FIREBASE_STORAGE_BUCKET: PERFORMANCE_STORAGE_BUCKET,
  ...(portableJavaHome ? {
    JAVA_HOME: portableJavaHome,
    PATH: `${path.join(portableJavaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
  } : {}),
};

module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests', 'browser'),
  testMatch: /.*\.(performance|smoke|setup|experiment)\.js/,
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
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: {
      signal: 'SIGTERM',
      timeout: 120_000,
    },
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'asset-warmup', testMatch: /asset-warmup\.setup\.js/ },
    {
      name: 'auth-setup',
      dependencies: ['asset-warmup'],
      testMatch: /auth\.setup\.js/,
    },
    {
      name: 'chromium',
      dependencies: ['auth-setup'],
      testIgnore: /asset-warmup\.setup\.js|auth\.setup\.js|firestore-persistence\.experiment\.js|task07-media-(?:cross-browser\.smoke|soak\.performance)\.js|task08-baseline\.performance\.js|task09a-baseline\.performance\.js/,
      use: { browserName: 'chromium', launchOptions: { args: ['--js-flags=--expose-gc'] } },
    },
    {
      name: 'task09a-chromium',
      dependencies: ['auth-setup'],
      testMatch: /task09a-baseline\.performance\.js/,
      use: {
        browserName: 'chromium',
        launchOptions: { args: ['--js-flags=--expose-gc'] },
      },
    },
    {
      name: 'task08-chromium',
      dependencies: ['auth-setup'],
      testMatch: /task08-baseline\.performance\.js/,
      use: {
        browserName: 'chromium',
        launchOptions: { args: ['--js-flags=--expose-gc'] },
      },
    },
    {
      name: 'firestore-persistence-experiment',
      dependencies: ['asset-warmup'],
      testMatch: /firestore-persistence\.experiment\.js/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox-smoke',
      dependencies: ['auth-setup'],
      testMatch: /(?:^|[\\/])(?:cross-browser|task07-media-cross-browser)\.smoke\.js$/,
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit-smoke',
      dependencies: ['auth-setup'],
      testMatch: /(?:^|[\\/])(?:cross-browser|task07-media-cross-browser)\.smoke\.js$/,
      use: { browserName: 'webkit' },
    },
    {
      name: 'task07-chromium',
      dependencies: ['auth-setup'],
      testMatch: /task07-media-(?:shell|routes)\.performance\.js/,
      use: {
        browserName: 'chromium',
        launchOptions: { args: ['--js-flags=--expose-gc'] },
      },
    },
    {
      name: 'task07-firefox',
      dependencies: ['auth-setup'],
      testMatch: /task07-media-cross-browser\.smoke\.js/,
      use: { browserName: 'firefox' },
    },
    {
      name: 'task07-webkit',
      dependencies: ['auth-setup'],
      testMatch: /task07-media-cross-browser\.smoke\.js/,
      use: { browserName: 'webkit' },
    },
    {
      name: 'task07-soak',
      dependencies: ['auth-setup'],
      testMatch: /task07-media-soak\.performance\.js/,
      timeout: task07SoakRuntime.timeoutMs,
      use: {
        browserName: 'chromium',
        launchOptions: { args: ['--js-flags=--expose-gc'] },
        trace: 'off',
        screenshot: 'only-on-failure',
      },
    },
  ],
});
