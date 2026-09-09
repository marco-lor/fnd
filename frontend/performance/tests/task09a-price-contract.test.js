const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
const { deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  configureOwnedPerformanceEnvironment,
  OWNED_PERFORMANCE_ENVIRONMENT,
  projectId,
} = require('../../scripts/performance/common');
const { withBackgroundTriggersDisabled } = require('../../scripts/performance/emulator-control');

configureOwnedPerformanceEnvironment();

const FUNCTIONS_REGION = 'europe-west8';
const FUNCTIONS_BASE_URL = 'http://127.0.0.1:5001';
const PASSWORD = 'PerfTest!123';
const ACTOR_UID = 'perf-player';
const ITEM_PATH = 'items/task09a-stale-price';
const RESOURCES_PATH = `users/${ACTOR_UID}/state/resources`;
const INVENTORY_COLLECTION = `users/${ACTOR_UID}/inventory`;
const RUN_ID = randomUUID();
const operationIds = ['stale', 'concurrent-a', 'concurrent-b', 'poor', 'denied'].map(kind => `task09a-${kind}-${RUN_ID}`);
const receiptId = operationId => createHash('sha256').update(JSON.stringify([ACTOR_UID, operationId])).digest('hex').slice(0, 48);

let app;
let db;

const fetchJson = async (url, init) => {
  const response = await fetch(url, init);
  const bodyText = await response.text();
  let body = {};
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${bodyText.slice(0, 300)}`, { cause: error });
  }
  return { response, body };
};

const signIn = async () => {
  const { response, body } = await fetchJson(
    `http://${OWNED_PERFORMANCE_ENVIRONMENT.FIREBASE_AUTH_EMULATOR_HOST}`
      + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=task09a-emulator',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${ACTOR_UID}@example.test`,
        password: PASSWORD,
        returnSecureToken: true,
      }),
    }
  );
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.idToken;
};

const callPurchase = async (token, operationId, expectedError = null) => {
  const { response, body } = await fetchJson(
    `${FUNCTIONS_BASE_URL}/${projectId}/${FUNCTIONS_REGION}/task05PurchaseItem`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        data: {
          itemId: ITEM_PATH.split('/')[1],
          operationId,
        },
      }),
    }
  );
  if (expectedError) {
    assert.equal(body.error?.status, expectedError, JSON.stringify(body));
    return body.error;
  }
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.data ?? body.result;
};

const captureCollection = async (collectionPath) => {
  const snapshot = await db.collection(collectionPath).get();
  return snapshot.docs.map((document) => ({ path: document.ref.path, data: document.data(), updateTime: document.updateTime.toMillis() }));
};

before(async () => {
  app = initializeApp({ projectId }, 'task09a-price-contract-tests');
  db = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
});

test('authoritative price, replay, concurrent buys and failed buys preserve 500 existing inventory snapshots', async () => {
  const original = {
    item: await db.doc(ITEM_PATH).get(),
    resources: await db.doc(RESOURCES_PATH).get(),
    inventory: await captureCollection(INVENTORY_COLLECTION),
  };
  assert.equal(original.inventory.length, 500, 'requires canonical 500-entry player fixture');
  const addedPaths = operationIds.map(id => `${INVENTORY_COLLECTION}/purchase_${receiptId(id)}`);
  const receiptPaths = operationIds.map(id => `user_operations/${receiptId(id)}`);
  for (const path of [...addedPaths, ...receiptPaths]) assert.equal((await db.doc(path).get()).exists, false);
  await withBackgroundTriggersDisabled(async () => {
    try {
      await db.doc(ITEM_PATH).set({
        item_type: 'accessorio', visibility: 'all', allowed_users: [],
        General: { Nome: 'Task09A stale price', prezzo: 4 }, Specific: {}, Parametri: {},
      });
      await db.doc(RESOURCES_PATH).set({ schemaVersion: 2, revision: 1, stats: { gold: 100 } });
      // The card displayed 4. The server has moved to 9 before confirmation.
      await db.doc(ITEM_PATH).update({ 'General.prezzo': 9 });
      const token = await signIn();
      const result = await callPurchase(token, operationIds[0]);
      assert.equal(result.replayed, false);
      assert.equal(result.price, 9);
      assert.equal(result.previousGold, 100);
      assert.equal(result.newGold, 91);
      assert.equal((await db.collection(INVENTORY_COLLECTION).get()).size, 501);
      assert.equal((await db.doc(addedPaths[0]).get()).get('pricePaid'), 9);
      // Replay returns the original result even after another catalog price change.
      await db.doc(ITEM_PATH).update({ 'General.prezzo': 12 });
      const duplicate = await callPurchase(token, operationIds[0]);
      assert.deepEqual(duplicate, { ...result, replayed: true });
      assert.equal((await db.collection(INVENTORY_COLLECTION).get()).size, 501);
      const concurrent = await Promise.all(operationIds.slice(1, 3).map(id => callPurchase(token, id)));
      assert.equal(new Set(concurrent.map(result => result.inventoryId)).size, 2);
      assert.ok(concurrent.every(result => result.price === 12 && !result.replayed));
      assert.equal((await db.doc(RESOURCES_PATH).get()).get('stats.gold'), 67);
      assert.equal((await db.collection(INVENTORY_COLLECTION).get()).size, 503);
      await db.doc(ITEM_PATH).update({ 'General.prezzo': 1000 });
      await callPurchase(token, operationIds[3], 'RESOURCE_EXHAUSTED');
      await db.doc(ITEM_PATH).update({ visibility: 'custom', allowed_users: ['another-player'] });
      await callPurchase(token, operationIds[4], 'PERMISSION_DENIED');
      assert.equal((await db.doc(RESOURCES_PATH).get()).get('stats.gold'), 67);
      for (const path of [...addedPaths.slice(3), ...receiptPaths.slice(3)]) assert.equal((await db.doc(path).get()).exists, false);
      // Acquired snapshots survive subsequent catalog deletion.
      const acquiredBeforeDeletion = await Promise.all(addedPaths.slice(0, 3).map(async path => (await db.doc(path).get()).data()));
      await db.doc(ITEM_PATH).delete();
      assert.deepEqual(await Promise.all(addedPaths.slice(0, 3).map(async path => (await db.doc(path).get()).data())), acquiredBeforeDeletion);
      assert.equal((await db.doc(addedPaths[0]).get()).get('pricePaid'), 9);
      const current = await captureCollection(INVENTORY_COLLECTION);
      assert.deepEqual(current.filter(doc => !addedPaths.includes(doc.path)), original.inventory);
      assert.equal(current.length, original.inventory.length + 3);
    } finally {
      for (const path of [...addedPaths, ...receiptPaths]) await db.doc(path).delete();
      if (original.item.exists) await original.item.ref.set(original.item.data());
      else await original.item.ref.delete();
      if (original.resources.exists) await original.resources.ref.set(original.resources.data());
      else await original.resources.ref.delete();
    }
  });
  assert.deepEqual(await captureCollection(INVENTORY_COLLECTION), original.inventory);
});
