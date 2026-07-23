import {CallableRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {getStorage} from "firebase-admin/storage";
import {randomUUID} from "crypto";

export type LegacyDuplicatePayload = {
  sourceFoeId?: string;
  newFoeName?: string;
  idempotencyKey?: string;
};

type CopyResult = {path: string; url: string};

const safeName = (value: string, max = 60): string =>
  (value || "")
    .toString()
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max) || "foe";

const guessExt = (contentType?: string, sourcePath?: string): string => {
  const normalizedContentType = (contentType || "").toLowerCase();
  if (normalizedContentType.includes("jpeg")) return "jpg";
  if (normalizedContentType.includes("png")) return "png";
  if (normalizedContentType.includes("webp")) return "webp";
  if (normalizedContentType.includes("gif")) return "gif";
  if (normalizedContentType.includes("svg")) return "svg";
  if (sourcePath && sourcePath.includes(".")) {
    const match = sourcePath.match(/\.([A-Za-z0-9]+)$/);
    if (match) return match[1].toLowerCase();
  }
  return "bin";
};

const nowTag = (): string =>
  `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

/**
 * Compatibility implementation for the original europe-west1 callable.
 *
 * It intentionally retains the historical duplication receipt collection and
 * asset layout. It does not consult Task-06 config or write Task-06 operation
 * documents.
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
  const requesterSnap = await db.doc(`users/${ctx.uid}`).get();
  if (requesterSnap.get("role") !== "dm") {
    throw new HttpsError(
      "permission-denied",
      "Only DMs can duplicate foes."
    );
  }

  let idemDocRef: FirebaseFirestore.DocumentReference | null = null;
  if (idempotencyKey && typeof idempotencyKey === "string") {
    idemDocRef = db.collection("duplications").doc(idempotencyKey);
    const existing = await idemDocRef.get();
    if (existing.exists) {
      const data = existing.data();
      if (data && data.result) {
        logger.info("Idempotent duplicate hit", {idempotencyKey});
        return data.result;
      }
    }
  }

  const sourceRef = db.collection("foes").doc(sourceFoeId);
  const sourceSnapshot = await sourceRef.get();
  if (!sourceSnapshot.exists) {
    throw new HttpsError("not-found", "Source foe not found");
  }
  const source = sourceSnapshot.data() || {};
  const bucket = getStorage().bucket();

  const copyFile = async (
    sourcePath: string,
    destinationFolder: string,
    baseName: string
  ): Promise<CopyResult> => {
    if (!sourcePath) return {path: "", url: ""};
    const sourceFile = bucket.file(sourcePath);
    const [exists] = await sourceFile.exists();
    if (!exists) return {path: "", url: ""};
    const [sourceMetadata] = await sourceFile.getMetadata();
    const extension = guessExt(
      sourceMetadata?.contentType,
      sourcePath
    );
    const destinationName =
      `${baseName}_${nowTag()}.${extension}`;
    const destinationPath =
      `${destinationFolder}/${destinationName}`;
    const destinationFile = bucket.file(destinationPath);
    await sourceFile.copy(destinationFile);
    const [destinationMetadata] = await destinationFile.getMetadata();
    let token = destinationMetadata?.metadata
      ?.firebaseStorageDownloadTokens as string | undefined;
    if (!token) token = randomUUID();
    const newMetadata = {
      ...(sourceMetadata?.contentType
        ? {contentType: sourceMetadata.contentType}
        : {}),
      cacheControl: "private, max-age=31536000, immutable",
      metadata: {
        ...(destinationMetadata?.metadata || {}),
        firebaseStorageDownloadTokens: token,
      },
    };
    try {
      await destinationFile.setMetadata(newMetadata);
    } catch (error) {
      logger.warn("setMetadata failed", {
        destPath: destinationPath,
        error: (error as Error).message,
      });
    }
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(destinationPath)}?alt=media&token=${token}`;
    return {path: destinationPath, url};
  };

  const getSourcePath = (item: unknown): string => {
    const record = (
      item && typeof item === "object"
        ? item
        : {}
    ) as Record<string, unknown>;
    const path = (record.imagePath || "").toString();
    if (!path || path.includes("://")) return "";
    return path;
  };

  const mainSourcePath = getSourcePath(source);
  const mainCopy = mainSourcePath
    ? await copyFile(
      mainSourcePath,
      "foes",
      safeName(newFoeName)
    )
    : {path: "", url: ""};

  const tecniche = Array.isArray(source?.tecniche)
    ? source.tecniche
    : [];
  const newTecniche: Array<Record<string, unknown>> = [];
  for (let index = 0; index < tecniche.length; index += 1) {
    const tecnica = tecniche[index] || {};
    const tecnicaSource = getSourcePath(tecnica);
    let imagePath = "";
    let imageUrl = "";
    if (tecnicaSource) {
      const copied = await copyFile(
        tecnicaSource,
        "foes/tecniche",
        safeName(tecnica?.name || "tecnica")
      );
      imagePath = copied.path;
      imageUrl = copied.url;
    }
    newTecniche.push({
      name: tecnica?.name || "",
      description: tecnica?.description || "",
      danni: tecnica?.danni || "",
      effetti: tecnica?.effetti || "",
      imageUrl,
      imagePath,
    });
  }

  const spells = Array.isArray(source?.spells)
    ? source.spells
    : [];
  const newSpells: Array<Record<string, unknown>> = [];
  for (let index = 0; index < spells.length; index += 1) {
    const spell = spells[index] || {};
    const spellSource = getSourcePath(spell);
    let imagePath = "";
    let imageUrl = "";
    if (spellSource) {
      const copied = await copyFile(
        spellSource,
        "foes/spells",
        safeName(spell?.name || "spell")
      );
      imagePath = copied.path;
      imageUrl = copied.url;
    }
    newSpells.push({
      name: spell?.name || "",
      description: spell?.description || "",
      danni: spell?.danni || "",
      effetti: spell?.effetti || "",
      imageUrl,
      imagePath,
    });
  }

  const hpTotal = Number(source?.stats?.hpTotal || 0);
  const manaTotal = Number(source?.stats?.manaTotal || 0);
  const payload: Record<string, unknown> = {
    name: newFoeName.trim(),
    category: source?.category || "",
    rank: source?.rank || "",
    notes: source?.notes || "",
    dadoAnima: source?.dadoAnima || "",
    Parametri: source?.Parametri || {},
    stats: {
      ...(source?.stats || {}),
      hpCurrent: hpTotal,
      manaCurrent: manaTotal,
    },
    imageUrl: mainCopy.url || "",
    imagePath: mainCopy.path || "",
    tecniche: newTecniche,
    spells: newSpells,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };

  const newDocRef = db.collection("foes").doc();
  const batch = db.batch();
  batch.set(newDocRef, payload);
  if (idemDocRef) {
    batch.set(
      idemDocRef,
      {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        actor: ctx.uid,
        sourceFoeId,
        newFoeId: newDocRef.id,
        result: {
          newFoeId: newDocRef.id,
          assets: {
            main: {
              path: payload.imagePath,
              url: payload.imageUrl,
            },
            spells: newSpells.map((spell) => ({
              name: spell.name,
              path: spell.imagePath || "",
              url: spell.imageUrl || "",
            })),
            tecniche: newTecniche.map((tecnica) => ({
              name: tecnica.name,
              path: tecnica.imagePath || "",
              url: tecnica.imageUrl || "",
            })),
          },
        },
      },
      {merge: true}
    );
  }

  await batch.commit();
  const result = {
    newFoeId: newDocRef.id,
    assets: {
      main: {
        path: payload.imagePath,
        url: payload.imageUrl,
      },
      spells: newSpells.map((spell) => ({
        name: spell.name,
        path: spell.imagePath || "",
        url: spell.imageUrl || "",
      })),
      tecniche: newTecniche.map((tecnica) => ({
        name: tecnica.name,
        path: tecnica.imagePath || "",
        url: tecnica.imageUrl || "",
      })),
    },
  };
  logger.info("Foe duplicated", {
    sourceFoeId,
    newFoeId: newDocRef.id,
  });
  return result;
};
