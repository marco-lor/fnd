import {createHash} from "crypto";
import {
  asItemMediaReferenceScope,
  asMediaKind,
  buildMediaStoragePlan,
  InspectedMediaObject,
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_PROCESSING_LEASE_MS,
  MEDIA_SCHEMA_VERSION,
  ItemMediaReferenceScope,
  MediaKind,
  mediaAssetId,
  MediaVariantName,
  normalizeMediaContentType,
  parseCanonicalMediaPath,
  isSafeMediaSegment,
  validateMediaObject,
  validateMediaOperationId,
} from "./mediaContracts";

export interface MediaUploadPlan {
  schemaVersion: number;
  contractVersion: number;
  assetId: string;
  kind: MediaKind;
  actorUid: string;
  ownerUid: string;
  entityId: string;
  referenceScope: ItemMediaReferenceScope | null;
  previousAssetId: string | null;
  operationId: string;
  sourceContentType: string;
  requestHash: string;
  originalPath: string;
  variants: Partial<Record<MediaVariantName, string>>;
  passthrough: boolean;
}

export interface Task07MediaValue {
  schemaVersion: number;
  contractVersion: number;
  assetId: string;
  kind: MediaKind;
  state: "ready" | "fallback";
  original: InspectedMediaObject;
  variants: Partial<Record<MediaVariantName, InspectedMediaObject>>;
  processing: {
    authoritative: true;
    fallbackCode: string | null;
  };
}

export type Task07MediaAssetState =
  "prepared" | "finalizing" | "ready" | "fallback" | "referenced" |
  "superseded" | "failed" | "cleanup-pending" | "cleanup-failed" |
  "cleaned";

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

const hash = (value: unknown): string => (
  createHash("sha256").update(stableStringify(value)).digest("hex")
);

export const buildTask07MediaUploadPlan = (input: {
  actorUid: unknown;
  ownerUid: unknown;
  entityId: unknown;
  referenceScope?: unknown;
  previousAssetId?: unknown;
  operationId: unknown;
  kind: unknown;
  sourceContentType: unknown;
}): MediaUploadPlan => {
  const actorUid = typeof input.actorUid === "string" ? input.actorUid.trim() : "";
  const ownerUid = typeof input.ownerUid === "string" ? input.ownerUid.trim() : "";
  const entityId = typeof input.entityId === "string" ? input.entityId.trim() : "";
  const operationId = validateMediaOperationId(input.operationId);
  const kind = asMediaKind(input.kind);
  const requestedReferenceScope = asItemMediaReferenceScope(
    input.referenceScope
  );
  const rawPreviousAssetId = typeof input.previousAssetId === "string" ?
    input.previousAssetId.trim() :
    "";
  const previousAssetId = rawPreviousAssetId || null;
  const previousAssetIdIsInvalid =
    input.previousAssetId !== undefined &&
    input.previousAssetId !== null &&
    (
      typeof input.previousAssetId !== "string" ||
      !/^m_[a-f0-9]{40}$/.test(rawPreviousAssetId)
    );
  const sourceContentType = normalizeMediaContentType(input.sourceContentType);
  if (!isSafeMediaSegment(actorUid) ||
    !isSafeMediaSegment(ownerUid) ||
    !isSafeMediaSegment(entityId) ||
    !operationId || !kind ||
    (kind === "item" && !requestedReferenceScope) ||
    (kind !== "item" && input.referenceScope !== undefined &&
      input.referenceScope !== null) ||
    previousAssetIdIsInvalid) {
    throw new TypeError("Media upload identity is invalid.");
  }
  const referenceScope = kind === "item" ? requestedReferenceScope : null;
  const assetId = mediaAssetId(actorUid, operationId);
  if (previousAssetId === assetId) {
    throw new TypeError(
      "Previous media asset must differ from its replacement."
    );
  }
  const storage = buildMediaStoragePlan({
    kind,
    ownerUid,
    assetId,
    sourceContentType,
  });
  const request = {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    contractVersion: MEDIA_CONTRACT_VERSION,
    assetId,
    kind,
    actorUid,
    ownerUid,
    entityId,
    referenceScope,
    previousAssetId,
    operationId,
    sourceContentType,
    originalPath: storage.originalPath,
    variants: storage.variants,
    passthrough: storage.passthrough,
  };
  return {
    ...request,
    requestHash: hash(request),
  };
};

