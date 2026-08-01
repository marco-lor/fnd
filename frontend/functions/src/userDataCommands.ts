import {randomBytes} from "crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {
  CallableRequest,
  FunctionsErrorCode,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https";
import {
  RESOURCE_FIELDS,
  ResourceName,
  USER_ITEM_MAX_BYTES,
  USER_SHELL_MAX_BYTES,
  USER_STATE_MAX_BYTES,
  UserDataCommandTargetPolicy,
  UserDataRolloutStage,
  USER_DATA_OPERATION_TTL_DAYS,
  USER_DATA_SCHEMA_VERSION,
  applyConsumableCap,
  applyResourceMutation,
  asFiniteNumber,
  asRecord,
  asTrimmedString,
  buildAdminUserListItem,
  canListPrivateUserLabels,
  normalizeAdminUserListPagination,
  buildLegacyDomainProjection,
  buildConsumableRollPlan,
  buildLegacyEquippedSnapshot,
  buildUserShellProjection,
  consumeActiveTurnEffects,
  canAccessCatalogItem,
  cloneWithoutUndefined,
  deepMergeRecords,
  deriveEquipmentTransition,
  deriveAnimaParameters,
  deriveParameterTotals,
  deriveResourceTotals,
  exactNameKey,
  evaluateDocumentBudget,
  hashValue,
  hasAnyOwnField,
  isValidFirestoreDocumentId,
  isOperationExpired,
  normalizeDisplayName,
  normalizeResourceTotalValue,
  operationReceiptId,
  operationRequestHash,
  parseCatalogPrice,
  removeLegacyInventoryDocuments,
  replaceLegacyInventorySnapshot,
  resolveResourceFields,
  resolveUserDataCommandTargetUid,
  resolveUserDataRolloutStage,
  validateOperationId,
  writesLegacyUserProjection,
  updateLegacyInventoryQuantity,
} from "./userDataV2";
import {
  enqueueOwnedMediaCleanup,
  parseOwnedMediaPath,
  planOwnedMediaCleanup,
} from "./userOwnedMediaCleanup";
import {isUserDataLegacyDrainFrozen} from "./userDataBridge";
import {
  hasUntrustedTask07InventoryMedia,
  mergeUntrustedInventorySnapshotPatch,
  preserveTrustedTask07PersonalContent,
  stripTask07PersonalContentProjection,
  stripUntrustedTask07InventoryMedia,
} from "./task07ServerBoundary";
import {assertActiveCaller} from "./callerAuthorization";

const REGION = "europe-west8";
const MAX_MUTATION_BYTES = 256 * 1024;
const PRIVILEGED_ROLES = new Set(["dm", "webmaster"]);
const PERSONAL_CONTENT_KINDS = new Set(["spell", "tecnica"]);
const PROGRESSION_KEYS = new Set([
  "stats",
  "Parametri",
  "AltriParametri",
  "flags",
]);
const OWNER_PROTECTED_PROGRESSION_STATS = new Set([
  "level",
  "basePointsAvailable",
  "basePointsSpent",
  "combatTokensAvailable",
  "combatTokensSpent",
  "negativeBaseStatCount",
]);
const RESOURCE_NAMES = new Set(["hp", "mana", "essenza", "barriera"]);

type UnknownRecord = Record<string, unknown>;
type Transaction = admin.firestore.Transaction;
type Firestore = admin.firestore.Firestore;
type UserSnapshot = admin.firestore.DocumentSnapshot;

interface BaseCommand {
  operationId: string;
  userId?: string;
}

interface CommandAccess {
  actorUid: string;
  targetUid: string;
  actorRole: string;
  targetSnapshot: UserSnapshot;
}

interface CommandResult extends UnknownRecord {
  success: true;
}

interface IdempotentContext {
  db: Firestore;
  transaction: Transaction;
  actorUid: string;
  targetUid: string;
  receiptId: string;
  rolloutStage: UserDataRolloutStage;
  writeLegacy: boolean;
}

const fail = (
  code: FunctionsErrorCode,
  message: string
): never => {
  throw new HttpsError(code, message);
};

const assertDocumentBudget = (
  value: unknown,
  limit: number,
  label: string
): void => {
  const budget = evaluateDocumentBudget(value, limit);
  if (budget.warning) {
    console.warn("Task05 document budget warning", {
      label,
      bytes: budget.bytes,
      limit: budget.limit,
    });
  }
  if (!budget.accepted) {
    fail("failed-precondition", `${label} exceeds its document-size budget.`);
  }
};

const asUpdateData = (
  value: UnknownRecord
): admin.firestore.UpdateData<admin.firestore.DocumentData> => value;

const requireActor = (request: CallableRequest<unknown>): string => {
  const uid = asTrimmedString(request.auth?.uid);
  return uid || fail("unauthenticated", "You must be authenticated.");
};

const assertPayloadSize = (value: unknown): void => {
  if (Buffer.byteLength(JSON.stringify(value ?? null), "utf8") > MAX_MUTATION_BYTES) {
    fail("invalid-argument", "The requested mutation is too large.");
  }
};

const operationExpiry = (): Timestamp => (
  Timestamp.fromMillis(
    Date.now() + USER_DATA_OPERATION_TTL_DAYS * 24 * 60 * 60 * 1000
  )
);

const runIdempotent = async (
  request: CallableRequest<BaseCommand>,
  action: string,
  targetPolicy: UserDataCommandTargetPolicy,
  work: (context: IdempotentContext) => Promise<CommandResult>
): Promise<UnknownRecord> => {
  const actorUid = requireActor(request);
  const targetUid = resolveUserDataCommandTargetUid(
    actorUid,
    request.data?.userId,
    targetPolicy
  );
  if (!isValidFirestoreDocumentId(targetUid)) {
    fail("invalid-argument", "userId must be a single valid document ID.");
  }
  const operationId = validateOperationId(request.data?.operationId);
  if (!operationId) {
    fail(
      "invalid-argument",
      "operationId must contain 8-80 letters, numbers, underscores, or dashes."
    );
  }
  assertPayloadSize(request.data);

  const db = admin.firestore();
  const receiptId = operationReceiptId(actorUid, operationId);
  const receiptRef = db.doc(`user_operations/${receiptId}`);
  const requestHash = operationRequestHash(action, request.data);

  return db.runTransaction(async (transaction) => {
    const receipt = await transaction.get(receiptRef);
    const nowMillis = Timestamp.now().toMillis();
    const receiptExpired = receipt.exists && isOperationExpired(
      receipt.get("expiresAt"),
      nowMillis
    );
    if (receipt.exists && !receiptExpired) {
      if (
        receipt.get("actorUid") !== actorUid ||
        receipt.get("action") !== action ||
        receipt.get("requestHash") !== requestHash
      ) {
        fail(
          "already-exists",
          "This operationId was already used for a different request."
        );
      }
      if (receipt.get("status") !== "completed") {
        fail("aborted", "The previous operation is not complete. Retry later.");
      }
      return {
        ...asRecord(receipt.get("result")),
        replayed: true,
      };
    }

    const rolloutConfig = await transaction.get(
      db.doc("app_config/user_data_v2")
    );
    const rolloutStage = resolveUserDataRolloutStage(
      rolloutConfig.data(),
      targetUid
    );
    if (isUserDataLegacyDrainFrozen(
      rolloutConfig.data(),
      targetUid
    )) {
      fail(
        "unavailable",
        "User data is temporarily frozen for the legacy drain. Retry later."
      );
    }
    const result = await work({
      db,
      transaction,
      actorUid,
      targetUid,
      receiptId,
      rolloutStage,
      writeLegacy: writesLegacyUserProjection(rolloutStage),
    });
    transaction.set(receiptRef, {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      operationId,
      actorUid,
      action,
      requestHash,
      status: "completed",
      result,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: operationExpiry(),
    });
    return {...result, replayed: false};
  });
};

const commandAccess = async (
  transaction: Transaction,
  db: Firestore,
  actorUid: string,
  targetUid: string,
  ownerOnly = false
): Promise<CommandAccess> => {
  const actorRef = db.doc(`users/${actorUid}`);
  const targetRef = db.doc(`users/${targetUid}`);
  const [actorSnapshot, targetSnapshot] = actorUid === targetUid
    ? await transaction.getAll(actorRef).then(([snapshot]) => [snapshot, snapshot])
    : await transaction.getAll(actorRef, targetRef);

  assertActiveCaller(actorSnapshot);
  if (!targetSnapshot.exists) fail("not-found", "Target user not found.");
  if (targetSnapshot.get("deletionState") === "pending") {
    fail("failed-precondition", "The target account is pending deletion.");
  }

  const shellBudget = evaluateDocumentBudget(
    targetSnapshot.data(),
    USER_SHELL_MAX_BYTES
  );
  if (shellBudget.warning) {
    console.warn("Task05 user shell budget warning", {
      userKey: hashValue(targetUid).slice(0, 12),
      bytes: shellBudget.bytes,
      limit: shellBudget.limit,
    });
  }

  const actorRole = asTrimmedString(actorSnapshot.get("role")).toLowerCase();
  if (
    targetUid !== actorUid &&
    (ownerOnly || !PRIVILEGED_ROLES.has(actorRole))
  ) {
    fail("permission-denied", "You cannot mutate this user's data.");
  }
  return {actorUid, targetUid, actorRole, targetSnapshot};
};

const stateMetadata = (actorUid: string): UnknownRecord => ({
  schemaVersion: USER_DATA_SCHEMA_VERSION,
  revision: FieldValue.increment(1),
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: actorUid,
});

const inventoryName = (snapshot: unknown): string => {
  const data = asRecord(snapshot);
  const general = asRecord(data.General);
  return asTrimmedString(general.Nome ?? data.name ?? data.id);
};

const inventoryKind = (snapshot: unknown): string => {
  const data = asRecord(snapshot);
  return asTrimmedString(data.type ?? data.item_type).toLowerCase() || "legacy";
};

