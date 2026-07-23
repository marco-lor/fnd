const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const frontendRoot = path.resolve(__dirname, "..", "..");

test("Task 06 operation records have checked-in TTL policies", () => {
  const indexes = require("../../firestore.indexes.json");
  const ttlByCollection = new Map(
    indexes.fieldOverrides
      .filter((entry) => entry.fieldPath === "expiresAt" && entry.ttl === true)
      .map((entry) => [entry.collectionGroup, entry])
  );
  [
    "user_operations",
    "backend_operations",
    "backend_operation_work",
    "subjects",
  ].forEach((collectionGroup) => {
    const entry = ttlByCollection.get(collectionGroup);
    assert.ok(entry, collectionGroup);
    assert.deepEqual(entry.indexes, [], collectionGroup);
  });
});

test("Task 06 control and operation documents are denied to clients", () => {
  const rules = fs.readFileSync(
    path.join(frontendRoot, "firestore.rules"),
    "utf8"
  );
  assert.match(rules, /match \/app_config\/task06_backend \{/);
  assert.match(rules, /match \/backend_operations\/\{operationId\} \{/);
  assert.match(rules, /match \/backend_operation_work\/\{workId\} \{/);
  assert.match(
    rules,
    /match \/backend_operations\/\{operationId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?match \/subjects\/\{subjectId\}/
  );
});

test("Task 06 operations fence pending actors and bulk subjects", () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "functions", "src", "backendOperations.ts"),
    "utf8"
  );
  assert.match(
    source,
    /actor\.get\("deletionState"\) === "pending"/
  );
  assert.equal(
    (source.match(/reason: "pending-deletion"/g) ?? []).length,
    2
  );
});

test("Task 06 private NPC cleanup has its collection-group index", () => {
  const indexes = require("../../firestore.indexes.json");
  const npcId = indexes.fieldOverrides.find((entry) => (
    entry.collectionGroup === "map_markers_private"
    && entry.fieldPath === "npcId"
  ));
  assert.ok(npcId);
  assert.deepEqual(npcId.indexes, [{
    order: "ASCENDING",
    queryScope: "COLLECTION_GROUP",
  }]);
});

test("V2 foe asset copies use the checked-in four-way bounded mapper", () => {
  const core = fs.readFileSync(
    path.join(frontendRoot, "functions", "src", "backendOperationCore.ts"),
    "utf8"
  );
  const duplicate = fs.readFileSync(
    path.join(frontendRoot, "functions", "src", "duplicateFoeWithAssets.ts"),
    "utf8"
  );
  assert.match(
    core,
    /BACKEND_OPERATION_STORAGE_CONCURRENCY\s*=\s*4/
  );
  assert.match(
    duplicate,
    /copied\s*=\s*await mapWithConcurrency\(\s*claim\.manifest,\s*BACKEND_OPERATION_STORAGE_CONCURRENCY,\s*copyManifestEntry\s*\)/
  );
  assert.match(
    duplicate,
    /const results = await mapWithConcurrency\(\s*manifest,\s*BACKEND_OPERATION_STORAGE_CONCURRENCY/
  );
});
