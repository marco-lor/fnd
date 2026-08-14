import {createHash} from "crypto";

type UnknownRecord = Record<string, unknown>;

type StripTask07MediaOptions = {
  canonicalClone?: boolean;
};

const TASK07_MEDIA_CONTROL_FIELDS = [
  "media",
  "mediaUpdatedAt",
  "task07MediaRevision",
  "videoMedia",
  "videoMediaUpdatedAt",
  "task07VideoMediaRevision",
] as const;

const TASK07_IMAGE_ALIAS_FIELDS = [
  "imagePath",
  "imageUrl",
  "image_url",
  "url",
  "downloadUrl",
  "videoPath",
  "videoUrl",
  "video_url",
] as const;

export const canonicalFoeClonePlanBudgetIssue = (
  clones: Array<{entries?: unknown[]}>,
  {
    maxFamilies = 20,
    maxObjects = 100,
    maxBytes = 256 * 1024,
  } = {}
): "too-many-families" | "too-many-objects" | "plan-too-large" | null => {
  if (clones.length > maxFamilies) return "too-many-families";
  const objectCount = clones.reduce(
    (total, clone) => total + (Array.isArray(clone.entries) ?
      clone.entries.length : 0),
    0
  );
  if (objectCount > maxObjects) return "too-many-objects";
  if (Buffer.byteLength(JSON.stringify(clones), "utf8") > maxBytes) {
    return "plan-too-large";
  }
  return null;
};

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (!value ||
    typeof value !== "object" ||
    Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasOwn = (value: UnknownRecord, field: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, field);

const containerHasPersistedMedia = (value: unknown): boolean => {
  if (!isPlainRecord(value)) return false;
  if (["media", "videoMedia"].some((field) => (
    hasOwn(value, field) && value[field] !== null && value[field] !== undefined
  ))) return true;
  return TASK07_IMAGE_ALIAS_FIELDS.some((field) => {
    const candidate = value[field];
    if (typeof candidate === "string") return Boolean(candidate.trim());
    return candidate !== null && candidate !== undefined;
  });
};

const nestedFoeMediaContainers = (source: UnknownRecord): unknown[] => [
  ...(Array.isArray(source.tecniche) ? source.tecniche : []),
  ...(Array.isArray(source.spells) ? source.spells : []),
].flatMap((entry) => isPlainRecord(entry) ? [entry, entry.General] : [entry]);

const embeddedRegistryHasMedia = (source: UnknownRecord): boolean => {
  const registry = source.task07EmbeddedMedia;
  if (!isPlainRecord(registry)) return registry !== undefined && registry !== null;
  return Object.values(registry).some((binding) => (
    isPlainRecord(binding) && containerHasPersistedMedia(binding)
  ));
};

export const foeHasNestedPersistedMedia = (
  source: UnknownRecord
): boolean => nestedFoeMediaContainers(source).some(containerHasPersistedMedia) ||
  embeddedRegistryHasMedia(source);

export type FoeNestedEntryIdentity = {
  kind: "foe-technique" | "foe-spell";
  entryIndex: number;
  sourceEntryId: string;
  sourceAssetId: string | null;
};

export type FoeNestedEntryIdentityPlan = {
  entries: FoeNestedEntryIdentity[];
  issue: "canonical-reference-invalid" | null;
};

const NESTED_ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CANONICAL_ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;
const RETIRED_NESTED_BINDING_FIELDS = new Set([
  "targetKind",
  "task07MediaRevision",
  "mediaUpdatedAt",
]);

const nestedEntryDeclaresPersistedMedia = (entry: UnknownRecord): boolean => (
  containerHasPersistedMedia(entry) ||
  containerHasPersistedMedia(entry.General)
);

const validRetiredNestedBinding = (binding: UnknownRecord): boolean => (
  Object.keys(binding).every((field) =>
    RETIRED_NESTED_BINDING_FIELDS.has(field)) &&
  (!hasOwn(binding, "task07MediaRevision") || (
    Number.isSafeInteger(binding.task07MediaRevision) &&
    Number(binding.task07MediaRevision) >= 0
  ))
);

export const classifyFoeNestedEntryIdentities = (
  source: UnknownRecord
): FoeNestedEntryIdentityPlan => {
  const rawRegistry = source.task07EmbeddedMedia;
  if (rawRegistry !== undefined && rawRegistry !== null &&
    !isPlainRecord(rawRegistry)) {
    return {entries: [], issue: "canonical-reference-invalid"};
  }
  const registry = isPlainRecord(rawRegistry) ? rawRegistry : {};
  const referencedIds = new Set<string>();
  const entries: FoeNestedEntryIdentity[] = [];
  let invalid = false;
  const add = (
    rawEntry: unknown,
    kind: "foe-technique" | "foe-spell",
    entryIndex: number
  ): void => {
    if (invalid) return;
    const entry = isPlainRecord(rawEntry) ? rawEntry : {};
    const sourceEntryId = typeof entry.task07MediaEntryId === "string" ?
      entry.task07MediaEntryId.trim() : "";
    if (!sourceEntryId) {
      if (nestedEntryDeclaresPersistedMedia(entry)) invalid = true;
      return;
    }
    if (!NESTED_ENTRY_ID_PATTERN.test(sourceEntryId) ||
      referencedIds.has(sourceEntryId)) {
      invalid = true;
      return;
    }
    referencedIds.add(sourceEntryId);
    if (!hasOwn(registry, sourceEntryId)) {
      if (nestedEntryDeclaresPersistedMedia(entry)) {
        invalid = true;
        return;
      }
      entries.push({kind, entryIndex, sourceEntryId, sourceAssetId: null});
      return;
    }
    const rawBinding = registry[sourceEntryId];
    if (!isPlainRecord(rawBinding) || rawBinding.targetKind !== kind ||
      hasOwn(rawBinding, "videoMedia")) {
      invalid = true;
      return;
    }
    const media = rawBinding.media;
    const sourceAssetId = isPlainRecord(media) &&
      typeof media.assetId === "string" &&
      CANONICAL_ASSET_ID_PATTERN.test(media.assetId.trim()) ?
      media.assetId.trim() : null;
    if (!sourceAssetId && (
      hasOwn(rawBinding, "media") ||
      nestedEntryDeclaresPersistedMedia(entry) ||
      !validRetiredNestedBinding(rawBinding)
    )) {
      invalid = true;
      return;
    }
    entries.push({kind, entryIndex, sourceEntryId, sourceAssetId});
  };
  const techniques = Array.isArray(source.tecniche) ? source.tecniche : [];
  techniques.forEach((entry, index) => add(entry, "foe-technique", index));
  const spells = Array.isArray(source.spells) ? source.spells : [];
  spells.forEach((entry, index) => add(entry, "foe-spell", index));
  if (invalid) return {entries: [], issue: "canonical-reference-invalid"};

  for (const [entryId, rawBinding] of Object.entries(registry)) {
    if (referencedIds.has(entryId)) continue;
    if (!isPlainRecord(rawBinding) ||
      !["foe-technique", "foe-spell"].includes(
        String(rawBinding.targetKind || "")
      ) ||
      hasOwn(rawBinding, "media") || hasOwn(rawBinding, "videoMedia") ||
      !validRetiredNestedBinding(rawBinding)) {
      return {entries: [], issue: "canonical-reference-invalid"};
    }
  }
  return {
    entries: entries.sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.entryIndex - right.entryIndex),
    issue: null,
  };
};

