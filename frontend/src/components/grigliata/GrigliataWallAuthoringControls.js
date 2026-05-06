import React, { useEffect, useMemo, useState } from 'react';
import {
  Circle,
  Group,
  Line,
} from 'react-konva';

import { normalizeEditableWallSegments } from './wallSources';

const WALL_STROKE = 'rgba(34, 211, 238, 0.92)';
const DOOR_STROKE = 'rgba(251, 191, 36, 0.96)';
const WINDOW_STROKE = 'rgba(125, 211, 252, 0.92)';
const DISABLED_STROKE = 'rgba(148, 163, 184, 0.72)';
const SELECTED_STROKE = '#F8FAFC';
const HANDLE_FILL = 'rgba(15, 23, 42, 0.86)';

const normalizeViewportScale = (viewportScale = 1) => (
  Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1
);

const scaleScreenPxToWorld = (screenPx, viewportScale = 1) => (
  screenPx / normalizeViewportScale(viewportScale)
);

const getWallStroke = (wall) => {
  if (!wall?.blocksSight) {
    return DISABLED_STROKE;
  }

  if (wall.wallType === 'door') {
    return DOOR_STROKE;
  }

  if (wall.wallType === 'window') {
    return WINDOW_STROKE;
  }

  return WALL_STROKE;
};

const stopBoardEvent = (event) => {
  if (!event) return;
  event.cancelBubble = true;
  event.evt?.stopPropagation?.();
};

