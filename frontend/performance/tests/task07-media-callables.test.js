const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {after, before, test} = require("node:test");
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = require("firebase-admin/app");
const {FieldValue, Timestamp, getFirestore} = require("firebase-admin/firestore");
const {getStorage: getAdminStorage} = require("firebase-admin/storage");
const {deleteApp, initializeApp} = require("firebase/app");
const {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} = require("firebase/auth");
const {
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytesResumable,
} = require("firebase/storage");

const {
  configureOwnedPerformanceEnvironment,
  OWNED_PERFORMANCE_ENVIRONMENT,
  projectId,
} = require("../../scripts/performance/common");
const {
  buildDeterministicPng,
  PERFORMANCE_STORAGE_BUCKET,
} = require("../../scripts/performance/fixtures");

configureOwnedPerformanceEnvironment();

const FUNCTIONS_REGION = "europe-west8";
const FUNCTIONS_BASE_URL = "http://127.0.0.1:5001";
const PASSWORD = "PerfTest!123";
const OWNER_UID = "perf-player";
const DM_UID = "perf-dm";
const OPERATION_ID = "task07-callable-avatar-0001";
const FOE_ID = "task07-callable-retirement-foe";
const FOE_MEDIA_OPERATION_ID = "task07-callable-foe-media-0001";
const FOE_ABANDON_OPERATION_ID = "task07-callable-foe-abandon-0001";
const CALL_TIMEOUT_MS = 120_000;

let clientApp;
let adminApp;
let auth;
let storage;
let db;
let bucket;
let token;
let originalControl;
let originalUserMediaFields;
let originalFoe = null;
let assetId = null;
let foeAssetId = null;
const foeReceiptIds = [];

class CallableInvocationError extends Error {
  constructor(name, response, payload) {
    const status = payload?.error?.status || `HTTP_${response.status}`;
    super(payload?.error?.message || `${name} failed with ${status}.`);
    this.name = "CallableInvocationError";
    this.code = String(status).toLowerCase().replaceAll("_", "-");
  }
}

const delay = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const callFunction = async (name, data, idToken = token) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(
      `${FUNCTIONS_BASE_URL}/${projectId}/${FUNCTIONS_REGION}/${name}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? {Authorization: `Bearer ${idToken}`} : {}),
        },
        body: JSON.stringify({data}),
        signal: controller.signal,
      }
    );
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok || body.error) {
      throw new CallableInvocationError(name, response, body);
    }
    return body.data ?? body.result;
  } finally {
    clearTimeout(timeout);
  }
};

const uploadSource = (upload, contents) => new Promise((resolve, reject) => {
  const task = uploadBytesResumable(
    ref(storage, upload.sourcePath),
    contents,
    {
      contentType: upload.sourceContentType,
      cacheControl: upload.cacheControl,
      contentDisposition: upload.contentDisposition,
      customMetadata: upload.sourceMetadata,
    }
  );
  task.on("state_changed", () => {}, reject, () => resolve(task.snapshot));
});

const uploadFoeOperation = (upload, contents) => new Promise((resolve, reject) => {
  const task = uploadBytesResumable(
    ref(storage, upload.path),
    contents,
    {
      contentType: upload.contentType,
      cacheControl: upload.cacheControl,
      contentDisposition: upload.contentDisposition,
      customMetadata: upload.metadata,
    }
  );
  task.on("state_changed", () => {}, reject, () => resolve(task.snapshot));
});

const waitForReady = async (id) => {
  const deadline = Date.now() + 90_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await callFunction("task07GetMediaStatus", {assetId: id});
    if (last.ready === true) return last;
    if (["cancelled", "deleted", "rejected", "superseded"].includes(last.state) ||
      (last.state === "failed" && last.retryable !== true)) {
      throw new Error(`Task 07 processor stopped in ${last.state}:${last.errorCode || "none"}.`);
    }
    await delay(250);
  }
  throw new Error(`Task 07 processor did not become ready: ${JSON.stringify(last)}.`);
};

before(async () => {
  adminApp = initializeAdminApp({
    projectId,
    storageBucket: PERFORMANCE_STORAGE_BUCKET,
  }, "task07-media-callables-admin");
  db = getFirestore(adminApp);
  bucket = getAdminStorage(adminApp).bucket();
  const controlRef = db.doc("utils/task07_media");
  const control = await controlRef.get();
  originalControl = control.exists ? control.data() : null;
  await controlRef.set({
    schemaVersion: 1,
    policyVersion: 1,
    mode: "v1-write",
    enabledPurposes: ["avatar"],
    enabledRoles: ["player"],
    enabledUids: [OWNER_UID],
  });
  const userRef = db.doc(`users/${OWNER_UID}`);
  const user = await userRef.get();
  originalUserMediaFields = {
    media: user.get("media"),
    task07MediaRevision: user.get("task07MediaRevision"),
    mediaUpdatedAt: user.get("mediaUpdatedAt"),
    imagePath: user.get("imagePath"),
    imageUrl: user.get("imageUrl"),
  };
  const foe = await db.doc(`foes/${FOE_ID}`).get();
  originalFoe = foe.exists ? foe.data() : null;
  await userRef.update({
    media: FieldValue.delete(),
    task07MediaRevision: FieldValue.delete(),
    mediaUpdatedAt: FieldValue.delete(),
  });

  clientApp = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: PERFORMANCE_STORAGE_BUCKET,
  }, "task07-media-callables-client");
  auth = getAuth(clientApp);
  connectAuthEmulator(
    auth,
    `http://${OWNED_PERFORMANCE_ENVIRONMENT.FIREBASE_AUTH_EMULATOR_HOST}`,
    {disableWarnings: true}
  );
  storage = getStorage(clientApp);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  const credential = await signInWithEmailAndPassword(
    auth,
    `${OWNER_UID}@example.test`,
    PASSWORD
  );
  token = await credential.user.getIdToken();
});

