import {randomUUID} from "crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {mapWithConcurrency} from "./backendOperationCore";
import {
  buildFoeRetirementFinalDocument,
  buildFoeRetirementUploadPlans,
  collectFoeLegacyStoragePaths,
  FoeMediaRetirementContractError,
  FoeRetirementResolvedUpload,
  FoeRetirementUploadPlan,
  foeTimestampsMatch,
  isSafeFoeStoragePath,
  legacyFoeCleanupCandidates,
  materializeFoeRetirementMutation,
  normalizeFoeTimestamp,
  sanitizeFoeRetirementMutation,
  SanitizedFoeRetirementMutation,
} from "./foeMediaRetirementCore";
import {
  isLegacyCleanupClaimable,
  LEGACY_CLEANUP_SWEEP_STATES,
  settleUnfencedLegacyCleanup,
} from "./foeMediaRetirementCleanupCore";
import {
  adminFoeRetirementStorage,
  FoeRetirementStorageError,
  TASK07_FOE_UPLOAD_VERIFY_CONCURRENCY,
  verifyFoeRetirementUploads,
} from "./foeMediaRetirementStorage";
import {
  asStoredTask07MediaUploadPlan,
  task07MediaReferencePath,
} from "./mediaAssetLifecycleCore";
import {MEDIA_CONTRACTS, MEDIA_SCHEMA_VERSION} from "./mediaContracts";
import {
  task07FoeCanonicalMediaStateFromTarget,
  task07FoeCanonicalRetirementPatch,
} from "./mediaTargetAdapters";
import {
  assertTask07DemoEmulatorBypassIsExact,
  TASK07_CALLABLE_OPTIONS,
} from "./task07CallableOptions";
import {
  asRecord,
  asTrimmedString,
  hashValue,
  operationReceiptId,
  operationRequestHash,
  validateOperationId,
} from "./userDataV2";

const OPERATION_COLLECTION = "task07_foe_media_operations";
const LEGACY_CLEANUP_COLLECTION = "task07_foe_media_cleanup";
const OPERATION_ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;
const RECEIPT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_LEASE_MS = 10 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 20;

type PrepareRequest = {
  schemaVersion?: number;
  operationId?: string;
  assetId?: string;
  expectedRevision?: number;
  expectedUpdatedAt?: unknown;
  mutation?: unknown;
};

type ReceiptRequest = {
  schemaVersion?: number;
  operationId?: string;
  assetId?: string;
};

type LegacyCleanupEntry = {path: string; generation: string};

function fail(
  code: "unauthenticated" | "permission-denied" | "invalid-argument" |
    "failed-precondition" | "not-found" | "already-exists" | "aborted" |
    "unavailable" | "internal",
  message: string,
  details?: unknown
): never {
  throw new HttpsError(code, message, details);
}

const expiryFromNow = (durationMs: number): Timestamp => (
  Timestamp.fromMillis(Date.now() + durationMs)
);

const requireUid = (request: CallableRequest<unknown>): string => {
  assertTask07DemoEmulatorBypassIsExact();
  const uid = asTrimmedString(request.auth?.uid);
  if (!uid) fail("unauthenticated", "Authentication required.");
  return uid;
};

const actorIsActiveManager = (
  actor: admin.firestore.DocumentSnapshot
): boolean => actor.exists &&
  ["dm", "webmaster"].includes(
    asTrimmedString(actor.get("role")).toLowerCase()
  ) &&
  actor.get("deletionState") !== "pending";

const requireAssetId = (value: unknown): string => {
  const assetId = asTrimmedString(value);
  if (!/^m_[a-f0-9]{40}$/.test(assetId)) {
    fail("invalid-argument", "Media asset ID is invalid.");
  }
  return assetId;
};

const requireReceiptRequest = (
  value: ReceiptRequest
): {operationId: string; assetId: string} => {
  if (value?.schemaVersion !== 1) {
    fail("invalid-argument", "Foe retirement schema version is invalid.");
  }
  const operationId = validateOperationId(value.operationId);
  if (!operationId) {
    fail("invalid-argument", "Foe retirement operation ID is invalid.");
  }
  return {operationId, assetId: requireAssetId(value.assetId)};
};

