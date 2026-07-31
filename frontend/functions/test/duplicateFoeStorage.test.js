const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyLegacyFoeSourcePresenceCheckpoint,
  copyLegacyFoeManifestEntry,
  LegacyFoeCopyStorageError,
} = require("../lib/duplicateFoeStorage");

const entry = {
  key: "main",
  sourcePath: "foes/source.png",
  destinationPath: "foes/operations/receipt/main.png",
  downloadToken: "receipt-token",
};

const validMetadata = {
  size: "10",
  contentType: "image/png",
  metadata: {
    firebaseStorageDownloadTokens: entry.downloadToken,
    task06OperationOwned: "true",
  },
};

const adapter = (overrides = {}) => ({
  bucketName: "demo.appspot.com",
  exists: async (path) => path === entry.sourcePath,
  copy: async () => {},
  getMetadata: async () => validMetadata,
  setMetadata: async () => {},
  isNotFound: (error) => error?.code === 404,
  ...overrides,
});

test("legacy copy reuses its valid destination before reading source", async () => {
  const calls = [];
  const result = await copyLegacyFoeManifestEntry({
    entry,
    storage: adapter({
      exists: async (path) => {
        calls.push(path);
        return path === entry.destinationPath;
      },
    }),
  });
  assert.equal(result.outcome, "reused");
  assert.deepEqual(calls, [entry.destinationPath]);
  assert.equal(result.path, entry.destinationPath);
});

test("legacy copy skips an explicitly missing source", async () => {
  const result = await copyLegacyFoeManifestEntry({
    entry,
    storage: adapter({exists: async () => false}),
  });
  assert.deepEqual(result, {
    outcome: "missing",
    key: "main",
    path: "",
    url: "",
  });
});

test("legacy copy keeps a source-side 404 race retryable", async () => {
  let destinationChecks = 0;
  await assert.rejects(
    copyLegacyFoeManifestEntry({
      entry,
      storage: adapter({
        exists: async (path) => {
          if (path === entry.sourcePath) return true;
          destinationChecks += 1;
          return false;
        },
        copy: async () => {
          const error = new Error("gone");
          error.code = 404;
          throw error;
        },
      }),
    }),
    (error) => error instanceof LegacyFoeCopyStorageError &&
      error.code === "legacy-source-disappeared" &&
      error.retryable === true
  );
  assert.equal(destinationChecks, 2);
});

test("known-present source never becomes a successful missing retry", async () => {
  const checkpointed = applyLegacyFoeSourcePresenceCheckpoint(
    [entry],
    new Set([entry.sourcePath])
  )[0];
  assert.equal(checkpointed.sourceKnownPresent, true);
  assert.equal(
    applyLegacyFoeSourcePresenceCheckpoint([checkpointed], new Set())[0]
      .sourceKnownPresent,
    true
  );

  await assert.rejects(
    copyLegacyFoeManifestEntry({
      entry: checkpointed,
      storage: adapter({
        exists: async (path) => path === entry.sourcePath,
        copy: async () => {
          const error = new Error("gone during first copy");
          error.code = 404;
          throw error;
        },
      }),
    }),
    (error) => error instanceof LegacyFoeCopyStorageError &&
      error.code === "legacy-source-disappeared" &&
      error.retryable === true
  );

  await assert.rejects(
    copyLegacyFoeManifestEntry({
      entry: checkpointed,
      storage: adapter({exists: async () => false}),
    }),
    (error) => error instanceof LegacyFoeCopyStorageError &&
      error.code === "legacy-source-missing-after-plan" &&
      error.retryable === true
  );
});

test("plan-time missing source remains skippable without a source re-probe", async () => {
  const checkpointed = applyLegacyFoeSourcePresenceCheckpoint(
    [entry],
    new Set()
  )[0];
  const calls = [];
  const result = await copyLegacyFoeManifestEntry({
    entry: checkpointed,
    storage: adapter({
      exists: async (path) => {
        calls.push(path);
        return false;
      },
    }),
  });
  assert.equal(result.outcome, "missing");
  assert.deepEqual(calls, [entry.destinationPath]);
});

test("legacy copy keeps transient source and destination failures retryable", async () => {
  await assert.rejects(
    copyLegacyFoeManifestEntry({
      entry,
      storage: adapter({
        exists: async (path) => path === entry.sourcePath,
        copy: async () => {
          const error = new Error("throttled");
          error.code = 429;
          throw error;
        },
      }),
    }),
    (error) => error instanceof LegacyFoeCopyStorageError &&
      error.retryable === true
  );
});

test("legacy copy rejects a conflicting deterministic destination", async () => {
  await assert.rejects(
    copyLegacyFoeManifestEntry({
      entry,
      storage: adapter({
        exists: async (path) => path === entry.destinationPath,
        getMetadata: async () => ({
          ...validMetadata,
          metadata: {task06OperationOwned: "true"},
        }),
      }),
    }),
    (error) => error instanceof LegacyFoeCopyStorageError &&
      error.retryable === false
  );
});
