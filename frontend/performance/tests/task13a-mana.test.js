// Real exported callable handler + Firestore emulator transactions; no Functions runtime required.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const path = require('node:path');
const req = require('node:module').createRequire(path.resolve(__dirname, '../../functions/package.json'));
const { configureOwnedPerformanceEnvironment, projectId } = require('../../scripts/performance/common');
configureOwnedPerformanceEnvironment();
const { initializeApp, deleteApp } = req('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore');
const { operationReceiptId } = require('../../functions/lib/userDataV2');
const uid = `task13a-mana-${process.pid}`;
const operations = ['concurrent-spell', 'concurrent-technique', 'floor-opt-in', 'bad-value', 'bad-auth', 'bad-target'].map(value => `task13a-${value}`);
let app, db, handler;
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  assert.equal(projectId, 'demo-fnd-perf');
  app = initializeApp({ projectId });
  db = getFirestore(app);
  handler = require('../../functions/lib/userDataCommands').task05UpdateResource;
  await db.doc(`users/${uid}`).set({ role: 'player' });
  await db.doc(`users/${uid}/state/resources`).set({ schemaVersion: 2, revision: 1, stats: { manaCurrent: 5, manaTotal: 10, hpCurrent: 12 } });
});
after(async () => {
  if (db) {
    await Promise.all([
      db.doc(`users/${uid}/state/resources`).delete(), db.doc(`users/${uid}`).delete(),
      ...operations.map(id => db.doc(`user_operations/${operationReceiptId(uid, id)}`).delete()),
    ]);
  }
  if (app) await deleteApp(app);
});
const request = (operationId, extra = {}) => ({ auth: { uid, token: {} }, data: { operationId, resource: 'mana', mode: 'delta', value: -4, ...extra } });

test('distinct concurrent casts serialize to negative mana, exact retries replay without another debit', async () => {
  const results = await Promise.all(operations.slice(0, 2).map(id => handler.run(request(id))));
  assert.deepEqual(results.map(result => result.newValue).sort((a,b) => a-b), [-3, 1]);
  const stored = await db.doc(`users/${uid}/state/resources`).get();
  assert.equal(stored.get('stats.manaCurrent'), -3);
  assert.equal(stored.get('stats.hpCurrent'), 12);
  assert.equal(stored.get('revision'), 3);
  const retries = await Promise.all(operations.slice(0, 2).map(id => handler.run(request(id))));
  assert.ok(retries.every(result => result.replayed === true));
  const afterRetry = await db.doc(`users/${uid}/state/resources`).get();
  assert.equal(afterRetry.get('stats.manaCurrent'), -3);
  assert.equal(afterRetry.get('revision'), 3);
});

test('mana floor is explicit opt-in and invalid/unauthorized requests are rejected', async () => {
  const result = await handler.run(request(operations[2], { floorAtZero: true }));
  assert.equal(result.newValue, 0);
  await assert.rejects(handler.run(request(operations[3], { value: 'bad' })), { code: 'invalid-argument' });
  await assert.rejects(handler.run({ ...request(operations[4]), auth: null }), { code: 'unauthenticated' });
  await db.doc(`users/${uid}-other`).set({ role: 'player' });
  try {
    await assert.rejects(handler.run(request(operations[5], { userId: `${uid}-other` })), { code: 'permission-denied' });
  } finally { await db.doc(`users/${uid}-other`).delete(); }
  assert.equal((await db.doc(`users/${uid}/state/resources`).get()).get('stats.manaCurrent'), 0);
});