export default function GrigliataWallAuthoringControls({
  walls = [],
  selectedWallId = '',
  draftWall = null,
  viewportScale = 1,
  onSelectWall = null,
  onBeginWallEndpointDrag = null,
  onBeginWallSegmentDrag = null,
}) {
  const normalizedWalls = useMemo(() => normalizeEditableWallSegments(walls), [walls]);
  const normalizedDraft = useMemo(
    () => (draftWall ? normalizeEditableWallSegments([{ id: 'draft-wall', ...draftWall }])[0] || null : null),
    [draftWall]
  );

  if (!normalizedWalls.length && !normalizedDraft) {
    return null;
  }

  const metrics = {
    strokeWidth: scaleScreenPxToWorld(3, viewportScale),
    selectedStrokeWidth: scaleScreenPxToWorld(4, viewportScale),
    hitStrokeWidth: scaleScreenPxToWorld(16, viewportScale),
    handleRadius: scaleScreenPxToWorld(7, viewportScale),
    handleStrokeWidth: scaleScreenPxToWorld(2, viewportScale),
  };

  const renderSegment = (wall) => {
    const isSelected = wall.id === selectedWallId;
    const stroke = getWallStroke(wall);
    const handleSegmentMouseDown = (event) => {
      stopBoardEvent(event);
      onSelectWall?.(wall.id);
      onBeginWallSegmentDrag?.(wall, event);
    };
    const handleEndpointMouseDown = (endpoint) => (event) => {
      stopBoardEvent(event);
      onSelectWall?.(wall.id);
      onBeginWallEndpointDrag?.(wall, endpoint, event);
    };

    return (
      <Group key={wall.id} data-testid="wall-source-control" data-wallid={wall.id}>
        <Line
          data-testid="wall-source-segment"
          data-wallid={wall.id}
          data-walltype={wall.wallType}
          data-selected={String(isSelected)}
          points={[wall.x1, wall.y1, wall.x2, wall.y2]}
          stroke={isSelected ? SELECTED_STROKE : stroke}
          strokeWidth={isSelected ? metrics.selectedStrokeWidth : metrics.strokeWidth}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
        <Line
          data-testid="wall-source-hit-target-line"
          data-wallid={wall.id}
          points={[wall.x1, wall.y1, wall.x2, wall.y2]}
          stroke="rgba(0, 0, 0, 0.01)"
          strokeWidth={metrics.hitStrokeWidth}
          lineCap="round"
          lineJoin="round"
          onMouseDown={handleSegmentMouseDown}
          onTap={handleSegmentMouseDown}
        />
        {isSelected && (
          <>
            <Circle
              data-testid="wall-source-start-handle"
              data-wallid={wall.id}
              x={wall.x1}
              y={wall.y1}
              radius={metrics.handleRadius}
              fill={HANDLE_FILL}
              stroke={SELECTED_STROKE}
              strokeWidth={metrics.handleStrokeWidth}
              onMouseDown={handleEndpointMouseDown('start')}
              onTap={handleEndpointMouseDown('start')}
            />
            <Circle
              data-testid="wall-source-end-handle"
              data-wallid={wall.id}
              x={wall.x2}
              y={wall.y2}
              radius={metrics.handleRadius}
              fill={HANDLE_FILL}
              stroke={SELECTED_STROKE}
              strokeWidth={metrics.handleStrokeWidth}
              onMouseDown={handleEndpointMouseDown('end')}
              onTap={handleEndpointMouseDown('end')}
            />
          </>
        )}
      </Group>
    );
  };

  return (
    <Group data-testid="wall-source-controls">
      {normalizedWalls.map(renderSegment)}
      {normalizedDraft && (
        <Line
          data-testid="wall-source-draft-segment"
          points={[normalizedDraft.x1, normalizedDraft.y1, normalizedDraft.x2, normalizedDraft.y2]}
          stroke={WALL_STROKE}
          strokeWidth={metrics.strokeWidth}
          dash={[scaleScreenPxToWorld(10, viewportScale), scaleScreenPxToWorld(7, viewportScale)]}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
    </Group>
  );
}

export function GrigliataSelectedWallPanel({
  wall = null,
  isPending = false,
  onUpdateWall = null,
  onDuplicateWall = null,
  onDeleteWall = null,
  onRequestClose = null,
  className = '',
  style = undefined,
}) {
  const [draftLabel, setDraftLabel] = useState(wall?.label || '');

  useEffect(() => {
    setDraftLabel(wall?.label || '');
  }, [wall]);

  if (!wall) {
    return null;
  }

  return (
    <div
      data-testid="selected-wall-panel"
      className={`w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-700/80 bg-slate-950/95 p-3 text-slate-100 shadow-2xl backdrop-blur-md ${className}`}
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Wall</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-100">{wall.label || 'Wall'}</p>
        </div>
        {onRequestClose && (
          <button
            type="button"
            aria-label="Close wall editor"
            onClick={onRequestClose}
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100"
          >
            Close
          </button>
        )}
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-300">
          Wall name
          <input
            aria-label="Wall name"
            type="text"
            value={draftLabel}
            disabled={isPending}
            onChange={(event) => setDraftLabel(event.target.value)}
            onBlur={() => onUpdateWall?.(wall.id, { label: draftLabel.trim() })}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block text-xs font-medium text-slate-300">
          Wall type
          <select
            aria-label="Wall type"
            value={wall.wallType || 'wall'}
            disabled={isPending}
            onChange={(event) => onUpdateWall?.(wall.id, { wallType: event.target.value })}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="wall">Wall</option>
            <option value="door">Door</option>
            <option value="window">Window</option>
          </select>
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm">
          <span>Blocks vision</span>
          <input
            type="checkbox"
            checked={wall.blocksVision === true}
            disabled={isPending}
            onChange={(event) => onUpdateWall?.(wall.id, { blocksVision: event.target.checked })}
            className="h-4 w-4 accent-cyan-300"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm">
          <span>Blocks light</span>
          <input
            type="checkbox"
            checked={wall.blocksLight === true}
            disabled={isPending}
            onChange={(event) => onUpdateWall?.(wall.id, { blocksLight: event.target.checked })}
            className="h-4 w-4 accent-cyan-300"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onDuplicateWall?.(wall.id)}
            disabled={isPending}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Duplicate Wall
          </button>
          <button
            type="button"
            onClick={() => onDeleteWall?.(wall.id)}
            disabled={isPending}
            className="rounded-xl border border-rose-400/50 bg-rose-950/50 px-3 py-2 text-xs font-semibold text-rose-100 hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Delete Wall
          </button>
        </div>
      </div>
    </div>
  );
}
