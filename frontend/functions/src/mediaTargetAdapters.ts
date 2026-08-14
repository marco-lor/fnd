import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {
  asTask07NestedMediaTarget,
  asStoredTask07MediaUploadPlan,
  isTask07PreviousMediaPlanCompatible,
  isTask07MediaRequestAuthorized,
  MediaUploadPlan,
  scanTask07MediaTargetReferences,
  task07MediaReferencePath,
  task07MediaTargetFields,
} from "./mediaAssetLifecycleCore";
import {
  InspectedMediaObject,
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_SCHEMA_VERSION,
  MediaVariantName,
  parseCanonicalMediaPath,
} from "./mediaContracts";
import {
  evaluateDocumentBudget,
  hashValue,
  USER_ITEM_MAX_BYTES,
} from "./userDataV2";
import {isTask07CanonicalStoragePath} from "./task07ServerBoundary";
import {task07MediaWritesV1ForActor} from "./task07MediaControl";

export class Task07TargetAdapterError extends Error {
  readonly code:
    "permission-denied" | "not-found" | "failed-precondition" |
    "already-exists" | "invalid-argument";

  constructor(
    code: Task07TargetAdapterError["code"],
    message: string
  ) {
    super(message);
    this.name = "Task07TargetAdapterError";
    this.code = code;
  }
}

export type StoredTask07MediaObject = InspectedMediaObject & {
  checksum: string;
  role?: "original" | MediaVariantName;
};

