import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GrigliataLightControls, { GrigliataSelectedLightPanel } from './GrigliataLightControls';

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

const light = {
  id: 'light-1',
  label: 'Torch',
  enabled: true,
  x: 140,
  y: 210,
  brightRadiusPx: 280,
  dimRadiusPx: 560,
  color: '#FFAD00',
};

describe('GrigliataLightControls', () => {
  test('renders selected DM light handles with non-listening radius previews', () => {
    render(
      <GrigliataLightControls
        lights={[light]}
        selectedLightId="light-1"
        viewportScale={2}
      />
    );

    expect(screen.getByTestId('light-source-controls')).toBeInTheDocument();
    expect(screen.getByTestId('light-source-bright-radius')).toHaveAttribute('data-listening', 'false');
    expect(screen.getByTestId('light-source-dim-radius')).toHaveAttribute('data-listening', 'false');
    expect(screen.getByTestId('light-source-handle')).toHaveAttribute('data-lightid', 'light-1');
    expect(screen.getByTestId('light-source-handle')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('light-source-handle')).toHaveAttribute('data-enabled', 'true');
  });

  test('selects and starts dragging from the light handle', () => {
    const onSelectLight = jest.fn();
    const onBeginLightDrag = jest.fn();

    render(
      <GrigliataLightControls
        lights={[light]}
        onSelectLight={onSelectLight}
        onBeginLightDrag={onBeginLightDrag}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('light-source-handle'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 210,
    });

    expect(onSelectLight).toHaveBeenCalledWith('light-1');
    expect(onBeginLightDrag).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'light-1' }),
      expect.any(Object)
    );
  });
});

describe('GrigliataSelectedLightPanel', () => {
  test('edits light name, radii, color, enabled state, duplicate, and delete', () => {
    const onUpdateLight = jest.fn();
    const onDuplicateLight = jest.fn();
    const onDeleteLight = jest.fn();

    render(
      <GrigliataSelectedLightPanel
        light={light}
        grid={grid}
        onUpdateLight={onUpdateLight}
        onDuplicateLight={onDuplicateLight}
        onDeleteLight={onDeleteLight}
      />
    );

    const panel = screen.getByTestId('selected-light-panel');
    fireEvent.change(within(panel).getByLabelText(/light name/i), {
      target: { value: 'Lantern' },
    });
    fireEvent.blur(within(panel).getByLabelText(/light name/i));

    fireEvent.click(within(panel).getByRole('checkbox', { name: /light enabled/i }));

    fireEvent.change(within(panel).getByRole('spinbutton', { name: /bright radius in squares/i }), {
      target: { value: '5' },
    });
    fireEvent.blur(within(panel).getByRole('spinbutton', { name: /bright radius in squares/i }));

    fireEvent.change(within(panel).getByRole('spinbutton', { name: /dim radius in squares/i }), {
      target: { value: '9' },
    });
    fireEvent.blur(within(panel).getByRole('spinbutton', { name: /dim radius in squares/i }));

    fireEvent.click(within(panel).getByRole('button', { name: /set light color #ffffff/i }));
    fireEvent.click(within(panel).getByRole('button', { name: /duplicate light/i }));
    fireEvent.click(within(panel).getByRole('button', { name: /delete light/i }));

    expect(onUpdateLight).toHaveBeenCalledWith('light-1', { label: 'Lantern' });
    expect(onUpdateLight).toHaveBeenCalledWith('light-1', { enabled: false });
    expect(onUpdateLight).toHaveBeenCalledWith('light-1', { brightRadiusPx: 350 });
    expect(onUpdateLight).toHaveBeenCalledWith('light-1', { dimRadiusPx: 630 });
    expect(onUpdateLight).toHaveBeenCalledWith('light-1', { color: '#FFFFFF' });
    expect(onDuplicateLight).toHaveBeenCalledWith('light-1');
    expect(onDeleteLight).toHaveBeenCalledWith('light-1');
  });
});