export const isTask07MediaRequestAuthorized = (input: {
  kind: MediaKind;
  actorUid: string;
  ownerUid: string;
  referenceScope: ItemMediaReferenceScope | null;
  actorRole: string;
}): boolean => {
  const isOwner = input.actorUid === input.ownerUid;
  switch (input.kind) {
  case "avatar":
    return isOwner;
  case "item":
    if (input.referenceScope === "global-catalog") {
      return isOwner && ["dm", "webmaster"].includes(input.actorRole);
    }
    return input.referenceScope === "user-inventory" &&
      (isOwner || ["dm", "webmaster"].includes(input.actorRole));
  case "npc":
    return isOwner && ["dm", "webmaster"].includes(input.actorRole);
  case "foe":
  case "map":
  case "map-video":
    return isOwner && input.actorRole === "dm";
  default:
    return false;
  }
};

export const isTask07MediaRetirementAuthorized = (input: {
  kind: MediaKind;
  actorUid: string;
  ownerUid: string;
  referenceScope: ItemMediaReferenceScope | null;
  actorRole: string;
}): boolean => {
  const isOwner = input.actorUid === input.ownerUid;
  switch (input.kind) {
  case "avatar":
    return isOwner;
  case "item":
    if (input.referenceScope === "global-catalog") {
      return ["dm", "webmaster"].includes(input.actorRole);
    }
    return input.referenceScope === "user-inventory" &&
      (isOwner || ["dm", "webmaster"].includes(input.actorRole));
  case "npc":
    return ["dm", "webmaster"].includes(input.actorRole);
  case "foe":
  case "map":
  case "map-video":
    return input.actorRole === "dm";
  default:
    return false;
  }
};

export const task07MediaReferencePath = (input: {
  kind: MediaKind;
  ownerUid: string;
  entityId: string;
  referenceScope: ItemMediaReferenceScope | null;
}): string => {
  switch (input.kind) {
  case "avatar":
    return `users/${input.ownerUid}`;
  case "item": {
    if (input.referenceScope === "global-catalog") {
      return `items/${input.entityId}`;
    }
    if (input.referenceScope === "user-inventory") {
      return `users/${input.ownerUid}/inventory/${input.entityId}`;
    }
    throw new TypeError("Item media reference scope is invalid.");
  }
  case "npc":
    return `echi_npcs/${input.entityId}`;
  case "foe":
    return `foes/${input.entityId}`;
  case "map":
  case "map-video":
    return `grigliata_backgrounds/${input.entityId}`;
  }
};

export const isTask07MediaPlanReferenceCompatible = (
  firstPlan: MediaUploadPlan | null,
  secondPlan: MediaUploadPlan | null
): boolean => {
  if (!firstPlan || !secondPlan ||
    firstPlan.kind !== secondPlan.kind ||
    firstPlan.referenceScope !== secondPlan.referenceScope) {
    return false;
  }
  try {
    return task07MediaReferencePath(firstPlan) ===
      task07MediaReferencePath(secondPlan);
  } catch {
    return false;
  }
};

export const isTask07PreviousMediaPlanCompatible = (
  replacementPlan: MediaUploadPlan,
  previousPlan: MediaUploadPlan | null
): boolean => {
  if (!replacementPlan.previousAssetId || !previousPlan ||
    replacementPlan.assetId === previousPlan.assetId ||
    replacementPlan.previousAssetId !== previousPlan.assetId) {
    return false;
  }
  return isTask07MediaPlanReferenceCompatible(
    replacementPlan,
    previousPlan
  );
};

export const task07MediaRetirementResponseAssetId = (
  replacementPlan: MediaUploadPlan
): string | null => (
  replacementPlan.previousAssetId
);

export type Task07MediaRetirementChainAction =
  "supersede" | "already-superseded" |
  "follow-supersession" | "invalid";

