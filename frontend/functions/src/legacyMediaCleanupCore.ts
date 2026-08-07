export type LegacyMediaScope =
  | "profile"
  | "catalog-item"
  | "npc"
  | "foe"
  | "background"
  | "token"
  | "music-track";

type UnknownRecord = Record<string, unknown>;

const LEGACY_MEDIA_SCOPES = new Set<LegacyMediaScope>([
  "profile",
  "catalog-item",
  "npc",
  "foe",
  "background",
  "token",
  "music-track",
]);

const MEDIA_VALUE_FIELDS = new Set([
  "audioPath",
  "audioUrl",
  "audio_url",
  "imagePath",
  "imageUrl",
  "image_url",
  "posterPath",
  "posterUrl",
  "thumbnailPath",
  "thumbnailUrl",
  "user_image_path",
  "user_image_url",
  "videoPath",
  "videoUrl",
  "video_url",
]);

const CANONICAL_STORAGE_ROOT = /^(?:media_assets|media_uploads)\//;
const VERSIONED_CANONICAL_STORAGE_ROOT = /^media\/v\d+\//;

const asString = (value: unknown): string => (
  typeof value === "string" ? value.trim() : ""
);

const asRecord = (value: unknown): UnknownRecord => (
  value && typeof value === "object" && !Array.isArray(value) ?
    value as UnknownRecord : {}
);

const pathFromHttpsUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return "";
    if (parsed.hostname === "firebasestorage.googleapis.com") {
      const marker = "/o/";
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex < 0) return "";
      return decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
    }
    if (parsed.hostname === "storage.googleapis.com") {
      const [, , ...pathParts] = parsed.pathname.split("/");
      return decodeURIComponent(pathParts.join("/"));
    }
  } catch {
    return "";
  }
  return "";
};

export const storagePathFromLegacyMediaValue = (value: unknown): string => {
  const text = asString(value).replace(/^\/+/, "");
  if (!text) return "";
  let path = text;
  if (text.startsWith("https://")) {
    path = pathFromHttpsUrl(text);
  } else if (text.startsWith("gs://")) {
    path = text.slice("gs://".length).split("/").slice(1).join("/");
  } else if (text.includes("://")) {
    return "";
  }
  path = path.trim().replace(/^\/+/, "");
  if (
    !path || path.includes("\\") || path.includes("\0") ||
    path.includes("?") || path.includes("#") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    CANONICAL_STORAGE_ROOT.test(path) ||
    VERSIONED_CANONICAL_STORAGE_ROOT.test(path)
  ) return "";
  return path;
};

export const isLegacyMediaScope = (
  value: unknown
): value is LegacyMediaScope => (
  LEGACY_MEDIA_SCOPES.has(value as LegacyMediaScope)
);

const referenceId = (referencePath: string, root: string): string => {
  const parts = referencePath.split("/");
  return parts.length === 2 && parts[0] === root ? parts[1] : "";
};

export const isLegacyMediaPathAllowed = (input: {
  ownerUid?: string;
  path: unknown;
  referencePath: string;
  scope: LegacyMediaScope;
}): boolean => {
  const path = storagePathFromLegacyMediaValue(input.path);
  if (!path) return false;
  switch (input.scope) {
  case "profile": {
    const uid = referenceId(input.referencePath, "users");
    if (!uid) return false;
    return path.startsWith(`users/${uid}/profile/`) || (
      path.startsWith("characters/") &&
      path.slice("characters/".length).includes(uid)
    );
  }
  case "catalog-item": {
    const itemId = referenceId(input.referencePath, "items");
    if (!itemId) return false;
    if (path.startsWith("items/")) {
      const itemFileName = path.slice("items/".length);
      return !itemFileName.startsWith("varie_") &&
        itemFileName.includes(`_${itemId}_`);
    }
    const spellFileName = path.startsWith("spells/videos/")
      ? path.slice("spells/videos/".length)
      : path.startsWith("spells/")
        ? path.slice("spells/".length)
        : "";
    return spellFileName.startsWith(`spell_${itemId}_`);
  }
  case "npc":
    return referenceId(input.referencePath, "echi_npcs") !== "" &&
      path.startsWith("echi_npcs/");
  case "foe":
    return referenceId(input.referencePath, "foes") !== "" &&
      path.startsWith("foes/") &&
      !path.startsWith("foes/task07-operations/");
  case "background":
    return referenceId(input.referencePath, "grigliata_backgrounds") !== "" &&
      path.startsWith("grigliata/backgrounds/");
  case "music-track":
    return referenceId(input.referencePath, "grigliata_music_tracks") !== "" &&
      path.startsWith("grigliata/music/");
  case "token": {
    const tokenId = referenceId(input.referencePath, "grigliata_tokens");
    const ownerUid = asString(input.ownerUid);
    return tokenId !== "" && ownerUid !== "" &&
      path.startsWith(`grigliata/tokens/${ownerUid}/`);
  }
  default:
    return false;
  }
};

const tokenDocumentOwnsMedia = (value: unknown): boolean => {
  const data = asRecord(value);
  return asString(data.tokenType) === "custom" &&
    asString(data.customTokenRole) !== "instance" &&
    asString(data.imageSource) === "uploaded" &&
    asString(data.ownerUid) !== "";
};

const collectMediaFieldPaths = (value: unknown): string[] => {
  const paths = new Set<string>();
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    Object.entries(entry as UnknownRecord).forEach(([key, child]) => {
      if (MEDIA_VALUE_FIELDS.has(key) && typeof child === "string") {
        const path = storagePathFromLegacyMediaValue(child);
        if (path) paths.add(path);
        return;
      }
      visit(child);
    });
  };
  visit(value);
  return [...paths].sort();
};

export const collectLegacyMediaPaths = (input: {
  referencePath: string;
  scope: LegacyMediaScope;
  value: unknown;
}): string[] => {
  if (input.scope === "token" && !tokenDocumentOwnsMedia(input.value)) {
    return [];
  }
  const data = asRecord(input.value);
  const ownerUid = input.scope === "token" ? asString(data.ownerUid) : "";
  return collectMediaFieldPaths(input.value).filter((path) => (
    isLegacyMediaPathAllowed({
      ownerUid,
      path,
      referencePath: input.referencePath,
      scope: input.scope,
    })
  ));
};

export const planLegacyMediaCleanup = (input: {
  after: unknown;
  before: unknown;
  referencePath: string;
  scope: LegacyMediaScope;
}): string[] => {
  const before = collectLegacyMediaPaths({
    referencePath: input.referencePath,
    scope: input.scope,
    value: input.before,
  });
  const after = new Set(collectLegacyMediaPaths({
    referencePath: input.referencePath,
    scope: input.scope,
    value: input.after,
  }));
  return before.filter((path) => !after.has(path));
};

export const documentContainsLegacyMediaPath = (
  value: unknown,
  expectedPath: unknown
): boolean => {
  const path = storagePathFromLegacyMediaValue(expectedPath);
  return path !== "" && collectMediaFieldPaths(value).includes(path);
};
