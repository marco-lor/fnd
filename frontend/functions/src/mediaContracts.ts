import {createHash} from "crypto";

export const MEDIA_SCHEMA_VERSION = 1;
export const MEDIA_CONTRACT_VERSION = 1;
export const MEDIA_ROOT = `media/v${MEDIA_SCHEMA_VERSION}`;
export const MEDIA_PRIVATE_CACHE_CONTROL =
  "private, max-age=31536000, immutable";
export const MEDIA_UNCOMMITTED_RETENTION_HOURS = 24;
export const MEDIA_CLEANUP_CONCURRENCY = 4;
export const MEDIA_ORPHAN_SWEEP_BATCH_SIZE = 100;
export const MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS = 8;
export const MEDIA_PROCESSING_LEASE_MS = 15 * 60 * 1000;

export const ITEM_MEDIA_REFERENCE_SCOPES = [
  "user-inventory",
  "global-catalog",
] as const;

export type MediaKind =
  "avatar" | "item" | "npc" | "foe" | "map" | "map-video";
export type MediaVariantName = "thumbnail" | "card" | "board" | "poster";
export type ItemMediaReferenceScope =
  typeof ITEM_MEDIA_REFERENCE_SCOPES[number];

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
    contentTypes: readonly string[];
    unsupportedContentTypes?: readonly string[];
    passthroughContentTypes: readonly string[];
    maxBytes: number;
    maxWidth: number;
    maxHeight: number;
    maxPixels: number;
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

const MIB = 1024 * 1024;
const KIB = 1024;
const SOURCE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
const PASSTHROUGH_IMAGE_TYPES = ["image/gif"] as const;

const variant = (
  width: number,
  height: number,
  fit: "cover" | "inside",
  quality: number,
  maxBytes: number
): MediaVariantContract => ({
  width,
  height,
  fit,
  quality,
  maxBytes,
  minScale: 0.7,
  contentType: "image/webp",
});

export const MEDIA_CONTRACTS: Record<MediaKind, MediaContract> = {
  avatar: {
    kind: "avatar",
    source: {
      contentTypes: SOURCE_IMAGE_TYPES,
      passthroughContentTypes: PASSTHROUGH_IMAGE_TYPES,
      maxBytes: 5 * MIB,
      maxWidth: 4096,
      maxHeight: 4096,
      maxPixels: 16_000_000,
      maxDurationMs: null,
    },
    variants: {
      thumbnail: variant(96, 96, "cover", 80, 128 * KIB),
      card: variant(320, 320, "cover", 82, 384 * KIB),
    },
    posterFrameMs: null,
    retention: {
      original: "retain",
      uncommittedHours: MEDIA_UNCOMMITTED_RETENTION_HOURS,
      supersededGraceHours: 24,
    },
  },
  item: {
    kind: "item",
    source: {
      contentTypes: SOURCE_IMAGE_TYPES,
      passthroughContentTypes: PASSTHROUGH_IMAGE_TYPES,
      maxBytes: 8 * MIB,
      maxWidth: 4096,
      maxHeight: 4096,
      maxPixels: 16_000_000,
      maxDurationMs: null,
    },
    variants: {
      thumbnail: variant(96, 96, "cover", 80, 128 * KIB),
      card: variant(480, 480, "inside", 82, 512 * KIB),
    },
    posterFrameMs: null,
    retention: {
      original: "retain",
      uncommittedHours: MEDIA_UNCOMMITTED_RETENTION_HOURS,
      supersededGraceHours: 24,
    },
  },
  npc: {
    kind: "npc",
    source: {
      contentTypes: SOURCE_IMAGE_TYPES,
      passthroughContentTypes: PASSTHROUGH_IMAGE_TYPES,
      maxBytes: 8 * MIB,
      maxWidth: 6000,
      maxHeight: 6000,
      maxPixels: 24_000_000,
      maxDurationMs: null,
    },
    variants: {
      thumbnail: variant(128, 128, "cover", 80, 160 * KIB),
      card: variant(480, 640, "inside", 84, 640 * KIB),
    },
    posterFrameMs: null,
    retention: {
      original: "retain",
      uncommittedHours: MEDIA_UNCOMMITTED_RETENTION_HOURS,
      supersededGraceHours: 24,
    },
  },
  foe: {
    kind: "foe",
    source: {
      contentTypes: SOURCE_IMAGE_TYPES,
      passthroughContentTypes: PASSTHROUGH_IMAGE_TYPES,
      maxBytes: 8 * MIB,
      maxWidth: 6000,
      maxHeight: 6000,
      maxPixels: 24_000_000,
      maxDurationMs: null,
    },
    variants: {
      thumbnail: variant(128, 128, "cover", 80, 160 * KIB),
      card: variant(480, 640, "inside", 84, 640 * KIB),
    },
    posterFrameMs: null,
    retention: {
      original: "retain",
      uncommittedHours: MEDIA_UNCOMMITTED_RETENTION_HOURS,
      supersededGraceHours: 24,
    },
  },
  map: {
    kind: "map",
    source: {
      contentTypes: SOURCE_IMAGE_TYPES,
      passthroughContentTypes: PASSTHROUGH_IMAGE_TYPES,
      maxBytes: 15 * MIB,
      maxWidth: 8192,
      maxHeight: 8192,
      maxPixels: 40_000_000,
      maxDurationMs: null,
    },
    variants: {
      thumbnail: variant(320, 180, "cover", 80, 256 * KIB),
      card: variant(960, 540, "inside", 84, 1024 * KIB),
      board: variant(2560, 2560, "inside", 86, 4 * MIB),
    },
    posterFrameMs: null,
    retention: {
      original: "retain",
      uncommittedHours: MEDIA_UNCOMMITTED_RETENTION_HOURS,
      supersededGraceHours: 24,
    },
  },
  "map-video": {
    kind: "map-video",
    source: {
      contentTypes: ["video/mp4"],
      unsupportedContentTypes: ["video/webm"],
      passthroughContentTypes: [],
      maxBytes: 25 * MIB,
      maxWidth: 4096,
      maxHeight: 4096,
      maxPixels: 8_300_000,
      maxDurationMs: 15 * 60 * 1000,
    },
    variants: {
      poster: variant(320, 180, "cover", 80, 256 * KIB),
    },
    posterFrameMs: 1000,
    retention: {
      original: "retain",
      uncommittedHours: MEDIA_UNCOMMITTED_RETENTION_HOURS,
      supersededGraceHours: 24,
    },
  },
};

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

