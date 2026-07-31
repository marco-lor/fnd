import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GrigliataDarknessControls, { GrigliataSelectedDarknessPanel } from './GrigliataDarknessControls';

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
  };
});

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

const darkness = {
  id: 'darkness-1',
  label: 'Void',
  enabled: true,
  x: 140,
  y: 210,
  radiusPx: 280,
  intensity: 0.75,
};

describe('GrigliataDarknessControls', () => {
  test('renders selected DM darkness handles with non-listening radius preview', () => {
    render(
      <GrigliataDarknessControls
        darknessSources={[darkness]}
        selectedDarknessId="darkness-1"
        viewportScale={2}
      />
    );

    expect(screen.getByTestId('darkness-source-controls')).toBeInTheDocument();
    expect(screen.getByTestId('darkness-source-radius')).toHaveAttribute('data-listening', 'false');
    expect(screen.getByTestId('darkness-source-handle')).toHaveAttribute('data-darknessid', 'darkness-1');
    expect(screen.getByTestId('darkness-source-handle')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('darkness-source-handle')).toHaveAttribute('data-enabled', 'true');
  });

  test('selects and starts dragging from the darkness handle', () => {
    const onSelectDarkness = jest.fn();
    const onBeginDarknessDrag = jest.fn();

    render(
      <GrigliataDarknessControls
        darknessSources={[darkness]}
        onSelectDarkness={onSelectDarkness}
        onBeginDarknessDrag={onBeginDarknessDrag}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('darkness-source-handle'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 210,
    });

    expect(onSelectDarkness).toHaveBeenCalledWith('darkness-1');
    expect(onBeginDarknessDrag).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'darkness-1' }),
      expect.any(Object)
    );
  });
});

describe('GrigliataSelectedDarknessPanel', () => {
  test('edits darkness name, radius, intensity, enabled state, duplicate, and delete', () => {
    const onUpdateDarkness = jest.fn();
    const onDuplicateDarkness = jest.fn();
    const onDeleteDarkness = jest.fn();

    render(
      <GrigliataSelectedDarknessPanel
        darkness={darkness}
        grid={grid}
        onUpdateDarkness={onUpdateDarkness}
        onDuplicateDarkness={onDuplicateDarkness}
        onDeleteDarkness={onDeleteDarkness}
      />
    );

    const panel = screen.getByTestId('selected-darkness-panel');
    fireEvent.change(within(panel).getByLabelText(/darkness name/i), {
      target: { value: 'Blackout' },
    });
    fireEvent.blur(within(panel).getByLabelText(/darkness name/i));

    fireEvent.click(within(panel).getByRole('checkbox', { name: /darkness enabled/i }));

    fireEvent.change(within(panel).getByRole('spinbutton', { name: /radius in squares/i }), {
      target: { value: '5' },
    });
    fireEvent.blur(within(panel).getByRole('spinbutton', { name: /radius in squares/i }));

    fireEvent.change(within(panel).getByRole('spinbutton', { name: /darkness intensity/i }), {
      target: { value: '0.4' },
    });
    fireEvent.blur(within(panel).getByRole('spinbutton', { name: /darkness intensity/i }));

    fireEvent.click(within(panel).getByRole('button', { name: /duplicate darkness/i }));
    fireEvent.click(within(panel).getByRole('button', { name: /delete darkness/i }));

    expect(onUpdateDarkness).toHaveBeenCalledWith('darkness-1', { label: 'Blackout' });
    expect(onUpdateDarkness).toHaveBeenCalledWith('darkness-1', { enabled: false });
    expect(onUpdateDarkness).toHaveBeenCalledWith('darkness-1', { radiusPx: 350 });
    expect(onUpdateDarkness).toHaveBeenCalledWith('darkness-1', { intensity: 0.4 });
    expect(onDuplicateDarkness).toHaveBeenCalledWith('darkness-1');
    expect(onDeleteDarkness).toHaveBeenCalledWith('darkness-1');
  });
});
