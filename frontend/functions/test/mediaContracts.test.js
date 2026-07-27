const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_PRIVATE_CACHE_CONTROL,
  MEDIA_SCHEMA_VERSION,
  buildTask07PrivateStorageMetadata,
  buildMediaStoragePlan,
  mediaAssetId,
  parseCanonicalMediaPath,
  readImageDimensions,
  validateMediaObject,
  validateTask07PrivateStorageMetadata,
} = require("../lib/mediaContracts");
const {
  buildTask07MediaUploadPlan,
  containsTask07MediaPath,
  containsTask07MediaReference,
  finalizeTask07MediaValue,
  task07MediaAssetChainsIntersect,
  isTask07MediaPlanReferenceCompatible,
  isTask07MediaRequestAuthorized,
  isTask07MediaRetirementAuthorized,
  isTask07PreviousMediaPlanCompatible,
  isTask07MediaStateAbandonable,
  isTask07ProcessingLeaseExpired,
  mapMediaCleanupWithConcurrency,
  task07CleanupRetryDelayMs,
  task07MediaCleanupPaths,
  task07MediaReferencePath,
  task07MediaReferenceRemovalAction,
  task07MediaRetirementChainAction,
  task07MediaRetirementResponseAssetId,
  task07PreviousRetirementAction,
  selectTask07CanonicalMediaReference,
  shouldClearTask07DeletedUserTokenProjection,
  shouldRecoverCommittedTask07MediaReference,
} = require("../lib/mediaAssetLifecycleCore");

const inspected = (path, overrides = {}) => ({
  path,
  contentType: "image/webp",
  bytes: 1024,
  width: 80,
  height: 80,
  durationMs: null,
  orientationDegrees: 0,
  generation: "1",
  cacheControl: MEDIA_PRIVATE_CACHE_CONTROL,
  ...overrides,
});

test("Task 07 contracts are versioned, bounded, and private", () => {
  assert.equal(MEDIA_SCHEMA_VERSION, 1);
  assert.equal(MEDIA_CONTRACT_VERSION, 1);
  assert.match(MEDIA_PRIVATE_CACHE_CONTROL, /^private,/);
  assert.doesNotMatch(MEDIA_PRIVATE_CACHE_CONTROL, /\bpublic\b/);
  assert.deepEqual(Object.keys(MEDIA_CONTRACTS).sort(), [
    "avatar",
    "foe",
    "item",
    "map",
    "map-video",
    "npc",
  ]);
  assert.deepEqual(Object.keys(MEDIA_CONTRACTS.map.variants).sort(), [
    "board",
    "card",
    "thumbnail",
  ]);
  assert.deepEqual(Object.keys(MEDIA_CONTRACTS["map-video"].variants), [
    "poster",
  ]);
  assert.deepEqual(MEDIA_CONTRACTS["map-video"].source.contentTypes, ["video/mp4"]);
  for (const contract of Object.values(MEDIA_CONTRACTS)) {
    assert.ok(contract.source.maxBytes > 0);
    assert.ok(contract.source.maxPixels > 0);
    assert.equal(contract.retention.original, "retain");
    for (const variant of Object.values(contract.variants)) {
      assert.equal(variant.contentType, "image/webp");
      assert.ok(variant.maxBytes < contract.source.maxBytes);
      assert.equal(variant.minScale, 0.7);
    }
  }
});