after(async () => {
  const controlRef = db?.doc("utils/task07_media");
  if (controlRef) {
    if (originalControl) await controlRef.set(originalControl);
    else await controlRef.delete();
  }
  if (db) {
    await db.doc(`users/${OWNER_UID}`).update({
      media: originalUserMediaFields?.media ?? FieldValue.delete(),
      task07MediaRevision:
        originalUserMediaFields?.task07MediaRevision ?? FieldValue.delete(),
      mediaUpdatedAt:
        originalUserMediaFields?.mediaUpdatedAt ?? FieldValue.delete(),
      imagePath: originalUserMediaFields?.imagePath ?? FieldValue.delete(),
      imageUrl: originalUserMediaFields?.imageUrl ?? FieldValue.delete(),
    }).catch(() => {});
    if (assetId) await db.doc(`media_assets/${assetId}`).delete().catch(() => {});
    if (foeAssetId) {
      await db.doc(`media_assets/${foeAssetId}`).delete().catch(() => {});
      await db.doc(`media_asset_cleanup/${foeAssetId}`).delete().catch(() => {});
    }
    for (const receiptId of foeReceiptIds) {
      await db.doc(`task07_foe_media_operations/${receiptId}`)
        .delete().catch(() => {});
      await db.doc(`task07_foe_media_cleanup/${receiptId}`)
        .delete().catch(() => {});
    }
    if (originalFoe) await db.doc(`foes/${FOE_ID}`).set(originalFoe);
    else await db.doc(`foes/${FOE_ID}`).delete().catch(() => {});
  }
  if (bucket && assetId) {
    await bucket.deleteFiles({prefix: `media_assets/v1/signed-in/${OWNER_UID}/${assetId}/`})
      .catch(() => {});
    await bucket.file(`media_uploads/${OWNER_UID}/${assetId}/source`)
      .delete({ignoreNotFound: true}).catch(() => {});
  }
  if (bucket && foeAssetId) {
    await bucket.deleteFiles({prefix: `media_assets/v1/dm-only/${DM_UID}/${foeAssetId}/`})
      .catch(() => {});
    await bucket.file(`media_uploads/${DM_UID}/${foeAssetId}/source`)
      .delete({ignoreNotFound: true}).catch(() => {});
  }
  if (bucket) {
    await bucket.deleteFiles({prefix: `foes/task07-operations/${DM_UID}/`})
      .catch(() => {});
  }
  if (clientApp) await deleteApp(clientApp);
  if (adminApp) await deleteAdminApp(adminApp);
});

