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
  getDocs,
  limit,
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
import MusicLibraryPanel from './MusicLibraryPanel';
import {
  buildPlacementDocId,
  buildStorageSafeName,
  getDisplayNameFromFileName,
  getFileExtension,
  getFileExtensionFromContentType,
  isManagerRole,
  normalizeGridConfig,
  readFileImageDimensions,
  snapBoardPointToGrid,
} from './boardUtils';
import {
  DEFAULT_GRID,
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
import { preloadImageAssets, scheduleImageAssetPreload } from './imageAssetRegistry';
import useGrigliataPageData from './useGrigliataPageData';

const MAX_BACKGROUND_FILE_BYTES = 15 * 1024 * 1024;
const MAX_CUSTOM_TOKEN_FILE_BYTES = 8 * 1024 * 1024;
const FIRESTORE_BATCH_SIZE = 450;
const PLACEMENT_RULE_SAFE_BATCH_SIZE = 10;
const PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE = PLACEMENT_RULE_SAFE_BATCH_SIZE;
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

const deleteGrigliataCustomTokenCallable = httpsCallable(functions, GRIGLIATA_CUSTOM_TOKEN_DELETE_FUNCTION);

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
);
const SIDEBAR_TAB_GRID_CLASS_NAMES = {
  1: 'grid grid-cols-1 gap-2',
  2: 'grid grid-cols-2 gap-2',
  3: 'grid grid-cols-3 gap-2',
  4: 'grid grid-cols-2 gap-2',
};
const DEFAULT_SIDEBAR_TAB_GRID_CLASS_NAME = SIDEBAR_TAB_GRID_CLASS_NAMES[3];
const MAX_DEFERRED_GALLERY_IMAGE_PRELOADS = 6;
const collectUniqueImageUrls = (urls) => [...new Set(
  (urls || []).map((url) => (typeof url === 'string' ? url.trim() : '')).filter(Boolean)
)];

