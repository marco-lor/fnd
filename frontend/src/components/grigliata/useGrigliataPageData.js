import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  documentId,
  doc,
  onSnapshot,
  query,
  where,
} from '../../performance/firestore';
import { db } from '../firebaseConfig';
import {
  buildGrigliataAoEFigureDocId,
  GRIGLIATA_AOE_FIGURE_COLLECTION,
  GRIGLIATA_AOE_FIGURE_TYPES,
  MAX_GRIGLIATA_AOE_FIGURES_PER_TYPE,
} from './aoeFigures';
import {
  buildPlacementDocId,
  normalizeGridConfig,
  normalizeHiddenTokenIdsByBackground,
  normalizeTokenSizeSquares,
  sortBackgrounds,
  timestampToMillis,
} from './boardUtils';
import {
  filterActiveGrigliataLiveInteractions,
  GRIGLIATA_LIVE_INTERACTION_COLLECTION,
  GRIGLIATA_LIVE_INTERACTION_STALE_MS,
} from './liveInteractions';
import {
  EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE,
  GRIGLIATA_MUSIC_PLAYBACK_COLLECTION,
  GRIGLIATA_MUSIC_PLAYBACK_DOC_ID,
  GRIGLIATA_MUSIC_PLAYBACK_SESSION_COLLECTION,
  GRIGLIATA_MUSIC_TRACK_COLLECTION,
  normalizeGrigliataMusicPlaybackState,
  sortGrigliataMusicPlaybackSessions,
  sortGrigliataMusicTracks,
} from './music';
import {
  filterActiveGrigliataPagePresence,
  GRIGLIATA_PAGE_PRESENCE_COLLECTION,
} from './presence';
import {
  normalizeTurnCounter,
  normalizeTurnEffects,
  sortTurnOrderEntries,
} from './turnOrder';
import {
  normalizeTokenVisionRadiusSquares,
  normalizeTokenVisionSettings,
} from './lightingVisibility';
import {
  GRIGLIATA_GALLERY_FOLDERS_COLLECTION,
  getWritableGalleryFolderId,
  sortGalleryFolders,
} from './galleryFolders';
import {
  GRIGLIATA_MUSIC_FOLDERS_COLLECTION,
  getWritableMusicFolderId,
  sortMusicFolders,
} from './musicFolders';
import {
  buildBackgroundMap,
  normalizeNarrationPlacements,
} from './narrationScene';
import { resolveTask07CustomTokenMediaProjection } from './customTokenMedia';
import { resolveTask07PlacedCanonicalMedia } from './characterTokenMedia';
import {
  resolveTask07BoardTokenCanonicalMedia,
} from './tokenMediaProjection';

const LIVE_INTERACTION_CLOCK_INTERVAL_MS = 15 * 1000;
const PLACED_CANONICAL_MEDIA_RETRY_DELAYS_MS = Object.freeze([500, 1500]);
// A document-ID disjunction is expanded while Firestore evaluates the read
// rule for every candidate. Ten IDs keeps that evaluation below the emulator
// and production rules expression ceiling; the overall visible-peer bound is
// intentionally independent so shrinking a safe chunk never drops coverage.
export const GRIGLIATA_SHARED_CHARACTER_PROFILE_QUERY_CHUNK_SIZE = 10;
export const GRIGLIATA_SHARED_CHARACTER_PROFILE_MAX_IDS = 60;
const PAGE_PRESENCE_CLOCK_INTERVAL_MS = 15 * 1000;
const resolveCustomTokenRole = (token = {}, tokenType = '') => {
  if (tokenType !== 'custom') {
    return '';
  }

  return token?.customTokenRole === 'instance' ? 'instance' : 'template';
};
const resolveCustomTemplateId = (token = {}, tokenType = '', tokenId = '') => {
  if (tokenType !== 'custom') {
    return '';
  }

  const rawTemplateId = typeof token?.customTemplateId === 'string' ? token.customTemplateId.trim() : '';
  if (rawTemplateId) {
    return rawTemplateId;
  }

  return tokenId;
};
const isCustomTemplateToken = (token = {}) => token?.tokenType === 'custom' && token?.customTokenRole !== 'instance';
const sortFoesLibrary = (foes) => (
  [...foes].sort((left, right) => {
    const rightMillis = timestampToMillis(right.updated_at || right.created_at);
    const leftMillis = timestampToMillis(left.updated_at || left.created_at);
    if (rightMillis !== leftMillis) {
      return rightMillis - leftMillis;
    }
    return (left.name || '').localeCompare(right.name || '');
  })
);

const normalizeOptionalVisionEnabled = (visionEnabled) => (
  typeof visionEnabled === 'boolean' ? visionEnabled : undefined
);

const normalizeOptionalVisionRadiusSquares = (visionRadiusSquares) => {
  const numericValue = Number(visionRadiusSquares);
  return Number.isFinite(numericValue)
    ? normalizeTokenVisionRadiusSquares(numericValue)
    : undefined;
};

const normalizeResourceValue = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : fallback;
};

const getEntityMedia = (entity) => {
  if (entity?.media && typeof entity.media === 'object') {
    return entity.media;
  }
  if (entity?.General?.media && typeof entity.General.media === 'object') {
    return entity.General.media;
  }
  return null;
};

const areCanonicalMediaMapsEqual = (left = {}, right = {}) => {
  if (left === right) return true;
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return leftIds.length === rightIds.length && leftIds.every((tokenId) => (
    Object.prototype.hasOwnProperty.call(right, tokenId)
    && JSON.stringify(left[tokenId]) === JSON.stringify(right[tokenId])
  ));
};

