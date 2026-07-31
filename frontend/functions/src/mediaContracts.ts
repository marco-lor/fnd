import {createHash} from "crypto";
import mediaPolicy from "./mediaPolicy.json";

export const MEDIA_SCHEMA_VERSION = 1;
export const MEDIA_CONTRACT_VERSION = mediaPolicy.policyVersion;
export const MEDIA_UPLOAD_ROOT = "media_uploads";
export const MEDIA_ROOT = `media_assets/v${MEDIA_SCHEMA_VERSION}`;
export const MEDIA_PRIVATE_CACHE_CONTROL = mediaPolicy.privateCacheControl;
export const MEDIA_STAGING_CACHE_CONTROL = mediaPolicy.stagingCacheControl;
export const MEDIA_UNCOMMITTED_RETENTION_HOURS =
  mediaPolicy.retention.unattachedHours;
export const MEDIA_CLEANUP_CONCURRENCY = 2;
export const MEDIA_ORPHAN_SWEEP_BATCH_SIZE = 100;
export const MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS =
  mediaPolicy.retention.cleanupMaxAttempts;
export const MEDIA_PROCESSING_MAX_AUTO_ATTEMPTS =
  mediaPolicy.retention.cleanupMaxAttempts;
export const MEDIA_PROCESSING_LEASE_MS = 15 * 60 * 1000;

export const ITEM_MEDIA_REFERENCE_SCOPES =
  ["user-inventory", "global-catalog"] as const;
export type ItemMediaReferenceScope =
  typeof ITEM_MEDIA_REFERENCE_SCOPES[number];
export type MediaKind =
  "avatar" | "item" | "token" | "npc" | "foe" | "technique" |
  "spell" | "map" | "technique-video" | "spell-video" |
  "map-video" | "music";
export type MediaVariantName =
  "thumbnail" | "thumbnail2x" | "card" | "card2x" |
  "gallery" | "gallery2x" | "poster" | "poster2x";
export type MediaAudienceScope =
  "signed-in" | "owner-manager" | "dm-only";

export interface MediaVariantContract {
  width: number;
  height: number;
  fit: "cover" | "inside";
  quality: number;
  maxBytes: number;
  minScale: number;
  contentType: "image/webp";
}

export interface MediaContract {
  kind: MediaKind;
  source: {
    mediaType: "image" | "video" | "audio";
    audienceScope: MediaAudienceScope | "scope-dependent";
    contentTypes: readonly string[];
    unsupportedContentTypes: readonly string[];
    passthroughContentTypes: readonly string[];
    maxBytes: number;
    maxWidth: number | null;
    maxHeight: number | null;
    maxPixels: number | null;
    maxDurationMs: number | null;
  };
  variants: Partial<Record<MediaVariantName, MediaVariantContract>>;
  posterFrameMs: number | null;
  retention: {
    original: "retain";
    uncommittedHours: number;
    supersededGraceHours: number;
  };
}

type RawContract = {
  mediaType: "image" | "video" | "audio";
  audienceScope: MediaAudienceScope | "scope-dependent";
  contentTypes: string[];
  maxBytes: number;
  maxWidth: number | null;
  maxHeight: number | null;
  maxPixels: number | null;
  maxDurationMs: number | null;
  variants: Record<string, Omit<MediaVariantContract,
    "contentType" | "minScale">>;
};

export const MEDIA_KINDS = Object.freeze(
  Object.keys(mediaPolicy.purposes) as MediaKind[]
);

const contractFor = (kind: MediaKind): MediaContract => {
  const raw = mediaPolicy.purposes[kind] as RawContract;
  return {
    kind,
    source: {
      ...raw,
      unsupportedContentTypes: [
        "image/gif", "image/heic", "image/heif", "image/svg+xml",
      ],
      passthroughContentTypes: [],
    },
    variants: Object.fromEntries(Object.entries(raw.variants)
      .map(([name, value]) => [name, {
        ...value,
        minScale: 0.7,
        contentType: "image/webp" as const,
      }])) as Partial<Record<MediaVariantName, MediaVariantContract>>,
    posterFrameMs: raw.mediaType === "video" ? 1000 : null,
    retention: {
      original: "retain",
      uncommittedHours: MEDIA_UNCOMMITTED_RETENTION_HOURS,
      supersededGraceHours: mediaPolicy.retention.supersededGraceHours,
    },
  };
};

