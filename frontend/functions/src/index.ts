/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at
 * https://firebase.google.com/docs/functions
 */

import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import {updateHpTotal} from "./updateHpTotal";
import {updateManaTotal} from "./updateManaTotal"; // new function import

admin.initializeApp();
const db = admin.firestore();

interface SingleParam {
  Base?: number;
  Anima?: number;
  Equip?: number;
  Mod?: number;
  Tot?: number;
}

interface Parametri {
  Base?: Record<string, SingleParam>;
  Combattimento?: Record<string, SingleParam>;
  // ... other sections as needed
}

export const updateTotParameters = onDocumentWritten(
  {
    document: "users/{userId}",
    region: "europe-west8", // Explicitly set the region here
  },
  async (event) => {
    const userId = event.params?.userId;
    const afterData = event.data?.after?.data();

    if (!afterData || !afterData.Parametri) {
      console.log("No 'Parametri' field found in user document.");
      return;
    }

    const parametri: Parametri = afterData.Parametri;
    // Clone the object to avoid mutating the original data.
    const updatedParams: Parametri = {...parametri};

    let changes = false; // Flag to track if any Tot value changes.

    const computeTotal = (param: SingleParam): number => {
      return (
        (param.Base || 0) +
        (param.Anima || 0) +
        (param.Equip || 0) +
        (param.Mod || 0)
      );
    };

    // Process Base section if available.
    if (updatedParams.Base) {
      for (const key of Object.keys(updatedParams.Base)) {
        const p = updatedParams.Base[key];
        if (p) {
          const newTot = computeTotal(p);
          // Only update if the computed total differs.
          if (p.Tot !== newTot) {
            p.Tot = newTot;
            changes = true;
          }
        }
      }
    }

    // Process Combattimento section if available.
    if (updatedParams.Combattimento) {
      for (const key of Object.keys(updatedParams.Combattimento)) {
        const p = updatedParams.Combattimento[key];
        if (p) {
          const newTot = computeTotal(p);
          // Only update if the computed total differs.
          if (p.Tot !== newTot) {
            p.Tot = newTot;
            changes = true;
          }
        }
      }
    }

    // If no Tot values changed, skip the Firestore update.
    if (!changes) {
      console.log("No changes in Tot values; skipping update.");
      return;
    }

    try {
      if (userId) {
        await db.collection("users").doc(userId)
          .update({Parametri: updatedParams});
        console.log(`Updated Tot values for user ${userId}`);
      }
    } catch (error) {
      console.error("Error updating Tot values:", error);
    }
  }
);

// Re-export functions so that Firebase deploys both.
export {updateHpTotal, updateManaTotal};
