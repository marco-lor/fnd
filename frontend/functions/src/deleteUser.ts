// functions/src/deleteUser.ts

import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {collectOwnedMediaPaths} from "./userOwnedMediaCleanup";
import {legacyRootMutationBlockReason} from "./legacyRootMutationGate";
import {isValidFirestoreDocumentId} from "./userDataV2";

// Do NOT call admin.initializeApp() here; it is already done in index.ts.

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
    const userToDeleteUid = typeof data.userId === "string"
      ? data.userId.trim()
      : "";
    if (!isValidFirestoreDocumentId(userToDeleteUid)) {
      throw new HttpsError(
        "invalid-argument",
        "A valid userId must be provided."
      );
    }

    const db = admin.firestore();
    const jobRef = db.doc(`user_deletion_jobs/${userToDeleteUid}`);
    const targetUserRef = db.doc(`users/${userToDeleteUid}`);
    const rolloutRef = db.doc("app_config/user_data_v2");
    let authorizedPendingJob = false;

    try {
      // 3. Authorize and publish the durable deletion fence atomically. A role
      // change must conflict with this transaction instead of allowing a stale
      // pre-transaction role read to authorize a destructive operation.
      const reqUserRef = db.doc(`users/${requestingUserUid}`);
      const initialization = await db.runTransaction(async (transaction) => {
        const [requester, rollout, currentTarget, existingJob] =
          await Promise.all([
            transaction.get(reqUserRef),
            transaction.get(rolloutRef),
            transaction.get(targetUserRef),
            transaction.get(jobRef),
          ]);
        if (!requester.exists || requester.get("role") !== "webmaster") {
          throw new HttpsError(
            "permission-denied",
            "Only webmasters can delete users."
          );
        }
        if (existingJob.get("stage") === "completed") return "completed";
        if (legacyRootMutationBlockReason(
          rollout.data(),
          userToDeleteUid
        ) === "legacy-drain") {
          throw new HttpsError(
            "unavailable",
            "User deletion is paused for the legacy drain. Retry later."
          );
        }
        const existingCreatedAt = existingJob.get("createdAt");
        transaction.set(jobRef, {
          schemaVersion: 2,
          targetUid: userToDeleteUid,
          requestedBy: requestingUserUid,
          stage: "pending",
          attempts: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: existingJob.exists && existingCreatedAt
            ? existingCreatedAt
            : admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        if (currentTarget.exists) {
          transaction.update(targetUserRef, {
            deletionState: "pending",
            deletionRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
            deletionRequestedBy: requestingUserUid,
          });
        }
        return "pending";
      });
      if (initialization === "completed") {
        return {success: true, message: "User successfully deleted."};
      }
      authorizedPendingJob = true;

      // 4. Disable sign-in and revoke refresh tokens immediately after the
      // Firestore tombstone. Rules also consult the tombstone, because already
      // issued ID tokens can outlive this Auth-side operation.
      try {
        await admin.auth().updateUser(userToDeleteUid, {disabled: true});
        await admin.auth().revokeRefreshTokens(userToDeleteUid);
      } catch (authErr: any) {
        if (authErr?.code !== "auth/user-not-found") throw authErr;
      }
      await jobRef.set({
        stage: "auth-disabled",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      // 5. Remove only canonical user-owned media and a verified legacy
      // profile image. Shared catalog media is never addressed here.
      const fencedTargetUserSnap = await targetUserRef.get();
      const legacyOwnedPaths = new Set<string>();
      if (fencedTargetUserSnap.exists) {
        const rootData = fencedTargetUserSnap.data() ?? {};
        [
          {scope: "profile" as const, value: rootData},
          {scope: "inventory" as const, value: rootData.inventory},
          {scope: "spells" as const, value: rootData.spells},
          {scope: "tecniche" as const, value: rootData.tecniche},
        ].forEach(({scope, value}) => collectOwnedMediaPaths(
          value,
          userToDeleteUid,
          scope,
          scope === "profile" ? "profile" : "legacy-root"
        ).forEach((path) => legacyOwnedPaths.add(path)));
      }
      const descendantMedia = await Promise.all([
        targetUserRef.collection("inventory").get(),
        targetUserRef.collection("spells").get(),
        targetUserRef.collection("tecniche").get(),
      ]);
      (["inventory", "spells", "tecniche"] as const).forEach(
        (scope, collectionIndex) => descendantMedia[collectionIndex].docs
          .forEach((snapshot) => collectOwnedMediaPaths(
            snapshot.data(),
            userToDeleteUid,
            scope,
            snapshot.id
          ).forEach((path) => legacyOwnedPaths.add(path)))
      );
      const bucket = admin.storage().bucket();
      const deleteAndVerifyOwnedMedia = async (): Promise<void> => {
        await bucket.deleteFiles({prefix: `users/${userToDeleteUid}/`});
        await Promise.all([...legacyOwnedPaths].map((path) => (
          bucket.file(path).delete({ignoreNotFound: true})
        )));
        const [remainingOwnedFiles] = await bucket.getFiles({
          prefix: `users/${userToDeleteUid}/`,
          maxResults: 1,
        });
        const legacyExists = await Promise.all([...legacyOwnedPaths].map(
          async (path) => (await bucket.file(path).exists())[0]
        ));
        if (remainingOwnedFiles.length || legacyExists.some(Boolean)) {
          throw new Error("owned-media-cleanup-not-verified");
        }
      };
      await deleteAndVerifyOwnedMedia();
      await jobRef.set({
        stage: "media-verified",
        mediaDeletionVerified: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      // 6. Recursive deletion includes every current and future user
      // subcollection. The public directory projection is removed explicitly
      // so completion does not depend on trigger delivery.
      const directoryRef = db.doc(`user_directory/${userToDeleteUid}`);
      const deleteAndVerifyFirestore = async (): Promise<void> => {
        await db.recursiveDelete(targetUserRef);
        await directoryRef.delete();
        const [remainingUser, remainingDirectory] = await db.getAll(
          targetUserRef,
          directoryRef
        );
        const remainingUserCollections = await targetUserRef.listCollections();
        if (
          remainingUser.exists ||
          remainingDirectory.exists ||
          remainingUserCollections.length
        ) {
          throw new Error("firestore-cleanup-not-verified");
        }
      };
      await deleteAndVerifyFirestore();
      await jobRef.set({
        stage: "firestore-verified",
        firestoreDeletionVerified: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      // 7. Delete the Auth record only after the first verified cleanup.
      try {
        await admin.auth().deleteUser(userToDeleteUid);
      } catch (authErr: any) {
        if (authErr?.code !== "auth/user-not-found") throw authErr;
      }

      // 8. Perform one final destructive sweep and verification after Auth
      // removal. The durable job tombstone remains present throughout, so
      // rules reject root recreation and every owner write while this runs.
      await deleteAndVerifyOwnedMedia();
      await deleteAndVerifyFirestore();
      await jobRef.set({
        stage: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      return {success: true, message: "User successfully deleted."};
    } catch (err: any) {
      console.error("Error deleting user:", err);
      if (err instanceof HttpsError && err.code === "unavailable") {
        throw err;
      }
      if (authorizedPendingJob) {
        await db.runTransaction(async (transaction) => {
          const job = await transaction.get(jobRef);
          if (!job.exists || job.get("stage") === "completed") return;
          transaction.set(jobRef, {
            stage: "failed",
            lastErrorCode: typeof err?.code === "string" ? err.code : "internal",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
        }).catch(() => undefined);
      }
      // eslint-disable-next-line max-len
      // If it is already an HttpsError, rethrow it so the client sees the proper code.
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
