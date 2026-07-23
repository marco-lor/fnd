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
import {updateUserRole} from "./updateUserRole";
import {duplicateFoeWithAssets} from "./duplicateFoeWithAssets";
import {expireBarriera} from "./expireBarriera";
import {cleanupGrigliataMusicTrack} from "./cleanupGrigliataMusicTrack";
import {deleteGrigliataCustomToken} from "./deleteGrigliataCustomToken";
import {spawnGrigliataCustomTokenInstance} from "./spawnGrigliataCustomTokenInstance";
import {spawnGrigliataFoeToken} from "./spawnGrigliataFoeToken";
import {updateGrigliataCustomTokenTemplate} from "./updateGrigliataCustomTokenTemplate";
import {clientFirebaseConfig} from "./clientFirebaseConfig";
import {syncUserDirectory} from "./syncUserDirectory";
import {
  task05AdjustGold,
  task05CommitConsumable,
  task05UpdateGrigliataCharacterResources,
  task05MutateInventory,
  task05MutatePersonalContent,
  task05PrepareConsumable,
  task05PurchaseItem,
  task05SetEquipment,
  task05UpdateProfileContent,
  task05UpdateProfile,
  task05UpdateProgression,
  task05UpdateResource,
  task05UpdateSettings,
} from "./userDataCommands";
import {cleanupUserOwnedMedia} from "./userOwnedMediaCleanup";
import {
  cleanupDeletedGrigliataTokenImage,
  cleanupReplacedGrigliataTokenImage,
} from "./cleanupGrigliataTokenImage";

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
  updateUserRole,
  duplicateFoeWithAssets,
  expireBarriera,
  cleanupGrigliataMusicTrack,
  deleteGrigliataCustomToken,
  spawnGrigliataCustomTokenInstance,
  spawnGrigliataFoeToken,
  updateGrigliataCustomTokenTemplate,
  clientFirebaseConfig,
  syncUserDirectory,
  task05AdjustGold,
  task05CommitConsumable,
  task05UpdateGrigliataCharacterResources,
  task05MutateInventory,
  task05MutatePersonalContent,
  task05PrepareConsumable,
  task05PurchaseItem,
  task05SetEquipment,
  task05UpdateProfileContent,
  task05UpdateProfile,
  task05UpdateProgression,
  task05UpdateResource,
  task05UpdateSettings,
  cleanupDeletedGrigliataTokenImage,
  cleanupReplacedGrigliataTokenImage,
  cleanupUserOwnedMedia,
};
