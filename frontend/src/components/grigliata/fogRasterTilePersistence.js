import {
  doc,
  runTransaction as defaultRunTransaction,
  serverTimestamp,
} from '../../performance/firestore';
import { normalizeGridConfig } from './boardUtils';
import {
  buildGrigliataFogOfWarDocId,
  GRIGLIATA_FOG_OF_WAR_COLLECTION,
} from './fogOfWar';
import {
  buildFogRasterTileDocId,
  buildFogRasterTilePayload,
  countFogRasterMaskBits,
  GRIGLIATA_FOG_MEMORY_TILES_COLLECTION,
  maskContainsFogRasterBits,
  mergeFogRasterTileMasks,
  normalizeFogRasterMemoryTileDoc,
  rasterizeFogPolygonsToTiles,
  subtractFogRasterTileMasks,
} from './fogRasterMemory';

// Fog memory tiles are independent bitsets, so each tile (player discovery) or
// owner (manager brush) gets its own small transaction. These limits keep a
// large exploration burst or an all-players brush from opening an unbounded
// number of concurrent Firestore transactions.
export const FOG_RASTER_TILE_WRITE_CONCURRENCY = 6;
export const FOG_BRUSH_OWNER_WRITE_CONCURRENCY = 4;
// A brush entry larger than this is applied to each owner in consecutive
// transactions of at most this many tiles, keeping every commit well inside
// Firestore's transaction limits. Smaller entries stay one atomic transaction.
export const FOG_BRUSH_MAX_TILES_PER_TRANSACTION = 200;
export const FOG_WRITE_RETRY_BASE_DELAY_MS = 350;
export const FOG_WRITE_RETRY_MAX_DELAY_MS = 30000;
export const GRIGLIATA_BACKGROUNDS_COLLECTION = 'grigliata_backgrounds';

const RETRYABLE_FOG_WRITE_ERROR_CODES = [
  // Transaction contention that outlived the SDK's own retries.
  'aborted',
  'already-exists',
  'failed-precondition',
  // Transient transport conditions, including offline clients.
  'unavailable',
  'deadline-exceeded',
  'resource-exhausted',
];

export const isRetryableFogWriteError = (error) => {
  const code = String(error?.code || '').toLowerCase();
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();

  return RETRYABLE_FOG_WRITE_ERROR_CODES.some((retryableCode) => (
    code.includes(retryableCode) || name.includes(retryableCode)
  ))
    || message.includes('already-exists')
    || message.includes('conflict')
    || message.includes('offline');
};

// Exponential backoff for deferred retries: 350 ms, 700 ms, ... capped at 30 s.
export const getFogWriteRetryDelayMs = (attempt = 1) => Math.min(
  FOG_WRITE_RETRY_MAX_DELAY_MS,
  FOG_WRITE_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, Math.floor(Number(attempt) || 1) - 1))
);

export const mapWithBoundedConcurrency = async (items, limit, worker) => {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  const workerCount = Math.max(1, Math.min(Math.floor(Number(limit)) || 1, list.length));
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(list[index], index) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  };

  await Promise.all(Array.from({ length: list.length ? workerCount : 0 }, runWorker));
  return results;
};

const readFogRasterTileInTransaction = async (transaction, tileRef) => {
  const snapshot = await transaction.get(tileRef);
  return snapshot.exists()
    ? normalizeFogRasterMemoryTileDoc({
      id: snapshot.id,
      ...snapshot.data(),
    })
    : null;
};

const getFogRasterTileGrid = (tile) => ({
  cellSizePx: tile.cellSizePx,
  offsetXPx: tile.offsetXPx,
  offsetYPx: tile.offsetYPx,
});

// Tile ids omit the grid, so a stored tile can belong to an earlier grid
// alignment of the same map. Its bits mean nothing on the current grid and
// must never be merged with (or subtracted from) a current-grid mask.
export const fogRasterTileGridsMatch = (leftTile, rightTile) => (
  !!leftTile
  && !!rightTile
  && leftTile.cellSizePx === rightTile.cellSizePx
  && leftTile.offsetXPx === rightTile.offsetXPx
  && leftTile.offsetYPx === rightTile.offsetYPx
);

