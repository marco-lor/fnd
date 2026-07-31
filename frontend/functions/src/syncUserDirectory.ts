import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import {
  buildUserDirectoryProjection,
  planUserDirectoryMutation,
  userDirectoryProjectionDataMatches,
} from "./userDirectoryProjection";
import {reconcileLegacyUserDomains} from "./userDataBridge";
import {
  TASK06_BACKEND_CONFIG_PATH,
  resolveTask06DerivedOwnerMode,
} from "./userDerivedState";

const REGION = "europe-west8";
const USER_DIRECTORY_COLLECTION = "user_directory";

export const syncUserDirectory = onDocumentWritten(
  {
    document: "users/{uid}",
    region: REGION,
  },
  async (event) => {
    if (!event.data) return;

    const beforeData = event.data.before.exists
      ? event.data.before.data()
      : null;
    const afterData = event.data.after.exists
      ? event.data.after.data()
      : null;
    const db = admin.firestore();
    const task06ConfigRef = db.doc(TASK06_BACKEND_CONFIG_PATH);
    const sourceRef = db.collection("users").doc(event.params.uid);
    const targetRef = db.collection(USER_DIRECTORY_COLLECTION)
      .doc(event.params.uid);
    const mutation = planUserDirectoryMutation(beforeData, afterData);

    // Events can be retried or delivered out of order. Resolve the current
    // source and target together so every relevant event converges to the
    // latest source state and retries do not create redundant writes.
    const legacyOwnerActive = mutation.type === "none"
      ? db.runTransaction(async (transaction) => {
        const task06Config = await transaction.get(task06ConfigRef);
        return resolveTask06DerivedOwnerMode(task06Config.data()) !==
          "authoritative";
      })
      : db.runTransaction(async (transaction) => {
      const [task06Config, sourceSnapshot, targetSnapshot] =
        await transaction.getAll(
          task06ConfigRef,
          sourceRef,
          targetRef
        );
      if (
        resolveTask06DerivedOwnerMode(task06Config.data()) ===
        "authoritative"
      ) return false;

      if (!sourceSnapshot.exists) {
        if (targetSnapshot.exists) transaction.delete(targetRef);
        return true;
      }

      const projection = buildUserDirectoryProjection(sourceSnapshot.data());
      if (
        targetSnapshot.exists
        && userDirectoryProjectionDataMatches(targetSnapshot.data(), projection)
      ) return true;

      // Full replacement guarantees that stale or accidentally-added private
      // fields cannot survive a projection refresh.
      transaction.set(targetRef, projection);
      return true;
    });

    if (!await legacyOwnerActive) return;
    const bridgeFence = await task06ConfigRef.get();
    if (
      resolveTask06DerivedOwnerMode(bridgeFence.data()) ===
      "authoritative"
    ) return;
    await reconcileLegacyUserDomains(
      event.params.uid,
      beforeData,
      afterData,
      event.data.after.updateTime
    );
  }
);
