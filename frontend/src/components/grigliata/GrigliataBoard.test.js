import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  test('renders the quick controls stack in the expected order and keeps reset view available', () => {
    render(<GrigliataBoard {...buildProps()} />);

    const quickControls = screen.getByTestId('grigliata-quick-controls');
    const buttons = within(quickControls).getAllByRole('button');

    expect(buttons).toHaveLength(4);
    expect(buttons[0]).toBe(screen.getByTestId('draw-color-trigger'));
    expect(buttons[1]).toHaveAttribute('aria-label', 'Enable ruler mode');
    expect(buttons[2]).toHaveAttribute('aria-label', 'Share live interactions');
    expect(buttons[3]).toHaveAttribute('aria-label', 'Reset View');
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
