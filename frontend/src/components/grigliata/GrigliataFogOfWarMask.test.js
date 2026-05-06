import React from 'react';
import { render, screen } from '@testing-library/react';
import GrigliataFogOfWarMask from './GrigliataFogOfWarMask';

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
    expect(screen.getAllByTestId('fog-explored-cell-cutout')).toHaveLength(1);
    expect(screen.getByTestId('fog-explored-cell-cutout')).toHaveAttribute('data-cellkey', '0:0');
    expect(screen.getByTestId('fog-explored-cell-cutout')).toHaveAttribute('data-opacity', '0.54');
    expect(screen.getAllByTestId('fog-current-cell-cutout')).toHaveLength(2);
    expect(screen.getAllByTestId('fog-current-cell-cutout').map((node) => (
      node.getAttribute('data-cellkey')
    ))).toEqual(['1:0', '2:0']);
    expect(screen.getAllByTestId('fog-current-cell-cutout')[0]).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
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
    expect(screen.getAllByTestId('fog-explored-cell-cutout')).toHaveLength(1);
    expect(screen.queryByTestId('fog-current-cell-cutout')).not.toBeInTheDocument();
  });
});
