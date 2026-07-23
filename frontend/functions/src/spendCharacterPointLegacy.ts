import {CallableRequest, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {assertLegacyRootMutationAllowed} from "./legacyRootMutationGate";

export interface LegacySpendPointData {
  statName?: string;
  statType?: "Base" | "Combat";
  change?: 1 | -1;
}

interface CombatStatCosts {
  [stat: string]: number;
}

const MIN_BASE_VALUE = -1;
const MAX_NEGATIVE_BASE_STATS = 4;

/**
 * Compatibility implementation for the original us-central1 callable.
 *
 * Keep this handler aligned with the pre-Task-06 implementation. In
 * particular, it updates only the legacy user aggregate and never creates a
 * Task-06 operation receipt.
 */
export const spendCharacterPointLegacyHandler = async (
  req: CallableRequest<LegacySpendPointData>
): Promise<{success: true}> => {
  if (!req.auth) {
    throw new HttpsError("unauthenticated", "You must be authenticated.");
  }
  const {statName, statType, change} = req.data;
  if (!statName || !statType || ![1, -1].includes(change ?? 0)) {
    throw new HttpsError("invalid-argument", "Bad request payload.");
  }
  const pointChange = change as 1 | -1;

  const uid = req.auth.uid;
  const db = admin.firestore();
  const userRef = db.doc(`users/${uid}`);
  const utilsRef = db.doc("utils/varie");
  const rolloutRef = db.doc("app_config/user_data_v2");

  let combatCosts: CombatStatCosts = {};
  if (statType === "Combat") {
    const utilSnap = await utilsRef.get();
    combatCosts = utilSnap.get("cost_params_combat") ?? {};
    if (combatCosts[statName] === undefined) {
      throw new HttpsError(
        "invalid-argument",
        `Unknown combat stat: ${statName}`
      );
    }
  }

  await db.runTransaction(async (tx) => {
    const [rollout, snap] = await tx.getAll(rolloutRef, userRef);
    assertLegacyRootMutationAllowed(rollout.data(), uid);
    if (!snap.exists) {
      throw new HttpsError("not-found", "User document is missing.");
    }

    const data = snap.data();
    if (!data) {
      throw new HttpsError("internal", "User data missing.");
    }

    const stats = data.stats ?? {};
    const params = data.Parametri ?? {};
    const flags = data.flags ?? {};
    const creationPhase = !(flags.characterCreationDone === true);
    const firestoreKey = statType === "Combat" ? "Combattimento" : "Base";
    const statObj = params[firestoreKey]?.[statName];
    if (!statObj) {
      throw new HttpsError(
        "internal",
        `Stat Parametri.${firestoreKey}.${statName} missing.`
      );
    }
    const curBase = Number(statObj.Base) || 0;
    const newBase = curBase + pointChange;
    if (newBase < MIN_BASE_VALUE) {
      throw new HttpsError("failed-precondition", "Cannot go below -1.");
    }
    if (statType === "Combat" && newBase < 0) {
      throw new HttpsError(
        "failed-precondition",
        "Combat stats cannot be negative."
      );
    }

    let availField = "";
    let spentField = "";
    let availDelta = 0;
    let spentDelta = 0;
    const update: admin.firestore.UpdateData<
      admin.firestore.DocumentData
    > = {
      [`Parametri.${firestoreKey}.${statName}.Base`]: newBase,
    };

    if (statType === "Base") {
      availField = "stats.basePointsAvailable";
      spentField = "stats.basePointsSpent";
      const negCount = Number(stats.negativeBaseStatCount) || 0;

      if (creationPhase) {
        if (
          curBase === 0 &&
          pointChange === -1 &&
          negCount >= MAX_NEGATIVE_BASE_STATS
        ) {
          throw new HttpsError(
            "failed-precondition",
            "You already have 4 parameters at -1."
          );
        }

        const newNeg = negCount +
          (curBase === 0 && pointChange === -1 ? 1 : 0) +
          (curBase === -1 && pointChange === 1 ? -1 : 0);
        const oldCredit = Math.floor(negCount / 2);
        const newCredit = Math.floor(newNeg / 2);
        const creditDelta = newCredit - oldCredit;

        if (curBase > -1 && newBase > -1) {
          if (pointChange === 1) {
            availDelta -= 1;
            spentDelta += 1;
          } else {
            availDelta += 1;
            spentDelta -= 1;
          }
        }

        availDelta += creditDelta;
        if (
          availDelta < 0 &&
          (stats.basePointsAvailable ?? 0) < -availDelta
        ) {
          throw new HttpsError(
            "resource-exhausted",
            "Not enough ability points."
          );
        }

        update[availField] =
          admin.firestore.FieldValue.increment(availDelta);
        update[spentField] =
          admin.firestore.FieldValue.increment(spentDelta);
        update["stats.negativeBaseStatCount"] = newNeg;
      } else {
        if (curBase === 0 && pointChange === -1) {
          throw new HttpsError(
            "failed-precondition",
            "Selling stats is disabled after character creation."
          );
        }

        if (pointChange === 1) {
          availDelta -= 1;
          spentDelta += 1;
        } else {
          availDelta += 1;
          spentDelta -= 1;
        }

        if (
          availDelta < 0 &&
          (stats.basePointsAvailable ?? 0) < -availDelta
        ) {
          throw new HttpsError(
            "resource-exhausted",
            "Not enough ability points."
          );
        }

        update[availField] =
          admin.firestore.FieldValue.increment(availDelta);
        update[spentField] =
          admin.firestore.FieldValue.increment(spentDelta);
      }
    } else {
      availField = "stats.combatTokensAvailable";
      spentField = "stats.combatTokensSpent";
      const cost = combatCosts[statName];
      const tokenNeed = cost * pointChange;

      if (
        pointChange === 1 &&
        (stats.combatTokensAvailable ?? 0) < cost
      ) {
        throw new HttpsError("resource-exhausted", "Not enough tokens.");
      }

      update[availField] =
        admin.firestore.FieldValue.increment(-tokenNeed);
      update[spentField] =
        admin.firestore.FieldValue.increment(tokenNeed);
    }

    tx.update(userRef, update);
  });

  return {success: true};
};
