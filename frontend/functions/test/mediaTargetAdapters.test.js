const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTask07MediaUploadPlan,
} = require("../lib/mediaAssetLifecycleCore");
const {
  assertTask07TargetDocumentBudget,
  buildTask07NewTargetAttachment,
  task07TargetAttachmentPatch,
  validateTask07MediaTarget,
} = require("../lib/mediaTargetAdapters");

const buildPlan = ({
  kind,
  entityId = "entity-1",
  operationId,
  referenceScope,
}) => buildTask07MediaUploadPlan({
  actorUid: "owner-a",
  ownerUid: "owner-a",
  entityId,
  operationId,
  kind,
  sourceContentType: kind.endsWith("-video") ? "video/mp4" : "image/png",
  sourceBytes: 1024,
  ...(referenceScope ? {referenceScope} : {}),
});

const targetSnapshot = (path, data = {}) => {
  const parts = path.split("/");
  const collectionId = parts[parts.length - 2];
  const parentDocumentId = parts.length >= 4 ? parts[parts.length - 3] : null;
  return {
    exists: true,
    id: parts[parts.length - 1],
    ref: {
      path,
      parent: {
        id: collectionId,
        parent: parentDocumentId ? {id: parentDocumentId} : null,
      },
    },
    data: () => data,
  };
};

test("personal art and video attachment patches use independent CAS slots", () => {
  const technique = buildPlan({
    kind: "technique",
    operationId: "technique_patch_1234",
  });
  const techniqueVideo = buildPlan({
    kind: "technique-video",
    operationId: "technique_video_patch_1234",
  });
  const timestamp = {marker: "timestamp"};
  const artMedia = {assetId: technique.assetId, original: {path: "art"}};
  const videoMedia = {
    assetId: techniqueVideo.assetId,
    original: {path: "video"},
  };

  assert.deepEqual(task07TargetAttachmentPatch({
    media: artMedia,
    plan: technique,
    revision: 3,
    timestamp,
  }), {
    media: artMedia,
    task07MediaRevision: 3,
    mediaUpdatedAt: timestamp,
  });
  assert.deepEqual(task07TargetAttachmentPatch({
    media: videoMedia,
    plan: techniqueVideo,
    revision: 5,
    timestamp,
  }), {
    videoMedia,
    task07VideoMediaRevision: 5,
    videoMediaUpdatedAt: timestamp,
  });
});

test("authoritative attachments retain noncanonical legacy rollback references", () => {
  const foe = buildPlan({
    kind: "foe",
    operationId: "foe_legacy_reference_1234",
  });
  const timestamp = {marker: "timestamp"};
  const originalPath =
    `media_assets/v1/dm-only/owner-a/${foe.assetId}/7/original`;
  const media = {
    assetId: foe.assetId,
    original: {
      path: originalPath,
      width: 640,
      height: 480,
      bytes: 1024,
      contentType: "image/png",
    },
  };

  assert.deepEqual(task07TargetAttachmentPatch({
    current: {
      imageUrl: "https://legacy.example/foe.png",
      imagePath: "foes/legacy-foe.png",
    },
    media,
    plan: foe,
    revision: 2,
    timestamp,
  }), {
    media,
    task07MediaRevision: 2,
    mediaUpdatedAt: timestamp,
  });

  assert.deepEqual(task07TargetAttachmentPatch({
    current: {imageUrl: "", imagePath: ""},
    media,
    plan: foe,
    revision: 1,
    timestamp,
  }), {
    media,
    task07MediaRevision: 1,
    mediaUpdatedAt: timestamp,
    imagePath: originalPath,
    imageUrl: "",
  });
});

test("ready media can be attached while creating a new foe target", () => {
  const foe = buildPlan({
    kind: "foe",
    entityId: "new-foe",
    operationId: "foe_new_target_1234",
  });
  const generatedPath =
    `media_assets/v1/dm-only/owner-a/${foe.assetId}/7`;
  const stored = (role, path, index) => ({
    path,
    contentType: role === "original" ? "image/png" : "image/webp",
    bytes: 100 + index,
    width: 96,
    height: 96,
    durationMs: null,
    orientationDegrees: 0,
    checksum: String(index + 1).repeat(64).slice(0, 64),
    role,
    generation: String(10 + index),
    cacheControl: "private, max-age=31536000, immutable",
  });
  const assetData = {
    state: "ready",
    generated: {
      generation: "7",
      original: stored("original", `${generatedPath}/original`, 0),
      variants: {
        thumbnail: stored("thumbnail", `${generatedPath}/thumbnail`, 1),
        thumbnail2x: stored("thumbnail2x", `${generatedPath}/thumbnail2x`, 2),
        card: stored("card", `${generatedPath}/card`, 3),
        card2x: stored("card2x", `${generatedPath}/card2x`, 4),
      },
    },
  };
  const timestamp = {marker: "timestamp"};
  const canonicalOnly = buildTask07NewTargetAttachment({
    assetData,
    plan: foe,
    targetData: {name: "Clone", imagePath: "", imageUrl: ""},
    timestamp,
  });
  assert.equal(canonicalOnly.referencePath, "foes/new-foe");
  assert.equal(canonicalOnly.revision, 1);
  assert.equal(canonicalOnly.targetData.media.assetId, foe.assetId);
  assert.equal(canonicalOnly.targetData.task07MediaRevision, 1);
  assert.equal(
    canonicalOnly.targetData.imagePath,
    `${generatedPath}/original`
  );

  const dual = buildTask07NewTargetAttachment({
    assetData,
    plan: foe,
    targetData: {
      name: "Clone",
      imagePath: "foes/operations/receipt/main.png",
      imageUrl: "https://legacy.example/main.png",
    },
    timestamp,
  });
  assert.equal(dual.targetData.imagePath, "foes/operations/receipt/main.png");
  assert.equal(dual.targetData.imageUrl, "https://legacy.example/main.png");
});

