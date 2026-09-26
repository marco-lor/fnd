// functions/src/deleteUser.ts

import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  collectArchivedOwnedMediaPaths,
  collectOwnedMediaPaths,
} from "./userOwnedMediaCleanup";
import {isValidFirestoreDocumentId} from "./userDataV2";
import {claimUserDeletion, drainDeletionWork} from "./userDeletionOperation";

// Do NOT call admin.initializeApp() here; it is already done in index.ts.

/**
 * Callable Cloud Function to delete a user and their Firestore document.
 * Only users with the "webmaster" role may delete other users.
 */
export const deleteUserHandler = async (
    request: CallableRequest<{ userId?: string; operationId?: string }>
  ): Promise<Record<string, unknown>> => {
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
    const userToDeleteUid = typeof data?.userId === "string"
      ? data.userId.trim()
      : "";
    if (!isValidFirestoreDocumentId(userToDeleteUid)) {
      throw new HttpsError(
        "invalid-argument",
        "A valid userId must be provided."
      );
    }

    const db = admin.firestore();
    const targetUserRef = db.doc(`users/${userToDeleteUid}`);
    const migrationArchiveRef = db.doc(
      `migration_state/user-data-v2/archives/${userToDeleteUid}`
    );
    const compactionArchiveRef = db.doc(
      "migration_state/user-data-v2/root_compaction_archives/" +
      userToDeleteUid
    );
    let runner: Awaited<ReturnType<typeof claimUserDeletion>> | null = null;
    let completedSteps = 0;

    try {
      runner = await claimUserDeletion(
        db, requestingUserUid, userToDeleteUid, data?.operationId
      );
      if (!runner.run) {
        return runner.operation ? {operation: runner.operation,
          success: runner.operation.status === "completed",
          message: "User deletion status."} :
          {success: true, message: "User successfully deleted."};
      }
      await runner.assertLease();
      const step = runner.step;
      // 4. Disable sign-in and revoke refresh tokens immediately after the
      // Firestore tombstone. Rules also consult the tombstone, because already
      // issued ID tokens can outlive this Auth-side operation.
      try {
        await step(() => admin.auth().updateUser(userToDeleteUid, {disabled: true}));
        await step(() => admin.auth().revokeRefreshTokens(userToDeleteUid));
      } catch (authErr: any) {
        if (authErr?.code !== "auth/user-not-found") throw authErr;
      }
      await runner.progress("auth-disabled", ++completedSteps);
      await runner.assertLease();

      // 5. Remove only canonical user-owned media and a verified legacy
      // profile image. Shared catalog media is never addressed here.
      const fencedTargetUserSnap = await step(() => targetUserRef.get());
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
      const descendantMedia = await step(() => drainDeletionWork([
        targetUserRef.collection("inventory").get(),
        targetUserRef.collection("spells").get(),
        targetUserRef.collection("tecniche").get(),
      ]));
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
        await step(() => drainDeletionWork([
          compactionArchiveRef.collection("root_fields").get(),
          migrationArchiveRef.collection("domains").get(),
        ]));
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
        await step(() => bucket.deleteFiles({prefix: `users/${userToDeleteUid}/`}));
        await step(() => drainDeletionWork([...legacyOwnedPaths].map((path) => (
          bucket.file(path).delete({ignoreNotFound: true})
        ))));
        const [remainingOwnedFiles] = await step(() => bucket.getFiles({
          prefix: `users/${userToDeleteUid}/`,
          maxResults: 1,
        }));
        const legacyExists = await step(() => drainDeletionWork([...legacyOwnedPaths].map(
          async (path) => (await bucket.file(path).exists())[0]
        )));
        if (remainingOwnedFiles.length || legacyExists.some(Boolean)) {
          throw new Error("owned-media-cleanup-not-verified");
        }
      };
      await deleteAndVerifyOwnedMedia();
      await runner.progress("media-verified", ++completedSteps, {
        mediaDeletionVerified: true,
      });
      await runner.assertLease();

      // 6. Recursive deletion includes every current and future user
      // subcollection. The public directory projection is removed explicitly
      // so completion does not depend on trigger delivery. Task 05 migration
      // and physical-compaction archives contain full historical user data
      // outside users/{uid}; they share the deletion fence and must not outlive
      // an account deletion.
      const directoryRef = db.doc(`user_directory/${userToDeleteUid}`);
      const managerSummaryRef = db.doc(`manager_user_summaries/${userToDeleteUid}`);
      const migrationArchiveRefs = [
        migrationArchiveRef,
        compactionArchiveRef,
      ];
      const deleteAndVerifyFirestore = async (): Promise<void> => {
        await step(() => drainDeletionWork([
          db.recursiveDelete(targetUserRef),
          ...migrationArchiveRefs.map((archiveRef) => (
            db.recursiveDelete(archiveRef)
          )),
        ]));
        await step(() => directoryRef.delete());
        await step(() => managerSummaryRef.delete());
        const [remainingUser, remainingDirectory, ...remainingArchives] =
          await step(() => db.getAll(
            targetUserRef,
            directoryRef,
            managerSummaryRef,
            ...migrationArchiveRefs
          ));
        const remainingCollections = await step(() => drainDeletionWork([
          targetUserRef.listCollections(),
          ...migrationArchiveRefs.map((archiveRef) => (
            archiveRef.listCollections()
          )),
        ]));
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
      await runner.progress("firestore-verified", ++completedSteps, {
        firestoreDeletionVerified: true,
      });
      await runner.assertLease();

      // 7. Delete the Auth record only after the first verified cleanup.
      try {
        await step(() => admin.auth().deleteUser(userToDeleteUid));
      } catch (authErr: any) {
        if (authErr?.code !== "auth/user-not-found") throw authErr;
      }

      await runner.progress("auth-deleted", ++completedSteps);
      await runner.assertLease();
      // 8. Perform one final destructive sweep and verification after Auth
      // removal. The durable job tombstone remains present throughout, so
      // rules reject root recreation and every owner write while this runs.
      await deleteAndVerifyOwnedMedia();
      await deleteAndVerifyFirestore();
      await runner.progress("completed", ++completedSteps);
      const operation = await runner.view();
      return {success: true, message: "User successfully deleted.",
        ...(operation ? {operation} : {})};
    } catch (err: any) {
      console.error("Error deleting user:", err);
      if (err instanceof HttpsError && err.code === "unavailable") {
        throw err;
      }
      if (runner?.run) {
        await runner.progress("failed", completedSteps, {
          lastErrorCode: typeof err?.code === "string" ? err.code : "internal",
          errorClass: "deletion-incomplete",
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
};
export const deleteUser = onCall(
  {region: "europe-west8", timeoutSeconds: 60}, deleteUserHandler
);
