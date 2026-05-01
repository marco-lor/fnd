import React, { useMemo } from 'react';
import {
  Group,
  Line,
  Rect,
} from 'react-konva';
import { normalizeGridConfig } from './boardUtils';
import {
  buildLightVisibilityPolygons,
  buildTokenVisionPolygons,
  normalizeLightingWallSegments,
} from './lightingGeometry';

export const DEFAULT_TOKEN_VISION_RADIUS_SQUARES = 12;

const DARKNESS_FILL = '#020617';
const DIM_LIGHT_CUTOUT_OPACITY = 0.42;
const DIM_LIGHT_TINT_OPACITY = 0.12;
const BRIGHT_LIGHT_TINT_OPACITY = 0.18;
const GLOBAL_DIM_LIGHT_TINT_OPACITY = 0.18;
const GLOBAL_BRIGHT_LIGHT_TINT_OPACITY = 0.26;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const hexToRgb = (hexColor) => {
  const normalizedColor = typeof hexColor === 'string'
    ? hexColor.trim().replace('#', '')
    : '';
  const expandedColor = normalizedColor.length === 3
    ? normalizedColor.split('').map((character) => `${character}${character}`).join('')
    : normalizedColor;

  if (!/^[\da-fA-F]{6}$/.test(expandedColor)) {
    return [255, 255, 255];
  }

  return [0, 2, 4].map((startIndex) => Number.parseInt(expandedColor.slice(startIndex, startIndex + 2), 16));
};

const withAlpha = (hexColor, alpha) => {
  const [red, green, blue] = hexToRgb(hexColor);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const polygonToPoints = (polygon = []) => (
  polygon.flatMap((point) => [point.x, point.y])
);

const hasRenderablePolygon = (polygon) => Array.isArray(polygon) && polygon.length >= 3;

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

export default function GrigliataLightingMask({
  bounds,
  grid,
  metadata,
  tokens = [],
  rayCount,
}) {
  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);
  const wallSegments = useMemo(
    () => normalizeLightingWallSegments(metadata?.walls),
    [metadata?.walls]
  );
  const tokenVisionPolygons = useMemo(
    () => buildTokenVisionPolygons({
      tokens,
      visionRadiusPx: normalizedGrid.cellSizePx * DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
      segments: wallSegments,
      rayCount,
    }),
    [normalizedGrid.cellSizePx, rayCount, tokens, wallSegments]
  );
  const lightPolygons = useMemo(
    () => (Array.isArray(metadata?.lights) ? metadata.lights : [])
      .map((light) => buildLightVisibilityPolygons({
        light,
        segments: wallSegments,
        rayCount,
      }))
      .filter(Boolean),
    [metadata?.lights, rayCount, wallSegments]
  );
  const coverRect = useMemo(
    () => buildCoverRect({ bounds, grid: normalizedGrid }),
    [bounds, normalizedGrid]
  );

  if (!metadata) {
    return null;
  }

  const scene = metadata.scene || {};
  const isGlobalLight = scene.globalLight === true;
  const darknessOpacity = clamp(asFiniteNumber(scene.darkness, 0), 0, 1);
  const hasDarkness = !isGlobalLight && darknessOpacity > 0;
  const hasLightContribution = lightPolygons.some((light) => (
    hasRenderablePolygon(light.dimPolygon) || hasRenderablePolygon(light.brightPolygon)
  ));

  if (!hasDarkness && !hasLightContribution) {
    return null;
  }

  return (
    <Group data-testid="lighting-mask-layer" listening={false}>
      {hasDarkness && (
        <Rect
          data-testid="lighting-darkness-overlay"
          x={coverRect.x}
          y={coverRect.y}
          width={coverRect.width}
          height={coverRect.height}
          fill={DARKNESS_FILL}
          opacity={darknessOpacity}
          listening={false}
        />
      )}

      {!isGlobalLight && tokenVisionPolygons.map((vision) => (
        hasRenderablePolygon(vision.polygon) && (
          <Line
            key={`token-vision-${vision.tokenId || `${vision.origin.x}-${vision.origin.y}`}`}
            data-testid="lighting-token-vision-cutout"
            points={polygonToPoints(vision.polygon)}
            closed
            fill="#ffffff"
            globalCompositeOperation="destination-out"
            listening={false}
          />
        )
      ))}

      {!isGlobalLight && lightPolygons.map((light) => (
        hasRenderablePolygon(light.dimPolygon) && (
          <Line
            key={`light-dim-cutout-${light.id}`}
            data-testid="lighting-light-dim-cutout"
            points={polygonToPoints(light.dimPolygon)}
            closed
            fill="#ffffff"
            opacity={DIM_LIGHT_CUTOUT_OPACITY}
            globalCompositeOperation="destination-out"
            listening={false}
          />
        )
      ))}

      {!isGlobalLight && lightPolygons.map((light) => (
        hasRenderablePolygon(light.brightPolygon) && (
          <Line
            key={`light-bright-cutout-${light.id}`}
            data-testid="lighting-light-bright-cutout"
            points={polygonToPoints(light.brightPolygon)}
            closed
            fill="#ffffff"
            globalCompositeOperation="destination-out"
            listening={false}
          />
        )
      ))}

      {lightPolygons.map((light) => (
        hasRenderablePolygon(light.dimPolygon) && (
          <Line
            key={`light-dim-polygon-${light.id}`}
            data-testid="lighting-light-dim-polygon"
            points={polygonToPoints(light.dimPolygon)}
            closed
            fill={withAlpha(light.color, 1)}
            opacity={isGlobalLight ? GLOBAL_DIM_LIGHT_TINT_OPACITY : DIM_LIGHT_TINT_OPACITY}
            listening={false}
          />
        )
      ))}

      {lightPolygons.map((light) => (
        hasRenderablePolygon(light.brightPolygon) && (
          <Line
            key={`light-bright-polygon-${light.id}`}
            data-testid="lighting-light-bright-polygon"
            points={polygonToPoints(light.brightPolygon)}
            closed
            fill={withAlpha(light.color, 1)}
            opacity={isGlobalLight ? GLOBAL_BRIGHT_LIGHT_TINT_OPACITY : BRIGHT_LIGHT_TINT_OPACITY}
            listening={false}
          />
        )
      ))}
    </Group>
  );
}
