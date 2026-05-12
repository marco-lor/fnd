import React from 'react';
import { render, screen } from '@testing-library/react';
import GrigliataFogOfWarMask, {
  REMEMBERED_FOG_OPACITY,
  buildFogMaskPolygonBands,
} from './GrigliataFogOfWarMask';

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
    Path: createComponent('Path'),
    Rect: createComponent('Rect'),
  };
});

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
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
  test('renders unexplored dark, explored dim, and current visible clear cutouts', () => {
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
    expect(screen.getAllByTestId('fog-remembered-cell-clear')).toHaveLength(1);
    expect(screen.getByTestId('fog-remembered-cell-clear')).toHaveAttribute('data-cellkey', '0:0');
    expect(screen.getByTestId('fog-remembered-cell-clear')).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(screen.getByTestId('fog-remembered-cell-clear')).not.toHaveAttribute('data-opacity');
    expect(screen.getAllByTestId('fog-remembered-cell-overlay')).toHaveLength(1);
    expect(screen.getByTestId('fog-remembered-cell-overlay')).toHaveAttribute('data-opacity', String(REMEMBERED_FOG_OPACITY));
    expect(screen.getAllByTestId('fog-current-cell-cutout')).toHaveLength(2);
    expect(screen.getAllByTestId('fog-current-cell-cutout').map((node) => (
      node.getAttribute('data-cellkey')
    ))).toEqual(['1:0', '2:0']);
    expect(screen.getAllByTestId('fog-current-cell-cutout')[0]).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
  });

  test('renders polygon fog masks when polygon data exists', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['0:0']}
        exploredPolygons={[[[
          { x: 0, y: 0 },
          { x: 140, y: 0 },
          { x: 140, y: 140 },
          { x: 0, y: 140 },
        ]]]}
        currentVisibleCells={['1:0']}
        currentVisiblePolygons={[[[
          { x: 70, y: 0 },
          { x: 140, y: 0 },
          { x: 140, y: 70 },
          { x: 70, y: 70 },
        ]]]}
      />
    );

    expect(screen.getByTestId('fog-known-polygon-clear')).toHaveAttribute('data-fillrule', 'evenodd');
    expect(screen.getByTestId('fog-known-polygon-clear')).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(screen.getByTestId('fog-remembered-polygon-overlay')).toHaveAttribute('data-opacity', String(REMEMBERED_FOG_OPACITY));
    expect(screen.getByTestId('fog-current-polygon-cutout')).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(screen.queryByTestId('fog-remembered-cell-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-current-cell-cutout')).not.toBeInTheDocument();
  });

  test('subtracts current visibility from the remembered polygon band', () => {
    const bands = buildFogMaskPolygonBands({
      exploredPolygons: [[[
        { x: 0, y: 0 },
        { x: 140, y: 0 },
        { x: 140, y: 140 },
        { x: 0, y: 140 },
      ]]],
      currentVisiblePolygons: [[[
        { x: 35, y: 35 },
        { x: 105, y: 35 },
        { x: 105, y: 105 },
        { x: 35, y: 105 },
      ]]],
    });

    expect(bands.knownPolygons).toHaveLength(1);
    expect(bands.knownPolygons[0]).toHaveLength(1);
    expect(bands.rememberedOnlyPolygons).toHaveLength(1);
    expect(bands.rememberedOnlyPolygons[0]).toHaveLength(2);
  });

  test('suppresses cell fallback by default when precision polygon memory exists', () => {
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

    expect(screen.getByTestId('fog-known-polygon-clear')).toBeInTheDocument();
    expect(screen.getByTestId('fog-remembered-polygon-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-clear')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-overlay')).not.toBeInTheDocument();
  });

  test('can force cell fallback rendering when precision persistence is degraded', () => {
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
        forceRenderExploredCellFallback
      />
    );

    expect(screen.getByTestId('fog-known-polygon-clear')).toBeInTheDocument();
    expect(screen.getByTestId('fog-remembered-polygon-overlay')).toBeInTheDocument();
    expect(screen.getAllByTestId('fog-remembered-cell-overlay')).toHaveLength(1);
    expect(screen.getByTestId('fog-remembered-cell-overlay')).toHaveAttribute('data-cellkey', '2:0');
  });

  test('keeps prior explored cells dim when there is no current vision', () => {
    render(
      <GrigliataFogOfWarMask
        bounds={bounds}
        grid={grid}
        exploredCells={['0:0']}
        currentVisibleCells={[]}
      />
    );

    expect(screen.getByTestId('fog-unexplored-overlay')).toBeInTheDocument();
    expect(screen.getAllByTestId('fog-remembered-cell-clear')).toHaveLength(1);
    expect(screen.getAllByTestId('fog-remembered-cell-overlay')).toHaveLength(1);
    expect(screen.queryByTestId('fog-current-cell-cutout')).not.toBeInTheDocument();
  });
});
