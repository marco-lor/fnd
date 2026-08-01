const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MEDIA_CONTRACTS,
  MEDIA_PRIVATE_CACHE_CONTROL,
  MEDIA_STAGING_CACHE_CONTROL,
  buildGeneratedMediaStoragePlan,
  buildTask07StagingPath,
  parseCanonicalMediaPath,
  parseTask07StagingPath,
  plannedMediaVariantDimensions,
} = require("../lib/mediaContracts");
const {
  asStoredTask07MediaUploadPlan,
  buildTask07MediaUploadPlan,
  isTask07CleanupQueueClaimable,
  isTask07MediaRequestAuthorized,
  isTask07MediaRetirementAuthorized,
  isTask07MediaStateAbandonable,
  isTask07MediaStateCleanupEligible,
  isTask07MediaStateManualCleanupRetryable,
  partitionTask07CleanupSweepRecords,
  task07MediaReferencePath,
  task07MediaTargetFields,
} = require("../lib/mediaAssetLifecycleCore");

test("Task 07 policy exposes the exact version-one purpose set", () => {
  assert.deepEqual(Object.keys(MEDIA_CONTRACTS).sort(), [
    "avatar",
    "foe",
    "item",
    "map",
    "map-video",
    "music",
    "npc",
    "spell",
    "spell-video",
    "technique",
    "technique-video",
    "token",
  ]);
  assert.deepEqual(
    Object.keys(MEDIA_CONTRACTS.avatar.variants),
    ["thumbnail", "thumbnail2x", "card"]
  );
  assert.deepEqual(
    Object.keys(MEDIA_CONTRACTS.map.variants),
    ["gallery", "gallery2x"]
  );
  assert.deepEqual(
    Object.keys(MEDIA_CONTRACTS["map-video"].variants),
    ["poster", "poster2x"]
  );
  assert.match(MEDIA_PRIVATE_CACHE_CONTROL, /^private,/);
  assert.equal(MEDIA_STAGING_CACHE_CONTROL, "private, no-store");
});

test("cover variants preserve Sharp no-enlargement dimensions", () => {
  const contract = MEDIA_CONTRACTS.avatar.variants.thumbnail2x;
  assert.deepEqual(
    plannedMediaVariantDimensions({width: 96, height: 96}, contract),
    {width: 96, height: 96}
  );
  assert.deepEqual(
    plannedMediaVariantDimensions({width: 200, height: 50}, contract),
    {width: 128, height: 50}
  );
  assert.deepEqual(
    plannedMediaVariantDimensions({width: 50, height: 200}, contract),
    {width: 50, height: 128}
  );
});

test("prepare plans bind exact bytes and expose only one staging source", () => {
  const input = {
    actorUid: "user-a",
    ownerUid: "user-a",
    entityId: "user-a",
    operationId: "upload_12345678",
    kind: "avatar",
    sourceContentType: "image/png",
    sourceBytes: 1024,
  };
  const plan = buildTask07MediaUploadPlan(input);
  assert.deepEqual(plan, buildTask07MediaUploadPlan(input));
  assert.equal(Object.hasOwn(plan, "commonTechnique"), false);
  assert.deepEqual(asStoredTask07MediaUploadPlan(plan), plan);
  assert.equal(
    plan.sourcePath,
    buildTask07StagingPath(plan.ownerUid, plan.assetId)
  );
  assert.equal(plan.originalPath, plan.sourcePath);
  assert.deepEqual(plan.variants, {});
  assert.equal(plan.passthrough, false);
  assert.deepEqual(parseTask07StagingPath(plan.sourcePath), {
    ownerUid: plan.ownerUid,
    assetId: plan.assetId,
    path: plan.sourcePath,
  });
  assert.equal(parseCanonicalMediaPath(plan.sourcePath), null);
});