export type ReadyTask07GeneratedMedia = {
  generation: string;
  original: StoredTask07MediaObject;
  variants: Partial<Record<MediaVariantName, StoredTask07MediaObject>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const NESTED_ENTRY_ID_FIELD = "task07MediaEntryId";

type NestedTargetResolution = {
  binding?: admin.firestore.DocumentData;
  conflict: boolean;
  entry?: admin.firestore.DocumentData;
  entryIndex?: number;
  entryKey?: string;
};

const resolveNestedTarget = (
  data: admin.firestore.DocumentData | undefined,
  plan: MediaUploadPlan
): NestedTargetResolution => {
  const nested = plan.nestedTarget;
  if (!nested) return {conflict: false, entry: data};
  const root = isRecord(data) ? data : {};
  const registryValue = root.task07EmbeddedMedia;
  const registry = isRecord(registryValue) ? registryValue : {};
  const rawBinding = registry[nested.entryId];
  const binding = isRecord(rawBinding) ? rawBinding : {};
  const bindingKind = binding.targetKind;
  const bindingConflict = (registryValue !== undefined &&
      registryValue !== null && !isRecord(registryValue)) ||
    (rawBinding !== undefined && rawBinding !== null &&
      !isRecord(rawBinding)) ||
    (bindingKind !== undefined && bindingKind !== nested.kind);
  if (nested.kind === "catalog-item-spell") {
    const general = isRecord(root.General) ? root.General : {};
    const spells = isRecord(general.spells) ? general.spells : {};
    const matches = Object.entries(spells).filter(([, value]) =>
      isRecord(value) && value[NESTED_ENTRY_ID_FIELD] === nested.entryId
    );
    if (matches.length > 1) return {conflict: true};
    if (matches.length === 1) {
      return {
        binding,
        conflict: bindingConflict,
        entryKey: matches[0][0],
        entry: matches[0][1] as admin.firestore.DocumentData,
      };
    }
    const entry = spells[nested.entryKey || ""];
    if (!isRecord(entry)) return {binding, conflict: bindingConflict};
    const storedEntryId = entry[NESTED_ENTRY_ID_FIELD];
    if (storedEntryId !== undefined && storedEntryId !== nested.entryId) {
      return {conflict: true};
    }
    return {
      binding,
      conflict: bindingConflict || (storedEntryId !== undefined &&
        typeof storedEntryId !== "string"),
      entryKey: nested.entryKey || undefined,
      entry: entry as admin.firestore.DocumentData,
    };
  }

  const collectionField = nested.kind === "foe-technique" ?
    "tecniche" : "spells";
  const entries = Array.isArray(root[collectionField]) ?
    root[collectionField] as unknown[] : [];
  const matches = entries
    .map((entry, index) => ({entry, index}))
    .filter(({entry}) => isRecord(entry) &&
      entry[NESTED_ENTRY_ID_FIELD] === nested.entryId);
  if (matches.length > 1) return {conflict: true};
  if (matches.length === 1) {
    return {
      binding,
      conflict: bindingConflict,
      entryIndex: matches[0].index,
      entry: matches[0].entry as admin.firestore.DocumentData,
    };
  }
  const entry = nested.entryIndex === null ? undefined :
    entries[nested.entryIndex];
  if (!isRecord(entry)) return {binding, conflict: bindingConflict};
  const storedEntryId = entry[NESTED_ENTRY_ID_FIELD];
  if (storedEntryId !== undefined && storedEntryId !== nested.entryId) {
    return {conflict: true};
  }
  return {
    binding,
    conflict: bindingConflict || (storedEntryId !== undefined &&
      typeof storedEntryId !== "string"),
    entryIndex: nested.entryIndex ?? undefined,
    entry: entry as admin.firestore.DocumentData,
  };
};

const legacyImageReferenceFrom = (
  value: unknown
): {imagePath: string; imageUrl: string} | null => {
  const container = isRecord(value) ? value : {};
  const imagePath = typeof container.imagePath === "string" ?
    container.imagePath.trim() :
    "";
  const imageUrl = typeof container.imageUrl === "string" ?
    container.imageUrl.trim() :
    "";
  const legacyImagePath = imagePath &&
    !isTask07CanonicalStoragePath(imagePath) ? imagePath : "";
  const legacyImageUrl = imageUrl &&
    !isTask07CanonicalStoragePath(imageUrl) ? imageUrl : "";
  return legacyImagePath || legacyImageUrl ? {
    imagePath: legacyImagePath,
    imageUrl: legacyImageUrl,
  } : null;
};

const asGeneratedObject = (
  value: unknown,
  plan: MediaUploadPlan,
  generation: string,
  expectedVariant: MediaVariantName | null
): StoredTask07MediaObject | null => {
  if (!isRecord(value)) return null;
  const parsed = parseCanonicalMediaPath(value.path);
  const checksum = typeof value.checksum === "string" ? value.checksum : "";
  if (!parsed ||
    parsed.assetId !== plan.assetId ||
    parsed.ownerKey !== plan.ownerKey ||
    parsed.audienceScope !== plan.audienceScope ||
    parsed.sourceGeneration !== generation ||
    parsed.variant !== expectedVariant ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    typeof value.contentType !== "string" ||
    !Number.isSafeInteger(value.bytes) ||
    Number(value.bytes) <= 0 ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    !/^[1-9][0-9]*$/.test(String(value.generation)) ||
    typeof value.cacheControl !== "string") {
    return null;
  }
  return value as unknown as StoredTask07MediaObject;
};

export const task07ReadyGeneratedMediaFromManifest = (
  data: admin.firestore.DocumentData,
  plan: MediaUploadPlan
): ReadyTask07GeneratedMedia => {
  const generated = isRecord(data.generated) ? data.generated : {};
  const sourceGeneration = typeof generated.generation === "string" ?
    generated.generation :
    "";
  if (!/^[1-9][0-9]*$/.test(sourceGeneration)) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media generation is invalid."
    );
  }
  const original = asGeneratedObject(
    generated.original,
    plan,
    sourceGeneration,
    null
  );
  if (!original) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media original is invalid."
    );
  }
  const storedVariants = isRecord(generated.variants) ?
    generated.variants :
    {};
  const expectedVariants = Object.keys(
    MEDIA_CONTRACTS[plan.kind].variants
  ).sort() as MediaVariantName[];
  if (Object.keys(storedVariants).sort().join(",") !==
    expectedVariants.join(",")) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media variant set is incomplete."
    );
  }
  const variants: Partial<
    Record<MediaVariantName, StoredTask07MediaObject>
  > = {};
  expectedVariants.forEach((variant) => {
    const object = asGeneratedObject(
      storedVariants[variant],
      plan,
      sourceGeneration,
      variant
    );
    if (!object) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Media derivative is invalid."
      );
    }
    variants[variant] = object;
  });
  return {generation: sourceGeneration, original, variants};
};

export const task07MediaTargetDataForPlan = (
  data: admin.firestore.DocumentData | undefined,
  plan: MediaUploadPlan
): admin.firestore.DocumentData | undefined => {
  if (plan.nestedTarget) {
    const resolution = resolveNestedTarget(data, plan);
    return resolution.binding || {};
  }
  if (plan.targetKind !== "common-technique") return data;
  const root = isRecord(data) ? data : {};
  return isRecord(root[plan.entityId]) ?
    root[plan.entityId] as admin.firestore.DocumentData :
    undefined;
};

export const task07NestedMediaTargetEntryExists = (
  data: admin.firestore.DocumentData | undefined,
  plan: MediaUploadPlan
): boolean => {
  if (!plan.nestedTarget) return true;
  const resolution = resolveNestedTarget(data, plan);
  return !resolution.conflict && Boolean(resolution.entry);
};

const rootTargetRevision = (
  data: admin.firestore.DocumentData | undefined,
  plan: MediaUploadPlan
): number => {
  const target = task07MediaTargetDataForPlan(data, plan);
  const value = target?.[task07MediaTargetFields(plan).revisionField];
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
};

