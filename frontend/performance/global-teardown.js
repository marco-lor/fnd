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
  frontendRoot,
  projectId,
  readJson,
  resultsDir,
  writeJson,
} = require('../scripts/performance/common');

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
  try {
    try {
      await setBackgroundTriggersEnabled(true, { projectId });
    } catch (error) {
      errors.push(error);
    }

    try {
      const healthReportPath = path.join(resultsDir, 'emulator-health.json');
      if (!fs.existsSync(healthReportPath)) {
        throw new Error('Emulator health report is missing; measurement trigger suppression cannot be verified.');
      }
      const healthReport = readJson(healthReportPath);
      measurementTriggerActivity = summarizeTriggerActivity(
        path.join(frontendRoot, '.perf-emulator-data', 'emulator.log')
      );
      suppression = assertMeasurementTriggerSuppression(
        healthReport.measurementWindow?.triggerActivityBaseline,
        measurementTriggerActivity
      );
    } catch (error) {
      errors.push(error);
    }

    try {
      logBudget = assertLogWithinBudget({
        logPath: path.join(frontendRoot, 'firebase-debug.log'),
        projectId,
      });
    } catch (error) {
      errors.push(error);
    }

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
            projectId: 'demo-fnd-perf',
            runId: process.env.FND_PERF_RUN_ID || 'local',
            authoritative: process.env.FND_PERF_AUTHORITATIVE === '1',
            retainedIterations: Number(process.env.FND_PERF_ITERATIONS || 1),
            browsers,
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
  } finally {
    fs.rmSync(webServerMarker, { force: true });
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new global.AggregateError(errors, 'Performance emulator teardown failed multiple gates.');
  }
};
