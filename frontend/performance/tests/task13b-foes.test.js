const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');
const F = require('firebase/firestore');
const req = require('node:module').createRequire(path.resolve(__dirname, '../../functions/package.json'));
const {initializeApp, deleteApp} = req('firebase-admin/app');
const {getFirestore, Timestamp} = req('firebase-admin/firestore');
const {configureOwnedPerformanceEnvironment} = require('../../scripts/performance/common');
configureOwnedPerformanceEnvironment();
const migration = require('../../scripts/task13/foe-order-migration');
const {reconcileFoeOrder, foeOrderSeconds} = require('../../functions/lib/foeOrder');
const {duplicateFoeWithAssets, duplicateFoeWithAssetsV2} = require('../../functions/lib/duplicateFoeWithAssets');
const projectId = 'demo-fnd-perf';
let env, app, db;
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  env = await initializeTestEnvironment({projectId, firestore: {host: '127.0.0.1', port: 8080,
    rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8')}});
  app = initializeApp({projectId, storageBucket: 'demo-fnd-perf.appspot.com'}); db = getFirestore(app);
});
after(async () => {await env?.cleanup(); if (app) await deleteApp(app);});
const client = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const compare = (a, b) => foeOrderSeconds(b.data()) - foeOrderSeconds(a.data()) || (a.id < b.id ? -1 : 1);
const execute = async operation => {const plan = await migration.inspect(db, operation); return migration.apply(db, plan, plan.fingerprint);};
async function reset(count = 500) {
  await env.clearFirestore();
  await Promise.all(['dm', 'player', 'webmaster'].map(role => db.doc('users/' + role).set({role})));
  const batch = db.batch();
  for (let i = 0; i < count; i++) batch.set(db.doc('foes/f' + String(i).padStart(3, '0')), {
    name: 'Foe ' + i, Parametri: {}, stats: {}, spells: [], tecniche: [],
    ...(i % 3 ? {updated_at: new Timestamp(i % 17, i * 1000)} : {}),
    ...(i % 5 ? {created_at: new Timestamp(i % 7, 0)} : {}),
  });
  await batch.commit();
}
const pageQuery = (database, anchor) => F.query(F.collection(database, 'foes'), F.orderBy('task13OrderSeconds', 'desc'),
  F.orderBy(F.documentId(), 'asc'), ...(anchor ? [F.startAfter(anchor.get('task13OrderSeconds'), anchor.id)] : []), F.limit(26));

test('versioned backfill resumes/replays, preserves timestamps, rejects stale data and reverses only control', async () => {
  await reset();
  const plan = await migration.inspect(db);
  assert.equal(plan.changes, 500);
  let checkpoint;
  const first = await migration.apply(db, plan, plan.fingerprint, {maxBatches: 1, checkpoint: async value => {checkpoint = value;}});
  assert.equal(first.offset, 100); assert.equal(first.complete, false);
  const replay = await migration.apply(db, plan, plan.fingerprint, {maxBatches: 1}); assert.equal(replay.writes, 0);
  await migration.apply(db, plan, plan.fingerprint, {offset: checkpoint.offset});
  assert.equal((await migration.inspect(db)).changes, 0);
  const source = await db.collection('foes').get();
  for (const row of source.docs) assert.equal(row.get('task13OrderSeconds'), foeOrderSeconds(row.data()));
  const activation = await migration.inspect(db, 'activate');
  await db.doc('foes/late').set({name: 'Late legacy writer'});
  await assert.rejects(migration.apply(db, activation, activation.fingerprint), /incomplete/);
  assert.equal((await db.doc(migration.CONTROL).get()).exists, false);
  await execute('backfill'); await execute('activate');
  await db.doc('foes/f000').update({notes: 'Later edit survives rollback'});
  await execute('rollback');
  assert.equal((await db.doc(migration.CONTROL).get()).get('mode'), 'legacy');
  assert.equal((await db.doc('foes/f000').get()).get('notes'), 'Later edit survives rollback');
  assert.deepEqual((await db.doc('foes/f001').get()).get('updated_at'), new Timestamp(1, 1000));
  const stale = await migration.inspect(db);
  await db.doc('foes/f001').update({updated_at: new Timestamp(99, 0)});
  await assert.rejects(migration.apply(db, stale, stale.fingerprint), /Stale source/);
  assert.equal(await reconcileFoeOrder(db, 'f001'), true);
  assert.equal(await reconcileFoeOrder(db, 'f001'), false);
  assert.equal((await db.doc('foes/f001').get()).get('task13OrderSeconds'), 99);
});

test('DM-only indexed pages traverse all 500 records with timestamp ties/missing fields', async () => {
  await reset(); await execute('backfill'); await execute('activate');
  const database = client('dm'), ids = []; let anchor;
  do {
    const page = await F.getDocs(pageQuery(database, anchor)); assert.ok(page.size <= 26);
    const rows = page.docs.slice(0, 25); ids.push(...rows.map(row => row.id));
    anchor = page.size > 25 ? rows.at(-1) : null;
  } while (anchor);
  assert.equal(ids.length, 500); assert.equal(new Set(ids).size, 500);
  assert.deepEqual(ids, (await db.collection('foes').get()).docs.sort(compare).map(row => row.id));
  for (const uid of [null, 'player', 'webmaster']) await assertFails(F.getDocs(pageQuery(client(uid))));
  await assertFails(F.setDoc(F.doc(database, 'foes', 'old-client'), {name: 'Missing order'}));
  await assertSucceeds(F.setDoc(F.doc(database, 'foes', 'current-client'), {name: 'Current', task13OrderSeconds: 0}));
  await assertFails(F.updateDoc(F.doc(database, 'foes', 'current-client'), {task13OrderSeconds: F.deleteField()}));
  await assertFails(F.setDoc(F.doc(client('webmaster'), 'utils', 'foes_paging'), {version: 1, mode: 'legacy'}));
});

test('live active page stays bounded when edits cross a cursor boundary and listener detaches', async () => {
  await reset(); await execute('backfill'); await execute('activate');
  const database = client('dm');
  const initial = await F.getDocs(pageQuery(database)); const boundary = initial.docs[24];
  let deliveries = 0; let latest;
  const stop = F.onSnapshot(pageQuery(database, boundary), value => {deliveries++; latest = value;});
  const wait = async predicate => {for (let i = 0; i < 100; i++) {if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20));} throw Error('Snapshot timeout');};
  await wait(() => latest);
  const moved = latest.docs[0].id;
  await db.doc('foes/' + moved).update({updated_at: new Timestamp(100, 0)}); await reconcileFoeOrder(db, moved);
  await wait(() => !latest.docs.some(row => row.id === moved)); assert.ok(latest.size <= 26);
  assert.equal((await F.getDocs(pageQuery(database))).docs[0].id, moved);
  // Anchor is a scalar tuple, so deleting/moving its document cannot invalidate it.
  await db.doc('foes/' + boundary.id).delete();
  assert.ok((await F.getDocs(pageQuery(database, boundary))).size <= 26);
  stop(); const count = deliveries;
  await db.doc('foes/f000').update({notes: 'after detach'});
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(deliveries, count);
});

