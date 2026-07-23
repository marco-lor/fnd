import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import {
  buildUserDirectoryProjection,
  planUserDirectoryMutation,
  userDirectoryProjectionDataMatches,
} from "./userDirectoryProjection";
import {reconcileLegacyUserDomains} from "./userDataBridge";

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
    const sourceRef = db.collection("users").doc(event.params.uid);
    const targetRef = db.collection(USER_DIRECTORY_COLLECTION)
      .doc(event.params.uid);
    const mutation = planUserDirectoryMutation(beforeData, afterData);

    // Events can be retried or delivered out of order. Resolve the current
    // source and target together so every relevant event converges to the
    // latest source state and retries do not create redundant writes.
    const syncDirectory = mutation.type === "none"
      ? Promise.resolve()
      : db.runTransaction(async (transaction) => {
      const [sourceSnapshot, targetSnapshot] = await Promise.all([
        transaction.get(sourceRef),
        transaction.get(targetRef),
      ]);

      if (!sourceSnapshot.exists) {
        if (targetSnapshot.exists) transaction.delete(targetRef);
        return;
      }

      const projection = buildUserDirectoryProjection(sourceSnapshot.data());
      if (
        targetSnapshot.exists
        && userDirectoryProjectionDataMatches(targetSnapshot.data(), projection)
      ) return;

      // Full replacement guarantees that stale or accidentally-added private
      // fields cannot survive a projection refresh.
      transaction.set(targetRef, projection);
    });

    await Promise.all([
      syncDirectory,
      reconcileLegacyUserDomains(
        event.params.uid,
        beforeData,
        afterData,
        event.data.after.updateTime
      ),
    ]);
  }
);
