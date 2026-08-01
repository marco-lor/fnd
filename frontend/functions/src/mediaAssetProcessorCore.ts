import {createHash} from "crypto";
import {
  buildGeneratedMediaStoragePlan,
  InspectedMediaObject,
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_POLICY_HASH,
  MEDIA_PRIVATE_CACHE_CONTROL,
  MEDIA_PROCESSING_MAX_AUTO_ATTEMPTS,
  MEDIA_STAGING_CACHE_CONTROL,
  MediaAudienceScope,
  MediaKind,
  MediaVariantName,
  normalizeMediaContentType,
  plannedMediaVariantDimensions,
} from "./mediaContracts";

export interface Task07ProcessorPlan {
  assetId: string;
  kind: MediaKind;
  ownerUid: string;
  ownerKey: string;
  entityId: string;
  audienceScope: MediaAudienceScope;
  sourceContentType: string;
  sourceBytes: number;
}

export const LEGACY_MAP_BACKFILL_MAX_WIDTH = 9600;
export const LEGACY_MAP_BACKFILL_MAX_HEIGHT = 9600;
export const LEGACY_MAP_BACKFILL_MAX_PIXELS = 92_160_000;

const LEGACY_MAP_BACKFILL_MARKER_KEYS = [
  "approvedPlanFingerprint", "assetId", "entityId", "kind", "ownerUid",
  "planVersion", "policyHash", "policyVersion", "receiptId",
  "reportSchemaVersion", "requestHash", "schemaVersion",
  "sourceFingerprint", "sourceGeneration", "sourcePath", "subjectHash",
  "targetPath",
] as const;

const recordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ?
    value as Record<string, unknown> :
    null;

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean => Object.keys(value).sort().join(",") ===
  [...expected].sort().join(",");

const sha256Value = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export const isAuthorizedTask07LegacyMapBackfill = (input: {
  plan: {
    assetId: string;
    kind: MediaKind;
    ownerUid: string;
    entityId: string;
    requestHash: string;
  };
  marker: unknown;
  receipt: unknown;
}): boolean => {
  const marker = recordValue(input.marker);
  const receipt = recordValue(input.receipt);
  const receiptMarker = recordValue(receipt?.legacyBackfill);
  if (input.plan.kind !== "map" || !marker || !receipt ||
    !receiptMarker ||
    !exactKeys(marker, LEGACY_MAP_BACKFILL_MARKER_KEYS) ||
    !exactKeys(receiptMarker, LEGACY_MAP_BACKFILL_MARKER_KEYS) ||
    LEGACY_MAP_BACKFILL_MARKER_KEYS.some(
      (key) => receiptMarker[key] !== marker[key]
    )) return false;
  const recoveryAttempts = receipt.legacyMapRecoveryAttempts;
  return marker.schemaVersion === 1 &&
    marker.kind === "legacy-map-backfill" &&
    marker.reportSchemaVersion === 4 &&
    marker.planVersion === 4 &&
    marker.policyVersion === MEDIA_CONTRACT_VERSION &&
    marker.policyHash === MEDIA_POLICY_HASH &&
    marker.assetId === input.plan.assetId &&
    marker.ownerUid === input.plan.ownerUid &&
    marker.entityId === input.plan.entityId &&
    marker.requestHash === input.plan.requestHash &&
    marker.targetPath === `grigliata_backgrounds/${input.plan.entityId}` &&
    /^r_[a-f0-9]{40}$/.test(String(marker.receiptId || "")) &&
    sha256Value(marker.subjectHash) &&
    sha256Value(marker.approvedPlanFingerprint) &&
    sha256Value(marker.sourceFingerprint) &&
    typeof marker.sourcePath === "string" && marker.sourcePath.length > 0 &&
    /^[1-9][0-9]*$/.test(String(marker.sourceGeneration || "")) &&
    receipt.state === "intent" &&
    receipt.sourceKey === "backgrounds" &&
    receipt.kind === "map" &&
    receipt.receiptId === marker.receiptId &&
    receipt.schemaVersion === marker.reportSchemaVersion &&
    receipt.planVersion === marker.planVersion &&
    receipt.policyVersion === marker.policyVersion &&
    receipt.policyHash === marker.policyHash &&
    receipt.subjectHash === marker.subjectHash &&
    receipt.approvedPlanFingerprint === marker.approvedPlanFingerprint &&
    receipt.assetId === marker.assetId &&
    receipt.ownerUid === marker.ownerUid &&
    receipt.entityId === marker.entityId &&
    receipt.targetPath === marker.targetPath &&
    receipt.sourcePath === marker.sourcePath &&
    receipt.sourceGeneration === marker.sourceGeneration &&
    receipt.sourceFingerprint === marker.sourceFingerprint &&
    Number.isSafeInteger(recoveryAttempts) &&
    Number(recoveryAttempts) >= 0 && Number(recoveryAttempts) <= 1;
};

