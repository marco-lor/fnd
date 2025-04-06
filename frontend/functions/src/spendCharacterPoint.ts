// Import v2 specific modules for HTTPS callable functions and errors
import {
  onCall,
  HttpsError,
  CallableRequest,
} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
// If you plan to use structured logging, uncomment the next line
// import * as logger from "firebase-functions/logger";

// Do NOT initialize Firebase Admin here because it's already initialized
// in index.ts.

// Define the expected input data structure for type safety
interface SpendPointData {
  statName: string;
  statType: "Base" | "Combat";
  change: 1 | -1;
}

// Define the structure of the combat stat costs in utils
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

// Define the minimum allowed base value for a stat (adjust if needed)
const MINIMUM_STAT_BASE_VALUE = 0;

// Define the function using the v2 'onCall' syntax
export const spendCharacterPoint = onCall(
  {
    region: "europe-west8", // Specify region in the options object
    // Add other options like memory, timeoutSeconds if needed
    // memory: "256MiB",
    // timeoutSeconds: 60,
  },
  async (request: CallableRequest<SpendPointData>) => {
    // 1. Authentication Check (uses request.auth in v2)
    if (!request.auth) {
      // Use HttpsError directly (imported from v2/https)
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }
    const uid = request.auth.uid;

    // 2. Input Validation (uses request.data in v2)
    const {statName, statType, change} = request.data; // Destructure
    const isValidStatType = statType === "Base" || statType === "Combat";
    const isValidChange = change === 1 || change === -1;

    // eslint-disable-next-line max-len
    if (!statName || !statType || !isValidStatType || !change || !isValidChange) {
      throw new HttpsError(
        "invalid-argument",
        "Invalid data. Required: statName (string), " +
          "statType ('Base'|'Combat'), change (1|-1)."
      );
    }

    // 3. Firestore References
    const db = admin.firestore();
    const userDocRef = db.collection("users").doc(uid);
    const utilsDocRef = db.collection("utils").doc("varie");

    try {
      // 4. Fetch Utils Data (Costs)
      const utilsDocSnap = await utilsDocRef.get();
      if (!utilsDocSnap.exists) {
        throw new HttpsError(
          "not-found",
          "Utility configuration document (utils/varie) not found."
        );
      }
      const utilsData = utilsDocSnap.data();
      // Use optional chaining and nullish coalescing for safer access
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

      // 5. Run Transaction
      await db.runTransaction(async (transaction) => {
        const userDocSnap = await transaction.get(userDocRef);
        if (!userDocSnap.exists) {
          throw new HttpsError("not-found", "User document not found.");
        }
        const userData = userDocSnap.data();
        if (!userData) {
          throw new HttpsError("internal", "User data is missing.");
        }

        // 6. Get Current Values
        const currentStats = userData.stats;
        const currentParams = userData.Parametri;
        const currentParamBase = currentParams?.[statType]?.[statName]?.Base;

        // More robust check for nested properties
        if (!currentStats || currentParamBase === undefined) {
          throw new HttpsError(
            "internal",
            `Stat data for Parametri.${statType}.${statName}.Base ` +
              "is missing or not structured correctly."
          );
        }

        const currentBaseValue = Number(currentParamBase) || 0;
        let availablePoints: number;
        let cost: number;
        let availablePointsField: string;
        let spentPointsField: string;

        // 7. Determine Point Type and Cost
        if (statType === "Base") {
          cost = 1; // Base stats cost 1 point
          availablePoints = Number(currentStats.basePointsAvailable) || 0;
          availablePointsField = "stats.basePointsAvailable";
          spentPointsField = "stats.basePointsSpent";
        } else {
          // Combat stats
          cost = combatStatCosts[statName];
          if (cost === undefined) {
            // Check if the key exists in the fetched costs
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

        // 8. Validate Change
        if (change === 1) {
          // Increasing stat
          if (availablePoints < cost) {
            const pointsNoun = statType === "Base" ? "points" : "tokens";
            throw new HttpsError(
              "resource-exhausted",
              `Insufficient ${pointsNoun}. ` +
                `Need ${cost}, have ${availablePoints}.`
            );
          }
        } else {
          // Decreasing stat (change === -1)
          if (currentBaseValue <= MINIMUM_STAT_BASE_VALUE) {
            throw new HttpsError(
              "failed-precondition",
              `Cannot decrease ${statName} below ${MINIMUM_STAT_BASE_VALUE}. ` +
                `Current base value is ${currentBaseValue}.`
            );
          }
          // Cost is effectively the amount refunded when decreasing
        }

        // 9. Prepare Updates
        const newBaseValue = currentBaseValue + change;
        // Cost deducted if +1, refunded if -1
        const pointsChange = cost * change;

        const updateData: { [key: string]: any } = {};
        const statPath = `Parametri.${statType}.${statName}.Base`;
        // Use FieldValue for atomic increments/decrements
        updateData[statPath] = newBaseValue;
        updateData[availablePointsField] =
          admin.firestore.FieldValue.increment(-pointsChange);
        updateData[spentPointsField] =
          admin.firestore.FieldValue.increment(pointsChange);

        // 10. Apply Updates within Transaction
        transaction.update(userDocRef, updateData);
      }); // End Transaction

      // 11. Return Success
      // logger.info(
      //   `Success: ${statType}.${statName} user ${uid} change ${change}.`
      // );
      return {
        success: true,
        message: `Successfully updated ${statType}.${statName}.`,
      };
    } catch (error: any) {
      // Log the error for debugging
      // logger.error(`Error updating stat for user ${uid}:`, error);

      // Re-throw HttpsError or wrap other errors
      if (error instanceof HttpsError) {
        throw error;
      } else {
        // Log original error for server-side debugging
        console.error("Unexpected error in spendCharacterPoint:", error);
        throw new HttpsError(
          "internal",
          "An unexpected error occurred while updating the stat.",
          // Optionally include original error details for debugging,
          // but be careful about exposing sensitive info.
          // error.message
        );
      }
    }
  }
);
