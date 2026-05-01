import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useAuth } from '../../AuthContext';
import { db, functions, storage } from '../firebaseConfig';
import BackgroundGalleryPanel from './BackgroundGalleryPanel';
import GrigliataLightingImportPanel from './GrigliataLightingImportPanel';
import MusicLibraryPanel from './MusicLibraryPanel';
import {
  buildGrigliataLightingSummary,
  GRIGLIATA_BACKGROUND_LIGHTING_COLLECTION,
  normalizeDungeonAlchemistLightingMetadata,
  parseDungeonAlchemistLightingJson,
} from './dungeonAlchemistLighting';
import {
  buildGrigliataLightingRenderInput,
  GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION,
} from './lightingRenderInput';
import {
  buildPlacementDocId,
  buildStorageSafeName,
  getDisplayNameFromFileName,
  getFileExtension,
  getFileExtensionFromContentType,
  isVideoBackground,
  isManagerRole,
  normalizeGridConfig,
  readFileImageDimensions,
  readFileVideoMetadata,
  snapBoardPointToGrid,
} from './boardUtils';
import {
  DEFAULT_GRID,
  FOE_LIBRARY_DRAG_TYPE,
  getGrigliataDrawTheme,
  resolveGrigliataDrawColorKey,
} from './constants';
import {
  buildGrigliataAoEFigureDoc,
  buildGrigliataAoEFigureDocId,
  findNextGrigliataAoEFigureSlot,
  GRIGLIATA_AOE_FIGURE_COLLECTION,
  normalizeGrigliataAoEFigureDraft,
} from './aoeFigures';
import GrigliataBoard from './GrigliataBoard';
import {
  buildGrigliataLiveInteractionDoc,
  buildGrigliataLiveInteractionDocId,
  GRIGLIATA_LIVE_INTERACTION_COLLECTION,
  GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS,
  normalizeGrigliataLiveInteractionDraft,
} from './liveInteractions';
import MapCalibrationPanel from './MapCalibrationPanel';
import MyTokenTray from './MyTokenTray';
import {
  buildGrigliataMusicPlaybackState,
  computeGrigliataMusicPlaybackOffsetMs,
  DEFAULT_GRIGLIATA_MUSIC_VOLUME,
  EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE,
  GRIGLIATA_MUSIC_MUTED_FIELD,
  GRIGLIATA_MUSIC_PLAYBACK_COLLECTION,
  GRIGLIATA_MUSIC_PLAYBACK_DOC_ID,
  GRIGLIATA_MUSIC_PLAYBACK_STATUSES,
  GRIGLIATA_MUSIC_TRACK_COLLECTION,
  MAX_GRIGLIATA_MUSIC_FILE_BYTES,
  normalizeGrigliataMusicVolume,
  normalizeGrigliataMusicPlaybackState,
  readAudioFileMetadata,
} from './music';
import {
  GRIGLIATA_PAGE_PRESENCE_COLLECTION,
  GRIGLIATA_PAGE_PRESENCE_HEARTBEAT_MS,
} from './presence';
import { preloadImageAssets, scheduleImageAssetPreload } from './imageAssetRegistry';
import {
  buildTurnOrderActiveState,
  buildShieldTurnEffect,
  getFirstTurnOrderEntry,
  getNextTurnOrderEntry,
  getTurnEffectByKind,
  normalizeTurnCounter,
  normalizeTurnEffects,
  reconcileTurnEffectsAtTurnCounter,
  TURN_EFFECT_KIND_SHIELD,
} from './turnOrder';
import useGrigliataPageData from './useGrigliataPageData';
import useGrigliataLightingMetadata from './useGrigliataLightingMetadata';
import useGrigliataLightingRenderInput from './useGrigliataLightingRenderInput';
import useGrigliataFogOfWar from './useGrigliataFogOfWar';
import useGrigliataFogOfWarPersistence from './useGrigliataFogOfWarPersistence';
import useGrigliataPlacementActions from './useGrigliataPlacementActions';
import { GRIGLIATA_FOG_OF_WAR_COLLECTION } from './fogOfWar';
import { useShellLayout } from '../common/shellLayout';

const MAX_BACKGROUND_IMAGE_FILE_BYTES = 15 * 1024 * 1024;
const MAX_BACKGROUND_VIDEO_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CUSTOM_TOKEN_FILE_BYTES = 8 * 1024 * 1024;
const FIRESTORE_BATCH_SIZE = 450;
// Firestore batched writes are capped at 20 rule access calls. Grigliata
// placement writes trigger role checks and, for custom/foe tokens, token
// reference validation reads, so these bulk actions need conservative chunking.
const PLACEMENT_RULE_SAFE_BATCH_SIZE = 6;
const PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE = 4;
const PLACEMENT_DELETE_BATCH_SIZE = 3;
const DRAW_COLOR_AUTOSAVE_DEBOUNCE_MS = 300;
const GRID_SIZE_AUTOSAVE_DEBOUNCE_MS = 300;
const MUSIC_VOLUME_WRITE_THROTTLE_MS = 150;
const LEGACY_TOKEN_CLEANUP_FIELD = 'legacyTokenPlacementCleanupCompletedAt';
const LEGACY_PLACEMENT_DEAD_STATE_CLEANUP_FIELD = 'legacyPlacementDeadStateCleanupCompletedAt';
const LEGACY_PLACEMENT_VISIBILITY_CLEANUP_FIELD = 'legacyPlacementVisibilityCleanupCompletedAt';
const GRIGLIATA_HIDDEN_BACKGROUND_IDS_FIELD = 'grigliata_hidden_background_ids';
const GRIGLIATA_HIDDEN_TOKEN_IDS_BY_BACKGROUND_FIELD = 'grigliata_hidden_token_ids_by_background';
const GRIGLIATA_SHARE_INTERACTIONS_FIELD = 'grigliata_share_interactions';
const GRIGLIATA_CUSTOM_TOKEN_DELETE_FUNCTION = 'deleteGrigliataCustomToken';
const GRIGLIATA_CUSTOM_TOKEN_SPAWN_FUNCTION = 'spawnGrigliataCustomTokenInstance';
const GRIGLIATA_CUSTOM_TOKEN_UPDATE_FUNCTION = 'updateGrigliataCustomTokenTemplate';
const GRIGLIATA_SPAWN_FOE_TOKEN_FUNCTION = 'spawnGrigliataFoeToken';

const deleteGrigliataCustomTokenCallable = httpsCallable(functions, GRIGLIATA_CUSTOM_TOKEN_DELETE_FUNCTION);
const spawnGrigliataCustomTokenInstanceCallable = httpsCallable(functions, GRIGLIATA_CUSTOM_TOKEN_SPAWN_FUNCTION);
const spawnGrigliataFoeTokenCallable = httpsCallable(functions, GRIGLIATA_SPAWN_FOE_TOKEN_FUNCTION);
const updateGrigliataCustomTokenTemplateCallable = httpsCallable(functions, GRIGLIATA_CUSTOM_TOKEN_UPDATE_FUNCTION);

const buildHiddenPlacementSettingsPayload = ({
  backgroundId,
  tokenId,
  isHidden,
  includeLegacyBackgroundFallback = false,
}) => ({
  settings: {
    [GRIGLIATA_HIDDEN_TOKEN_IDS_BY_BACKGROUND_FIELD]: {
      [backgroundId]: isHidden
        ? arrayUnion(tokenId)
        : arrayRemove(tokenId),
    },
    ...(includeLegacyBackgroundFallback ? {
      [GRIGLIATA_HIDDEN_BACKGROUND_IDS_FIELD]: isHidden
        ? arrayUnion(backgroundId)
        : arrayRemove(backgroundId),
    } : {}),
  },
});

const isLegacyHiddenPlacementToken = ({ tokenId, ownerUid }) => tokenId === ownerUid;
const isPermissionDeniedError = (error) => (
  error?.code === 'permission-denied'
  || error?.code === 'firestore/permission-denied'
  || error?.code === 'functions/permission-denied'
);
const SIDEBAR_TAB_GRID_CLASS_NAMES = {
  1: 'grid grid-cols-1 gap-2',
  2: 'grid grid-cols-2 gap-2',
  3: 'grid grid-cols-3 gap-2',
  4: 'grid grid-cols-2 gap-2',
  5: 'grid grid-cols-2 gap-2',
};
const DEFAULT_SIDEBAR_TAB_GRID_CLASS_NAME = SIDEBAR_TAB_GRID_CLASS_NAMES[3];
const MAX_DEFERRED_GALLERY_IMAGE_PRELOADS = 6;
const collectUniqueImageUrls = (urls) => [...new Set(
  (urls || []).map((url) => (typeof url === 'string' ? url.trim() : '')).filter(Boolean)
)];
const getBackgroundImageUrlForPreload = (background) => (
  background && !isVideoBackground(background) ? background.imageUrl : ''
);
const getBackgroundUploadAssetType = (file) => {
  const contentType = typeof file?.type === 'string' ? file.type.trim().toLowerCase() : '';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'video/mp4') return 'video';
  return '';
};
const normalizeNumericDraftValue = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};
const normalizeNonNegativeNumericValue = (value, fallback = 0) => (
  Math.max(0, normalizeNumericDraftValue(value, fallback))
);
const normalizeCurrentResourceValue = (value, fallback = 0) => (
  normalizeNonNegativeNumericValue(value, fallback)
);
const areGridConfigsEqual = (leftGrid, rightGrid) => {
  const left = normalizeGridConfig(leftGrid);
  const right = normalizeGridConfig(rightGrid);

  return left.cellSizePx === right.cellSizePx
    && left.offsetXPx === right.offsetXPx
    && left.offsetYPx === right.offsetYPx;
};
const normalizeTokenNotesValue = (value) => (typeof value === 'string' ? value : '');
const resolveCustomTokenRole = (token = {}) => (
  token?.tokenType === 'custom'
    ? (token?.customTokenRole === 'instance' ? 'instance' : 'template')
    : ''
);
const isCustomTokenInstance = (token = {}) => (
  token?.tokenType === 'custom' && resolveCustomTokenRole(token) === 'instance'
);
const hasFiniteOwnNumericField = (value, key) => (
  !!value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.prototype.hasOwnProperty.call(value, key)
  && Number.isFinite(Number(value[key]))
);
const buildMissingResourceTotals = (stats = {}, { hasShield = true } = {}) => ({
  hpTotal: !hasFiniteOwnNumericField(stats, 'hpTotal'),
  manaTotal: !hasFiniteOwnNumericField(stats, 'manaTotal'),
  shieldTotal: hasShield ? !hasFiniteOwnNumericField(stats, 'shieldTotal') : false,
});
const buildEmptySelectedExternalTokenState = () => ({
  tokenId: '',
  ownerUid: '',
  tokenType: '',
  userData: null,
  tokenProfile: null,
  isUserDataReady: false,
  isTokenProfileReady: false,
  userDataError: '',
  tokenProfileError: '',
});
const buildCharacterResourceValues = (stats = {}) => {
  const hpTotal = normalizeNonNegativeNumericValue(stats?.hpTotal, 0);
  const manaTotal = normalizeNonNegativeNumericValue(stats?.manaTotal, 0);
  const shieldTotal = normalizeNonNegativeNumericValue(stats?.barrieraTotal, 0);

  return {
    hpCurrent: normalizeCurrentResourceValue(stats?.hpCurrent, 0),
    hpTotal,
    manaCurrent: normalizeCurrentResourceValue(stats?.manaCurrent, 0),
    manaTotal,
    shieldCurrent: normalizeCurrentResourceValue(stats?.barrieraCurrent ?? stats?.barriera ?? 0, 0),
    shieldTotal,
    hasShield: true,
  };
};
const buildProfileResourceValues = (stats = {}, { hasShield = true } = {}) => {
  const hpTotal = normalizeNonNegativeNumericValue(stats?.hpTotal, 0);
  const manaTotal = normalizeNonNegativeNumericValue(stats?.manaTotal, 0);
  const shieldTotal = normalizeNonNegativeNumericValue(stats?.shieldTotal, 0);

  return {
    hpCurrent: normalizeCurrentResourceValue(stats?.hpCurrent, 0),
    hpTotal,
    manaCurrent: normalizeCurrentResourceValue(stats?.manaCurrent, 0),
    manaTotal,
    shieldCurrent: hasShield ? normalizeCurrentResourceValue(stats?.shieldCurrent, 0) : 0,
    shieldTotal: hasShield ? shieldTotal : 0,
    hasShield,
  };
};
const normalizeFoeParametri = (value, fallback = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  return ['Base', 'Combattimento', 'Special'].reduce((nextParametri, groupKey) => {
    const sourceGroup = source?.[groupKey];
    if (!sourceGroup || typeof sourceGroup !== 'object' || Array.isArray(sourceGroup)) {
      return nextParametri;
    }

    nextParametri[groupKey] = Object.entries(sourceGroup).reduce((nextGroup, [paramKey, paramValue]) => {
      const currentValue = paramValue && typeof paramValue === 'object' && !Array.isArray(paramValue)
        ? paramValue
        : {};

      nextGroup[paramKey] = {
        ...currentValue,
        Tot: normalizeNumericDraftValue(currentValue?.Tot, 0),
      };
      return nextGroup;
    }, {});

    return nextParametri;
  }, {});
};

