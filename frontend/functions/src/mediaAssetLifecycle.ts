import * as admin from "firebase-admin";
import {getStorage} from "firebase-admin/storage";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {
  asStoredTask07MediaUploadPlan,
  buildTask07MediaUploadPlan,
  isTask07CleanupQueueClaimable,
  isTask07MediaRequestAuthorized,
  isTask07MediaRetirementAuthorized,
  isTask07MediaStateAbandonable,
  isTask07MediaStateCleanupEligible,
  isTask07MediaStateManualCleanupRetryable,
  MediaUploadPlan,
  partitionTask07CleanupSweepRecords,
  scanTask07MediaTargetReferences,
  task07MediaTargetMayReferenceAsset,
  task07MediaReferencePath,
  task07MediaTargetSlotAssetId,
  task07MediaTargetSlotReferencesAsset,
  task07MediaTargetFields,
} from "./mediaAssetLifecycleCore";
import {task07ProcessMediaUpload} from "./mediaAssetProcessor";
import {
  attachTask07ReadyAssetTransaction,
  Task07TargetAdapterError,
  validateTask07MediaTarget,
} from "./mediaTargetAdapters";
import {
  buildTask07PrivateStorageMetadata,
  buildGeneratedMediaStoragePlan,
  MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS,
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_ORPHAN_SWEEP_BATCH_SIZE,
  MEDIA_SCHEMA_VERSION,
  MEDIA_STAGING_CACHE_CONTROL,
  parseCanonicalMediaPath,
} from "./mediaContracts";
import {
  assertTask07DemoEmulatorBypassIsExact,
  TASK07_CALLABLE_OPTIONS,
} from "./task07CallableOptions";
import {task07MediaWritesV1ForActor} from "./task07MediaControl";

const REGION = "europe-west8";
const CLEANUP_BATCH_SIZE = Math.min(MEDIA_ORPHAN_SWEEP_BATCH_SIZE, 20);
const CLEANUP_LEASE_MS = 10 * 60 * 1000;
const CLEANUP_SWEEP_MAX_SCAN_PAGES = 10;

type PrepareMediaUploadRequest = {
  ownerUid?: string;
  entityId?: string;
  referenceScope?: string;
  previousAssetId?: string | null;
  operationId?: string;
  kind?: string;
  sourceContentType?: string;
  sourceBytes?: number;
};

type AssetRequest = {
  assetId?: string;
  expectedRevision?: number | null;
};