export interface Task07DecodedSource {
  contentType: string;
  width: number;
  height: number;
  durationMs: number | null;
  orientationDegrees: 0 | 90 | 180 | 270;
  codec: string | null;
}

export interface Task07VariantOutput {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface Task07MediaTransformer {
  inspectSource(input: {
    buffer: Buffer;
    kind: MediaKind;
    declaredContentType: string;
    maxInputPixels: number;
  }): Promise<Task07DecodedSource>;
  createVariant(input: {
    buffer: Buffer;
    kind: MediaKind;
    source: Task07DecodedSource;
    variant: MediaVariantName;
    maxInputPixels: number;
  }): Promise<Task07VariantOutput>;
}

export interface Task07GeneratedObject {
  path: string;
  contentType: string;
  buffer: Buffer;
  width: number;
  height: number;
  durationMs: number | null;
  orientationDegrees: 0 | 90 | 180 | 270;
  checksum: string;
  role: "original" | MediaVariantName;
}

export interface Task07ProcessingResult {
  source: {
    mime: string;
    bytes: number;
    width: number;
    height: number;
    durationMs: number | null;
    checksum: string;
    orientation: 0 | 90 | 180 | 270;
    codec: string | null;
  };
  objects: Task07GeneratedObject[];
  original: Omit<InspectedMediaObject, "generation">;
  variants: Partial<
    Record<MediaVariantName, Omit<InspectedMediaObject, "generation">>
  >;
}

export class Task07ProcessorError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = false) {
    super(code);
    this.name = "Task07ProcessorError";
    this.code = code;
    this.retryable = retryable;
  }
}

export const validateTask07StagingMetadata = (input: {
  plan: Task07ProcessorPlan;
  metadata: {
    cacheControl?: string;
    contentDisposition?: string;
    contentType?: string;
    metadata?: Record<
      string, string | number | boolean | null | undefined
    >;
    size?: string | number;
  };
}): void => {
  const custom = input.metadata.metadata || {};
  const firebaseDownloadToken = custom.firebaseStorageDownloadTokens;
  const expected: Record<string, string> = {
    task07AssetId: input.plan.assetId,
    task07ContractVersion: String(MEDIA_CONTRACT_VERSION),
    task07EntityId: input.plan.entityId,
    task07Kind: input.plan.kind,
    task07OwnerUid: input.plan.ownerUid,
    task07Role: "source",
  };
  const actualKeys = Object.keys(custom)
    .filter((key) => (
      key !== "firebaseStorageDownloadTokens" &&
      custom[key] !== undefined
    ))
    .sort();
  if (input.metadata.contentType !== input.plan.sourceContentType ||
    Number(input.metadata.size) !== input.plan.sourceBytes ||
    input.metadata.cacheControl !== MEDIA_STAGING_CACHE_CONTROL ||
    input.metadata.contentDisposition !== "inline" ||
    (
      firebaseDownloadToken !== undefined &&
      (
        typeof firebaseDownloadToken !== "string" ||
        firebaseDownloadToken.trim().length === 0
      )
    ) ||
    actualKeys.join(",") !== Object.keys(expected).sort().join(",") ||
    Object.entries(expected).some(([key, value]) => custom[key] !== value)) {
    throw new Task07ProcessorError("staging-metadata-mismatch");
  }
};

export type Task07ProcessorClaimDecision =
  {action: "ack"} |
  {action: "retry"; code: string} |
  {action: "terminal"; attempt: number; code: string} |
  {action: "claim"; attempt: number};

