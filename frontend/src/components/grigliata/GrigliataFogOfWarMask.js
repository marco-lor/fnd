import React, { useMemo } from 'react';
import {
  Group,
  Path,
  Rect,
} from 'react-konva';
import { normalizeGridConfig } from './boardUtils';
import {
  decodeFogCellKey,
  normalizeFogCellKeys,
} from './fogOfWar';
import {
  applyFogMemoryPolygonHide,
  applyFogMemoryPolygonReveal,
  normalizeFogMemoryPolygons,
  normalizeRenderableFogPolygons,
} from './fogPolygonGeometry';

const FOG_FILL = '#020617';
const UNEXPLORED_OPACITY = 1;
const EXPLORED_CUTOUT_OPACITY = 0.54;
export const REMEMBERED_FOG_OPACITY = Number((1 - EXPLORED_CUTOUT_OPACITY).toFixed(2));
const GEOMETRY_EPSILON = 1e-6;

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

const pointIsOnSegment = (point, start, end) => {
  const cross = (
    (point.y - start.y) * (end.x - start.x)
    - (point.x - start.x) * (end.y - start.y)
  );
  if (Math.abs(cross) > GEOMETRY_EPSILON) {
    return false;
  }

  const dot = (
    (point.x - start.x) * (end.x - start.x)
    + (point.y - start.y) * (end.y - start.y)
  );
  if (dot < -GEOMETRY_EPSILON) {
    return false;
  }

  const squaredLength = ((end.x - start.x) ** 2) + ((end.y - start.y) ** 2);
  return dot <= squaredLength + GEOMETRY_EPSILON;
};

const pointIsInRing = (point, ring = []) => {
  let isInside = false;

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const start = ring[previousIndex];
    const end = ring[index];

    if (pointIsOnSegment(point, start, end)) {
      return true;
    }

    const intersects = (
      (start.y > point.y) !== (end.y > point.y)
      && point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    );

    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
};

const pointIsInFogPolygons = (point, polygons = []) => (
  polygons.some((polygon) => (
    Array.isArray(polygon?.[0])
    && pointIsInRing(point, polygon[0])
    && polygon.slice(1).every((ring) => !pointIsInRing(point, ring))
  ))
);

const cellCenterFromRect = (rect) => ({
  x: rect.x + (rect.width / 2),
  y: rect.y + (rect.height / 2),
});

const buildFogPolygonPathData = (polygons = []) => (
  polygons.flatMap((polygon) => (
    polygon.map((ring) => {
      if (!Array.isArray(ring) || ring.length < 3) {
        return '';
      }

      const [firstPoint, ...restPoints] = ring;
      return [
        `M ${firstPoint.x} ${firstPoint.y}`,
        ...restPoints.map((point) => `L ${point.x} ${point.y}`),
        'Z',
      ].join(' ');
    })
  )).filter(Boolean).join(' ')
);

const unionFogPolygons = (leftPolygons = [], rightPolygons = []) => {
  if (leftPolygons.length < 1) {
    return rightPolygons;
  }
  if (rightPolygons.length < 1) {
    return leftPolygons;
  }

  return applyFogMemoryPolygonReveal({
    existingPolygons: leftPolygons,
    revealPolygons: rightPolygons,
  }) || [...leftPolygons, ...rightPolygons];
};

const subtractFogPolygons = (existingPolygons = [], hidePolygons = []) => {
  if (existingPolygons.length < 1 || hidePolygons.length < 1) {
    return existingPolygons;
  }

  return applyFogMemoryPolygonHide({
    existingPolygons,
    hidePolygons,
  }) || existingPolygons;
};

export const buildFogMaskPolygonBands = ({
  exploredPolygons = [],
  currentVisiblePolygons = [],
} = {}) => {
  const normalizedExploredPolygons = normalizeFogMemoryPolygons(exploredPolygons) || [];
  const normalizedCurrentPolygons = normalizeRenderableFogPolygons(currentVisiblePolygons) || [];
  const knownPolygons = unionFogPolygons(normalizedExploredPolygons, normalizedCurrentPolygons);
  const rememberedOnlyPolygons = subtractFogPolygons(
    normalizedExploredPolygons,
    normalizedCurrentPolygons
  );

  return {
    exploredPolygons: normalizedExploredPolygons,
    currentPolygons: normalizedCurrentPolygons,
    knownPolygons,
    rememberedOnlyPolygons,
  };
};

