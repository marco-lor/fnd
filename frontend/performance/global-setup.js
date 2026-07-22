const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fixtureManifest = require('./fixture-manifest.json');
const {
  DEFAULT_LOG_BUDGET_BYTES,
  assertLogWithinBudget,
  disableBackgroundTriggersWithRecovery,
  setBackgroundTriggersEnabled,
  waitForEmulatorHealth,
} = require('../scripts/performance/emulator-control');
const { firebaseDebugLogPaths } = require('../scripts/performance/emulators');
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
const MAX_SEED_BACKGROUND_INVOCATIONS = 50;
const READINESS_BACKGROUND_TRIGGERS = new Set([
  'europe-west8-updateHpTotal',
  'europe-west8-updateManaTotal',
  'europe-west8-updateTotParameters',
  'europe-west8-updateAnimaModifier',
  'europe-west8-expireBarriera',
  'europe-west8-syncUserDirectory',
]);

const summarizeTriggerActivityText = (contents = '') => {
  const names = Array.from(contents.matchAll(/Beginning execution of "([^"]+)"/g), (match) => match[1]);
  const counts = names.reduce((result, name) => {
    result[name] = (result[name] || 0) + 1;
    return result;
  }, {});
  const cleanupInvocations = counts['europe-west1-cleanupReplacedGrigliataTokenImage'] || 0;
  const backgroundInvocations = names.filter((name) => (
    name !== 'europe-west1-clientFirebaseConfig'
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
    name !== 'europe-west1-clientFirebaseConfig'
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
      if (missing.length) {
        lastError = `missing emulator registrations: ${missing.join(', ')}`;
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
  fs.rmSync(scenarioDirectory, { recursive: true, force: true });
  fs.rmSync(healthReportPath, { force: true });
  fs.rmSync(authDiagnosticsPath, { force: true });
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
    const seed = childProcess.spawnSync(
      process.execPath,
      [path.join(frontendRoot, 'scripts', 'performance', 'fixtures.js'), 'seed'],
      { cwd: frontendRoot, env: process.env, encoding: 'utf8' }
    );
    if (seed.status !== 0) {
      throw new Error(`Deterministic fixture setup failed.\n${seed.stdout || ''}\n${seed.stderr || ''}`);
    }
    process.stdout.write(seed.stdout || '');

    stage = 'post-seed-health';
    report.health = await collectEmulatorHealth('post-seed');

    stage = 'disable-measurement-triggers';
    await disableBackgroundTriggersWithRecovery({ projectId });
    triggersDisabled = true;
    report.measurementWindow.backgroundTriggersEnabled = false;

    stage = 'seed-trigger-accounting';
    report.triggerActivity = summarizeTriggerActivity(emulatorLogPath);
    report.measurementWindow.triggerActivityBaseline = report.triggerActivity;

    stage = 'security-rules';
    const rules = childProcess.spawnSync(
      process.execPath,
      ['--test', path.join(frontendRoot, 'performance', 'tests', 'firestore-rules.test.js')],
      { cwd: frontendRoot, env: process.env, encoding: 'utf8' }
    );
    if (rules.status !== 0) {
      throw new Error(`Security Rules integration tests failed.\n${rules.stdout || ''}\n${rules.stderr || ''}`);
    }
    process.stdout.write(rules.stdout || '');

    const directoryQueryBuilder = childProcess.spawnSync(
      process.execPath,
      ['--test', path.join(frontendRoot, 'performance', 'tests', 'user-directory-query-builder.test.js')],
      { cwd: frontendRoot, env: process.env, encoding: 'utf8' }
    );
    if (directoryQueryBuilder.status !== 0) {
      throw new Error(`User-directory query-builder integration tests failed.\n${directoryQueryBuilder.stdout || ''}\n${directoryQueryBuilder.stderr || ''}`);
    }
    process.stdout.write(directoryQueryBuilder.stdout || '');

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