export type Task07FoeCanonicalMediaState = {
  assetId: string | null;
  revision: number;
  conflict: boolean;
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export const task07FoeCanonicalMediaStateFromTarget = (
  data: admin.firestore.DocumentData | undefined
): Task07FoeCanonicalMediaState => {
  const root = isRecord(data) ? data : {};
  const general = isRecord(root.General) ? root.General : null;
  const rootMediaValue = root.media;
  const generalMediaValue = general?.media;
  const rootHasMedia = rootMediaValue !== undefined && rootMediaValue !== null;
  const generalHasMedia = generalMediaValue !== undefined &&
    generalMediaValue !== null;
  const rootRevisionIsExplicit = hasOwn(root, "task07MediaRevision");
  const generalRevisionIsExplicit = Boolean(
    general && hasOwn(general, "task07MediaRevision")
  );
  const rootRevisionValue = root.task07MediaRevision;
  const generalRevisionValue = general?.task07MediaRevision;
  const scan = scanTask07MediaTargetReferences(root).media;
  let conflict = scan.malformed || scan.assetIds.length > 1;

  if (rootRevisionIsExplicit && !isRevision(rootRevisionValue)) {
    conflict = true;
  }
  if (rootHasMedia && generalHasMedia) {
    if (!isRecord(rootMediaValue) || !isRecord(generalMediaValue) ||
      hashValue(rootMediaValue) !== hashValue(generalMediaValue)) {
      conflict = true;
    }
    if (generalRevisionIsExplicit && !isRevision(generalRevisionValue)) {
      conflict = true;
    }
    if (rootRevisionIsExplicit && generalRevisionIsExplicit &&
      isRevision(rootRevisionValue) && isRevision(generalRevisionValue) &&
      rootRevisionValue !== generalRevisionValue) {
      conflict = true;
    }
  }

  return {
    assetId: !conflict && scan.assetIds.length === 1 ? scan.assetIds[0] : null,
    revision: isRevision(rootRevisionValue) ? rootRevisionValue : 0,
    conflict,
  };
};

export const task07MediaTargetState = (
  data: admin.firestore.DocumentData | undefined,
  plan: MediaUploadPlan
): Task07FoeCanonicalMediaState => {
  if (plan.nestedTarget) {
    const resolution = resolveNestedTarget(data, plan);
    if (resolution.conflict) {
      return {assetId: null, revision: 0, conflict: true};
    }
    if (!resolution.entry &&
      (!resolution.binding || Object.keys(resolution.binding).length === 0)) {
      return {assetId: null, revision: 0, conflict: false};
    }
  }
  if (plan.targetKind === "foe" &&
    task07MediaTargetFields(plan).slot === "media") {
    return task07FoeCanonicalMediaStateFromTarget(data);
  }
  const fields = task07MediaTargetFields(plan);
  const target = task07MediaTargetDataForPlan(data, plan);
  const scan = scanTask07MediaTargetReferences(target)[fields.slot];
  return {
    assetId: !scan.malformed && scan.assetIds.length === 1 ?
      scan.assetIds[0] : null,
    revision: rootTargetRevision(data, plan),
    conflict: scan.malformed || scan.assetIds.length > 1,
  };
};

const attachmentMatchesTargetSlot = (input: {
  asset: admin.firestore.DocumentSnapshot;
  referencePath: string;
  plan: MediaUploadPlan;
}): boolean => {
  if (input.asset.get("attachment.referencePath") !== input.referencePath) {
    return false;
  }
  const expectedSlot = task07MediaTargetFields(input.plan).slot;
  const storedSlot = input.asset.get("attachment.targetSlot");
  const storedNestedTarget = input.asset.get("attachment.nestedTarget");
  if (input.plan.nestedTarget) {
    const nested = asTask07NestedMediaTarget(storedNestedTarget);
    if (!nested ||
      nested.kind !== input.plan.nestedTarget.kind ||
      nested.entryId !== input.plan.nestedTarget.entryId ||
      nested.slot !== input.plan.nestedTarget.slot) return false;
  } else if (storedNestedTarget !== undefined && storedNestedTarget !== null) {
    return false;
  }
  // Version-one primary attachments created before personal video slots were
  // introduced have no targetSlot. Keep only that exact compatibility case.
  return storedSlot === expectedSlot ||
    (storedSlot === undefined && expectedSlot === "media");
};

export const validateTask07MediaTarget = (input: {
  plan: MediaUploadPlan;
  target: admin.firestore.DocumentSnapshot;
}): void => {
  if (!input.target.exists) {
    throw new Task07TargetAdapterError("not-found", "Media target not found.");
  }
  const data = input.target.data() || {};
  const targetData = task07MediaTargetDataForPlan(data, input.plan);
  const referencePath = task07MediaReferencePath(input.plan);
  if (input.target.ref.path !== referencePath ||
    (!["profile", "common-technique"].includes(input.plan.targetKind) &&
      input.target.id !== input.plan.entityId)) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media target identity is invalid."
    );
  }
  if (!targetData) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media target entry is missing."
    );
  }
  if (input.plan.nestedTarget &&
    !task07NestedMediaTargetEntryExists(data, input.plan)) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media target entry is missing."
    );
  }
  if (data.deletionState === "pending" ||
    data.pendingDeletion === true ||
    data.deleted === true ||
    targetData.deletionState === "pending" ||
    targetData.pendingDeletion === true ||
    targetData.deleted === true) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media target is pending deletion."
    );
  }
  if (input.plan.targetKind === "common-technique" &&
    (input.target.id !== "tecniche_common" ||
      input.target.ref.parent.id !== "utils")) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Common technique media target identity is invalid."
    );
  }
  if (input.plan.targetKind === "profile" &&
    input.target.id !== input.plan.ownerUid) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Profile target identity is invalid."
    );
  }
  if ([
    "user-inventory", "user-technique", "user-spell",
  ].includes(input.plan.targetKind) &&
    input.target.ref.parent.parent?.id !== input.plan.ownerUid) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "User-owned media target ownership is invalid."
    );
  }
  const expectedPersonalCollection = input.plan.targetKind === "user-technique" ?
    "tecniche" :
    input.plan.targetKind === "user-spell" ? "spells" : null;
  if (expectedPersonalCollection &&
    input.target.ref.parent.id !== expectedPersonalCollection) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Personal media target collection is invalid."
    );
  }
  if (input.plan.targetKind === "grigliata-token" &&
    data.ownerUid !== input.plan.ownerUid) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Token target ownership is invalid."
    );
  }
  if (input.plan.targetKind === "grigliata-background") {
    const expectedAssetType = input.plan.kind === "map-video" ?
      "video" : "image";
    const declaredAssetType = typeof data.assetType === "string" ?
      data.assetType.trim().toLowerCase() : "";
    if (declaredAssetType && declaredAssetType !== expectedAssetType) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Background media purpose is invalid."
      );
    }
  }
  if (input.plan.targetKind === "grigliata-music-track") {
    const contentType = typeof data.contentType === "string" ?
      data.contentType.trim().toLowerCase() : "";
    if (!contentType.startsWith("audio/") ||
      contentType !== input.plan.sourceContentType) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Music track media purpose is invalid."
      );
    }
  }
};

