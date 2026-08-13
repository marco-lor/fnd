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
import {spendCharacterPointV2} from "./spendCharacterPoint";
// Import the delete user function
import {deleteUser} from "./deleteUser";
import {levelUpAll} from "./levelUpAll";
import {levelUpUser} from "./levelUpUser";
import {updateUserRole} from "./updateUserRole";
import {
  duplicateFoeWithAssets,
  duplicateFoeWithAssetsV2,
} from "./duplicateFoeWithAssets";
import {cleanupGrigliataMusicTrack} from "./cleanupGrigliataMusicTrack";
import {deleteGrigliataCustomToken} from "./deleteGrigliataCustomToken";
import {spawnGrigliataCustomTokenInstance} from "./spawnGrigliataCustomTokenInstance";
import {spawnGrigliataFoeToken} from "./spawnGrigliataFoeTokenV2";
import {updateGrigliataCustomTokenTemplate} from "./updateGrigliataCustomTokenTemplate";
import {clientFirebaseConfig} from "./clientFirebaseConfig";
import {syncUserDirectory} from "./syncUserDirectory";
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
  task05CharacterCreation,
  task05CommitConsumable,
  task05ConsumeTurnEffects,
  task05ListAdminUsers,
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
  cleanupLegacyMedia,
  cleanupLegacyRemovedBackgroundMedia,
  cleanupLegacyRemovedCatalogItemMedia,
  cleanupLegacyRemovedFoeMedia,
  cleanupLegacyRemovedMusicTrackMedia,
  cleanupLegacyRemovedNpcMedia,
  cleanupLegacyRemovedTokenMedia,
  cleanupLegacyRemovedUserMedia,
  sweepLegacyMediaCleanup,
} from "./legacyMediaCleanup";
import {
  cleanupDeletedGrigliataTokenImage,
  cleanupReplacedGrigliataTokenImage,
} from "./cleanupGrigliataTokenImage";
import {
  cleanupTask07MediaAsset,
  cleanupTask07RemovedBackgroundMedia,
  cleanupTask07RemovedCatalogItemMedia,
  cleanupTask07RemovedFoeMedia,
  cleanupTask07RemovedInventoryMedia,
  cleanupTask07RemovedMusicTrackMedia,
  cleanupTask07RemovedNpcMedia,
  cleanupTask07RemovedSpellMedia,
  cleanupTask07RemovedTechniqueMedia,
  cleanupTask07RemovedTokenMedia,
  cleanupTask07RemovedUserMedia,
  sweepTask07MediaOrphans,
  task07AbandonMediaAsset,
  task07AttachMediaAsset,
  task07ConfirmMediaReference,
  task07GetMediaStatus,
  task07PrepareMediaUpload,
  task07RetireMediaAsset,
  task07RetryMediaCleanup,
} from "./mediaAssetLifecycle";
import {task07ProcessMediaUpload} from "./mediaAssetProcessor";
import {task07ResolveCharacterMedia} from "./grigliataCharacterMedia";
import {
  syncTask07MusicStreamFromControl,
  syncTask07MusicStreamFromPlayback,
  syncTask07MusicStreamFromSession,
  syncTask07MusicStreamFromTrack,
} from "./grigliataMusicStream";
import {
  sweepTask07FoeMediaOperations,
  task07AbandonFoeMediaRetirement,
  task07CommitFoeMediaRetirement,
  task07PrepareFoeMediaRetirement,
} from "./foeMediaRetirement";

admin.initializeApp();

// Ri-esporta le funzioni affinché Firebase le distribuisca tutte.
export {
  spendCharacterPointV2,
  deleteUser,
  levelUpAll,
  levelUpUser,
  updateUserRole,
  duplicateFoeWithAssets,
  duplicateFoeWithAssetsV2,
  cleanupGrigliataMusicTrack,
  deleteGrigliataCustomToken,
  spawnGrigliataCustomTokenInstance,
  spawnGrigliataFoeToken,
  updateGrigliataCustomTokenTemplate,
  clientFirebaseConfig,
  syncUserDirectory,
  setAllParameterLocks,
  deleteNpcV2,
  deleteEncounterV2,
  getBackendOperationStatus,
  resumeBackendOperation,
  runBackendOperationWorker,
  task05AdjustGold,
  task05CharacterCreation,
  task05CommitConsumable,
  task05ConsumeTurnEffects,
  task05ListAdminUsers,
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
  cleanupLegacyMedia,
  cleanupLegacyRemovedBackgroundMedia,
  cleanupLegacyRemovedCatalogItemMedia,
  cleanupLegacyRemovedFoeMedia,
  cleanupLegacyRemovedMusicTrackMedia,
  cleanupLegacyRemovedNpcMedia,
  cleanupLegacyRemovedTokenMedia,
  cleanupLegacyRemovedUserMedia,
  sweepLegacyMediaCleanup,
  cleanupTask07MediaAsset,
  cleanupTask07RemovedBackgroundMedia,
  cleanupTask07RemovedCatalogItemMedia,
  cleanupTask07RemovedFoeMedia,
  cleanupTask07RemovedInventoryMedia,
  cleanupTask07RemovedMusicTrackMedia,
  cleanupTask07RemovedNpcMedia,
  cleanupTask07RemovedSpellMedia,
  cleanupTask07RemovedTechniqueMedia,
  cleanupTask07RemovedTokenMedia,
  cleanupTask07RemovedUserMedia,
  sweepTask07MediaOrphans,
  task07AbandonMediaAsset,
  task07AttachMediaAsset,
  task07ConfirmMediaReference,
  task07GetMediaStatus,
  task07PrepareMediaUpload,
  task07ProcessMediaUpload,
  task07ResolveCharacterMedia,
  task07RetireMediaAsset,
  task07RetryMediaCleanup,
  task07PrepareFoeMediaRetirement,
  task07CommitFoeMediaRetirement,
  task07AbandonFoeMediaRetirement,
  sweepTask07FoeMediaOperations,
  syncTask07MusicStreamFromControl,
  syncTask07MusicStreamFromPlayback,
  syncTask07MusicStreamFromSession,
  syncTask07MusicStreamFromTrack,
};