test("private storage metadata preserves identity and rejects tokens", () => {
  const expected = buildTask07PrivateStorageMetadata({
    assetId: "m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    entityId: "entity-1",
    kind: "item",
    ownerUid: "user-1",
    role: "thumbnail",
  });
  assert.deepEqual(expected, {
    task07AssetId: "m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    task07ContractVersion: String(MEDIA_CONTRACT_VERSION),
    task07EntityId: "entity-1",
    task07Kind: "item",
    task07OwnerUid: "user-1",
    task07Role: "thumbnail",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      expected,
      "firebaseStorageDownloadTokens"
    ),
    false
  );

  const inspectedMetadata = {
    cacheControl: MEDIA_PRIVATE_CACHE_CONTROL,
    contentDisposition: "inline",
    metadata: {...expected},
    expected,
  };
  assert.deepEqual(
    validateTask07PrivateStorageMetadata(inspectedMetadata),
    {ok: true, errors: []}
  );
  assert.deepEqual(
    validateTask07PrivateStorageMetadata({
      ...inspectedMetadata,
      metadata: {
        ...expected,
        firebaseStorageDownloadTokens: null,
      },
    }),
    {ok: true, errors: []}
  );

  for (const key of Object.keys(expected)) {
    const result = validateTask07PrivateStorageMetadata({
      ...inspectedMetadata,
      metadata: {...expected, [key]: "wrong"},
    });
    assert.equal(result.ok, false, key);
    assert.ok(result.errors.some((error) => error.includes(key)), key);
  }
  const unsafe = validateTask07PrivateStorageMetadata({
    ...inspectedMetadata,
    cacheControl: "public, max-age=3600",
    contentDisposition: "attachment",
    metadata: {
      ...expected,
      firebaseStorageDownloadTokens: "",
    },
  });
  assert.equal(unsafe.ok, false);
  assert.ok(unsafe.errors.includes("private-cache-control-required"));
  assert.ok(unsafe.errors.includes("inline-content-disposition-required"));
  assert.ok(unsafe.errors.includes(
    "firebase-storage-download-token-forbidden"
  ));
});

test("upload plans are deterministic, actor-scoped, and contract-owned", () => {
  const first = buildTask07MediaUploadPlan({
    actorUid: "user-a",
    ownerUid: "user-a",
    entityId: "profile",
    operationId: "upload_12345678",
    kind: "avatar",
    sourceContentType: "image/png",
  });
  const second = buildTask07MediaUploadPlan({
    actorUid: "user-a",
    ownerUid: "user-a",
    entityId: "profile",
    operationId: "upload_12345678",
    kind: "avatar",
    sourceContentType: "image/png",
  });
  assert.deepEqual(first, second);
  assert.equal(first.assetId, mediaAssetId("user-a", "upload_12345678"));
  assert.match(first.originalPath, /\/original\/source\.png$/);
  assert.deepEqual(Object.keys(first.variants).sort(), ["card", "thumbnail"]);
  assert.equal(first.passthrough, false);
  assert.notEqual(
    first.assetId,
    mediaAssetId("user-b", "upload_12345678")
  );
});

test("GIF sources use an explicit original fallback and unsupported MIME fails", () => {
  const fallback = buildMediaStoragePlan({
    kind: "map",
    ownerUid: "dm-one",
    assetId: "m_1234567890abcdef",
    sourceContentType: "image/gif",
  });
  assert.equal(fallback.passthrough, true);
  assert.deepEqual(fallback.variants, {});
  assert.throws(() => buildMediaStoragePlan({
    kind: "map",
    ownerUid: "dm-one",
    assetId: "m_1234567890abcdef",
    sourceContentType: "image/svg+xml",
  }), /Unsupported map media type/);
  assert.throws(() => buildMediaStoragePlan({
    kind: "map-video",
    ownerUid: "dm-one",
    assetId: "m_1234567890abcdef",
    sourceContentType: "video/webm",
  }), /retain the legacy original fallback/);
});

test("canonical paths reject traversal, unknown variants, and wrong versions", () => {
  const plan = buildMediaStoragePlan({
    kind: "map",
    ownerUid: "dm-one",
    assetId: "m_1234567890abcdef",
    sourceContentType: "image/png",
  });
  assert.equal(parseCanonicalMediaPath(plan.originalPath).role, "original");
  assert.equal(
    parseCanonicalMediaPath(plan.variants.board).variant,
    "board"
  );
  assert.equal(parseCanonicalMediaPath(
    plan.originalPath.replace("dm-one", "..")
  ), null);
  assert.equal(parseCanonicalMediaPath(
    plan.variants.board.replace("board.webp", "poster.webp")
  ), null);
  assert.equal(parseCanonicalMediaPath(
    plan.variants.board.replace("/v1/board", "/v2/board")
  ), null);
});

