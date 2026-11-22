import {
  applyFogBrushTilesForOwner,
  buildFogBrushQueueKey,
  FOG_BRUSH_MAX_TILES_PER_TRANSACTION,
  buildFogRasterDiscoveryDeltaMask,
  drainFogBrushQueue,
  mapWithBoundedConcurrency,
  persistFogBrushQueueEntry,
  persistFogRasterDiscoveryTile,
  persistFogRasterDiscoveryTiles,
} from './fogRasterTilePersistence';
import {
  buildFogRasterTilePayload,
  countFogRasterMaskBits,
  createEmptyFogRasterMaskBytes,
  decodeFogRasterMaskBase64,
  GRIGLIATA_FOG_MEMORY_TILES_COLLECTION,
  normalizeFogRasterMemoryTileDoc,
  rasterizeFogPolygonsToTiles,
} from './fogRasterMemory';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  runTransaction: jest.fn(),
  serverTimestamp: jest.fn(),
}));

beforeEach(() => {
  // CRA enables resetMocks, so implementations are re-applied per test.
  const firestore = require('firebase/firestore');
  firestore.doc.mockImplementation((db, ...segments) => ({
    kind: 'doc',
    path: segments.join('/'),
    id: segments[segments.length - 1],
  }));
  firestore.serverTimestamp.mockImplementation(() => ({ __type: 'serverTimestamp' }));
});

const GRID = { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 };

const maskWithBits = (...bitIndexes) => {
  const mask = createEmptyFogRasterMaskBytes();
  bitIndexes.forEach((bitIndex) => {
    // eslint-disable-next-line no-bitwise
    mask[Math.floor(bitIndex / 8)] |= (1 << (bitIndex % 8));
  });
  return mask;
};

const bitsOf = (mask) => {
  const bits = [];
  for (let index = 0; index < mask.length * 8; index += 1) {
    // eslint-disable-next-line no-bitwise
    if (mask[Math.floor(index / 8)] & (1 << (index % 8))) bits.push(index);
  }
  return bits;
};

const buildTile = ({ ownerUid = 'player-1', tileKey = '0:0', maskBytes }) => {
  const [tileCol, tileRow] = tileKey.split(':').map(Number);
  return {
    id: `map-1__${ownerUid}__fog-raster-c8-s16-v1__${tileKey}`,
    backgroundId: 'map-1',
    ownerUid,
    tileKey,
    tileCol,
    tileRow,
    ...GRID,
    maskBytes,
  };
};

const storedDocFor = (tile) => ({
  id: tile.id,
  ...buildFogRasterTilePayload({
    ...tile,
    grid: GRID,
    updatedAt: { __type: 'serverTimestamp' },
    updatedBy: tile.ownerUid,
  }),
});

// In-memory transactional store: runs the callback against the current
// documents and applies buffered writes only when the callback resolves.
// Like Firestore, it rejects a read issued after a write.
const createTransactionStore = (initialDocs = []) => {
  const docs = new Map(initialDocs.map((stored) => [stored.id, stored]));
  const transactions = [];
  const runTransaction = jest.fn(async (db, callback) => {
    const writes = [];
    const transaction = {
      get: jest.fn(async (target) => {
        if (writes.length > 0) {
          throw new Error('Firestore transactions require all reads to be executed before all writes.');
        }
        const stored = docs.get(target.id)
          || (target.path === 'grigliata_backgrounds/map-1' ? { grid: GRID } : null);
        return {
          id: target.id,
          exists: () => !!stored,
          data: () => {
            const { id, ...data } = stored || {};
            return data;
          },
        };
      }),
      set: jest.fn((target, payload) => writes.push({ type: 'set', target, payload })),
      delete: jest.fn((target) => writes.push({ type: 'delete', target })),
    };
    transactions.push(transaction);
    const result = await callback(transaction);
    writes.forEach((write) => {
      if (write.type === 'delete') {
        docs.delete(write.target.id);
      } else {
        docs.set(write.target.id, { id: write.target.id, ...write.payload });
      }
    });
    return result;
  });
  const maskOf = (tileId) => {
    const stored = docs.get(tileId);
    return stored ? decodeFogRasterMaskBase64(stored.maskBase64) : null;
  };
  return { docs, transactions, runTransaction, maskOf };
};

