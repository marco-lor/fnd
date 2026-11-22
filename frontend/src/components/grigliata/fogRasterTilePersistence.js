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

// Include the map in the transaction's read set before mutating any tile.
// Recalibration between this read and the commit forces a fresh SDK attempt.
const isCurrentFogGrid = async (db, transaction, tile) => {
  const background = await transaction.get(doc(db, GRIGLIATA_BACKGROUNDS_COLLECTION, tile.backgroundId));
  return background.exists() && fogRasterTileGridsMatch(normalizeGridConfig(background.data().grid), tile);
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
 * Bits are merged only on the map's current grid.
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
    const storedTile = await readFogRasterTileInTransaction(transaction, tileRef);
    const baseTile = fogRasterTileGridsMatch(storedTile, tile) ? storedTile : null;
    if (baseTile && maskContainsFogRasterBits(baseTile.maskBytes, tile.maskBytes)) {
      return 'unchanged';
    }
    if (!await isCurrentFogGrid(db, transaction, tile)) {
      return 'stale-grid';
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
const planFogBrushReveal = (storedTile, brushTile) => {
  const baseTile = fogRasterTileGridsMatch(storedTile, brushTile) ? storedTile : null;
  if (countFogRasterMaskBits(brushTile.maskBytes) < 1
      || (baseTile && maskContainsFogRasterBits(baseTile.maskBytes, brushTile.maskBytes))) {
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
 * write, as Firestore transactions require. A cancelled attempt returns null.
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
  if (!brushTiles.length) return false;
  if (!shouldContinue()) return null;

  const isHide = mode === 'hide';
  return runTransaction(db, async (transaction) => {
    if (!shouldContinue()) return null;
    const plans = await Promise.all(brushTiles.map(async (brushTile) => {
      const tileRef = doc(db, GRIGLIATA_FOG_MEMORY_TILES_COLLECTION, brushTile.id);
      const storedTile = await readFogRasterTileInTransaction(transaction, tileRef);
      const plan = isHide
        ? planFogBrushHide(storedTile, brushTile)
        : planFogBrushReveal(storedTile, brushTile);
      return plan && { ...plan, brushTile, tileRef };
    }));
    const writes = plans.filter(Boolean);
    if (!shouldContinue()) return null;
    if (!writes.length || !await isCurrentFogGrid(db, transaction, writes[0].brushTile)) return false;
    const emptiedTile = writes.find(({ emptiesTile }) => emptiesTile)?.brushTile;
    const keepsEmptiedTiles = !!emptiedTile
      && await ownerHasLegacyFogPolygons({ db, transaction, tile: emptiedTile, grid });
    // The board can close during a read or before Firestore retries a conflict.
    if (!shouldContinue()) return null;
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
    return true;
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
 * An unfinished owner carries its next uncommitted chunk and its own error.
 * A null error means the board closed before the owner finished.
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
  if (!isValidFogBrushQueueEntry(entry)) {
    return { didWrite: false, unfinishedOwners: [] };
  }
  if (!shouldContinue()) {
    return {
      didWrite: false,
      unfinishedOwners: entry.ownerUids.map((ownerUid) => ({
        ownerUid, nextChunk: getFogBrushChunkStart(entry, ownerUid), error: null,
      })),
    };
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
          if (didWriteChunk === null) break;
          didWriteTile = didWriteTile || didWriteChunk;
          inputTileCount += brushTiles.length;
        }
      } catch (error) {
        return { didWriteTile, unfinished: { ownerUid, nextChunk, error } };
      }
      if (nextChunk < chunks.length) {
        return { didWriteTile, unfinished: { ownerUid, nextChunk, error: null } };
      }
      onOwnerResult?.({ ownerUid, inputTileCount, didWriteTile });
      return { didWriteTile };
    }
  );

  const outcomes = ownerResults.map((result, index) => (
    result.status === 'fulfilled'
      ? result.value
      : {
        unfinished: {
          ownerUid: entry.ownerUids[index],
          nextChunk: getFogBrushChunkStart(entry, entry.ownerUids[index]),
          error: result.reason,
        },
      }
  ));
  return {
    didWrite: outcomes.some(({ didWriteTile }) => didWriteTile),
    unfinishedOwners: outcomes.flatMap(({ unfinished }) => unfinished ? [unfinished] : []),
  };
};

/**
 * Keeps interrupted or retryable chunks ahead of later strokes. Permanent
 * failures are reported and removed so a rejected stroke cannot block the board.
 */
export const drainFogBrushQueue = async ({
  queue,
  persistEntry,
  onPermanentFailure,
  // Checked before each entry. Once the owning board session has ended, the
  // drain stops so a stale stroke cannot land after a newer board's edits.
  shouldContinue = () => true,
}) => {
  let didWrite = false;

  while (queue.length > 0 && shouldContinue()) {
    const entry = queue.shift();
    let unfinishedOwners;
    try {
      const result = await persistEntry(entry);
      didWrite = didWrite || result.didWrite;
      unfinishedOwners = result.unfinishedOwners;
    } catch (error) {
      unfinishedOwners = entry.ownerUids.map((ownerUid) => ({
        ownerUid, nextChunk: getFogBrushChunkStart(entry, ownerUid), error,
      }));
    }

    const retry = [];
    for (const owner of unfinishedOwners) {
      if (!owner.error || isRetryableFogWriteError(owner.error)) retry.push(owner);
      else onPermanentFailure?.(owner.error, owner.ownerUid);
    }
    if (!retry.length) continue;

    const retainedEntry = { ...entry, ownerUids: retry.map(({ ownerUid }) => ownerUid) };
    const progress = retry.filter(({ nextChunk }) => nextChunk > 0);
    if (progress.length) {
      retainedEntry.nextChunkByOwner = Object.fromEntries(progress.map(({ ownerUid, nextChunk }) => [ownerUid, nextChunk]));
    } else {
      delete retainedEntry.nextChunkByOwner;
    }
    retainedEntry.key = buildFogBrushQueueKey(retainedEntry);
    queue.unshift(retainedEntry);
    const retryError = retry.find(({ error }) => error)?.error;
    if (retryError && shouldContinue()) throw retryError;
    break;
  }

  return didWrite;
};
