import {getStorage} from "firebase-admin/storage";
import {isSafeOwnedStoragePath} from "./backendOperationCore";
import {asRecord, asTrimmedString} from "./userDataV2";

export type LegacyFoeCopyOutcome = "copied" | "reused" | "missing";

export interface LegacyFoeCopyManifestEntry {
  key: string;
  sourcePath: string;
  destinationPath: string;
  downloadToken: string;
  sourceKnownPresent?: boolean;
}

export const applyLegacyFoeSourcePresenceCheckpoint = (
  manifest: LegacyFoeCopyManifestEntry[],
  presentSourcePaths: ReadonlySet<string>
): LegacyFoeCopyManifestEntry[] => manifest.map((entry) => ({
  ...entry,
  sourceKnownPresent: entry.sourceKnownPresent === true ||
    presentSourcePaths.has(entry.sourcePath),
}));

export interface LegacyFoeCopyResult {
  outcome: LegacyFoeCopyOutcome;
  key: string;
  path: string;
  url: string;
}

export interface LegacyFoeObjectMetadata {
  size?: string | number;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface LegacyFoeCopyStorageAdapter {
  bucketName: string;
  exists(path: string): Promise<boolean>;
  copy(sourcePath: string, destinationPath: string): Promise<void>;
  getMetadata(path: string): Promise<LegacyFoeObjectMetadata>;
  setMetadata(
    path: string,
    metadata: LegacyFoeObjectMetadata
  ): Promise<void>;
  isNotFound(error: unknown): boolean;
}

export class LegacyFoeCopyStorageError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "LegacyFoeCopyStorageError";
    this.code = code;
    this.retryable = retryable;
  }
}

