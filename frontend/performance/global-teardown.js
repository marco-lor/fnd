const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJson, resultsDir, writeJson } = require('../scripts/performance/common');

module.exports = async () => {
  const webServerMarker = path.join(
    path.resolve(__dirname, '..'),
    '.perf-emulator-data',
    'playwright-webserver.active'
  );
  fs.rmSync(webServerMarker, { force: true });
  const scenarioDirectory = path.join(resultsDir, 'scenarios');
  if (!fs.existsSync(scenarioDirectory)) return;
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
    },
    scenarios,
  });
};