export const task07MediaValueFromReadyManifest = (
  data: admin.firestore.DocumentData,
  plan: MediaUploadPlan
): Record<string, unknown> => {
  const generated = task07ReadyGeneratedMediaFromManifest(data, plan);
  return {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    contractVersion: MEDIA_CONTRACT_VERSION,
    assetId: plan.assetId,
    kind: plan.kind,
    state: "ready",
    generation: generated.generation,
    audience: plan.audienceScope,
    ownerUid: plan.ownerUid,
    original: generated.original,
    variants: generated.variants,
    processing: {
      authoritative: true,
      fallbackCode: null,
    },
  };
};

export const task07TargetAttachmentPatch = (input: {
  current?: admin.firestore.DocumentData;
  media: Record<string, unknown>;
  normalizeCanonicalRoot?: boolean;
  plan: MediaUploadPlan;
  revision: number;
  timestamp: Timestamp;
}): admin.firestore.UpdateData<admin.firestore.DocumentData> => {
  const original = input.media.original as StoredTask07MediaObject;
  const fields = task07MediaTargetFields(input.plan);
  const current = input.current || {};
  if (input.plan.nestedTarget) {
    const resolution = resolveNestedTarget(current, input.plan);
    if (resolution.conflict || !resolution.entry) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Nested media target is missing or has conflicting identity."
      );
    }
    const nextEntry = {
      ...resolution.entry,
      [NESTED_ENTRY_ID_FIELD]: input.plan.nestedTarget.entryId,
    };
    const nextBinding = {
      ...(resolution.binding || {}),
      targetKind: input.plan.nestedTarget.kind,
      [fields.mediaField]: input.media,
      [fields.revisionField]: input.revision,
      [fields.updatedAtField]: input.timestamp,
    };
    const registry = isRecord(current.task07EmbeddedMedia) ?
      current.task07EmbeddedMedia : {};
    if (input.plan.nestedTarget.kind === "catalog-item-spell") {
      const general = isRecord(current.General) ? current.General : {};
      const spells = isRecord(general.spells) ? general.spells : {};
      return {
        General: {
          ...general,
          spells: {...spells, [resolution.entryKey || ""]: nextEntry},
        },
        task07EmbeddedMedia: {
          ...registry,
          [input.plan.nestedTarget.entryId]: nextBinding,
        },
      };
    }
    const collectionField = input.plan.nestedTarget.kind === "foe-technique" ?
      "tecniche" : "spells";
    const entries = Array.isArray(current[collectionField]) ?
      [...current[collectionField]] : [];
    if (resolution.entryIndex === undefined) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Nested media target index is missing."
      );
    }
    entries[resolution.entryIndex] = nextEntry;
    return {
      [collectionField]: entries,
      task07EmbeddedMedia: {
        ...registry,
        [input.plan.nestedTarget.entryId]: nextBinding,
      },
    };
  }
  if (input.plan.targetKind === "common-technique") {
    const currentEntry = task07MediaTargetDataForPlan(current, input.plan);
    if (!currentEntry) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Common technique media target is missing."
      );
    }
    const nextEntry = {...currentEntry};
    if (isRecord(currentEntry.General)) {
      const nextGeneral = {...currentEntry.General};
      nextGeneral[fields.mediaField] = FieldValue.delete();
      nextGeneral[fields.revisionField] = FieldValue.delete();
      nextGeneral[fields.updatedAtField] = FieldValue.delete();
      nextEntry.General = nextGeneral;
    }
    nextEntry[fields.mediaField] = input.media;
    nextEntry[fields.revisionField] = input.revision;
    nextEntry[fields.updatedAtField] = input.timestamp;
    return {[input.plan.entityId]: nextEntry};
  }
  const normalizesCanonicalRoot = input.normalizeCanonicalRoot === true;
  const normalizesFoeCanonicalRoot = Boolean(
    normalizesCanonicalRoot &&
    input.plan.targetKind === "foe" && fields.slot === "media"
  );
  const currentGeneral = normalizesFoeCanonicalRoot &&
    isRecord(current.General) ? current.General : {};
  const rootLegacyImageReference = legacyImageReferenceFrom(current);
  const generalLegacyImageReference = normalizesFoeCanonicalRoot ?
    legacyImageReferenceFrom(currentGeneral) :
    null;
  const preservedLegacyImageReference =
    rootLegacyImageReference || generalLegacyImageReference;
  const preservesLegacyImageReference = Boolean(preservedLegacyImageReference);
  const patch: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
    [fields.mediaField]: input.media,
    [fields.revisionField]: input.revision,
    [fields.updatedAtField]: input.timestamp,
  };
  const canonicalGeneral = isRecord(current.General) ? current.General : null;
  if (normalizesCanonicalRoot && canonicalGeneral && [
    fields.mediaField,
    fields.revisionField,
    fields.updatedAtField,
  ].some((field) => hasOwn(canonicalGeneral, field))) {
    patch[`General.${fields.mediaField}`] = FieldValue.delete();
    patch[`General.${fields.revisionField}`] = FieldValue.delete();
    patch[`General.${fields.updatedAtField}`] = FieldValue.delete();
  }
  if (normalizesFoeCanonicalRoot) {
    patch.imagePath = preservedLegacyImageReference?.imagePath || original.path;
    patch.imageUrl = preservedLegacyImageReference?.imageUrl || "";
  } else if ([
    "profile", "npc", "foe", "grigliata-token", "grigliata-background",
  ].includes(input.plan.targetKind) && !preservesLegacyImageReference) {
    patch.imagePath = original.path;
    patch.imageUrl = "";
  }
  if (input.plan.targetKind === "grigliata-background" &&
    !preservesLegacyImageReference) {
    patch.imageWidth = original.width;
    patch.imageHeight = original.height;
    patch.contentType = original.contentType;
    patch.sizeBytes = original.bytes;
    patch.assetType = input.plan.kind === "map-video" ? "video" : "image";
    if (input.plan.kind === "map-video") {
      patch.durationMs = original.durationMs || 0;
    }
  }
  if (input.plan.targetKind === "grigliata-music-track") {
    const durationMs = typeof original.durationMs === "number" &&
      Number.isSafeInteger(original.durationMs) && original.durationMs > 0 ?
      original.durationMs : current.durationMs;
    patch.contentType = original.contentType;
    patch.sizeBytes = original.bytes;
    if (Number.isSafeInteger(durationMs) && Number(durationMs) > 0) {
      patch.durationMs = durationMs;
    }
  }
  if (normalizesFoeCanonicalRoot) {
    patch.image_url = FieldValue.delete();
    patch.url = FieldValue.delete();
    patch.downloadUrl = FieldValue.delete();
    patch["General.media"] = FieldValue.delete();
    patch["General.mediaUpdatedAt"] = FieldValue.delete();
    patch["General.task07MediaRevision"] = FieldValue.delete();
    patch["General.imagePath"] = FieldValue.delete();
    patch["General.imageUrl"] = FieldValue.delete();
    patch["General.image_url"] = FieldValue.delete();
    patch["General.url"] = FieldValue.delete();
    patch["General.downloadUrl"] = FieldValue.delete();
  }
  return patch;
};

