import * as admin from "firebase-admin";
import {HttpsError} from "firebase-functions/v2/https";
import {
  hashValue,
  resolveUserDataRolloutStage,
} from "./userDataV2";
import {isUserDataLegacyDrainFrozen} from "./userDataBridge";
import {
  TASK06_BACKEND_CONFIG_PATH,
  resolveTask06DerivedOwnerMode,
} from "./userDerivedState";

const MODE_DOCUMENT = "app_config/user_data_v2";

export type LegacyRootMutationBlockReason =
  | "legacy-drain"
  | "new-only"
  | null;

export const legacyRootMutationBlockReason = (
  config: unknown,
  uid: string
): LegacyRootMutationBlockReason => {
  if (isUserDataLegacyDrainFrozen(config, uid)) return "legacy-drain";
  return resolveUserDataRolloutStage(config, uid) === "new-only"
    ? "new-only"
    : null;
};

export const assertLegacyRootMutationAllowed = (
  config: unknown,
  uid: string
): void => {
  const reason = legacyRootMutationBlockReason(config, uid);
  if (reason === "legacy-drain") {
    throw new HttpsError(
      "unavailable",
      "User data is temporarily frozen for the legacy drain. Retry later."
    );
  }
  if (reason === "new-only") {
    throw new HttpsError(
      "failed-precondition",
      "This legacy mutation is disabled after the user-data cutover."
    );
  }
};

type TriggerUpdateData = admin.firestore.UpdateData<
  admin.firestore.DocumentData
>;

export interface LegacyRootTriggerUpdate {
  uid: string;
  expectedFields: Record<string, unknown>;
  update?: TriggerUpdateData;
  buildUpdate?: (
    currentSource: admin.firestore.DocumentData
  ) => TriggerUpdateData | null;
  label: string;
}

export type LegacyRootTriggerUpdateResult =
  | "applied"
  | "blocked"
  | "missing"
  | "stale"
  | "unchanged";

/**
 * Applies an old root-derived trigger write only while the effective rollout
 * still permits legacy mutations. The config and source are read in the same
 * transaction as the update, so installing a drain/new-only fence forces a
 * retry that skips instead of committing after the cutoff. Source field hashes
 * also prevent delayed trigger delivery from overwriting newer root state.
 */
export const applyLegacyRootTriggerUpdate = async (
  input: LegacyRootTriggerUpdate
): Promise<LegacyRootTriggerUpdateResult> => {
  const db = admin.firestore();
  const configRef = db.doc(MODE_DOCUMENT);
  const task06ConfigRef = db.doc(TASK06_BACKEND_CONFIG_PATH);
  const userRef = db.doc(`users/${input.uid}`);
  return db.runTransaction(async (transaction) => {
    const [config, task06Config, user] = await transaction.getAll(
      configRef,
      task06ConfigRef,
      userRef
    );
    if (
      resolveTask06DerivedOwnerMode(task06Config.data()) ===
      "authoritative"
    ) {
      console.log(`${input.label}: skipped by Task 06 derived owner`, {
        userKey: hashValue(input.uid).slice(0, 12),
      });
      return "blocked";
    }
    if (legacyRootMutationBlockReason(config.data(), input.uid)) {
      console.log(`${input.label}: skipped by Task 05 legacy-root fence`, {
        userKey: hashValue(input.uid).slice(0, 12),
      });
      return "blocked";
    }
    if (!user.exists || user.get("deletionState") === "pending") {
      return "missing";
    }
    const stale = Object.entries(input.expectedFields).some(
      ([field, value]) => hashValue(user.get(field)) !== hashValue(value)
    );
    if (stale) return "stale";
    const update = input.buildUpdate
      ? input.buildUpdate(user.data() ?? {})
      : input.update;
    if (!update || !Object.keys(update).length) return "unchanged";
    transaction.update(userRef, update);
    return "applied";
  });
};
