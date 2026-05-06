import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GrigliataWallRuntimeControls from './GrigliataWallRuntimeControls';

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
        if (value == null) return;
        if (key === 'onTap') return;
        if (typeof value === 'function' && key.startsWith('on')) {
          domProps[key] = (event) => value({ evt: event, cancelBubble: false });
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

const walls = [{
  id: 'wall-1',
  x1: 0,
  y1: 0,
  x2: 70,
  y2: 0,
  wallType: 'wall',
  blocksSight: true,
}, {
  id: 'wall-2',
  x1: 70,
  y1: 0,
  x2: 140,
  y2: 0,
  wallType: 'door',
  isOpen: false,
  blocksSight: true,
}, {
  id: 'wall-3',
  x1: 140,
  y1: 0,
  x2: 210,
  y2: 0,
  wallType: 'window',
  isOpen: true,
  blocksSight: false,
}];

describe('GrigliataWallRuntimeControls', () => {
  test('renders interactive handles for doors and windows only', () => {
    render(
      <GrigliataWallRuntimeControls
        walls={walls}
        onToggleWallRuntimeSegment={jest.fn()}
      />
    );

    const controls = screen.getAllByTestId('wall-runtime-toggle');
    expect(controls).toHaveLength(2);
    expect(controls.map((control) => control.getAttribute('data-segmentid'))).toEqual(['wall-2', 'wall-3']);
    expect(controls.map((control) => control.getAttribute('data-state'))).toEqual(['closed', 'open']);
  });

  test('toggles the clicked segment without bubbling to board interactions', () => {
    const onToggleWallRuntimeSegment = jest.fn();
    render(
      <GrigliataWallRuntimeControls
        walls={walls}
        onToggleWallRuntimeSegment={onToggleWallRuntimeSegment}
      />
    );

    fireEvent.click(screen.getAllByTestId('wall-runtime-toggle')[0]);

    expect(onToggleWallRuntimeSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'wall-2',
      wallType: 'door',
      isOpen: false,
    }));
  });

  test('renders nothing without a toggle handler', () => {
    render(
      <GrigliataWallRuntimeControls
        walls={walls}
        onToggleWallRuntimeSegment={null}
      />
    );

    expect(screen.queryByTestId('wall-runtime-controls')).not.toBeInTheDocument();
  });
});