export const task07MediaRetirementChainAction = (input: {
  replacementAssetId: string;
  candidateState: unknown;
  supersededByAssetId?: unknown;
}): Task07MediaRetirementChainAction => {
  if (!/^m_[a-f0-9]{40}$/.test(input.replacementAssetId)) return "invalid";
  const state = typeof input.candidateState === "string" ?
    input.candidateState :
    "";
  const boundReplacement = typeof input.supersededByAssetId === "string" ?
    input.supersededByAssetId :
    "";
  if (boundReplacement &&
    !/^m_[a-f0-9]{40}$/.test(boundReplacement)) return "invalid";
  if (state === "referenced") {
    return boundReplacement ? "invalid" : "supersede";
  }
  if (state === "superseded") {
    if (!boundReplacement ||
      boundReplacement === input.replacementAssetId) {
      return "already-superseded";
    }
    return "follow-supersession";
  }
  if (["cleanup-pending", "cleanup-failed", "cleaned"].includes(state)) {
    if (!boundReplacement) return "invalid";
    return boundReplacement === input.replacementAssetId ?
      "already-superseded" :
      "follow-supersession";
  }
  return "invalid";
};

export type Task07PreviousRetirementAction =
  "not-requested" | Task07MediaRetirementChainAction;

export const task07PreviousRetirementAction = (input: {
  replacementPlan: MediaUploadPlan;
  previousPlan: MediaUploadPlan | null;
  previousState: unknown;
  supersededByAssetId?: unknown;
}): Task07PreviousRetirementAction => {
  if (!input.replacementPlan.previousAssetId) return "not-requested";
  if (!isTask07PreviousMediaPlanCompatible(
    input.replacementPlan,
    input.previousPlan
  )) return "invalid";
  return task07MediaRetirementChainAction({
    replacementAssetId: input.replacementPlan.assetId,
    candidateState: input.previousState,
    supersededByAssetId: input.supersededByAssetId,
  });
};

const storagePathFromValue = (value: string): string => {
  if (!value.includes("://")) return value;
  try {
    const parsed = new URL(value);
    const isFirebaseHost = [
      "firebasestorage.googleapis.com",
      "storage.googleapis.com",
      "127.0.0.1",
      "localhost",
      "::1",
    ].includes(parsed.hostname);
    if (!isFirebaseHost) return "";
    const encoded = parsed.pathname.split("/o/")[1];
    return encoded ? decodeURIComponent(encoded) : "";
  } catch {
    return "";
  }
};

const MEDIA_REFERENCE_KEYS = new Set([
  "imagePath",
  "imageUrl",
  "image_url",
  "path",
  "url",
]);

export const containsTask07MediaPath = (
  value: unknown,
  expectedPath: string,
  key = ""
): boolean => {
  if (typeof value === "string") {
    return MEDIA_REFERENCE_KEYS.has(key) &&
      storagePathFromValue(value) === expectedPath;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => (
      containsTask07MediaPath(entry, expectedPath, key)
    ));
  }
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([name, entry]) => (
    containsTask07MediaPath(entry, expectedPath, name)
  ));
};

export type Task07CanonicalMediaReferenceSelection = {
  status: "none" | "single" | "invalid" | "ambiguous";
  media: Record<string, unknown> | null;
  assetId: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value && typeof value === "object" && !Array.isArray(value))
);

export const shouldClearTask07DeletedUserTokenProjection = (
  uid: string,
  value: unknown
): boolean => (
  isSafeMediaSegment(uid) &&
  isRecord(value) &&
  value.ownerUid === uid &&
  value.tokenType === "character" &&
  value.imageSource === "profile"
);

const isCanonicalTask07MediaValue = (
  value: unknown
): value is Record<string, unknown> => {
  if (!isRecord(value) ||
    value.schemaVersion !== MEDIA_SCHEMA_VERSION ||
    value.contractVersion !== MEDIA_CONTRACT_VERSION ||
    typeof value.assetId !== "string" ||
    !/^m_[a-f0-9]{40}$/.test(value.assetId) ||
    !asMediaKind(value.kind) ||
    !["ready", "fallback"].includes(String(value.state)) ||
    !isRecord(value.original)) {
    return false;
  }
  const parsedOriginal = parseCanonicalMediaPath(value.original.path);
  return Boolean(parsedOriginal &&
    parsedOriginal.role === "original" &&
    parsedOriginal.assetId === value.assetId &&
    parsedOriginal.kind === value.kind);
};

