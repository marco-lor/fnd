import React from 'react';
import { render, screen, within } from '@testing-library/react';
import GrigliataLightingMask from './GrigliataLightingMask';
import * as lightingGeometry from './lightingGeometry';

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
    Circle: createComponent('Circle'),
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
  darknessSources: [{
    x: 180,
    y: 180,
    radiusPx: 90,
    intensity: 0.75,
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
    expect(screen.getByTestId('lighting-darkness-source-overlay')).toHaveAttribute('data-opacity', '0.75');
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

  test('uses precomputed token vision polygons when supplied', () => {
    const buildTokenVisionPolygonsSpy = jest.spyOn(lightingGeometry, 'buildTokenVisionPolygons');

    render(
      <GrigliataLightingMask
        bounds={bounds}
        grid={grid}
        metadata={metadata}
        tokens={[{
          tokenId: 'token-2',
          renderPosition: {
            x: 210,
            y: 70,
            size: 70,
          },
        }]}
        precomputedTokenVisionPolygons={[{
          tokenId: 'precomputed-1',
          origin: { x: 35, y: 35 },
          radius: 70,
          polygon: [
            { x: 0, y: 0 },
            { x: 70, y: 0 },
            { x: 70, y: 70 },
            { x: 0, y: 70 },
          ],
        }]}
      />
    );

    expect(buildTokenVisionPolygonsSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('lighting-token-vision-cutout')).toHaveAttribute('data-tokenid', 'precomputed-1');

    buildTokenVisionPolygonsSpy.mockRestore();
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
    expect(screen.getByTestId('lighting-darkness-source-overlay')).toBeInTheDocument();
  });

  test('renders darkness sources even when they are the only lighting contribution in global light', () => {
    render(
      <GrigliataLightingMask
        bounds={bounds}
        grid={grid}
        metadata={{
          scene: {
            darkness: 0,
            globalLight: true,
          },
          walls: [],
          lights: [],
          darknessSources: [{
            x: 210,
            y: 210,
            radiusPx: 120,
            intensity: 0.5,
          }],
        }}
        tokens={[]}
      />
    );

    expect(screen.getByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-darkness-source-overlay')).toHaveAttribute('data-radius', '120');
  });

  test('clips light and darkness-source contributions to the current fog-visible polygons', () => {
    render(
      <GrigliataLightingMask
        bounds={bounds}
        grid={grid}
        metadata={metadata}
        tokens={[token]}
        lightClipPolygons={[[[
          { x: 0, y: 0 },
          { x: 220, y: 0 },
          { x: 220, y: 220 },
          { x: 0, y: 220 },
        ]]]}
      />
    );

    const clipGroup = screen.getByTestId('lighting-light-clip-group');
    expect(clipGroup).toBeInTheDocument();
    expect(screen.getByTestId('lighting-token-vision-cutout')).toBeInTheDocument();
    expect(within(clipGroup).queryByTestId('lighting-light-bright-cutout')).not.toBeInTheDocument();
    expect(within(clipGroup).getByTestId('lighting-light-bright-polygon')).toBeInTheDocument();
    expect(within(clipGroup).getByTestId('lighting-darkness-source-overlay')).toBeInTheDocument();
  });

  test('hides light contributions when fog clipping is active but there is no current vision', () => {
    render(
      <GrigliataLightingMask
        bounds={bounds}
        grid={grid}
        metadata={metadata}
        tokens={[token]}
        lightClipPolygons={[]}
      />
    );

    expect(screen.getByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-token-vision-cutout')).toBeInTheDocument();
    expect(screen.queryByTestId('lighting-light-clip-group')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lighting-light-bright-polygon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lighting-darkness-source-overlay')).not.toBeInTheDocument();
  });
});
