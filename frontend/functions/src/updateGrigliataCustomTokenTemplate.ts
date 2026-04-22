import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

type UpdateGrigliataCustomTokenTemplatePayload = {
  tokenId: string;
  label: string;
  imageUrl?: string;
  imagePath?: string;
};

const REGION = "europe-west1";
const FIRESTORE_BATCH_SIZE = 450;

const asNonEmptyString = (value: unknown) => (
  typeof value === "string" && value.trim() ? value.trim() : ""
);

const isManagerRole = (role: unknown) => asNonEmptyString(role).toLowerCase() === "dm";

const commitDeleteFreeChunks = async (
  refs: admin.firestore.DocumentReference[],
  applyRef: (
    batch: admin.firestore.WriteBatch,
    ref: admin.firestore.DocumentReference
  ) => void
) => {
  for (let index = 0; index < refs.length; index += FIRESTORE_BATCH_SIZE) {
    const batch = admin.firestore().batch();
    refs.slice(index, index + FIRESTORE_BATCH_SIZE).forEach((ref) => applyRef(batch, ref));
    await batch.commit();
  }
};

export const updateGrigliataCustomTokenTemplate = onCall<UpdateGrigliataCustomTokenTemplatePayload>(
  {region: REGION},
  async (request: CallableRequest<UpdateGrigliataCustomTokenTemplatePayload>) => {
    const requesterUid = asNonEmptyString(request.auth?.uid);
    if (!requesterUid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const tokenId = asNonEmptyString(request.data?.tokenId);
    const label = asNonEmptyString(request.data?.label);
    if (!tokenId || !label) {
      throw new HttpsError("invalid-argument", "tokenId and label are required.");
    }

    const db = admin.firestore();
    const requesterSnap = await db.doc(`users/${requesterUid}`).get();
    const isManager = isManagerRole(requesterSnap.data()?.role);

    const templateRef = db.doc(`grigliata_tokens/${tokenId}`);
    const templateSnap = await templateRef.get();
    if (!templateSnap.exists) {
      throw new HttpsError("not-found", "Custom token template not found.");
    }

    const templateData = templateSnap.data() || {};
    const ownerUid = asNonEmptyString(templateData.ownerUid);
    const tokenType = asNonEmptyString(templateData.tokenType);
    const customTokenRole = asNonEmptyString(templateData.customTokenRole);
    if (!ownerUid || tokenType !== "custom" || customTokenRole === "instance") {
      throw new HttpsError("failed-precondition", "Only custom token templates can be updated.");
    }

    if (requesterUid !== ownerUid && !isManager) {
      throw new HttpsError("permission-denied", "You can only update your own custom token templates.");
    }

    const imageUrl = typeof request.data?.imageUrl === "string"
      ? request.data.imageUrl.trim()
      : asNonEmptyString(templateData.imageUrl);
    const imagePath = typeof request.data?.imagePath === "string"
      ? request.data.imagePath.trim()
      : asNonEmptyString(templateData.imagePath);
    const now = admin.firestore.FieldValue.serverTimestamp();

    const instanceSnapshots = await db.collection("grigliata_tokens")
      .where("customTemplateId", "==", tokenId)
      .get();
    const instanceRefs = instanceSnapshots.docs
      .filter((docSnap) => docSnap.id !== tokenId)
      .map((docSnap) => docSnap.ref);
    const placementRefs: admin.firestore.DocumentReference[] = [];

    for (const targetTokenId of [tokenId, ...instanceRefs.map((ref) => ref.id)]) {
      const placementSnap = await db.collection("grigliata_token_placements")
        .where("tokenId", "==", targetTokenId)
        .get();
      placementSnap.docs.forEach((docSnap) => {
        placementRefs.push(docSnap.ref);
      });
    }

    await commitDeleteFreeChunks(
      [templateRef, ...instanceRefs],
      (batch, ref) => {
        batch.set(ref, {
          label,
          imageUrl,
          imagePath,
          tokenType: "custom",
          customTokenRole: ref.id === tokenId ? "template" : "instance",
          customTemplateId: tokenId,
          imageSource: "uploaded",
          updatedAt: now,
          updatedBy: requesterUid,
        }, {merge: true});
      }
    );

    await commitDeleteFreeChunks(
      placementRefs,
      (batch, ref) => {
        batch.set(ref, {
          label,
          imageUrl,
          updatedAt: now,
          updatedBy: requesterUid,
        }, {merge: true});
      }
    );

    return {
      success: true,
      tokenId,
      updatedInstanceCount: instanceRefs.length,
      updatedPlacementCount: placementRefs.length,
    };
  }
);
