import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { getDoc, runTransaction, setDoc } from '../../performance/firestore';
import GrigliataFogOfWarMask from './GrigliataFogOfWarMask';
import GrigliataLightingMask from './GrigliataLightingMask';
import { decodeFogRasterMaskBase64 } from './fogRasterMemory';
import { filterFogVisibleTokens } from './fogVisibilityFiltering';
import useGrigliataFogOfWarPersistence, {
  buildViewerFogCurrentVisibility,
  GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS,
} from './useGrigliataFogOfWarPersistence';

jest.mock('../firebaseConfig', () => ({ db: {} }));

jest.mock('../../performance/firestore', () => ({
  doc: (_db, ...path) => path.join('/'),
  getDoc: jest.fn(),
  runTransaction: jest.fn(),
  serverTimestamp: () => null,
  setDoc: jest.fn(),
}));

jest.mock('react-konva', () => {
  const React = require('react');
  const Shape = (props) => <div data-testid={props['data-testid']} />;
  return {
    Circle: Shape,
    Image: Shape,
    Line: Shape,
    Rect: Shape,
    Group: ({ children, clipFunc, ...props }) => {
      const clipMoves = [];
      let clipLineCount = 0;
      clipFunc?.({
        beginPath: () => {},
        moveTo: (x, y) => clipMoves.push(`M ${x} ${y}`),
        lineTo: () => { clipLineCount += 1; },
        closePath: () => {},
      });
      return (
        <div
          data-testid={props['data-testid']}
          data-clip-moves={clipMoves.join(' ')}
          data-clip-line-count={clipLineCount}
        >
          {children}
        </div>
      );
    },
    Path: ({ data, ...props }) => (
      <div data-testid={props['data-testid']} data-path={data} />
    ),
  };
});

const grid = { cellSizePx: 32, offsetXPx: 0, offsetYPx: 0 };
const bounds = { minX: -32, minY: -32, maxX: 7400, maxY: 64 };
const lightingRenderInput = {
  backgroundId: 'map-1',
  scene: { darkness: 0.6, globalLight: false },
  walls: [],
  lights: [{ id: 'light-1', x: 16, y: 16, dimRadiusPx: 80, color: '#AA3300' }],
};

const sampleWasPersisted = (masks, x, y) => {
  // The fixture has a zero-offset grid and 2 px samples in 256 px tiles.
  const tileKey = `${Math.floor(x / 256)}:${Math.floor(y / 256)}`;
  const bitIndex = (Math.floor((y % 256) / 2) * 128) + Math.floor((x % 256) / 2);
  return Boolean((masks.get(tileKey)?.[Math.floor(bitIndex / 8)] || 0) & (1 << (bitIndex % 8)));
};

describe('live fog visibility with many owned sources', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    getDoc.mockResolvedValue({ exists: () => false });
    setDoc.mockResolvedValue(undefined);
    runTransaction.mockImplementation((_db, update) => update({ get: getDoc, set: setDoc }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test.each([[8, 96], [9, 96], [20, 256]])(
    '%i sources at %i rays reach the fog cutout, light clip, entity filter and stored tiles',
    async (sourceCount, rayCount) => {
      // The first two footprints overlap. The others are disjoint with empty gaps.
      const cols = [0, 1, ...Array.from({ length: sourceCount - 2 }, (_, index) => (index + 1) * 12)];
      const tokens = cols.map((col, index) => ({
        tokenId: index === 0 ? 'viewer' : `owned-${index}`,
        ownerUid: 'viewer',
        tokenType: index === 0 ? 'character' : 'custom',
        backgroundId: 'map-1',
        placed: true,
        visionEnabled: true,
        visionRadiusSquares: 1,
        col,
        row: 0,
      }));
      const args = { backgroundId: 'map-1', currentUserId: 'viewer', grid, tokens, lightingRenderInput, rayCount };
      const { result } = renderHook(() => useGrigliataFogOfWarPersistence(args));
      const { currentVisiblePolygons, currentVisibleCells } = result.current;

      expect(currentVisiblePolygons).toHaveLength(sourceCount);
      expect(currentVisiblePolygons.map(([ring]) => ring.length)).toEqual(cols.map(() => rayCount));
      expect(currentVisibleCells).toEqual([]);

      render(
        <>
          <GrigliataFogOfWarMask bounds={bounds} grid={grid} currentVisiblePolygons={currentVisiblePolygons} />
          <GrigliataLightingMask bounds={bounds} grid={grid} metadata={lightingRenderInput} lightClipPolygons={currentVisiblePolygons} />
        </>
      );
      const fogPath = screen.getByTestId('fog-current-polygon-cutout').getAttribute('data-path');
      const fogMoves = fogPath.match(/M -?[\d.]+ -?[\d.]+/g);
      expect(fogMoves).toHaveLength(sourceCount);
      const lineCount = sourceCount * (rayCount - 1);
      expect(fogPath.match(/L /g)).toHaveLength(lineCount);
      const lightClip = screen.getByTestId('lighting-light-clip-group');
      expect(lightClip).toHaveAttribute('data-clip-moves', fogMoves.join(' '));
      expect(lightClip).toHaveAttribute('data-clip-line-count', String(lineCount));

      const targets = [...cols, 6].map((col) => ({
        tokenId: `target-${col}`,
        renderPosition: { x: (col * 32) + 15, y: 15, size: 2 },
      }));
      expect(filterFogVisibleTokens({
        tokens: targets,
        currentUserId: 'viewer',
        grid,
        fogOfWar: { currentVisiblePolygons, currentVisibleCells },
      }).map(({ tokenId }) => tokenId)).toEqual(cols.map((col) => `target-${col}`));

      await act(async () => {
        jest.advanceTimersByTime(GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);
      });
      await waitFor(() => {
        const masks = new Map(setDoc.mock.calls.map(([, { tileKey, maskBase64 }]) => (
          [tileKey, decodeFogRasterMaskBase64(maskBase64)]
        )));
        expect(cols.map((col) => sampleWasPersisted(masks, (col * 32) + 17, 17))).toEqual(cols.map(() => true));
        expect(sampleWasPersisted(masks, 9, 17)).toBe(true);
        expect(sampleWasPersisted(masks, 33, 17)).toBe(true);
        expect(sampleWasPersisted(masks, 209, 17)).toBe(false);
      });
    }
  );

  test('shares the simplified rings with exploration', () => {
    const visibility = buildViewerFogCurrentVisibility({
      backgroundId: 'map-1',
      currentUserId: 'viewer',
      grid,
      lightingRenderInput,
      tokens: [{ tokenId: 'viewer', placed: true, col: 0, row: 0, visionRadiusSquares: 1 }],
    });

    expect(visibility.currentVisiblePolygons).toHaveLength(1);
    expect(visibility.currentPersistencePolygons).toBe(visibility.currentVisiblePolygons);
  });
});