type Actor = {
  uid: string;
  role: string;
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const fail = (
  code: "unauthenticated" | "permission-denied" | "invalid-argument" |
    "failed-precondition" | "not-found" | "already-exists" | "internal",
  message: string
): never => {
  throw new HttpsError(code, message);
};

const requireActor = async (
  request: CallableRequest<unknown>
): Promise<Actor> => {
  assertTask07DemoEmulatorBypassIsExact();
  const uid = asString(request.auth?.uid);
  if (!uid) fail("unauthenticated", "Authentication required.");
  const snapshot = await admin.firestore().doc(`users/${uid}`).get();
  if (!snapshot.exists || snapshot.get("deletionState") === "pending") {
    fail("permission-denied", "Active user required.");
  }
  return {
    uid,
    role: asString(snapshot.get("role")).toLowerCase(),
  };
};

const requireActiveOwner = async (ownerUid: string): Promise<void> => {
  const owner = await admin.firestore().doc(`users/${ownerUid}`).get();
  if (!owner.exists || owner.get("deletionState") === "pending") {
    fail("failed-precondition", "Media owner must be active.");
  }
};

const assetRef = (
  db: admin.firestore.Firestore,
  assetId: string
): admin.firestore.DocumentReference =>
  db.doc(`media_assets/${assetId}`);

const cleanupRef = (
  db: admin.firestore.Firestore,
  assetId: string
): admin.firestore.DocumentReference =>
  db.doc(`media_asset_cleanup/${assetId}`);

const requireAssetId = (value: unknown): string => {
  const assetId = asString(value);
  if (!/^m_[a-f0-9]{40}$/.test(assetId)) {
    fail("invalid-argument", "Media asset ID is invalid.");
  }
  return assetId;
};

const mediaAssetIdFromTarget = (
  data: admin.firestore.DocumentData | undefined,
  plan: Pick<MediaUploadPlan, "kind">
): string | null => {
  const fields = task07MediaTargetFields(plan);
  return task07MediaTargetSlotAssetId(data, fields.slot);
};

const publicUploadPlan = (plan: MediaUploadPlan) => ({
  schemaVersion: MEDIA_SCHEMA_VERSION,
  policyVersion: MEDIA_CONTRACT_VERSION,
  assetId: plan.assetId,
  purpose: plan.kind,
  targetKind: plan.targetKind,
  sourcePath: plan.sourcePath,
  sourceContentType: plan.sourceContentType,
  sourceBytes: plan.sourceBytes,
  sourceMetadata: buildTask07PrivateStorageMetadata({
    assetId: plan.assetId,
    entityId: plan.entityId,
    kind: plan.kind,
    ownerUid: plan.ownerUid,
    role: "source",
  }),
  cacheControl: MEDIA_STAGING_CACHE_CONTROL,
  contentDisposition: "inline",
  expiresInSeconds:
    MEDIA_CONTRACTS[plan.kind].retention.uncommittedHours * 60 * 60,
});

const mapAdapterError = (error: unknown): never => {
  if (error instanceof Task07TargetAdapterError) {
    throw new HttpsError(error.code, error.message);
  }
  throw error;
};

export const task07PrepareMediaUpload = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 30},
  async (request: CallableRequest<PrepareMediaUploadRequest>) => {
    const actor = await requireActor(request);
    const plan = (() => {
      try {
        return buildTask07MediaUploadPlan({
          actorUid: actor.uid,
          ownerUid: request.data?.ownerUid || actor.uid,
          entityId: request.data?.entityId,
          referenceScope: request.data?.referenceScope,
          previousAssetId: request.data?.previousAssetId,
          operationId: request.data?.operationId,
          kind: request.data?.kind,
          sourceContentType: request.data?.sourceContentType,
          sourceBytes: request.data?.sourceBytes,
        });
      } catch (error) {
        return fail(
          "invalid-argument",
          error instanceof Error ?
            error.message :
            "Invalid media upload plan."
        );
      }
    })();
    if (!isTask07MediaRequestAuthorized({
      kind: plan.kind,
      actorUid: actor.uid,
      ownerUid: plan.ownerUid,
      referenceScope: plan.referenceScope,
      actorRole: actor.role,
    })) {
      fail("permission-denied", "Media scope is not authorized.");
    }
    await requireActiveOwner(plan.ownerUid);
    const db = admin.firestore();
    const manifestRef = assetRef(db, plan.assetId);
    const targetRef = db.doc(task07MediaReferencePath(plan));
    const controlRef = db.doc("utils/task07_media");
    const preparation = await db.runTransaction(async (transaction) => {
      const [manifest, target, control] = await transaction.getAll(
        manifestRef,
        targetRef,
        controlRef
      );
      if (manifest.exists) {
        if (manifest.get("requestHash") !== plan.requestHash ||
          manifest.get("actorUid") !== actor.uid) {
          fail("already-exists", "Media operation identity is already bound.");
        }
        const state = asString(manifest.get("state"));
        if (!state) {
          fail("failed-precondition", "Media operation state is invalid.");
        }
        return {replay: true, state};
      }
      if (!task07MediaWritesV1ForActor({
        control: control.data(),
        purpose: plan.kind,
        role: actor.role,
        uid: actor.uid,
      })) {
        fail("failed-precondition", "Task 07 media writes are not enabled.");
      }
      try {
        validateTask07MediaTarget({plan, target});
      } catch (error) {
        return mapAdapterError(error);
      }
      if (mediaAssetIdFromTarget(target.data(), plan) !== plan.previousAssetId) {
        fail(
          "failed-precondition",
          "previousAssetId must match the target media reference."
        );
      }
      const now = admin.firestore.Timestamp.now();
      const cleanupAfter = admin.firestore.Timestamp.fromMillis(
        Date.now() +
        MEDIA_CONTRACTS[plan.kind].retention.uncommittedHours *
        60 * 60 * 1000
      );
      transaction.create(manifestRef, {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        policyVersion: MEDIA_CONTRACT_VERSION,
        assetId: plan.assetId,
        generation: null,
        state: "intent",
        purpose: plan.kind,
        audience: plan.audienceScope,
        ownerUid: plan.ownerUid,
        actorUid: actor.uid,
        targetKind: plan.targetKind,
        targetId: plan.entityId,
        previousAssetId: plan.previousAssetId,
        requestHash: plan.requestHash,
        plan,
        source: {
          path: plan.sourcePath,
          mime: plan.sourceContentType,
          bytes: plan.sourceBytes,
        },
        variants: {},
        attachment: null,
        retention: {cleanupAfter},
        error: {
          code: null,
          retryable: false,
          attempts: 0,
        },
        createdAt: now,
        updatedAt: now,
      });
      return {replay: false, state: "intent"};
    });
    let sourcePresent = false;
    if (preparation.replay) {
      try {
        [sourcePresent] = await getStorage().bucket()
          .file(plan.sourcePath).exists();
      } catch {
        fail("internal", "Media upload resume state is unavailable.");
      }
    }
    return {
      ok: true,
      state: preparation.state,
      replay: preparation.replay,
      sourcePresent,
      upload: publicUploadPlan(plan),
    };
  }
);

