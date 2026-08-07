import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {mapWithConcurrency} from "./backendOperationCore";
import {
  Task07CanonicalCloneEntry,
  Task07CanonicalCloneRole,
  Task07FoeMediaClonePlan,
} from "./mediaAssetCloneCore";
import {
  buildTask07PrivateStorageMetadata,
  MEDIA_CONTRACT_VERSION,
  MEDIA_PRIVATE_CACHE_CONTROL,
  MEDIA_SCHEMA_VERSION,
  MediaVariantName,
  parseCanonicalMediaPath,
  validateTask07PrivateStorageMetadata,
} from "./mediaContracts";
import {StoredTask07MediaObject} from "./mediaTargetAdapters";

export interface Task07CloneObjectMetadata {
  size?: string | number;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  generation?: string | number;
  crc32c?: string;
  md5Hash?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface Task07MediaCloneStorage {
  exists(path: string): Promise<boolean>;
  getMetadata(path: string, generation?: string):
    Promise<Task07CloneObjectMetadata>;
  copy(input: {
    sourcePath: string;
    sourceGeneration: string;
    destinationPath: string;
    contentType: string;
    cacheControl: string;
    contentDisposition: string;
    metadata: Record<string, string>;
  }): Promise<void>;
}

export interface Task07CanonicalCloneResult {
  generated: {
    generation: string;
    original: StoredTask07MediaObject;
    variants: Partial<
      Record<MediaVariantName, StoredTask07MediaObject>
    >;
  };
  copied: number;
  reused: number;
}

export class Task07MediaCloneStorageError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "Task07MediaCloneStorageError";
    this.code = code;
    this.retryable = retryable;
  }
}

const errorStatus = (error: unknown): number => {
  if (!error || typeof error !== "object") return Number.NaN;
  return Number((error as {code?: unknown}).code);
};

const adminStorage = (): Task07MediaCloneStorage => {
  const bucket = getStorage().bucket();
  return {
    exists: async (path) => {
      const [exists] = await bucket.file(path).exists();
      return exists;
    },
    getMetadata: async (path, generation) => {
      const [metadata] = await bucket.file(
        path,
        generation ? {generation} : undefined
      ).getMetadata();
      return metadata as Task07CloneObjectMetadata;
    },
    copy: async (input) => {
      const source = bucket.file(input.sourcePath, {
        generation: input.sourceGeneration,
      });
      const destination = bucket.file(input.destinationPath);
      await source.copy(destination, {
        contentType: input.contentType,
        cacheControl: input.cacheControl,
        contentDisposition: input.contentDisposition,
        metadata: input.metadata,
        preconditionOpts: {ifGenerationMatch: 0},
      });
    },
  };
};

const expectedIdentity = (input: {
  clone: Task07FoeMediaClonePlan;
  entry: Task07CanonicalCloneEntry;
  destination: boolean;
}) => {
  if (input.destination) {
    return buildTask07PrivateStorageMetadata({
      assetId: input.clone.destinationAssetId,
      entityId: input.clone.destinationFoeId,
      kind: "foe",
      ownerUid: input.clone.destinationPlan.ownerUid,
      role: input.entry.role,
    });
  }
  const parsed = parseCanonicalMediaPath(input.entry.source.path);
  if (!parsed || parsed.assetId !== input.clone.sourceAssetId) {
    throw new Task07MediaCloneStorageError(
      "source-path-invalid",
      "Canonical clone source path is invalid.",
      false
    );
  }
  return buildTask07PrivateStorageMetadata({
    assetId: input.clone.sourceAssetId,
    entityId: input.clone.sourceFoeId,
    kind: "foe",
    ownerUid: parsed.ownerUid,
    role: input.entry.role,
  });
};

