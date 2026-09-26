const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Timestamp} = require('firebase-admin/firestore');
const {claimUserDeletion} = require('../lib/userDeletionOperation');
const {backendOperationReceiptId} = require('../lib/backendOperationCore');
const actor = 'webmaster';
const target = 'target';
const id = 'delete-user-operation-0001';
const receiptPath = (uid = actor, operationId = id) => `backend_operations/${backendOperationReceiptId(uid, operationId)}`;
const fakeDb = () => {
  const documents = new Map([['users/webmaster', {role: 'webmaster'}], ['users/other-admin', {role: 'webmaster'}], ['users/target', {role: 'player'}]]);
  const snap = (path) => ({exists: documents.has(path), id: path.split('/').pop(), data: () => documents.get(path), get: (key) => documents.get(path)?.[key]});
  const db = {doc: (path) => ({path, id: path.split('/').pop(), get: async () => snap(path)}),
    runTransaction: async (run) => {
      const writes = [];
      const result = await run({get: async (ref) => snap(ref.path),
        set: (ref, value, options) => writes.push(() => documents.set(ref.path, {...(options?.merge ? documents.get(ref.path) : {}), ...value})),
        update: (ref, value) => writes.push(() => documents.set(ref.path, {...documents.get(ref.path), ...value})),
      });
      writes.forEach((write) => write());
      return result;
    }};
  return {db, documents};
};

test('deletion target lease serializes same ID, different IDs, actors and legacy calls', async () => {
  const {db, documents} = fakeDb();
  const first = await claimUserDeletion(db, actor, target, id);
  assert.equal(first.run, true);
  assert.equal(documents.get('users/target').deletionState, 'pending');
  assert.equal((await claimUserDeletion(db, actor, target, id)).run, false);
  for (const [uid, op] of [[actor, 'delete-user-another-0001'], ['other-admin', id], [actor, undefined]]) {
    await assert.rejects(claimUserDeletion(db, uid, target, op), {code: 'aborted'});
  }
  assert.equal(documents.get(receiptPath()).status, 'running');
  await first.progress('media-verified', 2);
  assert.equal(documents.get(receiptPath()).progress.processed, 2);
  await first.progress('failed', 2);
  assert.equal((await first.view()).retryable, true);
  const retry = await claimUserDeletion(db, actor, target, id);
  assert.equal(retry.run, true);
  await assert.rejects(first.progress('completed', 5), {code: 'aborted'});
  await retry.progress('completed', 5);
  assert.equal((await retry.view()).status, 'completed');
  const replay = await claimUserDeletion(db, actor, target, id);
  assert.equal(replay.run, false);
  assert.equal(replay.operation.replayed, true);
  assert.equal((await claimUserDeletion(db, actor, target, undefined)).run, false);
  assert.equal((await claimUserDeletion(db, 'other-admin', target, 'other-admin-delete-0001')).operation.status, 'completed');
});

test('legacy deletion claims the same target fence; stale runners cannot publish', async () => {
  const {db, documents} = fakeDb();
  const legacy = await claimUserDeletion(db, actor, target, undefined);
  assert.equal(legacy.operation, null);
  await assert.rejects(claimUserDeletion(db, actor, target, id), {code: 'aborted'});
  documents.get('user_deletion_jobs/target').leaseExpiresAt = Timestamp.fromMillis(0);
  await assert.rejects(legacy.assertLease(), {code: 'aborted'});
  const replacement = await claimUserDeletion(db, actor, target, id);
  await assert.rejects(legacy.progress('completed', 5), {code: 'aborted'});
  await replacement.progress('completed', 5);
});

test('deletion refuses self, invalid IDs, request rebinding and inactive actor', async () => {
  const {db, documents} = fakeDb();
  await assert.rejects(claimUserDeletion(db, actor, actor, id), {code: 'failed-precondition'});
  await assert.rejects(claimUserDeletion(db, actor, target, 'bad'), {code: 'invalid-argument'});
  const runner = await claimUserDeletion(db, actor, target, id);
  await assert.rejects(claimUserDeletion(db, actor, 'other-target', id), {code: 'already-exists'});
  await runner.progress('failed', 0);
  documents.set('users/webmaster', {role: 'dm'});
  await assert.rejects(claimUserDeletion(db, actor, target, id), {code: 'permission-denied'});
  documents.set('users/webmaster', {role: 'webmaster', deletionState: 'pending'});
  await assert.rejects(claimUserDeletion(db, actor, target, id), {code: 'permission-denied'});
  documents.set('users/webmaster', {role: 'webmaster'});
  documents.set('user_deletion_jobs/webmaster', {stage: 'failed'});
  await assert.rejects(claimUserDeletion(db, actor, target, id), {code: 'permission-denied'});
});

test('paused old RPC may settle but cannot launch a successor phase or publish', async () => {
  const {db, documents} = fakeDb();
  const old = await claimUserDeletion(db, actor, target, id);
  let settle;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const pending = old.step(async () => { started(); return new Promise((resolve) => { settle = resolve; }); });
  await startedPromise;
  documents.get('user_deletion_jobs/target').leaseExpiresAt = Timestamp.fromMillis(0);
  const replacement = await claimUserDeletion(db, actor, target, id);
  settle('old result');
  await assert.rejects(pending, {code: 'aborted'});
  let launched = false;
  await assert.rejects(old.step(async () => { launched = true; }), {code: 'aborted'});
  assert.equal(launched, false);
  await assert.rejects(old.progress('completed', 5), {code: 'aborted'});
  await replacement.progress('completed', 5);
});

