const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {resolveOperatorTarget} = require('./firebase-operator-target');

const FRONTEND_ROOT = path.resolve(__dirname, '..');

const target = (environmentName, projectId, hostingSite, storageBucket) => ({
  environmentName,
  projectId,
  hostingSite,
  storageBucket,
});

test('operator target selection is explicit and branch-aware', () => {
  assert.equal(resolveOperatorTarget({
    environment: {FND_GIT_BRANCH: 'devs'},
    options: target('staging', 'fatin-test', 'fatin-test', 'fatin-test.firebasestorage.app'),
  }).name, 'staging');
  assert.throws(
    () => resolveOperatorTarget({
      environment: {FND_GIT_BRANCH: 'main'},
      options: target('staging', 'fatin-test', 'fatin-test', 'fatin-test.firebasestorage.app'),
    }),
    /staging.*devs|devs.*staging/i
  );
});

test('operator target selection rejects implicit, mismatched, and performance targets by default', () => {
  assert.throws(
    () => resolveOperatorTarget({
      environment: {FND_GIT_BRANCH: 'main'},
      options: {projectId: 'fatins', hostingSite: 'fatins', storageBucket: 'fatins.firebasestorage.app'},
    }),
    /explicit.*environment/i
  );
  assert.throws(
    () => resolveOperatorTarget({
      environment: {FND_GIT_BRANCH: 'main'},
      options: target('production', 'fatin-test', 'fatin-test', 'fatin-test.firebasestorage.app'),
    }),
    /target mismatch|fatins|fatin-test/i
  );
  assert.throws(
    () => resolveOperatorTarget({
      environment: {FND_GIT_BRANCH: 'main'},
      options: target('performance', 'demo-fnd-perf', 'demo-fnd-perf', 'demo-fnd-perf.appspot.com'),
    }),
    /performance environment/i
  );
  assert.equal(resolveOperatorTarget({
    allowPerformance: true,
    environment: {FND_GIT_BRANCH: 'main'},
    options: target('performance', 'demo-fnd-perf', 'demo-fnd-perf', 'demo-fnd-perf.appspot.com'),
  }).name, 'performance');
});

test('Firebase-backed operator entry points validate the central target before access', () => {
  const entrypoints = [
    'task05/user-data-migration.js',
    'task05/user-data-rollout-stage.js',
    'task05/user-data-compaction.js',
    'task05/user-data-cutover.js',
    'task06/backend-rollout-control.js',
    'task07/media-derivative-backfill.js',
    'task07/media-rollout-control.js',
    'task07/media-storage-inventory.js',
    'task07/media-temporary-object-cleanup.js',
  ];
  for (const relativePath of entrypoints) {
    const source = fs.readFileSync(path.join(FRONTEND_ROOT, 'scripts', relativePath), 'utf8');
    assert.match(source, /resolveOperatorTarget/);
  }
});

test('operator package commands carry an explicit semantic target tuple', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(FRONTEND_ROOT, 'package.json'), 'utf8'));
  const commandNames = [
    'users:migrate-v2',
    'users:set-v2-stage',
    'users:compact-v2',
    'users:cutover-v2',
    'task07:media-backfill:plan',
    'task07:media-canonical-audit',
    'task07:media-storage-inventory',
    'task07:media-temporary-cleanup',
    'task07:media-rollout-control',
  ];
  for (const commandName of commandNames) {
    assert.match(
      packageJson.scripts[commandName],
      /--environment\s+\S+\s+--project\s+\S+\s+--site\s+\S+\s+--bucket\s+\S+/
    );
  }
});
