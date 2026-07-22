const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} = require('firebase/firestore');

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-fnd-perf',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(path.resolve(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
    },
  });
});

after(async () => environment?.cleanup());

test('anonymous, player, DM, and webmaster rules match their intended boundaries', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('perf-player').firestore();
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();

  await assertFails(getDoc(doc(anonymous, 'users/perf-player')));
  await assertSucceeds(getDoc(doc(anonymous, 'items/item-0000')));
  await assertSucceeds(getDoc(doc(player, 'users/perf-player')));
  await assertFails(getDoc(doc(player, 'users/perf-peer-2')));
  await assertFails(getDoc(doc(player, 'foes/foe-0000')));
  await assertSucceeds(getDoc(doc(dm, 'foes/foe-0000')));
  await assertSucceeds(getDoc(doc(webmaster, 'users/perf-player')));
});

test('roles cannot be changed through a direct privileged client update', async () => {
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();
  await assertFails(updateDoc(doc(webmaster, 'users/perf-player'), { role: 'dm' }));
});

test('shared config and Codex repository documents keep the existing role matrix', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const signedIn = [
    environment.authenticatedContext('perf-player').firestore(),
    environment.authenticatedContext('perf-dm').firestore(),
    environment.authenticatedContext('perf-webmaster').firestore(),
  ];
  const documentIds = [
    'varie',
    'schema_pg',
    'schema_weapon',
    'schema_armatura',
    'schema_accessorio',
    'schema_consumabile',
    'schema_spell',
    'schema_tecnica',
    'possible_lists',
    'spells_common',
    'tecniche_common',
    'utils',
    'codex',
  ];

  for (const documentId of documentIds) {
    await assertFails(getDoc(doc(anonymous, 'utils', documentId)));
    for (const firestore of signedIn) {
      await assertSucceeds(getDoc(doc(firestore, 'utils', documentId)));
    }
  }
});

const userDirectoryFirstPageQuery = (firestore) => query(
  collection(firestore, 'user_directory'),
  where('role', '==', 'player'),
  orderBy('normalizedLabel', 'asc'),
  orderBy(documentId(), 'asc'),
  limit(50)
);

test('user directory get/list access is restricted to DM and webmaster roles', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('perf-player').firestore();
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();

  await assertFails(getDoc(doc(anonymous, 'user_directory/perf-player')));
  await assertFails(getDoc(doc(player, 'user_directory/perf-player')));
  await assertSucceeds(getDoc(doc(dm, 'user_directory/perf-player')));
  await assertSucceeds(getDoc(doc(webmaster, 'user_directory/perf-player')));

  await assertFails(getDocs(userDirectoryFirstPageQuery(anonymous)));
  await assertFails(getDocs(userDirectoryFirstPageQuery(player)));
  const dmPage = await assertSucceeds(getDocs(userDirectoryFirstPageQuery(dm)));
  const webmasterPage = await assertSucceeds(getDocs(userDirectoryFirstPageQuery(webmaster)));

  assert.equal(dmPage.docs.length, 50);
  assert.equal(webmasterPage.docs.length, 50);
  for (const snapshot of dmPage.docs) {
    assert.deepEqual(Object.keys(snapshot.data()).sort(), [
      'characterId',
      'label',
      'normalizedLabel',
      'role',
      'schemaVersion',
    ]);
    assert.equal(snapshot.data().schemaVersion, 1);
    assert.equal(snapshot.data().role, 'player');
  }
});

test('all user directory client writes are denied', async () => {
  const contexts = [
    environment.unauthenticatedContext().firestore(),
    environment.authenticatedContext('perf-player').firestore(),
    environment.authenticatedContext('perf-dm').firestore(),
    environment.authenticatedContext('perf-webmaster').firestore(),
  ];
  const candidate = {
    schemaVersion: 1,
    characterId: 'Client write',
    label: 'Client write',
    normalizedLabel: 'client write',
    role: 'player',
  };

  for (const firestore of contexts) {
    await assertFails(setDoc(doc(firestore, 'user_directory/client-write-probe'), candidate));
    await assertFails(updateDoc(doc(firestore, 'user_directory/perf-player'), {label: 'Changed'}));
    await assertFails(deleteDoc(doc(firestore, 'user_directory/perf-player')));
  }
});
