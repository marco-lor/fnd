import React, { useEffect, useMemo, useState } from 'react';
import {
  Circle,
  Group,
} from 'react-konva';
import {
  DEFAULT_LIGHT_SOURCE_COLOR,
  LIGHT_SOURCE_COLOR_SWATCHES,
  normalizeEditableLightSources,
} from './lightSources';

const ENABLED_HANDLE_FILL = 'rgba(250, 204, 21, 0.92)';
const DISABLED_HANDLE_FILL = 'rgba(100, 116, 139, 0.88)';
const SELECTED_STROKE = '#F8FAFC';
const DEFAULT_STROKE = 'rgba(15, 23, 42, 0.92)';
const BRIGHT_RADIUS_FILL = 'rgba(250, 204, 21, 0.08)';
const DIM_RADIUS_FILL = 'rgba(250, 204, 21, 0.045)';

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeViewportScale = (viewportScale = 1) => (
  Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1
);

const scaleScreenPxToWorld = (screenPx, viewportScale = 1) => (
  screenPx / normalizeViewportScale(viewportScale)
);

const normalizeCellSizePx = (grid) => {
  const cellSizePx = Number(grid?.cellSizePx);
  return Number.isFinite(cellSizePx) && cellSizePx > 0 ? cellSizePx : 70;
};

const normalizeRadiusSquares = (value, fallback = 0) => (
  Math.max(0, Math.round(asFiniteNumber(value, fallback)))
);

const pxToSquares = (radiusPx, grid) => (
  normalizeRadiusSquares(asFiniteNumber(radiusPx, 0) / normalizeCellSizePx(grid))
);

const stopBoardEvent = (event) => {
  if (!event) return;
  event.cancelBubble = true;
  event.evt?.stopPropagation?.();
};

export default function GrigliataLightControls({
  lights = [],
  selectedLightId = '',
  viewportScale = 1,
  onSelectLight = null,
  onBeginLightDrag = null,
}) {
  const normalizedLights = useMemo(() => normalizeEditableLightSources(lights), [lights]);
  if (!normalizedLights.length) {
    return null;
  }

  const metrics = {
    handleRadius: scaleScreenPxToWorld(8, viewportScale),
    selectedHandleRadius: scaleScreenPxToWorld(10, viewportScale),
    handleStrokeWidth: scaleScreenPxToWorld(2, viewportScale),
  };

  return (
    <Group data-testid="light-source-controls">
      {normalizedLights.map((light) => {
        const isSelected = light.id === selectedLightId;
        const handleMouseDown = (event) => {
          stopBoardEvent(event);
          onSelectLight?.(light.id);
          onBeginLightDrag?.(light, event);
        };

        return (
          <Group key={light.id} data-testid="light-source-control" data-lightid={light.id}>
            {light.dimRadiusPx > 0 && (
              <Circle
                data-testid="light-source-dim-radius"
                data-lightid={light.id}
                x={light.x}
                y={light.y}
                radius={light.dimRadiusPx}
                fill={DIM_RADIUS_FILL}
                stroke={light.color}
                strokeWidth={metrics.handleStrokeWidth}
                opacity={light.enabled ? 1 : 0.35}
                listening={false}
              />
            )}
            {light.brightRadiusPx > 0 && (
              <Circle
                data-testid="light-source-bright-radius"
                data-lightid={light.id}
                x={light.x}
                y={light.y}
                radius={light.brightRadiusPx}
                fill={BRIGHT_RADIUS_FILL}
                stroke={light.color}
                strokeWidth={metrics.handleStrokeWidth}
                opacity={light.enabled ? 1 : 0.35}
                listening={false}
              />
            )}
            <Circle
              data-testid="light-source-handle"
              data-lightid={light.id}
              data-selected={String(isSelected)}
              data-enabled={String(light.enabled)}
              x={light.x}
              y={light.y}
              radius={isSelected ? metrics.selectedHandleRadius : metrics.handleRadius}
              fill={light.enabled ? ENABLED_HANDLE_FILL : DISABLED_HANDLE_FILL}
              stroke={isSelected ? SELECTED_STROKE : DEFAULT_STROKE}
              strokeWidth={metrics.handleStrokeWidth}
              onMouseDown={handleMouseDown}
              onTap={handleMouseDown}
            />
          </Group>
        );
      })}
    </Group>
  );
}

