import {randomUUID} from "crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import {
  BACKEND_OPERATION_LEASE_MS,
  BACKEND_OPERATION_STORAGE_CONCURRENCY,
  backendOperationExpiry,
  backendOperationReceiptId,
  backendOperationRequestHash,
  isSafeOwnedStoragePath,
  mapWithConcurrency,
  resolveTask06BackendConfig,
  validateBackendOperationId,
} from "./backendOperationCore";
import {
  asFiniteNumber,
  asRecord,
  asTrimmedString,
  hashValue,
  isValidFirestoreDocumentId,
} from "./userDataV2";
import {
  completeServerTelemetry,
  failServerTelemetry,
  startServerTelemetry,
} from "./serverTelemetry";
import {
  duplicateFoeWithAssetsLegacyHandler,
} from "./duplicateFoeWithAssetsLegacy";
import {
  applyLegacyFoeSourcePresenceCheckpoint,
  copyLegacyFoeManifestEntry,
  LegacyFoeCopyResult,
  LegacyFoeCopyStorageError,
} from "./duplicateFoeStorage";
import {
  assessCanonicalOnlyFoeDuplication,
  canonicalFoeClonePlanBudgetIssue,
  classifyFoeNestedEntryIdentities,
  duplicateFoeNestedEntryId,
  foeDuplicationControlFenceMatches,
  stripTask07MediaFromDuplicatedFoe,
} from "./duplicateFoeWithAssetsCore";
import {
  duplicateCleanupCallableCode,
  duplicateCleanupReceiptState,
  isTerminalDuplicateFailureCode,
  resolveRetryOperationAfterCleanup,
} from "./duplicateFoeRecoveryCore";
import {
  buildTask07FoeMediaClonePlan,
  task07CanonicalFoeMediaAssetId,
  task07FoeMediaClonePlansMatch,
  Task07FoeMediaClonePlan,
  Task07MediaClonePlanError,
} from "./mediaAssetCloneCore";
import {
  buildTask07MediaCloneManifest,
  copyTask07CanonicalMediaFamily,
  task07MediaCloneProcessingPatch,
  task07MediaCloneReadyPatch,
  Task07CanonicalCloneResult,
  Task07MediaCloneStorageError,
} from "./mediaAssetClone";
import {
  task07MediaTargetMayReferenceAsset,
  Task07NestedMediaTarget,
} from "./mediaAssetLifecycleCore";
import {
  MEDIA_CONTRACTS,
  MEDIA_SCHEMA_VERSION,
  parseCanonicalMediaPath,
} from "./mediaContracts";
import {
  buildTask07NewTargetAttachment,
} from "./mediaTargetAdapters";
import {task07MediaModeForActor} from "./task07MediaControl";

type DuplicatePayload = {
  sourceFoeId?: string;
  newFoeName?: string;
  operationId?: string;
  idempotencyKey?: string;
};

type CopyResult = LegacyFoeCopyResult;

type ManifestEntry = {
  key: string;
  sourcePath: string;
  destinationPath: string;
  downloadToken: string;
  sourceKnownPresent: boolean;
};

type DuplicateCleanupOutcome = {
  cleanupComplete: boolean;
  retryOperationAfterCleanup: boolean;
};

type CanonicalCleanupOutcome = {
  cleanupComplete: boolean;
  forceTerminal: boolean;
};

type DuplicateClaimMode = "completed" | "cleanup" | "execute";

type DuplicateClaim = {
  mode: DuplicateClaimMode;
  result: Record<string, unknown>;
  manifest: ManifestEntry[];
  source: Record<string, unknown>;
  newFoeId: string;
  clone: Task07FoeMediaClonePlan | null;
  nestedClones: Task07FoeMediaClonePlan[];
  attempt: number;
  retryOperationAfterCleanup: boolean;
  errorClass: string;
  cleanupCanComplete: boolean;
  task07ControlHash: string;
  task07Mode: string;
};

type OwnedCleanupInput = {
  db: admin.firestore.Firestore;
  operationRef: admin.firestore.DocumentReference;
  requestHash: string;
  invocationId: string;
  manifest: ManifestEntry[];
  clone: Task07FoeMediaClonePlan | null;
  nestedClones: Task07FoeMediaClonePlan[];
  newFoeId: string;
  attempt: number;
  errorClass: string;
  retryOperationAfterCleanup: boolean;
  cleanupCanComplete: boolean;
};

type OwnedFailureInput = Omit<
  OwnedCleanupInput,
  "errorClass" | "retryOperationAfterCleanup"
> & {
  error: unknown;
  incrementFailure: boolean;
};

const TASK06_CONFIG_PATH = "app_config/task06_backend";
const TASK07_CONFIG_PATH = "utils/task07_media";
const OPERATION_COLLECTION = "backend_operations";
const LEGACY_REGION = "europe-west1";
const CANONICAL_REGION = "europe-west8";
const DUPLICATE_FUNCTION_TIMEOUT_SECONDS = 60;

const actorSnapshotIsActiveDm = (
  actor: admin.firestore.DocumentSnapshot
): boolean => Boolean(
  actor.exists &&
  actor.get("role") === "dm" &&
  actor.get("deletionState") !== "pending"
);

const assertBoundedCanonicalFoeClones = (
  clones: Task07FoeMediaClonePlan[]
): void => {
  if (canonicalFoeClonePlanBudgetIssue(clones)) {
    throw new HttpsError(
      "failed-precondition",
      "Foe canonical media exceeds the safe duplication limit."
    );
  }
};

const safeName = (value: unknown, fallback: string): string => (
  asTrimmedString(value)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || fallback
);

const guessExtension = (path: string): string => {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(path);
  return match ? match[1].toLowerCase() : "bin";
};

const sourcePath = (value: unknown): string => {
  const path = asTrimmedString(asRecord(value).imagePath);
  return isSafeOwnedStoragePath(path, ["foes/"]) ? path : "";
};

const buildManifest = (
  source: Record<string, unknown>,
  receiptId: string
): ManifestEntry[] => {
  const entries: Array<{key: string; path: string; name: string}> = [];
  const mainPath = sourcePath(source) || sourcePath(asRecord(source.General));
  if (mainPath) {
    entries.push({key: "main", path: mainPath, name: "main"});
  }
  const tecniche = Array.isArray(source.tecniche) ? source.tecniche : [];
  tecniche.forEach((entry, index) => {
    const path = sourcePath(entry);
    if (path) {
      entries.push({
        key: `tecnica:${index}`,
        path,
        name: `tecnica_${index}`,
      });
    }
  });
  const spells = Array.isArray(source.spells) ? source.spells : [];
  spells.forEach((entry, index) => {
    const path = sourcePath(entry);
    if (path) {
      entries.push({
        key: `spell:${index}`,
        path,
        name: `spell_${index}`,
      });
    }
  });
  return entries.map((entry) => ({
    key: entry.key,
    sourcePath: entry.path,
    destinationPath: [
      "foes",
      "operations",
      receiptId,
      `${safeName(entry.name, "asset")}.${guessExtension(entry.path)}`,
    ].join("/"),
    downloadToken: randomUUID(),
    sourceKnownPresent: false,
  }));
};

const storedManifestFromData = (value: unknown): ManifestEntry[] | null => {
  if (!Array.isArray(value)) return null;
  const manifest = value.map((raw) => {
    const entry = asRecord(raw);
    return {
      key: asTrimmedString(entry.key),
      sourcePath: asTrimmedString(entry.sourcePath),
      destinationPath: asTrimmedString(entry.destinationPath),
      downloadToken: asTrimmedString(entry.downloadToken),
      sourceKnownPresent: entry.sourceKnownPresent === true,
    };
  });
  const destinations = new Set<string>();
  for (const entry of manifest) {
    if (!entry.key || !entry.sourcePath || !entry.downloadToken ||
      !isSafeOwnedStoragePath(entry.sourcePath, ["foes/"]) ||
      !isSafeOwnedStoragePath(
        entry.destinationPath,
        ["foes/operations/"]
      ) || destinations.has(entry.destinationPath)) return null;
    destinations.add(entry.destinationPath);
  }
  return manifest;
};