test("Task 07 demo pipeline prepares, processes, attaches, and resumes idempotently", {
  timeout: 120_000,
}, async () => {
  const source = buildDeterministicPng({width: 96, height: 96, seed: 707});
  const request = {
    ownerUid: OWNER_UID,
    entityId: OWNER_UID,
    operationId: OPERATION_ID,
    kind: "avatar",
    sourceContentType: "image/png",
    sourceBytes: source.byteLength,
  };

  await assert.rejects(
    callFunction("task07PrepareMediaUpload", request, null),
    (error) => error?.code === "unauthenticated"
  );
  const prepared = await callFunction("task07PrepareMediaUpload", request);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.replay, false);
  assert.equal(prepared.state, "intent");
  assert.equal(prepared.sourcePresent, false);
  assert.equal(prepared.upload.sourceBytes, source.byteLength);
  assert.match(
    prepared.upload.sourcePath,
    new RegExp(`^media_uploads/${OWNER_UID}/m_[a-f0-9]{40}/source$`)
  );
  assetId = prepared.upload.assetId;

  await uploadSource(prepared.upload, source);
  const ready = await waitForReady(assetId);
  assert.equal(ready.state, "ready");
  const attached = await callFunction("task07AttachMediaAsset", {
    assetId,
    expectedRevision: 0,
  });
  assert.equal(attached.attached, true);
  assert.equal(attached.revision, 1);

  const [user, manifest] = await Promise.all([
    db.doc(`users/${OWNER_UID}`).get(),
    db.doc(`media_assets/${assetId}`).get(),
  ]);
  assert.equal(user.get("media.assetId"), assetId);
  assert.equal(user.get("media.state"), "ready");
  assert.equal(user.get("task07MediaRevision"), 1);
  assert.match(
    user.get("media.original.path"),
    new RegExp(`^media_assets/v1/signed-in/${OWNER_UID}/${assetId}/[1-9][0-9]*/original$`)
  );
  assert.equal(user.get("imagePath"), originalUserMediaFields.imagePath);
  assert.equal(user.get("imageUrl"), originalUserMediaFields.imageUrl);
  assert.equal(manifest.get("state"), "attached");

  const replay = await callFunction("task07PrepareMediaUpload", request);
  assert.equal(replay.replay, true);
  assert.equal(replay.state, "attached");
  assert.equal(replay.sourcePresent, false);
  const replayAttach = await callFunction("task07AttachMediaAsset", {assetId});
  assert.equal(replayAttach.attached, false);
  assert.equal(replayAttach.revision, 1);

  await db.doc("utils/task07_media").update({mode: "shadow"});
  await assert.rejects(
    callFunction("task07PrepareMediaUpload", {
      ...request,
      operationId: "task07-callable-avatar-disabled-0001",
    }),
    (error) => error?.code === "failed-precondition"
  );
});

