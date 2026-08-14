import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {
  asStoredTask07MediaUploadPlan,
  MediaUploadPlan,
} from "./mediaAssetLifecycleCore";
import {
  buildGeneratedMediaStoragePlan,
  MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS,
} from "./mediaContracts";

const TEMPORARY_CLEANUP_BATCH_SIZE = 20;
const TEMPORARY_CLEANUP_LEASE_MS = 10 * 60 * 1000;
const TEMPORARY_CLEANUP_MAX_SCAN_PAGES = 10;

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const storageErrorCode = (error: unknown): number => {
  if (!error || typeof error !== "object") return Number.NaN;
  return Number((error as {code?: unknown}).code);
};

const manifestRef = (
  db: admin.firestore.Firestore,
  assetId: string
): admin.firestore.DocumentReference => db.doc(`media_assets/${assetId}`);

export const task07TemporaryCleanupPaths = (
  data: admin.firestore.DocumentData | undefined,
  plan: MediaUploadPlan
): string[] | null => {
  const raw = data?.cleanupTemporaryPaths;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) return null;
  const sourceGeneration = asString(data?.generation);
  let generated;
  try {
    generated = buildGeneratedMediaStoragePlan({
      kind: plan.kind,
      audienceScope: plan.audienceScope,
      ownerKey: plan.ownerKey,
      assetId: plan.assetId,
      sourceGeneration,
    });
  } catch {
    return null;
  }
  const finalPaths = new Set([
    generated.originalPath,
    ...Object.values(generated.variants).filter(Boolean) as string[],
  ]);
  const paths = new Set<string>();
  for (const value of raw) {
    const path = asString(value);
    const separator = path.lastIndexOf(".tmp-");
    const finalPath = separator > 0 ? path.slice(0, separator) : "";
    const eventId = separator > 0 ? path.slice(separator + 5) : "";
    if (!finalPaths.has(finalPath) ||
      !/^[A-Za-z0-9_-]{1,96}$/.test(eventId) || paths.has(path)) {
      return null;
    }
    paths.add(path);
  }
  return [...paths].sort();
};

const deleteTemporaryPath = async (
  path: string,
  plan: MediaUploadPlan
): Promise<void> => {
  const bucket = getStorage().bucket();
  let metadata;
  try {
    [metadata] = await bucket.file(path).getMetadata();
  } catch (error) {
    if (storageErrorCode(error) === 404) return;
    throw error;
  }
  const generation = asString(metadata.generation);
  const custom = metadata.metadata || {};
  if (!/^[1-9][0-9]*$/.test(generation) ||
    custom.task07AssetId !== plan.assetId ||
    custom.task07OwnerUid !== plan.ownerUid ||
    custom.task07Kind !== plan.kind) {
    throw new Error("temporary-object-ownership-mismatch");
  }
  await bucket.file(path, {generation}).delete({ignoreNotFound: true});
  const [stillExists] = await bucket.file(path).exists();
  if (stillExists) throw new Error("temporary-object-generation-drift");
};

export const task07TemporaryCleanupFields = (
  paths: readonly string[],
  now: Timestamp = Timestamp.now()
): admin.firestore.UpdateData<admin.firestore.DocumentData> => {
  const normalized = [...new Set(paths.map(asString).filter(Boolean))].sort();
  return normalized.length ? {
    cleanupTemporaryPaths: normalized,
    temporaryCleanup: {
      attempts: 0,
      cleanupAfter: now,
    },
  } : {
    cleanupTemporaryPaths: FieldValue.delete(),
    temporaryCleanup: FieldValue.delete(),
  };
};

