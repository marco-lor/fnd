import * as admin from "firebase-admin";
import {FieldPath, FieldValue, Timestamp} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {
  BACKEND_OPERATION_LEASE_MS,
  BACKEND_OPERATION_PAGE_SIZE,
  BACKEND_OPERATION_STEP_BUDGET_MS,
  BACKEND_OPERATION_STORAGE_CONCURRENCY,
  BackendOperationKind,
  BackendOperationStatus,
  BackendOperationView,
  backendOperationExpiry,
  backendOperationReceiptId,
  backendOperationRequestHash,
  emptyOperationProgress,
  getTokenGrantForLevel,
  mapWithConcurrency,
  operationViewFromData,
  ownedStoragePath,
  resolveTask06BackendConfig,
  validateBackendOperationId,
} from "./backendOperationCore";
import {
  asFiniteNumber,
  asRecord,
  asTrimmedString,
  deriveAnimaParameters,
  deriveResourceTotals,
  hashValue,
  isValidFirestoreDocumentId,
  resolveUserDataRolloutStage,
  writesLegacyUserProjection,
} from "./userDataV2";
import {isUserDataLegacyDrainFrozen} from "./userDataBridge";
import {
  completeServerTelemetry,
  failServerTelemetry,
  ServerErrorClass,
  startServerTelemetry,
} from "./serverTelemetry";

const REGION = "europe-west8";
const TASK06_CONFIG_PATH = "app_config/task06_backend";
const USER_DATA_CONFIG_PATH = "app_config/user_data_v2";
const OPERATION_COLLECTION = "backend_operations";
const WORK_COLLECTION = "backend_operation_work";
const WORKER_PAGE_SIZE = BACKEND_OPERATION_PAGE_SIZE;

type OperationInput = Record<string, unknown>;

interface OperationStepResult {
  done: boolean;
  phase: string;
  paused?: boolean;
  result?: Record<string, unknown>;
}

class OperationStepError extends Error {
  readonly errorClass: ServerErrorClass;
  readonly retryable: boolean;
  readonly terminalStatus: BackendOperationStatus;

  constructor(
    message: string,
    errorClass: ServerErrorClass,
    retryable = false,
    terminalStatus: BackendOperationStatus = "failed"
  ) {
    super(message);
    this.errorClass = errorClass;
    this.retryable = retryable;
    this.terminalStatus = terminalStatus;
  }
}

const workId = (receiptId: string, generation: number): string => (
  `${receiptId}-${String(generation).padStart(8, "0")}`
);

const stateMetadata = (
  actorUid: string,
  revision: unknown
): Record<string, unknown> => ({
  schemaVersion: 2,
  revision: Math.max(0, Math.trunc(asFiniteNumber(revision))) + 1,
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: actorUid,
});

const requiredRoleForKind = (
  kind: BackendOperationKind
): readonly string[] => (
  kind === "delete-npc" ? ["dm", "webmaster"] : ["dm"]
);

const assertActorRole = (
  actor: admin.firestore.DocumentSnapshot,
  kind: BackendOperationKind
): void => {
  if (!actor.exists) {
    throw new OperationStepError(
      "Operation actor no longer exists.",
      "authorization"
    );
  }
  if (actor.get("deletionState") === "pending") {
    throw new OperationStepError(
      "Operation actor is pending deletion.",
      "authorization"
    );
  }
  const role = asTrimmedString(actor.get("role")).toLowerCase();
  if (!requiredRoleForKind(kind).includes(role)) {
    throw new OperationStepError(
      "Operation actor is no longer authorized.",
      "authorization"
    );
  }
};

const assertCallableActorRole = (
  actor: admin.firestore.DocumentSnapshot,
  kind: BackendOperationKind
): void => {
  if (!actor.exists) {
    throw new HttpsError("permission-denied", "Operation actor not found.");
  }
  if (actor.get("deletionState") === "pending") {
    throw new HttpsError(
      "permission-denied",
      "Operation actor is pending deletion."
    );
  }
  const role = asTrimmedString(actor.get("role")).toLowerCase();
  if (!requiredRoleForKind(kind).includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "You are not authorized to start this operation."
    );
  }
};

