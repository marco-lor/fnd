import React, { useEffect, useMemo } from 'react';
import {
  Group,
  Image as KonvaImage,
  Path,
  Rect,
} from 'react-konva';
import { normalizeGridConfig } from './boardUtils';
import { normalizeFogCellKeys } from './fogOfWar';
import { logGrigliataFogDebug } from './fogDebug';
import {
  normalizeRenderableFogPolygons,
} from './fogPolygonGeometry';
import { buildFogRasterMemoryAtlases } from './fogRasterMemory';

const FOG_FILL = '#020617';
const UNEXPLORED_OPACITY = 1;
const EXPLORED_CUTOUT_OPACITY = 0.54;
export const REMEMBERED_FOG_OPACITY = Number((1 - EXPLORED_CUTOUT_OPACITY).toFixed(2));

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

export const buildFogMaskPolygonBands = ({
  currentVisiblePolygons = [],
} = {}) => {
  const normalizedCurrentPolygons = normalizeRenderableFogPolygons(currentVisiblePolygons) || [];

  return {
    exploredPolygons: [],
    currentPolygons: normalizedCurrentPolygons,
    knownPolygons: normalizedCurrentPolygons,
    rememberedOnlyPolygons: [],
  };
};

export default function GrigliataFogOfWarMask({
  bounds,
  grid,
  exploredCells = [],
  exploredPolygons = [],
  memoryTiles = [],
  currentVisibleCells = [],
  currentVisiblePolygons = [],
}) {
  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);
  const coverRect = useMemo(
    () => buildCoverRect({ bounds, grid: normalizedGrid }),
    [bounds, normalizedGrid]
  );
  const polygonBands = useMemo(
    () => buildFogMaskPolygonBands({
      currentVisiblePolygons,
    }),
    [currentVisiblePolygons]
  );
  const rasterAtlases = useMemo(
    () => buildFogRasterMemoryAtlases({
      memoryTiles,
      grid: normalizedGrid,
    }),
    [memoryTiles, normalizedGrid]
  );
  const normalizedCurrentPolygons = polygonBands.currentPolygons;
  const currentPolygonPathData = useMemo(
    () => buildFogPolygonPathData(normalizedCurrentPolygons),
    [normalizedCurrentPolygons]
  );
  const hasRasterMemory = rasterAtlases.length > 0;
  const hasCurrentPolygons = normalizedCurrentPolygons.length > 0 && !!currentPolygonPathData;

  useEffect(() => {
    logGrigliataFogDebug('mask-render', {
      exploredCellCount: normalizeFogCellKeys(exploredCells)?.length || 0,
      exploredPolygonCount: Array.isArray(exploredPolygons) ? exploredPolygons.length : 0,
      memoryTileCount: Array.isArray(memoryTiles) ? memoryTiles.length : 0,
      rasterAtlasCount: rasterAtlases.length,
      currentVisibleCellCount: normalizeFogCellKeys(currentVisibleCells)?.length || 0,
      currentVisiblePolygonCount: normalizedCurrentPolygons.length,
      knownPolygonCount: normalizedCurrentPolygons.length,
      rememberedPolygonCount: 0,
      hasRasterMemory,
      hasCurrentPolygonPath: hasCurrentPolygons,
      visualCellFallbackRendered: false,
      currentCellCutoutsRendered: false,
    });
  }, [
    currentVisibleCells,
    exploredCells,
    exploredPolygons,
    hasCurrentPolygons,
    hasRasterMemory,
    memoryTiles,
    normalizedCurrentPolygons.length,
    rasterAtlases.length,
  ]);

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

      {rasterAtlases.map((atlas) => (
        <KonvaImage
          key={`${atlas.id}-clear`}
          data-testid="fog-remembered-raster-clear"
          image={atlas.image}
          x={atlas.x}
          y={atlas.y}
          width={atlas.width}
          height={atlas.height}
          globalCompositeOperation="destination-out"
          imageSmoothingEnabled={false}
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

      {rasterAtlases.map((atlas) => (
        <KonvaImage
          key={`${atlas.id}-overlay`}
          data-testid="fog-remembered-raster-overlay"
          image={atlas.image}
          x={atlas.x}
          y={atlas.y}
          width={atlas.width}
          height={atlas.height}
          opacity={REMEMBERED_FOG_OPACITY}
          imageSmoothingEnabled={false}
          listening={false}
        />
      ))}

      {hasCurrentPolygons && (
        <Path
          data-testid="fog-current-polygon-cutout-final"
          data={currentPolygonPathData}
          fill="#ffffff"
          fillRule="evenodd"
          globalCompositeOperation="destination-out"
          listening={false}
        />
      )}

    </Group>
  );
}
