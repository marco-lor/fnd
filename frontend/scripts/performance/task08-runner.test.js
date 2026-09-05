const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveTask08BrowserIdentity,
  runTask08,
} = require('./task08-runner');
const {
  readTask08Report,
  recordTask08Scenario,
} = require('./task08-report');

test('Task 08 browser identity records the version reported by the Playwright browser', async () => {
  let launchOptions;
  let closed = false;
  const identity = await resolveTask08BrowserIdentity({
    chromiumImpl: {
      launch: async (options) => {
        launchOptions = options;
        return {
          version: () => '140.0.7339.16',
          close: async () => { closed = true; },
        };
      },
    },
  });

  assert.deepEqual(identity, {
    project: 'task08-chromium',
    name: 'chromium',
    version: '140.0.7339.16',
    playwrightVersion: require('@playwright/test/package.json').version,
  });
  assert.deepEqual(launchOptions, { headless: true });
  assert.equal(closed, true);
});

test('Task 08 runner keeps a complete scenario set partial until emulator cleanup is verified', async () => {
  const reportPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-task08-cleanup-gate-')),
    'task08-baseline.json'
  );
  const scenarioIds = [
    'task08-login',
    'task08-character-creation',
    'task08-home',
    'task08-two-client',
  ];

  await assert.rejects(
    runTask08({
      reportPath,
      sourceIdentity: {
        head: 'head',
        dirty: true,
        statusPorcelain: ' M source.js',
        sourceTreeFingerprint: 'source',
        trackedDiffFingerprint: 'diff',
        untrackedSourceTestFiles: [],
      },
      fixtureIdentity: { version: 'fixture', hash: 'hash', documentCount: 1 },
      browserIdentity: { project: 'task08-chromium', name: 'chromium', version: 'browser' },
      validatePrerequisitesImpl: () => ({
        performance: { identity: { identity: 'build', sourceTreeFingerprint: 'source' } },
      }),
      spawnPlaywrightImpl: () => {
        const report = readTask08Report(reportPath);
        for (const scenarioId of scenarioIds) {
          recordTask08Scenario({
            reportPath,
            runId: report.runId,
            identity: report.identity,
            scenarioId,
          });
        }
        return { status: 0 };
      },
      waitForPortsImpl: async () => {
        throw new Error('owned emulator cleanup failed');
      },
    }),
    /owned emulator cleanup failed/
  );

  const report = readTask08Report(reportPath);
  assert.equal(report.status, 'partial');
  assert.equal(report.complete, false);
  assert.deepEqual(report.completedScenarioIds, scenarioIds.sort());
});

test('Task 08 runner does not start Playwright when prerequisite validation fails', async () => {
  const reportPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-task08-runner-')),
    'task08-baseline.json'
  );
  let playwrightStarted = false;
  await assert.rejects(
    runTask08({
      reportPath,
      sourceIdentity: { head: 'head', dirty: true, sourceTreeFingerprint: 'source' },
      fixtureIdentity: { version: 'fixture', hash: 'hash' },
      browserIdentity: { project: 'task08-chromium', name: 'chromium', version: 'browser' },
      validatePrerequisitesImpl: () => {
        throw new Error('Functions dependencies are missing');
      },
      spawnPlaywrightImpl: () => {
        playwrightStarted = true;
        return { status: 0 };
      },
    }),
    /Functions dependencies are missing/
  );
  assert.equal(playwrightStarted, false);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'partial');
  assert.equal(report.complete, false);
  assert.match(report.failure.message, /Functions dependencies/);
});
