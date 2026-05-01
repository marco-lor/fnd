import React, { useMemo } from 'react';
import {
  Group,
  Rect,
} from 'react-konva';
import { normalizeGridConfig } from './boardUtils';
import {
  decodeFogCellKey,
  normalizeFogCellKeys,
} from './fogOfWar';

const FOG_FILL = '#020617';
const UNEXPLORED_OPACITY = 0.86;
const EXPLORED_CUTOUT_OPACITY = 0.54;

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const buildCoverRect = ({ bounds, grid }) => {
  const normalizedGrid = normalizeGridConfig(grid);
  const padding = normalizedGrid.cellSizePx;
  const minX = asFiniteNumber(bounds?.minX, 0);
  const minY = asFiniteNumber(bounds?.minY, 0);
  const width = Math.max(
    normalizedGrid.cellSizePx,
    asFiniteNumber(bounds?.width, asFiniteNumber(bounds?.maxX, 0) - minX)
  );
  const height = Math.max(
    normalizedGrid.cellSizePx,
    asFiniteNumber(bounds?.height, asFiniteNumber(bounds?.maxY, 0) - minY)
  );

  return {
    x: minX - padding,
    y: minY - padding,
    width: width + (padding * 2),
    height: height + (padding * 2),
  };
};

const buildCellRect = ({ cellKey, grid }) => {
  const cell = decodeFogCellKey(cellKey);
  if (!cell) {
    return null;
  }

  const normalizedGrid = normalizeGridConfig(grid);

  return {
    cellKey,
    x: normalizedGrid.offsetXPx + (cell.col * normalizedGrid.cellSizePx),
    y: normalizedGrid.offsetYPx + (cell.row * normalizedGrid.cellSizePx),
    width: normalizedGrid.cellSizePx,
    height: normalizedGrid.cellSizePx,
  };
};

export default function GrigliataFogOfWarMask({
  bounds,
  grid,
  exploredCells = [],
  currentVisibleCells = [],
}) {
  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);
  const coverRect = useMemo(
    () => buildCoverRect({ bounds, grid: normalizedGrid }),
    [bounds, normalizedGrid]
  );
  const normalizedCurrentCells = useMemo(
    () => normalizeFogCellKeys(currentVisibleCells) || [],
    [currentVisibleCells]
  );
  const currentCellSet = useMemo(
    () => new Set(normalizedCurrentCells),
    [normalizedCurrentCells]
  );
  const exploredCellRects = useMemo(
    () => (normalizeFogCellKeys(exploredCells) || [])
      .filter((cellKey) => !currentCellSet.has(cellKey))
      .map((cellKey) => buildCellRect({ cellKey, grid: normalizedGrid }))
      .filter(Boolean),
    [currentCellSet, exploredCells, normalizedGrid]
  );
  const currentCellRects = useMemo(
    () => normalizedCurrentCells
      .map((cellKey) => buildCellRect({ cellKey, grid: normalizedGrid }))
      .filter(Boolean),
    [normalizedCurrentCells, normalizedGrid]
  );

  return (
    <Group data-testid="fog-of-war-mask-layer" listening={false}>
      <Rect
        data-testid="fog-unexplored-overlay"
        x={coverRect.x}
        y={coverRect.y}
        width={coverRect.width}
        height={coverRect.height}
        fill={FOG_FILL}
        opacity={UNEXPLORED_OPACITY}
        listening={false}
      />

      {exploredCellRects.map((rect) => (
        <Rect
          key={`fog-explored-${rect.cellKey}`}
          data-testid="fog-explored-cell-cutout"
          data-cellkey={rect.cellKey}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill="#ffffff"
          opacity={EXPLORED_CUTOUT_OPACITY}
          globalCompositeOperation="destination-out"
          listening={false}
        />
      ))}

      {currentCellRects.map((rect) => (
        <Rect
          key={`fog-current-${rect.cellKey}`}
          data-testid="fog-current-cell-cutout"
          data-cellkey={rect.cellKey}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill="#ffffff"
          globalCompositeOperation="destination-out"
          listening={false}
        />
      ))}
    </Group>
  );
}
