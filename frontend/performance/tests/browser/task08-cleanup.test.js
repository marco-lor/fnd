const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTask08AccountCleanup,
  TASK08_CREATED_ACCOUNT_CLEANUP_ROOTS,
} = require('./task08-cleanup');

test('created-account cleanup retains the UID and defers Auth deletion across a partial failure', async () => {
  const calls = [];
  let firestoreAttempt = 0;
  let authDeleted = false;
  const cleanup = createTask08AccountCleanup({
    email: 'task08-created@example.test',
    auth: {
      getUserByEmail: async () => ({ uid: 'created-uid' }),
      deleteUser: async (uid) => {
        calls.push(`auth-delete:${uid}`);
        authDeleted = true;
      },
      getUser: async () => (authDeleted
        ? (() => { const error = new Error('not found'); error.code = 'auth/user-not-found'; throw error; })()
        : ({ uid: 'created-uid' })),
    },
    deleteOwnedFirestoreData: async (uid) => {
      calls.push(`firestore-delete:${uid}`);
      firestoreAttempt += 1;
      if (firestoreAttempt === 1) throw new Error('transient Firestore failure');
    },
    verifyOwnedFirestoreDataAbsent: async (uid) => calls.push(`firestore-verify:${uid}`),
  });
  cleanup.rememberCreatedAccount('task08-created@example.test', 'created-uid');

  await assert.rejects(
    cleanup.removeCreatedAccount(),
    /transient Firestore failure/
  );
  assert.deepEqual(calls, ['firestore-delete:created-uid']);
  assert.equal(authDeleted, false);

  await cleanup.removeCreatedAccount();
  assert.deepEqual(calls, [
    'firestore-delete:created-uid',
    'firestore-delete:created-uid',
    'firestore-verify:created-uid',
    'auth-delete:created-uid',
  ]);
  assert.equal(cleanup.getRememberedUid('task08-created@example.test'), null);
});

test('cleanup roots document the account initialize ownership boundary', () => {
  assert.deepEqual(TASK08_CREATED_ACCOUNT_CLEANUP_ROOTS('created-uid'), [
    'users/created-uid',
    'user_directory/created-uid',
    'user_operations[actorUid=created-uid]',
  ]);
});
