import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useReducedMotion } from 'framer-motion';
import GrigliataBoard, {
  buildAoEFigureMeasurementDecorationLayout,
  buildZoomNormalizedOverlayMetrics,
  getAoEFigureMeasurementTextLines,
} from './GrigliataBoard';
import {
  FOE_LIBRARY_DRAG_TYPE,
  getGrigliataDrawTheme,
  MAP_PING_BROADCAST_CLEAR_MS,
  MAP_PING_HOLD_DELAY_MS,
  MAP_PING_VISIBLE_MS,
  TRAY_DRAG_MIME,
} from './constants';
import { buildRenderableGrigliataAoEFigure } from './aoeFigures';
import { splitTokenStatusesForDisplay } from './tokenStatuses';
import useImageAsset, { useImageAssetSnapshot } from './useImageAsset';

const MAP_PING_EPIC_ACCENT = '#f97316';

jest.mock('framer-motion', () => {
  const actual = jest.requireActual('framer-motion');

  return {
    ...actual,
    useReducedMotion: jest.fn(() => false),
  };
});

jest.mock('./useImageAsset', () => ({
  __esModule: true,
  default: jest.fn(() => null),
  useImageAssetSnapshot: jest.fn(() => ({
    status: 'idle',
    image: null,
    error: null,
  })),
}));
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
  combatBackgroundName: '',
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
  onDeactivateActiveBackground: null,
  isDeactivateActiveBackgroundDisabled: false,
  isTurnOrderEnabled: true,
  turnOrderEntries: [],
  isTurnOrderStarted: false,
  activeTurnTokenId: '',
  onStartTurnOrder: jest.fn(),
  onAdvanceTurnOrder: jest.fn(),
  isTurnOrderProgressPending: false,
  onResetTurnOrder: null,
  isTurnOrderResetPending: false,
  onJoinTurnOrder: jest.fn(),
  onLeaveTurnOrder: jest.fn(),
  turnOrderActionTokenId: '',
  onSaveTurnOrderInitiative: jest.fn(),
  savingTurnOrderInitiativeTokenId: '',
  onAdjustGridSize: null,
  isGridSizeAdjustmentDisabled: false,
  onMoveTokens: jest.fn(),
  onDeleteTokens: jest.fn(),
  onCreateAoEFigure: jest.fn(),
  onMoveAoEFigure: jest.fn(),
  onUpdateAoEFigurePresentation: jest.fn(),
  onDeleteAoEFigures: jest.fn(),
  onSetSelectedTokensVisibility: null,
  isTokenVisibilityActionPending: false,
  onSetSelectedTokensDeadState: null,
  isTokenDeadActionPending: false,
  onUpdateTokenStatuses: jest.fn(),
  isTokenStatusActionPending: false,
  selectedTokenDetails: null,
  onDropCurrentToken: jest.fn(),
  onSelectedTokenIdsChange: jest.fn(),
  sharedInteractions: [],
  onSharedInteractionChange: jest.fn(),
  isNarrationOverlayActive: false,
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

describe('GrigliataBoard helpers', () => {
  test('normalizes overlay chrome against zoom', () => {
    const nearMetrics = buildZoomNormalizedOverlayMetrics(1);
    const farMetrics = buildZoomNormalizedOverlayMetrics(2);

    expect(farMetrics.rulerStrokeWidth).toBeCloseTo(nearMetrics.rulerStrokeWidth / 2);
    expect(farMetrics.aoePrimaryFontSize).toBeCloseTo(nearMetrics.aoePrimaryFontSize / 2);
  });

  test('formats rectangle measurement text lines', () => {
    expect(getAoEFigureMeasurementTextLines({
      figureType: 'rectangle',
      widthSquares: 3,
      heightSquares: 2,
      measurement: {
        widthFeet: 15,
        heightFeet: 10,
      },
    })).toEqual({
      primary: '15 x 10 ft',
      secondary: '3 x 2 sq',
    });
  });

  test('builds internal measurement decoration layouts for every AoE figure type', () => {
    ['circle', 'square', 'cone', 'rectangle'].forEach((figureType) => {
      const renderableFigure = buildRenderableGrigliataAoEFigure({
        figure: (
          figureType === 'rectangle'
            ? {
                figureType,
                originCell: { col: 1, row: 1 },
                targetCell: { col: 3, row: 2 },
              }
            : {
                figureType,
                originCell: { col: 2, row: 2 },
                targetCell: { col: 5, row: 4 },
              }
        ),
        grid,
      });

      const layout = buildAoEFigureMeasurementDecorationLayout({
        figure: renderableFigure,
        viewportScale: 1,
      });

      expect(layout).toEqual(expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
        badgeX: expect.any(Number),
        badgeY: expect.any(Number),
        arrowPoints: expect.any(Array),
        arrowHeadPoints: expect.any(Array),
      }));
      expect(layout.lines.primary).toMatch(/ft$/);
      expect(layout.lines.secondary).toMatch(/sq$/);
    });
  });

  test('keeps the measurement arrow extending past the badge toward the border', () => {
    const circleFigure = buildRenderableGrigliataAoEFigure({
      figure: {
        figureType: 'circle',
        originCell: { col: 2, row: 2 },
        targetCell: { col: 5, row: 2 },
      },
      grid,
    });
    const circleLayout = buildAoEFigureMeasurementDecorationLayout({
      figure: circleFigure,
      viewportScale: 1,
    });

    expect(circleLayout.arrowPoints[2]).toBeGreaterThan(circleLayout.badgeX + circleLayout.width);

    const coneFigure = buildRenderableGrigliataAoEFigure({
      figure: {
        figureType: 'cone',
        originCell: { col: 2, row: 2 },
        targetCell: { col: 5, row: 4 },
      },
      grid,
    });
    const coneLayout = buildAoEFigureMeasurementDecorationLayout({
      figure: coneFigure,
      viewportScale: 1,
    });

    expect(coneLayout.arrowPoints[2]).toBeGreaterThan(coneLayout.badgeX);
    expect(coneLayout.arrowPoints[3]).toBeGreaterThan(coneLayout.badgeY + (coneLayout.height * 0.4));
  });
});

