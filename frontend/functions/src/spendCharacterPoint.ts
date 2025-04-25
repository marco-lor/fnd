import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */
interface SpendPointData {
  statName: string;
  statType: "Base" | "Combat";
  change: 1 | -1;
}

interface CombatStatCosts {
  [stat: string]: number;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */
const MIN_BASE_VALUE = -1; // Base attributes never go below –1
const MAX_NEGATIVE_BASE_STATS = 4; // 4 attributes at –1 during creation
const REGION = "us-central1"; // adjust if you deploy elsewhere

/* -------------------------------------------------------------------------- */
/*  Cloud Function                                                            */
/* -------------------------------------------------------------------------- */
export const spendCharacterPoint = onCall(
  {region: REGION},
  async (req: CallableRequest<SpendPointData>) => {
    /* ---------------------------------------------------------------------- */
    /*  0.  Preliminary validation                                            */
    /* ---------------------------------------------------------------------- */
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "You must be authenticated.");
    }
    const {statName, statType, change} = req.data;
    if (!statName || !statType || ![1, -1].includes(change)) {
      throw new HttpsError("invalid-argument", "Bad request payload.");
    }

    /* ---------------------------------------------------------------------- */
    /*  1.  References & pre-loads                                            */
    /* ---------------------------------------------------------------------- */
    const uid = req.auth.uid;
    const db = admin.firestore();
    const userRef = db.doc(`users/${uid}`);
    const utilsRef = db.doc("utils/varie");

    // Pre-load combat-cost table only if needed
    let combatCosts: CombatStatCosts = {};
    if (statType === "Combat") {
      const utilSnap = await utilsRef.get();
      combatCosts = utilSnap.get("cost_params_combat") ?? {};
      if (combatCosts[statName] === undefined) {
        // eslint-disable-next-line max-len
        throw new HttpsError("invalid-argument", `Unknown combat stat: ${statName}`);
      }
    }

    /* ---------------------------------------------------------------------- */
    /*  2.  Transaction                                                       */
    /* ---------------------------------------------------------------------- */
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
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

      /* -------------------------------------------------------------------- */
      /*  2a.  Locate the specific parameter                                  */
      /* -------------------------------------------------------------------- */
      const firestoreKey = statType === "Combat" ? "Combattimento" : "Base";
      const statObj = params[firestoreKey]?.[statName];
      if (!statObj) {
        // eslint-disable-next-line max-len
        throw new HttpsError("internal", `Stat Parametri.${firestoreKey}.${statName} missing.`);
      }
      const curBase = Number(statObj.Base) || 0;
      const newBase = curBase + change;

      /* -------------------------------------------------------------------- */
      /*  2b.  Common guards                                                  */
      /* -------------------------------------------------------------------- */
      if (newBase < MIN_BASE_VALUE) {
        throw new HttpsError("failed-precondition", "Cannot go below -1.");
      }
      if (statType === "Combat" && newBase < 0) {
        // eslint-disable-next-line max-len
        throw new HttpsError("failed-precondition", "Combat stats cannot be negative.");
      }

      /* -------------------------------------------------------------------- */
      /*  3.  Base-stat specific logic                                        */
      /* -------------------------------------------------------------------- */
      let availField = "";
      let spentField = "";
      let availDelta = 0; // (+) give back, (–) consume
      let spentDelta = 0; // mirror of availDelta
      const update: Record<string, any> = {
        [`Parametri.${firestoreKey}.${statName}.Base`]: newBase,
      };

      if (statType === "Base") {
        availField = "stats.basePointsAvailable";
        spentField = "stats.basePointsSpent";

        const negCount = Number(stats.negativeBaseStatCount) || 0;

        /* ----------------- 3.1 CREATION  PHASE ---------------------------- */
        if (creationPhase) {
          /* guard: max 4 parameters at –1 */
          // eslint-disable-next-line max-len
          if (curBase === 0 && change === -1 && negCount >= MAX_NEGATIVE_BASE_STATS) {
            throw new HttpsError(
              "failed-precondition",
              "You already have 4 parameters at -1."
            );
          }

          // What will the new negative count be?
          const newNeg =
            negCount +
            (curBase === 0 && change === -1 ? 1 : 0) +
            (curBase === -1 && change === 1 ? -1 : 0);

          /* credit system: +1 free point for every full pair of -1 */
          const oldCredit = Math.floor(negCount / 2);
          const newCredit = Math.floor(newNeg / 2);
          const creditDelta = newCredit - oldCredit; // +1 → gained, -1 → lost

          // Normal cost/refund when both values are ≥0
          if (curBase > -1 && newBase > -1) {
            if (change === 1) {
              availDelta -= 1;
              spentDelta += 1;
            } else {
              availDelta += 1;
              spentDelta -= 1;
            }
          }

          availDelta += creditDelta; // apply free/removed credit
          // If we're spending, make sure user can afford it
          // eslint-disable-next-line max-len
          if (availDelta < 0 && (stats.basePointsAvailable ?? 0) < -availDelta) {
            throw new HttpsError(
              "resource-exhausted",
              "Not enough ability points."
            );
          }

          update[availField] = admin.firestore.FieldValue.increment(availDelta);
          update[spentField] = admin.firestore.FieldValue.increment(spentDelta);
          update["stats.negativeBaseStatCount"] = newNeg;

        /* ----------------- 3.2 RUNTIME  PHASE ----------------------------- */
        } else {
          /* after creation: 0 → -1 is forbidden */
          if (curBase === 0 && change === -1) {
            throw new HttpsError(
              "failed-precondition",
              "Selling stats is disabled after character creation."
            );
          }

          // Standard cost/refund; credits no longer change
          if (change === 1) {
            availDelta -= 1;
            spentDelta += 1;
          } else { // change === -1 and curBase > 0
            availDelta += 1;
            spentDelta -= 1;
          }

          // eslint-disable-next-line max-len
          if (availDelta < 0 && (stats.basePointsAvailable ?? 0) < -availDelta) {
            throw new HttpsError(
              "resource-exhausted",
              "Not enough ability points."
            );
          }

          update[availField] = admin.firestore.FieldValue.increment(availDelta);
          update[spentField] = admin.firestore.FieldValue.increment(spentDelta);
          /*  ⚠️  DO NOT touch negativeBaseStatCount or the original credits */
        }

      /* -------------------------------------------------------------------- */
      /*  4.  Combat-stat logic                                               */
      /* -------------------------------------------------------------------- */
      } else {
        availField = "stats.combatTokensAvailable";
        spentField = "stats.combatTokensSpent";

        const cost = combatCosts[statName];
        const tokenNeed = cost * change; // +cost for refund, -cost for spend

        if (change === 1 && (stats.combatTokensAvailable ?? 0) < cost) {
          throw new HttpsError("resource-exhausted", "Not enough tokens.");
        }

        update[availField] = admin.firestore.FieldValue.increment(-tokenNeed);
        update[spentField] = admin.firestore.FieldValue.increment(tokenNeed);
      }

      /* -------------------------------------------------------------------- */
      /*  5.  Commit                                                          */
      /* -------------------------------------------------------------------- */
      tx.update(userRef, update);
    });

    /* ---------------------------------------------------------------------- */
    /*  Success                                                               */
    /* ---------------------------------------------------------------------- */
    return {success: true};
  }
);
