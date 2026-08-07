import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {CallableRequest, HttpsError} from "firebase-functions/v2/https";
import {assertLegacyRootMutationAllowed} from "./legacyRootMutationGate";
import {getTokenGrantForLevel} from "./backendOperationCore";
import {assertActiveCaller} from "./callerAuthorization";

type LevelUpAllLegacyRequest = {
  idempotencyKey?: string;
};

export type LevelUpResult = {
  userId: string;
  characterId?: string;
  fromLevel: number;
  toLevel?: number;
  skipped?: string;
  tokensGranted?: number;
};

export type LevelUpCandidate = {
  userId: string;
  data: admin.firestore.DocumentData;
};

export type PlannedLevelUp = {
  userId: string;
  fromLevel: number;
  toLevel: number;
  tokensGranted: number;
};

export const planLevelUpAllLegacy = (
  candidates: readonly LevelUpCandidate[]
): {results: LevelUpResult[]; updates: PlannedLevelUp[]} => {
  const results: LevelUpResult[] = [];
  const updates: PlannedLevelUp[] = [];
  for (const candidate of candidates) {
    const {userId, data} = candidate;
    const role = data.role || "player";
    const fromLevel = Number(data?.stats?.level) || 1;
    if (role === "dm") {
      results.push({
        userId,
        characterId: data.characterId,
        fromLevel,
        skipped: "DM account",
      });
      continue;
    }
    if (fromLevel >= 10) {
      results.push({
        userId,
        characterId: data.characterId,
        fromLevel,
        skipped: "Already at max level",
      });
      continue;
    }

    const toLevel = fromLevel + 1;
    const tokensGranted = getTokenGrantForLevel(toLevel);
    updates.push({userId, fromLevel, toLevel, tokensGranted});
    results.push({
      userId,
      characterId: data.characterId,
      fromLevel,
      toLevel,
      tokensGranted,
    });
  }
  return {results, updates};
};

const assertDmCaller = (
  caller: admin.firestore.DocumentSnapshot
): void => {
  assertActiveCaller(
    caller,
    "DM profile not found.",
    "DM account is pending deletion."
  );
  if (caller.get("role") !== "dm") {
    throw new HttpsError(
      "permission-denied",
      "Only DMs can level up players."
    );
  }
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
  const callerRef = db.doc(`users/${callerUid}`);
  assertDmCaller(await callerRef.get());

  // Keep the production DMDashboard response contract and origin/main's
  // all-or-nothing commit, but read the users collection outside the
  // transaction. The transaction watches only the caller and rollout fence, so
  // ordinary player writes no longer invalidate its read set.
  const users = await db.collection("users").get();
  const {results, updates} = planLevelUpAllLegacy(users.docs.map((user) => ({
    userId: user.id,
    data: user.data() || {},
  })));
  if (updates.length * 2 > 500) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many users to level up in one atomic operation."
    );
  }

  await db.runTransaction(async (transaction) => {
    const [caller, rollout] = await transaction.getAll(
      callerRef,
      rolloutRef
    );
    assertDmCaller(caller);
    for (const update of updates) {
      assertLegacyRootMutationAllowed(rollout.data(), update.userId);
      const userRef = db.doc(`users/${update.userId}`);
      transaction.update(userRef, {
        "stats.level": update.toLevel,
        "stats.combatTokensAvailable":
          FieldValue.increment(update.tokensGranted),
      });
      transaction.set(userRef.collection("level_events").doc(), {
        from_level: update.fromLevel,
        to_level: update.toLevel,
        tokens_granted: update.tokensGranted,
        timestamp: FieldValue.serverTimestamp(),
      });
    }
  });

  return {ok: true, updated: results};
};