export function GrigliataSelectedLightPanel({
  light = null,
  grid = {},
  isPending = false,
  onUpdateLight = null,
  onDuplicateLight = null,
  onDeleteLight = null,
  onRequestClose = null,
  className = '',
  style = undefined,
}) {
  const [draftLabel, setDraftLabel] = useState(light?.label || '');
  const [draftBrightRadiusSquares, setDraftBrightRadiusSquares] = useState(() => pxToSquares(light?.brightRadiusPx, grid));
  const [draftDimRadiusSquares, setDraftDimRadiusSquares] = useState(() => pxToSquares(light?.dimRadiusPx, grid));
  const [draftColor, setDraftColor] = useState(light?.color || DEFAULT_LIGHT_SOURCE_COLOR);
  const cellSizePx = normalizeCellSizePx(grid);

  useEffect(() => {
    setDraftLabel(light?.label || '');
    setDraftBrightRadiusSquares(pxToSquares(light?.brightRadiusPx, grid));
    setDraftDimRadiusSquares(pxToSquares(light?.dimRadiusPx, grid));
    setDraftColor(light?.color || DEFAULT_LIGHT_SOURCE_COLOR);
  }, [grid, light]);

  if (!light) {
    return null;
  }

  const commitRadius = (fieldName, value) => {
    const radiusSquares = normalizeRadiusSquares(value);
    if (fieldName === 'brightRadiusPx') {
      setDraftBrightRadiusSquares(radiusSquares);
    } else {
      setDraftDimRadiusSquares(radiusSquares);
    }

    onUpdateLight?.(light.id, {
      [fieldName]: radiusSquares * cellSizePx,
    });
  };

  const commitColor = (nextColor) => {
    const color = typeof nextColor === 'string' && /^#[\da-fA-F]{6}$/.test(nextColor)
      ? nextColor.toUpperCase()
      : DEFAULT_LIGHT_SOURCE_COLOR;
    setDraftColor(color);
    onUpdateLight?.(light.id, { color });
  };

  return (
    <div
      data-testid="selected-light-panel"
      className={`w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-700/80 bg-slate-950/95 p-3 text-slate-100 shadow-2xl backdrop-blur-md ${className}`}
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">Light</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-100">{light.label || 'Light'}</p>
        </div>
        {onRequestClose && (
          <button
            type="button"
            aria-label="Close light editor"
            onClick={onRequestClose}
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100"
          >
            Close
          </button>
        )}
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-300">
          Light name
          <input
            aria-label="Light name"
            type="text"
            value={draftLabel}
            disabled={isPending}
            onChange={(event) => setDraftLabel(event.target.value)}
            onBlur={() => onUpdateLight?.(light.id, { label: draftLabel.trim() || 'Light' })}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm">
          <span>Light enabled</span>
          <input
            type="checkbox"
            checked={light.enabled !== false}
            disabled={isPending}
            onChange={(event) => onUpdateLight?.(light.id, { enabled: event.target.checked })}
            className="h-4 w-4 accent-amber-300"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-slate-300">
            Bright radius in squares
            <input
              aria-label="Bright radius in squares"
              type="number"
              min={0}
              step={1}
              value={draftBrightRadiusSquares}
              disabled={isPending}
              onChange={(event) => setDraftBrightRadiusSquares(event.target.value)}
              onBlur={() => commitRadius('brightRadiusPx', draftBrightRadiusSquares)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center text-sm font-semibold text-slate-100 outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="block text-xs font-medium text-slate-300">
            Dim radius in squares
            <input
              aria-label="Dim radius in squares"
              type="number"
              min={0}
              step={1}
              value={draftDimRadiusSquares}
              disabled={isPending}
              onChange={(event) => setDraftDimRadiusSquares(event.target.value)}
              onBlur={() => commitRadius('dimRadiusPx', draftDimRadiusSquares)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center text-sm font-semibold text-slate-100 outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-300">Color</p>
          <div className="mt-2 flex items-center gap-2">
            {LIGHT_SOURCE_COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Set light color ${color}`}
                disabled={isPending}
                onClick={() => commitColor(color)}
                className="h-8 w-8 rounded-full border border-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: color }}
              />
            ))}
            <input
              aria-label="Light color"
              type="color"
              value={draftColor}
              disabled={isPending}
              onChange={(event) => commitColor(event.target.value)}
              className="h-8 w-12 rounded-lg border border-slate-700 bg-slate-950 p-1 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onDuplicateLight?.(light.id)}
            disabled={isPending}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Duplicate Light
          </button>
          <button
            type="button"
            onClick={() => onDeleteLight?.(light.id)}
            disabled={isPending}
            className="rounded-xl border border-rose-400/50 bg-rose-950/50 px-3 py-2 text-xs font-semibold text-rose-100 hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Delete Light
          </button>
        </div>
      </div>
    </div>
  );
}
