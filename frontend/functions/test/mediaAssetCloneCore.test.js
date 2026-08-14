const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTask07MediaUploadPlan,
} = require("../lib/mediaAssetLifecycleCore");
const {
  buildGeneratedMediaStoragePlan,
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_SCHEMA_VERSION,
} = require("../lib/mediaContracts");
const {
  buildTask07FoeMediaClonePlan,
  buildTask07FoeTokenMediaRegenerationPlan,
  task07CanonicalFoeMediaAssetId,
  task07FoeTokenMediaRegenerationPlansMatch,
} = require("../lib/mediaAssetCloneCore");
const {
  task07MediaValueFromReadyManifest,
} = require("../lib/mediaTargetAdapters");

const checksum = (value) => value.repeat(64).slice(0, 64);

const sourceFixture = () => {
  const sourcePlan = buildTask07MediaUploadPlan({
    actorUid: "dm-source",
    ownerUid: "dm-source",
    entityId: "foe-source",
    operationId: "foe_source_media_1234",
    kind: "foe",
    sourceContentType: "image/png",
    sourceBytes: 2048,
  });
  const generatedPlan = buildGeneratedMediaStoragePlan({
    kind: "foe",
    audienceScope: sourcePlan.audienceScope,
    ownerKey: sourcePlan.ownerKey,
    assetId: sourcePlan.assetId,
    sourceGeneration: "7",
  });
  const object = (role, path, index) => ({
    path,
    contentType: role === "original" ? "image/png" : "image/webp",
    bytes: role === "original" ? 2048 : 128 + index,
    width: role === "original" ? 640 : 96,
    height: role === "original" ? 480 : 96,
    durationMs: null,
    orientationDegrees: 0,
    checksum: checksum(String(index + 1)),
    role,
    generation: String(20 + index),
    cacheControl: "private, max-age=31536000, immutable",
  });
  const variants = Object.fromEntries(
    Object.entries(generatedPlan.variants).map(([role, path], index) => [
      role,
      object(role, path, index + 1),
    ])
  );
  const manifest = {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    policyVersion: MEDIA_CONTRACT_VERSION,
    assetId: sourcePlan.assetId,
    state: "attached",
    purpose: "foe",
    audience: sourcePlan.audienceScope,
    ownerUid: sourcePlan.ownerUid,
    actorUid: sourcePlan.actorUid,
    targetKind: "foe",
    targetId: "foe-source",
    previousAssetId: null,
    requestHash: sourcePlan.requestHash,
    plan: sourcePlan,
    generation: "7",
    attachment: {
      referencePath: "foes/foe-source",
      targetSlot: "media",
      revision: 2,
    },
    generated: {
      generation: "7",
      original: object("original", generatedPlan.originalPath, 0),
      variants,
    },
  };
  const media = task07MediaValueFromReadyManifest(manifest, sourcePlan);
  return {
    sourcePlan,
    manifest,
    source: {
      name: "Canonical foe",
      media,
      task07MediaRevision: 2,
      imagePath: generatedPlan.originalPath,
      imageUrl: "",
    },
  };
};

const buildClone = (fixture = sourceFixture()) => (
  buildTask07FoeMediaClonePlan({
    actorUid: "dm-destination",
    backendReceiptId: "a".repeat(48),
    destinationFoeId: "dup-destination",
    sourceFoeId: "foe-source",
    source: fixture.source,
    sourceManifest: fixture.manifest,
  })
);

test("canonical foe clone plans own a distinct complete media family", () => {
  const fixture = sourceFixture();
  const first = buildClone(fixture);
  const second = buildClone(fixture);

  assert.deepEqual(first, second);
  assert.notEqual(first.destinationAssetId, fixture.sourcePlan.assetId);
  assert.equal(first.destinationPlan.ownerUid, "dm-destination");
  assert.equal(first.destinationPlan.entityId, "dup-destination");
  assert.equal(first.destinationPlan.previousAssetId, null);
  assert.equal(first.destinationReferencePath, "foes/dup-destination");
  assert.deepEqual(
    first.entries.map(({role}) => role),
    ["original", "card", "card2x", "thumbnail", "thumbnail2x"]
  );
  first.entries.forEach((entry) => {
    assert.match(
      entry.destinationPath,
      new RegExp(`/dm-destination/${first.destinationAssetId}/7/`)
    );
    assert.notEqual(entry.destinationPath, entry.source.path);
  });
});