test("prepare rejects unsupported formats, imprecise bytes, and missing adapters", () => {
  const base = {
    actorUid: "user-a",
    ownerUid: "user-a",
    entityId: "user-a",
    operationId: "upload_12345678",
    kind: "avatar",
    sourceContentType: "image/png",
    sourceBytes: 1024,
  };
  assert.throws(
    () => buildTask07MediaUploadPlan({...base, entityId: "other-profile"}),
    /must target its owner profile/
  );
  assert.throws(
    () => buildTask07MediaUploadPlan({
      ...base,
      sourceContentType: "image/gif",
    }),
    /Unsupported avatar media type/
  );
  assert.throws(
    () => buildTask07MediaUploadPlan({...base, sourceBytes: 0}),
    /identity is invalid/
  );
  assert.throws(
    () => buildTask07MediaUploadPlan({
      ...base,
      sourceBytes: MEDIA_CONTRACTS.avatar.source.maxBytes + 1,
    }),
    /source byte budget/
  );
  const music = buildTask07MediaUploadPlan({
    ...base,
    operationId: "music_track_upload_1234",
    kind: "music",
    sourceContentType: "audio/mpeg",
    entityId: "track",
  });
  assert.equal(music.targetKind, "grigliata-music-track");
  assert.equal(music.audienceScope, "signed-in");
  assert.equal(
    task07MediaReferencePath(music),
    "grigliata_music_tracks/track"
  );
});

test("personal technique and spell plans bind separate art and video slots", () => {
  const base = {
    actorUid: "owner-a",
    ownerUid: "owner-a",
    entityId: "content-1",
    sourceBytes: 1024,
  };
  const technique = buildTask07MediaUploadPlan({
    ...base,
    operationId: "technique_art_1234",
    kind: "technique",
    sourceContentType: "image/png",
  });
  const techniqueVideo = buildTask07MediaUploadPlan({
    ...base,
    operationId: "technique_video_1234",
    kind: "technique-video",
    sourceContentType: "video/mp4",
  });
  const spell = buildTask07MediaUploadPlan({
    ...base,
    operationId: "spell_art_12345678",
    kind: "spell",
    sourceContentType: "image/webp",
  });
  const spellVideo = buildTask07MediaUploadPlan({
    ...base,
    operationId: "spell_video_123456",
    kind: "spell-video",
    sourceContentType: "video/webm",
  });

  assert.equal(technique.targetKind, "user-technique");
  assert.equal(technique.audienceScope, "owner-manager");
  assert.equal(
    task07MediaReferencePath(technique),
    "users/owner-a/tecniche/content-1"
  );
  assert.deepEqual(task07MediaTargetFields(technique), {
    slot: "media",
    mediaField: "media",
    revisionField: "task07MediaRevision",
    updatedAtField: "mediaUpdatedAt",
  });
  assert.equal(techniqueVideo.targetKind, "user-technique");
  assert.deepEqual(task07MediaTargetFields(techniqueVideo), {
    slot: "videoMedia",
    mediaField: "videoMedia",
    revisionField: "task07VideoMediaRevision",
    updatedAtField: "videoMediaUpdatedAt",
  });
  assert.equal(spell.targetKind, "user-spell");
  assert.equal(
    task07MediaReferencePath(spellVideo),
    "users/owner-a/spells/content-1"
  );
  assert.equal(task07MediaTargetFields(spell).slot, "media");
  assert.equal(task07MediaTargetFields(spellVideo).slot, "videoMedia");
});

