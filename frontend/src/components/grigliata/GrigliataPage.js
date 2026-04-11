import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
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
import { DEFAULT_GRID } from './constants';
import GrigliataBoard from './GrigliataBoard';
import MyTokenTray from './MyTokenTray';

const MAX_BACKGROUND_FILE_BYTES = 15 * 1024 * 1024;
const FIRESTORE_BATCH_SIZE = 450;
const GRID_SIZE_AUTOSAVE_DEBOUNCE_MS = 300;
const LEGACY_TOKEN_CLEANUP_FIELD = 'legacyTokenPlacementCleanupCompletedAt';

const buildPlacementDocId = (backgroundId, ownerUid) => `${backgroundId}__${ownerUid}`;

export default function GrigliataPage() {
  const { user, userData, loading } = useAuth();
  const currentUserId = user?.uid || '';
  const currentUserEmail = user?.email || '';
  const currentCharacterId = typeof userData?.characterId === 'string' ? userData.characterId.trim() : '';
  const currentImageUrl = typeof userData?.imageUrl === 'string' ? userData.imageUrl.trim() : '';
  const currentImagePath = typeof userData?.imagePath === 'string' ? userData.imagePath.trim() : '';
  const currentTokenLabel = currentCharacterId || currentUserEmail.split('@')[0] || 'Player';
  const [navbarOffset, setNavbarOffset] = useState(0);
  const [backgrounds, setBackgrounds] = useState([]);
  const [boardState, setBoardState] = useState({});
  const [tokenProfiles, setTokenProfiles] = useState([]);
  const [activePlacements, setActivePlacements] = useState([]);

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
  const [activeGridSizeOverride, setActiveGridSizeOverride] = useState(null);
  const legacyCleanupStartedRef = useRef(false);
  const calibrationSelectionRef = useRef('');
  const gridSizeAutosaveTimeoutRef = useRef(null);
  const pendingGridSizeAutosaveRef = useRef(null);

  const role = (userData?.role || '').toLowerCase();
  const isManager = isManagerRole(role);

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

    const unsubscribePlacements = onSnapshot(
      query(
        collection(db, 'grigliata_token_placements'),
        where('backgroundId', '==', activeBackgroundId)
      ),
      (snapshot) => {
        const nextPlacements = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setActivePlacements(nextPlacements);
      },
      (error) => {
        console.error('Failed to load Grigliata token placements:', error);
      }
    );

    return () => unsubscribePlacements();
  }, [activeBackgroundId, currentUserId]);

  const activeBackground = useMemo(
    () => backgrounds.find((background) => background.id === activeBackgroundId) || null,
    [backgrounds, activeBackgroundId]
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

  const currentUserToken = useMemo(() => ({
    ownerUid: currentUserId,
    characterId: currentCharacterId,
    label: currentTokenLabel,
    imageUrl: currentUserTokenProfileDoc?.imageUrl || currentImageUrl,
    imagePath: currentUserTokenProfileDoc?.imagePath || currentImagePath,
    placed: !!currentUserPlacement,
    col: Number.isFinite(currentUserPlacement?.col) ? currentUserPlacement.col : 0,
    row: Number.isFinite(currentUserPlacement?.row) ? currentUserPlacement.row : 0,
  }), [
    currentCharacterId,
    currentImagePath,
    currentImageUrl,
    currentTokenLabel,
    currentUserId,
    currentUserPlacement,
    currentUserTokenProfileDoc,
  ]);

  const persistedActiveGrid = useMemo(
    () => normalizeGridConfig(activeBackground?.grid),
    [activeBackground]
  );

  const grid = useMemo(() => {
    if (!activeBackgroundId || activeGridSizeOverride?.backgroundId !== activeBackgroundId) {
      return persistedActiveGrid;
    }

    return normalizeGridConfig({
      ...persistedActiveGrid,
      cellSizePx: activeGridSizeOverride.cellSizePx,
    });
  }, [activeBackgroundId, activeGridSizeOverride, persistedActiveGrid]);

  const boardHeight = navbarOffset
    ? `calc(100vh - ${navbarOffset + 32}px)`
    : '72vh';

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
        batch.delete(docSnap.ref);
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
      void flushPendingGridSizeAutosave();
    }
  ), [activeBackgroundId, flushPendingGridSizeAutosave]);

  const upsertTokenPlacement = async ({ backgroundId, ownerUid, col, row }) => {
    const placementId = buildPlacementDocId(backgroundId, ownerUid);

    await setDoc(doc(db, 'grigliata_token_placements', placementId), {
      backgroundId,
      ownerUid,
      col,
      row,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId || null,
    }, { merge: true });
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
        batch.set(doc(db, 'grigliata_token_placements', buildPlacementDocId(move.backgroundId, move.ownerUid)), {
          backgroundId: move.backgroundId,
          ownerUid: move.ownerUid,
          col: move.col,
          row: move.row,
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId || null,
        }, { merge: true });
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
      });
    } catch (error) {
      console.error('Failed to place current user token:', error);
      setBoardError('Unable to place your token right now.');
    }
  };

  const handleMoveTokens = async (moves) => {
    if (!user?.uid || !moves?.length) return;

    setBoardError('');
    try {
      await commitPlacementMoves(moves);
    } catch (error) {
      console.error('Failed to move selected token placements:', error);
      setBoardError('Unable to move the selected token(s) right now.');
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
      setBoardError('Unable to delete the selected token(s) right now.');
      throw error;
    }
  };

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

  if (loading) {
    return <div className="px-6 py-8 text-white">Loading Grigliata...</div>;
  }

  if (!user) {
    return <div className="px-6 py-8 text-white">Please log in to access Grigliata.</div>;
  }

  return (
    <div className="px-4 py-4 md:px-5 md:py-5 text-white">
      <div className="mx-auto max-w-[1800px] space-y-4">
        <header className="rounded-3xl border border-slate-700 bg-slate-950/70 px-5 py-4 shadow-2xl backdrop-blur-sm">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Shared Battlemat</p>
          <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-amber-300">Grigliata</h1>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-300">
                Shared Roll20-style grid with DM-managed background images and per-map public token placements.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
              <span className="font-semibold text-slate-100">{boardTokens.length}</span> tokens on this map
              {' '}| Active background:{' '}
              <span className="font-semibold text-slate-100">{activeBackground?.name || 'Grid only'}</span>
            </div>
          </div>
        </header>

        {boardError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-900/20 px-4 py-3 text-sm text-red-200">
            {boardError}
          </div>
        )}

        <div className={`grid gap-4 ${isManager ? 'xl:grid-cols-[22rem_minmax(0,1fr)]' : 'xl:grid-cols-[18rem_minmax(0,1fr)]'}`}>
          <aside
            className="space-y-4 self-start xl:sticky"
            style={{ top: navbarOffset ? navbarOffset + 12 : 12 }}
          >
            <MyTokenTray
              currentUserToken={currentUserToken}
              activeMapName={activeBackground?.name || ''}
              onDragStart={() => setIsTrayDragging(true)}
              onDragEnd={() => setIsTrayDragging(false)}
            />

            {isManager && (
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
                calibrationDraft={calibrationDraft}
                calibrationError={calibrationError}
                isSavingCalibration={isSavingCalibration}
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
          </aside>

          <div className={`min-w-0 ${isTrayDragging ? 'ring-2 ring-amber-400/20 rounded-3xl' : ''}`}>
            <GrigliataBoard
              key={activeBackgroundId || '__grid__'}
              activeBackground={activeBackground}
              grid={grid}
              tokens={boardTokens}
              currentUserId={user.uid}
              isManager={isManager}
              isTokenDragActive={isTrayDragging}
              isRulerEnabled={isRulerEnabled}
              onToggleRuler={() => setIsRulerEnabled((currentValue) => !currentValue)}
              onAdjustGridSize={isManager ? handleAdjustActiveGridSize : null}
              isGridSizeAdjustmentDisabled={!activeBackgroundId}
              boardHeight={boardHeight}
              onMoveTokens={handleMoveTokens}
              onDeleteTokens={handleDeleteTokens}
              onDropCurrentToken={(worldPoint) => {
                setIsTrayDragging(false);
                handlePlaceCurrentToken(worldPoint);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