const inventoryDocument = (
  snapshot: UnknownRecord,
  options: {
    catalogItemId: string | null;
    catalogVersion: number | null;
    inventoryId: string;
    pricePaid: number;
    quantity?: number;
    source: string;
  }
): UnknownRecord => {
  const cleanSnapshot = cloneWithoutUndefined(snapshot) as UnknownRecord;
  const acquisitionHash = hashValue(cleanSnapshot);
  const name = inventoryName(cleanSnapshot);
  const document = {
    schemaVersion: USER_DATA_SCHEMA_VERSION,
    revision: 1,
    kind: inventoryKind(cleanSnapshot),
    quantity: Math.max(1, Math.trunc(options.quantity ?? 1)),
    catalogItemId: options.catalogItemId,
    catalogVersion: options.catalogVersion,
    acquisitionSnapshot: cleanSnapshot,
    acquisitionHash,
    currentSnapshot: cleanSnapshot,
    currentHash: acquisitionHash,
    currentRevision: 1,
    displayName: name,
    normalizedName: normalizeDisplayName(name),
    acquiredAt: FieldValue.serverTimestamp(),
    pricePaid: options.pricePaid,
    source: options.source,
    migration: null,
    legacyManaged: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  assertDocumentBudget(document, USER_ITEM_MAX_BYTES, "Inventory item");
  return document;
};

const legacyInventoryEntry = (
  snapshot: UnknownRecord,
  inventoryId: string,
  pricePaid: number,
  source: string,
  quantity = 1
): UnknownRecord => ({
  ...snapshot,
  ...(quantity > 1 ? {qty: quantity} : {}),
  _instance: {
    instanceId: inventoryId,
    acquiredAt: Timestamp.now(),
    pricePaid,
    source,
  },
});

const requireLegacyInventory = (
  result: {ok: boolean; inventory?: unknown[]; reason?: string}
): unknown[] => {
  const inventory = result.inventory;
  if (!result.ok || !inventory) {
    fail(
      "failed-precondition",
      `Legacy inventory mapping failed: ${result.reason || "unknown"}.`
    );
  }
  return inventory as unknown[];
};

type CharacterCreationAction =
  "initialize" | "selectRace" | "selectAnima" | "complete";

export const task05ListAdminUsers = onCall(
  {region: REGION},
  async (request: CallableRequest<{cursor?: string; limit?: number}>) => {
    assertPayloadSize(request.data);
    const actorUid = requireActor(request);
    const pagination = (() => {
      try {
        return normalizeAdminUserListPagination(request.data);
      } catch (error) {
        return fail("invalid-argument", (error as Error).message);
      }
    })();

    const db = admin.firestore();
    const actor = await db.doc(`users/${actorUid}`).get();
    assertActiveCaller(actor);
    if (!canListPrivateUserLabels(actor.get("role"))) {
      fail("permission-denied", "Only webmasters may list private user labels.");
    }

    let query: admin.firestore.Query = db.collection("users")
      .orderBy(admin.firestore.FieldPath.documentId())
      .select("characterId", "username", "email", "role");
    if (pagination.cursor) query = query.startAfter(pagination.cursor);
    const snapshot = await query.limit(pagination.limit + 1).get();
    const hasMore = snapshot.docs.length > pagination.limit;
    const pageDocs = snapshot.docs.slice(0, pagination.limit);
    return {
      items: pageDocs.map((document) => buildAdminUserListItem(
        document.id,
        document.data()
      )),
      cursor: hasMore && pageDocs.length > 0 ?
        pageDocs[pageDocs.length - 1].id : null,
      hasMore,
    };
  }
);

export const task05CharacterCreation = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {
    action: CharacterCreationAction;
    race?: string;
    anima?: string;
    characterId?: string;
    profile?: UnknownRecord;
  }>) => {
    const action = request.data?.action;
    if (![
      "initialize",
      "selectRace",
      "selectAnima",
      "complete",
    ].includes(action)) {
      fail("invalid-argument", "A valid character creation action is required.");
    }

    if (action === "initialize") {
      const actorUid = requireActor(request);
      if (!validateOperationId(request.data?.operationId)) {
        fail("invalid-argument", "A valid operationId is required.");
      }
      assertPayloadSize(request.data);
      const db = admin.firestore();
      const userRef = db.doc(`users/${actorUid}`);
      const rolloutRef = db.doc("app_config/user_data_v2");
      const schemaRef = db.doc("utils/schema_pg");
      const stateRefs = {
        progression: db.doc(`users/${actorUid}/state/progression`),
        resources: db.doc(`users/${actorUid}/state/resources`),
        settings: db.doc(`users/${actorUid}/state/settings`),
        equipment: db.doc(`users/${actorUid}/state/equipment`),
        profileContent: db.doc(`users/${actorUid}/state/profileContent`),
      };
      return db.runTransaction(async (transaction) => {
        const [
          rollout,
          schema,
          user,
          progression,
          resources,
          settings,
          equipment,
          profileContent,
        ] = await transaction.getAll(
          rolloutRef,
          schemaRef,
          userRef,
          stateRefs.progression,
          stateRefs.resources,
          stateRefs.settings,
          stateRefs.equipment,
          stateRefs.profileContent
        );
        if (isUserDataLegacyDrainFrozen(rollout.data(), actorUid)) {
          fail("unavailable", "User data is temporarily frozen. Retry later.");
        }
        if (user.get("deletionState") === "pending") {
          fail("failed-precondition", "The account is pending deletion.");
        }
        if (!schema.exists) {
          fail("failed-precondition", "Character schema is missing.");
        }
        const tokenEmail = asTrimmedString(request.auth?.token?.email);
        const schemaData = asRecord(schema.data());
        const userData = asRecord(user.data());
        const source: UnknownRecord = {
          ...schemaData,
          ...userData,
          ...(tokenEmail ? {email: asTrimmedString(userData.email) || tokenEmail} : {}),
          username: asTrimmedString(userData.username) ||
            tokenEmail.split("@")[0] ||
            `user_${actorUid.slice(0, 5)}`,
          role: asTrimmedString(userData.role).toLowerCase() || "player",
          flags: {
            ...asRecord(schemaData.flags),
            ...asRecord(userData.flags),
            characterCreationDone:
              asRecord(userData.flags).characterCreationDone === true,
          },
        };
        const domains = buildLegacyDomainProjection(source);
        if (!user.exists) {
          const stats = asRecord(source.stats);
          transaction.create(userRef, {
            ...buildUserShellProjection(source),
            modelVersion: USER_DATA_SCHEMA_VERSION,
            flags: source.flags,
            summary: {
              ...asRecord(source.summary),
              level: asFiniteNumber(stats.level, 1),
            },
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        const statePlans = [
          [progression, stateRefs.progression, domains.progression],
          [resources, stateRefs.resources, domains.resources],
          [settings, stateRefs.settings, domains.settings],
          [equipment, stateRefs.equipment, domains.equipment],
          [profileContent, stateRefs.profileContent, domains.profileContent],
        ] as const;
        statePlans.forEach(([snapshot, ref, data]) => {
          if (!snapshot.exists) transaction.create(ref, data);
        });
        return {
          success: true,
          created: !user.exists,
          initializedDomains: statePlans
            .filter(([snapshot]) => !snapshot.exists)
            .length,
        };
      });
    }

    return runIdempotent(
      request,
      `character-creation-${action}`,
      "actor-only",
      async (context) => {
        const access = await commandAccess(
          context.transaction,
          context.db,
          context.actorUid,
          context.targetUid,
          true
        );
        const progressionRef = context.db.doc(
          `users/${access.targetUid}/state/progression`
        );
        const progression = await context.transaction.get(progressionRef);
        const rootFlags = asRecord(access.targetSnapshot.get("flags"));
        const progressionFlags = asRecord(progression.get("flags"));
        if (
          rootFlags.characterCreationDone === true ||
          progressionFlags.characterCreationDone === true
        ) {
          fail("failed-precondition", "Character creation is already complete.");
        }

        if (action === "selectRace") {
          const race = asTrimmedString(request.data?.race);
          if (!race || race.length > 100) {
            fail("invalid-argument", "A valid race is required.");
          }
          const schemaRef = context.db.doc("utils/schema_pg");
          const varieRef = context.db.doc("utils/varie");
          const [schema, varie] = await context.transaction.getAll(
            schemaRef,
            varieRef
          );
          if (!schema.exists || !varie.exists) {
            fail("failed-precondition", "Character configuration is missing.");
          }
          const starting = asRecord(varie.get("starting_values"));
          const raceExtra = asRecord(asRecord(
            varie.get("races_extra")
          )[race]);
          const schemaParametri = asRecord(schema.get("Parametri"));
          const currentParametri = asRecord(
            progression.get("Parametri") ??
              access.targetSnapshot.get("Parametri")
          );
          const currentStats = {
            ...asRecord(access.targetSnapshot.get("stats")),
            ...asRecord(progression.get("stats")),
          };
          const nextParametri = {
            ...currentParametri,
            Base: asRecord(schemaParametri.Base),
            Combattimento: asRecord(schemaParametri.Combattimento),
          };
          const nextStats = {
            ...currentStats,
            basePointsAvailable: Math.max(0, asFiniteNumber(
              starting.abilityPoints
            ) + asFiniteNumber(raceExtra.extraAbilityCreation)),
            combatTokensAvailable: Math.max(0, asFiniteNumber(
              starting.tokenPoints
            ) + asFiniteNumber(raceExtra.extraTokenCreation)),
            basePointsSpent: 0,
            combatTokensSpent: 0,
            negativeBaseStatCount: 0,
          };
          const nextAltriParametri = {
            ...asRecord(
              progression.get("AltriParametri") ??
                access.targetSnapshot.get("AltriParametri")
            ),
            Anima_1: "---",
          };
          context.transaction.set(progressionRef, {
            ...stateMetadata(context.actorUid),
            Parametri: nextParametri,
            AltriParametri: nextAltriParametri,
            stats: nextStats,
          }, {merge: true});
          const rootUpdate: UnknownRecord = {race};
          if (context.writeLegacy) {
            rootUpdate.Parametri = nextParametri;
            rootUpdate.AltriParametri = nextAltriParametri;
            rootUpdate.stats = nextStats;
          }
          context.transaction.update(
            access.targetSnapshot.ref,
            asUpdateData(rootUpdate)
          );
          return {success: true, race};
        }

        if (action === "selectAnima") {
          const anima = asTrimmedString(request.data?.anima);
          if (!anima || anima.length > 100) {
            fail("invalid-argument", "A valid Anima shard is required.");
          }
          const nextAltriParametri = {
            ...asRecord(
              progression.get("AltriParametri") ??
                access.targetSnapshot.get("AltriParametri")
            ),
            Anima_1: anima,
          };
          context.transaction.set(progressionRef, {
            ...stateMetadata(context.actorUid),
            AltriParametri: nextAltriParametri,
          }, {merge: true});
          if (context.writeLegacy) {
            context.transaction.update(access.targetSnapshot.ref, {
              AltriParametri: nextAltriParametri,
            });
          }
          return {success: true, anima};
        }

        const characterId = asTrimmedString(request.data?.characterId);
        if (!characterId || characterId.length > 100) {
          fail("invalid-argument", "A valid characterId is required.");
        }
        const profile = asRecord(request.data?.profile);
        const profileKeys = Object.keys(profile);
        if (profileKeys.some((key) => !["imageUrl", "imagePath"].includes(key)) ||
          profileKeys.some((key) => typeof profile[key] !== "string")) {
          fail("invalid-argument", "Character profile media is invalid.");
        }
        const settingsRef = context.db.doc(
          `users/${access.targetUid}/state/settings`
        );
        const settings = await context.transaction.get(settingsRef);
        const completedFlags = {
          ...rootFlags,
          ...progressionFlags,
          characterCreationDone: true,
        };
        const nextSettings = {
          ...asRecord(settings.get("settings")),
          lock_param_base: true,
          lock_param_combat: true,
        };
        context.transaction.set(progressionRef, {
          ...stateMetadata(context.actorUid),
          flags: completedFlags,
        }, {merge: true});
        context.transaction.set(settingsRef, {
          ...stateMetadata(context.actorUid),
          settings: nextSettings,
        }, {merge: true});
        context.transaction.update(access.targetSnapshot.ref, {
          characterId,
          flags: completedFlags,
          ...profile,
          ...(context.writeLegacy ? {settings: nextSettings} : {}),
        });
        return {success: true, characterId};
      }
    );
  }
);

interface GrigliataTurnTransition {
  backgroundId: string;
  tokenId: string;
  expectedPreviousActiveTokenId: string;
  expectedTurnCounter: number;
  preserveStartedAt: boolean;
}

interface GrigliataBoardTurnEffect {
  id: string;
  kind: string;
  totalTurns: number;
  remainingTurns: number;
  appliesFromTurnCounter: number;
}

const GRIGLIATA_TURN_TRANSITION_KEYS = [
  "backgroundId",
  "expectedPreviousActiveTokenId",
  "expectedTurnCounter",
  "preserveStartedAt",
  "tokenId",
] as const;

export const normalizeGrigliataTurnTransition = (
  value: unknown
): GrigliataTurnTransition | null => {
  if (value === undefined) return null;
  const source = asRecord(value);
  const keys = Object.keys(source).sort();
  if (
    keys.length !== GRIGLIATA_TURN_TRANSITION_KEYS.length ||
    keys.some((key, index) => key !== GRIGLIATA_TURN_TRANSITION_KEYS[index])
  ) {
    fail(
      "invalid-argument",
      "The Grigliata turn transition must contain only its reviewed fields."
    );
  }
  const backgroundId = asTrimmedString(source.backgroundId);
  const tokenId = asTrimmedString(source.tokenId);
  const expectedPreviousActiveTokenId = asTrimmedString(
    source.expectedPreviousActiveTokenId
  );
  const expectedTurnCounter = typeof source.expectedTurnCounter === "number" ?
    source.expectedTurnCounter : Number.NaN;
  if (
    !isValidFirestoreDocumentId(backgroundId) ||
    !isValidFirestoreDocumentId(tokenId) ||
    (expectedPreviousActiveTokenId &&
      !isValidFirestoreDocumentId(expectedPreviousActiveTokenId)) ||
    !Number.isSafeInteger(expectedTurnCounter) ||
    expectedTurnCounter < 1 ||
    typeof source.preserveStartedAt !== "boolean"
  ) {
    fail("invalid-argument", "The Grigliata turn transition is invalid.");
  }
  return {
    backgroundId,
    tokenId,
    expectedPreviousActiveTokenId,
    expectedTurnCounter,
    preserveStartedAt: source.preserveStartedAt === true,
  };
};

const normalizeGrigliataBoardTurnEffect = (
  value: unknown
): GrigliataBoardTurnEffect | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = asRecord(value);
  const id = asTrimmedString(source.id);
  const kind = asTrimmedString(source.kind);
  const totalTurns = typeof source.totalTurns === "number" &&
    Number.isSafeInteger(source.totalTurns) && source.totalTurns >= 1 ?
    source.totalTurns : 0;
  if (!id || !kind || totalTurns < 1) return null;
  const remainingTurns = typeof source.remainingTurns === "number" &&
    Number.isSafeInteger(source.remainingTurns) && source.remainingTurns >= 0 ?
    Math.min(totalTurns, source.remainingTurns) : totalTurns;
  const appliesFromTurnCounter = typeof source.appliesFromTurnCounter === "number" &&
    Number.isSafeInteger(source.appliesFromTurnCounter) &&
    source.appliesFromTurnCounter >= 0 ? source.appliesFromTurnCounter : 0;
  return {
    id,
    kind,
    totalTurns,
    remainingTurns,
    appliesFromTurnCounter,
  };
};

const reconcileGrigliataBoardTurnEffects = (
  value: unknown,
  turnCounter: number
): {turnEffects: GrigliataBoardTurnEffect[]; expiredShield: boolean} => {
  const turnEffects: GrigliataBoardTurnEffect[] = [];
  let expiredShield = false;
  (Array.isArray(value) ? value : []).forEach((candidate) => {
    const effect = normalizeGrigliataBoardTurnEffect(candidate);
    if (!effect) return;
    const consumedTurns = Math.max(
      0,
      turnCounter - effect.appliesFromTurnCounter
    );
    const remainingTurns = Math.max(0, effect.totalTurns - consumedTurns);
    if (remainingTurns < 1) {
      if (effect.kind === "shield") expiredShield = true;
      return;
    }
    turnEffects.push({...effect, remainingTurns});
  });
  return {turnEffects, expiredShield};
};

export const task05ConsumeTurnEffects = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {
    grigliataTransition?: GrigliataTurnTransition;
  }>) => {
    const grigliataTransition = normalizeGrigliataTurnTransition(
      request.data?.grigliataTransition
    );
    return runIdempotent(
      request,
      "consume-turn-effects",
      "request-user-or-actor",
      async (context) => {
        const access = await commandAccess(
          context.transaction,
          context.db,
          context.actorUid,
          context.targetUid
        );
        if (access.actorRole !== "dm") {
          fail("permission-denied", "Only a DM may consume turn effects.");
        }
        const resourcesRef = context.db.doc(
          `users/${access.targetUid}/state/resources`
        );
        const resources = await context.transaction.get(resourcesRef);
        let transitionState: null | {
          backgroundRef: admin.firestore.DocumentReference;
          placementRef: admin.firestore.DocumentReference;
          activeTurn: UnknownRecord;
          joinedAt: unknown;
          initiative: number;
          label: string;
          nextTurnEffects: GrigliataBoardTurnEffect[];
          nextShieldEffect: GrigliataBoardTurnEffect | null;
          expiredShield: boolean;
          currentShieldEffect: GrigliataBoardTurnEffect;
        } = null;
        if (grigliataTransition) {
          const backgroundRef = context.db.doc(
            `grigliata_backgrounds/${grigliataTransition.backgroundId}`
          );
          const placementRef = context.db.doc(
            `grigliata_token_placements/${grigliataTransition.backgroundId}__${grigliataTransition.tokenId}`
          );
          const tokenRef = context.db.doc(
            `grigliata_tokens/${grigliataTransition.tokenId}`
          );
          const [background, placement, token] = await context.transaction.getAll(
            backgroundRef,
            placementRef,
            tokenRef
          );
          if (!background.exists || !placement.exists) {
            fail("failed-precondition", "The Grigliata turn context is stale.");
          }
          const activeTurn = asRecord(background.get("turnOrderActive"));
          const currentActiveTokenId = asTrimmedString(activeTurn.tokenId);
          const currentTurnCounterValue = placement.get("turnCounter");
          const currentTurnCounter = typeof currentTurnCounterValue === "number" &&
            Number.isSafeInteger(currentTurnCounterValue) &&
            currentTurnCounterValue >= 0 ? currentTurnCounterValue : 0;
          const placementOwnerUid = asTrimmedString(placement.get("ownerUid"));
          const placementTokenId = asTrimmedString(
            placement.get("tokenId")
          ) || placementOwnerUid;
          const currentTurnEffects = Array.isArray(placement.get("turnEffects")) ?
            placement.get("turnEffects") : [];
          const currentShieldEffects = currentTurnEffects
            .map((effect: unknown) => normalizeGrigliataBoardTurnEffect(effect))
            .filter((effect: GrigliataBoardTurnEffect | null): effect is GrigliataBoardTurnEffect =>
              effect?.kind === "shield"
            );
          const currentShieldEffect = currentShieldEffects.length === 1 ?
            currentShieldEffects[0] : null;
          if (
            placement.get("backgroundId") !== grigliataTransition.backgroundId ||
            placementTokenId !== grigliataTransition.tokenId ||
            placementOwnerUid !== access.targetUid ||
            grigliataTransition.tokenId !== access.targetUid ||
            placement.get("isInTurnOrder") !== true ||
            (token.exists && (
              (asTrimmedString(token.get("tokenType")) &&
                token.get("tokenType") !== "character") ||
              (asTrimmedString(token.get("ownerUid")) &&
                asTrimmedString(token.get("ownerUid")) !== access.targetUid)
            )) ||
            currentActiveTokenId !==
              grigliataTransition.expectedPreviousActiveTokenId ||
            currentTurnCounter + 1 !== grigliataTransition.expectedTurnCounter ||
            !currentShieldEffect
          ) {
            fail("failed-precondition", "The Grigliata turn context changed.");
          }
          const initiativeValue = placement.get("turnOrderInitiative");
          const reconciled = reconcileGrigliataBoardTurnEffects(
            currentTurnEffects,
            grigliataTransition.expectedTurnCounter
          );
          transitionState = {
            backgroundRef,
            placementRef,
            currentShieldEffect: currentShieldEffect as GrigliataBoardTurnEffect,
            activeTurn,
            joinedAt: placement.get("turnOrderJoinedAt") ?? null,
            initiative: typeof initiativeValue === "number" &&
              Number.isSafeInteger(initiativeValue) ? initiativeValue : 0,
            label: asTrimmedString(placement.get("label")),
            nextTurnEffects: reconciled.turnEffects,
            nextShieldEffect: reconciled.turnEffects.find(
              (effect) => effect.kind === "shield"
            ) ?? null,
            expiredShield: reconciled.expiredShield,
          };
        }
        const canonicalActiveTurnEffects = resources.get("active_turn_effect");
        const activeTurnEffectsSource = context.rolloutStage === "new-only" ?
          canonicalActiveTurnEffects :
          canonicalActiveTurnEffects ?? access.targetSnapshot.get("active_turn_effect");
        if (transitionState) {
          const resourceShield = asRecord(
            asRecord(activeTurnEffectsSource).barriera
          );
          if (
            resourceShield.totalTurns !== transitionState.currentShieldEffect.totalTurns ||
            resourceShield.remainingTurns !== transitionState.currentShieldEffect.remainingTurns
          ) {
            fail(
              "failed-precondition",
              "The Grigliata shield timer changed outside the active board."
            );
          }
        }
        const consumption = consumeActiveTurnEffects(activeTurnEffectsSource);
        if (!consumption.changed && !transitionState) {
          return {success: true, changed: false};
        }
        const barrierExpired = transitionState ?
          transitionState.expiredShield : consumption.barrierExpired;
        const synchronizedEffects = transitionState ? {
          ...consumption.effects,
          barriera: transitionState.nextShieldEffect ? {
            ...asRecord(consumption.effects.barriera),
            totalTurns: transitionState.nextShieldEffect.totalTurns,
            remainingTurns: transitionState.nextShieldEffect.remainingTurns,
          } : {
            ...asRecord(consumption.effects.barriera),
            totalTurns: 0,
            remainingTurns: 0,
          },
        } : consumption.effects;
        if (consumption.changed || barrierExpired || transitionState) {
          const resourcesUpdate: UnknownRecord = {
            ...stateMetadata(context.actorUid),
            active_turn_effect: synchronizedEffects,
          };
          if (barrierExpired) {
            resourcesUpdate.stats = {
              ...asRecord(resources.get("stats")),
              barrieraCurrent: 0,
              barrieraTotal: 0,
            };
          }
          context.transaction.set(resourcesRef, resourcesUpdate, {merge: true});
          if (context.writeLegacy) {
            const legacyUpdate: UnknownRecord = {
              active_turn_effect: synchronizedEffects,
            };
            if (barrierExpired) {
              legacyUpdate["stats.barrieraCurrent"] = 0;
              legacyUpdate["stats.barrieraTotal"] = 0;
            }
            context.transaction.update(
              access.targetSnapshot.ref,
              asUpdateData(legacyUpdate)
            );
          }
        }
        if (transitionState && grigliataTransition) {
          const startedAt = grigliataTransition.preserveStartedAt &&
            transitionState.activeTurn.startedAt ?
            transitionState.activeTurn.startedAt : FieldValue.serverTimestamp();
          context.transaction.set(transitionState.backgroundRef, {
            turnOrderActive: {
              tokenId: grigliataTransition.tokenId,
              initiative: transitionState.initiative,
              joinedAt: transitionState.joinedAt,
              label: transitionState.label,
              startedAt,
            },
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: context.actorUid,
          }, {merge: true});
          context.transaction.set(transitionState.placementRef, {
            backgroundId: grigliataTransition.backgroundId,
            tokenId: grigliataTransition.tokenId,
            ownerUid: access.targetUid,
            turnCounter: grigliataTransition.expectedTurnCounter,
            turnEffects: transitionState.nextTurnEffects.length ?
              transitionState.nextTurnEffects : FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: context.actorUid,
          }, {merge: true});
        }
        return {
          success: true,
          changed: consumption.changed,
          barrierExpired,
          transitioned: !!transitionState,
          ...(grigliataTransition ? {
            turnCounter: grigliataTransition.expectedTurnCounter,
          } : {}),
        };
      }
    );
  }
);

