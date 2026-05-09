import { normalizeGridConfig } from './boardUtils';
import {
  encodeFogCellKey,
  normalizeFogCellKeys,
} from './fogOfWar';

export const FOG_BRUSH_MODE_REVEAL = 'reveal';
export const FOG_BRUSH_MODE_HIDE = 'hide';
export const MIN_FOG_BRUSH_RADIUS_SQUARES = 1;
export const MAX_FOG_BRUSH_RADIUS_SQUARES = 20;
export const DEFAULT_FOG_BRUSH_RADIUS_SQUARES = 2;
export const GRIGLIATA_FOG_BRUSH_CELL_LIMIT = 5000;

const VALID_FOG_BRUSH_MODES = new Set([
  FOG_BRUSH_MODE_REVEAL,
  FOG_BRUSH_MODE_HIDE,
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const isFinitePoint = (point) => (
  Number.isFinite(Number(point?.x))
  && Number.isFinite(Number(point?.y))
);

const limitFogCellKeys = (cellKeys, cellLimit) => {
  const normalizedCells = normalizeFogCellKeys(cellKeys) || [];
  return cellLimit === null ? normalizedCells : normalizedCells.slice(0, cellLimit);
};

export const normalizeFogBrushMode = (mode) => (
  VALID_FOG_BRUSH_MODES.has(mode) ? mode : FOG_BRUSH_MODE_REVEAL
);

export const normalizeFogBrushRadiusSquares = (
  radiusSquares,
  fallback = DEFAULT_FOG_BRUSH_RADIUS_SQUARES
) => {
  const normalizedFallback = clamp(
    Math.round(asFiniteNumber(fallback, DEFAULT_FOG_BRUSH_RADIUS_SQUARES)),
    MIN_FOG_BRUSH_RADIUS_SQUARES,
    MAX_FOG_BRUSH_RADIUS_SQUARES
  );
  const numericValue = Number(radiusSquares);

  if (!Number.isFinite(numericValue)) {
    return normalizedFallback;
  }

  return clamp(
    Math.round(numericValue),
    MIN_FOG_BRUSH_RADIUS_SQUARES,
    MAX_FOG_BRUSH_RADIUS_SQUARES
  );
};

export const normalizeFogBrushSettings = (settings = {}) => ({
  mode: normalizeFogBrushMode(settings?.mode),
  radiusSquares: normalizeFogBrushRadiusSquares(settings?.radiusSquares),
});

export const buildFogBrushCellKeys = ({
  point = {},
  radiusSquares = DEFAULT_FOG_BRUSH_RADIUS_SQUARES,
  grid,
} = {}) => {
  if (!isFinitePoint(point)) {
    return [];
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const normalizedRadiusSquares = normalizeFogBrushRadiusSquares(radiusSquares);
  const radiusPx = normalizedRadiusSquares * normalizedGrid.cellSizePx;
  const center = {
    x: Number(point.x),
    y: Number(point.y),
  };
  const minCol = Math.floor((center.x - radiusPx - normalizedGrid.offsetXPx) / normalizedGrid.cellSizePx);
  const maxCol = Math.floor((center.x + radiusPx - normalizedGrid.offsetXPx) / normalizedGrid.cellSizePx);
  const minRow = Math.floor((center.y - radiusPx - normalizedGrid.offsetYPx) / normalizedGrid.cellSizePx);
  const maxRow = Math.floor((center.y + radiusPx - normalizedGrid.offsetYPx) / normalizedGrid.cellSizePx);
  const cellKeys = [];

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const cellCenter = {
        x: normalizedGrid.offsetXPx + (col * normalizedGrid.cellSizePx) + (normalizedGrid.cellSizePx / 2),
        y: normalizedGrid.offsetYPx + (row * normalizedGrid.cellSizePx) + (normalizedGrid.cellSizePx / 2),
      };
      const distance = Math.hypot(cellCenter.x - center.x, cellCenter.y - center.y);

      if (distance <= radiusPx) {
        const cellKey = encodeFogCellKey({ col, row });
        if (cellKey) {
          cellKeys.push(cellKey);
        }
      }
    }
  }

  return normalizeFogCellKeys(cellKeys) || [];
};

export const applyFogBrushEdit = ({
  existingCells = [],
  brushCells = [],
  mode = FOG_BRUSH_MODE_REVEAL,
  cellLimit = null,
} = {}) => {
  const normalizedExistingCells = normalizeFogCellKeys(existingCells) || [];
  const normalizedBrushCells = normalizeFogCellKeys(brushCells) || [];
  const numericLimit = Number(cellLimit);
  const normalizedCellLimit = cellLimit !== null && cellLimit !== undefined && Number.isFinite(numericLimit)
    ? Math.max(0, Math.floor(numericLimit))
    : null;

  if (normalizeFogBrushMode(mode) === FOG_BRUSH_MODE_HIDE) {
    const brushCellSet = new Set(normalizedBrushCells);
    return limitFogCellKeys(
      normalizedExistingCells.filter((cellKey) => !brushCellSet.has(cellKey)),
      normalizedCellLimit
    );
  }

  const nextCells = new Set(limitFogCellKeys(normalizedExistingCells, normalizedCellLimit));
  normalizedBrushCells.forEach((cellKey) => {
    if (
      !nextCells.has(cellKey)
      && normalizedCellLimit !== null
      && nextCells.size >= normalizedCellLimit
    ) {
      return;
    }

    nextCells.add(cellKey);
  });
  return limitFogCellKeys([...nextCells], normalizedCellLimit);
};
