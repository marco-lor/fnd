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
import {
  FiEye,
  FiEyeOff,
  FiImage,
  FiMinus,
  FiPlus,
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
} from './boardUtils';
import GrigliataTokenActions, { TokenStatusSummaryCard } from './GrigliataTokenActions';
import {
  getTokenStatusDefinition,
  splitTokenStatusesForDisplay,
  useTokenStatusIconImages,
} from './tokenStatuses';
import useImageAsset from './useImageAsset';
import { useImageAssetSnapshot } from './useImageAsset';
import {
  buildAoEFigureFromGrigliataLiveInteraction,
  buildMeasurementFromGrigliataLiveInteraction,
  buildPingFromGrigliataLiveInteraction,
  normalizeGrigliataLiveInteractionDraft,
} from './liveInteractions';
import {
  buildRenderableGrigliataAoEFigure,
  GRIGLIATA_AOE_FIGURE_TYPES,
  normalizeGrigliataAoEFigure,
  normalizeGrigliataAoEFigureDraft,
  shiftGrigliataAoEFigureCells,
} from './aoeFigures';

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
const TOKEN_RING_OUTLINE_STROKE_WIDTH = 6;
const TOKEN_STATUS_VISIBLE_BADGE_COUNT = 3;
const HIDDEN_TOKEN_PRIMARY = 'rgba(226, 232, 240, 0.96)';
const HIDDEN_TOKEN_SECONDARY = 'rgba(148, 163, 184, 0.94)';
const HIDDEN_TOKEN_SCRIM = 'rgba(15, 23, 42, 0.6)';
const DEAD_TOKEN_PRIMARY = 'rgba(254, 226, 226, 0.96)';
const DEAD_TOKEN_SECONDARY = 'rgba(248, 113, 113, 0.95)';
const DEAD_TOKEN_SCRIM = 'rgba(15, 23, 42, 0.34)';
const DEAD_TOKEN_BANNER_FILL = 'rgba(127, 29, 29, 0.88)';
const DEAD_TOKEN_LABEL = '#fecaca';
const DRAW_PICKER_EASE = [0.22, 1, 0.36, 1];
const BATTLEMAP_IMAGE_FADE_DURATION_MS = 1000;
const QUICK_CONTROL_NEUTRAL_SURFACE_CLASS = 'border-slate-700/90 bg-slate-950/92 shadow-lg shadow-slate-950/35';
const QUICK_CONTROL_NEON_SURFACE_CLASS = 'border-fuchsia-300/70 bg-gradient-to-br from-fuchsia-500/28 via-violet-500/24 to-pink-500/34 shadow-lg shadow-fuchsia-950/45 ring-1 ring-fuchsia-200/20';
const QUICK_CONTROL_BUTTON_BASE_CLASS = 'pointer-events-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border p-2 text-sm font-medium backdrop-blur-md transition-all duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
const QUICK_CONTROL_BUTTON_IDLE_CLASS = 'text-slate-200 hover:border-slate-500/80 hover:bg-slate-900/96 hover:text-slate-50';
const QUICK_CONTROL_BUTTON_ACTIVE_CLASS = 'text-fuchsia-50 hover:border-fuchsia-200/80 hover:from-fuchsia-500/36 hover:via-violet-500/30 hover:to-pink-500/42';
const QUICK_CONTROL_DRAWER_CLASS = `flex min-h-10 items-center gap-2 overflow-hidden rounded-2xl border p-2 backdrop-blur-md ${QUICK_CONTROL_NEUTRAL_SURFACE_CLASS}`;
const AOE_TEMPLATE_OPTION_BASE_CLASS = 'rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
const AOE_TEMPLATE_OPTION_IDLE_CLASS = 'border-slate-700 bg-slate-900/96 text-slate-200';
const AOE_TEMPLATE_OPTION_ACTIVE_CLASS = `${QUICK_CONTROL_NEON_SURFACE_CLASS} text-fuchsia-50`;

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

const clampToRange = (value, min, max) => Math.min(max, Math.max(min, value));
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

const HiddenEyeBadge = ({ x, y, size }) => {
  const half = size / 2;
  const padding = size * 0.2;
  const eyeTop = size * 0.38;
  const eyeBottom = size * 0.62;

  return (
    <Group x={x} y={y} listening={false}>
      <Circle
        x={half}
        y={half}
        radius={half}
        fill="rgba(15, 23, 42, 0.92)"
        stroke={HIDDEN_TOKEN_PRIMARY}
        strokeWidth={Math.max(1.5, size * 0.07)}
      />
      <Line
        points={[
          padding,
          half,
          half,
          eyeTop,
          size - padding,
          half,
          half,
          eyeBottom,
          padding,
          half,
        ]}
        stroke={HIDDEN_TOKEN_PRIMARY}
        strokeWidth={Math.max(1.3, size * 0.06)}
        lineCap="round"
        lineJoin="round"
      />
      <Circle
        x={half}
        y={half}
        radius={Math.max(1.5, size * 0.1)}
        fill={HIDDEN_TOKEN_PRIMARY}
      />
      <Line
        points={[
          padding * 0.85,
          size - (padding * 0.85),
          size - (padding * 0.85),
          padding * 0.85,
        ]}
        stroke="#f87171"
        strokeWidth={Math.max(1.6, size * 0.08)}
        lineCap="round"
      />
    </Group>
  );
};

