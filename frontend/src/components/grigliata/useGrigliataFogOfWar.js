import { useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  buildGrigliataFogOfWarDocId,
  GRIGLIATA_FOG_OF_WAR_COLLECTION,
  normalizeGrigliataFogOfWarDoc,
} from './fogOfWar';
import {
  FOG_RASTER_PROFILE_ID,
  GRIGLIATA_FOG_MEMORY_TILES_COLLECTION,
  normalizeFogRasterMemoryTileDoc,
} from './fogRasterMemory';

const buildTileMap = (memoryTiles = []) => (
  memoryTiles.reduce((tileMap, tile) => {
    if (tile?.id) {
      tileMap[tile.id] = tile;
    }
    return tileMap;
  }, {})
);

const sortMemoryTiles = (left, right) => (
  left.tileRow - right.tileRow
  || left.tileCol - right.tileCol
  || left.id.localeCompare(right.id)
);

export function useGrigliataFogRasterMemory({
  backgroundId = '',
  ownerUid = '',
  enabled = true,
}) {
  const rasterScopeKey = enabled && backgroundId && ownerUid
    ? `${backgroundId}::${ownerUid}`
    : '';
  const [rasterTileState, setRasterTileState] = useState({
    scopeKey: '',
    memoryTiles: [],
    isReady: false,
  });
  const rasterSubscriptionGenerationRef = useRef(0);
  const isCurrentRasterScope = rasterTileState.scopeKey === rasterScopeKey;
  const currentMemoryTiles = isCurrentRasterScope ? rasterTileState.memoryTiles : [];
  const isRasterFogReady = isCurrentRasterScope && rasterTileState.isReady;

  useEffect(() => {
    const subscriptionGeneration = rasterSubscriptionGenerationRef.current + 1;
    rasterSubscriptionGenerationRef.current = subscriptionGeneration;

    if (!enabled || !backgroundId || !ownerUid) {
      setRasterTileState({ scopeKey: '', memoryTiles: [], isReady: false });
      return undefined;
    }

    const subscriptionScopeKey = `${backgroundId}::${ownerUid}`;
    setRasterTileState({
      scopeKey: subscriptionScopeKey,
      memoryTiles: [],
      isReady: false,
    });

    const unsubscribeRasterTiles = onSnapshot(
      query(
        collection(db, GRIGLIATA_FOG_MEMORY_TILES_COLLECTION),
        where('backgroundId', '==', backgroundId),
        where('ownerUid', '==', ownerUid),
        where('rasterProfileId', '==', FOG_RASTER_PROFILE_ID)
      ),
      (snapshot) => {
        if (rasterSubscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        const memoryTiles = (snapshot.docs || [])
          .map((docSnapshot) => normalizeFogRasterMemoryTileDoc({
            id: docSnapshot.id,
            ...docSnapshot.data(),
          }))
          .filter((tile) => (
            tile?.backgroundId === backgroundId
            && tile?.ownerUid === ownerUid
          ))
          .sort(sortMemoryTiles);

        setRasterTileState({
          scopeKey: subscriptionScopeKey,
          memoryTiles,
          isReady: true,
        });
      },
      (error) => {
        if (rasterSubscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        console.error('Failed to load Grigliata raster fog memory:', error);
        setRasterTileState({
          scopeKey: subscriptionScopeKey,
          memoryTiles: [],
          isReady: true,
        });
      }
    );

    return () => {
      if (rasterSubscriptionGenerationRef.current === subscriptionGeneration) {
        rasterSubscriptionGenerationRef.current += 1;
      }
      unsubscribeRasterTiles();
    };
  }, [backgroundId, enabled, ownerUid]);

  return {
    memoryTiles: currentMemoryTiles,
    memoryTilesById: buildTileMap(currentMemoryTiles),
    isRasterFogReady,
  };
}

export default function useGrigliataFogOfWar({
  backgroundId = '',
  currentUserId = '',
  isManager = false,
}) {
  const fogDocId = buildGrigliataFogOfWarDocId(backgroundId, currentUserId);
  const legacyScopeKey = fogDocId && !isManager ? fogDocId : '';
  const [legacyFogState, setLegacyFogState] = useState({
    scopeKey: '',
    fogOfWar: null,
    isReady: false,
  });
  const legacySubscriptionGenerationRef = useRef(0);
  const isCurrentLegacyScope = legacyFogState.scopeKey === legacyScopeKey;
  const currentLegacyFogOfWar = isCurrentLegacyScope ? legacyFogState.fogOfWar : null;
  const isLegacyFogReady = isCurrentLegacyScope && legacyFogState.isReady;
  const {
    memoryTiles,
    memoryTilesById,
    isRasterFogReady,
  } = useGrigliataFogRasterMemory({
    backgroundId,
    ownerUid: currentUserId,
    enabled: !!fogDocId && !isManager,
  });

  useEffect(() => {
    const subscriptionGeneration = legacySubscriptionGenerationRef.current + 1;
    legacySubscriptionGenerationRef.current = subscriptionGeneration;

    if (!fogDocId || isManager) {
      setLegacyFogState({ scopeKey: '', fogOfWar: null, isReady: false });
      return undefined;
    }

    setLegacyFogState({ scopeKey: fogDocId, fogOfWar: null, isReady: false });

    const unsubscribeLegacyFog = onSnapshot(
      doc(db, GRIGLIATA_FOG_OF_WAR_COLLECTION, fogDocId),
      (snapshot) => {
        if (legacySubscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        setLegacyFogState({
          scopeKey: fogDocId,
          fogOfWar: snapshot.exists()
            ? normalizeGrigliataFogOfWarDoc({
            id: snapshot.id,
            ...snapshot.data(),
          })
            : null,
          isReady: true,
        });
      },
      (error) => {
        if (legacySubscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        console.error('Failed to load Grigliata fog of war:', error);
        setLegacyFogState({ scopeKey: fogDocId, fogOfWar: null, isReady: true });
      }
    );

    return () => {
      if (legacySubscriptionGenerationRef.current === subscriptionGeneration) {
        legacySubscriptionGenerationRef.current += 1;
      }
      unsubscribeLegacyFog();
    };
  }, [backgroundId, currentUserId, fogDocId, isManager]);

  const isFogOfWarReady = isLegacyFogReady && isRasterFogReady;
  const fogOfWar = isFogOfWarReady && (
    currentLegacyFogOfWar || memoryTiles.length > 0
  )
    ? {
      ...(currentLegacyFogOfWar || {
        id: buildGrigliataFogOfWarDocId(backgroundId, currentUserId),
        backgroundId,
        ownerUid: currentUserId,
        cellSizePx: 0,
        exploredCells: [],
        exploredPolygons: [],
        updatedAt: null,
        updatedBy: '',
      }),
      memoryTiles,
      memoryTilesById,
    }
    : null;

  return {
    fogOfWar,
    isFogOfWarReady,
    isRasterFogReady,
  };
}
