const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTask07MediaUploadPlan,
  isTask07MediaRequestAuthorized,
  isTask07MediaRetirementAuthorized,
} = require("../lib/mediaAssetLifecycleCore");
const {
  assertTask07TargetDocumentBudget,
  buildTask07NewTargetAttachment,
  task07CanonicalRootRetirementPatch,
  task07CommonTechniqueRetirementPatch,
  task07FoeCanonicalMediaStateFromTarget,
  task07FoeCanonicalRetirementPatch,
  task07MediaTargetState,
  task07NestedMediaTargetEntryExists,
  task07NestedMediaRetirementPatch,
  task07TargetAttachmentPatch,
  validateTask07MediaTarget,
} = require("../lib/mediaTargetAdapters");
const {DocumentMask} = require("@google-cloud/firestore/build/src/document");

const mergeMaskPaths = (value) => new Set(
  DocumentMask.fromObject(value).toProto().fieldPaths || []
);

const buildPlan = ({
  kind,
  entityId = "entity-1",
  operationId,
  referenceScope,
  commonTechnique = false,
  nestedTarget,
}) => buildTask07MediaUploadPlan({
  actorUid: "owner-a",
  ownerUid: "owner-a",
  entityId,
  operationId,
  kind,
  sourceContentType: kind.endsWith("-video") ? "video/mp4" : "image/png",
  sourceBytes: 1024,
  ...(commonTechnique ? {commonTechnique: true} : {}),
  ...(nestedTarget ? {nestedTarget} : {}),
  ...(referenceScope ? {referenceScope} : {}),
});

test("nested catalog spell media attaches through a frozen parent registry", () => {
  const nestedTarget = {
    schemaVersion: 1,
    kind: "catalog-item-spell",
    entryId: "spell-entry-1",
    entryKey: "Afferra",
    entryIndex: null,
    slot: "media",
  };
  const plan = buildPlan({
    kind: "spell",
    entityId: "item-1",
    operationId: "nested_catalog_1234",
    referenceScope: "global-catalog",
    nestedTarget,
  });
  const current = {
    General: {spells: {Afferra: {Nome: "Afferra", image_url: "legacy/a"}}},
  };
  const timestamp = {marker: "timestamp"};
  const media = {assetId: plan.assetId, original: {path: "canonical/a"}};
  const patch = task07TargetAttachmentPatch({
    current,
    media,
    plan,
    revision: 1,
    timestamp,
  });

  assert.equal(
    patch.General.spells.Afferra.task07MediaEntryId,
    nestedTarget.entryId
  );
  assert.equal(patch.General.spells.Afferra.media, undefined);
  assert.deepEqual(patch.task07EmbeddedMedia[nestedTarget.entryId], {
    targetKind: "catalog-item-spell",
    media,
    task07MediaRevision: 1,
    mediaUpdatedAt: timestamp,
  });
  assert.deepEqual(task07MediaTargetState({...current, ...patch}, plan), {
    assetId: plan.assetId,
    revision: 1,
    conflict: false,
  });

  const renamed = {
    ...current,
    ...patch,
    General: {
      ...patch.General,
      spells: {Presa: patch.General.spells.Afferra},
    },
  };
  assert.deepEqual(task07MediaTargetState(renamed, plan), {
    assetId: plan.assetId,
    revision: 1,
    conflict: false,
  });
  const retired = task07NestedMediaRetirementPatch({
    current: renamed,
    plan,
    revision: 1,
    timestamp,
  });
  assert.equal(retired.General.spells.Presa.task07MediaEntryId, "spell-entry-1");
  assert.equal(retired.task07EmbeddedMedia["spell-entry-1"].media, undefined);
  assert.equal(
    retired.task07EmbeddedMedia["spell-entry-1"].task07MediaRevision,
    2
  );
});

