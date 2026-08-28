const fs = require('fs');
const path = require('path');
const { deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fixtureManifest = require('./fixture-manifest.json');
const { runBoundedChildProcess } = require('../scripts/bounded-child-process');
const {
  DEFAULT_LOG_BUDGET_BYTES,
  assertLogWithinBudget,
  disableBackgroundTriggersWithRecovery,
  setBackgroundTriggersEnabled,
  waitForEmulatorHealth,
} = require('../scripts/performance/emulator-control');
const {
  FIREBASE_HOSTING_UPSTREAM_PORT,
  firebaseDebugLogPaths,
} = require('../scripts/performance/emulators');
const {
  PERFORMANCE_ENVIRONMENT_MODE,
  PERFORMANCE_PROJECT_ID: projectId,
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  writeJson,
} = require('../scripts/performance/common');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const STARTUP_TIMEOUT_MS = 240_000;
const STARTUP_REQUEST_TIMEOUT_MS = 10_000;
const STARTUP_INTERVAL_MS = 500;
const FIXTURE_SEED_TIMEOUT_MS = 300_000;
const TASK07_CALLABLES_TIMEOUT_MS = 240_000;
const SECURITY_RULES_TIMEOUT_MS = 120_000;
const DIRECTORY_QUERY_TIMEOUT_MS = 30_000;
// Includes the reviewed Task 07 callable fixtures that run before measurement
// triggers are disabled. The allowlist below still rejects any other trigger,
// and teardown requires zero growth throughout the measurement window.
const MAX_SEED_BACKGROUND_INVOCATIONS = 150;
const TASK07_MEDIA_INTEGRATION_ENABLED =
  process.env.FND_TASK07_MEDIA_INTEGRATION === '1';
const NON_BACKGROUND_HTTP_FUNCTIONS = new Set([
  'europe-west1-clientFirebaseConfig',
  'europe-west8-task05ListAdminUsers',
  'europe-west8-task05UpdateResource',
  'europe-west8-task05CharacterCreation',
  'europe-west8-task05PrepareConsumable',
  'europe-west8-task05CommitConsumable',
  'europe-west8-task07PrepareMediaUpload',
  'europe-west8-task07GetMediaStatus',
  'europe-west8-task07ResolveCharacterMedia',
  'europe-west8-task07AttachMediaAsset',
  'europe-west8-task07PrepareFoeMediaRetirement',
  'europe-west8-task07CommitFoeMediaRetirement',
  'europe-west8-task07AbandonFoeMediaRetirement',
]);
const READINESS_BACKGROUND_TRIGGERS = new Set([
  'europe-west8-syncUserDirectory',
  'europe-west8-cleanupLegacyRemovedFoeMedia',
  'europe-west8-cleanupLegacyRemovedUserMedia',
  'europe-west8-cleanupTask07RemovedBackgroundMedia',
  'europe-west8-cleanupTask07RemovedCatalogItemMedia',
  'europe-west8-cleanupTask07RemovedFoeMedia',
  'europe-west8-cleanupTask07RemovedInventoryMedia',
  'europe-west8-cleanupTask07RemovedNpcMedia',
  'europe-west8-cleanupTask07RemovedUserMedia',
  'europe-west8-cleanupTask07MediaAsset',
  'europe-west8-syncTask07MusicStreamFromControl',
  'europe-west8-syncTask07MusicStreamFromPlayback',
  'europe-west8-syncTask07MusicStreamFromSession',
  'europe-west8-task07ProcessMediaUpload',
]);

const summarizeTriggerActivityText = (contents = '') => {
  const names = Array.from(contents.matchAll(/Beginning execution of "([^"]+)"/g), (match) => match[1]);
  const counts = names.reduce((result, name) => {
    result[name] = (result[name] || 0) + 1;
    return result;
  }, {});
  const cleanupInvocations = counts['europe-west1-cleanupReplacedGrigliataTokenImage'] || 0;
  const backgroundInvocations = names.filter((name) => (
    !NON_BACKGROUND_HTTP_FUNCTIONS.has(name)
  )).length;
  const activity = { counts, backgroundInvocations, cleanupInvocations };
  const failWithActivity = (message) => {
    const error = new Error(message);
    error.triggerActivity = activity;
    throw error;
  };

  if (cleanupInvocations !== 0) {
    failWithActivity(
      `Bulk fixture seeding invoked cleanupReplacedGrigliataTokenImage ${cleanupInvocations} times.`
    );
  }
  const unexpectedBackgroundTriggers = [...new Set(names.filter((name) => (
    !NON_BACKGROUND_HTTP_FUNCTIONS.has(name)
    && !READINESS_BACKGROUND_TRIGGERS.has(name)
  )))];
  if (unexpectedBackgroundTriggers.length) {
    failWithActivity(
      `Fixture readiness invoked unexpected background triggers: ${unexpectedBackgroundTriggers.join(', ')}.`
    );
  }
  if (backgroundInvocations > MAX_SEED_BACKGROUND_INVOCATIONS) {
    failWithActivity(
      `Fixture readiness produced ${backgroundInvocations} background invocations; `
      + `expected at most ${MAX_SEED_BACKGROUND_INVOCATIONS}.`
    );
  }

  return activity;
};

const summarizeTriggerActivity = (emulatorLogPath) => summarizeTriggerActivityText(
  fs.existsSync(emulatorLogPath) ? fs.readFileSync(emulatorLogPath, 'utf8') : ''
);

const assertMeasurementTriggerSuppression = (baseline, current) => {
  const expected = Number(baseline?.backgroundInvocations);
  const observed = Number(current?.backgroundInvocations);
  if (!Number.isFinite(expected) || !Number.isFinite(observed)) {
    throw new Error('Measurement trigger activity is missing a valid background invocation count.');
  }
  if (observed !== expected) {
    throw new Error(
      `Background triggers ran during the measurement window: expected ${expected} total invocations, `
      + `observed ${observed}.`
    );
  }
  return { expected, observed };
};

const fetchStartupResponse = async ({
  fetchImpl,
  url,
  timeoutMs,
  label,
  consumeResponse,
}) => {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const request = Promise.resolve().then(async () => {
    const response = await fetchImpl(url, { signal: controller.signal });
    return consumeResponse(response);
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (timedOut) throw new Error(`${label} timed out after ${timeoutMs} ms.`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const readStartupResponseText = async (response) => (
  typeof response?.text === 'function' ? String(await response.text()) : ''
);

const waitForEmulators = async ({
  fetchImpl = global.fetch,
  lifecycleProjectId = projectId,
  timeoutMs = STARTUP_TIMEOUT_MS,
  requestTimeoutMs = STARTUP_REQUEST_TIMEOUT_MS,
  intervalMs = STARTUP_INTERVAL_MS,
  sleepImpl = delay,
  nowImpl = Date.now,
} = {}) => {
  assertPerformanceProject(lifecycleProjectId);
  if (typeof fetchImpl !== 'function' || typeof sleepImpl !== 'function' || typeof nowImpl !== 'function') {
    throw new TypeError('Startup fetch, sleep, and clock implementations must be functions.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Startup timeout must be a positive finite number.');
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new TypeError('Startup request timeout must be a positive finite number.');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new TypeError('Startup interval must be a non-negative finite number.');
  }
  const required = ['auth', 'firestore', 'functions', 'hosting', 'storage'];
  const deadline = nowImpl() + timeoutMs;
  let lastError = 'emulator hub did not respond';
  const nextRequestTimeout = () => {
    const remaining = deadline - nowImpl();
    if (remaining <= 0) throw new Error('Firebase emulator startup deadline expired.');
    return Math.min(requestTimeoutMs, remaining);
  };

  while (nowImpl() < deadline) {
    try {
      const emulators = await fetchStartupResponse({
        fetchImpl,
        url: 'http://127.0.0.1:4400/emulators',
        timeoutMs: nextRequestTimeout(),
        label: 'Firebase Emulator Hub startup probe',
        consumeResponse: async (response) => {
          if (!response?.ok) {
            const detail = (await readStartupResponseText(response)).slice(0, 500).trim();
            throw new Error(
              `Firebase Emulator Hub startup probe returned HTTP ${response?.status ?? 'unknown'}`
              + `${detail ? ` (${detail})` : ''}.`
            );
          }
          return response.json();
        },
      });
      const missing = required.filter((name) => !emulators?.[name]);
      const registeredHostingPort = Number(emulators?.hosting?.port);
      if (missing.length) {
        lastError = `missing emulator registrations: ${missing.join(', ')}`;
      } else if (registeredHostingPort !== FIREBASE_HOSTING_UPSTREAM_PORT) {
        lastError = (
          `Firebase Hosting registered on port ${registeredHostingPort || 'unknown'}; `
          + `expected ${FIREBASE_HOSTING_UPSTREAM_PORT}`
        );
      } else {
        await fetchStartupResponse({
          fetchImpl,
          url: `http://127.0.0.1:5001/${encodeURIComponent(lifecycleProjectId)}/europe-west1/clientFirebaseConfig`,
          timeoutMs: nextRequestTimeout(),
          label: 'Functions runtime startup probe',
          consumeResponse: async (response) => {
            const contents = await readStartupResponseText(response);
            if (!response?.ok) {
              const detail = contents.slice(0, 500).trim();
              throw new Error(
                `Functions runtime startup probe returned HTTP ${response?.status ?? 'unknown'}`
                + `${detail ? ` (${detail})` : ''}.`
              );
            }
            return { status: response.status };
          },
        });
        if (nowImpl() > deadline) {
          throw new Error('Firebase emulator startup probes completed after the startup deadline.');
        }
        return;
      }
    } catch (error) {
      lastError = error.message;
    }
    const remaining = deadline - nowImpl();
    if (remaining <= 0) break;
    await sleepImpl(Math.min(intervalMs, remaining));
  }
  throw new Error(`Firebase emulators were not ready within ${timeoutMs} ms (${lastError}).`);
};

const collectEmulatorHealth = async (label) => {
  const healthApp = initializeApp(
    { projectId },
    `performance-global-setup-health-${label}-${Date.now()}`
  );
  try {
    return await waitForEmulatorHealth({
      db: getFirestore(healthApp),
      expectedManifest: {
        version: fixtureManifest.version,
        hash: fixtureManifest.canonicalHash,
      },
      projectId,
    });
  } finally {
    await deleteApp(healthApp);
  }
};

module.exports = async () => {
  configureOwnedPerformanceEnvironment({
    mode: PERFORMANCE_ENVIRONMENT_MODE.OWNED_OVERRIDE,
  });
  assertPerformanceProject(projectId);
  const frontendRoot = path.resolve(__dirname, '..');
  const resultsDirectory = path.join(frontendRoot, 'performance-results');
  const scenarioDirectory = path.join(resultsDirectory, 'scenarios');
  const healthReportPath = path.join(resultsDirectory, 'emulator-health.json');
  const authDiagnosticsPath = path.join(resultsDirectory, 'auth-setup-diagnostics.json');
  const assetWarmupDiagnosticsPath = path.join(
    resultsDirectory,
    'asset-warmup-diagnostics.json'
  );
  const browserAssetWarmupDiagnosticsPath = path.join(
    resultsDirectory,
    'browser-asset-warmup-diagnostics.json'
  );
  const browserWorkerAssetWarmupDiagnosticsPaths = [
    'chromium',
    'firefox-smoke',
    'webkit-smoke',
  ].map((projectName) => path.join(
    resultsDirectory,
    `browser-worker-asset-warmup-${projectName}.json`
  ));
  const browserContextAssetWarmupDiagnosticsPaths = fs.existsSync(resultsDirectory)
    ? fs.readdirSync(resultsDirectory)
      .filter((fileName) => (
        /^browser-asset-warmup-context-[a-z0-9-]+\.json$/.test(fileName)
      ))
      .map((fileName) => path.join(resultsDirectory, fileName))
    : [];
  fs.rmSync(scenarioDirectory, { recursive: true, force: true });
  fs.rmSync(healthReportPath, { force: true });
  fs.rmSync(authDiagnosticsPath, { force: true });
  fs.rmSync(assetWarmupDiagnosticsPath, { force: true });
  fs.rmSync(browserAssetWarmupDiagnosticsPath, { force: true });
  browserWorkerAssetWarmupDiagnosticsPaths.forEach((diagnosticsPath) => {
    fs.rmSync(diagnosticsPath, { force: true });
  });
  browserContextAssetWarmupDiagnosticsPaths.forEach((diagnosticsPath) => {
    fs.rmSync(diagnosticsPath, { force: true });
  });
  fs.mkdirSync(scenarioDirectory, { recursive: true });
  const emulatorLogPath = path.join(frontendRoot, '.perf-emulator-data', 'emulator.log');
  const firebaseDebugCandidates = firebaseDebugLogPaths(frontendRoot);
  const report = {
    schemaVersion: 1,
    generatedAt: null,
    projectId,
    status: 'running',
    fixture: {
      version: fixtureManifest.version,
      hash: fixtureManifest.canonicalHash,
      documentCount: fixtureManifest.documentCount,
    },
    health: null,
    triggerActivity: null,
    measurementWindow: {
      backgroundTriggersEnabled: true,
      health: null,
      triggerActivityBaseline: null,
    },
    logs: { firebaseDebug: null },
    failure: null,
  };
  const captureLogSize = () => ({
    logPath: null,
    logPaths: firebaseDebugCandidates,
    files: firebaseDebugCandidates
      .filter((candidate) => fs.existsSync(candidate))
      .map((candidate) => ({ logPath: candidate, sizeBytes: fs.statSync(candidate).size })),
    sizeBytes: firebaseDebugCandidates
      .filter((candidate) => fs.existsSync(candidate))
      .reduce((total, candidate) => total + fs.statSync(candidate).size, 0),
    maxBytes: DEFAULT_LOG_BUDGET_BYTES,
  });
  let stage = 'emulator-registration';
  let triggersDisabled = false;
  let setupError = null;
  let triggerCleanupError = null;

  try {
    await waitForEmulators();

    stage = 'fixture-seed';
    const seed = await runBoundedChildProcess({
      command: process.execPath,
      args: [path.join(frontendRoot, 'scripts', 'performance', 'fixtures.js'), 'seed'],
      cwd: frontendRoot,
      environment: process.env,
      timeoutMs: FIXTURE_SEED_TIMEOUT_MS,
      label: 'Deterministic fixture setup',
    });
    if (seed.status !== 0) {
      throw new Error(`Deterministic fixture setup failed.\n${seed.stdout || ''}\n${seed.stderr || ''}`);
    }
    process.stdout.write(seed.stdout || '');
    process.stderr.write(seed.stderr || '');

    stage = 'post-seed-health';
    report.health = await collectEmulatorHealth('post-seed');

    if (TASK07_MEDIA_INTEGRATION_ENABLED) {
      stage = 'task07-callable-integration';
      const task07Callables = await runBoundedChildProcess({
        command: process.execPath,
        args: [
          '--test',
          '--test-concurrency=1',
          path.join(
            frontendRoot,
            'performance',
            'tests',
            'task07-media-callables.test.js'
          ),
        ],
        cwd: frontendRoot,
        environment: process.env,
        timeoutMs: TASK07_CALLABLES_TIMEOUT_MS,
        label: 'Task 07 callable integration tests',
      });
      if (task07Callables.status !== 0) {
        throw new Error(
          `Task 07 callable integration tests failed.\n${task07Callables.stdout || ''}\n${task07Callables.stderr || ''}`
        );
      }
      process.stdout.write(task07Callables.stdout || '');
      process.stderr.write(task07Callables.stderr || '');
    }

    stage = 'disable-measurement-triggers';
    await disableBackgroundTriggersWithRecovery({
      projectId,
      disableAttempts: 2,
      retryDelayMs: 250,
    });
    triggersDisabled = true;
    report.measurementWindow.backgroundTriggersEnabled = false;

    stage = 'seed-trigger-accounting';
    report.triggerActivity = summarizeTriggerActivity(emulatorLogPath);
    report.measurementWindow.triggerActivityBaseline = report.triggerActivity;

    stage = 'security-rules';
    const ruleTestFiles = [
      path.join(frontendRoot, 'performance', 'tests', 'firestore-rules.test.js'),
      ...(TASK07_MEDIA_INTEGRATION_ENABLED ? [
        path.join(frontendRoot, 'performance', 'tests', 'task07-media-rules.test.js'),
      ] : []),
    ];
    const rules = await runBoundedChildProcess({
      command: process.execPath,
      args: ['--test', '--test-concurrency=1', ...ruleTestFiles],
      cwd: frontendRoot,
      environment: process.env,
      timeoutMs: SECURITY_RULES_TIMEOUT_MS,
      label: 'Security Rules integration tests',
    });
    if (rules.status !== 0) {
      throw new Error(`Security Rules integration tests failed.\n${rules.stdout || ''}\n${rules.stderr || ''}`);
    }
    process.stdout.write(rules.stdout || '');
    process.stderr.write(rules.stderr || '');

    const directoryQueryBuilder = await runBoundedChildProcess({
      command: process.execPath,
      args: [
        '--test',
        path.join(frontendRoot, 'performance', 'tests', 'user-directory-query-builder.test.js'),
      ],
      cwd: frontendRoot,
      environment: process.env,
      timeoutMs: DIRECTORY_QUERY_TIMEOUT_MS,
      label: 'User-directory query-builder integration tests',
    });
    if (directoryQueryBuilder.status !== 0) {
      throw new Error(`User-directory query-builder integration tests failed.\n${directoryQueryBuilder.stdout || ''}\n${directoryQueryBuilder.stderr || ''}`);
    }
    process.stdout.write(directoryQueryBuilder.stdout || '');
    process.stderr.write(directoryQueryBuilder.stderr || '');

    stage = 'measurement-health';
    report.measurementWindow.health = await collectEmulatorHealth('measurement-ready');

    stage = 'firebase-debug-log-budget';
    report.logs.firebaseDebug = assertLogWithinBudget({
      logPaths: firebaseDebugCandidates,
      projectId,
    });
    report.status = 'passed';
  } catch (error) {
    setupError = error;
    if (error.triggerActivity) {
      report.triggerActivity = error.triggerActivity;
      report.measurementWindow.triggerActivityBaseline = error.triggerActivity;
    }
    const failedHealth = error.samples
      ? { healthy: false, projectId, consecutiveSamples: 0, samples: error.samples }
      : null;
    if (stage === 'post-seed-health' && failedHealth) report.health = failedHealth;
    if (stage === 'measurement-health' && failedHealth) {
      report.measurementWindow.health = failedHealth;
    }
    report.status = 'failed';
    report.failure = { stage, message: error.message };
  } finally {
    report.logs.firebaseDebug ||= captureLogSize();
    if (setupError && triggersDisabled) {
      try {
        await setBackgroundTriggersEnabled(true, { projectId });
        report.measurementWindow.backgroundTriggersEnabled = true;
      } catch (error) {
        triggerCleanupError = error;
        report.failure.triggerCleanup = error.message;
      }
    }
    report.generatedAt = new Date().toISOString();
    writeJson(healthReportPath, report);
  }

  if (setupError && triggerCleanupError) {
    throw new global.AggregateError(
      [setupError, triggerCleanupError],
      'Global setup failed after disabling background triggers, and triggers could not be re-enabled.'
    );
  }
  if (setupError) throw setupError;
};

module.exports.assertMeasurementTriggerSuppression = assertMeasurementTriggerSuppression;
module.exports.fetchStartupResponse = fetchStartupResponse;
module.exports.summarizeTriggerActivity = summarizeTriggerActivity;
module.exports.summarizeTriggerActivityText = summarizeTriggerActivityText;
module.exports.waitForEmulators = waitForEmulators;