const receiptRef = (
  db: admin.firestore.Firestore,
  actorUid: string,
  operationId: string
): admin.firestore.DocumentReference => db.doc(
  `${OPERATION_COLLECTION}/${operationReceiptId(actorUid, operationId)}`
);

const asUploadPlans = (value: unknown): FoeRetirementUploadPlan[] => {
  if (!Array.isArray(value)) {
    fail("failed-precondition", "Foe retirement receipt is malformed.");
  }
  return value as FoeRetirementUploadPlan[];
};

const assertReceiptIdentity = (input: {
  receipt: admin.firestore.DocumentSnapshot;
  actorUid: string;
  operationId: string;
  assetId: string;
}): void => {
  if (!input.receipt.exists) {
    fail(
      "not-found",
      "Foe retirement operation was not found.",
      {reason: "receipt-absent", operationId: input.operationId}
    );
  }
  if (input.receipt.get("actorUid") !== input.actorUid ||
    input.receipt.get("operationId") !== input.operationId ||
    input.receipt.get("assetId") !== input.assetId) {
    fail(
      "not-found",
      "Foe retirement operation was not found.",
      {reason: "receipt-identity-mismatch", operationId: input.operationId}
    );
  }
};

const prepareResult = (
  operationId: string,
  receiptId: string,
  assetId: string,
  foeId: string,
  uploads: FoeRetirementUploadPlan[]
) => ({
  schemaVersion: 1,
  status: "pending",
  operationId,
  receiptId,
  assetId,
  foeId,
  uploads: uploads.map((upload) => ({
    key: upload.key,
    path: upload.path,
    bytes: upload.bytes,
    contentType: upload.contentType,
    cacheControl: "private, max-age=31536000, immutable",
    contentDisposition: "inline",
    metadata: upload.metadata,
  })),
});

const completedResult = (
  receipt: admin.firestore.DocumentSnapshot
): Record<string, unknown> => {
  const result = asRecord(receipt.get("result"));
  if (!Object.keys(result).length) {
    fail("failed-precondition", "Completed foe retirement has no result.");
  }
  return result;
};

const mapContractError = (error: unknown): never => {
  if (error instanceof FoeMediaRetirementContractError) {
    fail("invalid-argument", error.message, {reason: error.code});
  }
  throw error;
};

const placeholderUploads = (
  plans: FoeRetirementUploadPlan[]
): FoeRetirementResolvedUpload[] => plans.map((plan) => ({
  key: plan.key,
  path: plan.path,
  url: `https://example.invalid/${"x".repeat(512)}`,
  generation: "1",
}));

