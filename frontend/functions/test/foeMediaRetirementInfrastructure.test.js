const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const frontendRoot = path.resolve(__dirname, "..", "..");

test("foe retirement receipts and cleanup work are private and indexed", () => {
  const rules = fs.readFileSync(
    path.join(frontendRoot, "firestore.rules"),
    "utf8"
  );
  assert.match(
    rules,
    /match \/task07_foe_media_operations\/\{receiptId\}[\s\S]*?allow read, write: if false;/
  );
  assert.match(
    rules,
    /match \/task07_foe_media_cleanup\/\{receiptId\}[\s\S]*?allow read, write: if false;/
  );
  const indexes = require("../../firestore.indexes.json");
  for (const [collectionGroup, stateField] of [
    ["task07_foe_media_operations", "status"],
    ["task07_foe_media_cleanup", "state"],
  ]) {
    assert.ok(indexes.indexes.some((entry) => (
      entry.collectionGroup === collectionGroup &&
      entry.fields[0].fieldPath === stateField &&
      entry.fields[1].fieldPath === "cleanupAfter"
    )));
    assert.ok(indexes.fieldOverrides.some((entry) => (
      entry.collectionGroup === collectionGroup &&
      entry.fieldPath === "expiresAt" && entry.ttl === true
    )));
  }
});

test("foe operation uploads are immutable, server-owned, and carved out", () => {
  const rules = fs.readFileSync(
    path.join(frontendRoot, "storage.rules"),
    "utf8"
  );
  assert.match(
    rules,
    /match \/foes\/task07-operations\/[\s\S]*?allow create:[\s\S]*?allow update, delete: if false;/
  );
  assert.match(
    rules,
    /match \/foes\/\{firstSegment\}\/\{remaining=\*\*\}[\s\S]*?allow create, update, delete: if isDM\(\)[\s\S]*?firstSegment != 'task07-operations'/
  );
  assert.match(rules, /request\.resource\.metadata == upload\.metadata/);
});

test("legacy cleanup reclaims leases and retains unfenced generations", () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "functions", "src", "foeMediaRetirement.ts"),
    "utf8"
  );
  const cleanupCore = fs.readFileSync(
    path.join(
      frontendRoot,
      "functions",
      "src",
      "foeMediaRetirementCleanupCore.ts"
    ),
    "utf8"
  );
  const worker = source.match(
    /const processLegacyCleanup[\s\S]*?(?=export const sweepTask07)/
  )?.[0] || "";
  assert.match(cleanupCore, /"pending",[\s\S]*"retry",[\s\S]*"processing"/);
  assert.match(source, /cleanupAfter: nextLeaseUntil/);
  assert.match(source, /\.where\("state", "in", \[\.\.\.LEGACY_CLEANUP_SWEEP_STATES\]\)/);
  assert.match(worker, /settleUnfencedLegacyCleanup\(claim\.remaining\)/);
  assert.doesNotMatch(worker, /deleteGeneration/);
  assert.match(worker, /retainedReason: settlement\.retainedReason/);
  assert.match(worker, /expiresAt: FieldValue\.delete\(\)/);
});

test("foe retirement commits target, manifest, queues, and receipt atomically", () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "functions", "src", "foeMediaRetirement.ts"),
    "utf8"
  );
  assert.match(source, /hashValue\(current\) !== receipt\.get\("targetHash"\)/);
  assert.match(source, /task07FoeCanonicalRetirementPatch/);
  assert.match(source, /transaction\.update\(manifestRef/);
  assert.match(source, /transaction\.set\(canonicalCleanupRef/);
  assert.match(source, /transaction\.set\(legacyCleanupRef/);
  assert.match(source, /status: "completed",\s*result: committedResult/);
  assert.match(source, /receipt\.get\("status"\) === "completed"/);
  assert.match(source, /receipt\.get\("status"\) === "completed"[\s\S]*?return/);
  assert.match(source, /reason: "receipt-absent"/);
  assert.match(source, /reason: "receipt-identity-mismatch"/);
  assert.match(source, /updatedAt: \{seconds: now\.seconds, nanoseconds: now\.nanoseconds\}/);
});
