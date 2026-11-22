import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { db } from '../firebaseConfig';
import {
  getTokenPositionPx,
  normalizeGridConfig,
} from './boardUtils';
import {
  buildTokenVisionPolygons,
  createVisibilitySourceCache,
  DEFAULT_TOKEN_VISION_RAY_COUNT,
  normalizeLightingWallSegments,
} from './lightingGeometry';
import {
  DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
  buildViewerTokenVisionEligibilityReport,
} from './lightingVisibility';
import {
  buildCurrentFogCellKeys,
  buildCurrentFogRenderPolygons,
  buildGrigliataFogOfWarDocId,
} from './fogOfWar';
import {
  countFogRasterMaskBits,
  maskContainsFogRasterBits,
  mergeFogRasterMemoryTiles,
  mergeFogRasterTileMasks,
  rasterizeFogPolygonsToTiles,
} from './fogRasterMemory';
import {
  buildFogRasterDiscoveryDeltaMask,
  getFogWriteRetryDelayMs,
  isRetryableFogWriteError,
  persistFogRasterDiscoveryTiles,
} from './fogRasterTilePersistence';
import { logGrigliataFogDebug } from './fogDebug';

export const GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS = 350;
export const DEFAULT_FOG_VISION_RAY_COUNT = DEFAULT_TOKEN_VISION_RAY_COUNT;

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
    source.tokenId,
    source.visionRadiusPx,
    Number(position.x),
    Number(position.y),
    Number(position.size),
  ];
};

const buildWallSegmentKeyParts = (segment = {}) => [
  segment.id || '',
  segment.x1,
  segment.y1,
  segment.x2,
  segment.y2,
];

const renderableSightByCast = new WeakMap();
const renderPolygonsBySight = new WeakMap();

const buildRenderableTokenVisionPolygon = (vision) => {
  const previous = renderableSightByCast.get(vision);
  if (previous) return previous;

  const toPoint = ({ x, y }) => ({ x: roundVisibilityNumber(x), y: roundVisibilityNumber(y) });
  const renderable = {
    tokenId: vision.tokenId,
    origin: toPoint(vision.origin),
    radius: roundVisibilityNumber(vision.radius),
    polygon: vision.polygon.map(toPoint),
  };
  renderableSightByCast.set(vision, renderable);
  return renderable;
};

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
  const wallSegments = normalizeLightingWallSegments(lightingRenderInput.walls, 'vision');

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
    ],
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
  sourceCache,
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
    if (sourceCache) buildTokenVisionPolygons({ cache: sourceCache });
    return {
      ...EMPTY_CURRENT_VISIBILITY,
      contributingTokenIds: [],
      skippedTokens: visionSourceReport.skippedTokens,
      visibilityKey: resolvedVisibilityKey,
    };
  }

  const wallSegments = normalizeLightingWallSegments(lightingRenderInput.walls, 'vision');
  const fogRayCount = Number.isFinite(Number(rayCount))
    ? rayCount
    : DEFAULT_FOG_VISION_RAY_COUNT;
  const tokenVisionPolygons = buildTokenVisionPolygons({
    tokens: visionSources,
    visionRadiusPx: normalizedGrid.cellSizePx * DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
    segments: wallSegments,
    rayCount: fogRayCount,
    cache: sourceCache,
  });
  let renderPolygons = renderPolygonsBySight.get(tokenVisionPolygons);
  if (!renderPolygons) {
    renderPolygons = {
      currentVisiblePolygons: buildCurrentFogRenderPolygons({ tokenVisionPolygons }),
      currentTokenVisionPolygons: tokenVisionPolygons.map(buildRenderableTokenVisionPolygon),
    };
    renderPolygonsBySight.set(tokenVisionPolygons, renderPolygons);
  }

  return {
    currentVisibleCells: includeCurrentVisibleCells
      ? buildCurrentFogCellKeys({
        tokenVisionPolygons,
        grid: normalizedGrid,
      })
      : [],
    ...renderPolygons,
    currentPersistencePolygons: renderPolygons.currentVisiblePolygons,
    contributingTokenIds: visionSourceReport.contributingTokenIds,
    skippedTokens: visionSourceReport.skippedTokens,
    visibilityKey: resolvedVisibilityKey,
  };
};