export const task07PrepareFoeMediaRetirement = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 30},
  async (request: CallableRequest<PrepareRequest>) => {
    const actorUid = requireUid(request);
    const data = request.data || {};
    if (data.schemaVersion !== 1) {
      fail("invalid-argument", "Foe retirement schema version is invalid.");
    }
    const operationId = validateOperationId(data.operationId);
    const assetId = requireAssetId(data.assetId);
    const expectedRevision = Number(data.expectedRevision);
    if (!operationId || !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      !Object.prototype.hasOwnProperty.call(data, "expectedUpdatedAt")) {
      fail("invalid-argument", "Foe retirement identity is invalid.");
    }
    let expectedUpdatedAt: ReturnType<typeof normalizeFoeTimestamp>;
    try {
      expectedUpdatedAt = normalizeFoeTimestamp(data.expectedUpdatedAt);
    } catch (error) {
      return mapContractError(error);
    }
    const requestHash = operationRequestHash(
      "task07-prepare-foe-media-retirement",
      {
        schemaVersion: 1,
        assetId,
        expectedRevision,
        expectedUpdatedAt,
        mutation: data.mutation,
      }
    );
    const db = admin.firestore();
    const ref = receiptRef(db, actorUid, operationId);
    const receiptId = ref.id;
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists) {
        if (existing.get("actorUid") !== actorUid ||
          existing.get("operationId") !== operationId ||
          existing.get("requestHash") !== requestHash) {
          fail("already-exists", "Foe retirement operation ID is already bound.");
        }
        if (existing.get("status") === "completed") {
          return completedResult(existing);
        }
        if (existing.get("status") === "pending") {
          return prepareResult(
            operationId,
            receiptId,
            assetId,
            asTrimmedString(existing.get("foeId")),
            asUploadPlans(existing.get("uploads"))
          );
        }
        fail(
          "failed-precondition",
          "Foe retirement operation can no longer be prepared."
        );
      }

      const manifestRef = db.doc(`media_assets/${assetId}`);
      const actorRef = db.doc(`users/${actorUid}`);
      const [actor, manifest] = await transaction.getAll(actorRef, manifestRef);
      if (!actorIsActiveManager(actor)) {
        fail(
          "permission-denied",
          "Only active DMs or webmasters may retire foe media."
        );
      }
      const plan = asStoredTask07MediaUploadPlan(manifest.get("plan"));
      if (!manifest.exists || !plan || plan.kind !== "foe" ||
        plan.targetKind !== "foe" || manifest.get("state") !== "attached") {
        fail("failed-precondition", "Attached foe media was not found.");
      }
      const foeId = plan.entityId;
      const foeRef = db.doc(`foes/${foeId}`);
      const foe = await transaction.get(foeRef);
      const current = foe.data() || {};
      const binding = task07FoeCanonicalMediaStateFromTarget(current);
      if (!foe.exists || task07MediaReferencePath(plan) !== `foes/${foeId}` ||
        binding.conflict || binding.assetId !== assetId ||
        binding.revision !== expectedRevision) {
        fail("failed-precondition", "Foe media binding changed.");
      }
      if (!foeTimestampsMatch(expectedUpdatedAt, current.updated_at)) {
        fail("aborted", "Foe document changed while it was being edited.");
      }
      let mutation: SanitizedFoeRetirementMutation;
      try {
        mutation = sanitizeFoeRetirementMutation({
          mutation: data.mutation,
          current,
        });
      } catch (error) {
        return mapContractError(error);
      }
      const uploads = buildFoeRetirementUploadPlans({
        mutation,
        actorUid,
        operationId,
        receiptId,
        foeId,
        assetId,
      });
      try {
        const materialized = materializeFoeRetirementMutation({
          mutation,
          uploads: placeholderUploads(uploads),
        });
        buildFoeRetirementFinalDocument({
          current,
          materialized,
          revision: binding.revision,
          updatedAt: expectedUpdatedAt,
        });
      } catch (error) {
        return mapContractError(error);
      }
      const now = Timestamp.now();
      const result = prepareResult(operationId, receiptId, assetId, foeId, uploads);
      transaction.create(ref, {
        schemaVersion: 1,
        actorUid,
        operationId,
        requestHash,
        assetId,
        foeId,
        expectedRevision,
        expectedUpdatedAt,
        targetHash: hashValue(current),
        mutation,
        uploads,
        uploadsBySlot: Object.fromEntries(uploads.map((upload) => [
          upload.slot,
          {
            path: upload.path,
            fileName: upload.fileName,
            bytes: upload.bytes,
            contentType: upload.contentType,
            digest: upload.sha256,
            metadata: upload.metadata,
          },
        ])),
        oldLegacyPaths: collectFoeLegacyStoragePaths(current),
        status: "pending",
        prepareResult: result,
        cleanupAfter: expiryFromNow(OPERATION_ABANDON_AFTER_MS),
        expiresAt: expiryFromNow(RECEIPT_EXPIRY_MS),
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
);

const legacyCleanupEntries = async (
  paths: unknown
): Promise<LegacyCleanupEntry[]> => {
  const candidates = Array.isArray(paths) ? paths.filter(isSafeFoeStoragePath) : [];
  const storage = adminFoeRetirementStorage();
  const entries = await mapWithConcurrency(
    [...new Set(candidates)],
    TASK07_FOE_UPLOAD_VERIFY_CONCURRENCY,
    async (path): Promise<LegacyCleanupEntry | null> => {
      try {
        const metadata = await storage.getMetadata(path);
        const generation = String(metadata.generation || "");
        if (!/^[1-9][0-9]*$/.test(generation)) {
          throw new FoeRetirementStorageError(
            "legacy-generation-invalid",
            "Legacy foe image generation is invalid.",
            true
          );
        }
        return {path, generation};
      } catch (error) {
        if (storage.isNotFound(error)) return null;
        if (error instanceof FoeRetirementStorageError) throw error;
        throw new FoeRetirementStorageError(
          "legacy-metadata-unavailable",
          "Legacy foe image metadata is unavailable.",
          true
        );
      }
    }
  );
  return entries.filter((entry): entry is LegacyCleanupEntry => Boolean(entry));
};

const mapStorageError = (error: unknown, operationId: string): never => {
  if (error instanceof FoeRetirementStorageError) {
    fail(
      error.retryable ? "unavailable" : "failed-precondition",
      error.message,
      {
        reason: error.code,
        operationId,
        abandonRecommended: !error.retryable,
      }
    );
  }
  throw error;
};

export const task07CommitFoeMediaRetirement = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 120, memory: "512MiB"},
  async (request: CallableRequest<ReceiptRequest>) => {
    const actorUid = requireUid(request);
    const {operationId, assetId} = requireReceiptRequest(request.data || {});
    const db = admin.firestore();
    const ref = receiptRef(db, actorUid, operationId);
    const initial = await ref.get();
    assertReceiptIdentity({receipt: initial, actorUid, operationId, assetId});
    if (initial.get("status") === "completed") {
      return completedResult(initial);
    }
    if (initial.get("status") !== "pending") {
      fail("failed-precondition", "Foe retirement is not pending.");
    }
    const uploadPlans = asUploadPlans(initial.get("uploads"));
    let resolvedUploads: FoeRetirementResolvedUpload[];
    let legacyEntries: LegacyCleanupEntry[];
    try {
      [resolvedUploads, legacyEntries] = await Promise.all([
        verifyFoeRetirementUploads({plans: uploadPlans}),
        legacyCleanupEntries(initial.get("oldLegacyPaths")),
      ]);
    } catch (error) {
      return mapStorageError(error, operationId);
    }

    const foeId = asTrimmedString(initial.get("foeId"));
    const foeRef = db.doc(`foes/${foeId}`);
    const manifestRef = db.doc(`media_assets/${assetId}`);
    const actorRef = db.doc(`users/${actorUid}`);
    const canonicalCleanupRef = db.doc(`media_asset_cleanup/${assetId}`);
    const legacyCleanupRef = db.doc(`${LEGACY_CLEANUP_COLLECTION}/${ref.id}`);
    let committedResult: Record<string, unknown> = {};
    await db.runTransaction(async (transaction) => {
      const receipt = await transaction.get(ref);
      assertReceiptIdentity({receipt, actorUid, operationId, assetId});
      if (receipt.get("status") === "completed") {
        committedResult = completedResult(receipt);
        return;
      }
      if (receipt.get("status") !== "pending") {
        fail("aborted", "Foe retirement ownership changed.");
      }
      const [actor, foe, manifest] = await transaction.getAll(
        actorRef,
        foeRef,
        manifestRef
      );
      if (!actorIsActiveManager(actor)) {
        fail(
          "permission-denied",
          "Only active DMs or webmasters may retire foe media."
        );
      }
      const current = foe.data() || {};
      if (!foe.exists || hashValue(current) !== receipt.get("targetHash")) {
        fail("aborted", "Foe document changed before retirement commit.");
      }
      const plan = asStoredTask07MediaUploadPlan(manifest.get("plan"));
      const binding = task07FoeCanonicalMediaStateFromTarget(current);
      const expectedRevision = Number(receipt.get("expectedRevision"));
      if (!manifest.exists || !plan || plan.kind !== "foe" ||
        plan.targetKind !== "foe" || plan.entityId !== foeId ||
        task07MediaReferencePath(plan) !== `foes/${foeId}` ||
        manifest.get("state") !== "attached" ||
        binding.conflict || binding.assetId !== assetId ||
        binding.revision !== expectedRevision) {
        fail("aborted", "Foe media binding changed before commit.");
      }
      let mutation: SanitizedFoeRetirementMutation;
      try {
        mutation = sanitizeFoeRetirementMutation({
          mutation: receipt.get("mutation"),
          current,
        });
      } catch (error) {
        return mapContractError(error);
      }
      const expectedUploads = buildFoeRetirementUploadPlans({
        mutation,
        actorUid,
        operationId,
        receiptId: ref.id,
        foeId,
        assetId,
      });
      if (hashValue(expectedUploads) !== hashValue(receipt.get("uploads")) ||
        hashValue(expectedUploads.map(({key, path}) => ({key, path}))) !==
          hashValue(resolvedUploads.map(({key, path}) => ({key, path})))) {
        fail("failed-precondition", "Foe upload plan changed before commit.");
      }
      const now = Timestamp.now();
      let materialized;
      let finalDocument;
      try {
        materialized = materializeFoeRetirementMutation({
          mutation,
          uploads: resolvedUploads,
        });
        finalDocument = buildFoeRetirementFinalDocument({
          current,
          materialized,
          revision: binding.revision,
          updatedAt: now,
        });
      } catch (error) {
        return mapContractError(error);
      }
      const cleanupAfter = Timestamp.fromMillis(
        Date.now() +
        MEDIA_CONTRACTS.foe.retention.supersededGraceHours * 60 * 60 * 1000
      );
      transaction.update(foeRef, {
        ...materialized.fields,
        tecniche: materialized.tecniche,
        spells: materialized.spells,
        updated_at: now,
        ...task07FoeCanonicalRetirementPatch({
          revision: binding.revision,
          timestamp: now,
        }),
      });
      transaction.update(manifestRef, {
        state: "superseded",
        retention: {supersededAt: now, cleanupAfter},
        updatedAt: now,
      });
      transaction.set(canonicalCleanupRef, {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId,
        state: "pending",
        reason: "retired",
        attempts: 0,
        cleanupAfter,
        createdAt: now,
        updatedAt: now,
      }, {merge: false});
      const candidates = new Set(legacyFoeCleanupCandidates({
        before: current,
        after: finalDocument,
      }));
      const cleanupEntries = legacyEntries.filter(({path}) => candidates.has(path));
      if (cleanupEntries.length) {
        transaction.set(legacyCleanupRef, {
          schemaVersion: 1,
          receiptId: ref.id,
          foeId,
          state: "pending",
          attempts: 0,
          entries: cleanupEntries,
          remaining: cleanupEntries,
          cleanupAfter: now,
          expiresAt: expiryFromNow(RECEIPT_EXPIRY_MS),
          createdAt: now,
          updatedAt: now,
        }, {merge: false});
      }
      committedResult = {
        schemaVersion: 1,
        status: "completed",
        operationId,
        assetId,
        foeId,
        revision: binding.revision + 1,
        updatedAt: {seconds: now.seconds, nanoseconds: now.nanoseconds},
      };
      transaction.update(ref, {
        status: "completed",
        result: committedResult,
        completedAt: now,
        cleanupAfter: FieldValue.delete(),
        cleanupLeaseOwner: FieldValue.delete(),
        cleanupLeaseUntil: FieldValue.delete(),
        expiresAt: expiryFromNow(RECEIPT_EXPIRY_MS),
        updatedAt: now,
      });
      return undefined;
    });
    if (await legacyCleanupRef.get().then((snapshot) => snapshot.exists)) {
      await processLegacyCleanup(ref.id).catch((error) => {
        console.error("Task07 foe legacy cleanup deferred", error);
      });
    }
    return committedResult;
  }
);

