import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

type SpawnGrigliataFoeTokenPayload = {
  foeId: string;
  backgroundId: string;
  col: number;
  row: number;
};

const REGION = "europe-west1";

const asNonEmptyString = (value: unknown) => (
  typeof value === "string" && value.trim() ? value.trim() : ""
);

const asInteger = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : null;
};

const isManagerRole = (role: unknown) => asNonEmptyString(role).toLowerCase() === "dm";

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

const normalizeStats = (value: unknown) => {
  const stats = value && typeof value === "object" && !Array.isArray(value)
    ? deepClone(value as Record<string, unknown>)
    : {};
  const hpTotal = Number((stats as Record<string, unknown>).hpTotal || 0);
  const manaTotal = Number((stats as Record<string, unknown>).manaTotal || 0);
  const hpCurrent = Number((stats as Record<string, unknown>).hpCurrent ?? hpTotal);
  const manaCurrent = Number((stats as Record<string, unknown>).manaCurrent ?? manaTotal);

  return {
    ...stats,
    hpTotal,
    hpCurrent,
    manaTotal,
    manaCurrent,
  };
};

const normalizeParametri = (value: unknown) => (
  value && typeof value === "object" && !Array.isArray(value)
    ? deepClone(value as Record<string, unknown>)
    : {}
);

const normalizeEntryList = (value: unknown) => (
  Array.isArray(value)
    ? deepClone(value.map((entry) => (
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry
        : {}
    )))
    : []
);

export const spawnGrigliataFoeToken = onCall<SpawnGrigliataFoeTokenPayload>(
  {region: REGION},
  async (request) => {
    const requesterUid = asNonEmptyString(request.auth?.uid);
    if (!requesterUid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const foeId = asNonEmptyString(request.data?.foeId);
    const backgroundId = asNonEmptyString(request.data?.backgroundId);
    const col = asInteger(request.data?.col);
    const row = asInteger(request.data?.row);

    if (!foeId || !backgroundId || col === null || row === null) {
      throw new HttpsError("invalid-argument", "foeId, backgroundId, col, and row are required.");
    }

    const db = admin.firestore();
    const requesterSnap = await db.doc(`users/${requesterUid}`).get();
    if (!isManagerRole(requesterSnap.data()?.role)) {
      throw new HttpsError("permission-denied", "Only the DM can spawn foe tokens.");
    }

    const foeRef = db.doc(`foes/${foeId}`);
    const foeSnap = await foeRef.get();
    if (!foeSnap.exists) {
      throw new HttpsError("not-found", "Foe not found.");
    }

    const foeData = foeSnap.data() || {};
    const tokenRef = db.collection("grigliata_tokens").doc();
    const placementId = `${backgroundId}__${tokenRef.id}`;
    const placementRef = db.doc(`grigliata_token_placements/${placementId}`);
    const now = admin.firestore.FieldValue.serverTimestamp();

    const tokenPayload = {
      ownerUid: requesterUid,
      label: asNonEmptyString(foeData.name) || "Foe",
      imageUrl: asNonEmptyString(foeData.imageUrl),
      imagePath: asNonEmptyString(foeData.imagePath),
      tokenType: "foe",
      imageSource: "foesHub",
      foeSourceId: foeId,
      category: asNonEmptyString(foeData.category),
      rank: asNonEmptyString(foeData.rank),
      dadoAnima: asNonEmptyString(foeData.dadoAnima),
      notes: asNonEmptyString(foeData.notes),
      stats: normalizeStats(foeData.stats),
      Parametri: normalizeParametri(foeData.Parametri),
      spells: normalizeEntryList(foeData.spells),
      tecniche: normalizeEntryList(foeData.tecniche),
      createdAt: now,
      createdBy: requesterUid,
      updatedAt: now,
      updatedBy: requesterUid,
    };

    const placementPayload = {
      backgroundId,
      tokenId: tokenRef.id,
      ownerUid: requesterUid,
      label: tokenPayload.label,
      imageUrl: tokenPayload.imageUrl,
      col,
      row,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
      updatedAt: now,
      updatedBy: requesterUid,
    };

    const batch = db.batch();
    batch.set(tokenRef, tokenPayload);
    batch.set(placementRef, placementPayload);
    await batch.commit();

    return {
      success: true,
      tokenId: tokenRef.id,
      placementId,
    };
  }
);
