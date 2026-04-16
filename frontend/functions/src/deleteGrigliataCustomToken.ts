import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

type DeleteGrigliataCustomTokenPayload = {
  tokenId: string;
};

const REGION = "europe-west1";
const HIDDEN_TOKEN_FIELD = "grigliata_hidden_token_ids_by_background";

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
    if (!ownerUid || tokenType !== "custom") {
      throw new HttpsError("failed-precondition", "Only custom tokens can be deleted through this function.");
    }

    if (requesterUid !== ownerUid && !isManager) {
      throw new HttpsError("permission-denied", "You can only delete your own custom tokens.");
    }

    const placementsSnap = await db.collection("grigliata_token_placements")
      .where("tokenId", "==", tokenId)
      .get();

    for (let index = 0; index < placementsSnap.docs.length; index += 450) {
      const batch = db.batch();
      placementsSnap.docs.slice(index, index + 450).forEach((placementDoc) => {
        batch.delete(placementDoc.ref);
      });
      await batch.commit();
    }

    const ownerRef = db.doc(`users/${ownerUid}`);
    const ownerSnap = await ownerRef.get();
    if (ownerSnap.exists) {
      const ownerData = ownerSnap.data() || {};
      const currentSettings = ownerData.settings || {};
      const nextHiddenTokenIdsByBackground = normalizeHiddenTokenIdsByBackground(currentSettings[HIDDEN_TOKEN_FIELD]);

      Object.keys(nextHiddenTokenIdsByBackground).forEach((backgroundId) => {
        const filteredTokenIds = nextHiddenTokenIdsByBackground[backgroundId].filter((hiddenTokenId) => hiddenTokenId !== tokenId);
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
      deletedPlacementCount: placementsSnap.size,
    };
  }
);