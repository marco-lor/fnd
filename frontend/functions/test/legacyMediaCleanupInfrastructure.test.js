const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.GCLOUD_PROJECT = "demo-fnd-perf";
process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../lib/index");
const frontendRoot = path.resolve(__dirname, "..", "..");

const REFERENCE_TRIGGER_EXPORTS = [
  "cleanupLegacyRemovedBackgroundMedia",
  "cleanupLegacyRemovedCatalogItemMedia",
  "cleanupLegacyRemovedFoeMedia",
  "cleanupLegacyRemovedMusicTrackMedia",
  "cleanupLegacyRemovedNpcMedia",
  "cleanupLegacyRemovedTokenMedia",
  "cleanupLegacyRemovedUserMedia",
];

test("every legacy media-owning root has a registered reference trigger", () => {
  REFERENCE_TRIGGER_EXPORTS.forEach((name) => {
    assert.equal(typeof functions[name], "function", name);
    assert.ok(functions[name].__endpoint.eventTrigger, name);
  });
  assert.ok(functions.cleanupLegacyMedia.__endpoint.eventTrigger);
  assert.ok(functions.sweepLegacyMediaCleanup.__endpoint.scheduleTrigger);
});

test("legacy cleanup queues are private and terminal receipts have TTL", () => {
  const rules = fs.readFileSync(
    path.join(frontendRoot, "firestore.rules"),
    "utf8"
  );
  assert.match(
    rules,
    /match \/legacy_media_cleanup\/\{cleanupId\}[\s\S]*?allow read, write: if false;/
  );
  assert.match(
    rules,
    /match \/user_media_cleanup\/\{cleanupId\}[\s\S]*?allow read, write: if false;/
  );
  const indexes = require("../../firestore.indexes.json");
  for (const collectionGroup of [
    "legacy_media_cleanup",
    "user_media_cleanup",
  ]) {
    assert.ok(indexes.fieldOverrides.some((entry) => (
      entry.collectionGroup === collectionGroup &&
      entry.fieldPath === "expiresAt" &&
      entry.ttl === true
    )), collectionGroup);
  }
});

test("cleanup retries are durable and deletion is verified", () => {
  const legacySource = fs.readFileSync(
    path.join(frontendRoot, "functions", "src", "legacyMediaCleanup.ts"),
    "utf8"
  );
  const ownedSource = fs.readFileSync(
    path.join(frontendRoot, "functions", "src", "userOwnedMediaCleanup.ts"),
    "utf8"
  );
  assert.match(legacySource, /retry: true/);
  assert.match(legacySource, /await file\.delete\(\{ignoreNotFound: true\}\)/);
  assert.match(legacySource, /await file\.exists\(\)/);
  assert.match(legacySource, /documentContainsLegacyMediaPath/);
  assert.match(legacySource, /retryFailedOwnedMediaCleanup/);
  assert.match(ownedSource, /retryFailedOwnedMediaCleanup/);
  assert.match(ownedSource, /await file\.exists\(\)/);
});
