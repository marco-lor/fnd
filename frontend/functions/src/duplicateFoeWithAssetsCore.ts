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
];

export const foeHasNestedPersistedMedia = (
  source: UnknownRecord
): boolean => nestedFoeMediaContainers(source).some(containerHasPersistedMedia);

export const foeHasPersistedMedia = (source: UnknownRecord): boolean => (
  containerHasPersistedMedia(source) ||
  containerHasPersistedMedia(source.General) ||
  foeHasNestedPersistedMedia(source)
);

export const assessCanonicalOnlyFoeDuplication = (
  source: UnknownRecord,
  hasCanonicalClone: boolean
): {allowed: true; reason: null} | {
  allowed: false;
  reason: "canonical-media-required" | "nested-media-unsupported";
} => {
  if (foeHasNestedPersistedMedia(source)) {
    return {allowed: false, reason: "nested-media-unsupported"};
  }
  if (foeHasPersistedMedia(source) && !hasCanonicalClone) {
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
  return copyable;
};
