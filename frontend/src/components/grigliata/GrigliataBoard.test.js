import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GrigliataBoard from './GrigliataBoard';
import { getGrigliataDrawTheme } from './constants';

jest.mock('./useImageAsset', () => jest.fn(() => null));
jest.mock('./tokenStatuses', () => ({
  getTokenStatusDefinition: jest.fn(() => null),
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
        if (typeof value === 'function' || value == null) {
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
    const domProps = {};

    Object.entries(props).forEach(([key, value]) => {
      if (typeof value === 'function' || value == null) {
        return;
      }

      const domKey = key.startsWith('data-') ? key : `data-${key.toLowerCase()}`;
      domProps[domKey] = serializeProp(value);
    });

    React.useImperativeHandle(ref, () => ({
      getPointerPosition: () => ({ x: 0, y: 0 }),
    }));

    return (
      <div {...domProps} data-konva-type="Stage" ref={ref}>
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
  currentUserId: 'current-user',
  isManager: false,
  isTokenDragActive: false,
  isRulerEnabled: false,
  isInteractionSharingEnabled: false,
  drawTheme: getGrigliataDrawTheme('aurora-fuchsia'),
  onToggleRuler: jest.fn(),
  onToggleInteractionSharing: jest.fn(),
  onChangeDrawColor: jest.fn(),
  onToggleGridVisibility: null,
  isGridVisibilityToggleDisabled: false,
  onAdjustGridSize: null,
  isGridSizeAdjustmentDisabled: false,
  onMoveTokens: jest.fn(),
  onDeleteTokens: jest.fn(),
  onSetSelectedTokensVisibility: null,
  isTokenVisibilityActionPending: false,
  onSetSelectedTokensDeadState: null,
  isTokenDeadActionPending: false,
  onUpdateTokenStatuses: jest.fn(),
  isTokenStatusActionPending: false,
  onDropCurrentToken: jest.fn(),
  sharedInteractions: [],
  onSharedInteractionChange: jest.fn(),
  ...overrides,
});

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
  });

  afterEach(() => {
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
});
