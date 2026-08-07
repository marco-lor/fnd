import {evaluateDocumentBudget} from "./userDataV2";

export const TASK07_FOE_RETIREMENT_MAX_UPLOADS = 16;
export const TASK07_FOE_RETIREMENT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const TASK07_FOE_RETIREMENT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const TASK07_FOE_DOCUMENT_MAX_BYTES = 900 * 1024;

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const CANONICAL_ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;
const FIREBASE_URL_PREFIX =
  "https://firebasestorage.googleapis.com/v0/b/";

const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const ENTRY_FIELDS = [
  "name",
  "description",
  "danni",
  "effetti",
  "image",
] as const;

const TOP_LEVEL_MUTATION_FIELDS = ["fields", "tecniche", "spells"];
const FORBIDDEN_TOP_LEVEL_FIELDS = new Set([
  "General",
  "created_at",
  "downloadUrl",
  "id",
  "imagePath",
  "imageUrl",
  "image_url",
  "media",
  "mediaUpdatedAt",
  "task07MediaRevision",
  "task07VideoMediaRevision",
  "updated_at",
  "url",
  "videoMedia",
  "videoMediaUpdatedAt",
  "tecniche",
  "spells",
]);

const FORBIDDEN_NESTED_FIELDS = new Set([
  "media",
  "mediaUpdatedAt",
  "task07MediaRevision",
  "task07VideoMediaRevision",
  "videoMedia",
  "videoMediaUpdatedAt",
]);

export type FoeRetirementImageIntent =
  {mode: "keep"; path: string; url: string} |
  {mode: "remove"} |
  {
    mode: "upload";
    key: string;
    sha256: string;
    bytes: number;
    contentType: string;
  };

export interface FoeRetirementEntry {
  name: string;
  description: string;
  danni: string;
  effetti: string;
  image: FoeRetirementImageIntent;
}

export interface SanitizedFoeRetirementMutation {
  fields: Record<string, unknown>;
  tecniche: FoeRetirementEntry[];
  spells: FoeRetirementEntry[];
}

export interface FoeRetirementUploadPlan {
  key: string;
  slot: string;
  path: string;
  fileName: string;
  sha256: string;
  bytes: number;
  contentType: string;
  metadata: Record<string, string>;
}

export interface FoeRetirementResolvedUpload {
  key: string;
  path: string;
  url: string;
  generation: string;
}

export interface NormalizedFoeTimestamp {
  seconds: number;
  nanoseconds: number;
}

export class FoeMediaRetirementContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FoeMediaRetirementContractError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new FoeMediaRetirementContractError(code, message);
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
};

const safeFieldName = (value: string): boolean => (
  Boolean(value) &&
  !value.includes(".") &&
  !value.includes("/") &&
  !value.includes(String.fromCharCode(92)) &&
  !/^__.*__$/.test(value)
);