test("nested foe targets survive reordering and reject duplicate identities", () => {
  const nestedTarget = {
    schemaVersion: 1,
    kind: "foe-technique",
    entryId: "foe-tech-1",
    entryKey: null,
    entryIndex: 0,
    slot: "media",
  };
  const plan = buildPlan({
    kind: "foe",
    entityId: "foe-1",
    operationId: "nested_foe_12345",
    nestedTarget,
  });
  const timestamp = {marker: "timestamp"};
  const media = {assetId: plan.assetId, original: {path: "canonical/t"}};
  const current = {tecniche: [{Nome: "First"}, {Nome: "Second"}]};
  const patch = task07TargetAttachmentPatch({
    current,
    media,
    plan,
    revision: 1,
    timestamp,
  });
  const reordered = {
    ...current,
    ...patch,
    tecniche: [patch.tecniche[1], patch.tecniche[0]],
  };
  assert.deepEqual(task07MediaTargetState(reordered, plan), {
    assetId: plan.assetId,
    revision: 1,
    conflict: false,
  });
  const duplicated = {
    ...reordered,
    tecniche: [reordered.tecniche[1], {...reordered.tecniche[1]}],
  };
  assert.equal(task07MediaTargetState(duplicated, plan).conflict, true);

  const removed = {...reordered, tecniche: []};
  assert.equal(task07NestedMediaTargetEntryExists(removed, plan), false);
  assert.deepEqual(task07MediaTargetState(removed, plan), {
    assetId: plan.assetId,
    revision: 1,
    conflict: false,
  });
  const retiredAfterRemoval = task07NestedMediaRetirementPatch({
    current: removed,
    plan,
    revision: 1,
    timestamp,
  });
  assert.equal(retiredAfterRemoval.task07EmbeddedMedia["foe-tech-1"].media,
    undefined);
  assert.deepEqual(retiredAfterRemoval.tecniche, undefined);
});

