import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GrigliataWallAuthoringControls, { GrigliataSelectedWallPanel } from './GrigliataWallAuthoringControls';

jest.mock('react-konva', () => {
  const React = require('react');

  const serializeProp = (value) => {
    if (Array.isArray(value)) return JSON.stringify(value);
    if (value && typeof value === 'object') return JSON.stringify(value);
    return value;
  };

  const buildKonvaEvent = (event) => {
    const konvaEvent = {
      evt: event,
      target: event.currentTarget,
    };

    Object.defineProperty(konvaEvent, 'cancelBubble', {
      get: () => false,
      set: (value) => {
        if (value) event.stopPropagation();
      },
    });

    return konvaEvent;
  };

  const createComponent = (displayName) => {
    const Component = ({ children, ...props }) => {
      const domProps = {};

      Object.entries(props).forEach(([key, value]) => {
        if (value == null) return;
        if (key === 'onTap') return;
        if (typeof value === 'function' && key.startsWith('on')) {
          domProps[key] = (event) => value(buildKonvaEvent(event));
          return;
        }
        if (typeof value === 'function') return;

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
  };
});

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

const wall = {
  id: 'wall-1',
  label: 'North Door',
  x1: 0,
  y1: 0,
  x2: 140,
  y2: 0,
  wallType: 'door',
  blocksSight: true,
  blocksVision: true,
  blocksLight: true,
};

describe('GrigliataWallAuthoringControls', () => {
  test('renders selected wall segments and endpoint handles', () => {
    render(
      <GrigliataWallAuthoringControls
        walls={[wall]}
        selectedWallId="wall-1"
        viewportScale={2}
      />
    );

    expect(screen.getByTestId('wall-source-controls')).toBeInTheDocument();
    expect(screen.getByTestId('wall-source-segment')).toHaveAttribute('data-wallid', 'wall-1');
    expect(screen.getByTestId('wall-source-segment')).toHaveAttribute('data-walltype', 'door');
    expect(screen.getByTestId('wall-source-start-handle')).toHaveAttribute('data-wallid', 'wall-1');
    expect(screen.getByTestId('wall-source-end-handle')).toHaveAttribute('data-wallid', 'wall-1');
  });

  test('selects and starts dragging endpoints and whole segments without bubbling', () => {
    const onSelectWall = jest.fn();
    const onBeginWallEndpointDrag = jest.fn();
    const onBeginWallSegmentDrag = jest.fn();

    render(
      <GrigliataWallAuthoringControls
        walls={[wall]}
        selectedWallId="wall-1"
        onSelectWall={onSelectWall}
        onBeginWallEndpointDrag={onBeginWallEndpointDrag}
        onBeginWallSegmentDrag={onBeginWallSegmentDrag}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('wall-source-start-handle'), {
      button: 0,
      buttons: 1,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.mouseDown(screen.getByTestId('wall-source-hit-target-line'), {
      button: 0,
      buttons: 1,
      clientX: 70,
      clientY: 0,
    });

    expect(onSelectWall).toHaveBeenCalledWith('wall-1');
    expect(onBeginWallEndpointDrag).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wall-1' }),
      'start',
      expect.any(Object)
    );
    expect(onBeginWallSegmentDrag).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wall-1' }),
      expect.any(Object)
    );
  });
});

describe('GrigliataSelectedWallPanel', () => {
  test('edits wall label, type, blocking flags, duplicate, and delete', () => {
    const onUpdateWall = jest.fn();
    const onDuplicateWall = jest.fn();
    const onDeleteWall = jest.fn();

    render(
      <GrigliataSelectedWallPanel
        wall={wall}
        grid={grid}
        onUpdateWall={onUpdateWall}
        onDuplicateWall={onDuplicateWall}
        onDeleteWall={onDeleteWall}
      />
    );

    const panel = screen.getByTestId('selected-wall-panel');
    fireEvent.change(within(panel).getByLabelText(/wall name/i), {
      target: { value: 'Kitchen Window' },
    });
    fireEvent.blur(within(panel).getByLabelText(/wall name/i));
    fireEvent.change(within(panel).getByLabelText(/wall type/i), {
      target: { value: 'window' },
    });
    fireEvent.click(within(panel).getByRole('checkbox', { name: /blocks vision/i }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: /blocks light/i }));
    fireEvent.click(within(panel).getByRole('button', { name: /duplicate wall/i }));
    fireEvent.click(within(panel).getByRole('button', { name: /delete wall/i }));

    expect(onUpdateWall).toHaveBeenCalledWith('wall-1', { label: 'Kitchen Window' });
    expect(onUpdateWall).toHaveBeenCalledWith('wall-1', { wallType: 'window' });
    expect(onUpdateWall).toHaveBeenCalledWith('wall-1', { blocksVision: false });
    expect(onUpdateWall).toHaveBeenCalledWith('wall-1', { blocksLight: false });
    expect(onDuplicateWall).toHaveBeenCalledWith('wall-1');
    expect(onDeleteWall).toHaveBeenCalledWith('wall-1');
  });
});
