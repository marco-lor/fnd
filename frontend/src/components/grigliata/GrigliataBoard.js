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
import { FaDiceD20, FaHandPointer, FaRulerHorizontal } from 'react-icons/fa';
import { GiHearts, GiMagicSwirl, GiShield } from 'react-icons/gi';
import {
  FiClock,
  FiEye,
  FiEyeOff,
  FiImage,
  FiMinus,
  FiMoon,
  FiMove,
  FiPlay,
  FiPlus,
  FiRotateCcw,
  FiSkipForward,
  FiSun,
  FiTrash2,
  FiUser,
  FiUsers,
  FiVolume2,
  FiVolumeX,
} from 'react-icons/fi';
import { MdBrush, MdCenterFocusStrong } from 'react-icons/md';
import {
  BOARD_FIT_PADDING,
  DEFAULT_GRIGLIATA_DRAW_COLOR_KEY,
  getGrigliataDrawTheme,
  GRIGLIATA_DRAW_THEMES,
  MAX_GRIGLIATA_VIEWPORT_SCALE,
  MAP_PING_BROADCAST_CLEAR_MS,
  MAP_PING_HOLD_DELAY_MS,
  MAP_PING_VISIBLE_MS,
  MIN_GRIGLIATA_VIEWPORT_SCALE,
  FOE_LIBRARY_DRAG_TYPE,
  TRAY_DRAG_MIME,
} from './constants';
import {
  buildGridMeasurementPath,
  fitViewportToBounds,
  getBackgroundAssetType,
  getBoardBounds,
  getInitials,
  getTokenPositionPx,
  normalizeGridConfig,
  snapBoardPointToGrid,
  timestampToMillis,
} from './boardUtils';
import GrigliataTokenActions, { TokenStatusSummaryCard } from './GrigliataTokenActions';
import DiceRoller from '../common/DiceRoller';
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
import GrigliataLightingDebugOverlay from './GrigliataLightingDebugOverlay';
import GrigliataLightingMask from './GrigliataLightingMask';
import GrigliataFogOfWarMask from './GrigliataFogOfWarMask';
import GrigliataWallRuntimeControls from './GrigliataWallRuntimeControls';
import GrigliataWallAuthoringControls, { GrigliataSelectedWallPanel } from './GrigliataWallAuthoringControls';
import GrigliataLightingDiagnostics from './GrigliataLightingDiagnostics';
import GrigliataLightControls, { GrigliataSelectedLightPanel } from './GrigliataLightControls';
import GrigliataDarknessControls, { GrigliataSelectedDarknessPanel } from './GrigliataDarknessControls';
import { normalizeEditableLightSources } from './lightSources';
import { normalizeEditableDarknessSources } from './darknessSources';
import { normalizeEditableWallSegments } from './wallSources';
import { resolveViewerTokenVisionSources } from './lightingVisibility';
import {
  filterFogVisibleTokens,
  splitFogVisibleTokenRenderLayers,
} from './fogVisibilityFiltering';
import {
  MAX_FOG_BRUSH_RADIUS_SQUARES,
  MIN_FOG_BRUSH_RADIUS_SQUARES,
  normalizeFogBrushSettings,
} from './fogBrushEditing';
import { sortTokensByLayerOrder } from './tokenLayering';
import {
  buildBackgroundMap,
  buildInitialNarrationPlacement,
  buildNarrationPlacementBounds,
} from './narrationScene';

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
const MAP_PING_ACCENT = '#fbbf24';
const MAP_PING_HIGHLIGHT = '#fef3c7';
const MAP_PING_ACCENT_GLOW = 'rgba(251, 191, 36, 0.34)';
const DRAW_PICKER_EASE = [0.22, 1, 0.36, 1];
const BATTLEMAP_IMAGE_FADE_DURATION_MS = 1000;
const NARRATION_IMAGE_FADE_DURATION_MS = 1000;
const NARRATION_IMAGE_REPLACEMENT_PHASE_DURATION_MS = NARRATION_IMAGE_FADE_DURATION_MS / 2;
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

const shouldSuppressTokenTurnOrderMenu = (interaction) => (
  interaction?.type === 'token-candidate'
  || interaction?.type === 'measure-candidate'
  || isWaypointEligibleInteraction(interaction)
);

