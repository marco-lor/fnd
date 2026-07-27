type UnknownRecord = Record<string, unknown>;

const TASK07_ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (!value ||
    typeof value !== "object" ||
    Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasOwn = (value: UnknownRecord, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
);

export const isTask07CanonicalStoragePath = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (/^\/?media\/v1\//.test(text)) return true;

  try {
    const parsed = new URL(text);
    const objectMarker = "/o/";
    const markerIndex = parsed.pathname.indexOf(objectMarker);
    if (markerIndex >= 0) {
      const encodedPath = parsed.pathname.slice(
        markerIndex + objectMarker.length
      );
      return /^media\/v1\//.test(decodeURIComponent(encodedPath));
    }
    if (parsed.protocol === "gs:") {
      const objectPath = decodeURIComponent(
        parsed.pathname.replace(/^\/+/, "")
      );
      return /^media\/v1\//.test(objectPath);
    }
    if (parsed.hostname === "storage.googleapis.com") {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      return pathParts.length > 1 &&
        /^media\/v1\//.test(decodeURIComponent(pathParts.slice(1).join("/")));
    }
  } catch {
    return false;
  }
  return false;
};

export const isTask07MediaDescriptor = (
  value: unknown
): value is UnknownRecord => {
  if (!isPlainRecord(value)) return false;
  const assetId = typeof value.assetId === "string" ?
    value.assetId.trim() :
    "";
  if (!TASK07_ASSET_ID_PATTERN.test(assetId)) return false;
  const original = isPlainRecord(value.original) ? value.original : {};
  return value.schemaVersion === 1 ||
    value.contractVersion === 1 ||
    isTask07CanonicalStoragePath(original.path);
};

const containsTask07Reference = (
  value: unknown,
  seen: WeakSet<object>
): boolean => {
  if (isTask07CanonicalStoragePath(value) ||
    isTask07MediaDescriptor(value)) return true;
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => containsTask07Reference(entry, seen));
  }
  if (!isPlainRecord(value)) return false;
  return Object.values(value).some(
    (entry) => containsTask07Reference(entry, seen)
  );
};

/**
 * Callable inventory payloads are untrusted. `media` and `General.media` are
 * reserved server-bound fields; canonical paths are rejected at any depth so
 * callers cannot smuggle a cross-bound descriptor under another key.
 * Null media values remain valid explicit removal intents.
 */
export const hasUntrustedTask07InventoryMedia = (value: unknown): boolean => {
  if (!isPlainRecord(value)) return containsTask07Reference(
    value,
    new WeakSet<object>()
  );
  if (hasOwn(value, "media") && value.media != null) return true;
  const general = isPlainRecord(value.General) ? value.General : null;
  if (general &&
    hasOwn(general, "media") &&
    general.media != null) return true;
  return containsTask07Reference(value, new WeakSet<object>());
};

const REMOVED = Symbol("task07-removed");

const stripTask07References = (
  value: unknown,
  seen: WeakMap<object, unknown>
): unknown | typeof REMOVED => {
  if (isTask07CanonicalStoragePath(value) ||
    isTask07MediaDescriptor(value)) return REMOVED;
  if (!value || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    value.forEach((entry) => {
      const next = stripTask07References(entry, seen);
      if (next !== REMOVED) output.push(next);
    });
    return output;
  }
  if (!isPlainRecord(value)) return value;
  const output: UnknownRecord = {};
  seen.set(value, output);
  Object.entries(value).forEach(([key, entry]) => {
    const next = stripTask07References(entry, seen);
    if (next !== REMOVED) output[key] = next;
  });
  return output;
};

export const stripUntrustedTask07InventoryMedia = (
  value: unknown
): UnknownRecord => {
  const stripped = stripTask07References(
    isPlainRecord(value) ? value : {},
    new WeakMap<object, unknown>()
  );
  const snapshot = isPlainRecord(stripped) ? stripped : {};
  delete snapshot.media;
  if (isPlainRecord(snapshot.General)) {
    const general = {...snapshot.General};
    delete general.media;
    snapshot.General = general;
  }
  return snapshot;
};

