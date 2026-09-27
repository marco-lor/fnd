import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {assertActiveCaller} from "./callerAuthorization";
import {isValidFirestoreDocumentId} from "./userDataV2";

type UpdateUserRolePayload = {
  userId: string;
  role: string;
};

const REGION = "europe-west8";
const ALLOWED_ROLES = new Set(["player", "dm", "webmaster"]);

const asNonEmptyString = (value: unknown) => (
  typeof value === "string" && value.trim() ? value.trim() : ""
);

const normalizeRole = (value: unknown) => {
  const role = asNonEmptyString(value).toLowerCase();
  return role === "players" ? "player" : role;
};

export const updateUserRole = onCall(
  {region: REGION},
  async (
    request: CallableRequest<UpdateUserRolePayload>
  ): Promise<{ success: boolean; userId: string; role: string }> => {
    const callerUid = asNonEmptyString(request.auth?.uid);
    if (!callerUid) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const targetUserId = asNonEmptyString(request.data?.userId);
    const nextRole = normalizeRole(request.data?.role);
    if (!isValidFirestoreDocumentId(targetUserId) || !ALLOWED_ROLES.has(nextRole)) {
      throw new HttpsError(
        "invalid-argument",
        "A valid userId and role are required."
      );
    }
    if (targetUserId === callerUid) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot change your own role."
      );
    }

    const db = admin.firestore();
    const callerRef = db.doc(`users/${callerUid}`);
    const targetRef = db.doc(`users/${targetUserId}`);
    const auditRef = db.collection("security_audit").doc();

    await db.runTransaction(async (tx) => {
      const [callerSnap, targetSnap, callerJob, targetJob] = await Promise.all([
        tx.get(callerRef),
        tx.get(targetRef),
        tx.get(db.doc(`user_deletion_jobs/${callerUid}`)),
        tx.get(db.doc(`user_deletion_jobs/${targetUserId}`)),
      ]);
      assertActiveCaller(callerSnap);
      if (callerJob.exists) {
        throw new HttpsError("permission-denied", "Caller is pending deletion.");
      }
      if (!callerSnap.exists || callerSnap.get("role") !== "webmaster") {
        throw new HttpsError(
          "permission-denied",
          "Only webmasters can change roles."
        );
      }
      if (!targetSnap.exists) {
        throw new HttpsError("not-found", "Target user not found.");
      }
      if (targetSnap.get("deletionState") === "pending" || targetJob.exists) {
        throw new HttpsError("failed-precondition", "Target is pending deletion.");
      }

      const previousRole = normalizeRole(targetSnap.get("role")) || "player";
      tx.update(targetRef, {
        role: nextRole,
        roleUpdatedAt: FieldValue.serverTimestamp(),
        roleUpdatedBy: callerUid,
      });
      tx.set(auditRef, {
        action: "updateUserRole",
        actorUid: callerUid,
        targetUid: targetUserId,
        previousRole,
        nextRole,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return {success: true, userId: targetUserId, role: nextRole};
  }
);