test('cooperative deadline fences a valid lease and sibling work drains on error', async (t) => {
  const {db} = fakeDb();
  const start = Date.now();
  const runner = await claimUserDeletion(db, actor, target, id);
  t.mock.method(Date, 'now', () => start + 51000);
  await assert.rejects(runner.step(async () => assert.fail('must not launch')), {code: 'aborted'});
  const {drainDeletionWork} = require('../lib/userDeletionOperation');
  let settle;
  let finished = false;
  const slow = new Promise((resolve) => { settle = resolve; });
  const result = drainDeletionWork([Promise.reject(new Error('first failed')), slow]).catch((err) => { finished = true; throw err; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  settle('drained');
  await assert.rejects(result, /first failed/);
});

test('awaited cleanup retries an actual media failure, preserves archives until verified, and supports legacy callers', async (t) => {
  const admin = require('firebase-admin');
  const {db, documents} = fakeDb();
  const baseDoc = db.doc;
  db.doc = (path) => ({...baseDoc(path),
    delete: async () => documents.delete(path),
    collection: (name) => ({get: async () => ({docs: [...documents.keys()].filter((key) => key.startsWith(`${path}/${name}/`)).map((key) => ({id: key.split('/').pop(), data: () => documents.get(key), get: (field) => documents.get(key)?.[field]}))})}),
    listCollections: async () => [...documents.keys()].some((key) => key.startsWith(`${path}/`)) ? ['descendants'] : [],
  });
  db.getAll = (...refs) => Promise.all(refs.map((ref) => ref.get()));
  db.recursiveDelete = async (ref) => { [...documents.keys()].filter((key) => key === ref.path || key.startsWith(`${ref.path}/`)).forEach((key) => documents.delete(key)); };
  const files = new Set();
  let failMedia = true;
  let authDeletes = 0;
  const bucket = {
    deleteFiles: async ({prefix}) => { if (failMedia) { failMedia = false; throw new Error('injected-media-error'); } [...files].filter((path) => path.startsWith(prefix)).forEach((path) => files.delete(path)); },
    getFiles: async ({prefix}) => [[...files].filter((path) => path.startsWith(prefix))],
    file: (path) => ({delete: async () => files.delete(path), exists: async () => [files.has(path)]}),
  };
  t.mock.getter(Object.getPrototypeOf(admin), 'firestore', () => () => db);
  t.mock.getter(Object.getPrototypeOf(admin), 'auth', () => () => ({updateUser: async () => {}, revokeRefreshTokens: async () => {}, deleteUser: async () => {authDeletes += 1;}}));
  t.mock.getter(Object.getPrototypeOf(admin), 'storage', () => () => ({bucket: () => bucket}));
  t.mock.method(console, 'error', () => {});
  const {deleteUserHandler} = require('../lib/deleteUser');
  for (const uid of ['target', 'legacy-target']) {
    documents.set(`users/${uid}`, {role: 'player'});
    documents.set(`users/${uid}/inventory/item`, {displayName: 'Owned'});
    documents.set(`user_directory/${uid}`, {label: 'Owned'});
    documents.set(`manager_user_summaries/${uid}`, {schemaVersion: 1});
    documents.set(`migration_state/user-data-v2/archives/${uid}/domains/shell`, {domain: 'shell', payload: {characterId: 'Archived'}});
    documents.set(`migration_state/user-data-v2/root_compaction_archives/${uid}/root_fields/email`, {field: 'email', value: 'private@example.test'});
    files.add(`users/${uid}/profile/file`);
  }
  const request = {auth: {uid: actor}, data: {userId: target, operationId: id}};
  await assert.rejects(deleteUserHandler(request), {code: 'internal'});
  assert.equal(documents.get(receiptPath()).status, 'failed');
  assert.equal(documents.get(receiptPath()).progress.processed, 1);
  assert.equal(authDeletes, 0);
  assert.equal(documents.has('migration_state/user-data-v2/archives/target/domains/shell'), true);
  assert.equal((await deleteUserHandler(request)).operation.status, 'completed');
  assert.equal(authDeletes, 1);
  assert.equal((await deleteUserHandler(request)).operation.replayed, true);
  assert.equal(authDeletes, 1);
  const legacy = await deleteUserHandler({auth: {uid: actor}, data: {userId: 'legacy-target'}});
  assert.deepEqual(legacy, {success: true, message: 'User successfully deleted.'});
  assert.equal(authDeletes, 2);
  assert.equal(files.size, 0);
  for (const uid of ['target', 'legacy-target']) {
    assert.equal(documents.has(`users/${uid}`), false);
    assert.equal(documents.has(`user_directory/${uid}`), false);
    assert.equal(documents.has(`manager_user_summaries/${uid}`), false);
    assert.equal([...documents.keys()].some((path) => path.includes(`archives/${uid}/`)), false);
    assert.equal(documents.get(`user_deletion_jobs/${uid}`).stage, 'completed');
  }
});