test("map attachment keeps legacy dimensions together with its legacy source", () => {
  const map = buildPlan({
    kind: "map",
    operationId: "map_legacy_reference_1234",
  });
  const timestamp = {marker: "timestamp"};
  const media = {
    assetId: map.assetId,
    original: {
      path: `media_assets/v1/signed-in/owner-a/${map.assetId}/8/original`,
      width: 1920,
      height: 1080,
      bytes: 2048,
      contentType: "image/jpeg",
    },
  };

  const patch = task07TargetAttachmentPatch({
    current: {
      imageUrl: "https://legacy.example/map.jpg",
      imagePath: "grigliata/backgrounds/legacy-map.jpg",
      imageWidth: 800,
      imageHeight: 600,
      contentType: "image/jpeg",
      sizeBytes: 500,
      assetType: "image",
    },
    media,
    plan: map,
    revision: 4,
    timestamp,
  });

  assert.deepEqual(patch, {
    media,
    task07MediaRevision: 4,
    mediaUpdatedAt: timestamp,
  });
  assert.equal(Object.hasOwn(patch, "imageWidth"), false);
  assert.equal(Object.hasOwn(patch, "imagePath"), false);
});

test("target validation binds personal content to the owner subcollection", () => {
  const spell = buildPlan({
    kind: "spell",
    entityId: "spell-1",
    operationId: "spell_target_12345",
  });
  assert.doesNotThrow(() => validateTask07MediaTarget({
    plan: spell,
    target: targetSnapshot("users/owner-a/spells/spell-1", {id: "spell-1"}),
  }));
  assert.throws(() => validateTask07MediaTarget({
    plan: spell,
    target: targetSnapshot("users/other-a/spells/spell-1", {id: "spell-1"}),
  }), /target identity|ownership/);
  assert.throws(() => validateTask07MediaTarget({
    plan: spell,
    target: targetSnapshot("users/owner-a/tecniche/spell-1", {id: "spell-1"}),
  }), /target identity|collection/);
});

test("target validation rejects wrong global paths, token owners, and map purpose", () => {
  const npc = buildPlan({
    kind: "npc",
    entityId: "npc-1",
    operationId: "npc_target_123456",
  });
  const foe = buildPlan({
    kind: "foe",
    entityId: "foe-1",
    operationId: "foe_target_123456",
  });
  const catalog = buildPlan({
    kind: "item",
    entityId: "item-1",
    operationId: "item_target_12345",
    referenceScope: "global-catalog",
  });
  const token = buildPlan({
    kind: "token",
    entityId: "token-1",
    operationId: "token_target_1234",
  });
  const map = buildPlan({
    kind: "map",
    entityId: "map-1",
    operationId: "map_target_123456",
  });

  assert.doesNotThrow(() => validateTask07MediaTarget({
    plan: npc,
    target: targetSnapshot("echi_npcs/npc-1", {createdBy: "another-manager"}),
  }));
  assert.doesNotThrow(() => validateTask07MediaTarget({
    plan: foe,
    target: targetSnapshot("foes/foe-1"),
  }));
  assert.doesNotThrow(() => validateTask07MediaTarget({
    plan: catalog,
    target: targetSnapshot("items/item-1"),
  }));
  assert.throws(() => validateTask07MediaTarget({
    plan: npc,
    target: targetSnapshot("echi_npcs/npc-2"),
  }), /target identity/);
  assert.throws(() => validateTask07MediaTarget({
    plan: token,
    target: targetSnapshot("grigliata_tokens/token-1", {}),
  }), /Token target ownership/);
  assert.throws(() => validateTask07MediaTarget({
    plan: map,
    target: targetSnapshot("grigliata_backgrounds/map-1", {assetType: "video"}),
  }), /Background media purpose/);
  assert.doesNotThrow(() => validateTask07MediaTarget({
    plan: map,
    target: targetSnapshot("grigliata_backgrounds/map-1", {assetType: "image"}),
  }));
});

test("Task 07 personal attachments preserve Task 05 document budgets", () => {
  const technique = buildPlan({
    kind: "technique",
    operationId: "technique_budget_1234",
  });
  assert.doesNotThrow(() => assertTask07TargetDocumentBudget({
    current: {displayName: "Bounded technique"},
    patch: {media: {assetId: technique.assetId}},
    plan: technique,
  }));

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.throws(() => assertTask07TargetDocumentBudget({
      current: {oversized: "x".repeat(300 * 1024)},
      patch: {media: {assetId: technique.assetId}},
      plan: technique,
    }), /document-size budget/);
  } finally {
    console.warn = originalWarn;
  }
});