export const selectTask07CanonicalMediaReference = (
  value: unknown
): Task07CanonicalMediaReferenceSelection => {
  if (!isRecord(value)) {
    return {status: "none", media: null, assetId: null};
  }
  const general = value.General;
  const candidates: unknown[] = [];
  if (Object.prototype.hasOwnProperty.call(value, "media")) {
    candidates.push(value.media);
  }
  if (isRecord(general) &&
    Object.prototype.hasOwnProperty.call(general, "media")) {
    candidates.push(general.media);
  }
  const unique = new Map<string, Record<string, unknown>>();
  let invalid = false;
  candidates.forEach((candidate) => {
    if (candidate === null) return;
    if (!isRecord(candidate)) {
      invalid = true;
      return;
    }
    if (!isCanonicalTask07MediaValue(candidate)) {
      invalid = true;
      return;
    }
    unique.set(stableStringify(candidate), candidate);
  });
  if (invalid) {
    return {status: "invalid", media: null, assetId: null};
  }
  if (unique.size === 0) {
    return {status: "none", media: null, assetId: null};
  }
  if (unique.size > 1) {
    return {status: "ambiguous", media: null, assetId: null};
  }
  const media = [...unique.values()][0];
  return {
    status: "single",
    media,
    assetId: media.assetId as string,
  };
};

export type Task07MediaReferenceRemovalAction =
  "none" | "replacement-present" | "superseded-grace" |
  "cleanup-immediate" | "invalid";

export const task07MediaAssetChainsIntersect = (
  firstAssetIds: readonly string[],
  secondAssetIds: readonly string[]
): boolean => {
  const first = new Set(firstAssetIds.filter((assetId) => (
    /^m_[a-f0-9]{40}$/.test(assetId)
  )));
  return secondAssetIds.some((assetId) => (
    /^m_[a-f0-9]{40}$/.test(assetId) && first.has(assetId)
  ));
};

export const task07MediaReferenceRemovalAction = (input: {
  beforeValue: unknown;
  afterValue: unknown;
  currentValue: unknown;
  eventAfterExists: boolean;
  currentExists: boolean;
  currentOwnsRemovedChain?: boolean;
}): Task07MediaReferenceRemovalAction => {
  const before = selectTask07CanonicalMediaReference(input.beforeValue);
  const after = selectTask07CanonicalMediaReference(input.afterValue);
  const current = selectTask07CanonicalMediaReference(input.currentValue);
  if ([before, after, current].some(({status}) => (
    status === "invalid" || status === "ambiguous"
  ))) return "invalid";
  if (before.status !== "single") return "none";
  if (after.status === "single" &&
    after.assetId === before.assetId) {
    return "replacement-present";
  }
  if (current.status === "single" &&
    (
      current.assetId === before.assetId ||
      input.currentOwnsRemovedChain
    )) {
    return "replacement-present";
  }
  return input.eventAfterExists && input.currentExists ?
    "superseded-grace" :
    "cleanup-immediate";
};

export const containsTask07MediaReference = (
  value: unknown,
  expectedMedia: unknown
): boolean => {
  if (!isCanonicalTask07MediaValue(expectedMedia)) return false;
  const selected = selectTask07CanonicalMediaReference(value);
  return selected.status === "single" &&
    stableStringify(selected.media) === stableStringify(expectedMedia);
};

export const shouldRecoverCommittedTask07MediaReference = (input: {
  state: unknown;
  referenceValue: unknown;
  expectedMedia: unknown;
}): boolean => (
  ["ready", "fallback"].includes(
    typeof input.state === "string" ? input.state : ""
  ) && containsTask07MediaReference(
    input.referenceValue,
    input.expectedMedia
  )
);

const normalizeInspectedObject = (
  inspected: InspectedMediaObject
): InspectedMediaObject => ({
  path: inspected.path,
  contentType: normalizeMediaContentType(inspected.contentType),
  bytes: inspected.bytes,
  width: inspected.width,
  height: inspected.height,
  durationMs: inspected.durationMs,
  orientationDegrees: inspected.orientationDegrees,
  generation: inspected.generation,
  cacheControl: inspected.cacheControl,
});

