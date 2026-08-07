import * as admin from "firebase-admin";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import {
  assertTask07DemoEmulatorBypassIsExact,
  TASK07_CALLABLE_OPTIONS,
} from "./task07CallableOptions";

const MAX_CHARACTER_TOKEN_IDS = 60;
const ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;
const GENERATION_PATTERN = /^[1-9][0-9]*$/;
const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const AVATAR_VARIANTS = ["thumbnail", "thumbnail2x", "card"] as const;

type Data = Record<string, unknown>;

type CharacterMediaEntry = {
  tokenId: string;
  media: Data;
};

const isRecord = (value: unknown): value is Data => (
  value != null && typeof value === "object" && !Array.isArray(value)
);

const asString = (value: unknown): string => (
  typeof value === "string" ? value.trim() : ""
);

const isSafeDocumentId = (value: string): boolean => (
  Boolean(value) && value !== "." && value !== ".." && value.length <= 256 &&
  !value.includes("/") && [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code > 31 && code !== 127;
  })
);

const positiveInteger = (value: unknown): number | null => {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
};

export const normalizeTask07CharacterTokenIds = (
  value: unknown
): string[] | null => {
  if (!Array.isArray(value) || value.length > MAX_CHARACTER_TOKEN_IDS) {
    return null;
  }
  const normalized = value.map(asString);
  if (normalized.some((tokenId) => !isSafeDocumentId(tokenId))) {
    return null;
  }
  return [...new Set(normalized)];
};

const readEntityMedia = (data: Data): unknown => {
  if (isRecord(data.media)) return data.media;
  const general = isRecord(data.General) ? data.General : null;
  return general?.media;
};

const sanitizeObjectDescriptor = (
  value: unknown,
  expectedPath: string,
  expectedGeneration: string
): Data | null => {
  if (!isRecord(value)) return null;
  const path = asString(value.path);
  const generation = asString(String(value.generation || ""));
  const bytes = positiveInteger(value.bytes);
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  const contentType = asString(value.contentType).toLowerCase();
  if (path !== expectedPath || generation !== expectedGeneration || !bytes ||
    !width || !height || !IMAGE_CONTENT_TYPES.has(contentType)) {
    return null;
  }
  return {path, generation, bytes, contentType, width, height};
};

export const sanitizeTask07CanonicalAvatarMedia = (
  value: unknown,
  expectedOwnerUid: string
): Data | null => {
  if (!isRecord(value)) return null;
  const assetId = asString(value.assetId);
  const generation = asString(String(value.generation || ""));
  if (value.schemaVersion !== 1 || value.contractVersion !== 1 ||
    value.kind !== "avatar" || value.state !== "ready" ||
    value.audience !== "signed-in" ||
    asString(value.ownerUid) !== expectedOwnerUid ||
    !ASSET_ID_PATTERN.test(assetId) ||
    !GENERATION_PATTERN.test(generation)) {
    return null;
  }

  const prefix = [
    "media_assets/v1/signed-in",
    expectedOwnerUid,
    assetId,
    generation,
  ].join("/");
  const original = sanitizeObjectDescriptor(
    value.original,
    `${prefix}/original`,
    generation
  );
  if (!original) return null;

  const sourceVariants = isRecord(value.variants) ? value.variants : {};
  const variants: Data = {};
  AVATAR_VARIANTS.forEach((variant) => {
    const descriptor = sanitizeObjectDescriptor(
      sourceVariants[variant],
      `${prefix}/${variant}`,
      generation
    );
    if (descriptor) variants[variant] = descriptor;
  });
  if (!variants.thumbnail) return null;

  return {
    schemaVersion: 1,
    contractVersion: 1,
    assetId,
    kind: "avatar",
    state: "ready",
    generation,
    audience: "signed-in",
    ownerUid: expectedOwnerUid,
    original,
    variants,
  };
};

export const resolveTask07CharacterMediaEntry = (input: {
  tokenId: string;
  tokenData: Data;
  usersById: ReadonlyMap<string, Data>;
}): CharacterMediaEntry | null => {
  const {tokenId, tokenData, usersById} = input;
  const ownerUid = asString(tokenData.ownerUid);
  const characterId = asString(tokenData.characterId);
  if (tokenData.tokenType !== "character" || !isSafeDocumentId(tokenId) ||
    !isSafeDocumentId(ownerUid)) {
    return null;
  }

  const candidateUserIds = [...new Set([characterId, ownerUid])]
    .filter(isSafeDocumentId);
  for (const userId of candidateUserIds) {
    const user = usersById.get(userId);
    if (!user) continue;
    if (userId !== ownerUid && asString(user.characterId) !== characterId) {
      continue;
    }
    const media = sanitizeTask07CanonicalAvatarMedia(
      readEntityMedia(user),
      userId
    );
    if (media) {
      return {tokenId, media};
    }
  }
  return null;
};

const relatedUserIds = (tokenData: Data): string[] => {
  if (tokenData.tokenType !== "character") return [];
  const ownerUid = asString(tokenData.ownerUid);
  const characterId = asString(tokenData.characterId);
  if (!isSafeDocumentId(ownerUid)) return [];
  return [...new Set([characterId, ownerUid])].filter(isSafeDocumentId);
};

export const task07ResolveCharacterMedia = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 30},
  async (request: CallableRequest<{tokenIds?: unknown}>) => {
    assertTask07DemoEmulatorBypassIsExact();
    if (!asString(request.auth?.uid)) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const tokenIds = normalizeTask07CharacterTokenIds(request.data?.tokenIds);
    if (!tokenIds) {
      throw new HttpsError(
        "invalid-argument",
        "A bounded list of valid character token IDs is required."
      );
    }
    if (!tokenIds.length) return {schemaVersion: 1, entries: []};

    const db = admin.firestore();
    const tokenSnapshots = await db.getAll(...tokenIds.map((tokenId) => (
      db.doc(`grigliata_tokens/${tokenId}`)
    )));
    const tokens = tokenSnapshots.flatMap((snapshot) => (
      snapshot.exists ? [[snapshot.id, snapshot.data() || {}] as const] : []
    ));
    const userIds = [...new Set(tokens.flatMap(([, data]) => (
      relatedUserIds(data)
    )))];
    if (!userIds.length) return {schemaVersion: 1, entries: []};

    const userSnapshots = await db.getAll(...userIds.map((userId) => (
      db.doc(`users/${userId}`)
    )));
    const usersById = new Map<string, Data>();
    userSnapshots.forEach((snapshot) => {
      if (snapshot.exists) usersById.set(snapshot.id, snapshot.data() || {});
    });
    const entries = tokens.flatMap(([tokenId, tokenData]) => {
      const entry = resolveTask07CharacterMediaEntry({
        tokenId,
        tokenData,
        usersById,
      });
      return entry ? [entry] : [];
    });

    return {schemaVersion: 1, entries};
  }
);
