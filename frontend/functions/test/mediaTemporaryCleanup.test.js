const test = require("node:test");
const assert = require("node:assert/strict");
const {Timestamp} = require("firebase-admin/firestore");

const {
  buildTask07MediaUploadPlan,
} = require("../lib/mediaAssetLifecycleCore");
const {
  buildGeneratedMediaStoragePlan,
} = require("../lib/mediaContracts");
const {
  task07TemporaryCleanupFields,
  task07TemporaryCleanupPaths,
} = require("../lib/mediaTemporaryCleanup");

const fixture = () => {
  const plan = buildTask07MediaUploadPlan({
    actorUid: "user-a",
    ownerUid: "user-a",
    entityId: "user-a",
    operationId: "temporary_cleanup_12345678",
    kind: "avatar",
    sourceContentType: "image/png",
    sourceBytes: 1024,
  });
  const generated = buildGeneratedMediaStoragePlan({
    kind: plan.kind,
    audienceScope: plan.audienceScope,
    ownerKey: plan.ownerKey,
    assetId: plan.assetId,
    sourceGeneration: "7",
  });
  const paths = [
    `${generated.originalPath}.tmp-event_1`,
    `${generated.variants.thumbnail}.tmp-event_1`,
  ];
  return {generated, paths, plan};
};

test("temporary cleanup accepts only exact generated staging copies", () => {
  const {paths, plan} = fixture();
  assert.deepEqual(task07TemporaryCleanupPaths({
    generation: "7",
    cleanupTemporaryPaths: [...paths].reverse(),
  }, plan), [...paths].sort());
  assert.equal(task07TemporaryCleanupPaths({
    generation: "7",
    cleanupTemporaryPaths: [paths[0], paths[0]],
  }, plan), null);
  assert.equal(task07TemporaryCleanupPaths({
    generation: "7",
    cleanupTemporaryPaths: [paths[0].replace(plan.assetId, `m_${"f".repeat(40)}`)],
  }, plan), null);
  assert.equal(task07TemporaryCleanupPaths({
    generation: "8",
    cleanupTemporaryPaths: paths,
  }, plan), null);
});

test("temporary cleanup fields are due immediately and deterministic", () => {
  const {paths} = fixture();
  const now = Timestamp.fromMillis(1234);
  const fields = task07TemporaryCleanupFields([
    paths[1],
    paths[0],
    paths[1],
  ], now);
  assert.deepEqual(fields.cleanupTemporaryPaths, [...paths].sort());
  assert.deepEqual(fields.temporaryCleanup, {
    attempts: 0,
    cleanupAfter: now,
  });
});