describe('mapWithBoundedConcurrency', () => {
  test('never exceeds the limit, preserves order, and settles every item', async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithBoundedConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (value === 4) throw new Error('four');
      return value * 10;
    });

    expect(maxActive).toBe(3);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled', 'fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled',
    ]);
    expect(results[6].value).toBe(70);
    expect(results[3].reason.message).toBe('four');
  });

  test('handles an empty list', async () => {
    await expect(mapWithBoundedConcurrency([], 4, jest.fn())).resolves.toEqual([]);
  });
});

describe('player discovery persistence', () => {
  test('delta mask keeps only bits missing from known memory', () => {
    const delta = buildFogRasterDiscoveryDeltaMask(maskWithBits(1, 2, 3), maskWithBits(2));
    expect(bitsOf(delta)).toEqual([1, 3]);
    expect(bitsOf(buildFogRasterDiscoveryDeltaMask(maskWithBits(5), undefined))).toEqual([5]);
  });

  test('merges the delta into the latest tile read inside the transaction', async () => {
    const otherClientTile = buildTile({ maskBytes: maskWithBits(10, 11) });
    const store = createTransactionStore([storedDocFor(otherClientTile)]);

    const status = await persistFogRasterDiscoveryTile({
      db: {},
      tile: buildTile({ maskBytes: maskWithBits(20) }),
      updatedBy: 'player-1',
      runTransaction: store.runTransaction,
    });

    expect(status).toBe('written');
    expect(bitsOf(store.maskOf(otherClientTile.id))).toEqual([10, 11, 20]);
    const [[target, payload, options]] = store.transactions[0].set.mock.calls;
    expect(target.path).toBe(`${GRIGLIATA_FOG_MEMORY_TILES_COLLECTION}/${otherClientTile.id}`);
    expect(payload).toEqual(expect.objectContaining({ ownerUid: 'player-1', updatedBy: 'player-1' }));
    expect(options).toEqual({ merge: true });
  });

  test('skips the write when the latest tile already contains the delta', async () => {
    const stored = buildTile({ maskBytes: maskWithBits(3, 4) });
    const store = createTransactionStore([storedDocFor(stored)]);

    await expect(persistFogRasterDiscoveryTile({
      db: {},
      tile: buildTile({ maskBytes: maskWithBits(4) }),
      updatedBy: 'player-1',
      runTransaction: store.runTransaction,
    })).resolves.toBe('unchanged');
    expect(store.transactions[0].set).not.toHaveBeenCalled();
  });

  test('does not open a transaction for an empty delta', async () => {
    const store = createTransactionStore();
    await expect(persistFogRasterDiscoveryTile({
      db: {},
      tile: buildTile({ maskBytes: createEmptyFogRasterMaskBytes() }),
      updatedBy: 'player-1',
      runTransaction: store.runTransaction,
    })).resolves.toBe('unchanged');
    expect(store.runTransaction).not.toHaveBeenCalled();
  });

  test('a stale delta cannot restore a bit hidden after the client last read it', async () => {
    // Stored tile after a manager hid bit 2; the client still believes {1, 2}
    // and now sees {2, 3}. Only the new bit 3 is queued and persisted.
    const store = createTransactionStore([storedDocFor(buildTile({ maskBytes: maskWithBits(1) }))]);
    const delta = buildFogRasterDiscoveryDeltaMask(maskWithBits(2, 3), maskWithBits(1, 2));

    await persistFogRasterDiscoveryTile({
      db: {},
      tile: buildTile({ maskBytes: delta }),
      updatedBy: 'player-1',
      runTransaction: store.runTransaction,
    });

    expect(bitsOf(store.maskOf(buildTile({ maskBytes: delta }).id))).toEqual([1, 3]);
  });

  test('replaces a stored tile from an old grid when the write is on the current map grid', async () => {
    const oldGridTile = { ...buildTile({ maskBytes: maskWithBits(1, 2) }), offsetXPx: 8 };
    const store = createTransactionStore([
      storedDocFor(oldGridTile),
      { id: 'map-1', grid: GRID },
    ]);
    // storedDocFor stamps GRID; restamp the stored tile with its own grid.
    store.docs.set(oldGridTile.id, { ...store.docs.get(oldGridTile.id), offsetXPx: 8 });

    await expect(persistFogRasterDiscoveryTile({
      db: {},
      tile: buildTile({ maskBytes: maskWithBits(9) }),
      updatedBy: 'player-1',
      runTransaction: store.runTransaction,
    })).resolves.toBe('written');

    expect(bitsOf(store.maskOf(oldGridTile.id))).toEqual([9]);
    expect(store.docs.get(oldGridTile.id).offsetXPx).toBe(0);
    const readIds = store.transactions[0].get.mock.calls.map(([target]) => target.path);
    expect(readIds).toEqual([
      `${GRIGLIATA_FOG_MEMORY_TILES_COLLECTION}/${oldGridTile.id}`,
      'grigliata_backgrounds/map-1',
    ]);
  });

  test('discards a delta computed on a grid the map no longer uses', async () => {
    const currentGrid = { ...GRID, offsetXPx: 8 };
    const newerTileId = buildTile({ maskBytes: maskWithBits(1) }).id;
    const store = createTransactionStore([{ id: 'map-1', grid: currentGrid }]);
    store.docs.set(newerTileId, {
      ...storedDocFor(buildTile({ maskBytes: maskWithBits(1, 2, 3) })),
      offsetXPx: 8,
    });

    await expect(persistFogRasterDiscoveryTile({
      db: {},
      tile: buildTile({ maskBytes: maskWithBits(9) }),
      updatedBy: 'player-1',
      runTransaction: store.runTransaction,
    })).resolves.toBe('stale-grid');

    expect(store.transactions[0].set).not.toHaveBeenCalled();
    expect(bitsOf(store.maskOf(newerTileId))).toEqual([1, 2, 3]);
  });

  test.each([false, true])('rejects stale discoveries on missing and untouched old-grid tiles (exists=%s)', async (exists) => {
    const tile = buildTile({ maskBytes: maskWithBits(3) });
    const oldTile = storedDocFor(buildTile({ maskBytes: maskWithBits(1) }));
    const store = createTransactionStore([{ id: 'map-1', grid: { ...GRID, offsetXPx: 8 } }, ...(exists ? [oldTile] : [])]);
    await expect(persistFogRasterDiscoveryTile({
      db: {}, tile, updatedBy: tile.ownerUid, runTransaction: store.runTransaction,
    })).resolves.toBe('stale-grid');
    expect(store.docs.get(tile.id)).toEqual(exists ? oldTile : undefined);
  });

  test('settles tiles independently and reports failures for re-queueing', async () => {
    const store = createTransactionStore();
    const failingTile = buildTile({ tileKey: '1:0', maskBytes: maskWithBits(7) });
    const runTransaction = jest.fn((db, callback) => (
      store.runTransaction(db, async (transaction) => {
        const result = await callback(transaction);
        const [[target]] = transaction.get.mock.calls;
        if (target.id === failingTile.id) {
          throw Object.assign(new Error('contention'), { code: 'aborted' });
        }
        return result;
      })
    ));

    const results = await persistFogRasterDiscoveryTiles({
      db: {},
      tiles: [
        buildTile({ tileKey: '0:0', maskBytes: maskWithBits(1) }),
        failingTile,
        buildTile({ tileKey: '2:0', maskBytes: maskWithBits(2) }),
      ],
      updatedBy: 'player-1',
      concurrency: 2,
      runTransaction,
    });

    expect(results.map(({ tile, status }) => [tile.tileKey, status])).toEqual([
      ['0:0', 'written'],
      ['1:0', 'failed'],
      ['2:0', 'written'],
    ]);
    expect(results[1].error.code).toBe('aborted');
  });
});