export default function GrigliataPage() {
  const { user, userData, loading } = useAuth();
  const currentUserId = user?.uid || '';
  const currentUserEmail = user?.email || '';
  const currentCharacterId = typeof userData?.characterId === 'string' ? userData.characterId.trim() : '';
  const currentImageUrl = typeof userData?.imageUrl === 'string' ? userData.imageUrl.trim() : '';
  const currentImagePath = typeof userData?.imagePath === 'string' ? userData.imagePath.trim() : '';
  const currentTokenLabel = currentCharacterId || currentUserEmail.split('@')[0] || 'Player';
  const persistedDrawColorKey = resolveGrigliataDrawColorKey(userData?.settings?.grigliata_draw_color);
  const persistedInteractionSharingEnabled = userData?.settings?.[GRIGLIATA_SHARE_INTERACTIONS_FIELD] === true;
  const isMusicMuted = userData?.settings?.[GRIGLIATA_MUSIC_MUTED_FIELD] === true;
  const [navbarOffset, setNavbarOffset] = useState(0);
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
  const [deletingBackgroundId, setDeletingBackgroundId] = useState('');
  const [clearingTokensBackgroundId, setClearingTokensBackgroundId] = useState('');
  const [deletingMusicTrackId, setDeletingMusicTrackId] = useState('');
  const [musicPlaybackActionTrackId, setMusicPlaybackActionTrackId] = useState('');
  const [musicPlaybackActionType, setMusicPlaybackActionType] = useState('');
  const [calibrationDraft, setCalibrationDraft] = useState(DEFAULT_GRID);
  const [calibrationError, setCalibrationError] = useState('');
  const [isSavingCalibration, setIsSavingCalibration] = useState(false);
  const [boardError, setBoardError] = useState('');
  const [isTrayDragging, setIsTrayDragging] = useState(false);
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
  const [gridVisibilityUpdateBackgroundId, setGridVisibilityUpdateBackgroundId] = useState('');
  const [isTokenVisibilityActionPending, setIsTokenVisibilityActionPending] = useState(false);
  const [isTokenDeadActionPending, setIsTokenDeadActionPending] = useState(false);
  const [isTokenStatusActionPending, setIsTokenStatusActionPending] = useState(false);
  const [isCreatingCustomToken, setIsCreatingCustomToken] = useState(false);
  const [updatingCustomTokenId, setUpdatingCustomTokenId] = useState('');
  const [deletingCustomTokenId, setDeletingCustomTokenId] = useState('');

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
    activeBackground,
    activeBackgroundId,
    activePlacementsById,
    aoeFigureSnapshots,
    backgrounds,
    boardState,
    boardTokens,
    currentUserToken,
    currentUserTokenProfileDoc,
    customUserTokens,
    grid,
    isCurrentUserTokenHiddenOnActiveMap,
    isGridVisible,
    musicPlaybackState,
    musicTracks,
    persistedActiveGrid,
    selectedBackground,
    selectedBackgroundId,
    setSelectedBackgroundId,
    sharedInteractions,
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
  const ownedTrayTokensById = useMemo(() => new Map(
    [currentUserToken, ...customUserTokens]
      .filter((token) => token?.tokenId && token?.ownerUid === currentUserId)
      .map((token) => [token.tokenId, token])
  ), [currentUserId, currentUserToken, customUserTokens]);
  const drawTheme = useMemo(
    () => getGrigliataDrawTheme(drawColorKey),
    [drawColorKey]
  );
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
      ]
      : [{ key: 'tokens', label: 'Tokens' }]
  ), [isManager]);
  const sidebarTabListClassName = SIDEBAR_TAB_GRID_CLASS_NAMES[sidebarTabs.length]
    || DEFAULT_SIDEBAR_TAB_GRID_CLASS_NAME;
  const isGallerySidebarActive = isManager && activeSidebarTab === 'gallery';
  const immediateImageUrls = useMemo(() => collectUniqueImageUrls([
    activeBackground?.imageUrl,
    currentUserToken?.imageUrl,
    ...customUserTokens.map((token) => token?.imageUrl),
    ...boardTokens.map((token) => token?.imageUrl),
  ]), [activeBackground?.imageUrl, boardTokens, currentUserToken?.imageUrl, customUserTokens]);
  const deferredGalleryImageUrls = useMemo(() => {
    if (!isGallerySidebarActive) {
      return [];
    }

    const immediateImageUrlSet = new Set(immediateImageUrls);
    return collectUniqueImageUrls(
      backgrounds
        .map((background) => background?.imageUrl)
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
    const navbar = document.querySelector('[data-navbar]');
    if (!navbar) return undefined;

    const updateOffset = () => {
      const { height } = navbar.getBoundingClientRect();
      setNavbarOffset(Math.ceil(height));
    };

    updateOffset();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateOffset);
      observer.observe(navbar);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateOffset);
    return () => window.removeEventListener('resize', updateOffset);
  }, []);

  useEffect(() => {
    setLocalLiveInteraction(null);
  }, [activeBackgroundId]);

  useEffect(() => {
    const nextCalibrationBackgroundId = selectedBackground?.id || '';
    if (calibrationSelectionRef.current === nextCalibrationBackgroundId) return;

    calibrationSelectionRef.current = nextCalibrationBackgroundId;
    setCalibrationDraft(normalizeGridConfig(selectedBackground?.grid));
    setCalibrationError('');
  }, [selectedBackground?.grid, selectedBackground?.id]);

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

  const workspaceHeight = navbarOffset
    ? `calc(100vh - ${navbarOffset}px)`
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

  const clearPlacementsForBackground = async (backgroundId) => {
    if (!backgroundId) return 0;

    let deletedCount = 0;

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

    if (persistedActiveGrid.cellSizePx === activeGridSizeOverride.cellSizePx) {
      setActiveGridSizeOverride(null);
    }
  }, [activeBackgroundId, activeGridSizeOverride, persistedActiveGrid.cellSizePx]);

  useEffect(() => (
    () => {
      void flushPendingDrawColorAutosave();
      void flushPendingGridSizeAutosave();
    }
  ), [activeBackgroundId, flushPendingDrawColorAutosave, flushPendingGridSizeAutosave]);

  const buildPlacementWritePayload = useCallback(({
    backgroundId,
    tokenId,
    ownerUid,
    col,
    row,
    isVisibleToPlayers,
    isDead,
    statuses,
  }) => {
    const resolvedTokenId = typeof tokenId === 'string' && tokenId ? tokenId : ownerUid;
    const placementId = buildPlacementDocId(backgroundId, resolvedTokenId);
    const existingPlacement = activePlacementsById.get(placementId);
    const resolvedIsVisibleToPlayers = typeof isVisibleToPlayers === 'boolean'
      ? isVisibleToPlayers
      : existingPlacement?.isVisibleToPlayers !== false;
    const resolvedIsDead = typeof isDead === 'boolean'
      ? isDead
      : existingPlacement?.isDead === true;
    const resolvedStatuses = Array.isArray(statuses)
      ? statuses
      : (Array.isArray(existingPlacement?.statuses) ? existingPlacement.statuses : null);
    const ownedTrayToken = ownedTrayTokensById.get(resolvedTokenId) || null;
    const existingLabel = typeof existingPlacement?.label === 'string' ? existingPlacement.label.trim() : '';
    const ownedLabel = typeof ownedTrayToken?.label === 'string' ? ownedTrayToken.label.trim() : '';
    const existingImageUrl = typeof existingPlacement?.imageUrl === 'string' ? existingPlacement.imageUrl.trim() : '';
    const ownedImageUrl = typeof ownedTrayToken?.imageUrl === 'string' ? ownedTrayToken.imageUrl.trim() : '';
    const resolvedLabel = existingLabel || ownedLabel || ownerUid || 'Player';
    const resolvedImageUrl = existingImageUrl || ownedImageUrl;

    return {
      backgroundId,
      tokenId: resolvedTokenId,
      ownerUid,
      label: resolvedLabel,
      imageUrl: resolvedImageUrl,
      col,
      row,
      isVisibleToPlayers: resolvedIsVisibleToPlayers,
      isDead: resolvedIsDead,
      ...(resolvedStatuses !== null ? { statuses: resolvedStatuses } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId || null,
    };
  }, [activePlacementsById, currentUserId, ownedTrayTokensById]);

  const upsertTokenPlacement = async ({
    backgroundId,
    tokenId,
    ownerUid,
    col,
    row,
    isVisibleToPlayers,
    isDead,
    statuses,
  }) => {
    const resolvedTokenId = typeof tokenId === 'string' && tokenId ? tokenId : ownerUid;
    const placementId = buildPlacementDocId(backgroundId, resolvedTokenId);
    const placementPayload = buildPlacementWritePayload({
      backgroundId,
      tokenId: resolvedTokenId,
      ownerUid,
      col,
      row,
      isVisibleToPlayers,
      isDead,
      statuses,
    });
    const isHidden = placementPayload.isVisibleToPlayers === false;
    const batch = writeBatch(db);

    batch.set(doc(db, 'grigliata_token_placements', placementId), placementPayload, { merge: true });
    batch.set(
      doc(db, 'users', ownerUid),
      buildHiddenPlacementSettingsPayload({
        backgroundId,
        tokenId: resolvedTokenId,
        isHidden,
        includeLegacyBackgroundFallback: isLegacyHiddenPlacementToken({
          tokenId: resolvedTokenId,
          ownerUid,
        }),
      }),
      { merge: true }
    );

    await batch.commit();
  };

  const getActiveMapPlacementContexts = (tokenIds) => {
    if (!activeBackgroundId) {
      return [];
    }

    return [...new Set((tokenIds || []).filter(Boolean))]
      .map((tokenId) => {
        const placementId = buildPlacementDocId(activeBackgroundId, tokenId);
        const placement = activePlacementsById.get(placementId);
        if (!placement) {
          return null;
        }

        return {
          tokenId,
          ownerUid: placement.ownerUid,
          placementId,
          col: Number.isFinite(placement?.col) ? placement.col : 0,
          row: Number.isFinite(placement?.row) ? placement.row : 0,
        };
      })
      .filter(Boolean);
  };

  const commitPlacementMoves = async (moves) => {
    const normalizedMoves = [...new Map(
      (moves || [])
        .map((move) => {
          const resolvedTokenId = move?.tokenId || move?.ownerUid || '';
          if (!move?.backgroundId || !move?.ownerUid || !resolvedTokenId) {
            return null;
          }

          return [
            buildPlacementDocId(move.backgroundId, resolvedTokenId),
            {
              ...move,
              tokenId: resolvedTokenId,
            },
          ];
        })
        .filter(Boolean)
    ).values()];

    for (let index = 0; index < normalizedMoves.length; index += PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE) {
      const batch = writeBatch(db);
      normalizedMoves.slice(index, index + PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE).forEach((move) => {
        const placementPayload = buildPlacementWritePayload(move);
        const isHidden = placementPayload.isVisibleToPlayers === false;
        batch.set(
          doc(db, 'grigliata_token_placements', buildPlacementDocId(move.backgroundId, move.tokenId)),
          placementPayload,
          { merge: true }
        );
        batch.set(
          doc(db, 'users', move.ownerUid),
          buildHiddenPlacementSettingsPayload({
            backgroundId: move.backgroundId,
            tokenId: move.tokenId,
            isHidden,
            includeLegacyBackgroundFallback: isLegacyHiddenPlacementToken({
              tokenId: move.tokenId,
              ownerUid: move.ownerUid,
            }),
          }),
          { merge: true }
        );
      });
      await batch.commit();
    }
  };

  const deleteActiveMapPlacements = async (tokenIds) => {
    const targetPlacements = getActiveMapPlacementContexts(tokenIds);
    if (!targetPlacements.length) return;

    for (let index = 0; index < targetPlacements.length; index += PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE) {
      const batch = writeBatch(db);
      targetPlacements.slice(index, index + PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE).forEach(({ ownerUid, placementId, tokenId }) => {
        batch.delete(doc(db, 'grigliata_token_placements', placementId));
        batch.set(
          doc(db, 'users', ownerUid),
          buildHiddenPlacementSettingsPayload({
            backgroundId: activeBackgroundId,
            tokenId,
            isHidden: false,
            includeLegacyBackgroundFallback: isLegacyHiddenPlacementToken({ tokenId, ownerUid }),
          }),
          { merge: true }
        );
      });
      await batch.commit();
    }
  };

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

  const handleCreateCustomToken = async ({ label, imageFile }) => {
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

    setBoardError('');
    setIsCreatingCustomToken(true);
    try {
      const { imageUrl, imagePath } = await uploadCustomTokenImage({
        file: imageFile,
        tokenLabel: trimmedLabel,
      });
      uploadedPath = imagePath;

      await addDoc(collection(db, 'grigliata_tokens'), {
        ownerUid: currentUserId,
        characterId: '',
        label: trimmedLabel,
        imageUrl,
        imagePath,
        tokenType: 'custom',
        imageSource: 'uploaded',
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

      await setDoc(doc(db, 'grigliata_tokens', tokenId), {
        ownerUid: currentUserId,
        label: trimmedLabel,
        imageUrl: nextImageUrl,
        imagePath: nextImagePath,
        tokenType: 'custom',
        imageSource: 'uploaded',
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId,
      }, { merge: true });

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

  const handleUploadBackground = async () => {
    if (!isManager || !user?.uid) return;

    setUploadError('');
    const file = selectedFile;

    if (!file) {
      setUploadError('Select an image file first.');
      return;
    }

    if (!file.type?.startsWith('image/')) {
      setUploadError('The selected file must be an image.');
      return;
    }

    if (file.size > MAX_BACKGROUND_FILE_BYTES) {
      setUploadError('Background images must be 15 MB or smaller.');
      return;
    }

    const mapName = (uploadName || getDisplayNameFromFileName(file.name)).trim();
    const safeName = buildStorageSafeName(mapName, 'grigliata_map');
    const fileExtension = getFileExtension(file.name) || '.png';
    const storagePath = `grigliata/backgrounds/${user.uid}/${safeName}_${Date.now()}${fileExtension}`;
    let uploadedPath = '';

    setIsUploading(true);
    try {
      const { width, height } = await readFileImageDimensions(file);
      const fileRef = storageRef(storage, storagePath);
      await uploadBytes(fileRef, file);
      uploadedPath = storagePath;
      const imageUrl = await getDownloadURL(fileRef);

      await addDoc(collection(db, 'grigliata_backgrounds'), {
        name: mapName || 'Untitled Map',
        imageUrl,
        imagePath: storagePath,
        imageWidth: width,
        imageHeight: height,
        grid: normalizeGridConfig(DEFAULT_GRID),
        isGridVisible: true,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });

      setSelectedFile(null);
      setUploadName('');
      setUploadError('');
    } catch (error) {
      console.error('Failed to upload background:', error);
      setUploadError('Failed to upload the selected image.');

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

  const handleSetSelectedTokensVisibility = async (tokenIds, nextIsVisibleToPlayers) => {
    if (
      !isManager
      || !currentUserId
      || !activeBackgroundId
      || typeof nextIsVisibleToPlayers !== 'boolean'
    ) {
      return;
    }

    const targetPlacements = getActiveMapPlacementContexts(tokenIds);
    if (!targetPlacements.length) {
      return;
    }

    setBoardError('');
    setIsTokenVisibilityActionPending(true);
    try {
      for (let index = 0; index < targetPlacements.length; index += PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE) {
        const batch = writeBatch(db);

        targetPlacements.slice(index, index + PLACEMENT_AND_USER_SETTINGS_BATCH_SIZE).forEach(({ ownerUid, placementId, tokenId, col, row }) => {
          batch.set(
            doc(db, 'grigliata_token_placements', placementId),
            buildPlacementWritePayload({
              backgroundId: activeBackgroundId,
              tokenId,
              ownerUid,
              col,
              row,
              isVisibleToPlayers: nextIsVisibleToPlayers,
            }),
            { merge: true }
          );
          batch.set(
            doc(db, 'users', ownerUid),
            buildHiddenPlacementSettingsPayload({
              backgroundId: activeBackgroundId,
              tokenId,
              isHidden: nextIsVisibleToPlayers === false,
              includeLegacyBackgroundFallback: isLegacyHiddenPlacementToken({ tokenId, ownerUid }),
            }),
            { merge: true }
          );
        });

        await batch.commit();
      }
    } catch (error) {
      console.error('Failed to update selected token visibility:', error);
      setBoardError('Unable to update the selected token visibility.');
    } finally {
      setIsTokenVisibilityActionPending(false);
    }
  };

  const handleSetSelectedTokensDeadState = async (tokenIds, nextIsDead) => {
    if (
      !isManager
      || !currentUserId
      || !activeBackgroundId
      || typeof nextIsDead !== 'boolean'
    ) {
      return;
    }

    const targetPlacements = getActiveMapPlacementContexts(tokenIds);
    if (!targetPlacements.length) {
      return;
    }

    setBoardError('');
    setIsTokenDeadActionPending(true);
    try {
      for (let index = 0; index < targetPlacements.length; index += PLACEMENT_RULE_SAFE_BATCH_SIZE) {
        const batch = writeBatch(db);

        targetPlacements.slice(index, index + PLACEMENT_RULE_SAFE_BATCH_SIZE).forEach(({ ownerUid, placementId, tokenId, col, row }) => {
          batch.set(
            doc(db, 'grigliata_token_placements', placementId),
            buildPlacementWritePayload({
              backgroundId: activeBackgroundId,
              tokenId,
              ownerUid,
              col,
              row,
              isDead: nextIsDead,
            }),
            { merge: true }
          );
        });

        await batch.commit();
      }
    } catch (error) {
      console.error('Failed to update selected token dead state:', error);
      setBoardError('Unable to update the selected token dead state.');
    } finally {
      setIsTokenDeadActionPending(false);
    }
  };

  const handleUpdateTokenStatuses = async (tokenId, nextStatuses) => {
    if (!currentUserId || !activeBackgroundId || !tokenId || !Array.isArray(nextStatuses)) {
      return;
    }

    const targetPlacement = getActiveMapPlacementContexts([tokenId])[0];
    if (!targetPlacement) {
      return;
    }

    const normalizedStatuses = nextStatuses.filter((statusId) => typeof statusId === 'string' && statusId);

    setBoardError('');
    setIsTokenStatusActionPending(true);
    try {
      await setDoc(
        doc(db, 'grigliata_token_placements', targetPlacement.placementId),
        buildPlacementWritePayload({
          backgroundId: activeBackgroundId,
          tokenId,
          ownerUid: targetPlacement.ownerUid,
          col: targetPlacement.col,
          row: targetPlacement.row,
          statuses: normalizedStatuses,
        }),
        { merge: true }
      );
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

  const handleClearTokensForBackground = async (background) => {
    if (!isManager || !user?.uid || !background?.id) return;

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
          cellSizePx: normalizedCalibration.cellSizePx,
        });
      }
    } catch (error) {
      console.error('Failed to save calibration:', error);
      setCalibrationError('Unable to save calibration changes.');
    } finally {
      setIsSavingCalibration(false);
    }
  };

  const handlePlaceTrayToken = async (trayToken, worldPoint) => {
    if (!user?.uid) return;

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
          : 'Unable to place your token right now.'
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
                activeBackground={activeBackground}
                grid={grid}
                isGridVisible={isGridVisible}
                tokens={boardTokens}
                aoeFigures={aoeFigureSnapshots}
                currentUserId={user.uid}
                isManager={isManager}
                isTokenDragActive={isTrayDragging}
                isRulerEnabled={isRulerEnabled}
                activeAoeFigureType={activeAoeFigureType}
                isInteractionSharingEnabled={isInteractionSharingEnabled}
                isMusicMuted={isMusicMuted}
                isMusicMutePending={isMusicMutePending}
                drawTheme={drawTheme}
                onSelectMouseTool={handleSelectMouseTool}
                onToggleRuler={handleToggleRuler}
                onChangeAoeFigureType={handleChangeAoeFigureType}
                onToggleInteractionSharing={handleToggleInteractionSharing}
                onToggleMusicMuted={handleToggleMusicMuted}
                onChangeDrawColor={handleDrawColorChange}
                onToggleGridVisibility={isManager ? handleToggleGridVisibility : null}
                isGridVisibilityToggleDisabled={!activeBackgroundId || gridVisibilityUpdateBackgroundId === activeBackgroundId}
                onAdjustGridSize={isManager ? handleAdjustActiveGridSize : null}
                isGridSizeAdjustmentDisabled={!activeBackgroundId}
                onMoveTokens={handleMoveTokens}
                onDeleteTokens={handleDeleteTokens}
                onCreateAoEFigure={handleCreateAoEFigure}
                onMoveAoEFigure={handleMoveAoEFigure}
                onDeleteAoEFigures={handleDeleteAoEFigures}
                onSetSelectedTokensVisibility={isManager ? handleSetSelectedTokensVisibility : null}
                isTokenVisibilityActionPending={isTokenVisibilityActionPending}
                onSetSelectedTokensDeadState={isManager ? handleSetSelectedTokensDeadState : null}
                isTokenDeadActionPending={isTokenDeadActionPending}
                onUpdateTokenStatuses={handleUpdateTokenStatuses}
                isTokenStatusActionPending={isTokenStatusActionPending}
                sharedInteractions={sharedInteractions}
                onSharedInteractionChange={handleSharedInteractionChange}
                onDropCurrentToken={(payload, worldPoint) => {
                  setIsTrayDragging(false);
                  handlePlaceTrayToken(payload, worldPoint);
                }}
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
                    currentUserToken={currentUserToken}
                    customTokens={customUserTokens}
                    activeMapName={activeBackground?.name || ''}
                    onDragStart={() => setIsTrayDragging(true)}
                    onDragEnd={() => setIsTrayDragging(false)}
                    onCreateCustomToken={handleCreateCustomToken}
                    isCreatingCustomToken={isCreatingCustomToken}
                    onUpdateCustomToken={handleUpdateCustomToken}
                    updatingCustomTokenId={updatingCustomTokenId}
                    onDeleteCustomToken={handleDeleteCustomToken}
                    deletingCustomTokenId={deletingCustomTokenId}
                  />
                )}

                {isManager && activeSidebarTab === 'gallery' && (
                  <BackgroundGalleryPanel
                    backgrounds={backgrounds}
                    activeBackgroundId={activeBackgroundId}
                    selectedBackgroundId={selectedBackgroundId}
                    uploadName={uploadName}
                    selectedFileName={selectedFile?.name || ''}
                    uploadError={uploadError}
                    isUploading={isUploading}
                    activatingBackgroundId={activatingBackgroundId}
                    deletingBackgroundId={deletingBackgroundId}
                    clearingTokensBackgroundId={clearingTokensBackgroundId}
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
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
