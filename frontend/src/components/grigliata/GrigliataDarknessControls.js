import React, { useEffect, useMemo, useState } from 'react';
import {
  Circle,
  Group,
} from 'react-konva';
import { normalizeEditableDarknessSources } from './darknessSources';

const ENABLED_HANDLE_FILL = 'rgba(15, 23, 42, 0.92)';
const DISABLED_HANDLE_FILL = 'rgba(100, 116, 139, 0.88)';
const SELECTED_STROKE = '#F8FAFC';
const DEFAULT_STROKE = 'rgba(147, 51, 234, 0.95)';
const RADIUS_FILL = 'rgba(88, 28, 135, 0.16)';
const RADIUS_STROKE = 'rgba(192, 132, 252, 0.78)';

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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

const normalizeIntensity = (value) => clamp(asFiniteNumber(value, 1), 0, 1);

const stopBoardEvent = (event) => {
  if (!event) return;
  event.cancelBubble = true;
  event.evt?.stopPropagation?.();
};

export default function GrigliataDarknessControls({
  darknessSources = [],
  selectedDarknessId = '',
  viewportScale = 1,
  onSelectDarkness = null,
  onBeginDarknessDrag = null,
}) {
  const normalizedDarknessSources = useMemo(
    () => normalizeEditableDarknessSources(darknessSources),
    [darknessSources]
  );
  if (!normalizedDarknessSources.length) {
    return null;
  }

  const metrics = {
    handleRadius: scaleScreenPxToWorld(8, viewportScale),
    selectedHandleRadius: scaleScreenPxToWorld(10, viewportScale),
    handleStrokeWidth: scaleScreenPxToWorld(2, viewportScale),
  };

  return (
    <Group data-testid="darkness-source-controls">
      {normalizedDarknessSources.map((darkness) => {
        const isSelected = darkness.id === selectedDarknessId;
        const handleMouseDown = (event) => {
          stopBoardEvent(event);
          onSelectDarkness?.(darkness.id);
          onBeginDarknessDrag?.(darkness, event);
        };

        return (
          <Group key={darkness.id} data-testid="darkness-source-control" data-darknessid={darkness.id}>
            {darkness.radiusPx > 0 && (
              <Circle
                data-testid="darkness-source-radius"
                data-darknessid={darkness.id}
                x={darkness.x}
                y={darkness.y}
                radius={darkness.radiusPx}
                fill={RADIUS_FILL}
                stroke={RADIUS_STROKE}
                strokeWidth={metrics.handleStrokeWidth}
                opacity={darkness.enabled ? darkness.intensity : 0.28}
                listening={false}
              />
            )}
            <Circle
              data-testid="darkness-source-handle"
              data-darknessid={darkness.id}
              data-selected={String(isSelected)}
              data-enabled={String(darkness.enabled)}
              x={darkness.x}
              y={darkness.y}
              radius={isSelected ? metrics.selectedHandleRadius : metrics.handleRadius}
              fill={darkness.enabled ? ENABLED_HANDLE_FILL : DISABLED_HANDLE_FILL}
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

export function GrigliataSelectedDarknessPanel({
  darkness = null,
  grid = {},
  isPending = false,
  onUpdateDarkness = null,
  onDuplicateDarkness = null,
  onDeleteDarkness = null,
  onRequestClose = null,
  className = '',
  style = undefined,
}) {
  const [draftLabel, setDraftLabel] = useState(darkness?.label || '');
  const [draftRadiusSquares, setDraftRadiusSquares] = useState(() => pxToSquares(darkness?.radiusPx, grid));
  const [draftIntensity, setDraftIntensity] = useState(() => normalizeIntensity(darkness?.intensity));
  const cellSizePx = normalizeCellSizePx(grid);

  useEffect(() => {
    setDraftLabel(darkness?.label || '');
    setDraftRadiusSquares(pxToSquares(darkness?.radiusPx, grid));
    setDraftIntensity(normalizeIntensity(darkness?.intensity));
  }, [darkness, grid]);

  if (!darkness) {
    return null;
  }

  const commitRadius = (value) => {
    const radiusSquares = normalizeRadiusSquares(value);
    setDraftRadiusSquares(radiusSquares);
    onUpdateDarkness?.(darkness.id, {
      radiusPx: radiusSquares * cellSizePx,
    });
  };

  const commitIntensity = (value) => {
    const intensity = normalizeIntensity(value);
    setDraftIntensity(intensity);
    onUpdateDarkness?.(darkness.id, { intensity });
  };

  return (
    <div
      data-testid="selected-darkness-panel"
      className={`w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-700/80 bg-slate-950/95 p-3 text-slate-100 shadow-2xl backdrop-blur-md ${className}`}
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-300">Darkness</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-100">{darkness.label || 'Darkness'}</p>
        </div>
        {onRequestClose && (
          <button
            type="button"
            aria-label="Close darkness editor"
            onClick={onRequestClose}
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100"
          >
            Close
          </button>
        )}
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-300">
          Darkness name
          <input
            aria-label="Darkness name"
            type="text"
            value={draftLabel}
            disabled={isPending}
            onChange={(event) => setDraftLabel(event.target.value)}
            onBlur={() => onUpdateDarkness?.(darkness.id, { label: draftLabel.trim() || 'Darkness' })}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none focus:border-violet-300 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-sm">
          <span>Darkness enabled</span>
          <input
            type="checkbox"
            checked={darkness.enabled !== false}
            disabled={isPending}
            onChange={(event) => onUpdateDarkness?.(darkness.id, { enabled: event.target.checked })}
            className="h-4 w-4 accent-violet-300"
          />
        </label>

        <label className="block text-xs font-medium text-slate-300">
          Radius in squares
          <input
            aria-label="Radius in squares"
            type="number"
            min={0}
            step={1}
            value={draftRadiusSquares}
            disabled={isPending}
            onChange={(event) => setDraftRadiusSquares(event.target.value)}
            onBlur={() => commitRadius(draftRadiusSquares)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center text-sm font-semibold text-slate-100 outline-none focus:border-violet-300 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block text-xs font-medium text-slate-300">
          Darkness intensity
          <input
            aria-label="Darkness intensity"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={draftIntensity}
            disabled={isPending}
            onChange={(event) => setDraftIntensity(event.target.value)}
            onBlur={() => commitIntensity(draftIntensity)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center text-sm font-semibold text-slate-100 outline-none focus:border-violet-300 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onDuplicateDarkness?.(darkness.id)}
            disabled={isPending}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Duplicate Darkness
          </button>
          <button
            type="button"
            onClick={() => onDeleteDarkness?.(darkness.id)}
            disabled={isPending}
            className="rounded-xl border border-rose-400/50 bg-rose-950/50 px-3 py-2 text-xs font-semibold text-rose-100 hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Delete Darkness
          </button>
        </div>
      </div>
    </div>
  );
}
