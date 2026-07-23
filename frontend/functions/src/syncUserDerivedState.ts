import * as admin from "firebase-admin";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {legacyRootMutationBlockReason} from "./legacyRootMutationGate";
import {reconcileLegacyUserDomains} from "./userDataBridge";
import {
  TASK06_BACKEND_CONFIG_PATH,
  classifyUserDerivedChange,
  planUserDerivedState,
  resolveTask06DerivedOwnerMode,
} from "./userDerivedState";
import {
  buildUserDirectoryProjection,
  userDirectoryProjectionDataMatches,
} from "./userDirectoryProjection";
import {hashValue} from "./userDataV2";

const REGION = "europe-west8";
const USER_DATA_CONFIG_PATH = "app_config/user_data_v2";
const UTILS_PATH = "utils/varie";
const USER_DIRECTORY_COLLECTION = "user_directory";

const recordShadowParity = (input: {
  uid: string;
  rootUpdate: Record<string, unknown>;
  directoryAction: string;
  needsUtils: boolean;
}): void => {
  console.log("Task06 derived-state shadow parity", {
    userKey: hashValue(input.uid).slice(0, 12),
    rootFieldCount: Object.keys(input.rootUpdate).length,
    rootPlanHash: hashValue(input.rootUpdate).slice(0, 16),
    directoryAction: input.directoryAction,
    needsUtils: input.needsUtils,
  });
};

export const syncUserDerivedState = onDocumentWritten(
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

    // Classify the event before reading either control document or utils.
    const eventClassification = classifyUserDerivedChange(
      beforeData,
      afterData
    );
    if (!eventClassification.sourceChanged) return;

    const db = admin.firestore();
    const task06ConfigRef = db.doc(TASK06_BACKEND_CONFIG_PATH);
    const initialTask06Config = await task06ConfigRef.get();
    const initialMode = resolveTask06DerivedOwnerMode(
      initialTask06Config.data()
    );
    if (initialMode === "legacy") return;

    if (initialMode === "shadow") {
      const utils = eventClassification.needsUtils
        ? (await db.doc(UTILS_PATH).get()).data()
        : undefined;
      const plan = planUserDerivedState({
        beforeData,
        afterData,
        utils,
      });
      recordShadowParity({
        uid: event.params.uid,
        rootUpdate: plan.rootUpdate,
        directoryAction: plan.directoryMutation.type,
        needsUtils: plan.classification.needsUtils,
      });
      return;
    }

    const userRef = db.doc(`users/${event.params.uid}`);
    const directoryRef = db.collection(USER_DIRECTORY_COLLECTION)
      .doc(event.params.uid);
    const task05ConfigRef = db.doc(USER_DATA_CONFIG_PATH);
    const utilsRef = db.doc(UTILS_PATH);
    const outcome = await db.runTransaction(async (transaction) => {
      const [task06Config, task05Config, source, directory] =
        await transaction.getAll(
          task06ConfigRef,
          task05ConfigRef,
          userRef,
          directoryRef
        );
      if (
        resolveTask06DerivedOwnerMode(task06Config.data()) !==
        "authoritative"
      ) {
        return {active: false, rootWrite: false, directoryWrite: false};
      }

      if (!source.exists) {
        if (directory.exists) transaction.delete(directoryRef);
        return {
          active: true,
          rootWrite: false,
          directoryWrite: directory.exists,
        };
      }

      const currentSource = source.data() ?? {};
      const latestClassification = classifyUserDerivedChange(
        beforeData,
        currentSource
      );
      const utils = latestClassification.needsUtils
        ? (await transaction.get(utilsRef)).data()
        : undefined;
      const plan = planUserDerivedState({
        beforeData,
        afterData: currentSource,
        utils,
      });
      const rootUpdateAllowed = (
        source.get("deletionState") !== "pending" &&
        !legacyRootMutationBlockReason(
          task05Config.data(),
          event.params.uid
        )
      );
      const rootWrite = rootUpdateAllowed &&
        Object.keys(plan.rootUpdate).length > 0;
      if (rootWrite) {
        transaction.update(
          userRef,
          plan.rootUpdate as admin.firestore.UpdateData<
            admin.firestore.DocumentData
          >
        );
      }

      const projection = buildUserDirectoryProjection(currentSource);
      const directoryWrite = !directory.exists ||
        !userDirectoryProjectionDataMatches(directory.data(), projection);
      if (directoryWrite) {
        // Full replacement prevents stale private fields from surviving.
        transaction.set(directoryRef, projection);
      }
      return {active: true, rootWrite, directoryWrite};
    });

    if (!outcome.active) return;

    // The bridge performs its own source hash, rollout-stage, drain, deletion,
    // and event-time checks and always projects the latest root snapshot.
    await reconcileLegacyUserDomains(
      event.params.uid,
      beforeData,
      afterData,
      event.data.after.updateTime
    );
  }
);
