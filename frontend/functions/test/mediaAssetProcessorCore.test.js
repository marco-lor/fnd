const test = require("node:test");
const assert = require("node:assert/strict");

const {
  processTask07MediaSource,
  task07ProcessorFailureCleanupPaths,
  Task07ProcessorError,
  validateTask07StagingMetadata,
} = require("../lib/mediaAssetProcessorCore");

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
