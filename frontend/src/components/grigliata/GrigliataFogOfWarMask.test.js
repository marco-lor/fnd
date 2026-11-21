import React from 'react';
import { render, screen } from '@testing-library/react';
import GrigliataFogOfWarMask, {
  REMEMBERED_FOG_OPACITY,
} from './GrigliataFogOfWarMask';
import {
  FOG_RASTER_MASK_ENCODING,
  FOG_RASTER_PROFILE_ID,
  createEmptyFogRasterMaskBytes,
  encodeFogRasterMaskBase64,
  normalizeFogRasterMemoryTileDoc,
} from './fogRasterMemory';

jest.mock('react-konva', () => {
  const React = require('react');

  const serializeProp = (value) => {
    if (Array.isArray(value)) return JSON.stringify(value);
    if (value && typeof value === 'object') return JSON.stringify(value);
    return value;
  };

  const createComponent = (displayName) => {
    const Component = ({ children, ...props }) => {
      const domProps = {};

      Object.entries(props).forEach(([key, value]) => {
        if (value == null || typeof value === 'function') return;
        const domKey = key.startsWith('data-') ? key : `data-${key.toLowerCase()}`;
        domProps[domKey] = serializeProp(value);
      });

      return (
        <div {...domProps} data-konva-type={displayName}>
          {children}
        </div>
      );
    };

    Component.displayName = displayName;
    return Component;
  };

  return {
    Group: createComponent('Group'),
    Image: createComponent('Image'),
    Path: createComponent('Path'),
    Rect: createComponent('Rect'),
  };
});

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

const buildMemoryTile = ({
  tileCol = 0, tileRow = 0, firstByte = 0xff, backgroundId = 'map-1', ownerUid = 'user-1',
  offsetXPx = 0,
} = {}) => {
  const tileKey = `${tileCol}:${tileRow}`;
  const maskBytes = createEmptyFogRasterMaskBytes();
  maskBytes[0] = firstByte;
  return normalizeFogRasterMemoryTileDoc({
    backgroundId,
    ownerUid,
    tileKey,
    tileCol,
    tileRow,
    rasterProfileId: FOG_RASTER_PROFILE_ID,
    tileSizeCells: 8,
    samplesPerCell: 16,
    cellSizePx: 70,
    offsetXPx,
    offsetYPx: 0,
    maskEncoding: FOG_RASTER_MASK_ENCODING,
    maskBase64: encodeFogRasterMaskBase64(maskBytes),
    updatedBy: 'user-1',
  });
};

const bounds = {
  minX: 0,
  minY: 0,
  maxX: 210,
  maxY: 140,
  width: 210,
  height: 140,
};