export const task07ProcessorClaimDecision = (input: {
  state: unknown;
  attempts: unknown;
  expiresAtMs: unknown;
  leaseUntilMs: unknown;
  activeGeneration: unknown;
  sourceGeneration: string;
  nowMs: number;
}): Task07ProcessorClaimDecision => {
  const state = typeof input.state === "string" ? input.state : "";
  const storedAttempts = Number.isSafeInteger(input.attempts) &&
    Number(input.attempts) >= 0 ? Number(input.attempts) : 0;
  const attempt = storedAttempts + 1;
  if (["ready", "attached", "superseded", "deleted"].includes(state)) {
    return {action: "ack"};
  }
  if (["cancelled", "rejected"].includes(state)) {
    return {action: "terminal", attempt, code: "intent-not-processable"};
  }
  if (Number.isFinite(input.expiresAtMs) &&
    Number(input.expiresAtMs) <= input.nowMs) {
    return {action: "terminal", attempt, code: "intent-expired"};
  }
  if (state === "processing" &&
    input.activeGeneration === input.sourceGeneration &&
    Number.isFinite(input.leaseUntilMs) &&
    Number(input.leaseUntilMs) > input.nowMs) {
    return {action: "retry", code: "processor-lease-active"};
  }
  if (!["intent", "uploaded", "failed", "processing"].includes(state)) {
    return {action: "terminal", attempt, code: "intent-not-processable"};
  }
  if (attempt > MEDIA_PROCESSING_MAX_AUTO_ATTEMPTS) {
    return {
      action: "terminal",
      attempt,
      code: "processor-attempt-limit-reached",
    };
  }
  return {action: "claim", attempt};
};

export const task07ProcessorFailureCleanupPaths = (input: {
  temporaryPaths: readonly string[];
  promotedPaths: readonly string[];
}): string[] => {
  // Canonical paths are shared by every delivery for a source generation. A
  // worker whose commit result is ambiguous, or whose lease expired while a
  // replacement worker completed, cannot safely decide that those objects are
  // orphaned. Only event-scoped temporary paths belong to this worker; the
  // manifest cleanup ledger owns canonical deletion.
  void input.promotedPaths;
  return [...new Set(input.temporaryPaths)];
};

const checksum = (buffer: Buffer): string =>
  createHash("sha256").update(buffer).digest("hex");

const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

export const task07SourceDimensionBudget = (
  kind: MediaKind,
  legacyMapBackfill = false
): {
  maxWidth: number | null;
  maxHeight: number | null;
  maxPixels: number | null;
} => legacyMapBackfill && kind === "map" ? {
  maxWidth: LEGACY_MAP_BACKFILL_MAX_WIDTH,
  maxHeight: LEGACY_MAP_BACKFILL_MAX_HEIGHT,
  maxPixels: LEGACY_MAP_BACKFILL_MAX_PIXELS,
} : MEDIA_CONTRACTS[kind].source;

const validateSource = (
  plan: Task07ProcessorPlan,
  buffer: Buffer,
  decoded: Task07DecodedSource,
  dimensionBudget: ReturnType<typeof task07SourceDimensionBudget>
): void => {
  const contract = MEDIA_CONTRACTS[plan.kind].source;
  const actualType = normalizeMediaContentType(decoded.contentType);
  if (actualType !== plan.sourceContentType ||
    !contract.contentTypes.includes(actualType)) {
    throw new Task07ProcessorError("source-signature-mime-mismatch");
  }
  if (buffer.byteLength !== plan.sourceBytes ||
    buffer.byteLength <= 0 ||
    buffer.byteLength > contract.maxBytes) {
    throw new Task07ProcessorError("source-byte-budget-exceeded");
  }
  if (contract.mediaType !== "audio") {
    if (!positiveInteger(decoded.width) || !positiveInteger(decoded.height)) {
      throw new Task07ProcessorError("source-dimensions-invalid");
    }
    if ((dimensionBudget.maxWidth !== null &&
        decoded.width > dimensionBudget.maxWidth) ||
      (dimensionBudget.maxHeight !== null &&
        decoded.height > dimensionBudget.maxHeight) ||
      (dimensionBudget.maxPixels !== null &&
        decoded.width * decoded.height > dimensionBudget.maxPixels)) {
      throw new Task07ProcessorError("source-dimension-budget-exceeded");
    }
  }
  if (contract.mediaType !== "image" &&
    contract.maxDurationMs !== null &&
    (
      !positiveInteger(decoded.durationMs) ||
      Number(decoded.durationMs) > contract.maxDurationMs
    )) {
    throw new Task07ProcessorError("source-duration-budget-exceeded");
  }
};

