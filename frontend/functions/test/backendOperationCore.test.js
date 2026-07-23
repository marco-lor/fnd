const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BACKEND_OPERATION_STORAGE_CONCURRENCY,
  BACKEND_OPERATION_STEP_BUDGET_MS,
  backendOperationReceiptId,
  backendOperationRequestHash,
  emptyOperationProgress,
  getTokenGrantForLevel,
  isSafeOwnedStoragePath,
  mapWithConcurrency,
  operationViewFromData,
  ownedStoragePath,
  resolveTask06BackendConfig,
  validateBackendOperationId,
} = require("../lib/backendOperationCore");

test("Task 06 config fails safely to legacy with operations disabled", () => {
  assert.deepEqual(resolveTask06BackendConfig(undefined), {
    schemaVersion: 1,
    derivedOwnerMode: "legacy",
    enabledOperationKinds: [],
  });
  assert.deepEqual(resolveTask06BackendConfig({
    schemaVersion: 1,
    derivedOwnerMode: "authoritative",
    enabledOperationKinds: [
      "level-up-all",
      "level-up-all",
      "not-real",
    ],
  }), {
    schemaVersion: 1,
    derivedOwnerMode: "authoritative",
    enabledOperationKinds: ["level-up-all"],
  });
});

test("operation identity is actor-scoped and request-bound", () => {
  const first = backendOperationReceiptId("actor-a", "operation_123");
  assert.equal(first, backendOperationReceiptId(
    "actor-a",
    "operation_123"
  ));
  assert.notEqual(first, backendOperationReceiptId(
    "actor-b",
    "operation_123"
  ));
  assert.notEqual(
    backendOperationRequestHash("level-up-all", {value: true}),
    backendOperationRequestHash("level-up-all", {value: false})
  );
  assert.equal(validateBackendOperationId("operation_123"), "operation_123");
  assert.equal(validateBackendOperationId("short"), "");
});

test("operation views expose bounded public progress only", () => {
  const view = operationViewFromData({
    operationId: "operation_123",
    actorUid: "private-actor",
    kind: "delete-npc",
    status: "running",
    progress: {
      planned: 12,
      processed: 9,
      succeeded: 8,
      skipped: 1,
      failed: 0,
    },
    retryable: true,
  });
  assert.deepEqual(view, {
    operationId: "operation_123",
    kind: "delete-npc",
    status: "running",
    progress: {
      planned: 12,
      processed: 9,
      succeeded: 8,
      skipped: 1,
      failed: 0,
    },
    replayed: false,
    retryable: true,
  });
  assert.deepEqual(emptyOperationProgress(), {
    planned: 0,
    processed: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
  });
});

test("storage ownership validation rejects URLs and traversal", () => {
  const prefixes = ["foes/operations/", "echi_npcs/"];
  assert.equal(
    isSafeOwnedStoragePath("foes/operations/a/main.png", prefixes),
    true
  );
  assert.equal(isSafeOwnedStoragePath("../secret", prefixes), false);
  assert.equal(
    isSafeOwnedStoragePath("https://example.test/file", prefixes),
    false
  );
  assert.equal(
    ownedStoragePath(
      "https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/"
        + "echi_npcs%2Fdm%2Fnpc.png?alt=media&token=test",
      prefixes,
      "demo.appspot.com"
    ),
    "echi_npcs/dm/npc.png"
  );
  assert.equal(
    ownedStoragePath(
      "https://firebasestorage.googleapis.com/v0/b/other.appspot.com/o/"
        + "echi_npcs%2Fdm%2Fnpc.png",
      prefixes,
      "demo.appspot.com"
    ),
    ""
  );
});

test("level grants retain the existing gameplay bands", () => {
  assert.deepEqual(
    Array.from({length: 10}, (_, index) => getTokenGrantForLevel(index + 1)),
    [0, 4, 4, 4, 6, 6, 6, 8, 8, 8]
  );
});

test("bounded mapper never exceeds the configured concurrency", async () => {
  assert.equal(BACKEND_OPERATION_STEP_BUDGET_MS, 20_000);
  let active = 0;
  let peak = 0;
  const output = await mapWithConcurrency(
    Array.from({length: 19}, (_, index) => index),
    BACKEND_OPERATION_STORAGE_CONCURRENCY,
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    }
  );
  assert.equal(peak <= BACKEND_OPERATION_STORAGE_CONCURRENCY, true);
  assert.deepEqual(output, Array.from(
    {length: 19},
    (_, index) => index * 2
  ));
});

test("bounded mapper drains in-flight work before reporting failure", async () => {
  let active = 0;
  let finished = 0;
  await assert.rejects(
    mapWithConcurrency(
      Array.from({length: 12}, (_, index) => index),
      3,
      async (value) => {
        active += 1;
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        finished += 1;
        if (value === 2) throw new Error("copy failed");
        return value;
      }
    ),
    /copy failed/
  );
  assert.equal(active, 0);
  assert.equal(finished, 12);
});