const assertMetadata = (input: {
  clone: Task07FoeMediaClonePlan;
  entry: Task07CanonicalCloneEntry;
  metadata: Task07CloneObjectMetadata;
  destination: boolean;
  sourceMetadata?: Task07CloneObjectMetadata;
}): StoredTask07MediaObject => {
  const descriptor = input.entry.source;
  const expected = expectedIdentity(input);
  const identity = validateTask07PrivateStorageMetadata({
    cacheControl: input.metadata.cacheControl,
    contentDisposition: input.metadata.contentDisposition,
    metadata: input.metadata.metadata,
    expected,
  });
  const expectedPath = input.destination ?
    input.entry.destinationPath : descriptor.path;
  const generation = String(input.metadata.generation || "");
  const metadataChecksum = String(
    input.metadata.metadata?.task07Checksum || ""
  );
  const sourceCrc = input.sourceMetadata?.crc32c;
  const sourceMd5 = input.sourceMetadata?.md5Hash;
  if (!identity.ok ||
    Number(input.metadata.size) !== descriptor.bytes ||
    input.metadata.contentType !== descriptor.contentType ||
    metadataChecksum !== descriptor.checksum ||
    !/^[1-9][0-9]*$/.test(generation) ||
    (!input.destination && generation !== descriptor.generation) ||
    (sourceCrc && input.metadata.crc32c !== sourceCrc) ||
    (sourceMd5 && input.metadata.md5Hash !== sourceMd5)) {
    throw new Task07MediaCloneStorageError(
      input.destination ?
        "destination-object-conflict" : "source-object-invalid",
      input.destination ?
        "Canonical clone destination conflicts with its plan." :
        "Canonical clone source metadata is invalid.",
      false
    );
  }
  return {
    ...descriptor,
    path: expectedPath,
    role: input.entry.role,
    generation,
    cacheControl: String(input.metadata.cacheControl || ""),
  };
};

const copyEntry = async (input: {
  clone: Task07FoeMediaClonePlan;
  entry: Task07CanonicalCloneEntry;
  storage: Task07MediaCloneStorage;
}): Promise<{object: StoredTask07MediaObject; copied: boolean}> => {
  let sourceMetadata: Task07CloneObjectMetadata;
  try {
    sourceMetadata = await input.storage.getMetadata(
      input.entry.source.path,
      input.entry.source.generation
    );
  } catch (error) {
    const missing = errorStatus(error) === 404;
    throw new Task07MediaCloneStorageError(
      missing ? "source-object-missing" : "source-metadata-unavailable",
      missing ?
        "Canonical clone source object is missing." :
        "Canonical clone source metadata is unavailable.",
      !missing
    );
  }
  assertMetadata({
    clone: input.clone,
    entry: input.entry,
    metadata: sourceMetadata,
    destination: false,
  });

  let existed: boolean;
  try {
    existed = await input.storage.exists(input.entry.destinationPath);
  } catch {
    throw new Task07MediaCloneStorageError(
      "destination-state-unavailable",
      "Canonical clone destination state is unavailable.",
      true
    );
  }
  if (!existed) {
    const destinationIdentity = expectedIdentity({
      clone: input.clone,
      entry: input.entry,
      destination: true,
    });
    try {
      await input.storage.copy({
        sourcePath: input.entry.source.path,
        sourceGeneration: input.entry.source.generation,
        destinationPath: input.entry.destinationPath,
        contentType: input.entry.source.contentType,
        cacheControl: MEDIA_PRIVATE_CACHE_CONTROL,
        contentDisposition: "inline",
        metadata: {
          ...destinationIdentity,
          task07Checksum: input.entry.source.checksum,
        },
      });
    } catch (error) {
      const sourceMissing = errorStatus(error) === 404;
      const raced = !sourceMissing && await input.storage
        .exists(input.entry.destinationPath)
        .catch(() => false);
      if (!raced) {
        throw new Task07MediaCloneStorageError(
          sourceMissing ? "source-object-missing" : "storage-copy-failed",
          sourceMissing ?
            "Canonical clone source object is missing." :
            "Canonical media copy failed.",
          !sourceMissing
        );
      }
      existed = true;
    }
  }
  let destinationMetadata: Task07CloneObjectMetadata;
  try {
    destinationMetadata = await input.storage.getMetadata(
      input.entry.destinationPath
    );
  } catch {
    throw new Task07MediaCloneStorageError(
      "destination-metadata-unavailable",
      "Canonical clone destination metadata is unavailable.",
      true
    );
  }
  const object = assertMetadata({
    clone: input.clone,
    entry: input.entry,
    metadata: destinationMetadata,
    destination: true,
    sourceMetadata,
  });
  return {object, copied: !existed};
};