const firebaseDownloadUrl = (
  bucket: string,
  path: string,
  token: string
): string => (
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/` +
  `${encodeURIComponent(path)}?alt=media&token=${token}`
);

const adminStorageAdapter = (): LegacyFoeCopyStorageAdapter => {
  const bucket = getStorage().bucket();
  return {
    bucketName: bucket.name,
    exists: async (path) => {
      const [exists] = await bucket.file(path).exists();
      return exists;
    },
    copy: async (sourcePath, destinationPath) => {
      await bucket.file(sourcePath).copy(bucket.file(destinationPath));
    },
    getMetadata: async (path) => {
      const [metadata] = await bucket.file(path).getMetadata();
      return metadata as LegacyFoeObjectMetadata;
    },
    setMetadata: async (path, metadata) => {
      const file = bucket.file(path);
      await file.setMetadata(
        metadata as Parameters<typeof file.setMetadata>[0]
      );
    },
    isNotFound: (error) => {
      if (!error || typeof error !== "object") return false;
      const record = error as {
        code?: unknown;
        errors?: Array<{reason?: unknown}>;
      };
      return Number(record.code) === 404 ||
        record.code === "storage/object-not-found" ||
        record.errors?.some(({reason}) => reason === "notFound") === true;
    },
  };
};

const tokenMatches = (metadata: LegacyFoeObjectMetadata, token: string) => {
  const custom = asRecord(metadata.metadata);
  const tokens = asTrimmedString(
    custom.firebaseStorageDownloadTokens
  ).split(",").map((value) => value.trim()).filter(Boolean);
  return custom.task06OperationOwned === "true" &&
    tokens.includes(token) &&
    Number(metadata.size) > 0 &&
    Boolean(asTrimmedString(metadata.contentType));
};

const existingResult = async (input: {
  entry: LegacyFoeCopyManifestEntry;
  storage: LegacyFoeCopyStorageAdapter;
}): Promise<LegacyFoeCopyResult> => {
  let metadata: LegacyFoeObjectMetadata;
  try {
    metadata = await input.storage.getMetadata(input.entry.destinationPath);
  } catch (error) {
    throw new LegacyFoeCopyStorageError(
      "legacy-destination-metadata-unavailable",
      "Legacy foe copy destination metadata is unavailable.",
      true
    );
  }
  if (!tokenMatches(metadata, input.entry.downloadToken)) {
    throw new LegacyFoeCopyStorageError(
      "legacy-destination-conflict",
      "Legacy foe copy destination conflicts with its receipt.",
      false
    );
  }
  return {
    outcome: "reused",
    key: input.entry.key,
    path: input.entry.destinationPath,
    url: firebaseDownloadUrl(
      input.storage.bucketName,
      input.entry.destinationPath,
      input.entry.downloadToken
    ),
  };
};

const destinationExists = async (
  storage: LegacyFoeCopyStorageAdapter,
  path: string
): Promise<boolean> => {
  try {
    return await storage.exists(path);
  } catch {
    throw new LegacyFoeCopyStorageError(
      "legacy-destination-state-unavailable",
      "Legacy foe copy destination state is unavailable.",
      true
    );
  }
};

export const copyLegacyFoeManifestEntry = async (input: {
  entry: LegacyFoeCopyManifestEntry;
  storage?: LegacyFoeCopyStorageAdapter;
}): Promise<LegacyFoeCopyResult> => {
  const {entry} = input;
  const storage = input.storage || adminStorageAdapter();
  if (!isSafeOwnedStoragePath(entry.sourcePath, ["foes/"]) ||
    !isSafeOwnedStoragePath(entry.destinationPath, ["foes/operations/"])) {
    throw new LegacyFoeCopyStorageError(
      "legacy-copy-path-invalid",
      "Legacy foe copy path is unsafe.",
      false
    );
  }
  if (await destinationExists(storage, entry.destinationPath)) {
    return existingResult({entry, storage});
  }

  // A persisted false value is the operation's plan-time observation. Do not
  // re-probe it here: an object that appears after planning is outside this
  // operation, while a known-present object must never degrade into missing.
  if (entry.sourceKnownPresent === false) {
    return {outcome: "missing", key: entry.key, path: "", url: ""};
  }

  let sourceExists: boolean;
  try {
    sourceExists = await storage.exists(entry.sourcePath);
  } catch {
    throw new LegacyFoeCopyStorageError(
      "legacy-source-state-unavailable",
      "Legacy foe copy source state is unavailable.",
      true
    );
  }
  if (!sourceExists) {
    if (entry.sourceKnownPresent === true) {
      throw new LegacyFoeCopyStorageError(
        "legacy-source-missing-after-plan",
        "Legacy foe media disappeared after copy planning.",
        true
      );
    }
    return {outcome: "missing", key: entry.key, path: "", url: ""};
  }

  try {
    await storage.copy(entry.sourcePath, entry.destinationPath);
  } catch (error) {
    const racedDestination = await destinationExists(
      storage,
      entry.destinationPath
    );
    if (racedDestination) return existingResult({entry, storage});
    if (storage.isNotFound(error)) {
      throw new LegacyFoeCopyStorageError(
        "legacy-source-disappeared",
        "Legacy foe media disappeared while it was being copied.",
        true
      );
    }
    throw new LegacyFoeCopyStorageError(
      "legacy-storage-copy-failed",
      "Legacy foe media copy failed.",
      true
    );
  }

  let destinationMetadata: LegacyFoeObjectMetadata;
  try {
    destinationMetadata = await storage.getMetadata(entry.destinationPath);
    await storage.setMetadata(entry.destinationPath, {
      ...(destinationMetadata.contentType ? {
        contentType: destinationMetadata.contentType,
      } : {}),
      cacheControl: "private, max-age=31536000, immutable",
      metadata: {
        ...asRecord(destinationMetadata.metadata),
        firebaseStorageDownloadTokens: entry.downloadToken,
        task06OperationOwned: "true",
      },
    });
  } catch {
    throw new LegacyFoeCopyStorageError(
      "legacy-destination-finalize-failed",
      "Legacy foe copy destination could not be finalized.",
      true
    );
  }
  return {
    outcome: "copied",
    key: entry.key,
    path: entry.destinationPath,
    url: firebaseDownloadUrl(
      storage.bucketName,
      entry.destinationPath,
      entry.downloadToken
    ),
  };
};