test("common technique plans bind nested map identity and signed-in slots", () => {
  const base = {
    actorUid: "webmaster-a",
    ownerUid: "webmaster-a",
    entityId: "tecnica-comune-a",
    commonTechnique: true,
    sourceBytes: 1024,
  };
  const art = buildTask07MediaUploadPlan({
    ...base,
    operationId: "common_technique_art_1234",
    kind: "technique",
    sourceContentType: "image/png",
  });
  const video = buildTask07MediaUploadPlan({
    ...base,
    operationId: "common_technique_video_1234",
    kind: "technique-video",
    sourceContentType: "video/mp4",
  });

  assert.equal(art.targetKind, "common-technique");
  assert.equal(video.targetKind, "common-technique");
  assert.equal(art.commonTechnique, true);
  assert.equal(art.audienceScope, "signed-in");
  assert.equal(video.audienceScope, "signed-in");
  assert.equal(task07MediaReferencePath(art), "utils/tecniche_common");
  assert.equal(task07MediaReferencePath(video), "utils/tecniche_common");
  assert.equal(task07MediaTargetFields(art).slot, "media");
  assert.equal(task07MediaTargetFields(video).slot, "videoMedia");
  assert.notEqual(art.requestHash, video.requestHash);
  assert.throws(() => buildTask07MediaUploadPlan({
    ...base,
    operationId: "common_spell_invalid_1234",
    kind: "spell",
    sourceContentType: "image/png",
  }), /identity is invalid/);
});

test("personal content authorization matches the Task 05 owner/manager boundary", () => {
  const base = {
    kind: "spell",
    ownerUid: "owner-a",
    referenceScope: null,
  };
  assert.equal(isTask07MediaRequestAuthorized({
    ...base,
    actorUid: "owner-a",
    actorRole: "player",
  }), true);
  assert.equal(isTask07MediaRequestAuthorized({
    ...base,
    actorUid: "dm-a",
    actorRole: "dm",
  }), true);
  assert.equal(isTask07MediaRequestAuthorized({
    ...base,
    actorUid: "other-a",
    actorRole: "player",
  }), false);
  assert.equal(isTask07MediaRequestAuthorized({
    ...base,
    kind: "spell-video",
    actorUid: "web-a",
    actorRole: "webmaster",
  }), true);
});

test("processing media remains cancellable so abandonment wins finalize races", () => {
  assert.equal(isTask07MediaStateAbandonable("processing"), true);
  assert.equal(isTask07MediaStateAbandonable("attached"), false);
  assert.equal(isTask07MediaStateAbandonable("superseded"), false);
});

test("cleanup retries accept only terminal cleanup-owned manifest states", () => {
  ["superseded", "cancelled", "rejected", "failed", "cleanup-pending"]
    .forEach((state) => {
      assert.equal(isTask07MediaStateManualCleanupRetryable(state), true);
      assert.equal(isTask07MediaStateCleanupEligible(state), true);
    });
  ["intent", "uploaded", "processing", "ready", "attached", "deleted"]
    .forEach((state) => {
      assert.equal(isTask07MediaStateManualCleanupRetryable(state), false);
    });
  assert.equal(isTask07MediaStateCleanupEligible("ready"), true);
  assert.equal(isTask07MediaStateCleanupEligible("attached"), false);
});

test("cleanup queue claims reclaim expired or missing processing leases", () => {
  const nowMs = 100_000;
  assert.equal(isTask07CleanupQueueClaimable({
    state: "pending", leaseUntilMs: Number.NaN, nowMs,
  }), true);
  assert.equal(isTask07CleanupQueueClaimable({
    state: "retry", leaseUntilMs: nowMs + 1, nowMs,
  }), true);
  assert.equal(isTask07CleanupQueueClaimable({
    state: "processing", leaseUntilMs: nowMs + 1, nowMs,
  }), false);
  assert.equal(isTask07CleanupQueueClaimable({
    state: "processing", leaseUntilMs: nowMs, nowMs,
  }), true);
  assert.equal(isTask07CleanupQueueClaimable({
    state: "processing", leaseUntilMs: Number.NaN, nowMs,
  }), true);
  assert.equal(isTask07CleanupQueueClaimable({
    state: "complete", leaseUntilMs: 0, nowMs,
  }), false);
});

