const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FoeRetirementStorageError,
  TASK07_FOE_UPLOAD_CACHE_CONTROL,
  verifyFoeRetirementUploads,
} = require("../lib/foeMediaRetirementStorage");

const plan = {
  key: "spells-0",
  slot: "spells-0",
  path: "foes/task07-operations/dm/receipt/foe/spells-0/hash.png",
  fileName: "hash.png",
  sha256: "a".repeat(64),
  bytes: 10,
  contentType: "image/png",
  metadata: {
    task07ActorUid: "dm",
    task07AssetId: `m_${"b".repeat(40)}`,
    task07Bytes: "10",
    task07Digest: "a".repeat(64),
    task07FoeId: "foe",
    task07OperationId: "operation-0001",
    task07ReceiptId: "receipt",
    task07Slot: "spells-0",
  },
};

const metadata = (overrides = {}) => ({
  size: "10",
  contentType: "image/png",
  cacheControl: TASK07_FOE_UPLOAD_CACHE_CONTROL,
  contentDisposition: "inline",
  generation: "7",
  metadata: {
    ...plan.metadata,
    firebaseStorageDownloadTokens: "firebase-token",
  },
  ...overrides,
});

const adapter = (overrides = {}) => ({
  bucketName: "demo.appspot.com",
  getMetadata: async () => metadata(),
  digest: async () => ({bytes: 10, sha256: "a".repeat(64)}),
  deleteGeneration: async () => {},
  isNotFound: (error) => error?.code === 404,
  ...overrides,
});

test("verifier fences generation and recomputes bytes and SHA-256", async () => {
  const result = await verifyFoeRetirementUploads({
    plans: [plan],
    storage: adapter(),
  });
  assert.equal(result[0].generation, "7");
  assert.match(result[0].url, /token=firebase-token$/);
});

test("verifier rejects missing, mismatched, and generation-changed objects", async () => {
  const cases = [
    adapter({
      getMetadata: async () => {
        const error = new Error("missing");
        error.code = 404;
        throw error;
      },
    }),
    adapter({digest: async () => ({bytes: 10, sha256: "c".repeat(64)})}),
    (() => {
      let calls = 0;
      return adapter({
        getMetadata: async () => metadata({generation: String(++calls + 6)}),
      });
    })(),
  ];
  for (const storage of cases) {
    await assert.rejects(
      verifyFoeRetirementUploads({plans: [plan], storage}),
      FoeRetirementStorageError
    );
  }
});

test("verifier rejects absent tokens and arbitrary custom metadata", async () => {
  for (const customMetadata of [
    {...plan.metadata},
    {
      ...plan.metadata,
      firebaseStorageDownloadTokens: "firebase-token",
      unexpected: "value",
    },
  ]) {
    await assert.rejects(
      verifyFoeRetirementUploads({
        plans: [plan],
        storage: adapter({
          getMetadata: async () => metadata({metadata: customMetadata}),
        }),
      }),
      (error) => error instanceof FoeRetirementStorageError &&
        error.retryable === false
    );
  }
});

test("verifier limits concurrent object streams to two", async () => {
  let active = 0;
  let maximum = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const storage = adapter({
    digest: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return {bytes: 10, sha256: "a".repeat(64)};
    },
  });
  const verification = verifyFoeRetirementUploads({
    plans: [0, 1, 2].map((index) => ({
      ...plan,
      key: `spells-${index}`,
      path: `${plan.path}-${index}`,
    })),
    storage,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 2);
  release();
  await verification;
});
