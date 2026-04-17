import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import GrigliataBoard from './GrigliataBoard';
import {
  FOE_LIBRARY_DRAG_TYPE,
  getGrigliataDrawTheme,
  MAP_PING_BROADCAST_CLEAR_MS,
  MAP_PING_HOLD_DELAY_MS,
  MAP_PING_VISIBLE_MS,
  TRAY_DRAG_MIME,
} from './constants';
import { splitTokenStatusesForDisplay } from './tokenStatuses';

jest.mock('./useImageAsset', () => jest.fn(() => null));
jest.mock('./tokenStatuses', () => ({
  getTokenStatusDefinition: jest.fn(() => null),
  normalizeTokenStatuses: jest.fn((statuses) => (Array.isArray(statuses) ? statuses : [])),
  splitTokenStatusesForDisplay: jest.fn(() => ({
    visibleStatuses: [],
    overflowStatuses: [],
    overflowCount: 0,
  })),
  useTokenStatusIconImages: jest.fn(() => ({})),
}));

jest.mock('react-konva', () => {
  const React = require('react');

  const serializeProp = (value) => {
    if (Array.isArray(value)) return JSON.stringify(value);
    if (value && typeof value === 'object') return JSON.stringify(value);
    return value;
  };

  const createComponent = (displayName, element = 'div', renderTextProp = false) => {
    const Component = React.forwardRef(({ children, text, ...props }, ref) => {
      const domProps = {};

      Object.entries(props).forEach(([key, value]) => {
        if (value == null) {
          return;
        }

        if (typeof value === 'function' && key.startsWith('on')) {
          domProps[key] = (event) => value(buildKonvaEvent(event));
          return;
        }

        if (typeof value === 'function') {
          return;
        }

        const domKey = key.startsWith('data-') ? key : `data-${key.toLowerCase()}`;
        domProps[domKey] = serializeProp(value);
      });

      return React.createElement(
        element,
        {
          ...domProps,
          ref,
          'data-konva-type': displayName,
        },
        renderTextProp ? text : children
      );
    });

    Component.displayName = displayName;
    return Component;
  };

  const Stage = React.forwardRef(({ children, ...props }, ref) => {
    const elementRef = React.useRef(null);
    const domProps = {};

    Object.entries(props).forEach(([key, value]) => {
      if (value == null) {
        return;
      }

      if (typeof value === 'function' && key.startsWith('on')) {
        domProps[key] = (event) => value(buildKonvaEvent(event));
        return;
      }

      if (typeof value === 'function') {
        return;
      }

      const domKey = key.startsWith('data-') ? key : `data-${key.toLowerCase()}`;
      domProps[domKey] = serializeProp(value);
    });

    React.useImperativeHandle(ref, () => {
      if (elementRef.current) {
        elementRef.current.getPointerPosition = () => ({ x: 0, y: 0 });
        return elementRef.current;
      }

      return {
        getPointerPosition: () => ({ x: 0, y: 0 }),
      };
    });

    return (
      <div {...domProps} data-konva-type="Stage" ref={elementRef}>
        {children}
      </div>
    );
  });

  Stage.displayName = 'Stage';

  return {
    Stage,
    Layer: createComponent('Layer'),
    Group: createComponent('Group'),
    Rect: createComponent('Rect'),
    Circle: createComponent('Circle'),
    Line: createComponent('Line'),
    Text: createComponent('Text', 'div', true),
    Image: createComponent('Image'),
  };
});

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

const buildProps = (overrides = {}) => ({
  activeBackground: {
    id: 'map-1',
    name: 'Sunken Ruins',
    grid,
    imageWidth: 0,
    imageHeight: 0,
  },
  grid,
  isGridVisible: true,
  tokens: [],
  aoeFigures: [],
  currentUserId: 'current-user',
  isManager: false,
  isTokenDragActive: false,
  activeTrayDragType: '',
  isRulerEnabled: false,
  activeAoeFigureType: '',
  isInteractionSharingEnabled: false,
  isMusicMuted: false,
  isMusicMutePending: false,
  drawTheme: getGrigliataDrawTheme('aurora-fuchsia'),
  onSelectMouseTool: jest.fn(),
  onToggleRuler: jest.fn(),
  onChangeAoeFigureType: jest.fn(),
  onToggleInteractionSharing: jest.fn(),
  onToggleMusicMuted: jest.fn(),
  onChangeDrawColor: jest.fn(),
  onToggleGridVisibility: null,
  isGridVisibilityToggleDisabled: false,
  onAdjustGridSize: null,
  isGridSizeAdjustmentDisabled: false,
  onMoveTokens: jest.fn(),
  onDeleteTokens: jest.fn(),
  onCreateAoEFigure: jest.fn(),
  onMoveAoEFigure: jest.fn(),
  onDeleteAoEFigures: jest.fn(),
  onSetSelectedTokensVisibility: null,
  isTokenVisibilityActionPending: false,
  onSetSelectedTokensDeadState: null,
  isTokenDeadActionPending: false,
  onUpdateTokenStatuses: jest.fn(),
  isTokenStatusActionPending: false,
  onDropCurrentToken: jest.fn(),
  onSelectedTokenIdsChange: jest.fn(),
  sharedInteractions: [],
  onSharedInteractionChange: jest.fn(),
  ...overrides,
});

