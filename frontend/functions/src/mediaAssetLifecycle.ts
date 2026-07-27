import * as admin from "firebase-admin";
import {getStorage} from "firebase-admin/storage";
import {HttpsError, CallableRequest, onCall} from "firebase-functions/v2/https";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {
  buildTask07MediaUploadPlan,
  containsTask07MediaPath,
  containsTask07MediaReference,
  task07MediaAssetChainsIntersect,
  finalizeTask07MediaValue,
  isTask07MediaPlanReferenceCompatible,
  isTask07MediaRequestAuthorized,
  isTask07PreviousMediaPlanCompatible,
  isTask07MediaRetirementAuthorized,
  isTask07MediaStateAbandonable,
  isTask07ProcessingLeaseExpired,
  mapMediaCleanupWithConcurrency,
  MediaUploadPlan,
  task07CleanupRetryDelayMs,
  task07MediaCleanupPaths,
  task07MediaReferencePath,
  task07MediaReferenceRemovalAction,
  task07MediaRetirementChainAction,
  task07MediaRetirementResponseAssetId,
  selectTask07CanonicalMediaReference,
  shouldClearTask07DeletedUserTokenProjection,
  shouldRecoverCommittedTask07MediaReference,
} from "./mediaAssetLifecycleCore";
import {
  buildTask07PrivateStorageMetadata,
  InspectedMediaObject,
  MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS,
  MEDIA_CLEANUP_CONCURRENCY,
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_ORPHAN_SWEEP_BATCH_SIZE,
  MEDIA_PRIVATE_CACHE_CONTROL,
  MEDIA_PROCESSING_LEASE_MS,
  MEDIA_SCHEMA_VERSION,
  MediaVariantName,
  isSafeMediaSegment,
  normalizeMediaContentType,
  readImageDimensions,
  validateTask07PrivateStorageMetadata,
} from "./mediaContracts";
import {
  displayDimensionsForOrientation,
  readJpegOrientationDegrees,
  readMp4MediaInfo,
} from "./mediaProbe";

const REGION = "europe-west8";
const MEDIA_ASSET_COLLECTION = "media_assets";
const MEDIA_CLEANUP_COLLECTION = "media_asset_cleanup";
const MAX_TASK07_REPLACEMENT_CHAIN_DEPTH = 32;

type PrepareMediaUploadRequest = {
  ownerUid?: string;
  entityId?: string;
  referenceScope?: string;
  previousAssetId?: string | null;
  operationId?: string;
  kind?: string;
  sourceContentType?: string;
};

type AssetRequest = {
  assetId?: string;
};

const asTrimmedString = (value: unknown): string => (
  typeof value === "string" ? value.trim() : ""
);

const timestampMillis = (value: unknown): number => {
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  if (!value || typeof value !== "object") return Number.NaN;
  const candidate = value as {toMillis?: () => number};
  return typeof candidate.toMillis === "function" ?
    candidate.toMillis() :
    Number.NaN;
};

const fail = (
  code: "unauthenticated" | "permission-denied" | "invalid-argument" |
  "failed-precondition" | "not-found" | "already-exists" | "internal",
  message: string
): never => {
  throw new HttpsError(code, message);
};

const requireActor = async (
  request: CallableRequest<unknown>
): Promise<{uid: string; role: string}> => {
  const uid = asTrimmedString(request.auth?.uid);
  if (!uid) fail("unauthenticated", "Authentication required.");
  const actor = await admin.firestore().doc(`users/${uid}`).get();
  if (!actor.exists || actor.get("deletionState") === "pending") {
    fail("permission-denied", "Active user required.");
  }
  return {uid, role: asTrimmedString(actor.get("role")).toLowerCase()};
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
): admin.firestore.DocumentReference => (
  db.doc(`${MEDIA_ASSET_COLLECTION}/${assetId}`)
);

const cleanupRef = (
  db: admin.firestore.Firestore,
  assetId: string
): admin.firestore.DocumentReference => (
  db.doc(`${MEDIA_CLEANUP_COLLECTION}/${assetId}`)
);

const planFromData = (
  value: admin.firestore.DocumentData | undefined
): MediaUploadPlan | null => {
  const plan = value?.plan;
  if (!plan || typeof plan !== "object") return null;
  try {
    const rebuilt = buildTask07MediaUploadPlan({
      actorUid: plan.actorUid,
      ownerUid: plan.ownerUid,
      entityId: plan.entityId,
      referenceScope: plan.referenceScope,
      previousAssetId: plan.previousAssetId,
      operationId: plan.operationId,
      kind: plan.kind,
      sourceContentType: plan.sourceContentType,
    });
    return rebuilt.requestHash === plan.requestHash ? rebuilt : null;
  } catch {
    return null;
  }
};

const publicUploadPlan = (plan: MediaUploadPlan) => ({
  schemaVersion: MEDIA_SCHEMA_VERSION,
  contractVersion: MEDIA_CONTRACT_VERSION,
  assetId: plan.assetId,
  kind: plan.kind,
  ownerUid: plan.ownerUid,
  entityId: plan.entityId,
  referenceScope: plan.referenceScope,
  previousAssetId: plan.previousAssetId,
  sourceContentType: plan.sourceContentType,
  originalPath: plan.originalPath,
  variants: plan.variants,
  passthrough: plan.passthrough,
  contract: MEDIA_CONTRACTS[plan.kind],
});

const inspectMediaFile = async (
  path: string
): Promise<InspectedMediaObject> => {
  const bucket = getStorage().bucket();
  const file = bucket.file(path);
  const [metadata] = await file.getMetadata();
  const contentType = normalizeMediaContentType(metadata.contentType);
  const bytes = Number(metadata.size);
  const generation = asTrimmedString(metadata.generation);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error("invalid-storage-byte-size");
  }
  if (!/^[1-9][0-9]*$/.test(generation)) {
    throw new Error("invalid-storage-generation");
  }
  const versionedFile = bucket.file(path, {
    generation,
    preconditionOpts: {ifGenerationMatch: generation},
  });
  const [buffer] = await versionedFile.download({validation: "crc32c"});
  if (buffer.byteLength !== bytes) {
    throw new Error("storage-byte-size-mismatch");
  }
  const image = readImageDimensions(buffer, contentType);
  const imageOrientationDegrees = contentType === "image/jpeg" ?
    readJpegOrientationDegrees(buffer) ?? 0 :
    0;
  const imageDisplayDimensions = image ?
    displayDimensionsForOrientation(
      image.width,
      image.height,
      imageOrientationDegrees
    ) :
    null;
  const video = contentType === "video/mp4" ?
    readMp4MediaInfo(buffer) :
    null;
  if (!image && !video) throw new Error("unsupported-or-corrupt-media");
  return {
    path,
    contentType,
    bytes,
    width: imageDisplayDimensions?.width ?? video?.width ?? 0,
    height: imageDisplayDimensions?.height ?? video?.height ?? 0,
    durationMs: video?.durationMs ?? null,
    // WebP derivatives are decoded, normalized pixels and always remain at 0.
    orientationDegrees: video?.orientationDegrees ??
      imageOrientationDegrees,
    generation,
    cacheControl: asTrimmedString(metadata.cacheControl),
  };
};