export const task07GetMediaStatus = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 15},
  async (request: CallableRequest<AssetRequest>) => {
    const actor = await requireActor(request);
    const assetId = requireAssetId(request.data?.assetId);
    const snapshot = await assetRef(admin.firestore(), assetId).get();
    const plan = asStoredTask07MediaUploadPlan(snapshot.get("plan"));
    if (!snapshot.exists) {
      fail("not-found", "Media asset not found.");
    }
    if (!plan) {
      fail("not-found", "Media asset not found.");
    }
    const authorizedPlan = plan as MediaUploadPlan;
    if (authorizedPlan.actorUid !== actor.uid) {
      fail("not-found", "Media asset not found.");
    }
    const storedState = asString(snapshot.get("state"));
    let attached = storedState === "attached";
    if (attached) {
      const target = await admin.firestore()
        .doc(task07MediaReferencePath(authorizedPlan))
        .get();
      attached = task07MediaTargetSlotReferencesAsset(
        target.data(),
        task07MediaTargetFields(authorizedPlan).slot,
        assetId
      );
    }
    const state = storedState === "attached" && !attached ?
      "reference-missing" :
      storedState;
    const errorCode = asString(snapshot.get("error.code"));
    return {
      ok: true,
      assetId,
      state,
      retryable: snapshot.get("error.retryable") === true,
      errorCode: errorCode || null,
      ready: state === "ready" || attached,
      attached,
    };
  }
);

export const task07AttachMediaAsset = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 30},
  async (request: CallableRequest<AssetRequest>) => {
    const actor = await requireActor(request);
    const assetId = requireAssetId(request.data?.assetId);
    try {
      const result = await attachTask07ReadyAssetTransaction({
        db: admin.firestore(),
        actorUid: actor.uid,
        actorRole: actor.role,
        assetId,
        expectedRevision: request.data?.expectedRevision,
      });
      return {ok: true, state: "attached", ...result};
    } catch (error) {
      return mapAdapterError(error);
    }
  }
);

// Compatibility function ID retained; the operation now performs the
// transaction itself and no longer confirms a prior browser Firestore write.
export const task07ConfirmMediaReference = task07AttachMediaAsset;

export const task07AbandonMediaAsset = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 30},
  async (request: CallableRequest<AssetRequest>) => {
    const actor = await requireActor(request);
    const assetId = requireAssetId(request.data?.assetId);
    const db = admin.firestore();
    const ref = assetRef(db, assetId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const plan = asStoredTask07MediaUploadPlan(snapshot.get("plan"));
      if (!snapshot.exists || !plan || plan.actorUid !== actor.uid) {
        fail("not-found", "Media asset not found.");
      }
      const state = snapshot.get("state");
      if (state === "cancelled") return;
      if (!isTask07MediaStateAbandonable(state)) {
        fail("failed-precondition", "Media asset cannot be cancelled.");
      }
      const now = admin.firestore.Timestamp.now();
      transaction.update(ref, {
        state: "cancelled",
        processing: admin.firestore.FieldValue.delete(),
        retention: {cleanupAfter: now},
        updatedAt: now,
      });
      transaction.set(cleanupRef(db, assetId), {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId,
        state: "pending",
        reason: "cancelled",
        attempts: 0,
        cleanupAfter: now,
        createdAt: now,
        updatedAt: now,
      }, {merge: false});
    });
    return {ok: true, state: "cancelled", assetId};
  }
);

