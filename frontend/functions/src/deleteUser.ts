// functions/src/deleteUser.ts

import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  collectArchivedOwnedMediaPaths,
  collectOwnedMediaPaths,
} from "./userOwnedMediaCleanup";
import {isValidFirestoreDocumentId} from "./userDataV2";
import {assertActiveCaller} from "./callerAuthorization";

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
    const migrationArchiveRef = db.doc(
      `migration_state/user-data-v2/archives/${userToDeleteUid}`
    );
    const compactionArchiveRef = db.doc(
      "migration_state/user-data-v2/root_compaction_archives/" +
      userToDeleteUid
    );
    let authorizedPendingJob = false;

    try {
      // 3. Authorize and publish the durable deletion fence atomically. A role
      // change must conflict with this transaction instead of allowing a stale
      // pre-transaction role read to authorize a destructive operation.
      const reqUserRef = db.doc(`users/${requestingUserUid}`);
      const initialization = await db.runTransaction(async (transaction) => {
        const [requester, currentTarget, existingJob] =
          await Promise.all([
            transaction.get(reqUserRef),
            transaction.get(targetUserRef),
            transaction.get(jobRef),
          ]);
        assertActiveCaller(
          requester,
          "Requesting user not found.",
          "Requesting user is pending deletion."
        );
        if (requester.get("role") !== "webmaster") {
          throw new HttpsError(
            "permission-denied",
            "Only webmasters can delete users."
          );
        }
        if (existingJob.get("stage") === "completed") return "completed";
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
      // Task 05 archives live outside users/{uid}. Inspect both generations
      // before deleting them, including media removed from authoritative V2.
      const [compactionArchiveFields, migrationArchiveDomains] =
        await Promise.all([
          compactionArchiveRef.collection("root_fields").get(),
          migrationArchiveRef.collection("domains").get(),
        ]);
      collectArchivedOwnedMediaPaths(userToDeleteUid, {
        rootFields: compactionArchiveFields.docs.map((snapshot) => ({
          field: snapshot.get("field"),
          value: snapshot.get("value"),
        })),
        migrationDomains: migrationArchiveDomains.docs.map((snapshot) => ({
          domain: snapshot.get("domain"),
          payload: snapshot.get("payload"),
        })),
      }).forEach((path) => legacyOwnedPaths.add(path));
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
      // so completion does not depend on trigger delivery. Task 05 migration
      // and physical-compaction archives contain full historical user data
      // outside users/{uid}; they share the deletion fence and must not outlive
      // an account deletion.
      const directoryRef = db.doc(`user_directory/${userToDeleteUid}`);
      const migrationArchiveRefs = [
        migrationArchiveRef,
        compactionArchiveRef,
      ];
      const deleteAndVerifyFirestore = async (): Promise<void> => {
        await Promise.all([
          db.recursiveDelete(targetUserRef),
          ...migrationArchiveRefs.map((archiveRef) => (
            db.recursiveDelete(archiveRef)
          )),
        ]);
        await directoryRef.delete();
        const [remainingUser, remainingDirectory, ...remainingArchives] =
          await db.getAll(
            targetUserRef,
            directoryRef,
            ...migrationArchiveRefs
          );
        const remainingCollections = await Promise.all([
          targetUserRef.listCollections(),
          ...migrationArchiveRefs.map((archiveRef) => (
            archiveRef.listCollections()
          )),
        ]);
        if (
          remainingUser.exists ||
          remainingDirectory.exists ||
          remainingArchives.some((snapshot) => snapshot.exists) ||
          remainingCollections.some((collections) => collections.length)
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
