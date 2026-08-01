import {createHash} from "crypto";
import {
  asItemMediaReferenceScope,
  asMediaKind,
  buildTask07StagingPath,
  ITEM_MEDIA_REFERENCE_SCOPES,
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_PROCESSING_LEASE_MS,
  MEDIA_SCHEMA_VERSION,
  ItemMediaReferenceScope,
  MediaAudienceScope,
  MediaKind,
  normalizeMediaContentType,
  resolveMediaAudienceScope,
  isSafeMediaSegment,
  mediaAssetId,
  validateMediaOperationId,
} from "./mediaContracts";

export type Task07MediaTargetKind =
  "profile" | "user-inventory" | "catalog-item" | "npc" | "foe" |
  "user-technique" | "common-technique" | "user-spell" |
  "grigliata-token" | "grigliata-background" |
  "grigliata-music-track";

export type Task07MediaTargetSlot = "media" | "videoMedia";

export interface Task07MediaTargetFields {
  slot: Task07MediaTargetSlot;
  mediaField: "media" | "videoMedia";
  revisionField: "task07MediaRevision" | "task07VideoMediaRevision";
  updatedAtField: "mediaUpdatedAt" | "videoMediaUpdatedAt";
}

export interface Task07MediaReferenceSlotScan {
  assetIds: string[];
  malformed: boolean;
}

export type Task07MediaReferenceScan = Record<
  Task07MediaTargetSlot,
  Task07MediaReferenceSlotScan
>;

export interface MediaUploadPlan {
  schemaVersion: number;
  contractVersion: number;
  policyVersion: number;
  assetId: string;
  kind: MediaKind;
  targetKind: Task07MediaTargetKind;
  actorUid: string;
  ownerUid: string;
  ownerKey: string;
  entityId: string;
  commonTechnique?: boolean;
  referenceScope: ItemMediaReferenceScope | null;
  audienceScope: MediaAudienceScope;
  previousAssetId: string | null;
  operationId: string;
  sourceContentType: string;
  sourceBytes: number;
  sourcePath: string;
  // Compatibility alias for callers being migrated. It is staging, not a
  // browser-writable canonical original.
  originalPath: string;
  variants: {};
  passthrough: false;
  requestHash: string;
}

export interface Task07MediaValue {
  schemaVersion: number;
  contractVersion: number;
  assetId: string;
  kind: MediaKind;
  state: "ready";
  original: Record<string, unknown>;
  variants: Record<string, Record<string, unknown>>;
  processing: {
    authoritative: true;
    fallbackCode: null;
  };
}

export type Task07MediaAssetState =
  "intent" | "uploaded" | "processing" | "ready" | "attached" |
  "superseded" | "cleanup-pending" | "deleted" | "cancelled" |
  "rejected" | "failed";

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

const hash = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

const targetKindFor = (
  kind: MediaKind,
  referenceScope: ItemMediaReferenceScope | null,
  commonTechnique: boolean
): Task07MediaTargetKind | null => {
  switch (kind) {
  case "avatar": return "profile";
  case "item":
    return referenceScope === "global-catalog" ?
      "catalog-item" :
      referenceScope === "user-inventory" ? "user-inventory" : null;
  case "token": return "grigliata-token";
  case "npc": return "npc";
  case "foe": return "foe";
  case "technique":
  case "technique-video": return commonTechnique ?
    "common-technique" :
    "user-technique";
  case "spell":
  case "spell-video": return "user-spell";
  case "map":
  case "map-video": return "grigliata-background";
  case "music": return "grigliata-music-track";
  default: return null;
  }
};

export const task07MediaTargetFields = (
  input: Pick<MediaUploadPlan, "kind">
): Task07MediaTargetFields => {
  const video = input.kind === "technique-video" ||
    input.kind === "spell-video";
  return video ? {
    slot: "videoMedia",
    mediaField: "videoMedia",
    revisionField: "task07VideoMediaRevision",
    updatedAtField: "videoMediaUpdatedAt",
  } : {
    slot: "media",
    mediaField: "media",
    revisionField: "task07MediaRevision",
    updatedAtField: "mediaUpdatedAt",
  };
};

const isCanonicalAssetId = (value: unknown): value is string =>
  typeof value === "string" && /^m_[a-f0-9]{40}$/.test(value);

