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
] as const;

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (!value ||
    typeof value !== "object" ||
    Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
