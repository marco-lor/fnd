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
import {updateHpTotal as legacyUpdateHpTotal} from "./updateHpTotal";
import {updateManaTotal as legacyUpdateManaTotal} from "./updateManaTotal";
import {
  updateTotParameters as legacyUpdateTotParameters,
} from "./updateTotParameters";
import {
  spendCharacterPoint,
  spendCharacterPointV2,
} from "./spendCharacterPoint";
// Import the delete user function
import {deleteUser} from "./deleteUser";
import {
  updateAnimaModifier as legacyUpdateAnimaModifier,
} from "./updateAnimaModifier";
import {levelUpAll} from "./levelUpAll";
import {levelUpUser} from "./levelUpUser";
import {updateUserRole} from "./updateUserRole";
import {
  duplicateFoeWithAssets,
  duplicateFoeWithAssetsV2,
} from "./duplicateFoeWithAssets";
import {expireBarriera as legacyExpireBarriera} from "./expireBarriera";
import {cleanupGrigliataMusicTrack} from "./cleanupGrigliataMusicTrack";
import {deleteGrigliataCustomToken} from "./deleteGrigliataCustomToken";
import {spawnGrigliataCustomTokenInstance} from "./spawnGrigliataCustomTokenInstance";
import {spawnGrigliataFoeToken} from "./spawnGrigliataFoeToken";
import {updateGrigliataCustomTokenTemplate} from "./updateGrigliataCustomTokenTemplate";
import {clientFirebaseConfig} from "./clientFirebaseConfig";
import {
  syncUserDirectory as legacySyncUserDirectory,
} from "./syncUserDirectory";
import {syncUserDerivedState} from "./syncUserDerivedState";
import {
  deleteEncounterV2,
  deleteNpcV2,
  getBackendOperationStatus,
  resumeBackendOperation,
  runBackendOperationWorker,
  setAllParameterLocks,
} from "./backendOperations";
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
import {usesDemoConsolidatedOwner} from "./demoConsolidatedOwner";

admin.initializeApp();

// The demo-only consolidated candidate exports one authoritative user-derived
// trigger. Normal builds keep every legacy export so an online rollout cannot
// change trigger availability until a separately reviewed deployment.
const usesConsolidatedDerivedOwner = usesDemoConsolidatedOwner();
const updateHpTotal = usesConsolidatedDerivedOwner ?
  undefined : legacyUpdateHpTotal;
const updateManaTotal = usesConsolidatedDerivedOwner ?
  undefined : legacyUpdateManaTotal;
const updateTotParameters = usesConsolidatedDerivedOwner ?
  undefined : legacyUpdateTotParameters;
const updateAnimaModifier = usesConsolidatedDerivedOwner ?
  undefined : legacyUpdateAnimaModifier;
const expireBarriera = usesConsolidatedDerivedOwner ?
  undefined : legacyExpireBarriera;
const syncUserDirectory = usesConsolidatedDerivedOwner ?
  undefined : legacySyncUserDirectory;

// Ri-esporta le funzioni affinché Firebase le distribuisca tutte.
export {
  updateHpTotal,
  updateManaTotal,
  updateTotParameters,
  spendCharacterPoint,
  spendCharacterPointV2,
  deleteUser,
  updateAnimaModifier,
  levelUpAll,
  levelUpUser,
  updateUserRole,
  duplicateFoeWithAssets,
  duplicateFoeWithAssetsV2,
  expireBarriera,
  cleanupGrigliataMusicTrack,
  deleteGrigliataCustomToken,
  spawnGrigliataCustomTokenInstance,
  spawnGrigliataFoeToken,
  updateGrigliataCustomTokenTemplate,
  clientFirebaseConfig,
  syncUserDirectory,
  syncUserDerivedState,
  setAllParameterLocks,
  deleteNpcV2,
  deleteEncounterV2,
  getBackendOperationStatus,
  resumeBackendOperation,
  runBackendOperationWorker,
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