export const MEDIA_CONTRACTS = Object.fromEntries(
  MEDIA_KINDS.map((kind) => [kind, contractFor(kind)])
) as Record<MediaKind, MediaContract>;

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface InspectedMediaObject extends ImageDimensions {
  path: string;
  contentType: string;
  bytes: number;
  durationMs: number | null;
  orientationDegrees: 0 | 90 | 180 | 270;
  generation: string;
  cacheControl: string;
  checksum?: string;
}

export interface MediaObjectValidation {
  ok: boolean;
  errors: string[];
}

export interface Task07PrivateStorageMetadataIdentity {
  task07AssetId: string;
  task07ContractVersion: string;
  task07EntityId: string;
  task07Kind: string;
  task07OwnerUid: string;
  task07Role: string;
}

export interface Task07PrivateStorageMetadataInspection {
  cacheControl: unknown;
  contentDisposition: unknown;
  metadata: unknown;
  expected: Task07PrivateStorageMetadataIdentity;
}

export interface ParsedStagingMediaPath {
  ownerUid: string;
  assetId: string;
  path: string;
}

export interface ParsedMediaPath {
  schemaVersion: number;
  audienceScope: MediaAudienceScope;
  ownerKey: string;
  assetId: string;
  sourceGeneration: string;
  role: "original" | "derivative";
  variant: MediaVariantName | null;
  path: string;
  kind: MediaKind | null;
  ownerUid: string;
}

export const normalizeMediaContentType = (value: unknown): string =>
  typeof value === "string" ?
    value.split(";")[0].trim().toLowerCase() :
    "";

export const isSafeMediaSegment = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 128 &&
  !/[/\\\u0000-\u001f\u007f]/.test(value) &&
  value !== "." &&
  value !== "..";

export const asItemMediaReferenceScope = (
  value: unknown
): ItemMediaReferenceScope | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return ITEM_MEDIA_REFERENCE_SCOPES.includes(
    normalized as ItemMediaReferenceScope
  ) ? normalized as ItemMediaReferenceScope : null;
};

export const asMediaKind = (value: unknown): MediaKind | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return Object.prototype.hasOwnProperty.call(MEDIA_CONTRACTS, normalized) ?
    normalized as MediaKind :
    null;
};

const MEDIA_VARIANTS = new Set(Object.values(MEDIA_CONTRACTS)
  .flatMap(({variants}) => Object.keys(variants)));
export const asMediaVariantName = (
  value: unknown
): MediaVariantName | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return MEDIA_VARIANTS.has(normalized) ?
    normalized as MediaVariantName :
    null;
};

export const validateMediaOperationId = (value: unknown): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(normalized) ?
    normalized :
    "";
};

export const mediaAssetId = (
  actorUid: string,
  operationId: string
): string => `m_${createHash("sha256")
  .update(`${actorUid}\u0000${operationId}`)
  .digest("hex")
  .slice(0, 40)}`;

export const resolveMediaAudienceScope = (
  kind: MediaKind,
  referenceScope: ItemMediaReferenceScope | null = null
): MediaAudienceScope => {
  const scope = MEDIA_CONTRACTS[kind].source.audienceScope;
  if (scope !== "scope-dependent") return scope;
  return referenceScope === "global-catalog" ?
    "signed-in" :
    "owner-manager";
};

export const buildTask07StagingPath = (
  ownerUid: string,
  assetId: string
): string => {
  if (!isSafeMediaSegment(ownerUid) || !isSafeMediaSegment(assetId)) {
    throw new TypeError("Media upload identity is invalid.");
  }
  return `${MEDIA_UPLOAD_ROOT}/${ownerUid}/${assetId}/source`;
};

export const parseTask07StagingPath = (
  value: unknown
): ParsedStagingMediaPath | null => {
  if (typeof value !== "string" || value.includes("\\")) return null;
  const parts = value.split("/");
  return parts.length === 4 &&
    parts[0] === MEDIA_UPLOAD_ROOT &&
    parts[3] === "source" &&
    isSafeMediaSegment(parts[1]) &&
    isSafeMediaSegment(parts[2]) ?
    {ownerUid: parts[1], assetId: parts[2], path: value} :
    null;
};

