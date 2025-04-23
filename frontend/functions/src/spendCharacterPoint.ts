import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

interface SpendPointData {
  statName: string;
  statType: "Base" | "Combat";
  change: 1 | -1;
}

interface CombatStatCosts {
  [k: string]: number;
}

const MIN_BASE = -1; // new minimum for Base parameters
const MAX_NEG = 4; // max parameters allowed at –1

export const spendCharacterPoint = onCall(
  {region: "us-central1"},
  async (req: CallableRequest<SpendPointData>) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Auth required.");

    const {statName, statType, change} = req.data;
    if (!statName || !statType || ![1, -1].includes(change)) {
      throw new HttpsError("invalid-argument", "Bad request.");
    }

    const uid = req.auth.uid;
    const db = admin.firestore();
    const user = db.doc(`users/${uid}`);
    const util = db.doc("utils/varie");

    // -----------------------------------------------------------------------
    //  Pre-load cost table (only needed for Combat)
    // -----------------------------------------------------------------------
    let combatCosts: CombatStatCosts = {};
    if (statType === "Combat") {
      const utilSnap = await util.get();
      combatCosts = utilSnap.get("cost_params_combat") ?? {};
      if (combatCosts[statName] === undefined) {
        throw new HttpsError("invalid-argument", "Unknown combat stat.");
      }
    }

    // -----------------------------------------------------------------------
    //  Run transaction
    // -----------------------------------------------------------------------
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(user);
      if (!snap.exists) throw new HttpsError("not-found", "User missing.");

      const data = snap.data()!;
      const stats = data.stats ?? {};
      const params = data.Parametri ?? {};
      const keyFireStore = statType === "Combat" ? "Combattimento" : "Base";
      const statObj = params[keyFireStore]?.[statName];

      if (!statObj) throw new HttpsError("internal", "Stat missing.");

      // Current values
      const curBase = Number(statObj.Base) || 0;
      const newBase = curBase + change;
      const negCount = Number(stats.negativeBaseStatCount) || 0;
      const newNegCount =
        statType === "Base" ?
          negCount + (curBase === 0 && change === -1 ? 1 : 0) +
            (curBase === -1 && change === 1 ? -1 : 0) :
          negCount;

      // ---------------------------------------------------------------------
      //  VALIDATION
      // ---------------------------------------------------------------------
      if (statType === "Base") {
        if (newBase < MIN_BASE) {
          throw new HttpsError("failed-precondition", "Cannot go below -1.");
        }
        if (newNegCount > MAX_NEG) {
          // eslint-disable-next-line max-len
          throw new HttpsError("failed-precondition", "Max 4 parameters at -1.");
        }
      } else if (newBase < 0) {
        throw new HttpsError("failed-precondition", "Combat stats >= 0.");
      }

      // ---------------------------------------------------------------------
      //  How many points/tokens are consumed / refunded
      // ---------------------------------------------------------------------
      let availField: string;
      let spentField: string;
      let availDelta = 0; // + => gain, - => spend
      let spentDelta = 0;

      if (statType === "Base") {
        availField = "stats.basePointsAvailable";
        spentField = "stats.basePointsSpent";

        const oldCredit = Math.floor(negCount / 2);
        const newCredit = Math.floor(newNegCount / 2);
        // eslint-disable-next-line max-len
        const creditDelta = newCredit - oldCredit; // +1 when hitting 2 / 4, -1 when leaving

        // Normal + / – between non-negative values
        if (curBase > -1 && newBase > -1) {
          if (change === 1) {
            availDelta -= 1;
            spentDelta += 1;
          } else {
            availDelta += 1;
            spentDelta -= 1;
          }
        }

        // Transition involving -1 (0 ↔ -1)
        availDelta += creditDelta; // handles free / consumed credit
      } else {
        availField = "stats.combatTokensAvailable";
        spentField = "stats.combatTokensSpent";

        const cost = combatCosts[statName];
        const need = change === 1 ? cost : -cost;
        availDelta -= need;
        spentDelta += need * (change === 1 ? 1 : -1);

        if (change === 1 && (stats.combatTokensAvailable ?? 0) < cost) {
          throw new HttpsError("resource-exhausted", "Not enough tokens.");
        }
      }

      // ---------------------------------------------------------------------
      //  Build atomic update
      // ---------------------------------------------------------------------
      const upd: Record<string, any> = {
        [`Parametri.${keyFireStore}.${statName}.Base`]: newBase,
        [availField]: admin.firestore.FieldValue.increment(availDelta),
        [spentField]: admin.firestore.FieldValue.increment(spentDelta),
      };

      if (statType === "Base") {
        upd["stats.negativeBaseStatCount"] = newNegCount;
      }

      tx.update(user, upd);
    });

    return {success: true};
  }
);
