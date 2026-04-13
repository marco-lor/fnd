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
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useAuth } from '../../AuthContext';
import { db, storage } from '../firebaseConfig';
import BackgroundGalleryPanel from './BackgroundGalleryPanel';
import {
  buildStorageSafeName,
  getDisplayNameFromFileName,
  getFileExtension,
  isManagerRole,
  normalizeGridConfig,
  readFileImageDimensions,
  snapBoardPointToGrid,
  sortBackgrounds,
} from './boardUtils';
import {
  DEFAULT_GRID,
  getGrigliataDrawTheme,
  resolveGrigliataDrawColorKey,
} from './constants';
import GrigliataBoard from './GrigliataBoard';
import {
  buildGrigliataLiveInteractionDoc,
  buildGrigliataLiveInteractionDocId,
  filterActiveGrigliataLiveInteractions,
  GRIGLIATA_LIVE_INTERACTION_COLLECTION,
  GRIGLIATA_LIVE_INTERACTION_STALE_MS,
  GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS,
  normalizeGrigliataLiveInteractionDraft,
} from './liveInteractions';
import MapCalibrationPanel from './MapCalibrationPanel';
import MyTokenTray from './MyTokenTray';

const MAX_BACKGROUND_FILE_BYTES = 15 * 1024 * 1024;
const FIRESTORE_BATCH_SIZE = 450;
const DRAW_COLOR_AUTOSAVE_DEBOUNCE_MS = 300;
const GRID_SIZE_AUTOSAVE_DEBOUNCE_MS = 300;
const LIVE_INTERACTION_CLOCK_INTERVAL_MS = 15 * 1000;
const LEGACY_TOKEN_CLEANUP_FIELD = 'legacyTokenPlacementCleanupCompletedAt';
const LEGACY_PLACEMENT_VISIBILITY_CLEANUP_FIELD = 'legacyPlacementVisibilityCleanupCompletedAt';
const GRIGLIATA_HIDDEN_BACKGROUND_IDS_FIELD = 'grigliata_hidden_background_ids';

const buildPlacementDocId = (backgroundId, ownerUid) => `${backgroundId}__${ownerUid}`;
const buildHiddenPlacementSettingsPayload = (backgroundId, isHidden) => ({
  settings: {
    [GRIGLIATA_HIDDEN_BACKGROUND_IDS_FIELD]: isHidden
      ? arrayUnion(backgroundId)
      : arrayRemove(backgroundId),
  },
});
const isPermissionDeniedError = (error) => (
  error?.code === 'permission-denied'
  || error?.code === 'firestore/permission-denied'
);
const SIDEBAR_TAB_GRID_CLASS_NAMES = {
  1: 'grid grid-cols-1 gap-2',
  2: 'grid grid-cols-2 gap-2',
  3: 'grid grid-cols-3 gap-2',
};
const DEFAULT_SIDEBAR_TAB_GRID_CLASS_NAME = SIDEBAR_TAB_GRID_CLASS_NAMES[3];

