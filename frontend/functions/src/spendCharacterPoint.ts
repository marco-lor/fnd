import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import {backendOperationExpiry} from "./backendOperationCore";
import {spendCharacterPointLegacyHandler} from "./spendCharacterPointLegacy";
import {isUserDataLegacyDrainFrozen} from "./userDataBridge";
import {
  asFiniteNumber,
  asRecord,
  asTrimmedString,
  deepMergeRecords,
  deriveParameterTotals,
  deriveResourceTotals,
  operationReceiptId,
  operationRequestHash,
  resolveUserDataRolloutStage,
  validateOperationId,
  writesLegacyUserProjection,
} from "./userDataV2";

interface SpendPointData {
  statName?: string;
  statType?: "Base" | "Combat";
  change?: 1 | -1;
  operationId?: string;
}

const MIN_BASE_VALUE = -1;
const MAX_NEGATIVE_BASE_STATS = 4;
const LEGACY_REGION = "us-central1";
const CANONICAL_REGION = "europe-west8";

const spendCharacterPointHandler = async (
  request: CallableRequest<SpendPointData>
): Promise<Record<string, unknown>> => {
  const actorUid = asTrimmedString(request.auth?.uid);
  if (!actorUid) {
    throw new HttpsError("unauthenticated", "You must be authenticated.");
  }
  const statName = asTrimmedString(request.data?.statName);
  const statType = request.data?.statType;
  const change = request.data?.change;
  if (
    !statName ||
    !["Base", "Combat"].includes(statType ?? "") ||
    ![1, -1].includes(change ?? 0)
  ) {
    throw new HttpsError("invalid-argument", "Bad request payload.");
  }
  const suppliedOperationId = asTrimmedString(request.data?.operationId);
  if (!suppliedOperationId) {
    throw new HttpsError("invalid-argument", "operationId is required.");
  }
  const operationId = validateOperationId(suppliedOperationId);
  if (!operationId) {
    throw new HttpsError("invalid-argument", "operationId is invalid.");
  }
  const db = admin.firestore();
  const userRef = db.doc(`users/${actorUid}`);
  const rolloutRef = db.doc("app_config/user_data_v2");
  const progressionRef = db.doc(`users/${actorUid}/state/progression`);
  const resourcesRef = db.doc(`users/${actorUid}/state/resources`);
  const utilsRef = db.doc("utils/varie");
  const receiptId = operationReceiptId(actorUid, operationId);
  const receiptRef = db.doc(`user_operations/${receiptId}`);
  const requestHash = operationRequestHash("spend-character-point", {
    statName,
    statType,
    change,
  });
  const result = await db.runTransaction(async (transaction) => {
    const [receipt, rollout, user, progression, resources, utils] =
      await transaction.getAll(
        receiptRef,
        rolloutRef,
        userRef,
        progressionRef,
        resourcesRef,
        utilsRef
      );
    if (!user.exists) {
      throw new HttpsError("not-found", "User document is missing.");
    }
    if (user.get("deletionState") === "pending") {
      throw new HttpsError(
        "failed-precondition",
        "The account is pending deletion."
      );
    }
    if (receipt.exists) {
      if (
        receipt.get("actorUid") !== actorUid ||
        receipt.get("action") !== "spend-character-point" ||
        receipt.get("requestHash") !== requestHash
      ) {
        throw new HttpsError(
          "already-exists",
          "operationId belongs to a different request."
        );
      }
      return {
        ...asRecord(receipt.get("result")),
        replayed: true,
      };
    }
    if (isUserDataLegacyDrainFrozen(rollout.data(), actorUid)) {
      throw new HttpsError(
        "unavailable",
        "User data is temporarily frozen. Retry later."
      );
    }
    const rootData = user.data() ?? {};
    const stats = {
      ...asRecord(rootData.stats),
      ...asRecord(progression.get("stats")),
    };
    const currentParametri = progression.get("Parametri") ??
      rootData.Parametri;
    const parametri = deepMergeRecords({}, currentParametri);
    const flags = {
      ...asRecord(rootData.flags),
      ...asRecord(progression.get("flags")),
    };
    const creationPhase = flags.characterCreationDone !== true;
    const firestoreKey = statType === "Combat"
      ? "Combattimento"
      : "Base";
    const stat = asRecord(asRecord(parametri[firestoreKey])[statName]);
    if (!Object.keys(stat).length) {
      throw new HttpsError(
        "internal",
        `Stat Parametri.${firestoreKey}.${statName} missing.`
      );
    }
    const curBase = asFiniteNumber(stat.Base);
    const newBase = curBase + (change as 1 | -1);
    if (newBase < MIN_BASE_VALUE) {
      throw new HttpsError("failed-precondition", "Cannot go below -1.");
    }
    if (statType === "Combat" && newBase < 0) {
      throw new HttpsError(
        "failed-precondition",
        "Combat stats cannot be negative."
      );
    }
    let availableField = "";
    let spentField = "";
    let availableDelta = 0;
    let spentDelta = 0;
    let negativeBaseStatCount = asFiniteNumber(
      stats.negativeBaseStatCount
    );
    if (statType === "Base") {
      availableField = "basePointsAvailable";
      spentField = "basePointsSpent";
      if (creationPhase) {
        if (
          curBase === 0 &&
          change === -1 &&
          negativeBaseStatCount >= MAX_NEGATIVE_BASE_STATS
        ) {
          throw new HttpsError(
            "failed-precondition",
            "You already have 4 parameters at -1."
          );
        }
        const nextNegativeCount = negativeBaseStatCount +
          (curBase === 0 && change === -1 ? 1 : 0) +
          (curBase === -1 && change === 1 ? -1 : 0);
        const creditDelta = Math.floor(nextNegativeCount / 2) -
          Math.floor(negativeBaseStatCount / 2);
        if (curBase > -1 && newBase > -1) {
          availableDelta += change === 1 ? -1 : 1;
          spentDelta += change === 1 ? 1 : -1;
        }
        availableDelta += creditDelta;
        negativeBaseStatCount = nextNegativeCount;
      } else {
        if (curBase === 0 && change === -1) {
          throw new HttpsError(
            "failed-precondition",
            "Selling stats is disabled after character creation."
          );
        }
        availableDelta += change === 1 ? -1 : 1;
        spentDelta += change === 1 ? 1 : -1;
      }
    } else {
      availableField = "combatTokensAvailable";
      spentField = "combatTokensSpent";
      const combatCosts = asRecord(utils.get("cost_params_combat"));
      const cost = asFiniteNumber(combatCosts[statName], Number.NaN);
      if (!Number.isFinite(cost) || cost < 0) {
        throw new HttpsError(
          "invalid-argument",
          `Unknown combat stat: ${statName}`
        );
      }
      const tokenNeed = cost * (change as 1 | -1);
      availableDelta = -tokenNeed;
      spentDelta = tokenNeed;
    }
    const currentAvailable = asFiniteNumber(stats[availableField]);
    if (availableDelta < 0 && currentAvailable < -availableDelta) {
      throw new HttpsError(
        "resource-exhausted",
        statType === "Combat"
          ? "Not enough tokens."
          : "Not enough ability points."
      );
    }
    const nextStats: Record<string, unknown> = {
      ...stats,
      [availableField]: currentAvailable + availableDelta,
      [spentField]: asFiniteNumber(stats[spentField]) + spentDelta,
      ...(statType === "Base" && creationPhase
        ? {negativeBaseStatCount}
        : {}),
    };
    const targetGroup = asRecord(parametri[firestoreKey]);
    targetGroup[statName] = {...stat, Base: newBase};
    parametri[firestoreKey] = targetGroup;
    const nextParametri = deriveParameterTotals(parametri);
    const level = asFiniteNumber(nextStats.level, 1);
    const resourceTotals = deriveResourceTotals({
      parametri: nextParametri,
      level,
      utils: utils.data(),
    });
    transaction.set(progressionRef, {
      schemaVersion: 2,
      revision: Math.max(
        0,
        Math.trunc(asFiniteNumber(progression.get("revision")))
      ) + 1,
      stats: nextStats,
      Parametri: nextParametri,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    }, {merge: true});
    if (Object.keys(resourceTotals).length) {
      transaction.set(resourcesRef, {
        schemaVersion: 2,
        revision: Math.max(
          0,
          Math.trunc(asFiniteNumber(resources.get("revision")))
        ) + 1,
        stats: {
          ...asRecord(resources.get("stats")),
          ...resourceTotals,
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      }, {merge: true});
    }
    if (writesLegacyUserProjection(resolveUserDataRolloutStage(
      rollout.data(),
      actorUid
    ))) {
      const rootUpdate: admin.firestore.UpdateData<
        admin.firestore.DocumentData
      > = {
        Parametri: nextParametri,
        [`stats.${availableField}`]: nextStats[availableField],
        [`stats.${spentField}`]: nextStats[spentField],
      };
      if (statType === "Base" && creationPhase) {
        rootUpdate["stats.negativeBaseStatCount"] =
          negativeBaseStatCount;
      }
      Object.entries(resourceTotals).forEach(([field, value]) => {
        rootUpdate[`stats.${field}`] = value;
      });
      transaction.update(userRef, rootUpdate);
    }
    const response = {success: true};
    transaction.create(receiptRef, {
      schemaVersion: 2,
      operationId,
      actorUid,
      action: "spend-character-point",
      requestHash,
      status: "completed",
      result: response,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: backendOperationExpiry(),
    });
    return {...response, replayed: false};
  });
  return {
    ...result,
    operationId,
    replayable: Boolean(suppliedOperationId),
  };
};

export const spendCharacterPoint = onCall(
  {region: LEGACY_REGION},
  spendCharacterPointLegacyHandler
);

export const spendCharacterPointV2 = onCall(
  {region: CANONICAL_REGION},
  spendCharacterPointHandler
);
