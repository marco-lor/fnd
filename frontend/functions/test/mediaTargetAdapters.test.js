const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTask07MediaUploadPlan,
} = require("../lib/mediaAssetLifecycleCore");
const {
  assertTask07TargetDocumentBudget,
  buildTask07NewTargetAttachment,
  task07FoeCanonicalMediaStateFromTarget,
  task07FoeCanonicalRetirementPatch,
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

test("foe media state normalizes root-only, General-only, and exact mirrors", () => {
  const assetId = `m_${"a".repeat(40)}`;
  const media = {
    assetId,
    state: "ready",
    original: {path: "media/original.png", width: 96},
  };

  assert.deepEqual(task07FoeCanonicalMediaStateFromTarget({
    media,
    task07MediaRevision: 4,
  }), {assetId, revision: 4, conflict: false});
  assert.deepEqual(task07FoeCanonicalMediaStateFromTarget({
    General: {media, task07MediaRevision: 99},
  }), {assetId, revision: 0, conflict: false});
  assert.deepEqual(task07FoeCanonicalMediaStateFromTarget({
    media,
    task07MediaRevision: 7,
    General: {
      media: JSON.parse(JSON.stringify(media)),
      task07MediaRevision: 7,
    },
  }), {assetId, revision: 7, conflict: false});
});

test("foe media state rejects descriptor and explicit revision conflicts", () => {
  const firstAssetId = `m_${"b".repeat(40)}`;
  const secondAssetId = `m_${"c".repeat(40)}`;
  const media = {
    assetId: firstAssetId,
    state: "ready",
    original: {path: "media/original.png", width: 96},
  };
  const conflictCases = [
    {
      media,
      General: {
        media: {...media, original: {...media.original, width: 192}},
      },
    },
    {
      media,
      General: {media: {...media, assetId: secondAssetId}},
    },
    {
      media,
      task07MediaRevision: 2,
      General: {
        media: JSON.parse(JSON.stringify(media)),
        task07MediaRevision: 3,
      },
    },
  ];

  conflictCases.forEach((target) => {
    const state = task07FoeCanonicalMediaStateFromTarget(target);
    assert.equal(state.conflict, true);
    assert.equal(state.assetId, null);
  });
});

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

test("foe replacement normalizes nested media and legacy aliases only", () => {
  const foe = buildPlan({
    kind: "foe",
    operationId: "foe_normalize_reference_1234",
  });
  const timestamp = {marker: "timestamp"};
  const media = {
    assetId: foe.assetId,
    original: {path: "media/new-original.png"},
  };
  const patch = task07TargetAttachmentPatch({
    current: {
      imagePath: "foes/legacy.png",
      imageUrl: "https://legacy.example/foe.png",
    },
    media,
    normalizeFoeCanonicalRoot: true,
    plan: foe,
    revision: 5,
    timestamp,
  });

  assert.equal(patch.media, media);
  assert.equal(patch.task07MediaRevision, 5);
  assert.equal(patch.imagePath, "foes/legacy.png");
  assert.equal(patch.imageUrl, "https://legacy.example/foe.png");
  for (const field of [
    "image_url",
    "url",
    "downloadUrl",
    "General.media",
    "General.mediaUpdatedAt",
    "General.task07MediaRevision",
    "General.imagePath",
    "General.imageUrl",
    "General.image_url",
    "General.url",
    "General.downloadUrl",
  ]) {
    assert.equal(Object.hasOwn(patch, field), true, field);
  }
  assert.equal(Object.hasOwn(patch, "General.videoMedia"), false);
  assert.equal(Object.hasOwn(patch, "General.label"), false);
});

test("foe replacement promotes a General legacy fallback when root is absent", () => {
  const foe = buildPlan({
    kind: "foe",
    operationId: "foe_promote_general_fallback_1234",
  });
  const timestamp = {marker: "timestamp"};
  const media = {
    assetId: foe.assetId,
    original: {path: "media/new-original.png"},
  };
  const patch = task07TargetAttachmentPatch({
    current: {
      General: {
        imagePath: "foes/general-legacy.png",
        imageUrl: "https://legacy.example/general-legacy.png",
        image_url: "https://canonical.example/do-not-promote.png",
        label: "preserved",
      },
    },
    media,
    normalizeFoeCanonicalRoot: true,
    plan: foe,
    revision: 3,
    timestamp,
  });

  assert.equal(patch.imagePath, "foes/general-legacy.png");
  assert.equal(
    patch.imageUrl,
    "https://legacy.example/general-legacy.png"
  );
  assert.equal(Object.hasOwn(patch, "General.imagePath"), true);
  assert.equal(Object.hasOwn(patch, "General.imageUrl"), true);
  assert.equal(Object.hasOwn(patch, "General.image_url"), true);
  assert.equal(Object.hasOwn(patch, "General.label"), false);
});

test("foe replacement keeps root image aliases authoritative", () => {
  const foe = buildPlan({
    kind: "foe",
    operationId: "foe_root_alias_precedence_1234",
  });
  const timestamp = {marker: "timestamp"};
  const newOriginalPath =
    `media_assets/v1/dm-only/owner-a/${foe.assetId}/7/original`;
  const media = {
    assetId: foe.assetId,
    original: {path: newOriginalPath},
  };
  const generalFallback = {
    imagePath: "foes/general-legacy.png",
    imageUrl: "https://legacy.example/general-legacy.png",
  };
  const legacyRootPatch = task07TargetAttachmentPatch({
    current: {
      imagePath: "foes/root-legacy.png",
      imageUrl: "https://legacy.example/root-legacy.png",
      General: generalFallback,
    },
    media,
    normalizeFoeCanonicalRoot: true,
    plan: foe,
    revision: 4,
    timestamp,
  });
  assert.equal(legacyRootPatch.imagePath, "foes/root-legacy.png");
  assert.equal(
    legacyRootPatch.imageUrl,
    "https://legacy.example/root-legacy.png"
  );

  const canonicalRootPatch = task07TargetAttachmentPatch({
    current: {
      imagePath:
        `media_assets/v1/dm-only/owner-a/m_${"d".repeat(40)}/6/original`,
      imageUrl: "",
      General: generalFallback,
    },
    media,
    normalizeFoeCanonicalRoot: true,
    plan: foe,
    revision: 4,
    timestamp,
  });
  assert.equal(canonicalRootPatch.imagePath, generalFallback.imagePath);
  assert.equal(canonicalRootPatch.imageUrl, generalFallback.imageUrl);

  const oldCanonicalPath =
    `media_assets/v1/dm-only/owner-a/m_${"e".repeat(40)}/6/original`;
  const canonicalUrlPatch = task07TargetAttachmentPatch({
    current: {
      imagePath: oldCanonicalPath,
      imageUrl:
        `https://firebasestorage.googleapis.com/v0/b/demo/o/` +
        `${encodeURIComponent(oldCanonicalPath)}?alt=media`,
      General: generalFallback,
    },
    media,
    normalizeFoeCanonicalRoot: true,
    plan: foe,
    revision: 4,
    timestamp,
  });
  assert.equal(canonicalUrlPatch.imagePath, generalFallback.imagePath);
  assert.equal(canonicalUrlPatch.imageUrl, generalFallback.imageUrl);
});

test("foe replacement does not promote General canonical-only aliases", () => {
  const foe = buildPlan({
    kind: "foe",
    operationId: "foe_ignore_general_canonical_1234",
  });
  const timestamp = {marker: "timestamp"};
  const newOriginalPath =
    `media_assets/v1/dm-only/owner-a/${foe.assetId}/7/original`;
  const patch = task07TargetAttachmentPatch({
    current: {
      General: {
        imagePath:
          `media_assets/v1/dm-only/owner-a/m_${"e".repeat(40)}/6/original`,
        imageUrl: "",
        image_url: "https://canonical.example/alternate.png",
        url: "https://canonical.example/source.png",
        downloadUrl: "https://canonical.example/download.png",
      },
    },
    media: {
      assetId: foe.assetId,
      original: {path: newOriginalPath},
    },
    normalizeFoeCanonicalRoot: true,
    plan: foe,
    revision: 5,
    timestamp,
  });

  assert.equal(patch.imagePath, newOriginalPath);
  assert.equal(patch.imageUrl, "");
});

test("foe retirement clears canonical controls and every image alias", () => {
  const timestamp = {marker: "timestamp"};
  const patch = task07FoeCanonicalRetirementPatch({
    revision: 8,
    timestamp,
  });

  assert.equal(patch.task07MediaRevision, 9);
  assert.equal(patch.mediaUpdatedAt, timestamp);
  for (const field of [
    "media",
    "imagePath",
    "imageUrl",
    "image_url",
    "url",
    "downloadUrl",
    "General.media",
    "General.mediaUpdatedAt",
    "General.task07MediaRevision",
    "General.imagePath",
    "General.imageUrl",
    "General.image_url",
    "General.url",
    "General.downloadUrl",
  ]) {
    assert.equal(Object.hasOwn(patch, field), true, field);
  }
  assert.equal(Object.hasOwn(patch, "videoMedia"), false);
  assert.equal(Object.hasOwn(patch, "General.videoMedia"), false);
  assert.equal(Object.hasOwn(patch, "General.label"), false);
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
    targetData: {
      name: "Clone",
      imagePath: "",
      imageUrl: "",
      General: {label: "preserved"},
    },
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
  assert.deepEqual(canonicalOnly.targetData.General, {label: "preserved"});
  assert.equal(
    Object.keys(canonicalOnly.targetData).some((field) => field.includes(".")),
    false
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
    normalizeFoeCanonicalRoot: true,
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
