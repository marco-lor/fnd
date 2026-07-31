import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {onObjectFinalized} from "firebase-functions/v2/storage";
import {Readable} from "stream";
import {
  asStoredTask07MediaUploadPlan,
  MediaUploadPlan,
} from "./mediaAssetLifecycleCore";
import {
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_PROCESSING_MAX_AUTO_ATTEMPTS,
  MEDIA_SCHEMA_VERSION,
  MediaVariantName,
  parseTask07StagingPath,
} from "./mediaContracts";
import {
  processTask07MediaSource,
  task07ProcessorClaimDecision,
  task07ProcessorFailureCleanupPaths,
  Task07GeneratedObject,
  Task07ProcessorError,
  validateTask07StagingMetadata,
} from "./mediaAssetProcessorCore";
import {createTask07DefaultMediaTransformer} from "./mediaProcessorRuntime";

const PROCESSOR_OPTIONS = {
  region: "europe-west8",
  cpu: 1,
  concurrency: 1,
  maxInstances: 1,
  memory: "1GiB" as const,
  timeoutSeconds: 540,
  retry: true,
};

const assetRef = (
  db: admin.firestore.Firestore,
  assetId: string
): admin.firestore.DocumentReference =>
  db.doc(`media_assets/${assetId}`);

const cleanupRef = (
  db: admin.firestore.Firestore,
  assetId: string
): admin.firestore.DocumentReference =>
  db.doc(`media_asset_cleanup/${assetId}`);

const timestampMillis = (value: unknown): number => {
  if (value instanceof Timestamp) return value.toMillis();
  return Number.NaN;
};

const readSourceWithHardCap = async (input: {
  file: {
    createReadStream(options: {validation: "crc32c"}): Readable;
  };
  expectedBytes: number;
  maxBytes: number;
}): Promise<Buffer> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const stream = input.file.createReadStream({
    validation: "crc32c",
  });
  stream.on("data", (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes > input.expectedBytes || bytes > input.maxBytes) {
      stream.destroy(new Task07ProcessorError(
        "source-byte-budget-exceeded"
      ));
      return;
    }
    chunks.push(chunk);
  });
  stream.on("error", reject);
  stream.on("end", () => {
    if (bytes !== input.expectedBytes) {
      reject(new Task07ProcessorError("source-byte-size-mismatch"));
      return;
    }
    resolve(Buffer.concat(chunks, bytes));
  });
});

type ClaimIntentResult =
  {status: "ack" | "terminal"} |
  {status: "claimed"; attempt: number; plan: MediaUploadPlan};