const cleanupRetryAt = (attempts: number): Timestamp => (
  Timestamp.fromMillis(
    Date.now() + Math.min(60 * 60 * 1000, 30_000 * (2 ** attempts))
  )
);

const cleanupOperationUploads = async (receiptId: string): Promise<boolean> => {
  const db = admin.firestore();
  const ref = db.doc(`${OPERATION_COLLECTION}/${receiptId}`);
  const owner = randomUUID();
  const claim = await db.runTransaction(async (transaction) => {
    const receipt = await transaction.get(ref);
    if (!receipt.exists || receipt.get("status") === "completed" ||
      !["pending", "cleanup-pending"].includes(
        asTrimmedString(receipt.get("status"))
      )) return null;
    const cleanupAfter = receipt.get("cleanupAfter");
    if (cleanupAfter instanceof Timestamp &&
      cleanupAfter.toMillis() > Date.now()) return null;
    const leaseUntil = receipt.get("cleanupLeaseUntil");
    if (leaseUntil instanceof Timestamp &&
      leaseUntil.toMillis() > Date.now()) return null;
    const uploads = asUploadPlans(receipt.get("uploads"));
    const rawRemaining = receipt.get("cleanupRemainingKeys");
    const remainingKeys: string[] = Array.isArray(rawRemaining) ?
      rawRemaining : uploads.map(({key}) => key);
    transaction.update(ref, {
      status: "cleanup-pending",
      cleanupLeaseOwner: owner,
      cleanupLeaseUntil: expiryFromNow(CLEANUP_LEASE_MS),
      updatedAt: Timestamp.now(),
    });
    return {
      attempts: Number(receipt.get("cleanupAttempts") || 0),
      uploads: uploads.filter(({key}) => remainingKeys.includes(key)),
    };
  });
  if (!claim) return false;
  const storage = adminFoeRetirementStorage();
  const results = await mapWithConcurrency(
    claim.uploads,
    TASK07_FOE_UPLOAD_VERIFY_CONCURRENCY,
    async (plan) => {
      try {
        const [verified] = await verifyFoeRetirementUploads({
          plans: [plan],
          storage,
        });
        await storage.deleteGeneration(plan.path, verified.generation);
        try {
          await storage.getMetadata(plan.path);
          return {key: plan.key, deleted: false};
        } catch (error) {
          return {key: plan.key, deleted: storage.isNotFound(error)};
        }
      } catch (error) {
        if (storage.isNotFound(error) || (
          error instanceof FoeRetirementStorageError &&
          error.code === "foe-upload-missing"
        )) {
          return {key: plan.key, deleted: true};
        }
        return {key: plan.key, deleted: false};
      }
    }
  );
  const remainingKeys = results
    .filter(({deleted}) => !deleted)
    .map(({key}) => key);
  await db.runTransaction(async (transaction) => {
    const receipt = await transaction.get(ref);
    if (!receipt.exists || receipt.get("status") === "completed" ||
      receipt.get("cleanupLeaseOwner") !== owner) return;
    const now = Timestamp.now();
    if (!remainingKeys.length) {
      transaction.update(ref, {
        status: "abandoned",
        cleanupAttempts: claim.attempts + 1,
        cleanupRemainingKeys: [],
        cleanupAfter: FieldValue.delete(),
        cleanupLeaseOwner: FieldValue.delete(),
        cleanupLeaseUntil: FieldValue.delete(),
        expiresAt: expiryFromNow(RECEIPT_EXPIRY_MS),
        updatedAt: now,
      });
    } else {
      transaction.update(ref, {
        status: "cleanup-pending",
        cleanupAttempts: claim.attempts + 1,
        cleanupRemainingKeys: remainingKeys,
        cleanupAfter: cleanupRetryAt(claim.attempts),
        cleanupLeaseOwner: FieldValue.delete(),
        cleanupLeaseUntil: FieldValue.delete(),
        expiresAt: expiryFromNow(RECEIPT_EXPIRY_MS),
        updatedAt: now,
      });
    }
  });
  return true;
};

