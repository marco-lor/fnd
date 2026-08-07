import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {
  documentContainsLegacyMediaPath,
  isLegacyMediaPathAllowed,
  isLegacyMediaScope,
  LegacyMediaScope,
  planLegacyMediaCleanup,
} from "./legacyMediaCleanupCore";
import {hashValue} from "./userDataV2";
import {retryFailedOwnedMediaCleanup} from "./userOwnedMediaCleanup";

const REGION = "europe-west8";
const QUEUE_COLLECTION = "legacy_media_cleanup";
const CLEANUP_LEASE_MS = 10 * 60 * 1000;
const CLEANUP_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_SWEEP_BATCH_SIZE = 30;

type QueueClaim = {
  ownerUid: string;
  referencePath: string;
  scope: LegacyMediaScope;
  storagePath: string;
};

const asString = (value: unknown): string => (
  typeof value === "string" ? value.trim() : ""
);

const terminalReceipt = (state: string) => ({
  state,
  expiresAt: Timestamp.fromMillis(Date.now() + CLEANUP_RECEIPT_TTL_MS),
  leaseUntil: FieldValue.delete(),
  nextAttemptAt: FieldValue.delete(),
  updatedAt: FieldValue.serverTimestamp(),
});

const ownerUidFor = (scope: LegacyMediaScope, value: unknown): string => {
  if (scope !== "token" || !value || typeof value !== "object") return "";
  return asString((value as Record<string, unknown>).ownerUid);
};

const enqueueRemovedMedia = async (input: {
  after: admin.firestore.DocumentData | undefined;
  before: admin.firestore.DocumentData | undefined;
  eventId: string;
  referencePath: string;
  scope: LegacyMediaScope;
}): Promise<void> => {
  const paths = planLegacyMediaCleanup(input);
  if (!paths.length) return;
  const db = admin.firestore();
  const ownerUid = ownerUidFor(input.scope, input.before);
  for (let offset = 0; offset < paths.length; offset += 200) {
    const chunk = paths.slice(offset, offset + 200);
    const refs = chunk.map((storagePath) => db.doc(
      `${QUEUE_COLLECTION}/${hashValue([
        input.eventId,
        input.referencePath,
        storagePath,
      ]).slice(0, 48)}`
    ));
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.getAll(...refs);
      existing.forEach((snapshot, index) => {
        if (snapshot.exists) return;
        transaction.create(snapshot.ref, {
          schemaVersion: 1,
          scope: input.scope,
          referencePath: input.referencePath,
          ownerUid,
          storagePath: chunk[index],
          sourceEventId: input.eventId,
          state: "pending",
          attempts: 0,
          deletionVerified: false,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    });
  }
};

const referenceRemovalTrigger = (
  document: string,
  scope: LegacyMediaScope,
  pathFor: (params: Record<string, string>) => string
) => onDocumentWritten(
  {
    document,
    region: REGION,
    cpu: 1,
    concurrency: 1,
    maxInstances: 2,
    memory: "256MiB",
    timeoutSeconds: 60,
    retry: true,
  },
  async (event) => enqueueRemovedMedia({
    after: event.data?.after.data(),
    before: event.data?.before.data(),
    eventId: event.id,
    referencePath: pathFor(event.params as Record<string, string>),
    scope,
  })
);

const claimCleanup = async (
  cleanupId: string
): Promise<QueueClaim | null> => {
  const db = admin.firestore();
  const queueRef = db.doc(`${QUEUE_COLLECTION}/${cleanupId}`);
  const now = Timestamp.now();
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(queueRef);
    if (!current.exists) return null;
    const state = asString(current.get("state"));
    if (!["pending", "retry", "processing"].includes(state)) return null;
    const nextAttemptAt = current.get("nextAttemptAt");
    if (nextAttemptAt instanceof Timestamp && nextAttemptAt.toMillis() > now.toMillis()) {
      return null;
    }
    const leaseUntil = current.get("leaseUntil");
    if (
      state === "processing" && leaseUntil instanceof Timestamp &&
      leaseUntil.toMillis() > now.toMillis()
    ) return null;
    const scope = current.get("scope");
    const referencePath = asString(current.get("referencePath"));
    const storagePath = asString(current.get("storagePath"));
    const ownerUid = asString(current.get("ownerUid"));
    if (!isLegacyMediaScope(scope) || !isLegacyMediaPathAllowed({
      ownerUid,
      path: storagePath,
      referencePath,
      scope,
    })) {
      transaction.update(queueRef, {
        ...terminalReceipt("rejected"),
        deletionVerified: false,
        errorCode: "invalid-legacy-media-cleanup",
      });
      return null;
    }
    transaction.update(queueRef, {
      state: "processing",
      attempts: FieldValue.increment(1),
      leaseUntil: Timestamp.fromMillis(now.toMillis() + CLEANUP_LEASE_MS),
      processingAt: now,
      updatedAt: now,
      errorCode: FieldValue.delete(),
    });
    return {ownerUid, referencePath, scope, storagePath};
  });
};