export const task07CanonicalRootRetirementPatch = (input: {
  current: admin.firestore.DocumentData;
  plan: MediaUploadPlan;
  revision: number;
  timestamp: Timestamp;
}): admin.firestore.UpdateData<admin.firestore.DocumentData> => {
  if (input.plan.nestedTarget ||
    input.plan.targetKind === "common-technique") {
    throw new Task07TargetAdapterError(
      "invalid-argument",
      "Canonical root retirement plan is invalid."
    );
  }
  const fields = task07MediaTargetFields(input.plan);
  const patch: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
    [fields.mediaField]: FieldValue.delete(),
    [fields.revisionField]: input.revision + 1,
    [fields.updatedAtField]: input.timestamp,
  };
  const canonicalGeneral = isRecord(input.current.General) ?
    input.current.General : null;
  if (canonicalGeneral && [
    fields.mediaField,
    fields.revisionField,
    fields.updatedAtField,
  ].some((field) => hasOwn(canonicalGeneral, field))) {
    patch[`General.${fields.mediaField}`] = FieldValue.delete();
    patch[`General.${fields.revisionField}`] = FieldValue.delete();
    patch[`General.${fields.updatedAtField}`] = FieldValue.delete();
  }
  return patch;
};

export const task07FoeCanonicalRetirementPatch = (input: {
  revision: number;
  timestamp: Timestamp;
}): admin.firestore.UpdateData<admin.firestore.DocumentData> => ({
  media: FieldValue.delete(),
  task07MediaRevision: input.revision + 1,
  mediaUpdatedAt: input.timestamp,
  imagePath: FieldValue.delete(),
  imageUrl: FieldValue.delete(),
  image_url: FieldValue.delete(),
  url: FieldValue.delete(),
  downloadUrl: FieldValue.delete(),
  "General.media": FieldValue.delete(),
  "General.mediaUpdatedAt": FieldValue.delete(),
  "General.task07MediaRevision": FieldValue.delete(),
  "General.imagePath": FieldValue.delete(),
  "General.imageUrl": FieldValue.delete(),
  "General.image_url": FieldValue.delete(),
  "General.url": FieldValue.delete(),
  "General.downloadUrl": FieldValue.delete(),
});

