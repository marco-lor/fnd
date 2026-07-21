const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fixtureManifest = require('./fixture-manifest.json');
const {
  assertLogWithinBudget,
  setBackgroundTriggersEnabled,
  waitForEmulatorHealth,
} = require('../scripts/performance/emulator-control');
const {
  projectId,
  writeJson,
} = require('../scripts/performance/common');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const MAX_SEED_BACKGROUND_INVOCATIONS = 50;

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

  if (cleanupInvocations !== 0) {
    throw new Error(
      `Bulk fixture seeding invoked cleanupReplacedGrigliataTokenImage ${cleanupInvocations} times.`
    );
  }
  if (backgroundInvocations > MAX_SEED_BACKGROUND_INVOCATIONS) {
    throw new Error(
      `Fixture readiness produced ${backgroundInvocations} background invocations; `
      + `expected at most ${MAX_SEED_BACKGROUND_INVOCATIONS}.`
    );
  }

  return { counts, backgroundInvocations, cleanupInvocations };
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

const waitForEmulators = async () => {
  const required = ['auth', 'firestore', 'functions', 'hosting', 'storage'];
  const deadline = Date.now() + 240_000;
  let lastError = 'emulator hub did not respond';
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4400/emulators');
      if (response.ok) {
        const emulators = await response.json();
        const missing = required.filter((name) => !emulators[name]);
        if (!missing.length) {
          const functionProbe = await fetch(
            'http://127.0.0.1:5001/demo-fnd-perf/europe-west1/clientFirebaseConfig'
          );
          if (functionProbe.ok) return;
          lastError = `Functions runtime probe returned ${functionProbe.status}`;
        } else {
          lastError = `missing emulator registrations: ${missing.join(', ')}`;
        }
      } else {
        lastError = `emulator hub returned ${response.status}`;
      }
    } catch (error) {
      lastError = error.message;
    }
    await delay(500);
  }
  throw new Error(`Firebase emulators were not ready within 240 seconds (${lastError}).`);
};

module.exports = async () => {
  const frontendRoot = path.resolve(__dirname, '..');
  const resultsDirectory = path.join(frontendRoot, 'performance-results');
  const scenarioDirectory = path.join(resultsDirectory, 'scenarios');
  const healthReportPath = path.join(resultsDirectory, 'emulator-health.json');
  fs.rmSync(scenarioDirectory, { recursive: true, force: true });
  fs.rmSync(healthReportPath, { force: true });
  fs.mkdirSync(scenarioDirectory, { recursive: true });

  await waitForEmulators();

  const seed = childProcess.spawnSync(
    process.execPath,
    [path.join(frontendRoot, 'scripts', 'performance', 'fixtures.js'), 'seed'],
    { cwd: frontendRoot, env: process.env, encoding: 'utf8' }
  );
  if (seed.status !== 0) {
    throw new Error(`Deterministic fixture setup failed.\n${seed.stdout || ''}\n${seed.stderr || ''}`);
  }
  process.stdout.write(seed.stdout || '');

  process.env.GCLOUD_PROJECT ||= projectId;
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  const healthApp = initializeApp(
    { projectId },
    `performance-global-setup-health-${Date.now()}`
  );
  let health;
  try {
    health = await waitForEmulatorHealth({
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

  const rules = childProcess.spawnSync(
    process.execPath,
    ['--test', path.join(frontendRoot, 'performance', 'tests', 'firestore-rules.test.js')],
    { cwd: frontendRoot, env: process.env, encoding: 'utf8' }
  );
  if (rules.status !== 0) {
    throw new Error(`Security Rules integration tests failed.\n${rules.stdout || ''}\n${rules.stderr || ''}`);
  }
  process.stdout.write(rules.stdout || '');

  const emulatorLogPath = path.join(frontendRoot, '.perf-emulator-data', 'emulator.log');
  await setBackgroundTriggersEnabled(false, { projectId });
  try {
    const triggerActivity = summarizeTriggerActivity(emulatorLogPath);
    const logBudget = assertLogWithinBudget({
      logPath: path.join(frontendRoot, 'firebase-debug.log'),
      projectId,
    });
    writeJson(healthReportPath, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      projectId,
      fixture: {
        version: fixtureManifest.version,
        hash: fixtureManifest.canonicalHash,
        documentCount: fixtureManifest.documentCount,
      },
      health,
      triggerActivity,
      measurementWindow: {
        backgroundTriggersEnabled: false,
        triggerActivityBaseline: triggerActivity,
      },
      logs: { firebaseDebug: logBudget },
    });
  } catch (error) {
    try {
      await setBackgroundTriggersEnabled(true, { projectId });
    } catch (cleanupError) {
      throw new global.AggregateError(
        [error, cleanupError],
        'Global setup failed after disabling background triggers, and triggers could not be re-enabled.'
      );
    }
    throw error;
  }
};

module.exports.assertMeasurementTriggerSuppression = assertMeasurementTriggerSuppression;
module.exports.summarizeTriggerActivity = summarizeTriggerActivity;
module.exports.summarizeTriggerActivityText = summarizeTriggerActivityText;