test("dimension parser reads PNG, GIF, JPEG, and WebP headers", () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(readImageDimensions(png, "image/png"), {
    width: 640,
    height: 480,
  });

  const gif = Buffer.alloc(10);
  gif.write("GIF89a", 0, "ascii");
  gif.writeUInt16LE(320, 6);
  gif.writeUInt16LE(200, 8);
  assert.deepEqual(readImageDimensions(gif, "image/gif"), {
    width: 320,
    height: 200,
  });

  const jpeg = Buffer.alloc(21);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0]).copy(jpeg);
  jpeg.writeUInt16BE(17, 4);
  jpeg[6] = 8;
  jpeg.writeUInt16BE(720, 7);
  jpeg.writeUInt16BE(1280, 9);
  assert.deepEqual(readImageDimensions(jpeg, "image/jpeg"), {
    width: 1280,
    height: 720,
  });

  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  webp.write("VP8X", 12, "ascii");
  webp.writeUIntLE(511, 24, 3);
  webp.writeUIntLE(255, 27, 3);
  assert.deepEqual(readImageDimensions(webp, "image/webp"), {
    width: 512,
    height: 256,
  });
  assert.equal(readImageDimensions(Buffer.from("not-image"), "image/png"), null);
});

test("server validation rejects public cache and derivative budget violations", () => {
  const plan = buildMediaStoragePlan({
    kind: "avatar",
    ownerUid: "user-a",
    assetId: "m_1234567890abcdef",
    sourceContentType: "image/png",
  });
  const source = validateMediaObject("avatar", inspected(plan.originalPath, {
    contentType: "image/png",
    width: 512,
    height: 512,
    cacheControl: "public, max-age=3600",
  }));
  assert.equal(source.ok, false);
  assert.ok(source.errors.includes("public-cache-control-forbidden"));

  const thumbnail = validateMediaObject(
    "avatar",
    inspected(plan.variants.thumbnail, {
      width: 97,
      height: 96,
    }),
    "thumbnail"
  );
  assert.equal(thumbnail.ok, false);
  assert.ok(thumbnail.errors.includes("variant-dimension-budget-exceeded"));
  const unstamped = validateMediaObject(
    "avatar",
    inspected(plan.variants.thumbnail, {cacheControl: ""}),
    "thumbnail",
    {requirePrivateMetadata: true}
  );
  assert.ok(unstamped.errors.includes("private-cache-control-required"));
  const invalidGeneration = validateMediaObject(
    "avatar",
    inspected(plan.variants.thumbnail, {generation: ""}),
    "thumbnail"
  );
  assert.ok(invalidGeneration.errors.includes("invalid-generation"));
});

test("authoritative variants enforce planned size and aspect constraints", () => {
  const plan = buildMediaStoragePlan({
    kind: "map",
    ownerUid: "dm-one",
    assetId: "m_1234567890abcdef",
    sourceContentType: "image/png",
  });
  const sourceDimensions = {width: 1600, height: 900};
  const tiny = validateMediaObject(
    "map",
    inspected(plan.variants.thumbnail, {width: 20, height: 20}),
    "thumbnail",
    {sourceDimensions}
  );
  assert.ok(tiny.errors.includes("variant-planned-dimension-too-small"));
  assert.ok(tiny.errors.includes("variant-aspect-ratio-mismatch"));

  const unrelatedShape = validateMediaObject(
    "map",
    inspected(plan.variants.thumbnail, {width: 224, height: 180}),
    "thumbnail",
    {sourceDimensions}
  );
  assert.ok(unrelatedShape.errors.includes("variant-aspect-ratio-mismatch"));

  const boundedRetry = validateMediaObject(
    "map",
    inspected(plan.variants.card, {width: 672, height: 378}),
    "card",
    {sourceDimensions}
  );
  assert.equal(boundedRetry.ok, true);
});

