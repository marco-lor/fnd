import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
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
  GRIGLIATA_MUSIC_TRACK_COLLECTION,
  normalizeGrigliataMusicPlaybackState,
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

const LIVE_INTERACTION_CLOCK_INTERVAL_MS = 15 * 1000;
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

export default function useGrigliataPageData({
  currentUserId = '',
  currentCharacterId = '',
  currentTokenLabel = '',
  currentImageUrl = '',
  currentImagePath = '',
  currentUserHiddenBackgroundIds = [],
  currentUserHiddenTokenIdsByBackground = {},
  isManager = false,
  activeGridSizeOverride = null,
}) {
  const [backgrounds, setBackgrounds] = useState([]);
  const [boardState, setBoardState] = useState({});
  const [foeLibrary, setFoeLibrary] = useState([]);
  const [tokenProfiles, setTokenProfiles] = useState([]);
  const [activePlacements, setActivePlacements] = useState([]);
  const [isActivePlacementsReady, setIsActivePlacementsReady] = useState(false);
  const [aoeFigureSnapshots, setAoEFigureSnapshots] = useState([]);
  const [liveInteractionSnapshots, setLiveInteractionSnapshots] = useState([]);
  const [pagePresenceSnapshots, setPagePresenceSnapshots] = useState([]);
  const [musicTracks, setMusicTracks] = useState([]);
  const [musicPlaybackState, setMusicPlaybackState] = useState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
  const [selectedBackgroundId, setSelectedBackgroundId] = useState('');
  const [liveInteractionClock, setLiveInteractionClock] = useState(() => Date.now());
  const [pagePresenceClock, setPagePresenceClock] = useState(() => Date.now());

  useEffect(() => {
    if (!currentUserId) {
      setBackgrounds([]);
      setBoardState({});
      setFoeLibrary([]);
      setTokenProfiles([]);
      setPagePresenceSnapshots([]);
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
      },
      (error) => {
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
      unsubscribeBackgrounds();
      unsubscribeState();
      unsubscribeFoes();
      unsubscribeTokenProfiles();
      unsubscribePagePresence();
    };
  }, [currentUserId, isManager]);

  const activeBackgroundId = typeof boardState?.activeBackgroundId === 'string'
    ? boardState.activeBackgroundId
    : '';
  const presentationBackgroundId = typeof boardState?.presentationBackgroundId === 'string'
    ? boardState.presentationBackgroundId
    : '';

  useEffect(() => {
    if (!currentUserId || !activeBackgroundId) {
      setActivePlacements([]);
      setIsActivePlacementsReady(false);
      return undefined;
    }

    setIsActivePlacementsReady(false);

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
        setIsActivePlacementsReady(true);
      },
      (error) => {
        console.error('Failed to load Grigliata token placements:', error);
        setActivePlacements([]);
        setIsActivePlacementsReady(true);
      }
    );

    return () => unsubscribePlacements();
  }, [activeBackgroundId, currentUserId, isManager]);

  useEffect(() => {
    if (!currentUserId || !activeBackgroundId) {
      setAoEFigureSnapshots([]);
      return undefined;
    }

    const mergeFigureCollections = (visibleFigures, ownFigures) => {
      const nextMap = new Map();

      [...visibleFigures, ...ownFigures].forEach((figure) => {
        if (figure?.id) {
          nextMap.set(figure.id, figure);
        }
      });

      setAoEFigureSnapshots([...nextMap.values()]);
    };

    if (isManager) {
      const figuresQuery = query(
        collection(db, GRIGLIATA_AOE_FIGURE_COLLECTION),
        where('backgroundId', '==', activeBackgroundId)
      );

      const unsubscribeFigures = onSnapshot(
        figuresQuery,
        (snapshot) => {
          const nextFigures = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          setAoEFigureSnapshots(nextFigures);
        },
        (error) => {
          console.error('Failed to load Grigliata AoE figures:', error);
          setAoEFigureSnapshots([]);
        }
      );

      return () => unsubscribeFigures();
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
          console.error(`Failed to load owned Grigliata AoE figure ${figureId}:`, error);
          ownFiguresById.delete(figureId);
          publishMergedFigures();
        }
      )
    ));

    return () => {
      unsubscribeVisibleFigures();
      unsubscribeOwnFigures.forEach((unsubscribe) => unsubscribe());
    };
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
    if (!currentUserId || !isManager) {
      setMusicTracks([]);
      setMusicPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      return undefined;
    }

    const unsubscribeTracks = onSnapshot(
      collection(db, GRIGLIATA_MUSIC_TRACK_COLLECTION),
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
            ? normalizeGrigliataMusicPlaybackState(snapshot.data())
            : EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE
        );
      },
      (error) => {
        console.error('Failed to load Grigliata music playback state:', error);
        setMusicPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      }
    );

    return () => {
      unsubscribeTracks();
      unsubscribePlayback();
    };
  }, [currentUserId, isManager]);

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
  const presentationBackground = useMemo(
    () => backgrounds.find((background) => background.id === presentationBackgroundId) || null,
    [backgrounds, presentationBackgroundId]
  );
  const displayBackground = presentationBackground || activeBackground;

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
    if (!backgrounds.length) {
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
  }, [backgrounds, activeBackgroundId, presentationBackgroundId]);

  const normalizedHiddenTokenIdsByBackground = useMemo(
    () => normalizeHiddenTokenIdsByBackground(currentUserHiddenTokenIdsByBackground),
    [currentUserHiddenTokenIdsByBackground]
  );

  const normalizedTokenProfiles = useMemo(
    () => tokenProfiles
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
    [tokenProfiles]
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
            tokenType: 'character',
            imageSource: 'profile',
          } : null);
        const tokenType = profile?.tokenType || (placement.tokenId !== placement.ownerUid ? 'custom' : 'character');
        const imageSource = profile?.imageSource || (
          tokenType === 'foe'
            ? 'foesHub'
            : (tokenType === 'custom' ? 'uploaded' : 'profile')
        );
        const tokenVisionSettings = normalizeTokenVisionSettings(placement);

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
          imageUrl: placementImageUrl || profile?.imageUrl || '',
          imagePath: profile?.imagePath || '',
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
      currentImagePath,
      currentImageUrl,
      currentTokenLabel,
      currentUserId,
      normalizedActivePlacements,
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
        tokenType: token.tokenType || 'character',
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
      imageUrl: currentUserTokenProfileDoc?.imageUrl || currentImageUrl,
      imagePath: currentUserTokenProfileDoc?.imagePath || currentImagePath,
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
    currentTokenLabel,
    currentUserId,
    currentUserPlacement,
    currentUserTokenProfileDoc,
    isCurrentUserTokenHiddenOnActiveMap,
  ]);

  const customUserTokens = useMemo(
    () => customUserTokenProfiles.map((tokenProfile) => {
      const activePlacementCount = activeCustomPlacementCountsByTemplateId.get(tokenProfile.id) || 0;

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
        placed: activePlacementCount > 0,
        activePlacementCount,
        col: 0,
        row: 0,
        sizeSquares: 1,
        isVisibleToPlayers: true,
        isDead: false,
        statuses: [],
        isHiddenByManager: false,
        createdAt: tokenProfile.createdAt || null,
        updatedAt: tokenProfile.updatedAt || null,
      };
    }),
    [
      activeCustomPlacementCountsByTemplateId,
      currentUserId,
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
  };
}