export default function useGrigliataPageData({
  currentUserId = '',
  currentCharacterId = '',
  currentTokenLabel = '',
  currentImageUrl = '',
  currentImagePath = '',
  currentMedia = null,
  currentUserHiddenBackgroundIds = [],
  currentUserHiddenTokenIdsByBackground = {},
  isManager = false,
  isCanonicalMediaAccessReady = true,
  repositoryAccessGeneration = 0,
  activeGridSizeOverride = null,
  selectedGalleryFolderId = '',
  selectedMusicFolderId = '',
  selectedBackgroundPreferenceKey = '',
  preferredSelectedBackgroundId = '',
}) {
  const [galleryBackgrounds, setGalleryBackgrounds] = useState([]);
  const [criticalBackgroundsById, setCriticalBackgroundsById] = useState({});
  const [boardState, setBoardState] = useState({});
  const [boardStateReadySubscriptionKey, setBoardStateReadySubscriptionKey] = useState('');
  const [foeLibrary, setFoeLibrary] = useState([]);
  const [tokenProfiles, setTokenProfiles] = useState([]);
  const [tokenProfilesReadyUserId, setTokenProfilesReadyUserId] = useState('');
  const [sharedCharacterProfilesById, setSharedCharacterProfilesById] = useState({});
  const [placedCanonicalMediaByTokenId, setPlacedCanonicalMediaByTokenId] = useState({});
  const placedCanonicalMediaByTokenIdRef = useRef({});
  const placedCanonicalMediaScopeRef = useRef('');
  const placedCanonicalMediaRequestGenerationRef = useRef(0);
  const [activePlacementState, setActivePlacementState] = useState({
    backgroundId: '',
    status: 'idle',
    items: [],
  });
  const [aoeFigureState, setAoeFigureState] = useState({
    backgroundId: '',
    items: [],
  });
  const [liveInteractionState, setLiveInteractionState] = useState({
    backgroundId: '',
    items: [],
  });
  const [pagePresenceSnapshots, setPagePresenceSnapshots] = useState([]);
  const [musicTracks, setMusicTracks] = useState([]);
  const [musicPlaybackState, setMusicPlaybackState] = useState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
  const [musicPlaybackSessions, setMusicPlaybackSessions] = useState([]);
  const [galleryFolders, setGalleryFolders] = useState([]);
  const [musicFolders, setMusicFolders] = useState([]);
  const [galleryFoldersReadySubscriptionKey, setGalleryFoldersReadySubscriptionKey] = useState('');
  const [musicFoldersReadySubscriptionKey, setMusicFoldersReadySubscriptionKey] = useState('');
  const [selectedBackgroundState, setSelectedBackgroundState] = useState({
    preferenceKey: '',
    value: '',
  });
  const normalizedPreferredSelectedBackgroundId = typeof preferredSelectedBackgroundId === 'string'
    ? preferredSelectedBackgroundId.trim()
    : '';
  const selectedBackgroundId = selectedBackgroundState.preferenceKey === selectedBackgroundPreferenceKey
    ? selectedBackgroundState.value
    : normalizedPreferredSelectedBackgroundId;
  const setSelectedBackgroundId = useCallback((valueOrUpdater) => {
    setSelectedBackgroundState((currentState) => {
      const currentValue = currentState.preferenceKey === selectedBackgroundPreferenceKey
        ? currentState.value
        : normalizedPreferredSelectedBackgroundId;
      const requestedValue = typeof valueOrUpdater === 'function'
        ? valueOrUpdater(currentValue)
        : valueOrUpdater;

      return {
        preferenceKey: selectedBackgroundPreferenceKey,
        value: typeof requestedValue === 'string' ? requestedValue.trim() : '',
      };
    });
  }, [normalizedPreferredSelectedBackgroundId, selectedBackgroundPreferenceKey]);
  const [liveInteractionClock, setLiveInteractionClock] = useState(() => Date.now());
  const [pagePresenceClock, setPagePresenceClock] = useState(() => Date.now());
  const boardStateSubscriptionKey = `${currentUserId}:${isManager ? 'manager' : 'player'}`;
  const managerFolderSubscriptionKey = isManager && currentUserId
    ? `${currentUserId}:manager`
    : '';
  const isBoardStateReady = Boolean(currentUserId)
    && boardStateReadySubscriptionKey === boardStateSubscriptionKey;
  const isGalleryFoldersReady = !!managerFolderSubscriptionKey
    && galleryFoldersReadySubscriptionKey === managerFolderSubscriptionKey;
  const isMusicFoldersReady = !!managerFolderSubscriptionKey
    && musicFoldersReadySubscriptionKey === managerFolderSubscriptionKey;
  const activePlacementSubscriptionGenerationRef = useRef(0);
  const aoeFigureSubscriptionGenerationRef = useRef(0);
  const liveInteractionSubscriptionGenerationRef = useRef(0);
  const criticalBackgroundSubscriptionGenerationRef = useRef(0);
  const [criticalBackgroundResolutionById, setCriticalBackgroundResolutionById] = useState({});

  useEffect(() => {
    if (!currentUserId) {
      setGalleryBackgrounds([]);
      setCriticalBackgroundsById({});
      setBoardState({});
      setBoardStateReadySubscriptionKey('');
      setFoeLibrary([]);
      setTokenProfiles([]);
      setTokenProfilesReadyUserId('');
      setSharedCharacterProfilesById({});
      placedCanonicalMediaByTokenIdRef.current = {};
      placedCanonicalMediaRequestGenerationRef.current += 1;
      setPlacedCanonicalMediaByTokenId({});
      setPagePresenceSnapshots([]);
      setGalleryFolders([]);
      setMusicFolders([]);
      setGalleryFoldersReadySubscriptionKey('');
      setMusicFoldersReadySubscriptionKey('');
      return undefined;
    }

    const unsubscribeState = onSnapshot(
      doc(db, 'grigliata_state', 'current'),
      (snapshot) => {
        setBoardState(snapshot.exists() ? snapshot.data() : {});
        setBoardStateReadySubscriptionKey(boardStateSubscriptionKey);
      },
      (error) => {
        setBoardStateReadySubscriptionKey('');
        console.error('Failed to load Grigliata state:', error);
      }
    );

    const unsubscribeTokenProfiles = onSnapshot(
      query(
        collection(db, 'grigliata_tokens'),
        where('ownerUid', '==', currentUserId)
      ),
      (snapshot) => {
        const nextTokens = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setTokenProfiles(nextTokens);
        setTokenProfilesReadyUserId(currentUserId);
      },
      (error) => {
        setTokenProfilesReadyUserId('');
        console.error('Failed to load Grigliata token profiles:', error);
      }
    );

    const unsubscribeFoes = isManager
      ? onSnapshot(
        collection(db, 'foes'),
        (snapshot) => {
          const nextFoes = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          setFoeLibrary(sortFoesLibrary(nextFoes));
        },
        (error) => {
          console.error('Failed to load Grigliata foes library:', error);
          setFoeLibrary([]);
        }
      )
      : (() => {
        setFoeLibrary([]);
        return () => {};
      })();

    const unsubscribeGalleryFolders = isManager
      ? onSnapshot(
        collection(db, GRIGLIATA_GALLERY_FOLDERS_COLLECTION),
        (snapshot) => {
          const nextFolders = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          setGalleryFolders(sortGalleryFolders(nextFolders));
          setGalleryFoldersReadySubscriptionKey(managerFolderSubscriptionKey);
        },
        (error) => {
          console.error('Failed to load Grigliata gallery folders:', error);
        }
      )
      : (() => {
        setGalleryFolders([]);
        setGalleryFoldersReadySubscriptionKey('');
        return () => {};
      })();

    const unsubscribePagePresence = onSnapshot(
      collection(db, GRIGLIATA_PAGE_PRESENCE_COLLECTION),
      (snapshot) => {
        const nextPagePresence = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setPagePresenceSnapshots(nextPagePresence);
      },
      (error) => {
        console.error('Failed to load Grigliata page presence:', error);
        setPagePresenceSnapshots([]);
      }
    );

    return () => {
      unsubscribeState();
      unsubscribeFoes();
      unsubscribeGalleryFolders();
      unsubscribeTokenProfiles();
      unsubscribePagePresence();
    };
  }, [boardStateSubscriptionKey, currentUserId, isManager, managerFolderSubscriptionKey]);

  const activeBackgroundId = typeof boardState?.activeBackgroundId === 'string'
    ? boardState.activeBackgroundId
    : '';
  const hasCurrentActivePlacementState = activePlacementState.backgroundId === activeBackgroundId;
  const activePlacements = useMemo(
    () => (hasCurrentActivePlacementState
      ? activePlacementState.items.filter((placement) => placement?.backgroundId === activeBackgroundId)
      : []),
    [activeBackgroundId, activePlacementState.items, hasCurrentActivePlacementState]
  );
  const isActivePlacementsReady = !!activeBackgroundId
    && hasCurrentActivePlacementState
    && activePlacementState.status === 'ready';
  const activePlacementsStatus = hasCurrentActivePlacementState
    ? activePlacementState.status
    : (activeBackgroundId ? 'loading' : 'idle');
  const aoeFigureSnapshots = useMemo(
    () => (aoeFigureState.backgroundId === activeBackgroundId
      ? aoeFigureState.items.filter((figure) => figure?.backgroundId === activeBackgroundId)
      : []),
    [activeBackgroundId, aoeFigureState.backgroundId, aoeFigureState.items]
  );
  const liveInteractionSnapshots = useMemo(
    () => (liveInteractionState.backgroundId === activeBackgroundId
      ? liveInteractionState.items.filter((interaction) => interaction?.backgroundId === activeBackgroundId)
      : []),
    [activeBackgroundId, liveInteractionState.backgroundId, liveInteractionState.items]
  );
  const legacyPresentationBackgroundId = typeof boardState?.presentationBackgroundId === 'string'
    ? boardState.presentationBackgroundId
    : '';
  const rawPresentationBackgroundIds = useMemo(() => {
    const ids = [];
    const rawPlacements = Array.isArray(boardState?.presentationPlacements)
      ? boardState.presentationPlacements
      : [];

    rawPlacements.forEach((placement) => {
      const backgroundId = typeof placement?.backgroundId === 'string' ? placement.backgroundId.trim() : '';
      if (backgroundId) {
        ids.push(backgroundId);
      }
    });

    if (legacyPresentationBackgroundId) {
      ids.push(legacyPresentationBackgroundId);
    }

    return [...new Set(ids)];
  }, [boardState?.presentationPlacements, legacyPresentationBackgroundId]);
  const criticalBackgroundIds = useMemo(() => ([
    ...new Set([
      activeBackgroundId,
      selectedBackgroundId,
      ...rawPresentationBackgroundIds,
    ].filter(Boolean)),
  ]), [activeBackgroundId, rawPresentationBackgroundIds, selectedBackgroundId]);

  useEffect(() => {
    if (!currentUserId || !isManager) {
      setGalleryBackgrounds([]);
      return undefined;
    }

    const folderId = getWritableGalleryFolderId(selectedGalleryFolderId);
    const backgroundsQuery = query(
      collection(db, 'grigliata_backgrounds'),
      where('galleryFolderId', '==', folderId)
    );

    const unsubscribeBackgrounds = onSnapshot(
      backgroundsQuery,
      (snapshot) => {
        const nextBackgrounds = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setGalleryBackgrounds(sortBackgrounds(nextBackgrounds));
      },
      (error) => {
        console.error('Failed to load Grigliata gallery backgrounds:', error);
        setGalleryBackgrounds([]);
      }
    );

    return () => {
      unsubscribeBackgrounds();
    };
  }, [currentUserId, isManager, selectedGalleryFolderId]);

  useEffect(() => {
    const subscriptionGeneration = criticalBackgroundSubscriptionGenerationRef.current + 1;
    criticalBackgroundSubscriptionGenerationRef.current = subscriptionGeneration;

    if (!currentUserId || !criticalBackgroundIds.length) {
      setCriticalBackgroundsById({});
      setCriticalBackgroundResolutionById({});
      return undefined;
    }

    const criticalBackgroundIdSet = new Set(criticalBackgroundIds);
    setCriticalBackgroundsById((currentMap) => (
      Object.fromEntries(
        Object.entries(currentMap).filter(([backgroundId]) => criticalBackgroundIdSet.has(backgroundId))
      )
    ));
    setCriticalBackgroundResolutionById((currentMap) => Object.fromEntries(
      criticalBackgroundIds.map((backgroundId) => [
        backgroundId,
        currentMap[backgroundId] || 'loading',
      ])
    ));

    const unsubscribes = criticalBackgroundIds.map((backgroundId) => (
      onSnapshot(
        doc(db, 'grigliata_backgrounds', backgroundId),
        (snapshot) => {
          if (criticalBackgroundSubscriptionGenerationRef.current !== subscriptionGeneration) {
            return;
          }

          setCriticalBackgroundsById((currentMap) => {
            const nextMap = { ...currentMap };

            if (snapshot.exists()) {
              nextMap[backgroundId] = {
                id: snapshot.id,
                ...snapshot.data(),
              };
            } else {
              delete nextMap[backgroundId];
            }

            return nextMap;
          });
          setCriticalBackgroundResolutionById((currentMap) => ({
            ...currentMap,
            [backgroundId]: 'ready',
          }));
        },
        (error) => {
          if (criticalBackgroundSubscriptionGenerationRef.current !== subscriptionGeneration) {
            return;
          }

          console.error('Failed to load critical Grigliata background:', error);
          setCriticalBackgroundResolutionById((currentMap) => ({
            ...currentMap,
            [backgroundId]: 'error',
          }));
        }
      )
    ));

    return () => {
      if (criticalBackgroundSubscriptionGenerationRef.current === subscriptionGeneration) {
        criticalBackgroundSubscriptionGenerationRef.current += 1;
      }
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [criticalBackgroundIds, currentUserId]);

  const backgrounds = useMemo(() => {
    const backgroundsById = new Map();

    galleryBackgrounds.forEach((background) => {
      if (background?.id) {
        backgroundsById.set(background.id, background);
      }
    });

    Object.values(criticalBackgroundsById).forEach((background) => {
      if (background?.id) {
        backgroundsById.set(background.id, background);
      }
    });

    return sortBackgrounds([...backgroundsById.values()]);
  }, [criticalBackgroundsById, galleryBackgrounds]);

  useEffect(() => {
    const subscriptionGeneration = activePlacementSubscriptionGenerationRef.current + 1;
    activePlacementSubscriptionGenerationRef.current = subscriptionGeneration;

    if (!currentUserId || !activeBackgroundId) {
      setActivePlacementState({
        backgroundId: '',
        status: 'idle',
        items: [],
      });
      return undefined;
    }

    const subscribedBackgroundId = activeBackgroundId;
    setActivePlacementState({
      backgroundId: subscribedBackgroundId,
      status: 'loading',
      items: [],
    });

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
        if (activePlacementSubscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        const nextPlacements = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })).filter((placement) => placement?.backgroundId === subscribedBackgroundId);
        setActivePlacementState({
          backgroundId: subscribedBackgroundId,
          status: 'ready',
          items: nextPlacements,
        });
      },
      (error) => {
        if (activePlacementSubscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        console.error('Failed to load Grigliata token placements:', error);
        setActivePlacementState({
          backgroundId: subscribedBackgroundId,
          status: 'error',
          items: [],
        });
      }
    );

    return () => {
      if (activePlacementSubscriptionGenerationRef.current === subscriptionGeneration) {
        activePlacementSubscriptionGenerationRef.current += 1;
      }
      unsubscribePlacements();
    };
  }, [activeBackgroundId, currentUserId, isManager]);

  useEffect(() => {
    const subscriptionGeneration = aoeFigureSubscriptionGenerationRef.current + 1;
    aoeFigureSubscriptionGenerationRef.current = subscriptionGeneration;

    if (!currentUserId || !activeBackgroundId) {
      setAoeFigureState({
        backgroundId: '',
        items: [],
      });
      return undefined;
    }

    const subscribedBackgroundId = activeBackgroundId;
    setAoeFigureState({
      backgroundId: subscribedBackgroundId,
      items: [],
    });

    const mergeFigureCollections = (visibleFigures, ownFigures) => {
      if (aoeFigureSubscriptionGenerationRef.current !== subscriptionGeneration) {
        return;
      }

      const nextMap = new Map();

      [...visibleFigures, ...ownFigures].forEach((figure) => {
        if (figure?.id && figure?.backgroundId === subscribedBackgroundId) {
          nextMap.set(figure.id, figure);
        }
      });

      setAoeFigureState({
        backgroundId: subscribedBackgroundId,
        items: [...nextMap.values()],
      });
    };

    if (isManager) {
      const figuresQuery = query(
        collection(db, GRIGLIATA_AOE_FIGURE_COLLECTION),
        where('backgroundId', '==', activeBackgroundId)
      );

      const unsubscribeFigures = onSnapshot(
        figuresQuery,
        (snapshot) => {
          if (aoeFigureSubscriptionGenerationRef.current !== subscriptionGeneration) {
            return;
          }

          const nextFigures = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })).filter((figure) => figure?.backgroundId === subscribedBackgroundId);
          setAoeFigureState({
            backgroundId: subscribedBackgroundId,
            items: nextFigures,
          });
        },
        (error) => {
          if (aoeFigureSubscriptionGenerationRef.current !== subscriptionGeneration) {
            return;
          }

          console.error('Failed to load Grigliata AoE figures:', error);
          setAoeFigureState({
            backgroundId: subscribedBackgroundId,
            items: [],
          });
        }
      );

      return () => {
        if (aoeFigureSubscriptionGenerationRef.current === subscriptionGeneration) {
          aoeFigureSubscriptionGenerationRef.current += 1;
        }
        unsubscribeFigures();
      };
    }

    let visibleFigures = [];
    const ownFiguresById = new Map();

    const publishMergedFigures = () => {
      mergeFigureCollections(visibleFigures, [...ownFiguresById.values()]);
    };

    const visibleFiguresQuery = query(
      collection(db, GRIGLIATA_AOE_FIGURE_COLLECTION),
      where('backgroundId', '==', activeBackgroundId),
      where('isVisibleToPlayers', '==', true)
    );
    const unsubscribeVisibleFigures = onSnapshot(
      visibleFiguresQuery,
      (snapshot) => {
        visibleFigures = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        publishMergedFigures();
      },
      (error) => {
        console.error('Failed to load visible Grigliata AoE figures:', error);
        visibleFigures = [];
        publishMergedFigures();
      }
    );

    const ownFigureDocIds = GRIGLIATA_AOE_FIGURE_TYPES.flatMap((figureType) => (
      Array.from({ length: MAX_GRIGLIATA_AOE_FIGURES_PER_TYPE }, (_, index) => (
        buildGrigliataAoEFigureDocId(activeBackgroundId, currentUserId, figureType, index + 1)
      ))
    )).filter(Boolean);

    const unsubscribeOwnFigures = ownFigureDocIds.map((figureId) => (
      onSnapshot(
        doc(db, GRIGLIATA_AOE_FIGURE_COLLECTION, figureId),
        (snapshot) => {
          if (aoeFigureSubscriptionGenerationRef.current !== subscriptionGeneration) {
            return;
          }

          if (snapshot.exists()) {
            ownFiguresById.set(figureId, {
              id: snapshot.id,
              ...snapshot.data(),
            });
          } else {
            ownFiguresById.delete(figureId);
          }
          publishMergedFigures();
        },
        (error) => {
          if (aoeFigureSubscriptionGenerationRef.current !== subscriptionGeneration) {
            return;
          }

          console.error(`Failed to load owned Grigliata AoE figure ${figureId}:`, error);
          ownFiguresById.delete(figureId);
          publishMergedFigures();
        }
      )
    ));

    return () => {
      if (aoeFigureSubscriptionGenerationRef.current === subscriptionGeneration) {
        aoeFigureSubscriptionGenerationRef.current += 1;
      }
      unsubscribeVisibleFigures();
      unsubscribeOwnFigures.forEach((unsubscribe) => unsubscribe());
    };
  }, [activeBackgroundId, currentUserId, isManager]);

  useEffect(() => {
    const subscriptionGeneration = liveInteractionSubscriptionGenerationRef.current + 1;
    liveInteractionSubscriptionGenerationRef.current = subscriptionGeneration;

    if (!currentUserId || !activeBackgroundId) {
      setLiveInteractionState({
        backgroundId: '',
        items: [],
      });
      return undefined;
    }

    const subscribedBackgroundId = activeBackgroundId;
    setLiveInteractionState({
      backgroundId: subscribedBackgroundId,
      items: [],
    });

    const interactionsQuery = query(
      collection(db, GRIGLIATA_LIVE_INTERACTION_COLLECTION),
      where('backgroundId', '==', activeBackgroundId)
    );

    const unsubscribeInteractions = onSnapshot(
      interactionsQuery,
      (snapshot) => {
        if (liveInteractionSubscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        const nextInteractions = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })).filter((interaction) => interaction?.backgroundId === subscribedBackgroundId);
        setLiveInteractionState({
          backgroundId: subscribedBackgroundId,
          items: nextInteractions,
        });
      },
      (error) => {
        if (liveInteractionSubscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        console.error('Failed to load Grigliata live interactions:', error);
        setLiveInteractionState({
          backgroundId: subscribedBackgroundId,
          items: [],
        });
      }
    );

    return () => {
      if (liveInteractionSubscriptionGenerationRef.current === subscriptionGeneration) {
        liveInteractionSubscriptionGenerationRef.current += 1;
      }
      unsubscribeInteractions();
    };
  }, [activeBackgroundId, currentUserId]);

  useEffect(() => {
    if (!currentUserId || !isManager) {
      setMusicTracks([]);
      setMusicFolders([]);
      setMusicFoldersReadySubscriptionKey('');
      setMusicPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      setMusicPlaybackSessions([]);
      return undefined;
    }

    const unsubscribeMusicFolders = onSnapshot(
      collection(db, GRIGLIATA_MUSIC_FOLDERS_COLLECTION),
      (snapshot) => {
        const nextFolders = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setMusicFolders(sortMusicFolders(nextFolders));
        setMusicFoldersReadySubscriptionKey(managerFolderSubscriptionKey);
      },
      (error) => {
        console.error('Failed to load Grigliata music folders:', error);
      }
    );

    const musicFolderId = getWritableMusicFolderId(selectedMusicFolderId);
    const musicTracksQuery = query(
      collection(db, GRIGLIATA_MUSIC_TRACK_COLLECTION),
      where('musicFolderId', '==', musicFolderId)
    );

    const unsubscribeTracks = onSnapshot(
      musicTracksQuery,
      (snapshot) => {
        const nextTracks = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setMusicTracks(sortGrigliataMusicTracks(nextTracks));
      },
      (error) => {
        console.error('Failed to load Grigliata music tracks:', error);
        setMusicTracks([]);
      }
    );

    const unsubscribePlayback = onSnapshot(
      doc(db, GRIGLIATA_MUSIC_PLAYBACK_COLLECTION, GRIGLIATA_MUSIC_PLAYBACK_DOC_ID),
      (snapshot) => {
        setMusicPlaybackState(
          snapshot.exists()
            ? normalizeGrigliataMusicPlaybackState(snapshot.data({ serverTimestamps: 'estimate' }))
            : EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE
        );
      },
      (error) => {
        console.error('Failed to load Grigliata music playback state:', error);
        setMusicPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      }
    );

    const unsubscribePlaybackSessions = onSnapshot(
      collection(db, GRIGLIATA_MUSIC_PLAYBACK_SESSION_COLLECTION),
      (snapshot) => {
        const nextSessions = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data({ serverTimestamps: 'estimate' }),
        }));
        setMusicPlaybackSessions(sortGrigliataMusicPlaybackSessions(nextSessions));
      },
      (error) => {
        console.error('Failed to load Grigliata music playback sessions:', error);
        setMusicPlaybackSessions([]);
      }
    );

    return () => {
      unsubscribeMusicFolders();
      unsubscribeTracks();
      unsubscribePlayback();
      unsubscribePlaybackSessions();
    };
  }, [currentUserId, isManager, managerFolderSubscriptionKey, selectedMusicFolderId]);

  useEffect(() => {
    setLiveInteractionClock(Date.now());
    if (!activeBackgroundId) return undefined;

    const intervalId = window.setInterval(() => {
      setLiveInteractionClock(Date.now());
    }, LIVE_INTERACTION_CLOCK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [activeBackgroundId]);

  useEffect(() => {
    setPagePresenceClock(Date.now());
    if (!currentUserId) return undefined;

    const intervalId = window.setInterval(() => {
      setPagePresenceClock(Date.now());
    }, PAGE_PRESENCE_CLOCK_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [currentUserId]);

  const activeBackground = useMemo(
    () => backgrounds.find((background) => background.id === activeBackgroundId) || null,
    [backgrounds, activeBackgroundId]
  );
  const presentationPlacements = useMemo(
    () => normalizeNarrationPlacements({
      rawPlacements: boardState?.presentationPlacements,
      legacyBackgroundId: legacyPresentationBackgroundId,
      backgrounds,
    }),
    [backgrounds, boardState?.presentationPlacements, legacyPresentationBackgroundId]
  );
  const presentationBackgroundIds = useMemo(
    () => presentationPlacements.map((placement) => placement.backgroundId),
    [presentationPlacements]
  );
  const presentationBackgroundsById = useMemo(
    () => buildBackgroundMap(backgrounds.filter((background) => presentationBackgroundIds.includes(background.id))),
    [backgrounds, presentationBackgroundIds]
  );
  const presentationBackgroundId = presentationPlacements[0]?.backgroundId || '';
  const presentationBackground = presentationBackgroundId
    ? presentationBackgroundsById.get(presentationBackgroundId) || null
    : null;
  const presentationPrimaryBackground = presentationBackground;
  const displayBackground = presentationPrimaryBackground || activeBackground;

  const sharedInteractions = useMemo(
    () => filterActiveGrigliataLiveInteractions(
      liveInteractionSnapshots,
      liveInteractionClock,
      GRIGLIATA_LIVE_INTERACTION_STALE_MS
    ),
    [liveInteractionClock, liveInteractionSnapshots]
  );

  const activePageViewers = useMemo(
    () => filterActiveGrigliataPagePresence(pagePresenceSnapshots, pagePresenceClock),
    [pagePresenceClock, pagePresenceSnapshots]
  );

  const selectedBackground = useMemo(
    () => backgrounds.find((background) => background.id === selectedBackgroundId) || null,
    [backgrounds, selectedBackgroundId]
  );

  useEffect(() => {
    if (
      selectedBackgroundId
      && backgrounds.some((background) => background.id === selectedBackgroundId)
    ) {
      return;
    }

    if (
      selectedBackgroundId
      && criticalBackgroundResolutionById[selectedBackgroundId] !== 'ready'
    ) {
      return;
    }

    if (!backgrounds.length) {
      if (!isBoardStateReady) return;
      setSelectedBackgroundId('');
      return;
    }

    setSelectedBackgroundId((previousId) => {
      if (previousId && backgrounds.some((background) => background.id === previousId)) {
        return previousId;
      }
      if (presentationBackgroundId && backgrounds.some((background) => background.id === presentationBackgroundId)) {
        return presentationBackgroundId;
      }
      if (activeBackgroundId && backgrounds.some((background) => background.id === activeBackgroundId)) {
        return activeBackgroundId;
      }
      return backgrounds[0].id;
    });
  }, [
    activeBackgroundId,
    backgrounds,
    criticalBackgroundResolutionById,
    isBoardStateReady,
    presentationBackgroundId,
    selectedBackgroundId,
    setSelectedBackgroundId,
  ]);

  const normalizedHiddenTokenIdsByBackground = useMemo(
    () => normalizeHiddenTokenIdsByBackground(currentUserHiddenTokenIdsByBackground),
    [currentUserHiddenTokenIdsByBackground]
  );

  const sharedCharacterProfileIdsKey = useMemo(() => JSON.stringify(
    [...new Set(activePlacements
      .map((placement) => (
        typeof placement?.tokenId === 'string'
          && typeof placement?.ownerUid === 'string'
          && placement.tokenId === placement.ownerUid
          ? placement.tokenId
          : ''
      ))
      .filter((tokenId) => tokenId && tokenId !== currentUserId)
      .filter(Boolean))]
      .sort()
      // Character profiles are the only token contract whose document ID is
      // the owner UID. Excluding custom/foe placement IDs keeps every query
      // within the signed-in character read boundary. Fan-out stays bounded.
      .slice(0, GRIGLIATA_SHARED_CHARACTER_PROFILE_MAX_IDS)
  ), [activePlacements, currentUserId]);

  useEffect(() => {
    const profileIds = JSON.parse(sharedCharacterProfileIdsKey);
    if (!currentUserId || !profileIds.length) {
      setSharedCharacterProfilesById({});
      return undefined;
    }

    let active = true;
    const profileIdChunks = [];
    for (
      let offset = 0;
      offset < profileIds.length;
      offset += GRIGLIATA_SHARED_CHARACTER_PROFILE_QUERY_CHUNK_SIZE
    ) {
      profileIdChunks.push(
        profileIds.slice(
          offset,
          offset + GRIGLIATA_SHARED_CHARACTER_PROFILE_QUERY_CHUNK_SIZE
        )
      );
    }
    const profilesByChunkIndex = new Map();
    const publishSharedProfiles = () => {
      if (!active) return;
      const mergedProfiles = {};
      [...profilesByChunkIndex.keys()]
        .sort((left, right) => left - right)
        .forEach((chunkIndex) => {
          Object.assign(mergedProfiles, profilesByChunkIndex.get(chunkIndex));
        });
      setSharedCharacterProfilesById(mergedProfiles);
    };

    setSharedCharacterProfilesById({});
    const unsubscribes = profileIdChunks.map((chunkProfileIds, chunkIndex) => onSnapshot(
      query(
        collection(db, 'grigliata_tokens'),
        where(documentId(), 'in', chunkProfileIds),
        where('tokenType', '==', 'character')
      ),
      (snapshot) => {
        if (!active) return;
        const nextChunkProfiles = {};
        snapshot.docs.forEach((profileSnapshot) => {
          const profile = {
            id: profileSnapshot.id,
            ...profileSnapshot.data(),
          };
          if (
            profile.tokenType === 'character'
            && profile.ownerUid === profileSnapshot.id
            && chunkProfileIds.includes(profileSnapshot.id)
          ) {
            nextChunkProfiles[profileSnapshot.id] = profile;
          }
        });
        profilesByChunkIndex.set(chunkIndex, nextChunkProfiles);
        publishSharedProfiles();
      },
      (error) => {
        if (!active) return;
        console.error('Failed to load a shared Grigliata character profile:', error);
        profilesByChunkIndex.set(chunkIndex, {});
        publishSharedProfiles();
      }
    ));

    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [currentUserId, sharedCharacterProfileIdsKey]);

  const placedCanonicalMediaRequestKey = useMemo(() => JSON.stringify({
    accessGeneration: repositoryAccessGeneration,
    backgroundId: activeBackgroundId,
    placements: activePlacements
      .map((placement) => ({
        tokenId: typeof placement?.tokenId === 'string' && placement.tokenId
          ? placement.tokenId
          : placement?.ownerUid || '',
        ownerUid: placement?.ownerUid || '',
        imageUrl: typeof placement?.imageUrl === 'string' ? placement.imageUrl : '',
      }))
      .filter((placement) => placement.tokenId && placement.ownerUid)
      .sort((left, right) => left.tokenId.localeCompare(right.tokenId)),
  }), [activeBackgroundId, activePlacements, repositoryAccessGeneration]);

  useEffect(() => {
    const request = JSON.parse(placedCanonicalMediaRequestKey);
    const tokenIds = request.placements.map((placement) => placement.tokenId);
    const requestGeneration = placedCanonicalMediaRequestGenerationRef.current + 1;
    placedCanonicalMediaRequestGenerationRef.current = requestGeneration;
    let active = true;
    const isCurrentRequest = () => (
      active
      && placedCanonicalMediaRequestGenerationRef.current === requestGeneration
    );
    const publishMedia = (nextMediaByTokenId) => {
      if (!isCurrentRequest()) return;
      const current = placedCanonicalMediaByTokenIdRef.current;
      if (areCanonicalMediaMapsEqual(current, nextMediaByTokenId)) return;
      placedCanonicalMediaByTokenIdRef.current = nextMediaByTokenId;
      setPlacedCanonicalMediaByTokenId(nextMediaByTokenId);
    };
    if (
      !isCanonicalMediaAccessReady
      || !currentUserId
      || !request.backgroundId
      || !tokenIds.length
    ) {
      placedCanonicalMediaScopeRef.current = '';
      publishMedia({});
      return () => {
        active = false;
      };
    }

    let retryTimerId = null;
    const scope = JSON.stringify([
      currentUserId,
      request.accessGeneration,
      request.backgroundId,
    ]);
    const scopeChanged = placedCanonicalMediaScopeRef.current !== scope;
    placedCanonicalMediaScopeRef.current = scope;
    const expectedOwnersByTokenId = new Map(request.placements.map((placement) => (
      [placement.tokenId, placement.ownerUid]
    )));

    const currentMediaByTokenId = placedCanonicalMediaByTokenIdRef.current;
    const retainedMediaByTokenId = scopeChanged ? {} : Object.fromEntries(
      Object.entries(currentMediaByTokenId).filter(([tokenId, media]) => (
        expectedOwnersByTokenId.get(tokenId) === media?.ownerUid
      ))
    );
    publishMedia(retainedMediaByTokenId);

    const resolvePlacedMedia = (attempt = 0) => {
      resolveTask07PlacedCanonicalMedia({
        backgroundId: request.backgroundId,
        tokenIds,
      })
        .then((mediaByTokenId) => {
          publishMedia(mediaByTokenId);
        })
        .catch((error) => {
          if (!isCurrentRequest()) return;
          if (attempt < PLACED_CANONICAL_MEDIA_RETRY_DELAYS_MS.length) {
            retryTimerId = setTimeout(
              () => resolvePlacedMedia(attempt + 1),
              PLACED_CANONICAL_MEDIA_RETRY_DELAYS_MS[attempt]
            );
            return;
          }
          console.error(
            'Failed to resolve visible Grigliata token canonical media:',
            error
          );
        });
    };
    resolvePlacedMedia();

    return () => {
      active = false;
      if (placedCanonicalMediaRequestGenerationRef.current === requestGeneration) {
        placedCanonicalMediaRequestGenerationRef.current += 1;
      }
      if (retryTimerId !== null) clearTimeout(retryTimerId);
    };
  }, [
    currentUserId,
    isCanonicalMediaAccessReady,
    placedCanonicalMediaRequestKey,
  ]);

  const normalizedTokenProfiles = useMemo(
    () => [
      ...tokenProfiles,
      ...Object.values(sharedCharacterProfilesById),
    ]
      .map((token) => {
        const tokenId = typeof token?.id === 'string' ? token.id : '';
        const ownerUid = typeof token?.ownerUid === 'string' && token.ownerUid
          ? token.ownerUid
          : tokenId;

        if (!tokenId || !ownerUid) {
          return null;
        }

        const tokenType = token?.tokenType === 'foe'
          ? 'foe'
          : (
            token?.tokenType === 'custom' || tokenId !== ownerUid
              ? 'custom'
              : 'character'
          );
        const imageSource = tokenType === 'foe'
          ? 'foesHub'
          : (
            token?.imageSource === 'uploaded' || tokenType === 'custom'
              ? 'uploaded'
              : 'profile'
          );

        return {
          ...token,
          id: tokenId,
          ownerUid,
          tokenType,
          customTokenRole: resolveCustomTokenRole(token, tokenType),
          customTemplateId: resolveCustomTemplateId(token, tokenType, tokenId),
          imageSource,
        };
      })
      .filter(Boolean),
    [sharedCharacterProfilesById, tokenProfiles]
  );

  const normalizedActivePlacements = useMemo(
    () => activePlacements
      .map((placement) => {
        const tokenId = typeof placement?.tokenId === 'string' && placement.tokenId
          ? placement.tokenId
          : placement?.ownerUid || '';

        if (!placement?.backgroundId || !placement?.ownerUid || !tokenId) {
          return null;
        }

        return {
          ...placement,
          tokenId,
          label: typeof placement?.label === 'string' ? placement.label : '',
          imageUrl: typeof placement?.imageUrl === 'string' ? placement.imageUrl : '',
          sizeSquares: normalizeTokenSizeSquares(placement?.sizeSquares),
          ...(normalizeOptionalVisionEnabled(placement?.visionEnabled) !== undefined
            ? { visionEnabled: normalizeOptionalVisionEnabled(placement.visionEnabled) }
            : {}),
          ...(normalizeOptionalVisionRadiusSquares(placement?.visionRadiusSquares) !== undefined
            ? { visionRadiusSquares: normalizeOptionalVisionRadiusSquares(placement.visionRadiusSquares) }
            : {}),
          isInTurnOrder: placement?.isInTurnOrder === true,
          turnOrderInitiative: Number.isInteger(placement?.turnOrderInitiative)
            ? placement.turnOrderInitiative
            : null,
          turnOrderJoinedAt: placement?.turnOrderJoinedAt || null,
          turnCounter: normalizeTurnCounter(placement?.turnCounter, 0),
          turnEffects: normalizeTurnEffects(placement?.turnEffects),
        };
      })
      .filter(Boolean),
    [activePlacements]
  );

  const currentUserTokenProfileDoc = useMemo(
    () => normalizedTokenProfiles.find((token) => (
      token.ownerUid === currentUserId
      && token.id === currentUserId
      && token.tokenType === 'character'
    )) || null,
    [currentUserId, normalizedTokenProfiles]
  );

  const activePlacementsById = useMemo(() => {
    const nextMap = new Map();

    normalizedActivePlacements.forEach((placement) => {
      nextMap.set(buildPlacementDocId(placement.backgroundId, placement.tokenId), placement);
    });

    return nextMap;
  }, [normalizedActivePlacements]);

  const activePlacementsByTokenId = useMemo(() => {
    const nextMap = new Map();

    normalizedActivePlacements.forEach((placement) => {
      nextMap.set(placement.tokenId, placement);
    });

    return nextMap;
  }, [normalizedActivePlacements]);

  const tokenProfilesByTokenId = useMemo(() => {
    const nextMap = new Map();
    normalizedTokenProfiles.forEach((token) => {
      if (token?.id) {
        nextMap.set(token.id, token);
      }
    });
    return nextMap;
  }, [normalizedTokenProfiles]);

  const foeSourcesById = useMemo(() => {
    const nextMap = new Map();
    foeLibrary.forEach((foe) => {
      const foeId = typeof foe?.id === 'string' ? foe.id : '';
      if (foeId) {
        nextMap.set(foeId, foe);
      }
    });
    return nextMap;
  }, [foeLibrary]);

  const boardTokens = useMemo(
    () => normalizedActivePlacements
      .map((placement) => {
        const placementLabel = typeof placement?.label === 'string' ? placement.label.trim() : '';
        const placementImageUrl = typeof placement?.imageUrl === 'string' ? placement.imageUrl.trim() : '';
        const profile = tokenProfilesByTokenId.get(placement.tokenId)
          || (placement.tokenId === currentUserId ? {
            id: currentUserId,
            ownerUid: currentUserId,
            characterId: currentCharacterId,
            label: currentTokenLabel,
            imageUrl: currentImageUrl,
            imagePath: currentImagePath,
            media: currentMedia,
            tokenType: 'character',
            imageSource: 'profile',
          } : null);
        const placementTokenType = placement?.tokenType === 'foe'
          ? 'foe'
          : (placement?.tokenType === 'custom' ? 'custom' : '');
        const tokenType = profile?.tokenType
          || placementTokenType
          || (placement.tokenId !== placement.ownerUid ? 'custom' : 'character');
        const imageSource = profile?.imageSource || (
          tokenType === 'foe'
            ? 'foesHub'
            : (tokenType === 'custom' ? 'uploaded' : 'profile')
        );
        const tokenVisionSettings = normalizeTokenVisionSettings(placement);
        const isCurrentUserCharacter = (
          tokenType === 'character'
          && placement.tokenId === currentUserId
        );
        const foeSource = tokenType === 'foe' && profile?.foeSourceId
          ? foeSourcesById.get(profile.foeSourceId) || null
          : null;
        const customTokenProjection = tokenType === 'custom'
          ? resolveTask07CustomTokenMediaProjection({
            profile,
            profilesByTokenId: tokenProfilesByTokenId,
          })
          : null;
        const characterMedia = tokenType === 'character'
          ? (
            isCurrentUserCharacter
              ? currentMedia
              : placedCanonicalMediaByTokenId[placement.tokenId] || null
          )
          : null;
        const placedMedia = placedCanonicalMediaByTokenId[placement.tokenId] || null;
        const projectedMedia = resolveTask07BoardTokenCanonicalMedia({
          tokenType,
          profile,
          foeSource,
          customTokenProjection,
          characterMedia,
          placedMedia,
        });
        const profileImageUrl = typeof profile?.imageUrl === 'string'
          ? profile.imageUrl.trim()
          : '';
        const foeSourceImageUrl = typeof foeSource?.imageUrl === 'string'
          ? foeSource.imageUrl.trim()
          : '';
        const profileImagePath = typeof profile?.imagePath === 'string'
          ? profile.imagePath.trim()
          : '';
        const foeSourceImagePath = typeof foeSource?.imagePath === 'string'
          ? foeSource.imagePath.trim()
          : '';
        const projectedImageUrl = isCurrentUserCharacter && currentMedia
          ? currentImageUrl
          : (tokenType === 'foe'
            ? (profileImageUrl || foeSourceImageUrl || placementImageUrl)
            : (placementImageUrl || customTokenProjection?.imageUrl || profileImageUrl));
        const projectedImagePath = isCurrentUserCharacter && currentMedia
          ? currentImagePath
          : (tokenType === 'foe'
            ? (profileImagePath || foeSourceImagePath)
            : (customTokenProjection?.imagePath || profileImagePath));

        return {
          ...(profile || {}),
          id: placement.tokenId,
          tokenId: placement.tokenId,
          backgroundId: placement.backgroundId,
          ownerUid: placement.ownerUid,
          characterId: profile?.characterId || '',
          tokenType,
          customTokenRole: tokenType === 'custom' ? (profile?.customTokenRole || 'template') : '',
          customTemplateId: tokenType === 'custom'
            ? (profile?.customTemplateId || placement.tokenId)
            : '',
          imageSource,
          label: placementLabel || profile?.label || placement.ownerUid || 'Player',
          imageUrl: projectedImageUrl,
          imagePath: projectedImagePath,
          media: projectedMedia,
          category: profile?.category || '',
          rank: profile?.rank || '',
          dadoAnima: profile?.dadoAnima || '',
          notes: profile?.notes || '',
          foeSourceId: profile?.foeSourceId || '',
          stats: profile?.stats || {},
          Parametri: profile?.Parametri || {},
          spells: Array.isArray(profile?.spells) ? profile.spells : [],
          tecniche: Array.isArray(profile?.tecniche) ? profile.tecniche : [],
          col: Number.isFinite(placement?.col) ? placement.col : 0,
          row: Number.isFinite(placement?.row) ? placement.row : 0,
          sizeSquares: normalizeTokenSizeSquares(placement?.sizeSquares),
          isVisibleToPlayers: placement?.isVisibleToPlayers !== false,
          isDead: placement?.isDead === true,
          statuses: Array.isArray(placement?.statuses) ? placement.statuses : [],
          visionEnabled: tokenVisionSettings.visionEnabled,
          visionRadiusSquares: tokenVisionSettings.visionRadiusSquares,
          isInTurnOrder: placement?.isInTurnOrder === true,
          turnOrderInitiative: Number.isInteger(placement?.turnOrderInitiative)
            ? placement.turnOrderInitiative
            : null,
          turnOrderJoinedAt: placement?.turnOrderJoinedAt || null,
          turnCounter: normalizeTurnCounter(placement?.turnCounter, 0),
          turnEffects: normalizeTurnEffects(placement?.turnEffects),
          placed: true,
        };
      }),
    [
      currentCharacterId,
      currentMedia,
      currentImagePath,
      currentImageUrl,
      currentTokenLabel,
      currentUserId,
      foeSourcesById,
      normalizedActivePlacements,
      placedCanonicalMediaByTokenId,
      tokenProfilesByTokenId,
    ]
  );

  const turnOrderEntries = useMemo(
    () => sortTurnOrderEntries([...boardTokens]
      .filter((token) => token?.isInTurnOrder === true)
      .map((token) => ({
        tokenId: token.tokenId,
        ownerUid: token.ownerUid,
        label: token.label || token.characterId || token.ownerUid || 'Token',
        imageUrl: token.imageUrl || '',
        media: getEntityMedia(token),
        tokenType: token.tokenType || 'character',
        isVisibleToPlayers: token.isVisibleToPlayers !== false,
        initiative: Number.isInteger(token.turnOrderInitiative) ? token.turnOrderInitiative : 0,
        joinedAt: token.turnOrderJoinedAt || null,
        joinedAtMs: token.turnOrderJoinedAt ? timestampToMillis(token.turnOrderJoinedAt) : Number.MAX_SAFE_INTEGER,
      }))),
    [boardTokens]
  );

  const customUserTokenProfiles = useMemo(
    () => [...normalizedTokenProfiles]
      .filter((token) => token.ownerUid === currentUserId && isCustomTemplateToken(token))
      .sort((left, right) => {
        const rightMillis = timestampToMillis(right.updatedAt || right.createdAt);
        const leftMillis = timestampToMillis(left.updatedAt || left.createdAt);
        if (rightMillis !== leftMillis) {
          return rightMillis - leftMillis;
        }
        return (left.label || '').localeCompare(right.label || '');
      }),
    [currentUserId, normalizedTokenProfiles]
  );

  const activeCustomPlacementCountsByTemplateId = useMemo(() => {
    const nextMap = new Map();

    normalizedActivePlacements.forEach((placement) => {
      const tokenProfile = tokenProfilesByTokenId.get(placement.tokenId);
      if (tokenProfile?.tokenType !== 'custom') {
        return;
      }

      const templateId = tokenProfile.customTemplateId || tokenProfile.id || placement.tokenId;
      nextMap.set(templateId, (nextMap.get(templateId) || 0) + 1);
    });

    return nextMap;
  }, [normalizedActivePlacements, tokenProfilesByTokenId]);

  const currentUserPlacement = useMemo(
    () => activePlacementsByTokenId.get(currentUserId) || null,
    [activePlacementsByTokenId, currentUserId]
  );

  const isCurrentUserTokenHiddenOnActiveMap = useMemo(
    () => !isManager
      && !currentUserPlacement
      && !!activeBackgroundId
      && (
        (normalizedHiddenTokenIdsByBackground[activeBackgroundId] || []).includes(currentUserId)
        || currentUserHiddenBackgroundIds.includes(activeBackgroundId)
      ),
    [
      activeBackgroundId,
      currentUserHiddenBackgroundIds,
      currentUserId,
      currentUserPlacement,
      isManager,
      normalizedHiddenTokenIdsByBackground,
    ]
  );

  const currentUserToken = useMemo(() => {
    const tokenVisionSettings = normalizeTokenVisionSettings(currentUserPlacement);

    return {
      id: currentUserId,
      tokenId: currentUserId,
      ownerUid: currentUserId,
      characterId: currentCharacterId,
      tokenType: 'character',
      imageSource: currentUserTokenProfileDoc?.imageSource || 'profile',
      label: currentUserTokenProfileDoc?.label || currentTokenLabel,
      imageUrl: currentMedia ? currentImageUrl : (currentUserTokenProfileDoc?.imageUrl || currentImageUrl),
      imagePath: currentMedia ? currentImagePath : (currentUserTokenProfileDoc?.imagePath || currentImagePath),
      media: currentMedia || getEntityMedia(currentUserTokenProfileDoc),
      placed: !!currentUserPlacement,
      col: Number.isFinite(currentUserPlacement?.col) ? currentUserPlacement.col : 0,
      row: Number.isFinite(currentUserPlacement?.row) ? currentUserPlacement.row : 0,
      sizeSquares: normalizeTokenSizeSquares(currentUserPlacement?.sizeSquares),
      isVisibleToPlayers: currentUserPlacement?.isVisibleToPlayers !== false,
      isDead: currentUserPlacement?.isDead === true,
      statuses: Array.isArray(currentUserPlacement?.statuses) ? currentUserPlacement.statuses : [],
      visionEnabled: tokenVisionSettings.visionEnabled,
      visionRadiusSquares: tokenVisionSettings.visionRadiusSquares,
      isHiddenByManager: isCurrentUserTokenHiddenOnActiveMap,
    };
  }, [
    currentCharacterId,
    currentImagePath,
    currentImageUrl,
    currentMedia,
    currentTokenLabel,
    currentUserId,
    currentUserPlacement,
    currentUserTokenProfileDoc,
    isCurrentUserTokenHiddenOnActiveMap,
  ]);

  const customUserTokens = useMemo(
    () => customUserTokenProfiles.map((tokenProfile) => {
      const activePlacementCount = activeCustomPlacementCountsByTemplateId.get(tokenProfile.id) || 0;
      const stats = tokenProfile?.stats || {};
      const hpTotal = normalizeResourceValue(stats.hpTotal, normalizeResourceValue(stats.hpCurrent, 0));
      const manaTotal = normalizeResourceValue(stats.manaTotal, normalizeResourceValue(stats.manaCurrent, 0));
      const shieldTotal = normalizeResourceValue(stats.shieldTotal, normalizeResourceValue(stats.shieldCurrent, 0));

      return {
        id: tokenProfile.id,
        tokenId: tokenProfile.id,
        ownerUid: tokenProfile.ownerUid,
        characterId: tokenProfile.characterId || '',
        tokenType: 'custom',
        customTokenRole: 'template',
        customTemplateId: tokenProfile.customTemplateId || tokenProfile.id,
        imageSource: tokenProfile.imageSource || 'uploaded',
        label: tokenProfile.label || 'Custom Token',
        imageUrl: tokenProfile.imageUrl || '',
        imagePath: tokenProfile.imagePath || '',
        media: getEntityMedia(tokenProfile),
        task07MediaRevision: tokenProfile.task07MediaRevision,
        placed: activePlacementCount > 0,
        activePlacementCount,
        col: 0,
        row: 0,
        sizeSquares: 1,
        isVisibleToPlayers: true,
        isDead: false,
        statuses: [],
        isHiddenByManager: false,
        hpCurrent: normalizeResourceValue(stats.hpCurrent, hpTotal),
        hpTotal,
        manaCurrent: normalizeResourceValue(stats.manaCurrent, manaTotal),
        manaTotal,
        shieldCurrent: normalizeResourceValue(stats.shieldCurrent, shieldTotal),
        shieldTotal,
        hasShield: true,
        createdAt: tokenProfile.createdAt || null,
        updatedAt: tokenProfile.updatedAt || null,
      };
    }),
    [
      activeCustomPlacementCountsByTemplateId,
      customUserTokenProfiles,
    ]
  );

  const persistedActiveGrid = useMemo(
    () => normalizeGridConfig(activeBackground?.grid),
    [activeBackground]
  );
  const isGridVisible = activeBackground?.isGridVisible !== false;
  const isTurnOrderEnabled = true;
  const turnOrderActiveState = activeBackground?.turnOrderActive && typeof activeBackground.turnOrderActive === 'object'
    ? activeBackground.turnOrderActive
    : null;
  const activeTurnTokenId = typeof turnOrderActiveState?.tokenId === 'string'
    ? turnOrderActiveState.tokenId
    : '';
  const activeTurnEntry = useMemo(
    () => turnOrderEntries.find((entry) => entry.tokenId === activeTurnTokenId) || null,
    [activeTurnTokenId, turnOrderEntries]
  );
  const isTurnOrderStarted = !!activeTurnTokenId;

  const grid = useMemo(() => {
    if (!activeBackgroundId || activeGridSizeOverride?.backgroundId !== activeBackgroundId) {
      return persistedActiveGrid;
    }

    return normalizeGridConfig({
      ...persistedActiveGrid,
      ...activeGridSizeOverride.grid,
      ...(Number.isFinite(activeGridSizeOverride.cellSizePx)
        ? { cellSizePx: activeGridSizeOverride.cellSizePx }
        : {}),
    });
  }, [activeBackgroundId, activeGridSizeOverride, persistedActiveGrid]);

  return {
    activeBackground,
    activeBackgroundId,
    activePageViewers,
    activePlacementsById,
    activePlacementsStatus,
    aoeFigureSnapshots,
    backgrounds,
    boardState,
    boardTokens,
    currentUserToken,
    currentUserTokenProfileDoc,
    customUserTokens,
    displayBackground,
    foeLibrary,
    galleryBackgrounds,
    galleryFolders,
    grid,
    isActivePlacementsReady,
    isBoardStateReady,
    isGalleryFoldersReady,
    isMusicFoldersReady,
    isCurrentUserTokenHiddenOnActiveMap,
    isGridVisible,
    isTokenProfilesReady: !!currentUserId && tokenProfilesReadyUserId === currentUserId,
    isTurnOrderEnabled,
    isTurnOrderStarted,
    activeTurnEntry,
    activeTurnTokenId,
    musicPlaybackState,
    musicPlaybackSessions,
    musicFolders,
    musicTracks,
    persistedActiveGrid,
    presentationBackground,
    presentationBackgroundIds,
    presentationBackgroundsById,
    presentationBackgroundId,
    presentationPlacements,
    presentationPrimaryBackground,
    selectedBackground,
    selectedBackgroundId,
    setSelectedBackgroundId,
    sharedInteractions,
    tokenProfilesByTokenId,
    turnOrderEntries,
  };
}