describe('manager brush persistence', () => {
  test('hide clears only the brushed bits and deletes tiles that become empty', async () => {
    const partial = buildTile({ ownerUid: 'player-2', tileKey: '0:0', maskBytes: maskWithBits(1, 2, 3) });
    const fullyHidden = buildTile({ ownerUid: 'player-2', tileKey: '1:0', maskBytes: maskWithBits(4) });
    const untouched = buildTile({ ownerUid: 'player-2', tileKey: '2:0', maskBytes: maskWithBits(5) });
    const store = createTransactionStore([partial, fullyHidden, untouched].map(storedDocFor));

    const didWrite = await applyFogBrushTilesForOwner({
      db: {},
      mode: 'hide',
      brushTiles: [
        { ...partial, maskBytes: maskWithBits(2) },
        { ...fullyHidden, maskBytes: maskWithBits(4) },
        { ...untouched, maskBytes: maskWithBits(9) },
        buildTile({ ownerUid: 'player-2', tileKey: '3:0', maskBytes: maskWithBits(1) }),
      ],
      grid: GRID,
      updatedBy: 'dm-1',
      runTransaction: store.runTransaction,
    });

    expect(didWrite).toBe(true);
    expect(bitsOf(store.maskOf(partial.id))).toEqual([1, 3]);
    expect(store.docs.has(fullyHidden.id)).toBe(false);
    expect(bitsOf(store.maskOf(untouched.id))).toEqual([5]);
    const [transaction] = store.transactions;
    expect(transaction.set).toHaveBeenCalledTimes(1);
    expect(transaction.delete).toHaveBeenCalledTimes(1);
  });

  test('reveal merges into the latest tile and skips tiles that already contain the stroke', async () => {
    const existing = buildTile({ ownerUid: 'player-2', tileKey: '0:0', maskBytes: maskWithBits(1) });
    const covered = buildTile({ ownerUid: 'player-2', tileKey: '1:0', maskBytes: maskWithBits(6, 7) });
    const store = createTransactionStore([existing, covered].map(storedDocFor));

    await applyFogBrushTilesForOwner({
      db: {},
      mode: 'reveal',
      brushTiles: [
        { ...existing, maskBytes: maskWithBits(2) },
        { ...covered, maskBytes: maskWithBits(7) },
        buildTile({ ownerUid: 'player-2', tileKey: '2:0', maskBytes: maskWithBits(3) }),
      ],
      grid: GRID,
      updatedBy: 'dm-1',
      runTransaction: store.runTransaction,
    });

    expect(bitsOf(store.maskOf(existing.id))).toEqual([1, 2]);
    expect(bitsOf(store.maskOf(buildTile({ ownerUid: 'player-2', tileKey: '2:0' }).id))).toEqual([3]);
    expect(store.transactions[0].set).toHaveBeenCalledTimes(2);
  });

  const LEGACY_DOC_ID = 'map-1__player-2';
  const legacyFogDoc = (overrides = {}) => ({
    id: LEGACY_DOC_ID,
    backgroundId: 'map-1',
    ownerUid: 'player-2',
    cellSizePx: GRID.cellSizePx,
    exploredCells: [],
    exploredPolygons: [{ rings: [{ points: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }] }] }],
    ...overrides,
  });
  const legacyReadCount = (transaction) => transaction.get.mock.calls
    .filter(([target]) => target.id === LEGACY_DOC_ID).length;

  test('hide keeps an emptied tile while the owner has legacy polygons a fresh session would import', async () => {
    const lastTile = buildTile({ ownerUid: 'player-2', tileKey: '0:0', maskBytes: maskWithBits(4) });
    const partial = buildTile({ ownerUid: 'player-2', tileKey: '1:0', maskBytes: maskWithBits(1, 2) });
    const store = createTransactionStore([storedDocFor(lastTile), storedDocFor(partial), legacyFogDoc()]);

    const didWrite = await applyFogBrushTilesForOwner({
      db: {},
      mode: 'hide',
      brushTiles: [lastTile, { ...partial, maskBytes: maskWithBits(2) }],
      grid: GRID,
      updatedBy: 'dm-1',
      runTransaction: store.runTransaction,
    });

    expect(didWrite).toBe(true);
    const [transaction] = store.transactions;
    expect(transaction.delete).not.toHaveBeenCalled();
    expect(legacyReadCount(transaction)).toBe(1);
    // The kept tile is a valid, empty tile on the current grid, so the
    // player's legacy import sees stored raster memory and stays skipped.
    const keptTile = normalizeFogRasterMemoryTileDoc(store.docs.get(lastTile.id));
    expect(keptTile).toEqual(expect.objectContaining(GRID));
    expect(bitsOf(keptTile.maskBytes)).toEqual([]);
    expect(bitsOf(store.maskOf(partial.id))).toEqual([1]);
  });

  test.each([
    ['no legacy document', null],
    ['legacy polygons on another cell size', legacyFogDoc({ cellSizePx: 50 })],
    ['a legacy document without polygons', legacyFogDoc({ exploredPolygons: [] })],
  ])('hide deletes an emptied tile when there is %s', async (label, legacyDoc) => {
    const lastTile = buildTile({ ownerUid: 'player-2', tileKey: '0:0', maskBytes: maskWithBits(4) });
    const store = createTransactionStore([storedDocFor(lastTile), ...(legacyDoc ? [legacyDoc] : [])]);

    await applyFogBrushTilesForOwner({
      db: {},
      mode: 'hide',
      brushTiles: [lastTile],
      grid: GRID,
      updatedBy: 'dm-1',
      runTransaction: store.runTransaction,
    });

    expect(store.docs.has(lastTile.id)).toBe(false);
    expect(store.transactions[0].delete).toHaveBeenCalledTimes(1);
  });

  test('hide reads the legacy document only when a tile would become empty', async () => {
    const partial = buildTile({ ownerUid: 'player-2', tileKey: '0:0', maskBytes: maskWithBits(1, 2) });
    const store = createTransactionStore([storedDocFor(partial), legacyFogDoc()]);

    await applyFogBrushTilesForOwner({
      db: {},
      mode: 'hide',
      brushTiles: [{ ...partial, maskBytes: maskWithBits(2) }],
      grid: GRID,
      updatedBy: 'dm-1',
      runTransaction: store.runTransaction,
    });

    expect(bitsOf(store.maskOf(partial.id))).toEqual([1]);
    expect(legacyReadCount(store.transactions[0])).toBe(0);
  });

  describe('stored tiles from an old grid', () => {
    const OLD_GRID = { cellSizePx: 50, offsetXPx: 10, offsetYPx: 0 };
    const storedOnGrid = (tile, grid) => ({
      id: tile.id,
      ...buildFogRasterTilePayload({
        ...tile,
        grid,
        updatedAt: { __type: 'serverTimestamp' },
        updatedBy: tile.ownerUid,
      }),
    });
    const oldTile = buildTile({ ownerUid: 'player-2', tileKey: '0:0', maskBytes: maskWithBits(1, 2) });
    const brushTile = buildTile({ ownerUid: 'player-2', tileKey: '0:0', maskBytes: maskWithBits(3) });
    const applyBrush = (store, mode) => applyFogBrushTilesForOwner({
      db: {},
      mode,
      brushTiles: [brushTile],
      grid: GRID,
      updatedBy: 'dm-1',
      runTransaction: store.runTransaction,
    });
    const backgroundReadCount = (store) => store.transactions[0].get.mock.calls
      .filter(([target]) => target.id === 'map-1').length;

    test('reveal replaces it when the stroke is on the map\'s current grid', async () => {
      const store = createTransactionStore([storedOnGrid(oldTile, OLD_GRID), { id: 'map-1', grid: GRID }]);

      await expect(applyBrush(store, 'reveal')).resolves.toBe(true);

      expect(store.docs.get(oldTile.id)).toEqual(expect.objectContaining(GRID));
      expect(bitsOf(store.maskOf(oldTile.id))).toEqual([3]);
      expect(backgroundReadCount(store)).toBe(1);
    });

    test('reveal leaves it alone when the stroke was painted on a grid the map no longer uses', async () => {
      const store = createTransactionStore([storedOnGrid(oldTile, OLD_GRID), { id: 'map-1', grid: OLD_GRID }]);

      await expect(applyBrush(store, 'reveal')).resolves.toBe(false);

      expect(store.docs.get(oldTile.id)).toEqual(expect.objectContaining(OLD_GRID));
      expect(bitsOf(store.maskOf(oldTile.id))).toEqual([1, 2]);
      expect(store.transactions[0].set).not.toHaveBeenCalled();
    });

    test('hide leaves it alone without reading the background', async () => {
      const store = createTransactionStore([storedOnGrid(oldTile, OLD_GRID), { id: 'map-1', grid: GRID }]);

      await expect(applyBrush(store, 'hide')).resolves.toBe(false);

      expect(bitsOf(store.maskOf(oldTile.id))).toEqual([1, 2]);
      expect(backgroundReadCount(store)).toBe(0);
    });
  });

  test('splits a large brush into transactions of at most 200 tiles per owner', async () => {
    // 15 x 15 tiles of 560 px: larger than one transaction allows.
    const brushPolygons = [[[{ x: 0, y: 0 }, { x: 8400, y: 0 }, { x: 8400, y: 8400 }, { x: 0, y: 8400 }]]];
    const store = createTransactionStore();

    const result = await persistFogBrushQueueEntry({
      db: {},
      entry: {
        backgroundId: 'map-1',
        ownerUids: ['player-2', 'player-3'],
        mode: 'reveal',
        ...GRID,
        updatedBy: 'dm-1',
        brushPolygons,
      },
      runTransaction: store.runTransaction,
    });

    expect(result).toEqual({ didWrite: true, unfinishedOwners: [] });
    expect(FOG_BRUSH_MAX_TILES_PER_TRANSACTION).toBe(200);
    expect(store.transactions.map((transaction) => transaction.set.mock.calls.length)
      .sort((left, right) => left - right)).toEqual([25, 25, 200, 200]);
    store.transactions.forEach((transaction) => {
      const reads = transaction.get.mock.calls.map(([ref]) => ref.path);
      expect(reads.filter((path) => path === 'grigliata_backgrounds/map-1')).toHaveLength(1);
      expect(reads.length).toBeLessThanOrEqual(FOG_BRUSH_MAX_TILES_PER_TRANSACTION + 1);
    });
    expect(store.docs.size).toBe(450);
  });

  test('closing the manager board stops remaining chunks and owners', async () => {
    const store = createTransactionStore();
    let active = true;
    const entry = {
      backgroundId: 'map-1', ownerUids: ['player-2', 'player-3'],
      mode: 'reveal', updatedBy: 'dm-1', ...GRID,
      brushPolygons: [[[{ x: 0, y: 0 }, { x: 8400, y: 0 }, { x: 8400, y: 8400 }, { x: 0, y: 8400 }]]],
    };
    const onOwnerResult = jest.fn();
    const result = await persistFogBrushQueueEntry({
      db: {}, entry, concurrency: 1,
      onOwnerResult,
      shouldContinue: () => active,
      runTransaction: async (db, callback) => {
        const result = await store.runTransaction(db, callback);
        active = false;
        return result;
      },
    });
    expect(store.transactions).toHaveLength(1);
    expect(onOwnerResult).not.toHaveBeenCalled();
    expect(result.unfinishedOwners).toEqual([
      { ownerUid: 'player-2', nextChunk: 1, error: null },
      { ownerUid: 'player-3', nextChunk: 0, error: null },
    ]);
    expect(store.docs.size).toBe(FOG_BRUSH_MAX_TILES_PER_TRANSACTION);
    expect([...store.docs.values()].every((tile) => tile.ownerUid === 'player-2')).toBe(true);
  });

  test('a manager session that ends during a read or before a retry cannot write a stale stroke', async () => {
    const tile = buildTile({ maskBytes: maskWithBits(2) });
    const store = createTransactionStore();
    let active = true;
    const result = await applyFogBrushTilesForOwner({
      db: {}, mode: 'reveal', brushTiles: [tile], grid: GRID, updatedBy: 'dm-1',
      shouldContinue: () => active,
      runTransaction: async (db, callback) => {
        await store.runTransaction(db, (transaction) => callback({
          ...transaction,
          get: async (ref) => {
            const snapshot = await transaction.get(ref);
            active = false;
            return snapshot;
          },
        }));
        return store.runTransaction(db, callback);
      },
    });
    expect(result).toBeNull();
    expect(store.transactions.map((transaction) => transaction.get.mock.calls.length)).toEqual([1, 0]);
    expect(store.docs.size).toBe(0);
  });

  test('queue entry reports exactly the owners whose transaction failed', async () => {
    const store = createTransactionStore();
    const runTransaction = jest.fn((db, callback) => store.runTransaction(db, async (transaction) => {
      const result = await callback(transaction);
      const [[target]] = transaction.get.mock.calls;
      if (target.id.includes('__player-3__')) {
        throw Object.assign(new Error('offline'), { code: 'unavailable' });
      }
      return result;
    }));
    const onOwnerResult = jest.fn();

    const result = await persistFogBrushQueueEntry({
      db: {},
      entry: {
        backgroundId: 'map-1',
        ownerUids: ['player-2', 'player-3', 'player-4'],
        mode: 'reveal',
        ...GRID,
        updatedBy: 'dm-1',
        brushPolygons: [[[{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }, { x: 0, y: 70 }]]],
      },
      runTransaction,
      onOwnerResult,
    });

    expect(result.didWrite).toBe(true);
    expect(result.unfinishedOwners).toEqual([
      { ownerUid: 'player-3', nextChunk: 0, error: expect.objectContaining({ code: 'unavailable' }) },
    ]);
    expect(onOwnerResult.mock.calls.map(([call]) => call.ownerUid).sort()).toEqual(['player-2', 'player-4']);
    const expectedTileCount = rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid: 'player-2',
      grid: GRID,
      polygons: [[[{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }, { x: 0, y: 70 }]]],
    }).length;
    expect(store.docs.size).toBe(expectedTileCount * 2);
    [...store.docs.values()].forEach((stored) => {
      expect(countFogRasterMaskBits(decodeFogRasterMaskBase64(stored.maskBase64))).toBeGreaterThan(0);
    });
  });
});

