import {
  asStoredTask07MediaUploadPlan,
  buildTask07MediaUploadPlan,
  MediaUploadPlan,
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
  if (scan.media.malformed || scan.media.assetIds.length > 1) {
    throw new Task07MediaClonePlanError(
      "canonical-reference-invalid",
      "Foe canonical media reference is malformed or conflicting."
    );
  }
  const descriptorAssetId = scan.media.assetIds[0] || null;
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

export const buildTask07FoeMediaClonePlan = (input: {
  actorUid: string;
  backendReceiptId: string;
  destinationFoeId: string;
  sourceFoeId: string;
  source: Record<string, unknown>;
  sourceManifest: Record<string, unknown> | null;
}): Task07FoeMediaClonePlan | null => {
  const sourceAssetId = task07CanonicalFoeMediaAssetId(input.source);
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
    sourcePlan.targetKind !== "foe" ||
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
    targetSlot !== "media") {
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
  assertSourceDescriptors(input.source, expectedMedia);

  const mediaOperationId =
    `duplicate-foe-media:${input.backendReceiptId}`;
  const destinationPlan = buildTask07MediaUploadPlan({
    actorUid: input.actorUid,
    ownerUid: input.actorUid,
    entityId: input.destinationFoeId,
    previousAssetId: null,
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
