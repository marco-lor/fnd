const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isAuthorizedTask07LegacyMapBackfill,
  LEGACY_MAP_BACKFILL_MAX_PIXELS,
  processTask07MediaSource,
  task07SourceDimensionBudget,
  task07ProcessorFailureCleanupPaths,
  Task07ProcessorError,
  validateTask07StagingMetadata,
} = require("../lib/mediaAssetProcessorCore");
const {
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_POLICY_HASH,
  plannedMediaVariantDimensions,
} = require("../lib/mediaContracts");

const plan = {
  assetId: `m_${"a".repeat(40)}`,
  kind: "avatar",
  ownerUid: "user-a",
  ownerKey: "user-a",
  entityId: "profile",
  audienceScope: "signed-in",
  sourceContentType: "image/png",
  sourceBytes: 10,
};

const transformer = {
  inspectSource: async () => ({
    contentType: "image/png",
    width: 400,
    height: 300,
    durationMs: null,
    orientationDegrees: 90,
    codec: null,
  }),
  createVariant: async ({variant}) => {
    const dimensions = {
      thumbnail: [64, 64],
      thumbnail2x: [128, 128],
      card: [256, 256],
    }[variant];
    return {
      buffer: Buffer.from(`webp-${variant}`),
      width: dimensions[0],
      height: dimensions[1],
    };
  },
};

const stagingMetadata = {
  cacheControl: "private, no-store",
  contentDisposition: "inline",
  contentType: plan.sourceContentType,
  size: String(plan.sourceBytes),
  metadata: {
    task07AssetId: plan.assetId,
    task07ContractVersion: "1",
    task07EntityId: plan.entityId,
    task07Kind: plan.kind,
    task07OwnerUid: plan.ownerUid,
    task07Role: "source",
  },
};

test("processor validates the stored staging cache policy", () => {
  assert.doesNotThrow(() => validateTask07StagingMetadata({
    plan,
    metadata: stagingMetadata,
  }));
  assert.throws(
    () => validateTask07StagingMetadata({
      plan,
      metadata: {
        ...stagingMetadata,
        cacheControl: "public, max-age=3600",
      },
    }),
    (error) => error instanceof Task07ProcessorError &&
      error.code === "staging-metadata-mismatch"
  );
});

test("processor accepts only Firebase's non-empty stored download token", () => {
  assert.doesNotThrow(() => validateTask07StagingMetadata({
    plan,
    metadata: {
      ...stagingMetadata,
      metadata: {
        ...stagingMetadata.metadata,
        firebaseStorageDownloadTokens: "firebase-generated-token",
      },
    },
  }));
  for (const firebaseStorageDownloadTokens of ["", "   ", null, 42]) {
    assert.throws(
      () => validateTask07StagingMetadata({
        plan,
        metadata: {
          ...stagingMetadata,
          metadata: {
            ...stagingMetadata.metadata,
            firebaseStorageDownloadTokens,
          },
        },
      }),
      (error) => error instanceof Task07ProcessorError &&
        error.code === "staging-metadata-mismatch"
    );
  }
  assert.throws(
    () => validateTask07StagingMetadata({
      plan,
      metadata: {
        ...stagingMetadata,
        metadata: {
          ...stagingMetadata.metadata,
          arbitraryClientMetadata: "not-allowed",
        },
      },
    }),
    (error) => error instanceof Task07ProcessorError &&
      error.code === "staging-metadata-mismatch"
  );
});

test("processor creates the complete immutable server output family", async () => {
  const result = await processTask07MediaSource({
    plan,
    sourceGeneration: "7",
    source: Buffer.alloc(10, 1),
    transformer,
  });
  assert.deepEqual(
    result.objects.map(({role}) => role),
    ["original", "thumbnail", "thumbnail2x", "card"]
  );
  assert.ok(result.objects.every(({path}) => (
    path.startsWith(
      `media_assets/v1/signed-in/user-a/${plan.assetId}/7/`
    )
  )));
  assert.equal(result.source.orientation, 90);
  assert.match(result.source.checksum, /^[a-f0-9]{64}$/);
  assert.equal(result.original.cacheControl.startsWith("private,"), true);
});

