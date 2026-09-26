const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const app = admin.initializeApp({projectId: 'demo-fnd-perf'});
const {updateUserRole} = require('../lib/updateUserRole');
after(() => app.delete());
const snapshot = (data) => ({exists: Boolean(data), get: (field) => data?.[field]});

test('role changes atomically reject actor/target deletion fences and retain audit', async (t) => {
  const db = admin.firestore();
  let stored = {};
  let writes = [];
  t.mock.method(db, 'runTransaction', async (run) => run({
    get: async (ref) => snapshot(stored[ref.path]),
    update: (ref, data) => writes.push({path: ref.path, data}),
    set: (ref, data) => writes.push({path: ref.path, data}),
  }));
  const request = {auth: {uid: 'actor'}, data: {userId: 'target', role: 'DM'}};
  for (const [path, value] of [
    ['users/actor', {role: 'webmaster', deletionState: 'pending'}],
    ['users/target', {role: 'player', deletionState: 'pending'}],
    ['user_deletion_jobs/actor', {stage: 'failed'}],
    ['user_deletion_jobs/target', {stage: 'failed'}],
  ]) {
    stored = {'users/actor': {role: 'webmaster'}, 'users/target': {role: 'player'}, [path]: value};
    writes = [];
    await assert.rejects(updateUserRole.run(request), (err) => ['permission-denied', 'failed-precondition'].includes(err.code));
    assert.equal(writes.length, 0);
  }
  stored = {'users/actor': {role: 'webmaster'}, 'users/target': {role: 'player'}};
  writes = [];
  assert.equal((await updateUserRole.run(request)).role, 'dm');
  assert.equal(writes.length, 2);
  assert.equal(writes[1].data.action, 'updateUserRole');
  await assert.rejects(updateUserRole.run({...request, data: {userId: 'actor', role: 'dm'}}), {code: 'failed-precondition'});
  await assert.rejects(updateUserRole.run({...request, data: {userId: 'bad/id', role: 'dm'}}), {code: 'invalid-argument'});
});