export function useViewerFogCurrentVisibility({
  backgroundId,
  currentUserId,
  isManager = false,
  grid,
  tokens,
  lightingRenderInput,
  isEnabled = true,
  rayCount,
}) {
  const hasLightingInput = !!lightingRenderInput;
  const sourceCache = useMemo(
    createVisibilitySourceCache,
    [backgroundId, currentUserId, hasLightingInput, isEnabled, isManager]
  );
  const lastVisibility = useRef(EMPTY_CURRENT_VISIBILITY);

  return useMemo(() => {
    if (!isEnabled) {
      lastVisibility.current = EMPTY_CURRENT_VISIBILITY;
      return buildEmptyCurrentVisibility('disabled');
    }

    const input = {
      backgroundId,
      currentUserId,
      isManager,
      grid,
      tokens,
      lightingRenderInput,
      rayCount,
      includeCurrentVisibleCells: false,
    };
    const visibilityKey = buildViewerFogVisibilityKey(input);
    if (lastVisibility.current.visibilityKey !== visibilityKey) {
      lastVisibility.current = buildViewerFogCurrentVisibility({ ...input, visibilityKey, sourceCache });
    }
    return lastVisibility.current;
  }, [backgroundId, currentUserId, grid, isEnabled, isManager, lightingRenderInput, rayCount, sourceCache, tokens]);
}

