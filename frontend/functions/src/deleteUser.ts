// functions/src/deleteUser.ts

import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Do NOT call admin.initializeApp() here — it’s already been done in index.ts

/**
 * Callable Cloud Function to delete a user and their Firestore document.
 * Only users with the "webmaster" role may delete other users.
 */
export const deleteUser = onCall(
  {region: "europe-west8"},
  async (
    request: CallableRequest<{ userId: string }>
  ): Promise<{ success: boolean; message: string }> => {
    const {auth, data} = request;

    // 1. Authentication
    if (!auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const requestingUserUid = auth.uid;

    // 2. Validate argument
    const userToDeleteUid = data.userId;
    if (!userToDeleteUid || typeof userToDeleteUid !== "string") {
      throw new HttpsError(
        "invalid-argument",
        "A valid “userId” must be provided."
      );
    }

    try {
      // 3. Load requesting user’s Firestore doc
      const reqUserRef = admin.firestore().doc(`users/${requestingUserUid}`);
      const reqUserSnap = await reqUserRef.get();
      if (!reqUserSnap.exists) {
        throw new HttpsError("permission-denied", "Requesting user not found.");
      }
      const reqUserData = reqUserSnap.data();
      if (reqUserData?.role !== "webmaster") {
        throw new HttpsError(
          "permission-denied",
          "Only webmasters can delete users."
        );
      }

      // 4. Delete target user’s Firestore document (if it exists)
      const targetUserRef = admin.firestore().doc(`users/${userToDeleteUid}`);
      const targetUserSnap = await targetUserRef.get();
      if (targetUserSnap.exists) {
        await targetUserRef.delete();
      }

      // 5. Delete from Firebase Auth
      await admin.auth().deleteUser(userToDeleteUid);

      return {success: true, message: "User successfully deleted."};
    } catch (err: any) {
      console.error("Error deleting user:", err);
      // eslint-disable-next-line max-len
      // If it’s already an HttpsError, rethrow it so the client sees the proper code
      if (err instanceof HttpsError) {
        throw err;
      }
      // Otherwise wrap it in an internal error
      throw new HttpsError(
        "internal",
        "Failed to delete user. Check function logs for details.",
        {originalError: err.message}
      );
    }
  }
);
