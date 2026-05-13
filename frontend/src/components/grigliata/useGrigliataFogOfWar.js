import { useEffect, useState } from 'react';
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

export default function useGrigliataFogOfWar({
  backgroundId = '',
  currentUserId = '',
  isManager = false,
}) {
  const [legacyFogState, setLegacyFogState] = useState({
    fogOfWar: null,
    isReady: false,
  });
  const [rasterTileState, setRasterTileState] = useState({
    memoryTiles: [],
    isReady: false,
  });

  useEffect(() => {
    const fogDocId = buildGrigliataFogOfWarDocId(backgroundId, currentUserId);

    if (!fogDocId || isManager) {
      setLegacyFogState({ fogOfWar: null, isReady: false });
      setRasterTileState({ memoryTiles: [], isReady: false });
      return undefined;
    }

    setLegacyFogState({ fogOfWar: null, isReady: false });
    setRasterTileState({ memoryTiles: [], isReady: false });

    const unsubscribeLegacyFog = onSnapshot(
      doc(db, GRIGLIATA_FOG_OF_WAR_COLLECTION, fogDocId),
      (snapshot) => {
        setLegacyFogState({
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
        console.error('Failed to load Grigliata fog of war:', error);
        setLegacyFogState({ fogOfWar: null, isReady: true });
      }
    );

    const unsubscribeRasterTiles = onSnapshot(
      query(
        collection(db, GRIGLIATA_FOG_MEMORY_TILES_COLLECTION),
        where('backgroundId', '==', backgroundId),
        where('ownerUid', '==', currentUserId),
        where('rasterProfileId', '==', FOG_RASTER_PROFILE_ID)
      ),
      (snapshot) => {
        const memoryTiles = (snapshot.docs || [])
          .map((docSnapshot) => normalizeFogRasterMemoryTileDoc({
            id: docSnapshot.id,
            ...docSnapshot.data(),
          }))
          .filter(Boolean)
          .sort(sortMemoryTiles);

        setRasterTileState({
          memoryTiles,
          isReady: true,
        });
      },
      (error) => {
        console.error('Failed to load Grigliata raster fog memory:', error);
        setRasterTileState({ memoryTiles: [], isReady: true });
      }
    );

    return () => {
      unsubscribeLegacyFog();
      unsubscribeRasterTiles();
    };
  }, [backgroundId, currentUserId, isManager]);

  const isFogOfWarReady = legacyFogState.isReady && rasterTileState.isReady;
  const fogOfWar = isFogOfWarReady && (
    legacyFogState.fogOfWar || rasterTileState.memoryTiles.length > 0
  )
    ? {
      ...(legacyFogState.fogOfWar || {
        id: buildGrigliataFogOfWarDocId(backgroundId, currentUserId),
        backgroundId,
        ownerUid: currentUserId,
        cellSizePx: 0,
        exploredCells: [],
        exploredPolygons: [],
        updatedAt: null,
        updatedBy: '',
      }),
      memoryTiles: rasterTileState.memoryTiles,
      memoryTilesById: buildTileMap(rasterTileState.memoryTiles),
    }
    : null;

  return {
    fogOfWar,
    isFogOfWarReady,
    isRasterFogReady: rasterTileState.isReady,
  };
}