export const copyTask07CanonicalMediaFamily = async (input: {
  clone: Task07FoeMediaClonePlan;
  concurrency: number;
  storage?: Task07MediaCloneStorage;
  onCopy?: () => void;
}): Promise<Task07CanonicalCloneResult> => {
  const storage = input.storage || adminStorage();
  const copied = await mapWithConcurrency(
    input.clone.entries,
    input.concurrency,
    async (entry) => {
      const result = await copyEntry({clone: input.clone, entry, storage});
      if (result.copied) input.onCopy?.();
      return result;
    }
  );
  const originalEntry = copied.find((_, index) =>
    input.clone.entries[index].role === "original");
  if (!originalEntry) {
    throw new Task07MediaCloneStorageError(
      "destination-original-missing",
      "Canonical clone original is missing.",
      false
    );
  }
  const variants: Partial<
    Record<MediaVariantName, StoredTask07MediaObject>
  > = {};
  copied.forEach(({object}, index) => {
    const role: Task07CanonicalCloneRole = input.clone.entries[index].role;
    if (role !== "original") variants[role] = object;
  });
  return {
    generated: {
      generation: input.clone.sourceGeneration,
      original: originalEntry.object,
      variants,
    },
    copied: copied.filter((entry) => entry.copied).length,
    reused: copied.filter((entry) => !entry.copied).length,
  };
};

export const buildTask07MediaCloneManifest = (input: {
  clone: Task07FoeMediaClonePlan;
  now: Timestamp;
  leaseExpiresAt: Timestamp;
  cleanupAfter: Timestamp;
  attempt: number;
}): admin.firestore.DocumentData => {
  const plan = input.clone.destinationPlan;
  const original = input.clone.entries.find(({role}) => role === "original");
  if (!original) {
    throw new Task07MediaCloneStorageError(
      "source-original-missing",
      "Canonical clone source original is missing.",
      false
    );
  }
  return {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    policyVersion: MEDIA_CONTRACT_VERSION,
    assetId: plan.assetId,
    generation: input.clone.sourceGeneration,
    state: "processing",
    purpose: plan.kind,
    audience: plan.audienceScope,
    ownerUid: plan.ownerUid,
    actorUid: plan.actorUid,
    targetKind: plan.targetKind,
    targetId: plan.entityId,
    previousAssetId: plan.previousAssetId,
    requestHash: plan.requestHash,
    plan,
    source: {
      mode: "canonical-clone",
      path: original.source.path,
      generation: original.source.generation,
      mime: original.source.contentType,
      bytes: original.source.bytes,
      checksum: original.source.checksum,
      clonedFromAssetId: input.clone.sourceAssetId,
    },
    variants: {},
    attachment: null,
    clone: input.clone,
    processing: {
      mode: "canonical-clone",
      sourceAssetId: input.clone.sourceAssetId,
      leaseUntil: input.leaseExpiresAt,
    },
    retention: {cleanupAfter: input.cleanupAfter},
    error: {code: null, retryable: false, attempts: input.attempt},
    createdAt: input.now,
    updatedAt: input.now,
  };
};

export const task07MediaCloneProcessingPatch = (input: {
  clone: Task07FoeMediaClonePlan;
  now: Timestamp;
  leaseExpiresAt: Timestamp;
  cleanupAfter: Timestamp;
  attempt: number;
}): admin.firestore.UpdateData<admin.firestore.DocumentData> => ({
  state: "processing",
  generation: input.clone.sourceGeneration,
  clone: input.clone,
  processing: {
    mode: "canonical-clone",
    sourceAssetId: input.clone.sourceAssetId,
    leaseUntil: input.leaseExpiresAt,
  },
  retention: {cleanupAfter: input.cleanupAfter},
  error: {code: null, retryable: false, attempts: input.attempt},
  updatedAt: input.now,
});

export const task07MediaCloneReadyPatch = (input: {
  clone: Task07FoeMediaClonePlan;
  result: Task07CanonicalCloneResult;
  now: Timestamp;
  cleanupAfter: Timestamp;
  attempt: number;
}): admin.firestore.UpdateData<admin.firestore.DocumentData> => ({
  schemaVersion: MEDIA_SCHEMA_VERSION,
  policyVersion: MEDIA_CONTRACT_VERSION,
  state: "ready",
  generation: input.clone.sourceGeneration,
  generated: input.result.generated,
  processing: FieldValue.delete(),
  cleanupTemporaryPaths: FieldValue.delete(),
  error: {code: null, retryable: false, attempts: input.attempt},
  retention: {cleanupAfter: input.cleanupAfter},
  updatedAt: input.now,
});
