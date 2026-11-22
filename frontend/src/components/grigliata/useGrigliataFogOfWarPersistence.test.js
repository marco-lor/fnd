import React from 'react';
import { render, renderHook, screen, waitFor, act } from '@testing-library/react';
import useGrigliataFogOfWarPersistence, {
  GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS,
  buildViewerFogCurrentVisibility,
  buildViewerFogCurrentVisibleCells,
} from './useGrigliataFogOfWarPersistence';
import {
  FOG_POLYGON_MAX_RING_POINTS,
  FOG_POLYGON_MEMORY_MAX_RING_POINTS,
} from './fogPolygonGeometry';
import {
  FOG_RASTER_MASK_ENCODING,
  FOG_RASTER_PROFILE_ID,
  GRIGLIATA_FOG_MEMORY_TILES_COLLECTION,
} from './fogRasterMemory';

const mockBuildDocTarget = (...segments) => ({
  kind: 'doc',
  path: segments.join('/'),
  id: segments[segments.length - 1],
});

const mockArrayUnionSentinel = (...values) => (
  values.length === 1
    ? { __type: 'arrayUnion', value: values[0] }
    : { __type: 'arrayUnion', values }
);

let mockTransactionInstances = [];

jest.mock('../firebaseConfig', () => ({
  db: {},
}));

jest.mock('firebase/firestore', () => ({
  arrayUnion: jest.fn((...values) => mockArrayUnionSentinel(...values)),
  doc: jest.fn((db, ...segments) => mockBuildDocTarget(...segments)),
  getDoc: jest.fn((target) => Promise.resolve({
    id: target.id,
    exists: () => false,
    data: () => ({}),
  })),
  runTransaction: jest.fn((db, callback) => {
    const transaction = {
      get: jest.fn((target) => Promise.resolve({
        id: target.id,
        exists: () => false,
        data: () => ({}),
      })),
      set: jest.fn(),
    };
    mockTransactionInstances.push(transaction);
    return Promise.resolve(callback(transaction));
  }),
  serverTimestamp: jest.fn(() => ({ __type: 'serverTimestamp' })),
  setDoc: jest.fn(() => Promise.resolve()),
}));

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

const hasDirectNestedArray = (value) => {
  if (Array.isArray(value)) {
    return value.some((item) => Array.isArray(item) || hasDirectNestedArray(item));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasDirectNestedArray);
  }
  return false;
};

const token = {
  tokenId: 'user-1',
  ownerUid: 'user-1',
  tokenType: 'character',
  placed: true,
  col: 0,
  row: 0,
  isVisibleToPlayers: true,
  isDead: false,
  visionRadiusSquares: 3,
};

const closedDoorInput = {
  backgroundId: 'map-1',
  scene: { darkness: 0.6, globalLight: false },
  lights: [],
  walls: [{
    id: 'wall-2',
    x1: 70,
    y1: -70,
    x2: 70,
    y2: 140,
    wallType: 'door',
    blocksSight: true,
    blocksVision: true,
    blocksLight: true,
  }],
};