const storedCanonicalCloneFromData = (
  value: unknown,
  newFoeId: string
): Task07FoeMediaClonePlan | null => {
  if (value === null || value === undefined) return null;
  const clone = asRecord(value);
  const destinationAssetId = asTrimmedString(clone.destinationAssetId);
  const entries = Array.isArray(clone.entries) ? clone.entries : [];
  const destinationPaths = new Set<string>();
  const pathsAreBounded = entries.length > 0 && entries.every((raw) => {
    const entry = asRecord(raw);
    const path = asTrimmedString(entry.destinationPath);
    const parsed = parseCanonicalMediaPath(path);
    if (!parsed || parsed.assetId !== destinationAssetId ||
      destinationPaths.has(path)) return false;
    destinationPaths.add(path);
    return true;
  });
  const destinationPlan = asRecord(clone.destinationPlan);
  if (clone.schemaVersion !== 1 ||
    !/^m_[a-f0-9]{40}$/.test(destinationAssetId) ||
    asTrimmedString(clone.destinationFoeId) !== newFoeId ||
    asTrimmedString(clone.destinationReferencePath) !== `foes/${newFoeId}` ||
    asTrimmedString(destinationPlan.assetId) !== destinationAssetId ||
    asTrimmedString(destinationPlan.entityId) !== newFoeId ||
    !pathsAreBounded) return null;
  return value as Task07FoeMediaClonePlan;
};

const storedCanonicalClonesFromData = (
  value: unknown,
  newFoeId: string
): Task07FoeMediaClonePlan[] | null => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const clones = value.map((entry) =>
    storedCanonicalCloneFromData(entry, newFoeId));
  if (clones.some((entry) => !entry)) return null;
  const typed = clones as Task07FoeMediaClonePlan[];
  const assetIds = new Set(typed.map(({destinationAssetId}) =>
    destinationAssetId));
  return assetIds.size === typed.length ? typed : null;
};

const copyManifestEntry = async (
  entry: ManifestEntry
): Promise<CopyResult> => copyLegacyFoeManifestEntry({entry});