export default function GrigliataPage() {
  const { user, userData, loading } = useAuth();
  const { topInset } = useShellLayout();
  const currentUserId = user?.uid || '';
  const currentUserEmail = user?.email || '';
  const currentCharacterId = typeof userData?.characterId === 'string' ? userData.characterId.trim() : '';
  const currentImageUrl = typeof userData?.imageUrl === 'string' ? userData.imageUrl.trim() : '';
  const currentImagePath = typeof userData?.imagePath === 'string' ? userData.imagePath.trim() : '';
  const currentTokenLabel = currentCharacterId || currentUserEmail.split('@')[0] || 'Player';
  const persistedDrawColorKey = resolveGrigliataDrawColorKey(userData?.settings?.grigliata_draw_color);
  const persistedInteractionSharingEnabled = userData?.settings?.[GRIGLIATA_SHARE_INTERACTIONS_FIELD] === true;
  const isMusicMuted = userData?.settings?.[GRIGLIATA_MUSIC_MUTED_FIELD] === true;
  const [localLiveInteraction, setLocalLiveInteraction] = useState(null);
  const [isInteractionSharingEnabled, setIsInteractionSharingEnabled] = useState(persistedInteractionSharingEnabled);

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [musicSelectedFile, setMusicSelectedFile] = useState(null);
  const [musicUploadName, setMusicUploadName] = useState('');
  const [musicUploadError, setMusicUploadError] = useState('');
  const [isMusicUploading, setIsMusicUploading] = useState(false);
  const [isMusicMutePending, setIsMusicMutePending] = useState(false);

  const [activatingBackgroundId, setActivatingBackgroundId] = useState('');
  const [narrationActionBackgroundId, setNarrationActionBackgroundId] = useState('');
  const [isNarrationClosePending, setIsNarrationClosePending] = useState(false);
  const [deletingBackgroundId, setDeletingBackgroundId] = useState('');
  const [clearingTokensBackgroundId, setClearingTokensBackgroundId] = useState('');
  const [deletingMusicTrackId, setDeletingMusicTrackId] = useState('');
  const [musicPlaybackActionTrackId, setMusicPlaybackActionTrackId] = useState('');
  const [musicPlaybackActionType, setMusicPlaybackActionType] = useState('');
  const [calibrationDraft, setCalibrationDraft] = useState(DEFAULT_GRID);
  const [calibrationError, setCalibrationError] = useState('');
  const [isSavingCalibration, setIsSavingCalibration] = useState(false);
  const [lightingSelectedFile, setLightingSelectedFile] = useState(null);
  const [lightingImportDraft, setLightingImportDraft] = useState(null);
  const [lightingImportError, setLightingImportError] = useState('');
  const [isImportingLighting, setIsImportingLighting] = useState(false);
  const [isApplyingLightingCalibration, setIsApplyingLightingCalibration] = useState(false);
  const [isLightingEnabledPending, setIsLightingEnabledPending] = useState(false);
  const [isFogOfWarEnabledPending, setIsFogOfWarEnabledPending] = useState(false);
  const [isFogResetPending, setIsFogResetPending] = useState(false);
  const [isLightingDebugOverlayVisible, setIsLightingDebugOverlayVisible] = useState(true);
  const [boardError, setBoardError] = useState('');
  const [activeTrayDragType, setActiveTrayDragType] = useState('');
  const [isRulerEnabled, setIsRulerEnabled] = useState(false);
  const [activeAoeFigureType, setActiveAoeFigureType] = useState('');
  const [drawColorKey, setDrawColorKey] = useState(persistedDrawColorKey);
  const [activeGridSizeOverride, setActiveGridSizeOverride] = useState(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState('tokens');
  const legacyCleanupStartedRef = useRef(false);
  const legacyPlacementDeadStateCleanupStartedRef = useRef(false);
  const legacyPlacementVisibilityCleanupStartedRef = useRef(false);
  const calibrationSelectionRef = useRef('');
  const drawColorAutosaveTimeoutRef = useRef(null);
  const pendingDrawColorAutosaveRef = useRef(null);
  const activeDrawColorAutosaveRef = useRef(null);
  const latestDrawColorRequestIdRef = useRef(0);
  const latestRequestedDrawColorKeyRef = useRef(persistedDrawColorKey);
  const persistedDrawColorKeyRef = useRef(persistedDrawColorKey);
  const persistedInteractionSharingEnabledRef = useRef(persistedInteractionSharingEnabled);
  const latestRequestedInteractionSharingEnabledRef = useRef(persistedInteractionSharingEnabled);
  const interactionSharingMutationPendingRef = useRef(false);
  const gridSizeAutosaveTimeoutRef = useRef(null);
  const pendingGridSizeAutosaveRef = useRef(null);
  const liveInteractionPublishTimeoutRef = useRef(null);
  const pendingLiveInteractionPublishRef = useRef(null);
  const musicVolumeWriteTimeoutRef = useRef(null);
  const pendingMusicVolumeRef = useRef(null);
  const latestRequestedMusicVolumeRef = useRef(DEFAULT_GRIGLIATA_MUSIC_VOLUME);
  const latestMusicPlaybackStateRef = useRef(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
  const activeLiveInteractionDocIdRef = useRef('');
  const liveInteractionMutationQueueRef = useRef(Promise.resolve());
  const turnOrderRepairPendingRef = useRef(false);
  const narrationActionPendingRef = useRef(false);
  const [gridVisibilityUpdateBackgroundId, setGridVisibilityUpdateBackgroundId] = useState('');
  const [isActiveBackgroundDeactivationPending, setIsActiveBackgroundDeactivationPending] = useState(false);
  const [isTurnOrderResetPending, setIsTurnOrderResetPending] = useState(false);
  const [isTurnOrderProgressPending, setIsTurnOrderProgressPending] = useState(false);
  const [turnOrderActionTokenId, setTurnOrderActionTokenId] = useState('');
  const [savingTurnOrderInitiativeTokenId, setSavingTurnOrderInitiativeTokenId] = useState('');
  const [isTokenVisibilityActionPending, setIsTokenVisibilityActionPending] = useState(false);
  const [isTokenDeadActionPending, setIsTokenDeadActionPending] = useState(false);
  const [isTokenStatusActionPending, setIsTokenStatusActionPending] = useState(false);
  const [isTokenSizeActionPending, setIsTokenSizeActionPending] = useState(false);
  const [isTokenVisionActionPending, setIsTokenVisionActionPending] = useState(false);
  const [isCreatingCustomToken, setIsCreatingCustomToken] = useState(false);
  const [updatingCustomTokenId, setUpdatingCustomTokenId] = useState('');
  const [deletingCustomTokenId, setDeletingCustomTokenId] = useState('');
  const [selectedBoardTokenIds, setSelectedBoardTokenIds] = useState([]);
  const [savingFoeTokenId, setSavingFoeTokenId] = useState('');
  const [selectedExternalTokenState, setSelectedExternalTokenState] = useState(() => buildEmptySelectedExternalTokenState());
  const [savingSelectedTokenDetailsId, setSavingSelectedTokenDetailsId] = useState('');
  const isTrayDragging = !!activeTrayDragType;

  const role = (userData?.role || '').toLowerCase();
  const isManager = isManagerRole(role);
  const currentUserHiddenBackgroundIds = useMemo(() => {
    const hiddenBackgroundIds = userData?.settings?.[GRIGLIATA_HIDDEN_BACKGROUND_IDS_FIELD];
    return Array.isArray(hiddenBackgroundIds)
      ? hiddenBackgroundIds.filter((backgroundId) => typeof backgroundId === 'string' && backgroundId)
      : [];
  }, [userData]);
  const currentUserHiddenTokenIdsByBackground = useMemo(() => {
    const hiddenTokenIdsByBackground = userData?.settings?.[GRIGLIATA_HIDDEN_TOKEN_IDS_BY_BACKGROUND_FIELD];

    if (!hiddenTokenIdsByBackground || typeof hiddenTokenIdsByBackground !== 'object' || Array.isArray(hiddenTokenIdsByBackground)) {
      return {};
    }

    return Object.entries(hiddenTokenIdsByBackground).reduce((nextMap, [backgroundId, tokenIds]) => {
      if (typeof backgroundId !== 'string' || !backgroundId) {
        return nextMap;
      }

      const normalizedTokenIds = [...new Set(
        (Array.isArray(tokenIds) ? tokenIds : [])
          .filter((tokenId) => typeof tokenId === 'string' && tokenId)
      )];

      if (normalizedTokenIds.length) {
        nextMap[backgroundId] = normalizedTokenIds;
      }

      return nextMap;
    }, {});
  }, [userData]);
  const {
    activeBackground: combatBackground,
    activeBackgroundId,
    activePageViewers,
    activePlacementsById,
    aoeFigureSnapshots,
    backgrounds,
    boardState,
    boardTokens,
    currentUserToken,
    currentUserTokenProfileDoc,
    customUserTokens,
    displayBackground,
    foeLibrary,
    grid,
    isActivePlacementsReady,
    isCurrentUserTokenHiddenOnActiveMap,
    isGridVisible,
    isTurnOrderEnabled,
    isTurnOrderStarted,
    activeTurnEntry,
    activeTurnTokenId,
    musicPlaybackState,
    musicTracks,
    persistedActiveGrid,
    presentationBackground,
    presentationBackgroundId,
    selectedBackground,
    selectedBackgroundId,
    setSelectedBackgroundId,
    sharedInteractions,
    tokenProfilesByTokenId,
    turnOrderEntries,
  } = useGrigliataPageData({
    activeGridSizeOverride,
    currentCharacterId,
    currentImagePath,
    currentImageUrl,
    currentTokenLabel,
    currentUserHiddenBackgroundIds,
    currentUserHiddenTokenIdsByBackground,
    currentUserId,
    isManager,
  });
  const {
    lightingMetadata,
  } = useGrigliataLightingMetadata({
    backgroundId: activeBackgroundId,
    currentUserId,
    isManager,
  });
  const {
    lightingRenderInput,
  } = useGrigliataLightingRenderInput({
    backgroundId: activeBackgroundId,
    currentUserId,
  });
  const {
    fogOfWar,
  } = useGrigliataFogOfWar({
    backgroundId: activeBackgroundId,
    currentUserId,
    isManager,
  });
  const dmPreviewLightingRenderInput = useMemo(() => {
    if (lightingRenderInput) {
      return lightingRenderInput;
    }

    if (!isManager || !lightingMetadata) {
      return null;
    }

    try {
      return buildGrigliataLightingRenderInput(lightingMetadata, {
        updatedAt: lightingMetadata.updatedAt || null,
        updatedBy: lightingMetadata.updatedBy || '',
      });
    } catch (error) {
      console.error('Failed to build DM lighting preview input:', error);
      return null;
    }
  }, [isManager, lightingMetadata, lightingRenderInput]);
  const enabledLightingRenderInput = combatBackground?.lightingEnabled === false
    ? null
    : dmPreviewLightingRenderInput;

  useEffect(() => {
    if (!currentUserId || isManager || !currentCharacterId) {
      return undefined;
    }

    const presenceDocRef = doc(db, GRIGLIATA_PAGE_PRESENCE_COLLECTION, currentUserId);
    let isActive = true;

    const writePresenceHeartbeat = async () => {
      try {
        await setDoc(presenceDocRef, {
          ownerUid: currentUserId,
          characterId: currentCharacterId,
          colorKey: drawColorKey,
          lastSeenAt: serverTimestamp(),
          updatedBy: currentUserId,
        }, { merge: true });
      } catch (error) {
        if (isActive) {
          console.error('Failed to update Grigliata page presence:', error);
        }
      }
    };

    void writePresenceHeartbeat();
    const intervalId = window.setInterval(writePresenceHeartbeat, GRIGLIATA_PAGE_PRESENCE_HEARTBEAT_MS);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
      void deleteDoc(presenceDocRef).catch((error) => {
        console.error('Failed to clear Grigliata page presence:', error);
      });
    };
  }, [currentCharacterId, currentUserId, drawColorKey, isManager]);

  const ownedTrayTokensById = useMemo(() => new Map(
    [currentUserToken, ...customUserTokens]
      .filter((token) => token?.tokenId && token?.ownerUid === currentUserId)
      .map((token) => [token.tokenId, token])
  ), [currentUserId, currentUserToken, customUserTokens]);
  const {
    buildPlacementWritePayload,
    buildTurnOrderRemovalPlacementWrite,
    getActiveMapPlacementContexts,
    canCurrentUserManageTurnOrderPlacement,
    upsertTokenPlacement,
    commitPlacementMoves,
    deleteActiveMapPlacements,
    setSelectedTokensVisibility,
    setSelectedTokensDeadState,
    updateTokenStatuses,
    setSelectedTokenSize,
    setSelectedTokenVision,
  } = useGrigliataPlacementActions({
    activeBackgroundId,
    activePlacementsById,
    currentUserId,
    isManager,
    ownedTrayTokensById,
    buildHiddenPlacementSettingsPayload,
    isLegacyHiddenPlacementToken,
    isCustomTokenInstance,
    deleteCustomToken: deleteGrigliataCustomTokenCallable,
    placementRuleSafeBatchSize: PLACEMENT_RULE_SAFE_BATCH_SIZE,
    placementAndUserSettingsBatchSize: PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE,
    placementDeleteBatchSize: PLACEMENT_DELETE_BATCH_SIZE,
  });
  const boardTokensById = useMemo(() => new Map(
    boardTokens
      .filter((token) => token?.tokenId)
      .map((token) => [token.tokenId, token])
  ), [boardTokens]);
  const selectedBoardTokens = useMemo(
    () => selectedBoardTokenIds
      .map((tokenId) => boardTokensById.get(tokenId))
      .filter(Boolean),
    [boardTokensById, selectedBoardTokenIds]
  );
  const selectedBoardToken = selectedBoardTokens.length === 1 ? selectedBoardTokens[0] : null;
  const selectedBoardTokenId = selectedBoardToken?.tokenId || '';
  const activeTurnCursor = combatBackground?.turnOrderActive && typeof combatBackground.turnOrderActive === 'object'
    ? combatBackground.turnOrderActive
    : null;
  const isNarrationOverlayActive = !!(
    presentationBackgroundId
    && presentationBackground
    && presentationBackground.id === presentationBackgroundId
  );
  const isCombatMapChangeLocked = isNarrationOverlayActive || isTurnOrderStarted;
  const isNarrationActionPending = !!narrationActionBackgroundId;
  const destructiveGalleryLockBackgroundIds = useMemo(() => backgrounds.reduce((lockedBackgroundIds, background) => {
    if (!background?.id) {
      return lockedBackgroundIds;
    }

    const hasActiveTurnOrderCursor = !!(
      background.turnOrderActive
      && typeof background.turnOrderActive === 'object'
    );
    const isLockedActiveCombatMap = background.id === activeBackgroundId && isCombatMapChangeLocked;
    if (isLockedActiveCombatMap || hasActiveTurnOrderCursor) {
      lockedBackgroundIds.push(background.id);
    }

    return lockedBackgroundIds;
  }, []), [activeBackgroundId, backgrounds, isCombatMapChangeLocked]);

  useEffect(() => {
    if (!isManager || !user?.uid || !presentationBackgroundId || presentationBackground || backgrounds.length < 1) {
      return;
    }

    void setDoc(doc(db, 'grigliata_state', 'current'), {
      presentationBackgroundId: '',
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }, { merge: true });
  }, [
    backgrounds.length,
    isManager,
    presentationBackground,
    presentationBackgroundId,
    user?.uid,
  ]);

  useEffect(() => {
    if (!isManager || !selectedBoardToken) {
      setSelectedExternalTokenState(buildEmptySelectedExternalTokenState());
      return undefined;
    }

    const isOwnedByCurrentUser = (
      selectedBoardToken.ownerUid === currentUserId
      || selectedBoardToken.tokenId === currentUserId
    );
    const tokenType = selectedBoardToken.tokenType || 'character';
    if (isOwnedByCurrentUser || tokenType === 'foe') {
      setSelectedExternalTokenState(buildEmptySelectedExternalTokenState());
      return undefined;
    }

    const nextSelectionState = {
      tokenId: selectedBoardToken.tokenId || '',
      ownerUid: selectedBoardToken.ownerUid || '',
      tokenType,
      userData: null,
      tokenProfile: null,
      isUserDataReady: tokenType !== 'character',
      isTokenProfileReady: false,
      userDataError: '',
      tokenProfileError: '',
    };
    setSelectedExternalTokenState(nextSelectionState);

    let isActive = true;
    const unsubscribes = [];

    const updateSelectedExternalTokenState = (updater) => {
      if (!isActive) {
        return;
      }

      setSelectedExternalTokenState((currentState) => {
        if (
          currentState.tokenId !== nextSelectionState.tokenId
          || currentState.ownerUid !== nextSelectionState.ownerUid
          || currentState.tokenType !== nextSelectionState.tokenType
        ) {
          return currentState;
        }

        return updater(currentState);
      });
    };

    if (tokenType === 'character' && nextSelectionState.ownerUid) {
      unsubscribes.push(onSnapshot(
        doc(db, 'users', nextSelectionState.ownerUid),
        (snapshot) => {
          updateSelectedExternalTokenState((currentState) => ({
            ...currentState,
            userData: snapshot.exists() ? snapshot.data() : null,
            isUserDataReady: true,
            userDataError: '',
          }));
        },
        (error) => {
          console.error('Failed to subscribe to selected Grigliata character user data:', error);
          updateSelectedExternalTokenState((currentState) => ({
            ...currentState,
            userData: null,
            isUserDataReady: false,
            userDataError: 'Unable to load the current character sheet values.',
          }));
        }
      ));
    }

    if (tokenType === 'character' || tokenType === 'custom') {
      unsubscribes.push(onSnapshot(
        doc(db, 'grigliata_tokens', nextSelectionState.tokenId),
        (snapshot) => {
          updateSelectedExternalTokenState((currentState) => ({
            ...currentState,
            tokenProfile: snapshot.exists() ? {
              id: snapshot.id,
              ...snapshot.data(),
            } : null,
            isTokenProfileReady: true,
            tokenProfileError: '',
          }));
        },
        (error) => {
          console.error('Failed to subscribe to selected Grigliata token profile:', error);
          updateSelectedExternalTokenState((currentState) => ({
            ...currentState,
            tokenProfile: null,
            isTokenProfileReady: false,
            tokenProfileError: 'Unable to load the current token profile.',
          }));
        }
      ));
    }

    return () => {
      isActive = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [currentUserId, isManager, selectedBoardToken]);

  const selectedTokenDetails = useMemo(() => {
    if (!selectedBoardToken) {
      return null;
    }

    const tokenType = selectedBoardToken.tokenType || 'character';
    const isOwnedByCurrentUser = (
      selectedBoardToken.ownerUid === currentUserId
      || selectedBoardToken.tokenId === currentUserId
    );
    const isExternalSelection = !isOwnedByCurrentUser && tokenType !== 'foe';
    const externalSelectionState = isExternalSelection
      && selectedExternalTokenState.tokenId === selectedBoardToken.tokenId
      && selectedExternalTokenState.ownerUid === (selectedBoardToken.ownerUid || '')
      && selectedExternalTokenState.tokenType === tokenType
      ? selectedExternalTokenState
      : null;
    const isSelectedExternalTokenReady = !isExternalSelection || (
      !!externalSelectionState
      && externalSelectionState.isTokenProfileReady
      && (tokenType !== 'character' || externalSelectionState.isUserDataReady)
    );
    const selectedExternalUserData = externalSelectionState?.userData || null;
    const selectedExternalTokenProfile = externalSelectionState?.tokenProfile || null;
    const selectedTokenLoadingMessage = externalSelectionState?.userDataError
      || externalSelectionState?.tokenProfileError
      || (tokenType === 'custom'
        ? 'Loading the current token values...'
        : 'Loading the current character sheet values...');

    if (tokenType === 'foe' && !isManager) {
      return null;
    }

    if (tokenType !== 'foe' && !isManager && !isOwnedByCurrentUser) {
      return null;
    }

    const localTokenProfile = tokenProfilesByTokenId.get(selectedBoardToken.tokenId) || null;
    const tokenProfile = isOwnedByCurrentUser ? localTokenProfile : selectedExternalTokenProfile;
    const profileLabel = typeof tokenProfile?.label === 'string' ? tokenProfile.label.trim() : '';
    const resolvedImageUrl = tokenProfile?.imageUrl || selectedBoardToken.imageUrl || '';
    const resolvedImagePath = tokenProfile?.imagePath || '';
    const resolvedNotes = normalizeTokenNotesValue(tokenProfile?.notes);

    if (tokenType === 'foe') {
      const foeStats = tokenProfile?.stats || {};
      const resourceValues = buildProfileResourceValues(foeStats, { hasShield: false });
      return {
        ...(tokenProfile || {}),
        ...selectedBoardToken,
        isReady: true,
        tokenType: 'foe',
        label: profileLabel || selectedBoardToken.label || 'Foe',
        imageUrl: resolvedImageUrl,
        imagePath: resolvedImagePath,
        category: tokenProfile?.category || '',
        rank: tokenProfile?.rank || '',
        dadoAnima: tokenProfile?.dadoAnima || '',
        notes: resolvedNotes,
        foeSourceId: tokenProfile?.foeSourceId || '',
        stats: foeStats,
        Parametri: tokenProfile?.Parametri || {},
        spells: Array.isArray(tokenProfile?.spells) ? tokenProfile.spells : [],
        tecniche: Array.isArray(tokenProfile?.tecniche) ? tokenProfile.tecniche : [],
        ...resourceValues,
      };
    }

    if (tokenType === 'character') {
      const userSource = isOwnedByCurrentUser ? userData : selectedExternalUserData;
      const resourceValues = buildCharacterResourceValues(userSource?.stats || {});
      return {
        ...(tokenProfile || {}),
        ...selectedBoardToken,
        isReady: isSelectedExternalTokenReady,
        loadingMessage: isSelectedExternalTokenReady ? '' : selectedTokenLoadingMessage,
        tokenType: 'character',
        ownerUid: selectedBoardToken.ownerUid || selectedBoardToken.tokenId,
        tokenId: selectedBoardToken.tokenId,
        characterId: tokenProfile?.characterId || selectedBoardToken.characterId || userSource?.characterId || '',
        label: profileLabel || selectedBoardToken.label || userSource?.characterId || 'Character',
        imageUrl: resolvedImageUrl,
        imagePath: resolvedImagePath,
        notes: resolvedNotes,
        stats: {
          hpCurrent: resourceValues.hpCurrent,
          hpTotal: resourceValues.hpTotal,
          manaCurrent: resourceValues.manaCurrent,
          manaTotal: resourceValues.manaTotal,
          shieldCurrent: resourceValues.shieldCurrent,
          shieldTotal: resourceValues.shieldTotal,
        },
        ...resourceValues,
      };
    }

    const customStats = tokenProfile?.stats || {};
    const resourceValues = buildProfileResourceValues(customStats, { hasShield: true });
    const missingResourceTotals = buildMissingResourceTotals(customStats, { hasShield: true });
    return {
      ...(tokenProfile || {}),
      ...selectedBoardToken,
      isReady: isSelectedExternalTokenReady,
      loadingMessage: isSelectedExternalTokenReady ? '' : selectedTokenLoadingMessage,
      tokenType: 'custom',
      ownerUid: selectedBoardToken.ownerUid,
      tokenId: selectedBoardToken.tokenId,
      label: profileLabel || selectedBoardToken.label || 'Custom Token',
      imageUrl: resolvedImageUrl,
      imagePath: resolvedImagePath,
      notes: resolvedNotes,
      stats: customStats,
      missingResourceTotals,
      ...resourceValues,
    };
  }, [
    currentUserId,
    isManager,
    selectedBoardToken,
    selectedExternalTokenState,
    tokenProfilesByTokenId,
    userData,
  ]);
  const trayCurrentUserToken = isManager ? null : currentUserToken;
  useEffect(() => {
    setSelectedBoardTokenIds([]);
  }, [activeBackgroundId, isNarrationOverlayActive]);
  const drawTheme = useMemo(
    () => getGrigliataDrawTheme(drawColorKey),
    [drawColorKey]
  );
  const visibleBoardTokens = useMemo(
    () => (isNarrationOverlayActive ? [] : boardTokens),
    [boardTokens, isNarrationOverlayActive]
  );
  const visibleAoeFigures = useMemo(
    () => (isNarrationOverlayActive ? [] : aoeFigureSnapshots),
    [aoeFigureSnapshots, isNarrationOverlayActive]
  );
  const visibleSharedInteractions = useMemo(
    () => (isNarrationOverlayActive ? [] : sharedInteractions),
    [isNarrationOverlayActive, sharedInteractions]
  );
  const isFogOfWarEnabled = combatBackground?.fogOfWarEnabled !== false;
  const fogLightingRenderInput = isFogOfWarEnabled ? dmPreviewLightingRenderInput : null;
  const normalizedFogGrid = useMemo(
    () => normalizeGridConfig(grid),
    [grid]
  );
  const {
    currentVisibleCells: fogCurrentVisibleCells,
  } = useGrigliataFogOfWarPersistence({
    backgroundId: activeBackgroundId,
    currentUserId,
    isManager,
    grid: normalizedFogGrid,
    tokens: visibleBoardTokens,
    lightingRenderInput: fogLightingRenderInput,
    fogOfWar,
    isEnabled: isFogOfWarEnabled && !isNarrationOverlayActive,
  });
  const boardFogOfWar = useMemo(() => {
    if (
      isManager
      || isNarrationOverlayActive
      || !isFogOfWarEnabled
      || !fogLightingRenderInput
    ) {
      return null;
    }

    return {
      exploredCells: fogOfWar?.cellSizePx === normalizedFogGrid.cellSizePx
        ? fogOfWar.exploredCells
        : [],
      currentVisibleCells: fogCurrentVisibleCells,
    };
  }, [
    fogCurrentVisibleCells,
    fogLightingRenderInput,
    fogOfWar,
    isFogOfWarEnabled,
    isManager,
    isNarrationOverlayActive,
    normalizedFogGrid.cellSizePx,
  ]);
  const normalizedMusicPlaybackState = useMemo(
    () => normalizeGrigliataMusicPlaybackState(musicPlaybackState),
    [musicPlaybackState]
  );

  useEffect(() => {
    latestMusicPlaybackStateRef.current = normalizedMusicPlaybackState;

    if (pendingMusicVolumeRef.current !== null) {
      if (normalizedMusicPlaybackState.volume === pendingMusicVolumeRef.current) {
        pendingMusicVolumeRef.current = null;
      } else {
        return;
      }
    }

    latestRequestedMusicVolumeRef.current = normalizedMusicPlaybackState.volume;
  }, [normalizedMusicPlaybackState]);
  const sidebarTabs = useMemo(() => (
    isManager
      ? [
        { key: 'tokens', label: 'Tokens' },
        { key: 'gallery', label: 'DM Gallery' },
        { key: 'music', label: 'Music' },
        { key: 'calibration', label: 'Map Calibration' },
        { key: 'lighting', label: 'Lighting' },
      ]
      : [{ key: 'tokens', label: 'Tokens' }]
  ), [isManager]);
  const sidebarTabListClassName = SIDEBAR_TAB_GRID_CLASS_NAMES[sidebarTabs.length]
    || DEFAULT_SIDEBAR_TAB_GRID_CLASS_NAME;
  const isGallerySidebarActive = isManager && activeSidebarTab === 'gallery';
  const immediateImageUrls = useMemo(() => collectUniqueImageUrls([
    getBackgroundImageUrlForPreload(combatBackground),
    getBackgroundImageUrlForPreload(displayBackground),
    currentUserToken?.imageUrl,
    ...customUserTokens.map((token) => token?.imageUrl),
    ...boardTokens.map((token) => token?.imageUrl),
  ]), [
    boardTokens,
    combatBackground,
    currentUserToken?.imageUrl,
    customUserTokens,
    displayBackground,
  ]);
  const deferredGalleryImageUrls = useMemo(() => {
    if (!isGallerySidebarActive) {
      return [];
    }

    const immediateImageUrlSet = new Set(immediateImageUrls);
    return collectUniqueImageUrls(
      backgrounds
        .map(getBackgroundImageUrlForPreload)
        .filter((imageUrl) => !immediateImageUrlSet.has(imageUrl))
        .slice(0, MAX_DEFERRED_GALLERY_IMAGE_PRELOADS)
    );
  }, [backgrounds, immediateImageUrls, isGallerySidebarActive]);

  const runPaginatedWriteBatch = useCallback(async ({
    collectionName,
    baseConstraints,
    applyDocument,
    pageSize = FIRESTORE_BATCH_SIZE,
    useCursor = true,
  }) => {
    let cursor = null;

    while (true) {
      const pageConstraints = cursor && useCursor
        ? [...baseConstraints, startAfter(cursor)]
        : baseConstraints;
      const snapshot = await getDocs(query(collection(db, collectionName), ...pageConstraints));

      if (snapshot.empty) {
        return;
      }

      const batch = writeBatch(db);
      let pendingWriteCount = 0;

      for (const docSnap of snapshot.docs) {
        pendingWriteCount += applyDocument({ batch, docSnap }) || 0;
      }

      if (pendingWriteCount > 0) {
        await batch.commit();
      }

      if (snapshot.size < pageSize) {
        return;
      }

      if (!useCursor) {
        continue;
      }

      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
  }, []);

  useEffect(() => {
    persistedDrawColorKeyRef.current = persistedDrawColorKey;

    const hasPendingDrawColorSave = !!pendingDrawColorAutosaveRef.current || !!activeDrawColorAutosaveRef.current;
    if (hasPendingDrawColorSave && persistedDrawColorKey !== latestRequestedDrawColorKeyRef.current) {
      return;
    }

    latestRequestedDrawColorKeyRef.current = persistedDrawColorKey;
    setDrawColorKey(persistedDrawColorKey);
  }, [persistedDrawColorKey]);

  useEffect(() => {
    persistedInteractionSharingEnabledRef.current = persistedInteractionSharingEnabled;

    if (
      interactionSharingMutationPendingRef.current
      && persistedInteractionSharingEnabled !== latestRequestedInteractionSharingEnabledRef.current
    ) {
      return;
    }

    latestRequestedInteractionSharingEnabledRef.current = persistedInteractionSharingEnabled;
    setIsInteractionSharingEnabled(persistedInteractionSharingEnabled);
  }, [persistedInteractionSharingEnabled]);

  useEffect(() => {
    if (sidebarTabs.some((tab) => tab.key === activeSidebarTab)) return;
    setActiveSidebarTab(sidebarTabs[0].key);
  }, [activeSidebarTab, sidebarTabs]);

  useEffect(() => {
    if (!isNarrationOverlayActive) {
      return;
    }

    setActiveTrayDragType('');
    setActiveAoeFigureType('');
    setIsRulerEnabled(false);
    setSelectedBoardTokenIds([]);
    setLocalLiveInteraction(null);
  }, [isNarrationOverlayActive]);

  useEffect(() => {
    if (!immediateImageUrls.length) {
      return undefined;
    }

    preloadImageAssets(immediateImageUrls);
    return undefined;
  }, [immediateImageUrls]);

  useEffect(() => {
    if (!deferredGalleryImageUrls.length) {
      return undefined;
    }

    return scheduleImageAssetPreload(deferredGalleryImageUrls);
  }, [deferredGalleryImageUrls]);

  useEffect(() => {
    setLocalLiveInteraction(null);
  }, [activeBackgroundId]);

  useEffect(() => {
    setIsLightingDebugOverlayVisible(true);
  }, [activeBackgroundId]);

  useEffect(() => {
    const nextCalibrationBackgroundId = selectedBackground?.id || '';
    if (calibrationSelectionRef.current === nextCalibrationBackgroundId) return;

    calibrationSelectionRef.current = nextCalibrationBackgroundId;
    setCalibrationDraft(normalizeGridConfig(selectedBackground?.grid));
    setCalibrationError('');
  }, [selectedBackground?.grid, selectedBackground?.id]);

  useEffect(() => {
    setLightingSelectedFile(null);
    setLightingImportDraft(null);
    setLightingImportError('');
  }, [selectedBackgroundId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    let isActive = true;

    const syncCurrentUserTokenProfile = async () => {
      const existingToken = currentUserTokenProfileDoc;
      const hasLegacyPlacementFields = !!(
        existingToken
        && (
          Object.prototype.hasOwnProperty.call(existingToken, 'placed')
          || Object.prototype.hasOwnProperty.call(existingToken, 'col')
          || Object.prototype.hasOwnProperty.call(existingToken, 'row')
        )
      );

      if (!currentImageUrl && !existingToken) {
        return;
      }

      const needsSync = !existingToken
        || existingToken.ownerUid !== currentUserId
        || existingToken.characterId !== currentCharacterId
        || existingToken.label !== currentTokenLabel
        || existingToken.imageUrl !== currentImageUrl
        || existingToken.imagePath !== currentImagePath
        || hasLegacyPlacementFields;

      if (!needsSync || !isActive) return;

      try {
        const tokenProfilePayload = {
          ownerUid: currentUserId,
          characterId: currentCharacterId,
          label: currentTokenLabel,
          imageUrl: currentImageUrl,
          imagePath: currentImagePath,
          tokenType: 'character',
          imageSource: 'profile',
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId,
        };

        if (existingToken || hasLegacyPlacementFields) {
          tokenProfilePayload.placed = deleteField();
          tokenProfilePayload.col = deleteField();
          tokenProfilePayload.row = deleteField();
        }

        await setDoc(doc(db, 'grigliata_tokens', currentUserId), tokenProfilePayload, { merge: true });
      } catch (error) {
        console.error('Failed to sync current user token profile:', error);
      }
    };

    syncCurrentUserTokenProfile();

    return () => {
      isActive = false;
    };
  }, [
    currentCharacterId,
    currentImagePath,
    currentImageUrl,
    currentTokenLabel,
    currentUserId,
    currentUserTokenProfileDoc,
  ]);

  const legacyCleanupCompletedAt = boardState?.[LEGACY_TOKEN_CLEANUP_FIELD];
  const legacyPlacementDeadStateCleanupCompletedAt = boardState?.[LEGACY_PLACEMENT_DEAD_STATE_CLEANUP_FIELD];
  const legacyPlacementVisibilityCleanupCompletedAt = boardState?.[LEGACY_PLACEMENT_VISIBILITY_CLEANUP_FIELD];

  useEffect(() => {
    if (!currentUserId || !isManager) return undefined;
    if (legacyCleanupCompletedAt || legacyCleanupStartedRef.current) return undefined;

    let cancelled = false;
    legacyCleanupStartedRef.current = true;

    const runLegacyCleanup = async () => {
      try {
        await runPaginatedWriteBatch({
          collectionName: 'grigliata_tokens',
          baseConstraints: [
            orderBy(documentId()),
            limit(FIRESTORE_BATCH_SIZE),
          ],
          applyDocument: ({ batch, docSnap }) => {
            batch.set(docSnap.ref, {
              placed: deleteField(),
              col: deleteField(),
              row: deleteField(),
              updatedAt: serverTimestamp(),
              updatedBy: currentUserId || null,
            }, { merge: true });
            return 1;
          },
        });

        if (cancelled) return;

        await setDoc(doc(db, 'grigliata_state', 'current'), {
          [LEGACY_TOKEN_CLEANUP_FIELD]: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId,
        }, { merge: true });
      } catch (error) {
        console.error('Failed to scrub legacy Grigliata token fields:', error);
        if (!cancelled) {
          setBoardError('Unable to finish the legacy token cleanup.');
          legacyCleanupStartedRef.current = false;
        }
      }
    };

    runLegacyCleanup();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, isManager, legacyCleanupCompletedAt, runPaginatedWriteBatch]);

  useEffect(() => {
    if (!currentUserId || !isManager) return undefined;
    if (
      legacyPlacementDeadStateCleanupCompletedAt
      || legacyPlacementDeadStateCleanupStartedRef.current
    ) {
      return undefined;
    }

    let cancelled = false;
    legacyPlacementDeadStateCleanupStartedRef.current = true;

    const runPlacementDeadStateCleanup = async () => {
      try {
        await runPaginatedWriteBatch({
          collectionName: 'grigliata_token_placements',
          baseConstraints: [
            orderBy(documentId()),
            limit(PLACEMENT_RULE_SAFE_BATCH_SIZE),
          ],
          pageSize: PLACEMENT_RULE_SAFE_BATCH_SIZE,
          applyDocument: ({ batch, docSnap }) => {
            const placement = docSnap.data();
            if (placement?.isDead === true || placement?.isDead === false) {
              return 0;
            }

            const tokenId = typeof placement?.tokenId === 'string' && placement.tokenId
              ? placement.tokenId
              : placement?.ownerUid || '';

            if (!tokenId) {
              return 0;
            }

            batch.set(docSnap.ref, {
              tokenId,
              isDead: false,
              updatedAt: serverTimestamp(),
              updatedBy: currentUserId || null,
            }, { merge: true });
            return 1;
          },
        });

        if (cancelled) return;

        await setDoc(doc(db, 'grigliata_state', 'current'), {
          [LEGACY_PLACEMENT_DEAD_STATE_CLEANUP_FIELD]: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId,
        }, { merge: true });
      } catch (error) {
        console.error('Failed to backfill Grigliata placement dead state:', error);
        if (!cancelled) {
          setBoardError('Unable to finish the Grigliata dead-state cleanup.');
          legacyPlacementDeadStateCleanupStartedRef.current = false;
        }
      }
    };

    runPlacementDeadStateCleanup();

    return () => {
      cancelled = true;
    };
  }, [
    currentUserId,
    isManager,
    legacyPlacementDeadStateCleanupCompletedAt,
    runPaginatedWriteBatch,
  ]);

  useEffect(() => {
    if (!currentUserId || !isManager) return undefined;
    if (!legacyPlacementDeadStateCleanupCompletedAt) return undefined;
    if (legacyPlacementVisibilityCleanupCompletedAt || legacyPlacementVisibilityCleanupStartedRef.current) {
      return undefined;
    }

    let cancelled = false;
    legacyPlacementVisibilityCleanupStartedRef.current = true;

    const runPlacementVisibilityCleanup = async () => {
      try {
        await runPaginatedWriteBatch({
          collectionName: 'grigliata_token_placements',
          baseConstraints: [
            orderBy(documentId()),
            limit(PLACEMENT_RULE_SAFE_BATCH_SIZE),
          ],
          pageSize: PLACEMENT_RULE_SAFE_BATCH_SIZE,
          applyDocument: ({ batch, docSnap }) => {
            const placement = docSnap.data();
            if (placement?.isVisibleToPlayers === true || placement?.isVisibleToPlayers === false) {
              return 0;
            }

            const tokenId = typeof placement?.tokenId === 'string' && placement.tokenId
              ? placement.tokenId
              : placement?.ownerUid || '';

            if (!tokenId) {
              return 0;
            }

            batch.set(docSnap.ref, {
              tokenId,
              isVisibleToPlayers: true,
              updatedAt: serverTimestamp(),
              updatedBy: currentUserId || null,
            }, { merge: true });
            return 1;
          },
        });

        if (cancelled) return;

        await setDoc(doc(db, 'grigliata_state', 'current'), {
          [LEGACY_PLACEMENT_VISIBILITY_CLEANUP_FIELD]: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId,
        }, { merge: true });
      } catch (error) {
        console.error('Failed to backfill Grigliata placement visibility:', error);
        if (!cancelled) {
          setBoardError('Unable to finish the Grigliata visibility cleanup.');
          legacyPlacementVisibilityCleanupStartedRef.current = false;
        }
      }
    };

    runPlacementVisibilityCleanup();

    return () => {
      cancelled = true;
    };
  }, [
    currentUserId,
    isManager,
    legacyPlacementDeadStateCleanupCompletedAt,
    legacyPlacementVisibilityCleanupCompletedAt,
    runPaginatedWriteBatch,
  ]);

  const workspaceHeight = topInset
    ? `calc(100vh - ${topInset}px)`
    : '100vh';

  const clearDrawColorAutosaveTimer = useCallback(() => {
    if (!drawColorAutosaveTimeoutRef.current) return;

    window.clearTimeout(drawColorAutosaveTimeoutRef.current);
    drawColorAutosaveTimeoutRef.current = null;
  }, []);

  const persistPendingDrawColorAutosave = useCallback(async () => {
    if (activeDrawColorAutosaveRef.current || !currentUserId) return;

    const saveRequest = pendingDrawColorAutosaveRef.current;
    if (!saveRequest?.colorKey) return;

    pendingDrawColorAutosaveRef.current = null;
    activeDrawColorAutosaveRef.current = saveRequest;

    try {
      await updateDoc(doc(db, 'users', currentUserId), {
        'settings.grigliata_draw_color': saveRequest.colorKey,
      });
    } catch (error) {
      console.error('Failed to save Grigliata draw color preference:', error);

      const hasNewerPendingRequest = pendingDrawColorAutosaveRef.current?.requestId > saveRequest.requestId;
      const hasNewerRequestedColor = latestRequestedDrawColorKeyRef.current !== saveRequest.colorKey;

      if (!hasNewerPendingRequest && !hasNewerRequestedColor) {
        const fallbackColorKey = persistedDrawColorKeyRef.current;
        latestRequestedDrawColorKeyRef.current = fallbackColorKey;
        setDrawColorKey(fallbackColorKey);
        setBoardError('Unable to save your Grigliata color preference right now.');
      }
    } finally {
      if (activeDrawColorAutosaveRef.current?.requestId === saveRequest.requestId) {
        activeDrawColorAutosaveRef.current = null;
      }

      if (!drawColorAutosaveTimeoutRef.current && pendingDrawColorAutosaveRef.current) {
        void persistPendingDrawColorAutosave();
      }
    }
  }, [currentUserId]);

  const flushPendingDrawColorAutosave = useCallback(async () => {
    clearDrawColorAutosaveTimer();
    await persistPendingDrawColorAutosave();
  }, [clearDrawColorAutosaveTimer, persistPendingDrawColorAutosave]);

  const scheduleDrawColorAutosave = useCallback((saveRequest) => {
    pendingDrawColorAutosaveRef.current = saveRequest;
    clearDrawColorAutosaveTimer();

    drawColorAutosaveTimeoutRef.current = window.setTimeout(() => {
      drawColorAutosaveTimeoutRef.current = null;
      void persistPendingDrawColorAutosave();
    }, DRAW_COLOR_AUTOSAVE_DEBOUNCE_MS);
  }, [clearDrawColorAutosaveTimer, persistPendingDrawColorAutosave]);

  const clearGridSizeAutosaveTimer = useCallback(() => {
    if (!gridSizeAutosaveTimeoutRef.current) return;

    window.clearTimeout(gridSizeAutosaveTimeoutRef.current);
    gridSizeAutosaveTimeoutRef.current = null;
  }, []);

  const cancelPendingGridSizeAutosave = useCallback((backgroundId = '') => {
    const pendingSave = pendingGridSizeAutosaveRef.current;
    if (!pendingSave) return;
    if (backgroundId && pendingSave.backgroundId !== backgroundId) return;

    pendingGridSizeAutosaveRef.current = null;
    clearGridSizeAutosaveTimer();
  }, [clearGridSizeAutosaveTimer]);

  const persistPendingGridSizeAutosave = useCallback(async (saveRequest) => {
    if (!saveRequest?.backgroundId || !Number.isFinite(saveRequest?.cellSizePx)) return;

    try {
      await updateDoc(doc(db, 'grigliata_backgrounds', saveRequest.backgroundId), {
        'grid.cellSizePx': saveRequest.cellSizePx,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId || null,
      });
    } catch (error) {
      console.error('Failed to auto-save the active map square size:', error);
      setBoardError('Unable to auto-save the square size.');

      if (selectedBackgroundId === saveRequest.backgroundId) {
        setCalibrationError('Unable to auto-save the square size.');
        setCalibrationDraft((currentDraft) => normalizeGridConfig({
          ...currentDraft,
          cellSizePx: saveRequest.fallbackCellSizePx,
        }));
      }

      if (activeBackgroundId === saveRequest.backgroundId) {
        setActiveGridSizeOverride(null);
      }
    }
  }, [activeBackgroundId, currentUserId, selectedBackgroundId]);

  const flushPendingGridSizeAutosave = useCallback(async () => {
    clearGridSizeAutosaveTimer();

    const pendingSave = pendingGridSizeAutosaveRef.current;
    pendingGridSizeAutosaveRef.current = null;

    await persistPendingGridSizeAutosave(pendingSave);
  }, [clearGridSizeAutosaveTimer, persistPendingGridSizeAutosave]);

  const scheduleGridSizeAutosave = useCallback((saveRequest) => {
    pendingGridSizeAutosaveRef.current = saveRequest;
    clearGridSizeAutosaveTimer();

    gridSizeAutosaveTimeoutRef.current = window.setTimeout(() => {
      gridSizeAutosaveTimeoutRef.current = null;
      const nextSave = pendingGridSizeAutosaveRef.current;
      pendingGridSizeAutosaveRef.current = null;
      void persistPendingGridSizeAutosave(nextSave);
    }, GRID_SIZE_AUTOSAVE_DEBOUNCE_MS);
  }, [clearGridSizeAutosaveTimer, persistPendingGridSizeAutosave]);

  const syncOwnedAoEFigureVisibility = useCallback(async (nextIsVisibleToPlayers) => {
    if (!currentUserId) return;

    await runPaginatedWriteBatch({
      collectionName: GRIGLIATA_AOE_FIGURE_COLLECTION,
      baseConstraints: [
        where('ownerUid', '==', currentUserId),
        orderBy(documentId()),
        limit(FIRESTORE_BATCH_SIZE),
      ],
      applyDocument: ({ batch, docSnap }) => {
        if (docSnap.data()?.isVisibleToPlayers === nextIsVisibleToPlayers) {
          return 0;
        }

        batch.set(docSnap.ref, {
          isVisibleToPlayers: nextIsVisibleToPlayers,
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId || null,
        }, { merge: true });
        return 1;
      },
    });
  }, [currentUserId, runPaginatedWriteBatch]);

  const persistInteractionSharingPreference = useCallback(async (nextIsEnabled) => {
    if (!currentUserId) return;

    await updateDoc(doc(db, 'users', currentUserId), {
      [`settings.${GRIGLIATA_SHARE_INTERACTIONS_FIELD}`]: nextIsEnabled,
    });
  }, [currentUserId]);

  const handleToggleMusicMuted = useCallback(async () => {
    if (!currentUserId || isMusicMutePending) return;

    setBoardError('');
    setIsMusicMutePending(true);

    try {
      await updateDoc(doc(db, 'users', currentUserId), {
        [`settings.${GRIGLIATA_MUSIC_MUTED_FIELD}`]: !isMusicMuted,
      });
    } catch (error) {
      console.error('Failed to update Grigliata music mute preference:', error);
      setBoardError('Unable to update your Grigliata music setting right now.');
    } finally {
      setIsMusicMutePending(false);
    }
  }, [currentUserId, isMusicMutePending, isMusicMuted]);

  const clearLiveInteractionPublishTimer = useCallback(() => {
    if (!liveInteractionPublishTimeoutRef.current) return;

    window.clearTimeout(liveInteractionPublishTimeoutRef.current);
    liveInteractionPublishTimeoutRef.current = null;
  }, []);

  const discardPendingLiveInteractionPublish = useCallback((docId = '') => {
    const pendingRequest = pendingLiveInteractionPublishRef.current;
    if (!pendingRequest) return;
    if (docId && pendingRequest.docId !== docId) return;

    pendingLiveInteractionPublishRef.current = null;
    clearLiveInteractionPublishTimer();
  }, [clearLiveInteractionPublishTimer]);

  const enqueueLiveInteractionMutation = useCallback((mutation, failureLabel) => {
    const runMutation = async () => {
      try {
        await mutation();
      } catch (error) {
        console.error(failureLabel, error);
        setBoardError('Unable to sync shared map interactions right now.');
      }
    };

    liveInteractionMutationQueueRef.current = liveInteractionMutationQueueRef.current.then(runMutation, runMutation);
    return liveInteractionMutationQueueRef.current;
  }, []);

  const deletePublishedLiveInteraction = useCallback((docId = activeLiveInteractionDocIdRef.current) => {
    if (!docId) return Promise.resolve();

    if (activeLiveInteractionDocIdRef.current === docId) {
      activeLiveInteractionDocIdRef.current = '';
    }

    return enqueueLiveInteractionMutation(
      () => deleteDoc(doc(db, GRIGLIATA_LIVE_INTERACTION_COLLECTION, docId)),
      'Failed to delete the shared Grigliata interaction:'
    );
  }, [enqueueLiveInteractionMutation]);

  const persistPendingLiveInteractionPublish = useCallback(() => {
    const pendingRequest = pendingLiveInteractionPublishRef.current;
    if (!pendingRequest?.docId || !pendingRequest?.payload) return Promise.resolve();

    pendingLiveInteractionPublishRef.current = null;
    activeLiveInteractionDocIdRef.current = pendingRequest.docId;

    return enqueueLiveInteractionMutation(
      () => setDoc(
        doc(db, GRIGLIATA_LIVE_INTERACTION_COLLECTION, pendingRequest.docId),
        pendingRequest.payload
      ),
      'Failed to publish the shared Grigliata interaction:'
    );
  }, [enqueueLiveInteractionMutation]);

  const scheduleLiveInteractionPublish = useCallback((publishRequest) => {
    pendingLiveInteractionPublishRef.current = publishRequest;
    clearLiveInteractionPublishTimer();

    liveInteractionPublishTimeoutRef.current = window.setTimeout(() => {
      liveInteractionPublishTimeoutRef.current = null;
      void persistPendingLiveInteractionPublish();
    }, GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS);
  }, [clearLiveInteractionPublishTimer, persistPendingLiveInteractionPublish]);

  const handleSharedInteractionChange = useCallback((nextInteraction) => {
    const normalizedDraft = normalizeGrigliataLiveInteractionDraft(nextInteraction);
    setBoardError('');
    setLocalLiveInteraction(
      normalizedDraft && activeBackgroundId
        ? {
          backgroundId: activeBackgroundId,
          draft: normalizedDraft,
        }
        : null
    );
  }, [activeBackgroundId]);

  const publishableLocalLiveInteraction = useMemo(
    () => (
      localLiveInteraction?.backgroundId === activeBackgroundId
        ? localLiveInteraction.draft
        : null
    ),
    [activeBackgroundId, localLiveInteraction]
  );
  const isLocalLiveInteractionPublishEnabled = useMemo(
    () => !!(
      publishableLocalLiveInteraction
      && (isInteractionSharingEnabled || publishableLocalLiveInteraction.type === 'ping')
    ),
    [isInteractionSharingEnabled, publishableLocalLiveInteraction]
  );

  useEffect(() => {
    const nextDocId = (
      currentUserId
      && activeBackgroundId
      && isLocalLiveInteractionPublishEnabled
      && publishableLocalLiveInteraction
    )
      ? buildGrigliataLiveInteractionDocId(activeBackgroundId, currentUserId)
      : '';

    const nextPayload = nextDocId
      ? buildGrigliataLiveInteractionDoc({
        backgroundId: activeBackgroundId,
        ownerUid: currentUserId,
        colorKey: drawColorKey,
        draft: publishableLocalLiveInteraction,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId,
      })
      : null;

    const pendingDocId = pendingLiveInteractionPublishRef.current?.docId || '';
    if (pendingDocId && pendingDocId !== nextDocId) {
      discardPendingLiveInteractionPublish(pendingDocId);
    }

    const activeDocId = activeLiveInteractionDocIdRef.current;
    if (activeDocId && activeDocId !== nextDocId) {
      void deletePublishedLiveInteraction(activeDocId);
    }

    if (nextDocId && nextPayload) {
      scheduleLiveInteractionPublish({
        docId: nextDocId,
        payload: nextPayload,
      });
      return;
    }

    discardPendingLiveInteractionPublish();
  }, [
    activeBackgroundId,
    currentUserId,
    deletePublishedLiveInteraction,
    discardPendingLiveInteractionPublish,
    drawColorKey,
    isLocalLiveInteractionPublishEnabled,
    publishableLocalLiveInteraction,
    scheduleLiveInteractionPublish,
  ]);

  useEffect(() => (
    () => {
      discardPendingLiveInteractionPublish();
      void deletePublishedLiveInteraction();
    }
  ), [deletePublishedLiveInteraction, discardPendingLiveInteractionPublish]);

  useEffect(() => {
    if (!isNarrationOverlayActive) {
      return;
    }

    discardPendingLiveInteractionPublish();
    void deletePublishedLiveInteraction();
  }, [
    deletePublishedLiveInteraction,
    discardPendingLiveInteractionPublish,
    isNarrationOverlayActive,
  ]);

  const clearPlacementsForBackground = async (backgroundId) => {
    if (!backgroundId) return 0;

    let deletedCount = 0;
    const background = backgrounds.find((candidate) => candidate?.id === backgroundId) || null;
    const hasActiveTurnOrderCursor = !!(
      background?.turnOrderActive
      && typeof background.turnOrderActive === 'object'
    );

    if (hasActiveTurnOrderCursor) {
      await clearTurnOrderActiveState(backgroundId);
    }

    await runPaginatedWriteBatch({
      collectionName: 'grigliata_token_placements',
      baseConstraints: [
        where('backgroundId', '==', backgroundId),
        limit(PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE),
      ],
      pageSize: PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE,
      applyDocument: ({ batch, docSnap }) => {
        const placement = docSnap.data() || {};
        const ownerUid = placement?.ownerUid;
        const tokenId = typeof placement?.tokenId === 'string' && placement.tokenId
          ? placement.tokenId
          : ownerUid;
        batch.delete(docSnap.ref);
        if (typeof ownerUid === 'string' && ownerUid && typeof tokenId === 'string' && tokenId) {
          batch.set(
            doc(db, 'users', ownerUid),
            buildHiddenPlacementSettingsPayload({
              backgroundId,
              tokenId,
              isHidden: false,
              includeLegacyBackgroundFallback: isLegacyHiddenPlacementToken({ tokenId, ownerUid }),
            }),
            { merge: true }
          );
        }
        deletedCount += 1;
        return 1;
      },
      useCursor: false,
    });

    return deletedCount;
  };

  const clearMusicVolumeWriteTimer = useCallback(() => {
    if (!musicVolumeWriteTimeoutRef.current) return;

    window.clearTimeout(musicVolumeWriteTimeoutRef.current);
    musicVolumeWriteTimeoutRef.current = null;
  }, []);

  const getCurrentSharedMusicVolume = useCallback(() => normalizeGrigliataMusicVolume(
    pendingMusicVolumeRef.current !== null
      ? pendingMusicVolumeRef.current
      : latestRequestedMusicVolumeRef.current
  ), []);

  const persistMusicPlaybackState = useCallback(async (nextPlaybackState) => {
    await setDoc(
      doc(db, GRIGLIATA_MUSIC_PLAYBACK_COLLECTION, GRIGLIATA_MUSIC_PLAYBACK_DOC_ID),
      nextPlaybackState
    );
  }, []);

  const persistSharedMusicVolume = useCallback(async (nextVolume) => {
    if (!isManager || !currentUserId) return;

    const resolvedVolume = normalizeGrigliataMusicVolume(nextVolume);
    latestRequestedMusicVolumeRef.current = resolvedVolume;

    await persistMusicPlaybackState({
      ...latestMusicPlaybackStateRef.current,
      volume: resolvedVolume,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId,
    });
  }, [currentUserId, isManager, persistMusicPlaybackState]);

  const persistPendingMusicVolume = useCallback(async () => {
    const pendingVolume = pendingMusicVolumeRef.current;
    if (pendingVolume === null) return;

    clearMusicVolumeWriteTimer();

    try {
      await persistSharedMusicVolume(pendingVolume);
    } catch (error) {
      console.error('Failed to update the shared Grigliata music volume:', error);
      setBoardError('Unable to update the shared music volume right now.');
    }
  }, [clearMusicVolumeWriteTimer, persistSharedMusicVolume]);

  const handleSharedMusicVolumeChange = useCallback((nextVolume) => {
    if (!isManager || !currentUserId) return;

    const resolvedVolume = normalizeGrigliataMusicVolume(nextVolume);
    pendingMusicVolumeRef.current = resolvedVolume;
    latestRequestedMusicVolumeRef.current = resolvedVolume;
    setBoardError('');
    clearMusicVolumeWriteTimer();

    musicVolumeWriteTimeoutRef.current = window.setTimeout(() => {
      musicVolumeWriteTimeoutRef.current = null;
      void persistPendingMusicVolume();
    }, MUSIC_VOLUME_WRITE_THROTTLE_MS);
  }, [clearMusicVolumeWriteTimer, currentUserId, isManager, persistPendingMusicVolume]);

  const handleSharedMusicVolumeCommit = useCallback((nextVolume) => {
    if (!isManager || !currentUserId) return;

    const resolvedVolume = normalizeGrigliataMusicVolume(nextVolume);
    pendingMusicVolumeRef.current = resolvedVolume;
    latestRequestedMusicVolumeRef.current = resolvedVolume;
    setBoardError('');
    void persistPendingMusicVolume();
  }, [currentUserId, isManager, persistPendingMusicVolume]);

  useEffect(() => (
    () => {
      clearMusicVolumeWriteTimer();
    }
  ), [clearMusicVolumeWriteTimer]);

  const runMusicPlaybackAction = useCallback(async ({
    actionType,
    buildState,
  }) => {
    if (!isManager || !currentUserId) return;

    const nextPlaybackState = buildState?.();
    if (!nextPlaybackState) return;

    const targetTrackId = nextPlaybackState.trackId || normalizedMusicPlaybackState.trackId || '';

    setBoardError('');
    clearMusicVolumeWriteTimer();
    setMusicPlaybackActionTrackId(targetTrackId);
    setMusicPlaybackActionType(actionType);
    try {
      await persistMusicPlaybackState(nextPlaybackState);
    } catch (error) {
      console.error(`Failed to ${actionType} Grigliata music playback:`, error);
      setBoardError('Unable to update the shared music playback right now.');
    } finally {
      setMusicPlaybackActionTrackId('');
      setMusicPlaybackActionType('');
    }
  }, [
    clearMusicVolumeWriteTimer,
    currentUserId,
    isManager,
    normalizedMusicPlaybackState.trackId,
    persistMusicPlaybackState,
  ]);

  const handleUploadMusicTrack = useCallback(async () => {
    if (!isManager || !user?.uid) return;

    setMusicUploadError('');
    const file = musicSelectedFile;

    if (!file) {
      setMusicUploadError('Select an audio file first.');
      return;
    }

    if (!file.type?.startsWith('audio/')) {
      setMusicUploadError('The selected file must be an audio file.');
      return;
    }

    if (file.size > MAX_GRIGLIATA_MUSIC_FILE_BYTES) {
      setMusicUploadError('Audio tracks must be 25 MB or smaller.');
      return;
    }

    const trackName = (musicUploadName || getDisplayNameFromFileName(file.name)).trim();
    const safeName = buildStorageSafeName(trackName, 'grigliata_music');
    const fileExtension = getFileExtension(file.name) || getFileExtensionFromContentType(file.type);
    const storagePath = `grigliata/music/${user.uid}/${safeName}_${Date.now()}${fileExtension}`;
    let uploadedPath = '';

    setIsMusicUploading(true);
    try {
      const { durationMs } = await readAudioFileMetadata(file);
      const fileRef = storageRef(storage, storagePath);
      await uploadBytes(fileRef, file);
      uploadedPath = storagePath;
      const audioUrl = await getDownloadURL(fileRef);

      await addDoc(collection(db, GRIGLIATA_MUSIC_TRACK_COLLECTION), {
        name: trackName || 'Untitled Track',
        fileName: file.name || '',
        audioUrl,
        audioPath: storagePath,
        contentType: file.type || '',
        sizeBytes: file.size || 0,
        durationMs,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });

      setMusicSelectedFile(null);
      setMusicUploadName('');
      setMusicUploadError('');
    } catch (error) {
      console.error('Failed to upload Grigliata music track:', error);
      setMusicUploadError('Failed to upload the selected audio track.');

      if (uploadedPath) {
        try {
          await deleteObject(storageRef(storage, uploadedPath));
        } catch (cleanupError) {
          console.warn('Music upload cleanup failed:', cleanupError);
        }
      }
    } finally {
      setIsMusicUploading(false);
    }
  }, [
    isManager,
    musicSelectedFile,
    musicUploadName,
    user?.uid,
  ]);

  const handlePlayMusicTrack = useCallback(async (track) => {
    await runMusicPlaybackAction({
      actionType: 'play',
      buildState: () => buildGrigliataMusicPlaybackState({
        status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING,
        track,
        offsetMs: 0,
        volume: getCurrentSharedMusicVolume(),
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId,
      }),
    });
  }, [currentUserId, getCurrentSharedMusicVolume, runMusicPlaybackAction]);

  const handlePauseMusicTrack = useCallback(async (track) => {
    await runMusicPlaybackAction({
      actionType: 'pause',
      buildState: () => buildGrigliataMusicPlaybackState({
        status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PAUSED,
        track,
        offsetMs: computeGrigliataMusicPlaybackOffsetMs(normalizedMusicPlaybackState),
        volume: getCurrentSharedMusicVolume(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId,
      }),
    });
  }, [currentUserId, getCurrentSharedMusicVolume, normalizedMusicPlaybackState, runMusicPlaybackAction]);

  const handleResumeMusicTrack = useCallback(async (track) => {
    await runMusicPlaybackAction({
      actionType: 'resume',
      buildState: () => buildGrigliataMusicPlaybackState({
        status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING,
        track,
        offsetMs: normalizedMusicPlaybackState.offsetMs,
        volume: getCurrentSharedMusicVolume(),
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId,
      }),
    });
  }, [currentUserId, getCurrentSharedMusicVolume, normalizedMusicPlaybackState.offsetMs, runMusicPlaybackAction]);

  const handleStopMusicTrack = useCallback(async () => {
    await runMusicPlaybackAction({
      actionType: 'stop',
      buildState: () => buildGrigliataMusicPlaybackState({
        status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED,
        volume: getCurrentSharedMusicVolume(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId,
      }),
    });
  }, [currentUserId, getCurrentSharedMusicVolume, runMusicPlaybackAction]);

  const handleDeleteMusicTrack = useCallback(async (track) => {
    if (!isManager || !user?.uid || !track?.id) return;

    const confirmed = window.confirm(`Delete track "${track.name || 'Untitled Track'}" permanently?`);
    if (!confirmed) return;

    setDeletingMusicTrackId(track.id);
    setBoardError('');
    try {
      if (normalizedMusicPlaybackState.trackId === track.id) {
        clearMusicVolumeWriteTimer();
        await persistMusicPlaybackState(buildGrigliataMusicPlaybackState({
          status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED,
          volume: getCurrentSharedMusicVolume(),
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId,
        }));
      }

      await deleteDoc(doc(db, GRIGLIATA_MUSIC_TRACK_COLLECTION, track.id));
    } catch (error) {
      console.error('Failed to delete Grigliata music track:', error);
      setBoardError('Unable to delete that music track right now.');
    } finally {
      setDeletingMusicTrackId('');
    }
  }, [
    clearMusicVolumeWriteTimer,
    currentUserId,
    getCurrentSharedMusicVolume,
    isManager,
    normalizedMusicPlaybackState.trackId,
    persistMusicPlaybackState,
    user?.uid,
  ]);

  useEffect(() => {
    if (!activeGridSizeOverride) return;

    if (activeGridSizeOverride.backgroundId !== activeBackgroundId) {
      setActiveGridSizeOverride(null);
      return;
    }

    const overrideGrid = normalizeGridConfig({
      ...persistedActiveGrid,
      ...activeGridSizeOverride.grid,
      ...(Number.isFinite(activeGridSizeOverride.cellSizePx)
        ? { cellSizePx: activeGridSizeOverride.cellSizePx }
        : {}),
    });

    if (areGridConfigsEqual(persistedActiveGrid, overrideGrid)) {
      setActiveGridSizeOverride(null);
    }
  }, [activeBackgroundId, activeGridSizeOverride, persistedActiveGrid]);

  useEffect(() => (
    () => {
      void flushPendingDrawColorAutosave();
      void flushPendingGridSizeAutosave();
    }
  ), [activeBackgroundId, flushPendingDrawColorAutosave, flushPendingGridSizeAutosave]);

  const validateCustomTokenImageFile = (file) => {
    if (!file) {
      return 'Select an image for the custom token.';
    }

    if (!file.type?.startsWith('image/')) {
      return 'Custom token images must be image files.';
    }

    if (file.size > MAX_CUSTOM_TOKEN_FILE_BYTES) {
      return 'Custom token images must be 8 MB or smaller.';
    }

    return '';
  };

  const uploadCustomTokenImage = async ({ file, tokenLabel }) => {
    const validationError = validateCustomTokenImageFile(file);
    if (validationError) {
      throw new Error(validationError);
    }

    const safeName = buildStorageSafeName(tokenLabel, 'grigliata_token');
    const fileExtension = getFileExtension(file.name)
      || getFileExtensionFromContentType(file.type)
      || '.png';
    const imagePath = `grigliata/tokens/${currentUserId}/${safeName}_${Date.now()}${fileExtension}`;
    const imageRef = storageRef(storage, imagePath);

    await uploadBytes(imageRef, file);
    const imageUrl = await getDownloadURL(imageRef);

    return {
      imageUrl,
      imagePath,
    };
  };

  const handleCreateCustomToken = async ({
    label,
    imageFile,
    hpCurrent,
    manaCurrent,
    shieldCurrent,
    notes,
  }) => {
    if (!currentUserId) return false;

    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    if (!trimmedLabel) {
      setBoardError('Enter a name for the custom token.');
      return false;
    }

    const validationError = validateCustomTokenImageFile(imageFile);
    if (validationError) {
      setBoardError(validationError);
      return false;
    }

    let uploadedPath = '';
    const nextHpTotal = normalizeNonNegativeNumericValue(hpCurrent, 0);
    const nextManaTotal = normalizeNonNegativeNumericValue(manaCurrent, 0);
    const nextShieldTotal = normalizeNonNegativeNumericValue(shieldCurrent, 0);

    setBoardError('');
    setIsCreatingCustomToken(true);
    try {
      const { imageUrl, imagePath } = await uploadCustomTokenImage({
        file: imageFile,
        tokenLabel: trimmedLabel,
      });
      uploadedPath = imagePath;

      const templateRef = doc(collection(db, 'grigliata_tokens'));
      await setDoc(templateRef, {
        ownerUid: currentUserId,
        characterId: '',
        label: trimmedLabel,
        imageUrl,
        imagePath,
        tokenType: 'custom',
        customTokenRole: 'template',
        customTemplateId: templateRef.id,
        imageSource: 'uploaded',
        notes: normalizeTokenNotesValue(notes),
        stats: {
          hpTotal: nextHpTotal,
          hpCurrent: nextHpTotal,
          manaTotal: nextManaTotal,
          manaCurrent: nextManaTotal,
          shieldTotal: nextShieldTotal,
          shieldCurrent: nextShieldTotal,
        },
        createdAt: serverTimestamp(),
        createdBy: currentUserId,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId,
      });

      return true;
    } catch (error) {
      console.error('Failed to create custom Grigliata token:', error);
      setBoardError(error?.message || 'Unable to create that custom token right now.');

      if (uploadedPath) {
        try {
          await deleteObject(storageRef(storage, uploadedPath));
        } catch (cleanupError) {
          console.warn('Custom token upload cleanup failed:', cleanupError);
        }
      }

      return false;
    } finally {
      setIsCreatingCustomToken(false);
    }
  };

  const handleUpdateCustomToken = async ({ tokenId, label, imageFile }) => {
    if (!currentUserId || !tokenId || tokenId === currentUserId) return false;

    const existingToken = ownedTrayTokensById.get(tokenId);
    if (!existingToken || existingToken.tokenType !== 'custom') {
      setBoardError('Unable to find that custom token.');
      return false;
    }

    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    if (!trimmedLabel) {
      setBoardError('Enter a name for the custom token.');
      return false;
    }

    const validationError = imageFile ? validateCustomTokenImageFile(imageFile) : '';
    if (validationError) {
      setBoardError(validationError);
      return false;
    }

    let uploadedPath = '';
    let nextImageUrl = existingToken.imageUrl || '';
    let nextImagePath = existingToken.imagePath || '';

    setBoardError('');
    setUpdatingCustomTokenId(tokenId);
    try {
      if (imageFile) {
        const uploadedImage = await uploadCustomTokenImage({
          file: imageFile,
          tokenLabel: trimmedLabel,
        });
        uploadedPath = uploadedImage.imagePath;
        nextImageUrl = uploadedImage.imageUrl;
        nextImagePath = uploadedImage.imagePath;
      }

      await updateGrigliataCustomTokenTemplateCallable({
        tokenId,
        label: trimmedLabel,
        imageUrl: nextImageUrl,
        imagePath: nextImagePath,
      });

      return true;
    } catch (error) {
      console.error('Failed to update custom Grigliata token:', error);
      setBoardError(error?.message || 'Unable to update that custom token right now.');

      if (uploadedPath) {
        try {
          await deleteObject(storageRef(storage, uploadedPath));
        } catch (cleanupError) {
          console.warn('Custom token replacement cleanup failed:', cleanupError);
        }
      }

      return false;
    } finally {
      setUpdatingCustomTokenId('');
    }
  };

  const handleDeleteCustomToken = async (token) => {
    const tokenId = typeof token?.tokenId === 'string' && token.tokenId ? token.tokenId : '';
    if (!currentUserId || !tokenId || tokenId === currentUserId) return false;

    const existingToken = ownedTrayTokensById.get(tokenId);
    if (!existingToken || existingToken.tokenType !== 'custom') {
      setBoardError('Unable to find that custom token.');
      return false;
    }

    const confirmed = window.confirm(`Delete custom token "${existingToken.label || 'Custom Token'}" permanently?`);
    if (!confirmed) {
      return false;
    }

    setBoardError('');
    setDeletingCustomTokenId(tokenId);
    try {
      await deleteGrigliataCustomTokenCallable({ tokenId });
      return true;
    } catch (error) {
      console.error('Failed to delete custom Grigliata token:', error);
      setBoardError('Unable to delete that custom token right now.');
      return false;
    } finally {
      setDeletingCustomTokenId('');
    }
  };

  const handleUpdateFoeToken = async ({
    tokenId,
    label,
    dadoAnima,
    stats,
    Parametri,
    notes,
  }) => {
    if (!isManager || !currentUserId || !tokenId) return false;

    const existingToken = tokenProfilesByTokenId.get(tokenId);
    if (!existingToken || existingToken.tokenType !== 'foe') {
      setBoardError('Unable to find that foe token.');
      return false;
    }

    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    if (!trimmedLabel) {
      setBoardError('Enter a name for the foe token.');
      return false;
    }

    const existingStats = existingToken.stats || {};
    const nextStats = {
      ...existingStats,
      ...(stats || {}),
      hpCurrent: normalizeCurrentResourceValue(stats?.hpCurrent, existingStats?.hpCurrent ?? 0),
      manaCurrent: normalizeCurrentResourceValue(stats?.manaCurrent, existingStats?.manaCurrent ?? 0),
    };
    const nextParametri = normalizeFoeParametri(Parametri, existingToken.Parametri || {});
    const nextDadoAnima = typeof dadoAnima === 'string' ? dadoAnima.trim() : (existingToken.dadoAnima || '');
    const activePlacement = activeBackgroundId
      ? activePlacementsById.get(buildPlacementDocId(activeBackgroundId, tokenId))
      : null;

    setBoardError('');
    setSavingFoeTokenId(tokenId);
    try {
      const batch = writeBatch(db);

      batch.set(doc(db, 'grigliata_tokens', tokenId), {
        label: trimmedLabel,
        dadoAnima: nextDadoAnima,
        stats: nextStats,
        Parametri: nextParametri,
        notes: normalizeTokenNotesValue(notes),
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId,
      }, { merge: true });

      if (activePlacement) {
        batch.set(doc(db, 'grigliata_token_placements', activePlacement.id || activePlacement.placementId || buildPlacementDocId(activeBackgroundId, tokenId)), {
          label: trimmedLabel,
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId,
        }, { merge: true });
      }

      await batch.commit();
      return true;
    } catch (error) {
      console.error('Failed to update Grigliata foe token:', error);
      setBoardError('Unable to update that foe token right now.');
      return false;
    } finally {
      setSavingFoeTokenId('');
    }
  };

  const handleSaveSelectedTokenDetails = async ({
    tokenId,
    tokenType,
    ownerUid,
    characterId,
    label,
    imageUrl,
    imagePath,
    hpCurrent,
    hpTotal,
    manaCurrent,
    manaTotal,
    shieldCurrent,
    shieldTotal,
    notes,
  }) => {
    if (!currentUserId || !tokenId) return false;

    const activeSelectedTokenDetails = selectedTokenDetails?.tokenId === tokenId
      ? selectedTokenDetails
      : null;

    if (selectedBoardTokenId !== tokenId || !activeSelectedTokenDetails) {
      setBoardError('Select a token before saving its details.');
      return false;
    }

    if (activeSelectedTokenDetails.isReady === false) {
      setBoardError(activeSelectedTokenDetails.loadingMessage || 'Wait for the selected token details to finish loading.');
      return false;
    }

    setBoardError('');
    setSavingSelectedTokenDetailsId(tokenId);
    try {
      if (tokenType === 'character') {
        await Promise.all([
          updateDoc(doc(db, 'users', ownerUid || tokenId), {
            'stats.hpCurrent': normalizeCurrentResourceValue(hpCurrent, 0),
            'stats.manaCurrent': normalizeCurrentResourceValue(manaCurrent, 0),
            'stats.barrieraCurrent': normalizeCurrentResourceValue(shieldCurrent, 0),
          }),
          setDoc(doc(db, 'grigliata_tokens', tokenId), {
            ownerUid: ownerUid || tokenId,
            characterId: characterId || '',
            label: label || 'Character',
            imageUrl: imageUrl || '',
            imagePath: imagePath || '',
            tokenType: 'character',
            imageSource: 'profile',
            notes: normalizeTokenNotesValue(notes),
            updatedAt: serverTimestamp(),
            updatedBy: currentUserId,
          }, { merge: true }),
        ]);

        return true;
      }

      if (tokenType === 'custom') {
        const missingResourceTotals = activeSelectedTokenDetails.missingResourceTotals || {};
        const nextHpCurrent = normalizeCurrentResourceValue(hpCurrent, 0);
        const nextManaCurrent = normalizeCurrentResourceValue(manaCurrent, 0);
        const nextShieldCurrent = normalizeCurrentResourceValue(shieldCurrent, 0);
        const nextHpTotal = missingResourceTotals.hpTotal
          ? nextHpCurrent
          : normalizeNonNegativeNumericValue(hpTotal, 0);
        const nextManaTotal = missingResourceTotals.manaTotal
          ? nextManaCurrent
          : normalizeNonNegativeNumericValue(manaTotal, 0);
        const nextShieldTotal = missingResourceTotals.shieldTotal
          ? nextShieldCurrent
          : normalizeNonNegativeNumericValue(shieldTotal, 0);

        await setDoc(doc(db, 'grigliata_tokens', tokenId), {
          notes: normalizeTokenNotesValue(notes),
          stats: {
            hpTotal: nextHpTotal,
            hpCurrent: nextHpCurrent,
            manaTotal: nextManaTotal,
            manaCurrent: nextManaCurrent,
            shieldTotal: nextShieldTotal,
            shieldCurrent: nextShieldCurrent,
          },
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId,
        }, { merge: true });

        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to save selected Grigliata token details:', error);
      setBoardError('Unable to save those token details right now.');
      return false;
    } finally {
      setSavingSelectedTokenDetailsId('');
    }
  };

  const handleUploadBackground = async () => {
    if (!isManager || !user?.uid) return;

    setUploadError('');
    const file = selectedFile;

    if (!file) {
      setUploadError('Select an image or MP4 video file first.');
      return;
    }

    const assetType = getBackgroundUploadAssetType(file);

    if (!assetType) {
      setUploadError('The selected file must be an image or MP4 video.');
      return;
    }

    if (assetType === 'image' && file.size > MAX_BACKGROUND_IMAGE_FILE_BYTES) {
      setUploadError('Background images must be 15 MB or smaller.');
      return;
    }

    if (assetType === 'video' && file.size > MAX_BACKGROUND_VIDEO_FILE_BYTES) {
      setUploadError('Background videos must be 25 MB or smaller.');
      return;
    }

    const mapName = (uploadName || getDisplayNameFromFileName(file.name)).trim();
    const safeName = buildStorageSafeName(mapName, 'grigliata_map');
    const fileExtension = getFileExtension(file.name)
      || getFileExtensionFromContentType(file.type)
      || (assetType === 'video' ? '.mp4' : '.png');
    const storagePath = `grigliata/backgrounds/${user.uid}/${safeName}_${Date.now()}${fileExtension}`;
    let uploadedPath = '';

    setIsUploading(true);
    try {
      const mediaMetadata = assetType === 'video'
        ? await readFileVideoMetadata(file)
        : await readFileImageDimensions(file);
      const fileRef = storageRef(storage, storagePath);
      await uploadBytes(fileRef, file);
      uploadedPath = storagePath;
      const imageUrl = await getDownloadURL(fileRef);

      const backgroundPayload = {
        name: mapName || 'Untitled Map',
        imageUrl,
        imagePath: storagePath,
        imageWidth: mediaMetadata.width,
        imageHeight: mediaMetadata.height,
        assetType,
        contentType: file.type || '',
        fileName: file.name || '',
        sizeBytes: file.size || 0,
        grid: normalizeGridConfig(DEFAULT_GRID),
        isGridVisible: true,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      };

      if (assetType === 'video') {
        backgroundPayload.durationMs = mediaMetadata.durationMs || 0;
      }

      await addDoc(collection(db, 'grigliata_backgrounds'), backgroundPayload);

      setSelectedFile(null);
      setUploadName('');
      setUploadError('');
    } catch (error) {
      console.error('Failed to upload background:', error);
      setUploadError('Failed to upload the selected background.');

      if (uploadedPath) {
        try {
          await deleteObject(storageRef(storage, uploadedPath));
        } catch (cleanupError) {
          console.warn('Background upload cleanup failed:', cleanupError);
        }
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleUseBackground = async (background) => {
    if (!isManager || !user?.uid || !background?.id) return;
    if (isCombatMapChangeLocked) {
      setBoardError(
        isNarrationOverlayActive
          ? 'Close narration before changing the combat map.'
          : 'Use narration instead of switching the combat map during an active turn order.'
      );
      return;
    }

    setBoardError('');
    setActivatingBackgroundId(background.id);
    try {
      await setDoc(doc(db, 'grigliata_state', 'current'), {
        activeBackgroundId: background.id,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      }, { merge: true });
    } catch (error) {
      console.error('Failed to activate background:', error);
      setBoardError('Unable to activate that background.');
    } finally {
      setActivatingBackgroundId('');
    }
  };

  const handleStartNarration = async (background) => {
    if (
      !isManager
      || !user?.uid
      || !background?.id
      || background.id === activeBackgroundId
      || narrationActionPendingRef.current
    ) return;

    setBoardError('');
    narrationActionPendingRef.current = true;
    setIsNarrationClosePending(false);
    setNarrationActionBackgroundId(background.id);
    try {
      if (background.imageUrl && !isVideoBackground(background)) {
        await preloadImageAssets([background.imageUrl]);
      }

      await setDoc(doc(db, 'grigliata_state', 'current'), {
        presentationBackgroundId: background.id,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      }, { merge: true });
    } catch (error) {
      console.error('Failed to start narration overlay:', error);
      setBoardError('Unable to open that narration scene.');
    } finally {
      narrationActionPendingRef.current = false;
      setNarrationActionBackgroundId('');
      setIsNarrationClosePending(false);
    }
  };

  const handleStopNarration = async () => {
    if (!isManager || !user?.uid || !presentationBackgroundId || narrationActionPendingRef.current) return;

    setBoardError('');
    narrationActionPendingRef.current = true;
    setIsNarrationClosePending(true);
    setNarrationActionBackgroundId(presentationBackgroundId);
    try {
      await setDoc(doc(db, 'grigliata_state', 'current'), {
        presentationBackgroundId: '',
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      }, { merge: true });
    } catch (error) {
      console.error('Failed to close narration overlay:', error);
      setBoardError('Unable to close the narration scene.');
    } finally {
      narrationActionPendingRef.current = false;
      setNarrationActionBackgroundId('');
      setIsNarrationClosePending(false);
    }
  };

  const handleToggleGridVisibility = async (backgroundId) => {
    if (!isManager || !user?.uid || !backgroundId) return;

    const background = backgrounds.find((entry) => entry.id === backgroundId);
    if (!background) return;

    setBoardError('');
    setGridVisibilityUpdateBackgroundId(backgroundId);
    try {
      await updateDoc(doc(db, 'grigliata_backgrounds', backgroundId), {
        isGridVisible: !(background.isGridVisible !== false),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    } catch (error) {
      console.error('Failed to toggle grid visibility:', error);
      setBoardError('Unable to update the shared grid visibility.');
    } finally {
      setGridVisibilityUpdateBackgroundId('');
    }
  };

  const handleDeactivateActiveBackground = async () => {
    if (!isManager || !user?.uid || !activeBackgroundId) return;
    if (isCombatMapChangeLocked) {
      setBoardError(
        isNarrationOverlayActive
          ? 'Close narration before deactivating the combat map.'
          : 'Use narration instead of deactivating the combat map during an active turn order.'
      );
      return;
    }

    setBoardError('');
    setIsActiveBackgroundDeactivationPending(true);
    try {
      await setDoc(doc(db, 'grigliata_state', 'current'), {
        activeBackgroundId: '',
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      }, { merge: true });
    } catch (error) {
      console.error('Failed to deactivate active background:', error);
      setBoardError('Unable to deactivate the active background.');
    } finally {
      setIsActiveBackgroundDeactivationPending(false);
    }
  };

  const getCharacterTurnEffectSource = useCallback(async (ownerUid) => {
    if (!ownerUid) {
      return null;
    }

    if (ownerUid === currentUserId && userData) {
      return userData;
    }

    const userSnapshot = await getDoc(doc(db, 'users', ownerUid));
    return userSnapshot.exists() ? userSnapshot.data() : null;
  }, [currentUserId, userData]);

  const buildCharacterShieldTurnEffect = useCallback((sourceUserData, turnCounter) => {
    const shieldTotal = normalizeNonNegativeNumericValue(sourceUserData?.stats?.barrieraTotal, 0);
    const totalTurns = normalizeNonNegativeNumericValue(
      sourceUserData?.active_turn_effect?.barriera?.totalTurns,
      0,
    );
    const remainingTurns = normalizeNonNegativeNumericValue(
      sourceUserData?.active_turn_effect?.barriera?.remainingTurns,
      0,
    );
    if (shieldTotal < 1 || totalTurns < 1 || remainingTurns < 1) {
      return null;
    }

    return buildShieldTurnEffect({
      totalTurns,
      remainingTurns,
      turnCounter,
    });
  }, []);

  const resolveTurnOrderProgressState = useCallback(async (entry) => {
    if (!entry?.tokenId) {
      return null;
    }

    const placementContext = getActiveMapPlacementContexts([entry.tokenId])[0];
    const boardToken = boardTokensById.get(entry.tokenId) || null;
    if (!placementContext || !boardToken) {
      return null;
    }

    const nextTurnCounter = normalizeTurnCounter(placementContext.turnCounter, 0) + 1;
    let nextTurnEffects = normalizeTurnEffects(placementContext.turnEffects);

    if (
      boardToken.tokenType === 'character'
      && !getTurnEffectByKind(nextTurnEffects, TURN_EFFECT_KIND_SHIELD)
    ) {
      const sourceUserData = await getCharacterTurnEffectSource(placementContext.ownerUid);
      const shieldTurnEffect = buildCharacterShieldTurnEffect(sourceUserData, nextTurnCounter);
      if (shieldTurnEffect) {
        nextTurnEffects = [...nextTurnEffects, shieldTurnEffect];
      }
    }

    const reconciledTurnEffects = reconcileTurnEffectsAtTurnCounter({
      turnCounter: nextTurnCounter,
      turnEffects: nextTurnEffects,
    });

    return {
      boardToken,
      placementContext,
      nextTurnCounter,
      nextTurnEffects: reconciledTurnEffects.turnEffects,
      expiredTurnEffects: reconciledTurnEffects.expiredEffects,
      activeShieldEffect: getTurnEffectByKind(reconciledTurnEffects.turnEffects, TURN_EFFECT_KIND_SHIELD),
      expiredShieldEffect: getTurnEffectByKind(reconciledTurnEffects.expiredEffects, TURN_EFFECT_KIND_SHIELD),
    };
  }, [
    boardTokensById,
    buildCharacterShieldTurnEffect,
    getCharacterTurnEffectSource,
  ]);

  const clearTurnOrderActiveState = useCallback(async (backgroundIdOverride = '') => {
    const targetBackgroundId = backgroundIdOverride || activeBackgroundId;
    if (!isManager || !user?.uid || !targetBackgroundId) {
      return;
    }

    await updateDoc(doc(db, 'grigliata_backgrounds', targetBackgroundId), {
      turnOrderActive: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
  }, [activeBackgroundId, isManager, user?.uid]);

  const writeTurnOrderActiveEntry = useCallback(async (entry, { preserveStartedAt = false } = {}) => {
    if (!isManager || !user?.uid || !activeBackgroundId || !entry?.tokenId) {
      return;
    }

    const progressState = await resolveTurnOrderProgressState(entry);
    if (!progressState) {
      return;
    }

    const nextStartedAt = preserveStartedAt && activeTurnCursor?.startedAt
      ? activeTurnCursor.startedAt
      : serverTimestamp();
    const {
      boardToken,
      placementContext,
      nextTurnCounter,
      nextTurnEffects,
      activeShieldEffect,
      expiredShieldEffect,
    } = progressState;
    const batch = writeBatch(db);

    batch.set(doc(db, 'grigliata_backgrounds', activeBackgroundId), {
      turnOrderActive: buildTurnOrderActiveState(entry, nextStartedAt),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }, { merge: true });
    batch.set(
      doc(db, 'grigliata_token_placements', placementContext.placementId),
      {
        ...buildPlacementWritePayload({
          backgroundId: activeBackgroundId,
          tokenId: entry.tokenId,
          ownerUid: placementContext.ownerUid,
          col: placementContext.col,
          row: placementContext.row,
          isVisibleToPlayers: placementContext.isVisibleToPlayers,
          isDead: placementContext.isDead,
          isInTurnOrder: placementContext.isInTurnOrder,
          turnOrderInitiative: placementContext.turnOrderInitiative,
          turnOrderJoinedAt: placementContext.turnOrderJoinedAt,
          turnCounter: nextTurnCounter,
          turnEffects: nextTurnEffects,
        }),
        ...(!nextTurnEffects.length ? { turnEffects: deleteField() } : {}),
      },
      { merge: true }
    );

    if (boardToken.tokenType === 'character') {
      if (activeShieldEffect) {
        batch.set(doc(db, 'users', placementContext.ownerUid), {
          active_turn_effect: {
            barriera: {
              totalTurns: activeShieldEffect.totalTurns,
              remainingTurns: activeShieldEffect.remainingTurns,
            },
          },
        }, { merge: true });
      } else if (expiredShieldEffect) {
        batch.set(doc(db, 'users', placementContext.ownerUid), {
          stats: {
            barrieraCurrent: 0,
            barrieraTotal: 0,
          },
          active_turn_effect: {
            barriera: {
              totalTurns: 0,
              remainingTurns: 0,
            },
          },
        }, { merge: true });
      }
    } else if (boardToken.tokenType === 'custom' && expiredShieldEffect) {
      batch.set(doc(db, 'grigliata_tokens', entry.tokenId), {
        stats: {
          shieldCurrent: 0,
          shieldTotal: 0,
        },
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId || null,
      }, { merge: true });
    }

    await batch.commit();
  }, [
    activeBackgroundId,
    activeTurnCursor?.startedAt,
    buildPlacementWritePayload,
    currentUserId,
    isManager,
    resolveTurnOrderProgressState,
    user?.uid,
  ]);

  const handleStartTurnOrder = async () => {
    if (!isManager || !user?.uid || !activeBackgroundId) {
      return;
    }

    const firstEntry = getFirstTurnOrderEntry(turnOrderEntries);
    if (!firstEntry) {
      return;
    }

    setBoardError('');
    setIsTurnOrderProgressPending(true);
    try {
      await writeTurnOrderActiveEntry(firstEntry);
    } catch (error) {
      console.error('Failed to start turn order:', error);
      setBoardError('Unable to start the turn order right now.');
    } finally {
      setIsTurnOrderProgressPending(false);
    }
  };

  const handleAdvanceTurnOrder = async () => {
    if (!isManager || !user?.uid || !activeBackgroundId || !isTurnOrderStarted) {
      return;
    }

    setBoardError('');
    setIsTurnOrderProgressPending(true);
    try {
      const nextEntry = getNextTurnOrderEntry(turnOrderEntries, activeTurnCursor);
      if (!nextEntry) {
        await clearTurnOrderActiveState();
      } else {
        await writeTurnOrderActiveEntry(nextEntry, { preserveStartedAt: true });
      }
    } catch (error) {
      console.error('Failed to advance turn order:', error);
      setBoardError('Unable to advance the turn order right now.');
    } finally {
      setIsTurnOrderProgressPending(false);
    }
  };

  const handleResetTurnOrder = async () => {
    if (!isManager || !user?.uid || !activeBackgroundId) return;

    const targetPlacements = [...activePlacementsById.values()]
      .map((placement) => {
        const resolvedTokenId = placement?.tokenId || placement?.ownerUid || '';
        if (!resolvedTokenId || placement?.backgroundId !== activeBackgroundId) {
          return null;
        }

        const hasTurnOrderState = placement?.isInTurnOrder === true
          || Number.isInteger(placement?.turnOrderInitiative)
          || !!placement?.turnOrderJoinedAt
          || normalizeTurnCounter(placement?.turnCounter, 0) > 0
          || normalizeTurnEffects(placement?.turnEffects).length > 0;
        if (!hasTurnOrderState) {
          return null;
        }

        const tokenType = boardTokensById.get(resolvedTokenId)?.tokenType || '';
        const hasShieldTurnEffect = !!getTurnEffectByKind(
          normalizeTurnEffects(placement?.turnEffects),
          TURN_EFFECT_KIND_SHIELD,
        );

        return {
          tokenId: resolvedTokenId,
          tokenType,
          hasShieldTurnEffect,
          ownerUid: placement.ownerUid,
          placementId: placement.id || buildPlacementDocId(activeBackgroundId, resolvedTokenId),
          col: Number.isFinite(placement?.col) ? placement.col : 0,
          row: Number.isFinite(placement?.row) ? placement.row : 0,
          isVisibleToPlayers: placement?.isVisibleToPlayers !== false,
          isDead: placement?.isDead === true,
          statuses: Array.isArray(placement?.statuses) ? placement.statuses : [],
        };
      })
      .filter(Boolean);
    const characterOwnerUidsToClearShieldTimers = [...new Set(
      targetPlacements
        .filter(({ tokenType }) => tokenType === 'character')
        .map(({ ownerUid }) => ownerUid)
        .filter(Boolean)
    )];
    const characterOwnerUidsToClearShieldStats = new Set(
      targetPlacements
        .filter(({ tokenType, hasShieldTurnEffect }) => tokenType === 'character' && hasShieldTurnEffect)
        .map(({ ownerUid }) => ownerUid)
        .filter(Boolean)
    );
    const customTokenIdsToClearShieldStats = [...new Set(
      targetPlacements
        .filter(({ tokenType, hasShieldTurnEffect }) => tokenType === 'custom' && hasShieldTurnEffect)
        .map(({ tokenId }) => tokenId)
        .filter(Boolean)
    )];

    setBoardError('');
    setIsTurnOrderResetPending(true);
    try {
      for (let index = 0; index < targetPlacements.length; index += PLACEMENT_RULE_SAFE_BATCH_SIZE) {
        const batch = writeBatch(db);

        targetPlacements.slice(index, index + PLACEMENT_RULE_SAFE_BATCH_SIZE).forEach((placement) => {
          batch.set(
            doc(db, 'grigliata_token_placements', placement.placementId),
            buildTurnOrderRemovalPlacementWrite({
              backgroundId: activeBackgroundId,
              tokenId: placement.tokenId,
              ownerUid: placement.ownerUid,
              col: placement.col,
              row: placement.row,
              isVisibleToPlayers: placement.isVisibleToPlayers,
              isDead: placement.isDead,
              statuses: placement.statuses,
            }),
            { merge: true }
          );
        });

        await batch.commit();
      }

      for (let index = 0; index < characterOwnerUidsToClearShieldTimers.length; index += FIRESTORE_BATCH_SIZE) {
        const batch = writeBatch(db);

        characterOwnerUidsToClearShieldTimers
          .slice(index, index + FIRESTORE_BATCH_SIZE)
          .forEach((ownerUid) => {
            batch.set(doc(db, 'users', ownerUid), {
              ...(characterOwnerUidsToClearShieldStats.has(ownerUid)
                ? {
                    stats: {
                      barrieraCurrent: 0,
                      barrieraTotal: 0,
                    },
                  }
                : {}),
              active_turn_effect: {
                barriera: {
                  totalTurns: 0,
                  remainingTurns: 0,
                },
              },
            }, { merge: true });
          });

        await batch.commit();
      }

      for (let index = 0; index < customTokenIdsToClearShieldStats.length; index += FIRESTORE_BATCH_SIZE) {
        const batch = writeBatch(db);

        customTokenIdsToClearShieldStats
          .slice(index, index + FIRESTORE_BATCH_SIZE)
          .forEach((tokenId) => {
            batch.set(doc(db, 'grigliata_tokens', tokenId), {
              stats: {
                shieldCurrent: 0,
                shieldTotal: 0,
              },
              updatedAt: serverTimestamp(),
              updatedBy: currentUserId || null,
            }, { merge: true });
          });

        await batch.commit();
      }

      await clearTurnOrderActiveState();
    } catch (error) {
      console.error('Failed to reset turn order:', error);
      setBoardError('Unable to reset the turn order right now.');
    } finally {
      setIsTurnOrderResetPending(false);
    }
  };

  const handleJoinTurnOrder = async (tokenId, nextInitiative = 0) => {
    if (!currentUserId || !activeBackgroundId || !tokenId) {
      return false;
    }

    const normalizedInitiative = Number(nextInitiative);
    if (!Number.isInteger(normalizedInitiative)) {
      setBoardError('Initiative must be a whole number.');
      return false;
    }

    const targetPlacement = getActiveMapPlacementContexts([tokenId])[0];
    if (
      !targetPlacement
      || !canCurrentUserManageTurnOrderPlacement(targetPlacement)
      || (!isManager && targetPlacement.isVisibleToPlayers === false)
      || targetPlacement.isInTurnOrder
    ) {
      return false;
    }

    setBoardError('');
    setTurnOrderActionTokenId(tokenId);
    try {
      await setDoc(
        doc(db, 'grigliata_token_placements', targetPlacement.placementId),
        buildPlacementWritePayload({
          backgroundId: activeBackgroundId,
          tokenId,
          ownerUid: targetPlacement.ownerUid,
          col: targetPlacement.col,
          row: targetPlacement.row,
          isInTurnOrder: true,
          turnOrderInitiative: normalizedInitiative,
          turnOrderJoinedAt: targetPlacement.turnOrderJoinedAt || serverTimestamp(),
        }),
        { merge: true }
      );
      return true;
    } catch (error) {
      console.error('Failed to join turn order:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'The DM is currently controlling that token.'
          : 'Unable to add that token to the turn order right now.'
      );
      return false;
    } finally {
      setTurnOrderActionTokenId('');
    }
  };

  const handleLeaveTurnOrder = async (tokenId) => {
    if (!currentUserId || !activeBackgroundId || !tokenId) {
      return;
    }

    const targetPlacement = getActiveMapPlacementContexts([tokenId])[0];
    if (
      !targetPlacement
      || !canCurrentUserManageTurnOrderPlacement(targetPlacement)
      || (!isManager && targetPlacement.isVisibleToPlayers === false)
      || !targetPlacement.isInTurnOrder
    ) {
      return;
    }

    setBoardError('');
    setTurnOrderActionTokenId(tokenId);
    try {
      await setDoc(
        doc(db, 'grigliata_token_placements', targetPlacement.placementId),
        buildTurnOrderRemovalPlacementWrite({
          backgroundId: activeBackgroundId,
          tokenId,
          ownerUid: targetPlacement.ownerUid,
          col: targetPlacement.col,
          row: targetPlacement.row,
          isVisibleToPlayers: targetPlacement.isVisibleToPlayers,
          isDead: targetPlacement.isDead,
          statuses: targetPlacement.statuses,
        }),
        { merge: true }
      );
    } catch (error) {
      console.error('Failed to leave turn order:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'The DM is currently controlling that token.'
          : 'Unable to remove that token from the turn order right now.'
      );
    } finally {
      setTurnOrderActionTokenId('');
    }
  };

  const handleSaveTurnOrderInitiative = async (tokenId, nextInitiative) => {
    if (!currentUserId || !activeBackgroundId || !tokenId) {
      return false;
    }

    const normalizedInitiative = Number(nextInitiative);
    if (!Number.isInteger(normalizedInitiative)) {
      setBoardError('Initiative must be a whole number.');
      return false;
    }

    const targetPlacement = getActiveMapPlacementContexts([tokenId])[0];
    if (
      !targetPlacement
      || !targetPlacement.isInTurnOrder
      || !canCurrentUserManageTurnOrderPlacement(targetPlacement)
      || (!isManager && targetPlacement.isVisibleToPlayers === false)
    ) {
      return false;
    }

    setBoardError('');
    setSavingTurnOrderInitiativeTokenId(tokenId);
    try {
      await setDoc(
        doc(db, 'grigliata_token_placements', targetPlacement.placementId),
        buildPlacementWritePayload({
          backgroundId: activeBackgroundId,
          tokenId,
          ownerUid: targetPlacement.ownerUid,
          col: targetPlacement.col,
          row: targetPlacement.row,
          isInTurnOrder: true,
          turnOrderInitiative: normalizedInitiative,
          turnOrderJoinedAt: targetPlacement.turnOrderJoinedAt || serverTimestamp(),
        }),
        { merge: true }
      );
      return true;
    } catch (error) {
      console.error('Failed to save turn order initiative:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'The DM is currently controlling that token.'
          : 'Unable to save that initiative right now.'
      );
      return false;
    } finally {
      setSavingTurnOrderInitiativeTokenId('');
    }
  };

  useEffect(() => {
    if (
      !isManager
      || !user?.uid
      || !activeBackgroundId
      || !isActivePlacementsReady
      || !isTurnOrderStarted
      || !!activeTurnEntry
      || turnOrderRepairPendingRef.current
      || isTurnOrderResetPending
    ) {
      return undefined;
    }

    let isActive = true;

    const repairTurnOrderState = async () => {
      setBoardError('');
      turnOrderRepairPendingRef.current = true;
      try {
        if (turnOrderEntries.length < 1) {
          await clearTurnOrderActiveState();
          return;
        }

        const nextEntry = getNextTurnOrderEntry(turnOrderEntries, activeTurnCursor);
        if (!nextEntry) {
          await clearTurnOrderActiveState();
          return;
        }

        await writeTurnOrderActiveEntry(nextEntry, { preserveStartedAt: true });
      } catch (error) {
        console.error('Failed to repair turn order state:', error);
        if (isActive) {
          setBoardError('Unable to repair the active turn order right now.');
        }
      } finally {
        turnOrderRepairPendingRef.current = false;
      }
    };

    void repairTurnOrderState();

    return () => {
      isActive = false;
    };
  }, [
    activeBackgroundId,
    activeTurnCursor,
    activeTurnEntry,
    clearTurnOrderActiveState,
    isActivePlacementsReady,
    isManager,
    isTurnOrderResetPending,
    isTurnOrderStarted,
    turnOrderEntries,
    user?.uid,
    writeTurnOrderActiveEntry,
  ]);

  const handleSetSelectedTokensVisibility = async (tokenIds, nextIsVisibleToPlayers) => {
    if (typeof nextIsVisibleToPlayers !== 'boolean') {
      return;
    }

    setBoardError('');
    setIsTokenVisibilityActionPending(true);
    try {
      await setSelectedTokensVisibility(tokenIds, nextIsVisibleToPlayers);
    } catch (error) {
      console.error('Failed to update selected token visibility:', error);
      setBoardError('Unable to update the selected token visibility.');
    } finally {
      setIsTokenVisibilityActionPending(false);
    }
  };

  const handleSetSelectedTokensDeadState = async (tokenIds, nextIsDead) => {
    if (typeof nextIsDead !== 'boolean') {
      return;
    }

    setBoardError('');
    setIsTokenDeadActionPending(true);
    try {
      await setSelectedTokensDeadState(tokenIds, nextIsDead);
    } catch (error) {
      console.error('Failed to update selected token dead state:', error);
      setBoardError('Unable to update the selected token dead state.');
    } finally {
      setIsTokenDeadActionPending(false);
    }
  };

  const handleUpdateTokenStatuses = async (tokenId, nextStatuses) => {
    if (!tokenId || !Array.isArray(nextStatuses)) {
      return;
    }

    setBoardError('');
    setIsTokenStatusActionPending(true);
    try {
      await updateTokenStatuses(tokenId, nextStatuses);
    } catch (error) {
      console.error('Failed to update token statuses:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'The DM is currently hiding or controlling that token.'
          : 'Unable to update that token status right now.'
      );
    } finally {
      setIsTokenStatusActionPending(false);
    }
  };

  const handleSetSelectedTokenSize = async (tokenId, sizeSquares) => {
    if (!tokenId) {
      return false;
    }

    setBoardError('');
    setIsTokenSizeActionPending(true);
    try {
      return await setSelectedTokenSize(tokenId, sizeSquares);
    } catch (error) {
      console.error('Failed to update token size:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'The DM is currently hiding or controlling that token.'
          : 'Unable to resize that token right now.'
      );
      return false;
    } finally {
      setIsTokenSizeActionPending(false);
    }
  };

  const handleSetSelectedTokenVision = async (tokenId, visionSettings) => {
    if (!tokenId || typeof visionSettings?.visionEnabled !== 'boolean') {
      return false;
    }

    setBoardError('');
    setIsTokenVisionActionPending(true);
    try {
      return await setSelectedTokenVision(tokenId, visionSettings);
    } catch (error) {
      console.error('Failed to update token vision settings:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'Only the DM can update token vision settings.'
          : 'Unable to update that token vision right now.'
      );
      return false;
    } finally {
      setIsTokenVisionActionPending(false);
    }
  };

  const handleClearTokensForBackground = async (background) => {
    if (!isManager || !user?.uid || !background?.id) return;

    const hasActiveTurnOrderCursor = !!(
      background.turnOrderActive
      && typeof background.turnOrderActive === 'object'
    );
    if ((background.id === activeBackgroundId && isCombatMapChangeLocked) || hasActiveTurnOrderCursor) {
      setBoardError(
        background.id === activeBackgroundId
          ? (isNarrationOverlayActive
            ? 'Close narration before clearing tokens on the combat map.'
            : 'Reset the active turn order before clearing tokens on the combat map.')
          : 'Reset that map\'s active turn order before clearing its tokens.'
      );
      return;
    }

    const confirmed = window.confirm(`Delete all token placements for "${background.name || 'Untitled Map'}"?`);
    if (!confirmed) return;

    setBoardError('');
    setClearingTokensBackgroundId(background.id);
    try {
      await clearPlacementsForBackground(background.id);
    } catch (error) {
      console.error('Failed to clear token placements:', error);
      setBoardError('Unable to clear that map\'s token placements.');
    } finally {
      setClearingTokensBackgroundId('');
    }
  };

  const handleDeleteBackground = async (background) => {
    if (!isManager || !user?.uid || !background?.id) return;

    const hasActiveTurnOrderCursor = !!(
      background.turnOrderActive
      && typeof background.turnOrderActive === 'object'
    );
    if ((background.id === activeBackgroundId && isCombatMapChangeLocked) || hasActiveTurnOrderCursor) {
      setBoardError(
        background.id === activeBackgroundId
          ? (isNarrationOverlayActive
            ? 'Close narration before deleting the combat map.'
            : 'Reset the active turn order before deleting the combat map.')
          : 'Reset that map\'s active turn order before deleting it.'
      );
      return;
    }

    const confirmed = window.confirm(`Delete background "${background.name || 'Untitled Map'}" permanently?`);
    if (!confirmed) return;

    setDeletingBackgroundId(background.id);
    setBoardError('');
    try {
      if (background.id === activeBackgroundId) {
        cancelPendingGridSizeAutosave(background.id);
        setActiveGridSizeOverride(null);
      }

      await clearPlacementsForBackground(background.id);
      await deleteDoc(doc(db, GRIGLIATA_BACKGROUND_LIGHTING_COLLECTION, background.id));
      await deleteDoc(doc(db, GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION, background.id));
      await runPaginatedWriteBatch({
        collectionName: GRIGLIATA_FOG_OF_WAR_COLLECTION,
        baseConstraints: [where('backgroundId', '==', background.id)],
        applyDocument: ({ batch, docSnap }) => {
          batch.delete(docSnap.ref);
          return 1;
        },
      });

      if (background.imagePath) {
        try {
          await deleteObject(storageRef(storage, background.imagePath));
        } catch (storageError) {
          if (storageError?.code !== 'storage/object-not-found') {
            throw storageError;
          }
        }
      }

      await deleteDoc(doc(db, 'grigliata_backgrounds', background.id));

      if (background.id === activeBackgroundId) {
        await setDoc(doc(db, 'grigliata_state', 'current'), {
          activeBackgroundId: '',
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        }, { merge: true });
      }

      if (background.id === presentationBackgroundId) {
        await setDoc(doc(db, 'grigliata_state', 'current'), {
          presentationBackgroundId: '',
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        }, { merge: true });
      }
    } catch (error) {
      console.error('Failed to delete background:', error);
      setBoardError('Unable to delete that background.');
    } finally {
      setDeletingBackgroundId('');
    }
  };

  const handleSaveCalibration = async () => {
    if (!isManager || !user?.uid || !selectedBackgroundId) return;

    setCalibrationError('');
    setBoardError('');
    setIsSavingCalibration(true);
    try {
      const normalizedCalibration = normalizeGridConfig(calibrationDraft);

      if (selectedBackgroundId === activeBackgroundId) {
        await flushPendingGridSizeAutosave();
      }

      await updateDoc(doc(db, 'grigliata_backgrounds', selectedBackgroundId), {
        grid: normalizedCalibration,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });

      setCalibrationDraft(normalizedCalibration);

      if (selectedBackgroundId === activeBackgroundId) {
        setActiveGridSizeOverride({
          backgroundId: selectedBackgroundId,
          grid: normalizedCalibration,
        });
      }
    } catch (error) {
      console.error('Failed to save calibration:', error);
      setCalibrationError('Unable to save calibration changes.');
    } finally {
      setIsSavingCalibration(false);
    }
  };

  const buildLightingMetadataFromFile = async (file, {
    importedAt = null,
    updatedAt = null,
  } = {}) => {
    if (!selectedBackground?.id) {
      throw new Error('Select a background before importing lighting metadata.');
    }

    if (!file || typeof file.text !== 'function') {
      throw new Error('Select a Dungeon Alchemist JSON file first.');
    }

    const rawJson = await file.text();
    const parsedJson = parseDungeonAlchemistLightingJson(rawJson);
    return normalizeDungeonAlchemistLightingMetadata(parsedJson, {
      background: selectedBackground,
      fileName: file.name || '',
      importedAt,
      importedBy: user?.uid || '',
      updatedAt,
      updatedBy: user?.uid || '',
    });
  };

  const handleLightingFileChange = async (event) => {
    const file = event.target.files?.[0] || null;
    setLightingSelectedFile(file);
    setLightingImportDraft(null);
    setLightingImportError('');

    if (!file) {
      return;
    }

    try {
      const metadataDraft = await buildLightingMetadataFromFile(file);
      setLightingImportDraft(metadataDraft);
    } catch (error) {
      setLightingImportError(error?.message || 'Unable to parse that lighting metadata file.');
    }
  };

  const handleImportLightingMetadata = async () => {
    if (!isManager || !user?.uid || !selectedBackground?.id) return;

    setLightingImportError('');
    setBoardError('');
    setIsImportingLighting(true);

    try {
      const importedAt = serverTimestamp();
      const updatedAt = serverTimestamp();
      const metadata = await buildLightingMetadataFromFile(lightingSelectedFile, {
        importedAt,
        updatedAt,
      });
      const summary = buildGrigliataLightingSummary(metadata, importedAt);
      const renderInput = buildGrigliataLightingRenderInput(metadata, {
        updatedAt,
        updatedBy: user.uid,
      });

      await setDoc(
        doc(db, GRIGLIATA_BACKGROUND_LIGHTING_COLLECTION, selectedBackground.id),
        metadata,
        { merge: true }
      );
      await setDoc(
        doc(db, GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION, selectedBackground.id),
        renderInput,
        { merge: true }
      );
      await updateDoc(doc(db, 'grigliata_backgrounds', selectedBackground.id), {
        lightingSummary: summary,
        lightingEnabled: true,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });

      setLightingImportDraft(metadata);
    } catch (error) {
      console.error('Failed to import Grigliata lighting metadata:', error);
      setLightingImportError(error?.message || 'Unable to import lighting metadata.');
    } finally {
      setIsImportingLighting(false);
    }
  };

  const handleToggleLightingDebugOverlay = () => {
    setIsLightingDebugOverlayVisible((currentValue) => !currentValue);
  };

  const handleToggleLightingEnabled = async () => {
    if (!isManager || !user?.uid || !selectedBackground?.id || isLightingEnabledPending) return;

    setLightingImportError('');
    setBoardError('');
    setIsLightingEnabledPending(true);

    try {
      await updateDoc(doc(db, 'grigliata_backgrounds', selectedBackground.id), {
        lightingEnabled: selectedBackground.lightingEnabled === false,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    } catch (error) {
      console.error('Failed to update Grigliata lighting enabled state:', error);
      setLightingImportError('Unable to update computed lighting right now.');
    } finally {
      setIsLightingEnabledPending(false);
    }
  };

  const handleToggleFogOfWarEnabled = async () => {
    if (!isManager || !user?.uid || !selectedBackground?.id || isFogOfWarEnabledPending) return;

    setLightingImportError('');
    setBoardError('');
    setIsFogOfWarEnabledPending(true);

    try {
      await updateDoc(doc(db, 'grigliata_backgrounds', selectedBackground.id), {
        fogOfWarEnabled: selectedBackground.fogOfWarEnabled === false,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    } catch (error) {
      console.error('Failed to update Grigliata fog of war enabled state:', error);
      setLightingImportError('Unable to update fog of war right now.');
    } finally {
      setIsFogOfWarEnabledPending(false);
    }
  };

  const handleResetFogOfWar = async () => {
    if (!isManager || !user?.uid || !selectedBackground?.id || isFogResetPending) return;

    const confirmed = window.confirm(`Reset explored fog for "${selectedBackground.name || 'Untitled Map'}"?`);
    if (!confirmed) return;

    setLightingImportError('');
    setBoardError('');
    setIsFogResetPending(true);

    try {
      await runPaginatedWriteBatch({
        collectionName: GRIGLIATA_FOG_OF_WAR_COLLECTION,
        baseConstraints: [where('backgroundId', '==', selectedBackground.id)],
        applyDocument: ({ batch, docSnap }) => {
          batch.delete(docSnap.ref);
          return 1;
        },
      });
    } catch (error) {
      console.error('Failed to reset Grigliata fog of war:', error);
      setLightingImportError('Unable to reset fog of war right now.');
    } finally {
      setIsFogResetPending(false);
    }
  };

  const handleApplyLightingCalibration = async () => {
    if (!isManager || !user?.uid || !selectedBackground?.id) return;

    const calibrationSource = lightingImportDraft
      || (selectedBackground.id === activeBackgroundId ? lightingMetadata : null);

    if (!calibrationSource?.grid) {
      setLightingImportError('Import lighting metadata for this background before applying JSON calibration.');
      return;
    }

    setLightingImportError('');
    setCalibrationError('');
    setBoardError('');
    setIsApplyingLightingCalibration(true);

    try {
      const normalizedCalibration = normalizeGridConfig(calibrationSource.grid);
      const updatedAt = serverTimestamp();
      const renderInput = selectedBackground.id === activeBackgroundId && lightingMetadata
        ? buildGrigliataLightingRenderInput(lightingMetadata, {
          updatedAt,
          updatedBy: user.uid,
        })
        : null;

      if (selectedBackground.id === activeBackgroundId) {
        await flushPendingGridSizeAutosave();
      }

      await updateDoc(doc(db, 'grigliata_backgrounds', selectedBackground.id), {
        grid: normalizedCalibration,
        updatedAt,
        updatedBy: user.uid,
      });
      if (renderInput) {
        await setDoc(
          doc(db, GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION, selectedBackground.id),
          renderInput,
          { merge: true }
        );
      }

      setCalibrationDraft(normalizedCalibration);

      if (selectedBackground.id === activeBackgroundId) {
        setActiveGridSizeOverride({
          backgroundId: selectedBackground.id,
          grid: normalizedCalibration,
        });
      }
    } catch (error) {
      console.error('Failed to apply lighting calibration:', error);
      setLightingImportError('Unable to apply JSON calibration.');
    } finally {
      setIsApplyingLightingCalibration(false);
    }
  };

  const handlePlaceTrayToken = async (trayToken, worldPoint) => {
    if (!user?.uid) return;

    if (trayToken?.type === FOE_LIBRARY_DRAG_TYPE) {
      if (!isManager) {
        setBoardError('Only the DM can place foes from the Foes Hub.');
        return;
      }

      const foeId = typeof trayToken?.foeId === 'string' ? trayToken.foeId : '';
      if (!foeId) {
        return;
      }

      if (!activeBackgroundId) {
        setBoardError('Select a map before placing a foe.');
        return;
      }

      setBoardError('');
      const snapped = snapBoardPointToGrid(worldPoint, grid, 'center');

      try {
        await spawnGrigliataFoeTokenCallable({
          foeId,
          backgroundId: activeBackgroundId,
          col: snapped.col,
          row: snapped.row,
        });
      } catch (error) {
        console.error('Failed to spawn Grigliata foe token:', error);
        setBoardError(
          isPermissionDeniedError(error)
            ? 'Only the DM can place foes from the Foes Hub.'
            : 'Unable to place that foe right now.'
        );
      }

      return;
    }

    const tokenId = typeof trayToken?.tokenId === 'string' && trayToken.tokenId
      ? trayToken.tokenId
      : '';
    const targetToken = ownedTrayTokensById.get(tokenId);
    if (!tokenId || !targetToken) {
      return;
    }

    if (!activeBackgroundId) {
      setBoardError('Select a map before placing your token.');
      return;
    }

    if (targetToken.isHiddenByManager) {
      setBoardError('The DM is currently hiding or controlling that token.');
      return;
    }

    if (!targetToken.imageUrl) {
      setBoardError(
        tokenId === currentUserId
          ? 'Upload a profile image before placing your token.'
          : 'Upload an image for that custom token before placing it.'
      );
      return;
    }

    setBoardError('');
    const snapped = snapBoardPointToGrid(worldPoint, grid, 'center');
    try {
      if (targetToken.tokenType === 'custom') {
        await spawnGrigliataCustomTokenInstanceCallable({
          templateTokenId: tokenId,
          backgroundId: activeBackgroundId,
          col: snapped.col,
          row: snapped.row,
        });
        return;
      }

      await upsertTokenPlacement({
        backgroundId: activeBackgroundId,
        tokenId,
        ownerUid: targetToken.ownerUid,
        col: snapped.col,
        row: snapped.row,
        isVisibleToPlayers: true,
      });
    } catch (error) {
      console.error('Failed to place tray token:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'The DM is currently hiding or controlling that token.'
          : (
            targetToken.tokenType === 'custom'
              ? 'Unable to spawn that custom token right now.'
              : 'Unable to place your token right now.'
          )
      );
    }
  };

  const handleMoveTokens = async (moves) => {
    if (!user?.uid || !moves?.length) return;

    setBoardError('');
    try {
      await commitPlacementMoves(moves);
    } catch (error) {
      console.error('Failed to move selected token placements:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'The DM is currently hiding or controlling that token.'
          : 'Unable to move the selected token(s) right now.'
      );
      throw error;
    }
  };

  const handleDeleteTokens = async (tokenIds) => {
    if (!user?.uid || !tokenIds?.length || !activeBackgroundId) return;

    setBoardError('');
    try {
      await deleteActiveMapPlacements(tokenIds);
    } catch (error) {
      console.error('Failed to delete selected token placements:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'The DM is currently hiding or controlling that token.'
          : 'Unable to delete the selected token(s) right now.'
      );
      throw error;
    }
  };

  const handleSelectMouseTool = useCallback(() => {
    setBoardError('');
    setActiveAoeFigureType('');
    setIsRulerEnabled(false);
  }, []);

  const handleToggleRuler = useCallback(() => {
    setBoardError('');
    setActiveAoeFigureType('');
    setIsRulerEnabled((currentValue) => !currentValue);
  }, []);

  const handleChangeAoeFigureType = useCallback((nextFigureType) => {
    setBoardError('');
    setActiveAoeFigureType(nextFigureType || '');
    if (nextFigureType) {
      setIsRulerEnabled(false);
    }
  }, []);

  const handleCreateAoEFigure = useCallback(async (draft) => {
    if (!currentUserId || !activeBackgroundId) return false;

    const normalizedDraft = normalizeGrigliataAoEFigureDraft(draft);
    if (!normalizedDraft) return false;

    const slot = findNextGrigliataAoEFigureSlot(aoeFigureSnapshots, {
      backgroundId: activeBackgroundId,
      ownerUid: currentUserId,
      figureType: normalizedDraft.figureType,
    });

    if (!slot) {
      setBoardError(`You can place at most 5 ${normalizedDraft.figureType} templates on this map.`);
      return false;
    }

    const docId = buildGrigliataAoEFigureDocId(
      activeBackgroundId,
      currentUserId,
      normalizedDraft.figureType,
      slot
    );
    const payload = buildGrigliataAoEFigureDoc({
      backgroundId: activeBackgroundId,
      ownerUid: currentUserId,
      slot,
      colorKey: drawColorKey,
      isVisibleToPlayers: isInteractionSharingEnabled,
      showMeasurementDetails: true,
      isFilled: true,
      draft: normalizedDraft,
      createdAt: serverTimestamp(),
      createdBy: currentUserId,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId,
    });

    if (!docId || !payload) {
      return false;
    }

    setBoardError('');
    try {
      await setDoc(doc(db, GRIGLIATA_AOE_FIGURE_COLLECTION, docId), payload);
      return true;
    } catch (error) {
      console.error('Failed to create Grigliata AoE figure:', error);
      setBoardError('Unable to place that AoE template right now.');
      throw error;
    }
  }, [
    activeBackgroundId,
    aoeFigureSnapshots,
    currentUserId,
    drawColorKey,
    isInteractionSharingEnabled,
  ]);

  const handleMoveAoEFigure = useCallback(async (figureId, draft) => {
    if (!currentUserId || !figureId) return;

    const normalizedDraft = normalizeGrigliataAoEFigureDraft(draft);
    if (!normalizedDraft) return;

    const existingFigure = aoeFigureSnapshots.find((figure) => figure.id === figureId);
    if (!existingFigure) return;

    const payload = {
      originCell: normalizedDraft.originCell,
      targetCell: normalizedDraft.targetCell,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId || null,
    };

    if (existingFigure.ownerUid === currentUserId) {
      payload.isVisibleToPlayers = isInteractionSharingEnabled;
    }

    setBoardError('');
    try {
      await updateDoc(doc(db, GRIGLIATA_AOE_FIGURE_COLLECTION, figureId), payload);
    } catch (error) {
      console.error('Failed to move Grigliata AoE figure:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'That AoE template is controlled by another player.'
          : 'Unable to move that AoE template right now.'
      );
      throw error;
    }
  }, [aoeFigureSnapshots, currentUserId, isInteractionSharingEnabled]);

  const handleUpdateAoEFigurePresentation = useCallback(async (figureId, patch) => {
    if (!currentUserId || !figureId || !patch || typeof patch !== 'object') return;

    const existingFigure = aoeFigureSnapshots.find((figure) => figure.id === figureId);
    if (!existingFigure) return;

    const payload = {
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId || null,
    };

    if (typeof patch.showMeasurementDetails === 'boolean') {
      payload.showMeasurementDetails = patch.showMeasurementDetails;
    }

    if (typeof patch.isFilled === 'boolean') {
      payload.isFilled = patch.isFilled;
    }

    if (Object.keys(payload).length <= 2) {
      return;
    }

    setBoardError('');
    try {
      await updateDoc(doc(db, GRIGLIATA_AOE_FIGURE_COLLECTION, figureId), payload);
    } catch (error) {
      console.error('Failed to update Grigliata AoE figure presentation:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'That AoE template is controlled by another player.'
          : 'Unable to update that AoE template right now.'
      );
      throw error;
    }
  }, [aoeFigureSnapshots, currentUserId]);

  const handleDeleteAoEFigures = useCallback(async (figureIds) => {
    const normalizedFigureIds = [...new Set((figureIds || []).filter(Boolean))];
    if (!normalizedFigureIds.length) return;

    setBoardError('');
    try {
      for (let index = 0; index < normalizedFigureIds.length; index += FIRESTORE_BATCH_SIZE) {
        const batch = writeBatch(db);
        normalizedFigureIds.slice(index, index + FIRESTORE_BATCH_SIZE).forEach((figureId) => {
          batch.delete(doc(db, GRIGLIATA_AOE_FIGURE_COLLECTION, figureId));
        });
        await batch.commit();
      }
    } catch (error) {
      console.error('Failed to delete Grigliata AoE figures:', error);
      setBoardError(
        isPermissionDeniedError(error)
          ? 'That AoE template is controlled by another player.'
          : 'Unable to delete the selected AoE template right now.'
      );
      throw error;
    }
  }, []);

  const handleToggleInteractionSharing = useCallback(async () => {
    if (!currentUserId) return;

    const nextIsEnabled = !isInteractionSharingEnabled;
    latestRequestedInteractionSharingEnabledRef.current = nextIsEnabled;
    interactionSharingMutationPendingRef.current = true;
    setBoardError('');
    setIsInteractionSharingEnabled(nextIsEnabled);

    try {
      await persistInteractionSharingPreference(nextIsEnabled);
      await syncOwnedAoEFigureVisibility(nextIsEnabled);
    } catch (error) {
      console.error('Failed to update Grigliata interaction sharing preference:', error);
      const fallbackValue = persistedInteractionSharingEnabledRef.current;
      latestRequestedInteractionSharingEnabledRef.current = fallbackValue;
      setIsInteractionSharingEnabled(fallbackValue);
      setBoardError('Unable to update interaction sharing right now.');
    } finally {
      interactionSharingMutationPendingRef.current = false;
    }
  }, [
    currentUserId,
    isInteractionSharingEnabled,
    persistInteractionSharingPreference,
    syncOwnedAoEFigureVisibility,
  ]);

  const handleDrawColorChange = useCallback((nextColorKey) => {
    if (!currentUserId) return;

    const resolvedColorKey = resolveGrigliataDrawColorKey(nextColorKey);
    if (resolvedColorKey === latestRequestedDrawColorKeyRef.current) return;

    latestDrawColorRequestIdRef.current += 1;
    latestRequestedDrawColorKeyRef.current = resolvedColorKey;
    setBoardError('');
    setDrawColorKey(resolvedColorKey);

    scheduleDrawColorAutosave({
      colorKey: resolvedColorKey,
      requestId: latestDrawColorRequestIdRef.current,
    });
  }, [currentUserId, scheduleDrawColorAutosave]);

  const handleAdjustActiveGridSize = useCallback((delta) => {
    if (!isManager || !user?.uid || !activeBackgroundId || !Number.isFinite(delta)) return;

    const nextGrid = normalizeGridConfig({
      ...grid,
      cellSizePx: grid.cellSizePx + delta,
    });

    if (nextGrid.cellSizePx === grid.cellSizePx) return;

    setBoardError('');
    if (selectedBackgroundId === activeBackgroundId) {
      setCalibrationError('');
      setCalibrationDraft((currentDraft) => normalizeGridConfig({
        ...currentDraft,
        cellSizePx: nextGrid.cellSizePx,
      }));
    }

    setActiveGridSizeOverride({
      backgroundId: activeBackgroundId,
      cellSizePx: nextGrid.cellSizePx,
    });

    scheduleGridSizeAutosave({
      backgroundId: activeBackgroundId,
      cellSizePx: nextGrid.cellSizePx,
      fallbackCellSizePx: persistedActiveGrid.cellSizePx,
    });
  }, [
    activeBackgroundId,
    grid,
    isManager,
    persistedActiveGrid.cellSizePx,
    scheduleGridSizeAutosave,
    selectedBackgroundId,
    user?.uid,
  ]);

  const handleOpenCalibration = useCallback((backgroundId) => {
    if (backgroundId) {
      setSelectedBackgroundId(backgroundId);
    }

    if (isManager) {
      setActiveSidebarTab('calibration');
    }
  }, [isManager, setSelectedBackgroundId]);

  if (loading) {
    return <div className="px-6 py-8 text-white">Loading Grigliata...</div>;
  }

  if (!user) {
    return <div className="px-6 py-8 text-white">Please log in to access Grigliata.</div>;
  }

  return (
    <div
      className="px-3 py-3 text-white md:px-4 md:py-4 xl:h-[var(--grigliata-workspace-height)] xl:min-h-[var(--grigliata-workspace-height)] xl:overflow-hidden"
      style={{ '--grigliata-workspace-height': workspaceHeight }}
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        {boardError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-900/20 px-4 py-2.5 text-sm text-red-200">
            {boardError}
          </div>
        )}

        <div className="grid flex-1 min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className={`min-w-0 xl:min-h-0 ${isTrayDragging ? 'rounded-3xl ring-2 ring-amber-400/20' : ''}`}>
            <div className="h-full min-h-[480px] xl:min-h-0">
              <GrigliataBoard
                key={activeBackgroundId || '__grid__'}
                activeBackground={displayBackground}
                combatBackgroundName={combatBackground?.name || ''}
                grid={grid}
                isGridVisible={isNarrationOverlayActive ? false : isGridVisible}
                tokens={visibleBoardTokens}
                aoeFigures={visibleAoeFigures}
                currentUserId={user.uid}
                isManager={isManager}
                isTokenDragActive={isTrayDragging && !isNarrationOverlayActive}
                activeTrayDragType={activeTrayDragType}
                isRulerEnabled={isRulerEnabled}
                activeAoeFigureType={isNarrationOverlayActive ? '' : activeAoeFigureType}
                isInteractionSharingEnabled={isInteractionSharingEnabled}
                isMusicMuted={isMusicMuted}
                isMusicMutePending={isMusicMutePending}
                drawTheme={drawTheme}
                onSelectMouseTool={isNarrationOverlayActive ? null : handleSelectMouseTool}
                onToggleRuler={isNarrationOverlayActive ? null : handleToggleRuler}
                onChangeAoeFigureType={isNarrationOverlayActive ? null : handleChangeAoeFigureType}
                onToggleInteractionSharing={isNarrationOverlayActive ? null : handleToggleInteractionSharing}
                onToggleMusicMuted={handleToggleMusicMuted}
                onChangeDrawColor={isNarrationOverlayActive ? null : handleDrawColorChange}
                onToggleGridVisibility={isManager && !isNarrationOverlayActive ? handleToggleGridVisibility : null}
                isGridVisibilityToggleDisabled={!activeBackgroundId || gridVisibilityUpdateBackgroundId === activeBackgroundId || isNarrationOverlayActive}
                onDeactivateActiveBackground={isManager ? handleDeactivateActiveBackground : null}
                isDeactivateActiveBackgroundDisabled={!activeBackgroundId || isActiveBackgroundDeactivationPending || isCombatMapChangeLocked}
                isTurnOrderEnabled={isTurnOrderEnabled}
                turnOrderEntries={turnOrderEntries}
                isTurnOrderStarted={isTurnOrderStarted}
                activeTurnTokenId={activeTurnTokenId}
                onStartTurnOrder={isManager && !isNarrationOverlayActive ? handleStartTurnOrder : null}
                onAdvanceTurnOrder={isManager && !isNarrationOverlayActive ? handleAdvanceTurnOrder : null}
                isTurnOrderProgressPending={isTurnOrderProgressPending}
                onResetTurnOrder={isManager && !isNarrationOverlayActive ? handleResetTurnOrder : null}
                isTurnOrderResetPending={isTurnOrderResetPending}
                onJoinTurnOrder={isNarrationOverlayActive ? null : handleJoinTurnOrder}
                onLeaveTurnOrder={isNarrationOverlayActive ? null : handleLeaveTurnOrder}
                turnOrderActionTokenId={turnOrderActionTokenId}
                onSaveTurnOrderInitiative={isNarrationOverlayActive ? null : handleSaveTurnOrderInitiative}
                savingTurnOrderInitiativeTokenId={savingTurnOrderInitiativeTokenId}
                onAdjustGridSize={isManager && !isNarrationOverlayActive ? handleAdjustActiveGridSize : null}
                isGridSizeAdjustmentDisabled={!activeBackgroundId || isNarrationOverlayActive}
                onMoveTokens={isNarrationOverlayActive ? null : handleMoveTokens}
                onDeleteTokens={isNarrationOverlayActive ? null : handleDeleteTokens}
                onCreateAoEFigure={isNarrationOverlayActive ? null : handleCreateAoEFigure}
                onMoveAoEFigure={isNarrationOverlayActive ? null : handleMoveAoEFigure}
                onUpdateAoEFigurePresentation={isNarrationOverlayActive ? null : handleUpdateAoEFigurePresentation}
                onDeleteAoEFigures={isNarrationOverlayActive ? null : handleDeleteAoEFigures}
                onSetSelectedTokensVisibility={isManager && !isNarrationOverlayActive ? handleSetSelectedTokensVisibility : null}
                isTokenVisibilityActionPending={isTokenVisibilityActionPending}
                onSetSelectedTokensDeadState={isManager && !isNarrationOverlayActive ? handleSetSelectedTokensDeadState : null}
                isTokenDeadActionPending={isTokenDeadActionPending}
                onUpdateTokenStatuses={isNarrationOverlayActive ? null : handleUpdateTokenStatuses}
                isTokenStatusActionPending={isTokenStatusActionPending}
                onSetSelectedTokenSize={isNarrationOverlayActive ? null : handleSetSelectedTokenSize}
                isTokenSizeActionPending={isTokenSizeActionPending}
                onSetSelectedTokenVision={isManager && !isNarrationOverlayActive ? handleSetSelectedTokenVision : null}
                isTokenVisionActionPending={isTokenVisionActionPending}
                selectedTokenDetails={isNarrationOverlayActive ? null : selectedTokenDetails}
                sharedInteractions={visibleSharedInteractions}
                activeViewers={activePageViewers}
                lightingRenderInput={enabledLightingRenderInput}
                lightingDebugMetadata={lightingMetadata}
                showLightingDebugOverlay={isManager && isLightingDebugOverlayVisible && !!lightingMetadata}
                fogOfWar={boardFogOfWar}
                onSharedInteractionChange={isNarrationOverlayActive ? null : handleSharedInteractionChange}
                onSelectedTokenIdsChange={setSelectedBoardTokenIds}
                onDropCurrentToken={isNarrationOverlayActive ? null : ((payload, worldPoint) => {
                  setActiveTrayDragType('');
                  handlePlaceTrayToken(payload, worldPoint);
                })}
                isNarrationOverlayActive={isNarrationOverlayActive}
              />
            </div>
          </div>

          <aside className="flex flex-col gap-3 xl:h-full xl:min-h-0">
            <div className="rounded-2xl border border-slate-700 bg-slate-950/75 p-2 shadow-2xl backdrop-blur-sm">
              <div
                className={sidebarTabListClassName}
                role="tablist"
                aria-label="Grigliata sidebar tabs"
              >
                {sidebarTabs.map((tab) => {
                  const isActive = activeSidebarTab === tab.key;

                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`grigliata-sidebar-panel-${tab.key}`}
                      onClick={() => setActiveSidebarTab(tab.key)}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition-colors ${
                        isActive
                          ? 'bg-amber-400 text-black shadow-lg'
                          : 'border border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1 custom-scroll">
              <div
                id={`grigliata-sidebar-panel-${activeSidebarTab}`}
                role="tabpanel"
                className="space-y-3"
              >
                {activeSidebarTab === 'tokens' && (
                  <MyTokenTray
                    currentUserId={currentUserId}
                    isManager={isManager}
                    currentUserToken={trayCurrentUserToken}
                    customTokens={customUserTokens}
                    foeLibrary={foeLibrary}
                    selectedTokenDetails={selectedTokenDetails}
                    activeMapName={combatBackground?.name || ''}
                    hasActiveMap={!!activeBackgroundId}
                    onDragStart={(payload) => setActiveTrayDragType(payload?.type || 'grigliata-token')}
                    onDragEnd={() => setActiveTrayDragType('')}
                    onCreateCustomToken={handleCreateCustomToken}
                    isCreatingCustomToken={isCreatingCustomToken}
                    onUpdateCustomToken={handleUpdateCustomToken}
                    updatingCustomTokenId={updatingCustomTokenId}
                    onDeleteCustomToken={handleDeleteCustomToken}
                    deletingCustomTokenId={deletingCustomTokenId}
                    onSaveSelectedTokenDetails={handleSaveSelectedTokenDetails}
                    savingSelectedTokenDetailsId={savingSelectedTokenDetailsId}
                    onUpdateFoeToken={handleUpdateFoeToken}
                    savingFoeTokenId={savingFoeTokenId}
                  />
                )}

                {isManager && activeSidebarTab === 'gallery' && (
                  <BackgroundGalleryPanel
                    backgrounds={backgrounds}
                    activeBackgroundId={activeBackgroundId}
                    presentationBackgroundId={presentationBackgroundId}
                    selectedBackgroundId={selectedBackgroundId}
                    uploadName={uploadName}
                    selectedFileName={selectedFile?.name || ''}
                    uploadError={uploadError}
                    isUploading={isUploading}
                    activatingBackgroundId={activatingBackgroundId}
                    narrationActionBackgroundId={narrationActionBackgroundId}
                    isNarrationActionPending={isNarrationActionPending}
                    isNarrationClosePending={isNarrationClosePending}
                    deletingBackgroundId={deletingBackgroundId}
                    clearingTokensBackgroundId={clearingTokensBackgroundId}
                    isUseBackgroundDisabled={isCombatMapChangeLocked}
                    destructiveActionLockedBackgroundIds={destructiveGalleryLockBackgroundIds}
                    onUploadNameChange={setUploadName}
                    onUploadFileChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setSelectedFile(file);
                      setUploadError('');
                      if (file && !uploadName.trim()) {
                        setUploadName(getDisplayNameFromFileName(file.name));
                      }
                    }}
                    onUploadBackground={handleUploadBackground}
                    onSelectBackground={setSelectedBackgroundId}
                    onUseBackground={handleUseBackground}
                    onNarrateBackground={handleStartNarration}
                    onCloseNarration={handleStopNarration}
                    onClearTokensForBackground={handleClearTokensForBackground}
                    onDeleteBackground={handleDeleteBackground}
                    onCalibrateBackground={handleOpenCalibration}
                  />
                )}

                {isManager && activeSidebarTab === 'music' && (
                  <MusicLibraryPanel
                    tracks={musicTracks}
                    activePlaybackState={normalizedMusicPlaybackState}
                    uploadName={musicUploadName}
                    selectedFileName={musicSelectedFile?.name || ''}
                    uploadError={musicUploadError}
                    isUploading={isMusicUploading}
                    deletingTrackId={deletingMusicTrackId}
                    playbackActionTrackId={musicPlaybackActionTrackId}
                    playbackActionType={musicPlaybackActionType}
                    onUploadNameChange={setMusicUploadName}
                    onUploadFileChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setMusicSelectedFile(file);
                      setMusicUploadError('');
                      if (file && !musicUploadName.trim()) {
                        setMusicUploadName(getDisplayNameFromFileName(file.name));
                      }
                    }}
                    onUploadTrack={handleUploadMusicTrack}
                    onSharedVolumeChange={handleSharedMusicVolumeChange}
                    onSharedVolumeCommit={handleSharedMusicVolumeCommit}
                    onPlayTrack={handlePlayMusicTrack}
                    onPauseTrack={handlePauseMusicTrack}
                    onResumeTrack={handleResumeMusicTrack}
                    onStopTrack={handleStopMusicTrack}
                    onDeleteTrack={handleDeleteMusicTrack}
                  />
                )}

                {isManager && activeSidebarTab === 'calibration' && (
                  <MapCalibrationPanel
                    selectedBackground={selectedBackground}
                    calibrationDraft={calibrationDraft}
                    calibrationError={calibrationError}
                    isSavingCalibration={isSavingCalibration}
                    onCalibrationDraftChange={(field, value) => {
                      setCalibrationDraft((currentDraft) => ({
                        ...currentDraft,
                        [field]: value,
                      }));
                    }}
                    onSaveCalibration={handleSaveCalibration}
                    onResetCalibration={() => setCalibrationDraft(DEFAULT_GRID)}
                  />
                )}

                {isManager && activeSidebarTab === 'lighting' && (
                  <GrigliataLightingImportPanel
                    selectedBackground={selectedBackground}
                    selectedFileName={lightingSelectedFile?.name || ''}
                    importError={lightingImportError}
                    importWarnings={lightingImportDraft?.importWarnings || null}
                    isImporting={isImportingLighting}
                    isApplyingCalibration={isApplyingLightingCalibration}
                    isLightingEnabled={selectedBackground?.lightingEnabled !== false}
                    isLightingEnabledPending={isLightingEnabledPending}
                    isFogOfWarEnabled={selectedBackground?.fogOfWarEnabled !== false}
                    isFogOfWarEnabledPending={isFogOfWarEnabledPending}
                    isFogResetPending={isFogResetPending}
                    isDebugOverlayVisible={isLightingDebugOverlayVisible}
                    hasLightingMetadata={!!lightingMetadata}
                    lightingMetadataDraft={lightingImportDraft}
                    lightingMetadata={selectedBackground?.id === activeBackgroundId ? lightingMetadata : null}
                    onLightingFileChange={handleLightingFileChange}
                    onImportLightingMetadata={handleImportLightingMetadata}
                    onApplyLightingCalibration={handleApplyLightingCalibration}
                    onToggleLightingEnabled={handleToggleLightingEnabled}
                    onToggleFogOfWarEnabled={handleToggleFogOfWarEnabled}
                    onResetFogOfWar={handleResetFogOfWar}
                    onToggleDebugOverlay={handleToggleLightingDebugOverlay}
                  />
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