const TokenStatusBadges = ({
  token,
  size,
  badgeImages,
  onOverflowMouseEnter,
  onOverflowMouseLeave,
  onOverflowToggle,
}) => {
  const { visibleStatuses, overflowCount } = splitTokenStatusesForDisplay(
    token?.statuses,
    TOKEN_STATUS_VISIBLE_BADGE_COUNT
  );
  if (!visibleStatuses.length && overflowCount < 1) {
    return null;
  }

  const badgeSize = Math.max(18, Math.round(size * 0.24));
  const badgeRadius = badgeSize / 2;
  const iconSize = Math.max(10, Math.round(badgeSize * 0.56));
  const inset = Math.max(3, Math.round(size * 0.04));
  const badgePositions = [
    { x: inset + badgeRadius, y: inset + badgeRadius },
    { x: size - inset - badgeRadius, y: inset + badgeRadius },
    { x: size - inset - badgeRadius, y: size - inset - badgeRadius },
  ];
  const overflowPosition = {
    x: inset + badgeRadius,
    y: size - inset - badgeRadius,
  };

  return (
    <>
      {visibleStatuses.map((statusId, index) => {
        const status = getTokenStatusDefinition(statusId);
        const position = badgePositions[index];
        if (!status || !position) {
          return null;
        }

        return (
          <Group key={`${token?.tokenId || token?.ownerUid || 'token'}-status-${statusId}`} listening={false}>
            <Circle
              x={position.x}
              y={position.y}
              radius={badgeRadius}
              fill={status.badgeFill}
              stroke={status.badgeStroke}
              strokeWidth={Math.max(1.4, badgeSize * 0.08)}
              shadowColor="#020617"
              shadowBlur={6}
              shadowOpacity={0.45}
            />
            {badgeImages?.[statusId] && (
              <KonvaImage
                image={badgeImages[statusId]}
                x={position.x - (iconSize / 2)}
                y={position.y - (iconSize / 2)}
                width={iconSize}
                height={iconSize}
                listening={false}
              />
            )}
          </Group>
        );
      })}

      {overflowCount > 0 && (
        <Group
          onMouseDown={(event) => {
            event.cancelBubble = true;
          }}
          onMouseEnter={() => onOverflowMouseEnter?.(token?.tokenId)}
          onMouseLeave={() => onOverflowMouseLeave?.(token?.tokenId)}
          onClick={(event) => {
            event.cancelBubble = true;
            onOverflowToggle?.(token?.tokenId);
          }}
          onTap={(event) => {
            event.cancelBubble = true;
            onOverflowToggle?.(token?.tokenId);
          }}
        >
          <Circle
            x={overflowPosition.x}
            y={overflowPosition.y}
            radius={badgeRadius}
            fill="rgba(2, 6, 23, 0.94)"
            stroke="rgba(251, 191, 36, 0.92)"
            strokeWidth={Math.max(1.5, badgeSize * 0.08)}
            shadowColor="#020617"
            shadowBlur={6}
            shadowOpacity={0.45}
          />
          <Text
            x={overflowPosition.x - badgeRadius}
            y={overflowPosition.y - (badgeRadius * 0.68)}
            width={badgeSize}
            align="center"
            fontSize={Math.max(9, Math.round(badgeSize * 0.48))}
            fontStyle="bold"
            fill="#fef3c7"
            text={`+${overflowCount}`}
            listening={false}
          />
        </Group>
      )}
    </>
  );
};