/**
 * Creates a grid-scope resolver bound to one transaction attempt. Create it
 * inside the runTransaction callback so every retry re-reads.
 *
 *   resolve({ storedTile, operationTile }) =>
 *     Promise<{ action: 'merge' | 'replace' | 'discard', baseTile }>
 *
 * - No stored tile, or stored tile on the operation's grid: 'merge' with
 *   baseTile = storedTile (or null).
 * - Stored tile on a different grid: reads
 *   grigliata_backgrounds/{operationTile.backgroundId}.grid in the same
 *   transaction (once per background per attempt). If the operation's grid is
 *   the map's current grid, 'replace' (baseTile null: the old-grid bits are
 *   dropped); otherwise the operation is stale, 'discard' (write nothing).
 *
 * All reads happen before any write, as Firestore transactions require.
 */
export const createFogRasterTileGridScopeResolver = ({ db, transaction }) => {
  const authoritativeGridByBackgroundId = new Map();
  const readAuthoritativeGrid = (backgroundId) => {
    if (!authoritativeGridByBackgroundId.has(backgroundId)) {
      authoritativeGridByBackgroundId.set(
        backgroundId,
        transaction.get(doc(db, GRIGLIATA_BACKGROUNDS_COLLECTION, backgroundId)).then((snapshot) => (
          snapshot.exists() ? normalizeGridConfig(snapshot.data()?.grid) : null
        ))
      );
    }
    return authoritativeGridByBackgroundId.get(backgroundId);
  };

  return async ({ storedTile, operationTile }) => {
    if (!storedTile || fogRasterTileGridsMatch(storedTile, operationTile)) {
      return { action: 'merge', baseTile: storedTile || null };
    }

    const authoritativeGrid = await readAuthoritativeGrid(operationTile.backgroundId);
    return fogRasterTileGridsMatch(authoritativeGrid, operationTile)
      ? { action: 'replace', baseTile: null }
      : { action: 'discard', baseTile: null };
  };
};

/**
 * Returns only the bits of `tile` that are not already in `knownTile`.
 * Player discoveries must be queued as these deltas: re-sending bits the
 * client already knew would let a stale reveal undo a manager hide that the
 * client has not observed yet.
 */
export const buildFogRasterDiscoveryDeltaMask = (tileMaskBytes, knownMaskBytes) => (
  subtractFogRasterTileMasks(tileMaskBytes, knownMaskBytes)
);

/**
 * Adds a player's newly discovered bits to the latest stored tile.
 * The read/merge/write runs in a transaction so a concurrent same-owner
 * discovery or manager hide forces a re-read instead of being overwritten.
 * Bits are never merged across grids (see createFogRasterTileGridScopeResolver).
 * Resolves to 'written', 'unchanged' (stored tile already contains every bit,
 * or nothing to write) or 'stale-grid' (the delta was computed on a grid the
 * map no longer uses and was discarded).
 */
export const persistFogRasterDiscoveryTile = async ({
  db,
  tile,
  updatedBy,
  runTransaction = defaultRunTransaction,
}) => {
  if (!tile?.id || countFogRasterMaskBits(tile.maskBytes) < 1) {
    return 'unchanged';
  }

  const tileRef = doc(db, GRIGLIATA_FOG_MEMORY_TILES_COLLECTION, tile.id);
  return runTransaction(db, async (transaction) => {
    const resolveGridScope = createFogRasterTileGridScopeResolver({ db, transaction });
    const storedTile = await readFogRasterTileInTransaction(transaction, tileRef);
    const { action, baseTile } = await resolveGridScope({ storedTile, operationTile: tile });
    if (action === 'discard') {
      return 'stale-grid';
    }
    if (baseTile && maskContainsFogRasterBits(baseTile.maskBytes, tile.maskBytes)) {
      return 'unchanged';
    }

    transaction.set(
      tileRef,
      buildFogRasterTilePayload({
        ...tile,
        grid: getFogRasterTileGrid(tile),
        maskBytes: mergeFogRasterTileMasks(baseTile?.maskBytes, tile.maskBytes),
        updatedAt: serverTimestamp(),
        updatedBy,
      }),
      { merge: true }
    );
    return 'written';
  });
};

/**
 * Persists queued player discovery deltas with bounded concurrency.
 * Every tile settles independently: one failing tile never discards the
 * others, and the caller receives the failed tiles to re-queue.
 * Each result's status is 'written', 'unchanged', 'stale-grid' or 'failed'.
 */
