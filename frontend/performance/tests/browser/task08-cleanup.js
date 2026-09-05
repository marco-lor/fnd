const {
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  projectId,
} = require('../../../scripts/performance/common');

const DEFAULT_EMAIL = 'task08-created@example.test';

const TASK08_CREATED_ACCOUNT_CLEANUP_ROOTS = (uid) => [
  `users/${uid}`,
  `user_directory/${uid}`,
  `user_operations[actorUid=${uid}]`,
];

const isAuthNotFound = (error) => (
  error?.code === 'auth/user-not-found'
  || error?.code === 'auth/invalid-uid'
);

const deleteDocumentTree = async (db, reference) => {
  if (typeof db.recursiveDelete === 'function') {
    await db.recursiveDelete(reference);
    return;
  }
  const collections = typeof reference.listCollections === 'function'
    ? await reference.listCollections()
    : [];
  for (const collection of collections) {
    const snapshot = await collection.get();
    for (const document of snapshot.docs || []) {
      await deleteDocumentTree(db, document.ref);
    }
  }
  await reference.delete();
};

const ownedReceiptQuery = (db, uid) => db.collection('user_operations')
  .where('actorUid', '==', uid);

const deleteOwnedFirestoreData = async (db, uid) => {
  const userReference = db.doc(`users/${uid}`);
  const directoryReference = db.doc(`user_directory/${uid}`);
  await deleteDocumentTree(db, userReference);
  await deleteDocumentTree(db, directoryReference);

  const receipts = await ownedReceiptQuery(db, uid).get();
  for (const receipt of receipts.docs || []) {
    await deleteDocumentTree(db, receipt.ref);
  }
};

const verifyOwnedFirestoreDataAbsent = async (db, uid) => {
  const references = [
    db.doc(`users/${uid}`),
    db.doc(`user_directory/${uid}`),
  ];
  for (const reference of references) {
    if ((await reference.get()).exists) {
      throw new Error(`Task 08 cleanup left owned Firestore data at ${reference.path}.`);
    }
  }
  const receipts = await ownedReceiptQuery(db, uid).get();
  if ((receipts.docs || []).length) {
    throw new Error(`Task 08 cleanup left ${receipts.docs.length} owned user operation receipt(s).`);
  }
};

const createTask08AccountCleanup = ({
  email = DEFAULT_EMAIL,
  auth,
  db,
  deleteOwnedFirestoreData: deleteOwnedFirestoreDataImpl,
  verifyOwnedFirestoreDataAbsent: verifyOwnedFirestoreDataAbsentImpl,
} = {}) => {
  if (!auth || typeof auth.getUserByEmail !== 'function' || typeof auth.deleteUser !== 'function') {
    throw new TypeError('Task 08 account cleanup requires an Admin Auth client.');
  }
  if (!deleteOwnedFirestoreDataImpl && !db) {
    throw new TypeError('Task 08 account cleanup requires an Admin Firestore client.');
  }
  const rememberedUids = new Map();
  const normalizeEmail = (value) => String(value || email).trim().toLowerCase();

  const rememberCreatedAccount = (accountEmail, uid) => {
    if (uid) rememberedUids.set(normalizeEmail(accountEmail), String(uid));
    return uid;
  };

  const resolveUid = async (accountEmail) => {
    const key = normalizeEmail(accountEmail);
    const remembered = rememberedUids.get(key);
    if (remembered) return remembered;
    try {
      const user = await auth.getUserByEmail(accountEmail);
      return rememberCreatedAccount(accountEmail, user.uid);
    } catch (error) {
      if (isAuthNotFound(error)) return null;
      throw error;
    }
  };

  const removeCreatedAccount = async (accountEmail = email) => {
    assertPerformanceProject(projectId);
    configureOwnedPerformanceEnvironment();
    const uid = await resolveUid(accountEmail);
    if (!uid) return { removed: false, uid: null };

    const deleteFirestore = deleteOwnedFirestoreDataImpl
      || ((candidateUid) => deleteOwnedFirestoreData(db, candidateUid));
    const verifyFirestore = verifyOwnedFirestoreDataAbsentImpl
      || ((candidateUid) => verifyOwnedFirestoreDataAbsent(db, candidateUid));

    // Keep the UID in memory until both stores have been verified. If any
    // Firestore or Auth step fails, a later finally block can retry using the
    // retained UID even if email lookup is no longer possible.
    await deleteFirestore(uid);
    await verifyFirestore(uid);
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (!isAuthNotFound(error)) throw error;
    }
    if (typeof auth.getUser === 'function') {
      try {
        await auth.getUser(uid);
        throw new Error(`Task 08 cleanup could not verify Auth deletion for ${uid}.`);
      } catch (error) {
        if (!isAuthNotFound(error)) throw error;
      }
    }
    rememberedUids.delete(normalizeEmail(accountEmail));
    return { removed: true, uid };
  };

  return {
    getRememberedUid: (accountEmail = email) => rememberedUids.get(normalizeEmail(accountEmail)) || null,
    rememberCreatedAccount,
    removeCreatedAccount,
  };
};

module.exports = {
  DEFAULT_EMAIL,
  TASK08_CREATED_ACCOUNT_CLEANUP_ROOTS,
  createTask08AccountCleanup,
  deleteOwnedFirestoreData,
  verifyOwnedFirestoreDataAbsent,
};
