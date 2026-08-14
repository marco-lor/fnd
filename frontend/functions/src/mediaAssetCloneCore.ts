import {
  asStoredTask07MediaUploadPlan,
  buildTask07MediaUploadPlan,
  MediaUploadPlan,
  Task07NestedMediaTarget,
  scanTask07MediaTargetReferences,
  task07MediaReferencePath,
} from "./mediaAssetLifecycleCore";
import {
  buildGeneratedMediaStoragePlan,
  MEDIA_CONTRACT_VERSION,
  MEDIA_SCHEMA_VERSION,
  MediaVariantName,
  parseCanonicalMediaPath,
} from "./mediaContracts";
import {
  ReadyTask07GeneratedMedia,
  StoredTask07MediaObject,
  task07FoeCanonicalMediaStateFromTarget,
  task07MediaValueFromReadyManifest,
  task07ReadyGeneratedMediaFromManifest,
} from "./mediaTargetAdapters";
import {asRecord, asTrimmedString, hashValue} from "./userDataV2";

export type Task07CanonicalCloneRole = "original" | MediaVariantName;

export interface Task07CanonicalCloneEntry {
  role: Task07CanonicalCloneRole;
  source: StoredTask07MediaObject;
  destinationPath: string;
}

export interface Task07FoeMediaClonePlan {
  schemaVersion: 1;
  sourceAssetId: string;
  destinationAssetId: string;
  sourceFoeId: string;
  destinationFoeId: string;
  sourceReferencePath: string;
  destinationReferencePath: string;
  sourceManifestFingerprint: string;
  sourceGeneration: string;
  mediaOperationId: string;
  destinationPlan: MediaUploadPlan;
  entries: Task07CanonicalCloneEntry[];
}

export interface Task07FoeTokenMediaRegenerationPlan {
  schemaVersion: 1;
  sourceAssetId: string;
  sourceFoeId: string;
  sourceReferencePath: string;
  sourceManifestFingerprint: string;
  sourceGeneration: string;
  sourceOriginal: StoredTask07MediaObject;
  destinationTokenId: string;
  destinationReferencePath: string;
  mediaOperationId: string;
  destinationPlan: MediaUploadPlan;
}

export class Task07MediaClonePlanError extends Error {
  readonly code:
    "canonical-reference-invalid" |
    "canonical-video-unsupported" |
    "source-manifest-invalid" |
    "source-attachment-invalid" |
    "source-descriptor-invalid";

  constructor(code: Task07MediaClonePlanError["code"], message: string) {
    super(message);
    this.name = "Task07MediaClonePlanError";
    this.code = code;
  }
}

const canonicalDescriptors = (
  source: Record<string, unknown>,
  slot: "media" | "videoMedia"
): Record<string, unknown>[] => {
  const descriptors: Record<string, unknown>[] = [];
  const root = asRecord(source[slot]);
  if (Object.keys(root).length) descriptors.push(root);
  const general = asRecord(asRecord(source.General)[slot]);
  if (Object.keys(general).length) descriptors.push(general);
  return descriptors;
};

const canonicalImagePathAssetId = (
  source: Record<string, unknown>
): string | null => {
  const paths = [
    asTrimmedString(source.imagePath),
    asTrimmedString(asRecord(source.General).imagePath),
  ].filter(Boolean);
  if (paths.some((path) =>
    path.startsWith("media_assets/") && !parseCanonicalMediaPath(path))) {
    throw new Task07MediaClonePlanError(
      "canonical-reference-invalid",
      "Foe canonical image path is malformed."
    );
  }
  const assetIds = [...new Set(paths.flatMap((path) => {
    const parsed = parseCanonicalMediaPath(path);
    return parsed ? [parsed.assetId] : [];
  }))];
  if (assetIds.length > 1) {
    throw new Task07MediaClonePlanError(
      "canonical-reference-invalid",
      "Foe canonical image paths disagree."
    );
  }
  return assetIds[0] || null;
};

export const task07CanonicalFoeMediaAssetId = (
  source: Record<string, unknown>
): string | null => {
  const scan = scanTask07MediaTargetReferences(source);
  if (scan.videoMedia.malformed || scan.videoMedia.assetIds.length) {
    throw new Task07MediaClonePlanError(
      "canonical-video-unsupported",
      "Foe canonical video media is unsupported."
    );
  }
  const canonicalState = task07FoeCanonicalMediaStateFromTarget(source);
  if (canonicalState.conflict) {
    throw new Task07MediaClonePlanError(
      "canonical-reference-invalid",
      "Foe canonical media reference is malformed or conflicting."
    );
  }
  const descriptorAssetId = canonicalState.assetId;
  const pathAssetId = canonicalImagePathAssetId(source);
  if (pathAssetId && pathAssetId !== descriptorAssetId) {
    throw new Task07MediaClonePlanError(
      "canonical-reference-invalid",
      "Foe canonical image path is not backed by its media descriptor."
    );
  }
  return descriptorAssetId;
};

