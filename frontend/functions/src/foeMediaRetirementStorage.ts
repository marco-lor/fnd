import {createHash} from "crypto";
import {getStorage} from "firebase-admin/storage";
import {mapWithConcurrency} from "./backendOperationCore";
import {
  FoeRetirementResolvedUpload,
  FoeRetirementUploadPlan,
} from "./foeMediaRetirementCore";
import {asRecord, asTrimmedString} from "./userDataV2";

export const TASK07_FOE_UPLOAD_VERIFY_CONCURRENCY = 2;
export const TASK07_FOE_UPLOAD_CACHE_CONTROL =
  "private, max-age=31536000, immutable";

export interface FoeRetirementObjectMetadata {
  size?: string | number;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  generation?: string | number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface FoeRetirementStorageAdapter {
  bucketName: string;
  getMetadata(
    path: string,
    generation?: string
  ): Promise<FoeRetirementObjectMetadata>;
  digest(path: string, generation: string, maxBytes: number): Promise<{
    bytes: number;
    sha256: string;
  }>;
  deleteGeneration(path: string, generation: string): Promise<void>;
  isNotFound(error: unknown): boolean;
}

export class FoeRetirementStorageError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "FoeRetirementStorageError";
    this.code = code;
    this.retryable = retryable;
  }
}

const errorStatus = (error: unknown): number => {
  if (!error || typeof error !== "object") return Number.NaN;
  return Number((error as {code?: unknown}).code);
};

export const adminFoeRetirementStorage =
(): FoeRetirementStorageAdapter => {
  const bucket = getStorage().bucket();
  return {
    bucketName: bucket.name,
    getMetadata: async (path, generation) => {
      const [metadata] = await bucket.file(
        path,
        generation ? {generation} : undefined
      ).getMetadata();
      return metadata as FoeRetirementObjectMetadata;
    },
    digest: (path, generation, maxBytes) => new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      let bytes = 0;
      const stream = bucket.file(path, {generation}).createReadStream({
        validation: true,
      });
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          stream.destroy(new Error("foe-upload-byte-limit-exceeded"));
          return;
        }
        hash.update(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve({
        bytes,
        sha256: hash.digest("hex"),
      }));
    }),
    deleteGeneration: async (path, generation) => {
      await bucket.file(path, {generation}).delete({ignoreNotFound: true});
    },
    isNotFound: (error) => errorStatus(error) === 404 ||
      Boolean(error && typeof error === "object" &&
        (error as {code?: unknown}).code === "storage/object-not-found"),
  };
};

const firebaseDownloadUrl = (
  bucket: string,
  path: string,
  token: string
): string => (
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/` +
  `${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`
);

const expectedMetadataMatches = (input: {
  plan: FoeRetirementUploadPlan;
  metadata: FoeRetirementObjectMetadata;
}): {generation: string; token: string} => {
  const custom = asRecord(input.metadata.metadata);
  const token = asTrimmedString(custom.firebaseStorageDownloadTokens)
    .split(",")
    .map((value) => value.trim())
    .find(Boolean) || "";
  const actualKeys = Object.keys(custom)
    .filter((key) => (
      key !== "firebaseStorageDownloadTokens" &&
      custom[key] !== undefined
    ))
    .sort();
  const expectedKeys = Object.keys(input.plan.metadata).sort();
  const generation = String(input.metadata.generation || "");
  const exactCustomMetadata = actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    Object.entries(input.plan.metadata).every(([key, value]) => (
      custom[key] === value
    ));
  if (!token || !/^[1-9][0-9]*$/.test(generation) ||
    Number(input.metadata.size) !== input.plan.bytes ||
    input.metadata.contentType !== input.plan.contentType ||
    input.metadata.cacheControl !== TASK07_FOE_UPLOAD_CACHE_CONTROL ||
    input.metadata.contentDisposition !== "inline" ||
    !exactCustomMetadata) {
    throw new FoeRetirementStorageError(
      "foe-upload-metadata-mismatch",
      "Foe upload metadata does not match its receipt.",
      false
    );
  }
  return {generation, token};
};

const verifyOne = async (input: {
  plan: FoeRetirementUploadPlan;
  storage: FoeRetirementStorageAdapter;
}): Promise<FoeRetirementResolvedUpload> => {
  let initial: FoeRetirementObjectMetadata;
  try {
    initial = await input.storage.getMetadata(input.plan.path);
  } catch (error) {
    throw new FoeRetirementStorageError(
      input.storage.isNotFound(error) ?
        "foe-upload-missing" : "foe-upload-metadata-unavailable",
      input.storage.isNotFound(error) ?
        "A required foe upload is missing." :
        "Foe upload metadata is temporarily unavailable.",
      !input.storage.isNotFound(error)
    );
  }
  const identity = expectedMetadataMatches({plan: input.plan, metadata: initial});
  let digest: {bytes: number; sha256: string};
  try {
    digest = await input.storage.digest(
      input.plan.path,
      identity.generation,
      input.plan.bytes
    );
  } catch (error) {
    throw new FoeRetirementStorageError(
      input.storage.isNotFound(error) ?
        "foe-upload-generation-changed" : "foe-upload-read-failed",
      input.storage.isNotFound(error) ?
        "Foe upload generation changed during verification." :
        "Foe upload could not be verified.",
      !input.storage.isNotFound(error)
    );
  }
  if (digest.bytes !== input.plan.bytes ||
    digest.sha256 !== input.plan.sha256) {
    throw new FoeRetirementStorageError(
      "foe-upload-content-mismatch",
      "Foe upload content does not match its digest.",
      false
    );
  }
  let current: FoeRetirementObjectMetadata;
  try {
    current = await input.storage.getMetadata(input.plan.path);
  } catch (error) {
    throw new FoeRetirementStorageError(
      input.storage.isNotFound(error) ?
        "foe-upload-generation-changed" : "foe-upload-metadata-unavailable",
      "Foe upload generation could not be fenced.",
      !input.storage.isNotFound(error)
    );
  }
  if (String(current.generation || "") !== identity.generation) {
    throw new FoeRetirementStorageError(
      "foe-upload-generation-changed",
      "Foe upload generation changed during verification.",
      false
    );
  }
  expectedMetadataMatches({plan: input.plan, metadata: current});
  return {
    key: input.plan.key,
    path: input.plan.path,
    url: firebaseDownloadUrl(
      input.storage.bucketName,
      input.plan.path,
      identity.token
    ),
    generation: identity.generation,
  };
};

export const verifyFoeRetirementUploads = async (input: {
  plans: FoeRetirementUploadPlan[];
  storage?: FoeRetirementStorageAdapter;
}): Promise<FoeRetirementResolvedUpload[]> => {
  const storage = input.storage || adminFoeRetirementStorage();
  return mapWithConcurrency(
    input.plans,
    TASK07_FOE_UPLOAD_VERIFY_CONCURRENCY,
    (plan) => verifyOne({plan, storage})
  );
};