const isAoECreateInteraction = (interaction) => interaction?.type === 'aoe-create';
const isAoEDragInteraction = (interaction) => (
  interaction?.type === 'aoe-drag-candidate'
  || interaction?.type === 'aoe-drag'
);
const isLightDragInteraction = (interaction) => (
  interaction?.type === 'light-drag-candidate'
  || interaction?.type === 'light-drag'
);
const isDarknessDragInteraction = (interaction) => (
  interaction?.type === 'darkness-drag-candidate'
  || interaction?.type === 'darkness-drag'
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
const TOKEN_TOOLTIP_EDGE_PADDING = 12;
const TOKEN_TOOLTIP_MIN_WIDTH = 96;
const TOKEN_TOOLTIP_MAX_WIDTH = 240;
const TOKEN_TOOLTIP_FONT_SIZE = 12;
const TOKEN_TOOLTIP_HORIZONTAL_PADDING = 28;
const buildClampedTokenTooltipLayout = ({
  containerWidth = 0,
  anchorCenterX = 0,
  preferredTop = 0,
  preferredBottom = 0,
  label = '',
  forceBelow = false,
}) => {
  const maxWidth = Math.max(
    TOKEN_TOOLTIP_MIN_WIDTH,
    Math.min(TOKEN_TOOLTIP_MAX_WIDTH, containerWidth - (TOKEN_TOOLTIP_EDGE_PADDING * 2))
  );
  const width = Math.min(
    maxWidth,
    Math.max(
      TOKEN_TOOLTIP_MIN_WIDTH,
      estimateTextWidth(label, TOKEN_TOOLTIP_FONT_SIZE) + TOKEN_TOOLTIP_HORIZONTAL_PADDING
    )
  );
  const left = clampToRange(
    anchorCenterX,
    TOKEN_TOOLTIP_EDGE_PADDING + (width / 2),
    Math.max(
      TOKEN_TOOLTIP_EDGE_PADDING + (width / 2),
      containerWidth - TOKEN_TOOLTIP_EDGE_PADDING - (width / 2)
    )
  );

  return {
    left,
    top: forceBelow ? preferredBottom : preferredTop,
    width,
    maxWidth,
    transform: forceBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  };
};
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
const EMPTY_VIDEO_ASSET_SNAPSHOT = {
  status: 'idle',
  image: null,
  error: null,
};
const useVideoBackgroundAssetSnapshot = (src) => {
  const normalizedSrc = typeof src === 'string' ? src.trim() : '';
  const [snapshot, setSnapshot] = useState(EMPTY_VIDEO_ASSET_SNAPSHOT);

  useEffect(() => {
    if (!normalizedSrc) {
      setSnapshot(EMPTY_VIDEO_ASSET_SNAPSHOT);
      return undefined;
    }

    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      setSnapshot({
        status: 'error',
        image: null,
        error: new Error('Video loading is not available in this environment.'),
      });
      return undefined;
    }

    let isActive = true;
    let didLoad = false;
    const video = document.createElement('video');

    const cleanupListeners = () => {
      if (typeof video.removeEventListener === 'function') {
        video.removeEventListener('loadeddata', handleLoaded);
        video.removeEventListener('canplay', handleLoaded);
        video.removeEventListener('error', handleError);
      } else {
        video.onloadeddata = null;
        video.oncanplay = null;
        video.onerror = null;
      }
    };

    function handleLoaded() {
      if (!isActive || didLoad) return;
      didLoad = true;

      setSnapshot({
        status: 'loaded',
        image: video,
        error: null,
      });

      const playPromise = typeof video.play === 'function' ? video.play() : null;
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => null);
      }
    }

    function handleError(errorEvent) {
      if (!isActive) return;

      setSnapshot({
        status: 'error',
        image: null,
        error: errorEvent instanceof Error
          ? errorEvent
          : new Error(`Failed to load video background: ${normalizedSrc}`),
      });
    }

    setSnapshot({
      status: 'loading',
      image: null,
      error: null,
    });

    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = 'auto';

    if (typeof video.addEventListener === 'function') {
      video.addEventListener('loadeddata', handleLoaded);
      video.addEventListener('canplay', handleLoaded);
      video.addEventListener('error', handleError);
    } else {
      video.onloadeddata = handleLoaded;
      video.oncanplay = handleLoaded;
      video.onerror = handleError;
    }

    video.src = normalizedSrc;
    if (typeof video.load === 'function') {
      try {
        video.load();
      } catch (_) {}
    }

    return () => {
      isActive = false;
      cleanupListeners();
      if (typeof video.pause === 'function') {
        video.pause();
      }
      if (typeof video.removeAttribute === 'function') {
        video.removeAttribute('src');
      }
      if (typeof video.load === 'function') {
        try {
          video.load();
        } catch (_) {}
      }
    };
  }, [normalizedSrc]);

  return snapshot;
};
const buildBattlemapImageLayer = ({ background, image, opacity = 1 }) => {
  if (!background?.imageUrl || !image) {
    return null;
  }

  const assetType = getBackgroundAssetType(background);

  return {
    key: `${background.id || background.imageUrl}::${background.imageUrl}`,
    src: background.imageUrl,
    assetType,
    image,
    imageWidth: background.imageWidth || image.naturalWidth || image.videoWidth || image.width || 0,
    imageHeight: background.imageHeight || image.naturalHeight || image.videoHeight || image.height || 0,
    opacity,
  };
};
const NarrationPlacementImage = ({
  placement,
  background,
  opacity = 1,
  transitionRole = 'stable',
  isPrimary = false,
  isManager = false,
  onMoveNarrationPlacement = null,
}) => {
  const assetType = getBackgroundAssetType(background);
  const imageSnapshot = useImageAssetSnapshot(assetType === 'image' ? background?.imageUrl || '' : '');
  const videoSnapshot = useVideoBackgroundAssetSnapshot(assetType === 'video' ? background?.imageUrl || '' : '');
  const assetSnapshot = assetType === 'video' ? videoSnapshot : imageSnapshot;

  if (!placement?.id || !background?.imageUrl || assetSnapshot.status !== 'loaded' || !assetSnapshot.image) {
    return null;
  }

  return (
    <KonvaImage
      data-testid={isPrimary ? 'battlemap-image-active' : `narration-image-placement-${placement.id}`}
      data-asset-type={assetType}
      data-transition-role={transitionRole}
      image={assetSnapshot.image}
      x={placement.x}
      y={placement.y}
      width={placement.width}
      height={placement.height}
      opacity={opacity}
      draggable={!!(isManager && onMoveNarrationPlacement)}
      listening={!!(isManager && onMoveNarrationPlacement)}
      onDragEnd={(event) => {
        const target = event?.target;
        const targetAttrX = target?.attrs?.x ?? target?.getAttribute?.('data-x');
        const targetAttrY = target?.attrs?.y ?? target?.getAttribute?.('data-y');
        const nextX = typeof target?.x === 'function' ? target.x() : Number(targetAttrX ?? placement.x);
        const nextY = typeof target?.y === 'function' ? target.y() : Number(targetAttrY ?? placement.y);
        onMoveNarrationPlacement?.(placement.id, { x: nextX, y: nextY });
      }}
    />
  );
};
const buildNarrationImageBounds = (background) => {
  const width = Number(background?.imageWidth) || 0;
  const height = Number(background?.imageHeight) || 0;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    minX: 0,
    minY: 0,
    maxX: width,
    maxY: height,
    width,
    height,
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
  const secondaryProgress = easeOutCubic(clampToRange((progress - 0.08) / 0.92, 0, 1));
  const fadeProgress = easeOutCubic(clampToRange((progress - 0.58) / 0.42, 0, 1));
  const fadeOpacity = prefersReducedMotion ? 0.88 : 1 - fadeProgress;
  const pulseStrength = prefersReducedMotion ? 0 : Math.sin(progress * Math.PI);
  const haloRadius = prefersReducedMotion ? 42 : 24 + (easedProgress * 34);
  const primaryRadius = prefersReducedMotion ? 40 : 18 + (easedProgress * 52);
  const secondaryRadius = prefersReducedMotion ? 24 : 12 + (secondaryProgress * 38);
  const coreRadius = prefersReducedMotion ? 5 : 4 + (pulseStrength * 1.5);

  return (
    <Group
      x={ping.point.x}
      y={ping.point.y}
      listening={false}
      data-testid={overlayId ? `map-ping-overlay-${overlayId}` : undefined}
    >
      <Circle
        radius={haloRadius}
        fill={drawTheme.stroke}
        opacity={0.08 * fadeOpacity}
        shadowColor={drawTheme.glow}
        shadowBlur={prefersReducedMotion ? 12 : 18}
        shadowOpacity={0.32 * fadeOpacity}
      />
      <Circle
        radius={primaryRadius}
        stroke={drawTheme.outlineStroke}
        strokeWidth={4.5}
        opacity={0.24 * fadeOpacity}
      />
      <Circle
        radius={primaryRadius}
        stroke={drawTheme.stroke}
        strokeWidth={2.4}
        opacity={0.92 * fadeOpacity}
        shadowColor={drawTheme.glow}
        shadowBlur={prefersReducedMotion ? 10 : 16}
        shadowOpacity={0.52 * fadeOpacity}
      />
      <Circle
        radius={secondaryRadius}
        stroke={MAP_PING_ACCENT}
        strokeWidth={1.4}
        opacity={0.58 * fadeOpacity}
        shadowColor={MAP_PING_ACCENT_GLOW}
        shadowBlur={prefersReducedMotion ? 5 : 8}
        shadowOpacity={0.38 * fadeOpacity}
      />
      <Circle
        radius={coreRadius + 3}
        fill="rgba(15, 23, 42, 0.9)"
        stroke={drawTheme.stroke}
        strokeWidth={1.5}
        opacity={fadeOpacity}
        shadowColor={drawTheme.glow}
        shadowBlur={prefersReducedMotion ? 8 : 12}
        shadowOpacity={0.5 * fadeOpacity}
      />
      <Circle
        radius={coreRadius}
        fill={drawTheme.stroke}
        opacity={0.94 * fadeOpacity}
      />
      <Circle
        radius={1.75}
        fill={MAP_PING_HIGHLIGHT}
        opacity={0.88 * fadeOpacity}
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
  hitTargetOnly = false,
}) => {
  if (!figure?.figureType) {
    return null;
  }

  const overlayProps = {
    listening,
    onMouseDown,
    'data-testid': overlayId
      ? `aoe-figure-${hitTargetOnly ? 'hit-target' : 'overlay'}-${overlayId}`
      : undefined,
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
        {hitTargetOnly ? null : (
          <>
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
          </>
        )}
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
        {hitTargetOnly ? null : (
          <>
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
          </>
        )}
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
        {hitTargetOnly ? null : (
          <>
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
          </>
        )}
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

const ActiveViewersOverlay = ({ viewers = [] }) => {
  if (!viewers.length) {
    return null;
  }

  return (
    <div
      data-testid="grigliata-active-viewers"
      className="pointer-events-none absolute bottom-4 left-4 z-30 flex max-w-[min(24rem,calc(100%-2rem))] flex-wrap items-end gap-2"
      aria-label="Active Grigliata viewers"
    >
      {viewers.map((viewer) => {
        const viewerTheme = getGrigliataDrawTheme(viewer.colorKey);

        return (
          <div
            key={viewer.ownerUid}
            data-testid={`grigliata-active-viewer-${viewer.ownerUid}`}
            className="flex min-w-0 max-w-[12rem] items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-950/88 px-2.5 py-1.5 text-xs font-semibold text-slate-100 shadow-lg shadow-black/35 backdrop-blur-md"
            title={viewer.characterId}
          >
            <span
              data-testid={`grigliata-active-viewer-swatch-${viewer.ownerUid}`}
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-[2px] border border-slate-950/80 shadow-sm"
              style={{
                backgroundColor: viewerTheme.hex,
                boxShadow: `0 0 10px ${viewerTheme.hex}`,
              }}
            />
            <span className="min-w-0 truncate">{viewer.characterId}</span>
          </div>
        );
      })}
    </div>
  );
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
  const panelRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const entryRefs = useRef(new Map());
  const [hoveredEntryTooltip, setHoveredEntryTooltip] = useState(null);

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

  const showEntryTooltip = useCallback((tokenId, label, element) => {
    const panelRect = panelRef.current?.getBoundingClientRect();
    const chipRect = element?.getBoundingClientRect?.();
    if (!panelRect || !chipRect || !tokenId || !label) {
      return;
    }

    const tooltipLayout = buildClampedTokenTooltipLayout({
      containerWidth: panelRect.width,
      anchorCenterX: chipRect.left - panelRect.left + (chipRect.width / 2),
      preferredTop: chipRect.top - panelRect.top - 8,
      preferredBottom: chipRect.bottom - panelRect.top + 8,
      label,
      forceBelow: false,
    });

    setHoveredEntryTooltip({
      tokenId,
      label,
      ...tooltipLayout,
    });
  }, []);

  const clearEntryTooltip = useCallback((tokenId = '') => {
    setHoveredEntryTooltip((currentTooltip) => (
      !currentTooltip || (tokenId && currentTooltip.tokenId !== tokenId)
        ? currentTooltip
        : null
    ));
  }, []);

  const setEntryRef = useCallback((tokenId, element) => {
    if (!tokenId) {
      return;
    }

    if (element) {
      entryRefs.current.set(tokenId, element);
      return;
    }

    entryRefs.current.delete(tokenId);
  }, []);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const activeEntry = entryRefs.current.get(activeTurnTokenId);
    if (!scrollContainer || !activeEntry || !activeTurnTokenId) {
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const entryRect = activeEntry.getBoundingClientRect();
    let scrollDelta = 0;

    if (entryRect.top < containerRect.top) {
      scrollDelta = entryRect.top - containerRect.top;
    } else if (entryRect.bottom > containerRect.bottom) {
      scrollDelta = entryRect.bottom - containerRect.bottom;
    }

    if (!scrollDelta) {
      return;
    }

    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    const nextScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, scrollContainer.scrollTop + scrollDelta),
    );
    scrollContainer.scrollTo({
      top: nextScrollTop,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [activeTurnTokenId, entries, prefersReducedMotion]);

  return (
    <div ref={panelRef} className="pointer-events-auto relative flex h-full min-h-0 w-full flex-col overflow-visible">
      {hoveredEntryTooltip && (
        <div
          data-testid={`turn-order-tooltip-${hoveredEntryTooltip.tokenId}`}
          className="pointer-events-none absolute z-[36] overflow-hidden text-center text-ellipsis whitespace-nowrap rounded-xl border border-slate-700/90 bg-slate-950/96 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-lg shadow-black/45 backdrop-blur-sm"
          style={{
            left: hoveredEntryTooltip.left,
            top: hoveredEntryTooltip.top,
            width: hoveredEntryTooltip.width,
            maxWidth: hoveredEntryTooltip.maxWidth,
            transform: hoveredEntryTooltip.transform,
          }}
        >
          {hoveredEntryTooltip.label}
        </div>
      )}
      <div
        ref={scrollContainerRef}
        data-testid="turn-order-scroll-container"
        onScroll={() => setHoveredEntryTooltip(null)}
        className="custom-scroll relative flex h-full min-h-0 flex-1 flex-col items-end gap-2 overflow-x-hidden overflow-y-auto overscroll-contain pb-8 pl-3 pr-1 pt-1 [scrollbar-gutter:stable]"
      >
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
          const isHiddenFromPlayers = entry.isVisibleToPlayers === false;
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
              ref={(element) => setEntryRef(entry.tokenId, element)}
              data-testid={`turn-order-entry-${entry.tokenId}`}
              data-active-turn={isActiveTurn ? 'true' : 'false'}
              data-hidden-from-players={isHiddenFromPlayers ? 'true' : 'false'}
              aria-current={isActiveTurn ? 'step' : undefined}
              className="relative z-10 flex max-w-full items-center gap-3 py-1.5"
              initial={prefersReducedMotion ? false : { opacity: 0, y: -10, x: 6 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -10, x: 6 }}
              transition={prefersReducedMotion ? { duration: 0.01 } : TURN_ORDER_ENTRY_TRANSITION}
            >
              {isActiveTurn && <span className="sr-only">Current turn</span>}
              <div className="min-w-0 text-right">
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
                        ? 'border border-amber-300/70 text-amber-100 shadow-[0_0_10px_rgba(251,191,36,0.14)] focus:border-amber-200/85'
                        : 'border border-slate-700/90 text-slate-100 focus:border-fuchsia-300/75'}`}
                    />
                  </form>
                ) : (
                  <div
                    data-testid={`turn-order-initiative-value-${entry.tokenId}`}
                    className={`mt-1 text-xs font-semibold ${isActiveTurn ? 'text-amber-200' : 'text-slate-400'}`}
                  >
                    {entry.initiative}
                  </div>
                )}
              </div>

              <div
                className="relative shrink-0"
                data-testid={`turn-order-chip-${entry.tokenId}`}
                onMouseEnter={(event) => showEntryTooltip(entry.tokenId, entry.label, event.currentTarget)}
                onMouseLeave={() => clearEntryTooltip(entry.tokenId)}
                onFocus={(event) => showEntryTooltip(entry.tokenId, entry.label, event.currentTarget)}
                onBlur={() => clearEntryTooltip(entry.tokenId)}
              >
                {entry.imageUrl ? (
                  <img
                    src={entry.imageUrl}
                    alt=""
                    className={`h-10 w-10 shrink-0 rounded-2xl object-cover transition-[border-color,box-shadow] duration-150 ${isActiveTurn
                      ? 'border-2 border-amber-300/90 shadow-[0_0_12px_rgba(251,191,36,0.24)]'
                      : 'border border-slate-700/80'}`}
                  />
                ) : (
                  <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-800/90 text-xs font-bold uppercase tracking-[0.18em] transition-[border-color,box-shadow] duration-150 ${isActiveTurn
                    ? 'border-2 border-amber-300/90 text-amber-50 shadow-[0_0_12px_rgba(251,191,36,0.24)]'
                    : 'border border-slate-700/80 text-slate-200'}`}>
                    {getInitials(entry.label)}
                  </div>
                )}
                {isHiddenFromPlayers && (
                  <div
                    data-testid={`turn-order-hidden-overlay-${entry.tokenId}`}
                    className="pointer-events-none absolute inset-px z-10 overflow-hidden rounded-[0.9rem] bg-slate-950/60"
                  >
                    <span
                      aria-hidden="true"
                      data-testid={`turn-order-hidden-slash-${entry.tokenId}`}
                      className="absolute left-1/2 top-1/2 h-0.5 w-12 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-slate-100 shadow-[0_0_0_2px_rgba(15,23,42,0.92)]"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-100/90 bg-slate-950/95 text-slate-100 shadow-sm shadow-black/60"
                    >
                      <FiEyeOff className="h-2.5 w-2.5" />
                    </span>
                    <span className="sr-only">Invisible to players</span>
                  </div>
                )}
                {isActiveTurn && (
                  <motion.span
                    aria-hidden="true"
                    data-testid={`turn-order-active-marker-${entry.tokenId}`}
                    className="pointer-events-none absolute -right-2 top-1/2 z-20 h-3 w-1 -translate-y-1/2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                    initial={prefersReducedMotion ? false : { opacity: 0, scaleY: 0.55 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.14, ease: 'easeOut' }}
                  />
                )}
              </div>
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
  fogViewerUserId = '',
  isFogViewerManager,
  isTokenDragActive,
  activeTrayDragType = '',
  isRulerEnabled,
  isRulerTokenMovementEnabled = false,
  activeAoeFigureType = '',
  isInteractionSharingEnabled = false,
  isMusicMuted = false,
  isMusicMutePending = false,
  drawTheme,
  onSelectMouseTool,
  onToggleRuler,
  onToggleRulerTokenMovement,
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
  onResolveTurnOrderInitiativeRoll,
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
  onSetSelectedTokenVision,
  isTokenVisionActionPending = false,
  onMoveTokenLayer,
  isTokenLayerActionPending = false,
  selectedTokenDetails = null,
  onDropCurrentToken,
  onSelectedTokenIdsChange,
  sharedInteractions = [],
  activeViewers = [],
  onSharedInteractionChange,
  lightingRenderInput = null,
  lightingDebugMetadata = null,
  showLightingDebugOverlay = false,
  fogOfWar = null,
  wallRuntimeSegments = null,
  onToggleWallRuntimeSegment = null,
  lightSourceControls = null,
  darknessSourceControls = null,
  wallSourceControls = null,
  fogBrushControls = null,
  isNarrationOverlayActive = false,
  narrationPlacements = [],
  narrationBackgrounds = [],
  onMoveNarrationPlacement = null,
}) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const interactionRef = useRef(null);
  const pingHoldTimeoutRef = useRef(null);
  const pingBroadcastClearTimeoutRef = useRef(null);
  const suppressNextTokenContextMenuRef = useRef(false);
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
  const [selectedLightId, setSelectedLightId] = useState(() => (
    typeof lightSourceControls?.selectedLightId === 'string'
      ? lightSourceControls.selectedLightId
      : ''
  ));
  const [lightDragState, setLightDragState] = useState(null);
  const [selectedDarknessId, setSelectedDarknessId] = useState(() => (
    typeof darknessSourceControls?.selectedDarknessId === 'string'
      ? darknessSourceControls.selectedDarknessId
      : ''
  ));
  const [darknessDragState, setDarknessDragState] = useState(null);
  const [selectedWallId, setSelectedWallId] = useState(() => (
    typeof wallSourceControls?.selectedWallId === 'string'
      ? wallSourceControls.selectedWallId
      : ''
  ));
  const [wallDragState, setWallDragState] = useState(null);
  const [wallCreatePreview, setWallCreatePreview] = useState(null);
  const [activeSharedInteraction, setActiveSharedInteraction] = useState(null);
  const [localPings, setLocalPings] = useState([]);
  const [pingAnimationClock, setPingAnimationClock] = useState(() => Date.now());
  const [hoveredOverflowTokenId, setHoveredOverflowTokenId] = useState('');
  const [pinnedOverflowTokenId, setPinnedOverflowTokenId] = useState('');
  const [hoveredTokenTooltipId, setHoveredTokenTooltipId] = useState('');
  const [isTurnOrderPanelCollapsed, setIsTurnOrderPanelCollapsed] = useState(() => readStoredTurnOrderCollapsed(currentUserId));
  const turnOrderPanelBodyId = useId();
  const [turnOrderContextMenu, setTurnOrderContextMenu] = useState(null);
  const [turnOrderJoinPrompt, setTurnOrderJoinPrompt] = useState(null);
  const [turnOrderInitiativeRollState, setTurnOrderInitiativeRollState] = useState({
    tokenId: '',
    status: 'idle',
    config: null,
  });
  const [turnOrderInitiativeRoller, setTurnOrderInitiativeRoller] = useState(null);
  const turnOrderJoinPromptTokenId = turnOrderJoinPrompt?.tokenId || '';
  const activeBackgroundAssetType = getBackgroundAssetType(activeBackground);
  const backgroundImageAssetSnapshot = useImageAssetSnapshot(
    activeBackgroundAssetType === 'image' ? activeBackground?.imageUrl || '' : ''
  );
  const backgroundVideoAssetSnapshot = useVideoBackgroundAssetSnapshot(
    activeBackgroundAssetType === 'video' ? activeBackground?.imageUrl || '' : ''
  );
  const backgroundAssetSnapshot = activeBackgroundAssetType === 'video'
    ? backgroundVideoAssetSnapshot
    : backgroundImageAssetSnapshot;
  const turnOrderContextMenuRef = useRef(null);
  const turnOrderJoinInputRef = useRef(null);
  const lastReportedSelectedTokenIdsRef = useRef([]);
  const [battlemapImageTransition, setBattlemapImageTransition] = useState({
    visibleLayer: null,
    fadingOutLayer: null,
  });
  const [narrationImageTransition, setNarrationImageTransition] = useState({
    entries: [],
    boundsPlacements: [],
  });
  const battlemapImageTransitionRef = useRef(battlemapImageTransition);
  const narrationImageTransitionRef = useRef(narrationImageTransition);
  const previousNarrationEntriesRef = useRef([]);
  const narrationImageAnimationHandleRef = useRef(null);
  const battlemapImageAnimationHandleRef = useRef(null);
  const battlemapImageAnimationLayersRef = useRef(null);
  const battlemapVideoFrameAnimationHandleRef = useRef(null);
  const previousNarrationOverlayActiveRef = useRef(isNarrationOverlayActive);
  const lastFitKeyRef = useRef('');
  const narrationBackgroundsById = useMemo(
    () => buildBackgroundMap(narrationBackgrounds),
    [narrationBackgrounds]
  );
  const resolvedDrawTheme = drawTheme || DEFAULT_DRAW_THEME;
  const isLightToolActive = !!(isManager && lightSourceControls?.isLightToolActive);
  const isLightSourcePending = !!lightSourceControls?.isPending;
  const isDarknessToolActive = !!(isManager && darknessSourceControls?.isDarknessToolActive);
  const isDarknessSourcePending = !!darknessSourceControls?.isPending;
  const isWallToolActive = !!(isManager && wallSourceControls?.isWallToolActive);
  const isWallSourcePending = !!wallSourceControls?.isPending;
  const isFogBrushToolActive = !!(isManager && fogBrushControls?.isFogBrushToolActive);
  const isFogBrushPending = !!fogBrushControls?.isPending;
  const fogBrushSettings = useMemo(
    () => normalizeFogBrushSettings({
      mode: fogBrushControls?.mode,
      radiusSquares: fogBrushControls?.radiusSquares,
    }),
    [fogBrushControls?.mode, fogBrushControls?.radiusSquares]
  );
  const isMouseSelectionActive = !isRulerEnabled
    && !activeAoeFigureType
    && !isLightToolActive
    && !isDarknessToolActive
    && !isWallToolActive
    && !isFogBrushToolActive;
  const isMusicEnabled = !isMusicMuted;
  const musicToggleActionLabel = isMusicEnabled ? 'Mute Music' : 'Unmute Music';
  const musicToggleStateLabel = isMusicEnabled ? 'Shared music enabled' : 'Shared music muted';
  const prefersReducedMotion = useReducedMotion();
  const fogBrushSettingsId = useId();
  const resolvedFogViewerUserId = fogViewerUserId || currentUserId;
  const resolvedIsFogViewerManager = typeof isFogViewerManager === 'boolean'
    ? isFogViewerManager
    : isManager;

  const cancelBattlemapImageAnimation = useCallback(() => {
    cancelAnimationFrameSafe(battlemapImageAnimationHandleRef.current);
    battlemapImageAnimationHandleRef.current = null;
    battlemapImageAnimationLayersRef.current = null;
  }, []);
  const cancelBattlemapVideoFrameAnimation = useCallback(() => {
    cancelAnimationFrameSafe(battlemapVideoFrameAnimationHandleRef.current);
    battlemapVideoFrameAnimationHandleRef.current = null;
  }, []);
  const cancelNarrationImageAnimation = useCallback(() => {
    cancelAnimationFrameSafe(narrationImageAnimationHandleRef.current);
    narrationImageAnimationHandleRef.current = null;
  }, []);

  useEffect(() => {
    battlemapImageTransitionRef.current = battlemapImageTransition;
  }, [battlemapImageTransition]);

  useEffect(() => {
    narrationImageTransitionRef.current = narrationImageTransition;
  }, [narrationImageTransition]);

  useEffect(() => (
    () => {
      cancelBattlemapImageAnimation();
    }
  ), [cancelBattlemapImageAnimation]);

  useEffect(() => (
    () => {
      cancelBattlemapVideoFrameAnimation();
    }
  ), [cancelBattlemapVideoFrameAnimation]);

  useEffect(() => (
    () => {
      cancelNarrationImageAnimation();
    }
  ), [cancelNarrationImageAnimation]);

  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);

  const resolvedBackground = useMemo(() => {
    if (!activeBackground) return null;

    return {
      ...activeBackground,
      imageWidth: activeBackground.imageWidth || backgroundAssetSnapshot.image?.naturalWidth || backgroundAssetSnapshot.image?.videoWidth || backgroundAssetSnapshot.image?.width || 0,
      imageHeight: activeBackground.imageHeight || backgroundAssetSnapshot.image?.naturalHeight || backgroundAssetSnapshot.image?.videoHeight || backgroundAssetSnapshot.image?.height || 0,
    };
  }, [activeBackground, backgroundAssetSnapshot.image]);

  const resolvedNarrationPlacements = useMemo(() => {
    if (!isNarrationOverlayActive) return [];
    if (Array.isArray(narrationPlacements) && narrationPlacements.length) {
      return narrationPlacements;
    }

    const fallbackPlacement = buildInitialNarrationPlacement(resolvedBackground);
    return fallbackPlacement ? [fallbackPlacement] : [];
  }, [isNarrationOverlayActive, narrationPlacements, resolvedBackground]);

  const canonicalNarrationEntries = useMemo(() => (
    isNarrationOverlayActive
      ? resolvedNarrationPlacements.map((placement, index) => ({
        key: placement.id,
        placement,
        background: narrationBackgroundsById.get(placement.backgroundId)
          || (index === 0 ? resolvedBackground : null),
        isPrimary: index === 0,
        opacity: 1,
        transitionRole: 'stable',
      }))
      : []
  ), [isNarrationOverlayActive, narrationBackgroundsById, resolvedBackground, resolvedNarrationPlacements]);
  const canonicalNarrationKey = useMemo(() => JSON.stringify(
    canonicalNarrationEntries.map((entry) => ({
      id: entry.placement.id,
      backgroundId: entry.placement.backgroundId,
      imageUrl: entry.background?.imageUrl || '',
      x: entry.placement.x,
      y: entry.placement.y,
      width: entry.placement.width,
      height: entry.placement.height,
      order: entry.placement.order,
    }))
  ), [canonicalNarrationEntries]);

  useEffect(() => {
    cancelNarrationImageAnimation();

    const previousEntries = previousNarrationEntriesRef.current;
    const currentVisualEntries = narrationImageTransitionRef.current.entries;
    const currentVisualByKey = new Map(currentVisualEntries.map((entry) => [entry.key, entry]));
    const previousKeys = new Set(previousEntries.map((entry) => entry.key));
    const nextKeys = new Set(canonicalNarrationEntries.map((entry) => entry.key));
    const sharedKeys = [...nextKeys].filter((key) => previousKeys.has(key));
    const entriesHaveChanged = previousEntries.length !== canonicalNarrationEntries.length
      || previousEntries.some((entry) => !nextKeys.has(entry.key));
    previousNarrationEntriesRef.current = canonicalNarrationEntries;

    const commitTransition = (nextState) => {
      narrationImageTransitionRef.current = nextState;
      setNarrationImageTransition(nextState);
    };

    if (prefersReducedMotion) {
      commitTransition({
        entries: canonicalNarrationEntries,
        boundsPlacements: canonicalNarrationEntries.map((entry) => entry.placement),
      });
      return undefined;
    }

    const animateEntries = ({ startEntries, endEntries, boundsPlacements, durationMs, onComplete }) => {
      const endOpacityByKey = new Map(endEntries.map((entry) => [entry.key, entry.opacity]));
      const startedAtMs = getAnimationTimestamp();
      commitTransition({ entries: startEntries, boundsPlacements });

      const step = (timestamp) => {
        const easedProgress = easeOutCubic(
          clampToRange((timestamp - startedAtMs) / durationMs, 0, 1)
        );
        const nextEntries = startEntries.map((entry) => ({
          ...entry,
          opacity: entry.opacity + (((endOpacityByKey.get(entry.key) ?? entry.opacity) - entry.opacity) * easedProgress),
        }));
        commitTransition({ entries: nextEntries, boundsPlacements });

        if (easedProgress >= 1) {
          narrationImageAnimationHandleRef.current = null;
          onComplete?.();
          return;
        }

        narrationImageAnimationHandleRef.current = requestAnimationFrameSafe(step);
      };

      narrationImageAnimationHandleRef.current = requestAnimationFrameSafe(step);
    };

    if (!previousEntries.length && canonicalNarrationEntries.length) {
      const incomingEntries = canonicalNarrationEntries.map((entry) => ({
        ...entry,
        opacity: 0,
        transitionRole: 'incoming',
      }));
      animateEntries({
        startEntries: incomingEntries,
        endEntries: canonicalNarrationEntries,
        boundsPlacements: canonicalNarrationEntries.map((entry) => entry.placement),
        durationMs: NARRATION_IMAGE_FADE_DURATION_MS,
        onComplete: () => commitTransition({
          entries: canonicalNarrationEntries,
          boundsPlacements: canonicalNarrationEntries.map((entry) => entry.placement),
        }),
      });
      return cancelNarrationImageAnimation;
    }

    if (previousEntries.length && !canonicalNarrationEntries.length) {
      const outgoingEntries = previousEntries.map((entry) => ({
        ...entry,
        opacity: currentVisualByKey.get(entry.key)?.opacity ?? 1,
        transitionRole: 'outgoing',
      }));
      animateEntries({
        startEntries: outgoingEntries,
        endEntries: outgoingEntries.map((entry) => ({ ...entry, opacity: 0 })),
        boundsPlacements: previousEntries.map((entry) => entry.placement),
        durationMs: NARRATION_IMAGE_FADE_DURATION_MS,
        onComplete: () => commitTransition({ entries: [], boundsPlacements: [] }),
      });
      return cancelNarrationImageAnimation;
    }

    if (previousEntries.length && canonicalNarrationEntries.length && sharedKeys.length === 0) {
      const outgoingEntries = previousEntries.map((entry) => ({
        ...entry,
        opacity: currentVisualByKey.get(entry.key)?.opacity ?? 1,
        transitionRole: 'outgoing',
      }));
      animateEntries({
        startEntries: outgoingEntries,
        endEntries: outgoingEntries.map((entry) => ({ ...entry, opacity: 0 })),
        boundsPlacements: previousEntries.map((entry) => entry.placement),
        durationMs: NARRATION_IMAGE_REPLACEMENT_PHASE_DURATION_MS,
        onComplete: () => {
          const incomingEntries = canonicalNarrationEntries.map((entry) => ({
            ...entry,
            opacity: 0,
            transitionRole: 'incoming',
          }));
          animateEntries({
            startEntries: incomingEntries,
            endEntries: canonicalNarrationEntries,
            boundsPlacements: canonicalNarrationEntries.map((entry) => entry.placement),
            durationMs: NARRATION_IMAGE_REPLACEMENT_PHASE_DURATION_MS,
            onComplete: () => commitTransition({
              entries: canonicalNarrationEntries,
              boundsPlacements: canonicalNarrationEntries.map((entry) => entry.placement),
            }),
          });
        },
      });
      return cancelNarrationImageAnimation;
    }

    if (entriesHaveChanged) {
      const nextByKey = new Map(canonicalNarrationEntries.map((entry) => [entry.key, entry]));
      const unionKeys = [...new Set([...previousEntries.map((entry) => entry.key), ...nextByKey.keys()])];
      const startEntries = unionKeys.map((key) => {
        const nextEntry = nextByKey.get(key);
        const previousEntry = previousEntries.find((entry) => entry.key === key);
        const currentEntry = currentVisualByKey.get(key);
        if (nextEntry) {
          return {
            ...nextEntry,
            opacity: currentEntry?.opacity ?? (previousEntry ? 1 : 0),
            transitionRole: previousEntry ? 'stable' : 'incoming',
          };
        }
        return {
          ...previousEntry,
          opacity: currentEntry?.opacity ?? 1,
          isPrimary: false,
          transitionRole: 'outgoing',
        };
      });
      const endEntries = startEntries.map((entry) => ({
        ...entry,
        opacity: nextByKey.has(entry.key) ? 1 : 0,
      }));
      animateEntries({
        startEntries,
        endEntries,
        boundsPlacements: startEntries.map((entry) => entry.placement),
        durationMs: NARRATION_IMAGE_FADE_DURATION_MS,
        onComplete: () => commitTransition({
          entries: canonicalNarrationEntries,
          boundsPlacements: canonicalNarrationEntries.map((entry) => entry.placement),
        }),
      });
      return cancelNarrationImageAnimation;
    }

    commitTransition({
      entries: canonicalNarrationEntries,
      boundsPlacements: canonicalNarrationEntries.map((entry) => entry.placement),
    });
    return undefined;
  // canonicalNarrationKey is the stable scene contract; entry objects may be rebuilt
  // when callers rely on default array props even though the scene is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelNarrationImageAnimation, canonicalNarrationKey, prefersReducedMotion]);

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
    battlemapImageAnimationLayersRef.current = { fromLayer, toLayer };

    setBattlemapImageTransition({
      visibleLayer: initialVisibleLayer,
      fadingOutLayer: initialFadingOutLayer,
    });

    const step = (timestamp) => {
      const animationLayers = battlemapImageAnimationLayersRef.current;
      const currentFromLayer = animationLayers?.fromLayer || null;
      const currentToLayer = animationLayers?.toLayer || null;
      const easedProgress = easeOutCubic(
        clampToRange((timestamp - startedAtMs) / BATTLEMAP_IMAGE_FADE_DURATION_MS, 0, 1)
      );

      setBattlemapImageTransition({
        visibleLayer: currentToLayer
          ? { ...currentToLayer, opacity: easedProgress }
          : null,
        fadingOutLayer: currentFromLayer
          ? { ...currentFromLayer, opacity: 1 - easedProgress }
          : null,
      });

      if (easedProgress >= 1) {
        battlemapImageAnimationHandleRef.current = null;
        battlemapImageAnimationLayersRef.current = null;
        setBattlemapImageTransition({
          visibleLayer: currentToLayer ? { ...currentToLayer, opacity: 1 } : null,
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
      const activeAnimationLayers = battlemapImageAnimationLayersRef.current;
      const isAnimatingSameSource = !!battlemapImageAnimationHandleRef.current
        && activeAnimationLayers?.toLayer?.src === targetBattlemapImageLayer.src;

      if (isAnimatingSameSource) {
        activeAnimationLayers.toLayer = {
          ...activeAnimationLayers.toLayer,
          ...targetBattlemapImageLayer,
        };
      } else {
        cancelBattlemapImageAnimation();
      }

      setBattlemapImageTransition((currentState) => ({
        visibleLayer: currentState.visibleLayer?.src === targetBattlemapImageLayer.src
          ? {
            ...currentState.visibleLayer,
            ...targetBattlemapImageLayer,
            opacity: isAnimatingSameSource ? currentState.visibleLayer.opacity ?? 0 : 1,
          }
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

  const battlemapVideoFrameKey = useMemo(() => ([
    battlemapImageTransition.visibleLayer,
    battlemapImageTransition.fadingOutLayer,
  ]
    .filter((layer) => layer?.assetType === 'video' && layer?.src)
    .map((layer) => layer.src)
    .join('|')), [
    battlemapImageTransition.fadingOutLayer,
    battlemapImageTransition.visibleLayer,
  ]);

  useEffect(() => {
    cancelBattlemapVideoFrameAnimation();

    if (!battlemapVideoFrameKey) {
      return undefined;
    }

    let isActive = true;
    const drawFrame = () => {
      if (!isActive) return;

      const stage = stageRef.current;
      if (typeof stage?.batchDraw === 'function') {
        stage.batchDraw();
      }
      if (typeof stage?.getLayers === 'function') {
        stage.getLayers().forEach((layer) => {
          if (typeof layer?.batchDraw === 'function') {
            layer.batchDraw();
          }
        });
      }

      battlemapVideoFrameAnimationHandleRef.current = requestAnimationFrameSafe(drawFrame);
    };

    battlemapVideoFrameAnimationHandleRef.current = requestAnimationFrameSafe(drawFrame);

    return () => {
      isActive = false;
      cancelBattlemapVideoFrameAnimation();
    };
  }, [battlemapVideoFrameKey, cancelBattlemapVideoFrameAnimation]);

  const placedTokens = useMemo(
    () => (tokens || []).filter((token) => token?.placed),
    [tokens]
  );

  const tokenItems = useMemo(
    () => sortTokensByLayerOrder(placedTokens, resolvedBackground?.tokenLayerOrder).map((token) => {
      const tokenId = token.id || token.ownerUid;
      const canMove = !!tokenId && (isManager || token.ownerUid === currentUserId || tokenId === currentUserId);
      return {
        ...token,
        tokenId,
        canMove,
        position: getTokenPositionPx(token, normalizedGrid),
      };
    }),
    [placedTokens, resolvedBackground?.tokenLayerOrder, isManager, currentUserId, normalizedGrid]
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

  useEffect(() => {
    setTurnOrderInitiativeRoller(null);

    if (
      !turnOrderJoinPromptTokenId
      || !activeTurnOrderJoinToken
      || !['character', 'foe'].includes(activeTurnOrderJoinToken.tokenType || 'character')
      || !onResolveTurnOrderInitiativeRoll
    ) {
      setTurnOrderInitiativeRollState({ tokenId: '', status: 'idle', config: null });
      return undefined;
    }

    let isActive = true;
    setTurnOrderInitiativeRollState({
      tokenId: turnOrderJoinPromptTokenId,
      status: 'loading',
      config: null,
    });

    Promise.resolve(onResolveTurnOrderInitiativeRoll(turnOrderJoinPromptTokenId))
      .then((config) => {
        if (!isActive) return;
        setTurnOrderInitiativeRollState({
          tokenId: turnOrderJoinPromptTokenId,
          status: config ? 'available' : 'unavailable',
          config: config || null,
        });
      })
      .catch((error) => {
        if (!isActive) return;
        console.warn('Failed to resolve the token initiative roll:', error);
        setTurnOrderInitiativeRollState({
          tokenId: turnOrderJoinPromptTokenId,
          status: 'error',
          config: null,
        });
      });

    return () => {
      isActive = false;
    };
  }, [
    activeTurnOrderJoinToken,
    onResolveTurnOrderInitiativeRoll,
    turnOrderJoinPromptTokenId,
  ]);

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
    () => tokenItems.map((token) => {
      const dragPosition = dragPositionOverrides.get(token.tokenId);

      return {
        ...token,
        renderPosition: dragPosition || token.position,
        isDragPreview: !!dragPosition,
        isActiveTurn: token.tokenId === activeTurnTokenId,
        isSelected: selectedTokenIdSet.has(token.tokenId),
      };
    }),
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
  const editableLightSources = useMemo(
    () => normalizeEditableLightSources(lightSourceControls?.lights),
    [lightSourceControls?.lights]
  );
  const renderedLightSources = useMemo(
    () => editableLightSources.map((light) => (
      lightDragState?.lightId === light.id
        ? {
          ...light,
          x: lightDragState.originLight.x + lightDragState.deltaWorld.x,
          y: lightDragState.originLight.y + lightDragState.deltaWorld.y,
        }
        : light
    )),
    [editableLightSources, lightDragState]
  );
  const selectedLight = useMemo(
    () => renderedLightSources.find((light) => light.id === selectedLightId) || null,
    [renderedLightSources, selectedLightId]
  );
  const editableDarknessSources = useMemo(
    () => normalizeEditableDarknessSources(darknessSourceControls?.darknessSources),
    [darknessSourceControls?.darknessSources]
  );
  const renderedDarknessSources = useMemo(
    () => editableDarknessSources.map((darkness) => (
      darknessDragState?.darknessId === darkness.id
        ? {
          ...darkness,
          x: darknessDragState.originDarkness.x + darknessDragState.deltaWorld.x,
          y: darknessDragState.originDarkness.y + darknessDragState.deltaWorld.y,
        }
        : darkness
    )),
    [darknessDragState, editableDarknessSources]
  );
  const selectedDarkness = useMemo(
    () => renderedDarknessSources.find((darkness) => darkness.id === selectedDarknessId) || null,
    [renderedDarknessSources, selectedDarknessId]
  );
  const editableWallSources = useMemo(
    () => normalizeEditableWallSegments(wallSourceControls?.walls),
    [wallSourceControls?.walls]
  );
  const renderedWallSources = useMemo(
    () => editableWallSources.map((wall) => {
      if (wallDragState?.wallId !== wall.id) {
        return wall;
      }

      if (wallDragState.type === 'endpoint') {
        return {
          ...wall,
          ...(wallDragState.endpoint === 'start'
            ? { x1: wallDragState.point.x, y1: wallDragState.point.y }
            : { x2: wallDragState.point.x, y2: wallDragState.point.y }),
        };
      }

      if (wallDragState.type === 'segment') {
        return {
          ...wall,
          x1: wall.x1 + wallDragState.deltaWorld.x,
          y1: wall.y1 + wallDragState.deltaWorld.y,
          x2: wall.x2 + wallDragState.deltaWorld.x,
          y2: wall.y2 + wallDragState.deltaWorld.y,
        };
      }

      return wall;
    }),
    [editableWallSources, wallDragState]
  );
  const selectedWall = useMemo(
    () => renderedWallSources.find((wall) => wall.id === selectedWallId) || null,
    [renderedWallSources, selectedWallId]
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
  const isNarrationVisualActive = narrationImageTransition.entries.length > 0;
  const narrationImageBounds = useMemo(
    () => (isNarrationVisualActive
      ? buildNarrationPlacementBounds(narrationImageTransition.boundsPlacements) || buildNarrationImageBounds(resolvedBackground)
      : null),
    [isNarrationVisualActive, narrationImageTransition.boundsPlacements, resolvedBackground]
  );
  const viewportFitBounds = narrationImageBounds || boardBounds;
  const backplateBounds = narrationImageBounds || boardBounds;
  const backplatePadding = narrationImageBounds ? 0 : normalizedGrid.cellSizePx;
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
  const fogVisibleRenderedTokens = useMemo(
    () => filterFogVisibleTokens({
      tokens: renderedTokens,
      currentUserId: resolvedFogViewerUserId,
      isManager: resolvedIsFogViewerManager,
      grid: normalizedGrid,
      fogOfWar,
    }),
    [fogOfWar, normalizedGrid, renderedTokens, resolvedFogViewerUserId, resolvedIsFogViewerManager]
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

  const schedulePingHoldForActiveInteraction = useCallback((expectedTypes) => {
    const activeInteraction = interactionRef.current;
    const activePingPoint = activeInteraction?.pingWorld || activeInteraction?.startWorld;
    if (
      !activeInteraction?.canTriggerPing
      || !Number.isFinite(activePingPoint?.x)
      || !Number.isFinite(activePingPoint?.y)
    ) {
      return;
    }

    clearPingHoldTimer();
    const expectedTypeSet = new Set(Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes]);
    pingHoldTimeoutRef.current = window.setTimeout(() => {
      pingHoldTimeoutRef.current = null;
      const currentInteraction = interactionRef.current;
      if (
        !expectedTypeSet.has(currentInteraction?.type)
        || !currentInteraction.canTriggerPing
      ) {
        return;
      }

      spawnMapPing(currentInteraction.pingWorld || currentInteraction.startWorld, { broadcast: true });
      interactionRef.current = {
        ...currentInteraction,
        type: 'ping-hold',
      };
    }, MAP_PING_HOLD_DELAY_MS);
  }, [clearPingHoldTimer, spawnMapPing]);

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

  const fitKey = [
    resolvedBackground?.id || '__no_active_background__',
    isNarrationOverlayActive ? 'narration' : 'board',
    narrationImageBounds
      ? `${narrationImageBounds.minX},${narrationImageBounds.minY},${narrationImageBounds.maxX},${narrationImageBounds.maxY}`
      : '',
  ].join('::');

  const fitToBoard = useCallback(() => {
    if (!stageSize.width || !stageSize.height) return;
    setViewport(fitViewportToBounds(viewportFitBounds, stageSize.width, stageSize.height, BOARD_FIT_PADDING));
    lastFitKeyRef.current = fitKey;
  }, [fitKey, stageSize.height, stageSize.width, viewportFitBounds]);

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
    setSelectedLightId('');
    setLightDragState(null);
    setSelectedDarknessId('');
    setDarknessDragState(null);
    setSelectedWallId('');
    setWallDragState(null);
    setWallCreatePreview(null);
    setLocalPings([]);
    setPingAnimationClock(Date.now());
    clearActiveSharedInteraction();
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
    setHoveredTokenTooltipId('');
  }, [clearActiveSharedInteraction, clearPingBroadcastTimer, clearPingHoldTimer, fitKey]);

  useEffect(() => {
    if (!isNarrationOverlayActive) {
      return;
    }

    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setSelectedTokenIds([]);
    setSelectedAoEFigureId('');
    setSelectedLightId('');
    setLightDragState(null);
    setSelectedDarknessId('');
    setDarknessDragState(null);
    setSelectedWallId('');
    setWallDragState(null);
    setWallCreatePreview(null);
    clearActiveSharedInteraction();
    setHoveredTokenTooltipId('');
  }, [clearActiveSharedInteraction, isNarrationOverlayActive]);

  useEffect(() => {
    if (!isRulerEnabled) {
      setMeasurementState(null);
    }
    if (!activeAoeFigureType) {
      setAoEPreviewState(null);
    }
    if (
      !isRulerEnabled
      && !activeAoeFigureType
      && !isLightToolActive
      && !isDarknessToolActive
      && !isWallToolActive
      && !isFogBrushToolActive
    ) {
      clearActiveSharedInteraction();
    }
  }, [
    activeAoeFigureType,
    clearActiveSharedInteraction,
    isDarknessToolActive,
    isFogBrushToolActive,
    isLightToolActive,
    isRulerEnabled,
    isWallToolActive,
  ]);

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

    if (prefersReducedMotion) {
      const expirationTimes = [
        ...localPings.map((ping) => ping.startedAtMs + MAP_PING_VISIBLE_MS),
        ...(sharedInteractions || [])
          .filter((interaction) => interaction?.type === 'ping' && interaction.ownerUid !== currentUserId)
          .map((interaction) => interaction.startedAtMs + MAP_PING_VISIBLE_MS),
      ].filter((expiresAtMs) => Number.isFinite(expiresAtMs) && expiresAtMs > Date.now());
      const nextExpirationMs = expirationTimes.length
        ? Math.min(...expirationTimes)
        : Date.now() + MAP_PING_VISIBLE_MS;
      const timeoutId = window.setTimeout(() => {
        setPingAnimationClock(Date.now());
      }, Math.max(0, nextExpirationMs - Date.now()) + 16);

      return () => window.clearTimeout(timeoutId);
    }

    let frameHandle = null;
    const updatePingFrame = () => {
      setPingAnimationClock(Date.now());
      frameHandle = requestAnimationFrameSafe(updatePingFrame);
    };

    frameHandle = requestAnimationFrameSafe(updatePingFrame);

    return () => cancelAnimationFrameSafe(frameHandle);
  }, [
    currentUserId,
    hasVisibleRemotePing,
    localPings,
    prefersReducedMotion,
    sharedInteractions,
    visibleLocalPings.length,
  ]);

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
    if (!turnOrderJoinPromptTokenId) {
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
  }, [turnOrderJoinPromptTokenId]);

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
    if (!selectedLightId) return;
    if (!editableLightSources.some((light) => light.id === selectedLightId)) {
      setSelectedLightId('');
    }
  }, [editableLightSources, selectedLightId]);

  useEffect(() => {
    if (!selectedDarknessId) return;
    if (!editableDarknessSources.some((darkness) => darkness.id === selectedDarknessId)) {
      setSelectedDarknessId('');
    }
  }, [editableDarknessSources, selectedDarknessId]);

  useEffect(() => {
    if (!selectedWallId) return;
    if (!editableWallSources.some((wall) => wall.id === selectedWallId)) {
      setSelectedWallId('');
    }
  }, [editableWallSources, selectedWallId]);

  useEffect(() => {
    const controlledSelectedLightId = lightSourceControls?.selectedLightId;
    if (typeof controlledSelectedLightId !== 'string') return;
    setSelectedLightId(controlledSelectedLightId);
  }, [lightSourceControls?.selectedLightId]);

  useEffect(() => {
    const controlledSelectedDarknessId = darknessSourceControls?.selectedDarknessId;
    if (typeof controlledSelectedDarknessId !== 'string') return;
    setSelectedDarknessId(controlledSelectedDarknessId);
  }, [darknessSourceControls?.selectedDarknessId]);

  useEffect(() => {
    const controlledSelectedWallId = wallSourceControls?.selectedWallId;
    if (typeof controlledSelectedWallId !== 'string') return;
    setSelectedWallId(controlledSelectedWallId);
  }, [wallSourceControls?.selectedWallId]);

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
    setHoveredTokenTooltipId('');
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

  const paintFogBrushAtPoint = useCallback((point) => {
    if (
      !point
      || !isFogBrushToolActive
      || !fogBrushControls?.onPaintFogBrush
    ) {
      return false;
    }

    void Promise.resolve(fogBrushControls.onPaintFogBrush({
      point,
      mode: fogBrushSettings.mode,
      radiusSquares: fogBrushSettings.radiusSquares,
    })).catch((error) => {
      console.error('Failed to paint Grigliata fog brush:', error);
    });
    return true;
  }, [
    fogBrushControls,
    fogBrushSettings.mode,
    fogBrushSettings.radiusSquares,
    isFogBrushToolActive,
  ]);

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

  const getDraggedLightPoint = useCallback((interaction, pointerWorld) => {
    if (!pointerWorld || !interaction?.originLight || !interaction?.startWorld) {
      return null;
    }

    const deltaWorld = {
      x: pointerWorld.x - interaction.startWorld.x,
      y: pointerWorld.y - interaction.startWorld.y,
    };

    return {
      deltaWorld,
      point: {
        x: interaction.originLight.x + deltaWorld.x,
        y: interaction.originLight.y + deltaWorld.y,
      },
    };
  }, []);

  const getDraggedDarknessPoint = useCallback((interaction, pointerWorld) => {
    if (!pointerWorld || !interaction?.originDarkness || !interaction?.startWorld) {
      return null;
    }

    const deltaWorld = {
      x: pointerWorld.x - interaction.startWorld.x,
      y: pointerWorld.y - interaction.startWorld.y,
    };

    return {
      deltaWorld,
      point: {
        x: interaction.originDarkness.x + deltaWorld.x,
        y: interaction.originDarkness.y + deltaWorld.y,
      },
    };
  }, []);

  const getDraggedWallEndpointPoint = useCallback((interaction, pointerWorld) => {
    if (!pointerWorld || !interaction?.startWorld) {
      return null;
    }

    return {
      x: pointerWorld.x,
      y: pointerWorld.y,
    };
  }, []);

  const getDraggedWallSegmentDelta = useCallback((interaction, pointerWorld) => {
    if (!pointerWorld || !interaction?.startWorld) {
      return null;
    }

    return {
      x: pointerWorld.x - interaction.startWorld.x,
      y: pointerWorld.y - interaction.startWorld.y,
    };
  }, []);

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

  const beginActiveBoardToolInteraction = useCallback((nativeEvent) => {
    if (isNarrationOverlayActive || !isPrimaryMouseButton(nativeEvent)) {
      return false;
    }

    const pointerWorld = getWorldPointFromClient(nativeEvent.clientX, nativeEvent.clientY);
    if (!pointerWorld) {
      return false;
    }

    if (isWallToolActive && wallSourceControls?.onCreateWallSegment) {
      clearPingHoldTimer();
      nativeEvent.preventDefault?.();

      if (isWallSourcePending) {
        return true;
      }

      setMeasurementState(null);
      setAoEPreviewState(null);
      setSelectedAoEFigureId('');
      clearActiveSharedInteraction();
      setSelectedTokenIds([]);
      setSelectedLightId('');
      setSelectedDarknessId('');
      setSelectedWallId('');
      setSelectionBox(null);

      const preview = {
        startPoint: pointerWorld,
        endPoint: pointerWorld,
      };
      setWallCreatePreview(preview);
      interactionRef.current = {
        type: 'wall-create',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startWorld: pointerWorld,
        endPoint: pointerWorld,
      };
      return true;
    }

    if (isLightToolActive && lightSourceControls?.onCreateLightSource) {
      clearPingHoldTimer();
      nativeEvent.preventDefault?.();

      if (isLightSourcePending) {
        return true;
      }

      setMeasurementState(null);
      setAoEPreviewState(null);
      setSelectedAoEFigureId('');
      clearActiveSharedInteraction();
      setSelectedTokenIds([]);
      setSelectedDarknessId('');
      setSelectedWallId('');
      setSelectionBox(null);

      interactionRef.current = {
        type: 'light-create',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startWorld: pointerWorld,
        point: pointerWorld,
      };
      return true;
    }

    if (isDarknessToolActive && darknessSourceControls?.onCreateDarknessSource) {
      clearPingHoldTimer();
      nativeEvent.preventDefault?.();

      if (isDarknessSourcePending) {
        return true;
      }

      setMeasurementState(null);
      setAoEPreviewState(null);
      setSelectedAoEFigureId('');
      clearActiveSharedInteraction();
      setSelectedTokenIds([]);
      setSelectedLightId('');
      setSelectedDarknessId('');
      setSelectedWallId('');
      setSelectionBox(null);

      interactionRef.current = {
        type: 'darkness-create',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startWorld: pointerWorld,
        point: pointerWorld,
      };
      return true;
    }

    if (isFogBrushToolActive && fogBrushControls?.onPaintFogBrush) {
      clearPingHoldTimer();
      nativeEvent.preventDefault?.();
      setMeasurementState(null);
      setAoEPreviewState(null);
      setSelectedAoEFigureId('');
      clearActiveSharedInteraction();
      setSelectedTokenIds([]);
      setSelectedLightId('');
      setSelectedDarknessId('');
      setSelectedWallId('');
      setSelectionBox(null);

      paintFogBrushAtPoint(pointerWorld);
      interactionRef.current = {
        type: 'fog-brush',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startWorld: pointerWorld,
        lastWorld: pointerWorld,
      };
      return true;
    }

    if (activeAoeFigureType) {
      clearPingHoldTimer();
      nativeEvent.preventDefault?.();
      setMeasurementState(null);
      setAoEPreviewState(null);
      setSelectedAoEFigureId('');
      clearActiveSharedInteraction();
      setSelectedTokenIds([]);
      setSelectedLightId('');
      setSelectedDarknessId('');
      setSelectedWallId('');
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
      return true;
    }

    if (isRulerEnabled) {
      clearPingHoldTimer();
      nativeEvent.preventDefault?.();
      setMeasurementState(null);
      setAoEPreviewState(null);
      setSelectedAoEFigureId('');
      clearActiveSharedInteraction();
      setSelectedTokenIds([]);
      setSelectedLightId('');
      setSelectedDarknessId('');
      setSelectedWallId('');
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
      return true;
    }

    return false;
  }, [
    activeAoeFigureType,
    buildAoEFigureForDraft,
    clearActiveSharedInteraction,
    clearPingHoldTimer,
    darknessSourceControls,
    fogBrushControls,
    getWorldPointFromClient,
    isDarknessSourcePending,
    isDarknessToolActive,
    isFogBrushToolActive,
    isLightSourcePending,
    isLightToolActive,
    isNarrationOverlayActive,
    isRulerEnabled,
    isWallSourcePending,
    isWallToolActive,
    lightSourceControls,
    normalizedGrid,
    paintFogBrushAtPoint,
    syncSharedAoEInteraction,
    wallSourceControls,
  ]);

  const applyScale = (nextScale, pointer) => {
    const safeScale = Math.min(
      MAX_GRIGLIATA_VIEWPORT_SCALE,
      Math.max(MIN_GRIGLIATA_VIEWPORT_SCALE, nextScale)
    );
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

    if (activeInteraction.type === 'ping-candidate') {
      clearActiveSharedInteraction();
      return;
    }

    if (isPingHoldInteraction(activeInteraction)) {
      return;
    }

    if (activeInteraction.type === 'fog-brush') {
      clearActiveSharedInteraction();
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

    if (activeInteraction.type === 'light-create') {
      if (isLightSourcePending) {
        clearActiveSharedInteraction();
        return;
      }

      let didCreateLight = false;
      try {
        didCreateLight = !!(await Promise.resolve(lightSourceControls?.onCreateLightSource?.(activeInteraction.point)));
      } finally {
        clearActiveSharedInteraction();
      }

      if (didCreateLight) {
        setSelectedLightId('');
      }
      return;
    }

    if (activeInteraction.type === 'darkness-create') {
      if (isDarknessSourcePending) {
        clearActiveSharedInteraction();
        return;
      }

      let didCreateDarkness = false;
      try {
        didCreateDarkness = !!(await Promise.resolve(darknessSourceControls?.onCreateDarknessSource?.(activeInteraction.point)));
      } finally {
        clearActiveSharedInteraction();
      }

      if (didCreateDarkness) {
        setSelectedDarknessId('');
      }
      return;
    }

    if (activeInteraction.type === 'wall-create') {
      if (isWallSourcePending) {
        setWallCreatePreview(null);
        clearActiveSharedInteraction();
        return;
      }

      const endPoint = pointerWorld || wallCreatePreview?.endPoint || activeInteraction.endPoint;
      const startPoint = activeInteraction.startWorld;
      const hasLength = !!(
        endPoint
        && Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y) >= 0.5
      );

      try {
        if (hasLength) {
          await Promise.resolve(wallSourceControls?.onCreateWallSegment?.(startPoint, endPoint));
        }
      } finally {
        setWallCreatePreview(null);
        clearActiveSharedInteraction();
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

    if (activeInteraction.type === 'token-context-candidate') {
      return;
    }

    if (isLightDragInteraction(activeInteraction)) {
      if (activeInteraction.type === 'light-drag-candidate') {
        setLightDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      if (isLightSourcePending) {
        setLightDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      const dragPoint = pointerWorld
        ? getDraggedLightPoint(activeInteraction, pointerWorld)
        : null;
      const nextPoint = dragPoint?.point || (
        lightDragState
          ? {
            x: lightDragState.originLight.x + lightDragState.deltaWorld.x,
            y: lightDragState.originLight.y + lightDragState.deltaWorld.y,
          }
          : activeInteraction.originLight
      );
      const hasMoved = !!(
        nextPoint
        && activeInteraction.originLight
        && (
          Math.abs(nextPoint.x - activeInteraction.originLight.x) >= 0.5
          || Math.abs(nextPoint.y - activeInteraction.originLight.y) >= 0.5
        )
      );

      try {
        if (hasMoved && activeInteraction.lightId && nextPoint) {
          await Promise.resolve(lightSourceControls?.onMoveLightSource?.(activeInteraction.lightId, nextPoint));
        }
      } finally {
        setLightDragState(null);
        clearActiveSharedInteraction();
      }
      return;
    }

    if (isDarknessDragInteraction(activeInteraction)) {
      if (activeInteraction.type === 'darkness-drag-candidate') {
        setDarknessDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      if (isDarknessSourcePending) {
        setDarknessDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      const dragPoint = pointerWorld
        ? getDraggedDarknessPoint(activeInteraction, pointerWorld)
        : null;
      const nextPoint = dragPoint?.point || (
        darknessDragState
          ? {
            x: darknessDragState.originDarkness.x + darknessDragState.deltaWorld.x,
            y: darknessDragState.originDarkness.y + darknessDragState.deltaWorld.y,
          }
          : activeInteraction.originDarkness
      );
      const hasMoved = !!(
        nextPoint
        && activeInteraction.originDarkness
        && (
          Math.abs(nextPoint.x - activeInteraction.originDarkness.x) >= 0.5
          || Math.abs(nextPoint.y - activeInteraction.originDarkness.y) >= 0.5
        )
      );

      try {
        if (hasMoved && activeInteraction.darknessId && nextPoint) {
          await Promise.resolve(darknessSourceControls?.onMoveDarknessSource?.(activeInteraction.darknessId, nextPoint));
        }
      } finally {
        setDarknessDragState(null);
        clearActiveSharedInteraction();
      }
      return;
    }

    if (activeInteraction.type === 'wall-endpoint-drag-candidate' || activeInteraction.type === 'wall-endpoint-drag') {
      if (activeInteraction.type === 'wall-endpoint-drag-candidate') {
        setWallDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      if (isWallSourcePending) {
        setWallDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      const nextPoint = pointerWorld
        ? getDraggedWallEndpointPoint(activeInteraction, pointerWorld)
        : wallDragState?.point;

      try {
        if (nextPoint && activeInteraction.wallId && activeInteraction.endpoint) {
          await Promise.resolve(wallSourceControls?.onMoveWallEndpoint?.(
            activeInteraction.wallId,
            activeInteraction.endpoint,
            nextPoint
          ));
        }
      } finally {
        setWallDragState(null);
        clearActiveSharedInteraction();
      }
      return;
    }

    if (activeInteraction.type === 'wall-segment-drag-candidate' || activeInteraction.type === 'wall-segment-drag') {
      if (activeInteraction.type === 'wall-segment-drag-candidate') {
        setWallDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      if (isWallSourcePending) {
        setWallDragState(null);
        clearActiveSharedInteraction();
        return;
      }

      const deltaWorld = pointerWorld
        ? getDraggedWallSegmentDelta(activeInteraction, pointerWorld)
        : wallDragState?.deltaWorld;

      try {
        if (deltaWorld && activeInteraction.wallId) {
          await Promise.resolve(wallSourceControls?.onMoveWallSegment?.(
            activeInteraction.wallId,
            deltaWorld
          ));
        }
      } finally {
        setWallDragState(null);
        clearActiveSharedInteraction();
      }
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
    darknessDragState,
    darknessSourceControls,
    getDraggedAoEFigureDraft,
    getDraggedDarknessPoint,
    getDraggedLightPoint,
    getDraggedTokenMeasurement,
    getDraggedWallEndpointPoint,
    getDraggedWallSegmentDelta,
    getWorldPointFromClient,
    isDarknessSourcePending,
    isLightSourcePending,
    isWallSourcePending,
    lightDragState,
    lightSourceControls,
    normalizedGrid,
    onCreateAoEFigure,
    onMoveAoEFigure,
    onMoveTokens,
    selectionBox,
    tokenDragState,
    tokenItems,
    clearPingHoldTimer,
    wallCreatePreview,
    wallDragState,
    wallSourceControls,
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

      const hasMovedBeyondThreshold = (
        Math.abs(event.clientX - activeInteraction.startClient.x) >= POINTER_DRAG_THRESHOLD_PX
        || Math.abs(event.clientY - activeInteraction.startClient.y) >= POINTER_DRAG_THRESHOLD_PX
      );

      if (activeInteraction.type === 'token-context-candidate') {
        if (!hasMovedBeyondThreshold) return;

        suppressNextTokenContextMenuRef.current = true;
        const nextInteraction = {
          type: 'pan',
          startClient: activeInteraction.startClient,
          startViewport: activeInteraction.startViewport,
        };
        interactionRef.current = nextInteraction;
        setViewport({
          ...activeInteraction.startViewport,
          x: activeInteraction.startViewport.x + (event.clientX - activeInteraction.startClient.x),
          y: activeInteraction.startViewport.y + (event.clientY - activeInteraction.startClient.y),
        });
        clearActiveSharedInteraction();
        return;
      }

      if (activeInteraction.type === 'ping-candidate') {
        if (!hasMovedBeyondThreshold) return;

        clearPingHoldTimer();
        interactionRef.current = null;
        clearActiveSharedInteraction();
        return;
      }

      const pointerWorld = getWorldPointFromClient(event.clientX, event.clientY);
      if (!pointerWorld) return;

      if (activeInteraction.type === 'fog-brush') {
        paintFogBrushAtPoint(pointerWorld);
        interactionRef.current = {
          ...activeInteraction,
          lastWorld: pointerWorld,
        };
        clearActiveSharedInteraction();
        return;
      }

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

      if (activeInteraction.type === 'wall-create') {
        const nextInteraction = {
          ...activeInteraction,
          endPoint: pointerWorld,
        };
        interactionRef.current = nextInteraction;
        setWallCreatePreview({
          startPoint: activeInteraction.startWorld,
          endPoint: pointerWorld,
        });
        clearActiveSharedInteraction();
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

      if (isLightDragInteraction(activeInteraction)) {
        if (activeInteraction.type === 'light-drag-candidate' && !hasMovedBeyondThreshold) return;

        const dragPoint = getDraggedLightPoint(activeInteraction, pointerWorld);
        if (!dragPoint) return;

        if (activeInteraction.type === 'light-drag-candidate') {
          interactionRef.current = {
            ...activeInteraction,
            type: 'light-drag',
          };
        }

        setLightDragState({
          lightId: activeInteraction.lightId,
          originLight: activeInteraction.originLight,
          deltaWorld: dragPoint.deltaWorld,
        });
        clearActiveSharedInteraction();
        return;
      }

      if (isDarknessDragInteraction(activeInteraction)) {
        if (activeInteraction.type === 'darkness-drag-candidate' && !hasMovedBeyondThreshold) return;

        const dragPoint = getDraggedDarknessPoint(activeInteraction, pointerWorld);
        if (!dragPoint) return;

        if (activeInteraction.type === 'darkness-drag-candidate') {
          interactionRef.current = {
            ...activeInteraction,
            type: 'darkness-drag',
          };
        }

        setDarknessDragState({
          darknessId: activeInteraction.darknessId,
          originDarkness: activeInteraction.originDarkness,
          deltaWorld: dragPoint.deltaWorld,
        });
        clearActiveSharedInteraction();
        return;
      }

      if (activeInteraction.type === 'wall-endpoint-drag-candidate' || activeInteraction.type === 'wall-endpoint-drag') {
        if (activeInteraction.type === 'wall-endpoint-drag-candidate' && !hasMovedBeyondThreshold) return;

        const point = getDraggedWallEndpointPoint(activeInteraction, pointerWorld);
        if (!point) return;

        if (activeInteraction.type === 'wall-endpoint-drag-candidate') {
          interactionRef.current = {
            ...activeInteraction,
            type: 'wall-endpoint-drag',
          };
        }

        setWallDragState({
          type: 'endpoint',
          wallId: activeInteraction.wallId,
          endpoint: activeInteraction.endpoint,
          point,
        });
        clearActiveSharedInteraction();
        return;
      }

      if (activeInteraction.type === 'wall-segment-drag-candidate' || activeInteraction.type === 'wall-segment-drag') {
        if (activeInteraction.type === 'wall-segment-drag-candidate' && !hasMovedBeyondThreshold) return;

        const deltaWorld = getDraggedWallSegmentDelta(activeInteraction, pointerWorld);
        if (!deltaWorld) return;

        if (activeInteraction.type === 'wall-segment-drag-candidate') {
          interactionRef.current = {
            ...activeInteraction,
            type: 'wall-segment-drag',
          };
        }

        setWallDragState({
          type: 'segment',
          wallId: activeInteraction.wallId,
          deltaWorld,
        });
        clearActiveSharedInteraction();
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

        clearPingHoldTimer();
        const draggedOriginToken = activeInteraction.originTokens.find(
          (originToken) => originToken.tokenId === activeInteraction.draggedTokenId
        );
        const shouldMeasureTokenDrag = activeInteraction.measurementSource === 'token-drag';
        const nextInteraction = {
          ...activeInteraction,
          type: 'token-drag',
          anchorCells: shouldMeasureTokenDrag
            ? [{
              col: draggedOriginToken?.col ?? 0,
              row: draggedOriginToken?.row ?? 0,
            }]
            : null,
          measurementSource: shouldMeasureTokenDrag ? 'token-drag' : null,
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

        if (
          currentInteraction.measurementSource === 'token-drag'
          && Array.isArray(currentInteraction.anchorCells)
        ) {
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
      } else if (activeInteraction.type === 'token-context-candidate') {
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
    getDraggedDarknessPoint,
    getDraggedLightPoint,
    getDraggedWallEndpointPoint,
    getDraggedWallSegmentDelta,
    clearActiveSharedInteraction,
    syncSharedAoEInteraction,
    finalizeInteraction,
    getDraggedTokenMeasurement,
    getWorldPointFromClient,
    isRulerEnabled,
    normalizedGrid,
    paintFogBrushAtPoint,
    syncSharedMeasureInteraction,
    clearPingHoldTimer,
  ]);

  useEffect(() => {
    const handleKeyDown = async (event) => {
      if (isEditableElementFocused()) return;

      if (event.key !== 'Delete' && event.code !== 'Delete') return;

      if (!selectedLightId && !selectedDarknessId && !selectedWallId && !selectedAoEFigureId && !selectedTokenIds.length) return;

      event.preventDefault();

      if (selectedLightId) {
        if (isLightSourcePending) {
          return;
        }

        try {
          const didDeleteLight = !!(await Promise.resolve(lightSourceControls?.onDeleteLightSource?.(selectedLightId)));
          if (didDeleteLight) {
            setSelectedLightId('');
          }
        } catch {
          // preserve selection if deletion fails
        }
        return;
      }

      if (selectedDarknessId) {
        if (isDarknessSourcePending) {
          return;
        }

        try {
          const didDeleteDarkness = !!(await Promise.resolve(darknessSourceControls?.onDeleteDarknessSource?.(selectedDarknessId)));
          if (didDeleteDarkness) {
            setSelectedDarknessId('');
          }
        } catch {
          // preserve selection if deletion fails
        }
        return;
      }

      if (selectedWallId) {
        if (isWallSourcePending) {
          return;
        }

        try {
          const didDeleteWall = !!(await Promise.resolve(wallSourceControls?.onDeleteWallSegment?.(selectedWallId)));
          if (didDeleteWall) {
            setSelectedWallId('');
          }
        } catch {
          // preserve selection if deletion fails
        }
        return;
      }

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
  }, [darknessSourceControls, isDarknessSourcePending, isLightSourcePending, isWallSourcePending, lightSourceControls, onDeleteAoEFigures, onDeleteTokens, selectedAoEFigureId, selectedDarknessId, selectedLightId, selectedTokenIds, selectedWallId, wallSourceControls]);

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

  const handleSelectLightSource = useCallback((lightId) => {
    const nextLightId = lightId || '';
    setSelectedLightId(nextLightId);
    lightSourceControls?.onSelectLight?.(nextLightId);

    if (nextLightId) {
      setSelectedTokenIds([]);
      setSelectedAoEFigureId('');
      setSelectedDarknessId('');
      setSelectedWallId('');
      setSelectionBox(null);
    }
  }, [lightSourceControls]);

  const handleSelectDarknessSource = useCallback((darknessId) => {
    const nextDarknessId = darknessId || '';
    setSelectedDarknessId(nextDarknessId);
    darknessSourceControls?.onSelectDarkness?.(nextDarknessId);

    if (nextDarknessId) {
      setSelectedTokenIds([]);
      setSelectedAoEFigureId('');
      setSelectedLightId('');
      setSelectedWallId('');
      setSelectionBox(null);
    }
  }, [darknessSourceControls]);

  const handleLightSourceMouseDown = useCallback((light, event) => {
    const nativeEvent = event.evt;
    event.cancelBubble = true;
    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
    clearPingHoldTimer();

    if (
      activeAoeFigureType
      || isRulerEnabled
      || isDarknessToolActive
      || isWallToolActive
      || isFogBrushToolActive
    ) {
      if (beginActiveBoardToolInteraction(nativeEvent)) {
        return;
      }
    }

    if (!light?.id || isNarrationOverlayActive || activeAoeFigureType || isRulerEnabled || isLightSourcePending) {
      return;
    }

    if (!isPrimaryMouseButton(nativeEvent)) {
      return;
    }

    const pointerWorld = getWorldPointFromClient(nativeEvent.clientX, nativeEvent.clientY);
    if (!pointerWorld) return;

    handleSelectLightSource(light.id);
    setMeasurementState(null);
    setAoEPreviewState(null);
    setSelectedAoEFigureId('');
    setSelectedTokenIds([]);
    setSelectionBox(null);
    clearActiveSharedInteraction();

    interactionRef.current = {
      type: 'light-drag-candidate',
      lightId: light.id,
      startClient: {
        x: nativeEvent.clientX,
        y: nativeEvent.clientY,
      },
      startWorld: pointerWorld,
      originLight: {
        x: light.x,
        y: light.y,
      },
    };
  }, [
    activeAoeFigureType,
    beginActiveBoardToolInteraction,
    clearActiveSharedInteraction,
    clearPingHoldTimer,
    getWorldPointFromClient,
    handleSelectLightSource,
    isDarknessToolActive,
    isFogBrushToolActive,
    isNarrationOverlayActive,
    isLightSourcePending,
    isRulerEnabled,
    isWallToolActive,
  ]);

  const handleDarknessSourceMouseDown = useCallback((darkness, event) => {
    const nativeEvent = event.evt;
    event.cancelBubble = true;
    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
    clearPingHoldTimer();

    if (
      activeAoeFigureType
      || isRulerEnabled
      || isLightToolActive
      || isWallToolActive
      || isFogBrushToolActive
    ) {
      if (beginActiveBoardToolInteraction(nativeEvent)) {
        return;
      }
    }

    if (!darkness?.id || isNarrationOverlayActive || activeAoeFigureType || isRulerEnabled || isDarknessSourcePending) {
      return;
    }

    if (!isPrimaryMouseButton(nativeEvent)) {
      return;
    }

    const pointerWorld = getWorldPointFromClient(nativeEvent.clientX, nativeEvent.clientY);
    if (!pointerWorld) return;

    handleSelectDarknessSource(darkness.id);
    setMeasurementState(null);
    setAoEPreviewState(null);
    setSelectedAoEFigureId('');
    setSelectedLightId('');
    setSelectedWallId('');
    setSelectedTokenIds([]);
    setSelectionBox(null);
    clearActiveSharedInteraction();

    interactionRef.current = {
      type: 'darkness-drag-candidate',
      darknessId: darkness.id,
      startClient: {
        x: nativeEvent.clientX,
        y: nativeEvent.clientY,
      },
      startWorld: pointerWorld,
      originDarkness: {
        x: darkness.x,
        y: darkness.y,
      },
    };
  }, [
    activeAoeFigureType,
    beginActiveBoardToolInteraction,
    clearActiveSharedInteraction,
    clearPingHoldTimer,
    getWorldPointFromClient,
    handleSelectDarknessSource,
    isDarknessSourcePending,
    isFogBrushToolActive,
    isLightToolActive,
    isNarrationOverlayActive,
    isRulerEnabled,
    isWallToolActive,
  ]);

  const handleSelectWallSource = useCallback((wallId) => {
    const nextWallId = wallId || '';
    setSelectedWallId(nextWallId);
    wallSourceControls?.onSelectWall?.(nextWallId);

    if (nextWallId) {
      setSelectedTokenIds([]);
      setSelectedAoEFigureId('');
      setSelectedLightId('');
      setSelectedDarknessId('');
      setSelectionBox(null);
    }
  }, [wallSourceControls]);

  const handleWallEndpointMouseDown = useCallback((wall, endpoint, event) => {
    const nativeEvent = event.evt;
    event.cancelBubble = true;
    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
    clearPingHoldTimer();

    if (
      activeAoeFigureType
      || isRulerEnabled
      || isLightToolActive
      || isDarknessToolActive
      || isFogBrushToolActive
    ) {
      if (beginActiveBoardToolInteraction(nativeEvent)) {
        return;
      }
    }

    if (!wall?.id || isNarrationOverlayActive || !isWallToolActive || isWallSourcePending) {
      return;
    }

    if (!isPrimaryMouseButton(nativeEvent)) {
      return;
    }

    const pointerWorld = getWorldPointFromClient(nativeEvent.clientX, nativeEvent.clientY);
    if (!pointerWorld) return;

    handleSelectWallSource(wall.id);
    setMeasurementState(null);
    setAoEPreviewState(null);
    setSelectedAoEFigureId('');
    setSelectedLightId('');
    setSelectedDarknessId('');
    setSelectedTokenIds([]);
    setSelectionBox(null);
    clearActiveSharedInteraction();

    interactionRef.current = {
      type: 'wall-endpoint-drag-candidate',
      wallId: wall.id,
      endpoint,
      startClient: {
        x: nativeEvent.clientX,
        y: nativeEvent.clientY,
      },
      startWorld: pointerWorld,
    };
  }, [
    activeAoeFigureType,
    beginActiveBoardToolInteraction,
    clearActiveSharedInteraction,
    clearPingHoldTimer,
    getWorldPointFromClient,
    handleSelectWallSource,
    isDarknessToolActive,
    isFogBrushToolActive,
    isLightToolActive,
    isNarrationOverlayActive,
    isRulerEnabled,
    isWallSourcePending,
    isWallToolActive,
  ]);

  const handleWallSegmentMouseDown = useCallback((wall, event) => {
    const nativeEvent = event.evt;
    event.cancelBubble = true;
    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
    clearPingHoldTimer();

    if (
      activeAoeFigureType
      || isRulerEnabled
      || isLightToolActive
      || isDarknessToolActive
      || isFogBrushToolActive
    ) {
      if (beginActiveBoardToolInteraction(nativeEvent)) {
        return;
      }
    }

    if (!wall?.id || isNarrationOverlayActive || !isWallToolActive || isWallSourcePending) {
      return;
    }

    if (!isPrimaryMouseButton(nativeEvent)) {
      return;
    }

    const pointerWorld = getWorldPointFromClient(nativeEvent.clientX, nativeEvent.clientY);
    if (!pointerWorld) return;

    handleSelectWallSource(wall.id);
    setMeasurementState(null);
    setAoEPreviewState(null);
    setSelectedAoEFigureId('');
    setSelectedLightId('');
    setSelectedDarknessId('');
    setSelectedTokenIds([]);
    setSelectionBox(null);
    clearActiveSharedInteraction();

    interactionRef.current = {
      type: 'wall-segment-drag-candidate',
      wallId: wall.id,
      startClient: {
        x: nativeEvent.clientX,
        y: nativeEvent.clientY,
      },
      startWorld: pointerWorld,
    };
  }, [
    activeAoeFigureType,
    beginActiveBoardToolInteraction,
    clearActiveSharedInteraction,
    clearPingHoldTimer,
    getWorldPointFromClient,
    handleSelectWallSource,
    isDarknessToolActive,
    isFogBrushToolActive,
    isLightToolActive,
    isNarrationOverlayActive,
    isRulerEnabled,
    isWallSourcePending,
    isWallToolActive,
  ]);

  const handleStageMouseDown = (event) => {
    if (isTokenDragActive) return;

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

    if (beginActiveBoardToolInteraction(nativeEvent)) {
      return;
    }

    setMeasurementState(null);
    setAoEPreviewState(null);
    setSelectedAoEFigureId('');
    setSelectedLightId('');
    setSelectedDarknessId('');
    setSelectedWallId('');
    clearActiveSharedInteraction();

    interactionRef.current = {
      type: 'selection-candidate',
      startClient: {
        x: nativeEvent.clientX,
        y: nativeEvent.clientY,
      },
      startWorld: pointerWorld,
      canTriggerPing: isPointWithinBounds(pointerWorld, boardBounds),
    };

    schedulePingHoldForActiveInteraction('selection-candidate');
  };

  const handleTokenMouseDown = (token, event) => {
    const nativeEvent = event.evt;
    event.cancelBubble = true;
    setTurnOrderContextMenu(null);
    setTurnOrderJoinPrompt(null);
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
    clearPingHoldTimer();

    if (isSecondaryMouseButton(nativeEvent)) {
      suppressNextTokenContextMenuRef.current = false;
      nativeEvent.preventDefault();
      const activeInteraction = interactionRef.current;

      if (hasPrimaryMouseButtonPressed(nativeEvent)) {
        if (commitMeasurementWaypoint(nativeEvent.clientX, nativeEvent.clientY)) {
          return;
        }

        if (shouldSuppressTokenTurnOrderMenu(activeInteraction)) {
          return;
        }
      }

      interactionRef.current = {
        type: 'token-context-candidate',
        tokenId: token?.tokenId || '',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startViewport: viewport,
      };
      return;
    }

    if (!isPrimaryMouseButton(nativeEvent)) return;

    const shouldMoveTokenWhileMeasuring = !!(
      isRulerEnabled
      && isRulerTokenMovementEnabled
      && token?.canMove
    );
    if (!shouldMoveTokenWhileMeasuring && beginActiveBoardToolInteraction(nativeEvent)) {
      return;
    }

    const pointerWorld = getWorldPointFromClient(nativeEvent.clientX, nativeEvent.clientY);
    if (!pointerWorld) return;
    const tokenPingWorld = token?.position
      ? {
        x: token.position.x + (token.position.size / 2),
        y: token.position.y + (token.position.size / 2),
      }
      : pointerWorld;

    setMeasurementState(null);
    setAoEPreviewState(null);
    setSelectedAoEFigureId('');
    setSelectedLightId('');
    setSelectedDarknessId('');
    setSelectedWallId('');
    clearActiveSharedInteraction();

    if (!token?.canMove) {
      setSelectedTokenIds([]);
      interactionRef.current = {
        type: 'ping-candidate',
        tokenId: token?.tokenId || '',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startWorld: pointerWorld,
        canTriggerPing: true,
        pingWorld: tokenPingWorld,
      };
      schedulePingHoldForActiveInteraction('ping-candidate');
      return;
    }

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
      canTriggerPing: !isRulerEnabled,
      pingWorld: tokenPingWorld,
      measurementSource: shouldMoveTokenWhileMeasuring ? 'token-drag' : null,
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

    if (!isRulerEnabled) {
      schedulePingHoldForActiveInteraction('token-candidate');
    }
  };

  const handleTokenContextMenu = (token, event) => {
    event.cancelBubble = true;
    event.evt?.preventDefault?.();

    if (suppressNextTokenContextMenuRef.current) {
      suppressNextTokenContextMenuRef.current = false;
      return;
    }

    const activeInteraction = interactionRef.current;

    if (isRulerEnabled && shouldSuppressTokenTurnOrderMenu(activeInteraction)) {
      commitMeasurementWaypoint(event.evt?.clientX, event.evt?.clientY);
      return;
    }

    if (activeInteraction?.type === 'token-context-candidate') {
      interactionRef.current = null;
    }

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

    if (
      activeAoeFigureType
      || isRulerEnabled
      || isLightToolActive
      || isDarknessToolActive
      || isWallToolActive
      || isFogBrushToolActive
    ) {
      if (beginActiveBoardToolInteraction(nativeEvent)) {
        return;
      }
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
    setSelectedLightId('');
    setSelectedDarknessId('');
    setSelectedWallId('');

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
    () => fogVisibleRenderedTokens.filter((token) => selectedTokenIdSet.has(token.tokenId)),
    [fogVisibleRenderedTokens, selectedTokenIdSet]
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
      || !!selectedLight
      || lightDragState
      || !!selectedDarkness
      || darknessDragState
      || !!selectedWall
      || wallDragState
      || isFogBrushToolActive
    ) {
      return null;
    }

    return buildSelectedTokenActionState({
      selectedTokens,
      allTokens: renderedTokens,
      tokenLayerOrder: resolvedBackground?.tokenLayerOrder,
      isManager,
      stageSize,
      viewport,
    });
  }, [
    activeAoeFigureType,
    isManager,
    isTokenDragActive,
    isRulerEnabled,
    isFogBrushToolActive,
    darknessDragState,
    lightDragState,
    selectedAoEFigureId,
    selectedDarkness,
    selectedLight,
    selectedWall,
    selectedTokens,
    renderedTokens,
    resolvedBackground?.tokenLayerOrder,
    selectionBox,
    stageSize.height,
    stageSize.width,
    tokenDragState,
    wallDragState,
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
      || !!selectedLight
      || lightDragState
      || !!selectedDarkness
      || darknessDragState
      || !!selectedWall
      || wallDragState
      || isFogBrushToolActive
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
    isFogBrushToolActive,
    darknessDragState,
    lightDragState,
    selectedAoEFigureId,
    selectedDarkness,
    selectedLight,
    selectedWall,
    selectedTokenActionState,
    selectedTokenDetails,
    selectedTokens,
    selectionBox,
    stageSize.height,
    stageSize.width,
    tokenDragState,
    wallDragState,
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
      || !!selectedLight
      || lightDragState
      || !!selectedDarkness
      || darknessDragState
      || !!selectedWall
      || wallDragState
      || isFogBrushToolActive
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
    isFogBrushToolActive,
    darknessDragState,
    lightDragState,
    selectedAoEFigure,
    selectedDarkness,
    selectedLight,
    selectedWall,
    selectionBox,
    stageSize.height,
    stageSize.width,
    tokenDragState,
    wallDragState,
    viewport.scale,
    viewport.x,
    viewport.y,
  ]);
  const activeOverflowTokenId = pinnedOverflowTokenId || hoveredOverflowTokenId;
  const activeOverflowToken = useMemo(() => {
    if (!activeOverflowTokenId) {
      return null;
    }

    const token = fogVisibleRenderedTokens.find((entry) => entry.tokenId === activeOverflowTokenId);
    const overflowCount = tokenStatusDisplayById.get(activeOverflowTokenId)?.overflowCount || 0;
    if (!token || overflowCount < 1) {
      return null;
    }

    return token;
  }, [activeOverflowTokenId, fogVisibleRenderedTokens, tokenStatusDisplayById]);
  const hoveredTokenTooltip = useMemo(() => {
    if (!hoveredTokenTooltipId) {
      return null;
    }

    return fogVisibleRenderedTokens.find((entry) => entry.tokenId === hoveredTokenTooltipId) || null;
  }, [fogVisibleRenderedTokens, hoveredTokenTooltipId]);
  const hoveredTokenTooltipStyle = useMemo(() => {
    if (!hoveredTokenTooltip) {
      return null;
    }

    const tokenScreenLeft = viewport.x + (hoveredTokenTooltip.renderPosition.x * viewport.scale);
    const tokenScreenTop = viewport.y + (hoveredTokenTooltip.renderPosition.y * viewport.scale);
    const tokenScreenSize = hoveredTokenTooltip.renderPosition.size * viewport.scale;
    const tokenCenterX = tokenScreenLeft + (tokenScreenSize / 2);
    const preferredTop = tokenScreenTop - 10;
    const shouldOpenBelow = preferredTop < 40;
    return buildClampedTokenTooltipLayout({
      containerWidth: stageSize.width,
      anchorCenterX: tokenCenterX,
      preferredTop,
      preferredBottom: tokenScreenTop + tokenScreenSize + 10,
      label: hoveredTokenTooltip.label || hoveredTokenTooltip.characterId || hoveredTokenTooltip.ownerUid || 'Token',
      forceBelow: shouldOpenBelow,
    });
  }, [hoveredTokenTooltip, stageSize.width, viewport.scale, viewport.x, viewport.y]);
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
  const isNarrationPresentationActive = isNarrationOverlayActive || isNarrationVisualActive;
  const areTurnOrderControlsDisabled = isNarrationPresentationActive;
  const visibleRenderedAoEFigures = isNarrationPresentationActive ? [] : renderedAoEFigures;
  const visibleRenderedTokens = isNarrationPresentationActive ? [] : fogVisibleRenderedTokens;
  const visibleTokenRenderLayers = useMemo(
    () => splitFogVisibleTokenRenderLayers({
      tokens: visibleRenderedTokens,
      currentUserId: resolvedFogViewerUserId,
      isManager: resolvedIsFogViewerManager,
      grid: normalizedGrid,
      fogOfWar,
    }),
    [fogOfWar, normalizedGrid, resolvedFogViewerUserId, resolvedIsFogViewerManager, visibleRenderedTokens]
  );
  const visibleRenderedTokensBelowFog = visibleTokenRenderLayers.belowFogTokens;
  const visibleRenderedTokensAboveFog = visibleTokenRenderLayers.aboveFogTokens;
  const visibleRenderedSharedInteractions = isNarrationPresentationActive ? [] : renderedSharedInteractions;
  const visibleLocalPingsForRender = isNarrationPresentationActive ? [] : visibleLocalPings;
  const visibleMeasurementState = isNarrationPresentationActive ? null : measurementState;
  const visibleAoEPreviewState = isNarrationPresentationActive ? null : aoePreviewState;
  const visibleSelectedTokenHud = isNarrationPresentationActive ? null : selectedSingleTokenHudState;
  const visibleOverflowToken = isNarrationPresentationActive ? null : activeOverflowToken;
  const visibleHoveredTokenTooltip = isNarrationPresentationActive ? null : hoveredTokenTooltip;
  const visibleSelectedAoEFigureActionState = isNarrationPresentationActive ? null : selectedAoEFigureActionState;
  const visibleSelectedTokenActionState = isNarrationPresentationActive ? null : selectedTokenActionState;
  const narrationExtraImageCount = isNarrationOverlayActive ? Math.max(0, resolvedNarrationPlacements.length - 1) : 0;
  const visibleTokenVisionSources = useMemo(
    () => (isNarrationPresentationActive ? [] : resolveViewerTokenVisionSources({
      tokens: visibleRenderedTokens,
      currentUserId: resolvedFogViewerUserId,
      isManager: resolvedIsFogViewerManager,
      cellSizePx: normalizedGrid.cellSizePx,
      backgroundId: resolvedBackground?.id || '',
    })),
    [
      isNarrationPresentationActive,
      normalizedGrid.cellSizePx,
      resolvedBackground?.id,
      resolvedFogViewerUserId,
      resolvedIsFogViewerManager,
      visibleRenderedTokens,
    ]
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-950/80 shadow-2xl">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          {!isNarrationPresentationActive && (
            <p className="text-xs text-slate-400">
              {resolvedBackground?.name || 'Grid only'}
              {` | ${normalizedGrid.cellSizePx}px squares | 5 ft per square`}
            </p>
          )}
          {isNarrationPresentationActive && (
            <span
              data-testid="narration-overlay-badge"
              className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200"
            >
              Narration
            </span>
          )}
          {narrationExtraImageCount > 0 && (
            <span
              data-testid="narration-overlay-count-badge"
              className="rounded-full border border-violet-400/35 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200"
            >
              +{narrationExtraImageCount}
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
            disabled={isNarrationPresentationActive}
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
              disabled={isNarrationPresentationActive}
            />
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleRuler}
              disabled={isNarrationPresentationActive}
              title={isRulerEnabled ? 'Disable ruler mode' : 'Enable ruler mode'}
              aria-label={isRulerEnabled ? 'Disable ruler mode' : 'Enable ruler mode'}
              aria-pressed={isRulerEnabled}
              className={`${getQuickControlButtonClassName(isRulerEnabled)} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <FaRulerHorizontal className="h-4 w-4" />
            </button>
            {isRulerEnabled && (
              <button
                type="button"
                onClick={onToggleRulerTokenMovement}
                disabled={isNarrationPresentationActive || !onToggleRulerTokenMovement}
                title="Move tokens while measuring"
                aria-label="Move tokens while measuring"
                aria-pressed={isRulerTokenMovementEnabled}
                data-testid="ruler-token-move-toggle"
                className={`${getQuickControlButtonClassName(isRulerTokenMovementEnabled)} h-8 w-8 rounded-xl p-1.5 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <FiMove className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="pointer-events-auto">
            <AoETemplatePicker
              activeFigureType={activeAoeFigureType}
              onChange={onChangeAoeFigureType}
              disabled={isNarrationPresentationActive}
            />
          </div>
          {!isNarrationPresentationActive && isManager && lightSourceControls?.onCreateLightSource && (
            <button
              type="button"
              onClick={() => lightSourceControls?.onToggleLightTool?.()}
              disabled={isNarrationPresentationActive || isLightSourcePending || !lightSourceControls?.onToggleLightTool}
              title={isLightToolActive ? 'Disable light source tool' : 'Enable light source tool'}
              aria-label={isLightToolActive ? 'Disable light source tool' : 'Enable light source tool'}
              aria-pressed={isLightToolActive}
              data-testid="light-source-tool-trigger"
              className={`${getQuickControlButtonClassName(isLightToolActive)} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <FiSun className="h-4 w-4" />
            </button>
          )}
          {!isNarrationPresentationActive && isManager && darknessSourceControls?.onToggleDarknessTool && (
            <button
              type="button"
              onClick={() => darknessSourceControls?.onToggleDarknessTool?.()}
              disabled={isNarrationPresentationActive || isDarknessSourcePending || !darknessSourceControls?.onToggleDarknessTool}
              title={isDarknessToolActive ? 'Disable darkness source tool' : 'Enable darkness source tool'}
              aria-label={isDarknessToolActive ? 'Disable darkness source tool' : 'Enable darkness source tool'}
              aria-pressed={isDarknessToolActive}
              data-testid="darkness-source-tool-trigger"
              className={`${getQuickControlButtonClassName(isDarknessToolActive)} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <FiMoon className="h-4 w-4" />
            </button>
          )}
          {!isNarrationPresentationActive && isManager && wallSourceControls?.onToggleWallTool && (
            <button
              type="button"
              onClick={() => wallSourceControls?.onToggleWallTool?.()}
              disabled={isNarrationPresentationActive || isWallSourcePending || !wallSourceControls?.onToggleWallTool}
              title={isWallToolActive ? 'Disable wall authoring tool' : 'Enable wall authoring tool'}
              aria-label={isWallToolActive ? 'Disable wall authoring tool' : 'Enable wall authoring tool'}
              aria-pressed={isWallToolActive}
              data-testid="wall-source-tool-trigger"
              className={`${getQuickControlButtonClassName(isWallToolActive)} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <FiMinus className="h-4 w-4" />
            </button>
          )}
          {!isNarrationPresentationActive && isManager && fogBrushControls?.onToggleFogBrushTool && (
            <div className="pointer-events-auto relative z-10 h-10 w-10 shrink-0">
              <div className="absolute left-0 top-0 z-20 flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => fogBrushControls?.onToggleFogBrushTool?.()}
                  disabled={isNarrationPresentationActive || isFogBrushPending || !fogBrushControls?.onToggleFogBrushTool}
                  title={isFogBrushToolActive ? 'Disable manual fog brush' : 'Enable manual fog brush'}
                  aria-label={isFogBrushToolActive ? 'Disable manual fog brush' : 'Enable manual fog brush'}
                  aria-pressed={isFogBrushToolActive}
                  aria-expanded={isFogBrushToolActive}
                  aria-controls={fogBrushSettingsId}
                  data-testid="fog-brush-tool-trigger"
                  className={`${getQuickControlButtonClassName(isFogBrushToolActive)} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <MdBrush className="h-4 w-4" />
                </button>

                <AnimatePresence initial={false}>
                  {isFogBrushToolActive && fogBrushControls && (
                    <motion.div
                      key="fog-brush-settings"
                      id={fogBrushSettingsId}
                      data-testid="fog-brush-settings"
                      className={QUICK_CONTROL_DRAWER_CLASS}
                      initial={prefersReducedMotion ? { opacity: 1, width: 'auto' } : { opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={prefersReducedMotion ? { opacity: 0, width: 0 } : { opacity: 0, width: 0 }}
                      transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.26, ease: DRAW_PICKER_EASE }}
                    >
                      <div className="flex items-center gap-1" role="group" aria-label="Manual fog brush settings">
                        <motion.button
                          type="button"
                          data-testid="fog-brush-mode-reveal"
                          onClick={() => fogBrushControls?.onChangeMode?.('reveal')}
                          disabled={isFogBrushPending}
                          title="Reveal fog"
                          aria-label="Reveal fog brush"
                          aria-pressed={fogBrushSettings.mode === 'reveal'}
                          initial={prefersReducedMotion ? false : { opacity: 0, x: 12, scale: 0.74 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 12, scale: 0.82 }}
                          transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.18, ease: DRAW_PICKER_EASE }}
                          className={`${getQuickControlButtonClassName(fogBrushSettings.mode === 'reveal')} h-8 w-8 rounded-xl disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          <FiEye className="h-3.5 w-3.5" />
                        </motion.button>
                        <motion.button
                          type="button"
                          data-testid="fog-brush-mode-hide"
                          onClick={() => fogBrushControls?.onChangeMode?.('hide')}
                          disabled={isFogBrushPending}
                          title="Hide fog"
                          aria-label="Hide fog brush"
                          aria-pressed={fogBrushSettings.mode === 'hide'}
                          initial={prefersReducedMotion ? false : { opacity: 0, x: 12, scale: 0.74 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 12, scale: 0.82 }}
                          transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.03, ease: DRAW_PICKER_EASE }}
                          className={`${getQuickControlButtonClassName(fogBrushSettings.mode === 'hide')} h-8 w-8 rounded-xl disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          <FiEyeOff className="h-3.5 w-3.5" />
                        </motion.button>
                        <motion.label
                          initial={prefersReducedMotion ? false : { opacity: 0, x: 12, scale: 0.74 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 12, scale: 0.82 }}
                          transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.18, delay: 0.06, ease: DRAW_PICKER_EASE }}
                          className="flex h-8 w-12 items-center justify-center rounded-xl border border-slate-700/90 bg-slate-900/90 px-1"
                        >
                          <span className="sr-only">Fog brush radius</span>
                          <input
                            type="number"
                            min={MIN_FOG_BRUSH_RADIUS_SQUARES}
                            max={MAX_FOG_BRUSH_RADIUS_SQUARES}
                            step="1"
                            aria-label="Fog brush radius"
                            value={fogBrushSettings.radiusSquares}
                            disabled={isFogBrushPending}
                            onChange={(event) => fogBrushControls?.onChangeRadiusSquares?.(Number(event.target.value))}
                            className="h-6 w-full bg-transparent text-center text-xs font-semibold text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </motion.label>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onToggleInteractionSharing}
            disabled={isNarrationPresentationActive}
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
                  disabled={isNarrationPresentationActive || isGridVisibilityToggleDisabled}
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
                  disabled={isNarrationPresentationActive || isDeactivateActiveBackgroundDisabled}
                  title="Deactivate active map"
                  aria-label="Deactivate active map"
                  className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <FiImage className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustGridSize?.(1)}
                  disabled={isNarrationPresentationActive || isGridSizeAdjustmentDisabled}
                  title="Increase square size"
                  aria-label="Increase square size"
                  className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <FiPlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustGridSize?.(-1)}
                  disabled={isNarrationPresentationActive || isGridSizeAdjustmentDisabled}
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
                className="pointer-events-none flex min-h-0 w-full flex-1 items-stretch overflow-visible"
                initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={prefersReducedMotion ? { duration: 0.01 } : TURN_ORDER_DRAWER_TRANSITION}
              >
                <TurnOrderPanel
                  currentUserId={currentUserId}
                  entries={sortedTurnOrderEntries}
                  isManager={isManager}
                  activeTurnTokenId={activeTurnTokenId}
                  onSaveTurnOrderInitiative={onSaveTurnOrderInitiative}
                  savingTurnOrderInitiativeTokenId={savingTurnOrderInitiativeTokenId}
                  isReadOnly={isNarrationPresentationActive}
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
                x={backplateBounds.minX - backplatePadding}
                y={backplateBounds.minY - backplatePadding}
                width={backplateBounds.width + (backplatePadding * 2)}
                height={backplateBounds.height + (backplatePadding * 2)}
                fill="#0f172a"
                listening={false}
              />

              {narrationImageTransition.entries.map((entry) => {
                return (
                  <NarrationPlacementImage
                    key={entry.key}
                    placement={entry.placement}
                    background={entry.background}
                    opacity={entry.opacity}
                    transitionRole={entry.transitionRole}
                    isPrimary={entry.isPrimary}
                    isManager={isManager && entry.transitionRole !== 'outgoing'}
                    onMoveNarrationPlacement={entry.transitionRole === 'outgoing' ? null : onMoveNarrationPlacement}
                  />
                );
              })}

              {!isNarrationVisualActive && battlemapImageTransition.fadingOutLayer && battlemapImageTransition.fadingOutLayer.imageWidth > 0 && battlemapImageTransition.fadingOutLayer.imageHeight > 0 && (
                <KonvaImage
                  data-testid="battlemap-image-outgoing"
                  data-asset-type={battlemapImageTransition.fadingOutLayer.assetType}
                  image={battlemapImageTransition.fadingOutLayer.image}
                  x={0}
                  y={0}
                  width={battlemapImageTransition.fadingOutLayer.imageWidth}
                  height={battlemapImageTransition.fadingOutLayer.imageHeight}
                  opacity={battlemapImageTransition.fadingOutLayer.opacity}
                  listening={false}
                />
              )}

              {!isNarrationVisualActive && battlemapImageTransition.visibleLayer && battlemapImageTransition.visibleLayer.imageWidth > 0 && battlemapImageTransition.visibleLayer.imageHeight > 0 && (
                <KonvaImage
                  data-testid="battlemap-image-active"
                  data-asset-type={battlemapImageTransition.visibleLayer.assetType}
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
                x={backplateBounds.minX - backplatePadding}
                y={backplateBounds.minY - backplatePadding}
                width={backplateBounds.width + (backplatePadding * 2)}
                height={backplateBounds.height + (backplatePadding * 2)}
                fill="rgba(15, 23, 42, 0.12)"
                listening={false}
              />

              {!isNarrationVisualActive && isGridVisible && <GridLayer bounds={boardBounds} grid={normalizedGrid} />}
            </Layer>

            {!isNarrationVisualActive && lightingRenderInput && (
              <Layer listening={false}>
                <GrigliataLightingMask
                  bounds={boardBounds}
                  grid={normalizedGrid}
                  metadata={lightingRenderInput}
                  tokens={visibleRenderedTokens}
                  visionSources={visibleTokenVisionSources}
                  precomputedTokenVisionPolygons={Array.isArray(fogOfWar?.currentTokenVisionPolygons) ? fogOfWar.currentTokenVisionPolygons : null}
                  lightClipPolygons={fogOfWar ? fogOfWar.currentVisiblePolygons || [] : undefined}
                />
              </Layer>
            )}

            <Layer>
              {!isNarrationVisualActive && isManager && isWallToolActive && wallSourceControls && (
                <GrigliataWallAuthoringControls
                  walls={renderedWallSources}
                  selectedWallId={selectedWallId}
                  draftWall={wallCreatePreview ? {
                    x1: wallCreatePreview.startPoint.x,
                    y1: wallCreatePreview.startPoint.y,
                    x2: wallCreatePreview.endPoint.x,
                    y2: wallCreatePreview.endPoint.y,
                    wallType: 'wall',
                    blocksSight: true,
                    blocksVision: true,
                    blocksLight: true,
                  } : null}
                  viewportScale={viewport.scale}
                  onSelectWall={handleSelectWallSource}
                  onBeginWallEndpointDrag={handleWallEndpointMouseDown}
                  onBeginWallSegmentDrag={handleWallSegmentMouseDown}
                />
              )}

              {!isNarrationVisualActive && isManager && !isWallToolActive && onToggleWallRuntimeSegment && (
                <GrigliataWallRuntimeControls
                  walls={wallRuntimeSegments || lightingRenderInput?.walls}
                  viewportScale={viewport.scale}
                  onToggleWallRuntimeSegment={onToggleWallRuntimeSegment}
                />
              )}

              {!isNarrationVisualActive && isManager && showLightingDebugOverlay && lightingDebugMetadata && (
                <GrigliataLightingDebugOverlay
                  metadata={lightingDebugMetadata}
                  viewportScale={viewport.scale}
                />
              )}

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

              {visibleRenderedAoEFigures.filter((figure) => figure.canEdit).map((figure) => (
                <EnhancedAoEFigureOverlay
                  key={`aoe-hit-target-${figure.id}`}
                  figure={figure.renderable}
                  overlayId={figure.id}
                  viewportScale={viewport.scale}
                  hitTargetOnly
                  onMouseDown={(event) => handleAoEFigureMouseDown(figure, event)}
                />
              ))}

              {!isNarrationVisualActive && isManager && renderedLightSources.length > 0 && (
                <GrigliataLightControls
                  lights={renderedLightSources}
                  selectedLightId={selectedLightId}
                  viewportScale={viewport.scale}
                  onSelectLight={handleSelectLightSource}
                  onBeginLightDrag={handleLightSourceMouseDown}
                />
              )}

              {!isNarrationVisualActive && isManager && renderedDarknessSources.length > 0 && (
                <GrigliataDarknessControls
                  darknessSources={renderedDarknessSources}
                  selectedDarknessId={selectedDarknessId}
                  viewportScale={viewport.scale}
                  onSelectDarkness={handleSelectDarknessSource}
                  onBeginDarknessDrag={handleDarknessSourceMouseDown}
                />
              )}

              {visibleRenderedTokensBelowFog.map((token) => (
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
                  onHoverChange={(tokenId, isHovered) => {
                    setHoveredTokenTooltipId((currentTokenId) => {
                      if (!isHovered) {
                        return currentTokenId === tokenId ? '' : currentTokenId;
                      }

                      return tokenId || '';
                    });
                  }}
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
            </Layer>

            {!isNarrationVisualActive && fogOfWar && (
              <Layer listening={false}>
                <GrigliataFogOfWarMask
                  bounds={boardBounds}
                  grid={normalizedGrid}
                  exploredCells={fogOfWar.exploredCells}
                  exploredPolygons={fogOfWar.exploredPolygons}
                  memoryTiles={fogOfWar.memoryTiles}
                  currentVisibleCells={fogOfWar.currentVisibleCells}
                  currentVisiblePolygons={fogOfWar.currentVisiblePolygons}
                />
              </Layer>
            )}

            <Layer>
              {visibleRenderedTokensAboveFog.map((token) => (
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
                  onHoverChange={(tokenId, isHovered) => {
                    setHoveredTokenTooltipId((currentTokenId) => {
                      if (!isHovered) {
                        return currentTokenId === tokenId ? '' : currentTokenId;
                      }

                      return tokenId || '';
                    });
                  }}
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

              {visibleRenderedAoEFigures.map((figure) => (
                <EnhancedAoEFigureOverlay
                  key={figure.id}
                  figure={figure.renderable}
                  drawTheme={getGrigliataDrawTheme(figure.colorKey)}
                  overlayId={figure.id}
                  isSelected={figure.isSelected}
                  viewportScale={viewport.scale}
                  listening={false}
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

        {visibleHoveredTokenTooltip && hoveredTokenTooltipStyle && (
          <div className="pointer-events-none absolute inset-0 z-[18]">
            <div
              data-testid={`battlemap-tooltip-${visibleHoveredTokenTooltip.tokenId}`}
              className="absolute overflow-hidden text-center text-ellipsis whitespace-nowrap rounded-xl border border-slate-700/90 bg-slate-950/96 px-3 py-1.5 text-xs font-semibold text-slate-100 shadow-lg shadow-black/45 backdrop-blur-sm"
              style={hoveredTokenTooltipStyle}
            >
              {visibleHoveredTokenTooltip.label || visibleHoveredTokenTooltip.characterId || visibleHoveredTokenTooltip.ownerUid || 'Token'}
            </div>
          </div>
        )}

        <ActiveViewersOverlay viewers={activeViewers} />

        {!isNarrationPresentationActive && isManager && (lightSourceControls || darknessSourceControls || wallSourceControls) && (
          <div className="pointer-events-none absolute inset-0 z-[27]">
            <div data-testid="lighting-diagnostics-anchor" className="pointer-events-auto absolute bottom-20 left-4">
              <GrigliataLightingDiagnostics
                lights={editableLightSources}
                walls={editableWallSources}
                selectedToken={selectedTokenDetails}
              />
            </div>
          </div>
        )}

        {!isNarrationPresentationActive && isManager && selectedLight && (
          <div className="pointer-events-none absolute inset-0 z-[28]">
            <div className="pointer-events-auto absolute left-16 top-4">
              <GrigliataSelectedLightPanel
                light={selectedLight}
                grid={normalizedGrid}
                isPending={!!lightSourceControls?.isPending}
                onUpdateLight={lightSourceControls?.onUpdateLightSource}
                onDuplicateLight={lightSourceControls?.onDuplicateLightSource}
                onDeleteLight={async (lightId) => {
                  if (isLightSourcePending) {
                    return false;
                  }

                  const didDeleteLight = !!(await Promise.resolve(lightSourceControls?.onDeleteLightSource?.(lightId)));
                  if (didDeleteLight) {
                    setSelectedLightId('');
                  }
                  return didDeleteLight;
                }}
                onRequestClose={() => setSelectedLightId('')}
              />
            </div>
          </div>
        )}

        {!isNarrationPresentationActive && isManager && selectedDarkness && (
          <div className="pointer-events-none absolute inset-0 z-[28]">
            <div className="pointer-events-auto absolute left-16 top-4">
              <GrigliataSelectedDarknessPanel
                darkness={selectedDarkness}
                grid={normalizedGrid}
                isPending={!!darknessSourceControls?.isPending}
                onUpdateDarkness={darknessSourceControls?.onUpdateDarknessSource}
                onDuplicateDarkness={darknessSourceControls?.onDuplicateDarknessSource}
                onDeleteDarkness={async (darknessId) => {
                  if (isDarknessSourcePending) {
                    return false;
                  }

                  const didDeleteDarkness = !!(await Promise.resolve(darknessSourceControls?.onDeleteDarknessSource?.(darknessId)));
                  if (didDeleteDarkness) {
                    setSelectedDarknessId('');
                  }
                  return didDeleteDarkness;
                }}
                onRequestClose={() => setSelectedDarknessId('')}
              />
            </div>
          </div>
        )}

        {!isNarrationPresentationActive && isManager && selectedWall && (
          <div className="pointer-events-none absolute inset-0 z-[28]">
            <div className="pointer-events-auto absolute left-16 top-4">
              <GrigliataSelectedWallPanel
                wall={selectedWall}
                isPending={!!wallSourceControls?.isPending}
                onUpdateWall={wallSourceControls?.onUpdateWallSegment}
                onDuplicateWall={wallSourceControls?.onDuplicateWallSegment}
                onDeleteWall={async (wallId) => {
                  if (isWallSourcePending) {
                    return false;
                  }

                  const didDeleteWall = !!(await Promise.resolve(wallSourceControls?.onDeleteWallSegment?.(wallId)));
                  if (didDeleteWall) {
                    setSelectedWallId('');
                  }
                  return didDeleteWall;
                }}
                onRequestClose={() => setSelectedWallId('')}
              />
            </div>
          </div>
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

          {!isNarrationPresentationActive && turnOrderContextMenu && activeTurnOrderContextToken && (
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

          {!isNarrationPresentationActive && turnOrderJoinPrompt && activeTurnOrderJoinToken && (
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
                  {turnOrderInitiativeRollState.tokenId === activeTurnOrderJoinToken.tokenId
                    && turnOrderInitiativeRollState.status === 'loading' && (
                    <div
                      data-testid="turn-order-initiative-roll-loading"
                      className="flex items-center justify-center gap-2 rounded-xl border border-slate-800/90 bg-slate-900/55 px-3 py-2 text-[11px] text-slate-400"
                      role="status"
                    >
                      <span className="h-3 w-3 animate-spin rounded-full border border-slate-500 border-t-indigo-300" aria-hidden="true" />
                      Checking Destrezza...
                    </div>
                  )}
                  {turnOrderInitiativeRollState.tokenId === activeTurnOrderJoinToken.tokenId
                    && turnOrderInitiativeRollState.status === 'available'
                    && turnOrderInitiativeRollState.config && (
                    <button
                      type="button"
                      data-testid="turn-order-initiative-roll-button"
                      aria-label={`Roll Destrezza for ${activeTurnOrderJoinToken.label}`}
                      disabled={
                        turnOrderActionTokenId === activeTurnOrderJoinToken.tokenId
                        || !!turnOrderInitiativeRoller
                      }
                      onClick={() => setTurnOrderInitiativeRoller({
                        tokenId: activeTurnOrderJoinToken.tokenId,
                        ...turnOrderInitiativeRollState.config,
                      })}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-300/35 bg-indigo-400/10 px-3 py-2 text-left text-xs text-indigo-100 transition-colors duration-150 hover:border-indigo-200/60 hover:bg-indigo-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
                        <FaDiceD20 className="h-4 w-4 shrink-0 text-indigo-200" aria-hidden="true" />
                        <span className="truncate">Roll Destrezza</span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-400">
                        {turnOrderInitiativeRollState.config.formula}
                      </span>
                    </button>
                  )}
                  {turnOrderInitiativeRollState.tokenId === activeTurnOrderJoinToken.tokenId
                    && turnOrderInitiativeRollState.status === 'error' && (
                    <p
                      data-testid="turn-order-initiative-roll-error"
                      className="text-center text-[11px] text-amber-300/85"
                    >
                      Dice roll unavailable. Enter initiative manually.
                    </p>
                  )}
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
              {turnOrderInitiativeRoller
                && turnOrderInitiativeRoller.tokenId === activeTurnOrderJoinToken.tokenId && (
                <DiceRoller
                  faces={turnOrderInitiativeRoller.faces}
                  count={turnOrderInitiativeRoller.count}
                  modifier={turnOrderInitiativeRoller.modifier}
                  description={turnOrderInitiativeRoller.description}
                  onComplete={(total) => {
                    const rolledTokenId = turnOrderInitiativeRoller.tokenId;
                    setTurnOrderInitiativeRoller(null);
                    setTurnOrderJoinPrompt((currentPrompt) => (
                      currentPrompt?.tokenId === rolledTokenId && Number.isInteger(total)
                        ? { ...currentPrompt, draft: String(total) }
                        : currentPrompt
                    ));
                    window.requestAnimationFrame(() => {
                      turnOrderJoinInputRef.current?.focus();
                    });
                  }}
                />
              )}
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
          isTokenVisionActionPending={isTokenVisionActionPending}
          onSetSelectedTokenVision={onSetSelectedTokenVision}
          isTokenLayerActionPending={isTokenLayerActionPending}
          onMoveTokenLayer={onMoveTokenLayer}
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