/**
 * Preserve an already command-owned descriptor during ordinary edits. A
 * caller may explicitly remove it with `media: null`, but may never supply a
 * replacement descriptor or canonical path through this generic command.
 */
export const mergeUntrustedInventorySnapshotPatch = (
  currentValue: unknown,
  patchValue: unknown
): UnknownRecord => {
  const current = isPlainRecord(currentValue) ? currentValue : {};
  const patch = isPlainRecord(patchValue) ? patchValue : {};
  if (hasUntrustedTask07InventoryMedia(patch)) {
    throw new TypeError("task07-inventory-media-injection");
  }
  const next: UnknownRecord = {...current, ...patch};
  if (hasOwn(patch, "media") && patch.media == null) delete next.media;

  if (hasOwn(patch, "General") && isPlainRecord(patch.General)) {
    const currentGeneral = isPlainRecord(current.General) ?
      current.General :
      {};
    const nextGeneral: UnknownRecord = {...currentGeneral, ...patch.General};
    if (hasOwn(patch.General, "media")) {
      if (patch.General.media == null) delete nextGeneral.media;
    } else if (hasOwn(currentGeneral, "media")) {
      nextGeneral.media = currentGeneral.media;
    }
    next.General = nextGeneral;
  }
  return next;
};

const preserveTrustedProjection = (
  untrustedValue: unknown,
  trustedValue: unknown
): UnknownRecord => {
  const output = stripUntrustedTask07InventoryMedia(untrustedValue);
  const untrusted = isPlainRecord(untrustedValue) ? untrustedValue : {};
  const trusted = isPlainRecord(trustedValue) ? trustedValue : {};
  const removesRootMedia = hasOwn(untrusted, "media") &&
    untrusted.media == null;
  if (!removesRootMedia && isTask07MediaDescriptor(trusted.media)) {
    output.media = trusted.media;
    const original = isPlainRecord(trusted.media.original) ?
      trusted.media.original :
      {};
    if (isTask07CanonicalStoragePath(original.path)) {
      output.imagePath = original.path;
    }
  }
  const trustedGeneral = isPlainRecord(trusted.General) ?
    trusted.General :
    null;
  const untrustedGeneral = isPlainRecord(untrusted.General) ?
    untrusted.General :
    null;
  const removesGeneralMedia = untrustedGeneral !== null &&
    hasOwn(untrustedGeneral, "media") && untrustedGeneral.media == null;
  if (!removesGeneralMedia &&
    trustedGeneral && isTask07MediaDescriptor(trustedGeneral.media)) {
    const outputGeneral = isPlainRecord(output.General) ?
      output.General :
      {};
    output.General = {
      ...outputGeneral,
      media: trustedGeneral.media,
    };
  }
  return output;
};

/**
 * The legacy root is client-controlled. It can remove media, but cannot
 * introduce it. Only a pre-existing command-owned V2 document can supply the
 * trusted projection that is carried forward.
 */
export const hardenLegacyInventoryProjectionMedia = (
  projectedValue: unknown,
  existingValue: unknown
): UnknownRecord => {
  const projected = isPlainRecord(projectedValue) ? projectedValue : {};
  const existing = isPlainRecord(existingValue) ? existingValue : {};
  const hardenedProjected = stripUntrustedTask07InventoryMedia(projected);
  const commandOwned = existing.legacyManaged === false;
  return {
    ...hardenedProjected,
    acquisitionSnapshot: commandOwned ?
      preserveTrustedProjection(
        projected.acquisitionSnapshot,
        existing.acquisitionSnapshot
      ) :
      stripUntrustedTask07InventoryMedia(projected.acquisitionSnapshot),
    currentSnapshot: commandOwned ?
      preserveTrustedProjection(
        projected.currentSnapshot,
        existing.currentSnapshot
      ) :
      stripUntrustedTask07InventoryMedia(projected.currentSnapshot),
  };
};
