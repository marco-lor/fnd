import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {CallableRequest, HttpsError} from "firebase-functions/v2/https";
import {assertLegacyRootMutationAllowed} from "./legacyRootMutationGate";
import {getTokenGrantForLevel} from "./backendOperationCore";

type LevelUpAllLegacyRequest = {
  idempotencyKey?: string;
};

type LevelUpResult = {
  userId: string;
  characterId?: string;
  fromLevel: number;
  toLevel?: number;
  skipped?: string;
  tokensGranted?: number;
};

export const levelUpAllLegacyHandler = async (
  request: CallableRequest<LevelUpAllLegacyRequest>
): Promise<Record<string, unknown>> => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be authenticated."
    );
  }
  const db = admin.firestore();
  const callerUid = request.auth.uid;
  const rolloutRef = db.doc("app_config/user_data_v2");
  const results = await db.runTransaction(async (transaction) => {
    const rollout = await transaction.get(rolloutRef);
    const users = await transaction.get(db.collection("users"));
    const caller = users.docs.find(
      (snapshot) => snapshot.id === callerUid
    );
    if (!caller || caller.get("role") !== "dm") {
      throw new HttpsError(
        "permission-denied",
        "Only DMs can level up players."
      );
    }

    const nextResults: LevelUpResult[] = [];
    let plannedWrites = 0;
    for (const user of users.docs) {
      const uid = user.id;
      const data = user.data() || {};
      const role = data.role || "player";
      const fromLevel = Number(data?.stats?.level) || 1;
      if (role === "dm") {
        nextResults.push({
          userId: uid,
          characterId: data.characterId,
          fromLevel,
          skipped: "DM account",
        });
        continue;
      }
      if (fromLevel >= 10) {
        nextResults.push({
          userId: uid,
          characterId: data.characterId,
          fromLevel,
          skipped: "Already at max level",
        });
        continue;
      }

      assertLegacyRootMutationAllowed(rollout.data(), uid);
      plannedWrites += 2;
      if (plannedWrites > 500) {
        throw new HttpsError(
          "resource-exhausted",
          "Too many users to level up in one atomic operation."
        );
      }
      const toLevel = fromLevel + 1;
      const tokensGranted = getTokenGrantForLevel(toLevel);
      transaction.update(user.ref, {
        "stats.level": toLevel,
        "stats.combatTokensAvailable":
          FieldValue.increment(tokensGranted),
      });
      transaction.set(user.ref.collection("level_events").doc(), {
        from_level: fromLevel,
        to_level: toLevel,
        tokens_granted: tokensGranted,
        timestamp: FieldValue.serverTimestamp(),
      });
      nextResults.push({
        userId: uid,
        characterId: data.characterId,
        fromLevel,
        toLevel,
        tokensGranted,
      });
    }
    return nextResults;
  });

  return {ok: true, updated: results};
};