describe('useGrigliataFogOfWarPersistence visibility helpers', () => {
  let firestore;

  beforeEach(() => {
    jest.useFakeTimers();
    mockTransactionInstances = [];
    firestore = require('firebase/firestore');
    firestore.arrayUnion.mockClear().mockImplementation((...values) => mockArrayUnionSentinel(...values));
    firestore.doc.mockClear().mockImplementation((db, ...segments) => mockBuildDocTarget(...segments));
    firestore.getDoc.mockClear().mockImplementation((target) => Promise.resolve({
      id: target.id,
      exists: () => false,
      data: () => ({}),
    }));
    firestore.runTransaction.mockClear().mockImplementation((db, callback) => {
      const transaction = buildMockTransaction();
      mockTransactionInstances.push(transaction);
      return Promise.resolve(callback(transaction));
    });
    firestore.serverTimestamp.mockClear().mockImplementation(() => ({ __type: 'serverTimestamp' }));
    firestore.setDoc.mockClear().mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('current visible fog cells respect closed and opened runtime blockers', () => {
    const closedCells = buildViewerFogCurrentVisibleCells({
      tokens: [token],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      lightingRenderInput: closedDoorInput,
      rayCount: 64,
    });
    const openCells = buildViewerFogCurrentVisibleCells({
      tokens: [token],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      lightingRenderInput: {
        ...closedDoorInput,
        walls: [{
          ...closedDoorInput.walls[0],
          isOpen: true,
          blocksSight: false,
          blocksVision: false,
          blocksLight: false,
        }],
      },
      rayCount: 64,
    });

    expect(closedCells).not.toContain('1:0');
    expect(openCells).toContain('1:0');
    expect(openCells.length).toBeGreaterThan(closedCells.length);
  });

  test('rasterizes only the moving source and starts fresh when the grid changes', () => {
    const rasterize = jest.spyOn(require('./fogRasterMemory'), 'rasterizeFogPolygonsToTiles');
    const stationary = { ...token, tokenId: 'stationary', col: 20 };
    const args = {
      tokens: [token, stationary], grid, backgroundId: 'map-1', currentUserId: 'user-1',
      lightingRenderInput: closedDoorInput, rayCount: 64,
    };
    try {
      const { rerender, result } = renderHook(useGrigliataFogOfWarPersistence, { initialProps: args });
      expect(rasterize.mock.calls.map(([input]) => input.polygons.length)).toEqual([2]);
      const stationaryPolygon = result.current.currentVisiblePolygons[1];
      const moved = [{ ...token, row: 1 }, stationary];
      rerender({ ...args, tokens: moved });
      expect(result.current.currentVisiblePolygons[1]).toBe(stationaryPolygon);
      expect(rasterize.mock.calls.map(([input]) => input.polygons.length)).toEqual([2, 1]);
      rerender({ ...args, tokens: moved, grid: { ...grid, offsetXPx: 4 } });
      expect(rasterize.mock.calls.map(([input]) => input.polygons.length)).toEqual([2, 1, 2]);
    } finally {
      rasterize.mockRestore();
    }
  });

  test('current visible fog visibility includes sanitized precision polygons', () => {
    const visibility = buildViewerFogCurrentVisibility({
      tokens: [token],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      lightingRenderInput: closedDoorInput,
      rayCount: 64,
    });

    expect(visibility.currentVisibleCells).not.toContain('1:0');
    expect(visibility.currentVisiblePolygons).toHaveLength(1);
    expect(visibility.currentVisiblePolygons[0][0].length).toBeGreaterThan(
      FOG_POLYGON_MAX_RING_POINTS
    );
    expect(visibility.currentPersistencePolygons[0][0].length).toBeGreaterThan(
      FOG_POLYGON_MAX_RING_POINTS
    );
    expect(visibility.currentPersistencePolygons[0][0].length).toBeLessThanOrEqual(
      FOG_POLYGON_MEMORY_MAX_RING_POINTS
    );
  });

  test('unions current fog from every eligible owned token', () => {
    const visibility = buildViewerFogCurrentVisibility({
      tokens: [
        { ...token, tokenId: 'user-1', ownerUid: 'user-1', col: 0, row: 0 },
        {
          ...token,
          tokenId: 'custom-1',
          ownerUid: 'user-1',
          tokenType: 'custom',
          col: 10,
          row: 0,
        },
        {
          ...token,
          tokenId: 'other-1',
          ownerUid: 'user-2',
          col: 20,
          row: 0,
        },
        {
          ...token,
          tokenId: 'dead-1',
          ownerUid: 'user-1',
          col: 30,
          row: 0,
          isDead: true,
        },
      ],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      lightingRenderInput: {
        backgroundId: 'map-1',
        scene: { darkness: 0.6, globalLight: false },
        lights: [],
        walls: [],
      },
      rayCount: 32,
    });

    expect(visibility.currentVisibleCells).toContain('0:0');
    expect(visibility.currentVisibleCells).toContain('10:0');
    expect(visibility.currentVisibleCells).not.toContain('20:0');
    expect(visibility.currentVisibleCells).not.toContain('30:0');
    expect(visibility.currentVisiblePolygons).toHaveLength(2);
    expect(visibility.currentPersistencePolygons).toHaveLength(2);
  });

  // ---- Raster persistence (transactional delta writes) ----
  const fogRasterMemory = jest.requireActual('./fogRasterMemory');
  const openInput = {
    backgroundId: 'map-1',
    scene: { darkness: 0.6, globalLight: false },
    lights: [],
    walls: [],
  };
  const getTransactionSetCalls = () => (
    mockTransactionInstances.flatMap((transaction) => transaction.set.mock.calls)
  );
  const getTransactionReadIds = () => (
    mockTransactionInstances.flatMap((transaction) => transaction.get.mock.calls.map(([target]) => target.id))
  );
  const getWrittenTile = (tileKey, ownerUid = 'user-1') => {
    const writes = getTransactionSetCalls().filter(([, payload]) => (
      payload.tileKey === tileKey && payload.ownerUid === ownerUid
    ));
    const [, payload] = writes[writes.length - 1] || [];
    return payload ? { payload, maskBytes: fogRasterMemory.decodeFogRasterMaskBase64(payload.maskBase64) } : null;
  };
  const cellPolygon = (col, row) => [[
    { x: col * grid.cellSizePx, y: row * grid.cellSizePx },
    { x: (col + 1) * grid.cellSizePx, y: row * grid.cellSizePx },
    { x: (col + 1) * grid.cellSizePx, y: (row + 1) * grid.cellSizePx },
    { x: col * grid.cellSizePx, y: (row + 1) * grid.cellSizePx },
  ]];
  const buildStoredTile = (polygons, { ownerUid = 'user-1', tileGrid = grid } = {}) => {
    const [tile] = fogRasterMemory.rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid,
      grid: tileGrid,
      polygons,
    });
    return fogRasterMemory.normalizeFogRasterMemoryTileDoc({
      id: tile.id,
      ...fogRasterMemory.buildFogRasterTilePayload({
        ...tile,
        grid: tileGrid,
        maskBytes: tile.maskBytes,
        updatedAt: null,
        updatedBy: ownerUid,
      }),
    });
  };
  const buildMockTransaction = (storedDocsById = new Map()) => ({
    get: jest.fn((target) => {
      const stored = storedDocsById.get(target.id) || (target.path.startsWith('grigliata_backgrounds/') ? { grid } : null);
      return Promise.resolve({
        id: target.id,
        exists: () => !!stored,
        data: () => ({ ...(stored || {}) }),
      });
    }),
    set: jest.fn(),
  });
  const useStoredTransactionDocs = (storedDocsById) => {
    firestore.runTransaction.mockImplementation((db, callback) => {
      const transaction = buildMockTransaction(storedDocsById);
      mockTransactionInstances.push(transaction);
      return Promise.resolve(callback(transaction));
    });
  };
  const flushDebounce = async (ms = GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  const PersistenceProbe = ({ hookArgs }) => {
    const { pendingMemoryTiles, currentVisiblePolygons } = useGrigliataFogOfWarPersistence({
      backgroundId: 'map-1',
      currentUserId: 'user-1',
      isManager: false,
      grid,
      tokens: [token],
      lightingRenderInput: closedDoorInput,
      fogOfWar: null,
      isEnabled: true,
      rayCount: 16,
      ...hookArgs,
    });
    return (
      <div>
        <div data-testid="pending-tile-count">{String(pendingMemoryTiles.length)}</div>
        <div data-testid="pending-tile-ids">{pendingMemoryTiles.map((tile) => tile.id).join(',')}</div>
        <div data-testid="polygon-count">{String(currentVisiblePolygons.length)}</div>
      </div>
    );
  };
  const pendingTileCount = () => Number(screen.getByTestId('pending-tile-count').textContent);

  test('persists raster memory tiles through per-tile transactions without legacy payloads', async () => {
    render(<PersistenceProbe />);

    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    expect(screen.getByTestId('polygon-count')).toHaveTextContent('1');

    await flushDebounce();

    await waitFor(() => {
      expect(getTransactionSetCalls().length).toBeGreaterThan(0);
    });
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.getDoc).not.toHaveBeenCalled();
    const tileWrites = getTransactionSetCalls();
    expect(firestore.runTransaction).toHaveBeenCalledTimes(tileWrites.length);
    expect(tileWrites[0][0].path).toContain(`${GRIGLIATA_FOG_MEMORY_TILES_COLLECTION}/`);
    expect(tileWrites[0][1]).toEqual(expect.objectContaining({
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      cellSizePx: 70,
      rasterProfileId: FOG_RASTER_PROFILE_ID,
      maskEncoding: FOG_RASTER_MASK_ENCODING,
      maskBase64: expect.any(String),
      updatedBy: 'user-1',
    }));
    expect(tileWrites[0][1]).not.toHaveProperty('exploredCells');
    expect(tileWrites[0][1]).not.toHaveProperty('exploredPolygons');
    expect(tileWrites[0][2]).toEqual({ merge: true });
    expect(hasDirectNestedArray(tileWrites[0][1])).toBe(false);
    await waitFor(() => {
      expect(pendingTileCount()).toBe(0);
    });
  });

  test('skips duplicate raster writes when only non-visibility token fields change', async () => {
    const { rerender } = render(<PersistenceProbe hookArgs={{ tokens: [{ ...token, statuses: [] }] }} />);

    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    await flushDebounce();
    await waitFor(() => {
      expect(getTransactionSetCalls().length).toBeGreaterThan(0);
    });
    const transactionCount = firestore.runTransaction.mock.calls.length;

    rerender(<PersistenceProbe hookArgs={{ tokens: [{ ...token, statuses: ['poisoned'] }] }} />);
    await flushDebounce();

    expect(firestore.runTransaction).toHaveBeenCalledTimes(transactionCount);
  });

  test('queues two rapid movements into one raster flush without dropping the first move', async () => {
    const { rerender } = render(<PersistenceProbe hookArgs={{ tokens: [{ ...token, col: 0, row: 0 }] }} />);

    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    rerender(<PersistenceProbe hookArgs={{ tokens: [{ ...token, col: 10, row: 0 }] }} />);
    await flushDebounce();

    await waitFor(() => {
      expect(getTransactionSetCalls().length).toBeGreaterThan(1);
    });
    const tileKeys = getTransactionSetCalls().map(([, payload]) => payload.tileKey);
    expect(new Set(tileKeys).size).toBe(tileKeys.length);
    expect(tileKeys).toEqual(expect.arrayContaining(['0:0', '1:0']));
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  test('defers a new raster flush while previous tile transactions are still in flight', async () => {
    let releaseFirstTransaction;
    firestore.runTransaction.mockImplementation((db, callback) => {
      const transaction = buildMockTransaction();
      mockTransactionInstances.push(transaction);
      if (!releaseFirstTransaction) {
        return new Promise((resolve) => {
          releaseFirstTransaction = () => resolve(callback(transaction));
        });
      }
      return Promise.resolve(callback(transaction));
    });

    const { rerender } = render(<PersistenceProbe hookArgs={{ tokens: [{ ...token, col: 0, row: 0 }] }} />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    await flushDebounce();
    await waitFor(() => {
      expect(releaseFirstTransaction).toEqual(expect.any(Function));
    });
    const firstFlushTransactionCount = firestore.runTransaction.mock.calls.length;

    rerender(<PersistenceProbe hookArgs={{ tokens: [{ ...token, col: 10, row: 0 }] }} />);
    await flushDebounce();
    expect(firestore.runTransaction).toHaveBeenCalledTimes(firstFlushTransactionCount);

    await act(async () => {
      releaseFirstTransaction();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(firestore.runTransaction.mock.calls.length).toBeGreaterThan(firstFlushTransactionCount);
    });
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  test.each([
    ['aborted', 'transaction contention'],
    ['unavailable', 'offline client'],
  ])('retries a %s (%s) tile failure with backoff and only for the failed tile', async (code) => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let failedTileId = '';
    firestore.runTransaction.mockImplementation((db, callback) => {
      const transaction = buildMockTransaction();
      mockTransactionInstances.push(transaction);
      return Promise.resolve(callback(transaction)).then((result) => {
        const [[target]] = transaction.get.mock.calls;
        if (!failedTileId) {
          failedTileId = target.id;
          throw Object.assign(new Error('transient'), { code });
        }
        return result;
      });
    });

    render(<PersistenceProbe hookArgs={{ tokens: [{ ...token, col: 10, row: 0 }] }} />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(1);
    });
    await flushDebounce();
    await waitFor(() => {
      expect(pendingTileCount()).toBe(1);
    });
    expect(failedTileId).not.toBe('');
    expect(screen.getByTestId('pending-tile-ids')).toHaveTextContent(failedTileId);
    const firstFlushReads = getTransactionReadIds();
    expect(firstFlushReads.filter((id) => id === failedTileId)).toHaveLength(1);

    await flushDebounce(GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);
    await waitFor(() => {
      expect(pendingTileCount()).toBe(0);
    });
    const retryReads = getTransactionReadIds().slice(firstFlushReads.length);
    expect(retryReads).toEqual([failedTileId, 'map-1']);
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      'Failed to persist Grigliata raster fog memory:',
      expect.anything()
    );
    consoleErrorSpy.mockRestore();
  });

  test('keeps a permanently failing tile pending without re-writing tiles that succeeded', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let failedTileId = '';
    firestore.runTransaction.mockImplementation((db, callback) => {
      const transaction = buildMockTransaction();
      mockTransactionInstances.push(transaction);
      return Promise.resolve(callback(transaction)).then((result) => {
        const [[target]] = transaction.get.mock.calls;
        if (!failedTileId || failedTileId === target.id) {
          failedTileId = target.id;
          throw Object.assign(new Error('denied'), { code: 'permission-denied' });
        }
        return result;
      });
    });

    render(<PersistenceProbe hookArgs={{ tokens: [{ ...token, col: 10, row: 0 }] }} />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(1);
    });
    const queuedTileCount = pendingTileCount();
    await flushDebounce();
    await waitFor(() => {
      expect(pendingTileCount()).toBe(1);
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to persist Grigliata raster fog memory:',
      expect.objectContaining({ code: 'permission-denied' })
    );
    expect(firestore.runTransaction).toHaveBeenCalledTimes(queuedTileCount);

    await flushDebounce(60000);
    expect(firestore.runTransaction).toHaveBeenCalledTimes(queuedTileCount);
    expect(screen.getByTestId('pending-tile-ids')).toHaveTextContent(failedTileId);
    consoleErrorSpy.mockRestore();
  });

  test('queues only bits missing from known memory so a stale reveal cannot restore a manager hide', async () => {
    // Client still believes cell (0,0) is explored; a manager has since hidden
    // it, so the latest stored tile is gone. The write must carry only the
    // newly seen bits, never the stale known cell.
    const knownTile = buildStoredTile([cellPolygon(0, 0)]);
    useStoredTransactionDocs(new Map());

    render(<PersistenceProbe hookArgs={{
      tokens: [{ ...token, col: 0, row: 0, visionRadiusSquares: 2 }],
      lightingRenderInput: openInput,
      fogOfWar: { memoryTiles: [knownTile] },
    }} />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    await flushDebounce();

    await waitFor(() => {
      expect(getWrittenTile('0:0')).not.toBeNull();
    });
    const written = getWrittenTile('0:0').maskBytes;
    const knownBitCount = fogRasterMemory.countFogRasterMaskBits(knownTile.maskBytes);
    expect(fogRasterMemory.countFogRasterMaskBits(written)).toBeGreaterThan(0);
    expect(fogRasterMemory.countFogRasterMaskBits(
      fogRasterMemory.subtractFogRasterTileMasks(knownTile.maskBytes, written)
    )).toBe(knownBitCount);
  });

  test('merges discovery deltas into the latest stored tile read inside the transaction', async () => {
    // Another client already stored cell (7,7) of tile 0:0, out of this sight.
    const otherClientTile = buildStoredTile([cellPolygon(7, 7)]);
    const { maskBytes, id, ...otherClientDoc } = otherClientTile;
    useStoredTransactionDocs(new Map([[otherClientTile.id, otherClientDoc]]));

    render(<PersistenceProbe hookArgs={{
      tokens: [{ ...token, col: 0, row: 0, visionRadiusSquares: 2 }],
      lightingRenderInput: openInput,
    }} />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    await flushDebounce();

    await waitFor(() => {
      expect(getWrittenTile('0:0')).not.toBeNull();
    });
    const written = getWrittenTile('0:0').maskBytes;
    expect(fogRasterMemory.maskContainsFogRasterBits(written, otherClientTile.maskBytes)).toBe(true);
    expect(fogRasterMemory.countFogRasterMaskBits(written))
      .toBeGreaterThan(fogRasterMemory.countFogRasterMaskBits(otherClientTile.maskBytes));
  });

  test('replaces (never merges) a stored tile from an earlier grid alignment when this grid is current', async () => {
    const shiftedGrid = { ...grid, offsetXPx: 35 };
    const oldGridTile = buildStoredTile([cellPolygon(5, 5)], { tileGrid: shiftedGrid });
    const { maskBytes, id, ...oldGridDoc } = oldGridTile;
    useStoredTransactionDocs(new Map([
      [oldGridTile.id, oldGridDoc],
      ['map-1', { grid }],
    ]));

    render(<PersistenceProbe hookArgs={{
      tokens: [{ ...token, col: 0, row: 0, visionRadiusSquares: 2 }],
      lightingRenderInput: openInput,
    }} />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    await flushDebounce();
    await waitFor(() => {
      expect(getWrittenTile('0:0')).not.toBeNull();
    });

    const { payload, maskBytes: written } = getWrittenTile('0:0');
    expect(payload.offsetXPx).toBe(0);
    expect(fogRasterMemory.countFogRasterMaskBits(
      fogRasterMemory.subtractFogRasterTileMasks(oldGridTile.maskBytes, written)
    )).toBe(fogRasterMemory.countFogRasterMaskBits(oldGridTile.maskBytes));
  });

  test('discards a queued delta whose grid is no longer the map grid instead of overwriting newer tiles', async () => {
    const realignedGrid = { ...grid, offsetXPx: 8 };
    const newerTile = buildStoredTile([cellPolygon(0, 0), cellPolygon(1, 1)], { tileGrid: realignedGrid });
    const { maskBytes, id, ...newerDoc } = newerTile;
    useStoredTransactionDocs(new Map([
      [newerTile.id, newerDoc],
      ['map-1', { grid: realignedGrid }],
    ]));

    // This client has not received the realignment yet and still uses grid.
    render(<PersistenceProbe hookArgs={{
      tokens: [{ ...token, col: 0, row: 0, visionRadiusSquares: 2 }],
      lightingRenderInput: openInput,
    }} />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    await flushDebounce();

    await waitFor(() => {
      expect(pendingTileCount()).toBe(0);
    });
    expect(getTransactionReadIds()).toEqual(expect.arrayContaining([newerTile.id, 'map-1']));
    expect(getTransactionSetCalls().filter(([target]) => target.id === newerTile.id)).toEqual([]);
  });

  test('a flush that started before a grid realignment does not drop tiles queued on the new grid', async () => {
    let releaseFirstTransaction;
    const storedDocs = new Map([['map-1', { grid }]]);
    firestore.runTransaction.mockImplementation((db, callback) => {
      const transaction = buildMockTransaction(storedDocs);
      mockTransactionInstances.push(transaction);
      if (!releaseFirstTransaction) {
        return new Promise((resolve) => {
          releaseFirstTransaction = () => resolve(callback(transaction));
        });
      }
      return Promise.resolve(callback(transaction));
    });
    const realignedGrid = { ...grid, offsetXPx: 4 };
    const baseArgs = { lightingRenderInput: openInput, tokens: [{ ...token, visionRadiusSquares: 1 }] };

    const { rerender } = render(<PersistenceProbe hookArgs={baseArgs} />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    await flushDebounce();
    await waitFor(() => {
      expect(releaseFirstTransaction).toEqual(expect.any(Function));
    });

    // Realign, move, and let the new debounce expire while the old-grid
    // transaction is still open.
    storedDocs.set('map-1', { grid: realignedGrid });
    rerender(<PersistenceProbe hookArgs={{
      ...baseArgs,
      grid: realignedGrid,
      tokens: [{ ...token, col: 3, row: 0, visionRadiusSquares: 1 }],
    }} />);
    await flushDebounce();
    const transactionsBeforeRelease = firestore.runTransaction.mock.calls.length;

    await act(async () => {
      releaseFirstTransaction();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(pendingTileCount()).toBe(0);
    });
    expect(firestore.runTransaction.mock.calls.length).toBeGreaterThan(transactionsBeforeRelease);
    const realignedWrites = getTransactionSetCalls().filter(([, payload]) => payload.offsetXPx === 4);
    expect(realignedWrites.length).toBeGreaterThan(0);
  });

  test('switching maps flushes queued discoveries for the previous map immediately', async () => {
    const { rerender } = render(<PersistenceProbe />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    expect(firestore.runTransaction).not.toHaveBeenCalled();

    rerender(<PersistenceProbe hookArgs={{ backgroundId: 'map-2', lightingRenderInput: null }} />);

    await waitFor(() => {
      expect(getTransactionSetCalls().length).toBeGreaterThan(0);
    });
    getTransactionSetCalls().forEach(([, payload]) => {
      expect(payload).toEqual(expect.objectContaining({
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        updatedBy: 'user-1',
      }));
    });
  });

  test('switching accounts never writes the previous owner queued tiles as the new user', async () => {
    const { rerender } = render(<PersistenceProbe />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });

    rerender(<PersistenceProbe hookArgs={{ currentUserId: 'user-2', tokens: [] }} />);
    await flushDebounce();

    expect(getTransactionSetCalls()).toEqual([]);
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  test('unmounting resolves queued discoveries instead of dropping them', async () => {
    const { unmount } = render(<PersistenceProbe />);
    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(0);
    });
    expect(firestore.runTransaction).not.toHaveBeenCalled();

    unmount();

    await waitFor(() => {
      expect(getTransactionSetCalls().length).toBeGreaterThan(0);
    });
    getTransactionSetCalls().forEach(([, payload]) => {
      expect(payload.updatedBy).toBe('user-1');
    });
  });

  test('queues rapid movements from different owned tokens into one shared raster flush', async () => {
    const buildMainToken = (col) => ({ ...token, tokenId: 'user-1', ownerUid: 'user-1', col, row: 0, visionRadiusSquares: 1 });
    const buildCompanionToken = (col) => ({
      ...token,
      tokenId: 'custom-1',
      ownerUid: 'user-1',
      tokenType: 'custom',
      col,
      row: 0,
      visionRadiusSquares: 1,
    });
    const argsFor = (mainCol, companionCol) => ({
      tokens: [buildMainToken(mainCol), buildCompanionToken(companionCol)],
      lightingRenderInput: openInput,
    });
    const { rerender } = render(<PersistenceProbe hookArgs={argsFor(0, 10)} />);

    await waitFor(() => {
      expect(pendingTileCount()).toBeGreaterThan(1);
    });
    rerender(<PersistenceProbe hookArgs={argsFor(20, 10)} />);
    rerender(<PersistenceProbe hookArgs={argsFor(20, 30)} />);
    await flushDebounce();

    await waitFor(() => {
      expect(getTransactionSetCalls().length).toBeGreaterThanOrEqual(4);
    });
    const tileWrites = getTransactionSetCalls();
    const tileKeys = tileWrites.map((call) => call[1].tileKey);
    expect(tileKeys).toEqual(expect.arrayContaining(['0:0', '1:0', '2:0', '3:0']));
    tileWrites.forEach(([, payload]) => {
      expect(payload.ownerUid).toBe('user-1');
      expect(payload).not.toHaveProperty('exploredCells');
      expect(payload).not.toHaveProperty('exploredPolygons');
    });
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});