test("authorization matches current private product audiences", () => {
  const allowed = (
    kind,
    actorUid,
    ownerUid,
    actorRole,
    referenceScope = null
  ) => (
    isTask07MediaRequestAuthorized({
      kind, actorUid, ownerUid, actorRole, referenceScope,
    })
  );
  assert.equal(allowed("avatar", "u1", "u1", "player"), true);
  assert.equal(allowed("avatar", "dm", "u1", "dm"), false);
  assert.equal(allowed(
    "item", "dm", "u1", "dm", "user-inventory"
  ), true);
  assert.equal(allowed(
    "item", "dm", "dm", "dm", "global-catalog"
  ), true);
  assert.equal(allowed(
    "item", "player", "player", "player", "global-catalog"
  ), false);
  assert.equal(allowed("item", "u1", "u1", "player"), false);
  assert.equal(allowed("npc", "dm", "dm", "dm"), true);
  assert.equal(allowed("npc", "player", "player", "player"), false);
  assert.equal(allowed("foe", "dm", "dm", "dm"), true);
  assert.equal(allowed("foe", "web", "web", "webmaster"), false);
  assert.equal(allowed("map", "dm", "other", "dm"), false);
});

test("reference checks accept canonical paths and encoded Firebase URLs", () => {
  const expected = "media/v1/item/u1/m_123/original/source.png";
  const encoded = `https://firebasestorage.googleapis.com/v0/b/bucket/o/` +
    `${encodeURIComponent(expected)}?alt=media&token=secret`;
  assert.equal(containsTask07MediaPath({
    media: {original: {path: expected}},
  }, expected), true);
  assert.equal(containsTask07MediaPath({imageUrl: encoded}, expected), true);
  assert.equal(containsTask07MediaPath({
    note: expected,
  }, expected), false);
  assert.equal(containsTask07MediaPath({
    imageUrl: `https://evil.example/o/${encodeURIComponent(expected)}`,
  }, expected), false);
  const plan = buildTask07MediaUploadPlan({
    actorUid: "u1",
    ownerUid: "u1",
    entityId: "i1",
    operationId: "reference_123456",
    kind: "item",
    referenceScope: "user-inventory",
    sourceContentType: "image/png",
  });
  const committedMedia = {
    schemaVersion: 1,
    contractVersion: 1,
    assetId: plan.assetId,
    kind: "item",
    state: "ready",
    original: {path: plan.originalPath},
    variants: {},
    processing: {authoritative: true, fallbackCode: null},
  };
  assert.equal(containsTask07MediaReference({
    media: committedMedia,
  }, committedMedia), true);
  assert.equal(containsTask07MediaReference({
    General: {
      media: committedMedia,
    },
  }, committedMedia), true);
  assert.equal(selectTask07CanonicalMediaReference({
    media: committedMedia,
    General: {media: committedMedia},
  }).status, "single");

  const replacementPlan = buildTask07MediaUploadPlan({
    actorUid: "u1",
    ownerUid: "u1",
    entityId: "i1",
    operationId: "reference_replacement_123",
    kind: "item",
    referenceScope: "user-inventory",
    previousAssetId: plan.assetId,
    sourceContentType: "image/png",
  });
  const replacementMedia = {
    ...committedMedia,
    assetId: replacementPlan.assetId,
    original: {path: replacementPlan.originalPath},
  };
  assert.equal(selectTask07CanonicalMediaReference({
    media: committedMedia,
    General: {media: replacementMedia},
  }).status, "ambiguous");
  assert.equal(selectTask07CanonicalMediaReference({
    media: {
      ...committedMedia,
      original: {path: "not-canonical"},
    },
  }).status, "invalid");
  assert.equal(selectTask07CanonicalMediaReference({
    media: null,
  }).status, "none");
  assert.equal(selectTask07CanonicalMediaReference({
    media: {legacyUrl: "legacy.png"},
  }).status, "invalid");
  assert.equal(selectTask07CanonicalMediaReference({
    media: {schemaVersion: 2},
  }).status, "invalid");
  assert.equal(selectTask07CanonicalMediaReference({
    media: {assetId: "legacy-asset"},
  }).status, "invalid");
  assert.equal(selectTask07CanonicalMediaReference({
    media: "legacy.png",
  }).status, "invalid");
  assert.equal(selectTask07CanonicalMediaReference({
    General: {media: 42},
  }).status, "invalid");
  assert.equal(selectTask07CanonicalMediaReference({
    General: {media: null},
  }).status, "none");
  assert.equal(selectTask07CanonicalMediaReference({
    General: null,
  }).status, "none");

  const removalAction = ({
    afterValue = {},
    currentValue = {},
    eventAfterExists = true,
    currentExists = eventAfterExists,
    currentOwnsRemovedChain = false,
  } = {}) => task07MediaReferenceRemovalAction({
    beforeValue: {media: committedMedia},
    afterValue,
    currentValue,
    eventAfterExists,
    currentExists,
    currentOwnsRemovedChain,
  });
  assert.equal(removalAction(), "superseded-grace");
  assert.equal(removalAction({currentExists: false}), "cleanup-immediate");
  assert.equal(removalAction({
    eventAfterExists: false,
    currentExists: true,
  }), "cleanup-immediate");
  assert.equal(removalAction({
    currentValue: {media: committedMedia},
    eventAfterExists: false,
    currentExists: true,
  }), "replacement-present");
  assert.equal(removalAction({
    currentValue: {media: committedMedia},
  }), "replacement-present");
  assert.equal(removalAction({
    afterValue: {media: replacementMedia},
    currentValue: {media: replacementMedia},
  }), "superseded-grace");
  assert.equal(removalAction({
    currentValue: {media: replacementMedia},
  }), "superseded-grace");
  assert.equal(removalAction({
    afterValue: {media: committedMedia},
    currentValue: {media: committedMedia},
  }), "replacement-present");
  assert.equal(removalAction({
    currentValue: {media: replacementMedia},
    eventAfterExists: false,
    currentExists: true,
  }), "cleanup-immediate");
  assert.equal(removalAction({
    currentValue: {media: replacementMedia},
    eventAfterExists: false,
    currentExists: true,
    currentOwnsRemovedChain: true,
  }), "replacement-present");
  assert.equal(task07MediaReferenceRemovalAction({
    beforeValue: {media: committedMedia},
    afterValue: {},
    currentValue: {
      media: {...committedMedia, original: {path: "invalid"}},
    },
    eventAfterExists: true,
    currentExists: true,
  }), "invalid");
  assert.equal(task07MediaAssetChainsIntersect(
    [replacementPlan.assetId, plan.assetId],
    [mediaAssetId("u1", "fresh_reference_123"), plan.assetId]
  ), true);
  assert.equal(task07MediaAssetChainsIntersect(
    [replacementPlan.assetId, plan.assetId],
    [mediaAssetId("u1", "fresh_reference_123")]
  ), false);
  assert.equal(shouldClearTask07DeletedUserTokenProjection("u1", {
    ownerUid: "u1",
    tokenType: "character",
    imageSource: "profile",
    imageUrl: "legacy-profile.png",
  }), true);
  assert.equal(shouldClearTask07DeletedUserTokenProjection("u1", {
    ownerUid: "other-user",
    tokenType: "character",
    imageSource: "profile",
  }), false);
  assert.equal(shouldClearTask07DeletedUserTokenProjection("u1", {
    ownerUid: "u1",
    tokenType: "custom",
    imageSource: "uploaded",
  }), false);
  assert.equal(shouldClearTask07DeletedUserTokenProjection("u1", {
    ownerUid: "u1",
    tokenType: "character",
    imageSource: "foesHub",
  }), false);
  assert.equal(containsTask07MediaReference({
    media: {
      ...committedMedia,
      original: {...committedMedia.original, bytes: 999},
    },
  }, committedMedia), false);
  assert.equal(containsTask07MediaReference({
    media: {...committedMedia, unexpected: true},
  }, committedMedia), false);
  const committedReference = {
    media: committedMedia,
  };
  assert.equal(shouldRecoverCommittedTask07MediaReference({
    state: "ready",
    referenceValue: committedReference,
    expectedMedia: committedMedia,
  }), true);
  assert.equal(shouldRecoverCommittedTask07MediaReference({
    state: "failed",
    referenceValue: committedReference,
    expectedMedia: committedMedia,
  }), false);
  assert.equal(containsTask07MediaReference(
    {imagePath: plan.originalPath},
    committedMedia
  ), false);
  assert.equal(containsTask07MediaPath({imagePath: "other"}, expected), false);
  assert.equal(task07MediaReferencePath({
    kind: "item",
    ownerUid: "u1",
    entityId: "i1",
    referenceScope: "user-inventory",
  }), "users/u1/inventory/i1");
  const catalogPlan = buildTask07MediaUploadPlan({
    actorUid: "u1",
    ownerUid: "u1",
    entityId: "i1",
    operationId: "reference_123456",
    kind: "item",
    referenceScope: "global-catalog",
    sourceContentType: "image/png",
  });
  assert.equal(catalogPlan.assetId, plan.assetId);
  assert.notEqual(catalogPlan.requestHash, plan.requestHash);
  assert.equal(task07MediaReferencePath(catalogPlan), "items/i1");
  assert.equal(task07MediaReferencePath({
    kind: "map",
    ownerUid: "dm",
    entityId: "map-1",
    referenceScope: null,
  }), "grigliata_backgrounds/map-1");
});