test('a concurrent old-client create and activation cannot commit a silently omitted record', async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await reset(5); await execute('backfill');
    const plan = await migration.inspect(db, 'activate');
    await Promise.allSettled([
      migration.apply(db, plan, plan.fingerprint),
      F.setDoc(F.doc(client('dm'), 'foes', 'concurrent'), {name: 'Old client'}),
    ]);
    const [control, rows] = await Promise.all([db.doc(migration.CONTROL).get(), db.collection('foes').get()]);
    if (control.get('mode') === 'paged') assert.ok(rows.docs.every(row => typeof row.get('task13OrderSeconds') === 'number'));
    else assert.equal(rows.docs.find(row => row.id === 'concurrent').get('name'), 'Old client');
  }
});

test('legacy no-media alias retries one durable intent without V2 enablement; V2 independently retries one result', async () => {
  await reset(1);
  const request = {auth: {uid: 'dm'}, data: {sourceFoeId: 'f000', newFoeName: 'Copied', operationId: 'task13-legacy-operation-0001'}};
  const first = await duplicateFoeWithAssets.run(request);
  const second = await duplicateFoeWithAssets.run(request);
  assert.equal(first.newFoeId, second.newFoeId);
  assert.equal((await db.collection('foes').get()).size, 2);
  await assert.rejects(duplicateFoeWithAssets.run({...request, data: {...request.data, newFoeName: 'Different'}}), /intent changed/);
  await db.doc('foes/f000').update({imageUrl: 'https://example.test/root.png'});
  const routedReplay = await duplicateFoeWithAssetsV2.run(request);
  assert.equal(routedReplay.newFoeId, first.newFoeId);
  await assert.rejects(duplicateFoeWithAssets.run({...request, data: {...request.data, operationId: 'task13-legacy-operation-0002'}}), /Media-bearing/);
  await db.doc('foes/f000').update({imageUrl: ''});
  await db.doc('app_config/task06_backend').set({schemaVersion: 1, derivedOwnerMode: 'authoritative', enabledOperationKinds: ['duplicate-foe']});
  const v2 = {...request, data: {...request.data, operationId: 'task13-v2-operation-0001'}};
  const a = await duplicateFoeWithAssetsV2.run(v2), b = await duplicateFoeWithAssetsV2.run(v2);
  assert.equal(a.newFoeId, b.newFoeId); assert.equal((await duplicateFoeWithAssets.run(v2)).newFoeId, a.newFoeId); assert.equal((await db.collection('foes').get()).size, 3);
  assert.equal(typeof (await db.doc('foes/' + a.newFoeId).get()).get('task13OrderSeconds'), 'number');
});