test("matching root and General descriptors resolve to one source asset", () => {
  const fixture = sourceFixture();
  fixture.source.General = {media: fixture.source.media};
  assert.equal(
    task07CanonicalFoeMediaAssetId(fixture.source),
    fixture.sourcePlan.assetId
  );
  assert.ok(buildClone(fixture));
});

test("nested foe clone plans bind a distinct destination entry and manifest", () => {
  const sourceNestedTarget = {
    schemaVersion: 1,
    kind: "foe-technique",
    entryId: "s".repeat(128),
    entryKey: null,
    entryIndex: 0,
    slot: "media",
  };
  const destinationNestedTarget = {
    ...sourceNestedTarget,
    entryId: "d".repeat(128),
  };
  const sourcePlan = buildTask07MediaUploadPlan({
    actorUid: "dm-source",
    ownerUid: "dm-source",
    entityId: "foe-source",
    operationId: "nested_source_media_1234",
    kind: "foe",
    nestedTarget: sourceNestedTarget,
    sourceContentType: "image/png",
    sourceBytes: 2048,
  });
  const storagePlan = buildGeneratedMediaStoragePlan({
    kind: "foe",
    audienceScope: sourcePlan.audienceScope,
    ownerKey: sourcePlan.ownerKey,
    assetId: sourcePlan.assetId,
    sourceGeneration: "9",
  });
  const object = (role, path, index) => ({
    path,
    contentType: role === "original" ? "image/png" : "image/webp",
    bytes: role === "original" ? 2048 : 140 + index,
    width: role === "original" ? 640 : 96,
    height: role === "original" ? 480 : 96,
    durationMs: null,
    orientationDegrees: 0,
    checksum: checksum(String(index + 4)),
    role,
    generation: String(30 + index),
    cacheControl: "private, max-age=31536000, immutable",
  });
  const variants = Object.fromEntries(
    Object.entries(storagePlan.variants).map(([role, path], index) => [
      role, object(role, path, index + 1),
    ])
  );
  const manifest = {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    policyVersion: MEDIA_CONTRACT_VERSION,
    assetId: sourcePlan.assetId,
    state: "attached",
    purpose: "foe",
    audience: sourcePlan.audienceScope,
    ownerUid: sourcePlan.ownerUid,
    actorUid: sourcePlan.actorUid,
    targetKind: "foe-technique",
    targetId: "foe-source",
    previousAssetId: null,
    requestHash: sourcePlan.requestHash,
    plan: sourcePlan,
    generation: "9",
    attachment: {
      referencePath: "foes/foe-source",
      targetSlot: "media",
      nestedTarget: sourceNestedTarget,
      revision: 1,
    },
    generated: {
      generation: "9",
      original: object("original", storagePlan.originalPath, 0),
      variants,
    },
  };
  const media = task07MediaValueFromReadyManifest(manifest, sourcePlan);
  const source = {
    tecniche: [{
      name: "Slash",
      task07MediaEntryId: sourceNestedTarget.entryId,
    }],
    task07EmbeddedMedia: {
      [sourceNestedTarget.entryId]: {
        targetKind: "foe-technique",
        media,
        task07MediaRevision: 1,
      },
    },
  };
  const clone = buildTask07FoeMediaClonePlan({
    actorUid: "dm-destination",
    backendReceiptId: "n".repeat(48),
    destinationFoeId: "dup-destination",
    sourceFoeId: "foe-source",
    source,
    sourceManifest: manifest,
    sourceNestedTarget,
    destinationNestedTarget,
  });
  assert.ok(clone);
  assert.deepEqual(clone.destinationPlan.nestedTarget,
    destinationNestedTarget);
  assert.equal(clone.destinationPlan.targetKind, "foe-technique");
  assert.ok(clone.mediaOperationId.length <= 128);
  assert.equal(clone.mediaOperationId.includes(sourceNestedTarget.entryId), false);
  assert.notEqual(clone.destinationAssetId, sourcePlan.assetId);
  assert.ok(clone.entries.every(({destinationPath}) =>
    destinationPath.includes(clone.destinationAssetId)));
});