test("replacement plans hash-bind and validate previous asset retirement", () => {
  const previous = buildTask07MediaUploadPlan({
    actorUid: "u1",
    ownerUid: "u1",
    entityId: "i1",
    operationId: "previous_12345678",
    kind: "item",
    referenceScope: "user-inventory",
    sourceContentType: "image/png",
  });
  const replacementInput = {
    actorUid: "u1",
    ownerUid: "u1",
    entityId: "i1",
    operationId: "replacement_12345678",
    kind: "item",
    referenceScope: "user-inventory",
    sourceContentType: "image/png",
  };
  const replacement = buildTask07MediaUploadPlan({
    ...replacementInput,
    previousAssetId: previous.assetId,
  });
  const concurrentReplacement = buildTask07MediaUploadPlan({
    ...replacementInput,
    operationId: "concurrent_12345678",
    previousAssetId: previous.assetId,
  });
  const unboundReplacement = buildTask07MediaUploadPlan(replacementInput);
  const nullReplacement = buildTask07MediaUploadPlan({
    ...replacementInput,
    previousAssetId: null,
  });

  assert.equal(replacement.previousAssetId, previous.assetId);
  assert.equal(unboundReplacement.previousAssetId, null);
  assert.equal(nullReplacement.previousAssetId, null);
  assert.equal(nullReplacement.requestHash, unboundReplacement.requestHash);
  assert.notEqual(replacement.requestHash, unboundReplacement.requestHash);
  assert.equal(isTask07MediaPlanReferenceCompatible(
    replacement,
    concurrentReplacement
  ), true);
  assert.equal(isTask07MediaPlanReferenceCompatible(
    replacement,
    {...concurrentReplacement, entityId: "other-item"}
  ), false);
  assert.equal(
    isTask07PreviousMediaPlanCompatible(replacement, previous),
    true
  );
  assert.equal(isTask07PreviousMediaPlanCompatible(
    replacement,
    {...previous, entityId: "other-item"}
  ), false);
  assert.equal(isTask07PreviousMediaPlanCompatible(
    replacement,
    {...previous, referenceScope: "global-catalog"}
  ), false);
  assert.equal(isTask07PreviousMediaPlanCompatible(
    replacement,
    {...previous, kind: "npc"}
  ), false);

  assert.throws(() => buildTask07MediaUploadPlan({
    ...replacementInput,
    previousAssetId: "not-a-canonical-asset",
  }), /Media upload identity is invalid/);
  assert.throws(() => buildTask07MediaUploadPlan({
    ...replacementInput,
    previousAssetId: "",
  }), /Media upload identity is invalid/);
  assert.throws(() => buildTask07MediaUploadPlan({
    ...replacementInput,
    previousAssetId: mediaAssetId(
      replacementInput.actorUid,
      replacementInput.operationId
    ),
  }), /must differ from its replacement/);

  const previousCatalog = buildTask07MediaUploadPlan({
    actorUid: "dm-old",
    ownerUid: "dm-old",
    entityId: "catalog-item",
    operationId: "catalog_previous_123",
    kind: "item",
    referenceScope: "global-catalog",
    sourceContentType: "image/png",
  });
  const replacementCatalog = buildTask07MediaUploadPlan({
    actorUid: "dm-new",
    ownerUid: "dm-new",
    entityId: "catalog-item",
    operationId: "catalog_replacement_123",
    kind: "item",
    referenceScope: "global-catalog",
    previousAssetId: previousCatalog.assetId,
    sourceContentType: "image/png",
  });
  assert.equal(isTask07PreviousMediaPlanCompatible(
    replacementCatalog,
    previousCatalog
  ), true);
  assert.equal(isTask07MediaPlanReferenceCompatible(
    replacementCatalog,
    previousCatalog
  ), true);

  const retirementAction = (
    replacementPlan,
    previousPlan,
    previousState,
    supersededByAssetId
  ) => task07PreviousRetirementAction({
    replacementPlan,
    previousPlan,
    previousState,
    supersededByAssetId,
  });
  const chainAction = (
    candidateState,
    supersededByAssetId
  ) => task07MediaRetirementChainAction({
    replacementAssetId: replacement.assetId,
    candidateState,
    supersededByAssetId,
  });
  assert.equal(
    retirementAction(replacement, previous, "referenced"),
    "supersede"
  );
  assert.equal(retirementAction(
    replacement,
    previous,
    "referenced",
    mediaAssetId("other-actor", "other_replacement_123")
  ), "invalid");
  assert.equal(
    retirementAction(replacement, previous, "superseded"),
    "already-superseded"
  );
  assert.equal(retirementAction(
    replacement,
    previous,
    "superseded",
    replacement.assetId
  ), "already-superseded");
  assert.equal(retirementAction(
    replacement,
    previous,
    "superseded",
    mediaAssetId("other-actor", "other_replacement_123")
  ), "follow-supersession");
  assert.equal(retirementAction(
    replacement,
    previous,
    "cleanup-pending",
    replacement.assetId
  ), "already-superseded");
  assert.equal(retirementAction(
    replacement,
    previous,
    "superseded",
    concurrentReplacement.assetId
  ), "follow-supersession");
  assert.equal(
    task07MediaRetirementResponseAssetId(replacement),
    previous.assetId
  );
  assert.notEqual(
    task07MediaRetirementResponseAssetId(replacement),
    concurrentReplacement.assetId
  );
  assert.equal(
    chainAction("referenced"),
    "supersede"
  );
  assert.equal(
    chainAction("superseded", concurrentReplacement.assetId),
    "follow-supersession"
  );
  assert.equal(
    chainAction("cleanup-pending", concurrentReplacement.assetId),
    "follow-supersession"
  );
  assert.equal(
    chainAction("superseded", replacement.assetId),
    "already-superseded"
  );
  assert.equal(chainAction("cleanup-pending"), "invalid");
  assert.equal(
    chainAction("superseded", "malformed-asset-id"),
    "invalid"
  );
  assert.equal(retirementAction(
    unboundReplacement,
    previous,
    "referenced"
  ), "not-requested");
});