export const task07RetireMediaAsset = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 30},
  async (request: CallableRequest<AssetRequest>) => {
    const actor = await requireActor(request);
    const assetId = requireAssetId(request.data?.assetId);
    const db = admin.firestore();
    const ref = assetRef(db, assetId);
    await db.runTransaction(async (transaction) => {
      const manifest = await transaction.get(ref);
      const plan = asStoredTask07MediaUploadPlan(manifest.get("plan"));
      if (!manifest.exists || !plan) {
        throw new HttpsError("not-found", "Media asset not found.");
      }
      if (!isTask07MediaRetirementAuthorized({
        kind: plan.kind,
        actorUid: actor.uid,
        ownerUid: plan.ownerUid,
        referenceScope: plan.referenceScope,
        actorRole: actor.role,
      })) {
        fail("permission-denied", "Media retirement is not authorized.");
      }
      if (manifest.get("state") === "superseded") return;
      if (manifest.get("state") !== "attached") {
        fail("failed-precondition", "Only attached media can be retired.");
      }
      const referencePath = task07MediaReferencePath(plan);
      const targetRef = db.doc(referencePath);
      const target = await transaction.get(targetRef);
      if (mediaAssetIdFromTarget(target.data(), plan) !== assetId) {
        fail("failed-precondition", "Media target changed.");
      }
      const targetFields = task07MediaTargetFields(plan);
      const now = admin.firestore.Timestamp.now();
      const cleanupAfter = admin.firestore.Timestamp.fromMillis(
        Date.now() +
        MEDIA_CONTRACTS[plan.kind].retention.supersededGraceHours *
        60 * 60 * 1000
      );
      const targetUpdate: admin.firestore.UpdateData<
        admin.firestore.DocumentData
      > = {
        [targetFields.mediaField]: admin.firestore.FieldValue.delete(),
        [targetFields.revisionField]:
          (Number(target.get(targetFields.revisionField)) || 0) + 1,
        [targetFields.updatedAtField]: now,
      };
      if ([
        "profile", "npc", "foe", "grigliata-token",
        "grigliata-background",
      ].includes(plan.targetKind)) {
        targetUpdate.imagePath = admin.firestore.FieldValue.delete();
        targetUpdate.imageUrl = "";
      }
      if (plan.targetKind === "grigliata-background") {
        targetUpdate.imageWidth = admin.firestore.FieldValue.delete();
        targetUpdate.imageHeight = admin.firestore.FieldValue.delete();
        targetUpdate.contentType = admin.firestore.FieldValue.delete();
        targetUpdate.sizeBytes = admin.firestore.FieldValue.delete();
        targetUpdate.durationMs = admin.firestore.FieldValue.delete();
      }
      transaction.update(targetRef, targetUpdate);
      transaction.update(ref, {
        state: "superseded",
        retention: {supersededAt: now, cleanupAfter},
        updatedAt: now,
      });
      transaction.set(cleanupRef(db, assetId), {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId,
        state: "pending",
        reason: "retired",
        attempts: 0,
        cleanupAfter,
        createdAt: now,
        updatedAt: now,
      }, {merge: false});
    });
    return {ok: true, state: "superseded", assetId};
  }
);

export const task07RetryMediaCleanup = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 30},
  async (request: CallableRequest<AssetRequest>) => {
    const actor = await requireActor(request);
    const assetId = requireAssetId(request.data?.assetId);
    const db = admin.firestore();
    await db.runTransaction(async (transaction) => {
      const [manifest, queue] = await transaction.getAll(
        assetRef(db, assetId),
        cleanupRef(db, assetId)
      );
      const plan = asStoredTask07MediaUploadPlan(manifest.get("plan"));
      if (!manifest.exists || !plan ||
        !isTask07MediaRetirementAuthorized({
          kind: plan.kind,
          actorUid: actor.uid,
          ownerUid: plan.ownerUid,
          referenceScope: plan.referenceScope,
          actorRole: actor.role,
        })) {
        fail("permission-denied", "Media cleanup retry is not authorized.");
      }
      if (!isTask07MediaStateManualCleanupRetryable(
        manifest.get("state")
      )) {
        fail(
          "failed-precondition",
          "Media asset is not in a cleanup-retryable state."
        );
      }
      const queueState = asString(queue.get("state"));
      if (queue.exists && !["retry", "dead-letter"].includes(queueState)) {
        fail(
          "failed-precondition",
          "Media cleanup is already active or complete."
        );
      }
      const now = admin.firestore.Timestamp.now();
      transaction.set(cleanupRef(db, assetId), {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId,
        state: "pending",
        reason: "manual-retry",
        attempts: 0,
        cleanupAfter: now,
        createdAt: now,
        updatedAt: now,
      }, {merge: false});
    });
    return {ok: true, state: "pending", assetId};
  }
);

