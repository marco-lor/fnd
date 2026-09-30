const {test} = require('node:test');
const assert = require('node:assert/strict');
const {options, validate, fingerprint, inspect} = require('./foe-order-migration');
const base = ['--environment', 'performance', '--project', 'demo-fnd-perf', '--report', 'task13-test-plan.json'];
test('operator requires explicit target/plan/checkpoint and validates operation', () => {
  assert.equal(options(base).operation, 'backfill');
  assert.throws(() => options(['--project', 'demo-fnd-perf']), /environment/);
  assert.throws(() => options([...base, '--write']), /checkpoint/);
  assert.throws(() => options([...base, '--operation', 'delete']), /operation/);
  assert.throws(() => options([...base, '--verify', '--write']), /mutually exclusive/);
});
test('exact project-bound versioned fingerprint and fresh plan are mandatory', () => {
  const plan = {kind: 'task13-foe-order-v1', projectId: 'demo-fnd-perf', operation: 'backfill',
    createdAt: new Date().toISOString(), control: null, subjects: [], changes: 0};
  plan.fingerprint = fingerprint(plan);
  assert.doesNotThrow(() => validate(plan, {projectId: plan.projectId}, plan.fingerprint));
  assert.throws(() => validate(plan, {projectId: 'fatin-test'}, plan.fingerprint), /approval/);
  assert.throws(() => validate({...plan, changes: 1}, {projectId: plan.projectId}, plan.fingerprint), /approval/);
  const old = {...plan, createdAt: '2020-01-01T00:00:00.000Z'}; old.fingerprint = fingerprint(old);
  assert.throws(() => validate(old, {projectId: old.projectId}, old.fingerprint), /expired/);
});
test('inspection refuses unknown future control versions rather than overwriting them', async () => {
  const query = {orderBy() {return this;}, limit() {return this;}, get: async () => ({docs: [], size: 0})};
  const db = {projectId: 'demo-fnd-perf', collection: () => query,
    doc: () => ({get: async () => ({data: () => ({version: 2, mode: 'paged'})})})};
  await assert.rejects(inspect(db), /Unsupported.*version/);
});