export const buildGeneratedMediaStoragePlan = (input: {
  kind: MediaKind;
  audienceScope: MediaAudienceScope;
  ownerKey: string;
  assetId: string;
  sourceGeneration: string;
}): {
  prefix: string;
  originalPath: string;
  variants: Partial<Record<MediaVariantName, string>>;
} => {
  if (!isSafeMediaSegment(input.ownerKey) ||
    !isSafeMediaSegment(input.assetId) ||
    !/^[1-9][0-9]*$/.test(input.sourceGeneration)) {
    throw new TypeError("Generated media identity is invalid.");
  }
  const prefix = `${MEDIA_ROOT}/${input.audienceScope}/${input.ownerKey}/` +
    `${input.assetId}/${input.sourceGeneration}`;
  return {
    prefix,
    originalPath: `${prefix}/original`,
    variants: Object.fromEntries(
      Object.keys(MEDIA_CONTRACTS[input.kind].variants)
        .map((name) => [name, `${prefix}/${name}`])
    ) as Partial<Record<MediaVariantName, string>>,
  };
};

// Deprecated shape retained while client callers move to sourcePath.
export const buildMediaStoragePlan = (input: {
  kind: MediaKind;
  ownerUid: string;
  assetId: string;
  sourceContentType: string;
}): {
  sourcePath: string;
  originalPath: string;
  variants: Partial<Record<MediaVariantName, string>>;
  passthrough: false;
} => {
  const contentType = normalizeMediaContentType(input.sourceContentType);
  const contract = MEDIA_CONTRACTS[input.kind];
  if (!contract.source.contentTypes.includes(contentType)) {
    throw new TypeError(`Unsupported ${input.kind} media type.`);
  }
  const sourcePath = buildTask07StagingPath(input.ownerUid, input.assetId);
  return {
    sourcePath,
    originalPath: sourcePath,
    variants: {},
    passthrough: false,
  };
};

export const mediaAssetPrefix = (
  kind: MediaKind,
  ownerUid: string,
  assetId: string
): string =>
  `${MEDIA_ROOT}/${resolveMediaAudienceScope(kind)}/${ownerUid}/${assetId}`;

