import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

type UpdateGrigliataCustomTokenTemplatePayload = {
  tokenId: string;
  label: string;
  imageUrl?: string;
  imagePath?: string;
};

const REGION = "europe-west1";
const FIRESTORE_BATCH_SIZE = 450;
const IN_QUERY_SIZE = 30;

const asNonEmptyString = (value: unknown) => (
  typeof value === "string" && value.trim() ? value.trim() : ""
);

const isManagerRole = (role: unknown) => asNonEmptyString(role).toLowerCase() === "dm";

const commitGuardedChunks = async (
  guardRef: admin.firestore.DocumentReference,
  refs: admin.firestore.DocumentReference[],
  applyRef: (
    transaction: admin.firestore.Transaction,
    ref: admin.firestore.DocumentReference
  ) => void
) => {
  for (let index = 0; index < refs.length; index += FIRESTORE_BATCH_SIZE) {
    await admin.firestore().runTransaction(async (transaction) => {
      const guard = await transaction.get(guardRef);
      if (!guard.exists) {
        throw new HttpsError(
          "not-found",
          "Custom token template not found."
        );
      }
      if (guard.get("task06Deletion.status") === "pending") {
        throw new HttpsError(
          "failed-precondition",
          "This custom token template is pending deletion."
        );
      }
      refs.slice(
        index,
        index + FIRESTORE_BATCH_SIZE
      ).forEach((ref) => applyRef(transaction, ref));
    });
  }
};

const chunkValues = <Value>(values: Value[], size: number): Value[][] => {
  const output: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
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
    const requesterRef = db.doc(`users/${requesterUid}`);
    const templateRef = db.doc(`grigliata_tokens/${tokenId}`);
    const templateData = await db.runTransaction(async (transaction) => {
      const [requester, template] = await transaction.getAll(
        requesterRef,
        templateRef
      );
      if (
        !requester.exists ||
        requester.get("deletionState") === "pending"
      ) {
        throw new HttpsError(
          "permission-denied",
          "An active user profile is required."
        );
      }
      if (!template.exists) {
        throw new HttpsError(
          "not-found",
          "Custom token template not found."
        );
      }
      if (template.get("task06Deletion.status") === "pending") {
        throw new HttpsError(
          "failed-precondition",
          "This custom token template is pending deletion."
        );
      }
      const data = template.data() || {};
      const ownerUid = asNonEmptyString(data.ownerUid);
      const tokenType = asNonEmptyString(data.tokenType);
      const customTokenRole = asNonEmptyString(data.customTokenRole);
      if (
        !ownerUid ||
        tokenType !== "custom" ||
        customTokenRole === "instance"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Only custom token templates can be updated."
        );
      }
      const isManager = isManagerRole(requester.get("role"));
      if (requesterUid !== ownerUid && !isManager) {
        throw new HttpsError(
          "permission-denied",
          "You can only update your own custom token templates."
        );
      }
      return data;
    });

    const imageUrl = typeof request.data?.imageUrl === "string"
      ? request.data.imageUrl.trim()
      : asNonEmptyString(templateData.imageUrl);
    const imagePath = typeof request.data?.imagePath === "string"
      ? request.data.imagePath.trim()
      : asNonEmptyString(templateData.imagePath);
    const now = FieldValue.serverTimestamp();

    const instanceSnapshots = await db.collection("grigliata_tokens")
      .where("customTemplateId", "==", tokenId)
      .get();
    const instanceRefs = instanceSnapshots.docs
      .filter((docSnap) => docSnap.id !== tokenId)
      .map((docSnap) => docSnap.ref);
    const placementRefs: admin.firestore.DocumentReference[] = [];

    const targetTokenIds = [tokenId, ...instanceRefs.map((ref) => ref.id)];
    for (const tokenIds of chunkValues(targetTokenIds, IN_QUERY_SIZE)) {
      const placementSnap = await db.collection("grigliata_token_placements")
        .where("tokenId", "in", tokenIds)
        .get();
      placementSnap.docs.forEach((docSnap) => {
        placementRefs.push(docSnap.ref);
      });
    }

    await commitGuardedChunks(
      templateRef,
      [templateRef, ...instanceRefs],
      (transaction, ref) => {
        transaction.set(ref, {
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

    await commitGuardedChunks(
      templateRef,
      placementRefs,
      (transaction, ref) => {
        transaction.set(ref, {
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
