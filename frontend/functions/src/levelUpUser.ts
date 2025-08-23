import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

type Request = { userId: string };

const REGION = "europe-west8";

const getTokenGrantForLevel = (level: number): number => {
  if (level >= 2 && level <= 4) return 4;
  if (level >= 5 && level <= 7) return 6;
  if (level >= 8 && level <= 10) return 8;
  return 0;
};

export const levelUpUser = onCall({ region: REGION }, async (req: CallableRequest<Request>) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "You must be authenticated.");
  const { userId } = req.data || ({} as Request);
  if (!userId || typeof userId !== "string") {
    throw new HttpsError("invalid-argument", "userId is required");
  }

  const db = admin.firestore();

  // DM permission check
  const callerSnap = await db.doc(`users/${req.auth.uid}`).get();
  if (!callerSnap.exists || callerSnap.get("role") !== "dm") {
    throw new HttpsError("permission-denied", "Only DMs can level up players.");
  }

  const userRef = db.doc(`users/${userId}`);
  const snap = await userRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Target user not found");
  const data = snap.data() || {};
  if (data.role === "dm") throw new HttpsError("failed-precondition", "Cannot level up a DM account");

  const fromLevel = Number(data?.stats?.level) || 1;
  if (fromLevel >= 10) {
    return { ok: true, skipped: "Already at max level", fromLevel, toLevel: fromLevel };
  }
  const toLevel = fromLevel + 1;
  const tokensGranted = getTokenGrantForLevel(toLevel);

  await db.runTransaction(async (tx) => {
    const cur = await tx.get(userRef);
    if (!cur.exists) throw new HttpsError("not-found", "Target user missing during tx");
    const now = cur.data() || {};
    const currentLevel = Number(now?.stats?.level) || 1;
    if (currentLevel !== fromLevel) {
      // simple guard against concurrent updates
      throw new HttpsError("aborted", "Level changed concurrently, retry.");
    }
    tx.update(userRef, {
      "stats.level": toLevel,
      "stats.combatTokensAvailable": admin.firestore.FieldValue.increment(tokensGranted),
    });
    const auditRef = userRef.collection("level_events").doc();
    tx.set(auditRef, {
      from_level: fromLevel,
      to_level: toLevel,
      tokens_granted: tokensGranted,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, userId, fromLevel, toLevel, tokensGranted };
});