export const task07CommonTechniqueRetirementPatch = (input: {
  current: admin.firestore.DocumentData;
  plan: MediaUploadPlan;
  revision: number;
  timestamp: Timestamp;
}): admin.firestore.UpdateData<admin.firestore.DocumentData> => {
  if (input.plan.targetKind !== "common-technique") {
    throw new Task07TargetAdapterError(
      "invalid-argument",
      "Common technique retirement plan is invalid."
    );
  }
  const currentEntry = task07MediaTargetDataForPlan(
    input.current,
    input.plan
  );
  if (!currentEntry) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Common technique media target is missing."
    );
  }
  const fields = task07MediaTargetFields(input.plan);
  const nextEntry = {...currentEntry};
  nextEntry[fields.mediaField] = FieldValue.delete();
  if (isRecord(currentEntry.General)) {
    const nextGeneral = {...currentEntry.General};
    nextGeneral[fields.mediaField] = FieldValue.delete();
    nextGeneral[fields.revisionField] = FieldValue.delete();
    nextGeneral[fields.updatedAtField] = FieldValue.delete();
    nextEntry.General = nextGeneral;
  }
  nextEntry[fields.revisionField] = input.revision + 1;
  nextEntry[fields.updatedAtField] = input.timestamp;
  return {[input.plan.entityId]: nextEntry};
};

export const task07NestedMediaRetirementPatch = (input: {
  current: admin.firestore.DocumentData;
  plan: MediaUploadPlan;
  revision: number;
  timestamp: Timestamp;
}): admin.firestore.UpdateData<admin.firestore.DocumentData> => {
  if (!input.plan.nestedTarget) {
    throw new Task07TargetAdapterError(
      "invalid-argument",
      "Nested media retirement plan is invalid."
    );
  }
  const resolution = resolveNestedTarget(input.current, input.plan);
  if (resolution.conflict || !resolution.binding) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Nested media binding is missing or has conflicting identity."
    );
  }
  const fields = task07MediaTargetFields(input.plan);
  const nextBinding = {...(resolution.binding || {})};
  delete nextBinding[fields.mediaField];
  nextBinding.targetKind = input.plan.nestedTarget.kind;
  nextBinding[fields.revisionField] = input.revision + 1;
  nextBinding[fields.updatedAtField] = input.timestamp;
  const registry = isRecord(input.current.task07EmbeddedMedia) ?
    input.current.task07EmbeddedMedia : {};
  if (input.plan.nestedTarget.kind === "catalog-item-spell") {
    const general = isRecord(input.current.General) ? input.current.General : {};
    const spells = isRecord(general.spells) ? general.spells : {};
    return {
      ...(resolution.entry ? {
        General: {
          ...general,
          spells: {
            ...spells,
            [resolution.entryKey || ""]: {
              ...resolution.entry,
              [NESTED_ENTRY_ID_FIELD]: input.plan.nestedTarget.entryId,
            },
          },
        },
      } : {}),
      task07EmbeddedMedia: {
        ...registry,
        [input.plan.nestedTarget.entryId]: nextBinding,
      },
    };
  }
  const collectionField = input.plan.nestedTarget.kind === "foe-technique" ?
    "tecniche" : "spells";
  const entries = Array.isArray(input.current[collectionField]) ?
    [...input.current[collectionField]] : [];
  if (resolution.entry && resolution.entryIndex !== undefined) {
    entries[resolution.entryIndex] = {
      ...resolution.entry,
      [NESTED_ENTRY_ID_FIELD]: input.plan.nestedTarget.entryId,
    };
  }
  return {
    ...(resolution.entry ? {[collectionField]: entries} : {}),
    task07EmbeddedMedia: {
      ...registry,
      [input.plan.nestedTarget.entryId]: nextBinding,
    },
  };
};