const checkpointLegacySourcePresence = async (input: {
  db: admin.firestore.Firestore;
  operationRef: admin.firestore.DocumentReference;
  sourceRef: admin.firestore.DocumentReference;
  task07ConfigRef: admin.firestore.DocumentReference;
  actorUid: string;
  task07ControlHash: string;
  task07Mode: string;
  requestHash: string;
  invocationId: string;
  manifest: ManifestEntry[];
}): Promise<ManifestEntry[]> => {
  if (input.manifest.length === 0) return input.manifest;
  const bucket = getStorage().bucket();
  const pathsToProbe = [...new Set(
    input.manifest
      .filter(({sourceKnownPresent}) => !sourceKnownPresent)
      .map(({sourcePath}) => sourcePath)
  )];
  const observations = await mapWithConcurrency(
    pathsToProbe,
    BACKEND_OPERATION_STORAGE_CONCURRENCY,
    async (path) => {
      try {
        const [exists] = await bucket.file(path).exists();
        return {path, exists};
      } catch {
        throw new LegacyFoeCopyStorageError(
          "legacy-source-state-unavailable",
          "Legacy foe copy source state is unavailable.",
          true
        );
      }
    }
  );
  const presentSourcePaths = new Set([
    ...input.manifest
      .filter(({sourceKnownPresent}) => sourceKnownPresent)
      .map(({sourcePath}) => sourcePath),
    ...observations
      .filter(({exists}) => exists)
      .map(({path}) => path),
  ]);
  const checkpointedManifest = applyLegacyFoeSourcePresenceCheckpoint(
    input.manifest,
    presentSourcePaths
  ) as ManifestEntry[];

  await input.db.runTransaction(async (transaction) => {
    const [operation, source, task07Config] = await transaction.getAll(
      input.operationRef,
      input.sourceRef,
      input.task07ConfigRef
    );
    const currentTask07ControlHash = hashValue(task07Config.data() ?? {});
    const currentTask07Mode = task07MediaModeForActor({
      control: task07Config.data(),
      purpose: "foe",
      role: "dm",
      uid: input.actorUid,
    });
    const storedManifest = operation.exists ?
      storedManifestFromData(operation.get("assetManifest")) : null;
    if (!operation.exists ||
      operation.get("requestHash") !== input.requestHash ||
      operation.get("status") !== "running" ||
      operation.get("phase") !== "copy-assets" ||
      operation.get("leaseOwner") !== input.invocationId ||
      !foeDuplicationControlFenceMatches({
        storedControlHash: operation.get("task07ControlHash"),
        storedMode: operation.get("task07Mode"),
        currentControlHash: currentTask07ControlHash,
        currentMode: currentTask07Mode,
      }) ||
      operation.get("task07ControlHash") !== input.task07ControlHash ||
      operation.get("task07Mode") !== input.task07Mode ||
      !source.exists ||
      operation.get("sourceHash") !== hashValue(source.data() ?? {}) ||
      !storedManifest ||
      hashValue(storedManifest) !== hashValue(input.manifest)) {
      throw new HttpsError(
        "aborted",
        "Foe duplication lost its legacy media checkpoint fence."
      );
    }
    transaction.update(input.operationRef, {
      assetManifest: checkpointedManifest,
      leaseExpiresAt: duplicateLeaseExpiry(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return checkpointedManifest;
};

const cleanupManifest = async (
  manifest: ManifestEntry[],
  protectedPaths: ReadonlySet<string> = new Set()
): Promise<boolean> => {
  const bucket = getStorage().bucket();
  const results = await mapWithConcurrency(
    manifest,
    BACKEND_OPERATION_STORAGE_CONCURRENCY,
    async (entry) => {
      if (!isSafeOwnedStoragePath(
        entry.destinationPath,
        ["foes/operations/"]
      )) return false;
      if (protectedPaths.has(entry.destinationPath)) return true;
      try {
        await bucket.file(entry.destinationPath).delete({
          ignoreNotFound: true,
        });
        return true;
      } catch {
        return false;
      }
    }
  );
  return results.every(Boolean);
};

const protectedDuplicateStoragePaths = (
  target: admin.firestore.DocumentData | undefined,
  manifest: ManifestEntry[]
): ReadonlySet<string> => {
  const candidates = new Set<string>();
  const addPath = (value: unknown): void => {
    const path = asTrimmedString(asRecord(value).imagePath);
    if (path) candidates.add(path);
  };
  addPath(target);
  const targetData = target ?? {};
  const tecniche = Array.isArray(targetData.tecniche) ?
    targetData.tecniche : [];
  const spells = Array.isArray(targetData.spells) ?
    targetData.spells : [];
  tecniche.forEach(addPath);
  spells.forEach(addPath);
  const ownedPaths = new Set(
    manifest.map((entry) => entry.destinationPath)
  );
  return new Set(
    [...candidates].filter((path) => ownedPaths.has(path))
  );
};

const copyByKey = (
  copied: CopyResult[],
  key: string
): CopyResult => copied.find((entry) => entry.key === key) ?? {
  outcome: "missing",
  key,
  path: "",
  url: "",
};

const duplicateLeaseExpiry = (): Timestamp => (
  Timestamp.fromMillis(
    Date.now() + BACKEND_OPERATION_LEASE_MS
  )
);

const hasActiveDuplicateLease = (
  operation: admin.firestore.DocumentSnapshot
): boolean => {
  const leaseOwner = asTrimmedString(operation.get("leaseOwner"));
  const leaseExpiresAt = operation.get("leaseExpiresAt");
  return !!leaseOwner &&
    leaseExpiresAt instanceof Timestamp &&
    leaseExpiresAt.toMillis() > Date.now();
};

const beginOwnedCleanup = async (
  db: admin.firestore.Firestore,
  operationRef: admin.firestore.DocumentReference,
  requestHash: string,
  invocationId: string,
  errorClass: string,
  retryOperationAfterCleanup: boolean,
  incrementFailure: boolean
): Promise<boolean> => db.runTransaction(async (transaction) => {
  const operation = await transaction.get(operationRef);
  if (
    !operation.exists ||
    operation.get("requestHash") !== requestHash ||
    operation.get("status") !== "running" ||
    operation.get("leaseOwner") !== invocationId
  ) return false;
  transaction.update(operationRef, {
    phase: "cleanup",
    retryable: true,
    retryOperationAfterCleanup,
    errorClass,
    ...(incrementFailure ? {
      "progress.failed": FieldValue.increment(1),
    } : {}),
    leaseExpiresAt: duplicateLeaseExpiry(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
});

const finishOwnedCleanup = async (
  db: admin.firestore.Firestore,
  operationRef: admin.firestore.DocumentReference,
  requestHash: string,
  invocationId: string,
  cleanupComplete: boolean
): Promise<DuplicateCleanupOutcome | null> =>
  db.runTransaction(async (transaction) => {
  const operation = await transaction.get(operationRef);
  if (
    !operation.exists ||
    operation.get("requestHash") !== requestHash ||
    operation.get("status") !== "running" ||
    operation.get("phase") !== "cleanup" ||
    operation.get("leaseOwner") !== invocationId
  ) return null;
  const retryOperationAfterCleanup = resolveRetryOperationAfterCleanup(
    operation.get("retryOperationAfterCleanup")
  );
  const receiptState = duplicateCleanupReceiptState({
    cleanupComplete,
    storedRetryOperationAfterCleanup: retryOperationAfterCleanup,
  });
  transaction.update(operationRef, {
    status: receiptState.status,
    retryable: receiptState.retryable,
    ...(cleanupComplete ? {
      retryOperationAfterCleanup: FieldValue.delete(),
    } : {}),
    leaseOwner: FieldValue.delete(),
    leaseExpiresAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {cleanupComplete, retryOperationAfterCleanup};
});

const cloneRetentionExpiry = (): Timestamp => Timestamp.fromMillis(
  Date.now() +
  MEDIA_CONTRACTS.foe.retention.uncommittedHours * 60 * 60 * 1000
);

const loadFoeMediaClonePlan = async (input: {
  transaction: admin.firestore.Transaction;
  db: admin.firestore.Firestore;
  actorUid: string;
  receiptId: string;
  sourceFoeId: string;
  destinationFoeId: string;
  source: Record<string, unknown>;
}): Promise<Task07FoeMediaClonePlan | null> => {
  try {
    const sourceAssetId = task07CanonicalFoeMediaAssetId(input.source);
    const sourceManifest = sourceAssetId ?
      await input.transaction.get(
        input.db.doc(`media_assets/${sourceAssetId}`)
      ) : null;
    return buildTask07FoeMediaClonePlan({
      actorUid: input.actorUid,
      backendReceiptId: input.receiptId,
      destinationFoeId: input.destinationFoeId,
      sourceFoeId: input.sourceFoeId,
      source: input.source,
      sourceManifest: sourceManifest?.data() ?? null,
    });
  } catch (error) {
    if (error instanceof Task07MediaClonePlanError) {
      throw new HttpsError("failed-precondition", error.message);
    }
    throw error;
  }
};

type NestedFoeIdentitySubject = {
  sourceNestedTarget: Task07NestedMediaTarget;
  destinationNestedTarget: Task07NestedMediaTarget;
  sourceAssetId: string | null;
};

type NestedFoeCloneSubject = NestedFoeIdentitySubject & {
  sourceAssetId: string;
};

const nestedFoeIdentitySubjects = (input: {
  source: Record<string, unknown>;
  receiptId: string;
}): NestedFoeIdentitySubject[] => {
  const plan = classifyFoeNestedEntryIdentities(input.source);
  if (plan.issue) {
    throw new Task07MediaClonePlanError(
      plan.issue,
      "Nested foe media identity or registry binding is invalid."
    );
  }
  return plan.entries.map((entry) => {
    const destinationEntryId = duplicateFoeNestedEntryId({
      receiptId: input.receiptId,
      kind: entry.kind,
      sourceEntryId: entry.sourceEntryId,
    });
    return {
      sourceAssetId: entry.sourceAssetId,
      sourceNestedTarget: {
        schemaVersion: 1,
        kind: entry.kind,
        entryId: entry.sourceEntryId,
        entryKey: null,
        entryIndex: entry.entryIndex,
        slot: "media",
      },
      destinationNestedTarget: {
        schemaVersion: 1,
        kind: entry.kind,
        entryId: destinationEntryId,
        entryKey: null,
        entryIndex: entry.entryIndex,
        slot: "media",
      },
    };
  });
};

const nestedFoeCloneSubjects = (input: {
  source: Record<string, unknown>;
  receiptId: string;
}): NestedFoeCloneSubject[] => nestedFoeIdentitySubjects(input)
  .filter((subject): subject is NestedFoeCloneSubject =>
    Boolean(subject.sourceAssetId));

const loadFoeNestedMediaClonePlans = async (input: {
  transaction: admin.firestore.Transaction;
  db: admin.firestore.Firestore;
  actorUid: string;
  receiptId: string;
  sourceFoeId: string;
  destinationFoeId: string;
  source: Record<string, unknown>;
}): Promise<Task07FoeMediaClonePlan[]> => {
  try {
    const subjects = nestedFoeCloneSubjects({
      source: input.source,
      receiptId: input.receiptId,
    });
    const manifests = subjects.length ? await input.transaction.getAll(
      ...subjects.map(({sourceAssetId}) =>
        input.db.doc(`media_assets/${sourceAssetId}`))
    ) : [];
    return subjects.map((subject, index) => {
      const plan = buildTask07FoeMediaClonePlan({
        actorUid: input.actorUid,
        backendReceiptId: input.receiptId,
        destinationFoeId: input.destinationFoeId,
        sourceFoeId: input.sourceFoeId,
        source: input.source,
        sourceManifest: manifests[index]?.data() ?? null,
        sourceNestedTarget: subject.sourceNestedTarget,
        destinationNestedTarget: subject.destinationNestedTarget,
      });
      if (!plan) {
        throw new Task07MediaClonePlanError(
          "source-manifest-invalid",
          "Nested foe canonical media clone plan is unavailable."
        );
      }
      return plan;
    });
  } catch (error) {
    if (error instanceof Task07MediaClonePlanError) {
      throw new HttpsError("failed-precondition", error.message);
    }
    throw error;
  }
};

const canonicalManifestMatches = (
  data: admin.firestore.DocumentData | undefined,
  clone: Task07FoeMediaClonePlan
): boolean => Boolean(
  data &&
  data.schemaVersion === MEDIA_SCHEMA_VERSION &&
  data.policyVersion === clone.destinationPlan.policyVersion &&
  data.assetId === clone.destinationAssetId &&
  data.generation === clone.sourceGeneration &&
  data.purpose === clone.destinationPlan.kind &&
  data.audience === clone.destinationPlan.audienceScope &&
  data.ownerUid === clone.destinationPlan.ownerUid &&
  data.targetKind === clone.destinationPlan.targetKind &&
  data.targetId === clone.destinationPlan.entityId &&
  data.requestHash === clone.destinationPlan.requestHash &&
  hashValue(data.plan) === hashValue(clone.destinationPlan) &&
  task07FoeMediaClonePlansMatch(data.clone, clone)
);

const settleCanonicalCloneCleanup = async (input: {
  db: admin.firestore.Firestore;
  clone: Task07FoeMediaClonePlan | null;
  code: string;
  retryable: boolean;
  attempt: number;
}): Promise<CanonicalCleanupOutcome> => {
  if (!input.clone) {
    return {cleanupComplete: true, forceTerminal: false};
  }
  const clone = input.clone;
  const manifestRef = input.db.doc(
    `media_assets/${clone.destinationAssetId}`
  );
  const targetRef = input.db.doc(clone.destinationReferencePath);
  const cleanupRef = input.db.doc(
    `media_asset_cleanup/${clone.destinationAssetId}`
  );
  return input.db.runTransaction(async (transaction) => {
    const [manifest, target, cleanup] = await transaction.getAll(
      manifestRef,
      targetRef,
      cleanupRef
    );
    const targetReferencesClone = task07MediaTargetMayReferenceAsset(
      target.data(),
      clone.destinationAssetId
    );
    if (targetReferencesClone || manifest.get("state") === "attached") {
      return {cleanupComplete: false, forceTerminal: true};
    }
    if (cleanup.exists) {
      const queueState = asTrimmedString(cleanup.get("state"));
      return {
        cleanupComplete: [
          "pending", "retry", "processing", "complete",
        ].includes(queueState),
        forceTerminal: true,
      };
    }
    const now = Timestamp.now();
    if (!manifest.exists) {
      if (input.retryable) {
        return {cleanupComplete: true, forceTerminal: false};
      }
      const recreated = buildTask07MediaCloneManifest({
        clone,
        now,
        leaseExpiresAt: now,
        cleanupAfter: now,
        attempt: input.attempt,
      });
      delete recreated.processing;
      transaction.create(manifestRef, {
        ...recreated,
        state: "rejected",
        retention: {cleanupAfter: now},
        error: {
          code: input.code,
          retryable: false,
          attempts: input.attempt,
        },
        updatedAt: now,
      });
      transaction.create(cleanupRef, {
        schemaVersion: MEDIA_SCHEMA_VERSION,
        assetId: clone.destinationAssetId,
        state: "pending",
        reason: input.code,
        attempts: 0,
        cleanupAfter: now,
        createdAt: now,
        updatedAt: now,
      });
      return {cleanupComplete: true, forceTerminal: true};
    }
    if (!canonicalManifestMatches(manifest.data(), clone)) {
      return {cleanupComplete: false, forceTerminal: true};
    }
    const state = asTrimmedString(manifest.get("state"));
    if (state === "deleted") {
      return {cleanupComplete: true, forceTerminal: true};
    }
    if (input.retryable && [
      "intent", "processing", "failed", "ready",
    ].includes(state)) {
      if (["intent", "processing", "failed"].includes(state)) {
        transaction.update(manifestRef, {
          state: "failed",
          processing: FieldValue.delete(),
          error: {
            code: input.code,
            retryable: true,
            attempts: Number(manifest.get("error.attempts") || 0),
          },
          updatedAt: now,
        });
      }
      return {cleanupComplete: true, forceTerminal: false};
    }
    const terminalStates = [
      "intent", "processing", "failed", "ready", "rejected",
      "cancelled", "superseded", "cleanup-pending",
    ];
    if (!terminalStates.includes(state)) {
      return {cleanupComplete: false, forceTerminal: true};
    }
    if (!["rejected", "cancelled", "superseded", "cleanup-pending"]
      .includes(state)) {
      transaction.update(manifestRef, {
        state: "rejected",
        processing: FieldValue.delete(),
        retention: {cleanupAfter: now},
        error: {
          code: input.code,
          retryable: false,
          attempts: Number(manifest.get("error.attempts") || 0),
        },
        updatedAt: now,
      });
    }
    transaction.create(cleanupRef, {
      schemaVersion: MEDIA_SCHEMA_VERSION,
      assetId: clone.destinationAssetId,
      state: "pending",
      reason: input.code,
      attempts: 0,
      cleanupAfter: now,
      createdAt: now,
      updatedAt: now,
    });
    return {cleanupComplete: true, forceTerminal: true};
  });
};

const forceOwnedCleanupTerminal = async (
  db: admin.firestore.Firestore,
  operationRef: admin.firestore.DocumentReference,
  requestHash: string,
  invocationId: string
): Promise<boolean> => db.runTransaction(async (transaction) => {
  const operation = await transaction.get(operationRef);
  if (!operation.exists ||
    operation.get("requestHash") !== requestHash ||
    operation.get("status") !== "running" ||
    operation.get("phase") !== "cleanup" ||
    operation.get("leaseOwner") !== invocationId) return false;
  transaction.update(operationRef, {
    retryOperationAfterCleanup: false,
    retryable: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
});

const runOwnedDuplicateCleanup = async (
  input: OwnedCleanupInput
): Promise<DuplicateCleanupOutcome> => {
  let legacyCleanupComplete = false;
  try {
    const target = isValidFirestoreDocumentId(input.newFoeId) ?
      await input.db.doc(`foes/${input.newFoeId}`).get() : null;
    const protectedPaths = protectedDuplicateStoragePaths(
      target?.data(),
      input.manifest
    );
    legacyCleanupComplete = await cleanupManifest(
      input.manifest,
      protectedPaths
    );
  } catch {
    legacyCleanupComplete = false;
  }

  let canonicalCleanup: CanonicalCleanupOutcome = {
    cleanupComplete: true,
    forceTerminal: false,
  };
  try {
    const results = [];
    for (const clone of [
      ...(input.clone ? [input.clone] : []),
      ...input.nestedClones,
    ]) {
      results.push(await settleCanonicalCloneCleanup({
        db: input.db,
        clone,
        code: input.errorClass,
        retryable: input.retryOperationAfterCleanup,
        attempt: input.attempt,
      }));
    }
    canonicalCleanup = {
      cleanupComplete: results.every(({cleanupComplete}) => cleanupComplete),
      forceTerminal: results.some(({forceTerminal}) => forceTerminal),
    };
  } catch {
    canonicalCleanup = {
      cleanupComplete: false,
      forceTerminal: false,
    };
  }

  if (canonicalCleanup.forceTerminal) {
    try {
      await forceOwnedCleanupTerminal(
        input.db,
        input.operationRef,
        input.requestHash,
        input.invocationId
      );
    } catch {
      canonicalCleanup = {...canonicalCleanup, cleanupComplete: false};
    }
  }
  const outcome = await finishOwnedCleanup(
    input.db,
    input.operationRef,
    input.requestHash,
    input.invocationId,
    input.cleanupCanComplete &&
      legacyCleanupComplete &&
      canonicalCleanup.cleanupComplete
  );
  if (!outcome) {
    throw new HttpsError(
      "aborted",
      "Foe duplication ownership changed during cleanup."
    );
  }
  return outcome;
};

const duplicateFailureDisposition = (error: unknown): {
  errorClass: string;
  retryOperationAfterCleanup: boolean;
} => {
  if (error instanceof Task07MediaCloneStorageError) {
    return {
      errorClass: error.code,
      retryOperationAfterCleanup: error.retryable,
    };
  }
  if (error instanceof LegacyFoeCopyStorageError) {
    return {
      errorClass: error.code,
      retryOperationAfterCleanup: error.retryable,
    };
  }
  if (error instanceof HttpsError) {
    const terminal = isTerminalDuplicateFailureCode(error.code);
    return {
      errorClass: terminal ? "conflict" : error.code,
      retryOperationAfterCleanup: !terminal,
    };
  }
  return {
    errorClass: "storage",
    retryOperationAfterCleanup: true,
  };
};

const recoverOwnedDuplicateFailure = async (
  input: OwnedFailureInput
): Promise<DuplicateCleanupOutcome> => {
  const disposition = duplicateFailureDisposition(input.error);
  const ownsCleanup = await beginOwnedCleanup(
    input.db,
    input.operationRef,
    input.requestHash,
    input.invocationId,
    disposition.errorClass,
    disposition.retryOperationAfterCleanup,
    input.incrementFailure
  );
  if (!ownsCleanup) {
    throw new HttpsError(
      "aborted",
      "Foe duplication ownership changed before cleanup."
    );
  }
  return runOwnedDuplicateCleanup({
    ...input,
    errorClass: disposition.errorClass,
    retryOperationAfterCleanup: disposition.retryOperationAfterCleanup,
  });
};

const cleanupOutcomeError = (
  outcome: DuplicateCleanupOutcome
): HttpsError => {
  const code = duplicateCleanupCallableCode(outcome);
  return new HttpsError(
    code,
    code === "failed-precondition" ?
      "Foe duplication was cleaned up and cannot be resumed." :
      outcome.cleanupComplete ?
        "Foe duplication is ready to resume. Retry this operation." :
        "Foe duplication cleanup is still pending. Retry this operation."
  );
};

const duplicateFoeHandler = async (
  request: CallableRequest<DuplicatePayload>,
  requireOperationId: boolean,
  region: string
): Promise<Record<string, unknown>> => {
  const actorUid = asTrimmedString(request.auth?.uid);
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const sourceFoeId = asTrimmedString(request.data?.sourceFoeId);
  const newFoeName = asTrimmedString(request.data?.newFoeName);
  if (!isValidFirestoreDocumentId(sourceFoeId)) {
    throw new HttpsError("invalid-argument", "sourceFoeId is invalid.");
  }
  if (!newFoeName) {
    throw new HttpsError("invalid-argument", "newFoeName is required.");
  }
  const suppliedOperationId = asTrimmedString(
    request.data?.operationId ?? request.data?.idempotencyKey
  );
  if (requireOperationId && !suppliedOperationId) {
    throw new HttpsError("invalid-argument", "operationId is required.");
  }
  const operationId = validateBackendOperationId(
    suppliedOperationId || randomUUID()
  );
  if (!operationId) {
    throw new HttpsError("invalid-argument", "operationId is invalid.");
  }
  const db = admin.firestore();
  const invocationId = randomUUID();
  const receiptId = backendOperationReceiptId(actorUid, operationId);
  const operationRef = db.doc(`${OPERATION_COLLECTION}/${receiptId}`);
  const actorRef = db.doc(`users/${actorUid}`);
  const sourceRef = db.doc(`foes/${sourceFoeId}`);
  const configRef = db.doc(TASK06_CONFIG_PATH);
  const task07ConfigRef = db.doc(TASK07_CONFIG_PATH);
  const requestHash = backendOperationRequestHash("duplicate-foe", {
    sourceFoeId,
    newFoeName,
  });
  const telemetry = startServerTelemetry({
    functionKey: requireOperationId
      ? "duplicateFoeWithAssetsV2"
      : "duplicateFoeWithAssets",
    region,
    invocationType: "callable",
    receiptId,
  });
  let replayed = false;
  const claim = await db.runTransaction(async (
    transaction
  ): Promise<DuplicateClaim> => {
    const [operation, actor, source, configSnapshot, task07Config] =
      await transaction.getAll(
        operationRef,
        actorRef,
        sourceRef,
        configRef,
        task07ConfigRef
      );
    const task06Config = resolveTask06BackendConfig(
      configSnapshot.data()
    );
    const task07ControlHash = hashValue(task07Config.data() ?? {});
    const task07Mode = task07MediaModeForActor({
      control: task07Config.data(),
      purpose: "foe",
      role: "dm",
      uid: actorUid,
    });
    const task07WritesEnabled =
      task07Mode === "v1-write" || task07Mode === "canonical-only";
    const canonicalOnly = task07Mode === "canonical-only";
    if (operation.exists && (
      operation.get("actorUid") !== actorUid ||
      operation.get("kind") !== "duplicate-foe" ||
      operation.get("requestHash") !== requestHash
    )) {
      throw new HttpsError(
        "already-exists",
        "operationId belongs to a different request."
      );
    }
    if (operation.exists && operation.get("status") === "completed") {
      replayed = true;
      return {
        mode: "completed",
        result: asRecord(operation.get("result")),
        manifest: [] as ManifestEntry[],
        source: {},
        newFoeId: asTrimmedString(operation.get("newFoeId")),
        clone: null as Task07FoeMediaClonePlan | null,
        nestedClones: [],
        attempt: Number(operation.get("attempt") || 1),
        retryOperationAfterCleanup: false,
        errorClass: "",
        cleanupCanComplete: true,
        task07ControlHash,
        task07Mode,
      };
    }
    if (operation.exists && hasActiveDuplicateLease(operation)) {
      throw new HttpsError(
        "aborted",
        "This foe duplication is already running."
      );
    }

    const storedNewFoeId = operation.exists ?
      asTrimmedString(operation.get("newFoeId")) : "";
    const rawStoredManifest = operation.exists ?
      operation.get("assetManifest") : undefined;
    const storedManifest = storedManifestFromData(rawStoredManifest);
    const rawStoredClone = operation.exists ?
      operation.get("canonicalMediaClone") : undefined;
    const storedClone = storedCanonicalCloneFromData(
      rawStoredClone,
      storedNewFoeId
    );
    const rawStoredNestedClones = operation.exists ?
      operation.get("canonicalNestedMediaClones") : undefined;
    const storedNestedClones = storedCanonicalClonesFromData(
      rawStoredNestedClones,
      storedNewFoeId
    );
    const cleanupCanComplete = Boolean(
      storedManifest &&
      (rawStoredClone === null || rawStoredClone === undefined || storedClone) &&
      storedNestedClones
    );
    const storedRetryAfterCleanup = resolveRetryOperationAfterCleanup(
      operation.exists ? operation.get("retryOperationAfterCleanup") : true
    );
    const storedAttempt = operation.exists ?
      Math.max(1, Number(operation.get("attempt") || 1)) : 1;
    const claimCleanup = (
      errorClass: string,
      retryOperationAfterCleanup = storedRetryAfterCleanup
    ): DuplicateClaim => {
      transaction.update(operationRef, {
        schemaVersion: 2,
        status: "running",
        phase: "cleanup",
        retryable: true,
        retryOperationAfterCleanup,
        errorClass,
        leaseOwner: invocationId,
        leaseExpiresAt: duplicateLeaseExpiry(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        mode: "cleanup",
        result: {},
        manifest: storedManifest ?? [],
        source: {},
        newFoeId: storedNewFoeId,
        clone: storedClone,
        nestedClones: storedNestedClones ?? [],
        attempt: storedAttempt,
        retryOperationAfterCleanup,
        errorClass,
        cleanupCanComplete,
        task07ControlHash,
        task07Mode,
      };
    };

    if (operation.exists && !foeDuplicationControlFenceMatches({
      storedControlHash: operation.get("task07ControlHash"),
      storedMode: operation.get("task07Mode"),
      currentControlHash: task07ControlHash,
      currentMode: task07Mode,
    })) {
      return claimCleanup("task07-control-drift", false);
    }

    if (operation.exists) {
      const status = asTrimmedString(operation.get("status"));
      const phase = asTrimmedString(operation.get("phase"));
      if (status === "cleanup-pending" ||
        (status === "running" && phase === "cleanup")) {
        return claimCleanup(
          asTrimmedString(operation.get("errorClass")) || "cleanup"
        );
      }
      if (status === "failed" && operation.get("retryable") !== true) {
        throw new HttpsError(
          "failed-precondition",
          "This foe duplication cannot be resumed."
        );
      }
    }

    if (
      requireOperationId &&
      !task06Config.enabledOperationKinds.includes("duplicate-foe")
    ) {
      if (operation.exists) {
        return claimCleanup("task06-disabled", false);
      }
      throw new HttpsError(
        "failed-precondition",
        "Foe duplication V2 is not enabled."
      );
    }

    if (operation.exists && (Boolean(rawStoredClone) ||
      Boolean((storedNestedClones || []).length)) &&
      !task07WritesEnabled) {
      return claimCleanup("task07-disabled", false);
    }

    const actorIsActiveDm = actorSnapshotIsActiveDm(actor);
    if (!operation.exists && !actorIsActiveDm) {
      throw new HttpsError(
        "permission-denied",
        "Only active DMs can duplicate foes."
      );
    }
    if (!source.exists) {
      if (operation.exists) {
        return claimCleanup("source-removed", false);
      }
      throw new HttpsError("not-found", "Source foe not found.");
    }
    const sourceData = source.data() ?? {};
    if (operation.exists &&
      operation.get("sourceHash") !== hashValue(sourceData)) {
      return claimCleanup("source-drift", false);
    }
    if (operation.exists && !cleanupCanComplete) {
      return claimCleanup("receipt-state-invalid", false);
    }
    const newFoeId = operation.exists ?
      storedNewFoeId :
      `dup_${receiptId.slice(0, 24)}`;
    if (!isValidFirestoreDocumentId(newFoeId)) {
      if (operation.exists) {
        return claimCleanup("target-identity-invalid", false);
      }
      throw new HttpsError(
        "failed-precondition",
        "Foe duplication target identity is invalid."
      );
    }
    let clone: Task07FoeMediaClonePlan | null;
    let nestedClones: Task07FoeMediaClonePlan[];
    try {
      clone = await loadFoeMediaClonePlan({
        transaction,
        db,
        actorUid,
        receiptId,
        sourceFoeId,
        destinationFoeId: newFoeId,
        source: sourceData,
      });
      nestedClones = await loadFoeNestedMediaClonePlans({
        transaction,
        db,
        actorUid,
        receiptId,
        sourceFoeId,
        destinationFoeId: newFoeId,
        source: sourceData,
      });
    } catch (error) {
      if (operation.exists && error instanceof HttpsError) {
        return claimCleanup("canonical-source-drift", false);
      }
      throw error;
    }
    if ((clone || nestedClones.length) && !task07WritesEnabled) {
      if (operation.exists) {
        return claimCleanup("task07-disabled", false);
      }
      throw new HttpsError(
        "failed-precondition",
        "Task 07 foe media writes are not enabled."
      );
    }
    if (canonicalOnly) {
      const assessment = assessCanonicalOnlyFoeDuplication(
        sourceData,
        Boolean(clone),
        nestedClones.length > 0
      );
      if (!assessment.allowed) {
        if (operation.exists) {
          return claimCleanup(assessment.reason, false);
        }
        throw new HttpsError(
          "failed-precondition",
          assessment.reason === "nested-media-unsupported" ?
            "Nested foe media must be migrated before canonical-only duplication." :
            "Media-bearing foes require a valid attached canonical Task 07 asset."
        );
      }
    }
    let manifest = operation.exists ?
      storedManifest as ManifestEntry[] :
      buildManifest(sourceData, receiptId);
    if (canonicalOnly) {
      if (operation.exists && manifest.length > 0) {
        return claimCleanup("legacy-manifest-forbidden", false);
      }
      manifest = [];
    }
    const clones = [...(clone ? [clone] : []), ...nestedClones];
    assertBoundedCanonicalFoeClones(clones);
    const cloneManifestRefs = clones.map(({destinationAssetId}) =>
      db.doc(`media_assets/${destinationAssetId}`));
    const cloneCleanupRefs = clones.map(({destinationAssetId}) =>
      db.doc(`media_asset_cleanup/${destinationAssetId}`));
    const newFoeRef = db.doc(`foes/${newFoeId}`);
    const existingTarget = await transaction.get(newFoeRef);
    const cloneSnapshots = clones.length ? await transaction.getAll(
      ...cloneManifestRefs,
      ...cloneCleanupRefs
    ) : [];
    const cloneManifests = cloneSnapshots.slice(0, clones.length);
    const cloneCleanups = cloneSnapshots.slice(clones.length);
    if (existingTarget.exists) {
      if (operation.exists) {
        return claimCleanup("target-already-bound", false);
      }
      throw new HttpsError(
        "already-exists",
        "Foe duplication target already exists."
      );
    }
    if (cloneCleanups.some((snapshot) => snapshot.exists)) {
      if (operation.exists) {
        return claimCleanup("canonical-cleanup-started", false);
      }
      throw new HttpsError(
        "failed-precondition",
        "Canonical media cleanup has already started for this operation."
      );
    }
    if (cloneManifests.some((snapshot, index) => snapshot.exists && (
      !canonicalManifestMatches(snapshot.data(), clones[index]) ||
      !["intent", "processing", "failed", "ready"]
        .includes(asTrimmedString(snapshot.get("state")))
    ))) {
      if (operation.exists) {
        return claimCleanup("canonical-identity-conflict", false);
      }
      throw new HttpsError(
        "already-exists",
        "Canonical media operation identity is already bound."
      );
    }
    if (operation.exists &&
      rawStoredClone !== undefined &&
      !task07FoeMediaClonePlansMatch(
        rawStoredClone,
        clone
      )) {
      return claimCleanup("canonical-plan-drift", false);
    }
    if (operation.exists && rawStoredNestedClones !== undefined &&
      hashValue(rawStoredNestedClones) !== hashValue(nestedClones)) {
      return claimCleanup("canonical-plan-drift", false);
    }
    if (!actorIsActiveDm) {
      throw new HttpsError(
        "permission-denied",
        "Only active DMs can duplicate foes."
      );
    }
    const attempt = operation.exists ?
      Number(operation.get("attempt") || 0) + 1 : 1;
    const now = Timestamp.now();
    const leaseExpiresAt = duplicateLeaseExpiry();
    const cleanupAfter = cloneRetentionExpiry();
    if (operation.exists) {
      transaction.update(operationRef, {
        schemaVersion: 2,
        canonicalMediaClone: clone,
        canonicalNestedMediaClones: nestedClones,
        task07ControlHash,
        task07Mode,
        status: "running",
        phase: "copy-assets",
        retryable: false,
        retryOperationAfterCleanup: FieldValue.delete(),
        attempt,
        leaseOwner: invocationId,
        leaseExpiresAt,
        "progress.planned": manifest.length + clones.reduce(
          (total, current) => total + current.entries.length,
          0
        ),
        updatedAt: now,
      });
    } else {
      transaction.create(operationRef, {
        schemaVersion: 2,
        operationId,
        actorUid,
        kind: "duplicate-foe",
        requestHash,
        sourceFoeId,
        sourceHash: hashValue(sourceData),
        task07ControlHash,
        task07Mode,
        newFoeId,
        assetManifest: manifest,
        canonicalMediaClone: clone,
        canonicalNestedMediaClones: nestedClones,
        status: "running",
        phase: "copy-assets",
        retryable: false,
        attempt,
        leaseOwner: invocationId,
        leaseExpiresAt,
        progress: {
          planned: manifest.length + clones.reduce(
            (total, current) => total + current.entries.length,
            0
          ),
          processed: 0,
          succeeded: 0,
          skipped: 0,
          failed: 0,
        },
        createdAt: now,
        updatedAt: now,
        expiresAt: backendOperationExpiry(),
      });
    }
    clones.forEach((currentClone, index) => {
      const manifestRef = cloneManifestRefs[index];
      const manifestSnapshot = cloneManifests[index];
      if (!manifestSnapshot?.exists) {
        transaction.create(manifestRef, buildTask07MediaCloneManifest({
          clone: currentClone,
          now,
          leaseExpiresAt,
          cleanupAfter,
          attempt,
        }));
      } else if (manifestSnapshot.get("state") !== "ready") {
        transaction.update(manifestRef, task07MediaCloneProcessingPatch({
          clone: currentClone,
          now,
          leaseExpiresAt,
          cleanupAfter,
          attempt,
        }));
      }
    });
    return {
      mode: "execute",
      result: {},
      manifest,
      source: sourceData,
      newFoeId,
      clone,
      nestedClones,
      attempt,
      retryOperationAfterCleanup: true,
      errorClass: "",
      cleanupCanComplete: true,
      task07ControlHash,
      task07Mode,
    };
  });
  if (claim.mode === "completed") {
    completeServerTelemetry(telemetry, {
      outcome: "replayed",
      replayed: true,
    });
    return {
      ...claim.result,
      operationId,
      replayed: true,
    };
  }
  if (claim.mode === "cleanup") {
    const outcome = await runOwnedDuplicateCleanup({
      db,
      operationRef,
      requestHash,
      invocationId,
      manifest: claim.manifest,
      clone: claim.clone,
      nestedClones: claim.nestedClones,
      newFoeId: claim.newFoeId,
      attempt: claim.attempt,
      errorClass: claim.errorClass,
      retryOperationAfterCleanup: claim.retryOperationAfterCleanup,
      cleanupCanComplete: claim.cleanupCanComplete,
    });
    failServerTelemetry(
      telemetry,
      outcome.cleanupComplete ? "conflict" : "storage",
      {copies: 0}
    );
    throw cleanupOutcomeError(outcome);
  }

  let legacyManifest = claim.manifest;
  let copied: CopyResult[];
  const canonicalResults = new Map<string, Task07CanonicalCloneResult>();
  let legacyActualCopies = 0;
  let canonicalActualCopies = 0;
  try {
    legacyManifest = await checkpointLegacySourcePresence({
      db,
      operationRef,
      sourceRef,
      task07ConfigRef,
      actorUid,
      task07ControlHash: claim.task07ControlHash,
      task07Mode: claim.task07Mode,
      requestHash,
      invocationId,
      manifest: legacyManifest,
    });
    copied = await mapWithConcurrency(
      legacyManifest,
      BACKEND_OPERATION_STORAGE_CONCURRENCY,
      async (entry) => {
        const result = await copyManifestEntry(entry);
        if (result.outcome === "copied") legacyActualCopies += 1;
        return result;
      }
    );
    const allClones = [
      ...(claim.clone ? [claim.clone] : []),
      ...claim.nestedClones,
    ];
    if (allClones.length) {
      for (const clone of allClones) {
        canonicalResults.set(
          clone.destinationAssetId,
          await copyTask07CanonicalMediaFamily({
            clone,
            concurrency: BACKEND_OPERATION_STORAGE_CONCURRENCY,
            onCopy: () => {
              canonicalActualCopies += 1;
            },
          })
        );
      }
      await db.runTransaction(async (transaction) => {
        const [operation, actor, sourceSnapshot, task07Config] =
          await transaction.getAll(
            operationRef,
            actorRef,
            sourceRef,
            task07ConfigRef
          );
        const currentTask07ControlHash = hashValue(
          task07Config.data() ?? {}
        );
        const currentTask07Mode = task07MediaModeForActor({
          control: task07Config.data(),
          purpose: "foe",
          role: "dm",
          uid: actorUid,
        });
        if (!actorSnapshotIsActiveDm(actor)) {
          throw new HttpsError(
            "permission-denied",
            "Only active DMs can duplicate foes."
          );
        }
        if (!sourceSnapshot.exists) {
          throw new HttpsError(
            "aborted",
            "Foe duplication lost its source media fence."
          );
        }
        const currentClone = await loadFoeMediaClonePlan({
          transaction,
          db,
          actorUid,
          receiptId,
          sourceFoeId,
          destinationFoeId: claim.newFoeId,
          source: sourceSnapshot.data() ?? {},
        });
        const currentNestedClones = await loadFoeNestedMediaClonePlans({
          transaction,
          db,
          actorUid,
          receiptId,
          sourceFoeId,
          destinationFoeId: claim.newFoeId,
          source: sourceSnapshot.data() ?? {},
        });
        const cloneManifestRefs = allClones.map(({destinationAssetId}) =>
          db.doc(`media_assets/${destinationAssetId}`));
        const cloneManifests = await transaction.getAll(...cloneManifestRefs);
        if (!operation.exists ||
          operation.get("requestHash") !== requestHash ||
          operation.get("status") !== "running" ||
          operation.get("phase") !== "copy-assets" ||
          operation.get("leaseOwner") !== invocationId ||
          !foeDuplicationControlFenceMatches({
            storedControlHash: operation.get("task07ControlHash"),
            storedMode: operation.get("task07Mode"),
            currentControlHash: currentTask07ControlHash,
            currentMode: currentTask07Mode,
          }) ||
          operation.get("task07ControlHash") !== claim.task07ControlHash ||
          operation.get("task07Mode") !== claim.task07Mode ||
          operation.get("sourceHash") !==
            hashValue(sourceSnapshot.data()) ||
          !task07FoeMediaClonePlansMatch(
            operation.get("canonicalMediaClone"),
            claim.clone
          ) ||
          hashValue(operation.get("canonicalNestedMediaClones")) !==
            hashValue(claim.nestedClones) ||
          !task07FoeMediaClonePlansMatch(currentClone, claim.clone) ||
          hashValue(currentNestedClones) !== hashValue(claim.nestedClones) ||
          cloneManifests.some((manifest, index) =>
            !manifest.exists ||
            !canonicalManifestMatches(manifest.data(), allClones[index]))) {
          throw new HttpsError(
            "aborted",
            "Foe duplication lost its canonical media fence."
          );
        }
        cloneManifests.forEach((cloneManifest, index) => {
          const clone = allClones[index];
          const result = canonicalResults.get(clone.destinationAssetId);
          if (!result) {
            throw new HttpsError(
              "failed-precondition",
              "Canonical media copy result is unavailable."
            );
          }
          if (cloneManifest.get("state") === "ready") {
            if (hashValue(cloneManifest.get("generated")) !==
              hashValue(result.generated)) {
              throw new HttpsError(
                "failed-precondition",
                "Canonical media ready checkpoint conflicts with Storage."
              );
            }
          } else if (["intent", "processing", "failed"].includes(
            asTrimmedString(cloneManifest.get("state"))
          )) {
            transaction.update(cloneManifestRefs[index],
              task07MediaCloneReadyPatch({
                clone,
                result,
                now: Timestamp.now(),
                cleanupAfter: cloneRetentionExpiry(),
                attempt: claim.attempt,
              }));
          } else {
            throw new HttpsError(
              "failed-precondition",
              "Canonical media manifest cannot be finalized."
            );
          }
        });
        transaction.update(operationRef, {
          phase: "commit",
          leaseExpiresAt: duplicateLeaseExpiry(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    }
  } catch (error) {
    let outcome: DuplicateCleanupOutcome;
    try {
      outcome = await recoverOwnedDuplicateFailure({
        db,
        operationRef,
        requestHash,
        invocationId,
        manifest: legacyManifest,
        clone: claim.clone,
        nestedClones: claim.nestedClones,
        newFoeId: claim.newFoeId,
        attempt: claim.attempt,
        cleanupCanComplete: true,
        error,
        incrementFailure: true,
      });
    } catch (cleanupError) {
      failServerTelemetry(telemetry, "conflict", {
        copies: legacyActualCopies + canonicalActualCopies,
      });
      throw cleanupError;
    }
    failServerTelemetry(
      telemetry,
      outcome.retryOperationAfterCleanup ? "storage" : "conflict",
      {
        copies: legacyActualCopies + canonicalActualCopies,
      }
    );
    throw cleanupOutcomeError(outcome);
  }
  const source = claim.source;
  const mainCopy = copyByKey(copied, "main");
  const nestedIdentities = nestedFoeIdentitySubjects({source, receiptId});
  const hasCanonicalClone = Boolean(claim.clone || claim.nestedClones.length);
  const copyableSource = stripTask07MediaFromDuplicatedFoe(source, {
    canonicalClone: hasCanonicalClone,
  });
  if (!hasCanonicalClone && nestedIdentities.length) {
    delete copyableSource.task07EmbeddedMedia;
  }
  const sourceTecniche = Array.isArray(copyableSource.tecniche)
    ? copyableSource.tecniche
    : [];
  const sourceSpells = Array.isArray(copyableSource.spells) ?
    copyableSource.spells : [];
  const nestedCloneAt = (
    kind: "foe-technique" | "foe-spell",
    index: number
  ): Task07FoeMediaClonePlan | undefined => claim.nestedClones.find(
    ({destinationPlan}) => destinationPlan.nestedTarget?.kind === kind &&
      destinationPlan.nestedTarget.entryIndex === index
  );
  const nestedIdentityAt = (
    kind: "foe-technique" | "foe-spell",
    index: number
  ): NestedFoeIdentitySubject | undefined => nestedIdentities.find(
    ({destinationNestedTarget}) =>
      destinationNestedTarget.kind === kind &&
      destinationNestedTarget.entryIndex === index
  );
  const newTecniche: Record<string, unknown>[] = sourceTecniche.map(
    (raw, index) => {
    const entry = asRecord(raw);
    const identity = nestedIdentityAt("foe-technique", index);
    const identifiedEntry = identity ? {
      ...entry,
      task07MediaEntryId: identity.destinationNestedTarget.entryId,
    } : entry;
    const copy = copyByKey(copied, `tecnica:${index}`);
    if (nestedCloneAt("foe-technique", index)) return identifiedEntry;
    return {
      ...identifiedEntry,
      imagePath: copy.path,
      imageUrl: copy.url,
    };
    }
  );
  const newSpells: Record<string, unknown>[] = sourceSpells.map(
    (raw, index) => {
    const entry = asRecord(raw);
    const identity = nestedIdentityAt("foe-spell", index);
    const identifiedEntry = identity ? {
      ...entry,
      task07MediaEntryId: identity.destinationNestedTarget.entryId,
    } : entry;
    const copy = copyByKey(copied, `spell:${index}`);
    if (nestedCloneAt("foe-spell", index)) return identifiedEntry;
    return {
      ...identifiedEntry,
      imagePath: copy.path,
      imageUrl: copy.url,
    };
    }
  );
  const sourceStats = asRecord(source.stats);
  const payload = {
    ...copyableSource,
    name: newFoeName,
    ...(!claim.clone ? {
      imagePath: mainCopy.path,
      imageUrl: mainCopy.url,
    } : {}),
    tecniche: newTecniche,
    spells: newSpells,
    stats: {
      ...sourceStats,
      hpCurrent: asFiniteNumber(sourceStats.hpTotal),
      manaCurrent: asFiniteNumber(sourceStats.manaTotal),
    },
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  };
  const result = {
    newFoeId: claim.newFoeId,
    assets: {
      main: {path: mainCopy.path, url: mainCopy.url},
      ...(claim.clone && canonicalResults.get(claim.clone.destinationAssetId) ? {
        canonicalMain: {
          sourceAssetId: claim.clone.sourceAssetId,
          assetId: claim.clone.destinationAssetId,
          originalPath: canonicalResults.get(
            claim.clone.destinationAssetId
          )?.generated.original.path,
        },
      } : {}),
      canonicalNested: claim.nestedClones.map((nestedClone) => ({
        sourceAssetId: nestedClone.sourceAssetId,
        assetId: nestedClone.destinationAssetId,
        nestedTarget: nestedClone.destinationPlan.nestedTarget,
        originalPath: canonicalResults.get(
          nestedClone.destinationAssetId
        )?.generated.original.path,
      })),
      tecniche: newTecniche.map((entry) => ({
        name: asTrimmedString(asRecord(entry).name),
        path: asTrimmedString(asRecord(entry).imagePath),
        url: asTrimmedString(asRecord(entry).imageUrl),
      })),
      spells: newSpells.map((entry) => ({
        name: asTrimmedString(asRecord(entry).name),
        path: asTrimmedString(asRecord(entry).imagePath),
        url: asTrimmedString(asRecord(entry).imageUrl),
      })),
    },
  };
  const allClones = [
    ...(claim.clone ? [claim.clone] : []),
    ...claim.nestedClones,
  ];
  const plannedCopies = legacyManifest.length + allClones.reduce(
    (total, clone) => total + clone.entries.length,
    0
  );
  const succeededCopies = copied.filter(
    ({outcome}) => outcome === "copied"
  ).length + [...canonicalResults.values()].reduce(
    (total, current) => total + current.copied,
    0
  );
  const skippedCopies = copied.filter(
    ({outcome}) => outcome !== "copied"
  ).length + [...canonicalResults.values()].reduce(
    (total, current) => total + current.reused,
    0
  );
  const processedCopies = succeededCopies + skippedCopies;
  if (processedCopies !== plannedCopies) {
    throw new HttpsError(
      "internal",
      "Foe duplication copy accounting is inconsistent."
    );
  }
  let finalizedReplay = false;
  try {
    finalizedReplay = await db.runTransaction(async (transaction) => {
      const [operation, actor, sourceSnapshot, task07Config] =
        await transaction.getAll(
          operationRef,
          actorRef,
          sourceRef,
          task07ConfigRef
        );
      const currentTask07ControlHash = hashValue(task07Config.data() ?? {});
      const currentTask07Mode = task07MediaModeForActor({
        control: task07Config.data(),
        purpose: "foe",
        role: "dm",
        uid: actorUid,
      });
      if (
        operation.exists &&
        operation.get("requestHash") === requestHash &&
        operation.get("status") === "completed"
      ) return true;
      if (
        !operation.exists ||
        !actorSnapshotIsActiveDm(actor) ||
        operation.get("requestHash") !== requestHash ||
        operation.get("status") !== "running" ||
        operation.get("phase") !==
          (allClones.length ? "commit" : "copy-assets") ||
        operation.get("leaseOwner") !== invocationId ||
        !foeDuplicationControlFenceMatches({
          storedControlHash: operation.get("task07ControlHash"),
          storedMode: operation.get("task07Mode"),
          currentControlHash: currentTask07ControlHash,
          currentMode: currentTask07Mode,
        }) ||
        operation.get("task07ControlHash") !== claim.task07ControlHash ||
        operation.get("task07Mode") !== claim.task07Mode ||
        !sourceSnapshot.exists ||
        operation.get("sourceHash") !== hashValue(sourceSnapshot.data())
      ) {
        throw new HttpsError(
          "aborted",
          "Foe duplication lost its source fence."
        );
      }
      const targetRef = db.doc(`foes/${claim.newFoeId}`);
      if (allClones.length) {
        const currentClone = await loadFoeMediaClonePlan({
          transaction,
          db,
          actorUid,
          receiptId,
          sourceFoeId,
          destinationFoeId: claim.newFoeId,
          source: sourceSnapshot.data() ?? {},
        });
        const currentNestedClones = await loadFoeNestedMediaClonePlans({
          transaction,
          db,
          actorUid,
          receiptId,
          sourceFoeId,
          destinationFoeId: claim.newFoeId,
          source: sourceSnapshot.data() ?? {},
        });
        const cloneManifestRefs = allClones.map(({destinationAssetId}) =>
          db.doc(`media_assets/${destinationAssetId}`));
        const cloneManifests = await transaction.getAll(...cloneManifestRefs);
        const target = await transaction.get(targetRef);
        if (!task07FoeMediaClonePlansMatch(currentClone, claim.clone) ||
          !task07FoeMediaClonePlansMatch(
            operation.get("canonicalMediaClone"),
            claim.clone
          ) ||
          hashValue(currentNestedClones) !== hashValue(claim.nestedClones) ||
          hashValue(operation.get("canonicalNestedMediaClones")) !==
            hashValue(claim.nestedClones) ||
          cloneManifests.some((manifest, index) => {
            const clone = allClones[index];
            const cloneResult = canonicalResults.get(clone.destinationAssetId);
            return !cloneResult || !manifest.exists ||
              !canonicalManifestMatches(manifest.data(), clone) ||
              manifest.get("state") !== "ready" ||
              hashValue(manifest.get("generated")) !==
                hashValue(cloneResult.generated);
          }) ||
          target.exists) {
          throw new HttpsError(
            "aborted",
            "Foe duplication lost its canonical attachment fence."
          );
        }
        const timestamp = Timestamp.now();
        let attachedTargetData: admin.firestore.DocumentData = payload;
        const attachments = allClones.map((clone, index) => {
          const attachment = buildTask07NewTargetAttachment({
            assetData: cloneManifests[index].data() ?? {},
            plan: clone.destinationPlan,
            targetData: attachedTargetData,
            timestamp,
          });
          attachedTargetData = attachment.targetData;
          return attachment;
        });
        transaction.create(targetRef, attachedTargetData);
        attachments.forEach((attachment, index) => {
          const clone = allClones[index];
          transaction.update(cloneManifestRefs[index], {
            state: "attached",
            attachment: {
              referencePath: attachment.referencePath,
              targetSlot: attachment.targetSlot,
              ...(clone.destinationPlan.nestedTarget ? {
                nestedTarget: clone.destinationPlan.nestedTarget,
              } : {}),
              revision: attachment.revision,
              attachedAt: timestamp,
            },
            "retention.cleanupAfter": FieldValue.delete(),
            updatedAt: timestamp,
          });
        });
      } else {
        transaction.create(targetRef, payload);
      }
      transaction.update(operationRef, {
        status: "completed",
        phase: "completed",
        retryable: false,
        result,
        progress: {
          planned: plannedCopies,
          processed: processedCopies,
          succeeded: succeededCopies,
          skipped: skippedCopies,
          failed: 0,
        },
        completedAt: FieldValue.serverTimestamp(),
        leaseOwner: FieldValue.delete(),
        leaseExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return false;
    });
  } catch (error) {
    let outcome: DuplicateCleanupOutcome;
    try {
      outcome = await recoverOwnedDuplicateFailure({
        db,
        operationRef,
        requestHash,
        invocationId,
        manifest: legacyManifest,
        clone: claim.clone,
        nestedClones: claim.nestedClones,
        newFoeId: claim.newFoeId,
        attempt: claim.attempt,
        cleanupCanComplete: true,
        error,
        incrementFailure: false,
      });
    } catch (cleanupError) {
      failServerTelemetry(telemetry, "conflict", {
        copies: legacyActualCopies + canonicalActualCopies,
      });
      throw cleanupError;
    }
    failServerTelemetry(
      telemetry,
      outcome.retryOperationAfterCleanup ? "internal" : "conflict",
      {copies: legacyActualCopies + canonicalActualCopies}
    );
    throw cleanupOutcomeError(outcome);
  }
  completeServerTelemetry(telemetry, {
    copies: legacyActualCopies + canonicalActualCopies,
    writes: allClones.length ? 2 + allClones.length : 2,
    replayed: replayed || finalizedReplay,
  });
  return {
    ...result,
    operationId,
    replayed: replayed || finalizedReplay,
  };
};

export const duplicateFoeWithAssets = onCall<DuplicatePayload>(
  {
    cors: true,
    region: LEGACY_REGION,
  },
  async (request) => duplicateFoeWithAssetsLegacyHandler(request)
);

export const duplicateFoeWithAssetsV2 = onCall<DuplicatePayload>(
  {
    cors: true,
    region: CANONICAL_REGION,
    timeoutSeconds: DUPLICATE_FUNCTION_TIMEOUT_SECONDS,
  },
  async (request) => duplicateFoeHandler(
    request,
    true,
    CANONICAL_REGION
  )
);