export const task07AbandonFoeMediaRetirement = onCall(
  {...TASK07_CALLABLE_OPTIONS, timeoutSeconds: 60},
  async (request: CallableRequest<ReceiptRequest>) => {
    const actorUid = requireUid(request);
    const {operationId, assetId} = requireReceiptRequest(request.data || {});
    const db = admin.firestore();
    const ref = receiptRef(db, actorUid, operationId);
    const outcome = await db.runTransaction(async (transaction) => {
      const receipt = await transaction.get(ref);
      assertReceiptIdentity({receipt, actorUid, operationId, assetId});
      if (receipt.get("status") === "completed") return completedResult(receipt);
      if (receipt.get("status") === "abandoned") {
        return {schemaVersion: 1, status: "abandoned", operationId, assetId};
      }
      if (!["pending", "cleanup-pending"].includes(
        asTrimmedString(receipt.get("status"))
      )) {
        fail("failed-precondition", "Foe retirement cannot be abandoned.");
      }
      const now = Timestamp.now();
      transaction.update(ref, {
        status: "cleanup-pending",
        cleanupAfter: now,
        expiresAt: expiryFromNow(RECEIPT_EXPIRY_MS),
        updatedAt: now,
      });
      return {
        schemaVersion: 1,
        status: "cleanup-pending",
        operationId,
        assetId,
      };
    });
    if (outcome.status === "completed" || outcome.status === "abandoned") {
      return outcome;
    }
    await cleanupOperationUploads(ref.id);
    const settled = await ref.get();
    return settled.get("status") === "completed" ?
      completedResult(settled) : {
        ...outcome,
        status: asTrimmedString(settled.get("status")) || outcome.status,
      };
  }
);