describe('GrigliataFogOfWarMask', () => {
  test('does not render visual cell fallback for explored or current cells', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['0:0', '1:0']}
        currentVisibleCells={['1:0', '2:0']}
      />
    );

    expect(screen.getByTestId('fog-of-war-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('fog-unexplored-overlay')).toHaveAttribute('data-opacity', '1');
    expect(screen.queryByTestId('fog-remembered-cell-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-current-cell-cutout')).not.toBeInTheDocument();
  });

  test('renders raster memory masks when tile memory exists', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        memoryTiles={[buildMemoryTile()]}
        currentVisiblePolygons={[[[
          { x: 70, y: 0 },
          { x: 140, y: 0 },
          { x: 140, y: 70 },
          { x: 70, y: 70 },
        ]]]}
      />
    );

    expect(screen.getByTestId('fog-remembered-raster-clear')).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(screen.getByTestId('fog-remembered-raster-overlay')).toHaveAttribute('data-opacity', String(REMEMBERED_FOG_OPACITY));
    expect(screen.getByTestId('fog-current-polygon-cutout')).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(screen.getByTestId('fog-current-polygon-cutout-final')).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(screen.queryByTestId('fog-known-polygon-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-polygon-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-current-cell-cutout')).not.toBeInTheDocument();
  });

  test('retains unchanged atlas images as exploration expands and repaints erased pixels', () => {
    const context = {
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: jest.fn(),
    };
    const userAgent = jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('test-browser');
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    try {
      const firstTile = buildMemoryTile({ tileCol: 1 });
      const farTile = buildMemoryTile({ tileCol: 4 });
      const negativeTile = buildMemoryTile({ tileCol: -1, tileRow: -1 });
      const renderMask = (tiles, props = {}) => (
        <GrigliataFogOfWarMask bounds={bounds} grid={grid} memoryTiles={tiles} {...props} />
      );
      const { rerender } = render(renderMask([firstTile, farTile]));
      expect(context.putImageData).toHaveBeenCalledTimes(2);

      rerender(renderMask([negativeTile, farTile, buildMemoryTile({ tileCol: 1 })]));
      expect(context.putImageData).toHaveBeenCalledTimes(3);

      const partlyErased = buildMemoryTile({ tileCol: 1, firstByte: 0x02 });
      rerender(renderMask([farTile, partlyErased]));
      expect(context.putImageData).toHaveBeenCalledTimes(4);
      const lastPixels = context.putImageData.mock.calls[3][0].data;
      expect([...lastPixels.slice(0, 12)]).toEqual([0, 0, 0, 0, 2, 6, 23, 255, 0, 0, 0, 0]);
      expect(screen.getAllByTestId('fog-remembered-raster-overlay')).toHaveLength(2);

      rerender(renderMask([farTile, buildMemoryTile({ tileCol: 1, firstByte: 0 })]));
      expect(context.putImageData).toHaveBeenCalledTimes(4);
      expect(screen.getByTestId('fog-remembered-raster-overlay')).toHaveAttribute('data-x', '2240');

      rerender(renderMask([buildMemoryTile({ tileCol: 4, ownerUid: 'user-2' })]));
      rerender(renderMask([buildMemoryTile({ tileCol: 4, ownerUid: 'user-2', backgroundId: 'map-2' })]));
      const movedGrid = { ...grid, offsetXPx: 10 };
      rerender(renderMask([buildMemoryTile({
        tileCol: 4, ownerUid: 'user-2', backgroundId: 'map-2', offsetXPx: 10,
      })], { grid: movedGrid }));
      expect(context.putImageData).toHaveBeenCalledTimes(7);
      expect(screen.getByTestId('fog-remembered-raster-overlay')).toHaveAttribute('data-x', '2250');
    } finally {
      getContext.mockRestore();
      userAgent.mockRestore();
    }
  });

  test('renders overlapping current vision polygons as merged live vision', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        memoryTiles={[buildMemoryTile()]}
        currentVisiblePolygons={[
          [[
            { x: 0, y: 0 },
            { x: 140, y: 0 },
            { x: 140, y: 140 },
            { x: 0, y: 140 },
          ]],
          [[
            { x: 70, y: 0 },
            { x: 210, y: 0 },
            { x: 210, y: 140 },
            { x: 70, y: 140 },
          ]],
        ]}
      />
    );

    const currentCutout = screen.getByTestId('fog-current-polygon-cutout');
    const finalCurrentCutout = screen.getByTestId('fog-current-polygon-cutout-final');

    expect(screen.getByTestId('fog-remembered-raster-overlay')).toBeInTheDocument();
    expect(currentCutout).toHaveAttribute('data-fillrule', 'nonzero');
    expect(currentCutout).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(finalCurrentCutout).toHaveAttribute('data-fillrule', 'nonzero');
    expect(finalCurrentCutout).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
  });

  test('does not render cell fallback gaps when precision polygon memory is partial', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['0:0', '2:0']}
        exploredPolygons={[[[
          { x: 0, y: 0 },
          { x: 70, y: 0 },
          { x: 70, y: 70 },
          { x: 0, y: 70 },
        ]]]}
        currentVisibleCells={[]}
      />
    );

    expect(screen.queryByTestId('fog-known-polygon-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-polygon-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
  });

  test('does not render off-polygon cell memory when current polygons cover stored polygon memory', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['0:0', '2:0']}
        exploredPolygons={[[[
          { x: 0, y: 0 },
          { x: 70, y: 0 },
          { x: 70, y: 70 },
          { x: 0, y: 70 },
        ]]]}
        currentVisibleCells={[]}
        currentVisiblePolygons={[[[
          { x: 0, y: 0 },
          { x: 70, y: 0 },
          { x: 70, y: 70 },
          { x: 0, y: 70 },
        ]]]}
      />
    );

    expect(screen.queryByTestId('fog-known-polygon-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-polygon-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
  });

  test('does not render cell fallback for cells outside polygon memory', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['0:0', '2:0']}
        exploredPolygons={[[[
          { x: 0, y: 0 },
          { x: 70, y: 0 },
          { x: 70, y: 70 },
          { x: 0, y: 70 },
        ]]]}
        currentVisibleCells={[]}
      />
    );

    expect(screen.queryByTestId('fog-known-polygon-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-polygon-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
  });

  test('suppresses cell fallback rectangles that only patch polygon boundary mismatch', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['1:0']}
        exploredPolygons={[[[
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 70 },
          { x: 0, y: 70 },
        ]]]}
        currentVisibleCells={[]}
      />
    );

    expect(screen.queryByTestId('fog-known-polygon-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
  });

  test('suppresses near-boundary cell fallback halos when precision memory is available', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['2:0']}
        exploredPolygons={[[[
          { x: 0, y: 0 },
          { x: 120, y: 0 },
          { x: 120, y: 70 },
          { x: 0, y: 70 },
        ]]]}
        currentVisibleCells={[]}
      />
    );

    expect(screen.queryByTestId('fog-known-polygon-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
  });

  test('does not render cell fallback when precision memory is explicitly degraded', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['1:0']}
        exploredPolygons={[[[
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 70 },
          { x: 0, y: 70 },
        ]]]}
        currentVisibleCells={[]}
        renderCellFallback
      />
    );

    expect(screen.queryByTestId('fog-remembered-cell-fallback-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
  });

  test('does not render prior explored cells when there is no polygon memory', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['0:0']}
        currentVisibleCells={[]}
      />
    );

    expect(screen.getByTestId('fog-unexplored-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-current-cell-cutout')).not.toBeInTheDocument();
  });
});
