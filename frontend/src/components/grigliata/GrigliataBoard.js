import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva';
import { FaHandPointer, FaRulerHorizontal } from 'react-icons/fa';
import { GiHearts, GiMagicSwirl, GiShield } from 'react-icons/gi';
import {
  FiClock,
  FiEye,
  FiEyeOff,
  FiImage,
  FiMinus,
  FiPlay,
  FiPlus,
  FiRotateCcw,
  FiSkipForward,
  FiTrash2,
  FiUser,
  FiUsers,
  FiVolume2,
  FiVolumeX,
} from 'react-icons/fi';
import { MdCenterFocusStrong } from 'react-icons/md';
import {
  BOARD_FIT_PADDING,
  DEFAULT_GRIGLIATA_DRAW_COLOR_KEY,
  getGrigliataDrawTheme,
  GRIGLIATA_DRAW_THEMES,
  MAP_PING_ANIMATION_INTERVAL_MS,
  MAP_PING_BROADCAST_CLEAR_MS,
  MAP_PING_HOLD_DELAY_MS,
  MAP_PING_VISIBLE_MS,
  FOE_LIBRARY_DRAG_TYPE,
  TRAY_DRAG_MIME,
} from './constants';
import {
  buildGridMeasurementPath,
  fitViewportToBounds,
  getBoardBounds,
  getInitials,
  getTokenPositionPx,
  normalizeGridConfig,
  snapBoardPointToGrid,
  timestampToMillis,
} from './boardUtils';
import GrigliataTokenActions, { TokenStatusSummaryCard } from './GrigliataTokenActions';
import {
  splitTokenStatusesForDisplay,
  useTokenStatusIconImages,
} from './tokenStatuses';
import { useImageAssetSnapshot } from './useImageAsset';
import {
  buildAoEFigureFromGrigliataLiveInteraction,
  buildMeasurementFromGrigliataLiveInteraction,
  buildPingFromGrigliataLiveInteraction,
  normalizeGrigliataLiveInteractionDraft,
} from './liveInteractions';
import {
  buildRenderableGrigliataAoEFigure,
  normalizeGrigliataAoEFigure,
  normalizeGrigliataAoEFigureDraft,
  shiftGrigliataAoEFigureCells,
} from './aoeFigures';
import { sortTurnOrderEntries } from './turnOrder';
import {
  buildSelectedTokenActionState,
  GridLayer,
  TokenNode,
} from './grigliataBoardTokenUi';

const POINTER_DRAG_THRESHOLD_PX = 4;
const RULER_LABEL_MIN_WIDTH = 90;
const AOE_LABEL_MIN_WIDTH = 112;
const AOE_LABEL_MAX_WIDTH = 220;
const AOE_LABEL_SIDE_PADDING = 12;
const AOE_LABEL_TOP_PADDING = 8;
const AOE_LABEL_LINE_HEIGHT = 17;
const AOE_LABEL_AVG_CHAR_WIDTH_PX = 7.4;
const AOE_LABEL_GAP_PX = 12;
const AOE_LABEL_EDGE_PADDING = 8;
const DEFAULT_DRAW_THEME = getGrigliataDrawTheme(DEFAULT_GRIGLIATA_DRAW_COLOR_KEY);
const MEASUREMENT_OUTLINE_STROKE_WIDTH = 7;
const SHAPE_OUTLINE_STROKE_WIDTH = 4;
const SCREEN_RULER_STROKE_WIDTH = 3;
const SCREEN_RULER_DASH_LENGTH = 10;
const SCREEN_RULER_DASH_GAP = 6;
const SCREEN_RULER_MARKER_RADIUS = 6;
const SCREEN_RULER_LABEL_HEIGHT = 28;
const SCREEN_RULER_LABEL_FONT_SIZE = 13;
const SCREEN_RULER_LABEL_OFFSET_X = 12;
const SCREEN_RULER_LABEL_OFFSET_Y = -14;
const SCREEN_AOE_OUTLINE_STROKE_WIDTH = 4;
const SCREEN_AOE_ACCENT_STROKE_WIDTH = 1.75;
const SCREEN_AOE_GLOW_BLUR = 10;
const SCREEN_AOE_HIT_STROKE_WIDTH = 18;
const SCREEN_AOE_ARROW_STROKE_WIDTH = 2.4;
const SCREEN_AOE_ARROW_HEAD_LENGTH = 12;
const SCREEN_AOE_ARROW_HEAD_WIDTH = 10;
const SCREEN_AOE_DOT_RADIUS = 5;
const SCREEN_AOE_BADGE_MIN_WIDTH = 72;
const SCREEN_AOE_BADGE_SIDE_PADDING = 10;
const SCREEN_AOE_BADGE_TOP_PADDING = 7;
const SCREEN_AOE_BADGE_CORNER_RADIUS = 10;
const SCREEN_AOE_BADGE_GAP = 12;
const SCREEN_AOE_BADGE_EDGE_PADDING = 12;
const SCREEN_AOE_PRIMARY_FONT_SIZE = 16;
const SCREEN_AOE_SECONDARY_FONT_SIZE = 12;
const SCREEN_AOE_LINE_GAP = 2;
const TOKEN_STATUS_VISIBLE_BADGE_COUNT = 3;
const MAP_PING_EPIC_ACCENT = '#f97316';
const MAP_PING_EPIC_HIGHLIGHT = '#fde047';
const MAP_PING_EPIC_SHADOW = 'rgba(249, 115, 22, 0.58)';
const DRAW_PICKER_EASE = [0.22, 1, 0.36, 1];
const BATTLEMAP_IMAGE_FADE_DURATION_MS = 1000;
const QUICK_CONTROL_NEUTRAL_SURFACE_CLASS = 'border-slate-700/90 bg-slate-950/92 shadow-lg shadow-slate-950/35';
const QUICK_CONTROL_NEON_SURFACE_CLASS = 'border-fuchsia-300/70 bg-gradient-to-br from-fuchsia-500/28 via-violet-500/24 to-pink-500/34 shadow-lg shadow-fuchsia-950/45 ring-1 ring-fuchsia-200/20';
const QUICK_CONTROL_BUTTON_BASE_CLASS = 'pointer-events-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border p-2 text-sm font-medium backdrop-blur-md transition-all duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
const QUICK_CONTROL_BUTTON_IDLE_CLASS = 'text-slate-200 hover:border-slate-500/80 hover:bg-slate-900/96 hover:text-slate-50';
const QUICK_CONTROL_BUTTON_ACTIVE_CLASS = 'text-fuchsia-50 hover:border-fuchsia-200/80 hover:from-fuchsia-500/36 hover:via-violet-500/30 hover:to-pink-500/42';
const QUICK_CONTROL_DRAWER_CLASS = `flex min-h-10 items-center gap-2 overflow-hidden rounded-2xl border p-2 backdrop-blur-md ${QUICK_CONTROL_NEUTRAL_SURFACE_CLASS}`;
const AOE_TEMPLATE_OPTION_BASE_CLASS = 'inline-flex h-10 w-10 items-center justify-center rounded-full border transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
const AOE_TEMPLATE_OPTION_IDLE_CLASS = 'border-slate-700 bg-slate-900/96 text-slate-200';
const AOE_TEMPLATE_OPTION_ACTIVE_CLASS = `${QUICK_CONTROL_NEON_SURFACE_CLASS} text-fuchsia-50`;
const TURN_ORDER_PANEL_WIDTH_CLASS = 'w-[min(12rem,calc(100vw-2rem))]';
const TURN_ORDER_PANEL_STORAGE_PREFIX = 'grigliata.turnOrderCollapsed';
const TURN_ORDER_DRAWER_TRANSITION = { duration: 0.26, ease: DRAW_PICKER_EASE };
const TURN_ORDER_ENTRY_TRANSITION = { duration: 0.18, ease: DRAW_PICKER_EASE };

const isPrimaryMouseButton = (nativeEvent) => nativeEvent?.button === 0;
const isSecondaryMouseButton = (nativeEvent) => nativeEvent?.button === 2;
const hasPrimaryMouseButtonPressed = (nativeEvent) => (nativeEvent?.buttons & 1) === 1;

const isSameGridCell = (left, right) => (
  !!left
  && !!right
  && left.col === right.col
  && left.row === right.row
);

const isWaypointEligibleInteraction = (interaction) => (
  !!interaction
  && (interaction.type === 'measure' || interaction.type === 'token-drag')
  && Array.isArray(interaction.anchorCells)
  && interaction.anchorCells.length > 0
);

const isAoECreateInteraction = (interaction) => interaction?.type === 'aoe-create';
const isAoEDragInteraction = (interaction) => (
  interaction?.type === 'aoe-drag-candidate'
  || interaction?.type === 'aoe-drag'
);
const isPingHoldInteraction = (interaction) => interaction?.type === 'ping-hold';

const normalizeSelectionRect = (selectionBox) => {
  if (!selectionBox?.start || !selectionBox?.end) return null;

  const minX = Math.min(selectionBox.start.x, selectionBox.end.x);
  const minY = Math.min(selectionBox.start.y, selectionBox.end.y);
  const maxX = Math.max(selectionBox.start.x, selectionBox.end.x);
  const maxY = Math.max(selectionBox.start.y, selectionBox.end.y);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const rectsIntersect = (left, right) => (
  left.x <= (right.x + right.width)
  && (left.x + left.width) >= right.x
  && left.y <= (right.y + right.height)
  && (left.y + left.height) >= right.y
);

const isEditableElementFocused = () => {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  const tagName = activeElement.tagName?.toLowerCase() || '';
  return activeElement.isContentEditable
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select';
};

const buildSelectionActionToolbarPosition = ({ left, top, width, buttonSize, gap }) => ({
  left: left + width + gap,
  top: top - gap - buttonSize,
});

const getTurnOrderCollapsedStorageKey = (currentUserId = '') => (
  `${TURN_ORDER_PANEL_STORAGE_PREFIX}.${currentUserId || 'anonymous'}`
);

const readStoredTurnOrderCollapsed = (currentUserId = '') => {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(getTurnOrderCollapsedStorageKey(currentUserId)) === 'true';
  } catch (_) {
    return false;
  }
};

const writeStoredTurnOrderCollapsed = (currentUserId = '', isCollapsed) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getTurnOrderCollapsedStorageKey(currentUserId), String(isCollapsed));
  } catch (_) {}
};

const canEditTurnOrderEntry = ({ entry, currentUserId = '', isManager = false }) => (
  !!entry?.tokenId
  && (
    isManager
    || entry.ownerUid === currentUserId
    || entry.tokenId === currentUserId
  )
);

const clampToRange = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeViewportScale = (viewportScale = 1) => (
  Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1
);
const scaleScreenPxToWorld = (screenPx, viewportScale = 1) => (
  screenPx / normalizeViewportScale(viewportScale)
);
const estimateTextWidth = (text, fontSize) => (
  Math.round(String(text || '').length * fontSize * 0.62)
);
const normalizeVector = (deltaX, deltaY, fallback = { x: 1, y: 0 }) => {
  const magnitude = Math.hypot(deltaX, deltaY);
  if (!magnitude) {
    return fallback;
  }

  return {
    x: deltaX / magnitude,
    y: deltaY / magnitude,
  };
};
const buildArrowHeadFlatPoints = (tipPoint, direction, length, width) => {
  const normalizedDirection = normalizeVector(direction.x, direction.y);
  const perpendicular = {
    x: -normalizedDirection.y,
    y: normalizedDirection.x,
  };
  const baseCenter = {
    x: tipPoint.x - (normalizedDirection.x * length),
    y: tipPoint.y - (normalizedDirection.y * length),
  };

  return [
    tipPoint.x,
    tipPoint.y,
    baseCenter.x + (perpendicular.x * (width / 2)),
    baseCenter.y + (perpendicular.y * (width / 2)),
    baseCenter.x - (perpendicular.x * (width / 2)),
    baseCenter.y - (perpendicular.y * (width / 2)),
  ];
};
const midpointBetween = (left, right) => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
});
export const buildZoomNormalizedOverlayMetrics = (viewportScale = 1) => ({
  rulerOutlineStrokeWidth: scaleScreenPxToWorld(MEASUREMENT_OUTLINE_STROKE_WIDTH, viewportScale),
  rulerStrokeWidth: scaleScreenPxToWorld(SCREEN_RULER_STROKE_WIDTH, viewportScale),
  rulerDash: [
    scaleScreenPxToWorld(SCREEN_RULER_DASH_LENGTH, viewportScale),
    scaleScreenPxToWorld(SCREEN_RULER_DASH_GAP, viewportScale),
  ],
  rulerMarkerRadius: scaleScreenPxToWorld(SCREEN_RULER_MARKER_RADIUS, viewportScale),
  rulerLabelMinWidth: scaleScreenPxToWorld(RULER_LABEL_MIN_WIDTH, viewportScale),
  rulerLabelHeight: scaleScreenPxToWorld(SCREEN_RULER_LABEL_HEIGHT, viewportScale),
  rulerLabelFontSize: scaleScreenPxToWorld(SCREEN_RULER_LABEL_FONT_SIZE, viewportScale),
  rulerLabelOffsetX: scaleScreenPxToWorld(SCREEN_RULER_LABEL_OFFSET_X, viewportScale),
  rulerLabelOffsetY: scaleScreenPxToWorld(SCREEN_RULER_LABEL_OFFSET_Y, viewportScale),
  aoeOutlineStrokeWidth: scaleScreenPxToWorld(SCREEN_AOE_OUTLINE_STROKE_WIDTH, viewportScale),
  aoeAccentStrokeWidth: scaleScreenPxToWorld(SCREEN_AOE_ACCENT_STROKE_WIDTH, viewportScale),
  aoeGlowBlur: scaleScreenPxToWorld(SCREEN_AOE_GLOW_BLUR, viewportScale),
  aoeHitStrokeWidth: scaleScreenPxToWorld(SCREEN_AOE_HIT_STROKE_WIDTH, viewportScale),
  aoeArrowStrokeWidth: scaleScreenPxToWorld(SCREEN_AOE_ARROW_STROKE_WIDTH, viewportScale),
  aoeArrowHeadLength: scaleScreenPxToWorld(SCREEN_AOE_ARROW_HEAD_LENGTH, viewportScale),
  aoeArrowHeadWidth: scaleScreenPxToWorld(SCREEN_AOE_ARROW_HEAD_WIDTH, viewportScale),
  aoeDotRadius: scaleScreenPxToWorld(SCREEN_AOE_DOT_RADIUS, viewportScale),
  aoeBadgeMinWidth: scaleScreenPxToWorld(SCREEN_AOE_BADGE_MIN_WIDTH, viewportScale),
  aoeBadgeSidePadding: scaleScreenPxToWorld(SCREEN_AOE_BADGE_SIDE_PADDING, viewportScale),
  aoeBadgeTopPadding: scaleScreenPxToWorld(SCREEN_AOE_BADGE_TOP_PADDING, viewportScale),
  aoeBadgeCornerRadius: scaleScreenPxToWorld(SCREEN_AOE_BADGE_CORNER_RADIUS, viewportScale),
  aoeBadgeGap: scaleScreenPxToWorld(SCREEN_AOE_BADGE_GAP, viewportScale),
  aoeBadgeEdgePadding: scaleScreenPxToWorld(SCREEN_AOE_BADGE_EDGE_PADDING, viewportScale),
  aoePrimaryFontSize: scaleScreenPxToWorld(SCREEN_AOE_PRIMARY_FONT_SIZE, viewportScale),
  aoeSecondaryFontSize: scaleScreenPxToWorld(SCREEN_AOE_SECONDARY_FONT_SIZE, viewportScale),
  aoeLineGap: scaleScreenPxToWorld(SCREEN_AOE_LINE_GAP, viewportScale),
});
export const getAoEFigureMeasurementTextLines = (figure) => {
  const measurement = figure?.measurement;
  if (!measurement || !figure?.figureType) {
    return null;
  }

  if (figure.figureType === 'circle') {
    return {
      primary: `${measurement.radiusFeet} ft`,
      secondary: `${figure.sizeSquares} sq`,
    };
  }

  if (figure.figureType === 'square') {
    return {
      primary: `${measurement.sideFeet} ft`,
      secondary: `${figure.sizeSquares} sq`,
    };
  }

  if (figure.figureType === 'cone') {
    return {
      primary: `${measurement.lengthFeet} ft`,
      secondary: `${figure.sizeSquares} sq`,
    };
  }

  if (figure.figureType === 'rectangle') {
    return {
      primary: `${measurement.widthFeet} x ${measurement.heightFeet} ft`,
      secondary: `${figure.widthSquares} x ${figure.heightSquares} sq`,
    };
  }

  return null;
};
export const buildAoEFigureMeasurementDecorationLayout = ({ figure, viewportScale = 1 }) => {
  if (!figure?.figureType || figure.showMeasurementDetails === false) {
    return null;
  }

  const lines = getAoEFigureMeasurementTextLines(figure);
  if (!lines) {
    return null;
  }

  const metrics = buildZoomNormalizedOverlayMetrics(viewportScale);
  const width = Math.max(
    metrics.aoeBadgeMinWidth,
    estimateTextWidth(lines.primary, metrics.aoePrimaryFontSize),
    estimateTextWidth(lines.secondary, metrics.aoeSecondaryFontSize)
  ) + (metrics.aoeBadgeSidePadding * 2);
  const height = (metrics.aoeBadgeTopPadding * 2)
    + metrics.aoePrimaryFontSize
    + metrics.aoeLineGap
    + metrics.aoeSecondaryFontSize;
  const buildBadgeCenterAlongLine = (startPoint, endPoint, progress = 0.72) => ({
    x: startPoint.x + ((endPoint.x - startPoint.x) * progress),
    y: startPoint.y + ((endPoint.y - startPoint.y) * progress),
  });

  if (figure.figureType === 'circle') {
    const arrowEnd = {
      x: figure.centerPoint.x + figure.radius - metrics.aoeBadgeEdgePadding,
      y: figure.centerPoint.y,
    };
    const badgeCenter = buildBadgeCenterAlongLine(figure.centerPoint, arrowEnd, 0.7);
    const minX = figure.centerPoint.x - figure.radius + metrics.aoeBadgeEdgePadding;
    const maxX = figure.centerPoint.x + figure.radius - width - metrics.aoeBadgeEdgePadding;
    const badgeX = clampToRange(
      badgeCenter.x - (width / 2),
      minX,
      Math.max(minX, maxX)
    );
    const badgeY = clampToRange(
      badgeCenter.y - (height / 2),
      figure.centerPoint.y - figure.radius + metrics.aoeBadgeEdgePadding,
      figure.centerPoint.y + figure.radius - height - metrics.aoeBadgeEdgePadding
    );
    const direction = normalizeVector(arrowEnd.x - figure.centerPoint.x, arrowEnd.y - figure.centerPoint.y);

    return {
      lines,
      width,
      height,
      badgeX,
      badgeY,
      startDot: figure.centerPoint,
      arrowPoints: [figure.centerPoint.x, figure.centerPoint.y, arrowEnd.x, arrowEnd.y],
      arrowHeadPoints: buildArrowHeadFlatPoints(
        arrowEnd,
        direction,
        metrics.aoeArrowHeadLength,
        metrics.aoeArrowHeadWidth
      ),
      metrics,
    };
  }

  if (figure.figureType === 'square' || figure.figureType === 'rectangle') {
    const centerY = figure.y + (figure.height / 2);
    const arrowStart = {
      x: figure.x + (figure.width / 2),
      y: centerY,
    };
    const arrowEnd = {
      x: figure.x + figure.width - metrics.aoeBadgeEdgePadding,
      y: centerY,
    };
    const badgeCenter = buildBadgeCenterAlongLine(arrowStart, arrowEnd, 0.72);
    const minX = figure.x + metrics.aoeBadgeEdgePadding;
    const maxX = figure.x + figure.width - width - metrics.aoeBadgeEdgePadding;
    const badgeX = clampToRange(
      badgeCenter.x - (width / 2),
      minX,
      Math.max(minX, maxX)
    );
    const badgeY = clampToRange(
      badgeCenter.y - (height / 2),
      figure.y + metrics.aoeBadgeEdgePadding,
      figure.y + figure.height - height - metrics.aoeBadgeEdgePadding
    );
    const direction = normalizeVector(arrowEnd.x - arrowStart.x, arrowEnd.y - arrowStart.y);

    return {
      lines,
      width,
      height,
      badgeX,
      badgeY,
      startDot: arrowStart,
      arrowPoints: [arrowStart.x, arrowStart.y, arrowEnd.x, arrowEnd.y],
      arrowHeadPoints: buildArrowHeadFlatPoints(
        arrowEnd,
        direction,
        metrics.aoeArrowHeadLength,
        metrics.aoeArrowHeadWidth
      ),
      metrics,
    };
  }

  if (figure.figureType === 'cone' && Array.isArray(figure.points) && figure.points.length === 3) {
    const apex = figure.points[0];
    const baseMidpoint = midpointBetween(figure.points[1], figure.points[2]);
    const direction = normalizeVector(baseMidpoint.x - apex.x, baseMidpoint.y - apex.y);
    const arrowEnd = {
      x: baseMidpoint.x - (direction.x * metrics.aoeBadgeEdgePadding),
      y: baseMidpoint.y - (direction.y * metrics.aoeBadgeEdgePadding),
    };
    const badgeCenter = buildBadgeCenterAlongLine(apex, arrowEnd, 0.7);
    const badgeX = badgeCenter.x - (width / 2);
    const badgeY = badgeCenter.y - (height / 2);

    return {
      lines,
      width,
      height,
      badgeX,
      badgeY,
      startDot: apex,
      arrowPoints: [apex.x, apex.y, arrowEnd.x, arrowEnd.y],
      arrowHeadPoints: buildArrowHeadFlatPoints(
        arrowEnd,
        direction,
        metrics.aoeArrowHeadLength,
        metrics.aoeArrowHeadWidth
      ),
      metrics,
    };
  }

  return null;
};
const TOKEN_HUD_EDGE_PADDING = 12;
const TOKEN_HUD_CHIP_GAP = 6;
const TOKEN_HUD_CHIP_ROW_HEIGHT = 32;
const TOKEN_HUD_CHIP_COLLISION_GAP = 10;
const buildSelectedTokenHudChipLayout = ({
  chipCount,
  tokenScreenSize,
  stageWidth,
  forceTwoRows = false,
}) => {
  const maxWidth = Math.max(180, stageWidth - (TOKEN_HUD_EDGE_PADDING * 2));
  const columns = forceTwoRows && chipCount > 2 ? 2 : chipCount;
  const rows = Math.max(1, Math.ceil(chipCount / Math.max(1, columns)));
  const preferredWidth = forceTwoRows
    ? Math.max(180, (columns * 92) + (Math.max(0, columns - 1) * TOKEN_HUD_CHIP_GAP), tokenScreenSize * 2.05)
    : Math.max(180, (chipCount * 96) + (Math.max(0, chipCount - 1) * TOKEN_HUD_CHIP_GAP), tokenScreenSize * 2.8);

  return {
    columns,
    rows,
    width: Math.min(preferredWidth, maxWidth),
    height: (rows * TOKEN_HUD_CHIP_ROW_HEIGHT) + (Math.max(0, rows - 1) * TOKEN_HUD_CHIP_GAP),
  };
};
const easeOutCubic = (value) => 1 - ((1 - clampToRange(value, 0, 1)) ** 3);
const getAnimationTimestamp = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);
const requestAnimationFrameSafe = (callback) => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return { kind: 'animation-frame', id: window.requestAnimationFrame(callback) };
  }

  return {
    kind: 'timeout',
    id: window.setTimeout(() => callback(getAnimationTimestamp()), 16),
  };
};
const cancelAnimationFrameSafe = (handle) => {
  if (!handle) return;

  if (handle.kind === 'animation-frame' && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle.id);
    return;
  }

  window.clearTimeout(handle.id);
};
const buildBattlemapImageLayer = ({ background, image, opacity = 1 }) => {
  if (!background?.imageUrl || !image) {
    return null;
  }

  return {
    key: `${background.id || background.imageUrl}::${background.imageUrl}`,
    src: background.imageUrl,
    image,
    imageWidth: background.imageWidth || image.naturalWidth || image.width || 0,
    imageHeight: background.imageHeight || image.naturalHeight || image.height || 0,
    opacity,
  };
};
const getDominantBattlemapImageLayer = ({ visibleLayer, fadingOutLayer }) => {
  if (visibleLayer && fadingOutLayer) {
    return visibleLayer.opacity >= fadingOutLayer.opacity ? visibleLayer : fadingOutLayer;
  }

  return visibleLayer || fadingOutLayer || null;
};