export const buildTask07MediaUploadPlan = (input: {
  actorUid: unknown;
  ownerUid: unknown;
  entityId: unknown;
  commonTechnique?: unknown;
  referenceScope?: unknown;
  previousAssetId?: unknown;
  operationId: unknown;
  kind: unknown;
  sourceContentType: unknown;
  sourceBytes: unknown;
}): MediaUploadPlan => {
  const actorUid = typeof input.actorUid === "string" ? input.actorUid.trim() : "";
  const ownerUid = typeof input.ownerUid === "string" ? input.ownerUid.trim() : "";
  const entityId = typeof input.entityId === "string" ? input.entityId.trim() : "";
  const commonTechnique = input.commonTechnique === true;
  const commonTechniqueSpecified = input.commonTechnique !== undefined;
  const operationId = validateMediaOperationId(input.operationId);
  const kind = asMediaKind(input.kind);
  const sourceContentType = normalizeMediaContentType(input.sourceContentType);
  const sourceBytes = Number(input.sourceBytes);
  const requestedScope = asItemMediaReferenceScope(input.referenceScope);
  const usesScope = kind === "item";
  const referenceScope = usesScope ? requestedScope : null;
  const previousAssetId = input.previousAssetId === undefined ||
    input.previousAssetId === null ?
    null :
    typeof input.previousAssetId === "string" ?
      input.previousAssetId.trim() :
      "";
  if (!kind ||
    !isSafeMediaSegment(actorUid) ||
    !isSafeMediaSegment(ownerUid) ||
    !isSafeMediaSegment(entityId) ||
    (input.commonTechnique !== undefined &&
      typeof input.commonTechnique !== "boolean") ||
    (commonTechnique && !["technique", "technique-video"].includes(kind || "")) ||
    !operationId ||
    (usesScope && !referenceScope) ||
    (!usesScope && input.referenceScope !== undefined &&
      input.referenceScope !== null) ||
    (previousAssetId !== null && !isCanonicalAssetId(previousAssetId)) ||
    !Number.isSafeInteger(sourceBytes) ||
    sourceBytes <= 0) {
    throw new TypeError("Media upload identity is invalid.");
  }
  if (kind === "avatar" && entityId !== ownerUid) {
    throw new TypeError("Avatar media must target its owner profile.");
  }
  const contract = MEDIA_CONTRACTS[kind];
  if (!contract.source.contentTypes.includes(sourceContentType)) {
    throw new TypeError(`Unsupported ${kind} media type.`);
  }
  if (sourceBytes > contract.source.maxBytes) {
    throw new TypeError(`${kind} media exceeds the source byte budget.`);
  }
  const targetKind = targetKindFor(kind, referenceScope, commonTechnique);
  if (!targetKind) {
    throw new TypeError(`No Task 07 target adapter is registered for ${kind}.`);
  }
  const assetId = mediaAssetId(actorUid, operationId);
  if (previousAssetId === assetId) {
    throw new TypeError(
      "Previous media asset must differ from its replacement."
    );
  }
  const sourcePath = buildTask07StagingPath(ownerUid, assetId);
  const request = {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    contractVersion: MEDIA_CONTRACT_VERSION,
    policyVersion: MEDIA_CONTRACT_VERSION,
    assetId,
    kind,
    targetKind,
    actorUid,
    ownerUid,
    ownerKey: ownerUid,
    entityId,
    ...(commonTechniqueSpecified ? {commonTechnique} : {}),
    referenceScope,
    audienceScope: commonTechnique ?
      "signed-in" as const :
      resolveMediaAudienceScope(kind, referenceScope),
    previousAssetId,
    operationId,
    sourceContentType,
    sourceBytes,
    sourcePath,
    originalPath: sourcePath,
    variants: {} as const,
    passthrough: false as const,
  };
  return {...request, requestHash: hash(request)};
};

