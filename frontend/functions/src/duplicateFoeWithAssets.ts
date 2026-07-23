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

type DuplicatePayload = {
  sourceFoeId?: string;
  newFoeName?: string;
  operationId?: string;
  idempotencyKey?: string;
};

type CopyResult = {
  key: string;
  path: string;
  url: string;
};

type ManifestEntry = {
  key: string;
  sourcePath: string;
  destinationPath: string;
  downloadToken: string;
};

const TASK06_CONFIG_PATH = "app_config/task06_backend";
const OPERATION_COLLECTION = "backend_operations";
const LEGACY_REGION = "europe-west1";
const CANONICAL_REGION = "europe-west8";
const DUPLICATE_FUNCTION_TIMEOUT_SECONDS = 60;

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
  const mainPath = sourcePath(source);
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
  }));
};

const firebaseDownloadUrl = (
  bucket: string,
  path: string,
  token: string
): string => (
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/` +
  `${encodeURIComponent(path)}?alt=media&token=${token}`
);

const copyManifestEntry = async (
  entry: ManifestEntry
): Promise<CopyResult> => {
  const bucket = getStorage().bucket();
  if (!isSafeOwnedStoragePath(
    entry.destinationPath,
    ["foes/operations/"]
  )) {
    throw new Error("Unsafe destination path.");
  }
  const sourceFile = bucket.file(entry.sourcePath);
  const destinationFile = bucket.file(entry.destinationPath);
  const [sourceExists] = await sourceFile.exists();
  if (!sourceExists) throw new Error("Source asset is missing.");
  const [destinationExists] = await destinationFile.exists();
  if (!destinationExists) {
    await sourceFile.copy(destinationFile);
  }
  const [sourceMetadata, destinationMetadata] = await Promise.all([
    sourceFile.getMetadata().then(([metadata]) => metadata),
    destinationFile.getMetadata().then(([metadata]) => metadata),
  ]);
  const token = asTrimmedString(entry.downloadToken) || asTrimmedString(
    asRecord(destinationMetadata.metadata).firebaseStorageDownloadTokens
  ) || randomUUID();
  await destinationFile.setMetadata({
    ...(sourceMetadata.contentType
      ? {contentType: sourceMetadata.contentType}
      : {}),
    cacheControl: "private, max-age=31536000, immutable",
    metadata: {
      ...asRecord(destinationMetadata.metadata),
      firebaseStorageDownloadTokens: token,
      task06OperationOwned: "true",
    },
  });
  return {
    key: entry.key,
    path: entry.destinationPath,
    url: firebaseDownloadUrl(bucket.name, entry.destinationPath, token),
  };
};

const cleanupManifest = async (
  manifest: ManifestEntry[]
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

const copyByKey = (
  copied: CopyResult[],
  key: string
): CopyResult => copied.find((entry) => entry.key === key) ?? {
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
  invocationId: string
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
  cleanupComplete: boolean,
  errorClass: string,
  incrementFailure: boolean
): Promise<boolean> => db.runTransaction(async (transaction) => {
  const operation = await transaction.get(operationRef);
  if (
    !operation.exists ||
    operation.get("requestHash") !== requestHash ||
    operation.get("status") !== "running" ||
    operation.get("phase") !== "cleanup" ||
    operation.get("leaseOwner") !== invocationId
  ) return false;
  transaction.update(operationRef, {
    status: cleanupComplete ? "failed" : "cleanup-pending",
    retryable: true,
    errorClass,
    ...(incrementFailure ? {
      "progress.failed": FieldValue.increment(1),
    } : {}),
    leaseOwner: FieldValue.delete(),
    leaseExpiresAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
});

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
  const claim = await db.runTransaction(async (transaction) => {
    const [operation, actor, source, configSnapshot] =
      await transaction.getAll(
        operationRef,
        actorRef,
        sourceRef,
        configRef
      );
    if (
      !actor.exists ||
      actor.get("role") !== "dm" ||
      actor.get("deletionState") === "pending"
    ) {
      throw new HttpsError(
        "permission-denied",
        "Only active DMs can duplicate foes."
      );
    }
    const task06Config = resolveTask06BackendConfig(
      configSnapshot.data()
    );
    if (operation.exists) {
      if (
        operation.get("actorUid") !== actorUid ||
        operation.get("kind") !== "duplicate-foe" ||
        operation.get("requestHash") !== requestHash
      ) {
        throw new HttpsError(
          "already-exists",
          "operationId belongs to a different request."
        );
      }
      if (operation.get("status") === "completed") {
        replayed = true;
        return {
          completed: true,
          result: asRecord(operation.get("result")),
          manifest: [] as ManifestEntry[],
          source: source.data() ?? {},
          newFoeId: asTrimmedString(operation.get("newFoeId")),
        };
      }
      if (
        requireOperationId &&
        !task06Config.enabledOperationKinds.includes("duplicate-foe")
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Foe duplication V2 is not enabled."
        );
      }
      if (!source.exists) {
        throw new HttpsError(
          "aborted",
          "The source foe was removed after this operation began."
        );
      }
      if (
        operation.get("sourceHash") !== hashValue(source.data()) ||
        !Array.isArray(operation.get("assetManifest"))
      ) {
        throw new HttpsError(
          "aborted",
          "The source foe changed after this operation began."
        );
      }
      if (hasActiveDuplicateLease(operation)) {
        throw new HttpsError(
          "aborted",
          "This foe duplication is already running."
        );
      }
      const status = asTrimmedString(operation.get("status"));
      const retryable = operation.get("retryable") === true;
      if (status !== "running" && !retryable) {
        throw new HttpsError(
          "failed-precondition",
          "This foe duplication cannot be resumed."
        );
      }
      transaction.update(operationRef, {
        status: "running",
        phase: "copy-assets",
        retryable: false,
        attempt: FieldValue.increment(1),
        leaseOwner: invocationId,
        leaseExpiresAt: duplicateLeaseExpiry(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        completed: false,
        result: {},
        manifest: operation.get("assetManifest") as ManifestEntry[],
        source: source.data() ?? {},
        newFoeId: asTrimmedString(operation.get("newFoeId")),
      };
    }
    if (
      requireOperationId &&
      !task06Config.enabledOperationKinds.includes("duplicate-foe")
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Foe duplication V2 is not enabled."
      );
    }
    if (!source.exists) {
      throw new HttpsError("not-found", "Source foe not found.");
    }
    const newFoeId = `dup_${receiptId.slice(0, 24)}`;
    const sourceData = source.data() ?? {};
    const manifest = buildManifest(sourceData, receiptId);
    transaction.create(operationRef, {
      schemaVersion: 1,
      operationId,
      actorUid,
      kind: "duplicate-foe",
      requestHash,
      sourceHash: hashValue(sourceData),
      newFoeId,
      assetManifest: manifest,
      status: "running",
      phase: "copy-assets",
      retryable: false,
      attempt: 1,
      leaseOwner: invocationId,
      leaseExpiresAt: duplicateLeaseExpiry(),
      progress: {
        planned: manifest.length,
        processed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: backendOperationExpiry(),
    });
    return {
      completed: false,
      result: {},
      manifest,
      source: sourceData,
      newFoeId,
    };
  });
  if (claim.completed) {
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
  let copied: CopyResult[];
  try {
    copied = await mapWithConcurrency(
      claim.manifest,
      BACKEND_OPERATION_STORAGE_CONCURRENCY,
      copyManifestEntry
    );
  } catch {
    const ownsCleanup = await beginOwnedCleanup(
      db,
      operationRef,
      requestHash,
      invocationId
    );
    if (!ownsCleanup) {
      failServerTelemetry(telemetry, "conflict", {
        copies: claim.manifest.length,
      });
      throw new HttpsError(
        "aborted",
        "Foe duplication ownership changed before cleanup."
      );
    }
    const cleanupComplete = await cleanupManifest(claim.manifest);
    await finishOwnedCleanup(
      db,
      operationRef,
      requestHash,
      invocationId,
      cleanupComplete,
      "storage",
      true
    );
    failServerTelemetry(telemetry, "storage", {
      copies: claim.manifest.length,
    });
    throw new HttpsError(
      "unavailable",
      "Foe assets could not be copied safely. Retry this operation."
    );
  }
  const source = claim.source;
  const mainCopy = copyByKey(copied, "main");
  const sourceTecniche = Array.isArray(source.tecniche)
    ? source.tecniche
    : [];
  const sourceSpells = Array.isArray(source.spells) ? source.spells : [];
  const newTecniche: Record<string, unknown>[] = sourceTecniche.map(
    (raw, index) => {
    const entry = asRecord(raw);
    const copy = copyByKey(copied, `tecnica:${index}`);
    return {
      ...entry,
      imagePath: copy.path,
      imageUrl: copy.url,
    };
    }
  );
  const newSpells: Record<string, unknown>[] = sourceSpells.map(
    (raw, index) => {
    const entry = asRecord(raw);
    const copy = copyByKey(copied, `spell:${index}`);
    return {
      ...entry,
      imagePath: copy.path,
      imageUrl: copy.url,
    };
    }
  );
  const sourceStats = asRecord(source.stats);
  const payload = {
    ...source,
    name: newFoeName,
    imagePath: mainCopy.path,
    imageUrl: mainCopy.url,
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
  let finalizedReplay = false;
  try {
    finalizedReplay = await db.runTransaction(async (transaction) => {
      const [operation, sourceSnapshot] = await transaction.getAll(
        operationRef,
        sourceRef
      );
      if (
        operation.exists &&
        operation.get("requestHash") === requestHash &&
        operation.get("status") === "completed"
      ) return true;
      if (
        !operation.exists ||
        operation.get("requestHash") !== requestHash ||
        operation.get("status") !== "running" ||
        operation.get("phase") !== "copy-assets" ||
        operation.get("leaseOwner") !== invocationId ||
        !sourceSnapshot.exists ||
        operation.get("sourceHash") !== hashValue(sourceSnapshot.data())
      ) {
        throw new HttpsError(
          "aborted",
          "Foe duplication lost its source fence."
        );
      }
      transaction.set(db.doc(`foes/${claim.newFoeId}`), payload);
      transaction.update(operationRef, {
        status: "completed",
        phase: "completed",
        retryable: false,
        result,
        progress: {
          planned: claim.manifest.length,
          processed: claim.manifest.length,
          succeeded: claim.manifest.length,
          skipped: 0,
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
    const ownsCleanup = await beginOwnedCleanup(
      db,
      operationRef,
      requestHash,
      invocationId
    );
    if (!ownsCleanup) {
      failServerTelemetry(telemetry, "conflict", {
        copies: copied.length,
      });
      throw new HttpsError(
        "aborted",
        "Foe duplication ownership changed before finalization."
      );
    }
    const cleanupComplete = await cleanupManifest(claim.manifest);
    await finishOwnedCleanup(
      db,
      operationRef,
      requestHash,
      invocationId,
      cleanupComplete,
      "conflict",
      false
    );
    failServerTelemetry(telemetry, "conflict", {
      copies: copied.length,
    });
    throw error;
  }
  completeServerTelemetry(telemetry, {
    copies: copied.length,
    writes: 2,
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