const isPointWithinBounds = (point, bounds) => (
  !!point
  && !!bounds
  && point.x >= bounds.minX
  && point.x <= bounds.maxX
  && point.y >= bounds.minY
  && point.y <= bounds.maxY
);

const SelectedTokenResourceHud = ({
  token,
  hudState,
}) => {
  const prefersReducedMotion = useReducedMotion();

  if (!token || !hudState) {
    return null;
  }

  const statChips = [
    { key: 'hp', label: 'HP', value: token.hpCurrent, icon: GiHearts, className: 'border-emerald-100/90 bg-emerald-600/95 text-white' },
    { key: 'mana', label: 'Mana', value: token.manaCurrent, icon: GiMagicSwirl, className: 'border-cyan-100/90 bg-sky-600/95 text-white' },
    ...(token.hasShield ? [{ key: 'shield', label: 'Shield', value: token.shieldCurrent, icon: GiShield, className: 'border-amber-100/95 bg-amber-500/95 text-white' }] : []),
  ];
  const chipTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 0.24, ease: [0.22, 1, 0.36, 1] };

  return (
    <div data-testid="selected-token-resource-hud" className="pointer-events-none absolute inset-0 z-[19]">
      <AnimatePresence initial={false}>
        <motion.div
          key={`${token.tokenId}-chips`}
          data-testid="selected-token-resource-chip-cluster"
          className="pointer-events-none absolute grid justify-center justify-items-center gap-1.5"
          style={{
            left: hudState.chipLeft,
            top: hudState.chipTop,
            width: hudState.chipWidth,
            gridTemplateColumns: `repeat(${hudState.chipColumns}, max-content)`,
          }}
          initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 10, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.96 }}
          transition={chipTransition}
        >
          {statChips.map((chip, index) => (
            <motion.div
              key={chip.key}
              data-testid={`selected-token-resource-chip-${chip.key}`}
              aria-label={`${chip.label} ${Math.max(0, Number(chip.value) || 0)}`}
              className={`inline-flex items-center justify-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold shadow-2xl shadow-black/55 ring-1 ring-black/35 ${chip.className}`}
              style={hudState.chipColumns === 2 && statChips.length % 2 === 1 && index === statChips.length - 1
                ? { gridColumn: '1 / -1', justifySelf: 'center' }
                : undefined}
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 5 }}
              transition={prefersReducedMotion ? { duration: 0.01 } : { ...chipTransition, delay: index * 0.04 }}
            >
              <chip.icon className="h-4 w-4 shrink-0 drop-shadow-[0_1px_2px_rgba(2,6,23,0.45)]" aria-hidden="true" />
              <span>{Math.max(0, Number(chip.value) || 0)}</span>
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

const MeasurementOverlay = ({
  measurement,
  drawTheme = DEFAULT_DRAW_THEME,
  overlayId = '',
  viewportScale = 1,
}) => {
  if (!measurement?.pathPoints?.length || measurement.pathPoints.length < 2 || !measurement?.endPoint || !measurement?.label) {
    return null;
  }

  const linePoints = measurement.pathPoints.flatMap((point) => [point.x, point.y]);
  const markerPoints = measurement.markerPoints || measurement.pathPoints;
  const metrics = buildZoomNormalizedOverlayMetrics(viewportScale);
  const segmentLabelFontSize = metrics.rulerLabelFontSize * 0.9;
  const segmentLabelHeight = metrics.rulerLabelHeight * 0.86;
  const segmentLabelVerticalInset = Math.max(
    metrics.aoeBadgeTopPadding * 0.8,
    segmentLabelHeight - segmentLabelFontSize - metrics.aoeBadgeTopPadding
  );
  const segmentLabelOffset = metrics.rulerMarkerRadius + metrics.aoeBadgeTopPadding;

  const labelWidth = Math.max(
    metrics.rulerLabelMinWidth,
    estimateTextWidth(measurement.label, metrics.rulerLabelFontSize) + (metrics.aoeBadgeSidePadding * 2)
  );
  const labelHeight = metrics.rulerLabelHeight;
  const labelX = measurement.endPoint.x + metrics.rulerLabelOffsetX;
  const labelY = measurement.endPoint.y + metrics.rulerLabelOffsetY;
  const segmentLabelLayouts = (measurement.segments?.length || 0) > 1
    ? measurement.segments.map((segment, index) => {
      const segmentLabel = `${segment.feet} ft`;
      const midpoint = midpointBetween(segment.startPoint, segment.endPoint);
      const direction = normalizeVector(
        segment.endPoint.x - segment.startPoint.x,
        segment.endPoint.y - segment.startPoint.y,
        { x: 1, y: 0 }
      );
      const perpendicular = {
        x: -direction.y,
        y: direction.x,
      };
      const preferredDirection = perpendicular.y > 0 ? -1 : 1;
      const offsetX = perpendicular.x * segmentLabelOffset * preferredDirection;
      const offsetY = perpendicular.y * segmentLabelOffset * preferredDirection;
      const segmentLabelWidth = Math.max(
        metrics.rulerLabelMinWidth * 0.66,
        estimateTextWidth(segmentLabel, segmentLabelFontSize) + (metrics.aoeBadgeSidePadding * 2)
      );

      return {
        key: `${segment.startCell?.col ?? 's'}:${segment.startCell?.row ?? 's'}:${segment.endCell?.col ?? 'e'}:${segment.endCell?.row ?? 'e'}:${index}`,
        text: segmentLabel,
        width: segmentLabelWidth,
        height: segmentLabelHeight,
        x: midpoint.x + offsetX - (segmentLabelWidth / 2),
        y: midpoint.y + offsetY - (segmentLabelHeight / 2),
      };
    })
    : [];

  return (
    <Group listening={false} data-testid={overlayId ? `measurement-overlay-${overlayId}` : undefined}>
      <Line
        points={linePoints}
        stroke={drawTheme.outlineStroke}
        strokeWidth={metrics.rulerOutlineStrokeWidth}
        dash={metrics.rulerDash}
        lineCap="round"
        lineJoin="round"
      />
      <Line
        points={linePoints}
        stroke={drawTheme.stroke}
        strokeWidth={metrics.rulerStrokeWidth}
        dash={metrics.rulerDash}
        lineCap="round"
        lineJoin="round"
        shadowColor={drawTheme.glow}
        shadowBlur={metrics.aoeGlowBlur}
        shadowOpacity={0.28}
      />

      {markerPoints.map((point) => (
        <React.Fragment key={point.key || `${point.x}:${point.y}`}>
          <Circle
            x={point.x}
            y={point.y}
            radius={metrics.rulerMarkerRadius}
            fill="#0f172a"
            stroke={drawTheme.outlineStroke}
            strokeWidth={metrics.rulerOutlineStrokeWidth}
          />
          <Circle
            x={point.x}
            y={point.y}
            radius={metrics.rulerMarkerRadius}
            fill="#0f172a"
            stroke={drawTheme.stroke}
            strokeWidth={metrics.rulerStrokeWidth}
          />
        </React.Fragment>
      ))}

      {segmentLabelLayouts.map((segmentLabel) => (
        <Group
          key={segmentLabel.key}
          x={segmentLabel.x}
          y={segmentLabel.y}
          listening={false}
          data-testid={overlayId ? `measurement-segment-label-${overlayId}` : undefined}
        >
          <Rect
            width={segmentLabel.width}
            height={segmentLabel.height}
            cornerRadius={metrics.aoeBadgeCornerRadius}
            stroke={drawTheme.outlineStroke}
            strokeWidth={metrics.aoeOutlineStrokeWidth}
          />
          <Rect
            width={segmentLabel.width}
            height={segmentLabel.height}
            cornerRadius={metrics.aoeBadgeCornerRadius}
            fill="rgba(2, 6, 23, 0.84)"
            stroke={drawTheme.labelBorder}
            strokeWidth={metrics.aoeAccentStrokeWidth}
            shadowColor={drawTheme.glow}
            shadowBlur={metrics.aoeGlowBlur}
            shadowOpacity={0.18}
          />
          <Text
            x={0}
            y={segmentLabelVerticalInset}
            width={segmentLabel.width}
            align="center"
            fontSize={segmentLabelFontSize}
            fontStyle="bold"
            fill={drawTheme.labelText}
            text={segmentLabel.text}
          />
        </Group>
      ))}

      <Group x={labelX} y={labelY}>
        <Rect
          width={labelWidth}
          height={labelHeight}
          cornerRadius={metrics.aoeBadgeCornerRadius}
          stroke={drawTheme.outlineStroke}
          strokeWidth={metrics.aoeOutlineStrokeWidth}
        />
        <Rect
          width={labelWidth}
          height={labelHeight}
          cornerRadius={metrics.aoeBadgeCornerRadius}
          fill="rgba(2, 6, 23, 0.92)"
          stroke={drawTheme.labelBorder}
          strokeWidth={metrics.aoeAccentStrokeWidth}
          shadowColor={drawTheme.glow}
          shadowBlur={metrics.aoeGlowBlur}
          shadowOpacity={0.2}
        />
        <Text
          x={0}
          y={metrics.aoeBadgeTopPadding}
          width={labelWidth}
          align="center"
          fontSize={metrics.rulerLabelFontSize}
          fontStyle="bold"
          fill={drawTheme.labelText}
          text={measurement.label}
        />
      </Group>
    </Group>
  );
};

const MapPingOverlay = ({
  ping,
  drawTheme = DEFAULT_DRAW_THEME,
  overlayId = '',
  now,
  prefersReducedMotion = false,
}) => {
  if (!ping?.point || !Number.isFinite(ping.startedAtMs) || !Number.isFinite(now)) {
    return null;
  }

  const ageMs = clampToRange(now - ping.startedAtMs, 0, MAP_PING_VISIBLE_MS);
  if (ageMs >= MAP_PING_VISIBLE_MS) {
    return null;
  }

  const progress = clampToRange(ageMs / MAP_PING_VISIBLE_MS, 0, 1);
  const easedProgress = easeOutCubic(progress);
  const pulseStrength = Math.sin(progress * Math.PI);
  const fadeOpacity = 1 - progress;
  const haloRadius = prefersReducedMotion ? 42 : 22 + (easedProgress * 76);
  const flareRadius = prefersReducedMotion ? 68 : 30 + (easedProgress * 138);
  const outerRadius = prefersReducedMotion ? 60 : 28 + (easedProgress * 128);
  const innerRadius = prefersReducedMotion ? 34 : 16 + (easedProgress * 66);
  const sigilRadius = prefersReducedMotion ? 28 : 18 + (pulseStrength * 14);
  const coreRadius = prefersReducedMotion ? 10 : 9 + (pulseStrength * 7);
  const rayInnerRadius = prefersReducedMotion ? 16 : 14 + (easedProgress * 14);
  const rayOuterRadius = prefersReducedMotion ? 62 : 44 + (easedProgress * 62);
  const rayStrokeWidth = prefersReducedMotion ? 3 : Math.max(2.8, 4.8 - (progress * 1.4));
  const rayAngles = Array.from({ length: 8 }, (_, index) => (Math.PI / 4) * index);
  const diamondRadius = prefersReducedMotion ? 18 : 12 + (pulseStrength * 10);
  const accentOpacity = prefersReducedMotion ? 0.92 : fadeOpacity * 0.92;
  const glowOpacity = prefersReducedMotion ? 0.86 : fadeOpacity * 0.86;

  return (
    <Group
      x={ping.point.x}
      y={ping.point.y}
      listening={false}
      data-testid={overlayId ? `map-ping-overlay-${overlayId}` : undefined}
    >
      <Circle
        radius={flareRadius}
        fill={drawTheme.stroke}
        opacity={prefersReducedMotion ? 0.12 : 0.06 + (fadeOpacity * 0.16)}
        shadowColor={drawTheme.glow}
        shadowBlur={prefersReducedMotion ? 18 : 34}
        shadowOpacity={glowOpacity * 0.46}
      />
      <Circle
        radius={haloRadius}
        fill={MAP_PING_EPIC_ACCENT}
        opacity={prefersReducedMotion ? 0.12 : 0.05 + (fadeOpacity * 0.12)}
        shadowColor={MAP_PING_EPIC_SHADOW}
        shadowBlur={prefersReducedMotion ? 14 : 26}
        shadowOpacity={accentOpacity * 0.42}
      />
      <Circle
        radius={outerRadius}
        stroke={drawTheme.outlineStroke}
        strokeWidth={Math.max(6, 9 - (progress * 2.2))}
        opacity={0.22 + (fadeOpacity * 0.16)}
      />
      <Circle
        radius={outerRadius}
        stroke={drawTheme.stroke}
        strokeWidth={Math.max(3.6, 6.4 - (progress * 1.6))}
        opacity={glowOpacity}
        shadowColor={drawTheme.glow}
        shadowBlur={prefersReducedMotion ? 18 : 34}
        shadowOpacity={glowOpacity * 0.62}
      />
      <Circle
        radius={Math.max(24, outerRadius - 12)}
        stroke={MAP_PING_EPIC_ACCENT}
        strokeWidth={Math.max(2.8, 4.4 - progress)}
        opacity={accentOpacity * 0.62}
        shadowColor={MAP_PING_EPIC_SHADOW}
        shadowBlur={prefersReducedMotion ? 12 : 20}
        shadowOpacity={accentOpacity * 0.42}
      />
      <Circle
        radius={innerRadius}
        fill={drawTheme.stroke}
        opacity={prefersReducedMotion ? 0.12 : 0.08 + (fadeOpacity * 0.16)}
        shadowColor={drawTheme.glow}
        shadowBlur={prefersReducedMotion ? 18 : 30}
        shadowOpacity={glowOpacity * 0.38}
      />
      <Circle
        radius={Math.max(14, innerRadius * 0.68)}
        fill={MAP_PING_EPIC_HIGHLIGHT}
        opacity={prefersReducedMotion ? 0.16 : 0.05 + (fadeOpacity * 0.14)}
        shadowColor={MAP_PING_EPIC_SHADOW}
        shadowBlur={prefersReducedMotion ? 10 : 20}
        shadowOpacity={accentOpacity * 0.36}
      />
      <Circle
        radius={sigilRadius}
        stroke={MAP_PING_EPIC_HIGHLIGHT}
        strokeWidth={prefersReducedMotion ? 2.4 : 2.1}
        dash={prefersReducedMotion ? [14, 10] : [12, 8]}
        opacity={accentOpacity * (prefersReducedMotion ? 0.84 : 0.74)}
      />
      <Circle
        radius={sigilRadius}
        stroke={drawTheme.stroke}
        strokeWidth={prefersReducedMotion ? 1.8 : 1.5}
        dash={prefersReducedMotion ? [14, 10] : [12, 8]}
        opacity={glowOpacity * (prefersReducedMotion ? 0.76 : 0.62)}
      />
      <Line
        points={[0, -diamondRadius, diamondRadius, 0, 0, diamondRadius, -diamondRadius, 0]}
        closed
        stroke={MAP_PING_EPIC_ACCENT}
        strokeWidth={prefersReducedMotion ? 2.4 : 2}
        lineJoin="round"
        opacity={accentOpacity * 0.82}
        shadowColor={MAP_PING_EPIC_SHADOW}
        shadowBlur={prefersReducedMotion ? 10 : 14}
        shadowOpacity={accentOpacity * 0.34}
      />
      {!prefersReducedMotion && rayAngles.map((angle) => (
        <React.Fragment key={`ping-ray-${angle}`}>
          <Line
            points={[
              Math.cos(angle) * rayInnerRadius,
              Math.sin(angle) * rayInnerRadius,
              Math.cos(angle) * rayOuterRadius,
              Math.sin(angle) * rayOuterRadius,
            ]}
            stroke={drawTheme.outlineStroke}
            strokeWidth={rayStrokeWidth + 2.6}
            lineCap="round"
            opacity={fadeOpacity * 0.28}
          />
          <Line
            points={[
              Math.cos(angle) * rayInnerRadius,
              Math.sin(angle) * rayInnerRadius,
              Math.cos(angle) * rayOuterRadius,
              Math.sin(angle) * rayOuterRadius,
            ]}
            stroke={drawTheme.stroke}
            strokeWidth={rayStrokeWidth}
            lineCap="round"
            opacity={glowOpacity * 0.76}
            shadowColor={drawTheme.stroke}
            shadowBlur={18}
            shadowOpacity={glowOpacity * 0.4}
          />
          <Line
            points={[
              Math.cos(angle) * rayInnerRadius,
              Math.sin(angle) * rayInnerRadius,
              Math.cos(angle) * rayOuterRadius,
              Math.sin(angle) * rayOuterRadius,
            ]}
            stroke={MAP_PING_EPIC_ACCENT}
            strokeWidth={Math.max(1.4, rayStrokeWidth - 1.8)}
            lineCap="round"
            opacity={accentOpacity * 0.82}
            shadowColor={MAP_PING_EPIC_SHADOW}
            shadowBlur={12}
            shadowOpacity={accentOpacity * 0.34}
          />
        </React.Fragment>
      ))}
      <Circle
        radius={coreRadius}
        fill={MAP_PING_EPIC_HIGHLIGHT}
        opacity={prefersReducedMotion ? 0.96 : 0.36 + (fadeOpacity * 0.64)}
        shadowColor={MAP_PING_EPIC_SHADOW}
        shadowBlur={prefersReducedMotion ? 14 : 20}
        shadowOpacity={accentOpacity * 0.46}
      />
      <Circle
        radius={Math.max(2.5, coreRadius * 0.42)}
        fill={drawTheme.stroke}
        opacity={glowOpacity}
      />
    </Group>
  );
};

const estimateAoELabelWidth = (line) => (
  Math.round((String(line || '').length * AOE_LABEL_AVG_CHAR_WIDTH_PX) + (AOE_LABEL_SIDE_PADDING * 2))
);

const splitAoEFigureMeasurementLines = (figure, maxWidth) => {
  const measurement = figure?.measurement;
  const label = measurement?.label;
  if (!label) {
    return [];
  }

  if (figure.figureType !== 'cone' || estimateAoELabelWidth(label) <= maxWidth) {
    return [label];
  }

  return [
    `L ${measurement.lengthFeet} ft • W ${measurement.widthFeet} ft`,
    `${measurement.angleDegrees}°`,
  ];
};

const buildAoEFigureMeasurementBadgeLayout = ({ figure, boardBounds }) => {
  if (!figure?.measurement?.label || !figure?.bounds) {
    return null;
  }

  const boardWidth = Math.max(0, boardBounds?.width || 0);
  const availableWidth = boardWidth - (AOE_LABEL_EDGE_PADDING * 2);
  const boundedWidth = clampToRange(
    availableWidth,
    AOE_LABEL_MIN_WIDTH,
    AOE_LABEL_MAX_WIDTH
  );
  const lines = splitAoEFigureMeasurementLines(figure, boundedWidth);
  if (!lines.length) {
    return null;
  }

  const contentWidth = Math.max(
    AOE_LABEL_MIN_WIDTH,
    ...lines.map((line) => estimateAoELabelWidth(line))
  );
  const width = Math.min(boundedWidth, contentWidth);
  const textHeight = lines.length * AOE_LABEL_LINE_HEIGHT;
  const height = textHeight + (AOE_LABEL_TOP_PADDING * 2);
  const unclampedX = figure.bounds.maxX + AOE_LABEL_GAP_PX;
  const unclampedY = figure.bounds.minY;
  const minX = (boardBounds?.minX ?? figure.bounds.minX) + AOE_LABEL_EDGE_PADDING;
  const maxX = (boardBounds?.maxX ?? (figure.bounds.maxX + width + AOE_LABEL_EDGE_PADDING)) - width - AOE_LABEL_EDGE_PADDING;
  const minY = (boardBounds?.minY ?? figure.bounds.minY) + AOE_LABEL_EDGE_PADDING;
  const maxY = (boardBounds?.maxY ?? (figure.bounds.maxY + height + AOE_LABEL_EDGE_PADDING)) - height - AOE_LABEL_EDGE_PADDING;

  return {
    lines,
    width,
    height,
    x: clampToRange(unclampedX, minX, Math.max(minX, maxX)),
    y: clampToRange(unclampedY, minY, Math.max(minY, maxY)),
  };
};

const AoEFigureOverlay = ({
  figure,
  drawTheme = DEFAULT_DRAW_THEME,
  overlayId = '',
  isSelected = false,
  onMouseDown,
  listening = true,
  boardBounds = null,
}) => {
  if (!figure?.figureType) {
    return null;
  }

  const overlayProps = {
    listening,
    onMouseDown,
    'data-testid': overlayId ? `aoe-figure-overlay-${overlayId}` : undefined,
  };
  const outlineStroke = isSelected ? 'rgba(248, 250, 252, 0.96)' : drawTheme.outlineStroke;
  const accentStroke = isSelected ? '#ffffff' : drawTheme.stroke;
  const outlineStrokeWidth = isSelected ? SHAPE_OUTLINE_STROKE_WIDTH + 1 : SHAPE_OUTLINE_STROKE_WIDTH;
  const accentStrokeWidth = isSelected ? 2.6 : 1.75;
  const shadowBlur = isSelected ? 16 : 10;
  const measurementLayout = buildAoEFigureMeasurementBadgeLayout({ figure, boardBounds });

  const measurementBadge = measurementLayout ? (
    <Group
      x={measurementLayout.x}
      y={measurementLayout.y}
      listening={false}
      data-testid={overlayId ? `aoe-figure-measurement-${overlayId}` : undefined}
    >
      <Rect
        width={measurementLayout.width}
        height={measurementLayout.height}
        cornerRadius={10}
        stroke={outlineStroke}
        strokeWidth={SHAPE_OUTLINE_STROKE_WIDTH}
      />
      <Rect
        width={measurementLayout.width}
        height={measurementLayout.height}
        cornerRadius={10}
        fill="rgba(2, 6, 23, 0.94)"
        stroke={drawTheme.labelBorder}
        strokeWidth={1.5}
        shadowColor={drawTheme.glow}
        shadowBlur={10}
        shadowOpacity={0.24}
      />
      <Text
        x={AOE_LABEL_SIDE_PADDING}
        y={AOE_LABEL_TOP_PADDING}
        width={measurementLayout.width - (AOE_LABEL_SIDE_PADDING * 2)}
        height={measurementLayout.height - (AOE_LABEL_TOP_PADDING * 2)}
        align="center"
        verticalAlign="middle"
        fontSize={15}
        fontStyle="bold"
        lineHeight={1.15}
        fill={drawTheme.labelText}
        text={measurementLayout.lines.join('\n')}
      />
    </Group>
  ) : null;

  if (figure.figureType === 'circle') {
    return (
      <Group {...overlayProps}>
        <Circle
          x={figure.centerPoint.x}
          y={figure.centerPoint.y}
          radius={figure.radius}
          stroke={outlineStroke}
          strokeWidth={outlineStrokeWidth}
        />
        <Circle
          x={figure.centerPoint.x}
          y={figure.centerPoint.y}
          radius={figure.radius}
          fill={drawTheme.fill}
          stroke={accentStroke}
          strokeWidth={accentStrokeWidth}
          shadowColor={drawTheme.glow}
          shadowBlur={shadowBlur}
          shadowOpacity={0.24}
        />
        {measurementBadge}
      </Group>
    );
  }

  if (figure.figureType === 'square') {
    return (
      <Group {...overlayProps}>
        <Rect
          x={figure.x}
          y={figure.y}
          width={figure.width}
          height={figure.height}
          stroke={outlineStroke}
          strokeWidth={outlineStrokeWidth}
        />
        <Rect
          x={figure.x}
          y={figure.y}
          width={figure.width}
          height={figure.height}
          fill={drawTheme.fill}
          stroke={accentStroke}
          strokeWidth={accentStrokeWidth}
          shadowColor={drawTheme.glow}
          shadowBlur={shadowBlur}
          shadowOpacity={0.24}
        />
        {measurementBadge}
      </Group>
    );
  }

  if (figure.figureType === 'rectangle') {
    return (
      <Group {...overlayProps}>
        <Rect
          x={figure.x}
          y={figure.y}
          width={figure.width}
          height={figure.height}
          stroke={outlineStroke}
          strokeWidth={outlineStrokeWidth}
        />
        <Rect
          x={figure.x}
          y={figure.y}
          width={figure.width}
          height={figure.height}
          fill={drawTheme.fill}
          stroke={accentStroke}
          strokeWidth={accentStrokeWidth}
          shadowColor={drawTheme.glow}
          shadowBlur={shadowBlur}
          shadowOpacity={0.24}
        />
        {measurementBadge}
      </Group>
    );
  }

  if (figure.figureType === 'cone') {
    return (
      <Group {...overlayProps}>
        <Line
          points={figure.flatPoints}
          closed
          stroke={outlineStroke}
          strokeWidth={outlineStrokeWidth}
          lineJoin="round"
        />
        <Line
          points={figure.flatPoints}
          closed
          fill={drawTheme.fill}
          stroke={accentStroke}
          strokeWidth={accentStrokeWidth}
          lineJoin="round"
          shadowColor={drawTheme.glow}
          shadowBlur={shadowBlur}
          shadowOpacity={0.24}
        />
        {measurementBadge}
      </Group>
    );
  }

  return null;
};

const EnhancedAoEFigureOverlay = ({
  figure,
  drawTheme = DEFAULT_DRAW_THEME,
  overlayId = '',
  isSelected = false,
  onMouseDown,
  listening = true,
  viewportScale = 1,
}) => {
  if (!figure?.figureType) {
    return null;
  }

  const overlayProps = {
    listening,
    onMouseDown,
    'data-testid': overlayId ? `aoe-figure-overlay-${overlayId}` : undefined,
  };
  const metrics = buildZoomNormalizedOverlayMetrics(viewportScale);
  const outlineStroke = isSelected ? 'rgba(248, 250, 252, 0.96)' : drawTheme.outlineStroke;
  const accentStroke = isSelected ? '#ffffff' : drawTheme.stroke;
  const outlineStrokeWidth = isSelected ? metrics.aoeOutlineStrokeWidth * 1.25 : metrics.aoeOutlineStrokeWidth;
  const accentStrokeWidth = isSelected ? metrics.aoeAccentStrokeWidth * 1.3 : metrics.aoeAccentStrokeWidth;
  const shadowBlur = isSelected ? metrics.aoeGlowBlur * 1.5 : metrics.aoeGlowBlur;
  const hitFill = 'rgba(255, 255, 255, 0.001)';
  const visibleFill = figure.isFilled === false ? 'rgba(255, 255, 255, 0)' : drawTheme.fill;
  const measurementLayout = buildAoEFigureMeasurementDecorationLayout({ figure, viewportScale });

  const measurementDecoration = measurementLayout ? (
    <Group listening={false} data-testid={overlayId ? `aoe-figure-measurement-${overlayId}` : undefined}>
      <Line
        points={measurementLayout.arrowPoints}
        stroke={accentStroke}
        strokeWidth={measurementLayout.metrics.aoeArrowStrokeWidth}
        lineCap="round"
        lineJoin="round"
      />
      <Line
        points={measurementLayout.arrowHeadPoints}
        closed
        fill={accentStroke}
        stroke={accentStroke}
        strokeWidth={measurementLayout.metrics.aoeArrowStrokeWidth * 0.65}
        lineJoin="round"
      />
      <Circle
        x={measurementLayout.startDot.x}
        y={measurementLayout.startDot.y}
        radius={measurementLayout.metrics.aoeDotRadius}
        fill={accentStroke}
        shadowColor={drawTheme.glow}
        shadowBlur={measurementLayout.metrics.aoeGlowBlur}
        shadowOpacity={0.2}
      />
      <Rect
        x={measurementLayout.badgeX}
        y={measurementLayout.badgeY}
        width={measurementLayout.width}
        height={measurementLayout.height}
        cornerRadius={measurementLayout.metrics.aoeBadgeCornerRadius}
        stroke={outlineStroke}
        strokeWidth={measurementLayout.metrics.aoeOutlineStrokeWidth}
      />
      <Rect
        x={measurementLayout.badgeX}
        y={measurementLayout.badgeY}
        width={measurementLayout.width}
        height={measurementLayout.height}
        cornerRadius={measurementLayout.metrics.aoeBadgeCornerRadius}
        fill="rgba(2, 6, 23, 0.72)"
        stroke={drawTheme.labelBorder}
        strokeWidth={measurementLayout.metrics.aoeAccentStrokeWidth}
        shadowColor={drawTheme.glow}
        shadowBlur={measurementLayout.metrics.aoeGlowBlur}
        shadowOpacity={0.24}
      />
      <Text
        x={measurementLayout.badgeX + measurementLayout.metrics.aoeBadgeSidePadding}
        y={measurementLayout.badgeY + measurementLayout.metrics.aoeBadgeTopPadding}
        width={measurementLayout.width - (measurementLayout.metrics.aoeBadgeSidePadding * 2)}
        align="center"
        fontSize={measurementLayout.metrics.aoePrimaryFontSize}
        fontStyle="bold"
        fill={drawTheme.labelText}
        text={measurementLayout.lines.primary}
      />
      <Text
        x={measurementLayout.badgeX + measurementLayout.metrics.aoeBadgeSidePadding}
        y={measurementLayout.badgeY + measurementLayout.metrics.aoeBadgeTopPadding + measurementLayout.metrics.aoePrimaryFontSize + measurementLayout.metrics.aoeLineGap}
        width={measurementLayout.width - (measurementLayout.metrics.aoeBadgeSidePadding * 2)}
        align="center"
        fontSize={measurementLayout.metrics.aoeSecondaryFontSize}
        fontStyle="bold"
        fill={drawTheme.labelText}
        text={measurementLayout.lines.secondary}
      />
      {figure.measurement?.label && (
        <Text
          x={measurementLayout.badgeX}
          y={measurementLayout.badgeY}
          width={measurementLayout.width}
          opacity={0}
          text={figure.measurement.label}
        />
      )}
    </Group>
  ) : null;

  if (figure.figureType === 'circle') {
    return (
      <Group {...overlayProps}>
        <Circle
          x={figure.centerPoint.x}
          y={figure.centerPoint.y}
          radius={figure.radius}
          fill={hitFill}
          stroke="rgba(255,255,255,0)"
          strokeWidth={metrics.aoeHitStrokeWidth}
        />
        <Circle
          x={figure.centerPoint.x}
          y={figure.centerPoint.y}
          radius={figure.radius}
          stroke={outlineStroke}
          strokeWidth={outlineStrokeWidth}
        />
        <Circle
          x={figure.centerPoint.x}
          y={figure.centerPoint.y}
          radius={figure.radius}
          fill={visibleFill}
          stroke={accentStroke}
          strokeWidth={accentStrokeWidth}
          shadowColor={drawTheme.glow}
          shadowBlur={shadowBlur}
          shadowOpacity={0.24}
        />
        {measurementDecoration}
      </Group>
    );
  }

  if (figure.figureType === 'square' || figure.figureType === 'rectangle') {
    return (
      <Group {...overlayProps}>
        <Rect
          x={figure.x}
          y={figure.y}
          width={figure.width}
          height={figure.height}
          fill={hitFill}
          stroke="rgba(255,255,255,0)"
          strokeWidth={metrics.aoeHitStrokeWidth}
        />
        <Rect
          x={figure.x}
          y={figure.y}
          width={figure.width}
          height={figure.height}
          stroke={outlineStroke}
          strokeWidth={outlineStrokeWidth}
        />
        <Rect
          x={figure.x}
          y={figure.y}
          width={figure.width}
          height={figure.height}
          fill={visibleFill}
          stroke={accentStroke}
          strokeWidth={accentStrokeWidth}
          shadowColor={drawTheme.glow}
          shadowBlur={shadowBlur}
          shadowOpacity={0.24}
        />
        {measurementDecoration}
      </Group>
    );
  }

  if (figure.figureType === 'cone') {
    return (
      <Group {...overlayProps}>
        <Line
          points={figure.flatPoints}
          closed
          fill={hitFill}
          stroke="rgba(255,255,255,0)"
          strokeWidth={metrics.aoeHitStrokeWidth}
          lineJoin="round"
        />
        <Line
          points={figure.flatPoints}
          closed
          stroke={outlineStroke}
          strokeWidth={outlineStrokeWidth}
          lineJoin="round"
        />
        <Line
          points={figure.flatPoints}
          closed
          fill={visibleFill}
          stroke={accentStroke}
          strokeWidth={accentStrokeWidth}
          lineJoin="round"
          shadowColor={drawTheme.glow}
          shadowBlur={shadowBlur}
          shadowOpacity={0.24}
        />
        {measurementDecoration}
      </Group>
    );
  }

  return null;
};

const getDrawSwatchStyle = (theme, isActive = false) => ({
  background: theme.swatchBackground,
  borderColor: isActive ? theme.swatchBorder : 'rgba(71, 85, 105, 0.9)',
  boxShadow: isActive
    ? `0 0 0 2px rgba(2, 6, 23, 0.92), 0 0 0 4px ${theme.swatchBorder}, ${theme.swatchGlow}`
    : `inset 0 0 0 1px rgba(255, 255, 255, 0.08), ${theme.swatchGlow}`,
});

const getQuickControlButtonClassName = (isActive = false) => [
  QUICK_CONTROL_BUTTON_BASE_CLASS,
  isActive ? QUICK_CONTROL_NEON_SURFACE_CLASS : QUICK_CONTROL_NEUTRAL_SURFACE_CLASS,
  isActive ? QUICK_CONTROL_BUTTON_ACTIVE_CLASS : QUICK_CONTROL_BUTTON_IDLE_CLASS,
].join(' ');

const getAoETemplateOptionClassName = (isActive = false) => [
  AOE_TEMPLATE_OPTION_BASE_CLASS,
  isActive ? AOE_TEMPLATE_OPTION_ACTIVE_CLASS : AOE_TEMPLATE_OPTION_IDLE_CLASS,
].join(' ');

const areStringArraysEqual = (left = [], right = []) => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

const DrawColorPicker = ({ activeColorKey, onChange, disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const drawerId = useId();
  const activeTheme = useMemo(
    () => getGrigliataDrawTheme(activeColorKey),
    [activeColorKey]
  );
  const alternativeThemes = useMemo(
    () => GRIGLIATA_DRAW_THEMES.filter((theme) => theme.key !== activeTheme.key),
    [activeTheme.key]
  );

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (pickerRef.current?.contains(event.target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectColor = (nextColorKey) => {
    if (disabled) {
      return;
    }

    onChange?.(nextColorKey);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={pickerRef} className="relative z-10 h-10 w-10 shrink-0" data-testid="draw-color-picker">
      <motion.div
        initial={false}
        animate={prefersReducedMotion
          ? undefined
          : {
            boxShadow: isOpen
              ? '0 22px 48px -22px rgba(2, 6, 23, 0.96)'
              : '0 14px 32px -24px rgba(2, 6, 23, 0.9)',
          }}
        className="absolute left-0 top-0 z-20 flex min-h-10 items-center justify-start rounded-2xl border border-slate-800/90 bg-slate-950/92 p-1 backdrop-blur-md"
      >
        <button
          ref={triggerRef}
          type="button"
          title={isOpen
            ? `Close drawing color choices. Current color: ${activeTheme.label}`
            : `Choose drawing color. Current color: ${activeTheme.label}`}
          aria-label={isOpen
            ? `Close drawing color choices. Current color: ${activeTheme.label}`
            : `Choose drawing color. Current color: ${activeTheme.label}`}
          aria-haspopup="true"
          aria-expanded={isOpen}
          aria-controls={drawerId}
          data-testid="draw-color-trigger"
          disabled={disabled}
          onClick={() => setIsOpen((currentOpen) => !currentOpen)}
          className="group relative flex h-8 w-8 items-center justify-center rounded-full border transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          style={getDrawSwatchStyle(activeTheme, true)}
        >
          <span className="sr-only">{activeTheme.label}</span>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[8px] rounded-full bg-slate-950/85"
            style={{ boxShadow: `0 0 12px ${activeTheme.stroke}` }}
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-slate-900/95 bg-slate-100/95 text-[10px] font-black leading-none text-slate-950 shadow-sm transition-transform duration-200 ${
              isOpen ? 'rotate-45' : 'rotate-0'
            }`}
          >
            +
          </span>
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              key="draw-color-drawer"
              id={drawerId}
              data-testid="draw-color-drawer"
              className="flex items-center gap-2 overflow-hidden pl-2 pr-2"
              initial={prefersReducedMotion ? { opacity: 1, width: 'auto' } : { opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={prefersReducedMotion ? { opacity: 0, width: 0 } : { opacity: 0, width: 0 }}
              transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.26, ease: DRAW_PICKER_EASE }}
            >
              <motion.span
                aria-hidden="true"
                initial={prefersReducedMotion ? false : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.16, ease: DRAW_PICKER_EASE }}
                className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400"
              >
                Draw
              </motion.span>

              <div className="flex items-center gap-1.5" role="group" aria-label="Choose a different drawing color">
                {alternativeThemes.map((theme, index) => (
                  <motion.button
                    key={theme.key}
                    type="button"
                    title={`Use ${theme.label} for grid drawings`}
                    aria-label={`Use ${theme.label} for grid drawings`}
                    data-testid={`draw-color-option-${theme.key}`}
                    onClick={() => handleSelectColor(theme.key)}
                    initial={prefersReducedMotion ? false : { opacity: 0, x: 12, scale: 0.74 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 12, scale: 0.82 }}
                    transition={prefersReducedMotion
                      ? { duration: 0.01 }
                      : { duration: 0.18, delay: index * 0.03, ease: DRAW_PICKER_EASE }}
                    className="group relative flex h-7 w-7 items-center justify-center rounded-full border transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    style={getDrawSwatchStyle(theme)}
                  >
                    <span className="sr-only">{theme.label}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

const AOE_TEMPLATE_LABELS = {
  circle: 'Circle',
  square: 'Square',
  cone: 'Cone',
  rectangle: 'Rectangle',
};
const SELECTABLE_AOE_FIGURE_TYPES = ['circle', 'rectangle', 'cone'];

const AoETemplateIcon = ({ figureType }) => {
  if (figureType === 'circle') {
    return <span aria-hidden="true" className="block h-4 w-4 rounded-full border-2 border-current" />;
  }

  if (figureType === 'rectangle') {
    return <span aria-hidden="true" className="block h-3.5 w-5 rounded-[4px] border-2 border-current" />;
  }

  if (figureType === 'cone') {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 overflow-visible">
        <path
          d="M4 15 10 5l6 10Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return null;
};

const AoETemplatePicker = ({ activeFigureType = '', onChange, disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const drawerId = useId();
  const activeLabel = activeFigureType ? AOE_TEMPLATE_LABELS[activeFigureType] || 'AoE' : 'AoE';

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (pickerRef.current?.contains(event.target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectTemplate = (figureType) => {
    if (disabled) {
      return;
    }

    onChange?.(figureType === activeFigureType ? '' : figureType);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={pickerRef} className="relative z-10 h-10 w-10 shrink-0" data-testid="aoe-template-picker">
      <div className="absolute left-0 top-0 z-20 flex items-start gap-2">
        <button
          ref={triggerRef}
          type="button"
          title={activeFigureType
            ? `Change area template. Current template: ${activeLabel}`
            : 'Choose an area template'}
          aria-label={activeFigureType
            ? `Change area template. Current template: ${activeLabel}`
            : 'Choose an area template'}
          aria-haspopup="true"
          aria-expanded={isOpen}
          aria-controls={drawerId}
          data-testid="aoe-template-trigger"
          disabled={disabled}
          onClick={() => setIsOpen((currentOpen) => !currentOpen)}
          className={`${getQuickControlButtonClassName(!!activeFigureType)} text-[10px] font-black uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60`}
        >
          AoE
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              key="aoe-template-drawer"
              id={drawerId}
              data-testid="aoe-template-drawer"
              className={QUICK_CONTROL_DRAWER_CLASS}
              initial={prefersReducedMotion ? { opacity: 1, width: 'auto' } : { opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={prefersReducedMotion ? { opacity: 0, width: 0 } : { opacity: 0, width: 0 }}
              transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.26, ease: DRAW_PICKER_EASE }}
            >
              <div className="flex items-center gap-1.5" role="group" aria-label="Choose an area template">
                {SELECTABLE_AOE_FIGURE_TYPES.map((figureType, index) => {
                  const isActive = figureType === activeFigureType;
                  const label = AOE_TEMPLATE_LABELS[figureType] || figureType;

                  return (
                    <motion.button
                      key={figureType}
                      type="button"
                      title={`Use the ${label.toLowerCase()} area template`}
                      aria-label={`Use the ${label.toLowerCase()} area template`}
                      aria-pressed={isActive}
                      data-testid={`aoe-template-option-${figureType}`}
                      onClick={() => handleSelectTemplate(figureType)}
                      initial={prefersReducedMotion ? false : { opacity: 0, x: 12, scale: 0.74 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 12, scale: 0.82 }}
                      transition={prefersReducedMotion
                        ? { duration: 0.01 }
                        : { duration: 0.18, delay: index * 0.03, ease: DRAW_PICKER_EASE }}
                      className={getAoETemplateOptionClassName(isActive)}
                    >
                      <AoETemplateIcon figureType={figureType} />
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const TurnOrderPanel = ({
  currentUserId = '',
  entries = [],
  isManager = false,
  activeTurnTokenId = '',
  onSaveTurnOrderInitiative,
  savingTurnOrderInitiativeTokenId = '',
  isReadOnly = false,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [initiativeEditors, setInitiativeEditors] = useState({});

  useEffect(() => {
    setInitiativeEditors((currentEditors) => entries.reduce((nextEditors, entry) => {
      const baseValue = Number.isInteger(entry?.initiative) ? entry.initiative : 0;
      const existingEditor = currentEditors[entry.tokenId];

      if (!existingEditor) {
        nextEditors[entry.tokenId] = {
          draft: String(baseValue),
          base: baseValue,
        };
        return nextEditors;
      }

      const isDirty = existingEditor.draft !== String(existingEditor.base);
      nextEditors[entry.tokenId] = isDirty
        ? { ...existingEditor, base: baseValue }
        : { draft: String(baseValue), base: baseValue };
      return nextEditors;
    }, {}));
  }, [entries]);

  const handleDraftChange = (tokenId, nextValue) => {
    setInitiativeEditors((currentEditors) => {
      const existingEditor = currentEditors[tokenId];
      return {
        ...currentEditors,
        [tokenId]: {
          draft: nextValue,
          base: existingEditor?.base ?? 0,
        },
      };
    });
  };

  const handleSaveInitiative = async (tokenId) => {
    const editor = initiativeEditors[tokenId];
    const normalizedDraft = typeof editor?.draft === 'string' ? editor.draft.trim() : '';
    if (!/^-?\d+$/.test(normalizedDraft)) {
      return;
    }

    const nextInitiative = Number.parseInt(normalizedDraft, 10);
    const didSave = await Promise.resolve(onSaveTurnOrderInitiative?.(tokenId, nextInitiative));
    if (didSave === false) {
      return;
    }

    setInitiativeEditors((currentEditors) => ({
      ...currentEditors,
      [tokenId]: {
        draft: String(nextInitiative),
        base: nextInitiative,
      },
    }));
  };

  const handleDiscardInitiative = (tokenId) => {
    setInitiativeEditors((currentEditors) => {
      const existingEditor = currentEditors[tokenId];
      const baseValue = Number.isInteger(existingEditor?.base) ? existingEditor.base : 0;

      return {
        ...currentEditors,
        [tokenId]: {
          draft: String(baseValue),
          base: baseValue,
        },
      };
    });
  };

  return (
    <div className="pointer-events-auto min-h-0 w-full">
      <div className="relative flex max-h-[calc(100vh-12rem)] min-h-0 flex-col items-end gap-2 overflow-x-hidden overflow-y-auto pb-8 pl-3 pr-0 pt-1">
        {entries.length > 0 && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 right-5 top-0 w-px origin-top bg-gradient-to-b from-fuchsia-200/45 via-slate-500/30 to-slate-800/10"
            initial={prefersReducedMotion ? false : { opacity: 0, scaleY: 0 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scaleY: 0 }}
            transition={prefersReducedMotion ? { duration: 0.01 } : TURN_ORDER_DRAWER_TRANSITION}
          />
        )}
        {entries.length ? entries.map((entry) => {
          const isActiveTurn = entry.tokenId === activeTurnTokenId;
          const canEdit = !isReadOnly && canEditTurnOrderEntry({
            entry,
            currentUserId,
            isManager,
          });
          const editor = initiativeEditors[entry.tokenId] || {
            draft: String(Number.isInteger(entry?.initiative) ? entry.initiative : 0),
            base: Number.isInteger(entry?.initiative) ? entry.initiative : 0,
          };
          const isSaving = savingTurnOrderInitiativeTokenId === entry.tokenId;

          return (
            <motion.div
              key={entry.tokenId}
              data-testid={`turn-order-entry-${entry.tokenId}`}
              data-active-turn={isActiveTurn ? 'true' : 'false'}
              className={`relative z-10 flex max-w-full items-center gap-3 ${isActiveTurn
                ? 'rounded-[1.1rem] bg-gradient-to-l from-fuchsia-500/14 via-fuchsia-500/5 to-transparent px-2 py-2 shadow-[0_0_18px_rgba(217,70,239,0.18)] ring-1 ring-fuchsia-300/25'
                : 'py-1.5'}`}
              initial={prefersReducedMotion ? false : { opacity: 0, y: -10, x: 6 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -10, x: 6 }}
              transition={prefersReducedMotion ? { duration: 0.01 } : TURN_ORDER_ENTRY_TRANSITION}
            >
              <div className="min-w-0 max-w-[8.5rem] text-right">
                <div className={`truncate text-sm font-semibold ${isActiveTurn ? 'text-fuchsia-50' : 'text-slate-100'}`}>{entry.label}</div>
                {canEdit ? (
                  <form
                    className="mt-1 inline-flex items-center justify-end gap-1.5"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      await handleSaveInitiative(entry.tokenId);
                    }}
                  >
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="-?[0-9]*"
                      value={editor.draft}
                      disabled={isSaving || isReadOnly}
                      data-testid={`turn-order-initiative-input-${entry.tokenId}`}
                      aria-label={`Initiative for ${entry.label}`}
                      onChange={(event) => handleDraftChange(entry.tokenId, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();
                        handleDiscardInitiative(entry.tokenId);
                      }}
                      className={`w-10 rounded-lg bg-slate-950/95 px-1.5 py-1 text-center text-xs font-semibold outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${isActiveTurn
                        ? 'border border-fuchsia-300/70 text-fuchsia-50 shadow-[0_0_12px_rgba(217,70,239,0.16)] focus:border-fuchsia-200/85'
                        : 'border border-slate-700/90 text-slate-100 focus:border-fuchsia-300/75'}`}
                    />
                  </form>
                ) : (
                  <div
                    data-testid={`turn-order-initiative-value-${entry.tokenId}`}
                    className={`mt-1 text-xs font-semibold ${isActiveTurn ? 'text-fuchsia-200' : 'text-slate-400'}`}
                  >
                    {entry.initiative}
                  </div>
                )}
              </div>

              {entry.imageUrl ? (
                <img
                  src={entry.imageUrl}
                  alt=""
                  className={`h-10 w-10 shrink-0 rounded-2xl object-cover ${isActiveTurn
                    ? 'border border-fuchsia-300/75 shadow-[0_0_16px_rgba(217,70,239,0.22)]'
                    : 'border border-slate-700/80'}`}
                />
              ) : (
                <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-800/90 text-xs font-bold uppercase tracking-[0.18em] ${isActiveTurn
                  ? 'border border-fuchsia-300/75 text-fuchsia-50 shadow-[0_0_16px_rgba(217,70,239,0.22)]'
                  : 'border border-slate-700/80 text-slate-200'}`}>
                  {getInitials(entry.label)}
                </div>
              )}
            </motion.div>
          );
        }) : (
          <motion.div
            data-testid="turn-order-empty-state"
            className="w-full rounded-[1.35rem] border border-dashed border-slate-700/90 bg-slate-900/70 px-4 py-5 text-sm leading-relaxed text-slate-400"
            initial={prefersReducedMotion ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={prefersReducedMotion ? { duration: 0.01 } : TURN_ORDER_ENTRY_TRANSITION}
          >
            No tokens have joined the turn order yet.
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default function GrigliataBoard({
  activeBackground,
  combatBackgroundName = '',
  grid,
  isGridVisible = true,
  tokens,
  aoeFigures = [],
  currentUserId,
  isManager,
  isTokenDragActive,
  activeTrayDragType = '',
  isRulerEnabled,
  activeAoeFigureType = '',
  isInteractionSharingEnabled = false,
  isMusicMuted = false,
  isMusicMutePending = false,
  drawTheme,
  onSelectMouseTool,
  onToggleRuler,
  onChangeAoeFigureType,
  onToggleInteractionSharing,
  onToggleMusicMuted,
  onChangeDrawColor,
  onToggleGridVisibility,
  isGridVisibilityToggleDisabled,
  onDeactivateActiveBackground,
  isDeactivateActiveBackgroundDisabled,
  isTurnOrderEnabled = true,
  turnOrderEntries = [],
  isTurnOrderStarted = false,
  activeTurnTokenId = '',
  onStartTurnOrder,
  onAdvanceTurnOrder,
  isTurnOrderProgressPending = false,
  onResetTurnOrder,
  isTurnOrderResetPending = false,
  onJoinTurnOrder,
  onLeaveTurnOrder,
  turnOrderActionTokenId = '',
  onSaveTurnOrderInitiative,
  savingTurnOrderInitiativeTokenId = '',
  onAdjustGridSize,
  isGridSizeAdjustmentDisabled,
  onMoveTokens,
  onDeleteTokens,
  onCreateAoEFigure,
  onMoveAoEFigure,
  onUpdateAoEFigurePresentation,
  onDeleteAoEFigures,
  onSetSelectedTokensVisibility,
  isTokenVisibilityActionPending,
  onSetSelectedTokensDeadState,
  isTokenDeadActionPending,
  onUpdateTokenStatuses,
  isTokenStatusActionPending,
  onSetSelectedTokenSize,
  isTokenSizeActionPending = false,
  selectedTokenDetails = null,
  onDropCurrentToken,
  onSelectedTokenIdsChange,
  sharedInteractions = [],
  onSharedInteractionChange,
  isNarrationOverlayActive = false,
}) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const interactionRef = useRef(null);
  const pingHoldTimeoutRef = useRef(null);
  const pingBroadcastClearTimeoutRef = useRef(null);
  const nextLocalPingIdRef = useRef(0);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [isDropActive, setIsDropActive] = useState(false);
  const [selectedTokenIds, setSelectedTokenIds] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const [tokenDragState, setTokenDragState] = useState(null);
  const [measurementState, setMeasurementState] = useState(null);
  const [aoePreviewState, setAoEPreviewState] = useState(null);
  const [selectedAoEFigureId, setSelectedAoEFigureId] = useState('');
  const [aoeFigureDragState, setAoEFigureDragState] = useState(null);
  const [activeSharedInteraction, setActiveSharedInteraction] = useState(null);
  const [localPings, setLocalPings] = useState([]);
  const [pingAnimationClock, setPingAnimationClock] = useState(() => Date.now());
  const [hoveredOverflowTokenId, setHoveredOverflowTokenId] = useState('');
  const [pinnedOverflowTokenId, setPinnedOverflowTokenId] = useState('');
  const [isTurnOrderPanelCollapsed, setIsTurnOrderPanelCollapsed] = useState(() => readStoredTurnOrderCollapsed(currentUserId));
  const turnOrderPanelBodyId = useId();
  const [turnOrderContextMenu, setTurnOrderContextMenu] = useState(null);
  const [turnOrderJoinPrompt, setTurnOrderJoinPrompt] = useState(null);
  const backgroundAssetSnapshot = useImageAssetSnapshot(activeBackground?.imageUrl || '');
  const turnOrderContextMenuRef = useRef(null);
  const turnOrderJoinInputRef = useRef(null);
  const lastReportedSelectedTokenIdsRef = useRef([]);
  const [battlemapImageTransition, setBattlemapImageTransition] = useState({
    visibleLayer: null,
    fadingOutLayer: null,
  });
  const battlemapImageTransitionRef = useRef(battlemapImageTransition);
  const battlemapImageAnimationHandleRef = useRef(null);
  const previousNarrationOverlayActiveRef = useRef(isNarrationOverlayActive);
  const lastFitKeyRef = useRef('');
  const resolvedDrawTheme = drawTheme || DEFAULT_DRAW_THEME;
  const isMouseSelectionActive = !isRulerEnabled && !activeAoeFigureType;
  const isMusicEnabled = !isMusicMuted;
  const musicToggleActionLabel = isMusicEnabled ? 'Mute Music' : 'Unmute Music';
  const musicToggleStateLabel = isMusicEnabled ? 'Shared music enabled' : 'Shared music muted';
  const prefersReducedMotion = useReducedMotion();

  const cancelBattlemapImageAnimation = useCallback(() => {
    cancelAnimationFrameSafe(battlemapImageAnimationHandleRef.current);
    battlemapImageAnimationHandleRef.current = null;
  }, []);

  useEffect(() => {
    battlemapImageTransitionRef.current = battlemapImageTransition;
  }, [battlemapImageTransition]);

  useEffect(() => (
    () => {
      cancelBattlemapImageAnimation();
    }
  ), [cancelBattlemapImageAnimation]);

  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);

  const resolvedBackground = useMemo(() => {
    if (!activeBackground) return null;

    return {
      ...activeBackground,
      imageWidth: activeBackground.imageWidth || backgroundAssetSnapshot.image?.naturalWidth || backgroundAssetSnapshot.image?.width || 0,
      imageHeight: activeBackground.imageHeight || backgroundAssetSnapshot.image?.naturalHeight || backgroundAssetSnapshot.image?.height || 0,
    };
  }, [activeBackground, backgroundAssetSnapshot.image]);

  const targetBattlemapImageLayer = useMemo(
    () => buildBattlemapImageLayer({
      background: resolvedBackground,
      image: backgroundAssetSnapshot.image,
    }),
    [backgroundAssetSnapshot.image, resolvedBackground]
  );

  const runBattlemapImageTransition = useCallback((fromLayer, toLayer) => {
    cancelBattlemapImageAnimation();

    if (prefersReducedMotion) {
      setBattlemapImageTransition({
        visibleLayer: toLayer ? { ...toLayer, opacity: 1 } : null,
        fadingOutLayer: null,
      });
      return;
    }

    const initialVisibleLayer = toLayer
      ? { ...toLayer, opacity: fromLayer ? 0 : 0 }
      : null;
    const initialFadingOutLayer = fromLayer
      ? { ...fromLayer, opacity: fromLayer.opacity ?? 1 }
      : null;
    const startedAtMs = getAnimationTimestamp();

    setBattlemapImageTransition({
      visibleLayer: initialVisibleLayer,
      fadingOutLayer: initialFadingOutLayer,
    });

    const step = (timestamp) => {
      const easedProgress = easeOutCubic(
        clampToRange((timestamp - startedAtMs) / BATTLEMAP_IMAGE_FADE_DURATION_MS, 0, 1)
      );

      setBattlemapImageTransition({
        visibleLayer: toLayer
          ? { ...toLayer, opacity: easedProgress }
          : null,
        fadingOutLayer: fromLayer
          ? { ...fromLayer, opacity: 1 - easedProgress }
          : null,
      });

      if (easedProgress >= 1) {
        battlemapImageAnimationHandleRef.current = null;
        setBattlemapImageTransition({
          visibleLayer: toLayer ? { ...toLayer, opacity: 1 } : null,
          fadingOutLayer: null,
        });
        return;
      }

      battlemapImageAnimationHandleRef.current = requestAnimationFrameSafe(step);
    };

    battlemapImageAnimationHandleRef.current = requestAnimationFrameSafe(step);
  }, [cancelBattlemapImageAnimation, prefersReducedMotion]);

  useEffect(() => {
    const currentTransition = battlemapImageTransitionRef.current;
    const dominantLayer = getDominantBattlemapImageLayer(currentTransition);
    const wasNarrationOverlayActive = previousNarrationOverlayActiveRef.current;
    previousNarrationOverlayActiveRef.current = isNarrationOverlayActive;
    const shouldSkipTransition = isNarrationOverlayActive || wasNarrationOverlayActive;

    if (!activeBackground?.imageUrl) {
      if (!dominantLayer) {
        cancelBattlemapImageAnimation();
        setBattlemapImageTransition({ visibleLayer: null, fadingOutLayer: null });
        return;
      }

      runBattlemapImageTransition(dominantLayer, null);
      return;
    }

    if (shouldSkipTransition && backgroundAssetSnapshot.status !== 'loaded') {
      cancelBattlemapImageAnimation();
      setBattlemapImageTransition({ visibleLayer: null, fadingOutLayer: null });
      return;
    }

    if (backgroundAssetSnapshot.status === 'loaded' && targetBattlemapImageLayer && shouldSkipTransition) {
      cancelBattlemapImageAnimation();
      setBattlemapImageTransition({
        visibleLayer: { ...targetBattlemapImageLayer, opacity: 1 },
        fadingOutLayer: null,
      });
      return;
    }

    if (
      targetBattlemapImageLayer
      && (
        currentTransition.visibleLayer?.src === targetBattlemapImageLayer.src
        || (!currentTransition.fadingOutLayer && dominantLayer?.src === targetBattlemapImageLayer.src)
      )
    ) {
      cancelBattlemapImageAnimation();
      setBattlemapImageTransition((currentState) => ({
        visibleLayer: currentState.visibleLayer?.src === targetBattlemapImageLayer.src
          ? { ...currentState.visibleLayer, ...targetBattlemapImageLayer, opacity: currentState.visibleLayer.opacity ?? 1 }
          : { ...targetBattlemapImageLayer, opacity: 1 },
        fadingOutLayer: currentState.fadingOutLayer?.src === targetBattlemapImageLayer.src
          ? null
          : currentState.fadingOutLayer,
      }));
      return;
    }

    if (backgroundAssetSnapshot.status === 'loaded' && targetBattlemapImageLayer) {
      runBattlemapImageTransition(dominantLayer, targetBattlemapImageLayer);
      return;
    }

    if (backgroundAssetSnapshot.status === 'error') {
      if (!dominantLayer) {
        cancelBattlemapImageAnimation();
        setBattlemapImageTransition({ visibleLayer: null, fadingOutLayer: null });
        return;
      }

      runBattlemapImageTransition(dominantLayer, null);
    }
  }, [
    activeBackground?.imageUrl,
    backgroundAssetSnapshot.status,
    cancelBattlemapImageAnimation,
    isNarrationOverlayActive,
    runBattlemapImageTransition,
    targetBattlemapImageLayer,
  ]);

  const placedTokens = useMemo(
    () => (tokens || []).filter((token) => token?.placed),
    [tokens]
  );

  const tokenItems = useMemo(
    () => placedTokens.map((token) => {
      const tokenId = token.id || token.ownerUid;
      const canMove = !!tokenId && (isManager || token.ownerUid === currentUserId || tokenId === currentUserId);
      return {
        ...token,
        tokenId,
        canMove,
        position: getTokenPositionPx(token, normalizedGrid),
      };
    }),
    [placedTokens, isManager, currentUserId, normalizedGrid]
  );

  const tokenItemsById = useMemo(() => {
    const nextMap = new Map();
    tokenItems.forEach((token) => {
      nextMap.set(token.tokenId, token);
    });
    return nextMap;
  }, [tokenItems]);

  const activeTurnOrderContextToken = useMemo(() => {
    if (!turnOrderContextMenu?.tokenId) {
      return null;
    }

    return tokenItemsById.get(turnOrderContextMenu.tokenId) || null;
  }, [tokenItemsById, turnOrderContextMenu]);

  const activeTurnOrderJoinToken = useMemo(() => {
    if (!turnOrderJoinPrompt?.tokenId) {
      return null;
    }

    return tokenItemsById.get(turnOrderJoinPrompt.tokenId) || null;
  }, [tokenItemsById, turnOrderJoinPrompt]);

  useEffect(() => {
    if (!turnOrderContextMenu) {
      return;
    }

    if (!activeTurnOrderContextToken) {
      setTurnOrderContextMenu(null);
    }
  }, [activeTurnOrderContextToken, turnOrderContextMenu]);

  useEffect(() => {
    if (!turnOrderJoinPrompt) {
      return;
    }

    if (
      !activeTurnOrderJoinToken
      || !activeTurnOrderJoinToken.canMove
      || activeTurnOrderJoinToken.isInTurnOrder
    ) {
      setTurnOrderJoinPrompt(null);
    }
  }, [activeTurnOrderJoinToken, turnOrderJoinPrompt]);

  const movableTokenIds = useMemo(
    () => new Set(tokenItems.filter((token) => token.canMove).map((token) => token.tokenId)),
    [tokenItems]
  );

  const figureItems = useMemo(
    () => (aoeFigures || [])
      .map((figure) => normalizeGrigliataAoEFigure(figure))
      .filter(Boolean)
      .map((figure) => ({
        ...figure,
        canEdit: isManager || figure.ownerUid === currentUserId,
        renderable: buildRenderableGrigliataAoEFigure({
          figure,
          grid: normalizedGrid,
        }),
      }))
      .filter((figure) => !!figure.renderable),
    [aoeFigures, currentUserId, isManager, normalizedGrid]
  );

  const figureItemsById = useMemo(() => {
    const nextMap = new Map();
    figureItems.forEach((figure) => {
      nextMap.set(figure.id, figure);
    });
    return nextMap;
  }, [figureItems]);

  const selectedTokenIdSet = useMemo(
    () => new Set(selectedTokenIds),
    [selectedTokenIds]
  );

  const dragPositionOverrides = useMemo(() => {
    const nextMap = new Map();
    if (!tokenDragState) return nextMap;

    tokenDragState.originTokens.forEach((originToken) => {
      nextMap.set(originToken.tokenId, {
        x: originToken.x + tokenDragState.deltaWorld.x,
        y: originToken.y + tokenDragState.deltaWorld.y,
        size: originToken.size,
      });
    });

    return nextMap;
  }, [tokenDragState]);

  const renderedTokens = useMemo(
    () => tokenItems.map((token) => ({
      ...token,
      renderPosition: dragPositionOverrides.get(token.tokenId) || token.position,
      isActiveTurn: token.tokenId === activeTurnTokenId,
      isSelected: selectedTokenIdSet.has(token.tokenId),
    })),
    [activeTurnTokenId, tokenItems, dragPositionOverrides, selectedTokenIdSet]
  );
  const renderedAoEFigures = useMemo(
    () => figureItems.map((figure) => {
      const dragDraft = aoeFigureDragState?.figureId === figure.id
        ? normalizeGrigliataAoEFigureDraft(aoeFigureDragState.draft)
        : null;
      const renderable = dragDraft
        ? buildRenderableGrigliataAoEFigure({
          figure: dragDraft,
          grid: normalizedGrid,
        })
        : figure.renderable;

      return {
        ...figure,
        renderable,
        isSelected: selectedAoEFigureId === figure.id,
      };
    }).filter((figure) => !!figure.renderable),
    [aoeFigureDragState, figureItems, normalizedGrid, selectedAoEFigureId]
  );
  const tokenStatusDisplayById = useMemo(() => {
    const nextMap = new Map();

    renderedTokens.forEach((token) => {
      nextMap.set(
        token.tokenId,
        splitTokenStatusesForDisplay(token.statuses, TOKEN_STATUS_VISIBLE_BADGE_COUNT)
      );
    });

    return nextMap;
  }, [renderedTokens]);
  const badgeStatusIds = useMemo(() => {
    const nextStatusIds = new Set();

    renderedTokens.forEach((token) => {
      const statusDisplay = tokenStatusDisplayById.get(token.tokenId);
      statusDisplay?.visibleStatuses?.forEach((statusId) => {
        nextStatusIds.add(statusId);
      });
    });

    return [...nextStatusIds];
  }, [renderedTokens, tokenStatusDisplayById]);
  const tokenStatusBadgeImages = useTokenStatusIconImages(badgeStatusIds);

  const boardBounds = useMemo(
    () => getBoardBounds({ background: resolvedBackground, grid: normalizedGrid, tokens: placedTokens }),
    [resolvedBackground, normalizedGrid, placedTokens]
  );
  const renderedSharedInteractions = useMemo(
    () => (sharedInteractions || [])
      .filter((interaction) => interaction?.ownerUid && interaction.ownerUid !== currentUserId)
      .map((interaction) => {
        if (interaction.type === 'ping') {
          const ping = buildPingFromGrigliataLiveInteraction({ interaction });

          if (!ping || (pingAnimationClock - ping.startedAtMs) >= MAP_PING_VISIBLE_MS) {
            return null;
          }

          return {
            kind: 'ping',
            ownerUid: interaction.ownerUid,
            drawTheme: getGrigliataDrawTheme(interaction.colorKey),
            ping,
          };
        }

        if (interaction.type === 'measure') {
          const measurement = buildMeasurementFromGrigliataLiveInteraction({
            interaction,
            grid: normalizedGrid,
          });

          if (!measurement) {
            return null;
          }

          return {
            kind: 'measure',
            ownerUid: interaction.ownerUid,
            drawTheme: getGrigliataDrawTheme(interaction.colorKey),
            measurement,
          };
        }

        if (interaction.type === 'aoe') {
          const figure = buildAoEFigureFromGrigliataLiveInteraction({
            interaction,
            grid: normalizedGrid,
          });

          if (!figure) {
            return null;
          }

          return {
            kind: 'aoe',
            ownerUid: interaction.ownerUid,
            drawTheme: getGrigliataDrawTheme(interaction.colorKey),
            figure,
          };
        }

        return null;
      })
      .filter(Boolean),
    [currentUserId, normalizedGrid, pingAnimationClock, sharedInteractions]
  );
  const visibleLocalPings = useMemo(
    () => localPings.filter((ping) => (pingAnimationClock - ping.startedAtMs) < MAP_PING_VISIBLE_MS),
    [localPings, pingAnimationClock]
  );
  const hasVisibleRemotePing = useMemo(
    () => renderedSharedInteractions.some((interaction) => interaction.kind === 'ping'),
    [renderedSharedInteractions]
  );

  const clearActiveSharedInteraction = useCallback(() => {
    setActiveSharedInteraction(null);
  }, []);

  const updateActiveSharedInteraction = useCallback((draft) => {
    setActiveSharedInteraction(normalizeGrigliataLiveInteractionDraft(draft));
  }, []);

  const clearPingHoldTimer = useCallback(() => {
    if (pingHoldTimeoutRef.current) {
      window.clearTimeout(pingHoldTimeoutRef.current);
      pingHoldTimeoutRef.current = null;
    }
  }, []);

  const clearPingBroadcastTimer = useCallback(() => {
    if (pingBroadcastClearTimeoutRef.current) {
      window.clearTimeout(pingBroadcastClearTimeoutRef.current);
      pingBroadcastClearTimeoutRef.current = null;
    }
  }, []);

  const spawnMapPing = useCallback((point, { broadcast = false } = {}) => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      return;
    }

    const startedAtMs = Date.now();
    const nextLocalPingId = nextLocalPingIdRef.current + 1;
    nextLocalPingIdRef.current = nextLocalPingId;
    setPingAnimationClock(startedAtMs);
    setLocalPings((currentPings) => ([
      ...currentPings.filter((ping) => (startedAtMs - ping.startedAtMs) < MAP_PING_VISIBLE_MS),
      {
        id: `local-ping-${nextLocalPingId}-${startedAtMs}`,
        point: {
          x: point.x,
          y: point.y,
        },
        startedAtMs,
        colorKey: resolvedDrawTheme.key,
      },
    ]));

    if (!broadcast) {
      return;
    }

    updateActiveSharedInteraction({
      type: 'ping',
      source: 'free',
      point: {
        x: point.x,
        y: point.y,
      },
      startedAtMs,
    });

    clearPingBroadcastTimer();
    pingBroadcastClearTimeoutRef.current = window.setTimeout(() => {
      pingBroadcastClearTimeoutRef.current = null;
      setActiveSharedInteraction((currentInteraction) => (
        currentInteraction?.type === 'ping' && currentInteraction.startedAtMs === startedAtMs
          ? null
          : currentInteraction
      ));
    }, MAP_PING_BROADCAST_CLEAR_MS);
  }, [clearPingBroadcastTimer, resolvedDrawTheme.key, updateActiveSharedInteraction]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    let isActive = true;

    const updateSize = () => {
      if (!isActive) return;
      const { width, height } = element.getBoundingClientRect();
      setStageSize({
        width: Math.max(0, Math.floor(width)),
        height: Math.max(0, Math.floor(height)),
      });
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateSize);
      observer.observe(element);
      return () => {
        isActive = false;
        observer.disconnect();
      };
    }

    window.addEventListener('resize', updateSize);
    return () => {
      isActive = false;
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  const fitKey = resolvedBackground?.id || '__no_active_background__';

  const fitToBoard = useCallback(() => {
    if (!stageSize.width || !stageSize.height) return;
    setViewport(fitViewportToBounds(boardBounds, stageSize.width, stageSize.height, BOARD_FIT_PADDING));
    lastFitKeyRef.current = fitKey;
  }, [boardBounds, fitKey, stageSize.height, stageSize.width]);

  useEffect(() => {
    if (!stageSize.width || !stageSize.height) return;
    if (lastFitKeyRef.current === fitKey) return;
    fitToBoard();
  }, [fitKey, fitToBoard, stageSize.width, stageSize.height]);

  useEffect(() => {
    interactionRef.current = null;
    clearPingHoldTimer();
    clearPingBroadcastTimer();
    setSelectedTokenIds([]);
    setSelectionBox(null);
    setTokenDragState(null);
    setMeasurementState(null);
    setAoEPreviewState(null);
    setSelectedAoEFigureId('');
    setAoEFigureDragState(null);
    setLocalPings([]);
    setPingAnimationClock(Date.now());
    clearActiveSharedInteraction();
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
  }, [clearActiveSharedInteraction, clearPingBroadcastTimer, clearPingHoldTimer, fitKey]);

  useEffect(() => {
    if (!isNarrationOverlayActive) {
      return;
    }

    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setSelectedTokenIds([]);
    setSelectedAoEFigureId('');
    clearActiveSharedInteraction();
  }, [clearActiveSharedInteraction, isNarrationOverlayActive]);

  useEffect(() => {
    if (!isRulerEnabled) {
      setMeasurementState(null);
    }
    if (!activeAoeFigureType) {
      setAoEPreviewState(null);
    }
    if (!isRulerEnabled && !activeAoeFigureType) {
      clearActiveSharedInteraction();
    }
  }, [activeAoeFigureType, clearActiveSharedInteraction, isRulerEnabled]);

  useEffect(() => {
    if (visibleLocalPings.length === localPings.length) {
      return;
    }

    setLocalPings(visibleLocalPings);
  }, [localPings.length, visibleLocalPings]);

  useEffect(() => {
    if (!visibleLocalPings.length && !hasVisibleRemotePing) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setPingAnimationClock(Date.now());
    }, MAP_PING_ANIMATION_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [hasVisibleRemotePing, visibleLocalPings.length]);

  useEffect(() => (
    () => {
      clearPingHoldTimer();
      clearPingBroadcastTimer();
    }
  ), [clearPingBroadcastTimer, clearPingHoldTimer]);

  useEffect(() => {
    writeStoredTurnOrderCollapsed(currentUserId, isTurnOrderPanelCollapsed);
  }, [currentUserId, isTurnOrderPanelCollapsed]);

  useEffect(() => {
    if (!turnOrderContextMenu) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (turnOrderContextMenuRef.current?.contains(event.target)) return;
      setTurnOrderContextMenu(null);
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setTurnOrderContextMenu(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [turnOrderContextMenu]);

  useEffect(() => {
    if (!turnOrderJoinPrompt) {
      return undefined;
    }

    const focusHandle = window.requestAnimationFrame(() => {
      turnOrderJoinInputRef.current?.focus();
      turnOrderJoinInputRef.current?.select();
    });

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setTurnOrderJoinPrompt(null);
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusHandle);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [turnOrderJoinPrompt]);

  useEffect(() => {
    onSharedInteractionChange?.(activeSharedInteraction);
  }, [activeSharedInteraction, onSharedInteractionChange]);

  useEffect(() => (
    () => {
      onSharedInteractionChange?.(null);
    }
  ), [onSharedInteractionChange]);

  useEffect(() => {
    setSelectedTokenIds((currentSelectedTokenIds) => {
      const nextSelectedTokenIds = currentSelectedTokenIds.filter((tokenId) => movableTokenIds.has(tokenId));
      return areStringArraysEqual(currentSelectedTokenIds, nextSelectedTokenIds)
        ? currentSelectedTokenIds
        : nextSelectedTokenIds;
    });
  }, [movableTokenIds]);

  useEffect(() => {
    if (!selectedAoEFigureId) return;

    const selectedFigure = figureItemsById.get(selectedAoEFigureId);
    if (!selectedFigure || !selectedFigure.canEdit) {
      setSelectedAoEFigureId('');
    }
  }, [figureItemsById, selectedAoEFigureId]);

  useEffect(() => {
    const tokenIdsWithOverflow = new Set(
      renderedTokens
        .filter((token) => (tokenStatusDisplayById.get(token.tokenId)?.overflowCount || 0) > 0)
        .map((token) => token.tokenId)
    );

    setHoveredOverflowTokenId((currentTokenId) => (
      tokenIdsWithOverflow.has(currentTokenId) ? currentTokenId : ''
    ));
    setPinnedOverflowTokenId((currentTokenId) => (
      tokenIdsWithOverflow.has(currentTokenId) ? currentTokenId : ''
    ));
  }, [renderedTokens, tokenStatusDisplayById]);

  useEffect(() => {
    if (!selectionBox && !tokenDragState && !isTokenDragActive) return;
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
  }, [isTokenDragActive, selectionBox, tokenDragState]);

  const getWorldPointFromClient = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewport.x) / viewport.scale,
      y: (clientY - rect.top - viewport.y) / viewport.scale,
    };
  }, [viewport.x, viewport.y, viewport.scale]);

  const buildMeasurementForCells = useCallback((anchorCells, liveEndCell) => (
    buildGridMeasurementPath({
      anchorCells,
      liveEndCell,
      grid: normalizedGrid,
    })
  ), [normalizedGrid]);

  const buildAoEFigureForDraft = useCallback((draft) => (
    buildRenderableGrigliataAoEFigure({
      figure: draft,
      grid: normalizedGrid,
    })
  ), [normalizedGrid]);

  const getDraggedTokenMeasurement = useCallback((interaction, pointerWorld) => {
    if (!pointerWorld) return null;

    const draggedOriginToken = interaction?.originTokens?.find(
      (originToken) => originToken.tokenId === interaction?.draggedTokenId
    );
    if (!draggedOriginToken) return null;

    const deltaWorld = {
      x: pointerWorld.x - interaction.startWorld.x,
      y: pointerWorld.y - interaction.startWorld.y,
    };
    const liveEndCell = snapBoardPointToGrid({
      x: draggedOriginToken.x + deltaWorld.x,
      y: draggedOriginToken.y + deltaWorld.y,
    }, normalizedGrid, 'top-left');

    return {
      draggedOriginToken,
      deltaWorld,
      liveEndCell,
    };
  }, [normalizedGrid]);

  const getDraggedAoEFigureDraft = useCallback((interaction, pointerWorld) => {
    if (!pointerWorld || !interaction?.originFigure || !interaction?.startWorld) {
      return null;
    }

    const startCell = snapBoardPointToGrid(interaction.startWorld, normalizedGrid, 'center');
    const pointerCell = snapBoardPointToGrid(pointerWorld, normalizedGrid, 'center');
    const colDelta = pointerCell.col - startCell.col;
    const rowDelta = pointerCell.row - startCell.row;
    const draft = shiftGrigliataAoEFigureCells(interaction.originFigure, colDelta, rowDelta);

    if (!draft) {
      return null;
    }

    return {
      colDelta,
      rowDelta,
      draft,
    };
  }, [normalizedGrid]);

  const syncSharedMeasureInteraction = useCallback((interaction, liveEndCell) => {
    if (!Array.isArray(interaction?.anchorCells) || !interaction.anchorCells.length || !liveEndCell) {
      clearActiveSharedInteraction();
      return;
    }

    updateActiveSharedInteraction({
      type: 'measure',
      source: interaction.measurementSource === 'token-drag' ? 'token-drag' : 'free',
      anchorCells: interaction.anchorCells.map((cell) => ({
        col: cell.col,
        row: cell.row,
      })),
      liveEndCell: {
        col: liveEndCell.col,
        row: liveEndCell.row,
      },
    });
  }, [clearActiveSharedInteraction, updateActiveSharedInteraction]);

  const syncSharedAoEInteraction = useCallback((draft, source = 'aoe-create') => {
    const normalizedDraft = normalizeGrigliataAoEFigureDraft(draft);
    if (!normalizedDraft) {
      clearActiveSharedInteraction();
      return;
    }

    updateActiveSharedInteraction({
      type: 'aoe',
      source,
      figureType: normalizedDraft.figureType,
      originCell: normalizedDraft.originCell,
      targetCell: normalizedDraft.targetCell,
    });
  }, [clearActiveSharedInteraction, updateActiveSharedInteraction]);

  const commitMeasurementWaypoint = useCallback((clientX, clientY) => {
    const activeInteraction = interactionRef.current;
    if (!isWaypointEligibleInteraction(activeInteraction)) return false;

    const pointerWorld = getWorldPointFromClient(clientX, clientY);
    if (!pointerWorld) return true;

    let liveEndCell = null;

    if (activeInteraction.type === 'token-drag') {
      const dragMeasurement = getDraggedTokenMeasurement(activeInteraction, pointerWorld);
      if (!dragMeasurement) return true;

      liveEndCell = dragMeasurement.liveEndCell;
      setTokenDragState({
        draggedTokenId: activeInteraction.draggedTokenId,
        tokenIds: activeInteraction.selectedIds,
        originTokens: activeInteraction.originTokens,
        deltaWorld: dragMeasurement.deltaWorld,
      });
    } else {
      liveEndCell = snapBoardPointToGrid(pointerWorld, normalizedGrid, 'center');
    }

    const lastAnchorCell = activeInteraction.anchorCells[activeInteraction.anchorCells.length - 1];
    if (isSameGridCell(lastAnchorCell, liveEndCell)) {
      setMeasurementState(buildMeasurementForCells(activeInteraction.anchorCells, liveEndCell));
      syncSharedMeasureInteraction(activeInteraction, liveEndCell);
      return true;
    }

    const nextAnchorCells = [...activeInteraction.anchorCells, {
      col: liveEndCell.col,
      row: liveEndCell.row,
    }];

    interactionRef.current = {
      ...activeInteraction,
      anchorCells: nextAnchorCells,
    };
    setMeasurementState(buildMeasurementForCells(nextAnchorCells, liveEndCell));
    syncSharedMeasureInteraction({
      ...activeInteraction,
      anchorCells: nextAnchorCells,
    }, liveEndCell);
    return true;
  }, [
    buildMeasurementForCells,
    getDraggedTokenMeasurement,
    getWorldPointFromClient,
    normalizedGrid,
    syncSharedMeasureInteraction,
  ]);

  const applyScale = (nextScale, pointer) => {
    const safeScale = Math.min(4, Math.max(0.2, nextScale));
    const referencePoint = pointer || {
      x: stageSize.width / 2,
      y: stageSize.height / 2,
    };

    setViewport((currentViewport) => {
      const worldPoint = {
        x: (referencePoint.x - currentViewport.x) / currentViewport.scale,
        y: (referencePoint.y - currentViewport.y) / currentViewport.scale,
      };

      return {
        scale: safeScale,
        x: referencePoint.x - (worldPoint.x * safeScale),
        y: referencePoint.y - (worldPoint.y * safeScale),
      };
    });
  };

  const handleWheel = (event) => {
    event.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    const scaleBy = 1.08 ** 3;
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const nextScale = direction > 0 ? viewport.scale * scaleBy : viewport.scale / scaleBy;
    applyScale(nextScale, pointer);
  };

  const parseDropPayload = (dataTransfer) => {
    const candidates = [
      dataTransfer.getData(TRAY_DRAG_MIME),
      dataTransfer.getData('text/plain'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed?.type === 'grigliata-token') {
          const tokenId = typeof parsed?.tokenId === 'string' && parsed.tokenId
            ? parsed.tokenId
            : typeof parsed?.uid === 'string' && parsed.uid
              ? parsed.uid
              : '';
          const ownerUid = typeof parsed?.ownerUid === 'string' && parsed.ownerUid
            ? parsed.ownerUid
            : typeof parsed?.uid === 'string' && parsed.uid
              ? parsed.uid
              : '';

          if (tokenId && ownerUid) {
            return {
              ...parsed,
              tokenId,
              ownerUid,
            };
          }
        }

        if (parsed?.type === FOE_LIBRARY_DRAG_TYPE) {
          const foeId = typeof parsed?.foeId === 'string' && parsed.foeId
            ? parsed.foeId
            : '';
          const ownerUid = typeof parsed?.ownerUid === 'string' && parsed.ownerUid
            ? parsed.ownerUid
            : typeof parsed?.uid === 'string' && parsed.uid
              ? parsed.uid
              : '';

          if (foeId && ownerUid) {
            return {
              ...parsed,
              foeId,
              ownerUid,
            };
          }
        }
      } catch {
        // ignore malformed payloads
      }
    }

    return null;
  };

  const getDropEffectForType = (dragType) => (
    dragType === FOE_LIBRARY_DRAG_TYPE ? 'copy' : 'move'
  );

  const handleDrop = (event) => {
    if (isNarrationOverlayActive) {
      event.preventDefault();
      event.stopPropagation();
      setIsDropActive(false);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(false);

    const payload = parseDropPayload(event.dataTransfer);
    const dragType = payload?.type || activeTrayDragType;
    const canAcceptCurrentTrayDrop = !!(dragType && currentUserId);
    if (!containerRef.current) return;
    if (!canAcceptCurrentTrayDrop && (!payload || payload.ownerUid !== currentUserId)) return;

    const worldPoint = getWorldPointFromClient(event.clientX, event.clientY);
    if (!worldPoint) return;

    onDropCurrentToken?.(payload, worldPoint);
  };

  const handleDragOver = (event) => {
    if (isNarrationOverlayActive) {
      return;
    }

    const payload = parseDropPayload(event.dataTransfer);
    const dragType = payload?.type || activeTrayDragType;
    const canAcceptCurrentTrayDrop = !!(dragType && currentUserId);
    if (!canAcceptCurrentTrayDrop && (!payload || payload.ownerUid !== currentUserId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = getDropEffectForType(dragType);
    setIsDropActive(true);
  };

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDropActive(false);
  };

  const finalizeInteraction = useCallback(async ({ clientX = null, clientY = null } = {}) => {
    const activeInteraction = interactionRef.current;
    if (!activeInteraction) return;

    clearPingHoldTimer();
    interactionRef.current = null;

    const pointerWorld = (
      Number.isFinite(clientX) && Number.isFinite(clientY)
        ? getWorldPointFromClient(clientX, clientY)
        : null
    );

    if (activeInteraction.type === 'selection-candidate') {
      setSelectionBox(null);
      setSelectedTokenIds([]);
      setSelectedAoEFigureId('');
      clearActiveSharedInteraction();
      return;
    }

    if (isPingHoldInteraction(activeInteraction)) {
      return;
    }

    if (activeInteraction.type === 'measure-candidate') {
      setMeasurementState(null);
      clearActiveSharedInteraction();
      return;
    }

    if (isAoECreateInteraction(activeInteraction)) {
      let didCreateFigure = false;
      try {
        didCreateFigure = !!(await Promise.resolve(onCreateAoEFigure?.(activeInteraction.draft)));
      } finally {
        setAoEPreviewState(null);
        clearActiveSharedInteraction();
      }

      if (didCreateFigure) {
        onSelectMouseTool?.();
      }
      return;
    }

    if (activeInteraction.type === 'selection-box') {
      const finalSelectionBox = pointerWorld
        ? { start: activeInteraction.startWorld, end: pointerWorld }
        : selectionBox;
      const normalizedSelectionRect = normalizeSelectionRect(finalSelectionBox);

      if (!normalizedSelectionRect) {
        setSelectedTokenIds([]);
        setSelectionBox(null);
        clearActiveSharedInteraction();
        return;
      }

      const nextSelectedTokenIds = tokenItems
        .filter((token) => token.canMove)
        .filter((token) => rectsIntersect(normalizedSelectionRect, {
          x: token.position.x,
          y: token.position.y,
          width: token.position.size,
          height: token.position.size,
        }))
        .map((token) => token.tokenId);

      setSelectedTokenIds(nextSelectedTokenIds);
      setSelectedAoEFigureId('');
      setSelectionBox(null);
      clearActiveSharedInteraction();
      return;
    }

    if (activeInteraction.type === 'measure') {
      setMeasurementState(null);
      clearActiveSharedInteraction();
      return;
    }

    if (activeInteraction.type === 'pan') {
      return;
    }

    if (isAoEDragInteraction(activeInteraction)) {
      if (activeInteraction.type === 'aoe-drag-candidate') {
        setAoEFigureDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      const dragDraft = pointerWorld
        ? getDraggedAoEFigureDraft(activeInteraction, pointerWorld)
        : null;
      const nextDraft = dragDraft?.draft || aoeFigureDragState?.draft || activeInteraction.originFigure;
      const normalizedDraft = normalizeGrigliataAoEFigureDraft(nextDraft);
      const originDraft = normalizeGrigliataAoEFigureDraft(activeInteraction.originFigure);
      const hasMoved = !!(
        normalizedDraft
        && originDraft
        && (
          normalizedDraft.originCell.col !== originDraft.originCell.col
          || normalizedDraft.originCell.row !== originDraft.originCell.row
          || normalizedDraft.targetCell.col !== originDraft.targetCell.col
          || normalizedDraft.targetCell.row !== originDraft.targetCell.row
        )
      );

      try {
        if (hasMoved && activeInteraction.figureId && normalizedDraft) {
          await Promise.resolve(onMoveAoEFigure?.(activeInteraction.figureId, normalizedDraft));
        }
      } finally {
        setAoEFigureDragState(null);
        clearActiveSharedInteraction();
      }
      return;
    }

    if (activeInteraction.type === 'token-candidate') {
      clearActiveSharedInteraction();
      return;
    }

    if (activeInteraction.type === 'token-drag') {
      const currentDragState = tokenDragState;
      const dragMeasurement = pointerWorld
        ? getDraggedTokenMeasurement(activeInteraction, pointerWorld)
        : null;
      const dragDeltaWorld = dragMeasurement?.deltaWorld || currentDragState?.deltaWorld || { x: 0, y: 0 };
      const draggedOriginToken = dragMeasurement?.draggedOriginToken || activeInteraction.originTokens.find(
        (originToken) => originToken.tokenId === activeInteraction.draggedTokenId
      );

      if (!draggedOriginToken) {
        setTokenDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      const snappedDraggedPosition = dragMeasurement?.liveEndCell || snapBoardPointToGrid({
        x: draggedOriginToken.x + dragDeltaWorld.x,
        y: draggedOriginToken.y + dragDeltaWorld.y,
      }, normalizedGrid, 'top-left');

      const colDelta = snappedDraggedPosition.col - draggedOriginToken.col;
      const rowDelta = snappedDraggedPosition.row - draggedOriginToken.row;

      try {
        if ((colDelta !== 0 || rowDelta !== 0) && activeInteraction.originTokens.length > 0) {
          await Promise.resolve(onMoveTokens?.(
            activeInteraction.originTokens.map((originToken) => ({
              tokenId: originToken.tokenId,
              ownerUid: originToken.ownerUid,
              backgroundId: originToken.backgroundId,
              col: originToken.col + colDelta,
              row: originToken.row + rowDelta,
              sizeSquares: originToken.sizeSquares,
              isVisibleToPlayers: originToken.isVisibleToPlayers,
              isDead: originToken.isDead,
              statuses: originToken.statuses,
            }))
          ));
        }
      } finally {
        setTokenDragState(null);
        setMeasurementState(null);
        clearActiveSharedInteraction();
      }
    }
  }, [
    aoeFigureDragState,
    clearActiveSharedInteraction,
    getDraggedAoEFigureDraft,
    getDraggedTokenMeasurement,
    getWorldPointFromClient,
    normalizedGrid,
    onCreateAoEFigure,
    onMoveAoEFigure,
    onMoveTokens,
    selectionBox,
    tokenDragState,
    tokenItems,
    clearPingHoldTimer,
  ]);

  useEffect(() => {
    const handleWindowMouseMove = (event) => {
      const activeInteraction = interactionRef.current;
      if (!activeInteraction) return;

      if (activeInteraction.type === 'pan') {
        setViewport({
          ...activeInteraction.startViewport,
          x: activeInteraction.startViewport.x + (event.clientX - activeInteraction.startClient.x),
          y: activeInteraction.startViewport.y + (event.clientY - activeInteraction.startClient.y),
        });
        return;
      }

      if (isPingHoldInteraction(activeInteraction)) {
        return;
      }

      const pointerWorld = getWorldPointFromClient(event.clientX, event.clientY);
      if (!pointerWorld) return;

      const hasMovedBeyondThreshold = (
        Math.abs(event.clientX - activeInteraction.startClient.x) >= POINTER_DRAG_THRESHOLD_PX
        || Math.abs(event.clientY - activeInteraction.startClient.y) >= POINTER_DRAG_THRESHOLD_PX
      );

      if (activeInteraction.type === 'selection-candidate') {
        if (!hasMovedBeyondThreshold) return;

        clearPingHoldTimer();

        if (isRulerEnabled) {
          const nextInteraction = {
            ...activeInteraction,
            type: 'measure',
            anchorCells: [
              snapBoardPointToGrid(activeInteraction.startWorld, normalizedGrid, 'center'),
            ],
            measurementSource: 'free',
          };
          const liveEndCell = snapBoardPointToGrid(pointerWorld, normalizedGrid, 'center');
          interactionRef.current = nextInteraction;
          setMeasurementState(buildMeasurementForCells(
            nextInteraction.anchorCells,
            liveEndCell
          ));
          syncSharedMeasureInteraction(nextInteraction, liveEndCell);
          return;
        }

        interactionRef.current = {
          ...activeInteraction,
          type: 'selection-box',
        };
        setSelectionBox({
          start: activeInteraction.startWorld,
          end: pointerWorld,
        });
        clearActiveSharedInteraction();
        return;
      }

      if (activeInteraction.type === 'measure-candidate') {
        if (!hasMovedBeyondThreshold) return;

        const nextInteraction = {
          ...activeInteraction,
          type: 'measure',
          anchorCells: activeInteraction.anchorCells || [
            snapBoardPointToGrid(activeInteraction.startWorld, normalizedGrid, 'center'),
          ],
        };
        const liveEndCell = snapBoardPointToGrid(pointerWorld, normalizedGrid, 'center');
        interactionRef.current = nextInteraction;
        setMeasurementState(buildMeasurementForCells(
          nextInteraction.anchorCells,
          liveEndCell
        ));
        syncSharedMeasureInteraction(nextInteraction, liveEndCell);
        return;
      }

      if (isAoECreateInteraction(activeInteraction)) {
        const liveCell = snapBoardPointToGrid(pointerWorld, normalizedGrid, 'center');
        const nextDraft = {
          ...activeInteraction.draft,
          targetCell: {
            col: liveCell.col,
            row: liveCell.row,
          },
        };

        interactionRef.current = {
          ...activeInteraction,
          draft: nextDraft,
        };
        setAoEPreviewState(buildAoEFigureForDraft(nextDraft));
        syncSharedAoEInteraction(nextDraft, activeInteraction.source || 'aoe-create');
        return;
      }

      if (activeInteraction.type === 'selection-box') {
        setSelectionBox({
          start: activeInteraction.startWorld,
          end: pointerWorld,
        });
        clearActiveSharedInteraction();
        return;
      }

      if (activeInteraction.type === 'measure') {
        const liveEndCell = snapBoardPointToGrid(pointerWorld, normalizedGrid, 'center');
        setMeasurementState(buildMeasurementForCells(
          activeInteraction.anchorCells,
          liveEndCell
        ));
        syncSharedMeasureInteraction(activeInteraction, liveEndCell);
        return;
      }

      if (isAoEDragInteraction(activeInteraction)) {
        if (activeInteraction.type === 'aoe-drag-candidate' && !hasMovedBeyondThreshold) return;

        const dragDraft = getDraggedAoEFigureDraft(activeInteraction, pointerWorld);
        if (!dragDraft) return;

        if (activeInteraction.type === 'aoe-drag-candidate') {
          interactionRef.current = {
            ...activeInteraction,
            type: 'aoe-drag',
          };
        }

        setAoEFigureDragState({
          figureId: activeInteraction.figureId,
          draft: dragDraft.draft,
        });
        syncSharedAoEInteraction(dragDraft.draft, 'aoe-move');
        return;
      }

      let currentInteraction = activeInteraction;

      if (activeInteraction.type === 'token-candidate') {
        if (!hasMovedBeyondThreshold) return;

        const nextInteraction = {
          ...activeInteraction,
          type: 'token-drag',
          anchorCells: isRulerEnabled
            ? [{
              col: activeInteraction.originTokens.find(
                (originToken) => originToken.tokenId === activeInteraction.draggedTokenId
              )?.col ?? 0,
              row: activeInteraction.originTokens.find(
                (originToken) => originToken.tokenId === activeInteraction.draggedTokenId
              )?.row ?? 0,
            }]
            : null,
          measurementSource: isRulerEnabled ? 'token-drag' : null,
        };
        interactionRef.current = nextInteraction;
        currentInteraction = nextInteraction;
      }

      if (currentInteraction?.type === 'token-drag') {
        const dragMeasurement = getDraggedTokenMeasurement(currentInteraction, pointerWorld);
        if (!dragMeasurement) return;

        setTokenDragState({
          draggedTokenId: currentInteraction.draggedTokenId,
          tokenIds: currentInteraction.selectedIds,
          originTokens: currentInteraction.originTokens,
          deltaWorld: dragMeasurement.deltaWorld,
        });

        if (isRulerEnabled && Array.isArray(currentInteraction.anchorCells)) {
          setMeasurementState(buildMeasurementForCells(
            currentInteraction.anchorCells,
            dragMeasurement.liveEndCell
          ));
          syncSharedMeasureInteraction(currentInteraction, dragMeasurement.liveEndCell);
        } else {
          clearActiveSharedInteraction();
        }
      }
    };

    const handleWindowMouseUp = (event) => {
      const activeInteraction = interactionRef.current;
      if (!activeInteraction) return;

      if (activeInteraction.type === 'pan') {
        if (!isSecondaryMouseButton(event)) return;
      } else if (!isPrimaryMouseButton(event)) {
        return;
      }

      void finalizeInteraction({
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };

    const handleWindowBlur = () => {
      void finalizeInteraction();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    activeAoeFigureType,
    buildAoEFigureForDraft,
    buildMeasurementForCells,
    getDraggedAoEFigureDraft,
    clearActiveSharedInteraction,
    syncSharedAoEInteraction,
    finalizeInteraction,
    getDraggedTokenMeasurement,
    getWorldPointFromClient,
    isRulerEnabled,
    normalizedGrid,
    syncSharedMeasureInteraction,
    clearPingHoldTimer,
  ]);

  useEffect(() => {
    const handleKeyDown = async (event) => {
      if (isEditableElementFocused()) return;

      if (event.key !== 'Delete' && event.code !== 'Delete') return;

      if (!selectedAoEFigureId && !selectedTokenIds.length) return;

      event.preventDefault();

      if (selectedAoEFigureId) {
        try {
          await Promise.resolve(onDeleteAoEFigures?.([selectedAoEFigureId]));
          setSelectedAoEFigureId('');
        } catch {
          // preserve selection if deletion fails
        }
        return;
      }

      if (selectedTokenIds.length) {
        try {
          await Promise.resolve(onDeleteTokens?.(selectedTokenIds));
          setSelectedTokenIds([]);
        } catch {
          // preserve selection if deletion fails
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDeleteAoEFigures, onDeleteTokens, selectedAoEFigureId, selectedTokenIds]);

  const openTurnOrderContextMenu = useCallback((token, nativeEvent) => {
    if (!token?.tokenId || !token?.canMove) {
      setTurnOrderContextMenu(null);
      return false;
    }

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) {
      return false;
    }

    nativeEvent?.preventDefault?.();
    setTurnOrderJoinPrompt(null);
    setTurnOrderContextMenu({
      tokenId: token.tokenId,
      left: clampToRange(
        (nativeEvent?.clientX || containerRect.left) - containerRect.left,
        12,
        Math.max(12, containerRect.width - 196)
      ),
      top: clampToRange(
        (nativeEvent?.clientY || containerRect.top) - containerRect.top,
        12,
        Math.max(12, containerRect.height - 72)
      ),
    });
    return true;
  }, []);

  const handleStageMouseDown = (event) => {
    if (isTokenDragActive) return;
    if (event.target !== stageRef.current) return;

    const nativeEvent = event.evt;
    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');

    if (isSecondaryMouseButton(nativeEvent)) {
      clearPingHoldTimer();
      nativeEvent.preventDefault();
      if (isNarrationOverlayActive) {
        interactionRef.current = {
          type: 'pan',
          startClient: {
            x: nativeEvent.clientX,
            y: nativeEvent.clientY,
          },
          startViewport: viewport,
        };
        return;
      }
      if (hasPrimaryMouseButtonPressed(nativeEvent) && commitMeasurementWaypoint(nativeEvent.clientX, nativeEvent.clientY)) {
        return;
      }
      if (
        hasPrimaryMouseButtonPressed(nativeEvent)
        && (interactionRef.current?.type === 'measure-candidate' || interactionRef.current?.type === 'token-candidate')
      ) {
        return;
      }
      interactionRef.current = {
        type: 'pan',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startViewport: viewport,
      };
      return;
    }

    if (isNarrationOverlayActive || !isPrimaryMouseButton(nativeEvent)) return;

    const pointerWorld = getWorldPointFromClient(nativeEvent.clientX, nativeEvent.clientY);
    if (!pointerWorld) return;

    clearPingHoldTimer();

    setMeasurementState(null);
    setAoEPreviewState(null);
    setSelectedAoEFigureId('');
    clearActiveSharedInteraction();

    if (activeAoeFigureType) {
      setSelectedTokenIds([]);
      setSelectionBox(null);
      const startCell = snapBoardPointToGrid(pointerWorld, normalizedGrid, 'center');
      const draft = {
        figureType: activeAoeFigureType,
        originCell: {
          col: startCell.col,
          row: startCell.row,
        },
        targetCell: {
          col: startCell.col,
          row: startCell.row,
        },
      };
      interactionRef.current = {
        type: 'aoe-create',
        source: 'aoe-create',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startWorld: pointerWorld,
        draft,
      };
      setAoEPreviewState(buildAoEFigureForDraft(draft));
      syncSharedAoEInteraction(draft, 'aoe-create');
      return;
    }

    if (isRulerEnabled) {
      setSelectedTokenIds([]);
      setSelectionBox(null);
      const startCell = snapBoardPointToGrid(pointerWorld, normalizedGrid, 'center');
      interactionRef.current = {
        type: 'measure-candidate',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startWorld: pointerWorld,
        anchorCells: [startCell],
        measurementSource: 'free',
      };
      return;
    }

    interactionRef.current = {
      type: 'selection-candidate',
      startClient: {
        x: nativeEvent.clientX,
        y: nativeEvent.clientY,
      },
      startWorld: pointerWorld,
      canTriggerPing: isPointWithinBounds(pointerWorld, boardBounds),
    };

    if (!isPointWithinBounds(pointerWorld, boardBounds)) {
      return;
    }

    pingHoldTimeoutRef.current = window.setTimeout(() => {
      pingHoldTimeoutRef.current = null;
      const activeInteraction = interactionRef.current;
      if (activeInteraction?.type !== 'selection-candidate' || !activeInteraction.canTriggerPing) {
        return;
      }

      spawnMapPing(activeInteraction.startWorld, { broadcast: true });
      interactionRef.current = {
        ...activeInteraction,
        type: 'ping-hold',
      };
    }, MAP_PING_HOLD_DELAY_MS);
  };

  const handleTokenMouseDown = (token, event) => {
    const nativeEvent = event.evt;
    event.cancelBubble = true;
    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
    clearPingHoldTimer();

    if (activeAoeFigureType) {
      return;
    }

    if (isSecondaryMouseButton(nativeEvent)) {
      if (openTurnOrderContextMenu(token, nativeEvent)) {
        return;
      }

      nativeEvent.preventDefault();
      if (hasPrimaryMouseButtonPressed(nativeEvent)) {
        commitMeasurementWaypoint(nativeEvent.clientX, nativeEvent.clientY);
      }
      return;
    }

    if (!isPrimaryMouseButton(nativeEvent)) return;

    setMeasurementState(null);
    setAoEPreviewState(null);
    setSelectedAoEFigureId('');
    clearActiveSharedInteraction();

    if (!token?.canMove) {
      setSelectedTokenIds([]);
      return;
    }

    const pointerWorld = getWorldPointFromClient(nativeEvent.clientX, nativeEvent.clientY);
    if (!pointerWorld) return;

    const nextSelectedTokenIds = selectedTokenIdSet.has(token.tokenId)
      ? selectedTokenIds
      : [token.tokenId];

    setSelectedTokenIds(nextSelectedTokenIds);

    interactionRef.current = {
      type: 'token-candidate',
      draggedTokenId: token.tokenId,
      selectedIds: nextSelectedTokenIds,
      startClient: {
        x: nativeEvent.clientX,
        y: nativeEvent.clientY,
      },
      startWorld: pointerWorld,
      originTokens: nextSelectedTokenIds
        .map((selectedTokenId) => tokenItemsById.get(selectedTokenId))
        .filter(Boolean)
        .map((selectedToken) => ({
          tokenId: selectedToken.tokenId,
          ownerUid: selectedToken.ownerUid,
          backgroundId: selectedToken.backgroundId,
          col: selectedToken.col,
          row: selectedToken.row,
          sizeSquares: selectedToken.sizeSquares,
          isVisibleToPlayers: selectedToken.isVisibleToPlayers,
          isDead: selectedToken.isDead,
          statuses: selectedToken.statuses,
          x: selectedToken.position.x,
          y: selectedToken.position.y,
          size: selectedToken.position.size,
      })),
    };
  };

  const handleTokenContextMenu = (token, event) => {
    event.cancelBubble = true;
    openTurnOrderContextMenu(token, event.evt);
  };

  const handleAoEFigureMouseDown = (figure, event) => {
    const nativeEvent = event.evt;
    event.cancelBubble = true;
    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
    clearPingHoldTimer();

    if (activeAoeFigureType || isRulerEnabled) {
      return;
    }

    if (!isPrimaryMouseButton(nativeEvent)) {
      return;
    }

    setMeasurementState(null);
    setAoEPreviewState(null);
    clearActiveSharedInteraction();
    setSelectedTokenIds([]);
    setSelectionBox(null);

    if (!figure?.canEdit) {
      setSelectedAoEFigureId('');
      return;
    }

    const pointerWorld = getWorldPointFromClient(nativeEvent.clientX, nativeEvent.clientY);
    if (!pointerWorld) return;

    setSelectedAoEFigureId(figure.id);

    interactionRef.current = {
      type: 'aoe-drag-candidate',
      figureId: figure.id,
      startClient: {
        x: nativeEvent.clientX,
        y: nativeEvent.clientY,
      },
      startWorld: pointerWorld,
      originFigure: {
        figureType: figure.figureType,
        originCell: figure.originCell,
        targetCell: figure.targetCell,
      },
    };
  };

  const normalizedSelectionRect = useMemo(
    () => normalizeSelectionRect(selectionBox),
    [selectionBox]
  );
  const selectedAoEFigure = useMemo(
    () => renderedAoEFigures.find((figure) => figure.id === selectedAoEFigureId) || null,
    [renderedAoEFigures, selectedAoEFigureId]
  );
  const selectedTokens = useMemo(
    () => renderedTokens.filter((token) => selectedTokenIdSet.has(token.tokenId)),
    [renderedTokens, selectedTokenIdSet]
  );
  useEffect(() => {
    const nextSelectedTokenIds = selectedTokens.map((token) => token.tokenId);
    if (areStringArraysEqual(lastReportedSelectedTokenIdsRef.current, nextSelectedTokenIds)) {
      return;
    }

    lastReportedSelectedTokenIdsRef.current = nextSelectedTokenIds;
    onSelectedTokenIdsChange?.(nextSelectedTokenIds);
  }, [onSelectedTokenIdsChange, selectedTokens]);
  const selectedTokenActionState = useMemo(() => {
    if (
      !selectedTokens.length
      || selectionBox
      || tokenDragState
      || isTokenDragActive
      || isRulerEnabled
      || !!activeAoeFigureType
      || !!selectedAoEFigureId
    ) {
      return null;
    }

    return buildSelectedTokenActionState({
      selectedTokens,
      isManager,
      stageSize,
      viewport,
    });
  }, [
    activeAoeFigureType,
    isManager,
    isTokenDragActive,
    isRulerEnabled,
    selectedAoEFigureId,
    selectedTokens,
    selectionBox,
    stageSize.height,
    stageSize.width,
    tokenDragState,
    viewport.scale,
    viewport.x,
    viewport.y,
  ]);
  const selectedSingleTokenHudState = useMemo(() => {
    if (
      !selectedTokenDetails
      || selectedTokenDetails.isReady === false
      || selectedTokens.length !== 1
      || selectionBox
      || tokenDragState
      || isTokenDragActive
      || isRulerEnabled
      || !!activeAoeFigureType
      || !!selectedAoEFigureId
    ) {
      return null;
    }

    const selectedToken = selectedTokens[0];
    if (!selectedToken || selectedToken.tokenId !== selectedTokenDetails.tokenId) {
      return null;
    }

    const chipCount = selectedTokenDetails.hasShield ? 3 : 2;
    const tokenScreenLeft = viewport.x + (selectedToken.renderPosition.x * viewport.scale);
    const tokenScreenTop = viewport.y + (selectedToken.renderPosition.y * viewport.scale);
    const tokenScreenSize = selectedToken.renderPosition.size * viewport.scale;
    const tokenScreenCenterX = tokenScreenLeft + (tokenScreenSize / 2);
    const obstacleRect = selectedTokenActionState
      ? {
        x: selectedTokenActionState.toolbarPosition.left,
        y: selectedTokenActionState.toolbarPosition.top,
        width: selectedTokenActionState.toolbarWidth,
        height: selectedTokenActionState.toolbarHeight,
      }
      : null;
    const resolveChipPlacement = (forceTwoRows = false) => {
      const chipLayout = buildSelectedTokenHudChipLayout({
        chipCount,
        tokenScreenSize,
        stageWidth: stageSize.width,
        forceTwoRows,
      });
      const chipTop = clampToRange(
        tokenScreenTop + tokenScreenSize + 12,
        TOKEN_HUD_EDGE_PADDING,
        Math.max(TOKEN_HUD_EDGE_PADDING, stageSize.height - chipLayout.height - TOKEN_HUD_EDGE_PADDING)
      );
      const chipLeftMin = TOKEN_HUD_EDGE_PADDING;
      const chipLeftMax = Math.max(chipLeftMin, stageSize.width - chipLayout.width - TOKEN_HUD_EDGE_PADDING);
      let chipLeft = clampToRange(
        tokenScreenCenterX - (chipLayout.width / 2),
        chipLeftMin,
        chipLeftMax
      );
      const chipRect = {
        x: chipLeft,
        y: chipTop,
        width: chipLayout.width,
        height: chipLayout.height,
      };

      if (obstacleRect && rectsIntersect(chipRect, obstacleRect)) {
        const shiftedLeft = obstacleRect.x - chipLayout.width - TOKEN_HUD_CHIP_COLLISION_GAP;
        if (shiftedLeft >= chipLeftMin) {
          chipLeft = shiftedLeft;
        } else if (!forceTwoRows && chipCount > 2) {
          return resolveChipPlacement(true);
        }
      }

      return {
        chipLeft: clampToRange(chipLeft, chipLeftMin, chipLeftMax),
        chipTop,
        chipWidth: chipLayout.width,
        chipHeight: chipLayout.height,
        chipColumns: chipLayout.columns,
      };
    };
    const chipPlacement = resolveChipPlacement();

    return {
      ...chipPlacement,
    };
  }, [
    activeAoeFigureType,
    isTokenDragActive,
    isRulerEnabled,
    selectedAoEFigureId,
    selectedTokenActionState,
    selectedTokenDetails,
    selectedTokens,
    selectionBox,
    stageSize.height,
    stageSize.width,
    tokenDragState,
    viewport.scale,
    viewport.x,
    viewport.y,
  ]);
  const selectedAoEFigureActionState = useMemo(() => {
    if (
      !selectedAoEFigure
      || aoeFigureDragState
      || isTokenDragActive
      || isRulerEnabled
      || !!activeAoeFigureType
      || selectionBox
      || tokenDragState
    ) {
      return null;
    }

    const figureBounds = selectedAoEFigure.renderable?.bounds;
    if (!figureBounds) {
      return null;
    }

    const screenWidth = figureBounds.width * viewport.scale;
    const referenceScreenSize = Math.max(
      figureBounds.width * viewport.scale,
      figureBounds.height * viewport.scale,
      36
    );
    const buttonSize = Math.max(36, Math.min(72, Math.round(referenceScreenSize * 0.28)));
    const gap = Math.max(14, Math.round(buttonSize * 0.22));
    const actionCount = 3;
    const toolbarInnerGap = Math.max(8, Math.round(buttonSize * 0.18));
    const toolbarWidth = buttonSize + 16;
    const toolbarHeight = (buttonSize * actionCount) + (toolbarInnerGap * (actionCount - 1)) + 16;
    const rawToolbarPosition = buildSelectionActionToolbarPosition({
      left: viewport.x + (figureBounds.minX * viewport.scale),
      top: viewport.y + (figureBounds.minY * viewport.scale),
      width: screenWidth,
      buttonSize,
      gap,
    });

    return {
      figureId: selectedAoEFigure.id,
      buttonSize,
      toolbarInnerGap,
      showMeasurementDetails: selectedAoEFigure.showMeasurementDetails !== false,
      isFilled: selectedAoEFigure.isFilled !== false,
      toolbarPosition: {
        left: Math.min(
          Math.max(12, rawToolbarPosition.left),
          Math.max(12, stageSize.width - toolbarWidth - 12)
        ),
        top: Math.min(
          Math.max(12, rawToolbarPosition.top),
          Math.max(12, stageSize.height - toolbarHeight - 12)
        ),
      },
    };
  }, [
    activeAoeFigureType,
    aoeFigureDragState,
    isRulerEnabled,
    isTokenDragActive,
    selectedAoEFigure,
    selectionBox,
    stageSize.height,
    stageSize.width,
    tokenDragState,
    viewport.scale,
    viewport.x,
    viewport.y,
  ]);
  const activeOverflowTokenId = pinnedOverflowTokenId || hoveredOverflowTokenId;
  const activeOverflowToken = useMemo(() => {
    if (!activeOverflowTokenId) {
      return null;
    }

    const token = renderedTokens.find((entry) => entry.tokenId === activeOverflowTokenId);
    const overflowCount = tokenStatusDisplayById.get(activeOverflowTokenId)?.overflowCount || 0;
    if (!token || overflowCount < 1) {
      return null;
    }

    return token;
  }, [activeOverflowTokenId, renderedTokens, tokenStatusDisplayById]);
  const activeOverflowCardStyle = useMemo(() => {
    if (!activeOverflowToken) {
      return null;
    }

    const screenSize = activeOverflowToken.renderPosition.size * viewport.scale;
    const maxCardWidth = Math.max(160, stageSize.width - 24);
    const cardWidth = Math.min(Math.max(220, Math.round(stageSize.width * 0.24)), maxCardWidth);
    const cardHeight = Math.min(
      Math.max(124, 56 + (activeOverflowToken.statuses.length * 42)),
      Math.max(124, stageSize.height - 24)
    );
    const preferredLeft = viewport.x + ((activeOverflowToken.renderPosition.x + activeOverflowToken.renderPosition.size) * viewport.scale) + 14;
    const fallbackLeft = viewport.x + (activeOverflowToken.renderPosition.x * viewport.scale) - cardWidth - 14;
    const preferredTop = viewport.y + (activeOverflowToken.renderPosition.y * viewport.scale) - 8;

    return {
      left: preferredLeft + cardWidth + 12 <= stageSize.width
        ? preferredLeft
        : clampToRange(fallbackLeft, 12, Math.max(12, stageSize.width - cardWidth - 12)),
      top: clampToRange(
        preferredTop,
        12,
        Math.max(12, stageSize.height - cardHeight - 12)
      ),
      width: cardWidth,
      minWidth: Math.min(cardWidth, Math.max(160, Math.round(screenSize * 2.2))),
    };
  }, [activeOverflowToken, stageSize.height, stageSize.width, viewport.scale, viewport.x, viewport.y]);
  const sortedTurnOrderEntries = useMemo(
    () => sortTurnOrderEntries(turnOrderEntries),
    [turnOrderEntries]
  );
  const areTurnOrderControlsDisabled = isNarrationOverlayActive;
  const visibleRenderedAoEFigures = isNarrationOverlayActive ? [] : renderedAoEFigures;
  const visibleRenderedTokens = isNarrationOverlayActive ? [] : renderedTokens;
  const visibleRenderedSharedInteractions = isNarrationOverlayActive ? [] : renderedSharedInteractions;
  const visibleLocalPingsForRender = isNarrationOverlayActive ? [] : visibleLocalPings;
  const visibleMeasurementState = isNarrationOverlayActive ? null : measurementState;
  const visibleAoEPreviewState = isNarrationOverlayActive ? null : aoePreviewState;
  const visibleSelectedTokenHud = isNarrationOverlayActive ? null : selectedSingleTokenHudState;
  const visibleOverflowToken = isNarrationOverlayActive ? null : activeOverflowToken;
  const visibleSelectedAoEFigureActionState = isNarrationOverlayActive ? null : selectedAoEFigureActionState;
  const visibleSelectedTokenActionState = isNarrationOverlayActive ? null : selectedTokenActionState;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-950/80 shadow-2xl">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-xs text-slate-400">
            {resolvedBackground?.name || 'Grid only'}
            {isNarrationOverlayActive
              ? ` | Narration scene${combatBackgroundName ? ` over ${combatBackgroundName}` : ''}`
              : ` | ${normalizedGrid.cellSizePx}px squares | 5 ft per square`}
          </p>
          {isNarrationOverlayActive && (
            <span
              data-testid="narration-overlay-badge"
              className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200"
            >
              Narration
            </span>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className={`relative w-full flex-1 min-h-[480px] transition-colors ${
          isDropActive ? 'bg-amber-500/10' : 'bg-slate-950/40'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onContextMenu={(event) => event.preventDefault()}
      >
        {isTokenDragActive && (
          <div
            data-testid="grigliata-board-drop-overlay"
            className="absolute inset-0 z-20"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onContextMenu={(event) => event.preventDefault()}
          />
        )}

        <div
          data-testid="grigliata-quick-controls"
          className="pointer-events-none absolute left-4 top-4 z-30 flex flex-col items-start gap-2"
        >
          <button
            type="button"
            onClick={onSelectMouseTool}
            disabled={isNarrationOverlayActive}
            title={isMouseSelectionActive ? 'Mouse selection mode is active' : 'Return to mouse selection'}
            aria-label="Return to mouse selection"
            aria-pressed={isMouseSelectionActive}
            data-testid="mouse-selection-trigger"
            className={`${getQuickControlButtonClassName(isMouseSelectionActive)} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <FaHandPointer className="h-4 w-4" />
          </button>
          <div className="pointer-events-auto">
            <DrawColorPicker
              activeColorKey={resolvedDrawTheme.key}
              onChange={onChangeDrawColor}
              disabled={isNarrationOverlayActive}
            />
          </div>
          <button
            type="button"
            onClick={onToggleRuler}
            disabled={isNarrationOverlayActive}
            title={isRulerEnabled ? 'Disable ruler mode' : 'Enable ruler mode'}
            aria-label={isRulerEnabled ? 'Disable ruler mode' : 'Enable ruler mode'}
            aria-pressed={isRulerEnabled}
            className={`${getQuickControlButtonClassName(isRulerEnabled)} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <FaRulerHorizontal className="h-4 w-4" />
          </button>
          <div className="pointer-events-auto">
            <AoETemplatePicker
              activeFigureType={activeAoeFigureType}
              onChange={onChangeAoeFigureType}
              disabled={isNarrationOverlayActive}
            />
          </div>
          <button
            type="button"
            onClick={onToggleInteractionSharing}
            disabled={isNarrationOverlayActive}
            title={isInteractionSharingEnabled ? 'Stop sharing live interactions' : 'Share live interactions'}
            aria-label={isInteractionSharingEnabled ? 'Stop sharing live interactions' : 'Share live interactions'}
            aria-pressed={isInteractionSharingEnabled}
            className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {isInteractionSharingEnabled ? <FiUsers className="h-4 w-4" /> : <FiUser className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={fitToBoard}
            title="Reset View"
            aria-label="Reset View"
            className={getQuickControlButtonClassName(false)}
          >
            <MdCenterFocusStrong className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggleMusicMuted?.()}
            disabled={isMusicMutePending || !onToggleMusicMuted}
            title={musicToggleActionLabel}
            aria-label={musicToggleStateLabel}
            aria-pressed={isMusicEnabled}
            aria-busy={isMusicMutePending ? true : undefined}
            data-testid="music-mute-trigger"
            className={`${getQuickControlButtonClassName(isMusicEnabled)} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {isMusicEnabled ? <FiVolume2 className="h-4 w-4" /> : <FiVolumeX className="h-4 w-4" />}
          </button>
        </div>

        <div
          data-testid="grigliata-right-rail"
          className={`pointer-events-none absolute right-4 top-4 bottom-4 z-30 flex flex-col items-end gap-3 ${TURN_ORDER_PANEL_WIDTH_CLASS}`}
        >
          {isManager && (
            <div
              data-testid="grigliata-manager-controls"
              className="pointer-events-none flex w-full flex-col items-end gap-2"
            >
                <button
                  type="button"
                  onClick={() => onToggleGridVisibility?.(activeBackground?.id || '')}
                  disabled={isNarrationOverlayActive || isGridVisibilityToggleDisabled}
                  title={isGridVisible ? 'Hide the shared grid for everyone' : 'Show the shared grid for everyone'}
                  aria-label={isGridVisible ? 'Hide Grid' : 'Show Grid'}
                  aria-pressed={isGridVisible}
                  className={`${getQuickControlButtonClassName(isGridVisible)} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isGridVisible ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => onDeactivateActiveBackground?.()}
                  disabled={isNarrationOverlayActive || isDeactivateActiveBackgroundDisabled}
                  title="Deactivate active map"
                  aria-label="Deactivate active map"
                  className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <FiImage className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustGridSize?.(1)}
                  disabled={isNarrationOverlayActive || isGridSizeAdjustmentDisabled}
                  title="Increase square size"
                  aria-label="Increase square size"
                  className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <FiPlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustGridSize?.(-1)}
                  disabled={isNarrationOverlayActive || isGridSizeAdjustmentDisabled}
                  title="Decrease square size"
                  aria-label="Decrease square size"
                  className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <FiMinus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onResetTurnOrder?.()}
                  disabled={areTurnOrderControlsDisabled || isTurnOrderResetPending || isTurnOrderProgressPending || (turnOrderEntries.length < 1 && !isTurnOrderStarted)}
                  title="Reset turn order"
                  aria-label="Reset turn order"
                  className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <FiRotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isTurnOrderStarted) {
                      onAdvanceTurnOrder?.();
                      return;
                    }

                    onStartTurnOrder?.();
                  }}
                  disabled={areTurnOrderControlsDisabled || isTurnOrderProgressPending || isTurnOrderResetPending || turnOrderEntries.length < 1 || (isTurnOrderStarted ? !onAdvanceTurnOrder : !onStartTurnOrder)}
                  title={isTurnOrderStarted ? 'Advance turn order' : 'Start turn order'}
                  aria-label={isTurnOrderStarted ? 'Advance turn order' : 'Start turn order'}
                  className={`${getQuickControlButtonClassName(isTurnOrderStarted)} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isTurnOrderStarted ? <FiSkipForward className="h-4 w-4" /> : <FiPlay className="h-4 w-4" />}
                </button>
            </div>
          )}

          <div className="pointer-events-none flex w-full flex-col items-end gap-2">
            <button
              type="button"
              data-testid="turn-order-rail-toggle"
              onClick={() => setIsTurnOrderPanelCollapsed((currentState) => !currentState)}
              title={isTurnOrderPanelCollapsed ? 'Expand turn order' : 'Collapse turn order'}
              aria-label={isTurnOrderPanelCollapsed ? 'Expand turn order' : 'Collapse turn order'}
              aria-controls={turnOrderPanelBodyId}
              aria-expanded={!isTurnOrderPanelCollapsed}
              className={getQuickControlButtonClassName(!isTurnOrderPanelCollapsed)}
            >
              <FiClock className="h-4 w-4" />
            </button>
          </div>

          <AnimatePresence initial={false}>
            {!isTurnOrderPanelCollapsed && (
              <motion.div
                key="turn-order-panel"
                id={turnOrderPanelBodyId}
                data-testid="turn-order-panel"
                className="pointer-events-none flex min-h-0 w-full flex-1 items-start overflow-hidden"
                initial={prefersReducedMotion ? { opacity: 1, height: 'auto' } : { opacity: 0, height: 0, y: -8 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0, height: 0 } : { opacity: 0, height: 0, y: -8 }}
                transition={prefersReducedMotion ? { duration: 0.01 } : TURN_ORDER_DRAWER_TRANSITION}
              >
                <TurnOrderPanel
                  currentUserId={currentUserId}
                  entries={sortedTurnOrderEntries}
                  isManager={isManager}
                  activeTurnTokenId={activeTurnTokenId}
                  onSaveTurnOrderInitiative={onSaveTurnOrderInitiative}
                  savingTurnOrderInitiativeTokenId={savingTurnOrderInitiativeTokenId}
                  isReadOnly={isNarrationOverlayActive}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {stageSize.width > 0 && stageSize.height > 0 && (
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
            onMouseDown={handleStageMouseDown}
            onWheel={handleWheel}
            onContextMenu={(event) => event.evt.preventDefault()}
          >
            <Layer>
              <Rect
                x={boardBounds.minX - normalizedGrid.cellSizePx}
                y={boardBounds.minY - normalizedGrid.cellSizePx}
                width={boardBounds.width + (normalizedGrid.cellSizePx * 2)}
                height={boardBounds.height + (normalizedGrid.cellSizePx * 2)}
                fill="#0f172a"
                listening={false}
              />

              {battlemapImageTransition.fadingOutLayer && battlemapImageTransition.fadingOutLayer.imageWidth > 0 && battlemapImageTransition.fadingOutLayer.imageHeight > 0 && (
                <KonvaImage
                  data-testid="battlemap-image-outgoing"
                  image={battlemapImageTransition.fadingOutLayer.image}
                  x={0}
                  y={0}
                  width={battlemapImageTransition.fadingOutLayer.imageWidth}
                  height={battlemapImageTransition.fadingOutLayer.imageHeight}
                  opacity={battlemapImageTransition.fadingOutLayer.opacity}
                  listening={false}
                />
              )}

              {battlemapImageTransition.visibleLayer && battlemapImageTransition.visibleLayer.imageWidth > 0 && battlemapImageTransition.visibleLayer.imageHeight > 0 && (
                <KonvaImage
                  data-testid="battlemap-image-active"
                  image={battlemapImageTransition.visibleLayer.image}
                  x={0}
                  y={0}
                  width={battlemapImageTransition.visibleLayer.imageWidth}
                  height={battlemapImageTransition.visibleLayer.imageHeight}
                  opacity={battlemapImageTransition.visibleLayer.opacity}
                  listening={false}
                />
              )}

              <Rect
                x={boardBounds.minX - normalizedGrid.cellSizePx}
                y={boardBounds.minY - normalizedGrid.cellSizePx}
                width={boardBounds.width + (normalizedGrid.cellSizePx * 2)}
                height={boardBounds.height + (normalizedGrid.cellSizePx * 2)}
                fill="rgba(15, 23, 42, 0.12)"
                listening={false}
              />

              {!isNarrationOverlayActive && isGridVisible && <GridLayer bounds={boardBounds} grid={normalizedGrid} />}

              {normalizedSelectionRect && (
                <>
                  <Rect
                    x={normalizedSelectionRect.x}
                    y={normalizedSelectionRect.y}
                    width={normalizedSelectionRect.width}
                    height={normalizedSelectionRect.height}
                    stroke={resolvedDrawTheme.outlineStroke}
                    strokeWidth={SHAPE_OUTLINE_STROKE_WIDTH}
                    dash={[8, 6]}
                    listening={false}
                  />
                  <Rect
                    x={normalizedSelectionRect.x}
                    y={normalizedSelectionRect.y}
                    width={normalizedSelectionRect.width}
                    height={normalizedSelectionRect.height}
                    fill={resolvedDrawTheme.fill}
                    stroke={resolvedDrawTheme.stroke}
                    strokeWidth={1.5}
                    dash={[8, 6]}
                    shadowColor={resolvedDrawTheme.glow}
                    shadowBlur={10}
                    shadowOpacity={0.18}
                    listening={false}
                  />
                </>
              )}

              {visibleRenderedAoEFigures.map((figure) => (
                <EnhancedAoEFigureOverlay
                  key={figure.id}
                  figure={figure.renderable}
                  drawTheme={getGrigliataDrawTheme(figure.colorKey)}
                  overlayId={figure.id}
                  isSelected={figure.isSelected}
                  viewportScale={viewport.scale}
                  onMouseDown={(event) => handleAoEFigureMouseDown(figure, event)}
                />
              ))}

              {visibleRenderedTokens.map((token) => (
                <TokenNode
                  key={token.tokenId}
                  token={token}
                  position={token.renderPosition}
                  canMove={token.canMove}
                  isActiveTurn={token.isActiveTurn}
                  isSelected={token.isSelected}
                  badgeImages={tokenStatusBadgeImages}
                  drawTheme={resolvedDrawTheme}
                  onMouseDown={handleTokenMouseDown}
                  onContextMenu={handleTokenContextMenu}
                  onOverflowMouseEnter={(tokenId) => setHoveredOverflowTokenId(tokenId || '')}
                  onOverflowMouseLeave={(tokenId) => {
                    setHoveredOverflowTokenId((currentTokenId) => (
                      currentTokenId === tokenId ? '' : currentTokenId
                    ));
                  }}
                  onOverflowToggle={(tokenId) => {
                    if (!tokenId) return;

                    setHoveredOverflowTokenId(tokenId);
                    setPinnedOverflowTokenId((currentTokenId) => (
                      currentTokenId === tokenId ? '' : tokenId
                    ));
                  }}
                />
              ))}

              {visibleRenderedSharedInteractions.map((sharedInteraction) => (
                sharedInteraction.kind === 'measure'
                  ? (
                    <MeasurementOverlay
                      key={`shared-measurement-${sharedInteraction.ownerUid}`}
                      measurement={sharedInteraction.measurement}
                      drawTheme={sharedInteraction.drawTheme}
                      overlayId={`shared-${sharedInteraction.ownerUid}`}
                      viewportScale={viewport.scale}
                    />
                  )
                  : sharedInteraction.kind === 'aoe'
                    ? (
                    <EnhancedAoEFigureOverlay
                      key={`shared-aoe-${sharedInteraction.ownerUid}`}
                      figure={sharedInteraction.figure}
                      drawTheme={sharedInteraction.drawTheme}
                      overlayId={`shared-${sharedInteraction.ownerUid}`}
                      viewportScale={viewport.scale}
                      listening={false}
                    />
                    )
                    : (
                    <MapPingOverlay
                      key={`shared-ping-${sharedInteraction.ownerUid}-${sharedInteraction.ping.startedAtMs}`}
                      ping={sharedInteraction.ping}
                      drawTheme={sharedInteraction.drawTheme}
                      overlayId={`shared-${sharedInteraction.ownerUid}`}
                      now={pingAnimationClock}
                      prefersReducedMotion={prefersReducedMotion}
                    />
                  )
              ))}

              {visibleLocalPingsForRender.map((ping) => (
                <MapPingOverlay
                  key={ping.id}
                  ping={ping}
                  drawTheme={getGrigliataDrawTheme(ping.colorKey)}
                  overlayId={ping.id}
                  now={pingAnimationClock}
                  prefersReducedMotion={prefersReducedMotion}
                />
              ))}

              {visibleMeasurementState && (
                <MeasurementOverlay
                  measurement={visibleMeasurementState}
                  drawTheme={resolvedDrawTheme}
                  overlayId="local"
                  viewportScale={viewport.scale}
                />
              )}

              {visibleAoEPreviewState && (
                <EnhancedAoEFigureOverlay
                  figure={visibleAoEPreviewState}
                  drawTheme={resolvedDrawTheme}
                  overlayId="local"
                  viewportScale={viewport.scale}
                  listening={false}
                />
              )}
            </Layer>
          </Stage>
        )}

        {visibleSelectedTokenHud && selectedTokenDetails && (
          <SelectedTokenResourceHud
            token={selectedTokenDetails}
            hudState={visibleSelectedTokenHud}
          />
        )}

        {visibleOverflowToken && activeOverflowCardStyle && (
          <div className="pointer-events-none absolute inset-0 z-[18]">
            <TokenStatusSummaryCard
              statuses={visibleOverflowToken.statuses}
              className="pointer-events-auto absolute"
              style={activeOverflowCardStyle}
              onMouseEnter={() => setHoveredOverflowTokenId(visibleOverflowToken.tokenId)}
              onMouseLeave={() => {
                if (!pinnedOverflowTokenId) {
                  setHoveredOverflowTokenId('');
                }
              }}
            />
          </div>
        )}

          {!isNarrationOverlayActive && turnOrderContextMenu && activeTurnOrderContextToken && (
            <div className="pointer-events-none absolute inset-0 z-[32]">
              <div
                ref={turnOrderContextMenuRef}
                data-testid="turn-order-context-menu"
              className="pointer-events-auto absolute min-w-[11rem] overflow-hidden rounded-[1.25rem] border border-slate-700/90 bg-slate-950/96 p-1.5 shadow-2xl shadow-black/55 backdrop-blur-md"
              style={{
                left: turnOrderContextMenu.left,
                top: turnOrderContextMenu.top,
              }}
            >
                <button
                  type="button"
                  data-testid={`turn-order-context-action-${activeTurnOrderContextToken.tokenId}`}
                  disabled={turnOrderActionTokenId === activeTurnOrderContextToken.tokenId}
                  onClick={async () => {
                    const tokenId = activeTurnOrderContextToken.tokenId;
                    setTurnOrderContextMenu(null);

                    if (activeTurnOrderContextToken.isInTurnOrder) {
                      await Promise.resolve(onLeaveTurnOrder?.(tokenId));
                      return;
                    }

                    const baseInitiative = Number.isInteger(activeTurnOrderContextToken.turnOrderInitiative)
                      ? activeTurnOrderContextToken.turnOrderInitiative
                      : 0;
                    setTurnOrderJoinPrompt({
                      tokenId,
                      draft: String(baseInitiative),
                    });
                  }}
                  className="flex w-full items-center justify-between rounded-[0.95rem] px-3 py-2 text-left text-sm font-medium text-slate-100 transition-colors duration-150 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>
                    {activeTurnOrderContextToken.isInTurnOrder ? 'Remove from turn order' : 'Add turn order'}
                </span>
                <FiClock className="h-4 w-4 text-slate-400" />
              </button>
              </div>
            </div>
          )}

          {!isNarrationOverlayActive && turnOrderJoinPrompt && activeTurnOrderJoinToken && (
            <div className="pointer-events-auto absolute inset-0 z-[34] flex items-center justify-center">
              <button
                type="button"
                aria-label="Close initiative prompt"
                className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
                onClick={() => setTurnOrderJoinPrompt(null)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="turn-order-join-title"
                data-testid="turn-order-join-overlay"
                className="relative z-10 w-[min(16rem,calc(100vw-2rem))] rounded-[1.5rem] border border-fuchsia-300/30 bg-slate-950/96 p-4 shadow-2xl shadow-black/60 ring-1 ring-fuchsia-200/10 backdrop-blur-md"
              >
                <div className="mb-3 min-w-0">
                  <div
                    id="turn-order-join-title"
                    className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-slate-400"
                  >
                    Initiative
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-100">
                    {activeTurnOrderJoinToken.label}
                  </div>
                </div>
                <form
                  className="space-y-3"
                  onSubmit={async (event) => {
                    event.preventDefault();

                    const normalizedDraft = typeof turnOrderJoinPrompt?.draft === 'string'
                      ? turnOrderJoinPrompt.draft.trim()
                      : '';
                    if (!/^-?\d+$/.test(normalizedDraft)) {
                      return;
                    }

                    const nextInitiative = Number.parseInt(normalizedDraft, 10);
                    const didJoin = await Promise.resolve(
                      onJoinTurnOrder?.(activeTurnOrderJoinToken.tokenId, nextInitiative)
                    );

                    if (didJoin !== false) {
                      setTurnOrderJoinPrompt(null);
                    }
                  }}
                >
                  <input
                    ref={turnOrderJoinInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="-?[0-9]*"
                    value={turnOrderJoinPrompt.draft}
                    disabled={turnOrderActionTokenId === activeTurnOrderJoinToken.tokenId}
                    data-testid="turn-order-join-initiative-input"
                    aria-label={`Initial initiative for ${activeTurnOrderJoinToken.label}`}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setTurnOrderJoinPrompt((currentPrompt) => (
                        currentPrompt
                          ? {
                              ...currentPrompt,
                              draft: nextValue,
                            }
                          : currentPrompt
                      ));
                    }}
                    className="w-full rounded-xl border border-slate-700/90 bg-slate-950/95 px-3 py-2 text-center text-sm font-semibold text-slate-100 outline-none transition-colors duration-150 focus:border-fuchsia-300/75 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      data-testid="turn-order-join-cancel"
                      disabled={turnOrderActionTokenId === activeTurnOrderJoinToken.tokenId}
                      onClick={() => setTurnOrderJoinPrompt(null)}
                      className="rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-300 transition-colors duration-150 hover:border-slate-500/80 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      data-testid="turn-order-join-confirm"
                      disabled={
                        turnOrderActionTokenId === activeTurnOrderJoinToken.tokenId
                        || !/^-?\d+$/.test(typeof turnOrderJoinPrompt?.draft === 'string' ? turnOrderJoinPrompt.draft.trim() : '')
                      }
                      className="rounded-xl border border-fuchsia-300/70 bg-gradient-to-br from-fuchsia-500/28 via-violet-500/24 to-pink-500/34 px-3 py-2 text-xs font-semibold text-fuchsia-50 shadow-lg shadow-fuchsia-950/35 transition-colors duration-150 hover:border-fuchsia-200/80 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Confirm
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

        <GrigliataTokenActions
            actionState={visibleSelectedTokenActionState}
            viewportSize={stageSize}
          isTokenVisibilityActionPending={isTokenVisibilityActionPending}
          isTokenDeadActionPending={isTokenDeadActionPending}
          isTokenStatusActionPending={isTokenStatusActionPending}
          isTokenSizeActionPending={isTokenSizeActionPending}
          onSetSelectedTokensVisibility={onSetSelectedTokensVisibility}
          onSetSelectedTokensDeadState={onSetSelectedTokensDeadState}
          onUpdateTokenStatuses={onUpdateTokenStatuses}
          onSetSelectedTokenSize={onSetSelectedTokenSize}
        />

        {visibleSelectedAoEFigureActionState && (
          <div className="pointer-events-none absolute inset-0 z-20">
            <div
              className="pointer-events-auto absolute"
              style={{
                left: visibleSelectedAoEFigureActionState.toolbarPosition.left,
                top: visibleSelectedAoEFigureActionState.toolbarPosition.top,
              }}
            >
              <div
                className="flex flex-col rounded-[1.4rem] border border-slate-700/70 bg-slate-950/88 p-2 shadow-2xl backdrop-blur-sm"
                style={{ gap: visibleSelectedAoEFigureActionState.toolbarInnerGap }}
              >
                <button
                  type="button"
                  aria-label={visibleSelectedAoEFigureActionState.showMeasurementDetails ? 'Hide size details' : 'Show size details'}
                  title={visibleSelectedAoEFigureActionState.showMeasurementDetails ? 'Hide size details' : 'Show size details'}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={async (event) => {
                    event.stopPropagation();

                    try {
                      await Promise.resolve(onUpdateAoEFigurePresentation?.(
                        visibleSelectedAoEFigureActionState.figureId,
                        {
                          showMeasurementDetails: !visibleSelectedAoEFigureActionState.showMeasurementDetails,
                        }
                      ));
                    } catch {
                      // keep selection unchanged if update fails
                    }
                  }}
                  className="flex items-center justify-center rounded-[1.15rem] border border-sky-300/50 bg-sky-500/20 text-slate-50 shadow-lg transition-transform duration-150 hover:scale-[1.03]"
                  style={{
                    width: visibleSelectedAoEFigureActionState.buttonSize,
                    height: visibleSelectedAoEFigureActionState.buttonSize,
                  }}
                >
                  {visibleSelectedAoEFigureActionState.showMeasurementDetails
                    ? <FiEyeOff className="h-[42%] w-[42%]" />
                    : <FiEye className="h-[42%] w-[42%]" />}
                </button>
                <button
                  type="button"
                  aria-label={visibleSelectedAoEFigureActionState.isFilled ? 'Show border only' : 'Fill selected AoE figure'}
                  title={visibleSelectedAoEFigureActionState.isFilled ? 'Show border only' : 'Fill selected AoE figure'}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={async (event) => {
                    event.stopPropagation();

                    try {
                      await Promise.resolve(onUpdateAoEFigurePresentation?.(
                        visibleSelectedAoEFigureActionState.figureId,
                        {
                          isFilled: !visibleSelectedAoEFigureActionState.isFilled,
                        }
                      ));
                    } catch {
                      // keep selection unchanged if update fails
                    }
                  }}
                  className="flex items-center justify-center rounded-[1.15rem] border border-amber-300/50 bg-amber-500/20 text-slate-50 shadow-lg transition-transform duration-150 hover:scale-[1.03]"
                  style={{
                    width: visibleSelectedAoEFigureActionState.buttonSize,
                    height: visibleSelectedAoEFigureActionState.buttonSize,
                  }}
                >
                  <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em]">
                    {visibleSelectedAoEFigureActionState.isFilled ? 'Line' : 'Fill'}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Delete selected AoE figure"
                  title="Delete selected AoE figure"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={async (event) => {
                    event.stopPropagation();

                    try {
                      await Promise.resolve(onDeleteAoEFigures?.([visibleSelectedAoEFigureActionState.figureId]));
                      setSelectedAoEFigureId('');
                    } catch {
                      // preserve selection if deletion fails
                    }
                  }}
                  className="flex items-center justify-center rounded-[1.15rem] border border-rose-300/60 bg-rose-600/35 text-slate-50 shadow-lg transition-transform duration-150 hover:scale-[1.03]"
                  style={{
                    width: visibleSelectedAoEFigureActionState.buttonSize,
                    height: visibleSelectedAoEFigureActionState.buttonSize,
                  }}
                >
                  <FiTrash2 className="h-[42%] w-[42%]" />
                </button>
              </div>
            </div>
          </div>
        )}

        {!resolvedBackground && (
          <div className="pointer-events-none absolute bottom-4 left-4 max-w-sm rounded-lg border border-slate-700/70 bg-slate-950/85 px-3 py-2 text-xs leading-relaxed text-slate-300 shadow-lg">
            No active background is selected. The board remains usable with the shared grid only.
          </div>
        )}
      </div>
    </div>
  );
}
