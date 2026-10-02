const assert = require('node:assert/strict');
const {test} = require('node:test');

const snapshot = data => ({exists: Boolean(data), data: () => data, get: key => data?.[key]});

const setup = (t, {operation, receiptId = 'receipt', role = 'dm', deletionState, config = {schemaVersion: 1, enabledOperationKinds: ['delete-encounter']}, work = {status: 'pending'}} = {}) => {
  const admin = require('firebase-admin');
  const writes = [];
  const refs = new Map();
  const records = {
    'users/actor': snapshot(role ? {role, deletionState} : null),
    [`backend_operations/${receiptId}`]: snapshot(operation),
    'backend_operation_work/work': snapshot(work),
    'app_config/task06_backend': snapshot(config),
  };
  const db = {
    doc: path => {
      assert.ok(Object.hasOwn(records, path), `Unexpected domain access: ${path}`);
      if (!refs.has(path)) refs.set(path, {path, get: async () => records[path]});
      return refs.get(path);
    },
    runTransaction: async fn => fn({
      getAll: async (...targets) => targets.map(target => records[target.path]),
      update: (ref, data) => writes.push({path: ref.path, data}),
      create: () => { throw new Error('Retired work must never be enqueued'); },
    }),
  };
  Object.defineProperty(admin, 'firestore', {configurable: true, value: () => db});
  t.after(() => { delete admin.firestore; });
  const modulePath = require.resolve('../lib/backendOperations');
  delete require.cache[modulePath];
  return {api: require(modulePath), writes, db, records};
};

test('compatibility tombstone authenticates and checks current DM before rejection without writes', async t => {
  for (const [role, auth, expected, deletionState] of [
    ['dm', undefined, 'unauthenticated'],
    ['player', {uid: 'actor'}, 'permission-denied'],
    ['webmaster', {uid: 'actor'}, 'permission-denied'],
    [null, {uid: 'actor'}, 'permission-denied'],
    ['dm', {uid: 'actor'}, 'permission-denied', 'pending'],
    ['dm', {uid: 'actor'}, 'failed-precondition'],
  ]) {
    await t.test(`${role}/${expected}/${deletionState || 'active'}`, async child => {
      const f = setup(child, {role, deletionState});
      await assert.rejects(f.api.deleteEncounterV2.run({auth, data: {}}), error => error.code === expected);
      assert.deepEqual(f.writes, []);
    });
  }
});

test('resume rejects retired receipts before replay or rescheduling despite stale status and config', async t => {
  const {backendOperationReceiptId} = require('../lib/backendOperationCore');
  const operationId = 'retired-resume-0001';
  for (const status of ['paused', 'failed', 'running', 'completed', 'pending', 'cleanup-pending']) {
    await t.test(status, async child => {
      const f = setup(child, {receiptId: backendOperationReceiptId('actor', operationId),
        operation: {kind: 'delete-encounter', actorUid: 'actor', operationId, status, generation: 9}});
      await assert.rejects(f.api.resumeBackendOperation.run({auth: {uid: 'actor'}, data: {operationId}}), error => error.code === 'failed-precondition' && /retired/.test(error.message));
      assert.deepEqual(f.writes, []);
    });
  }
});

test('queued retired work fails terminally before phase, lease, generation or enablement checks', async t => {
  for (const phase of ['prepare', 'descendants', 'verify', 'unknown']) {
    for (const enabled of [true, false]) {
      await t.test(`${phase}/${enabled ? 'stale-enabled' : 'disabled'}`, async child => {
        const f = setup(child, {
          operation: {kind: 'delete-encounter', phase, generation: 19, status: 'completed', leaseOwner: 'old', pendingCollections: ['encounters/history/logs']},
          config: {schemaVersion: 1, enabledOperationKinds: enabled ? ['delete-encounter'] : []},
        });
        const ref = f.db.doc('backend_operation_work/work');
        await f.api.runBackendOperationWorker.run({id: 'event', data: {...snapshot({receiptId: 'receipt', generation: 0}), ref}});
        assert.equal(f.writes.length, 2);
        for (const write of f.writes) {
          assert.equal(write.data.status, 'failed');
          assert.equal(write.data.retryable, false);
          assert.equal(write.data.retirementReason, 'combat-tool-retired');
        }
      });
    }
  }
});
