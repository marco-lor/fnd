const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  assertLogWithinBudget,
  setBackgroundTriggersEnabled,
} = require('../scripts/performance/emulator-control');
const {
  assertMeasurementTriggerSuppression,
  summarizeTriggerActivity,
} = require('./global-setup');
const {
  assertPerformanceProject,
  frontendRoot,
  projectId,
  readJson,
  resultsDir,
  writeJson,
} = require('../scripts/performance/common');
const {
  firebaseDebugLogPaths,
  removePerformanceFirebaseConfig,
} = require('../scripts/performance/emulators');

const TEARDOWN_TRIGGER_CONTROL_TIMEOUT_MS = 180_000;

const reenableBackgroundTriggers = ({
  lifecycleProjectId = projectId,
  setBackgroundTriggersEnabledImpl = setBackgroundTriggersEnabled,
  timeoutMs = TEARDOWN_TRIGGER_CONTROL_TIMEOUT_MS,
} = {}) => setBackgroundTriggersEnabledImpl(true, {
  projectId: lifecycleProjectId,
  timeoutMs,
});

const collectTeardownEvidence = ({
  healthReport,
  emulatorLogPath,
  firebaseDebugLogPath,
  firebaseDebugLogPaths: firebaseDebugCandidates,
  lifecycleProjectId = projectId,
  summarizeTriggerActivityImpl = summarizeTriggerActivity,
  assertMeasurementTriggerSuppressionImpl = assertMeasurementTriggerSuppression,
  assertLogWithinBudgetImpl = assertLogWithinBudget,
}) => {
  const errors = [];
  let logBudget;
  let measurementTriggerActivity;
  let suppression;

  try {
    measurementTriggerActivity = summarizeTriggerActivityImpl(emulatorLogPath);
  } catch (error) {
    measurementTriggerActivity = error.triggerActivity || null;
    errors.push(error);
  }

  if (healthReport && measurementTriggerActivity) {
    try {
      suppression = assertMeasurementTriggerSuppressionImpl(
        healthReport.measurementWindow?.triggerActivityBaseline,
        measurementTriggerActivity
      );
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    logBudget = assertLogWithinBudgetImpl({
      ...(firebaseDebugCandidates
        ? { logPaths: firebaseDebugCandidates }
        : { logPath: firebaseDebugLogPath }),
      projectId: lifecycleProjectId,
    });
  } catch (error) {
    logBudget = error.logBudget || null;
    errors.push(error);
  }

  return {
    errors,
    logBudget,
    measurementTriggerActivity,
    suppression,
  };
};

module.exports = async () => {
  const webServerMarker = path.join(
    path.resolve(__dirname, '..'),
    '.perf-emulator-data',
    'playwright-webserver.active'
  );
  const errors = [];
  let logBudget;
  let measurementTriggerActivity;
  let suppression;
  let demoProjectValidated = false;
  try {
    assertPerformanceProject(projectId);
    demoProjectValidated = true;

    let healthReport = null;
    const healthReportPath = path.join(resultsDir, 'emulator-health.json');
    try {
      if (!fs.existsSync(healthReportPath)) {
        throw new Error('Emulator health report is missing; measurement trigger suppression cannot be verified.');
      }
      healthReport = readJson(healthReportPath);
    } catch (error) {
      errors.push(error);
    }

    const evidence = collectTeardownEvidence({
      healthReport,
      emulatorLogPath: path.join(frontendRoot, '.perf-emulator-data', 'emulator.log'),
      firebaseDebugLogPaths: firebaseDebugLogPaths(frontendRoot),
      lifecycleProjectId: projectId,
    });
    logBudget = evidence.logBudget;
    measurementTriggerActivity = evidence.measurementTriggerActivity;
    suppression = evidence.suppression;
    errors.push(...evidence.errors);

    try {
      const scenarioDirectory = path.join(resultsDir, 'scenarios');
      if (fs.existsSync(scenarioDirectory)) {
        const scenarios = fs.readdirSync(scenarioDirectory)
          .filter((name) => name.endsWith('.json'))
          .sort()
          .map((name) => readJson(path.join(scenarioDirectory, name)));
        const browsers = Array.from(new Map(scenarios
          .filter((scenario) => scenario.environment?.browserName && scenario.environment?.browserVersion)
          .map((scenario) => [
            `${scenario.environment.browserName}:${scenario.environment.browserVersion}`,
            scenario.environment,
          ])).values());
        const authDiagnosticsPath = path.join(resultsDir, 'auth-setup-diagnostics.json');
        const authSetupDiagnostics = fs.existsSync(authDiagnosticsPath)
          ? readJson(authDiagnosticsPath)
          : null;

        writeJson(path.join(resultsDir, 'browser-report.json'), {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          environment: {
            node: process.version,
            platform: process.platform,
            architecture: process.arch,
            cpuModel: os.cpus()[0]?.model || 'unknown',
            cpuCount: os.cpus().length,
            totalMemoryBytes: os.totalmem(),
            projectId,
            runId: process.env.FND_PERF_RUN_ID || 'local',
            authoritative: process.env.FND_PERF_AUTHORITATIVE === '1',
            retainedIterations: Number(process.env.FND_PERF_ITERATIONS || 1),
            browsers,
            authSetupDiagnostics,
            emulatorLogs: { firebaseDebug: logBudget || null },
            measurementTriggerSuppression: {
              ...suppression,
              triggerActivity: measurementTriggerActivity || null,
            },
          },
          scenarios,
        });
      }
    } catch (error) {
      errors.push(error);
    }
  } catch (error) {
    errors.push(error);
  } finally {
    if (demoProjectValidated) {
      try {
        await reenableBackgroundTriggers();
      } catch (error) {
        errors.push(error);
      }
    }
    fs.rmSync(webServerMarker, { force: true });
    try {
      removePerformanceFirebaseConfig();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new global.AggregateError(errors, 'Performance emulator teardown failed multiple gates.');
  }
};

module.exports.collectTeardownEvidence = collectTeardownEvidence;
module.exports.reenableBackgroundTriggers = reenableBackgroundTriggers;
module.exports.TEARDOWN_TRIGGER_CONTROL_TIMEOUT_MS = TEARDOWN_TRIGGER_CONTROL_TIMEOUT_MS;