const TASK07_PRIVATE_STORAGE_METADATA_KEYS =
  ["task07AssetId", "task07ContractVersion", "task07EntityId",
    "task07Kind", "task07OwnerUid", "task07Role"] as const;

export interface ParsedMediaPath {
  schemaVersion: number;
  kind: MediaKind;
  ownerUid: string;
  assetId: string;
  role: "original" | "derivative";
  variant: MediaVariantName | null;
  path: string;
}

export const normalizeMediaContentType = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.split(";")[0].trim().toLowerCase();
};

export const buildTask07PrivateStorageMetadata = (input: {
  assetId: string;
  entityId: string;
  kind: MediaKind;
  ownerUid: string;
  role: "original" | MediaVariantName;
}): Task07PrivateStorageMetadataIdentity => ({
  task07AssetId: input.assetId,
  task07ContractVersion: String(MEDIA_CONTRACT_VERSION),
  task07EntityId: input.entityId,
  task07Kind: input.kind,
  task07OwnerUid: input.ownerUid,
  task07Role: input.role,
});

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
  const metadata =
    input.metadata &&
    typeof input.metadata === "object" &&
    !Array.isArray(input.metadata) ?
      input.metadata as Record<string, unknown> :
      null;
  if (!metadata) {
    errors.push("private-metadata-required");
  } else {
    TASK07_PRIVATE_STORAGE_METADATA_KEYS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(metadata, key) ||
        metadata[key] !== input.expected[key]) {
        errors.push(`private-metadata-${key}-mismatch`);
      }
    });
    const downloadToken = metadata.firebaseStorageDownloadTokens;
    if (downloadToken !== undefined && downloadToken !== null) {
      errors.push("firebase-storage-download-token-forbidden");
    }
  }
  return {
    ok: errors.length === 0,
    errors,
  };
};

export const asItemMediaReferenceScope = (
  value: unknown
): ItemMediaReferenceScope | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return ITEM_MEDIA_REFERENCE_SCOPES.includes(
    normalized as ItemMediaReferenceScope
  ) ?
    normalized as ItemMediaReferenceScope :
    null;
};

export const asMediaKind = (value: unknown): MediaKind | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return Object.prototype.hasOwnProperty.call(MEDIA_CONTRACTS, normalized) ?
    normalized as MediaKind :
    null;
};

export const asMediaVariantName = (
  value: unknown
): MediaVariantName | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return ["thumbnail", "card", "board", "poster"].includes(normalized) ?
    normalized as MediaVariantName :
    null;
};

export const isSafeMediaSegment = (value: unknown): value is string => (
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 128 &&
  !/[/\\\u0000-\u001f\u007f]/.test(value) &&
  value !== "." &&
  value !== ".."
);

