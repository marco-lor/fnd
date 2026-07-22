export const USER_DIRECTORY_SCHEMA_VERSION = 1 as const;
export const UNNAMED_CHARACTER_LABEL = "Unnamed character";

const CANONICAL_ROLES = new Set(["player", "dm", "webmaster"]);
const PROJECTION_KEYS = [
  "characterId",
  "label",
  "normalizedLabel",
  "role",
  "schemaVersion",
] as const;

export interface UserDirectoryProjection {
  schemaVersion: typeof USER_DIRECTORY_SCHEMA_VERSION;
  characterId: string;
  label: string;
  normalizedLabel: string;
  role: string;
}

export type UserDirectoryMutation =
  | {type: "none"}
  | {type: "delete"}
  | {type: "set"; projection: UserDirectoryProjection};

type UserSourceData = Record<string, unknown> | null | undefined;

const trimString = (value: unknown): string => (
  typeof value === "string" ? value.trim() : ""
);

export const normalizeDirectoryRole = (value: unknown): string => {
  const normalizedRole = trimString(value).toLowerCase();
  if (normalizedRole === "players") return "player";
  return CANONICAL_ROLES.has(normalizedRole) ? normalizedRole : "player";
};

export const normalizeDirectoryLabel = (value: string): string => (
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
);

export const buildUserDirectoryProjection = (
  sourceData: UserSourceData
): UserDirectoryProjection => {
  const characterId = trimString(sourceData?.characterId);
  const label = characterId || UNNAMED_CHARACTER_LABEL;

  return {
    schemaVersion: USER_DIRECTORY_SCHEMA_VERSION,
    characterId,
    label,
    normalizedLabel: normalizeDirectoryLabel(label),
    role: normalizeDirectoryRole(sourceData?.role),
  };
};

export const userDirectoryProjectionsEqual = (
  left: UserDirectoryProjection,
  right: UserDirectoryProjection
): boolean => (
  left.schemaVersion === right.schemaVersion
  && left.characterId === right.characterId
  && left.label === right.label
  && left.normalizedLabel === right.normalizedLabel
  && left.role === right.role
);

export const userDirectoryProjectionDataMatches = (
  value: unknown,
  projection: UserDirectoryProjection
): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data).sort();
  return keys.length === PROJECTION_KEYS.length
    && keys.every((key, index) => key === PROJECTION_KEYS[index])
    && PROJECTION_KEYS.every((key) => data[key] === projection[key]);
};

export const planUserDirectoryMutation = (
  beforeData: UserSourceData,
  afterData: UserSourceData
): UserDirectoryMutation => {
  if (!afterData) return beforeData ? {type: "delete"} : {type: "none"};

  const nextProjection = buildUserDirectoryProjection(afterData);
  if (
    beforeData
    && userDirectoryProjectionsEqual(
      buildUserDirectoryProjection(beforeData),
      nextProjection
    )
  ) {
    return {type: "none"};
  }

  return {type: "set", projection: nextProjection};
};
