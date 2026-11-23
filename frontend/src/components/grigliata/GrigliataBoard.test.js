import React from 'react';
import { act, fireEvent, queryByAttribute, render, screen, waitFor, within } from '@testing-library/react';
import { useReducedMotion } from 'framer-motion';
import GrigliataBoard, {
  buildAoEFigureMeasurementDecorationLayout,
  buildBoundedTokenMediaIdSet,
  buildZoomNormalizedOverlayMetrics,
  getAoEFigureMeasurementTextLines,
} from './GrigliataBoard';
import {
  FOE_LIBRARY_DRAG_TYPE,
  getGrigliataDrawTheme,
  MAP_PING_BROADCAST_CLEAR_MS,
  MAP_PING_HOLD_DELAY_MS,
  MAP_PING_VISIBLE_MS,
  MIN_GRIGLIATA_VIEWPORT_SCALE,
  TRAY_DRAG_MIME,
} from './constants';
import { buildRenderableGrigliataAoEFigure } from './aoeFigures';
import {
  getTokenStatusDefinition,
  splitTokenStatusesForDisplay,
  useTokenStatusIconImages,
} from './tokenStatuses';
import useImageAsset, { useImageAssetSnapshot } from '../common/imageAssets/useImageAsset';
import * as privateMediaAssetsModule from '../common/privateMediaAssets';
import {
  __configurePrivateMediaAssetsForTests,
  __resetPrivateMediaAssetsForTests,
  getPrivateMediaAssetCacheSnapshot,
} from '../common/privateMediaAssets';
import * as grigliataBoardTokenUiModule from './grigliataBoardTokenUi';
import * as fogVisibilityFiltering from './fogVisibilityFiltering';
import * as tokenStacksModule from './tokenStacks';
import { TOKEN_PORTRAIT_MAX_DRAWABLE_EDGE } from './grigliataBoardTokenUi';
import {
  getDecodedImageBytes,
  getTokenPortraitDecodedBytes,
  TOKEN_PORTRAIT_EDGE_TIERS,
} from './grigliataTokenPortraitBudget';
import {
  __configureImageAssetRegistryForTests,
  __getImageAssetRegistryStats,
  __resetImageAssetRegistry,
  getImageAssetRegistryRuntimeLimits,
  IMAGE_ASSET_PIN_NAMES,
} from '../common/imageAssets/imageAssetRegistry';
import {
  FOG_RASTER_MASK_ENCODING,
  FOG_RASTER_PROFILE_ID,
  createEmptyFogRasterMaskBytes,
  encodeFogRasterMaskBase64,
  normalizeFogRasterMemoryTileDoc,
} from './fogRasterMemory';

const TOKEN_PORTRAIT_SNAPSHOT_OPTIONS = { maxEdge: TOKEN_PORTRAIT_MAX_DRAWABLE_EDGE };
const MAP_PING_ACCENT = '#fbbf24';
const STATUS_BADGE_FILL = '#7c3aed';
const STATUS_BADGE_STROKE = '#f8fafc';
const OVERFLOW_BADGE_FILL = 'rgba(2, 6, 23, 0.94)';
const HIDDEN_BADGE_STROKE = 'rgba(226, 232, 240, 0.96)';
const DEAD_BANNER_FILL = 'rgba(127, 29, 29, 0.88)';

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
};

test('bounds token media leases and excludes offscreen tokens after priority selection', () => {
  const tokens = [
    {
      tokenId: 'offscreen',
      imageUrl: 'https://example.com/offscreen.png',
      renderPosition: {x: 900, y: 900, size: 500},
    },
    {
      tokenId: 'visible',
      imageUrl: 'https://example.com/visible.png',
      renderPosition: {x: 20, y: 20, size: 50},
    },
    {
      tokenId: 'selected',
      imageUrl: 'https://example.com/selected.png',
      renderPosition: {x: 800, y: 800, size: 50},
      isSelected: true,
    },
    {
      tokenId: 'active',
      imageUrl: 'https://example.com/active.png',
      renderPosition: {x: 700, y: 700, size: 50},
      isActiveTurn: true,
    },
  ];

  const selectedIds = buildBoundedTokenMediaIdSet({
    tokens,
    viewport: {x: 0, y: 0, scale: 1},
    stageSize: {width: 200, height: 200},
    limit: 4,
  });

  expect([...selectedIds]).toEqual(['active', 'selected', 'visible']);
  expect(selectedIds).not.toContain('offscreen');
});

test('loads visible token media at low zoom while keeping priority tokens first', () => {
  const tokenAt = (tokenId, overrides = {}) => ({
    tokenId,
    imageUrl: `https://example.com/${tokenId}.png`,
    renderPosition: {x: 20, y: 20, size: 50},
    ...overrides,
  });
  const tokens = [
    tokenAt('tiny-visible'),
    tokenAt('manager-movable', {canMove: true}),
    tokenAt('viewer-owned', {
      isOwnedByViewer: true,
      renderPosition: {x: 2000, y: 2000, size: 50},
    }),
    tokenAt('selected', {isSelected: true}),
    tokenAt('active', {isActiveTurn: true}),
    tokenAt('tiny-offscreen', {
      renderPosition: {x: 2000, y: 2000, size: 50},
    }),
  ];

  const selectedIds = buildBoundedTokenMediaIdSet({
    tokens,
    viewport: {x: 0, y: 0, scale: 0.2},
    stageSize: {width: 200, height: 200},
    limit: 10,
  });

  expect([...selectedIds]).toEqual([
    'active',
    'selected',
    'viewer-owned',
    'tiny-visible',
    'manager-movable',
  ]);
  expect(selectedIds).not.toContain('tiny-offscreen');
});

test('keeps offscreen priority media order stable when candidates exceed the limit', () => {
  const tokenAt = (tokenId, overrides = {}) => ({
    tokenId,
    imageUrl: `https://example.com/${tokenId}.png`,
    renderPosition: {x: 2000, y: 2000, size: 50},
    ...overrides,
  });
  const selectedIds = buildBoundedTokenMediaIdSet({
    tokens: [
      tokenAt('offscreen-ordinary'),
      tokenAt('owned-first', {isOwnedByViewer: true}),
      tokenAt('selected-first', {isSelected: true}),
      tokenAt('active-first', {isActiveTurn: true}),
      tokenAt('active-second', {isActiveTurn: true}),
      tokenAt('selected-second', {isSelected: true}),
      tokenAt('owned-second', {isOwnedByViewer: true}),
    ],
    viewport: {x: 0, y: 0, scale: 1},
    stageSize: {width: 200, height: 200},
    limit: 5,
  });

  expect([...selectedIds]).toEqual([
    'active-first',
    'active-second',
    'selected-first',
    'selected-second',
    'owned-first',
  ]);
  expect(selectedIds).not.toContain('owned-second');
  expect(selectedIds).not.toContain('offscreen-ordinary');
});

const buildLowZoomTokenGrid = ({count, columns = 20, imageUrlForIndex}) => (
  Array.from({length: count}, (_, index) => ({
    tokenId: `grid-token-${index}`,
    imageUrl: imageUrlForIndex(index),
    renderPosition: {
      x: (index % columns) * 50,
      y: Math.floor(index / columns) * 50,
      size: 50,
    },
  }))
);

test.each([
  {profile: 'desktop', limit: 72},
  {profile: 'compact', limit: 40},
])('leases every visible token portrait at low zoom beyond the $profile record budget', ({limit}) => {
  const lowZoomViewport = {x: 0, y: 0, scale: 0.2};
  const stageSize = {width: 400, height: 300};
  const sharedTokens = buildLowZoomTokenGrid({
    count: 80,
    imageUrlForIndex: () => 'https://example.com/shared-portrait.png',
  });
  const distinctTokens = buildLowZoomTokenGrid({
    count: 200,
    imageUrlForIndex: (index) => `https://example.com/distinct-${index}.png`,
  });

  // Guard against a vacuous fixture: each token is a few pixels wide, on screen,
  // and the visible set is larger than the offscreen priority budget.
  expect(50 * lowZoomViewport.scale).toBeLessThan(16);
  expect(sharedTokens.length).toBeGreaterThan(limit);
  expect(distinctTokens.length).toBeGreaterThan(limit);
  expect((19 * 50 + 50) * lowZoomViewport.scale).toBeLessThanOrEqual(stageSize.width);
  expect((9 * 50 + 50) * lowZoomViewport.scale).toBeLessThanOrEqual(stageSize.height);

  [sharedTokens, distinctTokens].forEach((tokens) => {
    const selectedIds = buildBoundedTokenMediaIdSet({
      tokens,
      viewport: lowZoomViewport,
      stageSize,
      limit,
    });
    expect([...selectedIds]).toEqual(tokens.map(({tokenId}) => tokenId));
  });
});

test('keeps offscreen ordinary art unloaded and charges shared offscreen priority art once', () => {
  const tokenAt = (tokenId, overrides = {}) => ({
    tokenId,
    imageUrl: `https://example.com/${tokenId}.png`,
    renderPosition: {x: 2000, y: 2000, size: 50},
    ...overrides,
  });
  const selectedIds = buildBoundedTokenMediaIdSet({
    tokens: [
      tokenAt('owned-shared-a', {isOwnedByViewer: true, imageUrl: 'https://example.com/party.png'}),
      tokenAt('owned-shared-b', {isOwnedByViewer: true, imageUrl: 'https://example.com/party.png'}),
      tokenAt('owned-visible-art', {
        isOwnedByViewer: true,
        imageUrl: 'https://example.com/visible-art.png',
      }),
      tokenAt('owned-distinct', {isOwnedByViewer: true}),
      tokenAt('owned-over-budget', {isOwnedByViewer: true}),
      tokenAt('offscreen-ordinary'),
      tokenAt('no-art', {isOwnedByViewer: true, imageUrl: ''}),
      tokenAt('visible-shared', {
        imageUrl: 'https://example.com/visible-art.png',
        renderPosition: {x: 20, y: 20, size: 50},
      }),
    ],
    viewport: {x: 0, y: 0, scale: 1},
    stageSize: {width: 200, height: 200},
    limit: 2,
  });

  expect([...selectedIds]).toEqual([
    'owned-shared-a',
    'owned-shared-b',
    'owned-visible-art',
    'owned-distinct',
    'visible-shared',
  ]);
  expect(selectedIds).not.toContain('owned-over-budget');
  expect(selectedIds).not.toContain('offscreen-ordinary');
  expect(selectedIds).not.toContain('no-art');
});

test('charges distinct offscreen thumbnails separately when they share a legacy fallback', () => {
  const token = (id, thumbnail) => ({
    tokenId: id,
    isOwnedByViewer: true,
    renderPosition: {x: 2000, y: 2000, size: 50},
    imageUrl: 'https://example.com/legacy.png',
    media: {
      kind: 'avatar', schemaVersion: 1, state: 'ready',
      variants: {thumbnail: {url: thumbnail, width: 96, height: 96}},
    },
  });
  const ids = buildBoundedTokenMediaIdSet({
    tokens: [
      token('first', 'https://example.com/first.png'),
      token('second', 'https://example.com/second.png'),
      token('first-copy', 'https://example.com/first.png'),
    ],
    viewport: {x: 0, y: 0, scale: 1},
    stageSize: {width: 200, height: 200},
    limit: 1,
  });
  expect([...ids]).toEqual(['first', 'first-copy']);
});

test('defers ordinary visible token media until the current viewport fit is ready', () => {
  const tokenAt = (tokenId, overrides = {}) => ({
    tokenId,
    imageUrl: `https://example.com/${tokenId}.png`,
    renderPosition: {x: 20, y: 20, size: 80},
    ...overrides,
  });

  const selectedIds = buildBoundedTokenMediaIdSet({
    tokens: [
      tokenAt('ordinary-visible'),
      tokenAt('viewer-owned', {isOwnedByViewer: true}),
      tokenAt('selected', {isSelected: true}),
      tokenAt('active', {isActiveTurn: true}),
    ],
    viewport: {x: 0, y: 0, scale: 1},
    stageSize: {width: 200, height: 200},
    limit: 10,
    allowVisibleMedia: false,
  });

  expect([...selectedIds]).toEqual(['active', 'selected', 'viewer-owned']);
  expect(selectedIds).not.toContain('ordinary-visible');
});

jest.mock('framer-motion', () => {
  const actual = jest.requireActual('framer-motion');

  return {
    ...actual,
    useReducedMotion: jest.fn(() => false),
  };
});