test("cleanup sweeps separate active work from terminal records", () => {
  const records = [
    {id: "complete", state: "complete"},
    {id: "pending", state: "pending"},
    {id: "dead", state: "dead-letter"},
    {id: "lease", state: "processing"},
    {id: "retry", state: "retry"},
  ];
  const partitioned = partitionTask07CleanupSweepRecords(records);
  assert.deepEqual(
    partitioned.active.map(({id}) => id),
    ["pending", "lease", "retry"]
  );
  assert.deepEqual(
    partitioned.terminal.map(({id}) => id),
    ["complete", "dead"]
  );
});

test("generated paths are audience and source-generation scoped", () => {
  const assetId = `m_${"a".repeat(40)}`;
  const generated = buildGeneratedMediaStoragePlan({
    kind: "map",
    audienceScope: "signed-in",
    ownerKey: "dm-one",
    assetId,
    sourceGeneration: "42",
  });
  assert.equal(
    generated.originalPath,
    `media_assets/v1/signed-in/dm-one/${assetId}/42/original`
  );
  assert.deepEqual(Object.keys(generated.variants), [
    "gallery", "gallery2x",
  ]);
  const parsed = parseCanonicalMediaPath(generated.variants.gallery);
  assert.equal(parsed.assetId, assetId);
  assert.equal(parsed.audienceScope, "signed-in");
  assert.equal(parsed.sourceGeneration, "42");
  assert.equal(parsed.variant, "gallery");
  assert.equal(
    parseCanonicalMediaPath(generated.originalPath.replace("/42/", "/0/")),
    null
  );
});

test("authorization and target adapters remain enumerated", () => {
  assert.equal(isTask07MediaRequestAuthorized({
    kind: "avatar",
    actorUid: "u1",
    ownerUid: "u1",
    referenceScope: null,
    actorRole: "player",
  }), true);
  assert.equal(isTask07MediaRequestAuthorized({
    kind: "foe",
    actorUid: "web",
    ownerUid: "web",
    referenceScope: null,
    actorRole: "webmaster",
  }), true);
  assert.equal(task07MediaReferencePath({
    kind: "token",
    ownerUid: "u1",
    entityId: "token-1",
    referenceScope: null,
  }), "grigliata_tokens/token-1");
  assert.equal(task07MediaReferencePath({
    kind: "music",
    ownerUid: "dm",
    entityId: "track-1",
    referenceScope: null,
  }), "grigliata_music_tracks/track-1");
  assert.equal(isTask07MediaRequestAuthorized({
    kind: "music",
    actorUid: "web",
    ownerUid: "web",
    referenceScope: null,
    actorRole: "webmaster",
  }), true);
  assert.equal(isTask07MediaRequestAuthorized({
    kind: "music",
    actorUid: "player",
    ownerUid: "player",
    referenceScope: null,
    actorRole: "player",
  }), false);
});

test("webmasters manage foe and map media without gaining token manager access", () => {
  for (const kind of ["foe", "map", "map-video"]) {
    assert.equal(isTask07MediaRequestAuthorized({
      kind,
      actorUid: "web",
      ownerUid: "web",
      referenceScope: null,
      actorRole: "webmaster",
    }), true);
    assert.equal(isTask07MediaRetirementAuthorized({
      kind,
      actorUid: "web",
      ownerUid: "another-owner",
      referenceScope: null,
      actorRole: "webmaster",
    }), true);
    assert.equal(isTask07MediaRequestAuthorized({
      kind,
      actorUid: "player",
      ownerUid: "player",
      referenceScope: null,
      actorRole: "player",
    }), false);
  }
  assert.equal(isTask07MediaRequestAuthorized({
    kind: "token",
    actorUid: "web",
    ownerUid: "another-owner",
    referenceScope: null,
    actorRole: "webmaster",
  }), false);
  assert.equal(isTask07MediaRetirementAuthorized({
    kind: "token",
    actorUid: "web",
    ownerUid: "another-owner",
    referenceScope: null,
    actorRole: "webmaster",
  }), false);
});