export const task05PurchaseItem = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {itemId: string}>) => {
    const itemId = asTrimmedString(request.data?.itemId);
    if (!itemId) fail("invalid-argument", "A catalog itemId is required.");

    return runIdempotent(
      request,
      "purchase-item",
      "actor-only",
      async (context) => {
      const {db, transaction, actorUid, receiptId} = context;
      const access = await commandAccess(
        transaction,
        db,
        actorUid,
        context.targetUid,
        true
      );
      const catalogRef = db.doc(`items/${itemId}`);
      const resourcesRef = db.doc(`users/${actorUid}/state/resources`);
      const inventoryId = `purchase_${receiptId}`;
      const inventoryRef = db.doc(`users/${actorUid}/inventory/${inventoryId}`);
      const [catalogSnapshot, resourcesSnapshot] = await transaction.getAll(
        catalogRef,
        resourcesRef
      );
      if (!catalogSnapshot.exists) fail("not-found", "Catalog item not found.");
      const catalogData = catalogSnapshot.data() ?? {};
      if (!canAccessCatalogItem(catalogData, actorUid, access.actorRole)) {
        fail("permission-denied", "This catalog item is not available to you.");
      }
      const parsedPrice = parseCatalogPrice(
        asRecord(catalogData.General).prezzo
      );
      const price = parsedPrice === null
        ? fail("failed-precondition", "Catalog price is invalid.")
        : parsedPrice;
      const resourceStats = asRecord(resourcesSnapshot.get("stats"));
      const rootStats = asRecord(access.targetSnapshot.get("stats"));
      const currentGold = asFiniteNumber(resourceStats.gold ?? rootStats.gold);
      if (currentGold < price) {
        fail("resource-exhausted", "Insufficient gold.");
      }
      const nextGold = currentGold - price;
      const currentInventory = Array.isArray(access.targetSnapshot.get("inventory"))
        ? [...access.targetSnapshot.get("inventory")]
        : [];
      const catalogVersion = catalogSnapshot.updateTime?.toMillis() ?? null;
      // A catalog attachment has one authoritative reference path. Copying it
      // into a user inventory snapshot would create an untracked second
      // reference that cleanup cannot prove safe. Keep the compatibility
      // legacy fields, but clean the complete Task 07 descriptor/CAS family.
      const snapshot = stripUntrustedTask07InventoryMedia({
        ...catalogData,
        id: itemId,
      });
      currentInventory.push(legacyInventoryEntry(
        snapshot,
        inventoryId,
        price,
        "bazaar"
      ));

      transaction.set(inventoryRef, inventoryDocument(snapshot, {
        catalogItemId: itemId,
        catalogVersion,
        inventoryId,
        pricePaid: price,
        source: "bazaar",
      }));
      transaction.set(resourcesRef, {
        ...stateMetadata(actorUid),
        stats: {gold: nextGold},
      }, {merge: true});
      if (context.writeLegacy) {
        transaction.update(access.targetSnapshot.ref, {
          "stats.gold": nextGold,
          inventory: currentInventory,
          modelVersion: USER_DATA_SCHEMA_VERSION,
        });
      }
      return {
        success: true,
        inventoryId,
        price,
        previousGold: currentGold,
        newGold: nextGold,
      };
      }
    );
  }
);

