#!/usr/bin/env node

const path = require('path');
const {
  assertSchemaVersion,
  authoritativeResultsDir,
  readJson,
  scenariosPath,
  writeJson,
} = require('./common');
const { collectCurrentReport } = require('./report');

const argumentValue = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const snapshotAuthoritativeRun = (runId = argumentValue('--run-id')) => {
  if (!runId || !/^[a-zA-Z0-9._-]+$/.test(runId)) {
    throw new Error('Provide a filesystem-safe authoritative run ID with --run-id.');
  }
  const report = collectCurrentReport();
  const manifest = assertSchemaVersion(readJson(scenariosPath), 'scenario manifest');
  assertSchemaVersion(report, 'authoritative report');
  const browserEnvironment = report.browser?.environment || {};
  if (!browserEnvironment.authoritative || browserEnvironment.runId !== runId) {
    throw new Error(`Browser report is not authoritative run ${runId}.`);
  }
  const retainedIterations = Number(browserEnvironment.retainedIterations);
  if (retainedIterations < 3) {
    throw new Error('Authoritative snapshots require at least three retained iterations.');
  }
  const missing = [];
  for (const scenario of manifest.scenarios) {
    const expected = scenario.scheduledOnly ? 1 : retainedIterations;
    const actual = (report.browser?.scenarios || [])
      .filter((entry) => (entry.scenarioId || entry.id) === scenario.id).length;
    if (actual !== expected) missing.push(`${scenario.id} expected ${expected}, found ${actual}`);
  }
  if (missing.length) throw new Error(`Authoritative scenario coverage is incomplete: ${missing.join('; ')}`);
  const outputPath = path.join(authoritativeResultsDir, `${runId}.json`);
  writeJson(outputPath, report);
  console.log(`Authoritative run snapshot written to ${outputPath}.`);
  return outputPath;
};

if (require.main === module) snapshotAuthoritativeRun();

module.exports = { snapshotAuthoritativeRun };