test("authoritative finalization requires the complete expected variant set", () => {
  const plan = buildTask07MediaUploadPlan({
    actorUid: "user-a",
    ownerUid: "user-a",
    entityId: "profile",
    operationId: "upload_abcdefgh",
    kind: "avatar",
    sourceContentType: "image/png",
  });
  const original = inspected(plan.originalPath, {
    contentType: "image/png",
    width: 400,
    height: 400,
  });
  assert.throws(() => finalizeTask07MediaValue({
    plan,
    original,
    variants: {
      thumbnail: inspected(plan.variants.thumbnail),
    },
  }), /variant-set-mismatch/);

  const value = finalizeTask07MediaValue({
    plan,
    original,
    variants: {
      thumbnail: inspected(plan.variants.thumbnail),
      card: inspected(plan.variants.card, {width: 300, height: 300}),
    },
  });
  assert.equal(value.state, "ready");
  assert.equal(value.processing.authoritative, true);
  assert.deepEqual(Object.keys(value.variants).sort(), ["card", "thumbnail"]);
  assert.throws(() => finalizeTask07MediaValue({
    plan,
    original: {...original, contentType: "image/jpeg"},
    variants: {
      thumbnail: inspected(plan.variants.thumbnail),
      card: inspected(plan.variants.card, {width: 300, height: 300}),
    },
  }), /original-content-type-mismatch/);
});