export const validateMediaOperationId = (value: unknown): string => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(normalized) ?
    normalized :
    "";
};

export const mediaAssetId = (
  actorUid: string,
  operationId: string
): string => (
  `m_${createHash("sha256")
    .update(`${actorUid}\u0000${operationId}`)
    .digest("hex")
    .slice(0, 40)}`
);

const extensionForContentType = (contentType: string): string => {
  switch (normalizeMediaContentType(contentType)) {
  case "image/jpeg": return "jpg";
  case "image/png": return "png";
  case "image/webp": return "webp";
  case "image/gif": return "gif";
  case "video/mp4": return "mp4";
  default: return "";
  }
};

export const mediaAssetPrefix = (
  kind: MediaKind,
  ownerUid: string,
  assetId: string
): string => {
  if (!isSafeMediaSegment(ownerUid) || !isSafeMediaSegment(assetId)) {
    throw new TypeError("Media owner and asset identifiers must be safe segments.");
  }
  return `${MEDIA_ROOT}/${kind}/${ownerUid}/${assetId}`;
};

export const buildMediaStoragePlan = (input: {
  kind: MediaKind;
  ownerUid: string;
  assetId: string;
  sourceContentType: string;
}): {
  originalPath: string;
  variants: Partial<Record<MediaVariantName, string>>;
  passthrough: boolean;
} => {
  const contract = MEDIA_CONTRACTS[input.kind];
  const contentType = normalizeMediaContentType(input.sourceContentType);
  if (contract.source.unsupportedContentTypes?.includes(contentType)) {
    throw new TypeError(
      `Unsupported ${input.kind} media type; retain the legacy original fallback.`
    );
  }
  if (!contract.source.contentTypes.includes(contentType)) {
    throw new TypeError(`Unsupported ${input.kind} media type.`);
  }
  const extension = extensionForContentType(contentType);
  const prefix = mediaAssetPrefix(input.kind, input.ownerUid, input.assetId);
  const passthrough = contract.source.passthroughContentTypes.includes(contentType);
  const variants = passthrough ? {} : Object.fromEntries(
    Object.keys(contract.variants).map((name) => [
      name,
      `${prefix}/derivatives/v${MEDIA_CONTRACT_VERSION}/${name}.webp`,
    ])
  ) as Partial<Record<MediaVariantName, string>>;
  return {
    originalPath: `${prefix}/original/source.${extension}`,
    variants,
    passthrough,
  };
};

