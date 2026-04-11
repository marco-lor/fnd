import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  BOARD_FIT_PADDING,
  DEFAULT_GRIGLIATA_DRAW_COLOR_KEY,
  getGrigliataDrawTheme,
  GRIGLIATA_DRAW_THEMES,
  TRAY_DRAG_MIME,
} from './constants';
import {
  buildGridMeasurement,
  buildGridMeasurementFromPoints,
  fitViewportToBounds,
  getBoardBounds,
  getInitials,
  getTokenPositionPx,
  normalizeGridConfig,
  snapBoardPointToGrid,
} from './boardUtils';
import useImageAsset from './useImageAsset';

const POINTER_DRAG_THRESHOLD_PX = 4;
const RULER_LABEL_MIN_WIDTH = 90;
const DEFAULT_DRAW_THEME = getGrigliataDrawTheme(DEFAULT_GRIGLIATA_DRAW_COLOR_KEY);
const MEASUREMENT_OUTLINE_STROKE_WIDTH = 7;
const SHAPE_OUTLINE_STROKE_WIDTH = 4;
const TOKEN_RING_OUTLINE_STROKE_WIDTH = 6;

const isPrimaryMouseButton = (nativeEvent) => nativeEvent?.button === 0;
const isSecondaryMouseButton = (nativeEvent) => nativeEvent?.button === 2;

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

const TokenNode = ({
  token,
  position,
  canMove,
  isSelected,
  drawTheme = DEFAULT_DRAW_THEME,
  onMouseDown,
}) => {
  const image = useImageAsset(token?.imageUrl || '');
  const size = position.size;
  const label = token?.label || token?.characterId || token?.ownerUid || 'Player';
  const initials = getInitials(label);

  return (
    <Group
      x={position.x}
      y={position.y}
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
            stroke={drawTheme.stroke}
            strokeWidth={2}
            dash={[7, 4]}
            shadowColor={drawTheme.glow}
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
            stroke={drawTheme.stroke}
            strokeWidth={3}
          />
        </>
      ) : (
        <Circle
          x={size / 2}
          y={size / 2}
          radius={(size / 2) - 1}
          stroke={canMove ? '#fbbf24' : '#cbd5e1'}
          strokeWidth={2}
        />
      )}

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
        fill={isSelected ? drawTheme.tokenLabelText : '#e2e8f0'}
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