const stampPrivateMetadata = async (
  inspected: InspectedMediaObject,
  plan: MediaUploadPlan,
  variantName: MediaVariantName | null
): Promise<InspectedMediaObject> => {
  const file = getStorage().bucket().file(inspected.path, {
    generation: inspected.generation,
    preconditionOpts: {ifGenerationMatch: inspected.generation},
  });
  const expectedMetadata = buildTask07PrivateStorageMetadata({
    assetId: plan.assetId,
    entityId: plan.entityId,
    kind: plan.kind,
    ownerUid: plan.ownerUid,
    role: variantName || "original",
  });
  const [metadata] = await file.setMetadata({
    cacheControl: MEDIA_PRIVATE_CACHE_CONTROL,
    contentDisposition: "inline",
    metadata: {
      ...expectedMetadata,
      firebaseStorageDownloadTokens: null,
    },
  }, {
    preconditionOpts: {ifGenerationMatch: inspected.generation},
  });
  if (asTrimmedString(metadata.generation) !== inspected.generation) {
    throw new Error("storage-generation-changed");
  }
  const privateMetadata = validateTask07PrivateStorageMetadata({
    cacheControl: metadata.cacheControl,
    contentDisposition: metadata.contentDisposition,
    metadata: metadata.metadata,
    expected: expectedMetadata,
  });
  if (!privateMetadata.ok) {
    throw new Error(
      "private-storage-metadata-not-applied:" +
      privateMetadata.errors.join(",")
    );
  }
  return {
    ...inspected,
    cacheControl: MEDIA_PRIVATE_CACHE_CONTROL,
  };
};

const inspectPlanObjects = async (plan: MediaUploadPlan) => {
  const original = await inspectMediaFile(plan.originalPath);
  const entries = Object.entries(plan.variants) as Array<
    [MediaVariantName, string]
  >;
  const inspected = await Promise.all(entries.map(async ([name, path]) => (
    [name, await inspectMediaFile(path)] as const
  )));
  return {
    original,
    variants: Object.fromEntries(inspected) as Partial<
    Record<MediaVariantName, InspectedMediaObject>
    >,
  };
};

const requireOwnedManifest = async (
  request: CallableRequest<AssetRequest>
): Promise<{
  actor: {uid: string; role: string};
  ref: admin.firestore.DocumentReference;
  snapshot: admin.firestore.DocumentSnapshot;
  plan: MediaUploadPlan;
}> => {
  const actor = await requireActor(request);
  const requestedAssetId = asTrimmedString(request.data?.assetId);
  if (!/^m_[a-f0-9]{40}$/.test(requestedAssetId)) {
    fail("invalid-argument", "assetId is invalid.");
  }
  const ref = assetRef(admin.firestore(), requestedAssetId);
  const snapshot = await ref.get();
  const plan = planFromData(snapshot.data());
  if (!snapshot.exists || !plan) {
    throw new HttpsError("not-found", "Media asset not found.");
  }
  if (plan.actorUid !== actor.uid) {
    fail("permission-denied", "Media asset belongs to another actor.");
  }
  return {actor, ref, snapshot, plan};
};

const requireRetirableManifest = async (
  request: CallableRequest<AssetRequest>
): Promise<{
  actor: {uid: string; role: string};
  ref: admin.firestore.DocumentReference;
  plan: MediaUploadPlan;
}> => {
  const actor = await requireActor(request);
  const requestedAssetId = asTrimmedString(request.data?.assetId);
  if (!/^m_[a-f0-9]{40}$/.test(requestedAssetId)) {
    fail("invalid-argument", "assetId is invalid.");
  }
  const ref = assetRef(admin.firestore(), requestedAssetId);
  const snapshot = await ref.get();
  const plan = planFromData(snapshot.data());
  if (!snapshot.exists) {
    fail("not-found", "Media asset not found.");
  }
  if (!plan) {
    throw new HttpsError("not-found", "Media asset not found.");
  }
  if (!isTask07MediaRetirementAuthorized({
    kind: plan.kind,
    actorUid: actor.uid,
    ownerUid: plan.ownerUid,
    referenceScope: plan.referenceScope,
    actorRole: actor.role,
  })) {
    fail("permission-denied", "Media asset cannot be retired by this actor.");
  }
  return {actor, ref, plan};
};

type PreviousMediaRetirementStatus = {
  requested: boolean;
  assetId: string | null;
  state: string;
  replay: boolean;
  graceHours: number | null;
};

const requireReferenceCompatibleMediaManifest = (
  replacementPlan: MediaUploadPlan,
  candidate: admin.firestore.DocumentSnapshot
): MediaUploadPlan => {
  const candidatePlan = planFromData(candidate.data());
  if (!candidate.exists || !candidatePlan ||
    candidate.get("assetId") !== candidatePlan.assetId ||
    candidate.get("requestHash") !== candidatePlan.requestHash ||
    candidate.id !== candidatePlan.assetId ||
    !isTask07MediaPlanReferenceCompatible(
      replacementPlan,
      candidatePlan
    )) {
    return fail(
      "failed-precondition",
      "Media supersession chain leaves the replacement reference."
    );
  }
  if (asTrimmedString(candidate.get("referencePath")) !==
    task07MediaReferencePath(replacementPlan)) {
    return fail(
      "failed-precondition",
      "Media supersession chain has an invalid reference binding."
    );
  }
  return candidatePlan;
};

const requireCompatiblePreviousManifest = (
  replacementPlan: MediaUploadPlan,
  previous: admin.firestore.DocumentSnapshot
): MediaUploadPlan => {
  const previousPlan = requireReferenceCompatibleMediaManifest(
    replacementPlan,
    previous
  );
  if (!isTask07PreviousMediaPlanCompatible(
    replacementPlan,
    previousPlan
  )) {
    fail(
      "failed-precondition",
      "Previous media asset is not compatible with its replacement."
    );
  }
  return previousPlan;
};

