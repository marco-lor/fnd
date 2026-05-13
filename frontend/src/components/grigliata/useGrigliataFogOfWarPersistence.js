import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  getTokenPositionPx,
  normalizeGridConfig,
} from './boardUtils';
import {
  buildTokenVisionPolygons,
  normalizeLightingWallSegments,
} from './lightingGeometry';
import {
  DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
  resolveViewerTokenVisionSources,
} from './lightingVisibility';
import {
  buildCurrentFogCellKeys,
  buildCurrentFogMemoryPolygons,
  buildCurrentFogRenderPolygons,
  buildGrigliataFogOfWarDocId,
} from './fogOfWar';
import {
  buildFogRasterTilePayload,
  countFogRasterMaskBits,
  GRIGLIATA_FOG_MEMORY_TILES_COLLECTION,
  maskContainsFogRasterBits,
  mergeFogRasterMemoryTiles,
  mergeFogRasterTileMasks,
  normalizeFogRasterMemoryTileDoc,
  rasterizeFogPolygonsToTiles,
} from './fogRasterMemory';
import { logGrigliataFogDebug } from './fogDebug';

export const GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS = 350;
export const DEFAULT_FOG_VISION_RAY_COUNT = 256;

const tileMatchesGrid = (tile, grid) => (
  tile?.cellSizePx === grid.cellSizePx
  && tile?.offsetXPx === grid.offsetXPx
  && tile?.offsetYPx === grid.offsetYPx
);

const buildTileMap = (tiles = []) => (
  mergeFogRasterMemoryTiles(tiles).reduce((tileMap, tile) => {
    tileMap.set(tile.id, tile);
    return tileMap;
  }, new Map())
);

const buildRenderableTokensForFog = ({ tokens = [], grid }) => (
  (Array.isArray(tokens) ? tokens : []).map((token) => ({
    ...token,
    renderPosition: token?.renderPosition || getTokenPositionPx(token, grid),
  }))
);

export const buildViewerFogCurrentVisibleCells = ({
  ...args
} = {}) => buildViewerFogCurrentVisibility(args).currentVisibleCells;