export const persistFogRasterDiscoveryTiles = async ({
  db,
  tiles = [],
  updatedBy,
  concurrency = FOG_RASTER_TILE_WRITE_CONCURRENCY,
  runTransaction = defaultRunTransaction,
}) => {
  const settledResults = await mapWithBoundedConcurrency(
    tiles,
    concurrency,
    (tile) => persistFogRasterDiscoveryTile({
      db,
      tile,
      updatedBy,
      runTransaction,
    })
  );

  return settledResults.map((result, index) => (
    result.status === 'fulfilled'
      ? { tile: tiles[index], status: result.value, error: null }
      : { tile: tiles[index], status: 'failed', error: result.reason }
  ));
};

// Players import their legacy polygon document only while they hold no raster
// tile on the map's grid. Deleting an owner's emptied tiles could re-run that
// import and bring hidden fog back, so emptied tiles are kept as empty
// documents while the legacy document has polygons for this cell size. Any
// non-empty list counts: no client version imports more than those polygons.
const ownerHasLegacyFogPolygons = async ({ db, transaction, tile, grid }) => {
  const legacyDocId = buildGrigliataFogOfWarDocId(tile.backgroundId, tile.ownerUid);
  if (!legacyDocId) {
    return false;
  }

  const snapshot = await transaction.get(doc(db, GRIGLIATA_FOG_OF_WAR_COLLECTION, legacyDocId));
  const legacyFog = snapshot.exists() ? snapshot.data() : null;
  return Math.round(Number(legacyFog?.cellSizePx)) === normalizeGridConfig(grid).cellSizePx
    && Array.isArray(legacyFog?.exploredPolygons)
    && legacyFog.exploredPolygons.length > 0;
};

// The mask a hide leaves on a stored tile, or null when nothing changes.
// Bits on a different grid mean nothing to this stroke, so those tiles stay.
const planFogBrushHide = (storedTile, brushTile) => {
  if (!fogRasterTileGridsMatch(storedTile, brushTile)) {
    return null;
  }

  const maskBytes = subtractFogRasterTileMasks(storedTile.maskBytes, brushTile.maskBytes);
  const bitCount = countFogRasterMaskBits(maskBytes);
  return bitCount === countFogRasterMaskBits(storedTile.maskBytes)
    ? null
    : { maskBytes, emptiesTile: bitCount < 1 };
};

// The mask a reveal writes, or null when nothing changes. A stored tile on
// another grid is replaced only when the stroke is on the map's current grid.
const planFogBrushReveal = async (resolveGridScope, storedTile, brushTile) => {
  if (countFogRasterMaskBits(brushTile.maskBytes) < 1) {
    return null;
  }

  const { action, baseTile } = await resolveGridScope({ storedTile, operationTile: brushTile });
  if (action === 'discard' || (baseTile && maskContainsFogRasterBits(baseTile.maskBytes, brushTile.maskBytes))) {
    return null;
  }
  return { maskBytes: mergeFogRasterTileMasks(baseTile?.maskBytes, brushTile.maskBytes), emptiesTile: false };
};

/**
 * Applies one manager brush stroke to one owner's stored tiles atomically.
 * Reveal ORs the brush mask into the latest tile; hide clears it and deletes
 * tiles that become empty, unless the owner still has legacy polygons (see
 * ownerHasLegacyFogPolygons). Tiles the stroke would not change are not
 * written. A stored tile from a different grid is left alone by hide and
 * replaced by reveal only on the map's current grid. Every read precedes every
 * write, as Firestore transactions require.
 */