export const assertTask07TargetDocumentBudget = (input: {
  current: admin.firestore.DocumentData;
  patch: admin.firestore.UpdateData<admin.firestore.DocumentData>;
  plan: MediaUploadPlan;
}): void => {
  if (![
    "user-inventory", "user-technique", "common-technique", "user-spell",
    "catalog-item-spell", "foe-technique", "foe-spell",
  ].includes(input.plan.targetKind)) return;
  const budget = evaluateDocumentBudget(
    {...input.current, ...input.patch},
    USER_ITEM_MAX_BYTES
  );
  if (budget.warning) {
    console.warn("Task07 target document budget warning", {
      targetKind: input.plan.targetKind,
      bytes: budget.bytes,
      limit: budget.limit,
    });
  }
  if (!budget.accepted) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "Media target exceeds its document-size budget."
    );
  }
};

export const buildTask07NewTargetAttachment = (input: {
  assetData: admin.firestore.DocumentData;
  plan: MediaUploadPlan;
  targetData: admin.firestore.DocumentData;
  timestamp: Timestamp;
}): {
  targetData: admin.firestore.DocumentData;
  referencePath: string;
  targetSlot: "media" | "videoMedia";
  revision: 1;
} => {
  if (input.assetData.state !== "ready" ||
    input.plan.previousAssetId !== null) {
    throw new Task07TargetAdapterError(
      "failed-precondition",
      "New-target media must be ready and have no previous attachment."
    );
  }
  const referencePath = task07MediaReferencePath(input.plan);
  const targetSlot = task07MediaTargetFields(input.plan).slot;
  const media = task07MediaValueFromReadyManifest(
    input.assetData,
    input.plan
  );
  const patch = task07TargetAttachmentPatch({
    current: input.targetData,
    media,
    plan: input.plan,
    revision: 1,
    timestamp: input.timestamp,
  });
  assertTask07TargetDocumentBudget({
    current: input.targetData,
    patch,
    plan: input.plan,
  });
  return {
    targetData: {...input.targetData, ...patch},
    referencePath,
    targetSlot,
    revision: 1,
  };
};