test("legacy map backfill authorization is exact and server-receipt-bound", () => {
  const authorizationPlan = {
    assetId: `m_${"c".repeat(40)}`,
    kind: "map",
    ownerUid: "manager-a",
    entityId: "map-a",
    requestHash: "1".repeat(64),
  };
  const marker = {
    schemaVersion: 1,
    kind: "legacy-map-backfill",
    reportSchemaVersion: 4,
    planVersion: 4,
    policyVersion: MEDIA_CONTRACT_VERSION,
    policyHash: MEDIA_POLICY_HASH,
    receiptId: `r_${"2".repeat(40)}`,
    subjectHash: "3".repeat(64),
    approvedPlanFingerprint: "4".repeat(64),
    assetId: authorizationPlan.assetId,
    requestHash: authorizationPlan.requestHash,
    ownerUid: authorizationPlan.ownerUid,
    entityId: authorizationPlan.entityId,
    targetPath: `grigliata_backgrounds/${authorizationPlan.entityId}`,
    sourcePath: "grigliata/backgrounds/manager-a/map.jpg",
    sourceGeneration: "7",
    sourceFingerprint: "5".repeat(64),
  };
  const receipt = {
    state: "intent",
    sourceKey: "backgrounds",
    kind: "map",
    receiptId: marker.receiptId,
    schemaVersion: marker.reportSchemaVersion,
    planVersion: marker.planVersion,
    policyVersion: marker.policyVersion,
    policyHash: marker.policyHash,
    subjectHash: marker.subjectHash,
    approvedPlanFingerprint: marker.approvedPlanFingerprint,
    assetId: marker.assetId,
    ownerUid: marker.ownerUid,
    entityId: marker.entityId,
    targetPath: marker.targetPath,
    sourcePath: marker.sourcePath,
    sourceGeneration: marker.sourceGeneration,
    sourceFingerprint: marker.sourceFingerprint,
    legacyMapRecoveryAttempts: 1,
    legacyBackfill: marker,
  };
  const authorized = (markerValue = marker, receiptValue = receipt) =>
    isAuthorizedTask07LegacyMapBackfill({
      plan: authorizationPlan,
      marker: markerValue,
      receipt: receiptValue,
    });
  assert.equal(authorized(), true);
  assert.equal(authorized(
    {...marker, extraLimit: 999},
    {...receipt, legacyBackfill: {...marker, extraLimit: 999}}
  ), false);
  assert.equal(authorized(
    {...marker, policyHash: "0".repeat(64)},
    {...receipt, policyHash: "0".repeat(64), legacyBackfill: {
      ...marker,
      policyHash: "0".repeat(64),
    }}
  ), false);
  assert.equal(authorized(marker, {...receipt, state: "attached"}), false);
  assert.equal(authorized(marker, {
    ...receipt,
    sourceFingerprint: "6".repeat(64),
  }), false);
});

test("only authorized legacy maps receive the bounded 9600 decode budget", async () => {
  const mapPlan = {
    ...plan,
    assetId: `m_${"d".repeat(40)}`,
    kind: "map",
    entityId: "legacy-map",
    sourceContentType: "image/jpeg",
  };
  const source = Buffer.alloc(mapPlan.sourceBytes, 7);
  const oversizedTransformer = (width, height, observed = []) => ({
    inspectSource: async (input) => {
      observed.push({phase: "inspect", pixels: input.maxInputPixels});
      return {
        contentType: "image/jpeg",
        width,
        height,
        durationMs: null,
        orientationDegrees: 0,
        codec: null,
      };
    },
    createVariant: async (input) => {
      observed.push({phase: input.variant, pixels: input.maxInputPixels});
      const contract = MEDIA_CONTRACTS.map.variants[input.variant];
      const dimensions = plannedMediaVariantDimensions(input.source, contract);
      return {
        buffer: Buffer.from(`map-${input.variant}`),
        width: dimensions.width,
        height: dimensions.height,
      };
    },
  });
  await assert.rejects(processTask07MediaSource({
    plan: mapPlan,
    sourceGeneration: "7",
    source,
    transformer: oversizedTransformer(9600, 9600),
  }), (error) => error instanceof Task07ProcessorError &&
    error.code === "source-dimension-budget-exceeded");

  const observed = [];
  const result = await processTask07MediaSource({
    plan: mapPlan,
    sourceGeneration: "7",
    source,
    transformer: oversizedTransformer(9600, 9600, observed),
    legacyMapBackfill: true,
  });
  assert.equal(result.original.width, 9600);
  assert.equal(result.original.height, 9600);
  assert.deepEqual(
    result.objects.find(({role}) => role === "original").buffer,
    source
  );
  assert.ok(observed.length >= 3);
  assert.ok(observed.every(({pixels}) => (
    pixels === LEGACY_MAP_BACKFILL_MAX_PIXELS
  )));
  assert.equal(
    task07SourceDimensionBudget("map", true).maxPixels,
    92_160_000
  );

  await assert.rejects(processTask07MediaSource({
    plan: mapPlan,
    sourceGeneration: "7",
    source,
    transformer: oversizedTransformer(9601, 9600),
    legacyMapBackfill: true,
  }), (error) => error instanceof Task07ProcessorError &&
    error.code === "source-dimension-budget-exceeded");
  await assert.rejects(processTask07MediaSource({
    plan,
    sourceGeneration: "7",
    source: Buffer.alloc(plan.sourceBytes),
    transformer: {
      ...oversizedTransformer(9600, 9600),
      inspectSource: async () => ({
        contentType: "image/png",
        width: 9600,
        height: 9600,
        durationMs: null,
        orientationDegrees: 0,
        codec: null,
      }),
    },
    legacyMapBackfill: true,
  }), (error) => error instanceof Task07ProcessorError &&
    error.code === "source-dimension-budget-exceeded");
});

