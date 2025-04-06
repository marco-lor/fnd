// file: ./functions/src/spendCharacterPoint.ts

import {
  onCall,
  HttpsError,
  CallableRequest,
} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
// import * as logger from "firebase-functions/logger";

interface SpendPointData {
  statName: string;
  statType: "Base" | "Combat"; // Input type remains the same
  change: 1 | -1;
}

interface CombatStatCosts {
  [key: string]: number;
  Salute: number;
  Mira: number;
  Attacco: number;
  Critico: number;
  Difesa: number;
  RiduzioneDanni: number;
  Disciplina: number;
}

const MINIMUM_STAT_BASE_VALUE = 0;

export const spendCharacterPoint = onCall(
  {
    region: "us-central1", // Or "europe-west8" if you changed it back
  },
  async (request: CallableRequest<SpendPointData>) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const uid = request.auth.uid;
    const {statName, statType, change} = request.data;

    // Determine the correct Firestore key based on input statType
    // *** THIS IS THE KEY CHANGE ***
    // eslint-disable-next-line max-len
    const firestoreStatTypeKey = statType === "Combat" ? "Combattimento" : "Base";
    // *** END KEY CHANGE ***

    // eslint-disable-next-line max-len
    const isValidStatType = statType === "Base" || statType === "Combat"; // Keep input validation as is
    const isValidChange = change === 1 || change === -1;

    // eslint-disable-next-line max-len
    if (!statName || !statType || !isValidStatType || !change || !isValidChange) {
      throw new HttpsError(
        "invalid-argument",
        "Invalid data. Required: statName (string), " +
          "statType ('Base'|'Combat'), change (1|-1)."
      );
    }

    const db = admin.firestore();
    const userDocRef = db.collection("users").doc(uid);
    const utilsDocRef = db.collection("utils").doc("varie");

    try {
      const utilsDocSnap = await utilsDocRef.get();
      if (!utilsDocSnap.exists) {
        throw new HttpsError(
          "not-found",
          "Utility configuration document (utils/varie) not found."
        );
      }
      const utilsData = utilsDocSnap.data();
      const combatStatCosts = utilsData?.cost_params_combat as
        | CombatStatCosts
        | undefined;

      if (!combatStatCosts) {
        throw new HttpsError(
          "internal",
          "Combat stat costs configuration (cost_params_combat) " +
            "is missing in utils/varie."
        );
      }

      await db.runTransaction(async (transaction) => {
        const userDocSnap = await transaction.get(userDocRef);
        if (!userDocSnap.exists) {
          throw new HttpsError("not-found", "User document not found.");
        }
        const userData = userDocSnap.data();
        if (!userData) {
          throw new HttpsError("internal", "User data is missing.");
        }

        // --- Revised Step 6: Use the correct Firestore key ---
        const currentStats = userData.stats;
        const currentParams = userData.Parametri;

        if (!currentStats) {
          throw new HttpsError("internal", "User 'stats' object is missing.");
        }
        if (!currentParams) {
          // eslint-disable-next-line max-len
          throw new HttpsError("internal", "User 'Parametri' object is missing.");
        }
        // Use the determined Firestore key here
        const statTypeObject = currentParams[firestoreStatTypeKey];
        if (!statTypeObject) {
          throw new HttpsError(
            "internal",
            // Use the correct key in the error message too
            `User 'Parametri.${firestoreStatTypeKey}' object is missing.`
          );
        }
        const specificStatObject = statTypeObject[statName];
        if (!specificStatObject) {
          throw new HttpsError(
            "internal",
            // Use the correct key in the error message too
            // eslint-disable-next-line max-len
            `User 'Parametri.${firestoreStatTypeKey}.${statName}' object is missing.`
          );
        }
        const currentParamBase = specificStatObject.Base;
        if (currentParamBase === undefined || currentParamBase === null) {
          throw new HttpsError(
            "internal",
            // Use the correct key in the error message too
            // eslint-disable-next-line max-len
            `Value for Parametri.${firestoreStatTypeKey}.${statName}.Base is missing (undefined or null).`
          );
        }
        // --- End Revised Step 6 ---

        const currentBaseValue = Number(currentParamBase);
        let availablePoints: number;
        let cost: number;
        let availablePointsField: string;
        let spentPointsField: string;

        // eslint-disable-next-line max-len
        // 7. Determine Point Type and Cost (No change needed here, uses input statType)
        if (statType === "Base") {
          cost = 1;
          availablePoints = Number(currentStats.basePointsAvailable) || 0;
          availablePointsField = "stats.basePointsAvailable";
          spentPointsField = "stats.basePointsSpent";
        } else { // statType === "Combat"
          cost = combatStatCosts[statName];
          if (cost === undefined) {
            throw new HttpsError(
              "invalid-argument",
              `Invalid or unconfigured combat stat name: ${statName}. ` +
                "Check 'cost_params_combat' in utils/varie."
            );
          }
          availablePoints = Number(currentStats.combatTokensAvailable) || 0;
          availablePointsField = "stats.combatTokensAvailable";
          spentPointsField = "stats.combatTokensSpent";
        }

        // 8. Validate Change (Same as before)
        if (change === 1) {
          if (availablePoints < cost) {
            const pointsNoun = statType === "Base" ? "points" : "tokens";
            throw new HttpsError(
              "resource-exhausted",
              // eslint-disable-next-line max-len
              `Insufficient ${pointsNoun}. Need ${cost}, have ${availablePoints}.`
            );
          }
        } else {
          if (currentBaseValue <= MINIMUM_STAT_BASE_VALUE) {
            throw new HttpsError(
              "failed-precondition",
              // eslint-disable-next-line max-len
              `Cannot decrease ${statName} below ${MINIMUM_STAT_BASE_VALUE}. Current base value is ${currentBaseValue}.`
            );
          }
        }

        // 9. Prepare Updates (Use the correct Firestore key in path)
        const newBaseValue = currentBaseValue + change;
        const pointsChange = cost * change;
        const updateData: { [key: string]: any } = {};
        // Use the determined Firestore key here
        const statPath = `Parametri.${firestoreStatTypeKey}.${statName}.Base`;
        updateData[statPath] = newBaseValue;
        // eslint-disable-next-line max-len
        updateData[availablePointsField] = admin.firestore.FieldValue.increment(-pointsChange);
        // eslint-disable-next-line max-len
        updateData[spentPointsField] = admin.firestore.FieldValue.increment(pointsChange);

        // 10. Apply Updates within Transaction (Same as before)
        transaction.update(userDocRef, updateData);
      }); // End Transaction

      // 11. Return Success (Same as before)
      return {
        success: true,
        message: `Successfully updated ${statType}.${statName}.`,
      };
    } catch (error: any) {
      // eslint-disable-next-line max-len
      console.error("Error in spendCharacterPoint transaction:", error); // Log the actual error server-side
      if (error instanceof HttpsError) {
        throw error;
      } else {
        // eslint-disable-next-line max-len
        console.error("Unexpected error details:", error.message, error.stack); // More detailed logging
        throw new HttpsError(
          "internal",
          "An unexpected error occurred while updating the stat.",
        );
      }
    }
  }
);