const claimIntent = async (input: {
  db: admin.firestore.Firestore;
  assetId: string;
  ownerUid: string;
  sourcePath: string;
  sourceGeneration: string;
}): Promise<ClaimIntentResult> => {
  const ref = assetRef(input.db, input.assetId);
  return input.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const plan = asStoredTask07MediaUploadPlan(snapshot.get("plan"));
    if (!snapshot.exists || !plan ||
      plan.assetId !== input.assetId ||
      plan.ownerUid !== input.ownerUid ||
      plan.sourcePath !== input.sourcePath) {
      return {status: "terminal"};
    }
    const state = String(snapshot.get("state") || "");
    const expiresAtMs = timestampMillis(snapshot.get("retention.cleanupAfter"));
    const activeGeneration = String(
      snapshot.get("processing.sourceGeneration") || ""
    );
    const leaseUntilMs = timestampMillis(
      snapshot.get("processing.leaseUntil")
    );
    const decision = task07ProcessorClaimDecision({
      state,
      attempts: snapshot.get("error.attempts"),
      expiresAtMs,
      leaseUntilMs,
      activeGeneration,
      sourceGeneration: input.sourceGeneration,
      nowMs: Date.now(),
    });
    if (decision.action === "ack") return {status: "ack"};
    if (decision.action === "retry") {
      throw new Task07ProcessorError(decision.code, true);
    }
    if (decision.action === "terminal") {
      const queueRef = cleanupRef(input.db, input.assetId);
      const queue = await transaction.get(queueRef);
      const now = Timestamp.now();
      transaction.update(ref, {
        state: state === "cancelled" ? "cancelled" : "rejected",
        processing: FieldValue.delete(),
        retention: {cleanupAfter: now},
        error: {
          code: decision.code,
          retryable: false,
          attempts: decision.attempt,
        },
        updatedAt: now,
      });
      if (!queue.exists) {
        transaction.create(queueRef, {
          schemaVersion: MEDIA_SCHEMA_VERSION,
          assetId: input.assetId,
          state: "pending",
          reason: decision.code,
          attempts: 0,
          cleanupAfter: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      return {status: "terminal"};
    }
    const attempt = decision.attempt;
    const now = Timestamp.now();
    transaction.update(ref, {
      state: "processing",
      generation: input.sourceGeneration,
      processing: {
        sourceGeneration: input.sourceGeneration,
        leaseUntil: Timestamp.fromMillis(
          Date.now() + 15 * 60 * 1000
        ),
      },
      error: {
        code: null,
        retryable: false,
        attempts: attempt,
      },
      updatedAt: now,
    });
    return {status: "claimed", attempt, plan};
  });
};

type StoredGeneratedDescriptor = Omit<Task07GeneratedObject, "buffer"> & {
  bytes: number;
  generation: string;
  cacheControl: string;
};

const uploadGeneratedSet = async (input: {
  assetId: string;
  eventId: string;
  objects: Task07GeneratedObject[];
  plan: MediaUploadPlan;
}): Promise<{
  original: StoredGeneratedDescriptor;
  variants: Partial<Record<MediaVariantName, StoredGeneratedDescriptor>>;
  temporaryPaths: string[];
  finalPaths: string[];
}> => {
  const bucket = getStorage().bucket();
  const temporaryPaths: string[] = [];
  const finalPaths: string[] = [];
  const uploaded = new Map<string, StoredGeneratedDescriptor>();
  try {
    for (const object of input.objects) {
    const temporaryPath = `${object.path}.tmp-${input.eventId}`;
    temporaryPaths.push(temporaryPath);
    const customMetadata = {
      task07AssetId: input.plan.assetId,
      task07ContractVersion: String(MEDIA_CONTRACT_VERSION),
      task07EntityId: input.plan.entityId,
      task07Kind: input.plan.kind,
      task07OwnerUid: input.plan.ownerUid,
      task07Role: object.role,
      task07Checksum: object.checksum,
    };
    await bucket.file(temporaryPath).save(object.buffer, {
      resumable: false,
      validation: "crc32c",
      preconditionOpts: {ifGenerationMatch: 0},
      metadata: {
        contentType: object.contentType,
        cacheControl: "private, max-age=31536000, immutable",
        contentDisposition: "inline",
        metadata: customMetadata,
      },
    });
    const [temporaryMetadata] = await bucket.file(temporaryPath).getMetadata();
    if (Number(temporaryMetadata.size) !== object.buffer.byteLength ||
      temporaryMetadata.contentType !== object.contentType ||
      temporaryMetadata.metadata?.task07Checksum !== object.checksum) {
      throw new Task07ProcessorError("temporary-output-verification-failed");
    }
    }
    for (const object of input.objects) {
    const temporaryPath = `${object.path}.tmp-${input.eventId}`;
    const destination = bucket.file(object.path);
    try {
      await bucket.file(temporaryPath).copy(destination, {
        preconditionOpts: {ifGenerationMatch: 0},
      });
    } catch (error) {
      const [exists] = await destination.exists();
      if (!exists) throw error;
    }
    finalPaths.push(object.path);
    const [metadata] = await destination.getMetadata();
    if (Number(metadata.size) !== object.buffer.byteLength ||
      metadata.contentType !== object.contentType ||
      metadata.metadata?.task07Checksum !== object.checksum ||
      metadata.metadata?.task07AssetId !== input.assetId ||
      !/^[1-9][0-9]*$/.test(String(metadata.generation))) {
      throw new Task07ProcessorError("promoted-output-verification-failed");
    }
    const descriptor: StoredGeneratedDescriptor = {
      path: object.path,
      contentType: object.contentType,
      bytes: object.buffer.byteLength,
      width: object.width,
      height: object.height,
      durationMs: object.durationMs,
      orientationDegrees: object.orientationDegrees,
      checksum: object.checksum,
      role: object.role,
      generation: String(metadata.generation),
      cacheControl: String(metadata.cacheControl || ""),
    };
    uploaded.set(object.path, descriptor);
    }
    const originalObject = input.objects.find(({role}) => role === "original");
    const original = originalObject && uploaded.get(originalObject.path);
    if (!original) {
      throw new Task07ProcessorError("promoted-original-missing");
    }
    const variants: Partial<
      Record<MediaVariantName, StoredGeneratedDescriptor>
    > = {};
    input.objects.forEach((object) => {
      if (object.role !== "original") {
        variants[object.role] = uploaded.get(object.path);
      }
    });
    return {
      original,
      variants,
      temporaryPaths,
      finalPaths,
    };
  } catch (error) {
    await deletePaths(task07ProcessorFailureCleanupPaths({
      temporaryPaths,
      promotedPaths: finalPaths,
    }));
    throw error;
  }
};

const deletePaths = async (paths: readonly string[]): Promise<void> => {
  const bucket = getStorage().bucket();
  await Promise.all(paths.map(async (path) => {
    try {
      await bucket.file(path).delete({ignoreNotFound: true});
    } catch {
      // Cleanup is retried by the ledger/sweeper; never replace the root error.
    }
  }));
};

const markFailure = async (input: {
  assetId: string;
  attempt: number;
  code: string;
  retryable: boolean;
  sourceGeneration: string;
  temporaryPaths: readonly string[];
}): Promise<void> => {
  const db = admin.firestore();
  const ref = assetRef(db, input.assetId);
  await db.runTransaction(async (transaction) => {
    const [snapshot, queue] = await transaction.getAll(
      ref,
      cleanupRef(db, input.assetId)
    );
    if (!snapshot.exists ||
      snapshot.get("state") !== "processing" ||
      String(snapshot.get("generation")) !== input.sourceGeneration ||
      Number(snapshot.get("error.attempts")) !== input.attempt) return;
    const now = Timestamp.now();
    const manifestUpdate: admin.firestore.UpdateData<
      admin.firestore.DocumentData
    > = {
      state: input.retryable ? "failed" : "rejected",
      processing: FieldValue.delete(),
      error: {
        code: input.code,
        retryable: input.retryable,
        attempts: input.attempt,
      },
      cleanupTemporaryPaths: [...new Set(input.temporaryPaths)],
      updatedAt: now,
    };
    if (!input.retryable) manifestUpdate.retention = {cleanupAfter: now};
    transaction.update(ref, manifestUpdate);
    if (!input.retryable && !queue.exists) {
      transaction.create(cleanupRef(db, input.assetId), {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId: input.assetId,
        state: "pending",
        reason: input.code,
        attempts: 0,
        cleanupAfter: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
};

export const task07ProcessMediaUpload = onObjectFinalized(
  PROCESSOR_OPTIONS,
  async (event) => {
    const object = event.data;
    const parsed = parseTask07StagingPath(object.name);
    if (!parsed || !object.generation) return;
    const sourceGeneration = String(object.generation);
    const db = admin.firestore();
    const sourceFile = getStorage().bucket(object.bucket).file(parsed.path, {
      generation: sourceGeneration,
      preconditionOpts: {ifGenerationMatch: sourceGeneration},
    });
    const claim = await claimIntent({
      db,
      assetId: parsed.assetId,
      ownerUid: parsed.ownerUid,
      sourcePath: parsed.path,
      sourceGeneration,
    });
    if (claim.status !== "claimed") {
      await sourceFile.delete({ignoreNotFound: true}).catch(() => undefined);
      return;
    }
    const claimed = claim;
    const temporaryPaths: string[] = [];
    const finalPaths: string[] = [];
    try {
      const [metadata] = await sourceFile.getMetadata();
      validateTask07StagingMetadata({plan: claimed.plan, metadata});
      const source = await readSourceWithHardCap({
        file: sourceFile,
        expectedBytes: claimed.plan.sourceBytes,
        maxBytes: MEDIA_CONTRACTS[claimed.plan.kind].source.maxBytes,
      });
      const result = await processTask07MediaSource({
        plan: {
          assetId: claimed.plan.assetId,
          kind: claimed.plan.kind,
          ownerUid: claimed.plan.ownerUid,
          ownerKey: claimed.plan.ownerKey,
          entityId: claimed.plan.entityId,
          audienceScope: claimed.plan.audienceScope,
          sourceContentType: claimed.plan.sourceContentType,
          sourceBytes: claimed.plan.sourceBytes,
        },
        sourceGeneration,
        source,
        transformer: createTask07DefaultMediaTransformer(),
      });
      const eventId = event.id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 96);
      temporaryPaths.push(...result.objects.map(
        ({path}) => `${path}.tmp-${eventId}`
      ));
      finalPaths.push(...result.objects.map(({path}) => path));
      const promoted = await uploadGeneratedSet({
        assetId: claimed.plan.assetId,
        eventId,
        objects: result.objects,
        plan: claimed.plan,
      });
      const ref = assetRef(db, claimed.plan.assetId);
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (!current.exists ||
          current.get("state") !== "processing" ||
          String(current.get("generation")) !== sourceGeneration ||
          Number(current.get("error.attempts")) !== claimed.attempt) {
          throw new Task07ProcessorError("processor-claim-lost", true);
        }
        transaction.update(ref, {
          schemaVersion: MEDIA_SCHEMA_VERSION,
          policyVersion: MEDIA_CONTRACT_VERSION,
          state: "ready",
          source: {
            path: parsed.path,
            generation: sourceGeneration,
            ...result.source,
          },
          generated: {
            generation: sourceGeneration,
            original: promoted.original,
            variants: promoted.variants,
          },
          processing: FieldValue.delete(),
          cleanupTemporaryPaths: FieldValue.delete(),
          error: {
            code: null,
            retryable: false,
            attempts: claimed.attempt,
          },
          retention: {
            cleanupAfter: Timestamp.fromMillis(
              Date.now() +
              MEDIA_CONTRACTS[claimed.plan.kind].retention.uncommittedHours *
              60 * 60 * 1000
            ),
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await deletePaths(temporaryPaths);
      // The ready manifest is the commit point. Staging cleanup after that
      // point is best-effort and must not turn a successful commit into a
      // processor failure with ambiguous ownership of canonical outputs.
      await sourceFile.delete({ignoreNotFound: true}).catch(() => undefined);
    } catch (error) {
      await deletePaths(task07ProcessorFailureCleanupPaths({
        temporaryPaths,
        promotedPaths: finalPaths,
      }));
      const processorError = error instanceof Task07ProcessorError ?
        error :
        new Task07ProcessorError("processor-internal-failure", true);
      const retryable = processorError.retryable &&
        claimed.attempt < MEDIA_PROCESSING_MAX_AUTO_ATTEMPTS;
      await markFailure({
        assetId: claimed.plan.assetId,
        attempt: claimed.attempt,
        code: processorError.code,
        retryable,
        sourceGeneration,
        temporaryPaths,
      });
      if (!retryable) {
        await sourceFile.delete({ignoreNotFound: true}).catch(() => undefined);
        return;
      }
      throw processorError;
    }
  }
);