test("processor applies the token derivative family after foe-source reuse", async () => {
  const tokenPlan = {
    ...plan,
    assetId: `m_${"b".repeat(40)}`,
    kind: "token",
    entityId: "spawned-foe-token",
  };
  const observed = [];
  const result = await processTask07MediaSource({
    plan: tokenPlan,
    sourceGeneration: "11",
    source: Buffer.alloc(10, 2),
    transformer: {
      inspectSource: async () => ({
        contentType: "image/png",
        width: 400,
        height: 300,
        durationMs: null,
        orientationDegrees: 0,
        codec: null,
      }),
      createVariant: async ({kind, source, variant}) => {
        const contract = MEDIA_CONTRACTS[kind].variants[variant];
        const dimensions = plannedMediaVariantDimensions(source, contract);
        observed.push({kind, variant, fit: contract.fit});
        return {
          buffer: Buffer.from(`token-${variant}`),
          width: dimensions.width,
          height: dimensions.height,
        };
      },
    },
  });

  assert.deepEqual(
    result.objects.map(({role}) => role),
    ["original", "thumbnail", "thumbnail2x", "card", "card2x"]
  );
  assert.ok(result.objects.every(({path}) => path.startsWith(
    `media_assets/v1/signed-in/user-a/${tokenPlan.assetId}/11/`
  )));
  assert.ok(observed.every(({kind, fit}) => (
    kind === "token" && fit === "inside"
  )));
});

test("processor rejects signature/MIME and exact byte mismatches", async () => {
  await assert.rejects(
    processTask07MediaSource({
      plan,
      sourceGeneration: "7",
      source: Buffer.alloc(9),
      transformer,
    }),
    (error) => error instanceof Task07ProcessorError &&
      error.code === "source-byte-budget-exceeded"
  );
  await assert.rejects(
    processTask07MediaSource({
      plan,
      sourceGeneration: "7",
      source: Buffer.alloc(10),
      transformer: {
        ...transformer,
        inspectSource: async () => ({
          ...(await transformer.inspectSource()),
          contentType: "image/jpeg",
        }),
      },
    }),
    (error) => error instanceof Task07ProcessorError &&
      error.code === "source-signature-mime-mismatch"
  );
});

test("processor fails closed on incomplete or wrong-sized derivatives", async () => {
  await assert.rejects(
    processTask07MediaSource({
      plan,
      sourceGeneration: "7",
      source: Buffer.alloc(10),
      transformer: {
        ...transformer,
        createVariant: async ({variant}) => ({
          buffer: Buffer.from("bad"),
          width: variant === "thumbnail" ? 63 : 1,
          height: 1,
        }),
      },
    }),
    (error) => error instanceof Task07ProcessorError &&
      error.code === "variant-verification-failed"
  );
});

test("processor failures clean only event-scoped temporary outputs", () => {
  const canonical =
    `media_assets/v1/signed-in/user-a/${plan.assetId}/7/original`;
  const temporary = `${canonical}.tmp-event-a`;
  assert.deepEqual(task07ProcessorFailureCleanupPaths({
    temporaryPaths: [temporary, temporary],
    promotedPaths: [canonical],
  }), [temporary]);
});