test("foe retirement abandons safely, commits atomically, and replays", {
  timeout: 180_000,
}, async () => {
  await db.doc("utils/task07_media").set({
    schemaVersion: 1,
    policyVersion: 1,
    mode: "v1-write",
    enabledPurposes: ["foe"],
    enabledRoles: ["dm"],
    enabledUids: [DM_UID],
  });
  const credential = await signInWithEmailAndPassword(
    auth,
    `${DM_UID}@example.test`,
    PASSWORD
  );
  token = await credential.user.getIdToken();

  const createdAt = Timestamp.now();
  const editedAt = Timestamp.fromMillis(createdAt.toMillis() + 1);
  await db.doc(`foes/${FOE_ID}`).set({
    name: "Task 07 retirement source",
    stats: {hpTotal: 20, hpCurrent: 20, manaTotal: 4, manaCurrent: 4},
    tecniche: [],
    spells: [],
    created_at: createdAt,
    updated_at: editedAt,
  });

  const canonicalSource = buildDeterministicPng({
    width: 96,
    height: 96,
    seed: 708,
  });
  const mediaPrepared = await callFunction("task07PrepareMediaUpload", {
    ownerUid: DM_UID,
    entityId: FOE_ID,
    operationId: "task07-callable-foe-source-0001",
    kind: "foe",
    sourceContentType: "image/png",
    sourceBytes: canonicalSource.byteLength,
  });
  foeAssetId = mediaPrepared.upload.assetId;
  await uploadSource(mediaPrepared.upload, canonicalSource);
  await waitForReady(foeAssetId);
  const attached = await callFunction("task07AttachMediaAsset", {
    assetId: foeAssetId,
    expectedRevision: 0,
  });
  assert.equal(attached.revision, 1);

  const nestedImage = buildDeterministicPng({
    width: 32,
    height: 32,
    seed: 709,
  });
  const digest = createHash("sha256").update(nestedImage).digest("hex");
  const mutation = {
    fields: {
      name: "Task 07 retirement committed",
      stats: {hpTotal: 24, hpCurrent: 24, manaTotal: 6, manaCurrent: 6},
    },
    tecniche: [],
    spells: [{
      name: "Atomic spell",
      description: "Stored with the retirement commit",
      danni: "2d6",
      effetti: "burn",
      image: {
        mode: "upload",
        key: "spells-0",
        sha256: digest,
        bytes: nestedImage.byteLength,
        contentType: "image/png",
      },
    }],
  };
  const targetBefore = await db.doc(`foes/${FOE_ID}`).get();
  const targetUpdatedAt = targetBefore.get("updated_at");
  const immutableRequest = {
    schemaVersion: 1,
    assetId: foeAssetId,
    expectedRevision: 1,
    expectedUpdatedAt: {
      seconds: targetUpdatedAt.seconds,
      nanoseconds: targetUpdatedAt.nanoseconds,
    },
    mutation,
  };

  const abandonedPlan = await callFunction(
    "task07PrepareFoeMediaRetirement",
    {...immutableRequest, operationId: FOE_ABANDON_OPERATION_ID}
  );
  foeReceiptIds.push(abandonedPlan.receiptId);
  assert.equal(abandonedPlan.status, "pending");
  assert.equal(abandonedPlan.uploads.length, 1);
  await uploadFoeOperation(abandonedPlan.uploads[0], nestedImage);
  const abandoned = await callFunction("task07AbandonFoeMediaRetirement", {
    schemaVersion: 1,
    operationId: FOE_ABANDON_OPERATION_ID,
    assetId: foeAssetId,
  });
  assert.equal(abandoned.status, "abandoned");
  const [abandonedObjectExists] = await bucket.file(
    abandonedPlan.uploads[0].path
  ).exists();
  assert.equal(abandonedObjectExists, false);
  assert.equal(
    (await db.doc(
      `task07_foe_media_operations/${abandonedPlan.receiptId}`
    ).get()).get("status"),
    "abandoned"
  );

  const prepared = await callFunction("task07PrepareFoeMediaRetirement", {
    ...immutableRequest,
    operationId: FOE_MEDIA_OPERATION_ID,
  });
  foeReceiptIds.push(prepared.receiptId);
  assert.equal(prepared.status, "pending");
  assert.equal(prepared.uploads.length, 1);
  await uploadFoeOperation(prepared.uploads[0], nestedImage);
  const committed = await callFunction("task07CommitFoeMediaRetirement", {
    schemaVersion: 1,
    operationId: FOE_MEDIA_OPERATION_ID,
    assetId: foeAssetId,
  });
  const {
    updatedAt: committedUpdatedAt,
    ...committedResult
  } = committed;
  assert.deepEqual(committedResult, {
    schemaVersion: 1,
    status: "completed",
    operationId: FOE_MEDIA_OPERATION_ID,
    assetId: foeAssetId,
    foeId: FOE_ID,
    revision: 2,
  });
  assert.equal(Number.isSafeInteger(committedUpdatedAt?.seconds), true);
  assert.equal(Number.isSafeInteger(committedUpdatedAt?.nanoseconds), true);

  const [target, manifest, receipt, cleanup] = await Promise.all([
    db.doc(`foes/${FOE_ID}`).get(),
    db.doc(`media_assets/${foeAssetId}`).get(),
    db.doc(`task07_foe_media_operations/${prepared.receiptId}`).get(),
    db.doc(`media_asset_cleanup/${foeAssetId}`).get(),
  ]);
  assert.equal(target.get("name"), "Task 07 retirement committed");
  assert.equal(target.get("media"), undefined);
  assert.equal(target.get("task07MediaRevision"), 2);
  const committedSpells = target.get("spells");
  assert.equal(committedSpells[0].imagePath, prepared.uploads[0].path);
  assert.match(committedSpells[0].imageUrl, /token=/);
  assert.equal(manifest.get("state"), "superseded");
  assert.equal(receipt.get("status"), "completed");
  assert.equal(cleanup.get("state"), "pending");

  const replay = await callFunction("task07PrepareFoeMediaRetirement", {
    ...immutableRequest,
    operationId: FOE_MEDIA_OPERATION_ID,
  });
  assert.deepEqual(replay, committed);
  const commitReplay = await callFunction("task07CommitFoeMediaRetirement", {
    schemaVersion: 1,
    operationId: FOE_MEDIA_OPERATION_ID,
    assetId: foeAssetId,
  });
  assert.deepEqual(commitReplay, committed);
  assert.equal(
    (await db.doc(`foes/${FOE_ID}`).get()).get("task07MediaRevision"),
    2
  );
});