export const applyFogBrushTilesForOwner = async ({
  db,
  mode,
  brushTiles = [],
  grid,
  updatedBy,
  runTransaction = defaultRunTransaction,
  shouldContinue = () => true,
}) => {
  if (!brushTiles.length || !shouldContinue()) {
    return false;
  }

  const isHide = mode === 'hide';
  return runTransaction(db, async (transaction) => {
    if (!shouldContinue()) return false;
    const resolveGridScope = createFogRasterTileGridScopeResolver({ db, transaction });
    const plans = await Promise.all(brushTiles.map(async (brushTile) => {
      const tileRef = doc(db, GRIGLIATA_FOG_MEMORY_TILES_COLLECTION, brushTile.id);
      const storedTile = await readFogRasterTileInTransaction(transaction, tileRef);
      const plan = isHide
        ? planFogBrushHide(storedTile, brushTile)
        : await planFogBrushReveal(resolveGridScope, storedTile, brushTile);
      return plan && { ...plan, brushTile, tileRef };
    }));
    const writes = plans.filter(Boolean);
    const emptiedTile = writes.find(({ emptiesTile }) => emptiesTile)?.brushTile;
    const keepsEmptiedTiles = !!emptiedTile
      && await ownerHasLegacyFogPolygons({ db, transaction, tile: emptiedTile, grid });
    // The board can close during a read or before Firestore retries a conflict.
    if (!shouldContinue()) return false;
    const updatedAt = serverTimestamp();

    writes.forEach(({ brushTile, tileRef, maskBytes, emptiesTile }) => {
      if (emptiesTile && !keepsEmptiedTiles) {
        transaction.delete(tileRef);
        return;
      }
      transaction.set(tileRef, buildFogRasterTilePayload({
        ...brushTile,
        grid,
        maskBytes,
        updatedAt,
        updatedBy,
      }), { merge: true });
    });
    return writes.length > 0;
  });
};

// Entries with recorded chunk progress get a distinct key, so a new stroke is
// never coalesced into polygons whose leading chunks are already committed.
export const buildFogBrushQueueKey = ({
  backgroundId,
  mode,
  cellSizePx,
  offsetXPx,
  offsetYPx,
  ownerUids = [],
  nextChunkByOwner = null,
} = {}) => JSON.stringify([
  backgroundId,
  mode,
  cellSizePx,
  offsetXPx,
  offsetYPx,
  ownerUids,
  nextChunkByOwner,
]);

const isValidFogBrushQueueEntry = (entry) => (
  !!entry?.backgroundId
  && !!entry?.updatedBy
  && Array.isArray(entry?.ownerUids)
  && entry.ownerUids.length > 0
  && Array.isArray(entry?.brushPolygons)
  && entry.brushPolygons.length > 0
);

const getFogBrushChunkStart = (entry, ownerUid) => {
  const chunkIndex = Number(entry.nextChunkByOwner?.[ownerUid]);
  return Number.isInteger(chunkIndex) && chunkIndex > 0 ? chunkIndex : 0;
};

/**
 * Applies one queued manager brush entry to every listed owner with bounded
 * concurrency. Each owner's stroke tiles are written in consecutive
 * transactions of at most maxTilesPerTransaction tiles, so an entry within
 * that size is atomic per owner. An owner starts at
 * entry.nextChunkByOwner[ownerUid]: a committed chunk is never replayed over
 * discoveries made since.
 * Resolves to { didWrite, failedOwnerUids, nextChunkByOwner, error } and never
 * rejects for a per-owner failure. nextChunkByOwner holds the chunk each
 * failed owner stopped at, when past its first, so a retry resumes there.
 */