test("passthrough finalization is explicit and derivative-free", () => {
  const plan = buildTask07MediaUploadPlan({
    actorUid: "dm-one",
    ownerUid: "dm-one",
    entityId: "map-one",
    operationId: "upload_gif_1234",
    kind: "map",
    sourceContentType: "image/gif",
  });
  const value = finalizeTask07MediaValue({
    plan,
    original: inspected(plan.originalPath, {
      contentType: "image/gif",
      width: 800,
      height: 600,
    }),
    variants: {},
  });
  assert.equal(value.state, "fallback");
  assert.equal(value.processing.fallbackCode, "source-mime-passthrough");
});

test("MP4 map finalization requires a bounded authoritative poster", () => {
  const plan = buildTask07MediaUploadPlan({
    actorUid: "dm-one",
    ownerUid: "dm-one",
    entityId: "map-video-one",
    operationId: "upload_mp4_1234",
    kind: "map-video",
    sourceContentType: "video/mp4",
  });
  const original = inspected(plan.originalPath, {
    contentType: "video/mp4",
    bytes: 2 * 1024 * 1024,
    width: 1080,
    height: 1920,
    durationMs: 12_500,
    orientationDegrees: 90,
  });
  assert.throws(() => finalizeTask07MediaValue({
    plan,
    original,
    variants: {},
  }), /variant-set-mismatch/);
  const value = finalizeTask07MediaValue({
    plan,
    original,
    variants: {
      poster: inspected(plan.variants.poster, {width: 320, height: 180}),
    },
  });
  assert.equal(value.state, "ready");
  assert.equal(value.original.orientationDegrees, 90);
  assert.deepEqual(Object.keys(value.variants), ["poster"]);

  const overDuration = validateMediaObject("map-video", {
    ...original,
    durationMs: MEDIA_CONTRACTS["map-video"].source.maxDurationMs + 1,
  });
  assert.ok(overDuration.errors.includes("source-duration-budget-exceeded"));
});