export default function GrigliataFogOfWarMask({
  bounds,
  grid,
  exploredCells = [],
  exploredPolygons = [],
  currentVisibleCells = [],
  currentVisiblePolygons = [],
  forceRenderExploredCellFallback = false,
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
  const polygonBands = useMemo(
    () => buildFogMaskPolygonBands({
      exploredPolygons,
      currentVisiblePolygons,
    }),
    [currentVisiblePolygons, exploredPolygons]
  );
  const normalizedCurrentPolygons = polygonBands.currentPolygons;
  const knownPolygons = polygonBands.knownPolygons;
  const rememberedOnlyPolygons = polygonBands.rememberedOnlyPolygons;
  const hasExploredPolygonMemory = polygonBands.exploredPolygons.length > 0;
  const knownPolygonPathData = useMemo(
    () => buildFogPolygonPathData(knownPolygons),
    [knownPolygons]
  );
  const rememberedPolygonPathData = useMemo(
    () => buildFogPolygonPathData(rememberedOnlyPolygons),
    [rememberedOnlyPolygons]
  );
  const currentPolygonPathData = useMemo(
    () => buildFogPolygonPathData(normalizedCurrentPolygons),
    [normalizedCurrentPolygons]
  );
  const hasKnownPolygons = knownPolygons.length > 0 && !!knownPolygonPathData;
  const hasRememberedPolygons = rememberedOnlyPolygons.length > 0 && !!rememberedPolygonPathData;
  const hasCurrentPolygons = normalizedCurrentPolygons.length > 0 && !!currentPolygonPathData;
  const rememberedCellRects = useMemo(
    () => (hasExploredPolygonMemory && !forceRenderExploredCellFallback
      ? []
      : normalizeFogCellKeys(exploredCells) || [])
      .filter((cellKey) => !currentCellSet.has(cellKey))
      .map((cellKey) => buildCellRect({ cellKey, grid: normalizedGrid }))
      .filter((rect) => !rect || !pointIsInFogPolygons(cellCenterFromRect(rect), knownPolygons))
      .filter(Boolean),
    [currentCellSet, exploredCells, forceRenderExploredCellFallback, hasExploredPolygonMemory, knownPolygons, normalizedGrid]
  );
  const currentCellRects = useMemo(
    () => (hasCurrentPolygons ? [] : normalizedCurrentCells)
      .map((cellKey) => buildCellRect({ cellKey, grid: normalizedGrid }))
      .filter(Boolean),
    [hasCurrentPolygons, normalizedCurrentCells, normalizedGrid]
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

      {hasKnownPolygons && (
        <Path
          data-testid="fog-known-polygon-clear"
          data={knownPolygonPathData}
          fill="#ffffff"
          fillRule="evenodd"
          globalCompositeOperation="destination-out"
          listening={false}
        />
      )}

      {rememberedCellRects.map((rect) => (
        <Rect
          key={`fog-remembered-clear-${rect.cellKey}`}
          data-testid="fog-remembered-cell-clear"
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

      {hasRememberedPolygons && (
        <Path
          data-testid="fog-remembered-polygon-overlay"
          data={rememberedPolygonPathData}
          fill={FOG_FILL}
          fillRule="evenodd"
          opacity={REMEMBERED_FOG_OPACITY}
          listening={false}
        />
      )}

      {rememberedCellRects.map((rect) => (
        <Rect
          key={`fog-remembered-overlay-${rect.cellKey}`}
          data-testid="fog-remembered-cell-overlay"
          data-cellkey={rect.cellKey}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill={FOG_FILL}
          opacity={REMEMBERED_FOG_OPACITY}
          listening={false}
        />
      ))}

      {hasCurrentPolygons && (
        <Path
          data-testid="fog-current-polygon-cutout"
          data={currentPolygonPathData}
          fill="#ffffff"
          fillRule="evenodd"
          globalCompositeOperation="destination-out"
          listening={false}
        />
      )}

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