export const parseCanonicalMediaPath = (
  value: unknown
): ParsedMediaPath | null => {
  if (typeof value !== "string" || value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  const parts = value.split("/");
  if (parts.length < 7 || parts[0] !== "media" ||
    parts[1] !== `v${MEDIA_SCHEMA_VERSION}`) return null;
  const kind = asMediaKind(parts[2]);
  if (!kind || !isSafeMediaSegment(parts[3]) ||
    !isSafeMediaSegment(parts[4])) return null;
  if (parts.length === 7 && parts[5] === "original" &&
    /^source\.(?:jpg|png|webp|gif|mp4)$/.test(parts[6])) {
    return {
      schemaVersion: MEDIA_SCHEMA_VERSION,
      kind,
      ownerUid: parts[3],
      assetId: parts[4],
      role: "original",
      variant: null,
      path: value,
    };
  }
  if (parts.length === 8 && parts[5] === "derivatives" &&
    parts[6] === `v${MEDIA_CONTRACT_VERSION}` &&
    /^(?:thumbnail|card|board|poster)\.webp$/.test(parts[7])) {
    const variantName = asMediaVariantName(parts[7].slice(0, -5));
    if (!variantName || !MEDIA_CONTRACTS[kind].variants[variantName]) return null;
    return {
      schemaVersion: MEDIA_SCHEMA_VERSION,
      kind,
      ownerUid: parts[3],
      assetId: parts[4],
      role: "derivative",
      variant: variantName,
      path: value,
    };
  }
  return null;
};

const dimensionsArePositive = (
  value: ImageDimensions | null
): value is ImageDimensions => (
  Boolean(value) &&
  Number.isSafeInteger(value?.width) &&
  Number.isSafeInteger(value?.height) &&
  (value?.width || 0) > 0 &&
  (value?.height || 0) > 0
);

export const plannedMediaVariantDimensions = (
  source: ImageDimensions,
  contract: MediaVariantContract
): ImageDimensions | null => {
  if (!dimensionsArePositive(source) ||
    !Number.isSafeInteger(contract.width) ||
    !Number.isSafeInteger(contract.height) ||
    contract.width <= 0 ||
    contract.height <= 0) return null;
  if (contract.fit === "cover") {
    return {width: contract.width, height: contract.height};
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
  options: {
    requirePrivateMetadata?: boolean;
    sourceDimensions?: ImageDimensions;
  } = {}
): MediaObjectValidation => {
  const errors: string[] = [];
  const contract = MEDIA_CONTRACTS[kind];
  const parsed = parseCanonicalMediaPath(inspected.path);
  if (!parsed || parsed.kind !== kind) errors.push("invalid-canonical-path");
  if (!Number.isSafeInteger(inspected.bytes) || inspected.bytes <= 0) {
    errors.push("invalid-byte-size");
  }
  if (!dimensionsArePositive(inspected)) errors.push("invalid-dimensions");
  if (!/^[1-9][0-9]*$/.test(inspected.generation)) {
    errors.push("invalid-generation");
  }
  if (![0, 90, 180, 270].includes(inspected.orientationDegrees)) {
    errors.push("invalid-orientation");
  }
  if (/\bpublic\b/i.test(inspected.cacheControl)) {
    errors.push("public-cache-control-forbidden");
  }
  if (options.requirePrivateMetadata &&
    inspected.cacheControl !== MEDIA_PRIVATE_CACHE_CONTROL) {
    errors.push("private-cache-control-required");
  }
  if (variantName) {
    const variantContract = contract.variants[variantName];
    if (!variantContract || parsed?.role !== "derivative" ||
      parsed.variant !== variantName) {
      errors.push("invalid-variant");
      return {ok: false, errors};
    }
    if (normalizeMediaContentType(inspected.contentType) !==
      variantContract.contentType) errors.push("invalid-variant-content-type");
    if (inspected.bytes > variantContract.maxBytes) {
      errors.push("variant-byte-budget-exceeded");
    }
    if (inspected.width > variantContract.width ||
      inspected.height > variantContract.height) {
      errors.push("variant-dimension-budget-exceeded");
    }
    if (options.sourceDimensions) {
      const planned = plannedMediaVariantDimensions(
        options.sourceDimensions,
        variantContract
      );
      if (!planned) {
        errors.push("invalid-variant-source-dimensions");
      } else {
        if (inspected.width > planned.width ||
          inspected.height > planned.height) {
          errors.push("variant-planned-dimension-exceeded");
        }
        const minWidth = Math.max(
          1,
          Math.round(planned.width * variantContract.minScale)
        );
        const minHeight = Math.max(
          1,
          Math.round(planned.height * variantContract.minScale)
        );
        if (inspected.width < minWidth || inspected.height < minHeight) {
          errors.push("variant-planned-dimension-too-small");
        }
        const ratioDelta = Math.abs(
          inspected.width * planned.height -
          inspected.height * planned.width
        );
        if (ratioDelta > planned.width + planned.height) {
          errors.push("variant-aspect-ratio-mismatch");
        }
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
    if (inspected.width > contract.source.maxWidth ||
      inspected.height > contract.source.maxHeight ||
      inspected.width * inspected.height > contract.source.maxPixels) {
      errors.push("source-dimension-budget-exceeded");
    }
    if (contract.source.maxDurationMs !== null &&
      (!Number.isSafeInteger(inspected.durationMs) ||
        (inspected.durationMs || 0) <= 0 ||
        (inspected.durationMs || 0) > contract.source.maxDurationMs)) {
      errors.push("source-duration-budget-exceeded");
    }
  }
  return {ok: errors.length === 0, errors};
};

const readPngDimensions = (buffer: Buffer): ImageDimensions | null => (
  buffer.length >= 24 &&
  buffer.subarray(0, 8).equals(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])) ?
    {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)} :
    null
);

const readGifDimensions = (buffer: Buffer): ImageDimensions | null => (
  buffer.length >= 10 &&
  ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")) ?
    {width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8)} :
    null
);

const readJpegDimensions = (buffer: Buffer): ImageDimensions | null => {
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
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
};

const readWebpDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 30 || buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }
  if (chunk === "VP8L" && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8 " && buffer[23] === 0x9d &&
    buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
};

export const readImageDimensions = (
  buffer: Buffer,
  contentType: unknown
): ImageDimensions | null => {
  switch (normalizeMediaContentType(contentType)) {
  case "image/png": return readPngDimensions(buffer);
  case "image/gif": return readGifDimensions(buffer);
  case "image/jpeg": return readJpegDimensions(buffer);
  case "image/webp": return readWebpDimensions(buffer);
  default: return null;
  }
};