test("catalog spell lifecycle is manager-only while foe nesting keeps manager ownership", () => {
  const base = {
    kind: "spell",
    actorUid: "owner-a",
    ownerUid: "owner-a",
    referenceScope: "global-catalog",
    targetKind: "catalog-item-spell",
  };
  assert.equal(isTask07MediaRequestAuthorized({...base, actorRole: "player"}), false);
  assert.equal(isTask07MediaRequestAuthorized({...base, actorRole: "dm"}), true);
  assert.equal(isTask07MediaRetirementAuthorized({...base, actorRole: "player"}), false);
  assert.equal(isTask07MediaRetirementAuthorized({...base, actorRole: "webmaster"}), true);
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

test("root attachment and retirement normalize General canonical fallbacks", () => {
  const item = buildPlan({
    kind: "item",
    operationId: "catalog_general_media_1234",
    referenceScope: "global-catalog",
  });
  const video = buildPlan({
    kind: "technique-video",
    operationId: "personal_general_video_1234",
  });
  const previousAssetId = `m_${"a".repeat(40)}`;
  const timestamp = {marker: "timestamp"};
  const current = {
    task07MediaRevision: 4,
    General: {
      label: "preserved",
      media: {assetId: previousAssetId},
      task07MediaRevision: 4,
      mediaUpdatedAt: {marker: "old"},
    },
  };
  assert.deepEqual(task07MediaTargetState(current, item), {
    assetId: previousAssetId,
    revision: 4,
    conflict: false,
  });

  const media = {assetId: item.assetId, original: {path: "canonical/item"}};
  const patch = task07TargetAttachmentPatch({
    current,
    media,
    normalizeCanonicalRoot: true,
    plan: item,
    revision: 5,
    timestamp,
  });
  assert.equal(patch.media, media);
  assert.equal(patch.task07MediaRevision, 5);
  for (const field of [
    "General.media",
    "General.task07MediaRevision",
    "General.mediaUpdatedAt",
  ]) {
    assert.equal(Object.hasOwn(patch, field), true, field);
  }
  assert.deepEqual(task07MediaTargetState({
    media,
    task07MediaRevision: 5,
    General: {label: "preserved"},
  }, item), {
    assetId: item.assetId,
    revision: 5,
    conflict: false,
  });

  const retired = task07CanonicalRootRetirementPatch({
    current: {
      General: current.General,
      media,
      task07MediaRevision: 5,
    },
    plan: item,
    revision: 5,
    timestamp,
  });
  assert.equal(retired.task07MediaRevision, 6);
  assert.equal(retired.mediaUpdatedAt, timestamp);
  for (const field of [
    "media",
    "General.media",
    "General.task07MediaRevision",
    "General.mediaUpdatedAt",
  ]) {
    assert.equal(Object.hasOwn(retired, field), true, field);
  }

  const retiredVideo = task07CanonicalRootRetirementPatch({
    current: {
      General: {
        videoMedia: {assetId: video.assetId},
        task07VideoMediaRevision: 2,
      },
    },
    plan: video,
    revision: 2,
    timestamp,
  });
  assert.equal(retiredVideo.task07VideoMediaRevision, 3);
  for (const field of [
    "videoMedia",
    "General.videoMedia",
    "General.task07VideoMediaRevision",
    "General.videoMediaUpdatedAt",
  ]) {
    assert.equal(Object.hasOwn(retiredVideo, field), true, field);
  }
});

test("common technique mutations normalize General canonical fallbacks", () => {
  const plan = buildPlan({
    kind: "technique",
    entityId: "tecnica-general",
    operationId: "common_general_media_1234",
    commonTechnique: true,
  });
  const previousAssetId = `m_${"b".repeat(40)}`;
  const timestamp = {marker: "timestamp"};
  const current = {
    "tecnica-general": {
      label: "Tecnica General",
      task07MediaRevision: 2,
      General: {
        label: "preserved",
        media: {assetId: previousAssetId},
        task07MediaRevision: 2,
        mediaUpdatedAt: {marker: "old"},
      },
    },
  };
  const media = {assetId: plan.assetId, original: {path: "canonical/common"}};
  const patch = task07TargetAttachmentPatch({
    current,
    media,
    plan,
    revision: 3,
    timestamp,
  });
  assert.equal(patch["tecnica-general"].General.label, "preserved");
  assert.equal(patch["tecnica-general"].media, media);
  assert.equal(patch["tecnica-general"].task07MediaRevision, 3);
  const attachmentMask = mergeMaskPaths(patch);
  for (const path of [
    "`tecnica-general`.media.assetId",
    "`tecnica-general`.General.media",
    "`tecnica-general`.General.task07MediaRevision",
    "`tecnica-general`.General.mediaUpdatedAt",
  ]) {
    assert.equal(attachmentMask.has(path), true, path);
  }

  const retired = task07CommonTechniqueRetirementPatch({
    current: {...current, ...patch},
    plan,
    revision: 3,
    timestamp,
  });
  assert.equal(retired["tecnica-general"].General.label, "preserved");
  assert.equal(Object.hasOwn(retired["tecnica-general"], "media"), true);
  assert.equal(retired["tecnica-general"].task07MediaRevision, 4);
  const retirementMask = mergeMaskPaths(retired);
  for (const path of [
    "`tecnica-general`.media",
    "`tecnica-general`.General.media",
    "`tecnica-general`.General.task07MediaRevision",
    "`tecnica-general`.General.mediaUpdatedAt",
  ]) {
    assert.equal(retirementMask.has(path), true, path);
  }
});

test("common technique patches preserve legacy fields and sibling entries", () => {
  const art = buildPlan({
    kind: "technique",
    entityId: "tecnica-a",
    operationId: "common_technique_art_1234",
    commonTechnique: true,
  });
  const video = buildPlan({
    kind: "technique-video",
    entityId: "tecnica-a",
    operationId: "common_technique_video_1234",
    commonTechnique: true,
  });
  const timestamp = {marker: "timestamp"};
  const current = {
    "tecnica-a": {
      label: "Tecnica A",
      image_url: "legacy/tecnica-a.png",
      video_url: "legacy/tecnica-a.mp4",
      videoMedia: {assetId: video.assetId},
      task07VideoMediaRevision: 2,
    },
    "tecnica-b": {label: "Tecnica B", image_url: "legacy/b.png"},
  };
  const media = {assetId: art.assetId, original: {path: "canonical/art"}};
  const patch = task07TargetAttachmentPatch({
    current,
    media,
    plan: art,
    revision: 3,
    timestamp,
  });

  assert.deepEqual(patch, {
    "tecnica-a": {
      ...current["tecnica-a"],
      media,
      task07MediaRevision: 3,
      mediaUpdatedAt: timestamp,
    },
  });
  assert.equal(Object.hasOwn(patch, "tecnica-b"), false);
  assert.deepEqual(task07MediaTargetState({...current, ...patch}, art), {
    assetId: art.assetId,
    revision: 3,
    conflict: false,
  });
  assert.deepEqual(task07MediaTargetState({...current, ...patch}, video), {
    assetId: video.assetId,
    revision: 2,
    conflict: false,
  });

  const retired = task07CommonTechniqueRetirementPatch({
    current: {...current, ...patch},
    plan: art,
    revision: 3,
    timestamp,
  });
  assert.equal(Object.hasOwn(retired["tecnica-a"], "media"), true);
  assert.equal(retired["tecnica-a"].image_url, "legacy/tecnica-a.png");
  assert.equal(retired["tecnica-a"].video_url, "legacy/tecnica-a.mp4");
  assert.equal(retired["tecnica-a"].videoMedia.assetId, video.assetId);
  assert.equal(retired["tecnica-a"].task07MediaRevision, 4);
  assert.equal(Object.hasOwn(retired, "tecnica-b"), false);
});

test("common technique validation binds an exact nested entry in utils", () => {
  const plan = buildPlan({
    kind: "technique",
    entityId: "tecnica-a",
    operationId: "common_technique_target_1234",
    commonTechnique: true,
  });
  assert.doesNotThrow(() => validateTask07MediaTarget({
    plan,
    target: targetSnapshot("utils/tecniche_common", {
      "tecnica-a": {image_url: "legacy/a.png"},
    }),
  }));
  assert.throws(() => validateTask07MediaTarget({
    plan,
    target: targetSnapshot("utils/tecniche_common", {
      "tecnica-b": {image_url: "legacy/b.png"},
    }),
  }), /missing/);
  assert.throws(() => validateTask07MediaTarget({
    plan,
    target: targetSnapshot("utils/other", {
      "tecnica-a": {image_url: "legacy/a.png"},
    }),
  }), /identity/);
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
    normalizeCanonicalRoot: true,
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
    normalizeCanonicalRoot: true,
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
    normalizeCanonicalRoot: true,
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
    normalizeCanonicalRoot: true,
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
    normalizeCanonicalRoot: true,
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
    normalizeCanonicalRoot: true,
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
    normalizeCanonicalRoot: true,
    plan: map,
    revision: 4,
    timestamp,
  });

  assert.equal(patch.media, media);
  assert.equal(patch.task07MediaRevision, 4);
  assert.equal(patch.mediaUpdatedAt, timestamp);
  assert.deepEqual(Object.keys(patch).sort(), [
    "media",
    "task07MediaRevision",
    "mediaUpdatedAt",
  ].sort());
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
    target: targetSnapshot("grigliata_backgrounds/map-1"),
  }));
  assert.doesNotThrow(() => validateTask07MediaTarget({
    plan: map,
    target: targetSnapshot("grigliata_backgrounds/map-1", {assetType: "image"}),
  }));
});