const incrementProgress = (
  transaction: admin.firestore.Transaction,
  operationRef: admin.firestore.DocumentReference,
  outcome: "succeeded" | "skipped" | "failed"
): void => {
  transaction.update(operationRef, {
    "progress.planned": FieldValue.increment(1),
    "progress.processed": FieldValue.increment(1),
    [`progress.${outcome}`]: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
};

const createSubject = (
  transaction: admin.firestore.Transaction,
  subjectRef: admin.firestore.DocumentReference,
  outcome: "succeeded" | "skipped" | "failed",
  details: Record<string, unknown> = {}
): void => {
  transaction.create(subjectRef, {
    schemaVersion: 1,
    outcome,
    ...details,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: backendOperationExpiry(),
  });
};

const operationRefFor = (
  db: admin.firestore.Firestore,
  receiptId: string
): admin.firestore.DocumentReference => db.doc(
  `${OPERATION_COLLECTION}/${receiptId}`
);

const createBackendOperation = async (input: {
  request: CallableRequest<unknown>;
  kind: BackendOperationKind;
  operationId: string;
  operationInput: OperationInput;
}): Promise<BackendOperationView> => {
  const actorUid = asTrimmedString(input.request.auth?.uid);
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const operationId = validateBackendOperationId(input.operationId);
  if (!operationId) {
    throw new HttpsError(
      "invalid-argument",
      "operationId must be 8-80 URL-safe characters."
    );
  }
  const db = admin.firestore();
  const receiptId = backendOperationReceiptId(actorUid, operationId);
  const requestHash = backendOperationRequestHash(
    input.kind,
    input.operationInput
  );
  const operationRef = operationRefFor(db, receiptId);
  const actorRef = db.doc(`users/${actorUid}`);
  const configRef = db.doc(TASK06_CONFIG_PATH);
  const initialWorkRef = db.doc(
    `${WORK_COLLECTION}/${workId(receiptId, 0)}`
  );
  return db.runTransaction(async (transaction) => {
    const [existing, actor, configSnapshot] = await transaction.getAll(
      operationRef,
      actorRef,
      configRef
    );
    assertCallableActorRole(actor, input.kind);
    if (existing.exists) {
      if (
        existing.get("actorUid") !== actorUid ||
        existing.get("kind") !== input.kind ||
        existing.get("requestHash") !== requestHash
      ) {
        throw new HttpsError(
          "already-exists",
          "This operationId belongs to a different request."
        );
      }
      return operationViewFromData(existing.data(), true);
    }
    const config = resolveTask06BackendConfig(configSnapshot.data());
    if (!config.enabledOperationKinds.includes(input.kind)) {
      throw new HttpsError(
        "failed-precondition",
        "This bounded operation is not enabled."
      );
    }
    const operationData = {
      schemaVersion: 1,
      operationId,
      actorUid,
      kind: input.kind,
      requestHash,
      input: input.operationInput,
      status: "pending",
      phase: "prepare",
      cursor: "",
      generation: 0,
      attempt: 0,
      retryable: false,
      progress: emptyOperationProgress(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: backendOperationExpiry(),
    };
    transaction.create(operationRef, operationData);
    transaction.create(initialWorkRef, {
      schemaVersion: 1,
      receiptId,
      generation: 0,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: backendOperationExpiry(),
    });
    return operationViewFromData(operationData);
  });
};

const queryUsersPage = async (
  cursor: string
): Promise<admin.firestore.QuerySnapshot> => {
  let query: admin.firestore.Query = admin.firestore()
    .collection("users")
    .orderBy(FieldPath.documentId())
    .limit(WORKER_PAGE_SIZE);
  if (cursor) query = query.startAfter(cursor);
  return query.get();
};

type SubjectResult = "new" | "replayed" | "paused";

const processLevelUpSubject = async (input: {
  actorUid: string;
  operationRef: admin.firestore.DocumentReference;
  receiptId: string;
  userId: string;
}): Promise<SubjectResult> => {
  const db = admin.firestore();
  const userRef = db.doc(`users/${input.userId}`);
  const actorRef = db.doc(`users/${input.actorUid}`);
  const rolloutRef = db.doc(USER_DATA_CONFIG_PATH);
  const progressionRef = db.doc(
    `users/${input.userId}/state/progression`
  );
  const resourcesRef = db.doc(`users/${input.userId}/state/resources`);
  const utilsRef = db.doc("utils/varie");
  const subjectRef = input.operationRef.collection("subjects").doc(
    hashValue(["user", input.userId]).slice(0, 48)
  );
  const eventRef = userRef.collection("level_events").doc(input.receiptId);
  return db.runTransaction(async (transaction) => {
    const [
      operation,
      actor,
      rollout,
      user,
      progression,
      resources,
      utils,
      subject,
    ] = await transaction.getAll(
      input.operationRef,
      actorRef,
      rolloutRef,
      userRef,
      progressionRef,
      resourcesRef,
      utilsRef,
      subjectRef
    );
    if (subject.exists) return "replayed";
    if (!operation.exists || operation.get("status") !== "running") {
      return "paused";
    }
    assertActorRole(actor, "level-up-all");
    if (user.exists && user.get("deletionState") === "pending") {
      createSubject(transaction, subjectRef, "skipped", {
        reason: "pending-deletion",
      });
      incrementProgress(transaction, input.operationRef, "skipped");
      return "new";
    }
    if (isUserDataLegacyDrainFrozen(rollout.data(), input.userId)) {
      return "paused";
    }
    if (!user.exists) {
      createSubject(transaction, subjectRef, "skipped", {
        reason: "missing-target",
      });
      incrementProgress(transaction, input.operationRef, "skipped");
      return "new";
    }
    const rootData = user.data() ?? {};
    const targetRole = asTrimmedString(rootData.role).toLowerCase();
    const progressionStats = asRecord(progression.get("stats"));
    const rootStats = asRecord(rootData.stats);
    const fromLevel = Math.max(1, Math.trunc(asFiniteNumber(
      progressionStats.level ?? rootStats.level,
      1
    )));
    if (targetRole === "dm" || fromLevel >= 10) {
      createSubject(transaction, subjectRef, "skipped", {
        reason: targetRole === "dm" ? "dm-account" : "maximum-level",
      });
      incrementProgress(transaction, input.operationRef, "skipped");
      return "new";
    }
    const toLevel = fromLevel + 1;
    const tokensGranted = getTokenGrantForLevel(toLevel);
    const currentTokens = asFiniteNumber(
      progressionStats.combatTokensAvailable ??
        rootStats.combatTokensAvailable
    );
    const nextProgressionStats = {
      ...progressionStats,
      level: toLevel,
      combatTokensAvailable: currentTokens + tokensGranted,
    };
    const currentParametri = progression.get("Parametri") ??
      rootData.Parametri;
    const nextParametri = deriveAnimaParameters({
      parametri: currentParametri,
      altriParametri: progression.get("AltriParametri") ??
        rootData.AltriParametri,
      level: toLevel,
      utils: utils.data(),
    });
    const resourceTotals = deriveResourceTotals({
      parametri: nextParametri,
      level: toLevel,
      utils: utils.data(),
    });
    transaction.set(progressionRef, {
      ...stateMetadata(input.actorUid, progression.get("revision")),
      stats: nextProgressionStats,
      Parametri: nextParametri,
    }, {merge: true});
    if (Object.keys(resourceTotals).length) {
      transaction.set(resourcesRef, {
        ...stateMetadata(input.actorUid, resources.get("revision")),
        stats: {
          ...asRecord(resources.get("stats")),
          ...resourceTotals,
        },
      }, {merge: true});
    }
    const rootUpdate: Record<string, unknown> = {
      "summary.level": toLevel,
    };
    const rolloutStage = resolveUserDataRolloutStage(
      rollout.data(),
      input.userId
    );
    if (writesLegacyUserProjection(rolloutStage)) {
      rootUpdate["stats.level"] = toLevel;
      rootUpdate["stats.combatTokensAvailable"] =
        currentTokens + tokensGranted;
      rootUpdate.Parametri = nextParametri;
      Object.entries(resourceTotals).forEach(([field, value]) => {
        rootUpdate[`stats.${field}`] = value;
      });
    }
    transaction.update(
      userRef,
      rootUpdate as admin.firestore.UpdateData<
        admin.firestore.DocumentData
      >
    );
    transaction.create(eventRef, {
      from_level: fromLevel,
      to_level: toLevel,
      tokens_granted: tokensGranted,
      operationReceiptId: input.receiptId,
      timestamp: FieldValue.serverTimestamp(),
    });
    createSubject(transaction, subjectRef, "succeeded", {
      fromLevel,
      toLevel,
      tokensGranted,
    });
    incrementProgress(transaction, input.operationRef, "succeeded");
    return "new";
  });
};

const processLockSubject = async (input: {
  actorUid: string;
  operationRef: admin.firestore.DocumentReference;
  userId: string;
  field: string;
  value: boolean;
}): Promise<SubjectResult> => {
  const db = admin.firestore();
  const userRef = db.doc(`users/${input.userId}`);
  const actorRef = db.doc(`users/${input.actorUid}`);
  const rolloutRef = db.doc(USER_DATA_CONFIG_PATH);
  const settingsRef = db.doc(`users/${input.userId}/state/settings`);
  const subjectRef = input.operationRef.collection("subjects").doc(
    hashValue(["settings", input.userId, input.field]).slice(0, 48)
  );
  return db.runTransaction(async (transaction) => {
    const [operation, actor, rollout, user, settings, subject] =
      await transaction.getAll(
        input.operationRef,
        actorRef,
        rolloutRef,
        userRef,
        settingsRef,
        subjectRef
      );
    if (subject.exists) return "replayed";
    if (!operation.exists || operation.get("status") !== "running") {
      return "paused";
    }
    assertActorRole(actor, "set-parameter-locks");
    if (user.exists && user.get("deletionState") === "pending") {
      createSubject(transaction, subjectRef, "skipped", {
        reason: "pending-deletion",
      });
      incrementProgress(transaction, input.operationRef, "skipped");
      return "new";
    }
    if (isUserDataLegacyDrainFrozen(rollout.data(), input.userId)) {
      return "paused";
    }
    if (!user.exists) {
      createSubject(transaction, subjectRef, "skipped", {
        reason: "missing-target",
      });
      incrementProgress(transaction, input.operationRef, "skipped");
      return "new";
    }
    transaction.set(settingsRef, {
      ...stateMetadata(input.actorUid, settings.get("revision")),
      settings: {
        ...asRecord(settings.get("settings")),
        [input.field]: input.value,
      },
    }, {merge: true});
    const rolloutStage = resolveUserDataRolloutStage(
      rollout.data(),
      input.userId
    );
    if (writesLegacyUserProjection(rolloutStage)) {
      transaction.set(userRef, {
        settings: {
          ...asRecord(user.get("settings")),
          [input.field]: input.value,
        },
      }, {merge: true});
    }
    createSubject(transaction, subjectRef, "succeeded");
    incrementProgress(transaction, input.operationRef, "succeeded");
    return "new";
  });
};

const processUserPage = async (input: {
  operation: admin.firestore.DocumentSnapshot;
  operationRef: admin.firestore.DocumentReference;
  receiptId: string;
  kind: "level-up-all" | "set-parameter-locks";
}): Promise<OperationStepResult> => {
  const cursor = asTrimmedString(input.operation.get("cursor"));
  const users = await queryUsersPage(cursor);
  if (users.empty) {
    return {
      done: true,
      phase: "completed",
      result: {
        processedUsers: asFiniteNumber(
          input.operation.get("progress.processed")
        ),
      },
    };
  }
  const actorUid = asTrimmedString(input.operation.get("actorUid"));
  const operationInput = asRecord(input.operation.get("input"));
  let paused = false;
  let lastProcessedCursor = cursor;
  const deadline = Date.now() + BACKEND_OPERATION_STEP_BUDGET_MS;
  for (const user of users.docs) {
    if (
      lastProcessedCursor !== cursor &&
      Date.now() >= deadline
    ) break;
    const result = input.kind === "level-up-all"
      ? await processLevelUpSubject({
        actorUid,
        operationRef: input.operationRef,
        receiptId: input.receiptId,
        userId: user.id,
      })
      : await processLockSubject({
        actorUid,
        operationRef: input.operationRef,
        userId: user.id,
        field: asTrimmedString(operationInput.field),
        value: operationInput.value === true,
      });
    if (result === "paused") {
      paused = true;
      break;
    }
    lastProcessedCursor = user.id;
  }
  if (lastProcessedCursor !== cursor) {
    await input.operationRef.update({
      cursor: lastProcessedCursor,
      phase: "mutate",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (paused) {
    return {done: false, phase: "paused", paused: true};
  }
  return {done: false, phase: "mutate"};
};

const requireCurrentActorRole = async (
  operation: admin.firestore.DocumentSnapshot
): Promise<void> => {
  const actorUid = asTrimmedString(operation.get("actorUid"));
  const actor = await admin.firestore().doc(`users/${actorUid}`).get();
  assertActorRole(actor, operation.get("kind") as BackendOperationKind);
};

const prepareNpcDeletion = async (
  operation: admin.firestore.DocumentSnapshot,
  operationRef: admin.firestore.DocumentReference
): Promise<OperationStepResult> => {
  await requireCurrentActorRole(operation);
  const npcId = asTrimmedString(asRecord(operation.get("input")).npcId);
  const npcRef = admin.firestore().doc(`echi_npcs/${npcId}`);
  const npc = await npcRef.get();
  if (!npc.exists) {
    return {
      done: true,
      phase: "completed",
      result: {alreadyDeleted: true},
    };
  }
  await admin.firestore().runTransaction(async (transaction) => {
    const [latestOperation, latestNpc] = await transaction.getAll(
      operationRef,
      npcRef
    );
    if (!latestOperation.exists || !latestNpc.exists) return;
    transaction.update(npcRef, {
      deletionState: "pending",
      deletionRequestedAt: FieldValue.serverTimestamp(),
      deletionRequestedBy: operation.get("actorUid"),
    });
    transaction.update(operationRef, {
      phase: "markers-public",
      storagePath: ownedStoragePath(
        latestNpc.get("imagePath"),
        ["echi_npcs/"],
        getStorage().bucket().name
      ) || ownedStoragePath(
        latestNpc.get("imageUrl"),
        ["echi_npcs/"],
        getStorage().bucket().name
      ),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return {done: false, phase: "markers-public"};
};

const deleteMarkerPage = async (input: {
  operation: admin.firestore.DocumentSnapshot;
  operationRef: admin.firestore.DocumentReference;
  collectionGroup: "map_markers" | "map_markers_private";
  nextPhase: string;
}): Promise<OperationStepResult> => {
  await requireCurrentActorRole(input.operation);
  const npcId = asTrimmedString(asRecord(input.operation.get("input")).npcId);
  const query = input.collectionGroup === "map_markers"
    ? admin.firestore().collection("map_markers")
      .where("npcId", "==", npcId)
      .limit(WORKER_PAGE_SIZE)
    : admin.firestore().collectionGroup("map_markers_private")
      .where("npcId", "==", npcId)
      .limit(WORKER_PAGE_SIZE);
  const markers = await query.get();
  if (markers.empty) {
    await input.operationRef.update({
      phase: input.nextPhase,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {done: false, phase: input.nextPhase};
  }
  const batch = admin.firestore().batch();
  markers.docs.forEach((marker) => {
    const subjectRef = input.operationRef.collection("subjects").doc(
      hashValue(["marker", marker.ref.path]).slice(0, 48)
    );
    batch.delete(marker.ref);
    batch.create(subjectRef, {
      schemaVersion: 1,
      outcome: "succeeded",
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: backendOperationExpiry(),
    });
  });
  batch.update(input.operationRef, {
    "progress.planned": FieldValue.increment(
      markers.size
    ),
    "progress.processed": FieldValue.increment(
      markers.size
    ),
    "progress.succeeded": FieldValue.increment(
      markers.size
    ),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return {done: false, phase: input.operation.get("phase")};
};

const deleteNpcMedia = async (
  operation: admin.firestore.DocumentSnapshot,
  operationRef: admin.firestore.DocumentReference
): Promise<OperationStepResult> => {
  await requireCurrentActorRole(operation);
  const storagePath = asTrimmedString(operation.get("storagePath"));
  let mediaCleanup = "skipped";
  if (
    ownedStoragePath(
      storagePath,
      ["echi_npcs/"],
      getStorage().bucket().name
    )
  ) {
    try {
      await getStorage().bucket().file(storagePath).delete({
        ignoreNotFound: true,
      });
      mediaCleanup = "deleted";
    } catch {
      throw new OperationStepError(
        "NPC media cleanup failed.",
        "storage",
        true,
        "cleanup-pending"
      );
    }
  }
  await operationRef.update({
    phase: "verify",
    mediaCleanup,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {done: false, phase: "verify"};
};

const finalizeNpcDeletion = async (
  operation: admin.firestore.DocumentSnapshot,
  operationRef: admin.firestore.DocumentReference
): Promise<OperationStepResult> => {
  await requireCurrentActorRole(operation);
  const npcId = asTrimmedString(asRecord(operation.get("input")).npcId);
  const [publicMarkers, privateMarkers] = await Promise.all([
    admin.firestore().collection("map_markers")
      .where("npcId", "==", npcId).limit(1).get(),
    admin.firestore().collectionGroup("map_markers_private")
      .where("npcId", "==", npcId).limit(1).get(),
  ]);
  if (!publicMarkers.empty || !privateMarkers.empty) {
    await operationRef.update({
      phase: !publicMarkers.empty
        ? "markers-public"
        : "markers-private",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      done: false,
      phase: !publicMarkers.empty ? "markers-public" : "markers-private",
    };
  }
  const npcRef = admin.firestore().doc(`echi_npcs/${npcId}`);
  await npcRef.delete();
  return {
    done: true,
    phase: "completed",
    result: {
      npcDeleted: true,
      mediaCleanup: asTrimmedString(operation.get("mediaCleanup")) ||
        "skipped",
    },
  };
};

const prepareEncounterDeletion = async (
  operation: admin.firestore.DocumentSnapshot,
  operationRef: admin.firestore.DocumentReference
): Promise<OperationStepResult> => {
  await requireCurrentActorRole(operation);
  const encounterId = asTrimmedString(
    asRecord(operation.get("input")).encounterId
  );
  const encounterRef = admin.firestore().doc(`encounters/${encounterId}`);
  const encounter = await encounterRef.get();
  if (!encounter.exists) {
    return {
      done: true,
      phase: "completed",
      result: {alreadyDeleted: true},
    };
  }
  const collections = await encounterRef.listCollections();
  await admin.firestore().runTransaction(async (transaction) => {
    const [latestOperation, latestEncounter] = await transaction.getAll(
      operationRef,
      encounterRef
    );
    if (!latestOperation.exists || !latestEncounter.exists) return;
    transaction.update(encounterRef, {
      status: "deleted",
      deletionState: "pending",
      deletionRequestedAt: FieldValue.serverTimestamp(),
      deletionRequestedBy: operation.get("actorUid"),
    });
    transaction.update(operationRef, {
      phase: "descendants",
      pendingCollections: collections.map((entry) => entry.path),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return {done: false, phase: "descendants"};
};

const deleteEncounterDescendantPage = async (
  operation: admin.firestore.DocumentSnapshot,
  operationRef: admin.firestore.DocumentReference
): Promise<OperationStepResult> => {
  await requireCurrentActorRole(operation);
  const pending = Array.isArray(operation.get("pendingCollections"))
    ? operation.get("pendingCollections")
      .map(asTrimmedString)
      .filter(Boolean)
    : [];
  if (!pending.length) {
    await operationRef.update({
      phase: "verify",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {done: false, phase: "verify"};
  }
  const collectionPath = pending[0];
  const documents = await admin.firestore().collection(collectionPath)
    .limit(WORKER_PAGE_SIZE)
    .get();
  if (documents.empty) {
    await operationRef.update({
      pendingCollections: pending.slice(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {done: false, phase: "descendants"};
  }
  const nestedCollections = new Set<string>(pending);
  const nestedByDocument = await mapWithConcurrency(
    documents.docs,
    BACKEND_OPERATION_STORAGE_CONCURRENCY,
    (document) => document.ref.listCollections()
  );
  for (const nested of nestedByDocument) {
    nested.forEach((entry) => nestedCollections.add(entry.path));
  }
  const batch = admin.firestore().batch();
  documents.docs.forEach((document) => {
    const subjectRef = operationRef.collection("subjects").doc(
      hashValue(["encounter-descendant", document.ref.path]).slice(0, 48)
    );
    batch.delete(document.ref);
    batch.create(subjectRef, {
      schemaVersion: 1,
      outcome: "succeeded",
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: backendOperationExpiry(),
    });
  });
  batch.update(operationRef, {
    pendingCollections: [...nestedCollections],
    "progress.planned": FieldValue.increment(
      documents.size
    ),
    "progress.processed": FieldValue.increment(
      documents.size
    ),
    "progress.succeeded": FieldValue.increment(
      documents.size
    ),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return {done: false, phase: "descendants"};
};

const finalizeEncounterDeletion = async (
  operation: admin.firestore.DocumentSnapshot,
  operationRef: admin.firestore.DocumentReference
): Promise<OperationStepResult> => {
  await requireCurrentActorRole(operation);
  const encounterId = asTrimmedString(
    asRecord(operation.get("input")).encounterId
  );
  const encounterRef = admin.firestore().doc(`encounters/${encounterId}`);
  const collections = await encounterRef.listCollections();
  const nonEmpty: string[] = [];
  for (const collection of collections) {
    const remaining = await collection.limit(1).get();
    if (!remaining.empty) nonEmpty.push(collection.path);
  }
  if (nonEmpty.length) {
    await operationRef.update({
      phase: "descendants",
      pendingCollections: nonEmpty,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {done: false, phase: "descendants"};
  }
  await encounterRef.delete();
  return {
    done: true,
    phase: "completed",
    result: {encounterDeleted: true},
  };
};

const processOperationStep = async (
  operation: admin.firestore.DocumentSnapshot,
  operationRef: admin.firestore.DocumentReference,
  receiptId: string
): Promise<OperationStepResult> => {
  const kind = operation.get("kind") as BackendOperationKind;
  const phase = asTrimmedString(operation.get("phase")) || "prepare";
  if (kind === "level-up-all" || kind === "set-parameter-locks") {
    return processUserPage({
      operation,
      operationRef,
      receiptId,
      kind,
    });
  }
  if (kind === "delete-npc") {
    if (phase === "prepare") {
      return prepareNpcDeletion(operation, operationRef);
    }
    if (phase === "markers-public") {
      return deleteMarkerPage({
        operation,
        operationRef,
        collectionGroup: "map_markers",
        nextPhase: "markers-private",
      });
    }
    if (phase === "markers-private") {
      return deleteMarkerPage({
        operation,
        operationRef,
        collectionGroup: "map_markers_private",
        nextPhase: "media",
      });
    }
    if (phase === "media") {
      return deleteNpcMedia(operation, operationRef);
    }
    return finalizeNpcDeletion(operation, operationRef);
  }
  if (kind === "delete-encounter") {
    if (phase === "prepare") {
      return prepareEncounterDeletion(operation, operationRef);
    }
    if (phase === "descendants") {
      return deleteEncounterDescendantPage(operation, operationRef);
    }
    return finalizeEncounterDeletion(operation, operationRef);
  }
  throw new OperationStepError(
    "This operation kind uses its domain-specific runner.",
    "validation"
  );
};

const scheduleNextWork = (
  transaction: admin.firestore.Transaction,
  operationRef: admin.firestore.DocumentReference,
  receiptId: string,
  generation: number
): void => {
  const nextGeneration = generation + 1;
  const nextWorkRef = admin.firestore().doc(
    `${WORK_COLLECTION}/${workId(receiptId, nextGeneration)}`
  );
  transaction.update(operationRef, {
    generation: nextGeneration,
    status: "pending",
    leaseOwner: FieldValue.delete(),
    leaseExpiresAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  transaction.create(nextWorkRef, {
    schemaVersion: 1,
    receiptId,
    generation: nextGeneration,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: backendOperationExpiry(),
  });
};

export const runBackendOperationWorker = onDocumentCreated(
  {
    document: `${WORK_COLLECTION}/{workId}`,
    region: REGION,
    retry: false,
  },
  async (event) => {
    const workSnapshot = event.data;
    if (!workSnapshot) return;
    const receiptId = asTrimmedString(workSnapshot.get("receiptId"));
    const generation = Math.max(0, Math.trunc(asFiniteNumber(
      workSnapshot.get("generation")
    )));
    if (!receiptId) return;
    const db = admin.firestore();
    const operationRef = operationRefFor(db, receiptId);
    const configRef = db.doc(TASK06_CONFIG_PATH);
    const telemetry = startServerTelemetry({
      functionKey: "runBackendOperationWorker",
      region: REGION,
      invocationType: "worker",
      receiptId,
    });
    const claimed = await db.runTransaction(async (transaction) => {
      const [operation, work, configSnapshot] = await transaction.getAll(
        operationRef,
        workSnapshot.ref,
        configRef
      );
      if (!operation.exists || !work.exists) return false;
      if (["completed", "failed"].includes(asTrimmedString(
        operation.get("status")
      ))) return false;
      if (
        Math.trunc(asFiniteNumber(operation.get("generation"))) !==
          generation ||
        work.get("status") !== "pending"
      ) return false;
      const config = resolveTask06BackendConfig(configSnapshot.data());
      const kind = operation.get("kind") as BackendOperationKind;
      if (!config.enabledOperationKinds.includes(kind)) {
        transaction.update(operationRef, {
          status: "paused",
          retryable: true,
          errorClass: "dependency",
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(workSnapshot.ref, {
          status: "completed",
          updatedAt: FieldValue.serverTimestamp(),
        });
        return false;
      }
      transaction.update(operationRef, {
        status: "running",
        leaseOwner: event.id,
        leaseExpiresAt: Timestamp.fromMillis(
          Date.now() + BACKEND_OPERATION_LEASE_MS
        ),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(workSnapshot.ref, {
        status: "running",
        leaseOwner: event.id,
        startedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!claimed) {
      completeServerTelemetry(telemetry, {outcome: "not-claimed"});
      return;
    }
    try {
      const operation = await operationRef.get();
      const step = await processOperationStep(
        operation,
        operationRef,
        receiptId
      );
      await db.runTransaction(async (transaction) => {
        const [latest, work] = await transaction.getAll(
          operationRef,
          workSnapshot.ref
        );
        if (!latest.exists || !work.exists) return;
        transaction.update(workSnapshot.ref, {
          status: "completed",
          completedAt: FieldValue.serverTimestamp(),
        });
        if (step.paused) {
          transaction.update(operationRef, {
            status: "paused",
            phase: step.phase,
            retryable: true,
            errorClass: "dependency",
            leaseOwner: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else if (step.done) {
          transaction.update(operationRef, {
            status: "completed",
            phase: step.phase,
            retryable: false,
            result: step.result ?? {},
            completedAt: FieldValue.serverTimestamp(),
            leaseOwner: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          scheduleNextWork(
            transaction,
            operationRef,
            receiptId,
            generation
          );
        }
      });
      completeServerTelemetry(telemetry, {
        outcome: step.done ? "completed" : step.paused ? "paused" : "continued",
        phase: step.phase,
      });
    } catch (error) {
      const operationError = error instanceof OperationStepError
        ? error
        : new OperationStepError(
          "Unexpected operation failure.",
          "internal",
          true
        );
      await db.runTransaction(async (transaction) => {
        const [latest, work] = await transaction.getAll(
          operationRef,
          workSnapshot.ref
        );
        if (!latest.exists || !work.exists) return;
        const attempt = Math.trunc(asFiniteNumber(latest.get("attempt"))) + 1;
        transaction.update(workSnapshot.ref, {
          status: "failed",
          completedAt: FieldValue.serverTimestamp(),
          errorClass: operationError.errorClass,
        });
        if (operationError.retryable && attempt < 3) {
          transaction.update(operationRef, {
            attempt,
            errorClass: operationError.errorClass,
            updatedAt: FieldValue.serverTimestamp(),
          });
          scheduleNextWork(
            transaction,
            operationRef,
            receiptId,
            generation
          );
        } else {
          transaction.update(operationRef, {
            status: operationError.terminalStatus,
            attempt,
            retryable: operationError.retryable,
            errorClass: operationError.errorClass,
            leaseOwner: FieldValue.delete(),
            leaseExpiresAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
      failServerTelemetry(telemetry, operationError.errorClass, {
        phase: asTrimmedString((await operationRef.get()).get("phase")),
      });
    }
  }
);

type LevelUpAllRequest = {
  operationId?: string;
  idempotencyKey?: string;
};

export const levelUpAllTask06Handler = async (
  request: CallableRequest<LevelUpAllRequest>
): Promise<Record<string, unknown>> => {
  const operationId = asTrimmedString(request.data?.operationId);
  if (!operationId) {
    throw new HttpsError(
      "invalid-argument",
      "operationId is required for Task 06 level-all."
    );
  }
  const operation = await createBackendOperation({
    request,
    kind: "level-up-all",
    operationId,
    operationInput: {},
  });
  return {
    ok: true,
    updated: [],
    operation,
    replayable: true,
  };
};

export const setAllParameterLocks = onCall(
  {region: REGION},
  async (request: CallableRequest<{
    operationId?: string;
    field?: string;
    value?: boolean;
  }>) => {
    const field = asTrimmedString(request.data?.field);
    if (!["lock_param_base", "lock_param_combat"].includes(field)) {
      throw new HttpsError(
        "invalid-argument",
        "field must identify a supported parameter lock."
      );
    }
    if (typeof request.data?.value !== "boolean") {
      throw new HttpsError("invalid-argument", "value must be Boolean.");
    }
    return createBackendOperation({
      request,
      kind: "set-parameter-locks",
      operationId: asTrimmedString(request.data?.operationId),
      operationInput: {field, value: request.data.value},
    });
  }
);

export const deleteNpcV2 = onCall(
  {region: REGION},
  async (request: CallableRequest<{
    operationId?: string;
    npcId?: string;
  }>) => {
    const npcId = asTrimmedString(request.data?.npcId);
    if (!isValidFirestoreDocumentId(npcId)) {
      throw new HttpsError("invalid-argument", "npcId is invalid.");
    }
    return createBackendOperation({
      request,
      kind: "delete-npc",
      operationId: asTrimmedString(request.data?.operationId),
      operationInput: {npcId},
    });
  }
);

export const deleteEncounterV2 = onCall(
  {region: REGION},
  async (request: CallableRequest<{
    operationId?: string;
    encounterId?: string;
  }>) => {
    const encounterId = asTrimmedString(request.data?.encounterId);
    if (!isValidFirestoreDocumentId(encounterId)) {
      throw new HttpsError("invalid-argument", "encounterId is invalid.");
    }
    return createBackendOperation({
      request,
      kind: "delete-encounter",
      operationId: asTrimmedString(request.data?.operationId),
      operationInput: {encounterId},
    });
  }
);

export const getBackendOperationStatus = onCall(
  {region: REGION},
  async (request: CallableRequest<{operationId?: string}>) => {
    const actorUid = asTrimmedString(request.auth?.uid);
    if (!actorUid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const operationId = validateBackendOperationId(
      request.data?.operationId
    );
    if (!operationId) {
      throw new HttpsError("invalid-argument", "operationId is invalid.");
    }
    const receiptId = backendOperationReceiptId(actorUid, operationId);
    const operation = await operationRefFor(
      admin.firestore(),
      receiptId
    ).get();
    if (!operation.exists || operation.get("actorUid") !== actorUid) {
      throw new HttpsError("not-found", "Operation not found.");
    }
    return operationViewFromData(operation.data());
  }
);

export const resumeBackendOperation = onCall(
  {region: REGION},
  async (request: CallableRequest<{operationId?: string}>) => {
    const actorUid = asTrimmedString(request.auth?.uid);
    if (!actorUid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const operationId = validateBackendOperationId(
      request.data?.operationId
    );
    if (!operationId) {
      throw new HttpsError("invalid-argument", "operationId is invalid.");
    }
    const db = admin.firestore();
    const receiptId = backendOperationReceiptId(actorUid, operationId);
    const operationRef = operationRefFor(db, receiptId);
    const configRef = db.doc(TASK06_CONFIG_PATH);
    return db.runTransaction(async (transaction) => {
      const [operation, actor, configSnapshot] = await transaction.getAll(
        operationRef,
        db.doc(`users/${actorUid}`),
        configRef
      );
      if (!operation.exists || operation.get("actorUid") !== actorUid) {
        throw new HttpsError("not-found", "Operation not found.");
      }
      const kind = operation.get("kind") as BackendOperationKind;
      assertCallableActorRole(actor, kind);
      const config = resolveTask06BackendConfig(configSnapshot.data());
      if (!config.enabledOperationKinds.includes(kind)) {
        throw new HttpsError(
          "failed-precondition",
          "This operation kind remains disabled."
        );
      }
      const status = asTrimmedString(operation.get("status"));
      const leaseExpiresAt = operation.get("leaseExpiresAt");
      const staleRunningLease = status === "running" &&
        leaseExpiresAt instanceof Timestamp &&
        leaseExpiresAt.toMillis() <= Date.now();
      if (
        !["paused", "failed", "cleanup-pending"].includes(status) &&
        !staleRunningLease
      ) {
        return operationViewFromData(operation.data(), true);
      }
      const generation = Math.trunc(
        asFiniteNumber(operation.get("generation"))
      ) + 1;
      const nextWorkRef = db.doc(
        `${WORK_COLLECTION}/${workId(receiptId, generation)}`
      );
      transaction.update(operationRef, {
        status: "pending",
        retryable: false,
        attempt: 0,
        generation,
        errorClass: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(nextWorkRef, {
        schemaVersion: 1,
        receiptId,
        generation,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: backendOperationExpiry(),
      });
      return operationViewFromData({
        ...operation.data(),
        status: "pending",
        retryable: false,
      }, true);
    });
  }
);