export default function GrigliataPage() {
  const { user, userData, loading } = useAuth();
  const currentUserId = user?.uid || '';
  const currentUserEmail = user?.email || '';
  const currentCharacterId = typeof userData?.characterId === 'string' ? userData.characterId.trim() : '';
  const currentImageUrl = typeof userData?.imageUrl === 'string' ? userData.imageUrl.trim() : '';
  const currentImagePath = typeof userData?.imagePath === 'string' ? userData.imagePath.trim() : '';
  const currentTokenLabel = currentCharacterId || currentUserEmail.split('@')[0] || 'Player';
  const persistedDrawColorKey = resolveGrigliataDrawColorKey(userData?.settings?.grigliata_draw_color);
  const [navbarOffset, setNavbarOffset] = useState(0);
  const [backgrounds, setBackgrounds] = useState([]);
  const [boardState, setBoardState] = useState({});
  const [tokenProfiles, setTokenProfiles] = useState([]);
  const [activePlacements, setActivePlacements] = useState([]);
  const [liveInteractionSnapshots, setLiveInteractionSnapshots] = useState([]);
  const [localLiveInteraction, setLocalLiveInteraction] = useState(null);
  const [isInteractionSharingEnabled, setIsInteractionSharingEnabled] = useState(false);
  const [liveInteractionClock, setLiveInteractionClock] = useState(() => Date.now());

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const [selectedBackgroundId, setSelectedBackgroundId] = useState('');
  const [activatingBackgroundId, setActivatingBackgroundId] = useState('');
  const [deletingBackgroundId, setDeletingBackgroundId] = useState('');
  const [clearingTokensBackgroundId, setClearingTokensBackgroundId] = useState('');
  const [calibrationDraft, setCalibrationDraft] = useState(DEFAULT_GRID);
  const [calibrationError, setCalibrationError] = useState('');
  const [isSavingCalibration, setIsSavingCalibration] = useState(false);
  const [boardError, setBoardError] = useState('');
  const [isTrayDragging, setIsTrayDragging] = useState(false);
  const [isRulerEnabled, setIsRulerEnabled] = useState(false);
  const [drawColorKey, setDrawColorKey] = useState(persistedDrawColorKey);
  const [activeGridSizeOverride, setActiveGridSizeOverride] = useState(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState('tokens');
  const legacyCleanupStartedRef = useRef(false);
  const legacyPlacementVisibilityCleanupStartedRef = useRef(false);
  const calibrationSelectionRef = useRef('');
  const drawColorAutosaveTimeoutRef = useRef(null);
  const pendingDrawColorAutosaveRef = useRef(null);
  const activeDrawColorAutosaveRef = useRef(null);
  const latestDrawColorRequestIdRef = useRef(0);
  const latestRequestedDrawColorKeyRef = useRef(persistedDrawColorKey);
  const persistedDrawColorKeyRef = useRef(persistedDrawColorKey);
  const gridSizeAutosaveTimeoutRef = useRef(null);
  const pendingGridSizeAutosaveRef = useRef(null);
  const liveInteractionPublishTimeoutRef = useRef(null);
  const pendingLiveInteractionPublishRef = useRef(null);
  const activeLiveInteractionDocIdRef = useRef('');
  const liveInteractionMutationQueueRef = useRef(Promise.resolve());
  const [gridVisibilityUpdateBackgroundId, setGridVisibilityUpdateBackgroundId] = useState('');
  const [tokenVisibilityUpdateOwnerUid, setTokenVisibilityUpdateOwnerUid] = useState('');

  const role = (userData?.role || '').toLowerCase();
  const isManager = isManagerRole(role);
  const currentUserHiddenBackgroundIds = useMemo(() => {
    const hiddenBackgroundIds = userData?.settings?.[GRIGLIATA_HIDDEN_BACKGROUND_IDS_FIELD];
    return Array.isArray(hiddenBackgroundIds)
      ? hiddenBackgroundIds.filter((backgroundId) => typeof backgroundId === 'string' && backgroundId)
      : [];
  }, [userData]);
  const drawTheme = useMemo(
    () => getGrigliataDrawTheme(drawColorKey),
    [drawColorKey]
  );
  const sidebarTabs = useMemo(() => (
    isManager
      ? [
        { key: 'tokens', label: 'Tokens' },
        { key: 'gallery', label: 'DM Gallery' },
        { key: 'calibration', label: 'Map Calibration' },
      ]
      : [{ key: 'tokens', label: 'Tokens' }]
  ), [isManager]);
  const sidebarTabListClassName = SIDEBAR_TAB_GRID_CLASS_NAMES[sidebarTabs.length]
    || DEFAULT_SIDEBAR_TAB_GRID_CLASS_NAME;

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
    if (sidebarTabs.some((tab) => tab.key === activeSidebarTab)) return;
    setActiveSidebarTab(sidebarTabs[0].key);
  }, [activeSidebarTab, sidebarTabs]);

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
    if (!currentUserId) {
      setBackgrounds([]);
      setBoardState({});
      setTokenProfiles([]);
      return undefined;
    }

    const unsubscribeBackgrounds = onSnapshot(
      collection(db, 'grigliata_backgrounds'),
      (snapshot) => {
        const nextBackgrounds = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setBackgrounds(sortBackgrounds(nextBackgrounds));
      },
      (error) => {
        console.error('Failed to load Grigliata backgrounds:', error);
      }
    );

    const unsubscribeState = onSnapshot(
      doc(db, 'grigliata_state', 'current'),
      (snapshot) => {
        setBoardState(snapshot.exists() ? snapshot.data() : {});
      },
      (error) => {
        console.error('Failed to load Grigliata state:', error);
      }
    );

    const unsubscribeTokenProfiles = onSnapshot(
      collection(db, 'grigliata_tokens'),
      (snapshot) => {
        const nextTokens = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setTokenProfiles(nextTokens);
      },
      (error) => {
        console.error('Failed to load Grigliata token profiles:', error);
      }
    );

    return () => {
      unsubscribeBackgrounds();
      unsubscribeState();
      unsubscribeTokenProfiles();
    };
  }, [currentUserId]);

  const activeBackgroundId = typeof boardState?.activeBackgroundId === 'string'
    ? boardState.activeBackgroundId
    : '';

  useEffect(() => {
    if (!currentUserId || !activeBackgroundId) {
      setActivePlacements([]);
      return undefined;
    }

    const placementsQuery = isManager
      ? query(
        collection(db, 'grigliata_token_placements'),
        where('backgroundId', '==', activeBackgroundId)
      )
      : query(
        collection(db, 'grigliata_token_placements'),
        where('backgroundId', '==', activeBackgroundId),
        where('isVisibleToPlayers', '==', true)
      );

    const unsubscribePlacements = onSnapshot(
      placementsQuery,
      (snapshot) => {
        const nextPlacements = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setActivePlacements(nextPlacements);
      },
      (error) => {
        console.error('Failed to load Grigliata token placements:', error);
        setActivePlacements([]);
      }
    );

    return () => unsubscribePlacements();
  }, [activeBackgroundId, currentUserId, isManager]);

  useEffect(() => {
    if (!currentUserId || !activeBackgroundId) {
      setLiveInteractionSnapshots([]);
      return undefined;
    }

    const interactionsQuery = query(
      collection(db, GRIGLIATA_LIVE_INTERACTION_COLLECTION),
      where('backgroundId', '==', activeBackgroundId)
    );

    const unsubscribeInteractions = onSnapshot(
      interactionsQuery,
      (snapshot) => {
        const nextInteractions = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setLiveInteractionSnapshots(nextInteractions);
      },
      (error) => {
        console.error('Failed to load Grigliata live interactions:', error);
        setLiveInteractionSnapshots([]);
      }
    );

    return () => unsubscribeInteractions();
  }, [activeBackgroundId, currentUserId]);

  useEffect(() => {
    setLiveInteractionClock(Date.now());
    if (!activeBackgroundId) return undefined;

    const intervalId = window.setInterval(() => {
      setLiveInteractionClock(Date.now());
    }, LIVE_INTERACTION_CLOCK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [activeBackgroundId]);

  useEffect(() => {
    setLocalLiveInteraction(null);
  }, [activeBackgroundId]);

  const activeBackground = useMemo(
    () => backgrounds.find((background) => background.id === activeBackgroundId) || null,
    [backgrounds, activeBackgroundId]
  );

  const sharedInteractions = useMemo(
    () => filterActiveGrigliataLiveInteractions(
      liveInteractionSnapshots,
      liveInteractionClock,
      GRIGLIATA_LIVE_INTERACTION_STALE_MS
    ),
    [liveInteractionClock, liveInteractionSnapshots]
  );

  const selectedBackground = useMemo(
    () => backgrounds.find((background) => background.id === selectedBackgroundId) || null,
    [backgrounds, selectedBackgroundId]
  );

  useEffect(() => {
    if (!backgrounds.length) {
      setSelectedBackgroundId('');
      return;
    }

    setSelectedBackgroundId((previousId) => {
      if (previousId && backgrounds.some((background) => background.id === previousId)) {
        return previousId;
      }
      if (activeBackgroundId && backgrounds.some((background) => background.id === activeBackgroundId)) {
        return activeBackgroundId;
      }
      return backgrounds[0].id;
    });
  }, [backgrounds, activeBackgroundId]);

  useEffect(() => {
    const nextCalibrationBackgroundId = selectedBackground?.id || '';
    if (calibrationSelectionRef.current === nextCalibrationBackgroundId) return;

    calibrationSelectionRef.current = nextCalibrationBackgroundId;
    setCalibrationDraft(normalizeGridConfig(selectedBackground?.grid));
    setCalibrationError('');
  }, [selectedBackground?.grid, selectedBackground?.id]);

  const currentUserTokenProfileDoc = useMemo(
    () => tokenProfiles.find((token) => token.id === currentUserId || token.ownerUid === currentUserId) || null,
    [currentUserId, tokenProfiles]
  );

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
  const legacyPlacementVisibilityCleanupCompletedAt = boardState?.[LEGACY_PLACEMENT_VISIBILITY_CLEANUP_FIELD];

  useEffect(() => {
    if (!currentUserId || !isManager) return undefined;
    if (legacyCleanupCompletedAt || legacyCleanupStartedRef.current) return undefined;

    let cancelled = false;
    legacyCleanupStartedRef.current = true;

    const runLegacyCleanup = async () => {
      try {
        let cursor = null;

        while (true) {
          const baseConstraints = [
            orderBy(documentId()),
            limit(FIRESTORE_BATCH_SIZE),
          ];

          const pageQuery = cursor
            ? query(collection(db, 'grigliata_tokens'), ...baseConstraints, startAfter(cursor))
            : query(collection(db, 'grigliata_tokens'), ...baseConstraints);

          const snapshot = await getDocs(pageQuery);
          if (snapshot.empty) break;

          const batch = writeBatch(db);
          for (const docSnap of snapshot.docs) {
            batch.set(docSnap.ref, {
              placed: deleteField(),
              col: deleteField(),
              row: deleteField(),
              updatedAt: serverTimestamp(),
              updatedBy: currentUserId || null,
            }, { merge: true });
          }
          await batch.commit();

          if (snapshot.size < FIRESTORE_BATCH_SIZE) {
            break;
          }

          cursor = snapshot.docs[snapshot.docs.length - 1];
        }

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
  }, [currentUserId, isManager, legacyCleanupCompletedAt]);

  useEffect(() => {
    if (!currentUserId || !isManager) return undefined;
    if (legacyPlacementVisibilityCleanupCompletedAt || legacyPlacementVisibilityCleanupStartedRef.current) {
      return undefined;
    }

    let cancelled = false;
    legacyPlacementVisibilityCleanupStartedRef.current = true;

    const runPlacementVisibilityCleanup = async () => {
      try {
        let cursor = null;

        while (true) {
          const baseConstraints = [
            orderBy(documentId()),
            limit(FIRESTORE_BATCH_SIZE),
          ];

          const pageQuery = cursor
            ? query(collection(db, 'grigliata_token_placements'), ...baseConstraints, startAfter(cursor))
            : query(collection(db, 'grigliata_token_placements'), ...baseConstraints);

          const snapshot = await getDocs(pageQuery);
          if (snapshot.empty) break;

          const batch = writeBatch(db);
          let shouldCommitBatch = false;

          for (const docSnap of snapshot.docs) {
            const placement = docSnap.data();
            if (placement?.isVisibleToPlayers === true || placement?.isVisibleToPlayers === false) {
              continue;
            }

            batch.set(docSnap.ref, {
              isVisibleToPlayers: true,
              updatedAt: serverTimestamp(),
              updatedBy: currentUserId || null,
            }, { merge: true });
            shouldCommitBatch = true;
          }

          if (shouldCommitBatch) {
            await batch.commit();
          }

          if (snapshot.size < FIRESTORE_BATCH_SIZE) {
            break;
          }

          cursor = snapshot.docs[snapshot.docs.length - 1];
        }

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
  }, [currentUserId, isManager, legacyPlacementVisibilityCleanupCompletedAt]);

  const tokenProfilesByOwnerUid = useMemo(() => {
    const nextMap = new Map();
    tokenProfiles.forEach((token) => {
      const ownerUid = token?.ownerUid || token?.id;
      if (ownerUid) {
        nextMap.set(ownerUid, token);
      }
    });
    return nextMap;
  }, [tokenProfiles]);

  const boardTokens = useMemo(
    () => activePlacements
      .filter((placement) => placement?.ownerUid)
      .map((placement) => {
        const profile = tokenProfilesByOwnerUid.get(placement.ownerUid)
          || (placement.ownerUid === currentUserId ? {
            ownerUid: currentUserId,
            characterId: currentCharacterId,
            label: currentTokenLabel,
            imageUrl: currentImageUrl,
            imagePath: currentImagePath,
          } : null);

        return {
          id: placement.ownerUid,
          backgroundId: placement.backgroundId,
          ownerUid: placement.ownerUid,
          characterId: profile?.characterId || '',
          label: profile?.label || placement.ownerUid || 'Player',
          imageUrl: profile?.imageUrl || '',
          imagePath: profile?.imagePath || '',
          col: Number.isFinite(placement?.col) ? placement.col : 0,
          row: Number.isFinite(placement?.row) ? placement.row : 0,
          isVisibleToPlayers: placement?.isVisibleToPlayers !== false,
          placed: true,
        };
      }),
    [
      activePlacements,
      currentCharacterId,
      currentImagePath,
      currentImageUrl,
      currentTokenLabel,
      currentUserId,
      tokenProfilesByOwnerUid,
    ]
  );

  const currentUserPlacement = useMemo(
    () => activePlacements.find((placement) => placement.ownerUid === currentUserId) || null,
    [activePlacements, currentUserId]
  );

  const isCurrentUserTokenHiddenOnActiveMap = useMemo(
    () => !isManager
      && !currentUserPlacement
      && !!activeBackgroundId
      && currentUserHiddenBackgroundIds.includes(activeBackgroundId),
    [activeBackgroundId, currentUserHiddenBackgroundIds, currentUserPlacement, isManager]
  );

  const currentUserToken = useMemo(() => ({
    ownerUid: currentUserId,
    characterId: currentCharacterId,
    label: currentTokenLabel,
    imageUrl: currentUserTokenProfileDoc?.imageUrl || currentImageUrl,
    imagePath: currentUserTokenProfileDoc?.imagePath || currentImagePath,
    placed: !!currentUserPlacement,
    col: Number.isFinite(currentUserPlacement?.col) ? currentUserPlacement.col : 0,
    row: Number.isFinite(currentUserPlacement?.row) ? currentUserPlacement.row : 0,
    isHiddenByManager: isCurrentUserTokenHiddenOnActiveMap,
  }), [
    currentCharacterId,
    currentImagePath,
    currentImageUrl,
    currentTokenLabel,
    isCurrentUserTokenHiddenOnActiveMap,
    currentUserId,
    currentUserPlacement,
    currentUserTokenProfileDoc,
  ]);

  const persistedActiveGrid = useMemo(
    () => normalizeGridConfig(activeBackground?.grid),
    [activeBackground]
  );
  const isGridVisible = activeBackground?.isGridVisible !== false;

  const grid = useMemo(() => {
    if (!activeBackgroundId || activeGridSizeOverride?.backgroundId !== activeBackgroundId) {
      return persistedActiveGrid;
    }

    return normalizeGridConfig({
      ...persistedActiveGrid,
      cellSizePx: activeGridSizeOverride.cellSizePx,
    });
  }, [activeBackgroundId, activeGridSizeOverride, persistedActiveGrid]);

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

  useEffect(() => {
    const nextDocId = (
      currentUserId
      && activeBackgroundId
      && isInteractionSharingEnabled
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
    isInteractionSharingEnabled,
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

    while (true) {
      const snapshot = await getDocs(query(
        collection(db, 'grigliata_token_placements'),
        where('backgroundId', '==', backgroundId),
        limit(FIRESTORE_BATCH_SIZE)
      ));

      if (snapshot.empty) return deletedCount;

      const batch = writeBatch(db);
      for (const docSnap of snapshot.docs) {
        const ownerUid = docSnap.data()?.ownerUid;
        batch.delete(docSnap.ref);
        if (typeof ownerUid === 'string' && ownerUid) {
          batch.set(
            doc(db, 'users', ownerUid),
            buildHiddenPlacementSettingsPayload(backgroundId, false),
            { merge: true }
          );
        }
        deletedCount += 1;
      }
      await batch.commit();

      if (snapshot.size < FIRESTORE_BATCH_SIZE) return deletedCount;
    }
  };

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

  const upsertTokenPlacement = async ({ backgroundId, ownerUid, col, row, isVisibleToPlayers = true }) => {
    const placementId = buildPlacementDocId(backgroundId, ownerUid);
    const isHidden = isVisibleToPlayers === false;
    const batch = writeBatch(db);

    batch.set(doc(db, 'grigliata_token_placements', placementId), {
      backgroundId,
      ownerUid,
      col,
      row,
      isVisibleToPlayers: !isHidden,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId || null,
    }, { merge: true });
    batch.set(
      doc(db, 'users', ownerUid),
      buildHiddenPlacementSettingsPayload(backgroundId, isHidden),
      { merge: true }
    );

    await batch.commit();
  };

  const commitPlacementMoves = async (moves) => {
    const normalizedMoves = [...new Map(
      (moves || [])
        .filter((move) => move?.backgroundId && move?.ownerUid)
        .map((move) => [buildPlacementDocId(move.backgroundId, move.ownerUid), move])
    ).values()];

    for (let index = 0; index < normalizedMoves.length; index += FIRESTORE_BATCH_SIZE) {
      const batch = writeBatch(db);
      normalizedMoves.slice(index, index + FIRESTORE_BATCH_SIZE).forEach((move) => {
        const isHidden = move.isVisibleToPlayers === false;
        batch.set(doc(db, 'grigliata_token_placements', buildPlacementDocId(move.backgroundId, move.ownerUid)), {
          backgroundId: move.backgroundId,
          ownerUid: move.ownerUid,
          col: move.col,
          row: move.row,
          isVisibleToPlayers: !isHidden,
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId || null,
        }, { merge: true });
        batch.set(
          doc(db, 'users', move.ownerUid),
          buildHiddenPlacementSettingsPayload(move.backgroundId, isHidden),
          { merge: true }
        );
      });
      await batch.commit();
    }
  };

  const deleteActiveMapPlacements = async (ownerUids) => {
    const normalizedOwnerUids = [...new Set((ownerUids || []).filter(Boolean))];
    if (!activeBackgroundId || !normalizedOwnerUids.length) return;

    for (let index = 0; index < normalizedOwnerUids.length; index += FIRESTORE_BATCH_SIZE) {
      const batch = writeBatch(db);
      normalizedOwnerUids.slice(index, index + FIRESTORE_BATCH_SIZE).forEach((ownerUid) => {
        batch.delete(doc(db, 'grigliata_token_placements', buildPlacementDocId(activeBackgroundId, ownerUid)));
        batch.set(
          doc(db, 'users', ownerUid),
          buildHiddenPlacementSettingsPayload(activeBackgroundId, false),
          { merge: true }
        );
      });
      await batch.commit();
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

  const handleToggleTokenVisibility = async (ownerUid) => {
    if (!isManager || !user?.uid || !activeBackgroundId || !ownerUid) return;

    const targetPlacement = activePlacements.find((placement) => placement.ownerUid === ownerUid);
    if (!targetPlacement) return;
    const nextIsVisibleToPlayers = targetPlacement?.isVisibleToPlayers === false;

    setBoardError('');
    setTokenVisibilityUpdateOwnerUid(ownerUid);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'grigliata_token_placements', buildPlacementDocId(activeBackgroundId, ownerUid)), {
        isVisibleToPlayers: nextIsVisibleToPlayers,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      batch.set(
        doc(db, 'users', ownerUid),
        buildHiddenPlacementSettingsPayload(activeBackgroundId, !nextIsVisibleToPlayers),
        { merge: true }
      );
      await batch.commit();
    } catch (error) {
      console.error('Failed to toggle token visibility:', error);
      setBoardError('Unable to update that token visibility.');
    } finally {
      setTokenVisibilityUpdateOwnerUid('');
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

  const handlePlaceCurrentToken = async (worldPoint) => {
    if (!user?.uid) return;

    if (!activeBackgroundId) {
      setBoardError('Select a map before placing your token.');
      return;
    }

    if (isCurrentUserTokenHiddenOnActiveMap) {
      setBoardError('The DM is currently hiding or controlling that token.');
      return;
    }

    if (!currentUserToken.imageUrl) {
      setBoardError('Upload a profile image before placing your token.');
      return;
    }

    setBoardError('');
    const snapped = snapBoardPointToGrid(worldPoint, grid, 'center');
    try {
      await upsertTokenPlacement({
        backgroundId: activeBackgroundId,
        ownerUid: user.uid,
        col: snapped.col,
        row: snapped.row,
        isVisibleToPlayers: true,
      });
    } catch (error) {
      console.error('Failed to place current user token:', error);
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
  }, [isManager]);

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
        <header className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 shadow-2xl backdrop-blur-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Shared Battlemat</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-semibold text-amber-300">Grigliata</h1>
                {isManager && (
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-200">
                    DM View
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 sm:text-sm">
              <div className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5">
                Active background:{' '}
                <span className="font-semibold text-slate-100">{activeBackground?.name || 'Grid only'}</span>
              </div>
              <div className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5">
                <span className="font-semibold text-slate-100">{boardTokens.length}</span> tokens on this map
              </div>
            </div>
          </div>
        </header>

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
                currentUserId={user.uid}
                isManager={isManager}
                isTokenDragActive={isTrayDragging}
                isRulerEnabled={isRulerEnabled}
                isInteractionSharingEnabled={isInteractionSharingEnabled}
                drawTheme={drawTheme}
                onToggleRuler={() => setIsRulerEnabled((currentValue) => !currentValue)}
                onToggleInteractionSharing={() => {
                  setBoardError('');
                  setIsInteractionSharingEnabled((currentValue) => !currentValue);
                }}
                onChangeDrawColor={handleDrawColorChange}
                onToggleGridVisibility={isManager ? handleToggleGridVisibility : null}
                isGridVisibilityToggleDisabled={!activeBackgroundId || gridVisibilityUpdateBackgroundId === activeBackgroundId}
                onAdjustGridSize={isManager ? handleAdjustActiveGridSize : null}
                isGridSizeAdjustmentDisabled={!activeBackgroundId}
                onMoveTokens={handleMoveTokens}
                onDeleteTokens={handleDeleteTokens}
                onToggleTokenVisibility={isManager ? handleToggleTokenVisibility : null}
                tokenVisibilityUpdateOwnerUid={tokenVisibilityUpdateOwnerUid}
                sharedInteractions={sharedInteractions}
                onSharedInteractionChange={handleSharedInteractionChange}
                onDropCurrentToken={(worldPoint) => {
                  setIsTrayDragging(false);
                  handlePlaceCurrentToken(worldPoint);
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
                    activeMapName={activeBackground?.name || ''}
                    onDragStart={() => setIsTrayDragging(true)}
                    onDragEnd={() => setIsTrayDragging(false)}
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