export const task05AdjustGold = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {delta: number}>) => {
    const delta = asFiniteNumber(request.data?.delta, Number.NaN);
    if (!Number.isFinite(delta) || delta === 0) {
      fail("invalid-argument", "A non-zero finite delta is required.");
    }
    return runIdempotent(
      request,
      "adjust-gold",
      "request-user-or-actor",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid
      );
      const resourcesRef = context.db.doc(
        `users/${access.targetUid}/state/resources`
      );
      const resources = await context.transaction.get(resourcesRef);
      const current = asFiniteNumber(
        asRecord(resources.get("stats")).gold ??
          asRecord(access.targetSnapshot.get("stats")).gold
      );
      const next = Math.max(0, current + delta);
      context.transaction.set(resourcesRef, {
        ...stateMetadata(context.actorUid),
        stats: {gold: next},
      }, {merge: true});
      if (context.writeLegacy) {
        context.transaction.update(access.targetSnapshot.ref, {
          "stats.gold": next,
        });
      }
      return {success: true, previousGold: current, newGold: next};
      }
    );
  }
);

export const task05UpdateResource = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {
    resource: ResourceName;
    mode: "set" | "delta";
    value: number;
    totalValue?: number;
    remainingTurns?: number;
    totalTurns?: number;
  }>) => {
    const resource = request.data?.resource;
    const mode = request.data?.mode;
    if (!RESOURCE_NAMES.has(resource) || !["set", "delta"].includes(mode)) {
      fail("invalid-argument", "A valid resource and mutation mode are required.");
    }
    return runIdempotent(
      request,
      "update-resource",
      "request-user-or-actor",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid
      );
      const resourcesRef = context.db.doc(
        `users/${access.targetUid}/state/resources`
      );
      const resources = await context.transaction.get(resourcesRef);
      const fields = resolveResourceFields(resource);
      const current = asRecord(resources.get("stats"))[fields.current] ??
        asRecord(access.targetSnapshot.get("stats"))[fields.current];
      const next = applyResourceMutation(current, mode, request.data?.value);
      if (next === null) fail("invalid-argument", "Resource value must be finite.");
      const totalValue = request.data?.totalValue === undefined
        ? null
        : normalizeResourceTotalValue(request.data.totalValue);
      if (request.data?.totalValue !== undefined && totalValue === null) {
        fail("invalid-argument", "Resource total must be a non-negative finite value.");
      }
      const stateUpdate: UnknownRecord = {
        ...stateMetadata(context.actorUid),
        stats: {[fields.current]: next},
      };
      const legacyUpdate: UnknownRecord = {
        [`stats.${fields.current}`]: next,
      };
      if (totalValue !== null) {
        asRecord(stateUpdate.stats)[fields.total] = totalValue;
        legacyUpdate[`stats.${fields.total}`] = totalValue;
      }
      if (resource === "barriera" && totalValue !== null) {
        const remainingTurns = Math.trunc(asFiniteNumber(
          request.data.remainingTurns,
          Number.NaN
        ));
        const totalTurns = Math.trunc(asFiniteNumber(
          request.data.totalTurns,
          Number.NaN
        ));
        if (
          !Number.isFinite(remainingTurns) || remainingTurns < 0 ||
          !Number.isFinite(totalTurns) || totalTurns < remainingTurns
        ) {
          fail("invalid-argument", "Barrier total and turns are invalid.");
        }
        stateUpdate.active_turn_effect = {
          barriera: {remainingTurns, totalTurns},
        };
        legacyUpdate["active_turn_effect.barriera"] = {
          remainingTurns,
          totalTurns,
        };
      }
      context.transaction.set(resourcesRef, stateUpdate, {merge: true});
      if (context.writeLegacy) {
        context.transaction.update(
          access.targetSnapshot.ref,
          asUpdateData(legacyUpdate)
        );
      }
      return {
        success: true,
        resource,
        previousValue: asFiniteNumber(current),
        newValue: next,
        ...(totalValue === null ? {} : {newTotalValue: totalValue}),
      };
      }
    );
  }
);

export const task05UpdateGrigliataCharacterResources = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {
    backgroundId: string;
    tokenId: string;
    resources: {
      hpCurrent: number;
      manaCurrent: number;
      barrieraCurrent: number;
    };
    tokenPatch?: UnknownRecord;
  }>) => {
    const backgroundId = asTrimmedString(request.data?.backgroundId);
    const tokenId = asTrimmedString(request.data?.tokenId);
    const resourceInput = asRecord(request.data?.resources);
    const nextResources = Object.fromEntries([
      "hpCurrent",
      "manaCurrent",
      "barrieraCurrent",
    ].map((key) => [key, asFiniteNumber(resourceInput[key], Number.NaN)]));
    if (!backgroundId || !tokenId || Object.values(nextResources).some(
      (value) => !Number.isFinite(value) || value < 0
    )) {
      fail("invalid-argument", "Valid board context and resources are required.");
    }
    const tokenPatch = asRecord(request.data?.tokenPatch);
    const allowedTokenFields = new Set([
      "characterId",
      "label",
      "imageUrl",
      "imagePath",
      "notes",
    ]);
    if (Object.keys(tokenPatch).some((key) => !allowedTokenFields.has(key))) {
      fail("invalid-argument", "The token patch contains unsupported fields.");
    }
    return runIdempotent(
      request,
      "grigliata-character-resources",
      "request-user-or-actor",
      async (context) => {
        const access = await commandAccess(
          context.transaction,
          context.db,
          context.actorUid,
          context.targetUid
        );
        if (access.targetUid !== context.actorUid && access.actorRole !== "dm") {
          fail("permission-denied", "Only the board DM may edit another character.");
        }
        const backgroundRef = context.db.doc(
          `grigliata_backgrounds/${backgroundId}`
        );
        const placementRef = context.db.doc(
          `grigliata_token_placements/${backgroundId}__${tokenId}`
        );
        const tokenRef = context.db.doc(`grigliata_tokens/${tokenId}`);
        const resourcesRef = context.db.doc(
          `users/${access.targetUid}/state/resources`
        );
        const [background, placement, token] = await context.transaction.getAll(
          backgroundRef,
          placementRef,
          tokenRef
        );
        if (!background.exists || !placement.exists || !token.exists) {
          fail("failed-precondition", "The board token context is stale.");
        }
        if (
          placement.get("backgroundId") !== backgroundId ||
          placement.get("tokenId") !== tokenId ||
          token.get("tokenType") !== "character" ||
          asTrimmedString(token.get("ownerUid")) !== access.targetUid
        ) {
          fail("failed-precondition", "The board token ownership is invalid.");
        }
        context.transaction.set(resourcesRef, {
          ...stateMetadata(context.actorUid),
          stats: nextResources,
        }, {merge: true});
        context.transaction.set(tokenRef, {
          ...cloneWithoutUndefined(tokenPatch) as UnknownRecord,
          ownerUid: access.targetUid,
          tokenType: "character",
          imageSource: "profile",
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.actorUid,
        }, {merge: true});
        if (context.writeLegacy) {
          context.transaction.update(access.targetSnapshot.ref, {
            "stats.hpCurrent": nextResources.hpCurrent,
            "stats.manaCurrent": nextResources.manaCurrent,
            "stats.barrieraCurrent": nextResources.barrieraCurrent,
          });
        }
        return {
          success: true,
          backgroundId,
          tokenId,
          userId: access.targetUid,
          resources: nextResources,
        };
      }
    );
  }
);

export const task05SetEquipment = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {
    slot: string;
    inventoryId: string | null;
  }>) => {
    const slot = asTrimmedString(request.data?.slot);
    const inventoryId = request.data?.inventoryId === null
      ? null
      : asTrimmedString(request.data?.inventoryId);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slot)) {
      fail("invalid-argument", "A valid equipment slot is required.");
    }
    if (request.data?.inventoryId !== null && !inventoryId) {
      fail("invalid-argument", "inventoryId must be a string or null.");
    }

    return runIdempotent(
      request,
      "set-equipment",
      "request-user-or-actor",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid
      );
      const equipmentRef = context.db.doc(
        `users/${access.targetUid}/state/equipment`
      );
      const equipment = await context.transaction.get(equipmentRef);
      const requestedSlots = {
        ...asRecord(equipment.get("slots")),
        [slot]: inventoryId,
      };
      const inventoryIds = [...new Set(Object.values(requestedSlots)
        .map(asTrimmedString)
        .filter(Boolean))];
      const progressionRef = context.db.doc(
        `users/${access.targetUid}/state/progression`
      );
      const resourcesRef = context.db.doc(
        `users/${access.targetUid}/state/resources`
      );
      const utilsRef = context.db.doc("utils/varie");
      const inventoryRefs = inventoryIds.map((id) => context.db.doc(
        `users/${access.targetUid}/inventory/${id}`
      ));
      const [progression, utils, ...inventorySnapshots] =
        await context.transaction.getAll(
          progressionRef,
          utilsRef,
          ...inventoryRefs
        );
      const inventoryById = Object.fromEntries(inventorySnapshots.map(
        (snapshot, index) => [
          inventoryIds[index],
          snapshot.exists ? asRecord(snapshot.get("currentSnapshot")) : null,
        ]
      ));
      if (inventoryId && !inventoryById[inventoryId]) {
        fail("not-found", "Inventory item not found.");
      }
      const transition = deriveEquipmentTransition({
        slots: requestedSlots,
        inventoryById,
        slot,
        inventoryId,
        parametri: progression.get("Parametri") ??
          access.targetSnapshot.get("Parametri"),
        level: asRecord(progression.get("stats")).level ??
          asRecord(access.targetSnapshot.get("stats")).level,
      });
      if (!transition.ok) {
        fail(
          "failed-precondition",
          `Equipment transition rejected: ${transition.error}.`
        );
      }
      assertDocumentBudget({
        slots: transition.slots,
        beltCapacity: transition.beltCapacity,
      }, USER_STATE_MAX_BYTES, "Equipment state");
      assertDocumentBudget(
        {Parametri: transition.parametri},
        USER_STATE_MAX_BYTES,
        "Progression state"
      );
      context.transaction.set(equipmentRef, {
        ...stateMetadata(context.actorUid),
        slots: transition.slots,
        beltCapacity: transition.beltCapacity,
      }, {merge: true});
      context.transaction.set(progressionRef, {
        ...stateMetadata(context.actorUid),
        Parametri: transition.parametri,
      }, {merge: true});
      const resourceTotals = deriveResourceTotals({
        parametri: transition.parametri,
        level: asRecord(progression.get("stats")).level ??
          asRecord(access.targetSnapshot.get("stats")).level,
        utils: utils.data(),
      });
      if (Object.keys(resourceTotals).length) {
        context.transaction.set(resourcesRef, {
          ...stateMetadata(context.actorUid),
          stats: resourceTotals,
        }, {merge: true});
      }
      if (context.writeLegacy) {
        const legacyUpdate: UnknownRecord = {
          equipped: buildLegacyEquippedSnapshot(
            transition.slots,
            inventoryById
          ),
          Parametri: transition.parametri,
        };
        Object.entries(resourceTotals).forEach(([key, value]) => {
          legacyUpdate[`stats.${key}`] = value;
        });
        context.transaction.update(
          access.targetSnapshot.ref,
          asUpdateData(legacyUpdate)
        );
      }
      return {
        success: true,
        slot,
        inventoryId,
        beltCapacity: transition.beltCapacity,
        clearedSlots: Object.keys(requestedSlots).filter((key) => (
          requestedSlots[key] && !transition.slots[key]
        )),
      };
      }
    );
  }
);