const descriptor = (
  object: Task07GeneratedObject
): Omit<InspectedMediaObject, "generation"> => ({
  path: object.path,
  contentType: object.contentType,
  bytes: object.buffer.byteLength,
  width: object.width,
  height: object.height,
  durationMs: object.durationMs,
  orientationDegrees: object.orientationDegrees,
  cacheControl: MEDIA_PRIVATE_CACHE_CONTROL,
  checksum: object.checksum,
});

export const processTask07MediaSource = async (input: {
  plan: Task07ProcessorPlan;
  sourceGeneration: string;
  source: Buffer;
  transformer: Task07MediaTransformer;
  legacyMapBackfill?: boolean;
}): Promise<Task07ProcessingResult> => {
  const dimensionBudget = task07SourceDimensionBudget(
    input.plan.kind,
    input.legacyMapBackfill === true
  );
  const maxInputPixels = dimensionBudget.maxPixels || 1;
  const decoded = await input.transformer.inspectSource({
    buffer: input.source,
    kind: input.plan.kind,
    declaredContentType: input.plan.sourceContentType,
    maxInputPixels,
  });
  validateSource(input.plan, input.source, decoded, dimensionBudget);
  const generated = buildGeneratedMediaStoragePlan({
    kind: input.plan.kind,
    audienceScope: input.plan.audienceScope,
    ownerKey: input.plan.ownerKey,
    assetId: input.plan.assetId,
    sourceGeneration: input.sourceGeneration,
  });
  const original: Task07GeneratedObject = {
    path: generated.originalPath,
    contentType: decoded.contentType,
    buffer: input.source,
    width: decoded.width,
    height: decoded.height,
    durationMs: decoded.durationMs,
    orientationDegrees: decoded.orientationDegrees,
    checksum: checksum(input.source),
    role: "original",
  };
  const objects: Task07GeneratedObject[] = [original];
  const variants: Partial<
    Record<MediaVariantName, Omit<InspectedMediaObject, "generation">>
  > = {};
  for (const variant of Object.keys(
    MEDIA_CONTRACTS[input.plan.kind].variants
  ) as MediaVariantName[]) {
    const contract = MEDIA_CONTRACTS[input.plan.kind].variants[variant];
    const path = generated.variants[variant];
    if (!contract || !path) {
      throw new Task07ProcessorError("processor-contract-invalid");
    }
    const output = await input.transformer.createVariant({
      buffer: input.source,
      kind: input.plan.kind,
      source: decoded,
      variant,
      maxInputPixels,
    });
    const expected = plannedMediaVariantDimensions(decoded, contract);
    if (!expected ||
      output.width !== expected.width ||
      output.height !== expected.height ||
      output.buffer.byteLength <= 0 ||
      output.buffer.byteLength > contract.maxBytes) {
      throw new Task07ProcessorError("variant-verification-failed");
    }
    const object: Task07GeneratedObject = {
      path,
      contentType: contract.contentType,
      buffer: output.buffer,
      width: output.width,
      height: output.height,
      durationMs: null,
      orientationDegrees: 0,
      checksum: checksum(output.buffer),
      role: variant,
    };
    objects.push(object);
    variants[variant] = descriptor(object);
  }
  return {
    source: {
      mime: decoded.contentType,
      bytes: input.source.byteLength,
      width: decoded.width,
      height: decoded.height,
      durationMs: decoded.durationMs,
      checksum: original.checksum,
      orientation: decoded.orientationDegrees,
      codec: decoded.codec,
    },
    objects,
    original: descriptor(original),
    variants,
  };
};