test("replacement retirement and recovery decisions are bounded", () => {
  const retire = (
    kind,
    actorUid,
    ownerUid,
    actorRole,
    referenceScope = null
  ) => (
    isTask07MediaRetirementAuthorized({
      kind, actorUid, ownerUid, actorRole, referenceScope,
    })
  );
  assert.equal(retire("avatar", "u1", "u1", "player"), true);
  assert.equal(retire("avatar", "dm", "u1", "dm"), false);
  assert.equal(retire(
    "item", "dm", "u1", "dm", "user-inventory"
  ), true);
  assert.equal(retire(
    "item", "dm2", "dm1", "dm", "global-catalog"
  ), true);
  assert.equal(retire(
    "item", "u1", "u1", "player", "global-catalog"
  ), false);
  assert.equal(retire("npc", "dm2", "dm1", "dm"), true);
  assert.equal(retire("map", "dm2", "dm1", "dm"), true);
  assert.equal(retire("map", "web", "dm1", "webmaster"), false);
  assert.equal(isTask07MediaStateAbandonable("referenced"), false);
  assert.equal(isTask07MediaStateAbandonable("failed"), true);
  assert.equal(isTask07ProcessingLeaseExpired({
    state: "processing",
    updatedAtMs: 1000,
    nowMs: 2000,
    leaseMs: 999,
  }), true);
  assert.equal(task07CleanupRetryDelayMs(1), 30_000);
  assert.equal(task07CleanupRetryDelayMs(99), 60 * 60 * 1000);
});

test("cleanup is manifest-bound and ignores injected paths", () => {
  const plan = buildTask07MediaUploadPlan({
    actorUid: "user-a",
    ownerUid: "user-a",
    entityId: "profile",
    operationId: "cleanup_abcdefgh",
    kind: "avatar",
    sourceContentType: "image/png",
  });
  const paths = task07MediaCleanupPaths({
    ...plan,
    variants: {
      ...plan.variants,
      board: "users/other/private.png",
    },
  });
  assert.deepEqual(paths, [
    plan.variants.card,
    plan.variants.thumbnail,
    plan.originalPath,
  ].sort());
});

test("cleanup concurrency is bounded while preserving result order", async () => {
  let active = 0;
  let maxActive = 0;
  const results = await mapMediaCleanupWithConcurrency(
    [5, 4, 3, 2, 1],
    2,
    async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    }
  );
  assert.equal(maxActive, 2);
  assert.deepEqual(results, [10, 8, 6, 4, 2]);
});