export const finalizeTask07MediaValue = (input: {
  plan: MediaUploadPlan;
  original: InspectedMediaObject;
  variants: Partial<Record<MediaVariantName, InspectedMediaObject>>;
}): Task07MediaValue => {
  const errors: string[] = [];
  if (input.original.path !== input.plan.originalPath) {
    errors.push("original-path-mismatch");
  }
  if (normalizeMediaContentType(input.original.contentType) !==
    input.plan.sourceContentType) {
    errors.push("original-content-type-mismatch");
  }
  const originalValidation = validateMediaObject(
    input.plan.kind,
    input.original,
    null,
    {requirePrivateMetadata: true}
  );
  errors.push(...originalValidation.errors.map((code) => `original:${code}`));

  const expectedVariants = Object.entries(input.plan.variants) as Array<
    [MediaVariantName, string]
  >;
  const actualVariantNames = Object.keys(input.variants).sort();
  const expectedVariantNames = expectedVariants.map(([name]) => name).sort();
  if (actualVariantNames.join(",") !== expectedVariantNames.join(",")) {
    errors.push("variant-set-mismatch");
  }
  expectedVariants.forEach(([name, expectedPath]) => {
    const inspected = input.variants[name];
    if (!inspected) return;
    if (inspected.path !== expectedPath) errors.push(`${name}:path-mismatch`);
    const result = validateMediaObject(
      input.plan.kind,
      inspected,
      name,
      {
        requirePrivateMetadata: true,
        sourceDimensions: input.original,
      }
    );
    errors.push(...result.errors.map((code) => `${name}:${code}`));
  });
  if (input.plan.passthrough && expectedVariantNames.length) {
    errors.push("passthrough-variants-forbidden");
  }
  if (errors.length) {
    throw new TypeError(`Media finalization failed: ${[...new Set(errors)].join(",")}`);
  }

  const variants = Object.fromEntries(
    expectedVariants.map(([name]) => [
      name,
      normalizeInspectedObject(input.variants[name] as InspectedMediaObject),
    ])
  ) as Partial<Record<MediaVariantName, InspectedMediaObject>>;
  return {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    contractVersion: MEDIA_CONTRACT_VERSION,
    assetId: input.plan.assetId,
    kind: input.plan.kind,
    state: input.plan.passthrough ? "fallback" : "ready",
    original: normalizeInspectedObject(input.original),
    variants,
    processing: {
      authoritative: true,
      fallbackCode: input.plan.passthrough ?
        "source-mime-passthrough" :
        null,
    },
  };
};

export const task07MediaCleanupPaths = (
  plan: Pick<MediaUploadPlan, "assetId" | "kind" | "ownerUid" |
  "originalPath" | "variants">
): string[] => {
  const expectedPrefix = `media/v${MEDIA_SCHEMA_VERSION}/` +
    `${plan.kind}/${plan.ownerUid}/${plan.assetId}/`;
  return [plan.originalPath, ...Object.values(plan.variants)]
    .filter((value): value is string => typeof value === "string")
    .filter((path) => {
      const parsed = parseCanonicalMediaPath(path);
      return Boolean(parsed && path.startsWith(expectedPrefix) &&
        parsed.assetId === plan.assetId &&
        parsed.ownerUid === plan.ownerUid &&
        parsed.kind === plan.kind);
    })
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort();
};

export const task07MediaVariantsForKind = (
  kind: MediaKind
): MediaVariantName[] => (
  Object.keys(MEDIA_CONTRACTS[kind].variants).sort() as MediaVariantName[]
);

export const isTask07MediaStateAbandonable = (
  state: unknown
): boolean => (
  ["prepared", "failed", "ready", "fallback", "cleanup-failed"]
    .includes(typeof state === "string" ? state : "")
);

export const isTask07ProcessingLeaseExpired = (input: {
  state: unknown;
  updatedAtMs: unknown;
  nowMs: number;
  leaseMs?: number;
}): boolean => {
  const leaseMs = input.leaseMs ?? MEDIA_PROCESSING_LEASE_MS;
  return ["finalizing", "processing"].includes(
    typeof input.state === "string" ? input.state : ""
  ) &&
    Number.isFinite(input.updatedAtMs) &&
    Number(input.updatedAtMs) <= input.nowMs - leaseMs;
};

export const task07CleanupRetryDelayMs = (attempts: unknown): number => {
  const normalized = Number.isSafeInteger(attempts) ?
    Math.max(1, Number(attempts)) :
    1;
  return Math.min(60 * 60 * 1000, 30_000 * (2 ** (normalized - 1)));
};

export const mapMediaCleanupWithConcurrency = async <Input, Output>(
  inputs: Input[],
  concurrency: number,
  worker: (input: Input, index: number) => Promise<Output>
): Promise<Output[]> => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError("Media cleanup concurrency must be positive.");
  }
  const results = new Array<Output>(inputs.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(inputs[index], index);
    }
  };
  await Promise.all(Array.from(
    {length: Math.min(concurrency, inputs.length)},
    () => run()
  ));
  return results;
};