const sourceManifestFingerprint = (
  manifest: Record<string, unknown>,
  generated: ReadyTask07GeneratedMedia
): string => hashValue({
  schemaVersion: manifest.schemaVersion,
  policyVersion: manifest.policyVersion,
  state: manifest.state,
  requestHash: manifest.requestHash,
  plan: manifest.plan,
  attachment: manifest.attachment,
  generation: manifest.generation,
  generated,
});

const assertSourceDescriptors = (
  source: Record<string, unknown>,
  expected: Record<string, unknown>
): void => {
  const descriptors = canonicalDescriptors(source, "media");
  if (!descriptors.length ||
    descriptors.some((descriptor) =>
      hashValue(descriptor) !== hashValue(expected))) {
    throw new Task07MediaClonePlanError(
      "source-descriptor-invalid",
      "Foe media descriptor does not match its attached manifest."
    );
  }
};

const nestedTargetIdentityMatches = (
  left: Task07NestedMediaTarget | undefined,
  right: Task07NestedMediaTarget | undefined
): boolean => Boolean(left && right &&
  left.schemaVersion === right.schemaVersion &&
  left.kind === right.kind &&
  left.entryId === right.entryId &&
  left.slot === right.slot);

export const buildTask07FoeMediaClonePlan = (input: {
  actorUid: string;
  backendReceiptId: string;
  destinationFoeId: string;
  sourceFoeId: string;
  source: Record<string, unknown>;
  sourceManifest: Record<string, unknown> | null;
  sourceNestedTarget?: Task07NestedMediaTarget;
  destinationNestedTarget?: Task07NestedMediaTarget;
}): Task07FoeMediaClonePlan | null => {
  const sourceContainer = input.sourceNestedTarget ?
    asRecord(asRecord(input.source.task07EmbeddedMedia)[
      input.sourceNestedTarget.entryId
    ]) : input.source;
  const nestedScan = input.sourceNestedTarget ?
    scanTask07MediaTargetReferences(sourceContainer).media : null;
  if (nestedScan && (nestedScan.malformed || nestedScan.assetIds.length > 1)) {
    throw new Task07MediaClonePlanError(
      "canonical-reference-invalid",
      "Nested foe media reference is malformed or conflicting."
    );
  }
  const sourceAssetId = input.sourceNestedTarget ?
    nestedScan?.assetIds[0] || null :
    task07CanonicalFoeMediaAssetId(input.source);
  if (!sourceAssetId) return null;
  const manifest = input.sourceManifest;
  const sourcePlan = asStoredTask07MediaUploadPlan(manifest?.plan);
  if (!manifest ||
    manifest.schemaVersion !== MEDIA_SCHEMA_VERSION ||
    manifest.policyVersion !== MEDIA_CONTRACT_VERSION ||
    manifest.state !== "attached" ||
    !sourcePlan ||
    manifest.assetId !== sourceAssetId ||
    manifest.requestHash !== sourcePlan.requestHash ||
    manifest.generation !== asTrimmedString(manifest.generated &&
      asRecord(manifest.generated).generation) ||
    sourcePlan.assetId !== sourceAssetId ||
    sourcePlan.kind !== "foe" ||
    sourcePlan.targetKind !== (input.sourceNestedTarget?.kind || "foe") ||
    Boolean(sourcePlan.nestedTarget) !== Boolean(input.sourceNestedTarget) ||
    (input.sourceNestedTarget && !nestedTargetIdentityMatches(
      sourcePlan.nestedTarget,
      input.sourceNestedTarget
    )) ||
    sourcePlan.entityId !== input.sourceFoeId ||
    manifest.purpose !== sourcePlan.kind ||
    manifest.audience !== sourcePlan.audienceScope ||
    manifest.ownerUid !== sourcePlan.ownerUid ||
    manifest.actorUid !== sourcePlan.actorUid ||
    manifest.targetKind !== sourcePlan.targetKind ||
    manifest.targetId !== sourcePlan.entityId ||
    manifest.previousAssetId !== sourcePlan.previousAssetId) {
    throw new Task07MediaClonePlanError(
      "source-manifest-invalid",
      "Attached foe media manifest is invalid or incompatible."
    );
  }
  const sourceReferencePath = task07MediaReferencePath(sourcePlan);
  const attachment = asRecord(manifest.attachment);
  const targetSlot = asTrimmedString(attachment.targetSlot);
  if (sourceReferencePath !== `foes/${input.sourceFoeId}` ||
    asTrimmedString(attachment.referencePath) !== sourceReferencePath ||
    targetSlot !== "media" ||
    Boolean(attachment.nestedTarget) !== Boolean(input.sourceNestedTarget) ||
    (input.sourceNestedTarget && !nestedTargetIdentityMatches(
      attachment.nestedTarget as Task07NestedMediaTarget,
      input.sourceNestedTarget
    ))) {
    throw new Task07MediaClonePlanError(
      "source-attachment-invalid",
      "Foe media manifest is attached to a different target."
    );
  }
  let generated: ReadyTask07GeneratedMedia;
  let expectedMedia: Record<string, unknown>;
  try {
    generated = task07ReadyGeneratedMediaFromManifest(manifest, sourcePlan);
    expectedMedia = task07MediaValueFromReadyManifest(manifest, sourcePlan);
  } catch {
    throw new Task07MediaClonePlanError(
      "source-manifest-invalid",
      "Attached foe media family is incomplete."
    );
  }
  assertSourceDescriptors(sourceContainer, expectedMedia);

  const nestedIdentity = input.sourceNestedTarget ?
    hashValue({
      entryId: input.sourceNestedTarget.entryId,
      kind: input.sourceNestedTarget.kind,
      slot: input.sourceNestedTarget.slot,
    }).slice(0, 24) : "";
  const mediaOperationId =
    `duplicate-foe-media:${input.backendReceiptId}` +
    (nestedIdentity ? `:${nestedIdentity}` : "");
  const destinationPlan = buildTask07MediaUploadPlan({
    actorUid: input.actorUid,
    ownerUid: input.actorUid,
    entityId: input.destinationFoeId,
    previousAssetId: null,
    ...(input.destinationNestedTarget ? {
      nestedTarget: input.destinationNestedTarget,
    } : {}),
    operationId: mediaOperationId,
    kind: "foe",
    sourceContentType: generated.original.contentType,
    sourceBytes: generated.original.bytes,
  });
  const storagePlan = buildGeneratedMediaStoragePlan({
    kind: destinationPlan.kind,
    audienceScope: destinationPlan.audienceScope,
    ownerKey: destinationPlan.ownerKey,
    assetId: destinationPlan.assetId,
    sourceGeneration: generated.generation,
  });
  const entries: Task07CanonicalCloneEntry[] = [{
    role: "original",
    source: generated.original,
    destinationPath: storagePlan.originalPath,
  }];
  (Object.keys(generated.variants).sort() as MediaVariantName[])
    .forEach((variant) => {
      const source = generated.variants[variant];
      const destinationPath = storagePlan.variants[variant];
      if (!source || !destinationPath) {
        throw new Task07MediaClonePlanError(
          "source-manifest-invalid",
          "Attached foe media family is incomplete."
        );
      }
      entries.push({role: variant, source, destinationPath});
    });
  return {
    schemaVersion: 1,
    sourceAssetId,
    destinationAssetId: destinationPlan.assetId,
    sourceFoeId: input.sourceFoeId,
    destinationFoeId: input.destinationFoeId,
    sourceReferencePath,
    destinationReferencePath: task07MediaReferencePath(destinationPlan),
    sourceManifestFingerprint: sourceManifestFingerprint(manifest, generated),
    sourceGeneration: generated.generation,
    mediaOperationId,
    destinationPlan,
    entries,
  };
};

