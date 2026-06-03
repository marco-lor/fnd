import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
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
  buildViewerTokenVisionEligibilityReport,
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

const EMPTY_CURRENT_VISIBILITY = {
  currentVisibleCells: [],
  currentVisiblePolygons: [],
  currentPersistencePolygons: [],
  currentTokenVisionPolygons: [],
  contributingTokenIds: [],
  skippedTokens: [],
  visibilityKey: '',
};

const roundVisibilityNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.round(numericValue * 1000) / 1000
    : 0;
};

const buildEmptyCurrentVisibility = (visibilityKey = '') => ({
  ...EMPTY_CURRENT_VISIBILITY,
  visibilityKey,
});

const isRetryableRasterFlushError = (error) => {
  const code = String(error?.code || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();

  return code.includes('already-exists')
    || code.includes('aborted')
    || code.includes('failed-precondition')
    || name.includes('already-exists')
    || message.includes('already-exists')
    || message.includes('conflict');
};

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

const buildVisionSourceKeyParts = (source = {}) => {
  const position = source?.renderPosition || source?.position || {};
  return [
    source?.tokenId || source?.id || source?.ownerUid || '',
    source?.ownerUid || '',
    source?.backgroundId || '',
    source?.tokenType || '',
    source?.placed === false ? 'unplaced' : 'placed',
    source?.isDead === true ? 'dead' : 'alive',
    source?.isVisibleToPlayers === false ? 'hidden' : 'visible',
    source?.visionEnabled === false ? 'vision-off' : 'vision-on',
    roundVisibilityNumber(source?.visionRadiusSquares),
    roundVisibilityNumber(source?.visionRadiusPx),
    roundVisibilityNumber(position.x),
    roundVisibilityNumber(position.y),
    roundVisibilityNumber(position.size),
  ];
};

const buildWallSegmentKeyParts = (segment = {}) => [
  segment.id || '',
  roundVisibilityNumber(segment.x1),
  roundVisibilityNumber(segment.y1),
  roundVisibilityNumber(segment.x2),
  roundVisibilityNumber(segment.y2),
];

const buildRenderableTokenVisionPolygons = (tokenVisionPolygons = []) => (
  (Array.isArray(tokenVisionPolygons) ? tokenVisionPolygons : [])
    .map((vision) => {
      const polygon = (Array.isArray(vision?.polygon) ? vision.polygon : [])
        .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
        .map((point) => ({
          x: roundVisibilityNumber(point.x),
          y: roundVisibilityNumber(point.y),
        }));

      if (polygon.length < 3) {
        return null;
      }

      return {
        tokenId: vision?.tokenId || '',
        origin: {
          x: roundVisibilityNumber(vision?.origin?.x),
          y: roundVisibilityNumber(vision?.origin?.y),
        },
        radius: roundVisibilityNumber(vision?.radius),
        polygon,
      };
    })
    .filter(Boolean)
);

export const buildViewerFogVisibilityKey = ({
  tokens = [],
  currentUserId = '',
  isManager = false,
  backgroundId = '',
  grid,
  lightingRenderInput = null,
  rayCount,
  includeCurrentVisibleCells = true,
} = {}) => {
  const normalizedGrid = normalizeGridConfig(grid);
  const fogRayCount = Number.isFinite(Number(rayCount))
    ? Number(rayCount)
    : DEFAULT_FOG_VISION_RAY_COUNT;

  if (!lightingRenderInput || isManager) {
    return JSON.stringify({
      backgroundId,
      currentUserId,
      isManager,
      hasLightingRenderInput: !!lightingRenderInput,
      includeCurrentVisibleCells,
    });
  }

  const renderableTokens = buildRenderableTokensForFog({
    tokens,
    grid: normalizedGrid,
  });
  const visionSourceReport = buildViewerTokenVisionEligibilityReport({
    tokens: renderableTokens,
    currentUserId,
    isManager,
    cellSizePx: normalizedGrid.cellSizePx,
    backgroundId,
  });
  const wallSegments = normalizeLightingWallSegments(lightingRenderInput.walls);

  return JSON.stringify({
    backgroundId,
    currentUserId,
    isManager,
    includeCurrentVisibleCells,
    rayCount: fogRayCount,
    grid: [
      normalizedGrid.cellSizePx,
      normalizedGrid.offsetXPx,
      normalizedGrid.offsetYPx,
    ].map(roundVisibilityNumber),
    sources: visionSourceReport.sources.map(buildVisionSourceKeyParts),
    skipped: visionSourceReport.skippedTokens.map((skippedToken) => [
      skippedToken.tokenId || '',
      skippedToken.ownerUid || '',
      skippedToken.reason || '',
    ]),
    walls: wallSegments.map(buildWallSegmentKeyParts),
  });
};

export const buildViewerFogCurrentVisibleCells = ({
  ...args
} = {}) => buildViewerFogCurrentVisibility(args).currentVisibleCells;

export const buildViewerFogCurrentVisibility = ({
  tokens = [],
  currentUserId = '',
  isManager = false,
  backgroundId = '',
  grid,
  lightingRenderInput = null,
  rayCount,
  includeCurrentVisibleCells = true,
  visibilityKey = '',
} = {}) => {
  const resolvedVisibilityKey = visibilityKey || buildViewerFogVisibilityKey({
    tokens,
    currentUserId,
    isManager,
    backgroundId,
    grid,
    lightingRenderInput,
    rayCount,
    includeCurrentVisibleCells,
  });

  if (!lightingRenderInput || isManager) {
    return buildEmptyCurrentVisibility(resolvedVisibilityKey);
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const renderableTokens = buildRenderableTokensForFog({
    tokens,
    grid: normalizedGrid,
  });
  const visionSourceReport = buildViewerTokenVisionEligibilityReport({
    tokens: renderableTokens,
    currentUserId,
    isManager,
    cellSizePx: normalizedGrid.cellSizePx,
    backgroundId,
  });
  const visionSources = visionSourceReport.sources;

  if (!visionSources.length) {
    return {
      ...EMPTY_CURRENT_VISIBILITY,
      contributingTokenIds: [],
      skippedTokens: visionSourceReport.skippedTokens,
      visibilityKey: resolvedVisibilityKey,
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
    currentVisibleCells: includeCurrentVisibleCells
      ? buildCurrentFogCellKeys({
        tokenVisionPolygons,
        grid: normalizedGrid,
      })
      : [],
    currentVisiblePolygons: buildCurrentFogRenderPolygons({
      tokenVisionPolygons,
    }),
    currentPersistencePolygons: buildCurrentFogMemoryPolygons({
      tokenVisionPolygons,
    }),
    currentTokenVisionPolygons: buildRenderableTokenVisionPolygons(tokenVisionPolygons),
    contributingTokenIds: visionSourceReport.contributingTokenIds,
    skippedTokens: visionSourceReport.skippedTokens,
    visibilityKey: resolvedVisibilityKey,
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
  const flushInFlightRef = useRef(false);
  const flushAfterInFlightRef = useRef(false);
  const movementSequenceRef = useRef(0);
  const importedLegacyFogDocIdsRef = useRef(new Set());
  const visibilityCacheRef = useRef({
    key: '',
    visibility: buildEmptyCurrentVisibility(''),
  });
  const lastQueuedVisibilityKeyRef = useRef('');
  const [pendingMemoryTiles, setPendingMemoryTiles] = useState([]);
  const fogDocId = useMemo(
    () => buildGrigliataFogOfWarDocId(backgroundId, currentUserId),
    [backgroundId, currentUserId]
  );
  const currentVisibility = useMemo(
    () => {
      if (!isEnabled) {
        return buildEmptyCurrentVisibility('disabled');
      }

      const visibilityKey = buildViewerFogVisibilityKey({
        tokens,
        currentUserId,
        isManager,
        backgroundId,
        grid: normalizedGrid,
        lightingRenderInput,
        rayCount,
        includeCurrentVisibleCells: false,
      });

      if (visibilityCacheRef.current.key === visibilityKey) {
        return visibilityCacheRef.current.visibility;
      }

      const nextVisibility = buildViewerFogCurrentVisibility({
        tokens,
        currentUserId,
        isManager,
        backgroundId,
        grid: normalizedGrid,
        lightingRenderInput,
        rayCount,
        includeCurrentVisibleCells: false,
        visibilityKey,
      });

      visibilityCacheRef.current = {
        key: visibilityKey,
        visibility: nextVisibility,
      };
      return nextVisibility;
    },
    [
      backgroundId,
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
  const currentTokenVisionPolygons = currentVisibility.currentTokenVisionPolygons;
  const currentVisibilityKey = currentVisibility.visibilityKey || '';
  const contributingTokenIds = Array.isArray(currentVisibility.contributingTokenIds)
    ? currentVisibility.contributingTokenIds
    : EMPTY_CURRENT_VISIBILITY.contributingTokenIds;
  const skippedTokens = Array.isArray(currentVisibility.skippedTokens)
    ? currentVisibility.skippedTokens
    : EMPTY_CURRENT_VISIBILITY.skippedTokens;
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
    if (flushInFlightRef.current) {
      flushAfterInFlightRef.current = true;
      logGrigliataFogDebug('raster-flush-defer', {
        backgroundId,
        currentUserId,
        pendingTileCount: pendingTileMapRef.current.size,
        inFlightTileCount: inFlightTileMapRef.current.size,
      });
      return;
    }

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

    flushInFlightRef.current = true;

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

    void Promise.all(tilesToFlush.map(async (tile) => {
      const tileRef = doc(db, GRIGLIATA_FOG_MEMORY_TILES_COLLECTION, tile.id);
      const snapshot = await getDoc(tileRef);
      const existingTile = snapshot.exists()
        ? normalizeFogRasterMemoryTileDoc({
          id: snapshot.id,
          ...snapshot.data(),
        })
        : null;

      const mergedMaskBytes = existingTile
        ? mergeFogRasterTileMasks(existingTile.maskBytes, tile.maskBytes)
        : tile.maskBytes;

      if (existingTile && maskContainsFogRasterBits(existingTile.maskBytes, tile.maskBytes)) {
        return false;
      }

      await setDoc(
        tileRef,
        buildFogRasterTilePayload({
          ...tile,
          grid: {
            cellSizePx: tile.cellSizePx,
            offsetXPx: tile.offsetXPx,
            offsetYPx: tile.offsetYPx,
          },
          maskBytes: mergedMaskBytes,
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId,
        }),
        { merge: true }
      );
      return true;
    })).then((writeResults) => {
      tilesToFlush.forEach((tile) => {
        inFlightTileMapRef.current.delete(tile.id);
      });
      refreshPendingMemoryTiles();
      logGrigliataFogDebug('raster-flush-ok', {
        backgroundId,
        currentUserId,
        tileCount: tilesToFlush.length,
        writtenTileCount: writeResults.filter(Boolean).length,
        totalBitCount,
      });
    }).catch((error) => {
      const isRetryableConflict = isRetryableRasterFlushError(error);

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

      if (isRetryableConflict) {
        flushAfterInFlightRef.current = true;
      } else {
        console.error('Failed to persist Grigliata raster fog memory:', error);
      }

      logGrigliataFogDebug('raster-flush-error', {
        backgroundId,
        currentUserId,
        tileCount: tilesToFlush.length,
        code: error?.code || '',
        message: error?.message || String(error),
        willRetry: isRetryableConflict,
      });
    }).finally(() => {
      flushInFlightRef.current = false;

      if (flushAfterInFlightRef.current) {
        flushAfterInFlightRef.current = false;
        if (pendingTileMapRef.current.size > 0) {
          flushPendingTiles();
        }
      }
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

  const queueRasterTiles = useCallback(({
    tiles = [],
    source = 'movement',
    movementId = 0,
    sourceTokenIds = [],
  } = {}) => {
    if (!tiles.length) {
      logGrigliataFogDebug('raster-queue-skip', {
        backgroundId,
        currentUserId,
        source,
        movementId,
        sourceTokenIds,
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
      sourceTokenIds,
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
      contributingTokenIds,
      skippedTokens: skippedTokens.slice(0, 12),
      skippedTokenCount: skippedTokens.length,
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
    contributingTokenIds,
    fogDocId,
    fogOfWar,
    isEnabled,
    isManager,
    lightingRenderInput,
    normalizedGrid.cellSizePx,
    pendingMemoryTiles.length,
    skippedTokens,
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
        contributingTokenIds,
        skippedTokens: skippedTokens.slice(0, 12),
        skippedTokenCount: skippedTokens.length,
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
      lastQueuedVisibilityKeyRef.current = '';
      return undefined;
    }

    if (currentVisibilityKey && lastQueuedVisibilityKeyRef.current === currentVisibilityKey) {
      logGrigliataFogDebug('persistence:skip', {
        backgroundId,
        currentUserId,
        fogDocId,
        isEnabled,
        isManager,
        hasLightingRenderInput: !!lightingRenderInput,
        currentVisibleCellCount: currentVisibleCells.length,
        currentPersistencePolygonCount: currentPersistencePolygons.length,
        contributingTokenIds,
        skippedTokens: skippedTokens.slice(0, 12),
        skippedTokenCount: skippedTokens.length,
        reason: 'unchanged-visibility',
      });
      return undefined;
    }

    lastQueuedVisibilityKeyRef.current = currentVisibilityKey;

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
      contributingTokenIds,
      skippedTokens: skippedTokens.slice(0, 12),
      skippedTokenCount: skippedTokens.length,
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
      sourceTokenIds: contributingTokenIds,
    });

    return undefined;
  }, [
    backgroundId,
    currentUserId,
    currentVisibleCells.length,
    currentVisibilityKey,
    currentPersistencePolygons,
    contributingTokenIds,
    fogDocId,
    isEnabled,
    isManager,
    lightingRenderInput,
    normalizedGrid,
    queueRasterTiles,
    skippedTokens,
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
    flushAfterInFlightRef.current = false;
  }, []);

  return {
    currentVisibleCells,
    currentVisiblePolygons,
    currentTokenVisionPolygons,
    pendingMemoryTiles,
  };
}