jest.mock('../common/imageAssets/useImageAsset', () => ({
  __esModule: true,
  default: jest.fn(() => null),
  useImageAssetSnapshot: jest.fn(() => ({
    status: 'idle',
    image: null,
    error: null,
  })),
}));
jest.mock('../../data/media/useTask07MediaReadMode', () => ({
  __esModule: true,
  default: () => 'derivative-read',
}));
jest.mock('../common/DiceRoller', () => function MockDiceRoller(props) {
  return (
    <div data-testid="turn-order-initiative-dice-roller">
      <span>{`faces:${props.faces};count:${props.count};modifier:${props.modifier};description:${props.description}`}</span>
      <button type="button" onClick={() => props.onComplete(13)}>
        Complete initiative dice roll
      </button>
    </div>
  );
});
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
      const attachNode = React.useCallback((node) => {
        if (node && displayName === 'Layer') node.batchDraw = jest.fn();
        if (node && displayName === 'Image') node.getLayer = () => node.closest('[data-konva-type="Layer"]');
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }, [ref]);

      Object.entries(props).forEach(([key, value]) => {
        if (value == null) {
          return;
        }

        if (key === 'onTap') {
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
          ref: attachNode,
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
      <div data-testid="konva-stage" {...domProps} data-konva-type="Stage" ref={elementRef}>
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
    Path: createComponent('Path'),
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

const buildMemoryTile = ({ tileKey = '0:0', tileCol = 0, tileRow = 0 } = {}) => {
  const maskBytes = createEmptyFogRasterMaskBytes();
  maskBytes[0] = 0xff;
  return normalizeFogRasterMemoryTileDoc({
    id: `map-1__current-user__${FOG_RASTER_PROFILE_ID}__${tileKey}`,
    backgroundId: 'map-1',
    ownerUid: 'current-user',
    tileKey,
    tileCol,
    tileRow,
    rasterProfileId: FOG_RASTER_PROFILE_ID,
    tileSizeCells: 8,
    samplesPerCell: 16,
    cellSizePx: 70,
    offsetXPx: 0,
    offsetYPx: 0,
    maskEncoding: FOG_RASTER_MASK_ENCODING,
    maskBase64: encodeFogRasterMaskBase64(maskBytes),
    updatedBy: 'current-user',
  });
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
  isRulerTokenMovementEnabled: false,
  activeAoeFigureType: '',
  isInteractionSharingEnabled: false,
  isMusicMuted: false,
  isMusicMutePending: false,
  drawTheme: getGrigliataDrawTheme('aurora-fuchsia'),
  onSelectMouseTool: jest.fn(),
  onToggleRuler: jest.fn(),
  onToggleRulerTokenMovement: jest.fn(),
  onChangeAoeFigureType: jest.fn(),
  onToggleInteractionSharing: jest.fn(),
  onToggleMusicMuted: jest.fn(),
  onChangeDrawColor: jest.fn(),
  onToggleGridVisibility: null,
  isGridVisibilityToggleDisabled: false,
  onDeactivateActiveBackground: null,
  isDeactivateActiveBackgroundDisabled: false,
  isTurnOrderEnabled: true,
  isTurnOrderDataReady: true,
  turnOrderEntries: [],
  isTurnOrderStarted: false,
  activeTurnTokenId: '',
  onStartTurnOrder: jest.fn(),
  onAdvanceTurnOrder: jest.fn(),
  isTurnOrderProgressPending: false,
  onResetTurnOrder: null,
  isTurnOrderResetPending: false,
  onJoinTurnOrder: jest.fn(),
  onResolveTurnOrderInitiativeRoll: null,
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
  onMoveTokenLayer: jest.fn(),
  isTokenLayerActionPending: false,
  selectedTokenDetails: null,
  onDropCurrentToken: jest.fn(),
  onSelectedTokenIdsChange: jest.fn(),
  sharedInteractions: [],
  activeViewers: [],
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

const getNumericKonvaProp = (element, attributeName) => Number.parseFloat(element?.getAttribute(attributeName) || '0');

const getTokenOverlayMetrics = (tokenNode) => {
  const statusBadge = tokenNode.querySelector(
    `[data-konva-type="Circle"][data-fill="${STATUS_BADGE_FILL}"][data-stroke="${STATUS_BADGE_STROKE}"]`
  );
  const overflowBadge = tokenNode.querySelector(
    `[data-konva-type="Circle"][data-fill="${OVERFLOW_BADGE_FILL}"]`
  );
  const hiddenBadge = tokenNode.querySelector(
    `[data-konva-type="Circle"][data-stroke="${HIDDEN_BADGE_STROKE}"]`
  );
  const deadBanner = tokenNode.querySelector(
    `[data-konva-type="Rect"][data-fill="${DEAD_BANNER_FILL}"]`
  );
  const textNodes = [...tokenNode.querySelectorAll('[data-konva-type="Text"]')];
  const overflowText = textNodes.find((node) => node.textContent === '+1');
  const deadText = textNodes.find((node) => node.textContent === 'DEAD');
  const statusIcon = statusBadge?.parentElement?.querySelector(
    '[data-konva-type="Image"]'
  );

  expect(statusBadge).toBeTruthy();
  expect(statusIcon).toBeTruthy();
  expect(overflowBadge).toBeTruthy();
  expect(overflowText).toBeTruthy();
  expect(hiddenBadge).toBeTruthy();
  expect(deadBanner).toBeTruthy();
  expect(deadText).toBeTruthy();

  return {
    statusBadgeRadius: getNumericKonvaProp(statusBadge, 'data-radius'),
    statusIconWidth: getNumericKonvaProp(statusIcon, 'data-width'),
    overflowBadgeRadius: getNumericKonvaProp(overflowBadge, 'data-radius'),
    overflowFontSize: getNumericKonvaProp(overflowText, 'data-fontsize'),
    hiddenBadgeRadius: getNumericKonvaProp(hiddenBadge, 'data-radius'),
    deadBannerHeight: getNumericKonvaProp(deadBanner, 'data-height'),
    deadFontSize: getNumericKonvaProp(deadText, 'data-fontsize'),
  };
};

const buildGridConfig = (cellSizePx) => ({
  cellSizePx,
  offsetXPx: 0,
  offsetYPx: 0,
});

const buildOverlayToken = () => ({
  tokenId: 'user-1',
  id: 'user-1',
  ownerUid: 'user-1',
  tokenType: 'character',
  label: 'Aldor',
  imageUrl: '',
  placed: true,
  col: 2,
  row: 2,
  isVisibleToPlayers: false,
  isDead: true,
  statuses: ['burning', 'sleeping', 'marked', 'poisoned'],
});

const buildBoardPropsWithGrid = (cellSizePx) => {
  const boardGrid = buildGridConfig(cellSizePx);

  return buildProps({
    grid: boardGrid,
    activeBackground: {
      id: 'map-1',
      name: 'Sunken Ruins',
      grid: boardGrid,
      imageWidth: 0,
      imageHeight: 0,
    },
    currentUserId: 'user-1',
    tokens: [buildOverlayToken()],
  });
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
    getTokenStatusDefinition.mockImplementation(() => null);
    useTokenStatusIconImages.mockImplementation(() => ({}));
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
    __resetPrivateMediaAssetsForTests();
    __resetImageAssetRegistry();
    jest.clearAllTimers();
    jest.useRealTimers();
    resizeObserverInstance = null;
    getBoundingClientRectSpy.mockRestore();
    delete global.ResizeObserver;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test('the dice projection and its numerical result both stay inside the board viewport', async () => {
    const props = buildProps({
      combatTray: {
        id: {}, phase: 'result', kind: 'attack', title: 'Spada', notation: 'd12',
        anchor: { backgroundId: 'map-1', targetIds: ['map-1__hidden-foe'] }, rolls: [{ sides: 12, value: 7 }],
      },
    });
    render(<GrigliataBoard {...props} />);
    const projection = await screen.findByTestId('grigliata-board-dice-projection');
    expect(projection).toHaveAttribute('aria-hidden', 'true');
    const viewport = queryByAttribute('data-combat-map-viewport', document.body, '');
    expect(viewport).toContainElement(projection);
    expect(viewport).toContainElement(queryByAttribute('data-konva-type', viewport, 'Stage'));
    const result = screen.getByRole('region', { name: 'Spada' });
    expect(viewport).toContainElement(result);
    expect(result).toHaveClass('gc-map-step');
    expect(result).toHaveTextContent('d12 7');
    expect(result).not.toContainElement(projection);
  });

  test('targeting, the ready throw and pending damage take turns in one map overlay', () => {
    const props = buildProps({
      combatAim: {
        pawn: { tokenId: 'caster', placementId: 'map-1__caster', col: 1, row: 1 },
        action: { id: 'cone', kind: 'spell', mode: 'multiple', rangeFt: 30 },
        selection: { picking: true, targetIds: [] },
        candidates: [],
        finish: jest.fn(),
      },
      combatTray: {
        id: {}, phase: 'ready', kind: 'attack', title: 'Spada', notation: 'd12', throwDice: jest.fn(),
      },
      combatNextDamage: { label: 'Tiro di danno · Talpa', prepare: jest.fn() },
    });
    const { rerender } = render(<GrigliataBoard {...props} />);
    const viewport = queryByAttribute('data-combat-map-viewport', document.body, '');
    const mapStep = () => queryByAttribute('class', viewport, /\bgc-map-step\b/);
    expect(mapStep()).toContainElement(screen.getByRole('button', { name: 'Conferma bersagli' }));
    expect(screen.queryByRole('button', { name: 'Tira i dadi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: props.combatNextDamage.label })).not.toBeInTheDocument();

    rerender(<GrigliataBoard {...props} combatAim={null} />);
    const ready = within(viewport).getByRole('region', { name: 'Spada' });
    expect(ready).toHaveClass('gc-map-step');
    fireEvent.click(within(ready).getByRole('button', { name: 'Tira i dadi' }));
    expect(props.combatTray.throwDice).toHaveBeenCalledTimes(1);

    // Cancelling a new aim restores its launcher; the old throw must not take focus again.
    rerender(<GrigliataBoard {...props} />);
    const boardControl = screen.getByRole('button', { name: 'Return to mouse selection' });
    boardControl.focus();
    rerender(<GrigliataBoard {...props} combatAim={null} />);
    expect(boardControl).toHaveFocus();
    expect(within(viewport).getByRole('button', { name: 'Tira i dadi' })).toBeVisible();

    rerender(<GrigliataBoard {...props} combatAim={null} combatTray={null} />);
    const next = within(viewport).getByRole('button', { name: props.combatNextDamage.label });
    expect(mapStep()).toContainElement(next);
    fireEvent.click(next);
    expect(props.combatNextDamage.prepare).toHaveBeenCalledTimes(1);
  });

  test('renders uniform subtle grid lines without major-line emphasis', async () => {
    render(<GrigliataBoard {...buildProps()} />);

    const gridLayer = await screen.findByTestId('grid-layer');
    const gridLines = Array.from(gridLayer.querySelectorAll('[data-konva-type="Line"]'));

    expect(gridLines.length).toBeGreaterThan(0);
    expect(new Set(gridLines.map((line) => line.getAttribute('data-stroke')))).toEqual(
      new Set(['rgba(248, 250, 252, 0.14)'])
    );
    expect(new Set(gridLines.map((line) => line.getAttribute('data-strokewidth')))).toEqual(
      new Set(['1'])
    );
    expect(gridLayer.querySelector('[data-stroke="rgba(248, 250, 252, 0.38)"]')).toBeNull();
    expect(gridLayer.querySelector('[data-strokewidth="1.4"]')).toBeNull();
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

  test('does not freeze a cached battlemap fade when same-source hydration refreshes its metadata', async () => {
    jest.useFakeTimers();
    const buildBackground = (name) => ({
      id: 'map-1',
      name,
      imageUrl: 'https://example.com/map-1.png',
      imageWidth: 1280,
      imageHeight: 720,
    });
    const { rerender } = render(
      <GrigliataBoard {...buildProps({ activeBackground: buildBackground('Cached map') })} />
    );

    expect(await screen.findByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '0');

    rerender(
      <GrigliataBoard {...buildProps({ activeBackground: buildBackground('Hydrated map') })} />
    );

    await act(async () => {
      jest.advanceTimersByTime(240);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();
  });

  test('loads the canonical full-quality original through an authenticated active-board lease', async () => {
    useReducedMotion.mockReturnValue(true);
    const storage = { name: 'authenticated-storage' };
    const ref = jest.fn((_storage, path) => ({ path }));
    const getBlob = jest.fn(async () => new Blob(['data'], { type: 'image/png' }));
    __configurePrivateMediaAssetsForTests({
      loadStorageApi: jest.fn(async () => ({ storage, ref, getBlob })),
      createObjectURL: jest.fn(() => 'blob:private-board-original'),
      revokeObjectURL: jest.fn(),
    });
    const assetId = `m_${'d'.repeat(40)}`;
    const original = {
      path: `media_assets/v1/signed-in/dm/${assetId}/17/original`,
      generation: '301',
      bytes: 4,
      contentType: 'image/png',
      width: 3840,
      height: 2160,
    };

    render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-private',
            name: 'Private Board',
            imageWidth: 0,
            imageHeight: 0,
            media: {
              schemaVersion: 1,
              state: 'ready',
              kind: 'map',
              original,
              variants: {},
            },
          },
        })}
      />
    );

    const activeImage = await screen.findByTestId('battlemap-image-active');
    expect(getBlob).toHaveBeenCalledTimes(1);
    expect(getBlob).toHaveBeenCalledWith({ path: original.path }, original.bytes);
    expect(useImageAssetSnapshot).toHaveBeenCalledWith('blob:private-board-original');
    expect(activeImage).toHaveAttribute('data-width', '3840');
    expect(activeImage).toHaveAttribute('data-height', '2160');
    expect(__getImageAssetRegistryStats().namedPins).toEqual([
      IMAGE_ASSET_PIN_NAMES.ACTIVE_BOARD,
    ]);
  });

  test('draws decoded frames and paused seeks on only the video background layer', async () => {
    useReducedMotion.mockReturnValue(true);
    const storage = { name: 'authenticated-storage' };
    const ref = jest.fn((_storage, path) => ({ path }));
    const getBlob = jest.fn(async () => new Blob(['data'], { type: 'video/mp4' }));
    __configurePrivateMediaAssetsForTests({
      loadStorageApi: jest.fn(async () => ({ storage, ref, getBlob })),
      createObjectURL: jest.fn(() => 'blob:private-battlemap-video'),
      revokeObjectURL: jest.fn(),
    });
    const originalCreateElement = document.createElement.bind(document);
    const listeners = {};
    const mockVideo = {
      videoWidth: 2040,
      videoHeight: 1620,
      paused: false,
      requestVideoFrameCallback: jest.fn(() => 12),
      cancelVideoFrameCallback: jest.fn(),
      muted: false,
      defaultMuted: false,
      loop: false,
      playsInline: false,
      autoplay: false,
      preload: '',
      src: '',
      addEventListener: jest.fn((eventName, handler) => {
        listeners[eventName] = handler;
      }),
      removeEventListener: jest.fn(),
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
      load: jest.fn(),
      removeAttribute: jest.fn(),
    };
    const createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockImplementation((tagName, options) => (
        tagName === 'video'
          ? mockVideo
          : originalCreateElement(tagName, options)
      ));

    try {
      const assetId = `m_${'e'.repeat(40)}`;
      const original = {
        path: `media_assets/v1/signed-in/dm/${assetId}/18/original`,
        generation: '401',
        bytes: 4,
        contentType: 'video/mp4',
        width: 2040,
        height: 1620,
      };
      const { unmount } = render(
        <GrigliataBoard
          {...buildProps({
            activeBackground: {
              id: 'map-video',
              name: 'Dungeon Alchemist Loop',
              imageWidth: 2040,
              imageHeight: 1620,
              assetType: 'video',
              media: {
                schemaVersion: 1,
                state: 'ready',
                kind: 'map-video',
                original,
              },
            },
          })}
        />
      );

      await waitFor(() => {
        expect(mockVideo.src).toBe('blob:private-battlemap-video');
      });
      await act(async () => {
        listeners.loadeddata();
      });

      expect(useImageAssetSnapshot).toHaveBeenCalledWith('');
      expect(mockVideo.muted).toBe(true);
      expect(mockVideo.defaultMuted).toBe(true);
      expect(mockVideo.loop).toBe(true);
      expect(mockVideo.playsInline).toBe(true);
      expect(mockVideo.autoplay).toBe(true);
      expect(mockVideo.play).toHaveBeenCalled();
      expect(getBlob).toHaveBeenCalledWith({ path: original.path }, original.bytes);

      const activeVideoLayer = screen.getByTestId('battlemap-image-active');
      expect(activeVideoLayer).toHaveAttribute('data-asset-type', 'video');
      expect(activeVideoLayer).toHaveAttribute('data-width', '2040');
      expect(activeVideoLayer).toHaveAttribute('data-height', '1620');

      const backgroundLayer = activeVideoLayer.getLayer();
      const stage = activeVideoLayer.closest('[data-konva-type="Stage"]');
      stage.batchDraw = jest.fn();
      const otherLayers = Array.from(stage.children).filter((layer) => layer !== backgroundLayer);
      expect(mockVideo.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
      mockVideo.requestVideoFrameCallback.mock.calls[0][0]();
      expect(mockVideo.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
      mockVideo.paused = true;
      mockVideo.requestVideoFrameCallback.mock.calls[1][0]();
      listeners.seeked();
      expect(backgroundLayer.batchDraw).toHaveBeenCalledTimes(3);
      expect(mockVideo.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
      expect(stage.batchDraw).not.toHaveBeenCalled();
      otherLayers.forEach((layer) => expect(layer.batchDraw).not.toHaveBeenCalled());

      mockVideo.paused = false;
      listeners.playing();
      expect(mockVideo.requestVideoFrameCallback).toHaveBeenCalledTimes(3);
      unmount();
      expect(mockVideo.cancelVideoFrameCallback).toHaveBeenCalledWith(12);
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('seeked', listeners.seeked);
    } finally {
      createElementSpy.mockRestore();
    }
  });

  test('resolves a canonical MP4 narration placement without changing narration layout', async () => {
    jest.useFakeTimers();
    useReducedMotion.mockReturnValue(true);
    const storage = { name: 'authenticated-storage' };
    const ref = jest.fn((_storage, path) => ({ path }));
    const getBlob = jest.fn(async () => new Blob(['data'], { type: 'video/mp4' }));
    __configurePrivateMediaAssetsForTests({
      loadStorageApi: jest.fn(async () => ({ storage, ref, getBlob })),
      createObjectURL: jest.fn(() => 'blob:private-narration-video'),
      revokeObjectURL: jest.fn(),
    });
    const originalCreateElement = document.createElement.bind(document);
    const listeners = {};
    const mockVideo = {
      videoWidth: 1920,
      videoHeight: 1080,
      paused: true,
      muted: false,
      defaultMuted: false,
      loop: false,
      playsInline: false,
      autoplay: false,
      preload: '',
      src: '',
      addEventListener: jest.fn((eventName, handler) => {
        listeners[eventName] = handler;
      }),
      removeEventListener: jest.fn(),
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
      load: jest.fn(),
      removeAttribute: jest.fn(),
    };
    const createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockImplementation((tagName, options) => (
        tagName === 'video'
          ? mockVideo
          : originalCreateElement(tagName, options)
      ));

    try {
      const assetId = `m_${'f'.repeat(40)}`;
      const original = {
        path: `media_assets/v1/signed-in/dm/${assetId}/19/original`,
        generation: '501',
        bytes: 4,
        contentType: 'video/mp4',
        width: 1920,
        height: 1080,
      };
      render(
        <GrigliataBoard
          {...buildProps({
            activeBackground: {
              id: 'map-1',
              name: 'Sunken Ruins',
              imageUrl: 'https://example.com/map-1.png',
              imageWidth: 1280,
              imageHeight: 720,
            },
            isNarrationOverlayActive: true,
            narrationBackgrounds: [{
              id: 'map-1',
              name: 'Sunken Ruins',
              imageUrl: 'https://example.com/map-1.png',
              imageWidth: 1280,
              imageHeight: 720,
            }, {
              id: 'map-video-private',
              name: 'Private Narration Video',
              assetType: 'video',
              imageWidth: 1920,
              imageHeight: 1080,
              media: {
                schemaVersion: 1,
                state: 'ready',
                kind: 'map-video',
                original,
              },
            }],
            narrationPlacements: [{
              id: 'background:map-1',
              backgroundId: 'map-1',
              x: 0,
              y: 0,
              width: 1280,
              height: 720,
              order: 0,
              mode: 'free',
              attachedSide: '',
            }, {
              id: 'background:map-video-private',
              backgroundId: 'map-video-private',
              x: 1280,
              y: 0,
              width: 1920,
              height: 1080,
              order: 1,
              mode: 'magnetic',
              attachedSide: 'right',
            }],
          })}
        />
      );

      await waitFor(() => {
        expect(mockVideo.src).toBe('blob:private-narration-video');
      });
      await act(async () => {
        listeners.loadeddata();
      });

      const narrationVideo = screen.getByTestId(
        'narration-image-placement-background:map-video-private'
      );
      expect(narrationVideo).toHaveAttribute('data-asset-type', 'video');
      expect(narrationVideo).toHaveAttribute('data-x', '1280');
      expect(narrationVideo).toHaveAttribute('data-width', '1920');
      expect(getBlob).toHaveBeenCalledWith({ path: original.path }, original.bytes);

      const backgroundLayer = narrationVideo.getLayer();
      mockVideo.paused = false;
      listeners.playing();
      act(() => jest.advanceTimersByTime(32));
      expect(backgroundLayer.batchDraw).toHaveBeenCalledTimes(2);
      mockVideo.paused = true;
      act(() => jest.advanceTimersByTime(100));
      expect(backgroundLayer.batchDraw).toHaveBeenCalledTimes(3);
      listeners.seeked();
      expect(backgroundLayer.batchDraw).toHaveBeenCalledTimes(4);
    } finally {
      createElementSpy.mockRestore();
    }
  });

  test('resolves a canonical-only token thumbnail through an authenticated lease', async () => {
    const storage = { name: 'authenticated-storage' };
    const ref = jest.fn((_storage, path) => ({ path }));
    const getBlob = jest.fn(async () => new Blob(['data'], { type: 'image/webp' }));
    __configurePrivateMediaAssetsForTests({
      loadStorageApi: jest.fn(async () => ({ storage, ref, getBlob })),
      createObjectURL: jest.fn(() => 'blob:private-token-thumbnail'),
      revokeObjectURL: jest.fn(),
    });
    const thumbnail = {
      path: `media_assets/v1/signed-in/user/m_${'a'.repeat(40)}/20/thumbnail`,
      generation: '1',
      bytes: 4,
      contentType: 'image/webp',
      width: 96,
      height: 96,
    };

    render(
      <GrigliataBoard
        {...buildProps({
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            imageUrl: '',
            media: {
              kind: 'avatar',
              schemaVersion: 1,
              state: 'ready',
              variants: { thumbnail },
            },
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

    await waitFor(() => {
      expect(getBlob).toHaveBeenCalledWith({ path: thumbnail.path }, thumbnail.bytes);
      expect(useImageAssetSnapshot).toHaveBeenCalledWith(
        'blob:private-token-thumbnail',
        { maxEdge: TOKEN_PORTRAIT_MAX_DRAWABLE_EDGE }
      );
    });
    expect(screen.getByTestId('token-node-user-1')).toBeInTheDocument();
  });

  describe('token portraits under shared media budgets', () => {
    const originalWindowImage = window.Image;
    const originalInnerWidth = window.innerWidth;
    const actualUseImageAsset = jest.requireActual('../common/imageAssets/useImageAsset');
    let sizeByPath;
    let removedImageSources;

    const pathFromSrc = (src) => (
      src.startsWith('blob:fnd-test/') ? src.split('/').slice(2).join('/') : src
    );

    class SizedFakeImage {
      constructor() {
        this.complete = false;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }

      set src(value) {
        this._src = value;
        if (!value) return;
        Promise.resolve().then(() => {
          if (this._src !== value) return;
          const [width, height] = sizeByPath.get(pathFromSrc(value)) || [64, 64];
          this.complete = true;
          this.naturalWidth = width;
          this.naturalHeight = height;
          this.onload?.();
        });
      }

      get src() {
        return this._src;
      }

      removeAttribute(name) {
        if (name !== 'src') return;
        removedImageSources.push(this._src);
        this._src = '';
      }
    }

    let boundedDrawableCount = 0;
    const createTestDrawable = (image, { maxEdge }) => {
      boundedDrawableCount += 1;
      const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
      return {
        testDrawable: 'bounded-canvas',
        width: Math.round(image.naturalWidth * scale),
        height: Math.round(image.naturalHeight * scale),
        dataset: {},
      };
    };

    const configurePrivateStorage = (overrides = {}) => {
      const blobPaths = new WeakMap();
      const contentTypeByPath = new Map();
      let objectUrlCount = 0;
      const getBlob = jest.fn(async (objectRef, bytes) => {
        const blob = new Blob(['x'.repeat(bytes)], {
          type: contentTypeByPath.get(objectRef.path),
        });
        blobPaths.set(blob, objectRef.path);
        return blob;
      });
      const revokeObjectURL = jest.fn();
      __configurePrivateMediaAssetsForTests({
        loadStorageApi: jest.fn(async () => ({
          storage: { name: 'authenticated-storage' },
          ref: (_storage, path) => ({ path }),
          getBlob,
        })),
        createObjectURL: jest.fn((blob) => {
          objectUrlCount += 1;
          return `blob:fnd-test/${objectUrlCount}/${blobPaths.get(blob)}`;
        }),
        revokeObjectURL,
        ...overrides,
      });
      const register = (descriptor) => {
        contentTypeByPath.set(descriptor.path, descriptor.contentType);
        sizeByPath.set(descriptor.path, [descriptor.width, descriptor.height]);
        return descriptor;
      };
      return { getBlob, register, revokeObjectURL };
    };

    const privateDescriptor = (id, name, overrides = {}) => ({
      path: `media_assets/v1/signed-in/user/m_${id.repeat(40).slice(0, 40)}/7/${name}`,
      generation: '42',
      bytes: 4,
      contentType: name === 'original' ? 'image/png' : 'image/webp',
      width: 96,
      height: 96,
      ...overrides,
    });

    const buildPortraitToken = (tokenId, index, overrides = {}) => ({
      tokenId,
      id: tokenId,
      ownerUid: 'another-user',
      tokenType: 'character',
      label: `Hero ${tokenId}`,
      imageUrl: '',
      placed: true,
      col: index,
      row: 0,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
      ...overrides,
    });

    const getPortraitNode = (tokenId) => (
      screen.getByTestId(`token-node-${tokenId}`).querySelector('[data-name="token-portrait"]')
    );

    const expectEveryPortrait = async (tokens, timeout = 4000) => {
      await waitFor(() => {
        tokens.forEach(({tokenId}) => {
          expect(getPortraitNode(tokenId)).not.toBeNull();
          expect(
            screen.getByTestId(`token-node-${tokenId}`)
              .querySelector('[data-name="token-portrait-placeholder"]')
          ).toBeNull();
        });
      }, { timeout });
    };

    const getTokenPortraitRegistryStats = () => __getImageAssetRegistryStats();

    // Records the props the board hands each TokenNode (calls through).
    const spyOnTokenNodes = () => jest.spyOn(grigliataBoardTokenUiModule, 'TokenNode');
    const getLatestTokenNodeProps = (tokenNodeSpy) => {
      const latest = new Map();
      tokenNodeSpy.mock.calls.forEach(([props]) => latest.set(props.token.tokenId, props));
      return latest;
    };
    const getPassedPortraitEdges = (tokenNodeSpy) => (
      new Set(tokenNodeSpy.mock.calls.map(([props]) => props.portraitMaxEdge))
    );

    const useCompactRuntime = () => {
      window.innerWidth = 390;
      __resetImageAssetRegistry();
      __configureImageAssetRegistryForTests({ createBoundedDrawable: createTestDrawable });
      __resetPrivateMediaAssetsForTests();
    };

    const HUGE_MAP_URL = 'https://example.com/legacy-9000-map.png';
    const HUGE_MAP_BYTES = 9000 * 9000 * 4;
    const buildHugeMapBoard = ({ tokenCount = 100, columns = 10, mapEdge = 9000, ...overrides } = {}) => {
      const lowZoomGrid = buildGridConfig(50);
      sizeByPath.set(HUGE_MAP_URL, [mapEdge, mapEdge]);
      const tokens = Array.from({ length: tokenCount }, (_, index) => {
        const imageUrl = `https://example.com/legacy-9000-portrait-${index}.png`;
        sizeByPath.set(imageUrl, [1024, 1024]);
        return buildPortraitToken(`legacy-9000-${index}`, index, {
          imageUrl,
          col: index % columns,
          row: Math.floor(index / columns),
        });
      });
      return {
        tokens,
        props: buildProps({
          grid: lowZoomGrid,
          activeBackground: {
            id: 'map-legacy-9000',
            name: 'Legacy 9000',
            imageUrl: HUGE_MAP_URL,
            imageWidth: mapEdge,
            imageHeight: mapEdge,
            grid: lowZoomGrid,
          },
          tokens,
          ...overrides,
        }),
      };
    };

    beforeEach(() => {
      sizeByPath = new Map();
      removedImageSources = [];
      boundedDrawableCount = 0;
      window.Image = SizedFakeImage;
      useReducedMotion.mockReturnValue(true);
      useImageAssetSnapshot.mockImplementation(actualUseImageAsset.useImageAssetSnapshot);
      __configureImageAssetRegistryForTests({ createBoundedDrawable: createTestDrawable });
    });

    afterEach(() => {
      window.Image = originalWindowImage;
      window.innerWidth = originalInnerWidth;
    });

    test('displays every valid private-only portrait beside an active map that exhausts the byte budget', async () => {
      const capacitySubscribeSpy = jest.spyOn(privateMediaAssetsModule, 'subscribePrivateMediaCapacity');
      try {
        // Injectable small budget: 8-byte map + 9 x 4-byte portraits = 44 > 32.
        const { getBlob, register } = configurePrivateStorage({
          maxCacheBytes: 32,
          maxActiveFetches: 2,
          // Isolate release-after-decode + capacity retry from the lane.
          maxTransientPortraitBytes: 0,
        });
        const mapOriginal = register(privateDescriptor('a', 'original', {
          bytes: 8,
          width: 3840,
          height: 2160,
        }));
        const privateMap = {
          id: 'map-private-budget',
          name: 'Private Budget Map',
          imageWidth: 0,
          imageHeight: 0,
          media: {
            schemaVersion: 1,
            state: 'ready',
            kind: 'map',
            original: mapOriginal,
            variants: {},
          },
        };
        const ids = ['b', 'c', 'd', 'e', 'f', '1', '2', '3', '4'];
        const tokens = ids.map((id, index) => {
          if (index < 6) {
            // Private legacy original (non-v1 manifest), no public fallback URL.
            const original = register(privateDescriptor(id, 'original', {
              width: 2048,
              height: 2048,
            }));
            return buildPortraitToken(`legacy-original-${id}`, index, {
              media: { kind: 'avatar', original },
            });
          }
          // Canonical-only v1 thumbnail, no legacy fallback URL.
          const thumbnail = register(privateDescriptor(id, 'thumbnail'));
          return buildPortraitToken(`canonical-thumb-${id}`, index, {
            media: {
              kind: 'avatar',
              schemaVersion: 1,
              state: 'ready',
              variants: { thumbnail },
            },
          });
        });

        const { rerender, unmount } = render(
          <GrigliataBoard {...buildProps({ activeBackground: privateMap })} />
        );
        await screen.findByTestId('battlemap-image-active');
        rerender(<GrigliataBoard {...buildProps({ activeBackground: privateMap, tokens })} />);

        await expectEveryPortrait(tokens);

        // Pressure was exercised, and each consumer waited a bounded number of
        // times (capacity notifications, not polling or a retry storm).
        expect(capacitySubscribeSpy.mock.calls.length).toBeGreaterThan(0);
        expect(capacitySubscribeSpy.mock.calls.length).toBeLessThanOrEqual(tokens.length * tokens.length);
        // Exactly one authenticated download per immutable generation.
        expect(getBlob).toHaveBeenCalledTimes(1 + tokens.length);
        expect(new Set(getBlob.mock.calls.map(([objectRef]) => objectRef.path)).size)
          .toBe(1 + tokens.length);
        getBlob.mock.calls.forEach(([objectRef, bytes]) => {
          expect(bytes).toBe(objectRef.path === mapOriginal.path ? 8 : 4);
        });

        const settled = getPrivateMediaAssetCacheSnapshot();
        expect(settled).toMatchObject({
          activeFetches: 0,
          queuedFetches: 0,
          reservedBytes: 0,
          capacityWaiterCount: 0,
        });
        expect(settled.cachedBytes).toBeLessThanOrEqual(32);
        // Only the active map keeps a lease; portraits released theirs once decoded.
        expect(settled.records.filter(({refCount}) => refCount > 0).map(({path}) => path))
          .toEqual([mapOriginal.path]);
        expect(settled.records.every(({status}) => status === 'ready')).toBe(true);

        // Oversized private originals keep a bounded drawable; thumbnails keep their image.
        expect(boundedDrawableCount).toBe(6);
        expect(getTokenPortraitRegistryStats()).toMatchObject({
          boundedRecordCount: tokens.length,
          activeRequestCount: 0,
          queuedRequestCount: 0,
        });

        // No retry loop keeps running after everything is displayed.
        const subscribeCount = capacitySubscribeSpy.mock.calls.length;
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(getBlob).toHaveBeenCalledTimes(1 + tokens.length);
        expect(capacitySubscribeSpy).toHaveBeenCalledTimes(subscribeCount);

        unmount();
        const released = getPrivateMediaAssetCacheSnapshot();
        expect(released.capacityWaiterCount).toBe(0);
        expect(
          released.records.filter(({path, refCount}) => path !== mapOriginal.path && refCount > 0)
        ).toEqual([]);
      } finally {
        capacitySubscribeSpy.mockRestore();
      }
    });

    test.each([
      { label: '31 of 32', backgroundBytes: 31 },
      { label: 'exactly 32 of 32', backgroundBytes: 32 },
    ])('displays private-only portraits while an on-screen background holds $label bytes', async ({
      backgroundBytes,
    }) => {
      // Injected small numbers: 32-byte budget, a 2-byte transient lane, and
      // 2-byte portraits (a "2 MiB portrait beside a 31 MiB map").
      const { getBlob, register } = configurePrivateStorage({
        maxCacheBytes: 32,
        maxActiveFetches: 2,
        maxTransientPortraitBytes: 2,
      });
      const mapOriginal = register(privateDescriptor('a', 'original', {
        bytes: backgroundBytes,
        width: 3840,
        height: 2160,
      }));
      const privateMap = {
        id: 'map-private-full',
        name: 'Private Full Map',
        imageWidth: 0,
        imageHeight: 0,
        media: {
          schemaVersion: 1,
          state: 'ready',
          kind: 'map',
          original: mapOriginal,
          variants: {},
        },
      };
      const tokens = ['b', 'c', 'd'].map((id, index) => {
        const thumbnail = register(privateDescriptor(id, 'thumbnail', { bytes: 2 }));
        return buildPortraitToken(`full-budget-${id}`, index, {
          media: {
            kind: 'avatar',
            schemaVersion: 1,
            state: 'ready',
            variants: { thumbnail },
          },
        });
      });

      const { rerender } = render(
        <GrigliataBoard {...buildProps({ activeBackground: privateMap })} />
      );
      await screen.findByTestId('battlemap-image-active');
      expect(getPrivateMediaAssetCacheSnapshot().cachedBytes).toBe(backgroundBytes);
      rerender(<GrigliataBoard {...buildProps({ activeBackground: privateMap, tokens })} />);

      await expectEveryPortrait(tokens);
      // The background stayed on screen with its lease the whole time.
      expect(screen.getByTestId('battlemap-image-active')).toBeInTheDocument();
      expect(getBlob).toHaveBeenCalledTimes(1 + tokens.length);
      await waitFor(() => {
        expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
          activeFetches: 0,
          queuedFetches: 0,
          reservedBytes: 0,
          capacityWaiterCount: 0,
          // Portraits released after decode, so the transient overage drained.
          transientOverageBytes: 0,
          cachedBytes: backgroundBytes,
        });
      });
      expect(getPrivateMediaAssetCacheSnapshot().records).toEqual([
        expect.objectContaining({ path: mapOriginal.path, refCount: 1, status: 'ready' }),
      ]);
    });

    test('keeps 100 visible 1024px legacy portraits within the total decoded budget', async () => {
      const tokenNodeSpy = spyOnTokenNodes();
      const lowZoomGrid = buildGridConfig(50);
      const mapUrl = 'https://example.com/legacy-budget-map.png';
      sizeByPath.set(mapUrl, [5000, 5000]);
      const tokens = Array.from({ length: 100 }, (_, index) => {
        const imageUrl = `https://example.com/legacy-portrait-${index}.png`;
        sizeByPath.set(imageUrl, [1024, 1024]);
        return buildPortraitToken(`legacy-url-${index}`, index, {
          imageUrl,
          col: index % 10,
          row: Math.floor(index / 10),
        });
      });

      render(
        <GrigliataBoard
          {...buildProps({
            grid: lowZoomGrid,
            activeBackground: {
              id: 'map-legacy-budget',
              name: 'Legacy Budget',
              imageUrl: mapUrl,
              imageWidth: 5000,
              imageHeight: 5000,
              grid: lowZoomGrid,
            },
            tokens,
          })}
        />
      );

      await expectEveryPortrait(tokens);
      const stats = getTokenPortraitRegistryStats();
      const mapBytes = 5000 * 5000 * 4;
      expect(stats.boundedRecordCount).toBe(100);
      expect(stats.decodedBytes - mapBytes)
        .toBe(100 * TOKEN_PORTRAIT_MAX_DRAWABLE_EDGE * TOKEN_PORTRAIT_MAX_DRAWABLE_EDGE * 4);
      // 100 x 1024^2 x 4 = 400 MiB of portraits alone used to exceed this cap.
      expect(stats.decodedBytes).toBeLessThanOrEqual(stats.limits.maxTotalDecodedBytes);
      expect(removedImageSources.sort()).toEqual(tokens.map(({imageUrl}) => imageUrl).sort());
      // A normal map within budget keeps the full portrait edge, unchanged.
      expect(TOKEN_PORTRAIT_EDGE_TIERS[0]).toBe(TOKEN_PORTRAIT_MAX_DRAWABLE_EDGE);
      expect(getPassedPortraitEdges(tokenNodeSpy)).toEqual(new Set([TOKEN_PORTRAIT_MAX_DRAWABLE_EDGE]));
      const latest = getLatestTokenNodeProps(tokenNodeSpy);
      expect(latest.size).toBe(100);
      tokens.forEach(({tokenId}) => {
        expect(latest.get(tokenId)).toMatchObject({
          loadMedia: true,
          portraitMaxEdge: TOKEN_PORTRAIT_MAX_DRAWABLE_EDGE,
        });
      });
      tokenNodeSpy.mockRestore();
    });

    test.each([
      { profile: 'desktop', mapEdge: 9000, expectedEdge: 384 },
      { profile: 'compact', mapEdge: 9000, expectedEdge: 128 },
      { profile: 'compact', mapEdge: 9150, expectedEdge: 32 },
    ])('budgets a $mapEdge px map with 100 distinct 1024px portraits at $expectedEdge px on $profile', async ({
      profile,
      mapEdge,
      expectedEdge,
    }) => {
      if (profile === 'compact') useCompactRuntime();
      const limits = getImageAssetRegistryRuntimeLimits();
      expect(limits.profile).toBe(profile);
      expect(getPrivateMediaAssetCacheSnapshot().profile).toBe(profile);
      const mapBytes = getDecodedImageBytes(mapEdge, mapEdge);
      expect(mapBytes + (100 * getTokenPortraitDecodedBytes(512)))
        .toBeGreaterThan(limits.maxTotalDecodedBytes);

      const tokenNodeSpy = spyOnTokenNodes();
      try {
        const { tokens, props } = buildHugeMapBoard({mapEdge});
        render(<GrigliataBoard {...props} />);

        await expectEveryPortrait(tokens, 8000);
        expect(screen.getByTestId('battlemap-image-active')).toBeInTheDocument();
        const latest = getLatestTokenNodeProps(tokenNodeSpy);
        expect(latest.size).toBe(100);
        tokens.forEach(({tokenId}) => {
          // Never excluded: every visible token loads, at the budgeted edge.
          expect(latest.get(tokenId)).toMatchObject({ loadMedia: true, portraitMaxEdge: expectedEdge });
        });
        // Stable from the first render (map metadata is known up front):
        // no 512 -> smaller re-key while the map decodes.
        expect(getPassedPortraitEdges(tokenNodeSpy)).toEqual(new Set([expectedEdge]));

        const budgetedTotal = mapBytes + (100 * getTokenPortraitDecodedBytes(expectedEdge));
        const registry = getTokenPortraitRegistryStats();
        expect(registry.boundedRecordCount).toBe(tokens.length);
        expect(registry.decodedBytes).toBe(budgetedTotal);
        expect(registry.decodedBytes).toBeLessThanOrEqual(limits.maxTotalDecodedBytes);
        // Highest tier that fits: adequate resolution, not needless pessimism.
        const higherTier = TOKEN_PORTRAIT_EDGE_TIERS[TOKEN_PORTRAIT_EDGE_TIERS.indexOf(expectedEdge) - 1];
        expect(mapBytes + (100 * getTokenPortraitDecodedBytes(higherTier)))
          .toBeGreaterThan(limits.maxTotalDecodedBytes);
        expect(registry.namedPins).toContain(IMAGE_ASSET_PIN_NAMES.ACTIVE_BOARD);
      } finally {
        tokenNodeSpy.mockRestore();
      }
    });

    test('keeps the 9000px portrait edge stable across zoom, pan and resize without permanent blanks', async () => {
      const tokenNodeSpy = spyOnTokenNodes();
      try {
        const { tokens, props } = buildHugeMapBoard();
        render(<GrigliataBoard {...props} />);
        await expectEveryPortrait(tokens, 8000);

        const stage = document.querySelector('[data-konva-type="Stage"]');
        const fittedScale = Number(stage.getAttribute('data-scalex'));
        for (let step = 0; step < 12; step += 1) {
          fireEvent.wheel(stage, { deltaY: -120 });
        }
        expect(Number(stage.getAttribute('data-scalex'))).toBeGreaterThan(fittedScale * 4);
        // Zoomed in: some portraits leave the viewport (and release), none re-key.
        await waitFor(() => {
          const latest = getLatestTokenNodeProps(tokenNodeSpy);
          expect(tokens.some(({tokenId}) => latest.get(tokenId).loadMedia === false)).toBe(true);
        });

        getBoundingClientRectSpy.mockImplementation(() => ({
          width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720,
        }));
        act(() => {
          resizeObserverInstance.callback([]);
        });
        for (let step = 0; step < 40; step += 1) {
          fireEvent.wheel(stage, { deltaY: 120 });
        }

        // Back at an overview: every portrait is shown again.
        await expectEveryPortrait(tokens, 8000);
        const latest = getLatestTokenNodeProps(tokenNodeSpy);
        tokens.forEach(({tokenId}) => {
          expect(latest.get(tokenId)).toMatchObject({ loadMedia: true, portraitMaxEdge: 384 });
        });
        expect(getPassedPortraitEdges(tokenNodeSpy)).toEqual(new Set([384]));
      } finally {
        tokenNodeSpy.mockRestore();
      }
    });

    test('drops to the compact tier when a resize switches the runtime profile', async () => {
      const tokenNodeSpy = spyOnTokenNodes();
      try {
        const { tokens, props } = buildHugeMapBoard({tokenCount: 40});
        render(<GrigliataBoard {...props} />);
        await expectEveryPortrait(tokens, 8000);
        expect(getPassedPortraitEdges(tokenNodeSpy)).toEqual(new Set([512]));

        window.innerWidth = 390;
        getBoundingClientRectSpy.mockImplementation(() => ({
          width: 390, height: 844, top: 0, left: 0, right: 390, bottom: 844,
        }));
        act(() => {
          window.dispatchEvent(new Event('resize'));
          resizeObserverInstance.callback([]);
        });

        await waitFor(() => {
          const latest = getLatestTokenNodeProps(tokenNodeSpy);
          tokens.forEach(({tokenId}) => {
            expect(latest.get(tokenId).portraitMaxEdge).toBe(256);
          });
        });
        const compactLimits = getImageAssetRegistryRuntimeLimits({ compact: true });
        await waitFor(() => {
          const registry = getTokenPortraitRegistryStats();
          expect(registry.limits.profile).toBe('compact');
          expect(registry.decodedBytes).toBeGreaterThanOrEqual(HUGE_MAP_BYTES + (40 * getTokenPortraitDecodedBytes(256)));
          expect(registry.decodedBytes).toBeLessThanOrEqual(compactLimits.maxTotalDecodedBytes);
        }, {timeout: 7000});
        await expectEveryPortrait(tokens, 8000);
      } finally {
        tokenNodeSpy.mockRestore();
      }
    });

    test('resizes loaded portraits when Save-Data changes without a viewport resize', async () => {
      const original = Object.getOwnPropertyDescriptor(navigator, 'connection');
      const connection = Object.assign(new EventTarget(), {saveData: false});
      Object.defineProperty(navigator, 'connection', {configurable: true, value: connection});
      const tokenNodeSpy = spyOnTokenNodes();
      try {
        const {tokens, props} = buildHugeMapBoard({tokenCount: 40});
        const view = render(<GrigliataBoard {...props} />);
        await expectEveryPortrait(tokens);
        expect(getPassedPortraitEdges(tokenNodeSpy)).toEqual(new Set([512]));
        act(() => {
          connection.saveData = true;
          connection.dispatchEvent(new Event('change'));
        });
        await waitFor(() => {
          const registry = getTokenPortraitRegistryStats();
          expect(registry.limits.profile).toBe('compact');
          const latest = getLatestTokenNodeProps(tokenNodeSpy);
          tokens.forEach(({tokenId}) => expect(latest.get(tokenId).portraitMaxEdge).toBe(256));
          expect(registry.decodedBytes).toBeLessThanOrEqual(registry.limits.maxTotalDecodedBytes);
        }, {timeout: 7000});
        await expectEveryPortrait(tokens);
        view.unmount();
      } finally {
        tokenNodeSpy.mockRestore();
        if (original) Object.defineProperty(navigator, 'connection', original);
        else delete navigator.connection;
      }
    });

    test('degrades to the floor edge, never a blank, when a compact map alone exceeds the budget', async () => {
      useCompactRuntime();
      const tokenNodeSpy = spyOnTokenNodes();
      try {
        const lowZoomGrid = buildGridConfig(50);
        const mapUrl = 'https://example.com/legacy-9600-map.png';
        sizeByPath.set(mapUrl, [9600, 9600]);
        expect(getDecodedImageBytes(9600, 9600))
          .toBeGreaterThan(getImageAssetRegistryRuntimeLimits().maxTotalDecodedBytes);
        const tokens = Array.from({ length: 12 }, (_, index) => {
          const imageUrl = `https://example.com/legacy-9600-portrait-${index}.png`;
          sizeByPath.set(imageUrl, [1024, 1024]);
          return buildPortraitToken(`legacy-9600-${index}`, index, { imageUrl });
        });
        render(
          <GrigliataBoard
            {...buildProps({
              grid: lowZoomGrid,
              activeBackground: {
                id: 'map-legacy-9600',
                name: 'Legacy 9600',
                imageUrl: mapUrl,
                imageWidth: 9600,
                imageHeight: 9600,
                grid: lowZoomGrid,
              },
              tokens,
            })}
          />
        );

        await expectEveryPortrait(tokens, 8000);
        expect(getPassedPortraitEdges(tokenNodeSpy)).toEqual(new Set([64]));
      } finally {
        tokenNodeSpy.mockRestore();
      }
    });

    test.each([
      { roleLabel: 'player', isManager: false, expectedEdge: 384, expectedCount: 101 },
      { roleLabel: 'manager', isManager: true, expectedEdge: 256, expectedCount: 141 },
    ])('budgets only portraits the $roleLabel can see under fog', async ({
      isManager,
      expectedEdge,
      expectedCount,
    }) => {
      const tokenNodeSpy = spyOnTokenNodes();
      try {
        // 140 distinct portraits: 100 in currently visible cells, 40 fogged.
        const { tokens: boardTokens, props } = buildHugeMapBoard({ tokenCount: 140 });
        const visibleTokens = boardTokens.slice(0, 100);
        const foggedTokens = boardTokens.slice(100);
        // The player's own main token stands in fog: it renders above the fog
        // layer (the second TokenNode usage) and still gets the budgeted edge.
        const ownUrl = 'https://example.com/legacy-9000-own.png';
        sizeByPath.set(ownUrl, [1024, 1024]);
        const ownToken = buildPortraitToken('player-user', 0, {
          ownerUid: 'player-user',
          imageUrl: ownUrl,
          col: 3,
          row: 15,
        });
        const tokens = [...boardTokens, ownToken];
        render(
          <GrigliataBoard
            {...props}
            tokens={tokens}
            isManager={isManager}
            currentUserId={isManager ? 'dm-user' : 'player-user'}
            fogOfWar={{
              exploredCells: [],
              currentVisibleCells: visibleTokens.map(({col, row}) => `${col}:${row}`),
            }}
          />
        );

        const expectedTokens = isManager ? tokens : [...visibleTokens, ownToken];
        await expectEveryPortrait(expectedTokens, 10000);
        const latest = getLatestTokenNodeProps(tokenNodeSpy);
        expect(latest.size).toBe(expectedCount);
        expectedTokens.forEach(({tokenId}) => {
          expect(latest.get(tokenId)).toMatchObject({ loadMedia: true, portraitMaxEdge: expectedEdge });
        });
        // Fogged portraits are neither rendered nor budgeted for the player.
        foggedTokens.forEach(({tokenId}) => {
          expect(screen.queryByTestId(`token-node-${tokenId}`) !== null).toBe(isManager);
        });
        expect(getPassedPortraitEdges(tokenNodeSpy)).toEqual(new Set([expectedEdge]));
        expect(HUGE_MAP_BYTES + (expectedCount * getTokenPortraitDecodedBytes(expectedEdge)))
          .toBeLessThanOrEqual(getImageAssetRegistryRuntimeLimits().maxTotalDecodedBytes);
      } finally {
        tokenNodeSpy.mockRestore();
      }
    });

    test('shows a canonical-only 96px portrait beside a compact 9600px private map', async () => {
      window.innerWidth = 390;
      __resetImageAssetRegistry();
      __configureImageAssetRegistryForTests({ createBoundedDrawable: createTestDrawable });
      const { getBlob, register } = configurePrivateStorage();
      expect(getPrivateMediaAssetCacheSnapshot().profile).toBe('compact');
      const mapOriginal = register(privateDescriptor('5', 'original', {
        bytes: 30,
        width: 9600,
        height: 9600,
      }));
      // The map alone exceeds the compact total decoded cap.
      expect(9600 * 9600 * 4).toBeGreaterThan(getPrivateMediaAssetCacheSnapshot().maxTotalDecodedBytes);
      const thumbnail = register(privateDescriptor('6', 'thumbnail'));
      const privateMap = {
        id: 'map-compact-huge',
        name: 'Compact Huge Map',
        imageWidth: 0,
        imageHeight: 0,
        media: {
          schemaVersion: 1,
          state: 'ready',
          kind: 'map',
          original: mapOriginal,
          variants: {},
        },
      };
      const token = buildPortraitToken('compact-thumb', 0, {
        media: {
          kind: 'avatar',
          schemaVersion: 1,
          state: 'ready',
          variants: { thumbnail },
        },
      });

      const { rerender } = render(
        <GrigliataBoard {...buildProps({ activeBackground: privateMap })} />
      );
      await screen.findByTestId('battlemap-image-active');
      rerender(
        <GrigliataBoard {...buildProps({ activeBackground: privateMap, tokens: [token] })} />
      );

      await expectEveryPortrait([token]);
      expect(getBlob).toHaveBeenCalledTimes(2);
      expect(getPrivateMediaAssetCacheSnapshot()).toMatchObject({
        capacityWaiterCount: 0,
        reservedBytes: 0,
      });
    });
  });

  test('renders the DM lighting debug overlay above the map and below tokens', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          tokens: [buildOverlayToken()],
          lightingDebugMetadata: {
            backgroundId: 'map-1',
            walls: [{
              id: 'wall-1',
              x1: 10,
              y1: 20,
              x2: 80,
              y2: 20,
              blocksSight: true,
              doorType: 0,
            }],
            lights: [{
              id: 'light-1',
              x: 45,
              y: 55,
              brightRadiusPx: 30,
              dimRadiusPx: 60,
              color: '#FFAD00',
            }],
          },
          showLightingDebugOverlay: true,
        })}
      />
    );

    const overlay = await screen.findByTestId('lighting-debug-overlay');
    const token = screen.getByTestId('token-node-user-1');

    expect(screen.getByTestId('lighting-debug-wall')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-debug-light-point')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-debug-light-bright')).toHaveAttribute('data-radius', '30');
    expect(overlay.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('renders the computed lighting mask with viewer-safe token vision outside narration', async () => {
    const lightingRenderInput = {
      backgroundId: 'map-1',
      scene: {
        darkness: 0.6,
        globalLight: true,
      },
      walls: [{
        id: 'wall-1',
        x1: 120,
        y1: 0,
        x2: 120,
        y2: 220,
        blocksSight: true,
      }],
      lights: [{
        id: 'light-1',
        x: 80,
        y: 80,
        brightRadiusPx: 60,
        dimRadiusPx: 140,
        color: '#FFAD00',
      }],
    };

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          currentUserId: 'dm-1',
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
            visionRadiusSquares: 4,
          }, {
            tokenId: 'user-2',
            id: 'user-2',
            ownerUid: 'user-2',
            tokenType: 'character',
            label: 'Bryn',
            imageUrl: '',
            placed: true,
            col: 4,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          lightingRenderInput,
        })}
      />
    );

    expect(await screen.findByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-darkness-overlay')).toHaveAttribute('data-opacity', '0.6');
    expect(screen.getAllByTestId('lighting-token-vision-cutout').map((node) => (
      node.getAttribute('data-tokenid')
    ))).toEqual(['user-1', 'user-2']);

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: false,
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
            tokenId: 'custom-1',
            id: 'custom-1',
            ownerUid: 'user-1',
            tokenType: 'custom',
            label: 'Lantern Spirit',
            imageUrl: '',
            placed: true,
            col: 3,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }, {
            tokenId: 'user-2',
            id: 'user-2',
            ownerUid: 'user-2',
            tokenType: 'character',
            label: 'Bryn',
            imageUrl: '',
            placed: true,
            col: 4,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          lightingRenderInput,
        })}
      />
    );

    expect(screen.getByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-light-bright-polygon')).toBeInTheDocument();
    expect(screen.getAllByTestId('lighting-token-vision-cutout').map((node) => (
      node.getAttribute('data-tokenid')
    ))).toEqual(['custom-1', 'user-1']);
    expect(screen.queryByTestId('lighting-light-clip-group')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          tokens: [buildOverlayToken()],
          lightingRenderInput,
          isNarrationOverlayActive: true,
        })}
      />
    );

    expect(screen.queryByTestId('lighting-mask-layer')).not.toBeInTheDocument();
  });

  test('renders imported lights for a player even without an eligible vision token', async () => {
    const lightingRenderInput = {
      backgroundId: 'map-1',
      scene: {
        darkness: 0.6,
        globalLight: false,
      },
      walls: [],
      lights: [{
        x: 80,
        y: 80,
        brightRadiusPx: 60,
        dimRadiusPx: 140,
        color: '#FFAD00',
      }],
    };

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: false,
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-2',
            id: 'user-2',
            ownerUid: 'user-2',
            tokenType: 'character',
            label: 'Bryn',
            imageUrl: '',
            placed: true,
            col: 4,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          lightingRenderInput,
        })}
      />
    );

    expect(await screen.findByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-light-bright-polygon')).toBeInTheDocument();
    expect(screen.queryByTestId('lighting-token-vision-cutout')).not.toBeInTheDocument();
  });

  test('clips player light contributions to current fog visibility when fog is active', async () => {
    const lightingRenderInput = {
      backgroundId: 'map-1',
      scene: {
        darkness: 0.6,
        globalLight: false,
      },
      walls: [],
      lights: [{
        id: 'light-1',
        x: 80,
        y: 80,
        brightRadiusPx: 60,
        dimRadiusPx: 140,
        color: '#FFAD00',
      }],
    };

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: false,
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
          fogOfWar: {
            exploredCells: ['0:0'],
            exploredPolygons: [],
            currentVisibleCells: ['1:1'],
            currentVisiblePolygons: [[[
              { x: 0, y: 0 },
              { x: 220, y: 0 },
              { x: 220, y: 220 },
              { x: 0, y: 220 },
            ]]],
          },
          lightingRenderInput,
        })}
      />
    );

    expect(await screen.findByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-light-clip-group')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-light-bright-polygon')).toBeInTheDocument();
    expect(screen.getByTestId('fog-of-war-mask-layer')).toBeInTheDocument();
  });

  test('renders fog states after lighting and suppresses fog during narration', async () => {
    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          fogOfWar: {
            exploredCells: ['0:0', '1:0'],
            currentVisibleCells: ['1:0', '2:0'],
          },
        })}
      />
    );

    expect(await screen.findByTestId('fog-of-war-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('fog-unexplored-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-current-cell-cutout')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          fogOfWar: {
            exploredCells: ['0:0'],
            currentVisibleCells: [],
          },
        })}
      />
    );

    expect(screen.getByTestId('fog-of-war-mask-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-current-cell-cutout')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          fogOfWar: {
            exploredCells: ['0:0', '2:0'],
            memoryTiles: [buildMemoryTile()],
            currentVisibleCells: [],
            currentVisiblePolygons: [],
          },
        })}
      />
    );

    expect(screen.getByTestId('fog-remembered-raster-clear')).toBeInTheDocument();
    expect(screen.getByTestId('fog-remembered-raster-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          fogOfWar: {
            exploredCells: ['0:0', '2:0'],
            memoryTiles: [buildMemoryTile()],
            currentVisibleCells: [],
            currentVisiblePolygons: [],
          },
        })}
      />
    );

    expect(screen.queryByTestId('fog-remembered-cell-fallback-overlay')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          fogOfWar: {
            exploredCells: ['0:0'],
            currentVisibleCells: ['0:0'],
          },
          isNarrationOverlayActive: true,
        })}
      />
    );

    expect(screen.queryByTestId('fog-of-war-mask-layer')).not.toBeInTheDocument();
  });

  test('uses player fog to hide tokens outside current visibility while keeping the main token usable', async () => {
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
            col: 9,
            row: 9,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }, {
            tokenId: 'user-2',
            id: 'user-2',
            ownerUid: 'user-2',
            tokenType: 'character',
            label: 'Bryn',
            imageUrl: '',
            placed: true,
            col: 8,
            row: 8,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }, {
            tokenId: 'foe-1',
            id: 'foe-1',
            ownerUid: 'dm-1',
            tokenType: 'foe',
            label: 'Skeleton',
            imageUrl: '',
            placed: true,
            col: 1,
            row: 0,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          fogOfWar: {
            exploredCells: ['8:8'],
            currentVisibleCells: ['1:0'],
          },
        })}
      />
    );

    const mainToken = await screen.findByTestId('token-node-user-1');
    const foeToken = screen.getByTestId('token-node-foe-1');
    const fog = screen.getByTestId('fog-of-war-mask-layer');
    expect(mainToken).toBeInTheDocument();
    expect(foeToken).toBeInTheDocument();
    expect(screen.queryByTestId('token-node-user-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fog-current-cell-cutout')).not.toBeInTheDocument();
    expect(foeToken.compareDocumentPosition(fog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fog.compareDocumentPosition(mainToken) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('updates remembered fog without rebuilding token visibility, layers or stacks', async () => {
    const filter = jest.spyOn(fogVisibilityFiltering, 'filterFogVisibleTokens');
    const splitLayers = jest.spyOn(fogVisibilityFiltering, 'splitFogVisibleTokenRenderLayers');
    const buildStacks = jest.spyOn(tokenStacksModule, 'buildTokenStackCells');
    try {
      const props = buildProps({
        currentUserId: 'user-1',
        isManager: false,
        tokens: [0, 8].map((col, index) => ({
          tokenId: `user-${index + 1}`,
          ownerUid: `user-${index + 1}`,
          tokenType: 'character',
          label: `Token ${index + 1}`,
          placed: true,
          col,
          row: 0,
          isVisibleToPlayers: true,
        })),
      });
      const sight = { currentVisibleCells: ['0:0'] };
      const { rerender } = render(<GrigliataBoard {...props} fogOfWar={sight} />);
      expect(await screen.findByTestId('token-node-user-1')).toBeInTheDocument();
      expect(screen.queryByTestId('token-node-user-2')).not.toBeInTheDocument();
      expect(filter).toHaveBeenCalled();
      expect(splitLayers).toHaveBeenCalled();
      expect(buildStacks).toHaveBeenCalled();
      filter.mockClear();
      splitLayers.mockClear();
      buildStacks.mockClear();

      rerender(<GrigliataBoard {...props} fogOfWar={{ ...sight, memoryTiles: [buildMemoryTile()] }} />);

      expect(screen.getByTestId('fog-remembered-raster-overlay')).toBeInTheDocument();
      expect(screen.queryByTestId('token-node-user-2')).not.toBeInTheDocument();
      expect(filter).not.toHaveBeenCalled();
      expect(splitLayers).not.toHaveBeenCalled();
      expect(buildStacks).not.toHaveBeenCalled();

      rerender(<GrigliataBoard {...props} fogOfWar={{ currentVisibleCells: ['8:0'] }} />);
      expect(await screen.findByTestId('token-node-user-2')).toBeInTheDocument();
      expect(filter).toHaveBeenCalled();
      expect(splitLayers).toHaveBeenCalled();
      expect(buildStacks).toHaveBeenCalled();

      const fixedSight = { currentVisiblePolygons: [[[
        { x: 555, y: 0 },
        { x: 625, y: 0 },
        { x: 625, y: 70 },
        { x: 555, y: 70 },
      ]]] };
      rerender(<GrigliataBoard {...props} fogOfWar={fixedSight} />);
      expect(screen.getByTestId('token-node-user-2')).toBeInTheDocument();
      const shiftedProps = { ...props, grid: { ...props.grid, offsetXPx: 350 } };
      rerender(<GrigliataBoard {...shiftedProps} fogOfWar={fixedSight} />);
      expect(screen.queryByTestId('token-node-user-2')).not.toBeInTheDocument();

      rerender(<GrigliataBoard {...shiftedProps} fogOfWar={fixedSight} fogViewerUserId="user-2" />);
      expect(await screen.findByTestId('token-node-user-2')).toBeInTheDocument();
      expect(screen.queryByTestId('token-node-user-1')).not.toBeInTheDocument();

      rerender(<GrigliataBoard {...shiftedProps} fogOfWar={fixedSight} fogViewerUserId="user-2" isFogViewerManager />);
      expect(await screen.findByTestId('token-node-user-1')).toBeInTheDocument();
      expect(screen.getByTestId('token-node-user-2')).toBeInTheDocument();
    } finally {
      buildStacks.mockRestore();
      splitLayers.mockRestore();
      filter.mockRestore();
    }
  });

  test('uses a separate fog viewer identity for DM view-as token filtering while keeping manager controls', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'dm-1',
          isManager: true,
          fogViewerUserId: 'user-1',
          isFogViewerManager: false,
          onToggleGridVisibility: jest.fn(),
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Aldor',
            imageUrl: '',
            placed: true,
            col: 9,
            row: 9,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }, {
            tokenId: 'user-2',
            id: 'user-2',
            ownerUid: 'user-2',
            tokenType: 'character',
            label: 'Bryn',
            imageUrl: '',
            placed: true,
            col: 8,
            row: 8,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }, {
            tokenId: 'foe-1',
            id: 'foe-1',
            ownerUid: 'dm-1',
            tokenType: 'foe',
            label: 'Skeleton',
            imageUrl: '',
            placed: true,
            col: 1,
            row: 0,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          fogOfWar: {
            exploredCells: [],
            exploredPolygons: [],
            memoryTiles: [buildMemoryTile()],
            currentVisibleCells: ['1:0'],
            currentVisiblePolygons: [],
          },
        })}
      />
    );

    expect(await screen.findByTestId('token-node-user-1')).toBeInTheDocument();
    expect(screen.getByTestId('token-node-foe-1')).toBeInTheDocument();
    expect(screen.queryByTestId('token-node-user-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('grigliata-manager-controls')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide grid/i })).toBeInTheDocument();
  });

  test('uses the fog viewer identity for DM view-as lighting vision sources', async () => {
    const lightingRenderInput = {
      backgroundId: 'map-1',
      scene: {
        darkness: 0.6,
        globalLight: true,
      },
      walls: [],
      lights: [{
        id: 'light-1',
        x: 120,
        y: 120,
        brightRadiusPx: 80,
        dimRadiusPx: 120,
        color: '#FFAD00',
      }],
    };

    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'dm-1',
          isManager: true,
          fogViewerUserId: 'user-1',
          isFogViewerManager: false,
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
            tokenId: 'custom-1',
            id: 'custom-1',
            ownerUid: 'user-1',
            tokenType: 'custom',
            label: 'Lantern Spirit',
            imageUrl: '',
            placed: true,
            col: 3,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }, {
            tokenId: 'user-2',
            id: 'user-2',
            ownerUid: 'user-2',
            tokenType: 'character',
            label: 'Bryn',
            imageUrl: '',
            placed: true,
            col: 4,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          fogOfWar: {
            exploredCells: [],
            exploredPolygons: [],
            memoryTiles: [buildMemoryTile()],
            currentVisibleCells: ['2:2', '3:2', '4:2'],
            currentVisiblePolygons: [[[
              { x: 0, y: 0 },
              { x: 420, y: 0 },
              { x: 420, y: 420 },
              { x: 0, y: 420 },
            ]]],
          },
          lightingRenderInput,
        })}
      />
    );

    expect(await screen.findByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.getAllByTestId('lighting-token-vision-cutout').map((node) => (
      node.getAttribute('data-tokenid')
    ))).toEqual(['custom-1', 'user-1']);
    expect(screen.getByTestId('lighting-light-clip-group')).toBeInTheDocument();
  });

  test('keeps shared AoE and live drawing overlays visible outside memory fog', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          aoeFigures: [{
            id: 'memory-figure',
            backgroundId: 'map-1',
            ownerUid: 'user-2',
            figureType: 'circle',
            slot: 1,
            originCell: { col: 8, row: 8 },
            targetCell: { col: 9, row: 8 },
            colorKey: 'ion-cyan',
            isVisibleToPlayers: true,
          }],
          sharedInteractions: [{
            backgroundId: 'map-1',
            ownerUid: 'user-2',
            type: 'ping',
            source: 'free',
            colorKey: 'ion-cyan',
            point: { x: 595, y: 595 },
            startedAtMs: Date.now(),
          }],
          fogOfWar: {
            exploredCells: ['8:8'],
            currentVisibleCells: ['0:0'],
          },
        })}
      />
    );

    expect(await screen.findByTestId('fog-of-war-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('aoe-figure-overlay-memory-figure')).toBeInTheDocument();
    expect(screen.getByTestId('aoe-figure-overlay-memory-figure')).toHaveAttribute('data-listening', 'false');
    expect(screen.getByTestId('map-ping-overlay-shared-user-2')).toBeInTheDocument();
  });

  test('renders player fog above tokens but below shared drawing overlays', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-2',
            id: 'user-2',
            ownerUid: 'user-2',
            tokenType: 'character',
            label: 'Bryn',
            imageUrl: '',
            placed: true,
            col: 1,
            row: 0,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          sharedInteractions: [{
            backgroundId: 'map-1',
            ownerUid: 'user-3',
            type: 'measure',
            source: 'free',
            colorKey: 'ion-cyan',
            anchorCells: [{ col: 8, row: 8 }],
            liveEndCell: { col: 9, row: 8 },
            updatedAt: Date.now(),
            updatedBy: 'user-3',
          }],
          fogOfWar: {
            exploredCells: ['1:0'],
            currentVisibleCells: ['1:0'],
          },
        })}
      />
    );

    const token = await screen.findByTestId('token-node-user-2');
    const fog = screen.getByTestId('fog-of-war-mask-layer');
    const sharedRuler = screen.getByTestId('measurement-overlay-shared-user-3');
    expect(token.compareDocumentPosition(fog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fog.compareDocumentPosition(sharedRuler) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('does not expose selected custom token controls for a player token hidden by fog', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'custom-1',
            id: 'custom-1',
            ownerUid: 'user-1',
            tokenType: 'custom',
            label: 'Familiar',
            imageUrl: '',
            placed: true,
            col: 8,
            row: 8,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          fogOfWar: {
            exploredCells: ['8:8'],
            currentVisibleCells: ['0:0'],
          },
        })}
      />
    );

    expect(screen.queryByTestId('token-node-custom-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit statuses for familiar/i })).not.toBeInTheDocument();
  });

  test('keeps owned custom tokens visible while dragging outside current fog visibility', async () => {
    const { container } = render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'custom-1',
            id: 'custom-1',
            ownerUid: 'user-1',
            tokenType: 'custom',
            label: 'Familiar',
            imageUrl: '',
            placed: true,
            col: 0,
            row: 0,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
          fogOfWar: {
            exploredCells: ['0:0'],
            currentVisibleCells: ['0:0'],
          },
        })}
      />
    );

    const tokenNode = await screen.findByTestId('token-node-custom-1');
    const stage = container.querySelector('[data-konva-type="Stage"]');
    const viewportLeft = getNumericKonvaProp(stage, 'data-x');
    const viewportTop = getNumericKonvaProp(stage, 'data-y');
    const viewportScale = getNumericKonvaProp(stage, 'data-scalex') || 1;
    const tokenWorldX = getNumericKonvaProp(tokenNode, 'data-x');
    const tokenWorldY = getNumericKonvaProp(tokenNode, 'data-y');
    const toClientPoint = (worldX, worldY) => ({
      clientX: viewportLeft + (worldX * viewportScale),
      clientY: viewportTop + (worldY * viewportScale),
    });

    fireEvent.mouseDown(tokenNode, {
      button: 0,
      buttons: 1,
      ...toClientPoint(tokenWorldX, tokenWorldY),
    });
    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      ...toClientPoint(tokenWorldX + (grid.cellSizePx * 5), tokenWorldY),
    });

    await waitFor(() => {
      expect(getNumericKonvaProp(screen.getByTestId('token-node-custom-1'), 'data-x')).toBeGreaterThan(200);
    });

    const draggedTokenNode = screen.getByTestId('token-node-custom-1');
    const fog = screen.getByTestId('fog-of-war-mask-layer');
    expect(fog.compareDocumentPosition(draggedTokenNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => {
      fireEvent.mouseUp(window, {
        button: 0,
        buttons: 0,
        ...toClientPoint(tokenWorldX + (grid.cellSizePx * 5), tokenWorldY),
      });
      await Promise.resolve();
    });
  });

  test('keeps the lighting debug overlay toggle independent from the computed mask', async () => {
    const lightingRenderInput = {
      backgroundId: 'map-1',
      scene: {
        darkness: 0.5,
        globalLight: false,
      },
      walls: [{
        id: 'wall-1',
        x1: 10,
        y1: 20,
        x2: 80,
        y2: 20,
        blocksSight: true,
        doorType: 0,
      }],
      lights: [{
        id: 'light-1',
        x: 45,
        y: 55,
        brightRadiusPx: 30,
        dimRadiusPx: 60,
        color: '#FFAD00',
      }],
    };
    const lightingDebugMetadata = {
      ...lightingRenderInput,
      walls: lightingRenderInput.walls.map((wall) => ({
        ...wall,
        id: 'raw-wall-id',
        doorType: 1,
        source: { sense: 1, door: 1 },
      })),
      lights: lightingRenderInput.lights.map((light) => ({
        ...light,
        id: 'raw-light-id',
        source: { tintAlpha: 0.25 },
      })),
    };

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightingRenderInput,
          lightingDebugMetadata,
          showLightingDebugOverlay: false,
        })}
      />
    );

    expect(await screen.findByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('lighting-debug-overlay')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightingRenderInput,
          lightingDebugMetadata,
          showLightingDebugOverlay: true,
        })}
      />
    );

    expect(screen.getByTestId('lighting-mask-layer')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-debug-overlay')).toBeInTheDocument();
  });

  test('shows actual View as player sight and the selected lamp clipped to sight and the effective door', () => {
    const selectedLight = { id: 'torch', x: 40, y: 60, brightRadiusPx: 20, dimRadiusPx: 100 };
    const authoredDoor = { id: 'door', wallType: 'door', x1: 60, y1: -100, x2: 60, y2: 300, blocksSight: true };
    const { id, ...projectedLight } = selectedLight;
    const sight = [
      { x: 30, y: 30 }, { x: 80, y: 30 }, { x: 80, y: 90 }, { x: 30, y: 90 },
    ];
    const otherSight = sight.map(({ x, y }) => ({ x: x + 130, y }));
    const props = buildProps({
      isManager: true,
      isFogViewerManager: false,
      showLightingDebugOverlay: true,
      lightingDebugMetadata: { walls: [authoredDoor], lights: [selectedLight] },
      lightSourceControls: { lights: [selectedLight], selectedLightId: id },
      fogOfWar: {
        currentVisiblePolygons: [[sight], [otherSight]],
        currentTokenVisionPolygons: [
          { tokenId: 'left', polygon: sight },
          { tokenId: 'right', polygon: otherSight },
        ],
      },
    });
    const input = { backgroundId: 'map-1', walls: [authoredDoor], lights: [projectedLight] };
    const { rerender } = render(<GrigliataBoard {...props} lightingRenderInput={input} />);
    expect(screen.getAllByTestId('lighting-debug-viewer-sight')).toHaveLength(2);
    const footprintMaxX = () => {
      const contour = screen.getByTestId('lighting-debug-lamp-footprint');
      const points = JSON.parse(contour.getAttribute('data-points'));
      return Math.max(...points.filter((_, index) => index % 2 === 0));
    };
    expect(footprintMaxX()).toBeCloseTo(60);

    rerender(<GrigliataBoard {...props} lightingRenderInput={{
      ...input,
      walls: [{ ...authoredDoor, isOpen: true, blocksVision: false, blocksLight: false, blocksSight: false }],
    }} />);
    expect(footprintMaxX()).toBeCloseTo(80);
  });

  test('distinguishes debug blocker types and styles doors and windows using runtime state', () => {
    const wall = { x1: 0, y1: 0, x2: 100, y2: 0, blocksSight: true };
    const walls = [
      { ...wall, id: 'sight', blocksVision: true, blocksLight: false },
      { ...wall, id: 'light', y1: 20, y2: 20, blocksVision: false, blocksLight: true },
      { ...wall, id: 'both', y1: 40, y2: 40, blocksVision: true, blocksLight: true },
      { ...wall, id: 'door', y1: 60, y2: 60, wallType: 'door' },
      { ...wall, id: 'window', y1: 80, y2: 80, wallType: 'window' },
    ];
    const props = buildProps({
      isManager: true,
      showLightingDebugOverlay: true,
      lightingDebugMetadata: { walls },
    });
    const input = { backgroundId: 'map-1', walls };
    const { rerender } = render(<GrigliataBoard {...props} lightingRenderInput={input} />);
    const [visionOnly, lightOnly, both, door, window] = screen.getAllByTestId('lighting-debug-wall');
    const stroke = (line) => line.getAttribute('data-stroke');
    const dash = (line) => line.getAttribute('data-dash');
    const blockers = [visionOnly, lightOnly, both];
    expect(new Set(blockers.map(stroke)).size).toBe(3);
    expect(new Set(blockers.map(dash)).size).toBe(3);
    expect(stroke(door)).toBe(stroke(both));
    expect(stroke(window)).toBe(stroke(both));
    const closedDash = dash(door);

    rerender(<GrigliataBoard {...props} lightingRenderInput={{
      ...input,
      walls: walls.map((segment) => (
        segment.wallType ? { ...segment, isOpen: true } : segment
      )),
    }} />);
    expect(stroke(door)).not.toBe(stroke(both));
    expect(stroke(window)).toBe(stroke(door));
    expect(dash(door)).not.toBe(closedDash);
  });

  test('renders DM wall runtime controls outside narration and forwards toggles', async () => {
    const onToggleWallRuntimeSegment = jest.fn();
    const lightingRenderInput = {
      backgroundId: 'map-1',
      scene: { darkness: 0.5, globalLight: false },
      walls: [{
        id: 'wall-1',
        x1: 0,
        y1: 0,
        x2: 70,
        y2: 0,
        wallType: 'door',
        isOpen: false,
        blocksSight: true,
      }],
      lights: [],
    };

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightingRenderInput,
          onToggleWallRuntimeSegment,
        })}
      />
    );

    const toggle = await screen.findByTestId('wall-runtime-toggle');
    fireEvent.click(toggle);
    expect(onToggleWallRuntimeSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'wall-1',
      isOpen: false,
    }));

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: false,
          lightingRenderInput,
          onToggleWallRuntimeSegment,
        })}
      />
    );
    expect(screen.queryByTestId('wall-runtime-toggle')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightingRenderInput,
          onToggleWallRuntimeSegment,
          isNarrationOverlayActive: true,
        })}
      />
    );
    expect(screen.queryByTestId('wall-runtime-toggle')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightingRenderInput,
          onToggleWallRuntimeSegment,
          wallSourceControls: {
            isWallToolActive: true,
            walls: [],
            onToggleWallTool: jest.fn(),
          },
        })}
      />
    );
    expect(screen.queryByTestId('wall-runtime-toggle')).not.toBeInTheDocument();
  });

  test('renders DM wall authoring tool outside narration only', async () => {
    const onToggleWallTool = jest.fn();
    const wallSourceControls = {
      isWallToolActive: false,
      walls: [],
      onToggleWallTool,
    };

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          wallSourceControls,
        })}
      />
    );

    const trigger = await screen.findByTestId('wall-source-tool-trigger');
    fireEvent.click(trigger);
    expect(onToggleWallTool).toHaveBeenCalled();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: false,
          wallSourceControls,
        })}
      />
    );
    expect(screen.queryByTestId('wall-source-tool-trigger')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          wallSourceControls,
          isNarrationOverlayActive: true,
        })}
      />
    );
    expect(screen.queryByTestId('wall-source-tool-trigger')).not.toBeInTheDocument();
  });

  test('renders DM light source controls outside narration only', async () => {
    const lightSourceControls = {
      lights: [{
        id: 'light-1',
        label: 'Torch',
        enabled: true,
        x: 140,
        y: 140,
        brightRadiusPx: 280,
        dimRadiusPx: 560,
        color: '#FFAD00',
      }],
      selectedLightId: 'light-1',
      onSelectLight: jest.fn(),
    };

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightSourceControls,
        })}
      />
    );

    expect(await screen.findByTestId('light-source-handle')).toHaveAttribute('data-lightid', 'light-1');
    expect(screen.getByTestId('selected-light-panel')).toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: false,
          lightSourceControls,
        })}
      />
    );
    expect(screen.queryByTestId('light-source-handle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selected-light-panel')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightSourceControls,
          isNarrationOverlayActive: true,
        })}
      />
    );
    expect(screen.queryByTestId('light-source-handle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selected-light-panel')).not.toBeInTheDocument();
  });

  test('renders DM darkness source controls outside narration only', async () => {
    const onToggleDarknessTool = jest.fn();
    const darknessSourceControls = {
      isDarknessToolActive: false,
      darknessSources: [{
        id: 'darkness-1',
        label: 'Void',
        enabled: true,
        x: 140,
        y: 140,
        radiusPx: 280,
        intensity: 0.75,
      }],
      selectedDarknessId: 'darkness-1',
      onSelectDarkness: jest.fn(),
      onToggleDarknessTool,
    };

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          darknessSourceControls,
        })}
      />
    );

    const trigger = await screen.findByTestId('darkness-source-tool-trigger');
    fireEvent.click(trigger);
    expect(onToggleDarknessTool).toHaveBeenCalled();
    expect(await screen.findByTestId('darkness-source-handle')).toHaveAttribute('data-darknessid', 'darkness-1');
    expect(screen.getByTestId('selected-darkness-panel')).toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: false,
          darknessSourceControls,
        })}
      />
    );
    expect(screen.queryByTestId('darkness-source-tool-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('darkness-source-handle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selected-darkness-panel')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          darknessSourceControls,
          isNarrationOverlayActive: true,
        })}
      />
    );
    expect(screen.queryByTestId('darkness-source-tool-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('darkness-source-handle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selected-darkness-panel')).not.toBeInTheDocument();
  });

  test('renders DM fog brush controls outside narration only', async () => {
    const onToggleFogBrushTool = jest.fn();
    const fogBrushControls = {
      isFogBrushToolActive: false,
      mode: 'reveal',
      radiusSquares: 2,
      onToggleFogBrushTool,
      onChangeMode: jest.fn(),
      onChangeRadiusSquares: jest.fn(),
      onPaintFogBrush: jest.fn(),
    };

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          fogBrushControls,
        })}
      />
    );

    const trigger = await screen.findByTestId('fog-brush-tool-trigger');
    fireEvent.click(trigger);
    expect(onToggleFogBrushTool).toHaveBeenCalled();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: false,
          fogBrushControls,
        })}
      />
    );
    expect(screen.queryByTestId('fog-brush-tool-trigger')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          fogBrushControls,
          isNarrationOverlayActive: true,
        })}
      />
    );
    expect(screen.queryByTestId('fog-brush-tool-trigger')).not.toBeInTheDocument();
  });

  test('toggles reveal and hide brush settings', async () => {
    const onChangeMode = jest.fn();
    const onChangeRadiusSquares = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          fogBrushControls: {
            isFogBrushToolActive: true,
            mode: 'reveal',
            radiusSquares: 2,
            onToggleFogBrushTool: jest.fn(),
            onChangeMode,
            onChangeRadiusSquares,
            onPaintFogBrush: jest.fn(),
          },
        })}
      />
    );

    const trigger = await screen.findByTestId('fog-brush-tool-trigger');
    const settings = screen.getByTestId('fog-brush-settings');

    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', settings.id);
    expect(settings.className).toContain('min-h-10');
    expect(settings.className).toContain('overflow-hidden');

    fireEvent.click(screen.getByTestId('fog-brush-mode-hide'));
    fireEvent.click(screen.getByTestId('fog-brush-mode-reveal'));
    fireEvent.change(screen.getByRole('spinbutton', { name: /fog brush radius/i }), {
      target: { value: '5' },
    });

    expect(onChangeMode).toHaveBeenNthCalledWith(1, 'hide');
    expect(onChangeMode).toHaveBeenNthCalledWith(2, 'reveal');
    expect(onChangeRadiusSquares).toHaveBeenCalledWith(5);
  });

  test('renders DM lighting diagnostics outside narration only', async () => {
    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          selectedTokenDetails: {
            tokenId: 'token-1',
            visionEnabled: true,
            visionRadiusSquares: 8,
          },
          activeViewers: [{
            ownerUid: 'user-2',
            characterId: 'Nyx',
            colorKey: 'aurora-fuchsia',
          }],
          lightSourceControls: {
            lights: [{
              id: 'light-1',
              label: 'Torch',
              enabled: true,
              x: 140,
              y: 140,
              brightRadiusPx: 280,
              dimRadiusPx: 560,
              color: '#FFAD00',
            }, {
              id: 'light-2',
              label: 'Hidden lamp',
              enabled: false,
              x: 210,
              y: 140,
              brightRadiusPx: 280,
              dimRadiusPx: 560,
              color: '#FFFFFF',
            }],
          },
          wallSourceControls: {
            walls: [{
              id: 'wall-1',
              label: 'Door',
              x1: 0,
              y1: 0,
              x2: 70,
              y2: 0,
              wallType: 'door',
              blocksSight: true,
            }],
          },
        })}
      />
    );

    expect(await screen.findByTestId('lighting-diagnostics-panel')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-diagnostics-active-lights')).toHaveTextContent('1');
    expect(screen.getByTestId('lighting-diagnostics-disabled-lights')).toHaveTextContent('1');
    expect(screen.getByTestId('lighting-diagnostics-token-vision')).toHaveTextContent('Enabled, 8 squares');
    expect(screen.getByTestId('grigliata-active-viewers')).toBeInTheDocument();
    expect(screen.getByTestId('lighting-diagnostics-anchor')).toHaveClass('bottom-20', 'left-4');

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          isNarrationOverlayActive: true,
          lightSourceControls: {
            lights: [{ id: 'light-1', enabled: true, x: 140, y: 140, brightRadiusPx: 280, dimRadiusPx: 560 }],
          },
          wallSourceControls: {
            walls: [{ id: 'wall-1', x1: 0, y1: 0, x2: 70, y2: 0, blocksSight: true }],
          },
        })}
      />
    );
    expect(screen.queryByTestId('lighting-diagnostics-panel')).not.toBeInTheDocument();
  });

  test('clears controlled light selection when selectedLightId becomes empty', async () => {
    const lightSourceControls = {
      lights: [{
        id: 'light-1',
        label: 'Torch',
        enabled: true,
        x: 140,
        y: 140,
        brightRadiusPx: 280,
        dimRadiusPx: 560,
        color: '#FFAD00',
      }],
      selectedLightId: 'light-1',
      onSelectLight: jest.fn(),
    };

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightSourceControls,
        })}
      />
    );

    expect(await screen.findByTestId('selected-light-panel')).toBeInTheDocument();
    expect(screen.getByTestId('light-source-handle')).toHaveAttribute('data-selected', 'true');

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightSourceControls: {
            ...lightSourceControls,
            selectedLightId: '',
          },
        })}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId('selected-light-panel')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('light-source-handle')).toHaveAttribute('data-selected', 'false');
  });

  test('creates and drags light sources from the DM board controls', async () => {
    const onCreateLightSource = jest.fn(() => Promise.resolve(true));
    const onMoveLightSource = jest.fn(() => Promise.resolve(true));
    const onSelectLight = jest.fn();

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightSourceControls: {
            isLightToolActive: true,
            lights: [],
            onCreateLightSource,
          },
        })}
      />
    );

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 140, clientY: 140, buttons: 0 });

    await waitFor(() => {
      expect(onCreateLightSource).toHaveBeenCalledWith(expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }));
    });

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightSourceControls: {
            lights: [{
              id: 'light-1',
              label: 'Torch',
              enabled: true,
              x: 140,
              y: 140,
              brightRadiusPx: 280,
              dimRadiusPx: 560,
              color: '#FFAD00',
            }],
            onSelectLight,
            onMoveLightSource,
          },
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('light-source-handle'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });
    fireEvent.mouseMove(window, { clientX: 210, clientY: 210, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 210, clientY: 210, buttons: 0 });

    expect(onSelectLight).toHaveBeenCalledWith('light-1');
    await waitFor(() => {
      expect(onMoveLightSource).toHaveBeenCalledWith('light-1', expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }));
    });
  });

  test('creates and drags darkness sources from the DM board controls', async () => {
    const onCreateDarknessSource = jest.fn(() => Promise.resolve(true));
    const onMoveDarknessSource = jest.fn(() => Promise.resolve(true));
    const onSelectDarkness = jest.fn();

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          darknessSourceControls: {
            isDarknessToolActive: true,
            darknessSources: [],
            onCreateDarknessSource,
          },
        })}
      />
    );

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 140, clientY: 140, buttons: 0 });

    await waitFor(() => {
      expect(onCreateDarknessSource).toHaveBeenCalledWith(expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }));
    });

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          darknessSourceControls: {
            darknessSources: [{
              id: 'darkness-1',
              label: 'Void',
              enabled: true,
              x: 140,
              y: 140,
              radiusPx: 280,
              intensity: 0.75,
            }],
            onSelectDarkness,
            onMoveDarknessSource,
          },
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('darkness-source-handle'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });
    fireEvent.mouseMove(window, { clientX: 210, clientY: 210, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 210, clientY: 210, buttons: 0 });

    expect(onSelectDarkness).toHaveBeenCalledWith('darkness-1');
    await waitFor(() => {
      expect(onMoveDarknessSource).toHaveBeenCalledWith('darkness-1', expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }));
    });
  });

  test('paints fog cells with click and drag from the DM brush tool', async () => {
    const onPaintFogBrush = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          fogBrushControls: {
            isFogBrushToolActive: true,
            mode: 'reveal',
            radiusSquares: 2,
            onToggleFogBrushTool: jest.fn(),
            onChangeMode: jest.fn(),
            onChangeRadiusSquares: jest.fn(),
            onPaintFogBrush,
          },
        })}
      />
    );

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseMove(window, { clientX: 210, clientY: 140, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 210, clientY: 140, buttons: 0 });

    await waitFor(() => {
      expect(onPaintFogBrush).toHaveBeenCalledTimes(2);
    });
    expect(onPaintFogBrush).toHaveBeenNthCalledWith(1, expect.objectContaining({
      point: expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
      mode: 'reveal',
      radiusSquares: 2,
    }));
    expect(onPaintFogBrush).toHaveBeenNthCalledWith(2, expect.objectContaining({
      mode: 'reveal',
      radiusSquares: 2,
    }));
  });

  test('keeps sampling fog brush drags while persistence is pending', async () => {
    const firstPaint = createDeferred();
    const onPaintFogBrush = jest.fn();

    function PendingFogBrushHarness() {
      const [isPending, setIsPending] = React.useState(false);

      const handlePaintFogBrush = React.useCallback((payload) => {
        onPaintFogBrush(payload);
        setIsPending(true);
        return firstPaint.promise;
      }, []);

      return (
        <GrigliataBoard
          {...buildProps({
            isManager: true,
            fogBrushControls: {
              isFogBrushToolActive: true,
              isPending,
              mode: 'reveal',
              radiusSquares: 2,
              onToggleFogBrushTool: jest.fn(),
              onChangeMode: jest.fn(),
              onChangeRadiusSquares: jest.fn(),
              onPaintFogBrush: handlePaintFogBrush,
            },
          })}
        />
      );
    }

    render(<PendingFogBrushHarness />);

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });

    await waitFor(() => {
      expect(onPaintFogBrush).toHaveBeenCalledTimes(1);
    });

    fireEvent.mouseMove(window, { clientX: 210, clientY: 140, buttons: 1 });

    await waitFor(() => {
      expect(onPaintFogBrush).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      firstPaint.resolve(true);
      await firstPaint.promise;
    });
  });

  test('selecting a light source clears an existing darkness selection', async () => {
    const onSelectLight = jest.fn();
    const onDeleteLightSource = jest.fn(() => Promise.resolve(true));
    const onDeleteDarknessSource = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightSourceControls: {
            lights: [{
              id: 'light-1',
              label: 'Torch',
              enabled: true,
              x: 140,
              y: 140,
              brightRadiusPx: 280,
              dimRadiusPx: 560,
              color: '#FFAD00',
            }],
            onSelectLight,
            onDeleteLightSource,
          },
          darknessSourceControls: {
            selectedDarknessId: 'darkness-1',
            darknessSources: [{
              id: 'darkness-1',
              label: 'Void',
              enabled: true,
              x: 210,
              y: 210,
              radiusPx: 280,
              intensity: 0.75,
            }],
            onDeleteDarknessSource,
          },
        })}
      />
    );

    expect(await screen.findByTestId('selected-darkness-panel')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('light-source-handle'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-light-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('selected-darkness-panel')).not.toBeInTheDocument();
    });
    expect(onSelectLight).toHaveBeenCalledWith('light-1');

    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });

    await waitFor(() => {
      expect(onDeleteLightSource).toHaveBeenCalledWith('light-1');
    });
    expect(onDeleteDarknessSource).not.toHaveBeenCalled();
  });

  test('creates and drags wall sources from the DM board controls', async () => {
    const onCreateWallSegment = jest.fn(() => Promise.resolve(true));
    const onMoveWallEndpoint = jest.fn(() => Promise.resolve(true));
    const onMoveWallSegment = jest.fn(() => Promise.resolve(true));
    const onSelectWall = jest.fn();

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          wallSourceControls: {
            isWallToolActive: true,
            walls: [],
            onCreateWallSegment,
          },
        })}
      />
    );

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseMove(window, { clientX: 280, clientY: 140, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 280, clientY: 140, buttons: 0 });

    await waitFor(() => {
      expect(onCreateWallSegment).toHaveBeenCalledWith(
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
      );
    });

    rerender(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          wallSourceControls: {
            isWallToolActive: true,
            selectedWallId: 'wall-1',
            walls: [{
              id: 'wall-1',
              label: 'Wall',
              x1: 140,
              y1: 140,
              x2: 280,
              y2: 140,
              wallType: 'wall',
              blocksSight: true,
              blocksVision: true,
              blocksLight: true,
            }],
            onSelectWall,
            onMoveWallEndpoint,
            onMoveWallSegment,
          },
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('wall-source-end-handle'), {
      button: 0,
      buttons: 1,
      clientX: 280,
      clientY: 140,
    });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 210, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 350, clientY: 210, buttons: 0 });

    await waitFor(() => {
      expect(onMoveWallEndpoint).toHaveBeenCalledWith(
        'wall-1',
        'end',
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
      );
    });

    fireEvent.mouseDown(screen.getByTestId('wall-source-hit-target-line'), {
      button: 0,
      buttons: 1,
      clientX: 210,
      clientY: 140,
    });
    fireEvent.mouseMove(window, { clientX: 280, clientY: 210, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 280, clientY: 210, buttons: 0 });

    await waitFor(() => {
      expect(onMoveWallSegment).toHaveBeenCalledWith(
        'wall-1',
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
      );
    });
  });

  test('blocks light source create, drag, and delete while a mutation is pending', async () => {
    const onCreateLightSource = jest.fn(() => Promise.resolve(true));
    const onMoveLightSource = jest.fn(() => Promise.resolve(true));
    const onDeleteLightSource = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          lightSourceControls: {
            isLightToolActive: true,
            isPending: true,
            selectedLightId: 'light-1',
            lights: [{
              id: 'light-1',
              label: 'Torch',
              enabled: true,
              x: 140,
              y: 140,
              brightRadiusPx: 280,
              dimRadiusPx: 560,
              color: '#FFAD00',
            }],
            onCreateLightSource,
            onMoveLightSource,
            onDeleteLightSource,
          },
        })}
      />
    );

    expect(await screen.findByTestId('selected-light-panel')).toBeInTheDocument();

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 140, clientY: 140, buttons: 0 });

    fireEvent.mouseDown(screen.getByTestId('light-source-handle'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });
    fireEvent.mouseMove(window, { clientX: 210, clientY: 210, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 210, clientY: 210, buttons: 0 });

    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });

    expect(onCreateLightSource).not.toHaveBeenCalled();
    expect(onMoveLightSource).not.toHaveBeenCalled();
    expect(onDeleteLightSource).not.toHaveBeenCalled();
    expect(screen.getByTestId('selected-light-panel')).toBeInTheDocument();
  });

  test('blocks darkness source create, drag, and delete while a mutation is pending', async () => {
    const onCreateDarknessSource = jest.fn(() => Promise.resolve(true));
    const onMoveDarknessSource = jest.fn(() => Promise.resolve(true));
    const onDeleteDarknessSource = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          darknessSourceControls: {
            isDarknessToolActive: true,
            isPending: true,
            selectedDarknessId: 'darkness-1',
            darknessSources: [{
              id: 'darkness-1',
              label: 'Void',
              enabled: true,
              x: 140,
              y: 140,
              radiusPx: 280,
              intensity: 0.75,
            }],
            onCreateDarknessSource,
            onMoveDarknessSource,
            onDeleteDarknessSource,
          },
        })}
      />
    );

    expect(await screen.findByTestId('selected-darkness-panel')).toBeInTheDocument();

    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.mouseDown(stage, { button: 0, clientX: 140, clientY: 140, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 140, clientY: 140, buttons: 0 });

    fireEvent.mouseDown(screen.getByTestId('darkness-source-handle'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });
    fireEvent.mouseMove(window, { clientX: 210, clientY: 210, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 210, clientY: 210, buttons: 0 });

    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });

    expect(onCreateDarknessSource).not.toHaveBeenCalled();
    expect(onMoveDarknessSource).not.toHaveBeenCalled();
    expect(onDeleteDarknessSource).not.toHaveBeenCalled();
    expect(screen.getByTestId('selected-darkness-panel')).toBeInTheDocument();
  });

  test('keeps token dragging above overlapping light handles', async () => {
    const onMoveTokens = jest.fn(() => Promise.resolve(true));
    const onMoveLightSource = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          currentUserId: 'dm-1',
          onMoveTokens,
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
          lightSourceControls: {
            lights: [{
              id: 'light-1',
              label: 'Torch',
              enabled: true,
              x: 175,
              y: 175,
              brightRadiusPx: 280,
              dimRadiusPx: 560,
              color: '#FFAD00',
            }],
            onMoveLightSource,
          },
        })}
      />
    );

    const lightHandle = await screen.findByTestId('light-source-handle');
    const token = screen.getByTestId('token-node-user-1');
    expect(lightHandle.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.mouseDown(token, { button: 0, buttons: 1, clientX: 175, clientY: 175 });
    fireEvent.mouseMove(window, { clientX: 245, clientY: 245, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 245, clientY: 245, buttons: 0 });

    await waitFor(() => {
      expect(onMoveTokens).toHaveBeenCalled();
    });
    expect(onMoveLightSource).not.toHaveBeenCalled();
  });

  test('keeps token dragging above overlapping darkness handles', async () => {
    const onMoveTokens = jest.fn(() => Promise.resolve(true));
    const onMoveDarknessSource = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          currentUserId: 'dm-1',
          onMoveTokens,
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
          darknessSourceControls: {
            darknessSources: [{
              id: 'darkness-1',
              label: 'Void',
              enabled: true,
              x: 175,
              y: 175,
              radiusPx: 280,
              intensity: 0.75,
            }],
            onMoveDarknessSource,
          },
        })}
      />
    );

    const darknessHandle = await screen.findByTestId('darkness-source-handle');
    const token = screen.getByTestId('token-node-user-1');
    expect(darknessHandle.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.mouseDown(token, { button: 0, buttons: 1, clientX: 175, clientY: 175 });
    fireEvent.mouseMove(window, { clientX: 245, clientY: 245, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 245, clientY: 245, buttons: 0 });

    await waitFor(() => {
      expect(onMoveTokens).toHaveBeenCalled();
    });
    expect(onMoveDarknessSource).not.toHaveBeenCalled();
  });

  test('keeps token dragging above overlapping wall handles', async () => {
    const onMoveTokens = jest.fn(() => Promise.resolve(true));
    const onMoveWallSegment = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          currentUserId: 'dm-1',
          onMoveTokens,
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
          wallSourceControls: {
            isWallToolActive: true,
            selectedWallId: 'wall-1',
            walls: [{
              id: 'wall-1',
              label: 'Wall',
              x1: 140,
              y1: 175,
              x2: 245,
              y2: 175,
              wallType: 'wall',
              blocksSight: true,
              blocksVision: true,
              blocksLight: true,
            }],
            onMoveWallSegment,
          },
        })}
      />
    );

    const wallHandle = await screen.findByTestId('wall-source-hit-target-line');
    const token = screen.getByTestId('token-node-user-1');
    expect(wallHandle.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.mouseDown(token, { button: 0, buttons: 1, clientX: 175, clientY: 175 });
    fireEvent.mouseMove(window, { clientX: 245, clientY: 245, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 245, clientY: 245, buttons: 0 });

    await waitFor(() => {
      expect(onMoveTokens).toHaveBeenCalled();
    });
    expect(onMoveWallSegment).not.toHaveBeenCalled();
  });

  describe('token stacks', () => {
    const stackToken = (tokenId, ownerUid, label, overrides = {}) => ({
      tokenId,
      id: tokenId,
      ownerUid,
      tokenType: 'character',
      label,
      imageUrl: '',
      placed: true,
      col: 2,
      row: 2,
      sizeSquares: 1,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
      ...overrides,
    });
    const nyx = (overrides) => stackToken('nyx', 'player-1', 'Nyx', overrides);
    const frusta = (overrides) => stackToken('frusta', 'player-2', 'Frusta Magica', overrides);
    const stackProps = (overrides = {}) => buildProps({
      currentUserId: 'player-1',
      activeBackground: { ...buildProps().activeBackground, tokenLayerOrder: ['nyx', 'frusta'] },
      tokens: [nyx(), frusta()],
      ...overrides,
    });
    // Client point at the center of a grid cell under the fitted stage transform.
    const cellCenterClient = (col, row) => {
      const stage = screen.getByTestId('konva-stage');
      const scale = getNumericKonvaProp(stage, 'data-scalex');
      return {
        clientX: getNumericKonvaProp(stage, 'data-x') + ((col + 0.5) * grid.cellSizePx * scale),
        clientY: getNumericKonvaProp(stage, 'data-y') + ((row + 0.5) * grid.cellSizePx * scale),
      };
    };
    // Presses the given canvas node (as Konva would report the top token) at a cell, then drags two cells right.
    const dragFromTokenNode = (tokenId, { col = 2, row = 2, deltaCol = 2 } = {}) => {
      const start = cellCenterClient(col, row);
      const end = cellCenterClient(col + deltaCol, row);
      fireEvent.mouseDown(screen.getByTestId(`token-node-${tokenId}`), { button: 0, buttons: 1, ...start });
      fireEvent.mouseMove(window, { buttons: 1, ...end });
      fireEvent.mouseUp(window, { button: 0, buttons: 0, ...end });
    };
    const chooseFromStack = (badgeCellKey, tokenId) => {
      fireEvent.click(screen.getByTestId(`token-stack-badge-${badgeCellKey}`));
      fireEvent.click(screen.getByTestId(`token-stack-option-${tokenId}`));
    };
    const movedTokenIds = (onMoveTokens) => onMoveTokens.mock.calls[0][0].map(({ tokenId }) => tokenId);

    test('reuses stack geometry on selection and turn changes, and rebuilds it after a move', () => {
      const buildStacks = jest.spyOn(tokenStacksModule, 'buildTokenStackCells');
      try {
        const props = stackProps();
        const { rerender } = render(<GrigliataBoard {...props} />);
        expect(buildStacks).toHaveBeenCalled();
        buildStacks.mockClear();

        chooseFromStack('2:2', 'nyx');
        rerender(<GrigliataBoard {...props} activeTurnTokenId="nyx" />);
        expect(screen.getByTestId('token-node-nyx')).toHaveAttribute('data-active-turn', 'true');
        expect(screen.getByTestId('token-stack-badge-2:2')).toBeInTheDocument();
        expect(buildStacks).not.toHaveBeenCalled();

        rerender(<GrigliataBoard {...props} activeTurnTokenId="nyx" tokens={[nyx({ col: 3 }), frusta()]} />);
        expect(buildStacks).toHaveBeenCalled();
        expect(screen.queryByTestId('token-stack-badge-2:2')).not.toBeInTheDocument();
      } finally {
        buildStacks.mockRestore();
      }
    });

    test('drags the chosen own token from under another player\'s token', async () => {
      const onMoveTokens = jest.fn(() => Promise.resolve(true));
      render(<GrigliataBoard {...stackProps({ onMoveTokens })} />);

      const badge = screen.getByTestId('token-stack-badge-2:2');
      expect(badge).toHaveTextContent('×2');
      expect(badge).toHaveAccessibleName(expect.stringContaining('Frusta Magica, Nyx'));
      // The badge sits in the top-right corner of its own cell: the cell center
      // stays a token drag target and the neighboring cells stay untouched.
      const center = cellCenterClient(2, 2);
      const halfCell = (grid.cellSizePx * getNumericKonvaProp(screen.getByTestId('konva-stage'), 'data-scalex')) / 2;
      const badgeLeft = Number.parseFloat(badge.style.left);
      const badgeTop = Number.parseFloat(badge.style.top);
      const badgeSize = Number.parseFloat(badge.style.width);
      expect(badgeLeft).toBeGreaterThan(center.clientX);
      expect(badgeTop + badgeSize).toBeLessThan(center.clientY);
      expect(badgeLeft + badgeSize).toBeCloseTo(center.clientX + halfCell);
      expect(badgeTop).toBeCloseTo(center.clientY - halfCell);

      fireEvent.click(badge);
      expect(badge).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('token-stack-option-frusta')).toBeDisabled();
      expect(screen.getByTestId('token-stack-option-nyx')).toHaveFocus();

      fireEvent.click(screen.getByTestId('token-stack-option-nyx'));
      expect(screen.queryByTestId('token-stack-picker')).not.toBeInTheDocument();
      expect(badge).toHaveFocus();
      fireEvent.click(badge);
      expect(screen.getByTestId('token-stack-option-nyx')).toHaveAttribute('aria-pressed', 'true');
      fireEvent.keyDown(screen.getByTestId('token-stack-option-nyx'), { key: 'Escape' });

      // Canvas hit-testing reports the top token, as on the real Konva stage.
      dragFromTokenNode('frusta');

      await waitFor(() => expect(onMoveTokens).toHaveBeenCalledTimes(1));
      expect(movedTokenIds(onMoveTokens)).toEqual(['nyx']);
      expect(onMoveTokens.mock.calls[0][0][0]).toMatchObject({ col: 4, row: 2 });
    });

    test('keeps the top token as the default drag target without a choice', async () => {
      const onMoveTokens = jest.fn(() => Promise.resolve(true));
      render(<GrigliataBoard {...stackProps({ isManager: true, currentUserId: 'dm-1', onMoveTokens })} />);

      expect(screen.getByTestId('token-stack-badge-2:2')).toBeInTheDocument();
      dragFromTokenNode('frusta');

      await waitFor(() => expect(onMoveTokens).toHaveBeenCalledTimes(1));
      expect(movedTokenIds(onMoveTokens)).toEqual(['frusta']);
    });

    test('closes the picker with Escape or an outside press without choosing', () => {
      const onSelectedTokenIdsChange = jest.fn();
      render(<GrigliataBoard {...stackProps({ onSelectedTokenIdsChange })} />);
      const badge = screen.getByTestId('token-stack-badge-2:2');

      fireEvent.click(badge);
      fireEvent.keyDown(screen.getByTestId('token-stack-option-nyx'), { key: 'Escape' });
      expect(screen.queryByTestId('token-stack-picker')).not.toBeInTheDocument();
      expect(badge).toHaveFocus();

      fireEvent.click(badge);
      fireEvent.pointerDown(document.body);
      expect(screen.queryByTestId('token-stack-picker')).not.toBeInTheDocument();
      expect(onSelectedTokenIdsChange).not.toHaveBeenCalledWith(['nyx']);
    });

    test('drags a chosen large token from any cell of its single stack badge', async () => {
      const onMoveTokens = jest.fn(() => Promise.resolve(true));
      render(
        <GrigliataBoard
          {...stackProps({
            isManager: true,
            currentUserId: 'dm-1',
            onMoveTokens,
            tokens: [nyx({ col: 1, row: 1, sizeSquares: 2 }), frusta({ col: 1, row: 1, sizeSquares: 2 })],
          })}
        />
      );

      expect(screen.getAllByTestId(/^token-stack-badge-/)).toHaveLength(1);
      chooseFromStack('1:1', 'nyx');
      dragFromTokenNode('frusta', { col: 2, row: 2 });

      await waitFor(() => expect(onMoveTokens).toHaveBeenCalledTimes(1));
      expect(movedTokenIds(onMoveTokens)).toEqual(['nyx']);
    });

    test('drops a stale choice once the chosen token no longer belongs to the viewer', () => {
      const onMoveTokens = jest.fn(() => Promise.resolve(true));
      const { rerender } = render(<GrigliataBoard {...stackProps({ onMoveTokens })} />);
      chooseFromStack('2:2', 'nyx');

      rerender(<GrigliataBoard {...stackProps({ onMoveTokens, tokens: [nyx({ ownerUid: 'player-3' }), frusta()] })} />);
      dragFromTokenNode('frusta');

      expect(onMoveTokens).not.toHaveBeenCalled();
    });

    test('uses a stack choice for one drag when large tokens still overlap after the move', async () => {
      const onMoveTokens = jest.fn();
      const props = (col) => stackProps({
        isManager: true,
        onMoveTokens,
        tokens: [nyx({ col, sizeSquares: 2 }), frusta({ sizeSquares: 2 })],
      });
      const { rerender } = render(<GrigliataBoard {...props(2)} />);
      chooseFromStack('2:2', 'nyx');
      dragFromTokenNode('frusta', { deltaCol: -1 });
      await waitFor(() => expect(onMoveTokens).toHaveBeenCalledTimes(1));
      expect(onMoveTokens.mock.calls[0][0]).toMatchObject([{ tokenId: 'nyx', col: 1 }]);

      rerender(<GrigliataBoard {...props(1)} />);
      dragFromTokenNode('frusta');
      await waitFor(() => expect(onMoveTokens).toHaveBeenCalledTimes(2));
      expect(onMoveTokens.mock.calls[1][0]).toMatchObject([{ tokenId: 'frusta', col: 4 }]);
    });

    test('can drag a covered token through a small opening beyond the first eight sight polygons', async () => {
      const onMoveTokens = jest.fn();
      const opening = (left, top, right, bottom) => [[
        { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
      ]];
      render(<GrigliataBoard {...stackProps({
        activeBackground: { ...buildProps().activeBackground, tokenLayerOrder: ['nyx', 'bora', 'frusta'] },
        tokens: [
          nyx({ col: 0, row: 0, sizeSquares: 2 }),
          stackToken('bora', 'player-1', 'Bora', { col: 1, row: 0, sizeSquares: 2 }),
          frusta({ col: 1, row: 1 }),
        ],
        fogOfWar: { currentVisiblePolygons: [
          ...Array.from({ length: 8 }, (_, index) => opening(index * 8, 0, index * 8 + 2, 2)),
          opening(74, 100, 76, 102),
          opening(83, 83, 86, 86),
        ] },
        onMoveTokens,
      })} />);
      const stage = screen.getByTestId('konva-stage');
      // At normal viewing scale the badge covers Bora's three-pixel opening.
      for (let step = 0; step < 4; step += 1) fireEvent.wheel(stage, { deltaY: -120 });
      chooseFromStack('1:1', 'bora');
      const badge = screen.getByTestId('token-stack-badge-1:1');
      const gridPosition = 84.5 / grid.cellSizePx - 0.5;
      const point = cellCenterClient(gridPosition, gridPosition);
      const start = { clientX: Math.round(point.clientX), clientY: Math.round(point.clientY) };
      const end = cellCenterClient(gridPosition + 2, gridPosition);
      const badgeLeft = Number.parseFloat(badge.style.left);
      const badgeTop = Number.parseFloat(badge.style.top);
      const badgeSize = Number.parseFloat(badge.style.width);
      expect(start.clientX).toBeGreaterThan(badgeLeft);
      expect(start.clientX).toBeLessThan(badgeLeft + badgeSize);
      expect(start.clientY).toBeGreaterThan(badgeTop);
      expect(start.clientY).toBeLessThan(badgeTop + badgeSize);
      fireEvent.mouseDown(badge, { button: 0, buttons: 1, ...start });
      fireEvent.mouseUp(window, { button: 0, buttons: 0, ...start });
      fireEvent.click(badge);
      expect(screen.getByRole('dialog', { name: 'Pedine sovrapposte' })).toBeVisible();
      fireEvent.click(screen.getByTestId('token-stack-option-bora'));
      expect(onMoveTokens).not.toHaveBeenCalled();

      fireEvent.mouseDown(badge, { button: 0, buttons: 1, ...start });
      fireEvent.mouseMove(window, { buttons: 1, ...end });
      fireEvent.mouseUp(window, { button: 0, buttons: 0, ...end });

      await waitFor(() => expect(onMoveTokens).toHaveBeenCalledTimes(1));
      expect(onMoveTokens.mock.calls[0][0]).toMatchObject([{ tokenId: 'bora', col: 3, row: 0 }]);
    });

    test('Delete targets the chosen token after selecting an area of effect', async () => {
      const figureId = 'map-1__player-1__circle__1';
      const onDeleteTokens = jest.fn();
      const onDeleteAoEFigures = jest.fn();
      render(<GrigliataBoard {...stackProps({
        aoeFigures: [{
          id: figureId, backgroundId: 'map-1', ownerUid: 'player-1', figureType: 'circle', slot: 1,
          originCell: { col: 5, row: 5 }, targetCell: { col: 6, row: 5 },
          colorKey: 'ion-cyan', isVisibleToPlayers: true,
        }],
        onDeleteTokens,
        onDeleteAoEFigures,
      })} />);
      const point = cellCenterClient(5, 5);
      fireEvent.mouseDown(screen.getByTestId(`aoe-figure-hit-target-${figureId}`), { button: 0, buttons: 1, ...point });
      fireEvent.mouseUp(window, { button: 0, buttons: 0, ...point });
      expect(screen.getByRole('button', { name: /delete selected aoe figure/i })).toBeInTheDocument();

      chooseFromStack('2:2', 'nyx');
      fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });
      await waitFor(() => expect(onDeleteTokens).toHaveBeenCalledWith(['nyx']));
      expect(onDeleteAoEFigures).not.toHaveBeenCalled();
    });

    test('does not revive a choice after its token moves away and back', async () => {
      const onMoveTokens = jest.fn(() => Promise.resolve(true));
      const managerProps = (tokens) => stackProps({ isManager: true, currentUserId: 'dm-1', onMoveTokens, tokens });
      const { rerender } = render(<GrigliataBoard {...managerProps([nyx(), frusta()])} />);
      chooseFromStack('2:2', 'nyx');

      rerender(<GrigliataBoard {...managerProps([nyx({ col: 6, row: 6 }), frusta()])} />);
      expect(screen.queryByTestId('token-stack-badge-2:2')).not.toBeInTheDocument();
      rerender(<GrigliataBoard {...managerProps([nyx(), frusta()])} />);
      dragFromTokenNode('frusta');

      await waitFor(() => expect(onMoveTokens).toHaveBeenCalledTimes(1));
      expect(movedTokenIds(onMoveTokens)).toEqual(['frusta']);
    });

    test('ignores a choice when the press lands outside the chosen stack', async () => {
      const onMoveTokens = jest.fn(() => Promise.resolve(true));
      render(
        <GrigliataBoard
          {...stackProps({
            isManager: true,
            currentUserId: 'dm-1',
            onMoveTokens,
            tokens: [nyx(), frusta({ sizeSquares: 2 })],
          })}
        />
      );
      chooseFromStack('2:2', 'nyx');

      // Frusta covers 2:2..3:3; pressing it at 3:3 is outside Nyx's stack.
      dragFromTokenNode('frusta', { col: 3, row: 3 });

      await waitFor(() => expect(onMoveTokens).toHaveBeenCalledTimes(1));
      expect(movedTokenIds(onMoveTokens)).toEqual(['frusta']);
    });

    test('hides stack badges while a board tool owns the pointer', () => {
      render(<GrigliataBoard {...stackProps({ isRulerEnabled: true })} />);
      expect(screen.queryByTestId('token-stack-badge-2:2')).not.toBeInTheDocument();
    });
  });

  test('paints fog from a token-covered cell while the fog brush is active', async () => {
    const onMoveTokens = jest.fn(() => Promise.resolve(true));
    const onPaintFogBrush = jest.fn(() => Promise.resolve(true));

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          currentUserId: 'dm-1',
          onMoveTokens,
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
          fogBrushControls: {
            isFogBrushToolActive: true,
            mode: 'reveal',
            radiusSquares: 2,
            onToggleFogBrushTool: jest.fn(),
            onChangeMode: jest.fn(),
            onChangeRadiusSquares: jest.fn(),
            onPaintFogBrush,
          },
        })}
      />
    );

    const token = screen.getByTestId('token-node-user-1');
    fireEvent.mouseDown(token, { button: 0, buttons: 1, clientX: 175, clientY: 175 });
    fireEvent.mouseMove(window, { clientX: 245, clientY: 245, buttons: 1 });
    fireEvent.mouseUp(window, { button: 0, clientX: 245, clientY: 245, buttons: 0 });

    await waitFor(() => {
      expect(onPaintFogBrush).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'reveal',
        radiusSquares: 2,
        point: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      }));
    });
    expect(onMoveTokens).not.toHaveBeenCalled();
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
    expect(__getImageAssetRegistryStats().namedPins).toEqual([
      IMAGE_ASSET_PIN_NAMES.ACTIVE_BOARD,
      IMAGE_ASSET_PIN_NAMES.CROSSFADE,
    ]);

    await act(async () => {
      jest.advanceTimersByTime(240);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1920');
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();
    expect(__getImageAssetRegistryStats().namedPins).toEqual([
      IMAGE_ASSET_PIN_NAMES.ACTIVE_BOARD,
    ]);
  });

  test('fits a new map before leasing its ordinary token media', async () => {
    const buildToken = (tokenId, ownerUid) => ({
      tokenId,
      id: tokenId,
      ownerUid,
      tokenType: 'character',
      label: tokenId,
      imageUrl: `https://example.com/${tokenId}.png`,
      placed: true,
      col: 2,
      row: 2,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
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

    await waitFor(() => {
      const stage = document.querySelector('[data-konva-type="Stage"]');
      expect(Number(stage?.getAttribute('data-scalex'))).not.toBe(1);
    });
    useImageAssetSnapshot.mockClear();

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
          tokens: [
            buildToken('ordinary-map-2', 'another-user'),
            buildToken('owned-map-2', 'current-user'),
          ],
        })}
      />
    );

    await waitFor(() => {
      expect(useImageAssetSnapshot).toHaveBeenCalledWith(
        'https://example.com/ordinary-map-2.png',
        TOKEN_PORTRAIT_SNAPSHOT_OPTIONS
      );
    });
    const requestedUrls = useImageAssetSnapshot.mock.calls.map(([url]) => url);
    const firstOwnedRequest = requestedUrls.indexOf('https://example.com/owned-map-2.png');
    const firstOrdinaryRequest = requestedUrls.indexOf('https://example.com/ordinary-map-2.png');

    expect(firstOwnedRequest).toBeGreaterThanOrEqual(0);
    expect(firstOrdinaryRequest).toBeGreaterThan(firstOwnedRequest);
    expect(requestedUrls.slice(0, firstOrdinaryRequest)).toContain('');
  });

  test('waits for background geometry before completing the token-media viewport fit', async () => {
    const buildToken = (tokenId, ownerUid) => ({
      tokenId,
      id: tokenId,
      ownerUid,
      tokenType: 'character',
      label: tokenId,
      imageUrl: `https://example.com/${tokenId}.png`,
      placed: true,
      col: 2,
      row: 2,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
    });
    const props = buildProps({
      activeBackground: {
        id: 'map-loading-geometry',
        name: 'Loading Geometry',
        imageUrl: 'https://example.com/map-loading-geometry.png',
        imageWidth: 0,
        imageHeight: 0,
      },
      tokens: [
        buildToken('ordinary-loading-geometry', 'another-user'),
        buildToken('owned-loading-geometry', 'current-user'),
      ],
    });
    useImageAssetSnapshot.mockImplementation(() => ({
      status: 'loading',
      image: null,
      error: null,
    }));
    const { rerender } = render(<GrigliataBoard {...props} />);

    await act(async () => {});
    expect(useImageAssetSnapshot).not.toHaveBeenCalledWith(
      'https://example.com/owned-loading-geometry.png',
      TOKEN_PORTRAIT_SNAPSHOT_OPTIONS
    );
    expect(useImageAssetSnapshot).not.toHaveBeenCalledWith(
      'https://example.com/ordinary-loading-geometry.png',
        TOKEN_PORTRAIT_SNAPSHOT_OPTIONS
    );

    useImageAssetSnapshot.mockImplementation(() => ({
      status: 'loaded',
      image: mockAlternateBattlemapImage,
      error: null,
    }));
    rerender(<GrigliataBoard {...props} />);

    await waitFor(() => {
      expect(useImageAssetSnapshot).toHaveBeenCalledWith(
        'https://example.com/ordinary-loading-geometry.png',
        TOKEN_PORTRAIT_SNAPSHOT_OPTIONS
      );
      expect(useImageAssetSnapshot).toHaveBeenCalledWith(
        'https://example.com/owned-loading-geometry.png',
        TOKEN_PORTRAIT_SNAPSHOT_OPTIONS
      );
    });
  });

  test.each([
    {
      label: 'media-less',
      imageUrl: '',
      snapshot: { status: 'idle', image: null, error: null },
    },
    {
      label: 'failed-media',
      imageUrl: 'https://example.com/failed-geometry.png',
      snapshot: { status: 'error', image: null, error: new Error('fixture failure') },
    },
  ])('allows ordinary token media after the $label geometry fallback settles', async ({
    imageUrl,
    label,
    snapshot,
  }) => {
    const portraitUrl = `https://example.com/ordinary-${label}.png`;
    let failedPortraitReads = 0;
    useImageAssetSnapshot.mockImplementation((src) => {
      // A cached decode failure can be reported on the very first render.
      // Fail promptly if fallback starts reading the failed URL in a loop.
      if (src === portraitUrl && snapshot.status === 'error' && ++failedPortraitReads > 16) {
        throw new Error('The terminal portrait failure did not settle');
      }
      return snapshot;
    });
    render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: `map-${label}`,
            name: label,
            imageUrl,
            imageWidth: 0,
            imageHeight: 0,
          },
          tokens: [{
            tokenId: `ordinary-${label}`,
            id: `ordinary-${label}`,
            ownerUid: 'another-user',
            tokenType: 'character',
            label,
            imageUrl: portraitUrl,
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

    await waitFor(() => {
      expect(useImageAssetSnapshot).toHaveBeenCalledWith(
        portraitUrl,
        TOKEN_PORTRAIT_SNAPSHOT_OPTIONS
      );
    });
  });

  describe.each([
    {viewer: 'DM', isManager: true},
    {viewer: 'player', isManager: false},
  ])('$viewer low-zoom token portraits', ({isManager}) => {
    const originalInnerWidth = window.innerWidth;
    const mapUrl = 'https://example.com/low-zoom-map.png';
    const lowZoomMapImage = {
      width: 5000,
      height: 5000,
      naturalWidth: 5000,
      naturalHeight: 5000,
    };
    const tokenPortraitImage = {
      width: 64,
      height: 64,
      naturalWidth: 64,
      naturalHeight: 64,
    };
    const lowZoomGrid = buildGridConfig(50);

    afterEach(() => {
      window.innerWidth = originalInnerWidth;
    });

    test.each([
      {profile: 'desktop', innerWidth: 1280, art: 'shared'},
      {profile: 'desktop', innerWidth: 1280, art: 'distinct'},
      {profile: 'compact', innerWidth: 390, art: 'shared'},
      {profile: 'compact', innerWidth: 390, art: 'distinct'},
    ])('renders every visible $art portrait on the $profile profile', async ({
      profile,
      innerWidth,
      art,
    }) => {
      window.innerWidth = innerWidth;
      if (profile === 'compact') {
        getBoundingClientRectSpy.mockReturnValue({
          width: innerWidth, height: 844, top: 0, left: 0, right: innerWidth, bottom: 844,
        });
      }
      const limits = getImageAssetRegistryRuntimeLimits();
      expect(limits.profile).toBe(profile);

      const visibleCount = art === 'shared' ? 80 : 200;
      const artFor = (index) => (
        art === 'shared'
          ? 'https://example.com/shared-portrait.png'
          : `https://example.com/distinct-portrait-${index}.png`
      );
      const buildLowZoomToken = (tokenId, overrides = {}) => ({
        tokenId,
        id: tokenId,
        ownerUid: 'another-user',
        tokenType: 'character',
        label: tokenId,
        placed: true,
        isVisibleToPlayers: true,
        isDead: false,
        statuses: [],
        ...overrides,
      });
      const visibleTokens = Array.from({length: visibleCount}, (_, index) => buildLowZoomToken(
        `low-zoom-${index}`,
        {imageUrl: artFor(index), col: index % 20, row: Math.floor(index / 20)}
      ));
      const foggedUrl = 'https://example.com/fogged-out.png';
      const tokens = [
        ...visibleTokens,
        buildLowZoomToken('fogged-out', {imageUrl: foggedUrl, col: 1, row: 12}),
      ];
      const requestedUrls = new Set();
      const imagesBySource = new Map(tokens.map(({imageUrl}) => [
        imageUrl, {...tokenPortraitImage, src: imageUrl},
      ]));
      useImageAssetSnapshot.mockImplementation((src) => {
        if (src) requestedUrls.add(src);
        if (src === mapUrl) return {status: 'loaded', image: lowZoomMapImage, error: null};
        if (imagesBySource.has(src)) return {status: 'loaded', image: imagesBySource.get(src), error: null};
        return {status: 'idle', image: null, error: null};
      });

      render(
        <GrigliataBoard
          {...buildProps({
            grid: lowZoomGrid,
            activeBackground: {
              id: 'map-low-zoom',
              name: 'Low Zoom',
              imageUrl: mapUrl,
              imageWidth: 5000,
              imageHeight: 5000,
              grid: lowZoomGrid,
            },
            currentUserId: isManager ? 'dm-user' : 'player-user',
            isManager,
            tokens,
            fogOfWar: {
              exploredCells: [],
              currentVisibleCells: visibleTokens.map(({col, row}) => `${col}:${row}`),
            },
          })}
        />
      );

      const expectedPortraitIds = [
        ...visibleTokens.map(({tokenId}) => tokenId),
        ...(isManager ? ['fogged-out'] : []),
      ];
      await waitFor(() => {
        expectedPortraitIds.forEach((tokenId) => {
          expect(
            screen.getByTestId(`token-node-${tokenId}`)
              .querySelector('[data-name="token-portrait"]')
          ).not.toBeNull();
        });
      });

      // The scenario must exercise a crowded, tiny-token overview that exceeds
      // the old token-ID budget instead of passing on a handful of large tokens.
      const stageScale = Number(
        document.querySelector('[data-konva-type="Stage"]')?.getAttribute('data-scalex')
      );
      expect(stageScale).toBeGreaterThan(0);
      expect(50 * stageScale).toBeLessThan(16);
      expect(visibleCount).toBeGreaterThan(limits.maxRecords - 24);

      expectedPortraitIds.forEach((tokenId) => {
        const tokenNode = screen.getByTestId(`token-node-${tokenId}`);
        const portraits = tokenNode.querySelectorAll('[data-name="token-portrait"]');
        expect(portraits).toHaveLength(1);
        expect(portraits[0]).toHaveAttribute('data-konva-type', 'Image');
        const expectedUrl = tokenId === 'fogged-out' ? foggedUrl : artFor(Number(tokenId.slice('low-zoom-'.length)));
        expect(JSON.parse(portraits[0].getAttribute('data-image')).src).toBe(expectedUrl);
        expect(tokenNode.querySelector('[data-name="token-portrait-placeholder"]')).toBeNull();
      });
      const tokenArtRequests = [...requestedUrls].filter((url) => url !== mapUrl);
      expect(tokenArtRequests).toEqual(expect.arrayContaining(visibleTokens.map(({imageUrl}) => imageUrl)));
      expect(new Set(visibleTokens.map(({imageUrl}) => imageUrl)).size)
        .toBe(art === 'shared' ? 1 : visibleCount);
      // Player fog privacy: a fogged-out token is neither rendered nor fetched;
      // the DM sees and loads it.
      expect(screen.queryByTestId('token-node-fogged-out') !== null).toBe(isManager);
      expect(requestedUrls.has(foggedUrl)).toBe(isManager);
    });
  });

  test('preserves the completed token-media fit across wheel zoom updates', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: {
            id: 'map-wheel-fit',
            name: 'Wheel Fit',
            imageUrl: 'https://example.com/map-wheel-fit.png',
            imageWidth: 1280,
            imageHeight: 720,
          },
          tokens: [{
            tokenId: 'ordinary-wheel-fit',
            id: 'ordinary-wheel-fit',
            ownerUid: 'another-user',
            tokenType: 'character',
            label: 'Ordinary wheel fit',
            imageUrl: 'https://example.com/ordinary-wheel-fit.png',
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

    await waitFor(() => {
      expect(useImageAssetSnapshot).toHaveBeenCalledWith(
        'https://example.com/ordinary-wheel-fit.png',
        TOKEN_PORTRAIT_SNAPSHOT_OPTIONS
      );
    });
    useImageAssetSnapshot.mockClear();
    const stage = document.querySelector('[data-konva-type="Stage"]');
    fireEvent.wheel(stage, { deltaY: -120 });

    await waitFor(() => {
      expect(useImageAssetSnapshot).toHaveBeenCalledWith(
        'https://example.com/ordinary-wheel-fit.png',
        TOKEN_PORTRAIT_SNAPSHOT_OPTIONS
      );
    });
  });

  test('fades into the narration battlemap without showing the combat map underneath', async () => {
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
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '0');
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');
  });

  test('replaces narration with sequential half-duration fades in one second total', async () => {
    jest.useFakeTimers();
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 16);

    const firstBackground = {
      id: 'map-2',
      name: 'Iron Keep',
      imageUrl: 'https://example.com/map-2.png',
      imageWidth: 1920,
      imageHeight: 1080,
    };
    const secondBackground = {
      id: 'map-3',
      name: 'Frost Hall',
      imageUrl: 'https://example.com/map-3.png',
      imageWidth: 1600,
      imageHeight: 900,
    };
    const buildNarrationProps = (background) => ({
      activeBackground: background,
      isNarrationOverlayActive: true,
      narrationBackgrounds: [background],
      narrationPlacements: [{
        id: `background:${background.id}`,
        backgroundId: background.id,
        x: 0,
        y: 0,
        width: background.imageWidth,
        height: background.imageHeight,
        order: 0,
        mode: 'free',
        attachedSide: '',
      }],
    });

    const { rerender } = render(
      <GrigliataBoard {...buildProps(buildNarrationProps(firstBackground))} />
    );

    await act(async () => {
      jest.advanceTimersByTime(1050);
    });
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');

    rerender(<GrigliataBoard {...buildProps(buildNarrationProps(secondBackground))} />);

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1920');
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-transition-role', 'outgoing');

    await act(async () => {
      jest.advanceTimersByTime(520);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1600');
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-transition-role', 'incoming');
    expect(Number(screen.getByTestId('battlemap-image-active').getAttribute('data-opacity'))).toBeLessThan(0.2);

    await act(async () => {
      jest.advanceTimersByTime(520);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1600');
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-transition-role', 'stable');
  });

  test('retains and fades narration out before restoring the combat battlemap', async () => {
    jest.useFakeTimers();
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 16);

    const combatBackground = {
      id: 'map-1',
      name: 'Sunken Ruins',
      imageUrl: 'https://example.com/map-1.png',
      imageWidth: 1280,
      imageHeight: 720,
    };
    const narrationBackground = {
      id: 'map-2',
      name: 'Iron Keep',
      imageUrl: 'https://example.com/map-2.png',
      imageWidth: 1920,
      imageHeight: 1080,
    };
    const narrationPlacement = {
      id: 'background:map-2',
      backgroundId: 'map-2',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      order: 0,
      mode: 'free',
      attachedSide: '',
    };

    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: narrationBackground,
          isNarrationOverlayActive: true,
          narrationBackgrounds: [narrationBackground],
          narrationPlacements: [narrationPlacement],
        })}
      />
    );
    await act(async () => {
      jest.advanceTimersByTime(1050);
    });

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeBackground: combatBackground,
          isNarrationOverlayActive: false,
          narrationBackgrounds: [],
          narrationPlacements: [],
        })}
      />
    );

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1920');
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-transition-role', 'outgoing');
    expect(screen.queryByTestId('grid-layer')).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1050);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1280');
    expect(screen.getByTestId('grid-layer')).toBeInTheDocument();
  });

  test('centers and maximizes the narration image using image bounds while combat maps keep board fit', async () => {
    useReducedMotion.mockReturnValue(true);

    const background = {
      id: 'map-1',
      name: 'Desert Narration',
      imageUrl: 'https://example.com/desert.png',
      imageWidth: 1920,
      imageHeight: 1080,
    };

    const { container, rerender } = render(
      <GrigliataBoard
        {...buildProps({
          activeBackground: background,
        })}
      />
    );

    const getStage = () => container.querySelector('[data-konva-type="Stage"]');

    await waitFor(() => {
      expect(getNumericKonvaProp(getStage(), 'data-scalex')).toBeCloseTo(544 / 1400, 5);
    });

    expect(getNumericKonvaProp(getStage(), 'data-scalex')).toBeLessThan(824 / 1920);

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeBackground: background,
          combatBackgroundName: 'Untitled Map',
          isNarrationOverlayActive: true,
        })}
      />
    );

    await waitFor(() => {
      expect(getNumericKonvaProp(getStage(), 'data-scalex')).toBeCloseTo(824 / 1920, 5);
    });

    const activeImage = screen.getByTestId('battlemap-image-active');
    const viewportLeft = getNumericKonvaProp(getStage(), 'data-x');
    const viewportTop = getNumericKonvaProp(getStage(), 'data-y');
    const viewportScale = getNumericKonvaProp(getStage(), 'data-scalex');
    const imageScreenWidth = getNumericKonvaProp(activeImage, 'data-width') * viewportScale;
    const imageScreenHeight = getNumericKonvaProp(activeImage, 'data-height') * viewportScale;

    expect(activeImage).toHaveAttribute('data-width', '1920');
    expect(activeImage).toHaveAttribute('data-height', '1080');
    expect(imageScreenWidth).toBeCloseTo(824, 4);
    expect(viewportLeft + (imageScreenWidth / 2)).toBeCloseTo(460, 4);
    expect(viewportTop + (imageScreenHeight / 2)).toBeCloseTo(320, 4);
    expect(screen.queryByTestId('battlemap-image-outgoing')).not.toBeInTheDocument();
  });

  test('preserves a narration viewport when unrelated combat-map geometry hydrates', async () => {
    useReducedMotion.mockReturnValue(true);
    const narrationBackground = {
      id: 'narration-map',
      name: 'Narration Map',
      imageUrl: 'https://example.com/narration-map.png',
      imageWidth: 1920,
      imageHeight: 1080,
    };
    const narrationPlacement = {
      id: 'background:narration-map',
      backgroundId: 'narration-map',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      order: 0,
    };
    const buildNarrationProps = (imageWidth, imageHeight) => buildProps({
      activeBackground: {
        id: 'combat-map-hydrating',
        name: 'Combat Map',
        imageUrl: '',
        imageWidth,
        imageHeight,
      },
      isNarrationOverlayActive: true,
      narrationBackgrounds: [narrationBackground],
      narrationPlacements: [narrationPlacement],
    });
    const { container, rerender } = render(
      <GrigliataBoard {...buildNarrationProps(0, 0)} />
    );
    const getStage = () => container.querySelector('[data-konva-type="Stage"]');

    await waitFor(() => {
      expect(getNumericKonvaProp(getStage(), 'data-scalex')).toBeCloseTo(824 / 1920, 5);
    });
    fireEvent.wheel(getStage(), { deltaY: -120 });
    await waitFor(() => {
      expect(getNumericKonvaProp(getStage(), 'data-scalex')).toBeGreaterThan(824 / 1920);
    });
    const zoomedViewport = {
      x: getNumericKonvaProp(getStage(), 'data-x'),
      y: getNumericKonvaProp(getStage(), 'data-y'),
      scale: getNumericKonvaProp(getStage(), 'data-scalex'),
    };

    rerender(<GrigliataBoard {...buildNarrationProps(5000, 5000)} />);
    await act(async () => {});

    expect(getNumericKonvaProp(getStage(), 'data-x')).toBeCloseTo(zoomedViewport.x, 5);
    expect(getNumericKonvaProp(getStage(), 'data-y')).toBeCloseTo(zoomedViewport.y, 5);
    expect(getNumericKonvaProp(getStage(), 'data-scalex')).toBeCloseTo(zoomedViewport.scale, 5);
  });

  test('renders multi-image narration placements and persists DM movement', async () => {
    useReducedMotion.mockReturnValue(true);
    const onMoveNarrationPlacement = jest.fn();
    const { container } = render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          isNarrationOverlayActive: true,
          activeBackground: {
            id: 'map-2',
            name: 'Iron Keep',
            imageUrl: 'https://example.com/map-2.png',
            imageWidth: 1920,
            imageHeight: 1080,
          },
          narrationBackgrounds: [{
            id: 'map-2',
            name: 'Iron Keep',
            imageUrl: 'https://example.com/map-2.png',
            imageWidth: 1920,
            imageHeight: 1080,
          }, {
            id: 'map-3',
            name: 'Frost Hall',
            imageUrl: 'https://example.com/map-3.png',
            imageWidth: 1600,
            imageHeight: 900,
          }],
          narrationPlacements: [{
            id: 'background:map-2',
            backgroundId: 'map-2',
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            order: 0,
            mode: 'free',
            attachedSide: '',
          }, {
            id: 'background:map-3',
            backgroundId: 'map-3',
            x: 1920,
            y: 90,
            width: 1600,
            height: 900,
            order: 1,
            mode: 'magnetic',
            attachedSide: 'right',
          }],
          onMoveNarrationPlacement,
        })}
      />
    );

    const stage = container.querySelector('[data-konva-type="Stage"]');
    await waitFor(() => {
      expect(getNumericKonvaProp(stage, 'data-scalex')).toBeCloseTo(824 / 3520, 5);
    });

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-width', '1920');
    expect(screen.getByTestId('narration-overlay-count-badge')).toHaveTextContent('+1');

    const secondaryImage = screen.getByTestId('narration-image-placement-background:map-3');
    expect(secondaryImage).toHaveAttribute('data-x', '1920');
    expect(secondaryImage).toHaveAttribute('data-y', '90');
    expect(secondaryImage).toHaveAttribute('data-draggable', 'true');

    secondaryImage.setAttribute('data-x', '2100');
    secondaryImage.setAttribute('data-y', '120');
    fireEvent.dragEnd(secondaryImage);

    expect(onMoveNarrationPlacement).toHaveBeenCalledWith('background:map-3', { x: 2100, y: 120 });
  });

  test('fades only placements added to or removed from multi-image narration', async () => {
    jest.useFakeTimers();
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 16);

    const backgrounds = [{
      id: 'map-2',
      name: 'Iron Keep',
      imageUrl: 'https://example.com/map-2.png',
      imageWidth: 1920,
      imageHeight: 1080,
    }, {
      id: 'map-3',
      name: 'Frost Hall',
      imageUrl: 'https://example.com/map-3.png',
      imageWidth: 1600,
      imageHeight: 900,
    }];
    const primaryPlacement = {
      id: 'background:map-2',
      backgroundId: 'map-2',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      order: 0,
      mode: 'free',
      attachedSide: '',
    };
    const secondaryPlacement = {
      id: 'background:map-3',
      backgroundId: 'map-3',
      x: 1920,
      y: 90,
      width: 1600,
      height: 900,
      order: 1,
      mode: 'magnetic',
      attachedSide: 'right',
    };
    const buildMultiProps = (placements) => buildProps({
      activeBackground: backgrounds[0],
      isNarrationOverlayActive: true,
      narrationBackgrounds: backgrounds,
      narrationPlacements: placements,
    });

    const { rerender } = render(<GrigliataBoard {...buildMultiProps([primaryPlacement])} />);
    await act(async () => {
      jest.advanceTimersByTime(1050);
    });

    rerender(<GrigliataBoard {...buildMultiProps([primaryPlacement, secondaryPlacement])} />);

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');
    expect(screen.getByTestId('narration-image-placement-background:map-3')).toHaveAttribute('data-opacity', '0');
    expect(screen.getByTestId('narration-image-placement-background:map-3')).toHaveAttribute('data-transition-role', 'incoming');

    await act(async () => {
      jest.advanceTimersByTime(1050);
    });
    expect(screen.getByTestId('narration-image-placement-background:map-3')).toHaveAttribute('data-opacity', '1');

    rerender(<GrigliataBoard {...buildMultiProps([primaryPlacement])} />);

    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');
    expect(screen.getByTestId('narration-image-placement-background:map-3')).toHaveAttribute('data-transition-role', 'outgoing');

    await act(async () => {
      jest.advanceTimersByTime(1050);
    });
    expect(screen.queryByTestId('narration-image-placement-background:map-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('battlemap-image-active')).toHaveAttribute('data-opacity', '1');
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

  test.each([
    { roleLabel: 'player', isManager: false },
    { roleLabel: 'manager', isManager: true },
  ])('allows $roleLabel viewers to zoom the battlemap out to five percent scale', ({ isManager }) => {
    const { container } = render(
      <GrigliataBoard {...buildProps({ isManager })} />
    );

    const stage = container.querySelector('[data-konva-type="Stage"]');
    expect(stage).toBeTruthy();

    for (let index = 0; index < 24; index += 1) {
      fireEvent.wheel(stage, { deltaY: 120 });
    }

    expect(Number.parseFloat(stage.getAttribute('data-scalex') || '1')).toBeCloseTo(MIN_GRIGLIATA_VIEWPORT_SCALE, 5);
    expect(Number.parseFloat(stage.getAttribute('data-scaley') || '1')).toBeCloseTo(MIN_GRIGLIATA_VIEWPORT_SCALE, 5);
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

  test('shows the ruler token movement toggle only while ruler mode is active', () => {
    const onToggleRulerTokenMovement = jest.fn();
    const { rerender } = render(
      <GrigliataBoard
        {...buildProps({
          onToggleRulerTokenMovement,
        })}
      />
    );

    expect(screen.queryByTestId('ruler-token-move-toggle')).not.toBeInTheDocument();

    rerender(
      <GrigliataBoard
        {...buildProps({
          isRulerEnabled: true,
          isRulerTokenMovementEnabled: false,
          onToggleRulerTokenMovement,
        })}
      />
    );

    const movementToggle = screen.getByTestId('ruler-token-move-toggle');
    expect(movementToggle).toHaveAttribute('aria-pressed', 'false');
    expect(movementToggle.className).not.toContain('bg-gradient-to-br');

    fireEvent.click(movementToggle);
    expect(onToggleRulerTokenMovement).toHaveBeenCalledTimes(1);

    rerender(
      <GrigliataBoard
        {...buildProps({
          isRulerEnabled: true,
          isRulerTokenMovementEnabled: true,
          onToggleRulerTokenMovement,
        })}
      />
    );

    expect(screen.getByTestId('ruler-token-move-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ruler-token-move-toggle').className).toContain('bg-gradient-to-br');
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

  test('renders active viewer names with drawing color swatches', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          activeViewers: [
            {
              ownerUid: 'user-2',
              characterId: 'Nyra',
              colorKey: 'ion-cyan',
            },
            {
              ownerUid: 'user-3',
              characterId: 'Bran',
              colorKey: 'solar-amber',
            },
          ],
        })}
      />
    );

    expect(screen.getByTestId('grigliata-active-viewers')).toBeInTheDocument();
    expect(screen.getByTestId('grigliata-active-viewer-user-2')).toHaveTextContent('Nyra');
    expect(screen.getByTestId('grigliata-active-viewer-swatch-user-2')).toHaveStyle({
      backgroundColor: '#38bdf8',
    });
    expect(screen.getByTestId('grigliata-active-viewer-user-3')).toHaveTextContent('Bran');
    expect(screen.getByTestId('grigliata-active-viewer-swatch-user-3')).toHaveStyle({
      backgroundColor: '#fbbf24',
    });
  });

  test('does not render the active viewers overlay when the list is empty', () => {
    render(<GrigliataBoard {...buildProps({ activeViewers: [] })} />);

    expect(screen.queryByTestId('grigliata-active-viewers')).not.toBeInTheDocument();
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

  test('renders tokens in the battlemap layer order without bringing a selected token forward', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          activeBackground: {
            id: 'map-1',
            name: 'Sunken Ruins',
            grid,
            imageWidth: 0,
            imageHeight: 0,
            tokenLayerOrder: ['large', 'small'],
          },
          tokens: [
            {
              tokenId: 'small',
              id: 'small',
              ownerUid: 'user-2',
              label: 'Small',
              imageUrl: '',
              placed: true,
              col: 1,
              row: 1,
              sizeSquares: 1,
              isVisibleToPlayers: true,
              statuses: [],
            },
            {
              tokenId: 'large',
              id: 'large',
              ownerUid: 'user-1',
              label: 'Large',
              imageUrl: '',
              placed: true,
              col: 0,
              row: 0,
              sizeSquares: 3,
              isVisibleToPlayers: true,
              statuses: [],
            },
          ],
        })}
      />
    );

    const largeToken = screen.getByTestId('token-node-large');
    const smallToken = screen.getByTestId('token-node-small');
    const assertLargeRendersBeforeSmall = () => {
      expect(largeToken.compareDocumentPosition(smallToken) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };

    assertLargeRendersBeforeSmall();
    fireEvent.mouseDown(largeToken, {
      button: 0,
      buttons: 1,
      clientX: 70,
      clientY: 70,
    });
    assertLargeRendersBeforeSmall();
  });

  test('shows overlap-aware layer controls for one DM-selected token', () => {
    const onMoveTokenLayer = jest.fn();
    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          currentUserId: 'dm-1',
          onMoveTokenLayer,
          activeBackground: {
            id: 'map-1',
            name: 'Sunken Ruins',
            grid,
            imageWidth: 0,
            imageHeight: 0,
            tokenLayerOrder: ['bottom', 'middle', 'top'],
          },
          tokens: ['bottom', 'middle', 'top'].map((tokenId) => ({
            tokenId,
            id: tokenId,
            ownerUid: 'dm-1',
            label: tokenId === 'middle' ? 'Middle Token' : tokenId,
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            sizeSquares: 1,
            isVisibleToPlayers: true,
            statuses: [],
          })),
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-middle'), {
      button: 0,
      buttons: 1,
      clientX: 175,
      clientY: 175,
    });

    const backwardButton = screen.getByRole('button', {
      name: /move middle token one overlapping layer backward/i,
    });
    const forwardButton = screen.getByRole('button', {
      name: /move middle token one overlapping layer forward/i,
    });
    expect(backwardButton).toBeEnabled();
    expect(forwardButton).toBeEnabled();

    fireEvent.click(backwardButton);
    fireEvent.click(forwardButton);

    expect(onMoveTokenLayer).toHaveBeenNthCalledWith(1, 'middle', 'backward');
    expect(onMoveTokenLayer).toHaveBeenNthCalledWith(2, 'middle', 'forward');
  });

  test('does not expose token layer controls to players', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [
            {
              tokenId: 'user-1',
              id: 'user-1',
              ownerUid: 'user-1',
              label: 'Player Token',
              imageUrl: '',
              placed: true,
              col: 1,
              row: 1,
              isVisibleToPlayers: true,
              statuses: [],
            },
            {
              tokenId: 'user-2',
              id: 'user-2',
              ownerUid: 'user-2',
              label: 'Other Token',
              imageUrl: '',
              placed: true,
              col: 1,
              row: 1,
              isVisibleToPlayers: true,
              statuses: [],
            },
          ],
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 105,
      clientY: 105,
    });

    expect(screen.queryByRole('button', { name: /overlapping layer/i })).not.toBeInTheDocument();
  });

  test('starts a ruler measurement from a movable token without moving it by default', async () => {
    const onMoveTokens = jest.fn(() => Promise.resolve(true));
    const { container } = render(
      <GrigliataBoard
        {...buildProps({
          isRulerEnabled: true,
          currentUserId: 'user-1',
          onMoveTokens,
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Ilya',
            imageUrl: '',
            placed: true,
            col: 1,
            row: 1,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
        })}
      />
    );

    const tokenNode = screen.getByTestId('token-node-user-1');
    const stage = container.querySelector('[data-konva-type="Stage"]');
    const viewportLeft = getNumericKonvaProp(stage, 'data-x');
    const viewportTop = getNumericKonvaProp(stage, 'data-y');
    const viewportScale = getNumericKonvaProp(stage, 'data-scalex') || 1;
    const tokenWorldX = getNumericKonvaProp(tokenNode, 'data-x');
    const tokenWorldY = getNumericKonvaProp(tokenNode, 'data-y');
    const toClientPoint = (worldX, worldY) => ({
      clientX: viewportLeft + (worldX * viewportScale),
      clientY: viewportTop + (worldY * viewportScale),
    });

    fireEvent.mouseDown(tokenNode, {
      button: 0,
      buttons: 1,
      ...toClientPoint(tokenWorldX, tokenWorldY),
    });
    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      ...toClientPoint(tokenWorldX + (grid.cellSizePx * 2), tokenWorldY),
    });

    expect(await screen.findByTestId('measurement-overlay-local')).toHaveTextContent('10 ft (2 squares)');
    expect(onMoveTokens).not.toHaveBeenCalled();

    fireEvent.mouseUp(window, {
      button: 0,
      buttons: 0,
      ...toClientPoint(tokenWorldX + (grid.cellSizePx * 2), tokenWorldY),
    });

    expect(onMoveTokens).not.toHaveBeenCalled();
  });

  test('starts a ruler measurement from a token the user cannot control', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          isRulerEnabled: true,
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-2',
            id: 'user-2',
            ownerUid: 'user-2',
            tokenType: 'character',
            label: 'Bryn',
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

    fireEvent.mouseDown(screen.getByTestId('token-node-user-2'), {
      button: 0,
      buttons: 1,
      clientX: 175,
      clientY: 175,
    });
    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      clientX: 315,
      clientY: 175,
    });

    expect(await screen.findByTestId('measurement-overlay-local')).toBeInTheDocument();
  });

  test('moves a token while measuring only when the ruler movement toggle is enabled', async () => {
    const onMoveTokens = jest.fn(() => Promise.resolve(true));
    render(
      <GrigliataBoard
        {...buildProps({
          isRulerEnabled: true,
          isRulerTokenMovementEnabled: true,
          currentUserId: 'user-1',
          onMoveTokens,
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Ilya',
            imageUrl: '',
            placed: true,
            col: 1,
            row: 1,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 175,
      clientY: 175,
    });
    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      clientX: 315,
      clientY: 175,
    });

    expect(await screen.findByTestId('measurement-overlay-local')).toBeInTheDocument();

    fireEvent.mouseUp(window, {
      button: 0,
      buttons: 0,
      clientX: 315,
      clientY: 175,
    });

    await waitFor(() => {
      expect(onMoveTokens).toHaveBeenCalledWith([
        expect.objectContaining({
          tokenId: 'user-1',
        }),
      ]);
    });
  });

  test('starts AoE placement from a token-covered map cell', async () => {
    const onCreateAoEFigure = jest.fn(() => Promise.resolve(true));
    render(
      <GrigliataBoard
        {...buildProps({
          activeAoeFigureType: 'circle',
          onCreateAoEFigure,
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Ilya',
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

    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 175,
      clientY: 175,
    });
    fireEvent.mouseMove(window, { clientX: 315, clientY: 175, buttons: 1 });

    expect(screen.getByTestId('aoe-figure-overlay-local')).toBeInTheDocument();

    fireEvent.mouseUp(window, { button: 0, clientX: 315, clientY: 175, buttons: 0 });

    await waitFor(() => {
      expect(onCreateAoEFigure).toHaveBeenCalledWith(expect.objectContaining({
        figureType: 'circle',
      }));
    });
  });

  test('emits a local and shared ping after a long press on a token', () => {
    jest.useFakeTimers();
    const onSharedInteractionChange = jest.fn();
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          onSharedInteractionChange,
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Ilya',
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

    onSharedInteractionChange.mockClear();
    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 175,
      clientY: 175,
    });

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
    }));
  });

  test('cancels a token-started long-press ping when the token drag begins', () => {
    jest.useFakeTimers();
    const onSharedInteractionChange = jest.fn();
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          onSharedInteractionChange,
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Ilya',
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

    onSharedInteractionChange.mockClear();
    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 175,
      clientY: 175,
    });
    fireEvent.mouseMove(window, { clientX: 245, clientY: 175, buttons: 1 });

    act(() => {
      jest.advanceTimersByTime(MAP_PING_HOLD_DELAY_MS + 80);
    });

    expect(document.querySelectorAll('[data-testid^="map-ping-overlay-local-ping-"]')).toHaveLength(0);
    expect(onSharedInteractionChange.mock.calls.find(([interaction]) => interaction?.type === 'ping')).toBeUndefined();
  });

  test('right-dragging from a token pans the map without opening the token menu', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Ilya',
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
            isInTurnOrder: false,
          }],
        })}
      />
    );

    const stage = document.querySelector('[data-konva-type="Stage"]');
    const startViewportX = getNumericKonvaProp(stage, 'data-x');
    const tokenNode = screen.getByTestId('token-node-user-1');

    fireEvent.mouseDown(tokenNode, { button: 2, buttons: 2, clientX: 175, clientY: 175 });
    fireEvent.mouseMove(window, { button: 2, buttons: 2, clientX: 245, clientY: 175 });
    fireEvent.mouseUp(window, { button: 2, buttons: 0, clientX: 245, clientY: 175 });
    fireEvent.contextMenu(tokenNode, { button: 2, clientX: 245, clientY: 175 });

    await waitFor(() => {
      expect(getNumericKonvaProp(stage, 'data-x')).toBeGreaterThan(startViewportX);
    });
    expect(screen.queryByTestId('turn-order-context-menu')).not.toBeInTheDocument();
  });

  test('right-clicking a token without dragging still opens the token menu', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Ilya',
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
            isInTurnOrder: false,
          }],
        })}
      />
    );

    const tokenNode = screen.getByTestId('token-node-user-1');
    fireEvent.mouseDown(tokenNode, { button: 2, buttons: 2, clientX: 175, clientY: 175 });
    fireEvent.mouseUp(window, { button: 2, buttons: 0, clientX: 175, clientY: 175 });
    fireEvent.contextMenu(tokenNode, { button: 2, clientX: 175, clientY: 175 });

    expect(await screen.findByTestId('turn-order-context-menu')).toBeInTheDocument();
  });

  test('shows token names only while hovering the token', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            tokenType: 'character',
            label: 'Hoverling',
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

    const tokenNode = screen.getByTestId('token-node-user-1');

    expect(screen.queryByText('Hoverling')).not.toBeInTheDocument();

    fireEvent.mouseEnter(tokenNode);
    expect(screen.getByText('Hoverling')).toBeInTheDocument();

    fireEvent.mouseLeave(tokenNode);
    expect(screen.queryByText('Hoverling')).not.toBeInTheDocument();
  });

  test('renders tokens without a permanent image ring', () => {
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
        })}
      />
    );

    const tokenNode = screen.getByTestId('token-node-user-1');

    expect(tokenNode.querySelector('[data-konva-type="Circle"][data-stroke]')).toBeNull();
  });

  test('renders larger token footprints from sizeSquares', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'token-2',
            id: 'token-2',
            ownerUid: 'user-1',
            tokenType: 'custom',
            label: 'Wolf',
            imageUrl: '',
            placed: true,
            col: 2,
            row: 2,
            sizeSquares: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
        })}
      />
    );

    const tokenNode = screen.getByTestId('token-node-token-2');
    const tokenFootprint = tokenNode.querySelector(
      '[data-width="140"][data-height="140"]'
    );

    expect(tokenFootprint).toBeTruthy();
  });

  test('scales status and overflow badges down on compact 1x1 tokens', () => {
    splitTokenStatusesForDisplay.mockImplementation((statuses = []) => ({
      visibleStatuses: statuses.slice(0, 3),
      overflowStatuses: statuses.slice(3),
      overflowCount: Math.max(0, statuses.length - 3),
    }));
    getTokenStatusDefinition.mockImplementation((statusId) => ({
      id: statusId,
      badgeFill: STATUS_BADGE_FILL,
      badgeStroke: STATUS_BADGE_STROKE,
    }));
    useTokenStatusIconImages.mockImplementation((statusIds = []) => statusIds.reduce((images, statusId) => ({
      ...images,
      [statusId]: { statusId },
    }), {}));

    const { rerender } = render(<GrigliataBoard {...buildBoardPropsWithGrid(24)} />);
    const compactMetrics = getTokenOverlayMetrics(screen.getByTestId('token-node-user-1'));

    rerender(<GrigliataBoard {...buildBoardPropsWithGrid(70)} />);
    const standardMetrics = getTokenOverlayMetrics(screen.getByTestId('token-node-user-1'));

    expect(compactMetrics.statusBadgeRadius).toBeLessThan(9);
    expect(compactMetrics.statusIconWidth).toBeLessThan(10);
    expect(compactMetrics.overflowBadgeRadius).toBeLessThan(9);
    expect(compactMetrics.overflowFontSize).toBeLessThan(9);
    expect(compactMetrics.statusBadgeRadius).toBeLessThan(standardMetrics.statusBadgeRadius);
    expect(compactMetrics.statusIconWidth).toBeLessThan(standardMetrics.statusIconWidth);
    expect(compactMetrics.overflowBadgeRadius).toBeLessThan(standardMetrics.overflowBadgeRadius);
    expect(compactMetrics.overflowFontSize).toBeLessThan(standardMetrics.overflowFontSize);
  });

  test('scales hidden and dead overlays down on compact 1x1 tokens', () => {
    splitTokenStatusesForDisplay.mockImplementation((statuses = []) => ({
      visibleStatuses: statuses.slice(0, 3),
      overflowStatuses: statuses.slice(3),
      overflowCount: Math.max(0, statuses.length - 3),
    }));
    getTokenStatusDefinition.mockImplementation((statusId) => ({
      id: statusId,
      badgeFill: STATUS_BADGE_FILL,
      badgeStroke: STATUS_BADGE_STROKE,
    }));
    useTokenStatusIconImages.mockImplementation((statusIds = []) => statusIds.reduce((images, statusId) => ({
      ...images,
      [statusId]: { statusId },
    }), {}));

    const { rerender } = render(<GrigliataBoard {...buildBoardPropsWithGrid(24)} />);
    const compactMetrics = getTokenOverlayMetrics(screen.getByTestId('token-node-user-1'));

    rerender(<GrigliataBoard {...buildBoardPropsWithGrid(70)} />);
    const standardMetrics = getTokenOverlayMetrics(screen.getByTestId('token-node-user-1'));

    expect(compactMetrics.hiddenBadgeRadius).toBeLessThan(9);
    expect(compactMetrics.deadBannerHeight).toBeLessThan(15);
    expect(compactMetrics.deadFontSize).toBeLessThan(10);
    expect(compactMetrics.hiddenBadgeRadius).toBeLessThan(standardMetrics.hiddenBadgeRadius);
    expect(compactMetrics.deadBannerHeight).toBeLessThan(standardMetrics.deadBannerHeight);
    expect(compactMetrics.deadFontSize).toBeLessThan(standardMetrics.deadFontSize);
  });

  test('shows the resize control for a selected single token and anchors hud layout to the enlarged footprint', async () => {
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
            col: 8,
            row: 1,
            sizeSquares: 2,
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
            hpCurrent: 18,
            manaCurrent: 9,
            shieldCurrent: 4,
            hasShield: true,
          },
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 600,
      clientY: 80,
    });

    expect(await screen.findByRole('button', { name: /resize aldor/i })).toBeInTheDocument();

    const chipCluster = await screen.findByTestId('selected-token-resource-chip-cluster');
    const stage = container.querySelector('[data-konva-type="Stage"]');
    const tokenNode = screen.getByTestId('token-node-user-1');
    const viewportTop = Number.parseFloat(stage.getAttribute('data-y') || '0');
    const viewportScale = Number.parseFloat(stage.getAttribute('data-scaley') || '1');
    const tokenWorldTop = Number.parseFloat(tokenNode.getAttribute('data-y') || '0');
    const tokenScreenTop = viewportTop + (tokenWorldTop * viewportScale);
    const tokenScreenSize = 140 * viewportScale;
    const chipTop = Number.parseFloat(chipCluster.style.top);

    expect(chipTop).toBeGreaterThanOrEqual((tokenScreenTop + tokenScreenSize) - 0.5);
  });

  test('shows selected-token vision controls only for DMs', async () => {
    const token = {
      tokenId: 'user-2',
      id: 'user-2',
      ownerUid: 'user-2',
      tokenType: 'character',
      label: 'Bryn',
      imageUrl: '',
      placed: true,
      col: 2,
      row: 2,
      sizeSquares: 1,
      isVisibleToPlayers: true,
      isDead: false,
      statuses: [],
    };
    const { unmount } = render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'dm-1',
          isManager: true,
          tokens: [token],
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-user-2'), {
      button: 0,
      buttons: 1,
      clientX: 160,
      clientY: 160,
    });

    expect(await screen.findByRole('button', { name: /edit vision for bryn/i })).toBeInTheDocument();

    unmount();

    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-2',
          isManager: false,
          tokens: [token],
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-user-2'), {
      button: 0,
      buttons: 1,
      clientX: 160,
      clientY: 160,
    });

    expect(screen.queryByRole('button', { name: /edit vision/i })).not.toBeInTheDocument();
  });

  test('preserves sizeSquares when dragging a token', async () => {
    const onMoveTokens = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({
          currentUserId: 'user-1',
          onMoveTokens,
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
            sizeSquares: 3,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
          }],
        })}
      />
    );

    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });
    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      clientX: 210,
      clientY: 140,
    });
    fireEvent.mouseUp(window, {
      button: 0,
      buttons: 1,
      clientX: 210,
      clientY: 140,
    });

    await waitFor(() => {
      expect(onMoveTokens).toHaveBeenCalledWith([
        expect.objectContaining({
          tokenId: 'user-1',
          sizeSquares: 3,
        }),
      ]);
    });
  });

  test('keeps only the external dashed outline when a token is selected', async () => {
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
        })}
      />
    );

    const tokenNode = screen.getByTestId('token-node-user-1');

    fireEvent.mouseDown(tokenNode, {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });

    await waitFor(() => {
      expect(tokenNode.querySelectorAll('[data-konva-type="Rect"][data-dash="[7,4]"]')).toHaveLength(2);
    });
    expect(tokenNode.querySelector('[data-konva-type="Circle"][data-stroke]')).toBeNull();
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
    expect(screen.queryByText(/Iron Keep\s+\|\s+Narration scene over Sunken Ruins/i)).not.toBeInTheDocument();
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

  test('uses a fixed thumbnail image for a legacy turn-order portrait', async () => {
    render(
      <GrigliataBoard
        {...buildProps({
          turnOrderEntries: [{
            tokenId: 'user-1',
            ownerUid: 'current-user',
            label: 'Ilya',
            imageUrl: 'https://example.com/ilya.png',
            tokenType: 'character',
            initiative: 12,
            joinedAt: null,
            joinedAtMs: 10,
          }],
        })}
      />
    );

    const chip = screen.getByTestId('turn-order-chip-user-1');
    await waitFor(() => {
      expect(chip.querySelector('img')).toHaveAttribute(
        'src',
        'https://example.com/ilya.png'
      );
    });
    expect(chip.querySelector('img')).toHaveAttribute('width', '40');
    expect(chip.querySelector('img')).toHaveAttribute('height', '40');
    expect(chip.querySelector('video')).toBeNull();
  });

  test('freezes turn-order controls while the active map roster is loading', () => {
    const onStartTurnOrder = jest.fn();
    const onResetTurnOrder = jest.fn();
    const onSaveTurnOrderInitiative = jest.fn();

    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          isTurnOrderDataReady: false,
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
          onStartTurnOrder,
          onResetTurnOrder,
          onSaveTurnOrderInitiative,
        })}
      />
    );

    expect(screen.getByRole('button', { name: /reset turn order/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /start turn order/i })).toBeDisabled();
    expect(screen.queryByTestId('turn-order-initiative-input-current-user')).not.toBeInTheDocument();
    expect(screen.getByTestId('turn-order-initiative-value-current-user')).toHaveTextContent('12');

    fireEvent.click(screen.getByRole('button', { name: /reset turn order/i }));
    fireEvent.click(screen.getByRole('button', { name: /start turn order/i }));
    expect(onResetTurnOrder).not.toHaveBeenCalled();
    expect(onStartTurnOrder).not.toHaveBeenCalled();
    expect(onSaveTurnOrderInitiative).not.toHaveBeenCalled();
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
    expect(screen.queryByText('Ilya')).not.toBeInTheDocument();

    const chip = screen.getByTestId('turn-order-chip-user-1');
    fireEvent.mouseEnter(chip);
    expect(screen.getByTestId('turn-order-tooltip-user-1')).toHaveTextContent('Ilya');

    fireEvent.mouseLeave(chip);
    expect(screen.queryByTestId('turn-order-tooltip-user-1')).not.toBeInTheDocument();

    const turnOrderScrollContainer = screen.getByTestId('turn-order-panel').querySelector('.overflow-y-auto');
    expect(turnOrderScrollContainer).toBeTruthy();
    expect(turnOrderScrollContainer.className).toContain('overflow-x-hidden');
    expect(turnOrderScrollContainer).toHaveAttribute('data-testid', 'turn-order-scroll-container');
    expect(turnOrderScrollContainer.className).toContain('custom-scroll');
    expect(turnOrderScrollContainer).toHaveClass('pointer-events-auto', 'max-h-full');
    expect(turnOrderScrollContainer.className).toContain('min-h-0');
    expect(turnOrderScrollContainer.className).toContain('overscroll-contain');
    expect(turnOrderScrollContainer.className).toContain('[scrollbar-gutter:stable]');

    fireEvent.mouseEnter(chip);
    expect(screen.getByTestId('turn-order-tooltip-user-1')).toBeInTheDocument();
    fireEvent.scroll(turnOrderScrollContainer);
    expect(screen.queryByTestId('turn-order-tooltip-user-1')).not.toBeInTheDocument();
  });

  test('marks hidden turn order portraits while leaving visible portraits unchanged', () => {
    render(
      <GrigliataBoard
        {...buildProps({
          isManager: true,
          activeTurnTokenId: 'hidden-image',
          isTurnOrderStarted: true,
          turnOrderEntries: [{
            tokenId: 'hidden-image',
            ownerUid: 'dm-1',
            label: 'Veiled Stalker',
            imageUrl: 'https://example.com/hidden.png',
            tokenType: 'foe',
            isVisibleToPlayers: false,
            initiative: 18,
            joinedAtMs: 10,
          }, {
            tokenId: 'hidden-initials',
            ownerUid: 'dm-1',
            label: 'Secret Shade',
            imageUrl: '',
            tokenType: 'foe',
            isVisibleToPlayers: false,
            initiative: 12,
            joinedAtMs: 20,
          }, {
            tokenId: 'visible-token',
            ownerUid: 'user-2',
            label: 'Ilya',
            imageUrl: '',
            tokenType: 'character',
            isVisibleToPlayers: true,
            initiative: 8,
            joinedAtMs: 30,
          }],
        })}
      />
    );

    expect(screen.getByTestId('turn-order-hidden-overlay-hidden-image')).toHaveTextContent('Invisible to players');
    expect(screen.getByTestId('turn-order-hidden-slash-hidden-image')).toBeInTheDocument();
    expect(screen.getByTestId('turn-order-hidden-overlay-hidden-initials')).toHaveTextContent('Invisible to players');
    expect(screen.queryByTestId('turn-order-hidden-overlay-visible-token')).not.toBeInTheDocument();
    expect(screen.getByTestId('turn-order-entry-hidden-image')).toHaveAttribute('data-hidden-from-players', 'true');
    expect(screen.getByTestId('turn-order-entry-hidden-image')).toHaveAttribute('data-active-turn', 'true');
    expect(screen.getByTestId('turn-order-entry-hidden-image')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('turn-order-active-marker-hidden-image')).toBeInTheDocument();
    expect(screen.getByTestId('turn-order-entry-visible-token')).toHaveAttribute('data-hidden-from-players', 'false');
  });

  test('keeps a long turn order rendered inside the constrained scroll container', () => {
    const turnOrderEntries = Array.from({ length: 40 }, (_, index) => ({
      tokenId: `token-${index + 1}`,
      ownerUid: `user-${index + 1}`,
      label: `Token ${index + 1}`,
      imageUrl: '',
      tokenType: 'character',
      isVisibleToPlayers: true,
      initiative: 40 - index,
      joinedAtMs: index,
    }));

    render(
      <GrigliataBoard {...buildProps({ turnOrderEntries })} />
    );

    const scrollContainer = screen.getByTestId('turn-order-scroll-container');
    expect(scrollContainer).toContainElement(screen.getByTestId('turn-order-entry-token-1'));
    expect(scrollContainer).toContainElement(screen.getByTestId('turn-order-entry-token-40'));
    expect(scrollContainer).toHaveClass('max-h-full');
    expect(scrollContainer.className).toContain('overflow-y-auto');
    expect(screen.getByTestId('turn-order-panel').className).toContain('flex-1');
  });

  test('scrolls only an off-screen active turn entry into view', () => {
    const turnOrderEntries = [{
      tokenId: 'visible-entry',
      label: 'Visible Entry',
      initiative: 20,
      joinedAtMs: 10,
    }, {
      tokenId: 'offscreen-entry',
      label: 'Offscreen Entry',
      initiative: 10,
      joinedAtMs: 20,
    }];
    getBoundingClientRectSpy.mockImplementation(function getTestRect() {
      if (this.dataset?.testid === 'turn-order-scroll-container') {
        return { width: 180, height: 200, top: 100, left: 0, right: 180, bottom: 300 };
      }
      if (this.dataset?.testid === 'turn-order-entry-visible-entry') {
        return { width: 100, height: 40, top: 120, left: 0, right: 100, bottom: 160 };
      }
      if (this.dataset?.testid === 'turn-order-entry-offscreen-entry') {
        return { width: 100, height: 40, top: 340, left: 0, right: 100, bottom: 380 };
      }
      return { width: 920, height: 640, top: 0, left: 0, right: 920, bottom: 640 };
    });

    const { rerender } = render(
      <GrigliataBoard {...buildProps({ turnOrderEntries })} />
    );
    const scrollContainer = screen.getByTestId('turn-order-scroll-container');
    const scrollTo = jest.fn();
    Object.defineProperties(scrollContainer, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, value: 0, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    });

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeTurnTokenId: 'offscreen-entry',
          isTurnOrderStarted: true,
          turnOrderEntries,
        })}
      />
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 80, behavior: 'smooth' });

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeTurnTokenId: 'visible-entry',
          isTurnOrderStarted: true,
          turnOrderEntries,
        })}
      />
    );

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  test('uses immediate active-entry scrolling when reduced motion is requested', () => {
    useReducedMotion.mockReturnValue(true);
    const turnOrderEntries = [{
      tokenId: 'offscreen-entry',
      label: 'Offscreen Entry',
      initiative: 10,
      joinedAtMs: 20,
    }];
    getBoundingClientRectSpy.mockImplementation(function getTestRect() {
      if (this.dataset?.testid === 'turn-order-scroll-container') {
        return { width: 180, height: 200, top: 100, left: 0, right: 180, bottom: 300 };
      }
      if (this.dataset?.testid === 'turn-order-entry-offscreen-entry') {
        return { width: 100, height: 40, top: 330, left: 0, right: 100, bottom: 370 };
      }
      return { width: 920, height: 640, top: 0, left: 0, right: 920, bottom: 640 };
    });

    const { rerender } = render(
      <GrigliataBoard {...buildProps({ turnOrderEntries })} />
    );
    const scrollContainer = screen.getByTestId('turn-order-scroll-container');
    const scrollTo = jest.fn();
    Object.defineProperties(scrollContainer, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, value: 0, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    });

    rerender(
      <GrigliataBoard
        {...buildProps({
          activeTurnTokenId: 'offscreen-entry',
          isTurnOrderStarted: true,
          turnOrderEntries,
        })}
      />
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 70, behavior: 'auto' });
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

  test('adds and removes a selected token from turn order without requiring a right click', async () => {
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

    fireEvent.mouseDown(screen.getByTestId('token-node-user-1'), {
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 140,
    });
    fireEvent.click(await screen.findByRole('button', { name: /add ilya to turn order/i }));

    expect(screen.getByTestId('turn-order-join-overlay')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('turn-order-join-initiative-input'), {
      target: { value: '14' },
    });
    fireEvent.click(screen.getByTestId('turn-order-join-confirm'));
    await waitFor(() => expect(onJoinTurnOrder).toHaveBeenCalledWith('user-1', 14));

    rerender(
      <GrigliataBoard
        {...buildProps({
          tokens: [{ ...token, isInTurnOrder: true, turnOrderInitiative: 14 }],
          onJoinTurnOrder,
          onLeaveTurnOrder,
        })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /remove ilya from turn order/i }));
    await waitFor(() => expect(onLeaveTurnOrder).toHaveBeenCalledWith('user-1'));
  });

  test('keeps multi-digit initiative input after the initial focus selection frame', async () => {
    jest.useFakeTimers();
    const onJoinTurnOrder = jest.fn(() => Promise.resolve());
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

    render(
      <GrigliataBoard
        {...buildProps({
          tokens: [token],
          onJoinTurnOrder,
        })}
      />
    );

    fireEvent.contextMenu(screen.getByTestId('token-node-user-1'), {
      clientX: 160,
      clientY: 160,
      button: 2,
    });
    fireEvent.click(screen.getByTestId('turn-order-context-action-user-1'));

    act(() => {
      jest.advanceTimersByTime(16);
    });

    const initiativeInput = screen.getByTestId('turn-order-join-initiative-input');
    fireEvent.change(initiativeInput, { target: { value: '1' } });
    initiativeInput.setSelectionRange(1, 1);

    act(() => {
      jest.advanceTimersByTime(16);
    });

    expect(initiativeInput).toHaveValue('1');
    expect(initiativeInput.selectionStart).toBe(1);
    expect(initiativeInput.selectionEnd).toBe(1);

    fireEvent.change(initiativeInput, { target: { value: '13' } });
    fireEvent.click(screen.getByTestId('turn-order-join-confirm'));

    expect(onJoinTurnOrder).toHaveBeenCalledWith('user-1', 13);
    await act(async () => {});
    expect(screen.queryByTestId('turn-order-join-overlay')).not.toBeInTheDocument();
  });

  test('rolls Destrezza into the initiative draft and waits for confirmation before joining', async () => {
    const onJoinTurnOrder = jest.fn(() => Promise.resolve());
    const onResolveTurnOrderInitiativeRoll = jest.fn(() => Promise.resolve({
      faces: 8,
      count: 1,
      modifier: 4,
      formula: 'd8 + 4',
      description: 'Destrezza (d8 + 4)',
    }));
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

    render(
      <GrigliataBoard
        {...buildProps({
          tokens: [token],
          onJoinTurnOrder,
          onResolveTurnOrderInitiativeRoll,
        })}
      />
    );

    fireEvent.contextMenu(screen.getByTestId('token-node-user-1'), {
      clientX: 160,
      clientY: 160,
      button: 2,
    });
    fireEvent.click(screen.getByTestId('turn-order-context-action-user-1'));

    expect(screen.getByTestId('turn-order-initiative-roll-loading')).toHaveTextContent('Checking Destrezza');
    const rollButton = await screen.findByRole('button', { name: 'Roll Destrezza for Ilya' });
    expect(rollButton).toHaveTextContent('d8 + 4');
    expect(onResolveTurnOrderInitiativeRoll).toHaveBeenCalledWith('user-1');

    fireEvent.click(rollButton);

    expect(screen.getByTestId('turn-order-initiative-dice-roller')).toHaveTextContent(
      'faces:8;count:1;modifier:4;description:Destrezza (d8 + 4)'
    );
    expect(onJoinTurnOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Complete initiative dice roll' }));

    expect(screen.getByTestId('turn-order-join-initiative-input')).toHaveValue('13');
    expect(onJoinTurnOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('turn-order-join-confirm'));
    await waitFor(() => expect(onJoinTurnOrder).toHaveBeenCalledWith('user-1', 13));
  });

  test('keeps manual initiative available when Destrezza is unavailable or resolution fails', async () => {
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
          onResolveTurnOrderInitiativeRoll: jest.fn(() => Promise.resolve(null)),
        })}
      />
    );

    fireEvent.contextMenu(screen.getByTestId('token-node-user-1'), {
      clientX: 160,
      clientY: 160,
      button: 2,
    });
    fireEvent.click(screen.getByTestId('turn-order-context-action-user-1'));

    await waitFor(() => {
      expect(screen.queryByTestId('turn-order-initiative-roll-loading')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('turn-order-initiative-roll-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('turn-order-join-initiative-input')).toBeEnabled();

    fireEvent.click(screen.getByTestId('turn-order-join-cancel'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    rerender(
      <GrigliataBoard
        {...buildProps({
          tokens: [token],
          onResolveTurnOrderInitiativeRoll: jest.fn(() => Promise.reject(new Error('offline'))),
        })}
      />
    );
    fireEvent.contextMenu(screen.getByTestId('token-node-user-1'), {
      clientX: 160,
      clientY: 160,
      button: 2,
    });
    fireEvent.click(screen.getByTestId('turn-order-context-action-user-1'));

    expect(await screen.findByTestId('turn-order-initiative-roll-error')).toHaveTextContent(
      'Enter initiative manually'
    );
    expect(screen.getByTestId('turn-order-join-initiative-input')).toBeEnabled();
    warnSpy.mockRestore();
  });

  test('does not open the token turn-order menu while adding a ruler waypoint during token movement', async () => {
    const { container } = render(
      <GrigliataBoard
        {...buildProps({
          isRulerEnabled: true,
          isRulerTokenMovementEnabled: true,
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
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
          }],
        })}
      />
    );

    const tokenNode = screen.getByTestId('token-node-user-1');
    const stage = container.querySelector('[data-konva-type="Stage"]');
    const viewportLeft = getNumericKonvaProp(stage, 'data-x');
    const viewportTop = getNumericKonvaProp(stage, 'data-y');
    const viewportScale = getNumericKonvaProp(stage, 'data-scalex') || 1;
    const tokenWorldX = getNumericKonvaProp(tokenNode, 'data-x');
    const tokenWorldY = getNumericKonvaProp(tokenNode, 'data-y');
    const toClientPoint = (worldX, worldY) => ({
      clientX: viewportLeft + (worldX * viewportScale),
      clientY: viewportTop + (worldY * viewportScale),
    });

    const dragStart = toClientPoint(tokenWorldX, tokenWorldY);
    const firstWaypoint = toClientPoint(tokenWorldX + (grid.cellSizePx * 2), tokenWorldY);
    const secondMove = toClientPoint(tokenWorldX + (grid.cellSizePx * 5), tokenWorldY);

    fireEvent.mouseDown(tokenNode, {
      button: 0,
      buttons: 1,
      ...dragStart,
    });
    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      ...firstWaypoint,
    });

    await waitFor(() => {
      expect(screen.getByTestId('measurement-overlay-local')).toBeInTheDocument();
    });

    fireEvent.mouseDown(tokenNode, {
      button: 2,
      buttons: 3,
      ...firstWaypoint,
    });
    fireEvent.contextMenu(tokenNode, {
      button: 2,
      buttons: 1,
      ...firstWaypoint,
    });

    expect(screen.queryByTestId('turn-order-context-menu')).not.toBeInTheDocument();

    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      ...secondMove,
    });

    await waitFor(() => {
      expect(screen.queryByTestId('turn-order-context-menu')).not.toBeInTheDocument();
      expect(screen.getByTestId('measurement-overlay-local')).toHaveTextContent('25 ft (5 squares)');

      const segmentLabels = screen.getAllByTestId('measurement-segment-label-local');
      expect(segmentLabels).toHaveLength(2);
      expect(segmentLabels[0]).toHaveTextContent('10 ft');
      expect(segmentLabels[1]).toHaveTextContent('15 ft');
    });
  });

  test('does not open the token turn-order menu while adding a ruler waypoint from a stage-started measurement', async () => {
    const { container } = render(
      <GrigliataBoard
        {...buildProps({
          isRulerEnabled: true,
          currentUserId: 'user-1',
          tokens: [{
            tokenId: 'user-1',
            id: 'user-1',
            ownerUid: 'user-1',
            label: 'Ilya',
            tokenType: 'character',
            imageUrl: '',
            placed: true,
            col: 4,
            row: 2,
            isVisibleToPlayers: true,
            isDead: false,
            statuses: [],
            isInTurnOrder: false,
          }],
        })}
      />
    );

    const tokenNode = screen.getByTestId('token-node-user-1');
    const stage = container.querySelector('[data-konva-type="Stage"]');
    const viewportLeft = getNumericKonvaProp(stage, 'data-x');
    const viewportTop = getNumericKonvaProp(stage, 'data-y');
    const viewportScale = getNumericKonvaProp(stage, 'data-scalex') || 1;
    const tokenWorldX = getNumericKonvaProp(tokenNode, 'data-x');
    const tokenWorldY = getNumericKonvaProp(tokenNode, 'data-y');
    const toClientPoint = (worldX, worldY) => ({
      clientX: viewportLeft + (worldX * viewportScale),
      clientY: viewportTop + (worldY * viewportScale),
    });

    const measureStart = toClientPoint(tokenWorldX - (grid.cellSizePx * 2), tokenWorldY);
    const firstWaypoint = toClientPoint(tokenWorldX, tokenWorldY);
    const secondMove = toClientPoint(tokenWorldX + (grid.cellSizePx * 3), tokenWorldY);

    fireEvent.mouseDown(stage, {
      button: 0,
      buttons: 1,
      ...measureStart,
    });
    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      ...firstWaypoint,
    });

    await waitFor(() => {
      expect(screen.getByTestId('measurement-overlay-local')).toBeInTheDocument();
    });

    fireEvent.mouseDown(tokenNode, {
      button: 2,
      buttons: 3,
      ...firstWaypoint,
    });
    fireEvent.contextMenu(tokenNode, {
      button: 2,
      buttons: 1,
      ...firstWaypoint,
    });

    expect(screen.queryByTestId('turn-order-context-menu')).not.toBeInTheDocument();

    fireEvent.mouseMove(window, {
      button: 0,
      buttons: 1,
      ...secondMove,
    });

    await waitFor(() => {
      expect(screen.queryByTestId('turn-order-context-menu')).not.toBeInTheDocument();
      expect(screen.getByTestId('measurement-overlay-local')).toHaveTextContent('25 ft (5 squares)');

      const segmentLabels = screen.getAllByTestId('measurement-segment-label-local');
      expect(segmentLabels).toHaveLength(2);
      expect(segmentLabels[0]).toHaveTextContent('10 ft');
      expect(segmentLabels[1]).toHaveTextContent('15 ft');
    });
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

    const activeEntry = screen.getByTestId('turn-order-entry-user-2');
    const inactiveEntry = screen.getByTestId('turn-order-entry-user-1');
    expect(activeEntry).toHaveAttribute('data-active-turn', 'true');
    expect(activeEntry).toHaveAttribute('aria-current', 'step');
    expect(activeEntry).toHaveTextContent('Current turn');
    expect(activeEntry.className).toContain('py-1.5');
    expect(activeEntry.className).not.toContain('bg-gradient-to-l');
    expect(screen.getByTestId('turn-order-active-marker-user-2')).toBeInTheDocument();
    expect(inactiveEntry).toHaveAttribute('data-active-turn', 'false');
    expect(inactiveEntry).not.toHaveAttribute('aria-current');
    expect(inactiveEntry.className).toContain('py-1.5');
    expect(screen.queryByTestId('turn-order-active-marker-user-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('token-node-user-2')).toHaveAttribute('data-active-turn', 'true');
    expect(screen.getByTestId('token-node-user-1')).toHaveAttribute('data-active-turn', 'false');
    expect(screen.getByTestId('token-active-turn-underlay-user-2')).toHaveAttribute(
      'data-stroke',
      'rgba(2, 6, 23, 0.88)'
    );
    expect(screen.getByTestId('token-active-turn-ring-user-2')).toHaveAttribute(
      'data-stroke',
      'rgba(251, 191, 36, 0.98)'
    );
    expect(screen.getByTestId('token-active-turn-ring-user-2')).not.toHaveAttribute('data-fill');
    expect(screen.queryByTestId('token-active-turn-ring-user-1')).not.toBeInTheDocument();
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

  test('resets a dirty initiative draft when the same token appears on another map', () => {
    const buildEntry = (initiative) => ({
      tokenId: 'current-user',
      ownerUid: 'current-user',
      label: 'Alya',
      imageUrl: '',
      tokenType: 'character',
      initiative,
      joinedAt: null,
      joinedAtMs: 50,
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
          currentUserId: 'current-user',
          turnOrderEntries: [buildEntry(15)],
        })}
      />
    );

    fireEvent.change(screen.getByTestId('turn-order-initiative-input-current-user'), {
      target: { value: '22' },
    });
    expect(screen.getByTestId('turn-order-initiative-input-current-user')).toHaveValue('22');

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
          currentUserId: 'current-user',
          turnOrderEntries: [buildEntry(7)],
        })}
      />
    );

    expect(screen.getByTestId('turn-order-initiative-input-current-user')).toHaveValue('7');
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
    expect(pingOverlay.querySelector(`[data-stroke="${MAP_PING_ACCENT}"]`)).not.toBeNull();
    expect(pingOverlay.querySelectorAll('[data-konva-type="Line"]')).toHaveLength(0);

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
    expect(localPingOverlays[0].querySelector(`[data-stroke="${MAP_PING_ACCENT}"]`)).not.toBeNull();
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
    expect(pingOverlay.querySelector(`[data-stroke="${MAP_PING_ACCENT}"]`)).not.toBeNull();
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

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-hit-target-${figureId}`), {
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

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-hit-target-${figureId}`), {
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

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-hit-target-${figureId}`), {
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

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-hit-target-${figureId}`), {
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

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-hit-target-${figureId}`), {
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

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-hit-target-${figureId}`), {
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

    fireEvent.mouseDown(screen.getByTestId(`aoe-figure-hit-target-${figureId}`), {
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

    expect(screen.queryByTestId(`aoe-figure-hit-target-${figureId}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`aoe-figure-overlay-${figureId}`)).toHaveAttribute('data-listening', 'false');

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
