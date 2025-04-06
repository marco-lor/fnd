/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at
 * https://firebase.google.com/docs/functions
 */

import * as admin from "firebase-admin";
import {updateHpTotal} from "./updateHpTotal";
import {updateManaTotal} from "./updateManaTotal";
import {updateTotParameters} from "./updateTotParameters";
// Import the new function
import {spendCharacterPoint} from "./spendCharacterPoint";

admin.initializeApp();

// Ri-esporta le funzioni affinché Firebase le distribuisca tutte.
export {
  updateHpTotal,
  updateManaTotal,
  updateTotParameters,
  // Export the new function
  spendCharacterPoint,
};