test("legacy-only foes do not allocate a canonical clone", () => {
  assert.equal(buildTask07FoeMediaClonePlan({
    actorUid: "dm-destination",
    backendReceiptId: "b".repeat(48),
    destinationFoeId: "dup-legacy",
    sourceFoeId: "foe-legacy",
    source: {imagePath: "foes/legacy.png"},
    sourceManifest: null,
  }), null);
});

test("conflicting, detached, and unsupported foe media fail closed", () => {
  const conflict = sourceFixture();
  conflict.source.General = {
    media: {...conflict.source.media, assetId: `m_${"f".repeat(40)}`},
  };
  assert.throws(() => buildClone(conflict), /malformed or conflicting/);

  const revisionConflict = sourceFixture();
  revisionConflict.source.General = {
    media: {...revisionConflict.source.media},
    task07MediaRevision: 3,
  };
  assert.throws(
    () => buildClone(revisionConflict),
    /malformed or conflicting/
  );

  const detachedPath = sourceFixture();
  delete detachedPath.source.media;
  assert.throws(() => buildClone(detachedPath), /not backed/);

  const malformedPath = sourceFixture();
  malformedPath.source.imagePath = "media_assets/v1/dm-only/dm-source/bad";
  assert.throws(() => buildClone(malformedPath), /path is malformed/);

  const video = sourceFixture();
  video.source.videoMedia = video.source.media;
  assert.throws(() => buildClone(video), /video media is unsupported/);

  const staleDescriptor = sourceFixture();
  staleDescriptor.source.media = {
    ...staleDescriptor.source.media,
    generation: "999",
  };
  assert.throws(() => buildClone(staleDescriptor), /does not match/);

  const staleManifestIdentity = sourceFixture();
  staleManifestIdentity.manifest.targetId = "foe-other";
  assert.throws(() => buildClone(staleManifestIdentity), /invalid or incompatible/);
});

test("foe-token spawn regenerates a token-owned signed-in media family", () => {
  const fixture = sourceFixture();
  const input = {
    actorUid: "dm-destination",
    backendReceiptId: "c".repeat(48),
    destinationTokenId: "spawned-foe-token",
    sourceFoeId: "foe-source",
    source: fixture.source,
    sourceManifest: fixture.manifest,
  };
  const first = buildTask07FoeTokenMediaRegenerationPlan(input);
  const replay = buildTask07FoeTokenMediaRegenerationPlan(input);

  assert.ok(first);
  assert.deepEqual(first, replay);
  assert.equal(first.sourceAssetId, fixture.sourcePlan.assetId);
  assert.equal(
    first.sourceOriginal.path,
    fixture.manifest.generated.original.path
  );
  assert.equal(first.destinationPlan.kind, "token");
  assert.equal(first.destinationPlan.audienceScope, "signed-in");
  assert.equal(first.destinationPlan.ownerUid, "dm-destination");
  assert.equal(first.destinationPlan.entityId, "spawned-foe-token");
  assert.equal(
    first.destinationReferencePath,
    "grigliata_tokens/spawned-foe-token"
  );
  assert.notEqual(first.destinationPlan.assetId, fixture.sourcePlan.assetId);
  assert.equal(MEDIA_CONTRACTS.foe.variants.thumbnail.fit, "cover");
  assert.equal(MEDIA_CONTRACTS.token.variants.thumbnail.fit, "inside");
  assert.equal(task07FoeTokenMediaRegenerationPlansMatch(first, replay), true);
  assert.equal(task07FoeTokenMediaRegenerationPlansMatch(
    first,
    {...replay, sourceGeneration: "stale"}
  ), false);
});

test("foe-token regeneration inherits canonical source fail-closed checks", () => {
  const fixture = sourceFixture();
  fixture.manifest.attachment.referencePath = "foes/different-source";
  assert.throws(() => buildTask07FoeTokenMediaRegenerationPlan({
    actorUid: "dm-destination",
    backendReceiptId: "d".repeat(48),
    destinationTokenId: "spawned-foe-token",
    sourceFoeId: "foe-source",
    source: fixture.source,
    sourceManifest: fixture.manifest,
  }), /different target/);
});