export const persistFogBrushQueueEntry = async ({
  db,
  entry,
  concurrency = FOG_BRUSH_OWNER_WRITE_CONCURRENCY,
  maxTilesPerTransaction = FOG_BRUSH_MAX_TILES_PER_TRANSACTION,
  runTransaction = defaultRunTransaction,
  onOwnerResult,
  shouldContinue = () => true,
}) => {
  if (!isValidFogBrushQueueEntry(entry) || !shouldContinue()) {
    return { didWrite: false, failedOwnerUids: [], nextChunkByOwner: {}, error: null };
  }

  const brushGrid = normalizeGridConfig({
    cellSizePx: entry.cellSizePx,
    offsetXPx: entry.offsetXPx,
    offsetYPx: entry.offsetYPx,
  });
  const firstOwner = entry.ownerUids[0];
  const strokeTiles = rasterizeFogPolygonsToTiles({
    backgroundId: entry.backgroundId,
    ownerUid: firstOwner,
    grid: brushGrid,
    polygons: entry.brushPolygons,
  });
  // Rasterization is deterministic, so chunk boundaries hold across retries.
  const chunkSize = Math.max(1, Math.floor(Number(maxTilesPerTransaction)) || FOG_BRUSH_MAX_TILES_PER_TRANSACTION);
  const chunks = [];
  for (let start = 0; start < strokeTiles.length; start += chunkSize) {
    chunks.push(strokeTiles.slice(start, start + chunkSize));
  }

  const ownerResults = await mapWithBoundedConcurrency(
    entry.ownerUids,
    concurrency,
    async (ownerUid) => {
      let nextChunk = getFogBrushChunkStart(entry, ownerUid);
      let didWriteTile = false;
      let inputTileCount = 0;
      try {
        for (; nextChunk < chunks.length && shouldContinue(); nextChunk += 1) {
          const brushTiles = ownerUid === firstOwner ? chunks[nextChunk] : chunks[nextChunk].map((tile) => ({
            ...tile, ownerUid, id: buildFogRasterTileDocId({ ...tile, ownerUid }),
          }));
          const didWriteChunk = await applyFogBrushTilesForOwner({
            db,
            mode: entry.mode,
            brushTiles,
            grid: brushGrid,
            updatedBy: entry.updatedBy,
            runTransaction,
            shouldContinue,
          });
          didWriteTile = didWriteTile || didWriteChunk;
          inputTileCount += brushTiles.length;
        }
      } catch (error) {
        return { ownerUid, didWriteTile, nextChunk, failed: true, error };
      }
      onOwnerResult?.({ ownerUid, inputTileCount, didWriteTile });
      return { ownerUid, didWriteTile, nextChunk, failed: false, error: null };
    }
  );

  const outcomes = ownerResults.map((result, index) => (
    result.status === 'fulfilled'
      ? result.value
      : {
        ownerUid: entry.ownerUids[index],
        didWriteTile: false,
        nextChunk: getFogBrushChunkStart(entry, entry.ownerUids[index]),
        failed: true,
        error: result.reason,
      }
  ));
  const failedOutcomes = outcomes.filter(({ failed }) => failed);

  return {
    didWrite: outcomes.some(({ didWriteTile }) => didWriteTile),
    failedOwnerUids: failedOutcomes.map(({ ownerUid }) => ownerUid),
    nextChunkByOwner: Object.fromEntries(failedOutcomes
      .filter(({ nextChunk }) => nextChunk > 0)
      .map(({ ownerUid, nextChunk }) => [ownerUid, nextChunk])),
    error: failedOutcomes[0]?.error || null,
  };
};

/**
 * Drains the manager brush queue strictly in order. When an entry fails for
 * some owners, only those owners stay queued at the head (ahead of every later
 * stroke) with the chunk each stopped at, and the drain stops. A later
 * hide/reveal can never overtake an earlier one, and neither owners that
 * succeeded nor chunks already committed are re-applied.
 * Rejects with the first failure after retaining the unfinished work.
 */
export const drainFogBrushQueue = async ({
  queue,
  persistEntry,
  // Checked before each entry. Once the owning board session has ended, the
  // drain stops so a stale stroke cannot land after a newer board's edits.
  shouldContinue = () => true,
}) => {
  let didWrite = false;

  while (queue.length > 0 && shouldContinue()) {
    const entry = queue.shift();
    let result;
    try {
      result = await persistEntry(entry);
    } catch (error) {
      queue.unshift(entry);
      throw error;
    }

    didWrite = didWrite || !!result?.didWrite;
    const failedOwnerUids = Array.isArray(result?.failedOwnerUids) ? result.failedOwnerUids : [];
    if (failedOwnerUids.length > 0) {
      const { nextChunkByOwner: previousProgress, ...retainedEntry } = entry;
      const progress = result.nextChunkByOwner || previousProgress || {};
      const nextChunkByOwner = Object.fromEntries(failedOwnerUids
        .filter((ownerUid) => progress[ownerUid] > 0)
        .map((ownerUid) => [ownerUid, progress[ownerUid]]));
      retainedEntry.ownerUids = failedOwnerUids;
      if (Object.keys(nextChunkByOwner).length > 0) {
        retainedEntry.nextChunkByOwner = nextChunkByOwner;
      }
      retainedEntry.key = buildFogBrushQueueKey(retainedEntry);
      queue.unshift(retainedEntry);
      throw result.error || new Error('Fog brush write failed.');
    }
  }

  return didWrite;
};