const stagePreviousMediaRetirement = async (
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  replacementPlan: MediaUploadPlan,
  previous: admin.firestore.DocumentSnapshot | undefined,
  nowMs: number
): Promise<PreviousMediaRetirementStatus> => {
  if (!replacementPlan.previousAssetId) {
    return {
      requested: false,
      assetId: task07MediaRetirementResponseAssetId(replacementPlan),
      state: "not-requested",
      replay: false,
      graceHours: null,
    };
  }
  if (!previous) {
    return fail("failed-precondition", "Previous media asset is missing.");
  }
  let candidate: admin.firestore.DocumentSnapshot = previous;
  let candidatePlan = requireCompatiblePreviousManifest(
    replacementPlan,
    previous
  );
  const visitedAssetIds = new Set<string>([replacementPlan.assetId]);
  for (let depth = 0;
    depth < MAX_TASK07_REPLACEMENT_CHAIN_DEPTH;
    depth += 1) {
    if (visitedAssetIds.has(candidatePlan.assetId)) {
      fail(
        "failed-precondition",
        "Media supersession chain contains a cycle."
      );
    }
    visitedAssetIds.add(candidatePlan.assetId);
    const candidateState = asTrimmedString(candidate.get("state"));
    const supersededByAssetId =
      typeof candidate.get("supersededByAssetId") === "string" ?
        candidate.get("supersededByAssetId") :
        "";
    const action = task07MediaRetirementChainAction({
      replacementAssetId: replacementPlan.assetId,
      candidateState,
      supersededByAssetId,
    });
    if (action === "invalid") {
      fail(
        "failed-precondition",
        "Media supersession chain has a conflicting retirement state."
      );
    }
    const graceHours =
      MEDIA_CONTRACTS[candidatePlan.kind].retention.supersededGraceHours;
    if (action === "supersede") {
      transaction.update(candidate.ref, {
        state: "superseded",
        supersededBy: replacementPlan.actorUid,
        supersededByAssetId: replacementPlan.assetId,
        supersededAt: admin.firestore.FieldValue.serverTimestamp(),
        uncommittedDeleteAfter: admin.firestore.Timestamp.fromMillis(
          nowMs + graceHours * 60 * 60 * 1000
        ),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {
        requested: true,
        assetId: task07MediaRetirementResponseAssetId(replacementPlan),
        state: "superseded",
        replay: false,
        graceHours,
      };
    }
    if (action === "already-superseded") {
      if (candidateState === "superseded" &&
        !supersededByAssetId) {
        transaction.update(candidate.ref, {
          supersededByAssetId: replacementPlan.assetId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return {
        requested: true,
        assetId: task07MediaRetirementResponseAssetId(replacementPlan),
        state: candidateState,
        replay: true,
        graceHours,
      };
    }
    if (!supersededByAssetId ||
      visitedAssetIds.has(supersededByAssetId)) {
      fail(
        "failed-precondition",
        "Media supersession chain contains an invalid link."
      );
    }
    candidate = await transaction.get(
      assetRef(db, supersededByAssetId)
    );
    candidatePlan = requireReferenceCompatibleMediaManifest(
      replacementPlan,
      candidate
    );
  }
  return fail(
    "failed-precondition",
    "Media supersession chain exceeds the supported depth."
  );
};

export const task07PrepareMediaUpload = onCall(
  {region: REGION, timeoutSeconds: 30},
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
        });
      } catch (error) {
        throw new HttpsError(
          "invalid-argument",
          error instanceof Error ? error.message : "Invalid media upload plan."
        );
      }
    })();
    if (!isTask07MediaRequestAuthorized({
      kind: plan.kind,
      actorUid: actor.uid,
      ownerUid: plan.ownerUid,
      referenceScope: plan.referenceScope,
      actorRole: actor.role,
    })) fail("permission-denied", "Media scope is not authorized.");
    await requireActiveOwner(plan.ownerUid);

    const db = admin.firestore();
    const ref = assetRef(db, plan.assetId);
    const referencePath = task07MediaReferencePath(plan);
    const referenceRef = db.doc(referencePath);
    await db.runTransaction(async (transaction) => {
      const [existing, reference] = await transaction.getAll(
        ref,
        referenceRef
      );
      if (existing.exists) {
        if (existing.get("requestHash") !== plan.requestHash ||
          existing.get("actorUid") !== actor.uid) {
          fail("already-exists", "Media operation identity is already bound.");
        }
        return;
      }
      const selectedReference = selectTask07CanonicalMediaReference(
        reference.data()
      );
      if (["invalid", "ambiguous"].includes(selectedReference.status)) {
        fail(
          "failed-precondition",
          "Target media reference is malformed or ambiguous."
        );
      }
      if (selectedReference.status === "single") {
        const previousAssetId = plan.previousAssetId;
        if (!previousAssetId ||
          selectedReference.assetId !== previousAssetId) {
          throw new HttpsError(
            "failed-precondition",
            "previousAssetId must match the exact target media reference."
          );
        }
        const previous = await transaction.get(
          assetRef(db, previousAssetId)
        );
        const previousPlan = requireCompatiblePreviousManifest(
          plan,
          previous
        );
        if (asTrimmedString(previous.get("state")) !== "referenced") {
          fail(
            "failed-precondition",
            "Previous media asset must still be referenced."
          );
        }
        if (!isTask07MediaRetirementAuthorized({
          kind: previousPlan.kind,
          actorUid: actor.uid,
          ownerUid: previousPlan.ownerUid,
          referenceScope: previousPlan.referenceScope,
          actorRole: actor.role,
        })) {
          fail(
            "permission-denied",
            "Previous media asset cannot be retired by this actor."
          );
        }
        if (!reference.exists ||
          !containsTask07MediaReference(
            reference.data(),
            previous.get("media")
          )) {
          fail(
            "failed-precondition",
            "Previous media asset is not the exact committed reference."
          );
        }
      } else if (plan.previousAssetId) {
        fail(
          "failed-precondition",
          "previousAssetId is not present on the target reference."
        );
      }
      transaction.create(ref, {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        contractVersion: MEDIA_CONTRACT_VERSION,
        assetId: plan.assetId,
        actorUid: actor.uid,
        ownerUid: plan.ownerUid,
        entityId: plan.entityId,
        referenceScope: plan.referenceScope,
        kind: plan.kind,
        previousAssetId: plan.previousAssetId,
        requestHash: plan.requestHash,
        state: "prepared",
        finalizationAttempts: 0,
        plan,
        uncommittedDeleteAfter: admin.firestore.Timestamp.fromMillis(
          Date.now() +
          MEDIA_CONTRACTS[plan.kind].retention.uncommittedHours * 60 * 60 * 1000
        ),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    return {ok: true, upload: publicUploadPlan(plan)};
  }
);

export const task07FinalizeMediaUpload = onCall(
  {region: REGION, timeoutSeconds: 120, memory: "512MiB"},
  async (request: CallableRequest<AssetRequest>) => {
    const {ref, plan} = await requireOwnedManifest(request);
    const claim = await admin.firestore().runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      const currentPlan = planFromData(current.data());
      if (!current.exists || !currentPlan ||
        currentPlan.requestHash !== plan.requestHash) {
        fail("not-found", "Media asset not found.");
      }
      const state = asTrimmedString(current.get("state"));
      if (["ready", "fallback", "referenced"].includes(state)) {
        return {replay: true, media: current.get("media")};
      }
      if (!["prepared", "failed"].includes(state)) {
        fail(
          "failed-precondition",
          "Media asset cannot be finalized in this state."
        );
      }
      transaction.update(ref, {
        state: "finalizing",
        finalizationAttempts: admin.firestore.FieldValue.increment(1),
        finalizationStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {replay: false, media: null};
    });
    if (claim.replay) {
      return {ok: true, media: claim.media, replay: true};
    }

    try {
      const inspected = await inspectPlanObjects(plan);
      const original = await stampPrivateMetadata(
        inspected.original,
        plan,
        null
      );
      const variantEntries = await Promise.all(
        Object.entries(inspected.variants).map(async ([name, value]) => (
          [name, await stampPrivateMetadata(
            value as InspectedMediaObject,
            plan,
            name as MediaVariantName
          )] as const
        ))
      );
      const variants = Object.fromEntries(variantEntries) as Partial<
        Record<MediaVariantName, InspectedMediaObject>
      >;
      const media = finalizeTask07MediaValue({plan, original, variants});
      await ref.update({
        state: media.state,
        media,
        uncommittedDeleteAfter: admin.firestore.Timestamp.fromMillis(
          Date.now() +
          MEDIA_CONTRACTS[plan.kind].retention.uncommittedHours * 60 * 60 * 1000
        ),
        finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        finalizationStartedAt: admin.firestore.FieldValue.delete(),
        errorCode: admin.firestore.FieldValue.delete(),
      });
      return {ok: true, media, replay: false};
    } catch (error) {
      const errorCode = error instanceof Error ?
        error.message.slice(0, 500) :
        "media-finalization-failed";
      await ref.update({
        state: "failed",
        errorCode,
        finalizationStartedAt: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.error("Task07 media finalization failed", {
        assetId: plan.assetId,
        error,
      });
      throw new HttpsError(
        "failed-precondition",
        "Media validation failed."
      );
    }
  }
);

export const task07ConfirmMediaReference = onCall(
  {region: REGION, timeoutSeconds: 30},
  async (request: CallableRequest<AssetRequest>) => {
    const {ref, plan} = await requireOwnedManifest(request);
    const db = admin.firestore();
    const referencePath = task07MediaReferencePath(plan);
    const referenceRef = db.doc(referencePath);
    const previousRef = plan.previousAssetId ?
      assetRef(db, plan.previousAssetId) :
      null;
    const retirementNowMs = Date.now();
    const result = await db.runTransaction(async (transaction) => {
      const snapshots = previousRef ?
        await transaction.getAll(ref, referenceRef, previousRef) :
        await transaction.getAll(ref, referenceRef);
      const [current, reference, previous] = snapshots;
      const currentPlan = planFromData(current.data());
      if (!current.exists || !currentPlan ||
        currentPlan.requestHash !== plan.requestHash) {
        fail("not-found", "Media asset not found.");
      }
      const state = asTrimmedString(current.get("state"));
      if (!["ready", "fallback", "referenced"].includes(state)) {
        fail("failed-precondition", "Media asset is not ready for reference.");
      }
      if (!reference.exists ||
        !containsTask07MediaReference(
          reference.data(),
          current.get("media")
        )) {
        fail(
          "failed-precondition",
          "Commit the exact finalized media metadata before confirming it."
        );
      }
      const retirement = await stagePreviousMediaRetirement(
        transaction,
        db,
        plan,
        previous,
        retirementNowMs
      );
      if (state === "referenced") return {replay: true, retirement};
      transaction.update(ref, {
        state: "referenced",
        referencePath,
        referencedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        uncommittedDeleteAfter: admin.firestore.FieldValue.delete(),
      });
      return {replay: false, retirement};
    });
    return {
      ok: true,
      state: "referenced",
      replay: result.replay,
      retirement: result.retirement,
    };
  }
);

export const task07RetireMediaAsset = onCall(
  {region: REGION, timeoutSeconds: 30},
  async (request: CallableRequest<AssetRequest>) => {
    const {actor, ref, plan} = await requireRetirableManifest(request);
    const db = admin.firestore();
    const referencePath = task07MediaReferencePath(plan);
    const referenceRef = db.doc(referencePath);
    const replay = await db.runTransaction(async (transaction) => {
      const [current, reference] = await transaction.getAll(ref, referenceRef);
      const state = asTrimmedString(current.get("state"));
      if (state === "superseded") return true;
      if (!["referenced", "ready", "fallback"].includes(state)) {
        fail("failed-precondition", "Media asset cannot be retired now.");
      }
      if (reference.exists &&
        containsTask07MediaPath(reference.data(), plan.originalPath)) {
        fail(
          "failed-precondition",
          "Commit the replacement media before retiring the old asset."
        );
      }
      const deleteAfter = admin.firestore.Timestamp.fromMillis(
        Date.now() +
        MEDIA_CONTRACTS[plan.kind].retention.supersededGraceHours *
          60 * 60 * 1000
      );
      transaction.update(ref, {
        state: "superseded",
        supersededBy: actor.uid,
        supersededAt: admin.firestore.FieldValue.serverTimestamp(),
        uncommittedDeleteAfter: deleteAfter,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return false;
    });
    return {
      ok: true,
      state: "superseded",
      replay,
      graceHours: MEDIA_CONTRACTS[plan.kind].retention.supersededGraceHours,
    };
  }
);

export const task07AbandonMediaAsset = onCall(
  {region: REGION, timeoutSeconds: 30},
  async (request: CallableRequest<AssetRequest>) => {
    const {actor, ref, plan} = await requireOwnedManifest(request);
    const db = admin.firestore();
    const queueRef = cleanupRef(db, plan.assetId);
    const referenceRef = db.doc(task07MediaReferencePath(plan));
    const state = await db.runTransaction(async (transaction) => {
      const [current, queue, reference] = await transaction.getAll(
        ref,
        queueRef,
        referenceRef
      );
      if (!current.exists || current.get("actorUid") !== plan.actorUid) {
        fail("not-found", "Media asset not found.");
      }
      const currentState = asTrimmedString(current.get("state"));
      if (currentState === "cleaned") return "cleaned";
      if (reference.exists &&
        containsTask07MediaPath(reference.data(), plan.originalPath)) {
        fail(
          "failed-precondition",
          "Remove the committed media reference before abandoning this asset."
        );
      }
      const queueState = asTrimmedString(queue.get("state"));
      if (currentState === "cleanup-pending" &&
        ["pending", "processing"].includes(queueState)) {
        return "cleanup-pending";
      }
      if (!isTask07MediaStateAbandonable(currentState)) {
        fail("failed-precondition", "Media asset cannot be abandoned now.");
      }
      const rawAttempts = Number(queue.get("attempts"));
      const attempts = Number.isSafeInteger(rawAttempts) && rawAttempts >= 0 ?
        rawAttempts :
        0;
      const queueData: admin.firestore.DocumentData = {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId: plan.assetId,
        actorUid: plan.actorUid,
        requestedBy: actor.uid,
        state: "pending",
        attempts,
        deletionVerified: false,
        reason: "explicit-abandon",
        retryAfter: admin.firestore.FieldValue.delete(),
        errorCode: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!queue.exists) {
        queueData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }
      transaction.set(queueRef, queueData, {merge: true});
      transaction.update(ref, {
        state: "cleanup-pending",
        cleanupRequestedBy: actor.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return "cleanup-pending";
    });
    return {ok: true, state};
  }
);

export const task07RetryMediaCleanup = onCall(
  {region: REGION, timeoutSeconds: 30},
  async (request: CallableRequest<AssetRequest>) => {
    const {actor, ref, plan} = await requireRetirableManifest(request);
    const db = admin.firestore();
    const queueRef = cleanupRef(db, plan.assetId);
    const referenceRef = db.doc(task07MediaReferencePath(plan));
    const replay = await db.runTransaction(async (transaction) => {
      const [queue, reference] = await transaction.getAll(
        queueRef,
        referenceRef
      );
      const queueState = asTrimmedString(queue.get("state"));
      if (["pending", "processing"].includes(queueState)) return true;
      if (!queue.exists || ![
        "failed",
        "blocked-reference",
        "exhausted",
      ].includes(
        asTrimmedString(queue.get("state"))
      )) fail("failed-precondition", "Media cleanup is not retryable.");
      if (reference.exists &&
        containsTask07MediaPath(reference.data(), plan.originalPath)) {
        fail(
          "failed-precondition",
          "Remove the committed media reference before retrying cleanup."
        );
      }
      transaction.update(queueRef, {
        state: "pending",
        requestedBy: actor.uid,
        deletionVerified: false,
        manualRetryAt: admin.firestore.FieldValue.serverTimestamp(),
        retryAfter: admin.firestore.FieldValue.delete(),
        processingAt: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorCode: admin.firestore.FieldValue.delete(),
      });
      transaction.update(ref, {
        state: "cleanup-pending",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return false;
    });
    return {ok: true, state: "cleanup-pending", replay};
  }
);

type Task07ReferenceClosureEntry = {
  snapshot: admin.firestore.DocumentSnapshot;
  plan: MediaUploadPlan;
};

type Task07ReferenceRemovalInput = {
  referenceRef: admin.firestore.DocumentReference;
  beforeValue: admin.firestore.DocumentData | undefined;
  afterValue: admin.firestore.DocumentData | undefined;
  afterExists: boolean;
  requestedBy: string;
  reason: string;
};

const failTask07ReferenceInvariant = (message: string): never => {
  throw new Error(message);
};

const TASK07_CLEANUP_QUEUE_STATES = new Set([
  "pending",
  "processing",
  "blocked-reference",
  "failed",
  "exhausted",
  "completed",
]);

const requireTask07CleanupQueueIdentity = (
  queue: admin.firestore.DocumentSnapshot,
  plan: MediaUploadPlan
): void => {
  if (!queue.exists) return;
  const attempts = Number(queue.get("attempts"));
  if (queue.id !== plan.assetId ||
    queue.get("schemaVersion") !== MEDIA_SCHEMA_VERSION ||
    queue.get("assetId") !== plan.assetId ||
    queue.get("actorUid") !== plan.actorUid ||
    !asTrimmedString(queue.get("requestedBy")) ||
    !asTrimmedString(queue.get("reason")) ||
    !TASK07_CLEANUP_QUEUE_STATES.has(
      asTrimmedString(queue.get("state"))
    ) ||
    !Number.isSafeInteger(attempts) ||
    attempts < 0 ||
    typeof queue.get("deletionVerified") !== "boolean") {
    failTask07ReferenceInvariant(
      "Task07 cleanup queue identity or state is malformed."
    );
  }
};

const clearTask07DeletedUserTokenProjection = async (
  uid: string
): Promise<void> => {
  if (!isSafeMediaSegment(uid)) {
    failTask07ReferenceInvariant(
      "Task07 deleted user projection has an invalid owner identifier."
    );
  }
  const db = admin.firestore();
  const projectionRef = db.doc(`grigliata_tokens/${uid}`);
  await db.runTransaction(async (transaction) => {
    const projection = await transaction.get(projectionRef);
    if (!projection.exists ||
      !shouldClearTask07DeletedUserTokenProjection(
        uid,
        projection.data()
      )) {
      return;
    }
    transaction.update(projectionRef, {
      media: admin.firestore.FieldValue.delete(),
      imageUrl: "",
      imagePath: "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: "system-user-deletion",
    });
  });
};

const requireExactTask07ReferenceManifest = (
  manifest: admin.firestore.DocumentSnapshot,
  referencePath: string,
  expectedMedia: Record<string, unknown>
): MediaUploadPlan => {
  const plan = planFromData(manifest.data());
  const expectedAssetId = expectedMedia.assetId;
  const state = asTrimmedString(manifest.get("state"));
  const storedReferencePath = asTrimmedString(
    manifest.get("referencePath")
  );
  if (!manifest.exists || !plan ||
    manifest.id !== plan.assetId ||
    manifest.get("schemaVersion") !== MEDIA_SCHEMA_VERSION ||
    manifest.get("contractVersion") !== MEDIA_CONTRACT_VERSION ||
    manifest.get("assetId") !== plan.assetId ||
    manifest.get("actorUid") !== plan.actorUid ||
    manifest.get("ownerUid") !== plan.ownerUid ||
    manifest.get("entityId") !== plan.entityId ||
    manifest.get("referenceScope") !== plan.referenceScope ||
    manifest.get("kind") !== plan.kind ||
    manifest.get("previousAssetId") !== plan.previousAssetId ||
    manifest.get("requestHash") !== plan.requestHash ||
    expectedAssetId !== plan.assetId ||
    task07MediaReferencePath(plan) !== referencePath ||
    (
      storedReferencePath &&
      storedReferencePath !== referencePath
    ) ||
    (
      !storedReferencePath &&
      !["ready", "fallback"].includes(state)
    ) ||
    !containsTask07MediaReference(
      {media: manifest.get("media")},
      expectedMedia
    )) {
    return failTask07ReferenceInvariant(
      "Task07 removed reference does not match its canonical manifest."
    );
  }
  return plan;
};

const loadTask07ReferenceClosure = async (
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  rootSnapshot: admin.firestore.DocumentSnapshot,
  rootPlan: MediaUploadPlan
): Promise<Task07ReferenceClosureEntry[]> => {
  const closure: Task07ReferenceClosureEntry[] = [{
    snapshot: rootSnapshot,
    plan: rootPlan,
  }];
  if (!rootPlan.previousAssetId) return closure;
  const visitedAssetIds = new Set<string>([rootPlan.assetId]);
  let nextAssetId = rootPlan.previousAssetId;
  for (let depth = 0;
    depth < MAX_TASK07_REPLACEMENT_CHAIN_DEPTH;
    depth += 1) {
    if (nextAssetId === rootPlan.assetId) return closure;
    if (visitedAssetIds.has(nextAssetId)) {
      failTask07ReferenceInvariant(
        "Task07 removed reference chain contains a cycle."
      );
    }
    visitedAssetIds.add(nextAssetId);
    const snapshot = await transaction.get(assetRef(db, nextAssetId));
    const plan = requireReferenceCompatibleMediaManifest(
      rootPlan,
      snapshot
    );
    closure.push({snapshot, plan});
    const supersededByAssetId =
      typeof snapshot.get("supersededByAssetId") === "string" ?
        snapshot.get("supersededByAssetId") :
        "";
    const action = task07MediaRetirementChainAction({
      replacementAssetId: rootPlan.assetId,
      candidateState: snapshot.get("state"),
      supersededByAssetId,
    });
    if (action === "invalid") {
      failTask07ReferenceInvariant(
        "Task07 removed reference chain has an invalid state."
      );
    }
    if (action !== "follow-supersession") return closure;
    nextAssetId = supersededByAssetId;
  }
  return failTask07ReferenceInvariant(
    "Task07 removed reference chain exceeds the supported depth."
  );
};

const task07ReferenceClosureIds = (
  closure: Task07ReferenceClosureEntry[]
): string[] => closure.map(({plan}) => plan.assetId);

const validateTask07ClosureState = (
  closure: Task07ReferenceClosureEntry[]
): void => {
  closure.forEach(({snapshot}) => {
    const state = asTrimmedString(snapshot.get("state"));
    if (![
      "ready",
      "fallback",
      "referenced",
      "superseded",
      "cleanup-pending",
      "cleanup-failed",
      "cleaned",
    ].includes(state)) {
      failTask07ReferenceInvariant(
        "Task07 removed reference manifest has an invalid cleanup state."
      );
    }
  });
};

const applyTask07ReferenceRemovalGrace = (
  transaction: admin.firestore.Transaction,
  closure: Task07ReferenceClosureEntry[],
  referencePath: string,
  requestedBy: string,
  nowMs: number
): void => {
  validateTask07ClosureState(closure);
  closure.forEach(({snapshot, plan}) => {
    const state = asTrimmedString(snapshot.get("state"));
    if (["cleanup-pending", "cleanup-failed", "cleaned"].includes(state)) {
      return;
    }
    const existingDeleteAfter = timestampMillis(
      snapshot.get("uncommittedDeleteAfter")
    );
    if (state === "superseded" && Number.isFinite(existingDeleteAfter)) {
      return;
    }
    const graceHours =
      MEDIA_CONTRACTS[plan.kind].retention.supersededGraceHours;
    const update: admin.firestore.DocumentData = {
      uncommittedDeleteAfter: admin.firestore.Timestamp.fromMillis(
        nowMs + graceHours * 60 * 60 * 1000
      ),
      referencePath,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (state !== "superseded") {
      update.state = "superseded";
      update.supersededBy = requestedBy;
      update.supersededByAssetId =
        admin.firestore.FieldValue.delete();
      update.supersededAt =
        admin.firestore.FieldValue.serverTimestamp();
    }
    transaction.update(snapshot.ref, update);
  });
};

const applyTask07ImmediateReferenceCleanup = async (
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  closure: Task07ReferenceClosureEntry[],
  referencePath: string,
  requestedBy: string,
  reason: string
): Promise<void> => {
  validateTask07ClosureState(closure);
  const queueRefs = closure.map(({plan}) => (
    cleanupRef(db, plan.assetId)
  ));
  const queues = await transaction.getAll(...queueRefs);
  queues.forEach((queue, index) => {
    requireTask07CleanupQueueIdentity(queue, closure[index].plan);
  });
  closure.forEach(({snapshot, plan}, index) => {
    const state = asTrimmedString(snapshot.get("state"));
    if (state === "cleaned") return;
    const queue = queues[index];
    const queueState = asTrimmedString(queue.get("state"));
    if (!["pending", "processing"].includes(queueState)) {
      const rawAttempts = Number(queue.get("attempts"));
      const attempts =
        Number.isSafeInteger(rawAttempts) && rawAttempts >= 0 ?
          rawAttempts :
          0;
      const queueData: admin.firestore.DocumentData = {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId: plan.assetId,
        actorUid: plan.actorUid,
        requestedBy,
        state: "pending",
        attempts,
        deletionVerified: false,
        reason,
        retryAfter: admin.firestore.FieldValue.delete(),
        processingAt: admin.firestore.FieldValue.delete(),
        completedAt: admin.firestore.FieldValue.delete(),
        deletedPaths: admin.firestore.FieldValue.delete(),
        errorCode: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!queue.exists) {
        queueData.createdAt =
          admin.firestore.FieldValue.serverTimestamp();
      }
      transaction.set(queue.ref, queueData, {merge: true});
    }
    transaction.update(snapshot.ref, {
      state: "cleanup-pending",
      cleanupRequestedBy: requestedBy,
      referencePath,
      uncommittedDeleteAfter: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
};

const handleTask07ReferenceRemoval = async (
  input: Task07ReferenceRemovalInput
): Promise<void> => {
  const initialAction = task07MediaReferenceRemovalAction({
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    currentValue: input.afterValue,
    eventAfterExists: input.afterExists,
    currentExists: input.afterExists,
  });
  if (initialAction === "invalid") {
    failTask07ReferenceInvariant(
      "Task07 reference mutation contains malformed canonical media."
    );
  }
  if (["none", "replacement-present"].includes(initialAction)) return;
  const before = selectTask07CanonicalMediaReference(input.beforeValue);
  if (before.status !== "single" || !before.media || !before.assetId) {
    return failTask07ReferenceInvariant(
      "Task07 reference removal lost its canonical before value."
    );
  }
  const beforeAssetId = before.assetId;
  const beforeMedia = before.media;

  const db = admin.firestore();
  const manifestRef = assetRef(db, beforeAssetId);
  const nowMs = Date.now();
  await db.runTransaction(async (transaction) => {
    const [manifest, currentReference] = await transaction.getAll(
      manifestRef,
      input.referenceRef
    );
    const removedPlan = requireExactTask07ReferenceManifest(
      manifest,
      input.referenceRef.path,
      beforeMedia
    );
    const removedClosure = await loadTask07ReferenceClosure(
      transaction,
      db,
      manifest,
      removedPlan
    );
    const current = selectTask07CanonicalMediaReference(
      currentReference.data()
    );
    if (current.status === "invalid" ||
      current.status === "ambiguous") {
      failTask07ReferenceInvariant(
        "Task07 current reference is malformed or ambiguous."
      );
    }

    let currentOwnsRemovedChain = false;
    if (current.status === "single" &&
      current.media &&
      current.assetId) {
      let currentManifest = removedClosure.find(({plan}) => (
        plan.assetId === current.assetId
      ))?.snapshot;
      if (!currentManifest) {
        currentManifest = await transaction.get(
          assetRef(db, current.assetId)
        );
      }
      const currentPlan = requireExactTask07ReferenceManifest(
        currentManifest,
        input.referenceRef.path,
        current.media
      );
      const currentClosure = await loadTask07ReferenceClosure(
        transaction,
        db,
        currentManifest,
        currentPlan
      );
      currentOwnsRemovedChain = task07MediaAssetChainsIntersect(
        task07ReferenceClosureIds(removedClosure),
        task07ReferenceClosureIds(currentClosure)
      );
    }

    const action = task07MediaReferenceRemovalAction({
      beforeValue: input.beforeValue,
      afterValue: input.afterValue,
      currentValue: currentReference.data(),
      eventAfterExists: input.afterExists,
      currentExists: currentReference.exists,
      currentOwnsRemovedChain,
    });
    if (action === "invalid") {
      failTask07ReferenceInvariant(
        "Task07 reference removal decision is invalid."
      );
    }
    if (["none", "replacement-present"].includes(action)) return;
    if (action === "superseded-grace") {
      applyTask07ReferenceRemovalGrace(
        transaction,
        removedClosure,
        input.referenceRef.path,
        input.requestedBy,
        nowMs
      );
      return;
    }
    await applyTask07ImmediateReferenceCleanup(
      transaction,
      db,
      removedClosure,
      input.referenceRef.path,
      input.requestedBy,
      input.reason
    );
  });
};

const task07ReferenceRemovalTrigger = (
  document: string,
  requestedBy: string,
  reason: string
) => onDocumentWritten(
  {
    document,
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    if (!event.data) return;
    await handleTask07ReferenceRemoval({
      referenceRef: event.data.after.ref,
      beforeValue: event.data.before.data(),
      afterValue: event.data.after.data(),
      afterExists: event.data.after.exists,
      requestedBy,
      reason,
    });
  }
);

export const cleanupTask07RemovedUserMedia = onDocumentWritten(
  {
    document: "users/{uid}",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    if (!event.data) return;
    if (!event.data.after.exists) {
      await clearTask07DeletedUserTokenProjection(event.params.uid);
    }
    await handleTask07ReferenceRemoval({
      referenceRef: event.data.after.ref,
      beforeValue: event.data.before.data(),
      afterValue: event.data.after.data(),
      afterExists: event.data.after.exists,
      requestedBy: "system-user-reference-removal",
      reason: "user-reference-removed",
    });
  }
);

export const cleanupTask07RemovedInventoryMedia =
  task07ReferenceRemovalTrigger(
    "users/{uid}/inventory/{entityId}",
    "system-inventory-reference-removal",
    "inventory-reference-removed"
  );

export const cleanupTask07RemovedCatalogItemMedia =
  task07ReferenceRemovalTrigger(
    "items/{entityId}",
    "system-catalog-reference-removal",
    "catalog-reference-removed"
  );

export const cleanupTask07RemovedNpcMedia =
  task07ReferenceRemovalTrigger(
    "echi_npcs/{entityId}",
    "system-npc-reference-removal",
    "npc-reference-removed"
  );

export const cleanupTask07RemovedFoeMedia =
  task07ReferenceRemovalTrigger(
    "foes/{entityId}",
    "system-foe-reference-removal",
    "foe-reference-removed"
  );

export const cleanupTask07RemovedBackgroundMedia =
  task07ReferenceRemovalTrigger(
    "grigliata_backgrounds/{entityId}",
    "system-background-reference-removal",
    "background-reference-removed"
  );

export const cleanupTask07MediaAsset = onDocumentWritten(
  {
    document: `${MEDIA_CLEANUP_COLLECTION}/{assetId}`,
    region: REGION,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (event) => {
    if (!event.data?.after.exists ||
      event.data.after.get("state") !== "pending") return;
    const db = admin.firestore();
    const queueRef = event.data.after.ref;
    const manifestRef = assetRef(db, event.params.assetId);
    const claimed = await db.runTransaction(async (transaction) => {
      const [queue, manifest] = await transaction.getAll(
        queueRef,
        manifestRef
      );
      const plan = planFromData(manifest.data());
      if (!queue.exists ||
        queue.get("state") !== "pending" ||
        !plan) {
        return null;
      }
      if (manifest.id !== plan.assetId ||
        manifest.get("schemaVersion") !== MEDIA_SCHEMA_VERSION ||
        manifest.get("contractVersion") !== MEDIA_CONTRACT_VERSION ||
        manifest.get("assetId") !== plan.assetId ||
        manifest.get("actorUid") !== plan.actorUid ||
        manifest.get("ownerUid") !== plan.ownerUid ||
        manifest.get("entityId") !== plan.entityId ||
        manifest.get("referenceScope") !== plan.referenceScope ||
        manifest.get("kind") !== plan.kind ||
        manifest.get("previousAssetId") !== plan.previousAssetId ||
        manifest.get("requestHash") !== plan.requestHash ||
        plan.assetId !== event.params.assetId) {
        failTask07ReferenceInvariant(
          "Task07 cleanup manifest identity is malformed."
        );
      }
      requireTask07CleanupQueueIdentity(queue, plan);
      const referencePath = task07MediaReferencePath(plan);
      const referenceRef = db.doc(referencePath);
      const reference = await transaction.get(referenceRef);
      const selectedReference = selectTask07CanonicalMediaReference(
        reference.data()
      );
      const malformedReference = ["invalid", "ambiguous"].includes(
        selectedReference.status
      );
      let sameAssetReference = false;
      if (selectedReference.status === "single") {
        const selectedAssetId = selectedReference.assetId;
        const selectedMedia = selectedReference.media;
        if (!selectedAssetId || !selectedMedia) {
          return failTask07ReferenceInvariant(
            "Task07 selected cleanup reference lost its canonical identity."
          );
        }
        const selectedManifest =
          selectedAssetId === plan.assetId ?
            manifest :
            await transaction.get(
              assetRef(db, selectedAssetId)
            );
        requireExactTask07ReferenceManifest(
          selectedManifest,
          referencePath,
          selectedMedia
        );
        sameAssetReference = selectedAssetId === plan.assetId;
      }
      if (malformedReference ||
        sameAssetReference ||
        containsTask07MediaPath(
          reference.data(),
          plan.originalPath
        )) {
        transaction.update(queueRef, {
          state: "blocked-reference",
          deletionVerified: false,
          referencePath,
          processingAt: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.update(manifestRef, {
          state: "referenced",
          referencePath,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return null;
      }
      transaction.update(queueRef, {
        state: "processing",
        attempts: admin.firestore.FieldValue.increment(1),
        processingAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      transaction.update(manifestRef, {
        state: "cleanup-pending",
        cleanupReferenceCheckedAt:
          admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return plan;
    });
    if (!claimed) return;

    try {
      const paths = task07MediaCleanupPaths(claimed);
      const bucket = getStorage().bucket();
      await mapMediaCleanupWithConcurrency(
        paths,
        MEDIA_CLEANUP_CONCURRENCY,
        async (path) => bucket.file(path).delete({ignoreNotFound: true})
      );
      const verification = await mapMediaCleanupWithConcurrency(
        paths,
        MEDIA_CLEANUP_CONCURRENCY,
        async (path) => bucket.file(path).exists()
      );
      if (verification.some(([exists]) => exists)) {
        throw new Error("storage-delete-not-verified");
      }
      await db.runTransaction(async (transaction) => {
        transaction.update(queueRef, {
          state: "completed",
          deletionVerified: true,
          deletedPaths: paths,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          errorCode: admin.firestore.FieldValue.delete(),
        });
        transaction.update(manifestRef, {
          state: "cleaned",
          cleanedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      const errorCode = error instanceof Error ?
        error.message.slice(0, 500) :
        "media-cleanup-failed";
      console.error("Task07 media cleanup failed", {
        assetId: event.params.assetId,
        error,
      });
      await db.runTransaction(async (transaction) => {
        const queue = await transaction.get(queueRef);
        if (!queue.exists) return;
        const attempts = Number(queue.get("attempts"));
        const exhausted = Number.isSafeInteger(attempts) &&
          attempts >= MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS;
        const queueData: admin.firestore.DocumentData = {
          state: exhausted ? "exhausted" : "failed",
          deletionVerified: false,
          errorCode,
          processingAt: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (!exhausted) {
          queueData.retryAfter = admin.firestore.Timestamp.fromMillis(
            Date.now() + task07CleanupRetryDelayMs(attempts)
          );
        }
        transaction.update(queueRef, queueData);
        transaction.update(manifestRef, {
          state: "cleanup-failed",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    }
  }
);

const queueExpiredTask07MediaAsset = async (
  manifestRef: admin.firestore.DocumentReference,
  nowMs: number
): Promise<boolean> => {
  const db = admin.firestore();
  return db.runTransaction(async (transaction) => {
    const initial = await transaction.get(manifestRef);
    const plan = planFromData(initial.data());
    if (!initial.exists || !plan) return false;
    const queueRef = cleanupRef(db, plan.assetId);
    const referencePath = task07MediaReferencePath(plan);
    const referenceRef = db.doc(referencePath);
    const previousRef = plan.previousAssetId ?
      assetRef(db, plan.previousAssetId) :
      null;
    const snapshots = previousRef ?
      await transaction.getAll(queueRef, referenceRef, previousRef) :
      await transaction.getAll(queueRef, referenceRef);
    const [queue, reference, previous] = snapshots;
    const state = asTrimmedString(initial.get("state"));
    const expiresAt = timestampMillis(initial.get("uncommittedDeleteAfter"));
    if (reference.exists &&
      shouldRecoverCommittedTask07MediaReference({
        state,
        referenceValue: reference.data(),
        expectedMedia: initial.get("media"),
      })) {
      await stagePreviousMediaRetirement(
        transaction,
        db,
        plan,
        previous,
        nowMs
      );
      transaction.update(manifestRef, {
        state: "referenced",
        referencePath,
        referencedAt: admin.firestore.FieldValue.serverTimestamp(),
        uncommittedDeleteAfter: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return true;
    }
    if (!Number.isFinite(expiresAt) || expiresAt > nowMs ||
      ["referenced", "cleaned", "cleanup-pending", "finalizing"]
        .includes(state) ||
      queue.exists) {
      return false;
    }
    if (!["prepared", "failed", "ready", "fallback", "superseded"].includes(state)) {
      return false;
    }
    transaction.create(queueRef, {
      schemaVersion: MEDIA_SCHEMA_VERSION,
      assetId: plan.assetId,
      actorUid: plan.actorUid,
      requestedBy: "system-orphan-sweep",
      state: "pending",
      attempts: 0,
      deletionVerified: false,
      reason: state === "superseded" ?
        "superseded-grace-expired" :
        "expired-uncommitted",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(manifestRef, {
      state: "cleanup-pending",
      cleanupRequestedBy: "system-orphan-sweep",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
};

const retryFailedTask07Cleanup = async (
  queueRef: admin.firestore.DocumentReference,
  nowMs: number
): Promise<boolean> => {
  const db = admin.firestore();
  return db.runTransaction(async (transaction) => {
    const queue = await transaction.get(queueRef);
    if (!queue.exists || queue.get("state") !== "failed") return false;
    const attempts = Number(queue.get("attempts"));
    if (!Number.isSafeInteger(attempts) ||
      attempts >= MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS) {
      transaction.update(queueRef, {
        state: "exhausted",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return false;
    }
    const retryAfter = timestampMillis(queue.get("retryAfter"));
    if (Number.isFinite(retryAfter) && retryAfter > nowMs) return false;
    transaction.update(queueRef, {
      state: "pending",
      retryAfter: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
};

const recoverStaleTask07Cleanup = async (
  queueRef: admin.firestore.DocumentReference,
  nowMs: number
): Promise<boolean> => {
  const db = admin.firestore();
  return db.runTransaction(async (transaction) => {
    const queue = await transaction.get(queueRef);
    if (!queue.exists || !isTask07ProcessingLeaseExpired({
      state: queue.get("state"),
      updatedAtMs: timestampMillis(
        queue.get("processingAt") || queue.get("updatedAt")
      ),
      nowMs,
    })) return false;
    const attempts = Number(queue.get("attempts"));
    transaction.update(queueRef, {
      state: Number.isSafeInteger(attempts) &&
        attempts >= MEDIA_CLEANUP_MAX_AUTO_ATTEMPTS ?
        "exhausted" :
        "pending",
      processingAt: admin.firestore.FieldValue.delete(),
      errorCode: "stale-processing-lease",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
};

const recoverStaleTask07Finalization = async (
  manifestRef: admin.firestore.DocumentReference,
  nowMs: number
): Promise<boolean> => {
  const db = admin.firestore();
  return db.runTransaction(async (transaction) => {
    const manifest = await transaction.get(manifestRef);
    if (!manifest.exists || !isTask07ProcessingLeaseExpired({
      state: manifest.get("state"),
      updatedAtMs: timestampMillis(
        manifest.get("finalizationStartedAt") || manifest.get("updatedAt")
      ),
      nowMs,
      leaseMs: MEDIA_PROCESSING_LEASE_MS,
    })) return false;
    transaction.update(manifestRef, {
      state: "failed",
      errorCode: "stale-finalization-lease",
      finalizationStartedAt: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
};

type MediaRecoveryJob = {
  kind: "expired" | "failed-cleanup" | "stale-cleanup" |
  "stale-finalization";
  ref: admin.firestore.DocumentReference;
};

export const sweepTask07MediaOrphans = onSchedule(
  {
    schedule: "every 15 minutes",
    region: REGION,
    timeoutSeconds: 120,
    memory: "256MiB",
    maxInstances: 1,
  },
  async () => {
    const db = admin.firestore();
    const nowMs = Date.now();
    const now = admin.firestore.Timestamp.fromMillis(nowMs);
    const [expired, failed, processing, finalizing] = await Promise.all([
      db.collection(MEDIA_ASSET_COLLECTION)
        .where("uncommittedDeleteAfter", "<=", now)
        .limit(MEDIA_ORPHAN_SWEEP_BATCH_SIZE)
        .get(),
      db.collection(MEDIA_CLEANUP_COLLECTION)
        .where("state", "==", "failed")
        .limit(MEDIA_ORPHAN_SWEEP_BATCH_SIZE)
        .get(),
      db.collection(MEDIA_CLEANUP_COLLECTION)
        .where("state", "==", "processing")
        .limit(MEDIA_ORPHAN_SWEEP_BATCH_SIZE)
        .get(),
      db.collection(MEDIA_ASSET_COLLECTION)
        .where("state", "==", "finalizing")
        .limit(MEDIA_ORPHAN_SWEEP_BATCH_SIZE)
        .get(),
    ]);
    const jobs: MediaRecoveryJob[] = [
      ...expired.docs.map(({ref}) => ({kind: "expired" as const, ref})),
      ...failed.docs.map(({ref}) => ({
        kind: "failed-cleanup" as const,
        ref,
      })),
      ...processing.docs.map(({ref}) => ({
        kind: "stale-cleanup" as const,
        ref,
      })),
      ...finalizing.docs.map(({ref}) => ({
        kind: "stale-finalization" as const,
        ref,
      })),
    ];
    const outcomes = await mapMediaCleanupWithConcurrency(
      jobs,
      MEDIA_CLEANUP_CONCURRENCY,
      async (job) => {
        switch (job.kind) {
        case "expired":
          return queueExpiredTask07MediaAsset(job.ref, nowMs);
        case "failed-cleanup":
          return retryFailedTask07Cleanup(job.ref, nowMs);
        case "stale-cleanup":
          return recoverStaleTask07Cleanup(job.ref, nowMs);
        case "stale-finalization":
          return recoverStaleTask07Finalization(job.ref, nowMs);
        }
      }
    );
    console.info("Task07 media orphan sweep completed", {
      scanned: jobs.length,
      recovered: outcomes.filter(Boolean).length,
    });
  }
);
