const assert = require("node:assert/strict");
const {after, before, test} = require("node:test");
const {deleteApp: deleteAdminApp, initializeApp: initializeAdminApp} = require("firebase-admin/app");
const {FieldValue, getFirestore} = require("firebase-admin/firestore");
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
const OPERATION_ID = "task07-callable-avatar-0001";
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
let assetId = null;

class CallableInvocationError extends Error {
  constructor(name, response, payload) {
    const status = payload?.error?.status || `HTTP_${response.status}`;
    super(payload?.error?.message || `${name} failed with ${status}.`);
    this.name = "CallableInvocationError";
    this.code = String(status).toLowerCase().replaceAll("_", "-");
  }
}

const delay = (milliseconds) => new Promise((resolve) => {
  const timer = setTimeout(resolve, milliseconds);
  timer.unref?.();
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
  }
  if (bucket && assetId) {
    await bucket.deleteFiles({prefix: `media_assets/v1/signed-in/${OWNER_UID}/${assetId}/`})
      .catch(() => {});
    await bucket.file(`media_uploads/${OWNER_UID}/${assetId}/source`)
      .delete({ignoreNotFound: true}).catch(() => {});
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