describe('GrigliataBoard', () => {
  const mockBattlemapImage = {
    width: 1280,
    height: 720,
    naturalWidth: 1280,
    naturalHeight: 720,
  };
  const mockAlternateBattlemapImage = {
    width: 1920,
    height: 1080,
    naturalWidth: 1920,
    naturalHeight: 1080,
  };
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  let resizeObserverInstance;
  let getBoundingClientRectSpy;

  beforeEach(() => {
    window.localStorage.clear();
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
    useReducedMotion.mockReturnValue(false);
    useImageAsset.mockImplementation(() => null);
    useImageAssetSnapshot.mockImplementation(() => ({
      status: 'loaded',
      image: mockBattlemapImage,
      error: null,
    }));
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 16);
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    resizeObserverInstance = null;
    getBoundingClientRectSpy.mockRestore();
    delete global.ResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test('fades in the battlemap image when activating from grid only', async () => {
    jest.useFakeTimers();

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: null,
        })}
      />
    );

    expect(screen.queryByTestId('battlemap-image-active')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-1',
            name: 'Sunken Ruins',
            imageUrl: 'https://example.com/map-1.png',
            imageWidth: 1280,
            imageHeight: 720,
          },
        })}
      />
    );

    const activeImage = await screen.findByTestId('battlemap-image-active');
    expect(activeImage).toHaveAttribute('data-opacity', '0');

    await act(async () => {
      jest.advanceTimersByTime(240);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();
  });

  test('keeps the old battlemap briefly while fading it out on deactivation', async () => {
    jest.useFakeTimers();

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-1',
            name: 'Sunken Ruins',
            imageUrl: 'https://example.com/map-1.png',
            imageWidth: 1280,
            imageHeight: 720,
          },
        })}
      />
    );

    await act(async () => {
      jest.advanceTimersByTime(240);
    });

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeBackground: null,
        })}
      />
    );

    expect(screen.getByTestId('battlemap-image-outgoing')).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(240);
    });

    expect(screen.queryByTestId('battlemap-image-active')).not.toBeInTheDocument();
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();
  });

  test('crossfades between the current and next battlemap image', async () => {
    jest.useFakeTimers();

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-1',
            name: 'Sunken Ruins',
            imageUrl: 'https://example.com/map-1.png',
            imageWidth: 1280,
            imageHeight: 720,
          },
        })}
      />
    );

    await act(async () => {
      jest.advanceTimersByTime(240);
    });

    useImageAssetSnapshot.mockImplementation(() => ({
      status: 'loaded',
      image: mockAlternateBattlemapImage,
      error: null,
    }));

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-2',
            name: 'Iron Keep',
            imageUrl: 'https://example.com/map-2.png',
            imageWidth: 1920,
            imageHeight: 1080,
          },
        })}
      />
    );

    expect(screen.getByTestId('battlemap-image-active')).toBeInTheDocument();
    expect(screen.getByTestId('battlemap-image-outgoing')).toBeInTheDocument();
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1920');
    expect(screen.getByTestId('battlemap-image-outgoing')).toHaveAttribute('data-width', '1280');

    await act(async () => {
      jest.advanceTimersByTime(240);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1920');
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();
  });

  test('swaps to the narration battlemap immediately without showing the combat map underneath', async () => {
    jest.useFakeTimers();

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-1',
            name: 'Sunken Ruins',
            imageUrl: 'https://example.com/map-1.png',
            imageWidth: 1280,
            imageHeight: 720,
          },
        })}
      />
    );

    await act(async () => {
      jest.advanceTimersByTime(240);
    });

    useImageAssetSnapshot.mockImplementation(() => ({
      status: 'loaded',
      image: mockAlternateBattlemapImage,
      error: null,
    }));

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-2',
            name: 'Iron Keep',
            imageUrl: 'https://example.com/map-2.png',
            imageWidth: 1920,
            imageHeight: 1080,
          },
          combatBackgroundName: 'Sunken Ruins',
          isNarrationOverlayActive: true,
        })}
      />
    );

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1920');
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();
  });

  test('hides the combat battlemap while the narration image is still loading', async () => {
    jest.useFakeTimers();

    useImageAssetSnapshot.mockImplementation((src) => {
      if (src === 'https://example.com/map-1.png') {
        return {
          status: 'loaded',
          image: mockBattlemapImage,
          error: null,
        };
      }

      if (src === 'https://example.com/map-2.png') {
        return {
          status: 'loading',
          image: null,
          error: null,
        };
      }

      return {
        status: 'idle',
        image: null,
        error: null,
      };
    });

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-1',
            name: 'Sunken Ruins',
            imageUrl: 'https://example.com/map-1.png',
            imageWidth: 1280,
            imageHeight: 720,
          },
        })}
      />
    );

    await act(async () => {
      jest.advanceTimersByTime(240);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1280');

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-2',
            name: 'Iron Keep',
            imageUrl: 'https://example.com/map-2.png',
            imageWidth: 1920,
            imageHeight: 1080,
          },
          combatBackgroundName: 'Sunken Ruins',
          isNarrationOverlayActive: true,
        })}
      />
    );

    expect(screen.queryByTestId('battlemap-image-active')).not.toBeInTheDocument();
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();

    useImageAssetSnapshot.mockImplementation((src) => {
      if (src === 'https://example.com/map-1.png') {
        return {
          status: 'loaded',
          image: mockBattlemapImage,
          error: null,
        };
      }

      if (src === 'https://example.com/map-2.png') {
        return {
          status: 'loaded',
          image: mockAlternateBattlemapImage,
          error: null,
        };
      }

      return {
        status: 'idle',
        image: null,
        error: null,
      };
    });

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-2',
            name: 'Iron Keep',
            imageUrl: 'https://example.com/map-2.png',
            imageWidth: 1920,
            imageHeight: 1080,
          },
          combatBackgroundName: 'Sunken Ruins',
          isNarrationOverlayActive: true,
        })}
      />
    );

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1920');
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();
  });

  test('swaps the battlemap image immediately when reduced motion is enabled', () => {
    jest.useFakeTimers();
    useReducedMotion.mockReturnValue(true);
    useImageAssetSnapshot.mockImplementation(() => ({
      status: 'loaded',
      image: mockAlternateBattlemapImage,
      error: null,
    }));

    render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-2',
            name: 'Iron Keep',
            imageUrl: 'https://example.com/map-2.png',
            imageWidth: 1920,
            imageHeight: 1080,
          },
        })}
      />
    );

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();
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

  test('zooms the battlemap three times faster on mouse wheel input', () => {
    const expectedScaleBy = 1.08 ** 3;

    const { container } = render(
      <GrigliataBoard {...buildProps()} />
    );

    const stage = container.querySelector('[data-konva-type="Stage"]');
    expect(stage).toBeTruthy();
    const initialScale = Number.parseFloat(stage.getAttribute('data-scalex') || '1');
    expect(initialScale).toBeGreaterThan(0);

    fireEvent.wheel(stage, { deltaY: -120 });

    expect(Number.parseFloat(stage.getAttribute('data-scalex') || '1')).toBeCloseTo(initialScale * expectedScaleBy, 5);
    expect(Number.parseFloat(stage.getAttribute('data-scaley') || '1')).toBeCloseTo(initialScale * expectedScaleBy, 5);
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

  test('shows the single-token resource hud for selected character tokens', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          selectedTokenDetails: {
            tokenId: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            imageUrl: '',
            notes: 'Front line',
            hpCurrent: 14,
            hpTotal: 18,
            manaCurrent: 7,
            manaTotal: 12,
            shieldCurrent: 3,
            shieldTotal: 6,
            hasShield: true,
          },
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });

    expect(await screen.findByTestId('selected-token-resource-hud')).toBeInTheDocument();
    expect(within(screen.getByTestId('selected-token-resource-chip-hp')).getByText('14')).toBeInTheDocument();
    expect(within(screen.getByTestId('selected-token-resource-chip-mana')).getByText('7')).toBeInTheDocument();
    expect(within(screen.getByTestId('selected-token-resource-chip-shield')).getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/^HP\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Mana\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Shield\b/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('selected-token-notes-preview')).not.toBeInTheDocument();
  });

  test('shows hp and mana only in the foe resource hud', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'foe-token-1',
            id: 'foe-token-1',
            ownerUid: 'user-1',
            tokenType: 'foe',
            label: 'Test One',
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          selectedTokenDetails: {
            tokenId: 'foe-token-1',
            ownerUid: 'user-1',
            tokenType: 'foe',
            label: 'Test One',
            imageUrl: '',
            notes: 'Alpha',
            hpCurrent: 42,
            manaCurrent: 9,
            hasShield: false,
          },
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-foe-token-1'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });

    expect(within(await screen.findByTestId('selected-token-resource-chip-hp')).getByText('42')).toBeInTheDocument();
    expect(within(screen.getByTestId('selected-token-resource-chip-mana')).getByText('9')).toBeInTheDocument();
    expect(screen.queryByText(/Shield /i)).not.toBeInTheDocument();
  });

  test('hides the resource hud when multiple tokens are selected via box select', async () => {
    const { container } = render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }, {
            tokenId: 'token-2',
            id: 'token-2',
            ownerUid: 'user-1',
            tokenType: 'custom',
            label: 'Wolf',
            imageUrl: '',
            placed: true,
            col: 3,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          selectedTokenDetails: {
            tokenId: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            hpCurrent: 14,
            manaCurrent: 7,
            shieldCurrent: 3,
            hasShield: true,
            notes: 'Front line',
          },
        })}
      />
    );

    const stage = container.querySelector('[data-konva-type="Stage"]');

    fireEvent.mouseDown(stage, {
      button: 0,
      buttons: 1,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      clientX: 900,
      clientY: 600,
    });
    fireEvent.mouseUp(window, {
      button: 0,
      buttons: 1,
      clientX: 900,
      clientY: 600,
    });

    await waitFor(() => {
      expect(screen.queryByTestId('selected-token-resource-hud')).not.toBeInTheDocument();
    });
  });

  test('does not render any board-side notes block even when the token has notes', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          selectedTokenDetails: {
            tokenId: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            imageUrl: '',
            notes: 'Front line',
            hpCurrent: 14,
            manaCurrent: 7,
            shieldCurrent: 3,
            hasShield: true,
          },
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });

    expect(await screen.findByTestId('selected-token-resource-hud')).toBeInTheDocument();
    expect(screen.queryByTestId('selected-token-notes-preview')).not.toBeInTheDocument();
  });

  test('positions the selected token chip cluster below the token near the top-right edge', async () => {
    const { container } = render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            imageUrl: '',
            placed: true,
            col: 10,
            row: 1,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          selectedTokenDetails: {
            tokenId: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            imageUrl: '',
            notes: 'Front line',
            hpCurrent: 34,
            manaCurrent: 10,
            shieldCurrent: 0,
            hasShield: true,
          },
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 720,
      clientY: 80,
    });

    const chipCluster = await screen.findByTestId('selected-token-resource-chip-cluster');
    const stage = container.querySelector('[data-konva-type="Stage"]');
    const tokenNode = screen.getByTestId('token-node-user-1');

    expect(stage).toBeTruthy();
    expect(chipCluster.style.gridTemplateColumns).toContain('repeat(3');

    const viewportTop = Number.parseFloat(stage.getAttribute('data-y') || '0');
    const viewportScale = Number.parseFloat(stage.getAttribute('data-scaley') || '1');
    const tokenWorldTop = Number.parseFloat(tokenNode.getAttribute('data-y') || '0');
    const tokenScreenTop = viewportTop + (tokenWorldTop * viewportScale);
    const tokenScreenSize = 70 * viewportScale;
    const chipTop = Number.parseFloat(chipCluster.style.top);

    expect(chipTop).toBeGreaterThanOrEqual((tokenScreenTop + tokenScreenSize) - 0.5);
    expect(within(screen.getByTestId('selected-token-resource-chip-shield')).getByText('0')).toBeInTheDocument();
    expect(screen.queryByTestId('selected-token-notes-preview')).not.toBeInTheDocument();
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
    const onDeactivateActiveBackground = jest.fn();
    const onStartTurnOrder = jest.fn();
    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          onToggleGridVisibility: jest.fn(),
          onDeactivateActiveBackground,
          onStartTurnOrder,
          onResetTurnOrder: jest.fn(),
          onAdjustGridSize: jest.fn(),
        })}
      />
    );

    const managerControls = screen.getByTestId('grigliata-manager-controls');
    const buttons = within(managerControls).getAllByRole('button');

    expect(buttons).toHaveLength(6);
    expect(buttons[0]).toHaveAttribute('aria-label', 'Hide Grid');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveAttribute('aria-label', 'Deactivate active map');
    expect(buttons[2]).toHaveAttribute('title', 'Increase square size');
    expect(buttons[3]).toHaveAttribute('title', 'Decrease square size');
    expect(buttons[4]).toHaveAttribute('aria-label', 'Reset turn order');
    expect(buttons[5]).toHaveAttribute('aria-label', 'Start turn order');
    expect(screen.getByTestId('turn-order-rail-toggle')).toHaveAttribute('aria-label', 'Collapse turn order');

    buttons.forEach((button) => {
      expect(button.className).toContain('rounded-2xl');
    });

    expect(buttons[0].className).toContain('bg-gradient-to-br');
    expect(buttons[1].className).not.toContain('bg-gradient-to-br');
    expect(buttons[2].className).not.toContain('bg-gradient-to-br');
    expect(buttons[3].className).not.toContain('bg-gradient-to-br');
    expect(buttons[4].className).not.toContain('bg-gradient-to-br');
    expect(buttons[5].className).not.toContain('bg-gradient-to-br');
    expect(screen.getByTestId('turn-order-rail-toggle').className).toContain('bg-gradient-to-br');

    fireEvent.click(buttons[1]);
    expect(onDeactivateActiveBackground).toHaveBeenCalledTimes(1);

    fireEvent.click(buttons[5]);
    expect(onStartTurnOrder).not.toHaveBeenCalled();
  });

  test('updates the manager grid control labels and disabled states', () => {
    const onToggleGridVisibility = jest.fn();
    const onDeactivateActiveBackground = jest.fn();
    const onStartTurnOrder = jest.fn();
    const onAdvanceTurnOrder = jest.fn();
    const onResetTurnOrder = jest.fn();
    const onAdjustGridSize = jest.fn();
    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          isGridVisible: true,
          onToggleGridVisibility,
          onDeactivateActiveBackground,
          onStartTurnOrder,
          onAdvanceTurnOrder,
          onResetTurnOrder,
          onAdjustGridSize,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /hide grid/i }));
    expect(onToggleGridVisibility).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /deactivate active map/i }));
    expect(onDeactivateActiveBackground).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /increase square size/i }));
    fireEvent.click(screen.getByRole('button', { name: /decrease square size/i }));
    expect(onAdjustGridSize).toHaveBeenNthCalledWith(1, 1);
    expect(onAdjustGridSize).toHaveBeenNthCalledWith(2, -1);

    fireEvent.click(screen.getByRole('button', { name: /reset turn order/i }));
    expect(onResetTurnOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /start turn order/i }));
    expect(onStartTurnOrder).not.toHaveBeenCalled();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          isGridVisible: false,
          isTurnOrderStarted: true,
          turnOrderEntries: [{
            tokenId: 'user-1',
            ownerUid: 'current-user',
            label: 'Ilya',
            imageUrl: '',
            tokenType: 'character',
            initiative: 12,
            joinedAt: null,
            joinedAtMs: 10,
          }],
          isGridVisibilityToggleDisabled: true,
          isDeactivateActiveBackgroundDisabled: true,
          isTurnOrderProgressPending: true,
          isTurnOrderResetPending: true,
          isGridSizeAdjustmentDisabled: true,
          onToggleGridVisibility,
          onDeactivateActiveBackground,
          onStartTurnOrder,
          onAdvanceTurnOrder,
          onResetTurnOrder,
          onAdjustGridSize,
        })}
      />
    );

    expect(screen.getByRole('button', { name: /show grid/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /show grid/i }).className).not.toContain('bg-gradient-to-br');
    expect(screen.getByRole('button', { name: /show grid/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /deactivate active map/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /increase square size/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /decrease square size/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reset turn order/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /advance turn order/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /advance turn order/i }).className).toContain('bg-gradient-to-br');
    expect(screen.getByTestId('turn-order-rail-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('renders narration mode as an image-only scene and freezes combat controls', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          isNarrationOverlayActive: true,
          activeBackground: {
            id: 'map-2',
            name: 'Iron Keep',
            imageUrl: 'https://example.com/map-2.png',
            imageWidth: 1280,
            imageHeight: 720,
          },
          combatBackgroundName: 'Sunken Ruins',
          tokens: [{
            tokenId: 'current-user',
            ownerUid: 'current-user',
            label: 'Ilya',
            imageUrl: '',
            placed: true,
            col: 1,
            row: 1,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          aoeFigures: [{
            id: 'map-1__current-user__circle__1',
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'circle',
            slot: 1,
            originCell: { col: 1, row: 1 },
            targetCell: { col: 3, row: 1 },
            colorKey: 'ion-cyan',
            isVisibleToPlayers: true,
          }],
          sharedInteractions: [{
            ownerUid: 'other-user',
            type: 'measure',
            source: 'free',
            colorKey: 'ion-cyan',
            anchorCells: [{ col: 1, row: 1 }],
            liveEndCell: { col: 3, row: 1 },
          }],
          turnOrderEntries: [{
            tokenId: 'current-user',
            ownerUid: 'current-user',
            label: 'Ilya',
            imageUrl: '',
            tokenType: 'character',
            initiative: 12,
            joinedAt: null,
            joinedAtMs: 10,
          }],
          onToggleGridVisibility: jest.fn(),
          onDeactivateActiveBackground: jest.fn(),
          onStartTurnOrder: jest.fn(),
          onResetTurnOrder: jest.fn(),
          onAdjustGridSize: jest.fn(),
        })}
      />
    );

    await screen.findByTestId('battlemap-image-active');

    expect(screen.getByTestId('narration-overlay-badge')).toHaveTextContent('Narration');
    expect(screen.getByText(/Iron Keep\s+\|\s+Narration scene over Sunken Ruins/i)).toBeInTheDocument();
    expect(screen.queryByTestId('grid-layer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('token-node-current-user')).not.toBeInTheDocument();
    expect(screen.queryByTestId('aoe-figure-overlay-map-1__current-user__circle__1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('measurement-overlay-shared-other-user')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /return to mouse selection/i })).toBeDisabled();
    expect(screen.getByTestId('draw-color-trigger')).toBeDisabled();
    expect(screen.getByTestId('aoe-template-trigger')).toBeDisabled();
    expect(screen.getByRole('button', { name: /share live interactions/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /hide grid/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /deactivate active map/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /increase square size/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reset turn order/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /start turn order/i })).toBeDisabled();
    expect(screen.getByTestId('turn-order-entry-current-user')).toBeInTheDocument();
    expect(screen.queryByTestId('turn-order-initiative-input-current-user')).not.toBeInTheDocument();
    expect(screen.getByTestId('turn-order-initiative-value-current-user')).toHaveTextContent('12');
  });

  test('shows the shared turn order panel by default and updates entries as data changes', () => {
    const turnOrderEntries = [{
      tokenId: 'user-1',
      ownerUid: 'current-user',
      label: 'Ilya',
      imageUrl: '',
      tokenType: 'character',
      initiative: 12,
      joinedAt: null,
      joinedAtMs: 10,
    }];
    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          turnOrderEntries: [],
        })}
      />
    );

    expect(screen.getByTestId('turn-order-panel')).toBeInTheDocument();
    expect(screen.getByTestId('turn-order-empty-state')).toHaveTextContent('No tokens have joined the turn order yet.');

    rerender(
      <GrigliataBoard
        {...buildProps({
          turnOrderEntries,
        })}
      />
    );

    expect(screen.getByTestId('turn-order-panel')).toBeInTheDocument();
    expect(screen.getByTestId('turn-order-entry-user-1')).toHaveTextContent('Ilya');

    const turnOrderScrollContainer = screen.getByTestId('turn-order-panel').querySelector('.overflow-y-auto');
    expect(turnOrderScrollContainer).toBeTruthy();
    expect(turnOrderScrollContainer.className).toContain('overflow-x-hidden');
  });

  test('persists the turn order panel collapsed state across remounts', () => {
    const storageKey = 'grigliata.turnOrderCollapsed.current-user';
    const turnOrderEntries = [{
      tokenId: 'user-1',
      ownerUid: 'current-user',
      label: 'Ilya',
      imageUrl: '',
      tokenType: 'character',
      initiative: 12,
      joinedAt: null,
      joinedAtMs: 10,
    }];
    const { unmount } = render(
      <GrigliataBoard
        {...buildProps({
          turnOrderEntries,
        })}
      />
    );

    const toggle = screen.getByTestId('turn-order-rail-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(storageKey)).toBe('true');

    unmount();

    render(
      <GrigliataBoard
        {...buildProps({
          turnOrderEntries,
        })}
      />
    );

    expect(screen.getByTestId('turn-order-rail-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(storageKey)).toBe('true');
  });

  test('opens a token turn-order context menu on right click for placed tokens', async () => {
    const onJoinTurnOrder = jest.fn(() => Promise.resolve());
    const onLeaveTurnOrder = jest.fn(() => Promise.resolve());
    const token = {
      id: 'user-1',
      tokenId: 'user-1',
      ownerUid: 'current-user',
      label: 'Ilya',
      tokenType: 'character',
      imageUrl: '',
      placed: true,
      col: 1,
      row: 1,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
      isInTurnOrder: false,
    };
    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          tokens: [token],
          onJoinTurnOrder,
          onLeaveTurnOrder,
        })}
      />
    );

    fireEvent.contextMenu(screen.getByTestId('token-node-user-1'), {
      clientX: 160,
      clientY: 160,
      button: 2,
    });

      expect(screen.getByTestId('turn-order-context-menu')).toBeInTheDocument();
      expect(screen.getByTestId('turn-order-context-action-user-1')).toHaveTextContent('Add turn order');

      fireEvent.click(screen.getByTestId('turn-order-context-action-user-1'));
      expect(onJoinTurnOrder).not.toHaveBeenCalled();
      expect(screen.getByTestId('turn-order-join-overlay')).toBeInTheDocument();
      expect(screen.getByTestId('turn-order-join-initiative-input')).toHaveValue('0');

      fireEvent.change(screen.getByTestId('turn-order-join-initiative-input'), {
        target: { value: '14' },
      });
      fireEvent.click(screen.getByTestId('turn-order-join-confirm'));

      await waitFor(() => {
        expect(onJoinTurnOrder).toHaveBeenCalledWith('user-1', 14);
      });

      rerender(
        <GrigliataBoard
        {...buildProps({
          tokens: [{ ...token, isInTurnOrder: true }],
          onJoinTurnOrder,
          onLeaveTurnOrder,
        })}
      />
    );

    fireEvent.contextMenu(screen.getByTestId('token-node-user-1'), {
      clientX: 160,
      clientY: 160,
      button: 2,
    });

    expect(screen.getByTestId('turn-order-context-action-user-1')).toHaveTextContent('Remove from turn order');
  });

  test('renders sorted turn order rows and respects edit permissions', () => {
    const turnOrderEntries = [{
      tokenId: 'other-user',
      ownerUid: 'other-user',
      label: 'Boros',
      imageUrl: '',
      tokenType: 'foe',
      initiative: 8,
      joinedAt: null,
      joinedAtMs: 20,
    }, {
      tokenId: 'current-user',
      ownerUid: 'current-user',
      label: 'Alya',
      imageUrl: '',
      tokenType: 'character',
      initiative: 15,
      joinedAt: null,
      joinedAtMs: 50,
    }, {
      tokenId: 'tie-break-a',
      ownerUid: 'tie-break-a',
      label: 'Ciro',
      imageUrl: '',
      tokenType: 'character',
      initiative: 15,
      joinedAt: null,
      joinedAtMs: 10,
    }];
    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          turnOrderEntries,
        })}
      />
    );

    const rows = [
      screen.getByTestId('turn-order-entry-tie-break-a'),
      screen.getByTestId('turn-order-entry-current-user'),
      screen.getByTestId('turn-order-entry-other-user'),
    ];

    expect(rows[0].compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows[1].compareDocumentPosition(rows[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('turn-order-initiative-input-current-user')).toBeInTheDocument();
    expect(screen.getByTestId('turn-order-initiative-input-other-user')).toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'current-user',
          isManager: false,
          turnOrderEntries,
        })}
      />
    );

    expect(screen.getByTestId('turn-order-initiative-input-current-user')).toBeInTheDocument();
    expect(screen.queryByTestId('turn-order-initiative-input-other-user')).not.toBeInTheDocument();
    expect(screen.getByTestId('turn-order-initiative-value-other-user')).toHaveTextContent('8');

    rerender(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'spectator',
          isManager: false,
          turnOrderEntries,
        })}
      />
    );

    expect(screen.queryByTestId('turn-order-initiative-input-current-user')).not.toBeInTheDocument();
    expect(screen.getByTestId('turn-order-initiative-value-current-user')).toHaveTextContent('15');
    expect(screen.getByTestId('turn-order-initiative-value-other-user')).toHaveTextContent('8');
  });

  test('highlights the active turn row and matching battlemap token', () => {
    const turnOrderEntries = [{
      tokenId: 'user-1',
      ownerUid: 'user-1',
      label: 'Ilya',
      imageUrl: '',
      tokenType: 'character',
      initiative: 14,
      joinedAt: null,
      joinedAtMs: 10,
    }, {
      tokenId: 'user-2',
      ownerUid: 'user-2',
      label: 'Boros',
      imageUrl: '',
      tokenType: 'character',
      initiative: 7,
      joinedAt: null,
      joinedAtMs: 20,
    }];

    render(
      <GrigliataBoard
        {...buildProps({
          activeTurnTokenId: 'user-2',
          isTurnOrderStarted: true,
          turnOrderEntries,
          tokens: [{
            id: 'user-1',
            tokenId: 'user-1',
            ownerUid: 'user-1',
            label: 'Ilya',
            imageUrl: '',
            placed: true,
            col: 1,
            row: 1,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }, {
            id: 'user-2',
            tokenId: 'user-2',
            ownerUid: 'user-2',
            label: 'Boros',
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
        })}
      />
    );

    expect(screen.getByTestId('turn-order-entry-user-2')).toHaveAttribute('data-active-turn', 'true');
    expect(screen.getByTestId('turn-order-entry-user-1')).toHaveAttribute('data-active-turn', 'false');
    expect(screen.getByTestId('token-node-user-2')).toHaveAttribute('data-active-turn', 'true');
    expect(screen.getByTestId('token-node-user-1')).toHaveAttribute('data-active-turn', 'false');
  });

  test('saves initiative on submit and discards unsaved edits on Escape without showing a save button', async () => {
    const onSaveTurnOrderInitiative = jest.fn(() => Promise.resolve());
    const turnOrderEntries = [{
      tokenId: 'current-user',
      ownerUid: 'current-user',
      label: 'Alya',
      imageUrl: '',
      tokenType: 'character',
      initiative: 15,
      joinedAt: null,
      joinedAtMs: 50,
    }];

    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'current-user',
          turnOrderEntries,
          onSaveTurnOrderInitiative,
        })}
      />
    );

    const input = screen.getByTestId('turn-order-initiative-input-current-user');
    expect(input).toHaveValue('15');

    fireEvent.change(input, { target: { value: '22' } });
    expect(screen.queryByTestId('turn-order-initiative-save-current-user')).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    expect(onSaveTurnOrderInitiative).not.toHaveBeenCalled();
    expect(screen.getByTestId('turn-order-initiative-input-current-user')).toHaveValue('15');

    fireEvent.change(screen.getByTestId('turn-order-initiative-input-current-user'), { target: { value: '22' } });
    fireEvent.submit(screen.getByTestId('turn-order-initiative-input-current-user').closest('form'));

    await waitFor(() => {
      expect(onSaveTurnOrderInitiative).toHaveBeenCalledWith('current-user', 22);
    });

    expect(screen.getByTestId('turn-order-initiative-input-current-user')).toHaveValue('22');
  });

  test('keeps the initiative editor dirty when the save callback reports failure', async () => {
    const onSaveTurnOrderInitiative = jest.fn(() => Promise.resolve(false));
    const turnOrderEntries = [{
      tokenId: 'current-user',
      ownerUid: 'current-user',
      label: 'Alya',
      imageUrl: '',
      tokenType: 'character',
      initiative: 15,
      joinedAt: null,
      joinedAtMs: 50,
    }];

    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'current-user',
          turnOrderEntries,
          onSaveTurnOrderInitiative,
        })}
      />
    );

    const input = screen.getByTestId('turn-order-initiative-input-current-user');
    fireEvent.change(input, { target: { value: '22' } });
    fireEvent.submit(input.closest('form'));

    await waitFor(() => {
      expect(onSaveTurnOrderInitiative).toHaveBeenCalledWith('current-user', 22);
    });

    expect(screen.getByTestId('turn-order-initiative-input-current-user')).toHaveValue('22');

    fireEvent.keyDown(screen.getByTestId('turn-order-initiative-input-current-user'), { key: 'Escape', code: 'Escape' });
    expect(screen.getByTestId('turn-order-initiative-input-current-user')).toHaveValue('15');
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

  test('renders per-step feet labels for a multi-step shared ruler and keeps the total at the end', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          sharedInteractions: [{
            backgroundId: 'map-1',
            ownerUid: 'other-user',
            type: 'measure',
            source: 'free',
            colorKey: 'ion-cyan',
            anchorCells: [
              { col: 1, row: 1 },
              { col: 3, row: 1 },
            ],
            liveEndCell: { col: 6, row: 1 },
            updatedAt: { toMillis: () => Date.now() },
            updatedBy: 'other-user',
          }],
        })}
      />
    );

    expect(screen.getByTestId('measurement-overlay-shared-other-user')).toBeInTheDocument();
    expect(screen.getByText('10 ft')).toBeInTheDocument();
    expect(screen.getByText('15 ft')).toBeInTheDocument();
    expect(screen.getByText('25 ft (5 squares)')).toBeInTheDocument();
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

    const pingOverlay = screen.getByTestId('map-ping-overlay-shared-other-user');

    expect(pingOverlay).toBeInTheDocument();
    expect(pingOverlay.querySelector('[data-stroke="#38bdf8"]')).not.toBeNull();
    expect(pingOverlay.querySelector(`[data-stroke="${MAP_PING_EPIC_ACCENT}"]`)).not.toBeNull();

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

    const localPingOverlays = document.querySelectorAll('[data-testid^="map-ping-overlay-local-ping-"]');
    expect(localPingOverlays).toHaveLength(1);
    expect(localPingOverlays[0].querySelector('[data-stroke="#f472b6"]')).not.toBeNull();
    expect(localPingOverlays[0].querySelector(`[data-stroke="${MAP_PING_EPIC_ACCENT}"]`)).not.toBeNull();
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

  test('keeps pings bold and theme-aware when reduced motion is enabled', () => {
    useReducedMotion.mockReturnValue(true);
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

    const pingOverlay = screen.getByTestId('map-ping-overlay-shared-other-user');

    expect(pingOverlay.querySelector('[data-stroke="#38bdf8"]')).not.toBeNull();
    expect(pingOverlay.querySelector(`[data-stroke="${MAP_PING_EPIC_ACCENT}"]`)).not.toBeNull();
    expect(pingOverlay.querySelector('[data-fill="#38bdf8"]')).not.toBeNull();
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
    expect(screen.queryByText('Templates')).not.toBeInTheDocument();
    expect(screen.getByTestId('aoe-template-option-rectangle')).toBeInTheDocument();
    expect(screen.queryByTestId('aoe-template-option-square')).not.toBeInTheDocument();

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

  test('renders a local rectangle preview and creates the figure on mouseup', async () => {
    const onCreateAoEFigure = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          activeAoeFigureType: 'rectangle',
          onCreateAoEFigure,
        })}
      />
    );

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 210, buttons: 1 });

    expect(screen.getByTestId('aoe-figure-overlay-local')).toBeInTheDocument();
    expect(screen.getByTestId('aoe-figure-measurement-local')).toHaveTextContent(/^\d+ x \d+ ft\s*\d+ x \d+ sq/);

    fireEvent.mouseUp(window, { button: 0, clientX: 350, clientY: 210, buttons: 0 });

    await waitFor(() => {
      expect(onCreateAoEFigure).toHaveBeenCalledWith(expect.objectContaining({
        figureType: 'rectangle',
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

    const createdDraft = onCreateAoEFigure.mock.calls[0][0];
    expect(Math.abs(createdDraft.targetCell.col - createdDraft.originCell.col)).toBeGreaterThan(0);
    expect(Math.abs(createdDraft.targetCell.row - createdDraft.originCell.row)).toBeGreaterThan(0);
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
          }, {
            id: 'map-1__current-user__rectangle__1',
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'rectangle',
            slot: 1,
            originCell: { col: 1, row: 6 },
            targetCell: { col: 3, row: 7 },
            colorKey: 'volt-lime',
            isVisibleToPlayers: true,
          }],
        })}
      />
    );

    expect(screen.getByTestId('aoe-figure-measurement-map-1__current-user__circle__1')).toBeInTheDocument();
    expect(screen.getByText('R 20 ft • D 40 ft')).toBeInTheDocument();
    expect(screen.getByText('15 ft side')).toBeInTheDocument();
    expect(screen.getByText('L 20 ft • W 20 ft • 53°')).toBeInTheDocument();
    expect(screen.getByText('W 15 ft • H 10 ft')).toBeInTheDocument();
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

  test('shows the detail and fill actions for selected editable AoE figures', async () => {
    const onUpdateAoEFigurePresentation = jest.fn(() => Promise.resolve());
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
          onUpdateAoEFigurePresentation,
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

    fireEvent.click(screen.getByRole('button', { name: /hide size details/i }));

    await waitFor(() => {
      expect(onUpdateAoEFigurePresentation).toHaveBeenCalledWith(figureId, {
        showMeasurementDetails: false,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /show border only/i }));

    await waitFor(() => {
      expect(onUpdateAoEFigurePresentation).toHaveBeenCalledWith(figureId, {
        isFilled: false,
      });
    });
  });

  test('keeps border-only AoE figures selectable', () => {
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
            targetCell: { col: 4, row: 4 },
            colorKey: 'nova-teal',
            isVisibleToPlayers: true,
            isFilled: false,
          }],
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-overlay-${figureId}`), {
      button: 0,
      clientX: 210,
      clientY: 210,
      buttons: 1,
    });
    fireEvent.mouseUp(window, { button: 0, clientX: 210, clientY: 210, buttons: 0 });

    expect(screen.getByRole('button', { name: /fill selected aoe figure/i })).toBeInTheDocument();
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

  test('moves an editable rectangle AoE figure without resizing it', async () => {
    const onMoveAoEFigure = jest.fn(() => Promise.resolve());
    const figureId = 'map-1__current-user__rectangle__1';

    render(
      <GrigliataBoard
        {...buildProps({
          aoeFigures: [{
            id: figureId,
            backgroundId: 'map-1',
            ownerUid: 'current-user',
            figureType: 'rectangle',
            slot: 1,
            originCell: { col: 2, row: 2 },
            targetCell: { col: 4, row: 3 },
            colorKey: 'nova-teal',
            isVisibleToPlayers: true,
          }],
          onMoveAoEFigure,
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-overlay-${figureId}`), {
      button: 0,
      clientX: 210,
      clientY: 175,
      buttons: 1,
    });
    fireEvent.mouseMove(window, { clientX: 280, clientY: 175, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 280, clientY: 175, buttons: 0 });

    await waitFor(() => {
      expect(onMoveAoEFigure).toHaveBeenCalledWith(
        figureId,
        expect.objectContaining({
          figureType: 'rectangle',
          originCell: expect.objectContaining({
            col: expect.any(Number),
            row: expect.any(Number),
          }),
          targetCell: expect.objectContaining({
            col: expect.any(Number),
            row: expect.any(Number),
          }),
        })
      );
    });

    const movedDraft = onMoveAoEFigure.mock.calls[0][1];
    expect(movedDraft.targetCell.col - movedDraft.originCell.col).toBe(2);
    expect(movedDraft.targetCell.row - movedDraft.originCell.row).toBe(1);
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
    expect(screen.queryByRole('button', { name: /hide size details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show border only/i })).not.toBeInTheDocument();
  });
});