export const task05MutateInventory = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {
    action: "remove" | "removeMany" | "setQuantity" | "grant" | "edit" |
      "createVarie";
    inventoryId?: string;
    itemId?: string;
    quantity?: number;
    patch?: UnknownRecord;
    snapshot?: UnknownRecord;
    inventoryIds?: string[];
  }>) => {
    const action = request.data?.action;
    if (![
      "remove",
      "removeMany",
      "setQuantity",
      "grant",
      "edit",
      "createVarie",
    ].includes(action)) {
      fail("invalid-argument", "A valid inventory action is required.");
    }
    return runIdempotent(
      request,
      `inventory-${action}`,
      "request-user-or-actor",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid
      );
      const quantity = Math.trunc(asFiniteNumber(
        request.data?.quantity,
        Number.NaN
      ));

      if (action === "removeMany") {
        const inventoryIds = Array.isArray(request.data?.inventoryIds)
          ? [...new Set(request.data.inventoryIds.map(asTrimmedString))]
            .filter(Boolean)
          : [];
        if (
          inventoryIds.length < 1 ||
          inventoryIds.length > 50 ||
          inventoryIds.length !== request.data?.inventoryIds?.length
        ) {
          fail(
            "invalid-argument",
            "removeMany requires 1-50 unique inventoryIds."
          );
        }
        const equipmentRef = context.db.doc(
          `users/${access.targetUid}/state/equipment`
        );
        const inventoryRefs = inventoryIds.map((id) => context.db.doc(
          `users/${access.targetUid}/inventory/${id}`
        ));
        const [equipment, ...inventorySnapshots] = await context.transaction
          .getAll(equipmentRef, ...inventoryRefs);
        if (inventorySnapshots.some((snapshot) => !snapshot.exists)) {
          fail("not-found", "One or more inventory items were not found.");
        }
        const equippedIds = new Set(Object.values(asRecord(
          equipment.get("slots")
        )).map(asTrimmedString).filter(Boolean));
        if (inventoryIds.some((id) => equippedIds.has(id))) {
          fail("failed-precondition", "Unequip items before removing them.");
        }
        inventoryRefs.forEach((ref) => context.transaction.delete(ref));
        inventorySnapshots.forEach((snapshot, index) => {
          enqueueOwnedMediaCleanup(context.transaction, context.db, {
            paths: planOwnedMediaCleanup({
              before: snapshot.data(),
              after: null,
              uid: access.targetUid,
              scope: "inventory",
              entityId: inventoryIds[index],
            }),
            uid: access.targetUid,
            scope: "inventory",
            entityId: inventoryIds[index],
            source: "inventory-remove-many",
            requestedBy: context.actorUid,
          });
        });
        if (context.writeLegacy) {
          const v2Documents = Object.fromEntries(inventorySnapshots.map(
            (snapshot, index) => [inventoryIds[index], snapshot.data() ?? {}]
          ));
          const rootInventory = requireLegacyInventory(
            removeLegacyInventoryDocuments(
              access.targetSnapshot.get("inventory"),
              v2Documents
            )
          );
          context.transaction.update(access.targetSnapshot.ref, {
            inventory: rootInventory,
          });
        }
        return {success: true, inventoryIds, removed: inventoryIds.length};
      }

      if (action === "createVarie") {
        if (!Number.isFinite(quantity) || quantity < 1 || quantity > 9999) {
          fail("invalid-argument", "Quantity must be between 1 and 9999.");
        }
        const requestedSnapshot = asRecord(request.data?.snapshot);
        if (hasUntrustedTask07InventoryMedia(requestedSnapshot)) {
          fail(
            "invalid-argument",
            "Custom inventory snapshots cannot set Task 07 media."
          );
        }
        const safeRequestedSnapshot =
          stripUntrustedTask07InventoryMedia(requestedSnapshot);
        const name = inventoryName(safeRequestedSnapshot);
        if (!name) fail("invalid-argument", "A Varie item name is required.");
        const snapshot = {
          ...safeRequestedSnapshot,
          type: "varie",
          item_type: "varie",
        };
        assertPayloadSize(snapshot);
        const inventoryId = `varie_${context.receiptId}`;
        const inventoryRef = context.db.doc(
          `users/${access.targetUid}/inventory/${inventoryId}`
        );
        context.transaction.create(inventoryRef, inventoryDocument(snapshot, {
          catalogItemId: null,
          catalogVersion: null,
          inventoryId,
          pricePaid: 0,
          quantity,
          source: access.targetUid === context.actorUid
            ? "player-custom"
            : "dm-custom",
        }));
        if (context.writeLegacy) {
          const rootInventory = Array.isArray(
            access.targetSnapshot.get("inventory")
          ) ? [...access.targetSnapshot.get("inventory")] : [];
          rootInventory.push(legacyInventoryEntry(
            snapshot,
            inventoryId,
            0,
            access.targetUid === context.actorUid
              ? "player-custom"
              : "dm-custom",
            quantity
          ));
          context.transaction.update(access.targetSnapshot.ref, {
            inventory: rootInventory,
          });
        }
        return {success: true, inventoryId, quantity};
      }

      if (action === "grant") {
        if (!PRIVILEGED_ROLES.has(access.actorRole)) {
          fail("permission-denied", "Only DMs or webmasters can grant items.");
        }
        const itemId = asTrimmedString(request.data?.itemId);
        if (!itemId || !Number.isFinite(quantity) || quantity < 1 || quantity > 50) {
          fail("invalid-argument", "Grant requires an itemId and quantity 1-50.");
        }
        const catalogRef = context.db.doc(`items/${itemId}`);
        const catalog = await context.transaction.get(catalogRef);
        if (!catalog.exists) fail("not-found", "Catalog item not found.");
        // Grants follow the same copy boundary as purchases: legacy media is
        // retained for compatibility, while canonical ownership/CAS fields
        // are stripped until this inventory target receives its own family.
        const snapshot = stripUntrustedTask07InventoryMedia({
          ...(catalog.data() ?? {}),
          id: itemId,
        });
        const kind = inventoryKind(snapshot);
        const documentCount = kind === "varie" ? 1 : quantity;
        const rootInventory = Array.isArray(access.targetSnapshot.get("inventory"))
          ? [...access.targetSnapshot.get("inventory")]
          : [];
        const inventoryIds: string[] = [];
        for (let index = 0; index < documentCount; index += 1) {
          const inventoryId = `grant_${hashValue([
            context.receiptId,
            index,
          ]).slice(0, 32)}`;
          inventoryIds.push(inventoryId);
          context.transaction.create(
            context.db.doc(`users/${access.targetUid}/inventory/${inventoryId}`),
            inventoryDocument(snapshot, {
              catalogItemId: itemId,
              catalogVersion: catalog.updateTime?.toMillis() ?? null,
              inventoryId,
              pricePaid: 0,
              quantity: kind === "varie" ? quantity : 1,
              source: "dm-grant",
            })
          );
          rootInventory.push(legacyInventoryEntry(
            snapshot,
            inventoryId,
            0,
            "dm-grant",
            kind === "varie" ? quantity : 1
          ));
        }
        if (context.writeLegacy) {
          context.transaction.update(access.targetSnapshot.ref, {
            inventory: rootInventory,
          });
        }
        return {success: true, inventoryIds, quantity};
      }

      const inventoryId = asTrimmedString(request.data?.inventoryId);
      if (!inventoryId) fail("invalid-argument", "inventoryId is required.");
      const inventoryRef = context.db.doc(
        `users/${access.targetUid}/inventory/${inventoryId}`
      );
      const equipmentRef = context.db.doc(
        `users/${access.targetUid}/state/equipment`
      );
      const [inventory, equipment] = await context.transaction.getAll(
        inventoryRef,
        equipmentRef
      );
      if (!inventory.exists) fail("not-found", "Inventory item not found.");

      const rootInventory = Array.isArray(access.targetSnapshot.get("inventory"))
        ? [...access.targetSnapshot.get("inventory")]
        : [];

      if (action === "remove") {
        const slots = asRecord(equipment.get("slots"));
        if (Object.values(slots).some((value) => value === inventoryId)) {
          fail("failed-precondition", "Unequip the item before removing it.");
        }
        const nextLegacyInventory = context.writeLegacy
          ? requireLegacyInventory(removeLegacyInventoryDocuments(
            rootInventory,
            {[inventoryId]: inventory.data() ?? {}}
          ))
          : rootInventory;
        context.transaction.delete(inventoryRef);
        enqueueOwnedMediaCleanup(context.transaction, context.db, {
          paths: planOwnedMediaCleanup({
            before: inventory.data(),
            after: null,
            uid: access.targetUid,
            scope: "inventory",
            entityId: inventoryId,
          }),
          uid: access.targetUid,
          scope: "inventory",
          entityId: inventoryId,
          source: "inventory-remove",
          requestedBy: context.actorUid,
        });
        if (context.writeLegacy) {
          context.transaction.update(access.targetSnapshot.ref, {
            inventory: nextLegacyInventory,
          });
        }
        return {success: true, inventoryId, removed: true};
      }

      if (action === "setQuantity") {
        if (!Number.isFinite(quantity) || quantity < 1 || quantity > 9999) {
          fail("invalid-argument", "Quantity must be between 1 and 9999.");
        }
        if (inventory.get("kind") !== "varie") {
          fail("failed-precondition", "Only Varie stacks have a quantity.");
        }
        const nextLegacyInventory = context.writeLegacy
          ? requireLegacyInventory(updateLegacyInventoryQuantity(
            rootInventory,
            inventoryId,
            inventory.data() ?? {},
            quantity
          ))
          : rootInventory;
        context.transaction.update(inventoryRef, {
          quantity,
          revision: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.actorUid,
        });
        if (context.writeLegacy) {
          context.transaction.update(access.targetSnapshot.ref, {
            inventory: nextLegacyInventory,
          });
        }
        return {success: true, inventoryId, quantity};
      }

      const patch = asRecord(request.data?.patch);
      if (!Object.keys(patch).length) {
        fail("invalid-argument", "A non-empty inventory patch is required.");
      }
      if (
        access.targetUid === context.actorUid &&
        inventory.get("kind") !== "varie"
      ) {
        fail("permission-denied", "Players may edit only custom Varie items.");
      }
      const forbidden = new Set([
        "schemaVersion",
        "revision",
        "quantity",
        "catalogItemId",
        "acquisitionSnapshot",
        "acquisitionHash",
        "source",
      ]);
      if (Object.keys(patch).some((key) => forbidden.has(key))) {
        fail("invalid-argument", "The patch contains server-owned fields.");
      }
      if (hasUntrustedTask07InventoryMedia(patch)) {
        fail(
          "invalid-argument",
          "Inventory edits cannot set Task 07 media."
        );
      }
      const currentSnapshot = mergeUntrustedInventorySnapshotPatch(
        inventory.get("currentSnapshot"),
        patch
      );
      const inventoryUpdate = {
        currentSnapshot,
        currentHash: hashValue(currentSnapshot),
        currentRevision: FieldValue.increment(1),
        displayName: inventoryName(currentSnapshot),
        normalizedName: normalizeDisplayName(inventoryName(currentSnapshot)),
        revision: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.actorUid,
      };
      assertDocumentBudget({
        ...(inventory.data() ?? {}),
        ...inventoryUpdate,
      }, USER_ITEM_MAX_BYTES, "Inventory item");
      const nextLegacyInventory = context.writeLegacy
        ? requireLegacyInventory(replaceLegacyInventorySnapshot(
          rootInventory,
          inventoryId,
          inventory.data() ?? {},
          currentSnapshot
        ))
        : rootInventory;
      context.transaction.update(inventoryRef, inventoryUpdate);
      enqueueOwnedMediaCleanup(context.transaction, context.db, {
        paths: planOwnedMediaCleanup({
          before: inventory.data(),
          after: {currentSnapshot},
          uid: access.targetUid,
          scope: "inventory",
          entityId: inventoryId,
        }),
        uid: access.targetUid,
        scope: "inventory",
        entityId: inventoryId,
        source: "inventory-edit",
        requestedBy: context.actorUid,
      });
      if (context.writeLegacy) {
        context.transaction.update(access.targetSnapshot.ref, {
          inventory: nextLegacyInventory,
        });
      }
      return {success: true, inventoryId, edited: true};
      }
    );
  }
);

