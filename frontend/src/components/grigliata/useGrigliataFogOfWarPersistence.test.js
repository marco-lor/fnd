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

jest.mock('../firebaseConfig', () => ({
  db: {},
}));

jest.mock('firebase/firestore', () => ({
  arrayUnion: jest.fn((...values) => mockArrayUnionSentinel(...values)),
  doc: jest.fn((db, ...segments) => mockBuildDocTarget(...segments)),
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
    firestore = require('firebase/firestore');
    firestore.arrayUnion.mockClear().mockImplementation((...values) => mockArrayUnionSentinel(...values));
    firestore.doc.mockClear().mockImplementation((db, ...segments) => mockBuildDocTarget(...segments));
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

  test('persists cells before polygon precision data to keep fog memory stable', async () => {
    const HookProbe = () => {
      const { currentVisibleCells, currentVisiblePolygons } = useGrigliataFogOfWarPersistence({
        backgroundId: 'map-1',
        currentUserId: 'user-1',
        isManager: false,
        grid,
        tokens: [token],
        lightingRenderInput: closedDoorInput,
        fogOfWar: null,
        isEnabled: true,
        rayCount: 64,
      });

      return (
        <div>
          <div data-testid="cell-count">{String(currentVisibleCells.length)}</div>
          <div data-testid="polygon-count">{String(currentVisiblePolygons.length)}</div>
        </div>
      );
    };

    render(<HookProbe />);

    await waitFor(() => {
      expect(Number(screen.getByTestId('cell-count').textContent)).toBeGreaterThan(0);
      expect(screen.getByTestId('polygon-count')).toHaveTextContent('1');
    });

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledTimes(2);
    });
    const [cellWrite, polygonWrite] = firestore.setDoc.mock.calls;
    expect(cellWrite).toEqual([
      expect.objectContaining({ path: 'grigliata_fog_of_war/map-1__user-1' }),
      expect.objectContaining({
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        cellSizePx: 70,
        exploredCells: expect.any(Array),
        updatedBy: 'user-1',
      }),
      { merge: true },
    ]);
    expect(cellWrite[1]).not.toHaveProperty('exploredPolygons');
    expect(polygonWrite).toEqual([
      expect.objectContaining({ path: 'grigliata_fog_of_war/map-1__user-1' }),
      expect.objectContaining({
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        cellSizePx: 70,
        exploredCells: expect.any(Array),
        exploredPolygons: expect.any(Array),
        updatedBy: 'user-1',
      }),
      { merge: true },
    ]);
    expect(polygonWrite[1].exploredPolygons[0]).toEqual(expect.objectContaining({
      rings: expect.any(Array),
    }));
    expect(polygonWrite[1].exploredPolygons[0].rings[0].points.length).toBeGreaterThan(
      FOG_POLYGON_MAX_RING_POINTS
    );
    expect(polygonWrite[1].exploredPolygons[0].rings[0].points.length).toBeLessThanOrEqual(
      FOG_POLYGON_MEMORY_MAX_RING_POINTS
    );
    expect(hasDirectNestedArray(polygonWrite[1].exploredPolygons)).toBe(false);
  });

  test('persists precision polygons with fallback cells when cells are already explored', async () => {
    const visibility = buildViewerFogCurrentVisibility({
      tokens: [token],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      lightingRenderInput: closedDoorInput,
      rayCount: 64,
    });
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const HookProbe = () => {
      const { isPrecisionFogFallbackActive } = useGrigliataFogOfWarPersistence({
        backgroundId: 'map-1',
        currentUserId: 'user-1',
        isManager: false,
        grid,
        tokens: [token],
        lightingRenderInput: closedDoorInput,
        fogOfWar: {
          backgroundId: 'map-1',
          ownerUid: 'user-1',
          cellSizePx: 70,
          exploredCells: visibility.currentVisibleCells,
          exploredPolygons: [],
        },
        isEnabled: true,
        rayCount: 64,
      });
      return <div data-testid="probe">ready</div>;
    };

    render(<HookProbe />);

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    });
    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'grigliata_fog_of_war/map-1__user-1' }),
      expect.objectContaining({
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        cellSizePx: 70,
        exploredCells: expect.any(Array),
        exploredPolygons: expect.any(Array),
        updatedBy: 'user-1',
      }),
      { merge: true }
    );
    expect(firestore.setDoc.mock.calls[0][1].exploredPolygons[0]).toEqual(expect.objectContaining({
      rings: expect.any(Array),
    }));
    expect(firestore.setDoc.mock.calls[0][1].exploredPolygons[0].rings[0].points.length).toBeGreaterThan(
      FOG_POLYGON_MAX_RING_POINTS
    );
    expect(firestore.setDoc.mock.calls[0][1].exploredPolygons[0].rings[0].points.length).toBeLessThanOrEqual(
      FOG_POLYGON_MEMORY_MAX_RING_POINTS
    );
    expect(firestore.setDoc.mock.calls[0][1].exploredCells).toEqual(
      visibility.currentVisibleCells
    );
    expect(hasDirectNestedArray(firestore.setDoc.mock.calls[0][1].exploredPolygons)).toBe(false);
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      'Precision Grigliata fog persistence was denied; continuing with cell fog fallback.',
      expect.anything()
    );

    consoleWarnSpy.mockRestore();
  });

  test('keeps cell fog fallback when precision polygon persistence is denied', async () => {
    const permissionError = Object.assign(new Error('denied'), { code: 'permission-denied' });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    firestore.setDoc
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(permissionError));

    const HookProbe = () => {
      const { isPrecisionFogFallbackActive } = useGrigliataFogOfWarPersistence({
        backgroundId: 'map-1',
        currentUserId: 'user-1',
        isManager: false,
        grid,
        tokens: [token],
        lightingRenderInput: closedDoorInput,
        fogOfWar: null,
        isEnabled: true,
        rayCount: 32,
      });
      return <div data-testid="fallback-active">{String(isPrecisionFogFallbackActive)}</div>;
    };

    render(<HookProbe />);

    await act(async () => {
      jest.advanceTimersByTime(GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(firestore.setDoc).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('fallback-active')).toHaveTextContent('true');
    });
    expect(firestore.setDoc.mock.calls[0][1]).toEqual(expect.objectContaining({
      exploredCells: expect.any(Array),
    }));
    expect(firestore.setDoc.mock.calls[0][1]).not.toHaveProperty('exploredPolygons');
    expect(firestore.setDoc.mock.calls[1][1]).toEqual(expect.objectContaining({
      exploredCells: expect.any(Array),
      exploredPolygons: expect.any(Array),
    }));
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      'Failed to persist Grigliata fog of war:',
      permissionError
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Precision Grigliata fog persistence was denied; continuing with cell fog fallback.',
      permissionError
    );

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });
});