export const task07FoeMediaClonePlansMatch = (
  first: unknown,
  second: Task07FoeMediaClonePlan | null
): boolean => hashValue(first) === hashValue(second);

export const buildTask07FoeTokenMediaRegenerationPlan = (input: {
  actorUid: string;
  backendReceiptId: string;
  destinationTokenId: string;
  sourceFoeId: string;
  source: Record<string, unknown>;
  sourceManifest: Record<string, unknown> | null;
}): Task07FoeTokenMediaRegenerationPlan | null => {
  // Reuse the exact source descriptor/manifest/attachment validation from
  // canonical foe duplication. The synthetic foe destination is never
  // persisted; only its verified source family is projected below.
  const validatedSource = buildTask07FoeMediaClonePlan({
    actorUid: input.actorUid,
    backendReceiptId: input.backendReceiptId,
    destinationFoeId: input.destinationTokenId,
    sourceFoeId: input.sourceFoeId,
    source: input.source,
    sourceManifest: input.sourceManifest,
  });
  if (!validatedSource) return null;
  const sourceOriginal = validatedSource.entries.find(
    ({role}) => role === "original"
  )?.source;
  if (!sourceOriginal) {
    throw new Task07MediaClonePlanError(
      "source-manifest-invalid",
      "Attached foe canonical original is missing."
    );
  }
  const mediaOperationId =
    `spawn-foe-token-media:${input.backendReceiptId}`;
  const destinationPlan = buildTask07MediaUploadPlan({
    actorUid: input.actorUid,
    ownerUid: input.actorUid,
    entityId: input.destinationTokenId,
    previousAssetId: null,
    operationId: mediaOperationId,
    kind: "token",
    sourceContentType: sourceOriginal.contentType,
    sourceBytes: sourceOriginal.bytes,
  });
  return {
    schemaVersion: 1,
    sourceAssetId: validatedSource.sourceAssetId,
    sourceFoeId: input.sourceFoeId,
    sourceReferencePath: validatedSource.sourceReferencePath,
    sourceManifestFingerprint: validatedSource.sourceManifestFingerprint,
    sourceGeneration: validatedSource.sourceGeneration,
    sourceOriginal,
    destinationTokenId: input.destinationTokenId,
    destinationReferencePath: task07MediaReferencePath(destinationPlan),
    mediaOperationId,
    destinationPlan,
  };
};

export const task07FoeTokenMediaRegenerationPlansMatch = (
  first: unknown,
  second: Task07FoeTokenMediaRegenerationPlan | null
): boolean => hashValue(first) === hashValue(second);
