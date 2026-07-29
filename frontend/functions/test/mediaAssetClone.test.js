const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTask07MediaUploadPlan,
} = require("../lib/mediaAssetLifecycleCore");
const {
  buildGeneratedMediaStoragePlan,
  buildTask07PrivateStorageMetadata,
} = require("../lib/mediaContracts");
const {
  copyTask07CanonicalMediaFamily,
  Task07MediaCloneStorageError,
} = require("../lib/mediaAssetClone");

const cloneFixture = () => {
  const sourceAssetId = `m_${"a".repeat(40)}`;
  const destinationPlan = buildTask07MediaUploadPlan({
    actorUid: "dm-destination",
    ownerUid: "dm-destination",
    entityId: "foe-destination",
    operationId: "duplicate-foe-media:test-receipt-1234",
    kind: "foe",
    sourceContentType: "image/png",
    sourceBytes: 2048,
  });
  const sourcePaths = buildGeneratedMediaStoragePlan({
    kind: "foe",
    audienceScope: "dm-only",
    ownerKey: "dm-source",
    assetId: sourceAssetId,
    sourceGeneration: "7",
  });
  const destinationPaths = buildGeneratedMediaStoragePlan({
    kind: "foe",
    audienceScope: "dm-only",
    ownerKey: destinationPlan.ownerKey,
    assetId: destinationPlan.assetId,
    sourceGeneration: "7",
  });
  const roles = ["original", "card", "card2x", "thumbnail", "thumbnail2x"];
  const entries = roles.map((role, index) => ({
    role,
    source: {
      path: role === "original"
        ? sourcePaths.originalPath
        : sourcePaths.variants[role],
      contentType: role === "original" ? "image/png" : "image/webp",
      bytes: role === "original" ? 2048 : 200 + index,
      width: role === "original" ? 640 : 96,
      height: role === "original" ? 480 : 96,
      durationMs: null,
      orientationDegrees: 0,
      checksum: String(index + 1).repeat(64).slice(0, 64),
      role,
      generation: String(10 + index),
      cacheControl: "private, max-age=31536000, immutable",
    },
    destinationPath: role === "original"
      ? destinationPaths.originalPath
      : destinationPaths.variants[role],
  }));
  return {
    schemaVersion: 1,
    sourceAssetId,
    destinationAssetId: destinationPlan.assetId,
    sourceFoeId: "foe-source",
    destinationFoeId: "foe-destination",
    sourceReferencePath: "foes/foe-source",
    destinationReferencePath: "foes/foe-destination",
    sourceManifestFingerprint: "f".repeat(64),
    sourceGeneration: "7",
    mediaOperationId: destinationPlan.operationId,
    destinationPlan,
    entries,
  };
};

class FakeCloneStorage {
  constructor(clone, failRole = null) {
    this.objects = new Map();
    this.failRole = failRole;
    this.failed = false;
    this.generation = 100;
    clone.entries.forEach((entry) => {
      this.objects.set(entry.source.path, {
        size: String(entry.source.bytes),
        contentType: entry.source.contentType,
        cacheControl: "private, max-age=31536000, immutable",
        contentDisposition: "inline",
        generation: entry.source.generation,
        crc32c: `crc-${entry.role}`,
        md5Hash: `md5-${entry.role}`,
        metadata: {
          ...buildTask07PrivateStorageMetadata({
            assetId: clone.sourceAssetId,
            entityId: clone.sourceFoeId,
            kind: "foe",
            ownerUid: "dm-source",
            role: entry.role,
          }),
          task07Checksum: entry.source.checksum,
        },
      });
    });
  }

  async exists(path) {
    return this.objects.has(path);
  }

  async getMetadata(path, generation) {
    const metadata = this.objects.get(path);
    if (!metadata || (generation && String(metadata.generation) !== generation)) {
      const error = new Error("missing");
      error.code = 404;
      throw error;
    }
    return structuredClone(metadata);
  }

  async copy(input) {
    const source = this.objects.get(input.sourcePath);
    if (!source) {
      const error = new Error("missing");
      error.code = 404;
      throw error;
    }
    const role = input.metadata.task07Role;
    if (!this.failed && role === this.failRole) {
      this.failed = true;
      const error = new Error("transient");
      error.code = 503;
      throw error;
    }
    if (this.objects.has(input.destinationPath)) {
      const error = new Error("exists");
      error.code = 412;
      throw error;
    }
    this.generation += 1;
    this.objects.set(input.destinationPath, {
      size: source.size,
      contentType: input.contentType,
      cacheControl: input.cacheControl,
      contentDisposition: input.contentDisposition,
      generation: String(this.generation),
      crc32c: source.crc32c,
      md5Hash: source.md5Hash,
      metadata: {...input.metadata},
    });
  }
}

test("canonical family copy rewrites ownership and replays exact objects", async () => {
  const clone = cloneFixture();
  const storage = new FakeCloneStorage(clone);
  const first = await copyTask07CanonicalMediaFamily({
    clone,
    concurrency: 2,
    storage,
  });
  assert.equal(first.copied, 5);
  assert.equal(first.reused, 0);
  assert.equal(first.generated.original.path, clone.entries[0].destinationPath);
  for (const entry of clone.entries) {
    const metadata = await storage.getMetadata(entry.destinationPath);
    assert.equal(metadata.metadata.task07AssetId, clone.destinationAssetId);
    assert.equal(metadata.metadata.task07EntityId, clone.destinationFoeId);
    assert.equal(metadata.metadata.task07OwnerUid, "dm-destination");
    assert.equal(metadata.metadata.firebaseStorageDownloadTokens, undefined);
  }

  const replay = await copyTask07CanonicalMediaFamily({
    clone,
    concurrency: 2,
    storage,
  });
  assert.equal(replay.copied, 0);
  assert.equal(replay.reused, 5);
  assert.deepEqual(replay.generated, first.generated);
});

test("partial canonical copies resume without replacing verified objects", async () => {
  const clone = cloneFixture();
  const storage = new FakeCloneStorage(clone, "card2x");
  await assert.rejects(
    copyTask07CanonicalMediaFamily({clone, concurrency: 1, storage}),
    (error) => error instanceof Task07MediaCloneStorageError && error.retryable
  );
  const before = new Map(storage.objects);
  const resumed = await copyTask07CanonicalMediaFamily({
    clone,
    concurrency: 1,
    storage,
  });
  assert.equal(resumed.copied, 1);
  assert.equal(resumed.reused, 4);
  clone.entries
    .filter(({role}) => role !== "card2x")
    .forEach(({destinationPath}) => {
      assert.deepEqual(storage.objects.get(destinationPath), before.get(destinationPath));
    });
});

test("a conflicting deterministic destination fails closed", async () => {
  const clone = cloneFixture();
  const storage = new FakeCloneStorage(clone);
  storage.objects.set(clone.entries[0].destinationPath, {
    size: "1",
    contentType: "image/png",
    cacheControl: "public, max-age=60",
    contentDisposition: "inline",
    generation: "99",
    metadata: {},
  });
  await assert.rejects(
    copyTask07CanonicalMediaFamily({clone, concurrency: 2, storage}),
    (error) => error instanceof Task07MediaCloneStorageError &&
      error.code === "destination-object-conflict" &&
      error.retryable === false
  );
});
