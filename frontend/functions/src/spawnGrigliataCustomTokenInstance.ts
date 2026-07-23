import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

type SpawnGrigliataCustomTokenInstancePayload = {
  templateTokenId: string;
  backgroundId: string;
  col: number;
  row: number;
};

const REGION = "europe-west1";

const asNonEmptyString = (value: unknown) => (
  typeof value === "string" && value.trim() ? value.trim() : ""
);

const asInteger = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : null;
};

const isManagerRole = (role: unknown) => asNonEmptyString(role).toLowerCase() === "dm";

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

const normalizeNonNegativeNumber = (value: unknown, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, numericValue);
};

const normalizeCustomStats = (value: unknown) => {
  const stats = value && typeof value === "object" && !Array.isArray(value)
    ? deepClone(value as Record<string, unknown>)
    : {};

  const hpCurrent = normalizeNonNegativeNumber((stats as Record<string, unknown>).hpCurrent, 0);
  const manaCurrent = normalizeNonNegativeNumber((stats as Record<string, unknown>).manaCurrent, 0);
  const shieldCurrent = normalizeNonNegativeNumber((stats as Record<string, unknown>).shieldCurrent, 0);

  return {
    ...stats,
    hpCurrent,
    hpTotal: normalizeNonNegativeNumber((stats as Record<string, unknown>).hpTotal, hpCurrent),
    manaCurrent,
    manaTotal: normalizeNonNegativeNumber((stats as Record<string, unknown>).manaTotal, manaCurrent),
    shieldCurrent,
    shieldTotal: normalizeNonNegativeNumber((stats as Record<string, unknown>).shieldTotal, shieldCurrent),
  };
};

export const spawnGrigliataCustomTokenInstance = onCall<SpawnGrigliataCustomTokenInstancePayload>(
  {region: REGION},
  async (request) => {
    const requesterUid = asNonEmptyString(request.auth?.uid);
    if (!requesterUid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const templateTokenId = asNonEmptyString(request.data?.templateTokenId);
    const backgroundId = asNonEmptyString(request.data?.backgroundId);
    const col = asInteger(request.data?.col);
    const row = asInteger(request.data?.row);

    if (!templateTokenId || !backgroundId || col === null || row === null) {
      throw new HttpsError("invalid-argument", "templateTokenId, backgroundId, col, and row are required.");
    }

    const db = admin.firestore();
    const requesterRef = db.doc(`users/${requesterUid}`);
    const templateRef = db.doc(`grigliata_tokens/${templateTokenId}`);
    const tokenRef = db.collection("grigliata_tokens").doc();
    const placementId = `${backgroundId}__${tokenRef.id}`;
    const placementRef = db.doc(`grigliata_token_placements/${placementId}`);
    await db.runTransaction(async (transaction) => {
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
      const templateData = template.data() || {};
      const ownerUid = asNonEmptyString(templateData.ownerUid);
      const tokenType = asNonEmptyString(templateData.tokenType);
      const customTokenRole = asNonEmptyString(
        templateData.customTokenRole
      );
      if (
        !ownerUid ||
        tokenType !== "custom" ||
        customTokenRole === "instance"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Only custom token templates can be spawned."
        );
      }
      const isManager = isManagerRole(requester.get("role"));
      if (requesterUid !== ownerUid && !isManager) {
        throw new HttpsError(
          "permission-denied",
          "You can only spawn your own custom token templates."
        );
      }
      const now = FieldValue.serverTimestamp();
      const label = asNonEmptyString(templateData.label) ||
        "Custom Token";
      const imageUrl = asNonEmptyString(templateData.imageUrl);
      transaction.create(tokenRef, {
        ownerUid,
        characterId: asNonEmptyString(templateData.characterId),
        label,
        imageUrl,
        imagePath: asNonEmptyString(templateData.imagePath),
        tokenType: "custom",
        customTokenRole: "instance",
        customTemplateId: templateTokenId,
        imageSource: "uploaded",
        notes: asNonEmptyString(templateData.notes),
        stats: normalizeCustomStats(templateData.stats),
        createdAt: now,
        createdBy: requesterUid,
        updatedAt: now,
        updatedBy: requesterUid,
      });
      transaction.create(placementRef, {
        backgroundId,
        tokenId: tokenRef.id,
        ownerUid,
        label,
        imageUrl,
        col,
        row,
        isVisibleToPlayers: true,
        isDead: false,
        statuses: [],
        updatedAt: now,
        updatedBy: requesterUid,
      });
    });

    return {
      success: true,
      tokenId: tokenRef.id,
      placementId,
      templateTokenId,
    };
  }
);
