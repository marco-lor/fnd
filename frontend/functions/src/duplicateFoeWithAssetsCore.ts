type UnknownRecord = Record<string, unknown>;

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (!value ||
    typeof value !== "object" ||
    Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * A duplicated foe is a distinct Task 07 reference target. Reusing either
 * canonical descriptor would bind the new foe to a manifest whose entityId
 * still belongs to the source foe. Keep legacy fields copyable, but require a
 * future media-copy workflow to attach a newly finalized canonical asset.
 */
export const stripTask07MediaFromDuplicatedFoe = (
  source: UnknownRecord
): UnknownRecord => {
  const copyable = {...source};
  delete copyable.media;
  if (!isPlainRecord(copyable.General)) return copyable;

  const general = {...copyable.General};
  delete general.media;
  return {
    ...copyable,
    General: general,
  };
};