export const task05MutatePersonalContent = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {
    kind: "spell" | "tecnica";
    action: "upsert" | "delete";
    contentId?: string;
    name?: string;
    data?: UnknownRecord;
  }>) => {
    const kind = request.data?.kind;
    const action = request.data?.action;
    if (!PERSONAL_CONTENT_KINDS.has(kind) || !["upsert", "delete"].includes(action)) {
      fail("invalid-argument", "A valid personal content action is required.");
    }
    return runIdempotent(
      request,
      `${kind}-${action}`,
      "request-user-or-actor",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid
      );
      const collectionName = kind === "spell" ? "spells" : "tecniche";
      const requestedId = asTrimmedString(request.data?.contentId);
      const contentId = requestedId || `content_${context.receiptId.slice(0, 32)}`;
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(contentId)) {
        fail("invalid-argument", "contentId is invalid.");
      }
      const contentRef = context.db.doc(
        `users/${access.targetUid}/${collectionName}/${contentId}`
      );
      const existing = await context.transaction.get(contentRef);
      const oldName = asTrimmedString(existing.get("displayName"));
      const rootContent = {
        ...asRecord(access.targetSnapshot.get(collectionName)),
      };

      if (action === "delete") {
        if (!existing.exists) fail("not-found", "Personal content not found.");
        const oldReservation = context.db.doc(
          `users/${access.targetUid}/content_names/${exactNameKey(
            `${kind}\0${oldName}`
          )}`
        );
        context.transaction.delete(contentRef);
        context.transaction.delete(oldReservation);
        enqueueOwnedMediaCleanup(context.transaction, context.db, {
          paths: planOwnedMediaCleanup({
            before: existing.data(),
            after: null,
            uid: access.targetUid,
            scope: collectionName,
            entityId: contentId,
          }),
          uid: access.targetUid,
          scope: collectionName,
          entityId: contentId,
          source: `${kind}-delete`,
          requestedBy: context.actorUid,
        });
        if (oldName) delete rootContent[oldName];
        if (context.writeLegacy) {
          context.transaction.update(access.targetSnapshot.ref, {
            [collectionName]: rootContent,
          });
        }
        return {success: true, contentId, deleted: true};
      }

      let contentData: UnknownRecord;
      try {
        contentData = preserveTrustedTask07PersonalContent(
          request.data?.data,
          existing.data()
        );
      } catch (error) {
        if ((error as Error)?.message === "task07-personal-media-injection") {
          fail(
            "invalid-argument",
            "Personal content cannot set Task 07 media."
          );
        }
        throw error;
      }
      const name = asTrimmedString(
        request.data?.name ?? contentData.Nome ?? contentData.name
      );
      if (!name) fail("invalid-argument", "Personal content name is required.");
      const reservationRef = context.db.doc(
        `users/${access.targetUid}/content_names/${exactNameKey(
          `${kind}\0${name}`
        )}`
      );
      const reservation = await context.transaction.get(reservationRef);
      if (reservation.exists && reservation.get("contentId") !== contentId) {
        fail("already-exists", "Personal content with this exact name exists.");
      }
      const oldReservation = oldName && oldName !== name
        ? context.db.doc(
          `users/${access.targetUid}/content_names/${exactNameKey(
            `${kind}\0${oldName}`
          )}`
        )
        : null;
      if (oldReservation) {
        await context.transaction.get(oldReservation);
      }
      const storedContent = {
        ...cloneWithoutUndefined(contentData) as UnknownRecord,
        id: contentId,
        schemaVersion: USER_DATA_SCHEMA_VERSION,
        revision: existing.exists
          ? FieldValue.increment(1)
          : 1,
        displayName: name,
        normalizedName: normalizeDisplayName(name),
        legacyManaged: false,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.actorUid,
      };
      assertDocumentBudget(
        storedContent,
        USER_ITEM_MAX_BYTES,
        "Personal content"
      );
      // Personal-content edits are replacements. A merge would retain omitted
      // media fields while simultaneously queueing their files for deletion.
      context.transaction.set(contentRef, storedContent);
      enqueueOwnedMediaCleanup(context.transaction, context.db, {
        paths: planOwnedMediaCleanup({
          before: existing.data(),
          after: storedContent,
          uid: access.targetUid,
          scope: collectionName,
          entityId: contentId,
        }),
        uid: access.targetUid,
        scope: collectionName,
        entityId: contentId,
        source: `${kind}-upsert`,
        requestedBy: context.actorUid,
      });
      context.transaction.set(reservationRef, {
        schemaVersion: USER_DATA_SCHEMA_VERSION,
        kind,
        exactName: name,
        contentId,
        legacyManaged: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (oldReservation) context.transaction.delete(oldReservation);
      if (oldName && oldName !== name) delete rootContent[oldName];
      rootContent[name] = {
        ...cloneWithoutUndefined(
          stripTask07PersonalContentProjection(contentData)
        ) as UnknownRecord,
        id: contentId,
      };
      if (context.writeLegacy) {
        context.transaction.update(access.targetSnapshot.ref, {
          [collectionName]: rootContent,
        });
      }
      return {success: true, contentId, name};
      }
    );
  }
);

export const task05UpdateProfile = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {patch: UnknownRecord}>) => {
    const patch = asRecord(request.data?.patch);
    const allowed = new Set([
      "username",
      "characterId",
      "race",
      "imageUrl",
      "imagePath",
    ]);
    if (!Object.keys(patch).length ||
      Object.keys(patch).some((key) => !allowed.has(key))) {
      fail("invalid-argument", "The profile patch contains unsupported fields.");
    }
    if (patch.imagePath) {
      const mediaPath = parseOwnedMediaPath(patch.imagePath);
      const targetUid = resolveUserDataCommandTargetUid(
        request.auth?.uid,
        request.data?.userId,
        "request-user-or-actor"
      );
      if (!mediaPath || mediaPath.uid !== targetUid ||
        mediaPath.scope !== "profile") {
        fail("invalid-argument", "imagePath must be a canonical owned profile path.");
      }
    }
    assertDocumentBudget(patch, USER_SHELL_MAX_BYTES, "Profile shell patch");
    return runIdempotent(
      request,
      "update-profile",
      "request-user-or-actor",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid
      );
      const nextShell = {
        ...buildUserShellProjection(access.targetSnapshot.data()),
        ...cloneWithoutUndefined(patch) as UnknownRecord,
      };
      assertDocumentBudget(nextShell, USER_SHELL_MAX_BYTES, "Profile shell");
      context.transaction.update(
        access.targetSnapshot.ref,
        asUpdateData(patch)
      );
      enqueueOwnedMediaCleanup(context.transaction, context.db, {
        paths: planOwnedMediaCleanup({
          before: access.targetSnapshot.data(),
          after: nextShell,
          uid: access.targetUid,
          scope: "profile",
          entityId: "profile",
        }),
        uid: access.targetUid,
        scope: "profile",
        entityId: "profile",
        source: "profile-update",
        requestedBy: context.actorUid,
      });
      return {success: true, updatedFields: Object.keys(patch)};
      }
    );
  }
);


interface GrigliataPlacementWrite {
  label: string;
  imageUrl: string;
  col: number;
  row: number;
  sizeSquares: number;
  isVisibleToPlayers: boolean;
  isDead: boolean;
  statuses?: string[];
  visionEnabled?: boolean;
  visionRadiusSquares?: number;
}

interface GrigliataPlacementMutation {
  action: "upsert" | "delete";
  deleteFoeTokenProfile: boolean;
  placement?: GrigliataPlacementWrite;
}

interface HiddenPlacementMutation {
  backgroundId: string;
  tokenId: string;
  isHidden: boolean;
  placementMutation?: GrigliataPlacementMutation;
  includeLegacyFallback: boolean;
}

const HIDDEN_PLACEMENT_MUTATION_KEYS = [
  "backgroundId",
  "includeLegacyFallback",
  "isHidden",
  "tokenId",
] as const;
const GRIGLIATA_HIDDEN_BACKGROUND_IDS_FIELD =
  "grigliata_hidden_background_ids";
const GRIGLIATA_HIDDEN_TOKEN_IDS_BY_BACKGROUND_FIELD =
  "grigliata_hidden_token_ids_by_background";

const GRIGLIATA_PLACEMENT_WRITE_KEYS = new Set([
  "col",
  "imageUrl",
  "isDead",
  "isVisibleToPlayers",
  "label",
  "row",
  "sizeSquares",
  "statuses",
  "visionEnabled",
  "visionRadiusSquares",
]);

const normalizeGrigliataPlacementMutation = (
  value: unknown
): GrigliataPlacementMutation | null => {
  if (value === undefined) return null;
  const source = asRecord(value);
  const action = asTrimmedString(source.action);
  const deleteFoeTokenProfile = source.deleteFoeTokenProfile;
  const expectedKeys = action === "upsert" ?
    ["action", "deleteFoeTokenProfile", "placement"] :
    ["action", "deleteFoeTokenProfile"];
  const keys = Object.keys(source).sort();
  if (
    !["upsert", "delete"].includes(action) ||
    typeof deleteFoeTokenProfile !== "boolean" ||
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail("invalid-argument", "The Grigliata placement mutation is invalid.");
  }
  if (action === "delete") {
    return {
      action: "delete",
      deleteFoeTokenProfile: deleteFoeTokenProfile === true,
    };
  }
  const placement = asRecord(source.placement);
  const placementKeys = Object.keys(placement);
  const requiredKeys = [
    "col",
    "imageUrl",
    "isDead",
    "isVisibleToPlayers",
    "label",
    "row",
    "sizeSquares",
  ];
  const label = asTrimmedString(placement.label);
  const imageUrl = typeof placement.imageUrl === "string" ?
    placement.imageUrl.trim() : "";
  const col = placement.col;
  const row = placement.row;
  const sizeSquares = placement.sizeSquares;
  const statuses = placement.statuses;
  const visionEnabled = placement.visionEnabled;
  const visionRadiusSquares = placement.visionRadiusSquares;
  if (
    placementKeys.some((key) => !GRIGLIATA_PLACEMENT_WRITE_KEYS.has(key)) ||
    requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(placement, key)) ||
    !label || label.length > 200 ||
    imageUrl.length > 4096 ||
    typeof col !== "number" || !Number.isSafeInteger(col) || col < 0 || col > 10000 ||
    typeof row !== "number" || !Number.isSafeInteger(row) || row < 0 || row > 10000 ||
    typeof sizeSquares !== "number" || !Number.isSafeInteger(sizeSquares) ||
      sizeSquares < 1 || sizeSquares > 9 ||
    typeof placement.isVisibleToPlayers !== "boolean" ||
    typeof placement.isDead !== "boolean" ||
    (statuses !== undefined && (
      !Array.isArray(statuses) || statuses.length > 64 ||
      statuses.some((status) => typeof status !== "string" ||
        !status.trim() || status.length > 100)
    )) ||
    (visionEnabled !== undefined && typeof visionEnabled !== "boolean") ||
    (visionRadiusSquares !== undefined && (
      typeof visionRadiusSquares !== "number" ||
      !Number.isSafeInteger(visionRadiusSquares) ||
      visionRadiusSquares < 1 || visionRadiusSquares > 60
    ))
  ) {
    fail("invalid-argument", "The Grigliata placement write is invalid.");
  }
  return {
    action: "upsert",
    deleteFoeTokenProfile: deleteFoeTokenProfile === true,
    placement: {
      label,
      imageUrl,
      col: col as number,
      row: row as number,
      sizeSquares: sizeSquares as number,
      isVisibleToPlayers: placement.isVisibleToPlayers === true,
      isDead: placement.isDead === true,
      ...(statuses === undefined ? {} : {
        statuses: (statuses as string[]).map((status: string) => status.trim()),
      }),
      ...(visionEnabled === undefined ? {} : {visionEnabled: visionEnabled as boolean}),
      ...(visionRadiusSquares === undefined ? {} : {
        visionRadiusSquares: visionRadiusSquares as number,
      }),
    },
  };
};


export const normalizeHiddenPlacementMutation = (
  value: unknown
): HiddenPlacementMutation | null => {
  if (value === undefined) return null;
  const source = asRecord(value);
  const keys = Object.keys(source).sort();
  const placementMutation = normalizeGrigliataPlacementMutation(
    source.placementMutation
  );
  const expectedKeys = placementMutation ?
    [...HIDDEN_PLACEMENT_MUTATION_KEYS, "placementMutation"].sort() :
    [...HIDDEN_PLACEMENT_MUTATION_KEYS];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(
      "invalid-argument",
      "The hidden-placement mutation must contain only its reviewed fields."
    );
  }
  const backgroundId = asTrimmedString(source.backgroundId);
  const tokenId = asTrimmedString(source.tokenId);
  if (
    !isValidFirestoreDocumentId(backgroundId) ||
    !isValidFirestoreDocumentId(tokenId) ||
    typeof source.isHidden !== "boolean" ||
    typeof source.includeLegacyFallback !== "boolean"
  ) {
    fail(
      "invalid-argument",
      "The hidden-placement mutation is invalid."
    );
  }
  return {
    backgroundId,
    tokenId,
    isHidden: source.isHidden === true,
    ...(placementMutation ? {placementMutation} : {}),
    includeLegacyFallback: source.includeLegacyFallback === true,
  };
};

