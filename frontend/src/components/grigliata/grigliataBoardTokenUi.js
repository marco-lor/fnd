import React from 'react';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Line,
  Rect,
  Text,
} from 'react-konva';
import {
  DEFAULT_GRIGLIATA_DRAW_COLOR_KEY,
  getGrigliataDrawTheme,
} from './constants';
import {
  getInitials,
  normalizeGridConfig,
  normalizeTokenSizeSquares,
} from './boardUtils';
import {
  getTokenStatusDefinition,
  splitTokenStatusesForDisplay,
} from './tokenStatuses';
import useImageAsset from './useImageAsset';

const SHAPE_OUTLINE_STROKE_WIDTH = 4;
const TOKEN_STATUS_VISIBLE_BADGE_COUNT = 3;
const DEFAULT_DRAW_THEME = getGrigliataDrawTheme(DEFAULT_GRIGLIATA_DRAW_COLOR_KEY);
const HIDDEN_TOKEN_PRIMARY = 'rgba(226, 232, 240, 0.96)';
const HIDDEN_TOKEN_SECONDARY = 'rgba(148, 163, 184, 0.94)';
const HIDDEN_TOKEN_SCRIM = 'rgba(15, 23, 42, 0.6)';
const DEAD_TOKEN_PRIMARY = 'rgba(254, 226, 226, 0.96)';
const DEAD_TOKEN_SECONDARY = 'rgba(248, 113, 113, 0.95)';
const DEAD_TOKEN_SCRIM = 'rgba(15, 23, 42, 0.34)';
const DEAD_TOKEN_BANNER_FILL = 'rgba(127, 29, 29, 0.88)';
const DEAD_TOKEN_LABEL = '#fecaca';
const ACTIVE_TURN_PRIMARY = 'rgba(251, 191, 36, 0.98)';
const ACTIVE_TURN_SECONDARY = '#fef3c7';
const ACTIVE_TURN_GLOW = 'rgba(245, 158, 11, 0.42)';
const ACTIVE_TURN_FILL = 'rgba(245, 158, 11, 0.16)';
const GRID_LINE_STROKE = 'rgba(248, 250, 252, 0.14)';
const GRID_LINE_STROKE_WIDTH = 1;

const scaleTokenMetric = (size, ratio, minimum = 1) => Math.max(minimum, Math.round(size * ratio));
const scaleTokenStroke = (size, ratio, minimum = 0.75) => Math.max(minimum, size * ratio);

const buildTokenChromeMetrics = (tokenSize) => {
  const size = Number.isFinite(tokenSize) ? tokenSize : 0;
  const badgeSize = scaleTokenMetric(size, 0.24, 5);
  const hiddenBadgeSize = scaleTokenMetric(size, 0.28, 6);
  const deadBannerHeight = scaleTokenMetric(size, 0.24, 4);

  return {
    badgeSize,
    badgeRadius: badgeSize / 2,
    badgeIconSize: scaleTokenMetric(badgeSize, 0.56, 3),
    badgeInset: scaleTokenMetric(size, 0.04, 2),
    badgeStrokeWidth: scaleTokenStroke(badgeSize, 0.08),
    badgeShadowBlur: Math.max(2, badgeSize * 0.33),
    overflowFontSize: scaleTokenMetric(badgeSize, 0.48, 4),
    hiddenBadgeSize,
    hiddenSlashInset: scaleTokenMetric(size, 0.18, 2),
    hiddenSlashStroke: scaleTokenStroke(size, 0.1, 1),
    deadBannerHeight,
    deadBannerOffset: scaleTokenMetric(size, 0.1, 3),
    deadLabelFontSize: scaleTokenMetric(size, 0.18, 5),
    deadLabelOffset: scaleTokenMetric(deadBannerHeight, 0.1, 1),
  };
};

const buildSelectionActionToolbarPosition = ({ left, top, width, buttonSize, gap }) => ({
  left: left + width + gap,
  top: top - gap - buttonSize,
});