export const parseCanonicalMediaPath = (
  value: unknown
): ParsedMediaPath | null => {
  if (typeof value !== "string" || value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  const parts = value.split("/");
  if (parts.length !== 7 ||
    parts[0] !== "media_assets" ||
    parts[1] !== `v${MEDIA_SCHEMA_VERSION}` ||
    !["signed-in", "owner-manager", "dm-only"].includes(parts[2]) ||
    !isSafeMediaSegment(parts[3]) ||
    !isSafeMediaSegment(parts[4]) ||
    !/^[1-9][0-9]*$/.test(parts[5])) return null;
  const variant = parts[6] === "original" ?
    null :
    asMediaVariantName(parts[6]);
  if (parts[6] !== "original" && !variant) return null;
  return {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    audienceScope: parts[2] as MediaAudienceScope,
    ownerKey: parts[3],
    assetId: parts[4],
    sourceGeneration: parts[5],
    role: variant ? "derivative" : "original",
    variant,
    path: value,
    kind: null,
    ownerUid: parts[3],
  };
};

export const buildTask07PrivateStorageMetadata = (input: {
  assetId: string;
  entityId: string;
  kind: MediaKind;
  ownerUid: string;
  role: "source" | "original" | MediaVariantName;
}): Task07PrivateStorageMetadataIdentity => ({
  task07AssetId: input.assetId,
  task07ContractVersion: String(MEDIA_CONTRACT_VERSION),
  task07EntityId: input.entityId,
  task07Kind: input.kind,
  task07OwnerUid: input.ownerUid,
  task07Role: input.role,
});

const METADATA_KEYS = [
  "task07AssetId", "task07ContractVersion", "task07EntityId",
  "task07Kind", "task07OwnerUid", "task07Role",
] as const;
export const validateTask07PrivateStorageMetadata = (
  input: Task07PrivateStorageMetadataInspection
): MediaObjectValidation => {
  const errors: string[] = [];
  if (input.cacheControl !== MEDIA_PRIVATE_CACHE_CONTROL) {
    errors.push("private-cache-control-required");
  }
  if (input.contentDisposition !== "inline") {
    errors.push("inline-content-disposition-required");
  }
  const metadata = input.metadata &&
    typeof input.metadata === "object" &&
    !Array.isArray(input.metadata) ?
    input.metadata as Record<string, unknown> :
    null;
  if (!metadata) {
    errors.push("private-metadata-required");
  } else {
    METADATA_KEYS.forEach((key) => {
      if (metadata[key] !== input.expected[key]) {
        errors.push(`private-metadata-${key}-mismatch`);
      }
    });
    if (metadata.firebaseStorageDownloadTokens !== undefined &&
      metadata.firebaseStorageDownloadTokens !== null) {
      errors.push("firebase-storage-download-token-forbidden");
    }
  }
  return {ok: errors.length === 0, errors};
};

const positiveDimensions = (
  value: ImageDimensions | null
): value is ImageDimensions =>
  Boolean(value) &&
  Number.isSafeInteger(value?.width) &&
  Number.isSafeInteger(value?.height) &&
  (value?.width || 0) > 0 &&
  (value?.height || 0) > 0;

export const plannedMediaVariantDimensions = (
  source: ImageDimensions,
  contract: MediaVariantContract
): ImageDimensions | null => {
  if (!positiveDimensions(source)) return null;
  if (contract.fit === "cover") {
    return {
      width: Math.min(source.width, contract.width),
      height: Math.min(source.height, contract.height),
    };
  }
  const scale = Math.min(
    contract.width / source.width,
    contract.height / source.height,
    1
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
};

export const validateMediaObject = (
  kind: MediaKind,
  inspected: InspectedMediaObject,
  variantName: MediaVariantName | null = null,
  options: {requirePrivateMetadata?: boolean;
    sourceDimensions?: ImageDimensions} = {}
): MediaObjectValidation => {
  const errors: string[] = [];
  const contract = MEDIA_CONTRACTS[kind];
  const parsed = parseCanonicalMediaPath(inspected.path);
  if (!parsed) errors.push("invalid-canonical-path");
  if (!Number.isSafeInteger(inspected.bytes) || inspected.bytes <= 0) {
    errors.push("invalid-byte-size");
  }
  if (!/^[1-9][0-9]*$/.test(inspected.generation)) {
    errors.push("invalid-generation");
  }
  if (options.requirePrivateMetadata &&
    inspected.cacheControl !== MEDIA_PRIVATE_CACHE_CONTROL) {
    errors.push("private-cache-control-required");
  }
  if (variantName) {
    const variant = contract.variants[variantName];
    if (!variant || parsed?.variant !== variantName) {
      errors.push("invalid-variant");
    } else {
      if (!positiveDimensions(inspected)) errors.push("invalid-dimensions");
      if (normalizeMediaContentType(inspected.contentType) !==
        variant.contentType) errors.push("invalid-variant-content-type");
      if (inspected.bytes > variant.maxBytes) {
        errors.push("variant-byte-budget-exceeded");
      }
      if (inspected.width > variant.width ||
        inspected.height > variant.height) {
        errors.push("variant-dimension-budget-exceeded");
      }
    }
  } else {
    if (parsed?.role !== "original") errors.push("invalid-original-path");
    if (!contract.source.contentTypes.includes(
      normalizeMediaContentType(inspected.contentType)
    )) errors.push("invalid-source-content-type");
    if (inspected.bytes > contract.source.maxBytes) {
      errors.push("source-byte-budget-exceeded");
    }
    if (contract.source.mediaType !== "audio") {
      if (!positiveDimensions(inspected)) errors.push("invalid-dimensions");
      if ((contract.source.maxWidth !== null &&
          inspected.width > contract.source.maxWidth) ||
        (contract.source.maxHeight !== null &&
          inspected.height > contract.source.maxHeight) ||
        (contract.source.maxPixels !== null &&
          inspected.width * inspected.height > contract.source.maxPixels)) {
        errors.push("source-dimension-budget-exceeded");
      }
    }
    if (contract.source.mediaType !== "image" &&
      contract.source.maxDurationMs !== null &&
      (!Number.isSafeInteger(inspected.durationMs) ||
        (inspected.durationMs || 0) <= 0 ||
        (inspected.durationMs || 0) > contract.source.maxDurationMs)) {
      errors.push("source-duration-budget-exceeded");
    }
  }
  return {ok: errors.length === 0, errors};
};

const pngDimensions = (buffer: Buffer): ImageDimensions | null =>
  buffer.length >= 24 &&
  buffer.subarray(0, 8).equals(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])) ?
    {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)} :
    null;

const jpegDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker) &&
      length >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }
  return null;
};

const webpDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 30 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }
  return null;
};

export const readImageDimensions = (
  buffer: Buffer,
  contentType: unknown
): ImageDimensions | null => {
  switch (normalizeMediaContentType(contentType)) {
  case "image/png": return pngDimensions(buffer);
  case "image/jpeg": return jpegDimensions(buffer);
  case "image/webp": return webpDimensions(buffer);
  default: return null;
  }
};
