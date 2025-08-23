import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

type LevelUpAllRequest = {
  idempotencyKey?: string;
};

type LevelUpResult = {
  userId: string;
  characterId?: string;
  fromLevel: number;
  toLevel?: number; // undefined when skipped
  skipped?: string; // reason
  tokensGranted?: number;
};

const REGION = "europe-west8";

const getTokenGrantForLevel = (level: number): number => {
  if (level >= 2 && level <= 4) return 4;
  if (level >= 5 && level <= 7) return 6;
  if (level >= 8 && level <= 10) return 8;
  return 0;
};


export const levelUpAll = onCall({ region: REGION }, async (req: CallableRequest<LevelUpAllRequest>) => {
  if (!req.auth) {
    throw new HttpsError("unauthenticated", "You must be authenticated.");
  }

  const db = admin.firestore();
  const callerUid = req.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const callerRole = callerSnap.get("role");
  if (callerRole !== "dm") {
    throw new HttpsError("permission-denied", "Only DMs can level up players.");
  }

  const usersSnap = await db.collection("users").get();
  const results: LevelUpResult[] = [];

  const batch = db.batch();

  for (const docSnap of usersSnap.docs) {
    const uid = docSnap.id;
    const data = docSnap.data() || {};
    const role = data.role || "player";
    if (role === "dm") {
      results.push({ userId: uid, characterId: data.characterId, fromLevel: data?.stats?.level || 1, skipped: "DM account" });
      continue;
    }

  const stats = data.stats || {};
    const fromLevel = Number(stats.level) || 1;
    if (fromLevel >= 10) {
      results.push({ userId: uid, characterId: data.characterId, fromLevel, skipped: "Already at max level" });
      continue;
    }

    const toLevel = fromLevel + 1;
  const tokensGranted = getTokenGrantForLevel(toLevel);

    // Build user update
    const userRef = db.doc(`users/${uid}`);
    const update: Record<string, any> = {
      "stats.level": toLevel,
      "stats.combatTokensAvailable": admin.firestore.FieldValue.increment(tokensGranted),
    };

    batch.update(userRef, update);

    // Prepare audit doc write separately (can't add to batch subcollection with auto-id reliably? Actually we can)
    const auditRef = userRef.collection("level_events").doc();
  batch.set(auditRef, {
      from_level: fromLevel,
      to_level: toLevel,
      tokens_granted: tokensGranted,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    results.push({
      userId: uid,
      characterId: data.characterId,
      fromLevel,
      toLevel,
  tokensGranted,
    });
  }

  await batch.commit();

  return { ok: true, updated: results };
});