const HiddenEyeBadge = ({ x, y, size }) => {
  const half = size / 2;
  const padding = size * 0.2;
  const eyeTop = size * 0.38;
  const eyeBottom = size * 0.62;
  const outlineStrokeWidth = scaleTokenStroke(size, 0.07, 0.8);
  const eyeStrokeWidth = scaleTokenStroke(size, 0.06, 0.75);
  const pupilRadius = Math.max(1, size * 0.1);
  const slashStrokeWidth = scaleTokenStroke(size, 0.08, 0.9);

  return (
    <Group x={x} y={y} listening={false}>
      <Circle
        x={half}
        y={half}
        radius={half}
        fill="rgba(15, 23, 42, 0.92)"
        stroke={HIDDEN_TOKEN_PRIMARY}
        strokeWidth={outlineStrokeWidth}
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
        strokeWidth={eyeStrokeWidth}
        lineCap="round"
        lineJoin="round"
      />
      <Circle
        x={half}
        y={half}
        radius={pupilRadius}
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
        strokeWidth={slashStrokeWidth}
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

  const {
    badgeSize,
    badgeRadius,
    badgeIconSize,
    badgeInset,
    badgeShadowBlur,
    badgeStrokeWidth,
    overflowFontSize,
  } = buildTokenChromeMetrics(size);
  const badgePositions = [
    { x: badgeInset + badgeRadius, y: badgeInset + badgeRadius },
    { x: size - badgeInset - badgeRadius, y: badgeInset + badgeRadius },
    { x: size - badgeInset - badgeRadius, y: size - badgeInset - badgeRadius },
  ];
  const overflowPosition = {
    x: badgeInset + badgeRadius,
    y: size - badgeInset - badgeRadius,
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
              strokeWidth={badgeStrokeWidth}
              shadowColor="#020617"
              shadowBlur={badgeShadowBlur}
              shadowOpacity={0.45}
            />
            {badgeImages?.[statusId] && (
              <KonvaImage
                image={badgeImages[statusId]}
                x={position.x - (badgeIconSize / 2)}
                y={position.y - (badgeIconSize / 2)}
                width={badgeIconSize}
                height={badgeIconSize}
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
            strokeWidth={badgeStrokeWidth}
            shadowColor="#020617"
            shadowBlur={badgeShadowBlur}
            shadowOpacity={0.45}
          />
          <Text
            x={overflowPosition.x - badgeRadius}
            y={overflowPosition.y - (badgeRadius * 0.68)}
            width={badgeSize}
            align="center"
            fontSize={overflowFontSize}
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

export const TokenNode = ({
  token,
  position,
  canMove,
  isSelected,
  isActiveTurn = false,
  badgeImages,
  drawTheme = DEFAULT_DRAW_THEME,
  onMouseDown,
  onContextMenu,
  onHoverChange,
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
  const {
    hiddenBadgeSize,
    hiddenSlashInset,
    hiddenSlashStroke,
    deadBannerHeight,
    deadBannerOffset,
    deadLabelFontSize,
    deadLabelOffset,
  } = buildTokenChromeMetrics(size);
  const deadBannerY = size - deadBannerHeight - deadBannerOffset;

  return (
    <Group
      x={position.x}
      y={position.y}
      data-testid={token?.tokenId ? `token-node-${token.tokenId}` : undefined}
      data-active-turn={isActiveTurn ? 'true' : 'false'}
      onMouseDown={(event) => onMouseDown?.(token, event)}
      onContextMenu={(event) => onContextMenu?.(token, event)}
      onMouseEnter={() => onHoverChange?.(token?.tokenId || '', true)}
      onMouseLeave={() => onHoverChange?.(token?.tokenId || '', false)}
    >
      {isActiveTurn && (
        <>
          <Circle
            x={size / 2}
            y={size / 2}
            radius={(size / 2) + 18}
            fill="rgba(245, 158, 11, 0.1)"
            shadowColor={ACTIVE_TURN_GLOW}
            shadowBlur={30}
            shadowOpacity={0.48}
            listening={false}
          />
          <Circle
            x={size / 2}
            y={size / 2}
            radius={(size / 2) + 11}
            fill={ACTIVE_TURN_FILL}
            stroke="rgba(254, 243, 199, 0.92)"
            strokeWidth={Math.max(2.5, size * 0.06)}
            shadowColor={ACTIVE_TURN_GLOW}
            shadowBlur={22}
            shadowOpacity={0.44}
            listening={false}
          />
          <Circle
            x={size / 2}
            y={size / 2}
            radius={(size / 2) + 16}
            stroke={ACTIVE_TURN_PRIMARY}
            strokeWidth={Math.max(1.8, size * 0.045)}
            shadowColor={ACTIVE_TURN_GLOW}
            shadowBlur={14}
            shadowOpacity={0.34}
            listening={false}
          />
        </>
      )}

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
            y={deadBannerY + deadLabelOffset}
            width={size}
            align="center"
            fontSize={deadLabelFontSize}
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

    </Group>
  );
};

export const GridLayer = ({ bounds, grid }) => {
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
        stroke={GRID_LINE_STROKE}
        strokeWidth={GRID_LINE_STROKE_WIDTH}
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
        stroke={GRID_LINE_STROKE}
        strokeWidth={GRID_LINE_STROKE_WIDTH}
        listening={false}
      />
    );
  }

  return (
    <Group listening={false} data-testid="grid-layer">
      {lines}
    </Group>
  );
};

export const buildSelectedTokenActionState = ({
  selectedTokens,
  isManager = false,
  stageSize,
  viewport,
}) => {
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

  const selectedToken = selectedTokens.length === 1 ? selectedTokens[0] : null;
  const statusToken = selectedToken
    ? {
      tokenId: selectedToken.tokenId,
      label: selectedToken.label || 'token',
      statuses: selectedToken.statuses || [],
    }
    : null;
  const sizeToken = selectedToken
    ? {
      tokenId: selectedToken.tokenId,
      label: selectedToken.label || 'token',
      sizeSquares: normalizeTokenSizeSquares(selectedToken.sizeSquares),
    }
    : null;
  const actionCount = (isManager ? 2 : 0) + (statusToken ? 1 : 0) + (sizeToken ? 1 : 0);
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
    sizeToken,
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
};
