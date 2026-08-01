const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GCLOUD_PROJECT = "demo-fnd-perf";
process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../lib/index");
const lifecycle = require("../lib/mediaAssetLifecycle");
const {
  task07CallableEnforcesAppCheck,
} = require("../lib/task07CallableOptions");

const INDEX_EXPORTS = [
  "cleanupTask07MediaAsset",
  "cleanupTask07RemovedBackgroundMedia",
  "cleanupTask07RemovedCatalogItemMedia",
  "cleanupTask07RemovedFoeMedia",
  "cleanupTask07RemovedInventoryMedia",
  "cleanupTask07RemovedNpcMedia",
  "cleanupTask07RemovedSpellMedia",
  "cleanupTask07RemovedTechniqueMedia",
  "cleanupTask07RemovedTokenMedia",
  "cleanupTask07RemovedUserMedia",
  "sweepTask07MediaOrphans",
  "task07AbandonMediaAsset",
  "task07AttachMediaAsset",
  "task07ConfirmMediaReference",
  "task07GetMediaStatus",
  "task07PrepareMediaUpload",
  "task07ProcessMediaUpload",
  "task07RetireMediaAsset",
  "task07RetryMediaCleanup",
  "syncTask07MusicStreamFromControl",
  "syncTask07MusicStreamFromPlayback",
  "syncTask07MusicStreamFromSession",
  "syncTask07MusicStreamFromTrack",
];

test("existing Function IDs retain registered endpoints", () => {
  assert.deepEqual(
    INDEX_EXPORTS.filter((name) => typeof functions[name] !== "function"),
    []
  );
  assert.ok(functions.task07PrepareMediaUpload.__endpoint.callableTrigger);
  assert.ok(functions.task07ConfirmMediaReference.__endpoint.callableTrigger);
  assert.ok(functions.task07ProcessMediaUpload.__endpoint.eventTrigger);
  assert.ok(functions.cleanupTask07MediaAsset.__endpoint.eventTrigger);
  assert.ok(functions.sweepTask07MediaOrphans.__endpoint.scheduleTrigger);
  assert.ok(
    functions.syncTask07MusicStreamFromControl.__endpoint.eventTrigger
  );
  assert.ok(
    functions.syncTask07MusicStreamFromPlayback.__endpoint.eventTrigger
  );
  assert.ok(
    functions.syncTask07MusicStreamFromSession.__endpoint.eventTrigger
  );
  assert.ok(
    functions.syncTask07MusicStreamFromTrack.__endpoint.eventTrigger
  );
});

test("new server endpoints exist for explicit index registration", () => {
  assert.equal(typeof lifecycle.task07GetMediaStatus, "function");
  assert.equal(typeof lifecycle.task07AttachMediaAsset, "function");
  assert.equal(typeof lifecycle.cleanupTask07RemovedTokenMedia, "function");
  assert.equal(typeof lifecycle.cleanupTask07RemovedTechniqueMedia, "function");
  assert.equal(typeof lifecycle.cleanupTask07RemovedSpellMedia, "function");
});

test("App Check bypass is exact to the demo emulator", () => {
  assert.equal(task07CallableEnforcesAppCheck({
    FUNCTIONS_EMULATOR: "true",
    GCLOUD_PROJECT: "demo-fnd-perf",
  }), false);
  assert.equal(task07CallableEnforcesAppCheck({
    FUNCTIONS_EMULATOR: "true",
    GCLOUD_PROJECT: "production-project",
  }), true);
  assert.equal(task07CallableEnforcesAppCheck({
    GCLOUD_PROJECT: "demo-fnd-perf",
  }), true);
  assert.equal(task07CallableEnforcesAppCheck({}), true);
});
