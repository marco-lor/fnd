const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertApprovedPlan,
  assertSafeTarget,
  buildPlan,
  parseArguments,
  resolveCurrentConfig,
} = require('./user-data-rollout-stage');

const snapshot = (data = null, updateTime = null) => ({
  exists: data !== null,
  data,
  updateTime,
});

test('CLI is dry-run by default and hard-locks the production project', () => {
  const parsed = parseArguments([
    '--project', 'fatins',
    '--stage', 'shadow-verify',
    '--allow-live-project',
    '--confirm-project', 'fatins',
  ]);
  assert.equal(parsed.execute, false);
  assert.equal(parsed.authMode, 'admin');
  assert.throws(() => parseArguments([
    '--project', 'fatin-test', '--stage', 'shadow-verify',
  ]), /accepts only project fatins/);
  assert.throws(() => parseArguments([
    '--project', 'fatins', '--stage', 'new-only',
  ]), /--stage must be/);
});

test('live access requires exact double confirmation', () => {
  const options = parseArguments([
    '--project', 'fatins', '--stage', 'shadow-verify',
  ]);
  assert.throws(() => assertSafeTarget(options, {}), /Live Firestore access is refused/);
  assert.deepEqual(assertSafeTarget({
    ...options,
    allowLiveProject: true,
    confirmProject: 'fatins',
  }, {}), {live: true});
});

test('only the staged V2 transition sequence and rollback edges are accepted', () => {
  const first = buildPlan({
    projectId: 'fatins',
    stage: 'shadow-verify',
    snapshot: snapshot(),
  });
  assert.equal(first.beforeMode, 'legacy-read');
  assert.equal(first.afterMode, 'shadow-verify');
  assert.throws(() => buildPlan({
    projectId: 'fatins',
    stage: 'new-read-dual-write',
    snapshot: snapshot({mode: 'legacy-read', legacyDrain: {}, userOverrides: {}}),
  }), /Direct rollout transition/);
  assert.equal(buildPlan({
    projectId: 'fatins',
    stage: 'new-read-dual-write',
    snapshot: snapshot({mode: 'dual-write', legacyDrain: {}, userOverrides: {}}),
  }).afterMode, 'new-read-dual-write');
  assert.equal(buildPlan({
    projectId: 'fatins',
    stage: 'dual-write',
    snapshot: snapshot({mode: 'new-read-dual-write', legacyDrain: {}, userOverrides: {}}),
  }).afterMode, 'dual-write');
  assert.throws(() => buildPlan({
    projectId: 'fatins',
    stage: 'legacy-read',
    snapshot: snapshot({mode: 'new-read-dual-write', legacyDrain: {}, userOverrides: {}}),
  }), /Direct rollout transition/);
});

test('global changes refuse overrides, drains, completion locks, and new-only', () => {
  for (const data of [
    {mode: 'dual-write', userOverrides: 'invalid', legacyDrain: {}},
    {mode: 'dual-write', userOverrides: {private: 'dual-write'}, legacyDrain: {}},
    {mode: 'dual-write', userOverrides: {}, legacyDrain: {global: {}}},
    {mode: 'dual-write', userOverrides: {}, legacyDrain: {}, userDataCompletionLock: {}},
    {mode: 'new-only', userOverrides: {}, legacyDrain: {}},
  ]) {
    assert.throws(() => resolveCurrentConfig({exists: true, data}));
  }
});

test('approval binds the exact unchanged plan and fingerprint', () => {
  const plan = buildPlan({
    projectId: 'fatins',
    stage: 'dual-write',
    snapshot: snapshot(
      {mode: 'shadow-verify', legacyDrain: {}, userOverrides: {}},
      '2026-08-01T00:00:00.000Z'
    ),
  });
  assert.doesNotThrow(() => assertApprovedPlan({
    approved: plan,
    current: plan,
    fingerprint: plan.planFingerprint,
  }));
  assert.throws(() => assertApprovedPlan({
    approved: plan,
    current: {...plan, beforeUpdateTime: 'changed'},
    fingerprint: plan.planFingerprint,
  }), /no longer matches/);
});