const hasLiveTokenProjection = async (storagePath: string): Promise<boolean> => {
  const snapshot = await admin.firestore().collection("grigliata_tokens")
    .where("imagePath", "==", storagePath)
    .limit(1)
    .get();
  return !snapshot.empty;
};

export const processLegacyMediaCleanup = async (
  cleanupId: string
): Promise<boolean> => {
  const claim = await claimCleanup(cleanupId);
  if (!claim) return false;
  const db = admin.firestore();
  const queueRef = db.doc(`${QUEUE_COLLECTION}/${cleanupId}`);
  try {
    const source = await db.doc(claim.referencePath).get();
    if (
      source.exists &&
      documentContainsLegacyMediaPath(source.data(), claim.storagePath)
    ) {
      await queueRef.update({
        ...terminalReceipt("retained-reference"),
        deletionVerified: false,
        errorCode: "source-still-references-media",
      });
      return false;
    }
    if (claim.scope === "token" && await hasLiveTokenProjection(claim.storagePath)) {
      await queueRef.update({
        state: "retry",
        deletionVerified: false,
        errorCode: "token-projection-still-references-media",
        leaseUntil: FieldValue.delete(),
        nextAttemptAt: Timestamp.fromMillis(Date.now() + CLEANUP_LEASE_MS),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return false;
    }
    const file = getStorage().bucket().file(claim.storagePath);
    await file.delete({ignoreNotFound: true});
    const [exists] = await file.exists();
    if (exists) throw new Error("storage-delete-not-verified");
    await queueRef.update({
      ...terminalReceipt("completed"),
      deletionVerified: true,
      completedAt: FieldValue.serverTimestamp(),
      errorCode: FieldValue.delete(),
    });
    return true;
  } catch (error) {
    console.error("Legacy media cleanup failed", {
      cleanupId,
      error,
    });
    await queueRef.update({
      state: "retry",
      deletionVerified: false,
      errorCode: error instanceof Error ? error.message : "unknown",
      lastFailedAt: FieldValue.serverTimestamp(),
      leaseUntil: FieldValue.delete(),
      nextAttemptAt: Timestamp.fromMillis(Date.now() + CLEANUP_LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw error;
  }
};

const sweepLegacyCleanupQueue = async (): Promise<void> => {
  const db = admin.firestore();
  for (const state of ["pending", "retry", "processing"]) {
    const snapshot = await db.collection(QUEUE_COLLECTION)
      .where("state", "==", state)
      .limit(CLEANUP_SWEEP_BATCH_SIZE)
      .get();
    for (const cleanup of snapshot.docs) {
      try {
        await processLegacyMediaCleanup(cleanup.id);
      } catch {
        // The durable receipt remains retryable for the next scheduled pass.
      }
    }
  }
};

export const cleanupLegacyRemovedUserMedia = referenceRemovalTrigger(
  "users/{uid}",
  "profile",
  ({uid}) => `users/${uid}`
);
export const cleanupLegacyRemovedCatalogItemMedia = referenceRemovalTrigger(
  "items/{entityId}",
  "catalog-item",
  ({entityId}) => `items/${entityId}`
);
export const cleanupLegacyRemovedNpcMedia = referenceRemovalTrigger(
  "echi_npcs/{entityId}",
  "npc",
  ({entityId}) => `echi_npcs/${entityId}`
);
export const cleanupLegacyRemovedFoeMedia = referenceRemovalTrigger(
  "foes/{entityId}",
  "foe",
  ({entityId}) => `foes/${entityId}`
);
export const cleanupLegacyRemovedBackgroundMedia = referenceRemovalTrigger(
  "grigliata_backgrounds/{entityId}",
  "background",
  ({entityId}) => `grigliata_backgrounds/${entityId}`
);
export const cleanupLegacyRemovedTokenMedia = referenceRemovalTrigger(
  "grigliata_tokens/{entityId}",
  "token",
  ({entityId}) => `grigliata_tokens/${entityId}`
);
export const cleanupLegacyRemovedMusicTrackMedia = referenceRemovalTrigger(
  "grigliata_music_tracks/{entityId}",
  "music-track",
  ({entityId}) => `grigliata_music_tracks/${entityId}`
);

export const cleanupLegacyMedia = onDocumentCreated(
  {
    document: `${QUEUE_COLLECTION}/{cleanupId}`,
    region: REGION,
    cpu: 1,
    concurrency: 2,
    maxInstances: 2,
    memory: "256MiB",
    timeoutSeconds: 120,
    retry: true,
  },
  async (event) => processLegacyMediaCleanup(event.params.cleanupId)
);

export const sweepLegacyMediaCleanup = onSchedule(
  {
    schedule: "every 60 minutes",
    region: REGION,
    timeZone: "UTC",
    timeoutSeconds: 300,
    memory: "256MiB",
    cpu: 1,
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    await sweepLegacyCleanupQueue();
    await retryFailedOwnedMediaCleanup();
  }
);
