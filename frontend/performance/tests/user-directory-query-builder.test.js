const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const firestoreSdk = require('firebase/firestore');
const {
  buildUserDirectoryQuery,
  USER_DIRECTORY_PAGE_SIZE,
} = require('../../src/data/userDirectoryQueryFactory.cjs');

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

const firstDirectoryPage = (firestore, role = null) => buildUserDirectoryQuery({
  firestore,
  role,
  sdk: firestoreSdk,
}).target;

test('the exact repository query builder executes in the emulator role matrix', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('perf-player').firestore();
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();

  const roles = [null, 'player', 'dm', 'webmaster'];
  for (const role of roles) {
    for (const denied of [anonymous, player]) {
      await assertFails(firestoreSdk.getDocs(firstDirectoryPage(denied, role)));
    }
    const dmPage = await assertSucceeds(firestoreSdk.getDocs(firstDirectoryPage(dm, role)));
    const webmasterPage = await assertSucceeds(
      firestoreSdk.getDocs(firstDirectoryPage(webmaster, role))
    );
    assert.ok(dmPage.docs.length <= USER_DIRECTORY_PAGE_SIZE);
    assert.deepEqual(
      dmPage.docs.map((snapshot) => snapshot.id),
      webmasterPage.docs.map((snapshot) => snapshot.id)
    );
    if (role) {
      assert.ok(dmPage.docs.every((snapshot) => snapshot.data().role === role));
    }
  }
});

test('equal sort values and a deleted cursor document resume without gaps or duplicates', async () => {
  const ids = ['task04-equal-a', 'task04-equal-b', 'task04-equal-c'];
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    for (const id of ids) {
      await firestoreSdk.setDoc(firestoreSdk.doc(firestore, 'user_directory', id), {
        schemaVersion: 1,
        characterId: id,
        label: id,
        normalizedLabel: '000 task04 equal',
        role: 'webmaster',
      });
    }
  });

  try {
    const dm = environment.authenticatedContext('perf-dm').firestore();
    const firstQuery = buildUserDirectoryQuery({
      firestore: dm,
      role: 'webmaster',
      pageSize: 2,
      sdk: firestoreSdk,
    });
    const first = await assertSucceeds(firestoreSdk.getDocs(firstQuery.target));
    assert.deepEqual(first.docs.map(({ id }) => id), ids.slice(0, 2));

    const cursorDocument = first.docs[1];
    const cursor = {
      version: 1,
      queryKey: firstQuery.queryKey,
      sortValues: [cursorDocument.data().normalizedLabel],
      documentId: cursorDocument.id,
    };
    await environment.withSecurityRulesDisabled(async (context) => {
      await firestoreSdk.deleteDoc(
        firestoreSdk.doc(context.firestore(), 'user_directory', cursorDocument.id)
      );
    });

    const resumed = buildUserDirectoryQuery({
      firestore: dm,
      role: 'webmaster',
      cursor,
      pageSize: 2,
      sdk: firestoreSdk,
    });
    const second = await assertSucceeds(firestoreSdk.getDocs(resumed.target));
    assert.equal(second.docs[0].id, ids[2]);
    assert.equal(new Set([...first.docs, ...second.docs].map(({ id }) => id)).size,
      first.docs.length + second.docs.length);
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await Promise.all(ids.map((id) => firestoreSdk.deleteDoc(
        firestoreSdk.doc(firestore, 'user_directory', id)
      )));
    });
  }
});

test('the exact builder resumes with scalar values and rejects cross-role cursors', async () => {
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const first = await assertSucceeds(firestoreSdk.getDocs(firstDirectoryPage(dm, 'player')));
  const last = first.docs[first.docs.length - 1];
  const cursor = {
    version: 1,
    queryKey: 'directory.users.by-role.player.page.v1',
    sortValues: [last.data().normalizedLabel],
    documentId: last.id,
  };
  const resumed = buildUserDirectoryQuery({
    firestore: dm,
    role: 'player',
    cursor,
    sdk: firestoreSdk,
  });
  await assertSucceeds(firestoreSdk.getDocs(resumed.target));

  assert.throws(() => buildUserDirectoryQuery({
    firestore: dm,
    role: 'dm',
    cursor,
    sdk: firestoreSdk,
  }), /queryKey does not match/);
});