const TokenNode = ({
  token,
  position,
  canMove,
  isSelected,
  badgeImages,
  drawTheme = DEFAULT_DRAW_THEME,
  onMouseDown,
  onOverflowMouseEnter,
  onOverflowMouseLeave,
  onOverflowToggle,
}) => {
  const image = useImageAsset(token?.imageUrl || '');
  const size = position.size;
  const label = token?.label || token?.characterId || token?.ownerUid || 'Player';
  const initials = getInitials(label);
  const isHiddenFromPlayers = token?.isVisibleToPlayers === false;
  const isDead = token?.isDead === true;
  const selectedStroke = isHiddenFromPlayers
    ? HIDDEN_TOKEN_SECONDARY
    : (isDead ? DEAD_TOKEN_SECONDARY : drawTheme.stroke);
  const selectedGlow = isHiddenFromPlayers
    ? 'rgba(148, 163, 184, 0.45)'
    : (isDead ? 'rgba(248, 113, 113, 0.35)' : drawTheme.glow);
  const idleRingStroke = isHiddenFromPlayers
    ? HIDDEN_TOKEN_SECONDARY
    : (isDead ? DEAD_TOKEN_SECONDARY : (canMove ? '#fbbf24' : '#cbd5e1'));
  const labelFill = isHiddenFromPlayers
    ? '#cbd5e1'
    : (isDead ? DEAD_TOKEN_LABEL : (isSelected ? drawTheme.tokenLabelText : '#e2e8f0'));
  const hiddenBadgeSize = Math.max(18, Math.round(size * 0.28));
  const hiddenSlashInset = Math.max(8, Math.round(size * 0.18));
  const hiddenSlashStroke = Math.max(5, Math.round(size * 0.1));
  const deadBannerHeight = Math.max(15, Math.round(size * 0.24));
  const deadBannerY = size - deadBannerHeight - Math.max(6, Math.round(size * 0.1));

  return (
    <Group
      x={position.x}
      y={position.y}
      data-testid={token?.tokenId ? `token-node-${token.tokenId}` : undefined}
      onMouseDown={(event) => onMouseDown?.(token, event)}
    >
      {isSelected && (
        <>
          <Rect
            x={-6}
            y={-6}
            width={size + 12}
            height={size + 12}
            cornerRadius={10}
            stroke={drawTheme.outlineStroke}
            strokeWidth={SHAPE_OUTLINE_STROKE_WIDTH}
            dash={[7, 4]}
            listening={false}
          />
          <Rect
            x={-6}
            y={-6}
            width={size + 12}
            height={size + 12}
            cornerRadius={10}
            stroke={selectedStroke}
            strokeWidth={2}
            dash={[7, 4]}
            shadowColor={selectedGlow}
            shadowBlur={10}
            shadowOpacity={0.35}
            listening={false}
          />
        </>
      )}

      <Circle
        x={size / 2}
        y={size / 2}
        radius={(size / 2) - 1}
        fill="rgba(15, 23, 42, 0.9)"
        shadowColor="#000000"
        shadowBlur={14}
        shadowOpacity={0.45}
      />

      <Group
        clipFunc={(context) => {
          context.beginPath();
          context.arc(size / 2, size / 2, (size / 2) - 2, 0, Math.PI * 2, false);
        }}
      >
        {image ? (
          <KonvaImage image={image} width={size} height={size} />
        ) : (
          <Rect width={size} height={size} fill="#475569" />
        )}
        {isDead && (
          <Rect width={size} height={size} fill={DEAD_TOKEN_SCRIM} />
        )}
        {isHiddenFromPlayers && (
          <Rect width={size} height={size} fill={HIDDEN_TOKEN_SCRIM} />
        )}
      </Group>

      {isSelected ? (
        <>
          <Circle
            x={size / 2}
            y={size / 2}
            radius={(size / 2) - 1}
            stroke={drawTheme.outlineStroke}
            strokeWidth={TOKEN_RING_OUTLINE_STROKE_WIDTH}
          />
          <Circle
            x={size / 2}
            y={size / 2}
            radius={(size / 2) - 1}
            stroke={selectedStroke}
            strokeWidth={3}
          />
        </>
      ) : (
        <Circle
          x={size / 2}
          y={size / 2}
          radius={(size / 2) - 1}
          stroke={idleRingStroke}
          strokeWidth={2}
        />
      )}

      {isHiddenFromPlayers && (
        <>
          <Line
            points={[
              hiddenSlashInset,
              size - hiddenSlashInset,
              size - hiddenSlashInset,
              hiddenSlashInset,
            ]}
            stroke="rgba(15, 23, 42, 0.92)"
            strokeWidth={hiddenSlashStroke + 3}
            lineCap="round"
            listening={false}
          />
          <Line
            points={[
              hiddenSlashInset,
              size - hiddenSlashInset,
              size - hiddenSlashInset,
              hiddenSlashInset,
            ]}
            stroke={HIDDEN_TOKEN_PRIMARY}
            strokeWidth={hiddenSlashStroke}
            lineCap="round"
            listening={false}
          />
          <HiddenEyeBadge
            x={size - hiddenBadgeSize - 2}
            y={2}
            size={hiddenBadgeSize}
          />
        </>
      )}

      {isDead && (
        <Group
          clipFunc={(context) => {
            context.beginPath();
            context.arc(size / 2, size / 2, (size / 2) - 2, 0, Math.PI * 2, false);
          }}
          listening={false}
        >
          <Rect
            x={0}
            y={deadBannerY}
            width={size}
            height={deadBannerHeight}
            fill={DEAD_TOKEN_BANNER_FILL}
          />
          <Text
            x={0}
            y={deadBannerY + Math.max(1, Math.round(deadBannerHeight * 0.1))}
            width={size}
            align="center"
            fontSize={Math.max(10, Math.round(size * 0.18))}
            fontStyle="bold"
            fill={DEAD_TOKEN_PRIMARY}
            text="DEAD"
          />
        </Group>
      )}

      <TokenStatusBadges
        token={token}
        size={size}
        badgeImages={badgeImages}
        onOverflowMouseEnter={onOverflowMouseEnter}
        onOverflowMouseLeave={onOverflowMouseLeave}
        onOverflowToggle={onOverflowToggle}
      />

      {!image && (
        <Text
          x={0}
          y={(size / 2) - 10}
          width={size}
          align="center"
          fontSize={Math.max(12, Math.round(size * 0.26))}
          fontStyle="bold"
          fill="#f8fafc"
          text={initials}
          listening={false}
        />
      )}

      <Text
        x={-Math.round(size * 0.3)}
        y={size + 4}
        width={Math.round(size * 1.6)}
        align="center"
        fontSize={Math.max(10, Math.round(size * 0.18))}
        fill={labelFill}
        text={label}
        ellipsis
        listening={false}
      />
    </Group>
  );
};

