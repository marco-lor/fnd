import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
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
    firestore.runTransaction.mockClear().mockImplementation((db, callback) => {
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

  test('persists raster memory tiles instead of legacy cell or polygon fallback', async () => {
    const HookProbe = () => {
      const { currentVisibleCells, currentVisiblePolygons, pendingMemoryTiles } = useGrigliataFogOfWarPersistence({
        backgroundId: 'map-1',
        currentUserId: 'user-1',
        isManager: false,
        grid,
        tokens: [token],
        lightingRenderInput: closedDoorInput,
        fogOfWar: null,
        isEnabled: true,
        rayCount: 16,
      });

      return (
        <div>
          <div data-testid="cell-count">{String(currentVisibleCells.length)}</div>
          <div data-testid="polygon-count">{String(currentVisiblePolygons.length)}</div>
          <div data-testid="pending-tile-count">{String(pendingMemoryTiles.length)}</div>
        </div>
      );
    };

    render(<HookProbe />);

    await waitFor(() => {
      expect(Number(screen.getByTestId('cell-count').textContent)).toBeGreaterThan(0);
      expect(screen.getByTestId('polygon-count')).toHaveTextContent('1');
      expect(Number(screen.getByTestId('pending-tile-count').textContent)).toBeGreaterThan(0);
    });

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    });
    expect(firestore.setDoc).not.toHaveBeenCalled();
    const tileWrites = mockTransactionInstances[0].set.mock.calls;
    expect(tileWrites.length).toBeGreaterThan(0);
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
    expect(hasDirectNestedArray(tileWrites[0][1])).toBe(false);
  });

  test('queues two rapid movements into one raster flush without dropping the first move', async () => {
    const HookProbe = ({ movingToken }) => {
      const { pendingMemoryTiles } = useGrigliataFogOfWarPersistence({
        backgroundId: 'map-1',
        currentUserId: 'user-1',
        isManager: false,
        grid,
        tokens: [movingToken],
        lightingRenderInput: closedDoorInput,
        fogOfWar: null,
        isEnabled: true,
        rayCount: 16,
      });
      return <div data-testid="pending-tile-count">{String(pendingMemoryTiles.length)}</div>;
    };

    const { rerender } = render(<HookProbe movingToken={{ ...token, col: 0, row: 0 }} />);

    await waitFor(() => {
      expect(Number(screen.getByTestId('pending-tile-count').textContent)).toBeGreaterThan(0);
    });

    rerender(<HookProbe movingToken={{ ...token, col: 10, row: 0 }} />);

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    });
    const tileKeys = mockTransactionInstances[0].set.mock.calls
      .map((call) => call[1].tileKey);
    expect(new Set(tileKeys).size).toBeGreaterThan(1);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});