export const isTask07MediaRequestAuthorized = (input: {
  kind: MediaKind;
  actorUid: string;
  ownerUid: string;
  referenceScope: ItemMediaReferenceScope | null;
  actorRole: string;
}): boolean => {
  const isOwner = input.actorUid === input.ownerUid;
  const manager = ["dm", "webmaster"].includes(input.actorRole);
  switch (input.kind) {
  case "avatar": return isOwner;
  case "item":
    return input.referenceScope === "global-catalog" ?
      isOwner && manager :
      input.referenceScope === "user-inventory" && (isOwner || manager);
  case "token": return isOwner || input.actorRole === "dm";
  case "npc": return isOwner && manager;
  case "foe":
  case "map":
  case "map-video":
  case "music": return isOwner && manager;
  case "technique":
  case "technique-video":
  case "spell":
  case "spell-video": return isOwner || manager;
  default: return false;
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
  const manager = ["dm", "webmaster"].includes(input.actorRole);
  switch (input.kind) {
  case "avatar": return isOwner;
  case "item":
    return input.referenceScope === "global-catalog" ?
      manager :
      input.referenceScope === "user-inventory" && (isOwner || manager);
  case "npc": return manager;
  case "foe":
  case "map":
  case "map-video":
  case "music": return manager;
  case "token": return isOwner || input.actorRole === "dm";
  case "technique":
  case "technique-video":
  case "spell":
  case "spell-video": return isOwner || manager;
  default: return false;
  }
};

const asReferenceRecord = (
  value: unknown
): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value) ?
    value as Record<string, unknown> :
    null
);

export const scanTask07MediaTargetReferences = (
  value: unknown
): Task07MediaReferenceScan => {
  const root = asReferenceRecord(value) || {};
  const general = asReferenceRecord(root.General);
  const containers = general ? [root, general] : [root];
  const scan = (slot: Task07MediaTargetSlot): Task07MediaReferenceSlotScan => {
    const assetIds = new Set<string>();
    let malformed = false;
    containers.forEach((container) => {
      const candidate = container[slot];
      if (candidate === undefined || candidate === null) return;
      const descriptor = asReferenceRecord(candidate);
      if (!descriptor || !isCanonicalAssetId(descriptor.assetId)) {
        malformed = true;
        return;
      }
      assetIds.add(descriptor.assetId);
    });
    return {assetIds: [...assetIds].sort(), malformed};
  };
  return {media: scan("media"), videoMedia: scan("videoMedia")};
};

export const task07MediaTargetSlotAssetId = (
  value: unknown,
  slot: Task07MediaTargetSlot
): string | null => {
  const scan = scanTask07MediaTargetReferences(value)[slot];
  return !scan.malformed && scan.assetIds.length === 1 ?
    scan.assetIds[0] :
    null;
};

export const task07MediaTargetSlotReferencesAsset = (
  value: unknown,
  slot: Task07MediaTargetSlot,
  assetId: string
): boolean => {
  const scan = scanTask07MediaTargetReferences(value)[slot];
  return !scan.malformed &&
    scan.assetIds.length === 1 &&
    scan.assetIds[0] === assetId;
};

export const task07MediaTargetMayReferenceAsset = (
  value: unknown,
  assetId: string
): boolean => Object.values(scanTask07MediaTargetReferences(value))
  .some((scan) => scan.malformed || scan.assetIds.includes(assetId));

export const task07MediaReferencePath = (input: {
  kind: MediaKind;
  ownerUid: string;
  entityId: string;
  commonTechnique?: boolean;
  referenceScope: ItemMediaReferenceScope | null;
}): string => {
  switch (input.kind) {
  case "avatar": return `users/${input.ownerUid}`;
  case "item":
    if (input.referenceScope === "global-catalog") {
      return `items/${input.entityId}`;
    }
    if (input.referenceScope === "user-inventory") {
      return `users/${input.ownerUid}/inventory/${input.entityId}`;
    }
    break;
  case "token": return `grigliata_tokens/${input.entityId}`;
  case "npc": return `echi_npcs/${input.entityId}`;
  case "foe": return `foes/${input.entityId}`;
  case "technique":
  case "technique-video":
    if (input.commonTechnique === true) return "utils/tecniche_common";
    return `users/${input.ownerUid}/tecniche/${input.entityId}`;
  case "spell":
  case "spell-video":
    return `users/${input.ownerUid}/spells/${input.entityId}`;
  case "map":
  case "map-video":
    return `grigliata_backgrounds/${input.entityId}`;
  case "music":
    return `grigliata_music_tracks/${input.entityId}`;
  default:
    break;
  }
  throw new TypeError("Task 07 media target is unsupported.");
};

export const isTask07MediaPlanReferenceCompatible = (
  first: MediaUploadPlan | null,
  second: MediaUploadPlan | null
): boolean => {
  if (!first || !second ||
    first.kind !== second.kind ||
    first.targetKind !== second.targetKind ||
    first.entityId !== second.entityId ||
    (first.commonTechnique === true) !== (second.commonTechnique === true) ||
    first.referenceScope !== second.referenceScope) return false;
  try {
    return task07MediaReferencePath(first) === task07MediaReferencePath(second);
  } catch {
    return false;
  }
};