export const attachTask07ReadyAssetTransaction = async (input: {
  db: admin.firestore.Firestore;
  actorUid: string;
  actorRole: string;
  assetId: string;
  expectedRevision?: number | null;
  nowMs?: number;
}): Promise<{
  attached: boolean;
  assetId: string;
  previousAssetId: string | null;
  referencePath: string;
  targetSlot: "media" | "videoMedia";
  revision: number;
}> => {
  if (!/^m_[a-f0-9]{40}$/.test(input.assetId) ||
    (input.expectedRevision !== undefined &&
      input.expectedRevision !== null &&
      (!Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0))) {
    throw new Task07TargetAdapterError(
      "invalid-argument",
      "Media attachment identity is invalid."
    );
  }
  const assetRef = input.db.doc(`media_assets/${input.assetId}`);
  const controlRef = input.db.doc("utils/task07_media");
  const actorRef = input.db.doc(`users/${input.actorUid}`);
  const nowMs = input.nowMs ?? Date.now();
  return input.db.runTransaction(async (transaction) => {
    const [asset, control, actor] = await transaction.getAll(
      assetRef,
      controlRef,
      actorRef
    );
    const plan = asStoredTask07MediaUploadPlan(asset.get("plan"));
    if (!asset.exists || !plan || plan.assetId !== input.assetId) {
      throw new Task07TargetAdapterError(
        "not-found",
        "Media asset not found."
      );
    }
    const actorRole = typeof actor.get("role") === "string" ?
      actor.get("role").trim().toLowerCase() : "";
    if (!actor.exists || actor.get("deletionState") === "pending" ||
      actorRole !== input.actorRole.trim().toLowerCase() ||
      plan.actorUid !== input.actorUid ||
      !isTask07MediaRequestAuthorized({
        kind: plan.kind,
        actorUid: input.actorUid,
        ownerUid: plan.ownerUid,
        referenceScope: plan.referenceScope,
        actorRole,
        targetKind: plan.targetKind,
      })) {
      throw new Task07TargetAdapterError(
        "permission-denied",
        "Media attachment is not authorized."
      );
    }
    if (!task07MediaWritesV1ForActor({
      control: control.data(),
      purpose: plan.kind,
      role: actorRole,
      uid: input.actorUid,
    })) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Task 07 media writes are not enabled."
      );
    }
    const referencePath = task07MediaReferencePath(plan);
    const targetSlot = task07MediaTargetFields(plan).slot;
    if (asset.get("state") === "attached" &&
      attachmentMatchesTargetSlot({asset, referencePath, plan})) {
      const target = await transaction.get(input.db.doc(referencePath));
      const targetState = task07MediaTargetState(target.data(), plan);
      const stillReferencesAsset = !targetState.conflict &&
        targetState.assetId === input.assetId;
      if (!stillReferencesAsset) {
        throw new Task07TargetAdapterError(
          "failed-precondition",
          "Attached media target no longer references this asset."
        );
      }
      return {
        attached: false,
        assetId: input.assetId,
        previousAssetId: plan.previousAssetId,
        referencePath,
        targetSlot,
        revision: targetState.revision,
      };
    }
    if (asset.get("state") !== "ready") {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Media asset is not ready."
      );
    }
    const media = task07MediaValueFromReadyManifest(asset.data() || {}, plan);
    const referenceRef = input.db.doc(referencePath);
    const target = await transaction.get(referenceRef);
    validateTask07MediaTarget({plan, target});
    const currentState = task07MediaTargetState(target.data(), plan);
    if (currentState.conflict) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Media target bindings conflict."
      );
    }
    const revision = currentState.revision;
    if (input.expectedRevision !== undefined &&
      input.expectedRevision !== null &&
      input.expectedRevision !== revision) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Media target revision changed."
      );
    }
    if (currentState.assetId !== plan.previousAssetId) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Previous media does not match the target."
      );
    }
    const previousRef = plan.previousAssetId ?
      input.db.doc(`media_assets/${plan.previousAssetId}`) :
      null;
    const previous = previousRef ?
      await transaction.get(previousRef) :
      null;
    const previousPlan = previous ?
      asStoredTask07MediaUploadPlan(previous.get("plan")) : null;
    if (previousRef && (
      !previous ||
      !previous.exists ||
      previous.get("state") !== "attached" ||
      !isTask07PreviousMediaPlanCompatible(plan, previousPlan) ||
      !attachmentMatchesTargetSlot({
        asset: previous,
        referencePath,
        plan,
      })
    )) {
      throw new Task07TargetAdapterError(
        "failed-precondition",
        "Previous media manifest is not attached to this target."
      );
    }
    const timestamp = Timestamp.fromMillis(nowMs);
    const targetPatch = task07TargetAttachmentPatch({
      current: target.data() || {},
      media,
      normalizeCanonicalRoot: true,
      plan,
      revision: revision + 1,
      timestamp,
    });
    assertTask07TargetDocumentBudget({
      current: target.data() || {},
      patch: targetPatch,
      plan,
    });
    if (plan.targetKind === "common-technique") {
      transaction.set(referenceRef, targetPatch, {merge: true});
    } else {
      transaction.update(referenceRef, targetPatch);
    }
    transaction.update(assetRef, {
      state: "attached",
      attachment: {
        referencePath,
        targetSlot,
        ...(plan.nestedTarget ? {nestedTarget: plan.nestedTarget} : {}),
        revision: revision + 1,
        attachedAt: timestamp,
      },
      "retention.cleanupAfter": FieldValue.delete(),
      updatedAt: timestamp,
    });
    if (previousRef && previous) {
      const cleanupAfter = Timestamp.fromMillis(
        nowMs +
        MEDIA_CONTRACTS[plan.kind].retention.supersededGraceHours *
        60 * 60 * 1000
      );
      transaction.update(previousRef, {
        state: "superseded",
        supersededByAssetId: plan.assetId,
        retention: {
          supersededAt: timestamp,
          cleanupAfter,
        },
        updatedAt: timestamp,
      });
      transaction.set(
        input.db.doc(`media_asset_cleanup/${plan.previousAssetId}`),
        {
          schemaVersion: MEDIA_SCHEMA_VERSION,
          assetId: plan.previousAssetId,
          state: "pending",
          reason: "superseded",
          attempts: 0,
          cleanupAfter,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {merge: false}
      );
    }
    return {
      attached: true,
      assetId: input.assetId,
      previousAssetId: plan.previousAssetId,
      referencePath,
      targetSlot,
      revision: revision + 1,
    };
  });
};
