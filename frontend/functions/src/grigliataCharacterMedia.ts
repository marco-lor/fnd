import * as admin from "firebase-admin";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import {
  assertTask07DemoEmulatorBypassIsExact,
  TASK07_CALLABLE_OPTIONS,
} from "./task07CallableOptions";
import {assertActiveCaller} from "./callerAuthorization";

const MAX_CHARACTER_TOKEN_IDS = 60;
const ASSET_ID_PATTERN = /^m_[a-f0-9]{40}$/;
const GENERATION_PATTERN = /^[1-9][0-9]*$/;
const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const AVATAR_VARIANTS = ["thumbnail", "thumbnail2x", "card"] as const;
const TOKEN_VARIANTS = [
  "thumbnail",
  "thumbnail2x",
  "card",
  "card2x",
] as const;

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
  expectedPath: string
): Data | null => {
  if (!isRecord(value)) return null;
  const path = asString(value.path);
  const generation = asString(String(value.generation || ""));
  const bytes = positiveInteger(value.bytes);
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  const contentType = asString(value.contentType).toLowerCase();
  if (path !== expectedPath || !GENERATION_PATTERN.test(generation) || !bytes ||
    !width || !height || !IMAGE_CONTENT_TYPES.has(contentType)) {
    return null;
  }
  return {path, generation, bytes, contentType, width, height};
};

const sanitizeTask07CanonicalImageMedia = (
  value: unknown,
  expectedOwnerUid: string,
  expectedKind: "avatar" | "token",
  expectedVariants: readonly string[]
): Data | null => {
  if (!isRecord(value)) return null;
  const assetId = asString(value.assetId);
  const generation = asString(String(value.generation || ""));
  if (value.schemaVersion !== 1 || value.contractVersion !== 1 ||
    value.kind !== expectedKind || value.state !== "ready" ||
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
    `${prefix}/original`
  );
  if (!original) return null;

  const sourceVariants = isRecord(value.variants) ? value.variants : {};
  const variants: Data = {};
  expectedVariants.forEach((variant) => {
    const descriptor = sanitizeObjectDescriptor(
      sourceVariants[variant],
      `${prefix}/${variant}`
    );
    if (descriptor) variants[variant] = descriptor;
  });
  if (!variants.thumbnail) return null;

  return {
    schemaVersion: 1,
    contractVersion: 1,
    assetId,
    kind: expectedKind,
    state: "ready",
    generation,
    audience: "signed-in",
    ownerUid: expectedOwnerUid,
    original,
    variants,
  };
};

export const sanitizeTask07CanonicalAvatarMedia = (
  value: unknown,
  expectedOwnerUid: string
): Data | null => sanitizeTask07CanonicalImageMedia(
  value,
  expectedOwnerUid,
  "avatar",
  AVATAR_VARIANTS
);

export const sanitizeTask07CanonicalTokenMedia = (
  value: unknown,
  expectedOwnerUid: string
): Data | null => sanitizeTask07CanonicalImageMedia(
  value,
  expectedOwnerUid,
  "token",
  TOKEN_VARIANTS
);

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

const resolvedPlacementTokenId = (placementData: Data): string => (
  asString(placementData.tokenId) || asString(placementData.ownerUid)
);

export const isTask07PlacementMediaVisible = (input: {
  placementId: string;
  backgroundId: string;
  tokenId: string;
  placementData: Data;
  actorRole: string;
}): boolean => {
  const {placementData} = input;
  return isSafeDocumentId(input.backgroundId) &&
    isSafeDocumentId(input.tokenId) &&
    input.placementId === `${input.backgroundId}__${input.tokenId}` &&
    asString(placementData.backgroundId) === input.backgroundId &&
    resolvedPlacementTokenId(placementData) === input.tokenId &&
    isSafeDocumentId(asString(placementData.ownerUid)) &&
    (
      placementData.isVisibleToPlayers !== false ||
      asString(input.actorRole).toLowerCase() === "dm"
    );
};

const resolvedCustomTemplate = (input: {
  tokenId: string;
  tokenData: Data;
  templatesById: ReadonlyMap<string, Data>;
}): Data | null => {
  const ownerUid = asString(input.tokenData.ownerUid);
  const role = asString(input.tokenData.customTokenRole) || "template";
  if (role !== "instance") return input.tokenData;
  const templateId = asString(input.tokenData.customTemplateId);
  const template = input.templatesById.get(templateId);
  if (!isSafeDocumentId(templateId) || templateId === input.tokenId ||
    !template || template.tokenType !== "custom" ||
    asString(template.customTokenRole) === "instance" ||
    asString(template.ownerUid) !== ownerUid ||
    (asString(template.customTemplateId) || templateId) !== templateId) {
    return null;
  }
  return template;
};

