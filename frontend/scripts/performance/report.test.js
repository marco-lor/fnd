const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMetricMap, resolveGitCommit } = require('./report');

test('build and scenario reports flatten into stable budget keys', () => {
  const metrics = buildMetricMap({
    buildReport: { assets: [{ category: 'javascript', classification: 'entry', gzipBytes: 123 }] },
    browserReport: { scenarios: [{ id: 'login-cold', metrics: { 'runtime.consoleErrors': 0 } }] },
  });
  assert.deepEqual(metrics, {
    'build:javascript.entry.gzipBytes': 123,
    'login-cold:runtime.consoleErrors': 0,
  });
});

test('zero-gate metrics retain the worst iteration instead of hiding a single leak in the median', () => {
  const metrics = buildMetricMap({
    browserReport: {
      scenarios: [
        { id: 'home', metrics: { 'runtime.activeTimeoutsAfterCleanup': 0, 'runtime.activeMediaAfterCleanup': 0 } },
        { id: 'home', metrics: { 'runtime.activeTimeoutsAfterCleanup': 0, 'runtime.activeMediaAfterCleanup': 1 } },
        { id: 'home', metrics: { 'runtime.activeTimeoutsAfterCleanup': 1, 'runtime.activeMediaAfterCleanup': 0 } },
      ],
    },
  });

  assert.equal(metrics['home:runtime.activeTimeoutsAfterCleanup'], 1);
  assert.equal(metrics['home:runtime.activeMediaAfterCleanup'], 1);
});

test('Task 07 media caps retain the worst observed shell measurement', () => {
  const metrics = buildMetricMap({
    browserReport: {
      scenarios: [
        { id: 'task07-media-shell', metrics: { 'task07.audioNodes': 0, 'task07.attachedImages': 20 } },
        { id: 'task07-media-shell', metrics: { 'task07.audioNodes': 1, 'task07.attachedImages': 90 } },
        { id: 'task07-media-shell', metrics: { 'task07.audioNodes': 0, 'task07.attachedImages': 30 } },
      ],
    },
  });

  assert.equal(metrics['task07-media-shell:task07.audioNodes'], 1);
  assert.equal(metrics['task07-media-shell:task07.attachedImages'], 90);
});

test('commit identity always comes from HEAD and rejects a stale inherited GITHUB_SHA', () => {
  const head = 'a'.repeat(40);
  const execFileSync = () => `${head}\n`;
  assert.equal(resolveGitCommit({ environment: {}, execFileSync }), head);
  assert.equal(resolveGitCommit({ environment: { GITHUB_SHA: head }, execFileSync }), head);
  assert.throws(
    () => resolveGitCommit({ environment: { GITHUB_SHA: 'b'.repeat(40) }, execFileSync }),
    /does not match the checked-out HEAD/
  );
});