export const isTask07PreviousMediaPlanCompatible = (
  replacement: MediaUploadPlan,
  previous: MediaUploadPlan | null
): boolean => Boolean(
  replacement.previousAssetId &&
  previous &&
  replacement.previousAssetId === previous.assetId &&
  replacement.assetId !== previous.assetId &&
  isTask07MediaPlanReferenceCompatible(replacement, previous)
);

export const task07MediaRetirementResponseAssetId = (
  replacement: MediaUploadPlan
): string | null => replacement.previousAssetId;

export const isTask07MediaStateAbandonable = (
  state: unknown
): boolean => [
  "intent", "uploaded", "processing", "failed", "rejected", "ready",
].includes(typeof state === "string" ? state : "");

const TASK07_MEDIA_CLEANUP_ELIGIBLE_STATES = new Set([
  "ready", "superseded", "cancelled", "rejected", "failed",
  "cleanup-pending",
]);

const TASK07_MEDIA_MANUAL_CLEANUP_RETRY_STATES = new Set([
  "superseded", "cancelled", "rejected", "failed", "cleanup-pending",
]);

const TASK07_ACTIVE_CLEANUP_QUEUE_STATES = new Set([
  "pending", "retry", "processing",
]);

export const isTask07MediaStateCleanupEligible = (
  state: unknown
): boolean => typeof state === "string" &&
  TASK07_MEDIA_CLEANUP_ELIGIBLE_STATES.has(state);

export const isTask07MediaStateManualCleanupRetryable = (
  state: unknown
): boolean => typeof state === "string" &&
  TASK07_MEDIA_MANUAL_CLEANUP_RETRY_STATES.has(state);

export const isTask07CleanupQueueClaimable = (input: {
  state: unknown;
  leaseUntilMs: unknown;
  nowMs: number;
}): boolean => {
  if (input.state === "pending" || input.state === "retry") return true;
  if (input.state !== "processing") return false;
  const leaseUntilMs = Number(input.leaseUntilMs);
  return !Number.isFinite(leaseUntilMs) || leaseUntilMs <= input.nowMs;
};

export const partitionTask07CleanupSweepRecords = <RecordType extends {
  state: unknown;
}>(records: readonly RecordType[]): {
  active: RecordType[];
  terminal: RecordType[];
} => records.reduce((result, record) => {
  (typeof record.state === "string" &&
    TASK07_ACTIVE_CLEANUP_QUEUE_STATES.has(record.state) ?
    result.active : result.terminal).push(record);
  return result;
}, {active: [], terminal: []} as {
  active: RecordType[];
  terminal: RecordType[];
});

export const isTask07ProcessingLeaseExpired = (input: {
  state: unknown;
  updatedAtMs: unknown;
  nowMs: number;
  leaseMs?: number;
}): boolean => input.state === "processing" &&
  Number.isFinite(input.updatedAtMs) &&
  Number(input.updatedAtMs) <=
    input.nowMs - (input.leaseMs ?? MEDIA_PROCESSING_LEASE_MS);

export const task07CleanupRetryDelayMs = (attempts: unknown): number => {
  const count = Number.isSafeInteger(attempts) ?
    Math.max(1, Number(attempts)) :
    1;
  return Math.min(60 * 60 * 1000, 30_000 * (2 ** (count - 1)));
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
      const index = cursor++;
      results[index] = await worker(inputs[index], index);
    }
  };
  await Promise.all(Array.from(
    {length: Math.min(concurrency, inputs.length)},
    () => run()
  ));
  return results;
};

export const asStoredTask07MediaUploadPlan = (
  value: unknown
): MediaUploadPlan | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as Partial<MediaUploadPlan>;
  try {
    const rebuilt = buildTask07MediaUploadPlan({
      actorUid: plan.actorUid,
      ownerUid: plan.ownerUid,
      entityId: plan.entityId,
      commonTechnique: plan.commonTechnique,
      referenceScope: plan.referenceScope,
      previousAssetId: plan.previousAssetId,
      operationId: plan.operationId,
      kind: plan.kind,
      sourceContentType: plan.sourceContentType,
      sourceBytes: plan.sourceBytes,
    });
    return rebuilt.requestHash === plan.requestHash ? rebuilt : null;
  } catch {
    return null;
  }
};

export const TASK07_MEDIA_REFERENCE_SCOPES =
  ITEM_MEDIA_REFERENCE_SCOPES;