const MeasurementOverlay = ({ measurement, drawTheme = DEFAULT_DRAW_THEME }) => {
  if (!measurement?.startPoint || !measurement?.endPoint || !measurement?.label) return null;

  const labelWidth = Math.max(
    RULER_LABEL_MIN_WIDTH,
    Math.round((measurement.label.length * 7.2) + 16)
  );
  const labelHeight = 28;
  const labelX = measurement.endPoint.x + 12;
  const labelY = measurement.endPoint.y - 14;

  return (
    <Group listening={false}>
      <Line
        points={[
          measurement.startPoint.x,
          measurement.startPoint.y,
          measurement.endPoint.x,
          measurement.endPoint.y,
        ]}
        stroke={drawTheme.outlineStroke}
        strokeWidth={MEASUREMENT_OUTLINE_STROKE_WIDTH}
        dash={[10, 6]}
        lineCap="round"
        lineJoin="round"
      />
      <Line
        points={[
          measurement.startPoint.x,
          measurement.startPoint.y,
          measurement.endPoint.x,
          measurement.endPoint.y,
        ]}
        stroke={drawTheme.stroke}
        strokeWidth={3}
        dash={[10, 6]}
        lineCap="round"
        lineJoin="round"
        shadowColor={drawTheme.glow}
        shadowBlur={10}
        shadowOpacity={0.28}
      />

      <Circle
        x={measurement.startPoint.x}
        y={measurement.startPoint.y}
        radius={6}
        fill="#0f172a"
        stroke={drawTheme.outlineStroke}
        strokeWidth={TOKEN_RING_OUTLINE_STROKE_WIDTH}
      />
      <Circle
        x={measurement.startPoint.x}
        y={measurement.startPoint.y}
        radius={6}
        fill="#0f172a"
        stroke={drawTheme.stroke}
        strokeWidth={2}
      />

      <Circle
        x={measurement.endPoint.x}
        y={measurement.endPoint.y}
        radius={6}
        fill="#0f172a"
        stroke={drawTheme.outlineStroke}
        strokeWidth={TOKEN_RING_OUTLINE_STROKE_WIDTH}
      />
      <Circle
        x={measurement.endPoint.x}
        y={measurement.endPoint.y}
        radius={6}
        fill="#0f172a"
        stroke={drawTheme.stroke}
        strokeWidth={2}
      />

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

const DrawColorPicker = ({ activeColorKey, onChange }) => (
  <fieldset className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-2.5 py-1.5">
    <legend className="sr-only">Drawing color</legend>
    <span aria-hidden="true" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
      Draw
    </span>
    <div className="flex items-center gap-1.5">
      {GRIGLIATA_DRAW_THEMES.map((theme) => {
        const isActive = theme.key === activeColorKey;

        return (
          <label
            key={theme.key}
            title={`Use ${theme.label} for grid drawings`}
            className="group relative block cursor-pointer"
          >
            <input
              type="radio"
              name="grigliata-draw-color"
              value={theme.key}
              checked={isActive}
              onChange={() => onChange?.(theme.key)}
              className="peer sr-only"
            />
            <span className="sr-only">{theme.label}</span>
            <span
              aria-hidden="true"
              className="relative flex h-7 w-7 items-center justify-center rounded-full border transition-transform duration-150 group-hover:scale-105 peer-focus-visible:ring-2 peer-focus-visible:ring-slate-200/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-950"
              style={{
                background: theme.swatchBackground,
                borderColor: isActive ? theme.swatchBorder : 'rgba(71, 85, 105, 0.9)',
                boxShadow: isActive
                  ? `0 0 0 2px rgba(2, 6, 23, 0.92), 0 0 0 4px ${theme.swatchBorder}, ${theme.swatchGlow}`
                  : `inset 0 0 0 1px rgba(255, 255, 255, 0.08), ${theme.swatchGlow}`,
              }}
            >
              {isActive && (
                <span
                  className="pointer-events-none absolute inset-[7px] rounded-full bg-slate-950/85"
                  style={{ boxShadow: `0 0 10px ${theme.stroke}` }}
                />
              )}
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);

export default function GrigliataBoard({
  activeBackground,
  grid,
  tokens,
  currentUserId,
  isManager,
  isTokenDragActive,
  isRulerEnabled,
  drawTheme,
  onToggleRuler,
  onChangeDrawColor,
  onAdjustGridSize,
  isGridSizeAdjustmentDisabled,
  boardHeight,
  onMoveTokens,
  onDeleteTokens,
  onDropCurrentToken,
}) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const interactionRef = useRef(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [isDropActive, setIsDropActive] = useState(false);
  const [selectedTokenIds, setSelectedTokenIds] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const [tokenDragState, setTokenDragState] = useState(null);
  const [measurementState, setMeasurementState] = useState(null);
  const backgroundImage = useImageAsset(activeBackground?.imageUrl || '');
  const lastFitKeyRef = useRef('');
  const resolvedDrawTheme = drawTheme || DEFAULT_DRAW_THEME;

  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);

  const resolvedBackground = useMemo(() => {
    if (!activeBackground) return null;

    return {
      ...activeBackground,
      imageWidth: activeBackground.imageWidth || backgroundImage?.naturalWidth || backgroundImage?.width || 0,
      imageHeight: activeBackground.imageHeight || backgroundImage?.naturalHeight || backgroundImage?.height || 0,
    };
  }, [activeBackground, backgroundImage]);

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

  const boardBounds = useMemo(
    () => getBoardBounds({ background: resolvedBackground, grid: normalizedGrid, tokens: placedTokens }),
    [resolvedBackground, normalizedGrid, placedTokens]
  );

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
    setSelectedTokenIds([]);
    setSelectionBox(null);
    setTokenDragState(null);
    setMeasurementState(null);
  }, [fitKey]);

  useEffect(() => {
    if (!isRulerEnabled) {
      setMeasurementState(null);
    }
  }, [isRulerEnabled]);

  useEffect(() => {
    setSelectedTokenIds((currentSelectedTokenIds) => (
      currentSelectedTokenIds.filter((tokenId) => movableTokenIds.has(tokenId))
    ));
  }, [movableTokenIds]);

  const getWorldPointFromClient = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewport.x) / viewport.scale,
      y: (clientY - rect.top - viewport.y) / viewport.scale,
    };
  }, [viewport.x, viewport.y, viewport.scale]);

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
          return parsed;
        }
      } catch {
        // ignore malformed payloads
      }
    }

    return null;
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDropActive(false);

    const payload = parseDropPayload(event.dataTransfer);
    const canAcceptCurrentTrayDrop = !!(isTokenDragActive && currentUserId);
    if (!containerRef.current) return;
    if (!canAcceptCurrentTrayDrop && (!payload || payload.uid !== currentUserId)) return;

    const worldPoint = getWorldPointFromClient(event.clientX, event.clientY);
    if (!worldPoint) return;

    onDropCurrentToken?.(worldPoint);
  };

  const handleDragOver = (event) => {
    const payload = parseDropPayload(event.dataTransfer);
    const canAcceptCurrentTrayDrop = !!(isTokenDragActive && currentUserId);
    if (!canAcceptCurrentTrayDrop && (!payload || payload.uid !== currentUserId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setIsDropActive(true);
  };

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDropActive(false);
  };

  const finalizeInteraction = useCallback(async ({ clientX = null, clientY = null } = {}) => {
    const activeInteraction = interactionRef.current;
    if (!activeInteraction) return;

    interactionRef.current = null;

    const pointerWorld = (
      Number.isFinite(clientX) && Number.isFinite(clientY)
        ? getWorldPointFromClient(clientX, clientY)
        : null
    );

    if (activeInteraction.type === 'selection-candidate') {
      setSelectionBox(null);
      setSelectedTokenIds([]);
      return;
    }

    if (activeInteraction.type === 'measure-candidate') {
      setMeasurementState(null);
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
      setSelectionBox(null);
      return;
    }

    if (activeInteraction.type === 'measure') {
      setMeasurementState(null);
      return;
    }

    if (activeInteraction.type === 'pan') {
      return;
    }

    if (activeInteraction.type === 'token-candidate') {
      return;
    }

    if (activeInteraction.type === 'token-drag') {
      const currentDragState = tokenDragState;
      const dragDeltaWorld = pointerWorld
        ? {
          x: pointerWorld.x - activeInteraction.startWorld.x,
          y: pointerWorld.y - activeInteraction.startWorld.y,
        }
        : (currentDragState?.deltaWorld || { x: 0, y: 0 });

      const draggedOriginToken = activeInteraction.originTokens.find(
        (originToken) => originToken.tokenId === activeInteraction.draggedTokenId
      );

      if (!draggedOriginToken) {
        setTokenDragState(null);
        return;
      }

      const snappedDraggedPosition = snapBoardPointToGrid({
        x: draggedOriginToken.x + dragDeltaWorld.x,
        y: draggedOriginToken.y + dragDeltaWorld.y,
      }, normalizedGrid, 'top-left');

      const colDelta = snappedDraggedPosition.col - draggedOriginToken.col;
      const rowDelta = snappedDraggedPosition.row - draggedOriginToken.row;

      try {
        if ((colDelta !== 0 || rowDelta !== 0) && activeInteraction.originTokens.length > 0) {
          await Promise.resolve(onMoveTokens?.(
            activeInteraction.originTokens.map((originToken) => ({
              ownerUid: originToken.ownerUid,
              backgroundId: originToken.backgroundId,
              col: originToken.col + colDelta,
              row: originToken.row + rowDelta,
            }))
          ));
        }
      } finally {
        setTokenDragState(null);
        setMeasurementState(null);
      }
    }
  }, [
    getWorldPointFromClient,
    normalizedGrid,
    onMoveTokens,
    selectionBox,
    tokenDragState,
    tokenItems,
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

      const pointerWorld = getWorldPointFromClient(event.clientX, event.clientY);
      if (!pointerWorld) return;

      const hasMovedBeyondThreshold = (
        Math.abs(event.clientX - activeInteraction.startClient.x) >= POINTER_DRAG_THRESHOLD_PX
        || Math.abs(event.clientY - activeInteraction.startClient.y) >= POINTER_DRAG_THRESHOLD_PX
      );

      if (activeInteraction.type === 'selection-candidate') {
        if (!hasMovedBeyondThreshold) return;

        if (isRulerEnabled) {
          interactionRef.current = {
            ...activeInteraction,
            type: 'measure',
          };
          setMeasurementState(buildGridMeasurementFromPoints({
            startPoint: activeInteraction.startWorld,
            endPoint: pointerWorld,
            grid: normalizedGrid,
          }));
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
        return;
      }

      if (activeInteraction.type === 'measure-candidate') {
        if (!hasMovedBeyondThreshold) return;

        interactionRef.current = {
          ...activeInteraction,
          type: 'measure',
        };
        setMeasurementState(buildGridMeasurementFromPoints({
          startPoint: activeInteraction.startWorld,
          endPoint: pointerWorld,
          grid: normalizedGrid,
        }));
        return;
      }

      if (activeInteraction.type === 'selection-box') {
        setSelectionBox({
          start: activeInteraction.startWorld,
          end: pointerWorld,
        });
        return;
      }

      if (activeInteraction.type === 'measure') {
        setMeasurementState(buildGridMeasurementFromPoints({
          startPoint: activeInteraction.startWorld,
          endPoint: pointerWorld,
          grid: normalizedGrid,
        }));
        return;
      }

      if (activeInteraction.type === 'token-candidate') {
        if (!hasMovedBeyondThreshold) return;

        interactionRef.current = {
          ...activeInteraction,
          type: 'token-drag',
        };
      }

      if (interactionRef.current?.type === 'token-drag') {
        const nextDeltaWorld = {
          x: pointerWorld.x - activeInteraction.startWorld.x,
          y: pointerWorld.y - activeInteraction.startWorld.y,
        };

        setTokenDragState({
          draggedTokenId: activeInteraction.draggedTokenId,
          tokenIds: activeInteraction.selectedIds,
          originTokens: activeInteraction.originTokens,
          deltaWorld: nextDeltaWorld,
        });

        if (isRulerEnabled) {
          const draggedOriginToken = activeInteraction.originTokens.find(
            (originToken) => originToken.tokenId === activeInteraction.draggedTokenId
          );

          if (draggedOriginToken) {
            const snappedDraggedPosition = snapBoardPointToGrid({
              x: draggedOriginToken.x + nextDeltaWorld.x,
              y: draggedOriginToken.y + nextDeltaWorld.y,
            }, normalizedGrid, 'top-left');

            setMeasurementState(buildGridMeasurement({
              startCell: draggedOriginToken,
              endCell: snappedDraggedPosition,
              grid: normalizedGrid,
            }));
          }
        }
      }
    };

    const handleWindowMouseUp = (event) => {
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
  }, [finalizeInteraction, getWorldPointFromClient, isRulerEnabled, normalizedGrid]);

  useEffect(() => {
    const handleKeyDown = async (event) => {
      if (!selectedTokenIds.length) return;
      if (isEditableElementFocused()) return;

      if (event.key !== 'Delete' && event.code !== 'Delete') return;

      event.preventDefault();

      try {
        await Promise.resolve(onDeleteTokens?.(selectedTokenIds));
        setSelectedTokenIds([]);
      } catch {
        // preserve selection if deletion fails
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDeleteTokens, selectedTokenIds]);

  const handleStageMouseDown = (event) => {
    if (isTokenDragActive) return;
    if (event.target !== stageRef.current) return;

    const nativeEvent = event.evt;

    if (isSecondaryMouseButton(nativeEvent)) {
      nativeEvent.preventDefault();
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

    setMeasurementState(null);

    if (isRulerEnabled) {
      setSelectedTokenIds([]);
      setSelectionBox(null);
      interactionRef.current = {
        type: 'measure-candidate',
        startClient: {
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        },
        startWorld: pointerWorld,
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
    };
  };

  const handleTokenMouseDown = (token, event) => {
    const nativeEvent = event.evt;
    event.cancelBubble = true;

    if (isSecondaryMouseButton(nativeEvent)) {
      nativeEvent.preventDefault();
      return;
    }

    if (!isPrimaryMouseButton(nativeEvent)) return;

    setMeasurementState(null);

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
          x: selectedToken.position.x,
          y: selectedToken.position.y,
          size: selectedToken.position.size,
        })),
    };
  };

  const normalizedSelectionRect = useMemo(
    () => normalizeSelectionRect(selectionBox),
    [selectionBox]
  );

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-700 bg-slate-950/80 shadow-2xl">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Grigliata</h2>
          <p className="text-xs text-slate-400">
            {resolvedBackground?.name || 'Grid only'} | {normalizedGrid.cellSizePx}px squares | 5 ft per square
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <DrawColorPicker
            activeColorKey={resolvedDrawTheme.key}
            onChange={onChangeDrawColor}
          />
          <button
            type="button"
            onClick={onToggleRuler}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              isRulerEnabled
                ? 'border-sky-400/60 bg-sky-500/15 text-sky-100 hover:bg-sky-500/20'
                : 'border-slate-700 text-slate-200 hover:bg-slate-800'
            }`}
          >
            {isRulerEnabled ? 'Ruler On' : 'Ruler Off'}
          </button>
          {isManager && (
            <>
              <button
                type="button"
                onClick={() => onAdjustGridSize?.(1)}
                disabled={isGridSizeAdjustmentDisabled}
                title="Increase square size"
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => onAdjustGridSize?.(-1)}
                disabled={isGridSizeAdjustmentDisabled}
                title="Decrease square size"
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                -
              </button>
            </>
          )}
          <button
            type="button"
            onClick={fitToBoard}
            className="rounded-md border border-amber-500/40 px-3 py-1.5 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/10"
          >
            Reset View
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`relative w-full min-h-[520px] transition-colors ${
          isDropActive ? 'bg-amber-500/10' : 'bg-slate-950/40'
        }`}
        style={{ height: boardHeight }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onContextMenu={(event) => event.preventDefault()}
      >
        {isTokenDragActive && (
          <div
            className="absolute inset-0 z-20"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onContextMenu={(event) => event.preventDefault()}
          />
        )}

        <div className="absolute left-4 top-4 z-10 rounded-lg border border-slate-700/70 bg-slate-950/80 px-3 py-2 text-xs text-slate-300 shadow-lg">
          {isRulerEnabled
            ? `Right-drag empty space to pan. Left-drag empty space to measure. Drag tokens to move with visible feet count.${isManager ? ' Use +/- to calibrate square size.' : ''}`
            : `Right-drag empty space to pan. Left-drag to select. Press Delete to remove selected tokens from this map.${isManager ? ' Use +/- to calibrate square size.' : ''}`}
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

              {backgroundImage && resolvedBackground?.imageWidth > 0 && resolvedBackground?.imageHeight > 0 && (
                <KonvaImage
                  image={backgroundImage}
                  x={0}
                  y={0}
                  width={resolvedBackground.imageWidth}
                  height={resolvedBackground.imageHeight}
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

              <GridLayer bounds={boardBounds} grid={normalizedGrid} />

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

              {renderedTokens.map((token) => (
                <TokenNode
                  key={token.tokenId}
                  token={token}
                  position={token.renderPosition}
                  canMove={token.canMove}
                  isSelected={token.isSelected}
                  drawTheme={resolvedDrawTheme}
                  onMouseDown={handleTokenMouseDown}
                />
              ))}

              {measurementState && (
                <MeasurementOverlay measurement={measurementState} drawTheme={resolvedDrawTheme} />
              )}
            </Layer>
          </Stage>
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