const assertJsonValue = (
  value: unknown,
  path: string,
  depth = 0
): void => {
  if (depth > 12) fail("mutation-depth-exceeded", `${path} is too deep.`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("mutation-value-invalid", `${path} must be finite.`);
    }
    return;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized.startsWith("blob:") || normalized.startsWith("data:")) {
      fail("mutation-url-invalid", `${path} contains a temporary URL.`);
    }
    if (value.trim().startsWith("media_assets/") ||
      storagePathFromUrl(value).startsWith("media_assets/")) {
      fail("mutation-canonical-media-forbidden", `${path} is canonical media.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(
      entry,
      `${path}[${index}]`,
      depth + 1
    ));
    return;
  }
  if (!isPlainRecord(value)) {
    fail("mutation-value-invalid", `${path} must contain plain JSON values.`);
  }
  if (CANONICAL_ASSET_ID_PATTERN.test(String(value.assetId || ""))) {
    fail("mutation-canonical-media-forbidden", `${path} is canonical media.`);
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (!safeFieldName(key) || FORBIDDEN_NESTED_FIELDS.has(key)) {
      fail("mutation-field-forbidden", `${path}.${key} is not writable.`);
    }
    if (entry === undefined) {
      fail("mutation-value-invalid", `${path}.${key} is undefined.`);
    }
    assertJsonValue(entry, `${path}.${key}`, depth + 1);
  });
};

const safeHttpsUrl = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^https:\/\//i.test(normalized) ? normalized : "";
};

function storagePathFromUrl(value: unknown): string {
  const url = safeHttpsUrl(value);
  if (!url || !url.startsWith(FIREBASE_URL_PREFIX)) return "";
  const encodedPath = url.split("/o/")[1]?.split("?")[0] || "";
  if (!encodedPath) return "";
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return "";
  }
}

export const isSafeFoeStoragePath = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const path = value.trim();
  return path.startsWith("foes/") &&
    !path.includes(String.fromCharCode(92)) &&
    path.split("/").every((segment) => (
      Boolean(segment) && segment !== "." && segment !== ".."
    ));
};

const imagePair = (value: unknown): {path: string; url: string} | null => {
  if (!isPlainRecord(value)) return null;
  const explicitPath = typeof value.imagePath === "string" ?
    value.imagePath.trim() : "";
  const url = safeHttpsUrl(value.imageUrl);
  const path = explicitPath || storagePathFromUrl(url);
  if (!path && !url) return null;
  if (path && !isSafeFoeStoragePath(path)) return null;
  return {path, url};
};

const currentImagePairs = (
  current: Record<string, unknown>
): Map<string, {path: string; url: string}> => {
  const result = new Map<string, {path: string; url: string}>();
  for (const collectionName of ["tecniche", "spells"] as const) {
    const rawEntries = current[collectionName];
    const entries: unknown[] = Array.isArray(rawEntries) ? rawEntries : [];
    entries.forEach((entry) => {
      const pair = imagePair(entry);
      if (pair) result.set(JSON.stringify([pair.path, pair.url]), pair);
    });
  }
  return result;
};

const requireString = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    fail("mutation-entry-invalid", `${path} must be a string.`);
  }
  const normalized = value;
  assertJsonValue(normalized, path);
  return normalized;
};

const sanitizeImageIntent = (input: {
  value: unknown;
  expectedKey: string;
  pairs: Map<string, {path: string; url: string}>;
}): FoeRetirementImageIntent => {
  if (!isPlainRecord(input.value) || typeof input.value.mode !== "string") {
    fail("mutation-image-invalid", "Foe image intent is invalid.");
  }
  if (input.value.mode === "remove") {
    if (!exactKeys(input.value, ["mode"])) {
      fail("mutation-image-invalid", "Remove image intent has extra fields.");
    }
    return {mode: "remove"};
  }
  if (input.value.mode === "keep") {
    if (!exactKeys(input.value, ["mode", "path", "url"])) {
      fail("mutation-image-invalid", "Keep image intent is invalid.");
    }
    const requested = {
      path: typeof input.value.path === "string" ?
        input.value.path.trim() : "",
      url: safeHttpsUrl(input.value.url),
    };
    const retained = input.pairs.get(JSON.stringify([
      requested.path,
      requested.url,
    ]));
    if (!retained) {
      fail(
        "mutation-retained-image-mismatch",
        "Retained foe image does not match the current document."
      );
    }
    return {mode: "keep", path: retained.path, url: retained.url};
  }
  if (input.value.mode === "upload") {
    if (!exactKeys(input.value, [
      "mode",
      "key",
      "sha256",
      "bytes",
      "contentType",
    ])) {
      fail("mutation-image-invalid", "Upload image intent is invalid.");
    }
    const key = typeof input.value.key === "string" ?
      input.value.key.trim() : "";
    const sha256 = typeof input.value.sha256 === "string" ?
      input.value.sha256.trim().toLowerCase() : "";
    const bytes = Number(input.value.bytes);
    const contentType = typeof input.value.contentType === "string" ?
      input.value.contentType.trim().toLowerCase() : "";
    if (key !== input.expectedKey || !SAFE_SEGMENT_PATTERN.test(key) ||
      !DIGEST_PATTERN.test(sha256) ||
      !Number.isSafeInteger(bytes) || bytes <= 0 ||
      bytes > TASK07_FOE_RETIREMENT_MAX_UPLOAD_BYTES ||
      !CONTENT_TYPE_EXTENSIONS[contentType]) {
      fail("mutation-upload-invalid", "Foe image upload is invalid.");
    }
    return {mode: "upload", key, sha256, bytes, contentType};
  }
  return fail("mutation-image-invalid", "Unknown foe image intent.");
};

const sanitizeEntries = (input: {
  value: unknown;
  collectionName: "tecniche" | "spells";
  pairs: Map<string, {path: string; url: string}>;
}): FoeRetirementEntry[] => {
  if (!Array.isArray(input.value)) {
    fail("mutation-entry-invalid", `${input.collectionName} must be an array.`);
  }
  return input.value.map((raw, index) => {
    if (!isPlainRecord(raw) || !exactKeys(raw, ENTRY_FIELDS)) {
      fail(
        "mutation-entry-invalid",
        `${input.collectionName}[${index}] has unknown fields.`
      );
    }
    return {
      name: requireString(raw.name, `${input.collectionName}[${index}].name`),
      description: requireString(
        raw.description,
        `${input.collectionName}[${index}].description`
      ),
      danni: requireString(
        raw.danni,
        `${input.collectionName}[${index}].danni`
      ),
      effetti: requireString(
        raw.effetti,
        `${input.collectionName}[${index}].effetti`
      ),
      image: sanitizeImageIntent({
        value: raw.image,
        expectedKey: `${input.collectionName}-${index}`,
        pairs: input.pairs,
      }),
    };
  });
};

export const sanitizeFoeRetirementMutation = (input: {
  mutation: unknown;
  current: Record<string, unknown>;
}): SanitizedFoeRetirementMutation => {
  if (!isPlainRecord(input.mutation) ||
    !exactKeys(input.mutation, TOP_LEVEL_MUTATION_FIELDS)) {
    fail("mutation-invalid", "Foe retirement mutation is invalid.");
  }
  if (!isPlainRecord(input.mutation.fields)) {
    fail("mutation-fields-invalid", "Foe fields must be a plain object.");
  }
  const fields: Record<string, unknown> = {};
  Object.entries(input.mutation.fields).forEach(([key, value]) => {
    if (!safeFieldName(key) || FORBIDDEN_TOP_LEVEL_FIELDS.has(key)) {
      fail("mutation-field-forbidden", `Foe field ${key} is not writable.`);
    }
    if (value === undefined) {
      fail("mutation-value-invalid", `Foe field ${key} is undefined.`);
    }
    assertJsonValue(value, `fields.${key}`);
    fields[key] = value;
  });
  const pairs = currentImagePairs(input.current);
  const tecniche = sanitizeEntries({
    value: input.mutation.tecniche,
    collectionName: "tecniche",
    pairs,
  });
  const spells = sanitizeEntries({
    value: input.mutation.spells,
    collectionName: "spells",
    pairs,
  });
  const uploads = [...tecniche, ...spells]
    .map(({image}) => image)
    .filter((image): image is Extract<
      FoeRetirementImageIntent,
      {mode: "upload"}
    > => image.mode === "upload");
  const totalBytes = uploads.reduce((total, {bytes}) => total + bytes, 0);
  if (uploads.length > TASK07_FOE_RETIREMENT_MAX_UPLOADS ||
    totalBytes > TASK07_FOE_RETIREMENT_MAX_TOTAL_BYTES ||
    new Set(uploads.map(({key}) => key)).size !== uploads.length) {
    fail("mutation-upload-budget-exceeded", "Foe upload budget exceeded.");
  }
  return {fields, tecniche, spells};
};

export const buildFoeRetirementUploadPlans = (input: {
  mutation: SanitizedFoeRetirementMutation;
  actorUid: string;
  operationId: string;
  receiptId: string;
  foeId: string;
  assetId: string;
}): FoeRetirementUploadPlan[] => {
  const uploads = [...input.mutation.tecniche, ...input.mutation.spells]
    .map(({image}) => image)
    .filter((image): image is Extract<
      FoeRetirementImageIntent,
      {mode: "upload"}
    > => image.mode === "upload");
  return uploads.map((upload) => {
    const extension = CONTENT_TYPE_EXTENSIONS[upload.contentType];
    const fileName = `${upload.sha256}.${extension}`;
    const path = [
      "foes",
      "task07-operations",
      input.actorUid,
      input.receiptId,
      input.foeId,
      upload.key,
      fileName,
    ].join("/");
    return {
      key: upload.key,
      slot: upload.key,
      path,
      fileName,
      sha256: upload.sha256,
      bytes: upload.bytes,
      contentType: upload.contentType,
      metadata: {
        task07ActorUid: input.actorUid,
        task07AssetId: input.assetId,
        task07Bytes: String(upload.bytes),
        task07Digest: upload.sha256,
        task07FoeId: input.foeId,
        task07OperationId: input.operationId,
        task07ReceiptId: input.receiptId,
        task07Slot: upload.key,
      },
    };
  });
};

const materializeEntries = (
  entries: FoeRetirementEntry[],
  resolved: Map<string, FoeRetirementResolvedUpload>
): Record<string, unknown>[] => entries.map((entry) => {
  let imagePath = "";
  let imageUrl = "";
  if (entry.image.mode === "keep") {
    imagePath = entry.image.path;
    imageUrl = entry.image.url;
  } else if (entry.image.mode === "upload") {
    const upload = resolved.get(entry.image.key);
    if (!upload) {
      fail("verified-upload-missing", "Verified foe upload is missing.");
    }
    imagePath = upload.path;
    imageUrl = upload.url;
  }
  return {
    name: entry.name,
    description: entry.description,
    danni: entry.danni,
    effetti: entry.effetti,
    imagePath,
    imageUrl,
  };
});

export const materializeFoeRetirementMutation = (input: {
  mutation: SanitizedFoeRetirementMutation;
  uploads: FoeRetirementResolvedUpload[];
}): {
  fields: Record<string, unknown>;
  tecniche: Record<string, unknown>[];
  spells: Record<string, unknown>[];
} => {
  const resolved = new Map(input.uploads.map((upload) => [
    upload.key,
    upload,
  ]));
  return {
    fields: input.mutation.fields,
    tecniche: materializeEntries(input.mutation.tecniche, resolved),
    spells: materializeEntries(input.mutation.spells, resolved),
  };
};

const deleteCanonicalFoeFields = (target: Record<string, unknown>): void => {
  [
    "media",
    "imagePath",
    "imageUrl",
    "image_url",
    "url",
    "downloadUrl",
  ].forEach((field) => delete target[field]);
  if (isPlainRecord(target.General)) {
    const general = {...target.General};
    [
      "media",
      "mediaUpdatedAt",
      "task07MediaRevision",
      "imagePath",
      "imageUrl",
      "image_url",
      "url",
      "downloadUrl",
    ].forEach((field) => delete general[field]);
    target.General = general;
  }
};

export const buildFoeRetirementFinalDocument = (input: {
  current: Record<string, unknown>;
  materialized: ReturnType<typeof materializeFoeRetirementMutation>;
  revision: number;
  updatedAt: unknown;
}): Record<string, unknown> => {
  const result: Record<string, unknown> = {
    ...input.current,
    ...input.materialized.fields,
    tecniche: input.materialized.tecniche,
    spells: input.materialized.spells,
    task07MediaRevision: input.revision + 1,
    mediaUpdatedAt: input.updatedAt,
    updated_at: input.updatedAt,
  };
  if (Object.prototype.hasOwnProperty.call(input.current, "created_at")) {
    result.created_at = input.current.created_at;
  }
  deleteCanonicalFoeFields(result);
  const budget = evaluateDocumentBudget(result, TASK07_FOE_DOCUMENT_MAX_BYTES);
  if (!budget.accepted) {
    fail("foe-document-budget-exceeded", "Foe document exceeds 900 KiB.");
  }
  return result;
};

const addStoragePaths = (value: unknown, target: Set<string>): void => {
  if (!isPlainRecord(value)) return;
  for (const field of [
    "imagePath",
    "imageUrl",
    "image_url",
    "url",
    "downloadUrl",
  ]) {
    const raw = value[field];
    const path = isSafeFoeStoragePath(raw) ? raw.trim() : storagePathFromUrl(raw);
    if (isSafeFoeStoragePath(path)) target.add(path);
  }
};

export const collectFoeLegacyStoragePaths = (
  value: Record<string, unknown>
): string[] => {
  const paths = new Set<string>();
  addStoragePaths(value, paths);
  addStoragePaths(value.General, paths);
  for (const collectionName of ["tecniche", "spells"] as const) {
    const rawEntries = value[collectionName];
    const entries: unknown[] = Array.isArray(rawEntries) ? rawEntries : [];
    entries.forEach((entry) => addStoragePaths(entry, paths));
  }
  return [...paths].sort();
};

export const legacyFoeCleanupCandidates = (input: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): string[] => {
  const retained = new Set(collectFoeLegacyStoragePaths(input.after));
  return collectFoeLegacyStoragePaths(input.before)
    .filter((path) => !retained.has(path));
};

export const normalizeFoeTimestamp = (
  value: unknown
): NormalizedFoeTimestamp | null => {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") {
    fail("expected-updated-at-invalid", "Expected timestamp is invalid.");
  }
  const timestamp = value as {
    seconds?: unknown;
    nanoseconds?: unknown;
    toMillis?: unknown;
  };
  const seconds = Number(timestamp.seconds);
  const nanoseconds = Number(timestamp.nanoseconds || 0);
  if (!Number.isSafeInteger(seconds) ||
    !Number.isSafeInteger(nanoseconds) ||
    nanoseconds < 0 || nanoseconds >= 1_000_000_000) {
    fail("expected-updated-at-invalid", "Expected timestamp is invalid.");
  }
  return {seconds, nanoseconds};
};

export const foeTimestampsMatch = (
  left: unknown,
  right: unknown
): boolean => {
  const normalizedLeft = normalizeFoeTimestamp(left);
  const normalizedRight = normalizeFoeTimestamp(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
};
