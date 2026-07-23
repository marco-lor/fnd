import {randomBytes} from "crypto";
import * as admin from "firebase-admin";
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
  buildConsumableRollPlan,
  buildLegacyEquippedSnapshot,
  buildUserShellProjection,
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

const operationExpiry = (): admin.firestore.Timestamp => (
  admin.firestore.Timestamp.fromMillis(
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
    const nowMillis = admin.firestore.Timestamp.now().toMillis();
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
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

  if (!actorSnapshot.exists) fail("permission-denied", "Caller profile missing.");
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
  revision: admin.firestore.FieldValue.increment(1),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
    pricePaid: options.pricePaid,
    source: options.source,
    migration: null,
    legacyManaged: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    acquiredAt: admin.firestore.Timestamp.now(),
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
      const snapshot = {...catalogData, id: itemId};
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
      const stateUpdate: UnknownRecord = {
        ...stateMetadata(context.actorUid),
        stats: {[fields.current]: next},
      };
      const legacyUpdate: UnknownRecord = {
        [`stats.${fields.current}`]: next,
      };
      if (resource === "barriera" && request.data?.totalValue !== undefined) {
        const totalValue = asFiniteNumber(
          request.data.totalValue,
          Number.NaN
        );
        const remainingTurns = Math.trunc(asFiniteNumber(
          request.data.remainingTurns,
          Number.NaN
        ));
        const totalTurns = Math.trunc(asFiniteNumber(
          request.data.totalTurns,
          Number.NaN
        ));
        if (
          !Number.isFinite(totalValue) || totalValue < 0 ||
          !Number.isFinite(remainingTurns) || remainingTurns < 0 ||
          !Number.isFinite(totalTurns) || totalTurns < remainingTurns
        ) {
          fail("invalid-argument", "Barrier total and turns are invalid.");
        }
        asRecord(stateUpdate.stats)[fields.total] = totalValue;
        stateUpdate.active_turn_effect = {
          barriera: {remainingTurns, totalTurns},
        };
        legacyUpdate[`stats.${fields.total}`] = totalValue;
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
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        const name = inventoryName(requestedSnapshot);
        if (!name) fail("invalid-argument", "A Varie item name is required.");
        const snapshot = {
          ...requestedSnapshot,
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
        const snapshot = {...(catalog.data() ?? {}), id: itemId};
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
          revision: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
      const currentSnapshot = {
        ...asRecord(inventory.get("currentSnapshot")),
        ...patch,
      };
      const inventoryUpdate = {
        currentSnapshot,
        currentHash: hashValue(currentSnapshot),
        currentRevision: admin.firestore.FieldValue.increment(1),
        displayName: inventoryName(currentSnapshot),
        normalizedName: normalizeDisplayName(inventoryName(currentSnapshot)),
        revision: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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

      const contentData = asRecord(request.data?.data);
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
          ? admin.firestore.FieldValue.increment(1)
          : 1,
        displayName: name,
        normalizedName: normalizeDisplayName(name),
        legacyManaged: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (oldReservation) context.transaction.delete(oldReservation);
      if (oldName && oldName !== name) delete rootContent[oldName];
      rootContent[name] = {
        ...cloneWithoutUndefined(contentData) as UnknownRecord,
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

export const task05UpdateSettings = onCall(
  {region: REGION},
  async (request: CallableRequest<BaseCommand & {patch: UnknownRecord}>) => {
    const patch = asRecord(request.data?.patch);
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
      !Object.keys(patch).length ||
      Object.keys(patch).some((key) => !allowedRootFields.has(key))
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
      if (
        (hasLocks && access.actorRole !== "dm") ||
        (access.targetUid !== context.actorUid && hasPreferences)
      ) {
        fail("permission-denied", "Only a DM may update parameter locks.");
      }
      const settingsRef = context.db.doc(
        `users/${access.targetUid}/state/settings`
      );
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
      if (context.writeLegacy) {
        context.transaction.update(
          access.targetSnapshot.ref,
          asUpdateData(legacyPatch)
        );
      }
      return {success: true, updatedFields: Object.keys(patch)};
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
        admin.firestore.Timestamp.now().toMillis()
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
          revision: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        committedAt: admin.firestore.FieldValue.serverTimestamp(),
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