const buildKonvaEvent = (event) => {
  const konvaEvent = {
    evt: event,
    target: event.currentTarget,
  };

  Object.defineProperty(konvaEvent, 'cancelBubble', {
    get: () => false,
    set: (value) => {
      if (value) {
        event.stopPropagation();
      }
    },
  });

  return konvaEvent;
};

describe('GrigliataBoard', () => {
  let resizeObserverInstance;
  let getBoundingClientRectSpy;

  beforeEach(() => {
    class MockResizeObserver {
      constructor(callback) {
        this.callback = callback;
        resizeObserverInstance = this;
      }

      observe(target) {
        this.callback([{ target }]);
      }

      disconnect() {}
    }

    global.ResizeObserver = MockResizeObserver;
    getBoundingClientRectSpy = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({
        width: 920,
        height: 640,
        top: 0,
        left: 0,
        right: 920,
        bottom: 640,
      }));

    splitTokenStatusesForDisplay.mockImplementation(() => ({
      visibleStatuses: [],
      overflowStatuses: [],
      overflowCount: 0,
    }));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    resizeObserverInstance = null;
    getBoundingClientRectSpy.mockRestore();
    delete global.ResizeObserver;
  });

  test('renders the interaction sharing toggle and updates its pressed state', () => {
    const onToggleInteractionSharing = jest.fn();
    const { rerender } = render(
      <GrigliataBoard {...buildProps({ onToggleInteractionSharing })} />
    );

    const shareButton = screen.getByRole('button', { name: /share live interactions/i });
    expect(shareButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(shareButton);
    expect(onToggleInteractionSharing).toHaveBeenCalledTimes(1);

    rerender(
      <GrigliataBoard
        {...buildProps({
          isInteractionSharingEnabled: true,
          onToggleInteractionSharing,
        })}
      />
    );

    expect(screen.getByRole('button', { name: /stop sharing live interactions/i })).toHaveAttribute('aria-pressed', 'true');
  });

  test('renders the mouse selection control and updates its pressed state', () => {
    const onSelectMouseTool = jest.fn();
    const { rerender } = render(
      <GrigliataBoard {...buildProps({ onSelectMouseTool })} />
    );

    const mouseSelectionButton = screen.getByTestId('mouse-selection-trigger');
    expect(mouseSelectionButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(mouseSelectionButton);
    expect(onSelectMouseTool).toHaveBeenCalledTimes(1);

    rerender(
      <GrigliataBoard
        {...buildProps({
          isRulerEnabled: true,
          onSelectMouseTool,
        })}
      />
    );

    expect(screen.getByTestId('mouse-selection-trigger')).toHaveAttribute('aria-pressed', 'false');
  });

  test('fires a tray drop only once when the drop lands on the active overlay', () => {
    const onDropCurrentToken = jest.fn();
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'current-user',
          isTokenDragActive: true,
          activeTrayDragType: FOE_LIBRARY_DRAG_TYPE,
          onDropCurrentToken,
        })}
      />
    );

    const overlay = screen.getByTestId('grigliata-board-drop-overlay');
    const payload = JSON.stringify({
      type: FOE_LIBRARY_DRAG_TYPE,
      foeId: 'foe-1',
      ownerUid: 'current-user',
    });
    const dataTransfer = {
      getData: jest.fn((type) => {
        if (type === TRAY_DRAG_MIME || type === 'text/plain') {
          return payload;
        }

        return '';
      }),
      dropEffect: '',
    };

    fireEvent.drop(overlay, {
      clientX: 140,
      clientY: 140,
      dataTransfer,
    });

    expect(onDropCurrentToken).toHaveBeenCalledTimes(1);
    expect(onDropCurrentToken).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FOE_LIBRARY_DRAG_TYPE,
        foeId: 'foe-1',
        ownerUid: 'current-user',
      }),
      expect.any(Object)
    );
  });

  test('renders the quick controls stack in the expected order and keeps reset view available', () => {
    render(<GrigliataBoard {...buildProps()} />);

    const quickControls = screen.getByTestId('grigliata-quick-controls');
    const buttons = within(quickControls).getAllByRole('button');

    expect(buttons).toHaveLength(7);
    expect(buttons[0]).toBe(screen.getByTestId('mouse-selection-trigger'));
    expect(buttons[1]).toBe(screen.getByTestId('draw-color-trigger'));
    expect(buttons[2]).toHaveAttribute('aria-label', 'Enable ruler mode');
    expect(buttons[3]).toHaveAttribute('aria-label', 'Choose an area template');
    expect(buttons[4]).toHaveAttribute('aria-label', 'Share live interactions');
    expect(buttons[5]).toHaveAttribute('aria-label', 'Reset View');
    expect(buttons[6]).toBe(screen.getByTestId('music-mute-trigger'));
    expect(buttons[6]).toHaveAttribute('aria-label', 'Shared music enabled');
    expect(buttons[6]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[6]).toHaveAttribute('title', 'Mute Music');
  });

  test('uses a shared square shell for the left tools and shows the music control as active when shared music is enabled', () => {
    const { rerender } = render(<GrigliataBoard {...buildProps()} />);

    const mouseSelectionButton = screen.getByTestId('mouse-selection-trigger');
    const drawColorTrigger = screen.getByTestId('draw-color-trigger');
    const rulerButton = screen.getByRole('button', { name: /enable ruler mode/i });
    const aoeTrigger = screen.getByTestId('aoe-template-trigger');
    const interactionSharingButton = screen.getByRole('button', { name: /share live interactions/i });
    const resetViewButton = screen.getByRole('button', { name: /reset view/i });
    const musicToggleButton = screen.getByTestId('music-mute-trigger');

    [mouseSelectionButton, rulerButton, aoeTrigger, interactionSharingButton, resetViewButton, musicToggleButton].forEach((button) => {
      expect(button.className).toContain('rounded-2xl');
    });

    expect(drawColorTrigger.className).toContain('rounded-full');
    expect(drawColorTrigger.className).not.toContain('rounded-2xl');

    expect(mouseSelectionButton.className).toContain('bg-gradient-to-br');
    expect(rulerButton.className).not.toContain('bg-gradient-to-br');
    expect(aoeTrigger.className).not.toContain('bg-gradient-to-br');
    expect(interactionSharingButton.className).not.toContain('bg-gradient-to-br');
    expect(resetViewButton.className).not.toContain('bg-gradient-to-br');
    expect(musicToggleButton.className).toContain('bg-gradient-to-br');

    rerender(<GrigliataBoard {...buildProps({ isRulerEnabled: true })} />);

    expect(screen.getByRole('button', { name: /disable ruler mode/i }).className).toContain('bg-gradient-to-br');
    expect(screen.getByTestId('mouse-selection-trigger').className).not.toContain('bg-gradient-to-br');

    rerender(<GrigliataBoard {...buildProps({ activeAoeFigureType: 'circle' })} />);

    expect(screen.getByTestId('aoe-template-trigger').className).toContain('bg-gradient-to-br');

    rerender(<GrigliataBoard {...buildProps({ isInteractionSharingEnabled: true })} />);

    expect(screen.getByRole('button', { name: /stop sharing live interactions/i }).className).not.toContain('bg-gradient-to-br');
    expect(screen.getByRole('button', { name: /reset view/i }).className).not.toContain('bg-gradient-to-br');
    expect(screen.getByTestId('music-mute-trigger').className).toContain('bg-gradient-to-br');

    rerender(<GrigliataBoard {...buildProps({ isMusicMuted: true })} />);

    expect(screen.getByTestId('music-mute-trigger').className).not.toContain('bg-gradient-to-br');
  });

  test('renders the music toggle beneath reset view and exposes state plus action labels', () => {
    const onToggleMusicMuted = jest.fn();
    const { rerender } = render(
      <GrigliataBoard {...buildProps({ onToggleMusicMuted })} />
    );

    const quickControls = screen.getByTestId('grigliata-quick-controls');
    const buttons = within(quickControls).getAllByRole('button');
    const resetViewButton = screen.getByRole('button', { name: /reset view/i });
    const musicToggleButton = screen.getByTestId('music-mute-trigger');

    expect(buttons[5]).toBe(resetViewButton);
    expect(buttons[6]).toBe(musicToggleButton);
  expect(musicToggleButton).toHaveAttribute('aria-label', 'Shared music enabled');
  expect(musicToggleButton).toHaveAttribute('aria-pressed', 'true');
  expect(musicToggleButton).toHaveAttribute('title', 'Mute Music');

    fireEvent.click(musicToggleButton);

    expect(onToggleMusicMuted).toHaveBeenCalledTimes(1);

    rerender(
      <GrigliataBoard
        {...buildProps({
          isMusicMuted: true,
          onToggleMusicMuted,
        })}
      />
    );

    expect(screen.getByTestId('music-mute-trigger')).toHaveAttribute('aria-label', 'Shared music muted');
    expect(screen.getByTestId('music-mute-trigger')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('music-mute-trigger')).toHaveAttribute('title', 'Unmute Music');
  });

  test('disables the music toggle while the mute preference update is pending', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          isMusicMutePending: true,
        })}
      />
    );

    expect(screen.getByTestId('music-mute-trigger')).toBeDisabled();
  });

  test('shows only the map metadata in the top board header', () => {
    render(<GrigliataBoard {...buildProps()} />);

    expect(screen.queryByRole('heading', { name: /grigliata/i })).not.toBeInTheDocument();
    expect(screen.getByText('Sunken Ruins | 70px squares | 5 ft per square')).toBeInTheDocument();
  });

  test('emits selected token ids when the user selects a token', () => {
    const onSelectedTokenIdsChange = jest.fn();
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'foe-token-1',
            id: 'foe-token-1',
            ownerUid: 'user-1',
            label: 'Test One',
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          onSelectedTokenIdsChange,
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-foe-token-1'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });

    expect(onSelectedTokenIdsChange).toHaveBeenLastCalledWith(['foe-token-1']);
  });

  test('does not render the manager controls stack for non-managers', () => {
    render(<GrigliataBoard {...buildProps()} />);

    expect(screen.queryByTestId('grigliata-manager-controls')).not.toBeInTheDocument();
  });

  test('keeps draw colors collapsed until the trigger is opened and emits the selected color', () => {
    const onChangeDrawColor = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({ onChangeDrawColor })}
      />
    );

    const trigger = screen.getByTestId('draw-color-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('draw-color-drawer')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('draw-color-drawer')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('draw-color-option-ion-cyan'));

    expect(onChangeDrawColor).toHaveBeenCalledWith('ion-cyan');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    return waitFor(() => {
      expect(screen.getByTestId('draw-color-drawer')).toHaveStyle({ width: '0px', opacity: '0' });
    });
  });

  test('closes the draw color drawer on escape and outside pointer down', async () => {
    render(<GrigliataBoard {...buildProps()} />);

    const trigger = screen.getByTestId('draw-color-trigger');
    fireEvent.click(trigger);
    expect(screen.getByTestId('draw-color-drawer')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    await waitFor(() => {
      expect(screen.getByTestId('draw-color-drawer')).toHaveStyle({ width: '0px', opacity: '0' });
    });

    fireEvent.click(trigger);
    expect(screen.getByTestId('draw-color-drawer')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(screen.getByTestId('draw-color-drawer')).toHaveStyle({ width: '0px', opacity: '0' });
    });
  });

  test('renders the manager controls stack on the right in the expected order', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          onToggleGridVisibility: jest.fn(),
          onAdjustGridSize: jest.fn(),
        })}
      />
    );

    const managerControls = screen.getByTestId('grigliata-manager-controls');
    const buttons = within(managerControls).getAllByRole('button');

    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAttribute('aria-label', 'Hide Grid');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveAttribute('title', 'Increase square size');
    expect(buttons[2]).toHaveAttribute('title', 'Decrease square size');
  });

  test('updates the manager grid control labels and disabled states', () => {
    const onToggleGridVisibility = jest.fn();
    const onAdjustGridSize = jest.fn();
    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          isGridVisible: true,
          onToggleGridVisibility,
          onAdjustGridSize,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /hide grid/i }));
    expect(onToggleGridVisibility).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /increase square size/i }));
    fireEvent.click(screen.getByRole('button', { name: /decrease square size/i }));
    expect(onAdjustGridSize).toHaveBeenNthCalledWith(1, 1);
    expect(onAdjustGridSize).toHaveBeenNthCalledWith(2, -1);

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          isGridVisible: false,
          isGridVisibilityToggleDisabled: true,
          isGridSizeAdjustmentDisabled: true,
          onToggleGridVisibility,
          onAdjustGridSize,
        })}
      />
    );

    expect(screen.getByRole('button', { name: /show grid/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /show grid/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /increase square size/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /decrease square size/i })).toBeDisabled();
  });

  test('renders a remote shared ruler with the broadcaster color', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          sharedInteractions: [{
            backgroundId: 'map-1',
            ownerUid: 'other-user',
            type: 'measure',
            source: 'free',
            colorKey: 'ion-cyan',
            anchorCells: [{ col: 1, row: 1 }],
            liveEndCell: { col: 3, row: 1 },
            updatedAt: { toMillis: () => Date.now() },
            updatedBy: 'other-user',
          }],
        })}
      />
    );

    expect(screen.getByTestId('measurement-overlay-shared-other-user')).toBeInTheDocument();
    expect(screen.getByText('10 ft (2 squares)')).toBeInTheDocument();
    expect(document.querySelector('[data-stroke="#38bdf8"]')).not.toBeNull();
  });

  test('renders a remote shared ping with the broadcaster color and lets it expire locally', () => {
    jest.useFakeTimers();
    const startedAtMs = Date.now();

    render(
      <GrigliataBoard
        {...buildProps({
          sharedInteractions: [{
            backgroundId: 'map-1',
            ownerUid: 'other-user',
            type: 'ping',
            source: 'free',
            colorKey: 'ion-cyan',
            point: { x: 280, y: 210 },
            startedAtMs,
            updatedAt: { toMillis: () => startedAtMs + 30 },
            updatedBy: 'other-user',
          }],
        })}
      />
    );

    expect(screen.getByTestId('map-ping-overlay-shared-other-user')).toBeInTheDocument();
    expect(document.querySelector('[data-stroke="#38bdf8"]')).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(MAP_PING_VISIBLE_MS + 64);
    });

    expect(screen.queryByTestId('map-ping-overlay-shared-other-user')).not.toBeInTheDocument();
  });

  test('does not duplicate the current user shared interaction as a remote overlay', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          sharedInteractions: [{
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            type: 'measure',
            source: 'free',
            colorKey: 'ion-cyan',
            anchorCells: [{ col: 1, row: 1 }],
            liveEndCell: { col: 3, row: 1 },
            updatedAt: { toMillis: () => Date.now() },
            updatedBy: 'current-user',
          }],
        })}
      />
    );

    expect(screen.queryByTestId('measurement-overlay-shared-current-user')).not.toBeInTheDocument();
    expect(screen.queryByText('10 ft (2 squares)')).not.toBeInTheDocument();
  });

  test('emits a local and shared ping after a long press on empty map space even when sharing is disabled', () => {
    jest.useFakeTimers();
    const onSharedInteractionChange = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({
          onSharedInteractionChange,
        })}
      />
    );

    onSharedInteractionChange.mockClear();

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 260, clientY: 220, buttons: 1 });

    act(() => {
      jest.advanceTimersByTime(MAP_PING_HOLD_DELAY_MS);
    });

    expect(document.querySelectorAll('[data-testid^="map-ping-overlay-local-ping-"]')).toHaveLength(1);
    expect(onSharedInteractionChange).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ping',
      source: 'free',
      point: expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
      startedAtMs: expect.any(Number),
    }));

    fireEvent.mouseUp(window, { button: 0, clientX: 260, clientY: 220, buttons: 0 });

    act(() => {
      jest.advanceTimersByTime(MAP_PING_VISIBLE_MS + 64);
    });

    expect(document.querySelectorAll('[data-testid^="map-ping-overlay-local-ping-"]')).toHaveLength(0);

    act(() => {
      jest.advanceTimersByTime(MAP_PING_BROADCAST_CLEAR_MS - MAP_PING_VISIBLE_MS + 64);
    });

    expect(onSharedInteractionChange).toHaveBeenLastCalledWith(null);
  });

  test('cancels the long-press ping when the pointer moves into a selection drag', () => {
    jest.useFakeTimers();
    const onSharedInteractionChange = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({
          isInteractionSharingEnabled: true,
          onSharedInteractionChange,
        })}
      />
    );

    onSharedInteractionChange.mockClear();

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 240, clientY: 210, buttons: 1 });
    fireEvent.mouseMove(window, { clientX: 290, clientY: 260, buttons: 1 });

    act(() => {
      jest.advanceTimersByTime(MAP_PING_HOLD_DELAY_MS + 80);
    });

    fireEvent.mouseUp(window, { button: 0, clientX: 290, clientY: 260, buttons: 0 });

    expect(document.querySelectorAll('[data-testid^="map-ping-overlay-local-ping-"]')).toHaveLength(0);
    expect(onSharedInteractionChange.mock.calls.find(([interaction]) => interaction?.type === 'ping')).toBeUndefined();
  });

  test('does not emit a ping while ruler mode is active', () => {
    jest.useFakeTimers();
    const onSharedInteractionChange = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({
          isInteractionSharingEnabled: true,
          isRulerEnabled: true,
          onSharedInteractionChange,
        })}
      />
    );

    onSharedInteractionChange.mockClear();

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 280, clientY: 210, buttons: 1 });

    act(() => {
      jest.advanceTimersByTime(MAP_PING_HOLD_DELAY_MS + 80);
    });

    fireEvent.mouseUp(window, { button: 0, clientX: 280, clientY: 210, buttons: 0 });

    expect(document.querySelectorAll('[data-testid^="map-ping-overlay-local-ping-"]')).toHaveLength(0);
    expect(onSharedInteractionChange.mock.calls.find(([interaction]) => interaction?.type === 'ping')).toBeUndefined();
  });

  test('does not emit a ping while the AoE tool is active or when holding an AoE figure', () => {
    jest.useFakeTimers();
    const onSharedInteractionChange = jest.fn();
    const figureId = 'map-1__current-user__circle__1';

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isInteractionSharingEnabled: true,
          onSharedInteractionChange,
          aoeFigures: [{
            id: figureId,
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'circle',
            slot: 1,
            originCell: { col: 4, row: 2 },
            targetCell: { col: 5, row: 2 },
            colorKey: 'ion-cyan',
            isVisibleToPlayers: true,
          }],
        })}
      />
    );

    onSharedInteractionChange.mockClear();

    const stage = document.querySelector('[data-konva-type="Stage"]');
    rerender(
      <GrigliataBoard
        {...buildProps({
          isInteractionSharingEnabled: true,
          onSharedInteractionChange,
          activeAoeFigureType: 'circle',
          aoeFigures: [{
            id: figureId,
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'circle',
            slot: 1,
            originCell: { col: 4, row: 2 },
            targetCell: { col: 5, row: 2 },
            colorKey: 'ion-cyan',
            isVisibleToPlayers: true,
          }],
        })}
      />
    );

    fireEvent.mouseDown(stage, {
      button: 0,
      clientX: 315,
      clientY: 175,
      buttons: 1,
    });

    act(() => {
      jest.advanceTimersByTime(MAP_PING_HOLD_DELAY_MS + 80);
    });

    fireEvent.mouseUp(window, { button: 0, clientX: 315, clientY: 175, buttons: 0 });

    onSharedInteractionChange.mockClear();
    rerender(
      <GrigliataBoard
        {...buildProps({
          isInteractionSharingEnabled: true,
          onSharedInteractionChange,
          aoeFigures: [{
            id: figureId,
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'circle',
            slot: 1,
            originCell: { col: 4, row: 2 },
            targetCell: { col: 5, row: 2 },
            colorKey: 'ion-cyan',
            isVisibleToPlayers: true,
          }],
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-overlay-${figureId}`), {
      button: 0,
      clientX: 315,
      clientY: 175,
      buttons: 1,
    });

    act(() => {
      jest.advanceTimersByTime(MAP_PING_HOLD_DELAY_MS + 80);
    });

    fireEvent.mouseUp(window, { button: 0, clientX: 315, clientY: 175, buttons: 0 });

    expect(document.querySelectorAll('[data-testid^="map-ping-overlay-local-ping-"]')).toHaveLength(0);
    expect(onSharedInteractionChange.mock.calls.find(([interaction]) => interaction?.type === 'ping')).toBeUndefined();
  });

  test('opens the AoE template drawer and emits the selected template type', () => {
    const onChangeAoeFigureType = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({ onChangeAoeFigureType })}
      />
    );

    const trigger = screen.getByTestId('aoe-template-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('aoe-template-drawer')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByTestId('aoe-template-drawer')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('aoe-template-option-circle'));
    expect(onChangeAoeFigureType).toHaveBeenCalledWith('circle');
  });

  test('renders a local AoE preview and creates the figure on mouseup', async () => {
    const onCreateAoEFigure = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          activeAoeFigureType: 'circle',
          onCreateAoEFigure,
        })}
      />
    );

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseMove(window, { clientX: 280, clientY: 140, buttons: 1 });

    expect(screen.getByTestId('aoe-figure-overlay-local')).toBeInTheDocument();
    expect(screen.getByTestId('aoe-figure-measurement-local')).toHaveTextContent('R 30 ft • D 60 ft');

    fireEvent.mouseUp(window, { button: 0, clientX: 280, clientY: 140, buttons: 0 });

    await waitFor(() => {
      expect(onCreateAoEFigure).toHaveBeenCalledWith(expect.objectContaining({
        figureType: 'circle',
        originCell: expect.objectContaining({
          col: expect.any(Number),
          row: expect.any(Number),
        }),
        targetCell: expect.objectContaining({
          col: expect.any(Number),
          row: expect.any(Number),
        }),
      }));
    });
  });

  test('returns to mouse selection after a successful AoE placement', async () => {
    const onCreateAoEFigure = jest.fn(() => Promise.resolve(true));
    const onSelectMouseTool = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({
          activeAoeFigureType: 'circle',
          onCreateAoEFigure,
          onSelectMouseTool,
        })}
      />
    );

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseMove(window, { clientX: 280, clientY: 140, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 280, clientY: 140, buttons: 0 });

    await waitFor(() => {
      expect(onCreateAoEFigure).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(onSelectMouseTool).toHaveBeenCalledTimes(1);
    });
  });

  test('keeps the AoE tool active after an unsuccessful AoE placement', async () => {
    const onCreateAoEFigure = jest.fn(() => Promise.resolve(false));
    const onSelectMouseTool = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({
          activeAoeFigureType: 'circle',
          onCreateAoEFigure,
          onSelectMouseTool,
        })}
      />
    );

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseMove(window, { clientX: 280, clientY: 140, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 280, clientY: 140, buttons: 0 });

    await waitFor(() => {
      expect(onCreateAoEFigure).toHaveBeenCalledTimes(1);
    });

    expect(onSelectMouseTool).not.toHaveBeenCalled();
  });

  test('renders measurement badges for placed AoE figures', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          aoeFigures: [{
            id: 'map-1__current-user__circle__1',
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'circle',
            slot: 1,
            originCell: { col: 2, row: 2 },
            targetCell: { col: 5, row: 2 },
            colorKey: 'ion-cyan',
            isVisibleToPlayers: true,
          }, {
            id: 'map-1__current-user__square__1',
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'square',
            slot: 1,
            originCell: { col: 4, row: 4 },
            targetCell: { col: 6, row: 6 },
            colorKey: 'nova-teal',
            isVisibleToPlayers: true,
          }, {
            id: 'map-1__current-user__cone__1',
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'cone',
            slot: 1,
            originCell: { col: 8, row: 3 },
            targetCell: { col: 11, row: 3 },
            colorKey: 'solar-amber',
            isVisibleToPlayers: true,
          }],
        })}
      />
    );

    expect(screen.getByTestId('aoe-figure-measurement-map-1__current-user__circle__1')).toBeInTheDocument();
    expect(screen.getByText('R 20 ft • D 40 ft')).toBeInTheDocument();
    expect(screen.getByText('15 ft side')).toBeInTheDocument();
    expect(screen.getByText('L 20 ft • W 20 ft • 53°')).toBeInTheDocument();
  });

  test('renders a remote shared AoE preview with the broadcaster color', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          sharedInteractions: [{
            backgroundId: 'map-1',
            ownerUid: 'other-user',
            type: 'aoe',
            source: 'aoe-create',
            colorKey: 'volt-lime',
            figureType: 'square',
            originCell: { col: 1, row: 1 },
            targetCell: { col: 2, row: 2 },
            updatedAt: { toMillis: () => Date.now() },
            updatedBy: 'other-user',
          }],
        })}
      />
    );

    expect(screen.getByTestId('aoe-figure-overlay-shared-other-user')).toBeInTheDocument();
    expect(screen.getByTestId('aoe-figure-measurement-shared-other-user')).toBeInTheDocument();
    expect(screen.getByText('10 ft side')).toBeInTheDocument();
    expect(document.querySelector('[data-stroke="#a3e635"]')).not.toBeNull();
  });

  test('selects an editable AoE figure and deletes it from the red bin action', async () => {
    const onDeleteAoEFigures = jest.fn(() => Promise.resolve());
    const figureId = 'map-1__current-user__circle__1';

    render(
      <GrigliataBoard
        {...buildProps({
          aoeFigures: [{
            id: figureId,
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'circle',
            slot: 1,
            originCell: { col: 2, row: 2 },
            targetCell: { col: 3, row: 2 },
            colorKey: 'ion-cyan',
            isVisibleToPlayers: true,
          }],
          onDeleteAoEFigures,
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-overlay-${figureId}`), {
      button: 0,
      clientX: 175,
      clientY: 175,
      buttons: 1,
    });
    fireEvent.mouseUp(window, { button: 0, clientX: 175, clientY: 175, buttons: 0 });

    fireEvent.click(screen.getByRole('button', { name: /delete selected aoe figure/i }));

    await waitFor(() => {
      expect(onDeleteAoEFigures).toHaveBeenCalledWith([figureId]);
    });
  });

  test('moves an editable AoE figure when dragged', async () => {
    const onMoveAoEFigure = jest.fn(() => Promise.resolve());
    const figureId = 'map-1__current-user__square__1';

    render(
      <GrigliataBoard
        {...buildProps({
          aoeFigures: [{
            id: figureId,
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'square',
            slot: 1,
            originCell: { col: 2, row: 2 },
            targetCell: { col: 3, row: 3 },
            colorKey: 'nova-teal',
            isVisibleToPlayers: true,
          }],
          onMoveAoEFigure,
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-overlay-${figureId}`), {
      button: 0,
      clientX: 175,
      clientY: 175,
      buttons: 1,
    });
    fireEvent.mouseMove(window, { clientX: 245, clientY: 175, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 245, clientY: 175, buttons: 0 });

    await waitFor(() => {
      expect(onMoveAoEFigure).toHaveBeenCalledWith(figureId, expect.objectContaining({
        figureType: 'square',
        originCell: expect.objectContaining({
          col: expect.any(Number),
          row: expect.any(Number),
        }),
        targetCell: expect.objectContaining({
          col: expect.any(Number),
          row: expect.any(Number),
        }),
      }));
    });
  });

  test('deletes a selected AoE figure when Delete is pressed', async () => {
    const onDeleteAoEFigures = jest.fn(() => Promise.resolve());
    const figureId = 'map-1__current-user__cone__1';

    render(
      <GrigliataBoard
        {...buildProps({
          aoeFigures: [{
            id: figureId,
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'cone',
            slot: 1,
            originCell: { col: 2, row: 2 },
            targetCell: { col: 4, row: 2 },
            colorKey: 'solar-amber',
            isVisibleToPlayers: true,
          }],
          onDeleteAoEFigures,
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-overlay-${figureId}`), {
      button: 0,
      clientX: 175,
      clientY: 175,
      buttons: 1,
    });
    fireEvent.mouseUp(window, { button: 0, clientX: 175, clientY: 175, buttons: 0 });
    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });

    await waitFor(() => {
      expect(onDeleteAoEFigures).toHaveBeenCalledWith([figureId]);
    });
  });

  test('does not expose the delete action for a non-editable visible AoE figure', () => {
    const figureId = 'map-1__other-user__circle__1';

    render(
      <GrigliataBoard
        {...buildProps({
          aoeFigures: [{
            id: figureId,
            backgroundId: 'map-1',
            ownerUid: 'other-user',
            figureType: 'circle',
            slot: 1,
            originCell: { col: 2, row: 2 },
            targetCell: { col: 3, row: 2 },
            colorKey: 'ion-cyan',
            isVisibleToPlayers: true,
          }],
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-overlay-${figureId}`), {
      button: 0,
      clientX: 175,
      clientY: 175,
      buttons: 1,
    });
    fireEvent.mouseUp(window, { button: 0, clientX: 175, clientY: 175, buttons: 0 });

    expect(screen.queryByRole('button', { name: /delete selected aoe figure/i })).not.toBeInTheDocument();
  });
});
