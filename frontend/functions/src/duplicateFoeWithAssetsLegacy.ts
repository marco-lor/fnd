import {CallableRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  foeHasPersistedMedia,
} from "./duplicateFoeWithAssetsCore";
import {task07MediaModeForActor} from "./task07MediaControl";
import {hashValue} from "./userDataV2";

export type LegacyDuplicatePayload = {
  sourceFoeId?: string;
  newFoeName?: string;
  idempotencyKey?: string;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord => (
  value && typeof value === "object" && !Array.isArray(value) ?
    value as UnknownRecord :
    {}
);

const duplicatedEntries = (value: unknown): UnknownRecord[] => (
  Array.isArray(value) ? value : []
).map((raw) => {
  const entry = asRecord(raw);
  return {
    name: entry.name || "",
    description: entry.description || "",
    danni: entry.danni || "",
    effetti: entry.effetti || "",
    imageUrl: "",
    imagePath: "",
  };
});

/**
 * Compatibility implementation for the original europe-west1 callable.
 *
 * This endpoint is intentionally limited to foes with no persisted media. Any
 * media-bearing source must use the resumable V2 callable, which owns canonical
 * Task 07 cloning and recovery. Reading Task 07 control in the same Firestore
 * transaction as the target write prevents a control change from being hidden
 * behind a legacy Storage side effect.
 */
export const duplicateFoeWithAssetsLegacyHandler = async (
  req: CallableRequest<LegacyDuplicatePayload>
): Promise<Record<string, unknown>> => {
  const ctx = req.auth;
  if (!ctx || !ctx.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const {
    sourceFoeId,
    newFoeName,
    idempotencyKey,
  } = req.data || {};
  if (!sourceFoeId || typeof sourceFoeId !== "string") {
    throw new HttpsError("invalid-argument", "sourceFoeId is required");
  }
  if (
    !newFoeName ||
    typeof newFoeName !== "string" ||
    !newFoeName.trim()
  ) {
    throw new HttpsError("invalid-argument", "newFoeName is required");
  }

  const db = admin.firestore();
  const requesterRef = db.doc("users/" + ctx.uid);
  const sourceRef = db.doc("foes/" + sourceFoeId);
  const task07ControlRef = db.doc("utils/task07_media");
  const newDocRef = db.collection("foes").doc();
  const idemDocRef = idempotencyKey && typeof idempotencyKey === "string" ?
    db.collection("duplications").doc(idempotencyKey) :
    null;

  const outcome = await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(
      requesterRef,
      sourceRef,
      task07ControlRef,
      ...(idemDocRef ? [idemDocRef] : [])
    );
    const requester = snapshots[0];
    const sourceSnapshot = snapshots[1];
    const task07Control = snapshots[2];
    const existingReceipt = idemDocRef ? snapshots[3] : null;

    if (requester.get("role") !== "dm") {
      throw new HttpsError(
        "permission-denied",
        "Only DMs can duplicate foes."
      );
    }
    if (existingReceipt?.exists) {
      const existingResult = existingReceipt.get("result");
      if (existingResult && typeof existingResult === "object") {
        return {
          replayed: true,
          result: existingResult as Record<string, unknown>,
        };
      }
    }
    if (!sourceSnapshot.exists) {
      throw new HttpsError("not-found", "Source foe not found");
    }

    const source = asRecord(sourceSnapshot.data());
    if (foeHasPersistedMedia(source)) {
      throw new HttpsError(
        "failed-precondition",
        "Media-bearing foes require canonical Task 07 duplication."
      );
    }

    const task07Mode = task07MediaModeForActor({
      control: task07Control.data(),
      purpose: "foe",
      role: "dm",
      uid: ctx.uid,
    });
    const task07ControlHash = hashValue(task07Control.data() ?? {});
    const sourceStats = asRecord(source.stats);
    const hpTotal = Number(sourceStats.hpTotal || 0);
    const manaTotal = Number(sourceStats.manaTotal || 0);
    const newTecniche = duplicatedEntries(source.tecniche);
    const newSpells = duplicatedEntries(source.spells);
    const payload: Record<string, unknown> = {
      name: newFoeName.trim(),
      category: source.category || "",
      rank: source.rank || "",
      notes: source.notes || "",
      dadoAnima: source.dadoAnima || "",
      Parametri: source.Parametri || {},
      stats: {
        ...sourceStats,
        hpCurrent: hpTotal,
        manaCurrent: manaTotal,
      },
      imageUrl: "",
      imagePath: "",
      tecniche: newTecniche,
      spells: newSpells,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    const result = {
      newFoeId: newDocRef.id,
      assets: {
        main: {path: "", url: ""},
        spells: newSpells.map((spell) => ({
          name: spell.name,
          path: "",
          url: "",
        })),
        tecniche: newTecniche.map((tecnica) => ({
          name: tecnica.name,
          path: "",
          url: "",
        })),
      },
    };

    transaction.create(newDocRef, payload);
    if (idemDocRef) {
      transaction.set(idemDocRef, {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        actor: ctx.uid,
        sourceFoeId,
        sourceHash: hashValue(source),
        task07ControlHash,
        task07Mode,
        newFoeId: newDocRef.id,
        result,
      }, {merge: true});
    }
    return {replayed: false, result};
  });

  logger.info(
    outcome.replayed ? "Idempotent duplicate hit" : "Foe duplicated",
    {
      sourceFoeId,
      newFoeId: outcome.result.newFoeId,
      legacyNoMediaOnly: true,
    }
  );
  return outcome.result;
};
