import * as admin from "firebase-admin";
import {HttpsError} from "firebase-functions/v2/https";

type CallerSnapshot = Pick<
  admin.firestore.DocumentSnapshot,
  "exists" | "get"
>;

/**
 * Rejects profiles whose credentials may still be valid while account
 * deletion is in progress. Role checks must run only after this assertion.
 */
export const assertActiveCaller = (
  snapshot: CallerSnapshot,
  missingMessage = "Caller profile missing.",
  pendingMessage = "Caller account is pending deletion."
): void => {
  if (!snapshot.exists) {
    throw new HttpsError("permission-denied", missingMessage);
  }
  if (snapshot.get("deletionState") === "pending") {
    throw new HttpsError("permission-denied", pendingMessage);
  }
};