export default function useGrigliataFogOfWarPersistence({
  backgroundId = '',
  currentUserId = '',
  isManager = false,
  grid,
  tokens = [],
  lightingRenderInput = null,
  fogOfWar = null,
  // False while the player's stored raster memory for this scope is still
  // loading. Discovery deltas are computed against that memory, so nothing
  // is queued until it is known.
  isFogMemoryReady = true,
  isEnabled = true,
  rayCount,
}) {
  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);
  const pendingTileMapRef = useRef(new Map());
  const inFlightTileMapRef = useRef(new Map());
  const flushTimeoutRef = useRef(null);
  const flushInFlightRef = useRef(false);
  const flushAfterInFlightRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const flushPendingTilesRef = useRef(null);
  const movementSequenceRef = useRef(0);
  const importedLegacyFogDocIdsRef = useRef(new Set());
  const lastQueuedVisibilityKeyRef = useRef('');
  const previousExplorationRef = useRef(null);
  const [pendingMemoryTiles, setPendingMemoryTiles] = useState([]);
  const fogDocId = useMemo(
    () => buildGrigliataFogOfWarDocId(backgroundId, currentUserId),
    [backgroundId, currentUserId]
  );
  const currentVisibility = useViewerFogCurrentVisibility({
    backgroundId,
    currentUserId,
    isManager,
    grid: normalizedGrid,
    tokens,
    lightingRenderInput,
    isEnabled,
    rayCount,
  });
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
      .filter((tile) => (
        tile?.backgroundId === backgroundId
        && tile?.ownerUid === currentUserId
        && tileMatchesGrid(tile, normalizedGrid)
      )),
    [backgroundId, currentUserId, fogOfWar?.memoryTiles, normalizedGrid]
  );
  const currentBackgroundPendingMemoryTiles = useMemo(
    () => pendingMemoryTiles.filter((tile) => (
      tile?.backgroundId === backgroundId
      && tile?.ownerUid === currentUserId
    )),
    [backgroundId, currentUserId, pendingMemoryTiles]
  );

  const refreshPendingMemoryTiles = useCallback(() => {
    setPendingMemoryTiles(mergeFogRasterMemoryTiles([
      ...inFlightTileMapRef.current.values(),
      ...pendingTileMapRef.current.values(),
    ]));
  }, []);

  // Same-scope known memory: stored tiles are already filtered to this
  // background/owner/grid; tile ids carry background and owner, so local
  // in-flight and pending tiles only need the grid check.
  const getKnownTileMap = useCallback(() => buildTileMap([
    ...storedMemoryTiles,
    ...[
      ...inFlightTileMapRef.current.values(),
      ...pendingTileMapRef.current.values(),
    ].filter((tile) => tileMatchesGrid(tile, normalizedGrid)),
  ]), [normalizedGrid, storedMemoryTiles]);

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

    // Resolve the queue against the current scope. Tiles queued for another
    // map of this owner are still valid and flush as-is; tiles for this map
    // from an earlier grid alignment, or for another account, can no longer
    // be written correctly and are dropped.
    const tilesToFlush = [];
    let droppedTileCount = 0;
    pendingTileMapRef.current.forEach((tile) => {
      const isStaleScope = tile.ownerUid !== currentUserId
        || (tile.backgroundId === backgroundId && !tileMatchesGrid(tile, normalizedGrid));
      if (isStaleScope) {
        droppedTileCount += 1;
      } else {
        tilesToFlush.push(tile);
      }
    });
    pendingTileMapRef.current.clear();
    if (droppedTileCount > 0) {
      logGrigliataFogDebug('raster-flush-drop-stale-scope', {
        backgroundId,
        currentUserId,
        droppedTileCount,
      });
    }

    tilesToFlush.forEach((tile) => {
      const existingInFlightTile = inFlightTileMapRef.current.get(tile.id);
      inFlightTileMapRef.current.set(tile.id, existingInFlightTile && tileMatchesGrid(existingInFlightTile, tile)
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

    // Each tile is merged into the latest stored tile in its own transaction
    // (bounded concurrency). Tiles settle independently: committed and
    // already-contained tiles leave the in-flight map, failed tiles go back to
    // pending without disturbing the rest of the batch.
    let shouldRetryFailedTiles = false;
    void persistFogRasterDiscoveryTiles({
      db,
      tiles: tilesToFlush,
      updatedBy: currentUserId,
    }).then((tileResults) => {
      const failedResults = tileResults.filter((result) => result.status === 'failed');
      const writtenTileCount = tileResults.filter((result) => result.status === 'written').length;
      // 'stale-grid': the map was realigned after this delta was computed; the
      // transaction discarded it rather than overwrite a current-grid tile.
      const staleGridTileCount = tileResults.filter((result) => result.status === 'stale-grid').length;

      tileResults.forEach(({ tile, status }) => {
        inFlightTileMapRef.current.delete(tile.id);
        if (status !== 'failed') {
          return;
        }
        const pendingTile = pendingTileMapRef.current.get(tile.id);
        if (!pendingTile) {
          pendingTileMapRef.current.set(tile.id, tile);
        } else if (tileMatchesGrid(pendingTile, tile)) {
          pendingTileMapRef.current.set(tile.id, {
            ...pendingTile,
            maskBytes: mergeFogRasterTileMasks(pendingTile.maskBytes, tile.maskBytes),
          });
        }
        // Otherwise a newer pending tile from a different grid supersedes it.
      });
      refreshPendingMemoryTiles();

      if (!failedResults.length) {
        retryAttemptRef.current = 0;
        logGrigliataFogDebug('raster-flush-ok', {
          backgroundId,
          currentUserId,
          tileCount: tilesToFlush.length,
          writtenTileCount,
          staleGridTileCount,
          totalBitCount,
        });
        return;
      }

      const firstError = failedResults[0].error;
      shouldRetryFailedTiles = failedResults.every((result) => isRetryableFogWriteError(result.error));
      if (!shouldRetryFailedTiles) {
        console.error('Failed to persist Grigliata raster fog memory:', firstError);
      }

      logGrigliataFogDebug('raster-flush-error', {
        backgroundId,
        currentUserId,
        tileCount: tilesToFlush.length,
        failedTileCount: failedResults.length,
        writtenTileCount,
        staleGridTileCount,
        code: firstError?.code || '',
        message: firstError?.message || String(firstError),
        willRetry: shouldRetryFailedTiles,
      });
    }).finally(() => {
      flushInFlightRef.current = false;
      const hasDeferredWork = flushAfterInFlightRef.current && pendingTileMapRef.current.size > 0;
      flushAfterInFlightRef.current = false;

      // Deferred drains and timers always use the latest flush: this
      // callback's closure may predate a grid, map, or account change and
      // would otherwise judge newly queued tiles by the stale scope.
      if (hasDeferredWork) {
        flushPendingTilesRef.current();
        return;
      }

      // Transient failures (contention, offline) retry with capped backoff
      // rather than immediately. Nothing is rescheduled after unmount.
      if (
        shouldRetryFailedTiles
        && !isUnmountedRef.current
        && !flushTimeoutRef.current
        && pendingTileMapRef.current.size > 0
      ) {
        retryAttemptRef.current += 1;
        const retryDelayMs = getFogWriteRetryDelayMs(retryAttemptRef.current);
        logGrigliataFogDebug('raster-flush-retry-scheduled', {
          backgroundId,
          currentUserId,
          attempt: retryAttemptRef.current,
          retryDelayMs,
          pendingTileCount: pendingTileMapRef.current.size,
        });
        flushTimeoutRef.current = window.setTimeout(() => {
          flushTimeoutRef.current = null;
          flushPendingTilesRef.current();
        }, retryDelayMs);
      }
    });
  }, [backgroundId, currentUserId, normalizedGrid, refreshPendingMemoryTiles]);

  const scheduleRasterFlush = useCallback(() => {
    if (flushTimeoutRef.current) {
      window.clearTimeout(flushTimeoutRef.current);
    }
    flushTimeoutRef.current = window.setTimeout(() => {
      flushTimeoutRef.current = null;
      flushPendingTilesRef.current();
    }, GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);
  }, []);

  // Layout effect: updated in the same task as the commit, before any timer
  // or settled transaction can observe the previous scope's flush.
  useLayoutEffect(() => {
    flushPendingTilesRef.current = flushPendingTiles;
  }, [flushPendingTiles]);

  // Switching map (or account) resolves discoveries queued for the previous
  // scope right away instead of leaving them behind the debounce.
  const persistenceScopeKey = JSON.stringify([backgroundId, currentUserId]);
  const previousPersistenceScopeKeyRef = useRef(persistenceScopeKey);
  useEffect(() => {
    if (previousPersistenceScopeKeyRef.current === persistenceScopeKey) {
      return;
    }
    previousPersistenceScopeKeyRef.current = persistenceScopeKey;
    if (pendingTileMapRef.current.size < 1) {
      return;
    }
    if (flushTimeoutRef.current) {
      window.clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    flushPendingTiles();
  }, [flushPendingTiles, persistenceScopeKey]);

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

    // Queue only bits that are new relative to this player's known memory.
    // Re-sending already-known bits would let this write restore a bit a
    // manager has hidden since the client last heard from Firestore.
    tiles.forEach((tile) => {
      const knownTile = knownTileMap.get(tile.id);
      const discoveryMaskBytes = buildFogRasterDiscoveryDeltaMask(tile.maskBytes, knownTile?.maskBytes);
      const discoveryBitCount = countFogRasterMaskBits(discoveryMaskBytes);
      if (discoveryBitCount < 1) {
        return;
      }

      const pendingTile = pendingTileMapRef.current.get(tile.id);
      pendingTileMapRef.current.set(tile.id, {
        ...tile,
        maskBytes: pendingTile && tileMatchesGrid(pendingTile, tile)
          ? mergeFogRasterTileMasks(pendingTile.maskBytes, discoveryMaskBytes)
          : discoveryMaskBytes,
      });
      knownTileMap.set(tile.id, {
        ...tile,
        maskBytes: mergeFogRasterTileMasks(knownTile?.maskBytes, discoveryMaskBytes),
      });
      queuedTileCount += 1;
      queuedBitCount += discoveryBitCount;
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
      pendingRasterTileCount: currentBackgroundPendingMemoryTiles.length,
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
    currentBackgroundPendingMemoryTiles.length,
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
      || !isFogMemoryReady
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
                      : (
                        !isFogMemoryReady
                          ? 'waiting-for-stored-memory'
                          : 'no-current-persistence-polygons'
                      )
                  )
              )
          ),
      });
      lastQueuedVisibilityKeyRef.current = '';
      previousExplorationRef.current = null;
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

    const gridScope = JSON.stringify([
      backgroundId, currentUserId,
      normalizedGrid.cellSizePx, normalizedGrid.offsetXPx, normalizedGrid.offsetYPx,
    ]);
    const previous = previousExplorationRef.current;
    const changedPolygons = previous?.scope === gridScope
      ? currentPersistencePolygons.filter((polygon) => !previous.polygons.has(polygon))
      : currentPersistencePolygons;
    previousExplorationRef.current = { scope: gridScope, polygons: new Set(currentPersistencePolygons) };
    if (!changedPolygons.length) return undefined;

    const movementId = movementSequenceRef.current + 1;
    movementSequenceRef.current = movementId;
    const rasterTiles = rasterizeFogPolygonsToTiles({
      backgroundId,
      ownerUid: currentUserId,
      grid: normalizedGrid,
      polygons: changedPolygons,
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
    isFogMemoryReady,
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

  useEffect(() => {
    // The pending Map instance lives for the hook's lifetime (it is only
    // mutated), so the cleanup reads this same instance.
    const pendingTileMap = pendingTileMapRef.current;
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (flushTimeoutRef.current) {
        window.clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      // Navigating away resolves queued discoveries once instead of dropping
      // them; an in-flight flush picks them up when it settles. No retries
      // are scheduled after unmount.
      flushAfterInFlightRef.current = false;
      if (pendingTileMap.size > 0) {
        flushPendingTilesRef.current?.();
      }
    };
  }, []);

  return {
    currentVisibleCells,
    currentVisiblePolygons,
    currentTokenVisionPolygons,
    pendingMemoryTiles: currentBackgroundPendingMemoryTiles,
  };
}