const GridLayer = ({ bounds, grid }) => {
  const normalizedGrid = normalizeGridConfig(grid);
  const verticalStart = Math.floor((bounds.minX - normalizedGrid.offsetXPx) / normalizedGrid.cellSizePx) - 1;
  const verticalEnd = Math.ceil((bounds.maxX - normalizedGrid.offsetXPx) / normalizedGrid.cellSizePx) + 1;
  const horizontalStart = Math.floor((bounds.minY - normalizedGrid.offsetYPx) / normalizedGrid.cellSizePx) - 1;
  const horizontalEnd = Math.ceil((bounds.maxY - normalizedGrid.offsetYPx) / normalizedGrid.cellSizePx) + 1;

  const lines = [];

  for (let index = verticalStart; index <= verticalEnd; index += 1) {
    const x = normalizedGrid.offsetXPx + (index * normalizedGrid.cellSizePx);
    lines.push(
      <Line
        key={`v-${index}`}
        points={[x, bounds.minY - normalizedGrid.cellSizePx, x, bounds.maxY + normalizedGrid.cellSizePx]}
        stroke={index % 5 === 0 ? 'rgba(248, 250, 252, 0.38)' : 'rgba(248, 250, 252, 0.18)'}
        strokeWidth={index % 5 === 0 ? 1.4 : 1}
        listening={false}
      />
    );
  }

  for (let index = horizontalStart; index <= horizontalEnd; index += 1) {
    const y = normalizedGrid.offsetYPx + (index * normalizedGrid.cellSizePx);
    lines.push(
      <Line
        key={`h-${index}`}
        points={[bounds.minX - normalizedGrid.cellSizePx, y, bounds.maxX + normalizedGrid.cellSizePx, y]}
        stroke={index % 5 === 0 ? 'rgba(248, 250, 252, 0.38)' : 'rgba(248, 250, 252, 0.18)'}
        strokeWidth={index % 5 === 0 ? 1.4 : 1}
        listening={false}
      />
    );
  }

  return lines;
};

