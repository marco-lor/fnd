import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";

type DuplicatePayload = {
  sourceFoeId: string;
  newFoeName: string;
  idempotencyKey?: string;
};

type CopyResult = { path: string; url: string };

const safeName = (s: string, max = 60) =>
  (s || "")
    .toString()
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max) || "foe";

const guessExt = (contentType?: string, srcPath?: string) => {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  if (srcPath && srcPath.includes(".")) {
    const m = srcPath.match(/\.([A-Za-z0-9]+)$/);
    if (m) return m[1].toLowerCase();
  }
  return "bin";
};

const nowTag = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export const duplicateFoeWithAssets = onCall<DuplicatePayload>(
  { cors: true, region: "europe-west1" },
  async (req) => {
    const ctx = req.auth;
    if (!ctx || !ctx.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const { sourceFoeId, newFoeName, idempotencyKey } = req.data || ({} as DuplicatePayload);
    if (!sourceFoeId || typeof sourceFoeId !== "string") {
      throw new HttpsError("invalid-argument", "sourceFoeId is required");
    }
    if (!newFoeName || typeof newFoeName !== "string" || !newFoeName.trim()) {
      throw new HttpsError("invalid-argument", "newFoeName is required");
    }

    const db = admin.firestore();

    // Idempotency
    let idemDocRef: FirebaseFirestore.DocumentReference | null = null;
    if (idempotencyKey && typeof idempotencyKey === "string") {
      idemDocRef = db.collection("duplications").doc(idempotencyKey);
      const existing = await idemDocRef.get();
      if (existing.exists) {
        const data = existing.data();
        if (data && data.result) {
          logger.info("Idempotent duplicate hit", { idempotencyKey });
          return data.result;
        }
      }
    }

    const srcRef = db.collection("foes").doc(sourceFoeId);
    const snap = await srcRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Source foe not found");
    }
    const source = snap.data() || {};

    const bucket = getStorage().bucket();

    const copyFile = async (
      srcPath: string,
      destFolder: string,
      baseName: string
    ): Promise<CopyResult> => {
      if (!srcPath) return { path: "", url: "" };
      const srcFile = bucket.file(srcPath);
      const [exists] = await srcFile.exists();
      if (!exists) return { path: "", url: "" };
      const [meta] = await srcFile.getMetadata();
      const ext = guessExt(meta?.contentType, srcPath);
      const destName = `${baseName}_${nowTag()}.${ext}`;
      const destPath = `${destFolder}/${destName}`;
      const destFile = bucket.file(destPath);
      await srcFile.copy(destFile);
      // Preserve contentType and add a reasonable cacheControl, ensure download token exists
      const [dmeta] = await destFile.getMetadata();
      let token = dmeta?.metadata?.firebaseStorageDownloadTokens as string | undefined;
      if (!token) token = randomUUID();
      const newMeta: any = {
        cacheControl: meta?.cacheControl || "public, max-age=3600, immutable",
        metadata: {
          ...(dmeta?.metadata || {}),
          firebaseStorageDownloadTokens: token,
        },
      };
      if (meta?.contentType) newMeta.contentType = meta.contentType;
      try {
        await destFile.setMetadata(newMeta);
      } catch (e) {
        logger.warn("setMetadata failed", { destPath, error: (e as Error).message });
      }
      const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destPath)}?alt=media&token=${token}`;
      return { path: destPath, url };
    };

    const getSrcPath = (item: any): string => {
      const p = (item?.imagePath || "").toString();
      if (!p) return "";
      // Only allow intra-bucket copies (no external URLs)
      if (p.includes("://")) return "";
      return p;
    };

    // Copy main image
    const mainSrcPath: string = getSrcPath(source);
    const mainCopy = mainSrcPath
      ? await copyFile(mainSrcPath, "foes", safeName(newFoeName))
      : { path: "", url: "" };

    // Copy tecniche
    const tecniche: any[] = Array.isArray(source?.tecniche) ? source.tecniche : [];
    const newTecniche: any[] = [];
    for (let i = 0; i < tecniche.length; i++) {
      const t = tecniche[i] || {};
      const tSrc = getSrcPath(t);
      let tPath = "";
      let tUrl = "";
      if (tSrc) {
        const r = await copyFile(tSrc, "foes/tecniche", safeName(t?.name || "tecnica"));
        tPath = r.path;
        tUrl = r.url;
      }
      newTecniche.push({
        name: t?.name || "",
        description: t?.description || "",
        danni: t?.danni || "",
        effetti: t?.effetti || "",
        imageUrl: tUrl,
        imagePath: tPath,
      });
    }

    // Copy spells
    const spells: any[] = Array.isArray(source?.spells) ? source.spells : [];
    const newSpells: any[] = [];
    for (let i = 0; i < spells.length; i++) {
      const s = spells[i] || {};
      const sSrc = getSrcPath(s);
      let sPath = "";
      let sUrl = "";
      if (sSrc) {
        const r = await copyFile(sSrc, "foes/spells", safeName(s?.name || "spell"));
        sPath = r.path;
        sUrl = r.url;
      }
      newSpells.push({
        name: s?.name || "",
        description: s?.description || "",
        danni: s?.danni || "",
        effetti: s?.effetti || "",
        imageUrl: sUrl,
        imagePath: sPath,
      });
    }

    const hpTotal = Number(source?.stats?.hpTotal || 0);
    const manaTotal = Number(source?.stats?.manaTotal || 0);

    // Prepare payload
    const payload: any = {
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

    const foesCol = db.collection("foes");
    const newDocRef = foesCol.doc();

    const batch = db.batch();
    batch.set(newDocRef, payload);

    let idemWriteRef: FirebaseFirestore.DocumentReference | null = null;
    if (idemDocRef) {
      idemWriteRef = idemDocRef;
      batch.set(
        idemWriteRef,
        {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          actor: ctx.uid,
          sourceFoeId,
          newFoeId: newDocRef.id,
          result: {
            newFoeId: newDocRef.id,
            assets: {
              main: { path: payload.imagePath, url: payload.imageUrl },
              spells: newSpells.map((s: any) => ({ name: s.name, path: s.imagePath || "", url: s.imageUrl || "" })),
              tecniche: newTecniche.map((t: any) => ({ name: t.name, path: t.imagePath || "", url: t.imageUrl || "" })),
            },
          },
        },
        { merge: true }
      );
    }

    await batch.commit();

    const result = {
      newFoeId: newDocRef.id,
      assets: {
        main: { path: payload.imagePath, url: payload.imageUrl },
        spells: newSpells.map((s: any) => ({ name: s.name, path: s.imagePath || "", url: s.imageUrl || "" })),
        tecniche: newTecniche.map((t: any) => ({ name: t.name, path: t.imagePath || "", url: t.imageUrl || "" })),
      },
    };

    logger.info("Foe duplicated", { sourceFoeId, newFoeId: newDocRef.id });
    return result;
  }
);