export const task05UpdateSettings = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {
    patch?: UnknownRecord;
    hiddenPlacement?: HiddenPlacementMutation;
  }>) => {
    const patch = asRecord(request.data?.patch);
    const hiddenPlacement = normalizeHiddenPlacementMutation(
      request.data?.hiddenPlacement
    );
    const allowedRootFields = new Set([
      "settings",
      "parameterLocks",
      "paramLocks",
      "grigliata",
      "drawColorKey",
      "shareLiveInteractions",
      "grigliataMuted",
      "hiddenGrigliataBackgrounds",
      "hiddenGrigliataTokens",
    ]);
    if (
      (Object.keys(patch).length ? 1 : 0) + (hiddenPlacement ? 1 : 0) !== 1 ||
      (Object.keys(patch).length > 0 &&
      (
      Object.keys(patch).some((key) => !allowedRootFields.has(key))
      ))
    ) {
      fail("invalid-argument", "The settings patch contains unsupported fields.");
    }
    assertDocumentBudget(patch, USER_STATE_MAX_BYTES, "Settings state");
    return runIdempotent(
      request,
      "update-settings",
      "request-user-or-actor",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid
      );
      const lockFields = new Set(["parameterLocks", "paramLocks"]);
      const requestedFields = Object.keys(patch);
      const hasLocks = requestedFields.some((key) => lockFields.has(key));
      const hasPreferences = requestedFields.some((key) => !lockFields.has(key));
      if (hiddenPlacement) {
        if (
          hiddenPlacement.includeLegacyFallback &&
          hiddenPlacement.tokenId !== access.targetUid
        ) {
          fail(
            "invalid-argument",
            "Legacy background fallback is valid only for the main user token."
          );
        }
        if (
          access.targetUid !== context.actorUid &&
          access.actorRole !== "dm"
        ) {
          fail(
            "permission-denied",
            "Only a DM may update another user's hidden placements."
          );
        }
      } else if (
        (hasLocks && access.actorRole !== "dm") ||
        (access.targetUid !== context.actorUid && hasPreferences)
      ) {
        fail("permission-denied", "Only a DM may update parameter locks.");
      }
      let placementState: null | {
        mutation: GrigliataPlacementMutation;
        placementRef: admin.firestore.DocumentReference;
        tokenRef: admin.firestore.DocumentReference;
        deleteTokenProfile: boolean;
      } = null;
      if (hiddenPlacement?.placementMutation) {
        const mutation = hiddenPlacement.placementMutation;
        const backgroundRef = context.db.doc(
          `grigliata_backgrounds/${hiddenPlacement.backgroundId}`
        );
        const placementRef = context.db.doc(
          `grigliata_token_placements/${hiddenPlacement.backgroundId}__${hiddenPlacement.tokenId}`
        );
        const tokenRef = context.db.doc(
          `grigliata_tokens/${hiddenPlacement.tokenId}`
        );
        const [background, placement, token] = await context.transaction.getAll(
          backgroundRef,
          placementRef,
          tokenRef
        );
        if (!background.exists) {
          fail("failed-precondition", "The Grigliata background no longer exists.");
        }
        const existingOwnerUid = asTrimmedString(placement.get("ownerUid"));
        const existingTokenId = asTrimmedString(placement.get("tokenId")) ||
          existingOwnerUid;
        if (placement.exists && (
          placement.get("backgroundId") !== hiddenPlacement.backgroundId ||
          existingTokenId !== hiddenPlacement.tokenId ||
          existingOwnerUid !== access.targetUid
        )) {
          fail("failed-precondition", "The Grigliata placement identity changed.");
        }
        const tokenOwnerUid = asTrimmedString(token.get("ownerUid"));
        const tokenType = asTrimmedString(token.get("tokenType"));
        if (token.exists && tokenOwnerUid && tokenOwnerUid !== access.targetUid) {
          fail("failed-precondition", "The Grigliata token owner changed.");
        }
        if (hiddenPlacement.tokenId === access.targetUid && token.exists &&
          tokenType && tokenType !== "character") {
          fail("failed-precondition", "The main token is not a character token.");
        }
        if (mutation.action === "upsert") {
          if (
            mutation.deleteFoeTokenProfile ||
            !mutation.placement ||
            mutation.placement.isVisibleToPlayers === hiddenPlacement.isHidden ||
            (hiddenPlacement.tokenId !== access.targetUid && (
              !token.exists || tokenOwnerUid !== access.targetUid
            ))
          ) {
            fail("failed-precondition", "The Grigliata placement write is stale.");
          }
        } else if (hiddenPlacement.isHidden) {
          fail("invalid-argument", "A deleted placement cannot remain hidden.");
        }
        if (mutation.deleteFoeTokenProfile && token.exists && (
          tokenType !== "foe" || tokenOwnerUid !== access.targetUid
        )) {
          fail("failed-precondition", "The foe token identity changed.");
        }
        placementState = {
          mutation,
          placementRef,
          tokenRef,
          deleteTokenProfile: mutation.deleteFoeTokenProfile && token.exists,
        };
      }
      const settingsRef = context.db.doc(
        `users/${access.targetUid}/state/settings`
      );
      const hiddenPlacementSettings = hiddenPlacement ? {
        [GRIGLIATA_HIDDEN_TOKEN_IDS_BY_BACKGROUND_FIELD]: {
          [hiddenPlacement.backgroundId]: hiddenPlacement.isHidden ?
            FieldValue.arrayUnion(hiddenPlacement.tokenId) :
            FieldValue.arrayRemove(hiddenPlacement.tokenId),
        },
        ...(hiddenPlacement.includeLegacyFallback ? {
          [GRIGLIATA_HIDDEN_BACKGROUND_IDS_FIELD]: hiddenPlacement.isHidden ?
            FieldValue.arrayUnion(hiddenPlacement.backgroundId) :
            FieldValue.arrayRemove(hiddenPlacement.backgroundId),
        } : {}),
      } : null;
      const domainPatch: UnknownRecord = {
        ...stateMetadata(context.actorUid),
      };
      const legacyPatch: UnknownRecord = {};
      ["parameterLocks", "paramLocks"].forEach((key) => {
        if (patch[key] === undefined) return;
        domainPatch[key] = asRecord(patch[key]);
        legacyPatch[key] = asRecord(patch[key]);
      });
      if (patch.settings) {
        domainPatch.settings = asRecord(patch.settings);
        legacyPatch.settings = {
          ...asRecord(access.targetSnapshot.get("settings")),
          ...asRecord(patch.settings),
        };
      }
      if (hiddenPlacementSettings) {
        domainPatch.settings = hiddenPlacementSettings;
      }
      const grigliata = {
        ...asRecord(patch.grigliata),
        ...Object.fromEntries(Object.entries(patch).filter(
          ([key]) => ![
            "settings",
            "grigliata",
            "parameterLocks",
            "paramLocks",
          ].includes(key)
        )),
      };
      if (Object.keys(grigliata).length) {
        domainPatch.grigliata = grigliata;
        Object.assign(legacyPatch, grigliata);
      }
      context.transaction.set(settingsRef, domainPatch, {merge: true});
      if (placementState) {
        if (placementState.mutation.action === "upsert") {
          context.transaction.set(placementState.placementRef, {
            backgroundId: hiddenPlacement?.backgroundId,
            tokenId: hiddenPlacement?.tokenId,
            ownerUid: access.targetUid,
            ...asRecord(placementState.mutation.placement),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: context.actorUid,
          }, {merge: true});
        } else {
          context.transaction.delete(placementState.placementRef);
          if (placementState.deleteTokenProfile) {
            context.transaction.delete(placementState.tokenRef);
          }
        }
      }
      if (context.writeLegacy) {
        if (hiddenPlacementSettings) {
          context.transaction.set(access.targetSnapshot.ref, {
            settings: hiddenPlacementSettings,
          }, {merge: true});
        } else {
          context.transaction.update(
            access.targetSnapshot.ref,
            asUpdateData(legacyPatch)
          );
        }
      }
      return {
        success: true,
        updatedFields: hiddenPlacement ?
          ["hiddenPlacement"] : Object.keys(patch),
      };
      }
    );
  }
);

export const task05UpdateProfileContent = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {patch: UnknownRecord}>) => {
    const patch = asRecord(request.data?.patch);
    const allowed = new Set(["lingue", "conoscenze", "professioni"]);
    if (
      !Object.keys(patch).length ||
      Object.keys(patch).some((key) => !allowed.has(key)) ||
      Object.values(patch).some((value) => Array.isArray(value) ||
        value === null || typeof value !== "object")
    ) {
      fail("invalid-argument", "Profile content must contain supported maps.");
    }
    assertDocumentBudget(patch, USER_STATE_MAX_BYTES, "Profile content state");
    return runIdempotent(
      request,
      "update-profile-content",
      "request-user-or-actor",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid
      );
      const profileRef = context.db.doc(
        `users/${access.targetUid}/state/profileContent`
      );
      context.transaction.set(profileRef, {
        ...stateMetadata(context.actorUid),
        ...patch,
      }, {merge: true});
      if (context.writeLegacy) {
        context.transaction.update(
          access.targetSnapshot.ref,
          asUpdateData(patch)
        );
      }
      return {success: true, updatedFields: Object.keys(patch)};
      }
    );
  }
);

export const task05UpdateProgression = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {patch: UnknownRecord}>) => {
    const patch = asRecord(request.data?.patch);
    if (
      !Object.keys(patch).length ||
      Object.keys(patch).some((key) => !PROGRESSION_KEYS.has(key))
    ) {
      fail("invalid-argument", "The progression patch is invalid.");
    }
    return runIdempotent(
      request,
      "update-progression",
      "request-user-or-actor",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid
      );
      const statsPatch = asRecord(patch.stats);
      if (hasAnyOwnField(statsPatch, RESOURCE_FIELDS)) {
        fail(
          "invalid-argument",
          "Resource stats must be changed through a resource command."
        );
      }
      if (Object.keys(statsPatch).some((key) => (
        !OWNER_PROTECTED_PROGRESSION_STATS.has(key)
      ))) {
        fail("invalid-argument", "The progression stats patch is invalid.");
      }
      if (
        access.targetUid === context.actorUid &&
        Object.keys(statsPatch).some((key) => (
          OWNER_PROTECTED_PROGRESSION_STATS.has(key)
        ))
      ) {
        fail("permission-denied", "Progression counters are server-owned.");
      }
      const progressionRef = context.db.doc(
        `users/${access.targetUid}/state/progression`
      );
      const resourcesRef = context.db.doc(
        `users/${access.targetUid}/state/resources`
      );
      const utilsRef = context.db.doc("utils/varie");
      const [progression, utils] = await context.transaction.getAll(
        progressionRef,
        utilsRef
      );
      const mergedPatch: UnknownRecord = Object.fromEntries(Object.entries(
        patch
      ).map(
        ([key, value]) => [
          key,
          deepMergeRecords(
            progression.get(key) ?? access.targetSnapshot.get(key),
            value
          ),
        ]
      ));
      const level = asRecord(mergedPatch.stats).level ??
        asRecord(progression.get("stats")).level ??
        asRecord(access.targetSnapshot.get("stats")).level;
      const shouldRecomputeParameters = Boolean(
        patch.Parametri || patch.AltriParametri || statsPatch.level !== undefined
      );
      let resourceTotals: UnknownRecord = {};
      if (shouldRecomputeParameters) {
        const parametri = mergedPatch.Parametri ??
          progression.get("Parametri") ??
          access.targetSnapshot.get("Parametri");
        const shouldRecomputeAnima = Boolean(
          patch.AltriParametri || statsPatch.level !== undefined
        );
        mergedPatch.Parametri = shouldRecomputeAnima
          ? deriveAnimaParameters({
            parametri,
            altriParametri: mergedPatch.AltriParametri ??
              progression.get("AltriParametri") ??
              access.targetSnapshot.get("AltriParametri"),
            level,
            utils: utils.data(),
          })
          : deriveParameterTotals(parametri);
        resourceTotals = deriveResourceTotals({
          parametri: mergedPatch.Parametri,
          level,
          utils: utils.data(),
        });
      }
      assertDocumentBudget(
        mergedPatch,
        USER_STATE_MAX_BYTES,
        "Progression state"
      );
      context.transaction.set(progressionRef, {
        ...stateMetadata(context.actorUid),
        ...mergedPatch,
      }, {merge: true});
      if (Object.keys(resourceTotals).length) {
        context.transaction.set(resourcesRef, {
          ...stateMetadata(context.actorUid),
          stats: resourceTotals,
        }, {merge: true});
      }
      const rootUpdate: UnknownRecord = {};
      if (statsPatch.level !== undefined) {
        rootUpdate["summary.level"] = asFiniteNumber(level, 1);
      }
      if (context.writeLegacy) {
        Object.assign(rootUpdate, Object.fromEntries(Object.entries(patch).map(
          ([key, value]) => [
            key,
            deepMergeRecords(access.targetSnapshot.get(key), value),
          ]
        )));
        if (mergedPatch.Parametri) rootUpdate.Parametri = mergedPatch.Parametri;
        Object.entries(resourceTotals).forEach(([key, value]) => {
          if (rootUpdate.stats) {
            asRecord(rootUpdate.stats)[key] = value;
          } else {
            rootUpdate[`stats.${key}`] = value;
          }
        });
      }
      if (Object.keys(rootUpdate).length) {
        context.transaction.update(
          access.targetSnapshot.ref,
          asUpdateData(rootUpdate)
        );
      }
      return {success: true, updatedFields: Object.keys(patch)};
      }
    );
  }
);