const MeasurementOverlay = ({
  measurement,
  drawTheme = DEFAULT_DRAW_THEME,
  overlayId = '',
}) => {
  if (!measurement?.pathPoints?.length || measurement.pathPoints.length < 2 || !measurement?.endPoint || !measurement?.label) {
    return null;
  }

  const linePoints = measurement.pathPoints.flatMap((point) => [point.x, point.y]);
  const markerPoints = measurement.markerPoints || measurement.pathPoints;

  const labelWidth = Math.max(
    RULER_LABEL_MIN_WIDTH,
    Math.round((measurement.label.length * 7.2) + 16)
  );
  const labelHeight = 28;
  const labelX = measurement.endPoint.x + 12;
  const labelY = measurement.endPoint.y - 14;

  return (
    <Group listening={false} data-testid={overlayId ? `measurement-overlay-${overlayId}` : undefined}>
      <Line
        points={linePoints}
        stroke={drawTheme.outlineStroke}
        strokeWidth={MEASUREMENT_OUTLINE_STROKE_WIDTH}
        dash={[10, 6]}
        lineCap="round"
        lineJoin="round"
      />
      <Line
        points={linePoints}
        stroke={drawTheme.stroke}
        strokeWidth={3}
        dash={[10, 6]}
        lineCap="round"
        lineJoin="round"
        shadowColor={drawTheme.glow}
        shadowBlur={10}
        shadowOpacity={0.28}
      />

      {markerPoints.map((point) => (
        <React.Fragment key={point.key || `${point.x}:${point.y}`}>
          <Circle
            x={point.x}
            y={point.y}
            radius={6}
            fill="#0f172a"
            stroke={drawTheme.outlineStroke}
            strokeWidth={TOKEN_RING_OUTLINE_STROKE_WIDTH}
          />
          <Circle
            x={point.x}
            y={point.y}
            radius={6}
            fill="#0f172a"
            stroke={drawTheme.stroke}
            strokeWidth={2}
          />
        </React.Fragment>
      ))}

      <Group x={labelX} y={labelY}>
        <Rect
          width={labelWidth}
          height={labelHeight}
          cornerRadius={9}
          stroke={drawTheme.outlineStroke}
          strokeWidth={SHAPE_OUTLINE_STROKE_WIDTH}
        />
        <Rect
          width={labelWidth}
          height={labelHeight}
          cornerRadius={9}
          fill="rgba(2, 6, 23, 0.92)"
          stroke={drawTheme.labelBorder}
          strokeWidth={1.5}
          shadowColor={drawTheme.glow}
          shadowBlur={8}
          shadowOpacity={0.2}
        />
        <Text
          x={0}
          y={6}
          width={labelWidth}
          align="center"
          fontSize={13}
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
  const outerRadius = prefersReducedMotion ? 42 : 18 + (easedProgress * 108);
  const innerRadius = prefersReducedMotion ? 24 : 10 + (easedProgress * 54);
  const sigilRadius = prefersReducedMotion ? 18 : 16 + (pulseStrength * 12);
  const coreRadius = prefersReducedMotion ? 7 : 7 + (pulseStrength * 6);
  const rayInnerRadius = prefersReducedMotion ? 12 : 12 + (easedProgress * 12);
  const rayOuterRadius = prefersReducedMotion ? 34 : 30 + (easedProgress * 42);
  const rayStrokeWidth = prefersReducedMotion ? 1.5 : Math.max(1.4, 2.4 - progress);
  const rayAngles = [0, Math.PI / 4, Math.PI / 2, (Math.PI * 3) / 4];
  const diamondRadius = prefersReducedMotion ? 12 : 10 + (pulseStrength * 8);

  return (
    <Group
      x={ping.point.x}
      y={ping.point.y}
      listening={false}
      data-testid={overlayId ? `map-ping-overlay-${overlayId}` : undefined}
    >
      <Circle
        radius={outerRadius}
        stroke={drawTheme.outlineStroke}
        strokeWidth={Math.max(3.5, 6 - (progress * 2))}
        opacity={0.16 + (fadeOpacity * 0.12)}
      />
      <Circle
        radius={outerRadius}
        stroke={drawTheme.stroke}
        strokeWidth={Math.max(1.8, 3 - progress)}
        opacity={fadeOpacity * 0.66}
        shadowColor={drawTheme.glow}
        shadowBlur={22}
        shadowOpacity={fadeOpacity * 0.36}
      />
      <Circle
        radius={innerRadius}
        fill="#f8fafc"
        opacity={fadeOpacity * 0.08}
        shadowColor={drawTheme.glow}
        shadowBlur={28}
        shadowOpacity={fadeOpacity * 0.3}
      />
      <Circle
        radius={sigilRadius}
        stroke="#fef3c7"
        strokeWidth={1.4}
        dash={[10, 8]}
        opacity={fadeOpacity * (prefersReducedMotion ? 0.34 : 0.5)}
      />
      <Circle
        radius={sigilRadius}
        stroke={drawTheme.stroke}
        strokeWidth={1.1}
        dash={[10, 8]}
        opacity={fadeOpacity * (prefersReducedMotion ? 0.26 : 0.42)}
      />
      <Line
        points={[0, -diamondRadius, diamondRadius, 0, 0, diamondRadius, -diamondRadius, 0]}
        closed
        stroke="#fef3c7"
        strokeWidth={1.4}
        lineJoin="round"
        opacity={fadeOpacity * 0.56}
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
            strokeWidth={rayStrokeWidth + 1.6}
            lineCap="round"
            opacity={fadeOpacity * 0.22}
          />
          <Line
            points={[
              Math.cos(angle) * rayInnerRadius,
              Math.sin(angle) * rayInnerRadius,
              Math.cos(angle) * rayOuterRadius,
              Math.sin(angle) * rayOuterRadius,
            ]}
            stroke="#fef3c7"
            strokeWidth={rayStrokeWidth}
            lineCap="round"
            opacity={fadeOpacity * 0.62}
            shadowColor={drawTheme.stroke}
            shadowBlur={10}
            shadowOpacity={fadeOpacity * 0.3}
          />
        </React.Fragment>
      ))}
      <Circle
        radius={coreRadius}
        fill="#fef3c7"
        opacity={0.22 + (fadeOpacity * 0.72)}
        shadowColor={drawTheme.stroke}
        shadowBlur={18}
        shadowOpacity={fadeOpacity * 0.5}
      />
      <Circle
        radius={Math.max(2.5, coreRadius * 0.42)}
        fill={drawTheme.stroke}
        opacity={fadeOpacity * 0.84}
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