const boundedCleanupPaths = (
  data: admin.firestore.DocumentData,
  plan: MediaUploadPlan
): string[] => {
  const paths = new Set<string>([plan.sourcePath]);
  const sourceGeneration = asString(data.generation);
  if (/^[1-9][0-9]*$/.test(sourceGeneration)) {
    try {
      const planned = buildGeneratedMediaStoragePlan({
        kind: plan.kind,
        audienceScope: plan.audienceScope,
        ownerKey: plan.ownerKey,
        assetId: plan.assetId,
        sourceGeneration,
      });
      paths.add(planned.originalPath);
      Object.values(planned.variants).forEach((path) => {
        if (path) paths.add(path);
      });
    } catch {
      // Stored descriptors below remain bounded and independently validated.
    }
  }
  const generated = data.generated;
  if (!generated || typeof generated !== "object") return [...paths];
  const candidateObjects = [
    (generated as Record<string, unknown>).original,
    ...Object.values(
      ((generated as Record<string, unknown>).variants &&
      typeof (generated as Record<string, unknown>).variants === "object") ?
        (generated as Record<string, unknown>).variants as
          Record<string, unknown> :
        {}
    ),
  ];
  candidateObjects.forEach((value) => {
    if (!value || typeof value !== "object") return;
    const path = asString((value as Record<string, unknown>).path);
    const parsed = parseCanonicalMediaPath(path);
    if (parsed &&
      parsed.assetId === plan.assetId &&
      parsed.ownerKey === plan.ownerKey &&
      parsed.audienceScope === plan.audienceScope) {
      paths.add(path);
    }
  });
  const temporaryPaths = Array.isArray(data.cleanupTemporaryPaths) ?
    data.cleanupTemporaryPaths.slice(0, 100) :
    [];
  temporaryPaths.forEach((value) => {
    const path = asString(value);
    const separator = path.lastIndexOf(".tmp-");
    if (separator <= 0 ||
      !/^[A-Za-z0-9_-]{1,96}$/.test(path.slice(separator + 5))) return;
    const parsed = parseCanonicalMediaPath(path.slice(0, separator));
    if (parsed &&
      parsed.assetId === plan.assetId &&
      parsed.ownerKey === plan.ownerKey &&
      parsed.audienceScope === plan.audienceScope) {
      paths.add(path);
    }
  });
  return [...paths].sort();
};