describe('drainFogBrushQueue', () => {
  const entry = (name, ownerUids = ['player-2']) => {
    const queued = {
      name,
      backgroundId: 'map-1',
      mode: name.startsWith('hide') ? 'hide' : 'reveal',
      ownerUids,
      ...GRID,
      brushPolygons: [name],
    };
    queued.key = buildFogBrushQueueKey(queued);
    return queued;
  };

  test('applies entries strictly in order', async () => {
    const applied = [];
    const queue = [entry('reveal-1'), entry('hide-1'), entry('reveal-2')];

    await expect(drainFogBrushQueue({
      queue,
      persistEntry: async (queued) => {
        applied.push(queued.name);
        return { didWrite: true, unfinishedOwners: [] };
      },
    })).resolves.toBe(true);

    expect(applied).toEqual(['reveal-1', 'hide-1', 'reveal-2']);
    expect(queue).toEqual([]);
  });

  test('retains only failed owners at the head and keeps later strokes queued behind them', async () => {
    const queue = [entry('hide-1', ['player-2', 'player-3']), entry('reveal-1')];
    const failure = Object.assign(new Error('offline'), { code: 'unavailable' });
    const persistEntry = jest.fn()
      .mockResolvedValueOnce({ didWrite: true, unfinishedOwners: [{ ownerUid: 'player-3', nextChunk: 0, error: failure }] });

    await expect(drainFogBrushQueue({ queue, persistEntry })).rejects.toBe(failure);

    expect(persistEntry).toHaveBeenCalledTimes(1);
    expect(queue.map((queued) => [queued.name, queued.ownerUids])).toEqual([
      ['hide-1', ['player-3']],
      ['reveal-1', ['player-2']],
    ]);
    expect(queue[0].key).toBe(buildFogBrushQueueKey({ ...queue[0] }));

    const applied = [];
    persistEntry.mockImplementation(async (queued) => {
      applied.push([queued.name, queued.ownerUids]);
      return { didWrite: true, unfinishedOwners: [] };
    });
    await expect(drainFogBrushQueue({ queue, persistEntry })).resolves.toBe(true);
    expect(applied).toEqual([
      ['hide-1', ['player-3']],
      ['reveal-1', ['player-2']],
    ]);
  });

  test('resumes a partly applied large hide at its failed chunk, ahead of later strokes', async () => {
    const square = (min, max) => [[[{ x: min, y: min }, { x: max, y: min }, { x: max, y: max }, { x: min, y: max }]]];
    const brushEntry = (mode, brushPolygons) => {
      const queued = { backgroundId: 'map-1', ownerUids: ['player-2'], mode, ...GRID, updatedBy: 'dm-1', brushPolygons };
      queued.key = buildFogBrushQueueKey(queued);
      return queued;
    };
    // 225 revealed tiles: hiding them takes two transactions, 200 + 25 tiles.
    const revealedTiles = rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid: 'player-2',
      grid: GRID,
      polygons: square(0, 8400),
    });
    const [firstChunkTile] = revealedTiles;
    const lastChunkTile = revealedTiles[revealedTiles.length - 1];
    const store = createTransactionStore(revealedTiles.map(storedDocFor));
    const offline = Object.assign(new Error('offline'), { code: 'unavailable' });
    let transactionCount = 0;
    let failsSecondTransaction = true;
    const runTransaction = jest.fn((db, callback) => {
      transactionCount += 1;
      return failsSecondTransaction && transactionCount === 2
        ? Promise.reject(offline)
        : store.runTransaction(db, callback);
    });
    const persistEntry = (queued) => persistFogBrushQueueEntry({ db: {}, entry: queued, runTransaction });
    const laterReveal = square(7900, 7950);
    const queue = [brushEntry('hide', square(0, 8400)), brushEntry('reveal', laterReveal)];

    await expect(drainFogBrushQueue({ queue, persistEntry })).rejects.toBe(offline);

    expect(store.docs.has(firstChunkTile.id)).toBe(false);
    expect(store.docs.has(lastChunkTile.id)).toBe(true);
    expect(queue.map((queued) => queued.mode)).toEqual(['hide', 'reveal']);
    expect(queue[0].nextChunkByOwner).toEqual({ 'player-2': 1 });
    // A new stroke cannot coalesce into polygons whose first chunk committed.
    expect(queue[0].key).not.toBe(brushEntry('hide', square(0, 8400)).key);

    // A player rediscovers part of a tile the committed chunk already hid.
    store.docs.set(firstChunkTile.id, storedDocFor({ ...firstChunkTile, maskBytes: maskWithBits(5) }));
    failsSecondTransaction = false;
    await expect(drainFogBrushQueue({ queue, persistEntry })).resolves.toBe(true);

    expect(queue).toEqual([]);
    expect(bitsOf(store.maskOf(firstChunkTile.id))).toEqual([5]);
    // The rest of the hide landed, then the later reveal on top of it.
    const [laterRevealTile] = rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid: 'player-2',
      grid: GRID,
      polygons: laterReveal,
    });
    expect(laterRevealTile.id).toBe(lastChunkTile.id);
    expect(store.maskOf(lastChunkTile.id)).toEqual(laterRevealTile.maskBytes);
    expect([...store.docs.keys()].sort()).toEqual([firstChunkTile.id, lastChunkTile.id].sort());
  });

  test('stops before the next entry once the board session has ended', async () => {
    let isSessionActive = true;
    const applied = [];
    const queue = [entry('hide-1'), entry('reveal-1')];

    await expect(drainFogBrushQueue({
      queue,
      shouldContinue: () => isSessionActive,
      persistEntry: async (queued) => {
        applied.push(queued.name);
        isSessionActive = false;
        return { didWrite: true, unfinishedOwners: [] };
      },
    })).resolves.toBe(true);

    expect(applied).toEqual(['hide-1']);
    expect(queue.map((queued) => queued.name)).toEqual(['reveal-1']);
  });

  test('reports a rejected entry and applies the following stroke in the same drain', async () => {
    const queue = [entry('reveal-1'), entry('hide-1')];
    const failure = Object.assign(new Error('invalid stroke'), { code: 'invalid-argument' });
    const persistEntry = jest.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ didWrite: true, unfinishedOwners: [] });
    const onPermanentFailure = jest.fn();

    await expect(drainFogBrushQueue({ queue, persistEntry, onPermanentFailure })).resolves.toBe(true);
    expect(onPermanentFailure).toHaveBeenCalledWith(failure, 'player-2');
    expect(persistEntry.mock.calls.map(([stroke]) => stroke.name)).toEqual(['reveal-1', 'hide-1']);
    expect(queue).toEqual([]);
  });

  test('reports a permanent owner failure and retries only the offline owner before later strokes', async () => {
    const queue = [entry('hide-1', ['player-2', 'player-3']), entry('reveal-2')];
    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    const offline = Object.assign(new Error('offline'), { code: 'unavailable' });
    const persistEntry = jest.fn().mockResolvedValueOnce({ didWrite: true, unfinishedOwners: [
      { ownerUid: 'player-2', nextChunk: 0, error: denied },
      { ownerUid: 'player-3', nextChunk: 2, error: offline },
    ] }).mockResolvedValue({ didWrite: true, unfinishedOwners: [] });
    const onPermanentFailure = jest.fn();
    await expect(drainFogBrushQueue({ queue, persistEntry, onPermanentFailure })).rejects.toBe(offline);
    expect(onPermanentFailure).toHaveBeenCalledWith(denied, 'player-2');
    expect(queue[0]).toMatchObject({ ownerUids: ['player-3'], nextChunkByOwner: { 'player-3': 2 } });
    await expect(drainFogBrushQueue({ queue, persistEntry, onPermanentFailure })).resolves.toBe(true);
    expect(persistEntry.mock.calls.map(([stroke]) => stroke.name)).toEqual(['hide-1', 'hide-1', 'reveal-2']);
  });
});