const DrawColorPicker = ({ activeColorKey, onChange }) => {
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
          onClick={() => setIsOpen((currentOpen) => !currentOpen)}
          className="group relative flex h-8 w-8 items-center justify-center rounded-full border transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
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

const AoETemplatePicker = ({ activeFigureType = '', onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const drawerId = useId();
  const activeLabel = activeFigureType ? AOE_TEMPLATE_LABELS[activeFigureType] || 'AoE' : 'AoE';

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
          onClick={() => setIsOpen((currentOpen) => !currentOpen)}
          className={`${getQuickControlButtonClassName(!!activeFigureType)} text-[10px] font-black uppercase tracking-[0.18em]`}
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
              <motion.span
                aria-hidden="true"
                initial={prefersReducedMotion ? false : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.16, ease: DRAW_PICKER_EASE }}
                className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400"
              >
                Templates
              </motion.span>

              <div className="flex items-center gap-1.5" role="group" aria-label="Choose an area template">
                {GRIGLIATA_AOE_FIGURE_TYPES.map((figureType, index) => {
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
                      {label}
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

export default function GrigliataBoard({
  activeBackground,
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
  onAdjustGridSize,
  isGridSizeAdjustmentDisabled,
  onMoveTokens,
  onDeleteTokens,
  onCreateAoEFigure,
  onMoveAoEFigure,
  onDeleteAoEFigures,
  onSetSelectedTokensVisibility,
  isTokenVisibilityActionPending,
  onSetSelectedTokensDeadState,
  isTokenDeadActionPending,
  onUpdateTokenStatuses,
  isTokenStatusActionPending,
  onDropCurrentToken,
  onSelectedTokenIdsChange,
  sharedInteractions = [],
  onSharedInteractionChange,
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
  const backgroundAssetSnapshot = useImageAssetSnapshot(activeBackground?.imageUrl || '');
  const [battlemapImageTransition, setBattlemapImageTransition] = useState({
    visibleLayer: null,
    fadingOutLayer: null,
  });
  const battlemapImageTransitionRef = useRef(battlemapImageTransition);
  const battlemapImageAnimationHandleRef = useRef(null);
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

    if (!activeBackground?.imageUrl) {
      if (!dominantLayer) {
        cancelBattlemapImageAnimation();
        setBattlemapImageTransition({ visibleLayer: null, fadingOutLayer: null });
        return;
      }

      runBattlemapImageTransition(dominantLayer, null);
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
      isSelected: selectedTokenIdSet.has(token.tokenId),
    })),
    [tokenItems, dragPositionOverrides, selectedTokenIdSet]
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
    onSharedInteractionChange?.(activeSharedInteraction);
  }, [activeSharedInteraction, onSharedInteractionChange]);

  useEffect(() => (
    () => {
      onSharedInteractionChange?.(null);
    }
  ), [onSharedInteractionChange]);

  useEffect(() => {
    setSelectedTokenIds((currentSelectedTokenIds) => (
      currentSelectedTokenIds.filter((tokenId) => movableTokenIds.has(tokenId))
    ));
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
    const scaleBy = 1.08;
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

  const handleStageMouseDown = (event) => {
    if (isTokenDragActive) return;
    if (event.target !== stageRef.current) return;

    const nativeEvent = event.evt;
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');

    if (isSecondaryMouseButton(nativeEvent)) {
      clearPingHoldTimer();
      nativeEvent.preventDefault();
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

    if (!isPrimaryMouseButton(nativeEvent)) return;

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
    setHoveredOverflowTokenId('');
    setPinnedOverflowTokenId('');
    clearPingHoldTimer();

    if (activeAoeFigureType) {
      return;
    }

    if (isSecondaryMouseButton(nativeEvent)) {
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
          isVisibleToPlayers: selectedToken.isVisibleToPlayers,
          isDead: selectedToken.isDead,
          statuses: selectedToken.statuses,
          x: selectedToken.position.x,
          y: selectedToken.position.y,
          size: selectedToken.position.size,
        })),
    };
  };

  const handleAoEFigureMouseDown = (figure, event) => {
    const nativeEvent = event.evt;
    event.cancelBubble = true;
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
    onSelectedTokenIdsChange?.(selectedTokens.map((token) => token.tokenId));
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

    const selectionBounds = selectedTokens.reduce((accumulator, token) => {
      const left = token.renderPosition.x;
      const top = token.renderPosition.y;
      const right = token.renderPosition.x + token.renderPosition.size;
      const bottom = token.renderPosition.y + token.renderPosition.size;

      return {
        minX: Math.min(accumulator.minX, left),
        minY: Math.min(accumulator.minY, top),
        maxX: Math.max(accumulator.maxX, right),
        maxY: Math.max(accumulator.maxY, bottom),
      };
    }, {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    });

    if (!Number.isFinite(selectionBounds.minX) || !Number.isFinite(selectionBounds.minY)) {
      return null;
    }

    const screenWidth = (selectionBounds.maxX - selectionBounds.minX) * viewport.scale;
    const referenceScreenSize = Math.max(
      ...selectedTokens.map((token) => token.renderPosition.size * viewport.scale),
      36
    );
    const buttonSize = Math.max(36, Math.min(84, Math.round(referenceScreenSize)));
    const gap = Math.max(14, Math.round(buttonSize * 0.22));
    const normalizedTokenIds = [...new Set(
      selectedTokens
        .map((token) => token.tokenId)
        .filter(Boolean)
    )];
    if (!normalizedTokenIds.length) {
      return null;
    }

    const statusToken = selectedTokens.length === 1
      ? {
        tokenId: selectedTokens[0].tokenId,
        label: selectedTokens[0].label || 'token',
        statuses: selectedTokens[0].statuses || [],
      }
      : null;
    const actionCount = (isManager ? 2 : 0) + (statusToken ? 1 : 0);
    if (actionCount < 1) {
      return null;
    }

    const toolbarWidth = (buttonSize * actionCount) + (Math.max(0, actionCount - 1) * 8) + 16;
    const toolbarHeight = buttonSize + 16;
    const allSelectedTokensHidden = selectedTokens.every((token) => token.isVisibleToPlayers === false);
    const allSelectedTokensDead = selectedTokens.every((token) => token.isDead === true);
    const selectionLabel = normalizedTokenIds.length === 1 ? 'token' : 'tokens';
    const rawToolbarPosition = buildSelectionActionToolbarPosition({
      left: viewport.x + (selectionBounds.minX * viewport.scale),
      top: viewport.y + (selectionBounds.minY * viewport.scale),
      width: screenWidth,
      buttonSize,
      gap,
    });

    return {
      tokenIds: normalizedTokenIds,
      buttonSize,
      toolbarWidth,
      toolbarHeight,
      showVisibilityAction: isManager,
      showDeadAction: isManager,
      statusToken,
      nextIsVisibleToPlayers: allSelectedTokensHidden,
      nextIsDead: !allSelectedTokensDead,
      visibilityTitle: allSelectedTokensHidden
        ? `Show selected ${selectionLabel} to players`
        : `Hide selected ${selectionLabel} from players`,
      deadStateTitle: allSelectedTokensDead
        ? `Mark selected ${selectionLabel} as alive`
        : `Mark selected ${selectionLabel} as dead`,
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
    const toolbarWidth = buttonSize + 16;
    const toolbarHeight = buttonSize + 16;
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

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-950/80 shadow-2xl">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <p className="text-xs text-slate-400">
            {resolvedBackground?.name || 'Grid only'} | {normalizedGrid.cellSizePx}px squares | 5 ft per square
          </p>
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
            title={isMouseSelectionActive ? 'Mouse selection mode is active' : 'Return to mouse selection'}
            aria-label="Return to mouse selection"
            aria-pressed={isMouseSelectionActive}
            data-testid="mouse-selection-trigger"
            className={getQuickControlButtonClassName(isMouseSelectionActive)}
          >
            <FaHandPointer className="h-4 w-4" />
          </button>
          <div className="pointer-events-auto">
            <DrawColorPicker
              activeColorKey={resolvedDrawTheme.key}
              onChange={onChangeDrawColor}
            />
          </div>
          <button
            type="button"
            onClick={onToggleRuler}
            title={isRulerEnabled ? 'Disable ruler mode' : 'Enable ruler mode'}
            aria-label={isRulerEnabled ? 'Disable ruler mode' : 'Enable ruler mode'}
            aria-pressed={isRulerEnabled}
            className={getQuickControlButtonClassName(isRulerEnabled)}
          >
            <FaRulerHorizontal className="h-4 w-4" />
          </button>
          <div className="pointer-events-auto">
            <AoETemplatePicker
              activeFigureType={activeAoeFigureType}
              onChange={onChangeAoeFigureType}
            />
          </div>
          <button
            type="button"
            onClick={onToggleInteractionSharing}
            title={isInteractionSharingEnabled ? 'Stop sharing live interactions' : 'Share live interactions'}
            aria-label={isInteractionSharingEnabled ? 'Stop sharing live interactions' : 'Share live interactions'}
            aria-pressed={isInteractionSharingEnabled}
            className={getQuickControlButtonClassName(false)}
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

        {isManager && (
          <div
            data-testid="grigliata-manager-controls"
            className="pointer-events-none absolute right-4 top-4 z-30 flex flex-col items-end gap-2"
          >
            <button
              type="button"
              onClick={() => onToggleGridVisibility?.(activeBackground?.id || '')}
              disabled={isGridVisibilityToggleDisabled}
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
              disabled={isDeactivateActiveBackgroundDisabled}
              title="Deactivate active map"
              aria-label="Deactivate active map"
              className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <FiImage className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onAdjustGridSize?.(1)}
              disabled={isGridSizeAdjustmentDisabled}
              title="Increase square size"
              aria-label="Increase square size"
              className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <FiPlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onAdjustGridSize?.(-1)}
              disabled={isGridSizeAdjustmentDisabled}
              title="Decrease square size"
              aria-label="Decrease square size"
              className={`${getQuickControlButtonClassName(false)} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <FiMinus className="h-4 w-4" />
            </button>
          </div>
        )}

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

              {isGridVisible && <GridLayer bounds={boardBounds} grid={normalizedGrid} />}

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

              {renderedAoEFigures.map((figure) => (
                <AoEFigureOverlay
                  key={figure.id}
                  figure={figure.renderable}
                  drawTheme={getGrigliataDrawTheme(figure.colorKey)}
                  overlayId={figure.id}
                  isSelected={figure.isSelected}
                  boardBounds={boardBounds}
                  onMouseDown={(event) => handleAoEFigureMouseDown(figure, event)}
                />
              ))}

              {renderedTokens.map((token) => (
                <TokenNode
                  key={token.tokenId}
                  token={token}
                  position={token.renderPosition}
                  canMove={token.canMove}
                  isSelected={token.isSelected}
                  badgeImages={tokenStatusBadgeImages}
                  drawTheme={resolvedDrawTheme}
                  onMouseDown={handleTokenMouseDown}
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

              {renderedSharedInteractions.map((sharedInteraction) => (
                sharedInteraction.kind === 'measure'
                  ? (
                    <MeasurementOverlay
                      key={`shared-measurement-${sharedInteraction.ownerUid}`}
                      measurement={sharedInteraction.measurement}
                      drawTheme={sharedInteraction.drawTheme}
                      overlayId={`shared-${sharedInteraction.ownerUid}`}
                    />
                  )
                  : sharedInteraction.kind === 'aoe'
                    ? (
                    <AoEFigureOverlay
                      key={`shared-aoe-${sharedInteraction.ownerUid}`}
                      figure={sharedInteraction.figure}
                      drawTheme={sharedInteraction.drawTheme}
                      overlayId={`shared-${sharedInteraction.ownerUid}`}
                      boardBounds={boardBounds}
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

              {visibleLocalPings.map((ping) => (
                <MapPingOverlay
                  key={ping.id}
                  ping={ping}
                  drawTheme={getGrigliataDrawTheme(ping.colorKey)}
                  overlayId={ping.id}
                  now={pingAnimationClock}
                  prefersReducedMotion={prefersReducedMotion}
                />
              ))}

              {measurementState && (
                <MeasurementOverlay
                  measurement={measurementState}
                  drawTheme={resolvedDrawTheme}
                  overlayId="local"
                />
              )}

              {aoePreviewState && (
                <AoEFigureOverlay
                  figure={aoePreviewState}
                  drawTheme={resolvedDrawTheme}
                  overlayId="local"
                  boardBounds={boardBounds}
                  listening={false}
                />
              )}
            </Layer>
          </Stage>
        )}

        {activeOverflowToken && activeOverflowCardStyle && (
          <div className="pointer-events-none absolute inset-0 z-[18]">
            <TokenStatusSummaryCard
              statuses={activeOverflowToken.statuses}
              className="pointer-events-auto absolute"
              style={activeOverflowCardStyle}
              onMouseEnter={() => setHoveredOverflowTokenId(activeOverflowToken.tokenId)}
              onMouseLeave={() => {
                if (!pinnedOverflowTokenId) {
                  setHoveredOverflowTokenId('');
                }
              }}
            />
          </div>
        )}

        <GrigliataTokenActions
          actionState={selectedTokenActionState}
          viewportSize={stageSize}
          isTokenVisibilityActionPending={isTokenVisibilityActionPending}
          isTokenDeadActionPending={isTokenDeadActionPending}
          isTokenStatusActionPending={isTokenStatusActionPending}
          onSetSelectedTokensVisibility={onSetSelectedTokensVisibility}
          onSetSelectedTokensDeadState={onSetSelectedTokensDeadState}
          onUpdateTokenStatuses={onUpdateTokenStatuses}
        />

        {selectedAoEFigureActionState && (
          <div className="pointer-events-none absolute inset-0 z-20">
            <div
              className="pointer-events-auto absolute"
              style={{
                left: selectedAoEFigureActionState.toolbarPosition.left,
                top: selectedAoEFigureActionState.toolbarPosition.top,
              }}
            >
              <div className="rounded-[1.4rem] border border-rose-300/40 bg-slate-950/88 p-2 shadow-2xl backdrop-blur-sm">
                <button
                  type="button"
                  aria-label="Delete selected AoE figure"
                  title="Delete selected AoE figure"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={async (event) => {
                    event.stopPropagation();

                    try {
                      await Promise.resolve(onDeleteAoEFigures?.([selectedAoEFigureActionState.figureId]));
                      setSelectedAoEFigureId('');
                    } catch {
                      // preserve selection if deletion fails
                    }
                  }}
                  className="flex items-center justify-center rounded-[1.15rem] border border-rose-300/60 bg-rose-600/35 text-slate-50 shadow-lg transition-transform duration-150 hover:scale-[1.03]"
                  style={{
                    width: selectedAoEFigureActionState.buttonSize,
                    height: selectedAoEFigureActionState.buttonSize,
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
