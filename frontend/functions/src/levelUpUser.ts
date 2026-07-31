import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import {backendOperationExpiry, getTokenGrantForLevel} from "./backendOperationCore";
import {levelUpUserLegacyHandler} from "./levelUpUserLegacy";
import {isUserDataLegacyDrainFrozen} from "./userDataBridge";
import {
  asFiniteNumber,
  asRecord,
  asTrimmedString,
  deriveAnimaParameters,
  deriveResourceTotals,
  isValidFirestoreDocumentId,
  operationReceiptId,
  operationRequestHash,
  resolveUserDataRolloutStage,
  validateOperationId,
  writesLegacyUserProjection,
} from "./userDataV2";

type Request = {
  userId: string;
  operationId?: string;
};

const REGION = "europe-west8";

const levelUpUserOperationHandler = async (
  request: CallableRequest<Request>
): Promise<Record<string, unknown>> => {
    const actorUid = asTrimmedString(request.auth?.uid);
    if (!actorUid) {
      throw new HttpsError("unauthenticated", "You must be authenticated.");
    }
    const userId = asTrimmedString(request.data?.userId);
    if (!isValidFirestoreDocumentId(userId)) {
      throw new HttpsError(
        "invalid-argument",
        "userId must be a single valid document ID."
      );
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
    const callerRef = db.doc(`users/${actorUid}`);
    const userRef = db.doc(`users/${userId}`);
    const rolloutRef = db.doc("app_config/user_data_v2");
    const progressionRef = db.doc(`users/${userId}/state/progression`);
    const resourcesRef = db.doc(`users/${userId}/state/resources`);
    const utilsRef = db.doc("utils/varie");
    const receiptId = operationReceiptId(actorUid, operationId);
    const receiptRef = db.doc(`user_operations/${receiptId}`);
    const eventRef = userRef.collection("level_events").doc(receiptId);
    const requestHash = operationRequestHash("level-up-user", {
      userId,
      operationId,
    });
    const result = await db.runTransaction(async (transaction) => {
      const [
        receipt,
        caller,
        rollout,
        target,
        progression,
        resources,
        utils,
      ] = await transaction.getAll(
        receiptRef,
        callerRef,
        rolloutRef,
        userRef,
        progressionRef,
        resourcesRef,
        utilsRef
      );
      if (
        !caller.exists ||
        caller.get("role") !== "dm" ||
        caller.get("deletionState") === "pending"
      ) {
        throw new HttpsError(
          "permission-denied",
          "Only active DMs can level up players."
        );
      }
      if (receipt.exists) {
        if (
          receipt.get("actorUid") !== actorUid ||
          receipt.get("action") !== "level-up-user" ||
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
      if (isUserDataLegacyDrainFrozen(rollout.data(), userId)) {
        throw new HttpsError(
          "unavailable",
          "User data is temporarily frozen. Retry later."
        );
      }
      if (!target.exists) {
        throw new HttpsError("not-found", "Target user not found");
      }
      if (target.get("deletionState") === "pending") {
        throw new HttpsError(
          "failed-precondition",
          "The target account is pending deletion."
        );
      }
      const targetData = target.data() ?? {};
      if (asTrimmedString(targetData.role).toLowerCase() === "dm") {
        throw new HttpsError(
          "failed-precondition",
          "Cannot level up a DM account"
        );
      }
      const progressionStats = asRecord(progression.get("stats"));
      const rootStats = asRecord(targetData.stats);
      const fromLevel = Math.max(1, Math.trunc(asFiniteNumber(
        progressionStats.level ?? rootStats.level,
        1
      )));
      let response: Record<string, unknown>;
      if (fromLevel >= 10) {
        response = {
          skipped: "Already at max level",
          fromLevel,
          toLevel: fromLevel,
        };
      } else {
        const toLevel = fromLevel + 1;
        const tokensGranted = getTokenGrantForLevel(toLevel);
        const currentTokens = asFiniteNumber(
          progressionStats.combatTokensAvailable ??
            rootStats.combatTokensAvailable
        );
        const nextParametri = deriveAnimaParameters({
          parametri: progression.get("Parametri") ?? targetData.Parametri,
          altriParametri: progression.get("AltriParametri") ??
            targetData.AltriParametri,
          level: toLevel,
          utils: utils.data(),
        });
        const resourceTotals = deriveResourceTotals({
          parametri: nextParametri,
          level: toLevel,
          utils: utils.data(),
        });
        transaction.set(progressionRef, {
          schemaVersion: 2,
          revision: Math.max(
            0,
            Math.trunc(asFiniteNumber(progression.get("revision")))
          ) + 1,
          stats: {
            ...progressionStats,
            level: toLevel,
            combatTokensAvailable: currentTokens + tokensGranted,
          },
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
        const rootUpdate: admin.firestore.UpdateData<
          admin.firestore.DocumentData
        > = {
          "summary.level": toLevel,
        };
        const rolloutStage = resolveUserDataRolloutStage(
          rollout.data(),
          userId
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
        transaction.update(userRef, rootUpdate);
        transaction.create(eventRef, {
          from_level: fromLevel,
          to_level: toLevel,
          tokens_granted: tokensGranted,
          operationReceiptId: receiptId,
          timestamp: FieldValue.serverTimestamp(),
        });
        response = {fromLevel, toLevel, tokensGranted};
      }
      transaction.create(receiptRef, {
        schemaVersion: 2,
        operationId,
        actorUid,
        action: "level-up-user",
        requestHash,
        status: "completed",
        result: response,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: backendOperationExpiry(),
      });
      return {...response, replayed: false};
    });
    return {
      ok: true,
      userId,
      operationId,
      replayable: Boolean(suppliedOperationId),
      ...result,
    };
};

export const levelUpUser = onCall(
  {region: REGION},
  async (request: CallableRequest<Request>) => {
    const hasExplicitOperationId = Object.prototype.hasOwnProperty.call(
      request.data ?? {},
      "operationId"
    );
    if (!hasExplicitOperationId) {
      return levelUpUserLegacyHandler(request);
    }
    return levelUpUserOperationHandler(request);
  }
);
