import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
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
  const [tokens, setTokens] = useState([]);

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const [selectedBackgroundId, setSelectedBackgroundId] = useState('');
  const [activatingBackgroundId, setActivatingBackgroundId] = useState('');
  const [deletingBackgroundId, setDeletingBackgroundId] = useState('');
  const [calibrationDraft, setCalibrationDraft] = useState(DEFAULT_GRID);
  const [calibrationError, setCalibrationError] = useState('');
  const [isSavingCalibration, setIsSavingCalibration] = useState(false);
  const [boardError, setBoardError] = useState('');
  const [isTrayDragging, setIsTrayDragging] = useState(false);

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
      setTokens([]);
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

    const unsubscribeTokens = onSnapshot(
      collection(db, 'grigliata_tokens'),
      (snapshot) => {
        const nextTokens = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setTokens(nextTokens);
      },
      (error) => {
        console.error('Failed to load Grigliata tokens:', error);
      }
    );

    return () => {
      unsubscribeBackgrounds();
      unsubscribeState();
      unsubscribeTokens();
    };
  }, [currentUserId]);

  const activeBackgroundId = typeof boardState?.activeBackgroundId === 'string'
    ? boardState.activeBackgroundId
    : '';

  const activeBackground = useMemo(
    () => backgrounds.find((background) => background.id === activeBackgroundId) || null,
    [backgrounds, activeBackgroundId]
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
    const selectedBackground = backgrounds.find((background) => background.id === selectedBackgroundId);
    setCalibrationDraft(normalizeGridConfig(selectedBackground?.grid));
    setCalibrationError('');
  }, [backgrounds, selectedBackgroundId]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    let active = true;

    const syncCurrentUserToken = async () => {
      const tokenRef = doc(db, 'grigliata_tokens', currentUserId);
      const label = currentTokenLabel;
      const imageUrl = currentImageUrl;
      const imagePath = currentImagePath;
      const characterId = currentCharacterId;

      try {
        const tokenSnapshot = await getDoc(tokenRef);
        if (!active) return;

        const existingToken = tokenSnapshot.exists() ? tokenSnapshot.data() : null;

        if (!imageUrl) {
          if (existingToken && (existingToken.imageUrl || existingToken.placed)) {
            await setDoc(tokenRef, {
              ownerUid: currentUserId,
              characterId,
              label,
              imageUrl: '',
              imagePath: '',
              placed: false,
              updatedAt: serverTimestamp(),
              updatedBy: currentUserId,
            }, { merge: true });
          }
          return;
        }

        const needsSync = (
          !existingToken
          || existingToken.ownerUid !== currentUserId
          || existingToken.characterId !== characterId
          || existingToken.label !== label
          || existingToken.imageUrl !== imageUrl
          || existingToken.imagePath !== imagePath
        );

        if (!needsSync) return;

        await setDoc(tokenRef, {
          ownerUid: currentUserId,
          characterId,
          label,
          imageUrl,
          imagePath,
          placed: !!existingToken?.placed,
          col: Number.isFinite(existingToken?.col) ? existingToken.col : 0,
          row: Number.isFinite(existingToken?.row) ? existingToken.row : 0,
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId,
        }, { merge: true });
      } catch (error) {
        console.error('Failed to sync current user token:', error);
      }
    };

    syncCurrentUserToken();

    return () => {
      active = false;
    };
  }, [
    currentCharacterId,
    currentImagePath,
    currentImageUrl,
    currentUserId,
    currentTokenLabel,
  ]);

  const currentUserToken = useMemo(() => {
    const tokenDoc = tokens.find((token) => token.id === currentUserId || token.ownerUid === currentUserId);
    return {
      ownerUid: currentUserId,
      characterId: currentCharacterId,
      label: currentTokenLabel,
      imageUrl: tokenDoc?.imageUrl || currentImageUrl,
      imagePath: tokenDoc?.imagePath || currentImagePath,
      placed: !!tokenDoc?.placed,
      col: Number.isFinite(tokenDoc?.col) ? tokenDoc.col : 0,
      row: Number.isFinite(tokenDoc?.row) ? tokenDoc.row : 0,
    };
  }, [
    currentCharacterId,
    currentImagePath,
    currentImageUrl,
    currentUserId,
    currentTokenLabel,
    tokens,
  ]);

  const grid = useMemo(
    () => normalizeGridConfig(activeBackground?.grid),
    [activeBackground]
  );

  const boardHeight = navbarOffset
    ? `calc(100vh - ${navbarOffset + 32}px)`
    : '72vh';

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

  const handleDeleteBackground = async (background) => {
    if (!isManager || !user?.uid || !background?.id) return;

    const confirmed = window.confirm(`Delete background "${background.name || 'Untitled Map'}" permanently?`);
    if (!confirmed) return;

    setDeletingBackgroundId(background.id);
    setBoardError('');
    try {
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
    setIsSavingCalibration(true);
    try {
      await updateDoc(doc(db, 'grigliata_backgrounds', selectedBackgroundId), {
        grid: normalizeGridConfig(calibrationDraft),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    } catch (error) {
      console.error('Failed to save calibration:', error);
      setCalibrationError('Unable to save calibration changes.');
    } finally {
      setIsSavingCalibration(false);
    }
  };

  const upsertToken = async (ownerUid, payload) => {
    await setDoc(doc(db, 'grigliata_tokens', ownerUid), {
      ...payload,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId || null,
    }, { merge: true });
  };

  const handlePlaceCurrentToken = async (worldPoint) => {
    if (!user?.uid || !currentUserToken.imageUrl) return;

    setBoardError('');
    const snapped = snapBoardPointToGrid(worldPoint, grid, 'center');
    try {
      await upsertToken(user.uid, {
        ownerUid: user.uid,
        characterId: currentUserToken.characterId || '',
        label: currentUserToken.label || currentTokenLabel,
        imageUrl: currentUserToken.imageUrl,
        imagePath: currentUserToken.imagePath || '',
        col: snapped.col,
        row: snapped.row,
        placed: true,
      });
    } catch (error) {
      console.error('Failed to place current user token:', error);
      setBoardError('Unable to place your token right now.');
    }
  };

  const handleMoveToken = async (token, snapped) => {
    const tokenId = token?.id || token?.ownerUid || '';
    const tokenOwnerUid = token?.ownerUid || tokenId;
    const canMove = !!tokenId && (isManager || tokenOwnerUid === user?.uid || tokenId === user?.uid);

    if (!user?.uid || !canMove) return;

    setBoardError('');
    try {
      await upsertToken(tokenId, {
        ownerUid: tokenOwnerUid,
        characterId: token?.characterId || '',
        label: token?.label || 'Player',
        imageUrl: token?.imageUrl || '',
        imagePath: token?.imagePath || '',
        col: snapped.col,
        row: snapped.row,
        placed: true,
      });
    } catch (error) {
      console.error('Failed to move token:', error);
      setBoardError('Unable to move that token right now.');
    }
  };

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
                Shared Roll20-style grid with DM-managed background images and public player tokens.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
              <span className="font-semibold text-slate-100">{tokens.filter((token) => token?.placed && token?.imageUrl).length}</span> tokens on the board
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
              activeBackground={activeBackground}
              grid={grid}
              tokens={tokens}
              currentUserId={user.uid}
              isManager={isManager}
              isTokenDragActive={isTrayDragging}
              boardHeight={boardHeight}
              onMoveToken={handleMoveToken}
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