export const task05PrepareConsumable = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {
    inventoryId: string;
    resource?: "hp" | "mana" | null;
  }>) => {
    const inventoryId = asTrimmedString(request.data?.inventoryId);
    const resource = request.data?.resource ?? null;
    if (!inventoryId || !["hp", "mana", null].includes(resource)) {
      fail("invalid-argument", "A valid inventoryId and resource are required.");
    }
    const randomSeed = randomBytes(80);
    return runIdempotent(
      request,
      "prepare-consumable",
      "actor-only",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid,
        true
      );
      const inventoryRef = context.db.doc(
        `users/${access.targetUid}/inventory/${inventoryId}`
      );
      const progressionRef = context.db.doc(
        `users/${access.targetUid}/state/progression`
      );
      const utilsRef = context.db.doc("utils/varie");
      const [inventory, progression, utils] = await context.transaction.getAll(
        inventoryRef,
        progressionRef,
        utilsRef
      );
      if (!inventory.exists) fail("not-found", "Consumable not found.");
      const snapshot = asRecord(inventory.get("currentSnapshot"));
      if (inventoryKind(snapshot) !== "consumabile") {
        fail("failed-precondition", "The inventory item is not consumable.");
      }
      const rootStats = asRecord(access.targetSnapshot.get("stats"));
      const progressionStats = asRecord(progression.get("stats"));
      const level = progressionStats.level ?? rootStats.level;
      const plan = buildConsumableRollPlan(
        snapshot,
        resource,
        level,
        utils.get("dadiAnimaByLevel")
      );
      const count = Math.min(20, plan.count);
      const rolls = Array.from({length: count}, (_, index) => (
        randomSeed.readUInt32BE(index * 4) % plan.faces + 1
      ));
      const gain = rolls.reduce((total, roll) => total + roll, plan.modifier);
      return {
        success: true,
        preparationId: context.receiptId,
        inventoryId,
        inventoryHash: inventory.get("currentHash") || hashValue(snapshot),
        resource: plan.resource,
        faces: plan.faces,
        count,
        rolls,
        modifier: plan.modifier,
        gain,
      };
      }
    );
  }
);

export const task05CommitConsumable = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {preparationId: string}>) => {
    const preparationId = asTrimmedString(request.data?.preparationId);
    if (!/^[a-f0-9]{48}$/.test(preparationId)) {
      fail("invalid-argument", "A valid preparationId is required.");
    }
    return runIdempotent(
      request,
      "commit-consumable",
      "actor-only",
      async (context) => {
      const access = await commandAccess(
        context.transaction,
        context.db,
        context.actorUid,
        context.targetUid,
        true
      );
      const preparationRef = context.db.doc(
        `user_operations/${preparationId}`
      );
      const preparation = await context.transaction.get(preparationRef);
      if (
        !preparation.exists ||
        preparation.get("actorUid") !== context.actorUid ||
        preparation.get("action") !== "prepare-consumable" ||
        preparation.get("status") !== "completed"
      ) {
        fail("failed-precondition", "Consumable preparation is invalid.");
      }
      if (isOperationExpired(
        preparation.get("expiresAt"),
        Timestamp.now().toMillis()
      )) {
        fail("failed-precondition", "Consumable preparation expired.");
      }
      if (preparation.get("committedByReceipt")) {
        fail("already-exists", "This consumable preparation was already committed.");
      }
      const result = asRecord(preparation.get("result"));
      const inventoryId = asTrimmedString(result.inventoryId);
      const inventoryRef = context.db.doc(
        `users/${access.targetUid}/inventory/${inventoryId}`
      );
      const resourcesRef = context.db.doc(
        `users/${access.targetUid}/state/resources`
      );
      const equipmentRef = context.db.doc(
        `users/${access.targetUid}/state/equipment`
      );
      const [inventory, resources, equipment] = await context.transaction.getAll(
        inventoryRef,
        resourcesRef,
        equipmentRef
      );
      if (!inventory.exists) fail("not-found", "Consumable is no longer present.");
      const inventoryHash = inventory.get("currentHash") ||
        hashValue(inventory.get("currentSnapshot"));
      if (inventoryHash !== result.inventoryHash) {
        fail("failed-precondition", "Consumable changed after preparation.");
      }

      const quantity = Math.max(1, Math.trunc(asFiniteNumber(
        inventory.get("quantity"),
        1
      )));
      const nextQuantity = quantity - 1;
      const rootInventory = Array.isArray(access.targetSnapshot.get("inventory"))
        ? [...access.targetSnapshot.get("inventory")]
        : [];
      const slots = asRecord(equipment.get("slots"));
      const clearedSlots = Object.entries(slots)
        .filter(([, value]) => value === inventoryId)
        .map(([key]) => key);
      const nextSlots = Object.fromEntries(Object.entries(slots).map(
        ([key, value]) => [
          key,
          nextQuantity <= 0 && value === inventoryId ? null : value,
        ]
      ));
      let equipmentTransition: ReturnType<typeof deriveEquipmentTransition> |
        null = null;
      let remainingInventoryById: UnknownRecord = {};
      let derivedResourceTotals: UnknownRecord = {};
      if (nextQuantity <= 0 && clearedSlots.length) {
        const progressionRef = context.db.doc(
          `users/${access.targetUid}/state/progression`
        );
        const utilsRef = context.db.doc("utils/varie");
        const remainingIds = [...new Set(Object.values(nextSlots)
          .map(asTrimmedString)
          .filter(Boolean))];
        const remainingRefs = remainingIds.map((id) => context.db.doc(
          `users/${access.targetUid}/inventory/${id}`
        ));
        const [progression, utils, ...remainingSnapshots] =
          await context.transaction.getAll(
            progressionRef,
            utilsRef,
            ...remainingRefs
          );
        if (remainingSnapshots.some((snapshot) => !snapshot.exists)) {
          fail(
            "failed-precondition",
            "Equipment references a missing inventory item."
          );
        }
        remainingInventoryById = Object.fromEntries(remainingSnapshots.map(
          (snapshot, index) => [
            remainingIds[index],
            asRecord(snapshot.get("currentSnapshot")),
          ]
        ));
        equipmentTransition = deriveEquipmentTransition({
          slots: nextSlots,
          inventoryById: remainingInventoryById,
          slot: clearedSlots[0],
          inventoryId: null,
          parametri: progression.get("Parametri") ??
            access.targetSnapshot.get("Parametri"),
          level: asRecord(progression.get("stats")).level ??
            asRecord(access.targetSnapshot.get("stats")).level,
        });
        if (!equipmentTransition.ok) {
          fail(
            "failed-precondition",
            `Equipment recompute failed: ${equipmentTransition.error}.`
          );
        }
        context.transaction.set(progressionRef, {
          ...stateMetadata(context.actorUid),
          Parametri: equipmentTransition.parametri,
        }, {merge: true});
        derivedResourceTotals = deriveResourceTotals({
          parametri: equipmentTransition.parametri,
          level: asRecord(progression.get("stats")).level ??
            asRecord(access.targetSnapshot.get("stats")).level,
          utils: utils.data(),
        });
        if (Object.keys(derivedResourceTotals).length) {
          context.transaction.set(resourcesRef, {
            ...stateMetadata(context.actorUid),
            stats: derivedResourceTotals,
          }, {merge: true});
        }
      }

      let nextRootInventory = rootInventory;
      if (context.writeLegacy) {
        nextRootInventory = nextQuantity > 0
          ? requireLegacyInventory(updateLegacyInventoryQuantity(
            rootInventory,
            inventoryId,
            inventory.data() ?? {},
            nextQuantity
          ))
          : requireLegacyInventory(removeLegacyInventoryDocuments(
            rootInventory,
            {[inventoryId]: inventory.data() ?? {}}
          ));
      }
      if (nextQuantity > 0) {
        context.transaction.update(inventoryRef, {
          quantity: nextQuantity,
          revision: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.actorUid,
        });
      } else {
        context.transaction.delete(inventoryRef);
        enqueueOwnedMediaCleanup(context.transaction, context.db, {
          paths: planOwnedMediaCleanup({
            before: inventory.data(),
            after: null,
            uid: access.targetUid,
            scope: "inventory",
            entityId: inventoryId,
          }),
          uid: access.targetUid,
          scope: "inventory",
          entityId: inventoryId,
          source: "consumable-depleted",
          requestedBy: context.actorUid,
        });
        if (equipmentTransition) {
          context.transaction.set(equipmentRef, {
            ...stateMetadata(context.actorUid),
            slots: equipmentTransition.slots,
            beltCapacity: equipmentTransition.beltCapacity,
          }, {merge: true});
        }
      }

      const resource = result.resource;
      let resourceValue: number | null = null;
      if (resource === "hp" || resource === "mana") {
        const fields = resolveResourceFields(resource);
        const resourceStats = asRecord(resources.get("stats"));
        const rootStats = asRecord(access.targetSnapshot.get("stats"));
        resourceValue = applyConsumableCap(
          resourceStats[fields.current] ?? rootStats[fields.current],
          result.gain,
          derivedResourceTotals[fields.total] ??
            resourceStats[fields.total] ?? rootStats[fields.total]
        );
        context.transaction.set(resourcesRef, {
          ...stateMetadata(context.actorUid),
          stats: {[fields.current]: resourceValue},
        }, {merge: true});
      }
      const rootUpdate: UnknownRecord = {inventory: nextRootInventory};
      if (equipmentTransition) {
        rootUpdate.equipped = buildLegacyEquippedSnapshot(
          equipmentTransition.slots,
          remainingInventoryById
        );
        rootUpdate.Parametri = equipmentTransition.parametri;
      } else if (nextQuantity > 0 && clearedSlots.length) {
        const legacyEquipped = {
          ...asRecord(access.targetSnapshot.get("equipped")),
        };
        clearedSlots.forEach((slotKey) => {
          legacyEquipped[slotKey] = {
            ...asRecord(inventory.get("currentSnapshot")),
            qty: nextQuantity,
            _instance: {
              ...asRecord(asRecord(legacyEquipped[slotKey])._instance),
              instanceId: inventoryId,
            },
          };
        });
        rootUpdate.equipped = legacyEquipped;
      }
      if (resource === "hp" || resource === "mana") {
        rootUpdate[`stats.${resolveResourceFields(resource).current}`] = resourceValue;
      }
      Object.entries(derivedResourceTotals).forEach(([key, value]) => {
        rootUpdate[`stats.${key}`] = value;
      });
      if (context.writeLegacy) {
        context.transaction.update(
          access.targetSnapshot.ref,
          asUpdateData(rootUpdate)
        );
      }
      context.transaction.update(preparationRef, {
        committedAt: FieldValue.serverTimestamp(),
        committedByReceipt: context.receiptId,
      });
      return {
        success: true,
        preparationId,
        inventoryId,
        quantity: nextQuantity,
        resource,
        resourceValue,
      };
      }
    );
  }
);
