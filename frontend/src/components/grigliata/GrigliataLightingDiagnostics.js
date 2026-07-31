import React, { useMemo } from 'react';

import { normalizeEditableWallSegments } from './wallSources';
import { normalizeTokenVisionSettings } from './lightingVisibility';

const countLights = (lights = []) => (
  (Array.isArray(lights) ? lights : []).reduce((counts, light) => {
    if (light?.enabled === false) {
      return { ...counts, disabled: counts.disabled + 1 };
    }

    return { ...counts, active: counts.active + 1 };
  }, { active: 0, disabled: 0 })
);

const countWallsByType = (walls = []) => (
  normalizeEditableWallSegments(walls).reduce((counts, wall) => ({
    ...counts,
    [wall.wallType]: (counts[wall.wallType] || 0) + 1,
  }), { wall: 0, door: 0, window: 0 })
);

export default function GrigliataLightingDiagnostics({
  isVisible = true,
  lights = [],
  walls = [],
  selectedToken = null,
  className = '',
  style = undefined,
}) {
  const lightCounts = useMemo(() => countLights(lights), [lights]);
  const wallCounts = useMemo(() => countWallsByType(walls), [walls]);
  const tokenVision = selectedToken?.tokenId
    ? normalizeTokenVisionSettings(selectedToken)
    : null;

  if (!isVisible) {
    return null;
  }

  return (
    <div
      data-testid="lighting-diagnostics-panel"
      className={`w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-slate-700/80 bg-slate-950/92 px-3 py-2 text-xs text-slate-200 shadow-xl backdrop-blur-md ${className}`}
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Active Lights</p>
          <p data-testid="lighting-diagnostics-active-lights" className="text-sm font-semibold text-slate-100">{lightCounts.active}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Disabled</p>
          <p data-testid="lighting-diagnostics-disabled-lights" className="text-sm font-semibold text-slate-100">{lightCounts.disabled}</p>
        </div>
      </div>
      <p data-testid="lighting-diagnostics-wall-counts" className="mt-2 text-slate-300">
        Wall {wallCounts.wall} | Door {wallCounts.door} | Window {wallCounts.window}
      </p>
      <p data-testid="lighting-diagnostics-token-vision" className="mt-1 text-slate-300">
        {tokenVision
          ? `${tokenVision.visionEnabled ? 'Enabled' : 'Disabled'}, ${tokenVision.visionRadiusSquares} squares`
          : 'No token selected'}
      </p>
    </div>
  );
}
