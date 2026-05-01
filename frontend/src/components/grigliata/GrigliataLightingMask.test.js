import React from 'react';
import { render, screen } from '@testing-library/react';
import GrigliataLightingMask from './GrigliataLightingMask';

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
    Line: createComponent('Line'),
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
  maxX: 700,
  maxY: 700,
  width: 700,
  height: 700,
};

const token = {
  tokenId: 'token-1',
  renderPosition: {
    x: 70,
    y: 70,
    size: 70,
  },
};

const metadata = {
  scene: {
    darkness: 0.6,
    globalLight: false,
  },
  walls: [{
    id: 'wall-1',
    x1: 200,
    y1: 0,
    x2: 200,
    y2: 300,
    blocksSight: true,
  }],
  lights: [{
    id: 'light-1',
    x: 120,
    y: 120,
    brightRadiusPx: 80,
    dimRadiusPx: 160,
    color: '#FFAD00',
  }],
};

describe('GrigliataLightingMask', () => {
  test('renders darkness, token vision, and clipped light cutouts', () => {
    render(
      <GrigliataLightingMask
        bounds={bounds}
        grid={grid}
        metadata={metadata}
        tokens={[token]}
      />
    );

    expect(screen.getByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-darkness-overlay')).toHaveAttribute('data-opacity', '0.6');
    expect(screen.getByTestId('lighting-token-vision-cutout')).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(screen.getByTestId('lighting-light-bright-cutout')).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(screen.getByTestId('lighting-light-dim-cutout')).toHaveAttribute('data-globalcompositeoperation', 'destination-out');
    expect(screen.getByTestId('lighting-light-bright-polygon')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-light-dim-polygon')).toBeInTheDocument();
  });

  test('renders only the provided viewer-safe token vision sources', () => {
    render(
      <GrigliataLightingMask
        bounds={bounds}
        grid={grid}
        metadata={metadata}
        tokens={[token, {
          tokenId: 'token-2',
          renderPosition: {
            x: 210,
            y: 70,
            size: 70,
          },
        }]}
        visionSources={[{
          ...token,
          visionRadiusPx: 210,
        }]}
      />
    );

    expect(screen.getAllByTestId('lighting-token-vision-cutout')).toHaveLength(1);
    expect(screen.getByTestId('lighting-token-vision-cutout')).toHaveAttribute('data-tokenid', 'token-1');
  });

  test('skips darkness in global light scenes while showing clipped light contribution', () => {
    render(
      <GrigliataLightingMask
        bounds={bounds}
        grid={grid}
        metadata={{
          ...metadata,
          scene: {
            darkness: 0.7,
            globalLight: true,
          },
        }}
        tokens={[token]}
      />
    );

    expect(screen.getByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('lighting-darkness-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lighting-token-vision-cutout')).not.toBeInTheDocument();
    expect(screen.getByTestId('lighting-light-bright-polygon')).toBeInTheDocument();
  });
});