test("music targets bind the global track and refresh canonical audio metadata", () => {
  const music = buildTask07MediaUploadPlan({
    actorUid: "owner-a",
    ownerUid: "owner-a",
    entityId: "track-1",
    operationId: "music_target_123456",
    kind: "music",
    sourceContentType: "audio/mpeg",
    sourceBytes: 1024,
  });
  assert.doesNotThrow(() => validateTask07MediaTarget({
    plan: music,
    target: targetSnapshot("grigliata_music_tracks/track-1", {
      contentType: "audio/mpeg",
    }),
  }));
  assert.throws(() => validateTask07MediaTarget({
    plan: music,
    target: targetSnapshot("grigliata_music_tracks/track-1", {
      contentType: "audio/ogg",
    }),
  }), /Music track media purpose/);
  assert.throws(() => validateTask07MediaTarget({
    plan: music,
    target: targetSnapshot("grigliata_music_tracks/track-2", {
      contentType: "audio/mpeg",
    }),
  }), /target identity/);

  const timestamp = {marker: "timestamp"};
  const media = {
    assetId: music.assetId,
    original: {
      path: `media_assets/v1/signed-in/owner-a/${music.assetId}/7/original`,
      contentType: "audio/mpeg",
      bytes: 4096,
      durationMs: 12345,
    },
  };
  assert.deepEqual(task07TargetAttachmentPatch({
    current: {
      audioPath: "grigliata/music/owner-a/legacy.mp3",
      audioUrl: "https://legacy.example/track.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 1024,
      durationMs: 12000,
    },
    media,
    plan: music,
    revision: 2,
    timestamp,
  }), {
    media,
    task07MediaRevision: 2,
    mediaUpdatedAt: timestamp,
    contentType: "audio/mpeg",
    sizeBytes: 4096,
    durationMs: 12345,
  });
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
