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
import {spendCharacterPoint} from "./spendCharacterPoint";
// Import the delete user function
import {deleteUser} from "./deleteUser";
import {updateAnimaModifier} from "./updateAnimaModifier";
import {levelUpAll} from "./levelUpAll";
import {levelUpUser} from "./levelUpUser";
import {duplicateFoeWithAssets} from "./duplicateFoeWithAssets";
import {expireBarriera} from "./expireBarriera";

admin.initializeApp();

// Ri-esporta le funzioni affinché Firebase le distribuisca tutte.
export {
  updateHpTotal,
  updateManaTotal,
  updateTotParameters,
  spendCharacterPoint,
  deleteUser,
  updateAnimaModifier,
  levelUpAll,
  levelUpUser,
  duplicateFoeWithAssets,
  expireBarriera,
};
