import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

type DeleteGrigliataCustomTokenPayload = {
  tokenId: string;
};

const REGION = "europe-west1";
const HIDDEN_TOKEN_FIELD = "grigliata_hidden_token_ids_by_background";
const FIRESTORE_BATCH_SIZE = 450;

const asNonEmptyString = (value: unknown) => (
  typeof value === "string" && value.trim() ? value.trim() : ""
);

const isManagerRole = (role: unknown) => asNonEmptyString(role).toLowerCase() === "dm";

const normalizeHiddenTokenIdsByBackground = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, string[]>;
  }

  return Object.entries(value as Record<string, unknown>).reduce((nextMap, [backgroundId, tokenIds]) => {
    if (!backgroundId) {
      return nextMap;
    }

    const normalizedTokenIds = [...new Set(
      (Array.isArray(tokenIds) ? tokenIds : [])
        .map((tokenId) => asNonEmptyString(tokenId))
        .filter(Boolean)
    )];

    if (normalizedTokenIds.length) {
      nextMap[backgroundId] = normalizedTokenIds;
    }

    return nextMap;
  }, {} as Record<string, string[]>);
};

export const deleteGrigliataCustomToken = onCall<DeleteGrigliataCustomTokenPayload>(
  {region: REGION},
  async (request: CallableRequest<DeleteGrigliataCustomTokenPayload>) => {
    const requesterUid = asNonEmptyString(request.auth?.uid);
    if (!requesterUid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const tokenId = asNonEmptyString(request.data?.tokenId);
    if (!tokenId) {
      throw new HttpsError("invalid-argument", "tokenId is required.");
    }

    const db = admin.firestore();
    const requesterSnap = await db.doc(`users/${requesterUid}`).get();
    const requesterRole = requesterSnap.data()?.role;
    const isManager = isManagerRole(requesterRole);

    const tokenRef = db.doc(`grigliata_tokens/${tokenId}`);
    const tokenSnap = await tokenRef.get();
    if (!tokenSnap.exists) {
      throw new HttpsError("not-found", "Custom token not found.");
    }

    const tokenData = tokenSnap.data() || {};
    const ownerUid = asNonEmptyString(tokenData.ownerUid);
    const tokenType = asNonEmptyString(tokenData.tokenType);
    const customTokenRole = asNonEmptyString(tokenData.customTokenRole);
    if (!ownerUid || tokenType !== "custom") {
      throw new HttpsError("failed-precondition", "Only custom tokens can be deleted through this function.");
    }

    if (requesterUid !== ownerUid && !isManager) {
      throw new HttpsError("permission-denied", "You can only delete your own custom tokens.");
    }

    const deletedTokenIds = new Set<string>([tokenId]);
    const isTemplate = customTokenRole !== "instance";
    const instanceDocs = isTemplate
      ? (await db.collection("grigliata_tokens")
        .where("customTemplateId", "==", tokenId)
        .get()).docs.filter((docSnap) => docSnap.id !== tokenId)
      : [];

    instanceDocs.forEach((docSnap) => {
      deletedTokenIds.add(docSnap.id);
    });

    const placementDocs = [];
    for (const targetTokenId of deletedTokenIds) {
      const placementsSnap = await db.collection("grigliata_token_placements")
        .where("tokenId", "==", targetTokenId)
        .get();
      placementDocs.push(...placementsSnap.docs);
    }

    for (let index = 0; index < placementDocs.length; index += FIRESTORE_BATCH_SIZE) {
      const batch = db.batch();
      placementDocs.slice(index, index + FIRESTORE_BATCH_SIZE).forEach((placementDoc) => {
        batch.delete(placementDoc.ref);
      });
      await batch.commit();
    }

    if (instanceDocs.length) {
      for (let index = 0; index < instanceDocs.length; index += FIRESTORE_BATCH_SIZE) {
        const batch = db.batch();
        instanceDocs.slice(index, index + FIRESTORE_BATCH_SIZE).forEach((instanceDoc) => {
          batch.delete(instanceDoc.ref);
        });
        await batch.commit();
      }
    }

    const ownerRef = db.doc(`users/${ownerUid}`);
    const ownerSnap = await ownerRef.get();
    if (ownerSnap.exists) {
      const ownerData = ownerSnap.data() || {};
      const currentSettings = ownerData.settings || {};
      const nextHiddenTokenIdsByBackground = normalizeHiddenTokenIdsByBackground(currentSettings[HIDDEN_TOKEN_FIELD]);

      Object.keys(nextHiddenTokenIdsByBackground).forEach((backgroundId) => {
        const filteredTokenIds = nextHiddenTokenIdsByBackground[backgroundId]
          .filter((hiddenTokenId) => !deletedTokenIds.has(hiddenTokenId));
        if (filteredTokenIds.length) {
          nextHiddenTokenIdsByBackground[backgroundId] = filteredTokenIds;
        } else {
          delete nextHiddenTokenIdsByBackground[backgroundId];
        }
      });

      await ownerRef.set({
        settings: {
          [HIDDEN_TOKEN_FIELD]: nextHiddenTokenIdsByBackground,
        },
      }, {merge: true});
    }

    await tokenRef.delete();

    return {
      success: true,
      tokenId,
      deletedPlacementCount: placementDocs.length,
      deletedInstanceCount: instanceDocs.length,
    };
  }
);