export const buildViewerFogCurrentVisibility = ({
  tokens = [],
  currentUserId = '',
  isManager = false,
  grid,
  lightingRenderInput = null,
  rayCount,
} = {}) => {
  if (!lightingRenderInput || isManager) {
    return {
      currentVisibleCells: [],
      currentVisiblePolygons: [],
      currentPersistencePolygons: [],
    };
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const renderableTokens = buildRenderableTokensForFog({
    tokens,
    grid: normalizedGrid,
  });
  const visionSources = resolveViewerTokenVisionSources({
    tokens: renderableTokens,
    currentUserId,
    isManager,
    cellSizePx: normalizedGrid.cellSizePx,
  });

  if (!visionSources.length) {
    return {
      currentVisibleCells: [],
      currentVisiblePolygons: [],
      currentPersistencePolygons: [],
    };
  }

  const wallSegments = normalizeLightingWallSegments(lightingRenderInput.walls);
  const fogRayCount = Number.isFinite(Number(rayCount))
    ? rayCount
    : DEFAULT_FOG_VISION_RAY_COUNT;
  const tokenVisionPolygons = buildTokenVisionPolygons({
    tokens: visionSources,
    visionRadiusPx: normalizedGrid.cellSizePx * DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
    segments: wallSegments,
    rayCount: fogRayCount,
  });

  return {
    currentVisibleCells: buildCurrentFogCellKeys({
      tokenVisionPolygons,
      grid: normalizedGrid,
    }),
    currentVisiblePolygons: buildCurrentFogRenderPolygons({
      tokenVisionPolygons,
    }),
    currentPersistencePolygons: buildCurrentFogMemoryPolygons({
      tokenVisionPolygons,
    }),
  };
};

export default function useGrigliataFogOfWarPersistence({
  backgroundId = '',
  currentUserId = '',
  isManager = false,
  grid,
  tokens = [],
  lightingRenderInput = null,
  fogOfWar = null,
  isEnabled = true,
  rayCount,
}) {
  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);
  const pendingTileMapRef = useRef(new Map());
  const inFlightTileMapRef = useRef(new Map());
  const flushTimeoutRef = useRef(null);
  const movementSequenceRef = useRef(0);
  const importedLegacyFogDocIdsRef = useRef(new Set());
  const [pendingMemoryTiles, setPendingMemoryTiles] = useState([]);
  const fogDocId = useMemo(
    () => buildGrigliataFogOfWarDocId(backgroundId, currentUserId),
    [backgroundId, currentUserId]
  );
  const currentVisibility = useMemo(
    () => (isEnabled
      ? buildViewerFogCurrentVisibility({
        tokens,
        currentUserId,
        isManager,
        grid: normalizedGrid,
        lightingRenderInput,
        rayCount,
      })
      : { currentVisibleCells: [], currentVisiblePolygons: [], currentPersistencePolygons: [] }),
    [
      currentUserId,
      isEnabled,
      isManager,
      lightingRenderInput,
      normalizedGrid,
      rayCount,
      tokens,
    ]
  );
  const currentVisibleCells = currentVisibility.currentVisibleCells;
  const currentVisiblePolygons = currentVisibility.currentVisiblePolygons;
  const currentPersistencePolygons = currentVisibility.currentPersistencePolygons;
  const storedMemoryTiles = useMemo(
    () => (Array.isArray(fogOfWar?.memoryTiles) ? fogOfWar.memoryTiles : [])
      .filter((tile) => tileMatchesGrid(tile, normalizedGrid)),
    [fogOfWar?.memoryTiles, normalizedGrid]
  );

  const refreshPendingMemoryTiles = useCallback(() => {
    setPendingMemoryTiles(mergeFogRasterMemoryTiles([
      ...inFlightTileMapRef.current.values(),
      ...pendingTileMapRef.current.values(),
    ]));
  }, []);

  const getKnownTileMap = useCallback(() => buildTileMap([
    ...storedMemoryTiles,
    ...inFlightTileMapRef.current.values(),
    ...pendingTileMapRef.current.values(),
  ]), [storedMemoryTiles]);

  const pruneSettledPendingTiles = useCallback(() => {
    const storedTileMap = buildTileMap(storedMemoryTiles);
    let didChange = false;

    [inFlightTileMapRef.current, pendingTileMapRef.current].forEach((tileMap) => {
      [...tileMap.entries()].forEach(([tileId, tile]) => {
        const storedTile = storedTileMap.get(tileId);
        if (storedTile && maskContainsFogRasterBits(storedTile.maskBytes, tile.maskBytes)) {
          tileMap.delete(tileId);
          didChange = true;
        }
      });
    });

    if (didChange) {
      refreshPendingMemoryTiles();
    }
  }, [refreshPendingMemoryTiles, storedMemoryTiles]);

  const flushPendingTiles = useCallback(() => {
    const tilesToFlush = [...pendingTileMapRef.current.values()];
    pendingTileMapRef.current.clear();

    tilesToFlush.forEach((tile) => {
      const existingInFlightTile = inFlightTileMapRef.current.get(tile.id);
      inFlightTileMapRef.current.set(tile.id, existingInFlightTile
        ? {
          ...tile,
          maskBytes: mergeFogRasterTileMasks(existingInFlightTile.maskBytes, tile.maskBytes),
        }
        : tile);
    });
    refreshPendingMemoryTiles();

    if (!tilesToFlush.length) {
      return;
    }

    const totalBitCount = tilesToFlush.reduce(
      (total, tile) => total + countFogRasterMaskBits(tile.maskBytes),
      0
    );
    logGrigliataFogDebug('raster-flush-start', {
      backgroundId,
      currentUserId,
      tileCount: tilesToFlush.length,
      totalBitCount,
    });

    void runTransaction(db, async (transaction) => {
      const reads = await Promise.all(tilesToFlush.map(async (tile) => {
        const tileRef = doc(db, GRIGLIATA_FOG_MEMORY_TILES_COLLECTION, tile.id);
        const snapshot = await transaction.get(tileRef);
        const existingTile = snapshot.exists()
          ? normalizeFogRasterMemoryTileDoc({
            id: snapshot.id,
            ...snapshot.data(),
          })
          : null;
        return { tile, tileRef, existingTile };
      }));

      const updatedAt = serverTimestamp();
      reads.forEach(({ tile, tileRef, existingTile }) => {
        const mergedMaskBytes = existingTile
          ? mergeFogRasterTileMasks(existingTile.maskBytes, tile.maskBytes)
          : tile.maskBytes;

        if (existingTile && maskContainsFogRasterBits(existingTile.maskBytes, tile.maskBytes)) {
          return;
        }

        transaction.set(
          tileRef,
          buildFogRasterTilePayload({
            ...tile,
            grid: {
              cellSizePx: tile.cellSizePx,
              offsetXPx: tile.offsetXPx,
              offsetYPx: tile.offsetYPx,
            },
            maskBytes: mergedMaskBytes,
            updatedAt,
            updatedBy: currentUserId,
          }),
          { merge: true }
        );
      });
    }).then(() => {
      tilesToFlush.forEach((tile) => {
        inFlightTileMapRef.current.delete(tile.id);
      });
      refreshPendingMemoryTiles();
      logGrigliataFogDebug('raster-flush-ok', {
        backgroundId,
        currentUserId,
        tileCount: tilesToFlush.length,
        totalBitCount,
      });
    }).catch((error) => {
      tilesToFlush.forEach((tile) => {
        const pendingTile = pendingTileMapRef.current.get(tile.id);
        pendingTileMapRef.current.set(tile.id, pendingTile
          ? {
            ...tile,
            maskBytes: mergeFogRasterTileMasks(pendingTile.maskBytes, tile.maskBytes),
          }
          : tile);
        inFlightTileMapRef.current.delete(tile.id);
      });
      refreshPendingMemoryTiles();
      console.error('Failed to persist Grigliata raster fog memory:', error);
      logGrigliataFogDebug('raster-flush-error', {
        backgroundId,
        currentUserId,
        tileCount: tilesToFlush.length,
        code: error?.code || '',
        message: error?.message || String(error),
      });
    });
  }, [backgroundId, currentUserId, refreshPendingMemoryTiles]);

  const scheduleRasterFlush = useCallback(() => {
    if (flushTimeoutRef.current) {
      window.clearTimeout(flushTimeoutRef.current);
    }
    flushTimeoutRef.current = window.setTimeout(() => {
      flushTimeoutRef.current = null;
      flushPendingTiles();
    }, GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);
  }, [flushPendingTiles]);

  const queueRasterTiles = useCallback(({ tiles = [], source = 'movement', movementId = 0 } = {}) => {
    if (!tiles.length) {
      logGrigliataFogDebug('raster-queue-skip', {
        backgroundId,
        currentUserId,
        source,
        movementId,
        reason: 'no-raster-tiles',
      });
      return;
    }

    const knownTileMap = getKnownTileMap();
    let queuedTileCount = 0;
    let queuedBitCount = 0;

    tiles.forEach((tile) => {
      const knownTile = knownTileMap.get(tile.id);
      if (knownTile && maskContainsFogRasterBits(knownTile.maskBytes, tile.maskBytes)) {
        return;
      }

      const pendingTile = pendingTileMapRef.current.get(tile.id);
      const nextTile = pendingTile
        ? {
          ...tile,
          maskBytes: mergeFogRasterTileMasks(pendingTile.maskBytes, tile.maskBytes),
        }
        : tile;

      pendingTileMapRef.current.set(tile.id, nextTile);
      knownTileMap.set(tile.id, nextTile);
      queuedTileCount += 1;
      queuedBitCount += countFogRasterMaskBits(tile.maskBytes);
    });

    logGrigliataFogDebug('raster-queue-add', {
      backgroundId,
      currentUserId,
      source,
      movementId,
      inputTileCount: tiles.length,
      queuedTileCount,
      queuedBitCount,
      pendingTileCount: pendingTileMapRef.current.size,
    });

    if (queuedTileCount > 0) {
      refreshPendingMemoryTiles();
      scheduleRasterFlush();
    }
  }, [
    backgroundId,
    currentUserId,
    getKnownTileMap,
    refreshPendingMemoryTiles,
    scheduleRasterFlush,
  ]);

  useEffect(() => {
    logGrigliataFogDebug('visibility', {
      backgroundId,
      currentUserId,
      fogDocId,
      isManager,
      isEnabled,
      hasLightingRenderInput: !!lightingRenderInput,
      tokenCount: Array.isArray(tokens) ? tokens.length : 0,
      placedTokenIds: (Array.isArray(tokens) ? tokens : [])
        .filter((token) => token?.placed)
        .map((token) => token.tokenId || token.ownerUid || ''),
      currentVisibleCellCount: currentVisibleCells.length,
      currentVisiblePolygonCount: currentVisiblePolygons.length,
      currentPersistencePolygonCount: currentPersistencePolygons.length,
      storedCellCount: fogOfWar?.cellSizePx === normalizedGrid.cellSizePx
        ? fogOfWar?.exploredCells?.length || 0
        : 0,
      storedPolygonCount: fogOfWar?.cellSizePx === normalizedGrid.cellSizePx
        ? fogOfWar?.exploredPolygons?.length || 0
        : 0,
      storedRasterTileCount: storedMemoryTiles.length,
      pendingRasterTileCount: pendingMemoryTiles.length,
      visualCellFallbackEnabled: false,
    });
  }, [
    backgroundId,
    currentPersistencePolygons.length,
    currentUserId,
    currentVisibleCells.length,
    currentVisiblePolygons.length,
    fogDocId,
    fogOfWar,
    isEnabled,
    isManager,
    lightingRenderInput,
    normalizedGrid.cellSizePx,
    pendingMemoryTiles.length,
    storedMemoryTiles.length,
    tokens,
  ]);

  useEffect(() => {
    if (
      !isEnabled
      || isManager
      || !fogDocId
      || !lightingRenderInput
      || currentPersistencePolygons.length < 1
    ) {
      logGrigliataFogDebug('persistence:skip', {
        backgroundId,
        currentUserId,
        fogDocId,
        isEnabled,
        isManager,
        hasLightingRenderInput: !!lightingRenderInput,
        currentVisibleCellCount: currentVisibleCells.length,
        currentPersistencePolygonCount: currentPersistencePolygons.length,
        reason: !isEnabled
          ? 'disabled'
          : (
            isManager
              ? 'manager'
              : (
                !fogDocId
                  ? 'missing-doc-id'
                  : (
                    !lightingRenderInput
                      ? 'missing-lighting-render-input'
                      : 'no-current-persistence-polygons'
                  )
              )
          ),
      });
      return undefined;
    }

    const movementId = movementSequenceRef.current + 1;
    movementSequenceRef.current = movementId;
    const rasterTiles = rasterizeFogPolygonsToTiles({
      backgroundId,
      ownerUid: currentUserId,
      grid: normalizedGrid,
      polygons: currentPersistencePolygons,
    });

    logGrigliataFogDebug('raster-visibility', {
      backgroundId,
      currentUserId,
      fogDocId,
      movementId,
      currentVisibleCellCount: currentVisibleCells.length,
      currentPersistencePolygonCount: currentPersistencePolygons.length,
      rasterTileCount: rasterTiles.length,
      rasterBitCount: rasterTiles.reduce(
        (total, tile) => total + countFogRasterMaskBits(tile.maskBytes),
        0
      ),
    });

    queueRasterTiles({
      tiles: rasterTiles,
      source: 'movement',
      movementId,
    });

    return undefined;
  }, [
    backgroundId,
    currentUserId,
    currentVisibleCells.length,
    currentPersistencePolygons,
    fogDocId,
    isEnabled,
    isManager,
    lightingRenderInput,
    normalizedGrid,
    queueRasterTiles,
  ]);

  useEffect(() => {
    const hasMatchingLegacyGrid = fogOfWar?.cellSizePx === normalizedGrid.cellSizePx;
    const legacyPolygons = hasMatchingLegacyGrid && Array.isArray(fogOfWar?.exploredPolygons)
      ? fogOfWar.exploredPolygons
      : [];

    if (
      !isEnabled
      || isManager
      || !fogDocId
      || legacyPolygons.length < 1
      || storedMemoryTiles.length > 0
      || importedLegacyFogDocIdsRef.current.has(fogDocId)
    ) {
      return;
    }

    importedLegacyFogDocIdsRef.current.add(fogDocId);
    const rasterTiles = rasterizeFogPolygonsToTiles({
      backgroundId,
      ownerUid: currentUserId,
      grid: normalizedGrid,
      polygons: legacyPolygons,
    });

    queueRasterTiles({
      tiles: rasterTiles,
      source: 'legacy-polygon-import',
      movementId: 0,
    });
  }, [
    backgroundId,
    currentUserId,
    fogDocId,
    fogOfWar,
    isEnabled,
    isManager,
    normalizedGrid,
    queueRasterTiles,
    storedMemoryTiles.length,
  ]);

  useEffect(() => {
    pruneSettledPendingTiles();
  }, [pruneSettledPendingTiles]);

  useEffect(() => () => {
    if (flushTimeoutRef.current) {
      window.clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
  }, []);

  return {
    currentVisibleCells,
    currentVisiblePolygons,
    pendingMemoryTiles,
  };
}
