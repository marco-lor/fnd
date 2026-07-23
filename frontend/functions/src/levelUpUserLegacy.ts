import {CallableRequest, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {assertLegacyRootMutationAllowed} from "./legacyRootMutationGate";
import {isValidFirestoreDocumentId} from "./userDataV2";

export interface LegacyLevelUpUserData {
  userId?: string;
}

const getTokenGrantForLevel = (level: number): number => {
  if (level >= 2 && level <= 4) return 4;
  if (level >= 5 && level <= 7) return 6;
  if (level >= 8 && level <= 10) return 8;
  return 0;
};

/**
 * Compatibility implementation for calls made before Task 06 introduced
 * operation IDs. This retains the original root-document transaction and
 * deliberately creates neither Task-06 state nor an operation receipt.
 */
export const levelUpUserLegacyHandler = async (
  req: CallableRequest<LegacyLevelUpUserData>
): Promise<Record<string, unknown>> => {
  if (!req.auth) {
    throw new HttpsError("unauthenticated", "You must be authenticated.");
  }
  const requestedUserId = req.data?.userId;
  const userId = typeof requestedUserId === "string"
    ? requestedUserId.trim()
    : "";
  if (!isValidFirestoreDocumentId(userId)) {
    throw new HttpsError(
      "invalid-argument",
      "userId must be a single valid document ID."
    );
  }

  const db = admin.firestore();
  const callerRef = db.doc(`users/${req.auth.uid}`);
  const userRef = db.doc(`users/${userId}`);
  const rolloutRef = db.doc("app_config/user_data_v2");
  const result = await db.runTransaction(async (tx) => {
    const [caller, rollout, target] = await tx.getAll(
      callerRef,
      rolloutRef,
      userRef
    );
    if (!caller.exists || caller.get("role") !== "dm") {
      throw new HttpsError(
        "permission-denied",
        "Only DMs can level up players."
      );
    }
    assertLegacyRootMutationAllowed(rollout.data(), userId);
    if (!target.exists) {
      throw new HttpsError("not-found", "Target user not found");
    }
    const targetData = target.data() || {};
    if (targetData.role === "dm") {
      throw new HttpsError(
        "failed-precondition",
        "Cannot level up a DM account"
      );
    }

    const fromLevel = Number(targetData?.stats?.level) || 1;
    if (fromLevel >= 10) {
      return {
        skipped: "Already at max level",
        fromLevel,
        toLevel: fromLevel,
      };
    }
    const toLevel = fromLevel + 1;
    const tokensGranted = getTokenGrantForLevel(toLevel);
    tx.update(userRef, {
      "stats.level": toLevel,
      "stats.combatTokensAvailable":
        admin.firestore.FieldValue.increment(tokensGranted),
    });
    tx.set(userRef.collection("level_events").doc(), {
      from_level: fromLevel,
      to_level: toLevel,
      tokens_granted: tokensGranted,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {fromLevel, toLevel, tokensGranted};
  });

  return {ok: true, userId, ...result};
};
