const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  completeTask08Run,
  createTask08Run,
  readTask08Report,
  recordTask08Scenario,
  sourceTreeIdentity,
} = require('./task08-report');

const temporaryReportPath = () => path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-task08-report-')),
  'task08-baseline.json'
);

const identity = (overrides = {}) => ({
  head: 'head-1',
  dirty: true,
  sourceTreeFingerprint: 'source-1',
  trackedDiffFingerprint: 'diff-1',
  untrackedSourceTestFiles: ['src/performance/task08.js'],
  fixture: {
    version: 'fixture-1',
    hash: 'fixture-hash-1',
  },
  build: {
    identity: 'build-1',
    sourceTreeFingerprint: 'source-1',
  },
  browser: {
    project: 'task08-chromium',
    name: 'chromium',
    version: 'test-browser',
  },
  ...overrides,
});

test('a new run replaces stale scenario data and exposes dirty source identity', () => {
  const reportPath = temporaryReportPath();
  fs.writeFileSync(reportPath, JSON.stringify({
    schemaVersion: 2,
    status: 'complete',
    complete: true,
    runId: 'old-run',
    scenarios: [{ id: 'task08-home', observed: { stale: true } }],
  }));

  const report = createTask08Run({
    reportPath,
    runId: 'new-run',
    identity: identity(),
    now: () => '2026-08-28T10:00:00.000Z',
  });

  assert.equal(report.runId, 'new-run');
  assert.equal(report.status, 'partial');
  assert.equal(report.complete, false);
  assert.deepEqual(report.scenarios, []);
  assert.equal(report.identity.dirty, true);
  assert.equal(readTask08Report(reportPath).runId, 'new-run');
});

test('scenario recording rejects a mixed run/source identity', () => {
  const reportPath = temporaryReportPath();
  createTask08Run({
    reportPath,
    runId: 'run-1',
    identity: identity(),
  });

  assert.throws(
    () => recordTask08Scenario({
      reportPath,
      runId: 'run-2',
      identity: identity(),
      scenarioId: 'task08-home',
      result: { observed: {} },
    }),
    /runId/i
  );
  assert.throws(
    () => recordTask08Scenario({
      reportPath,
      runId: 'run-1',
      identity: identity({ sourceTreeFingerprint: 'source-2' }),
      scenarioId: 'task08-home',
      result: { observed: {} },
    }),
    /identity|source/i
  );
});

test('an incomplete required scenario set cannot be represented as complete', () => {
  const reportPath = temporaryReportPath();
  createTask08Run({
    reportPath,
    runId: 'run-1',
    identity: identity(),
  });
  recordTask08Scenario({
    reportPath,
    runId: 'run-1',
    identity: identity(),
    scenarioId: 'task08-home',
    result: { observed: {} },
  });

  assert.throws(
    () => completeTask08Run({ reportPath }),
    /required|incomplete|scenario/i
  );
  const report = readTask08Report(reportPath);
  assert.equal(report.status, 'partial');
  assert.equal(report.complete, false);
});

test('source-tree fingerprint includes tracked diff and sorted untracked source/test files', () => {
  const files = {
    'src/z.test.js': Buffer.from('z'),
    'src/a.js': Buffer.from('a'),
    'performance-results/ignored.json': Buffer.from('ignored'),
  };
  const identityValue = sourceTreeIdentity({
    repoRoot: 'C:/repo',
    execFileSync: (_command, args) => {
      if (args.includes('rev-parse')) return 'head-1\n';
      if (args.includes('status')) return ' M tracked.js\n?? src/z.test.js\n?? src/a.js\n';
      if (args.includes('diff')) return Buffer.from('tracked-diff');
      if (args.includes('ls-files')) return 'src/z.test.js\nperformance-results/ignored.json\nsrc/a.js\n';
      throw new Error(`Unexpected git invocation: ${args.join(' ')}`);
    },
    readFileSync: (filePath) => {
      const relative = filePath.replaceAll('\\', '/').replace('C:/repo/', '');
      return files[relative];
    },
    existsSync: () => true,
  });

  assert.equal(identityValue.head, 'head-1');
  assert.equal(identityValue.dirty, true);
  assert.deepEqual(identityValue.untrackedSourceTestFiles, ['src/a.js', 'src/z.test.js']);
  assert.match(identityValue.sourceTreeFingerprint, /^[a-f0-9]{64}$/);
});