export const processTask07TemporaryCleanup = async (
  assetId: string
): Promise<boolean> => {
  if (!/^m_[a-f0-9]{40}$/.test(assetId)) return false;
  const db = admin.firestore();
  const ref = manifestRef(db, assetId);
  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const cleanupAfter = snapshot.get("temporaryCleanup.cleanupAfter");
    const leaseUntil = snapshot.get("temporaryCleanup.leaseUntil");
    const nowMs = Date.now();
    if (!(cleanupAfter instanceof Timestamp) ||
      cleanupAfter.toMillis() > nowMs ||
      (leaseUntil instanceof Timestamp && leaseUntil.toMillis() > nowMs)) {
      return null;
    }
    const plan = asStoredTask07MediaUploadPlan(snapshot.get("plan"));
    const paths = plan ?
      task07TemporaryCleanupPaths(snapshot.data(), plan) : null;
    const attempts = Number(snapshot.get("temporaryCleanup.attempts") || 0);
    if (!plan || !paths || attempts >= MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS) {
      transaction.update(ref, {
        "temporaryCleanup.cleanupAfter": FieldValue.delete(),
        "temporaryCleanup.leaseUntil": FieldValue.delete(),
        "temporaryCleanup.deadLetter": true,
        "temporaryCleanup.lastErrorCode": plan && paths ?
          "temporary-cleanup-attempt-limit" :
          "temporary-cleanup-plan-invalid",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return null;
    }
    const attempt = attempts + 1;
    transaction.update(ref, {
      "temporaryCleanup.attempts": attempt,
      "temporaryCleanup.cleanupAfter": FieldValue.delete(),
      "temporaryCleanup.leaseUntil": Timestamp.fromMillis(
        nowMs + TEMPORARY_CLEANUP_LEASE_MS
      ),
      "temporaryCleanup.deadLetter": FieldValue.delete(),
      "temporaryCleanup.lastErrorCode": FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {attempt, paths, plan};
  });
  if (!claimed) return false;

  const failed: string[] = [];
  for (const path of claimed.paths) {
    try {
      await deleteTemporaryPath(path, claimed.plan);
    } catch {
      failed.push(path);
    }
  }

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists ||
      Number(snapshot.get("temporaryCleanup.attempts")) !== claimed.attempt) {
      return;
    }
    const currentPlan = asStoredTask07MediaUploadPlan(snapshot.get("plan"));
    const currentPaths = currentPlan ?
      task07TemporaryCleanupPaths(snapshot.data(), currentPlan) : null;
    if (!currentPaths ||
      JSON.stringify(currentPaths) !== JSON.stringify(claimed.paths)) return;
    if (!failed.length) {
      transaction.update(ref, {
        cleanupTemporaryPaths: FieldValue.delete(),
        temporaryCleanup: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }
    const deadLetter = claimed.attempt >= MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS;
    transaction.update(ref, {
      cleanupTemporaryPaths: failed,
      "temporaryCleanup.cleanupAfter": deadLetter ?
        FieldValue.delete() :
        Timestamp.fromMillis(
          Date.now() + Math.min(
            60 * 60 * 1000,
            30_000 * (2 ** Math.max(0, claimed.attempt - 1))
          )
        ),
      "temporaryCleanup.leaseUntil": FieldValue.delete(),
      "temporaryCleanup.deadLetter": deadLetter,
      "temporaryCleanup.lastErrorCode": "temporary-storage-delete-failed",
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return true;
};

export const sweepTask07TemporaryCleanup = async (): Promise<number> => {
  const db = admin.firestore();
  let processed = 0;
  for (let page = 0;
    page < TEMPORARY_CLEANUP_MAX_SCAN_PAGES;
    page += 1) {
    const snapshot = await db.collection("media_assets")
      .where("temporaryCleanup.cleanupAfter", "<=", Timestamp.now())
      .limit(TEMPORARY_CLEANUP_BATCH_SIZE)
      .get();
    if (snapshot.empty) break;
    for (const document of snapshot.docs) {
      if (await processTask07TemporaryCleanup(document.id)) processed += 1;
    }
    if (snapshot.size < TEMPORARY_CLEANUP_BATCH_SIZE) break;
  }
  return processed;
};