export const resolveTask07PlacedTokenMediaEntry = (input: {
  tokenId: string;
  tokenData: Data;
  templatesById: ReadonlyMap<string, Data>;
  usersById: ReadonlyMap<string, Data>;
}): CharacterMediaEntry | null => {
  const {tokenId, tokenData} = input;
  const ownerUid = asString(tokenData.ownerUid);
  if (!isSafeDocumentId(tokenId) || !isSafeDocumentId(ownerUid)) return null;

  if (tokenData.tokenType === "character") {
    return resolveTask07CharacterMediaEntry({
      tokenId,
      tokenData,
      usersById: input.usersById,
    });
  }

  if (tokenData.tokenType === "custom") {
    const source = resolvedCustomTemplate({
      tokenId,
      tokenData,
      templatesById: input.templatesById,
    });
    const media = source ? sanitizeTask07CanonicalTokenMedia(
      readEntityMedia(source),
      ownerUid
    ) : null;
    return media ? {tokenId, media} : null;
  }

  if (tokenData.tokenType === "foe") {
    const media = sanitizeTask07CanonicalTokenMedia(
      readEntityMedia(tokenData),
      ownerUid
    );
    return media ? {tokenId, media} : null;
  }

  return null;
};

export const task07ResolveCharacterMedia = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 30},
  async (request: CallableRequest<{tokenIds?: unknown}>) => {
    assertTask07DemoEmulatorBypassIsExact();
    const actorUid = asString(request.auth?.uid);
    if (!actorUid) {
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
    const actor = await db.doc(`users/${actorUid}`).get();
    assertActiveCaller(actor);
    const actorRole = asString(actor.get("role")).toLowerCase();
    const backgroundId = asString(
      (request.data as {backgroundId?: unknown})?.backgroundId
    );
    if (backgroundId && !isSafeDocumentId(backgroundId)) {
      throw new HttpsError(
        "invalid-argument",
        "A valid Grigliata background ID is required."
      );
    }

    let accessibleTokenIds = tokenIds;
    const placementOwnersByTokenId = new Map<string, string>();
    if (backgroundId) {
      const placementSnapshots = await db.getAll(...tokenIds.map((tokenId) => (
        db.doc(`grigliata_token_placements/${backgroundId}__${tokenId}`)
      )));
      accessibleTokenIds = tokenIds.filter((tokenId, index) => {
        const placement = placementSnapshots[index];
        const placementData = placement.exists ? placement.data() || {} : {};
        const visible = placement.exists && isTask07PlacementMediaVisible({
          placementId: placement.id,
          backgroundId,
          tokenId,
          placementData,
          actorRole,
        });
        if (visible) {
          placementOwnersByTokenId.set(
            tokenId,
            asString(placementData.ownerUid)
          );
        }
        return visible;
      });
    }
    if (!accessibleTokenIds.length) {
      return {schemaVersion: 1, entries: []};
    }

    const tokenSnapshots = await db.getAll(...accessibleTokenIds.map((tokenId) => (
      db.doc(`grigliata_tokens/${tokenId}`)
    )));
    const tokens = tokenSnapshots.flatMap((snapshot) => (
      snapshot.exists && (
        !backgroundId ||
        asString(snapshot.get("ownerUid")) ===
          placementOwnersByTokenId.get(snapshot.id)
      ) ?
        [[snapshot.id, snapshot.data() || {}] as const] : []
    ));
    const templatesById = new Map<string, Data>(tokens);
    const missingTemplateIds = [...new Set(tokens.flatMap(([, data]) => {
      const templateId = data.tokenType === "custom" &&
        asString(data.customTokenRole) === "instance" ?
        asString(data.customTemplateId) : "";
      return isSafeDocumentId(templateId) && !templatesById.has(templateId) ?
        [templateId] : [];
    }))];
    if (missingTemplateIds.length) {
      const templateSnapshots = await db.getAll(...missingTemplateIds.map(
        (templateId) => db.doc(`grigliata_tokens/${templateId}`)
      ));
      templateSnapshots.forEach((snapshot) => {
        if (snapshot.exists) {
          templatesById.set(snapshot.id, snapshot.data() || {});
        }
      });
    }
    const userIds = [...new Set(tokens.flatMap(([, data]) => (
      relatedUserIds(data)
    )))];
    const usersById = new Map<string, Data>();
    if (userIds.length) {
      const userSnapshots = await db.getAll(...userIds.map((userId) => (
        db.doc(`users/${userId}`)
      )));
      userSnapshots.forEach((snapshot) => {
        if (snapshot.exists) usersById.set(snapshot.id, snapshot.data() || {});
      });
    }
    const entries = tokens.flatMap(([tokenId, tokenData]) => {
      if (!backgroundId && tokenData.tokenType !== "character") return [];
      const entry = resolveTask07PlacedTokenMediaEntry({
        tokenId,
        tokenData,
        templatesById,
        usersById,
      });
      return entry ? [entry] : [];
    });

    return {schemaVersion: 1, entries};
  }
);
