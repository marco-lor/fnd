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

admin.initializeApp();

// Ri-esporta le funzioni affinché Firebase le distribuisca tutte.
export {updateHpTotal, updateManaTotal, updateTotParameters};