const processLegacyCleanup = async (receiptId: string): Promise<boolean> => {
  const db = admin.firestore();
  const ref = db.doc(`${LEGACY_CLEANUP_COLLECTION}/${receiptId}`);
  const owner = randomUUID();
  const claim = await db.runTransaction(async (transaction) => {
    const cleanup = await transaction.get(ref);
    if (!cleanup.exists) return null;
    const cleanupAfter = cleanup.get("cleanupAfter");
    const leaseUntil = cleanup.get("leaseUntil");
    if (!isLegacyCleanupClaimable({
      state: asTrimmedString(cleanup.get("state")),
      nowMs: Date.now(),
      cleanupAfterMs: cleanupAfter instanceof Timestamp ?
        cleanupAfter.toMillis() : null,
      leaseUntilMs: leaseUntil instanceof Timestamp ?
        leaseUntil.toMillis() : null,
    })) return null;
    const rawRemaining = cleanup.get("remaining");
    const remaining: LegacyCleanupEntry[] = Array.isArray(rawRemaining) ?
      rawRemaining : [];
    const nextLeaseUntil = expiryFromNow(CLEANUP_LEASE_MS);
    transaction.update(ref, {
      state: "processing",
      leaseOwner: owner,
      leaseUntil: nextLeaseUntil,
      // Keep expired processing work discoverable through the existing
      // state/cleanupAfter composite index without polling an active lease.
      cleanupAfter: nextLeaseUntil,
      updatedAt: Timestamp.now(),
    });
    return {
      foeId: asTrimmedString(cleanup.get("foeId")),
      attempts: Number(cleanup.get("attempts") || 0),
      remaining,
    };
  });
  if (!claim) return false;
  // A Storage delete cannot be made atomic with every possible foe reference.
  // Another foe can already share a legacy path, or a client can reintroduce
  // it after a Firestore read. Retain the generation instead of risking a
  // broken live reference.
  const settlement = settleUnfencedLegacyCleanup(claim.remaining);
  await db.runTransaction(async (transaction) => {
    const cleanup = await transaction.get(ref);
    if (!cleanup.exists || cleanup.get("state") !== "processing" ||
      cleanup.get("leaseOwner") !== owner) return;
    const now = Timestamp.now();
    transaction.update(ref, settlement.state === "retained" ? {
      state: settlement.state,
      attempts: claim.attempts + 1,
      remaining: [],
      retained: settlement.retained,
      retainedReason: settlement.retainedReason,
      retainedAt: now,
      cleanupAfter: FieldValue.delete(),
      leaseOwner: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
      // Retained generations have no automated deletion path. Keep their
      // evidence durable until a fenced reconciliation explicitly resolves it.
      expiresAt: FieldValue.delete(),
      updatedAt: now,
    } : {
      state: settlement.state,
      attempts: claim.attempts + 1,
      remaining: [],
      retained: [],
      retainedReason: FieldValue.delete(),
      cleanupAfter: FieldValue.delete(),
      leaseOwner: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
      completedAt: now,
      expiresAt: expiryFromNow(RECEIPT_EXPIRY_MS),
      updatedAt: now,
    });
  });
  return true;
};

export const sweepTask07FoeMediaOperations = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "europe-west8",
    timeZone: "UTC",
    timeoutSeconds: 300,
    memory: "256MiB",
    cpu: 1,
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    const db = admin.firestore();
    const now = Timestamp.now();
    const [operations, legacy] = await Promise.all([
      db.collection(OPERATION_COLLECTION)
        .where("status", "in", ["pending", "cleanup-pending"])
        .where("cleanupAfter", "<=", now)
        .orderBy("cleanupAfter", "asc")
        .limit(CLEANUP_BATCH_SIZE)
        .get(),
      db.collection(LEGACY_CLEANUP_COLLECTION)
        .where("state", "in", [...LEGACY_CLEANUP_SWEEP_STATES])
        .where("cleanupAfter", "<=", now)
        .orderBy("cleanupAfter", "asc")
        .limit(CLEANUP_BATCH_SIZE)
        .get(),
    ]);
    await Promise.allSettled([
      ...operations.docs.map((document) => cleanupOperationUploads(document.id)),
      ...legacy.docs.map((document) => processLegacyCleanup(document.id)),
    ]);
  }
);