export const duplicateFoeNestedEntryId = (input: {
  receiptId: string;
  kind: "foe-technique" | "foe-spell";
  sourceEntryId: string;
}): string => `n_${createHash("sha256")
  .update([
    String(input.receiptId),
    input.kind,
    String(input.sourceEntryId),
  ].join("\u0000"))
  .digest("hex")
  .slice(0, 40)}`;

export const foeHasPersistedMedia = (source: UnknownRecord): boolean => (
  containerHasPersistedMedia(source) ||
  containerHasPersistedMedia(source.General) ||
  foeHasNestedPersistedMedia(source)
);

const foeHasRootPersistedMedia = (source: UnknownRecord): boolean => (
  containerHasPersistedMedia(source) ||
  containerHasPersistedMedia(source.General)
);

export const assessCanonicalOnlyFoeDuplication = (
  source: UnknownRecord,
  hasCanonicalClone: boolean,
  hasCanonicalNestedClone = false
): {allowed: true; reason: null} | {
  allowed: false;
  reason: "canonical-media-required" | "nested-media-unsupported";
} => {
  if (foeHasNestedPersistedMedia(source)) {
    if (!hasCanonicalNestedClone) {
      return {allowed: false, reason: "nested-media-unsupported"};
    }
  }
  if (foeHasRootPersistedMedia(source) && !hasCanonicalClone) {
    return {allowed: false, reason: "canonical-media-required"};
  }
  return {allowed: true, reason: null};
};

export const foeDuplicationControlFenceMatches = (input: {
  storedControlHash: unknown;
  storedMode: unknown;
  currentControlHash: unknown;
  currentMode: unknown;
}): boolean => {
  const storedControlHash = String(input.storedControlHash || "").trim();
  const storedMode = String(input.storedMode || "").trim();
  const currentControlHash = String(input.currentControlHash || "").trim();
  const currentMode = String(input.currentMode || "").trim();
  return Boolean(
    storedControlHash &&
    storedMode &&
    storedControlHash === currentControlHash &&
    storedMode === currentMode
  );
};

/**
 * A canonical duplicate is a distinct Task 07 reference target. Strip every
 * source media binding and image alias before its newly finalized asset is
 * attached. The legacy duplication path keeps its existing copy semantics.
 */
export const stripTask07MediaFromDuplicatedFoe = (
  source: UnknownRecord,
  options: StripTask07MediaOptions = {}
): UnknownRecord => {
  const copyable = {...source};
  const general = isPlainRecord(copyable.General) ?
    {...copyable.General} :
    null;
  if (general) copyable.General = general;
  if (!options.canonicalClone) return copyable;

  const stripCanonicalAliases = (target: UnknownRecord): void => {
    TASK07_MEDIA_CONTROL_FIELDS.forEach((field) => delete target[field]);
    TASK07_IMAGE_ALIAS_FIELDS.forEach((field) => delete target[field]);
  };
  stripCanonicalAliases(copyable);
  if (general) stripCanonicalAliases(general);
  delete copyable.task07EmbeddedMedia;
  const stripNestedEntry = (value: unknown): unknown => {
    if (!isPlainRecord(value)) return value;
    const entry = {...value};
    stripCanonicalAliases(entry);
    if (isPlainRecord(entry.General)) {
      const entryGeneral = {...entry.General};
      stripCanonicalAliases(entryGeneral);
      entry.General = entryGeneral;
    }
    delete entry.task07MediaEntryId;
    return entry;
  };
  if (Array.isArray(copyable.tecniche)) {
    copyable.tecniche = copyable.tecniche.map(stripNestedEntry);
  }
  if (Array.isArray(copyable.spells)) {
    copyable.spells = copyable.spells.map(stripNestedEntry);
  }
  return copyable;
};
