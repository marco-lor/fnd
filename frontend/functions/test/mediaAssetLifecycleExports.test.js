const test = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");

process.env.GCLOUD_PROJECT = "demo-fnd-perf";

const functions = require("../lib/index");

const TASK07_REFERENCE_REMOVAL_EXPORTS = [
  "cleanupTask07RemovedBackgroundMedia",
  "cleanupTask07RemovedCatalogItemMedia",
  "cleanupTask07RemovedFoeMedia",
  "cleanupTask07RemovedInventoryMedia",
  "cleanupTask07RemovedNpcMedia",
  "cleanupTask07RemovedUserMedia",
];

const TASK07_MEDIA_EXPORTS = [
  "cleanupTask07MediaAsset",
  ...TASK07_REFERENCE_REMOVAL_EXPORTS,
  "sweepTask07MediaOrphans",
  "task07AbandonMediaAsset",
  "task07ConfirmMediaReference",
  "task07FinalizeMediaUpload",
  "task07PrepareMediaUpload",
  "task07RetireMediaAsset",
  "task07RetryMediaCleanup",
];

test("Task 07 media lifecycle exports are all registered", () => {
  assert.deepEqual(
    TASK07_MEDIA_EXPORTS.filter((name) => typeof functions[name] !== "function"),
    []
  );
});

test("Task 07 endpoints retain callable, Firestore, and schedule metadata", () => {
  const endpointTypes = Object.fromEntries(TASK07_MEDIA_EXPORTS.map((name) => [
    name,
    functions[name].__endpoint?.platform,
  ]));
  assert.ok(Object.values(endpointTypes).every(Boolean));
  assert.deepEqual(functions.task07PrepareMediaUpload.__endpoint.callableTrigger, {});
  assert.ok(functions.cleanupTask07MediaAsset.__endpoint.eventTrigger);
  assert.ok(TASK07_REFERENCE_REMOVAL_EXPORTS.every((name) => (
    functions[name].__endpoint.eventTrigger
  )));
  assert.ok(functions.sweepTask07MediaOrphans.__endpoint.scheduleTrigger);
});

test("reference removal combines event and live document existence", () => {
  const source = readFileSync(
    join(__dirname, "../src/mediaAssetLifecycle.ts"),
    "utf8"
  );
  assert.match(
    source,
    new RegExp(
      "eventAfterExists:\\s*input\\.afterExists," +
      "\\s*currentExists:\\s*currentReference\\.exists"
    )
  );
});
