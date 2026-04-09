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
import { BOARD_FIT_PADDING, TRAY_DRAG_MIME } from './constants';
import {
  fitViewportToBounds,
  getBoardBounds,
  getInitials,
  getTokenPositionPx,
  normalizeGridConfig,
  snapBoardPointToGrid,
} from './boardUtils';
import useImageAsset from './useImageAsset';

const TokenNode = ({ token, grid, canMove, onMoveToken }) => {
  const image = useImageAsset(token?.imageUrl || '');
  const position = useMemo(() => getTokenPositionPx(token, grid), [token, grid]);
  const size = position.size;
  const label = token?.label || token?.characterId || token?.ownerUid || 'Player';
  const initials = getInitials(label);

  const handleDragStart = (event) => {
    event.cancelBubble = true;
  };

  const handleDragEnd = (event) => {
    event.cancelBubble = true;
    const snapped = snapBoardPointToGrid({ x: event.target.x(), y: event.target.y() }, grid, 'top-left');
    event.target.position({ x: snapped.x, y: snapped.y });
    event.target.getLayer()?.batchDraw();
    onMoveToken?.(token, snapped);
  };

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable={canMove}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
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

      <Circle
        x={size / 2}
        y={size / 2}
        radius={(size / 2) - 1}
        stroke={canMove ? '#fbbf24' : '#cbd5e1'}
        strokeWidth={2}
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
        fill="#e2e8f0"
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

export default function GrigliataBoard({
  activeBackground,
  grid,
  tokens,
  currentUserId,
  isManager,
  isTokenDragActive,
  boardHeight,
  onMoveToken,
  onDropCurrentToken,
}) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [isDropActive, setIsDropActive] = useState(false);
  const backgroundImage = useImageAsset(activeBackground?.imageUrl || '');
  const lastFitKeyRef = useRef('');

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

    const rect = containerRef.current.getBoundingClientRect();
    const worldPoint = {
      x: (event.clientX - rect.left - viewport.x) / viewport.scale,
      y: (event.clientY - rect.top - viewport.y) / viewport.scale,
    };

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

  return (
    <div className="relative rounded-3xl border border-slate-700 bg-slate-950/80 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Grigliata</h2>
          <p className="text-xs text-slate-400">
            {resolvedBackground?.name || 'Grid only'} | {normalizedGrid.cellSizePx}px squares
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => applyScale(viewport.scale * 1.12)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-800"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => applyScale(viewport.scale / 1.12)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-800"
          >
            -
          </button>
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
      >
        {isTokenDragActive && (
          <div
            className="absolute inset-0 z-20"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          />
        )}

        <div className="absolute left-4 top-4 z-10 rounded-lg border border-slate-700/70 bg-slate-950/80 px-3 py-2 text-xs text-slate-300 shadow-lg">
          Drag the empty board to pan. Use the mouse wheel or buttons to zoom.
        </div>

        {stageSize.width > 0 && stageSize.height > 0 && (
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            draggable
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
            onDragEnd={(event) => {
              setViewport((currentViewport) => ({
                ...currentViewport,
                x: event.target.x(),
                y: event.target.y(),
              }));
            }}
            onWheel={handleWheel}
          >
            <Layer>
              <Rect
                x={boardBounds.minX - normalizedGrid.cellSizePx}
                y={boardBounds.minY - normalizedGrid.cellSizePx}
                width={boardBounds.width + (normalizedGrid.cellSizePx * 2)}
                height={boardBounds.height + (normalizedGrid.cellSizePx * 2)}
                fill="#0f172a"
              />

              {backgroundImage && resolvedBackground?.imageWidth > 0 && resolvedBackground?.imageHeight > 0 && (
                <KonvaImage
                  image={backgroundImage}
                  x={0}
                  y={0}
                  width={resolvedBackground.imageWidth}
                  height={resolvedBackground.imageHeight}
                />
              )}

              <Rect
                x={boardBounds.minX - normalizedGrid.cellSizePx}
                y={boardBounds.minY - normalizedGrid.cellSizePx}
                width={boardBounds.width + (normalizedGrid.cellSizePx * 2)}
                height={boardBounds.height + (normalizedGrid.cellSizePx * 2)}
                fill="rgba(15, 23, 42, 0.12)"
              />

              <GridLayer bounds={boardBounds} grid={normalizedGrid} />

              {placedTokens.map((token) => {
                const tokenId = token.id || token.ownerUid;
                const canMove = isManager || token.ownerUid === currentUserId || tokenId === currentUserId;

                return (
                  <TokenNode
                    key={tokenId}
                    token={token}
                    grid={normalizedGrid}
                    canMove={canMove}
                    onMoveToken={onMoveToken}
                  />
                );
              })}
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
