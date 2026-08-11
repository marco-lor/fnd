const test = require('node:test');
const assert = require('node:assert/strict');
const {canonicalHash} = require('../task05/user-data-model');
const {
  assertApprovedPlan,
  assertSafeTarget,
  buildPlan,
  parseArguments,
  resolveCurrentConfig,
} = require('./backend-rollout-control');

const liveArguments = [
  '--project', 'fatin-test',
  '--derived-owner', 'legacy',
  '--enabled-kinds', 'set-parameter-locks,level-up-all',
  '--auth', 'firebase-cli',
  '--allow-live-project',
  '--confirm-project', 'fatin-test',
];

test('parses a sorted, exact production control target', () => {
  const options = parseArguments(liveArguments);
  assert.equal(options.projectId, 'fatin-test');
  assert.equal(options.derivedOwnerMode, 'legacy');
  assert.deepEqual(options.enabledOperationKinds, [
    'level-up-all',
    'set-parameter-locks',
  ]);
  assert.deepEqual(assertSafeTarget(options, {}), {live: true});
});

test('refuses other projects, unknown operation kinds, and unconfirmed live access', () => {
  assert.throws(
    () => parseArguments(liveArguments.map((value) => value === 'fatin-test' ? 'wrong-project' : value)),
    /accepts only project fatin-test/
  );
  assert.throws(
    () => parseArguments([...liveArguments, '--enabled-kinds', 'unknown-kind']),
    /unknown operation kind/
  );
  const options = parseArguments(liveArguments.filter((value) => value !== '--allow-live-project'));
  assert.throws(() => assertSafeTarget(options, {}), /Live Firestore access is refused/);
});

test('builds an immutable missing-document plan and validates its approval', () => {
  const plan = buildPlan({
    projectId: 'fatin-test',
    desiredConfig: {
      derivedOwnerMode: 'legacy',
      enabledOperationKinds: ['level-up-all', 'set-parameter-locks'],
    },
    snapshot: {exists: false, data: null, updateTime: null},
  });
  assert.equal(plan.beforeExists, false);
  assert.equal(plan.noChange, false);
  assert.deepEqual(plan.afterConfig, {
    schemaVersion: 1,
    derivedOwnerMode: 'legacy',
    enabledOperationKinds: ['level-up-all', 'set-parameter-locks'],
  });
  assertApprovedPlan({approved: plan, current: plan, fingerprint: plan.planFingerprint});
  assert.throws(
    () => assertApprovedPlan({
      approved: plan,
      current: {...plan, beforeUpdateTime: 'changed'},
      fingerprint: plan.planFingerprint,
    }),
    /no longer matches/
  );
  assert.match(plan.planFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(plan.planFingerprint, canonicalHash(plan.afterConfig));
});

test('normalizes valid config and refuses unmanaged or malformed state', () => {
  assert.deepEqual(resolveCurrentConfig({exists: false, data: null}), {
    schemaVersion: 1,
    derivedOwnerMode: 'legacy',
    enabledOperationKinds: [],
  });
  assert.deepEqual(resolveCurrentConfig({
    exists: true,
    data: {
      schemaVersion: 1,
      derivedOwnerMode: 'legacy',
      enabledOperationKinds: ['set-parameter-locks', 'level-up-all'],
    },
  }), {
    schemaVersion: 1,
    derivedOwnerMode: 'legacy',
    enabledOperationKinds: ['level-up-all', 'set-parameter-locks'],
  });
  assert.throws(() => resolveCurrentConfig({
    exists: true,
    data: {
      schemaVersion: 1,
      derivedOwnerMode: 'legacy',
      enabledOperationKinds: [],
      surprise: true,
    },
  }), /unmanaged fields/);
});