const processCleanup = async (assetId: string): Promise<boolean> => {
  const db = admin.firestore();
  const queueRef = cleanupRef(db, assetId);
  const claimed = await db.runTransaction(async (transaction) => {
    const [queue, manifest] = await transaction.getAll(
      queueRef,
      assetRef(db, assetId)
    );
    if (!queue.exists) {
      return null;
    }
    const nowMs = Date.now();
    const leaseUntil = queue.get("leaseUntil");
    if (!isTask07CleanupQueueClaimable({
      state: asString(queue.get("state")),
      leaseUntilMs: leaseUntil instanceof admin.firestore.Timestamp ?
        leaseUntil.toMillis() : Number.NaN,
      nowMs,
    })) return null;
    const cleanupAfter = queue.get("cleanupAfter");
    if (cleanupAfter instanceof admin.firestore.Timestamp &&
      cleanupAfter.toMillis() > nowMs) return null;
    if (!manifest.exists) {
      transaction.update(queueRef, {
        state: "dead-letter",
        cleanupAfter: admin.firestore.FieldValue.delete(),
        leaseUntil: admin.firestore.FieldValue.delete(),
        lastErrorCode: "media-manifest-missing",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }
    const plan = asStoredTask07MediaUploadPlan(manifest.get("plan"));
    if (!plan) {
      transaction.update(queueRef, {
        state: "dead-letter",
        cleanupAfter: admin.firestore.FieldValue.delete(),
        leaseUntil: admin.firestore.FieldValue.delete(),
        lastErrorCode: "media-plan-invalid",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }
    if (!isTask07MediaStateCleanupEligible(manifest.get("state"))) {
      transaction.update(queueRef, {
        state: "dead-letter",
        cleanupAfter: admin.firestore.FieldValue.delete(),
        leaseUntil: admin.firestore.FieldValue.delete(),
        lastErrorCode: "manifest-state-not-cleanup-eligible",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }
    const reference = await transaction.get(
      db.doc(task07MediaReferencePath(plan))
    );
    const referenceScan = scanTask07MediaTargetReferences(reference.data());
    if (task07MediaTargetMayReferenceAsset(reference.data(), assetId)) {
      const attempts = Number(queue.get("attempts") || 0) + 1;
      const deadLetter = attempts >= MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS;
      const malformed = Object.values(referenceScan)
        .some((scan) => scan.malformed);
      transaction.update(queueRef, {
        state: deadLetter ? "dead-letter" : "retry",
        attempts,
        cleanupAfter: deadLetter ?
          admin.firestore.FieldValue.delete() :
          admin.firestore.Timestamp.fromMillis(
            Date.now() + 60 * 60 * 1000
          ),
        leaseUntil: admin.firestore.FieldValue.delete(),
        lastErrorCode: malformed ?
          "target-media-reference-malformed" :
          "asset-still-referenced",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }
    const attempts = Number(queue.get("attempts") || 0) + 1;
    if (attempts > MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS) {
      transaction.update(queueRef, {
        state: "dead-letter",
        cleanupAfter: admin.firestore.FieldValue.delete(),
        leaseUntil: admin.firestore.FieldValue.delete(),
        lastErrorCode: "cleanup-attempt-limit-reached",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }
    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    transaction.update(assetRef(db, assetId), {
      state: "cleanup-pending",
      updatedAt: now,
    });
    transaction.update(queueRef, {
      state: "processing",
      attempts,
      leaseUntil: admin.firestore.Timestamp.fromMillis(
        nowMs + CLEANUP_LEASE_MS
      ),
      updatedAt: now,
    });
    return {
      attempts,
      manifest: manifest.data() || {},
      paths: boundedCleanupPaths(manifest.data() || {}, plan),
    };
  });
  if (!claimed) return false;
  try {
    const bucket = getStorage().bucket();
    for (const path of claimed.paths) {
      await bucket.file(path).delete({ignoreNotFound: true});
    }
    const now = admin.firestore.Timestamp.now();
    await db.runTransaction(async (transaction) => {
      const [queue, manifest] = await transaction.getAll(
        queueRef,
        assetRef(db, assetId)
      );
      if (queue.get("state") !== "processing" ||
        Number(queue.get("attempts")) !== claimed.attempts ||
        manifest.get("state") !== "cleanup-pending") return;
      transaction.update(assetRef(db, assetId), {
        state: "deleted",
        generated: admin.firestore.FieldValue.delete(),
        source: admin.firestore.FieldValue.delete(),
        cleanupTemporaryPaths: admin.firestore.FieldValue.delete(),
        "retention.cleanupAfter": admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });
      transaction.update(queueRef, {
        state: "complete",
        completedAt: now,
        cleanupAfter: admin.firestore.FieldValue.delete(),
        leaseUntil: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });
    });
  } catch {
    const attempts = claimed.attempts;
    await db.runTransaction(async (transaction) => {
      const queue = await transaction.get(queueRef);
      if (queue.get("state") !== "processing" ||
        Number(queue.get("attempts")) !== attempts) return;
      const deadLetter = attempts >= MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS;
      transaction.update(queueRef, {
        state: deadLetter ? "dead-letter" : "retry",
        cleanupAfter: deadLetter ?
          admin.firestore.FieldValue.delete() :
          admin.firestore.Timestamp.fromMillis(
            Date.now() + Math.min(
              60 * 60 * 1000,
              30_000 * (2 ** Math.max(0, attempts - 1))
            )
          ),
        lastErrorCode: "storage-delete-failed",
        leaseUntil: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  }
  return true;
};

export const cleanupTask07MediaAsset = onDocumentWritten(
  {
    document: "media_asset_cleanup/{assetId}",
    region: REGION,
    cpu: 1,
    concurrency: 1,
    maxInstances: 1,
    memory: "256MiB",
    timeoutSeconds: 120,
    retry: false,
  },
  async (event) => {
    const assetId = asString(event.params.assetId);
    if (/^m_[a-f0-9]{40}$/.test(assetId)) {
      await processCleanup(assetId);
    }
  }
);

const mediaAssetIdsByTargetSlot = (
  data: admin.firestore.DocumentData | undefined
): Record<"media" | "videoMedia", string[]> => {
  const scan = scanTask07MediaTargetReferences(data);
  return {
    media: scan.media.assetIds,
    videoMedia: scan.videoMedia.assetIds,
  };
};

const stageRemovedReferences = async (input: {
  before: admin.firestore.DocumentData | undefined;
  after: admin.firestore.DocumentData | undefined;
  referencePath: string;
}): Promise<void> => {
  const before = mediaAssetIdsByTargetSlot(input.before);
  const after = mediaAssetIdsByTargetSlot(input.after);
  const removed = (Object.keys(before) as Array<"media" | "videoMedia">)
    .flatMap((slot) => before[slot]
      .filter((assetId) => !after[slot].includes(assetId))
      .map((assetId) => ({assetId, slot}))
    );
  if (!removed.length) return;
  const db = admin.firestore();
  for (const {assetId: removedAssetId, slot} of removed) {
    const ref = assetRef(db, removedAssetId);
    await db.runTransaction(async (transaction) => {
      const manifest = await transaction.get(ref);
      const plan = asStoredTask07MediaUploadPlan(manifest.get("plan"));
      if (!manifest.exists || !plan ||
        task07MediaReferencePath(plan) !== input.referencePath ||
        task07MediaTargetFields(plan).slot !== slot ||
        manifest.get("state") !== "attached") return;
      const now = admin.firestore.Timestamp.now();
      const cleanupAfter = admin.firestore.Timestamp.fromMillis(
        Date.now() +
        MEDIA_CONTRACTS[plan.kind].retention.supersededGraceHours *
        60 * 60 * 1000
      );
      transaction.update(ref, {
        state: "superseded",
        retention: {supersededAt: now, cleanupAfter},
        updatedAt: now,
      });
      transaction.set(cleanupRef(db, removedAssetId), {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId: removedAssetId,
        state: "pending",
        reason: "reference-removed",
        attempts: 0,
        cleanupAfter,
        createdAt: now,
        updatedAt: now,
      }, {merge: false});
    });
  }
};

const referenceRemovalTrigger = (
  document: string,
  pathFor: (params: Record<string, string>) => string
) => onDocumentWritten(
  {
    document,
    region: REGION,
    cpu: 1,
    concurrency: 1,
    maxInstances: 1,
    memory: "256MiB",
    timeoutSeconds: 60,
    retry: true,
  },
  async (event) => stageRemovedReferences({
    before: event.data?.before.data(),
    after: event.data?.after.data(),
    referencePath: pathFor(event.params as Record<string, string>),
  })
);

export const cleanupTask07RemovedUserMedia = referenceRemovalTrigger(
  "users/{uid}",
  ({uid}) => `users/${uid}`
);
export const cleanupTask07RemovedInventoryMedia = referenceRemovalTrigger(
  "users/{uid}/inventory/{entityId}",
  ({uid, entityId}) => `users/${uid}/inventory/${entityId}`
);
export const cleanupTask07RemovedTechniqueMedia = referenceRemovalTrigger(
  "users/{uid}/tecniche/{entityId}",
  ({uid, entityId}) => `users/${uid}/tecniche/${entityId}`
);
export const cleanupTask07RemovedSpellMedia = referenceRemovalTrigger(
  "users/{uid}/spells/{entityId}",
  ({uid, entityId}) => `users/${uid}/spells/${entityId}`
);
export const cleanupTask07RemovedCatalogItemMedia = referenceRemovalTrigger(
  "items/{entityId}",
  ({entityId}) => `items/${entityId}`
);
export const cleanupTask07RemovedNpcMedia = referenceRemovalTrigger(
  "echi_npcs/{entityId}",
  ({entityId}) => `echi_npcs/${entityId}`
);
export const cleanupTask07RemovedFoeMedia = referenceRemovalTrigger(
  "foes/{entityId}",
  ({entityId}) => `foes/${entityId}`
);
export const cleanupTask07RemovedBackgroundMedia = referenceRemovalTrigger(
  "grigliata_backgrounds/{entityId}",
  ({entityId}) => `grigliata_backgrounds/${entityId}`
);
export const cleanupTask07RemovedTokenMedia = referenceRemovalTrigger(
  "grigliata_tokens/{entityId}",
  ({entityId}) => `grigliata_tokens/${entityId}`
);

const normalizeExpiredAsset = async (
  manifestRef: admin.firestore.DocumentReference,
  nowMs: number
): Promise<boolean> => {
  const db = admin.firestore();
  return db.runTransaction(async (transaction) => {
    const [manifest, queue] = await transaction.getAll(
      manifestRef,
      cleanupRef(db, manifestRef.id)
    );
    if (!manifest.exists) return false;
    const cleanupAfter = manifest.get("retention.cleanupAfter");
    if (!(cleanupAfter instanceof admin.firestore.Timestamp) ||
      cleanupAfter.toMillis() > nowMs) return false;
    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    const plan = asStoredTask07MediaUploadPlan(manifest.get("plan"));
    const state = asString(manifest.get("state"));
    const leaseUntil = manifest.get("processing.leaseUntil");
    if (state === "processing" &&
      leaseUntil instanceof admin.firestore.Timestamp &&
      leaseUntil.toMillis() > nowMs) {
      transaction.update(manifestRef, {
        "retention.cleanupAfter": leaseUntil,
        updatedAt: now,
      });
      return true;
    }
    if (["attached", "deleted"].includes(state)) {
      transaction.update(manifestRef, {
        "retention.cleanupAfter": admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });
      return true;
    }
    const cleanupState = [
      "intent", "uploaded", "processing", "ready", "superseded",
      "cancelled", "rejected", "failed", "cleanup-pending",
    ].includes(state);
    if (!plan || !cleanupState) {
      transaction.update(manifestRef, {
        "retention.cleanupAfter": admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });
      if (!queue.exists) {
        transaction.create(cleanupRef(db, manifestRef.id), {
          schemaVersion: MEDIA_SCHEMA_VERSION,
          assetId: manifestRef.id,
          state: "dead-letter",
          reason: plan ? "invalid-expired-state" : "media-plan-invalid",
          attempts: 0,
          lastErrorCode: plan ? "invalid-expired-state" : "media-plan-invalid",
          createdAt: now,
          updatedAt: now,
        });
      }
      return true;
    }
    const terminalize = ["intent", "uploaded", "processing"].includes(state);
    transaction.update(manifestRef, {
      state: terminalize ? "rejected" :
        ["ready", "superseded"].includes(state) ?
          "cleanup-pending" : state,
      processing: admin.firestore.FieldValue.delete(),
      "retention.cleanupAfter": admin.firestore.FieldValue.delete(),
      ...(terminalize ? {
        error: {
          code: "expired-uncommitted",
          retryable: false,
          attempts: Number(manifest.get("error.attempts") || 0),
        },
      } : {}),
      updatedAt: now,
    });
    if (!queue.exists) {
      transaction.create(cleanupRef(db, manifestRef.id), {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId: manifestRef.id,
        state: "pending",
        reason: terminalize ? "expired-uncommitted" : state,
        attempts: 0,
        cleanupAfter: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    return true;
  });
};

const enqueueExpiredAssets = async (): Promise<number> => {
  const db = admin.firestore();
  const nowMs = Date.now();
  const now = admin.firestore.Timestamp.fromMillis(nowMs);
  let normalized = 0;
  for (let page = 0; page < CLEANUP_SWEEP_MAX_SCAN_PAGES; page += 1) {
    const snapshot = await db.collection("media_assets")
      .where("retention.cleanupAfter", "<=", now)
      .limit(CLEANUP_BATCH_SIZE)
      .get();
    if (snapshot.empty) break;
    for (const manifest of snapshot.docs) {
      if (await normalizeExpiredAsset(manifest.ref, nowMs)) normalized += 1;
    }
    if (snapshot.size < CLEANUP_BATCH_SIZE) break;
  }
  return normalized;
};

const sweepDueCleanupQueue = async (): Promise<number> => {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  let cursor: admin.firestore.QueryDocumentSnapshot | null = null;
  let processed = 0;
  for (let page = 0;
    page < CLEANUP_SWEEP_MAX_SCAN_PAGES && processed < CLEANUP_BATCH_SIZE;
    page += 1) {
    let query: admin.firestore.Query = db.collection("media_asset_cleanup")
      .where("cleanupAfter", "<=", now)
      .orderBy("cleanupAfter", "asc")
      .limit(CLEANUP_BATCH_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    const partitioned = partitionTask07CleanupSweepRecords(
      snapshot.docs.map((document) => ({
        document,
        state: asString(document.get("state")),
      }))
    );
    if (partitioned.terminal.length) {
      const batch = db.batch();
      partitioned.terminal.forEach(({document}) => {
        batch.update(document.ref, {
          cleanupAfter: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }
    for (const {document} of partitioned.active) {
      if (processed >= CLEANUP_BATCH_SIZE) break;
      if (await processCleanup(document.id)) processed += 1;
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < CLEANUP_BATCH_SIZE) break;
  }
  return processed;
};

export const sweepTask07MediaOrphans = onSchedule(
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
    await enqueueExpiredAssets();
    await sweepDueCleanupQueue();
  }
);

// The existing exported Function ID is intentionally converted from a browser
// callable into the Storage finalize trigger. Generated objects are now
// exclusively server-authored.
export const task07FinalizeMediaUpload = task07ProcessMediaUpload;
