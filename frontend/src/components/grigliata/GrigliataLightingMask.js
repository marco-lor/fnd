import React, { useMemo } from 'react';
import {
  Circle,
  Group,
  Line,
  Rect,
} from 'react-konva';
import { normalizeGridConfig } from './boardUtils';
import { normalizeRenderableFogPolygons } from './fogPolygonGeometry';
import {
  buildLightVisibilityPolygons,
  buildTokenVisionPolygons,
  normalizeLightingWallSegments,
} from './lightingGeometry';
import { DEFAULT_TOKEN_VISION_RADIUS_SQUARES } from './lightingVisibility';

export { DEFAULT_TOKEN_VISION_RADIUS_SQUARES };

const DARKNESS_FILL = '#020617';
const DIM_LIGHT_CUTOUT_OPACITY = 0.42;
const DIM_LIGHT_TINT_OPACITY = 0.12;
const BRIGHT_LIGHT_TINT_OPACITY = 0.18;
const GLOBAL_DIM_LIGHT_TINT_OPACITY = 0.18;
const GLOBAL_BRIGHT_LIGHT_TINT_OPACITY = 0.26;
const FOG_DIM_LIGHT_TINT_OPACITY = 0.045;
const FOG_BRIGHT_LIGHT_TINT_OPACITY = 0.12;
const DARKNESS_SOURCE_FILL = 'rgba(2, 6, 23, 1)';

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

const whiteWithAlpha = (alpha) => `rgba(255, 255, 255, ${alpha})`;

const polygonToPoints = (polygon = []) => (
  polygon.flatMap((point) => [point.x, point.y])
);

const hasRenderablePolygon = (polygon) => Array.isArray(polygon) && polygon.length >= 3;

const getGradientRadius = (light) => Math.max(
  asFiniteNumber(light?.dimRadiusPx, 0),
  asFiniteNumber(light?.brightRadiusPx, 0)
);

const getBrightStop = (light, radius) => clamp(
  radius > 0 ? asFiniteNumber(light?.brightRadiusPx, 0) / radius : 0,
  0,
  1
);

const buildLightCutoutGradientStops = (light) => {
  const radius = getGradientRadius(light);
  const brightStop = getBrightStop(light, radius);
  const brightHoldStop = clamp(brightStop * 0.86, 0, 1);
  const dimStopOpacity = brightStop > 0 && brightStop < 1 ? 0.7 : DIM_LIGHT_CUTOUT_OPACITY;

  return [
    0,
    whiteWithAlpha(1),
    brightHoldStop,
    whiteWithAlpha(1),
    Math.max(brightStop, brightHoldStop),
    whiteWithAlpha(dimStopOpacity),
    1,
    whiteWithAlpha(0),
  ];
};

const buildLightTintGradientStops = (light, isGlobalLight) => {
  const radius = getGradientRadius(light);
  const brightStop = getBrightStop(light, radius);
  const dimOpacity = isGlobalLight ? GLOBAL_DIM_LIGHT_TINT_OPACITY : DIM_LIGHT_TINT_OPACITY;
  const brightOpacity = isGlobalLight ? GLOBAL_BRIGHT_LIGHT_TINT_OPACITY : BRIGHT_LIGHT_TINT_OPACITY;

  return [
    0,
    withAlpha(light.color, brightOpacity),
    clamp(brightStop * 0.86, 0, 1),
    withAlpha(light.color, brightOpacity),
    Math.max(brightStop, 0.01),
    withAlpha(light.color, dimOpacity),
    1,
    withAlpha(light.color, 0),
  ];
};

const buildFogLightTintGradientStops = (light) => {
  const radius = getGradientRadius(light);
  const brightStop = getBrightStop(light, radius);

  return [
    0,
    withAlpha(light.color, FOG_BRIGHT_LIGHT_TINT_OPACITY),
    clamp(brightStop * 0.75, 0, 1),
    withAlpha(light.color, FOG_BRIGHT_LIGHT_TINT_OPACITY),
    Math.max(brightStop, 0.01),
    withAlpha(light.color, FOG_DIM_LIGHT_TINT_OPACITY),
    1,
    withAlpha(light.color, 0),
  ];
};

const buildPolygonClipFunc = (polygons = []) => {
  if (!Array.isArray(polygons) || polygons.length < 1) {
    return null;
  }

  return (context) => {
    context.beginPath();
    polygons.forEach((polygon) => {
      const outerRing = polygon?.[0];
      if (!hasRenderablePolygon(outerRing)) {
        return;
      }

      outerRing.forEach((point, index) => {
        if (index === 0) {
          context.moveTo(point.x, point.y);
          return;
        }
        context.lineTo(point.x, point.y);
      });
      context.closePath();
    });
  };
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

export default function GrigliataLightingMask({
  bounds,
  grid,
  metadata,
  tokens = [],
  visionSources = null,
  lightClipPolygons,
  rayCount,
}) {
  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);
  const resolvedVisionSources = Array.isArray(visionSources) ? visionSources : tokens;
  const wallSegments = useMemo(
    () => normalizeLightingWallSegments(metadata?.walls),
    [metadata?.walls]
  );
  const tokenVisionPolygons = useMemo(
    () => buildTokenVisionPolygons({
      tokens: resolvedVisionSources,
      visionRadiusPx: normalizedGrid.cellSizePx * DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
      segments: wallSegments,
      rayCount,
    }),
    [normalizedGrid.cellSizePx, rayCount, resolvedVisionSources, wallSegments]
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
  const darknessSources = useMemo(
    () => (Array.isArray(metadata?.darknessSources) ? metadata.darknessSources : [])
      .map((darkness) => {
        const x = Number(darkness?.x);
        const y = Number(darkness?.y);
        const radiusPx = Math.max(0, asFiniteNumber(darkness?.radiusPx, 0));
        const intensity = clamp(asFiniteNumber(darkness?.intensity, 1), 0, 1);

        if (![x, y, radiusPx, intensity].every(Number.isFinite) || radiusPx <= 0 || intensity <= 0) {
          return null;
        }

        return {
          x,
          y,
          radiusPx,
          intensity,
        };
      })
      .filter(Boolean),
    [metadata?.darknessSources]
  );
  const shouldClipLightContributions = Array.isArray(lightClipPolygons);
  const normalizedLightClipPolygons = useMemo(
    () => (shouldClipLightContributions
      ? normalizeRenderableFogPolygons(lightClipPolygons) || []
      : []),
    [lightClipPolygons, shouldClipLightContributions]
  );
  const lightClipFunc = useMemo(
    () => buildPolygonClipFunc(normalizedLightClipPolygons),
    [normalizedLightClipPolygons]
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
  const hasDarknessSourceContribution = darknessSources.length > 0;
  const canRenderLightContributions = !shouldClipLightContributions || normalizedLightClipPolygons.length > 0;
  const shouldUseFogLightGlows = shouldClipLightContributions;
  const lightContributionNodes = canRenderLightContributions ? (
    <>
      {lightPolygons.map((light) => {
        const clipPolygon = hasRenderablePolygon(light.dimPolygon)
          ? light.dimPolygon
          : light.brightPolygon;
        const radius = getGradientRadius(light);

        if (!hasRenderablePolygon(clipPolygon) || radius <= 0) {
          return null;
        }

        if (shouldUseFogLightGlows) {
          return (
            <Group
              key={`light-gradient-${light.id}`}
              data-testid="lighting-light-gradient"
              listening={false}
            >
              <Circle
                data-testid="lighting-light-dim-polygon"
                x={light.origin.x}
                y={light.origin.y}
                radius={radius}
                fillRadialGradientStartPoint={{ x: 0, y: 0 }}
                fillRadialGradientStartRadius={0}
                fillRadialGradientEndPoint={{ x: 0, y: 0 }}
                fillRadialGradientEndRadius={radius}
                fillRadialGradientColorStops={buildFogLightTintGradientStops(light)}
                listening={false}
              />

              {asFiniteNumber(light.brightRadiusPx, 0) > 0 && (
                <Circle
                  data-testid="lighting-light-bright-polygon"
                  x={light.origin.x}
                  y={light.origin.y}
                  radius={Math.min(radius, asFiniteNumber(light.brightRadiusPx, 0))}
                  fillRadialGradientStartPoint={{ x: 0, y: 0 }}
                  fillRadialGradientStartRadius={0}
                  fillRadialGradientEndPoint={{ x: 0, y: 0 }}
                  fillRadialGradientEndRadius={Math.min(radius, asFiniteNumber(light.brightRadiusPx, 0))}
                  fillRadialGradientColorStops={[
                    0,
                    withAlpha(light.color, FOG_BRIGHT_LIGHT_TINT_OPACITY * 0.5),
                    1,
                    withAlpha(light.color, 0),
                  ]}
                  listening={false}
                />
              )}
            </Group>
          );
        }

        return (
          <Group
            key={`light-gradient-${light.id}`}
            data-testid="lighting-light-gradient"
            clipFunc={buildPolygonClipFunc([[clipPolygon]])}
            listening={false}
          >
            {!isGlobalLight && (
              <Circle
                data-testid="lighting-light-dim-cutout"
                x={light.origin.x}
                y={light.origin.y}
                radius={radius}
                fillRadialGradientStartPoint={{ x: 0, y: 0 }}
                fillRadialGradientStartRadius={0}
                fillRadialGradientEndPoint={{ x: 0, y: 0 }}
                fillRadialGradientEndRadius={radius}
                fillRadialGradientColorStops={buildLightCutoutGradientStops(light)}
                globalCompositeOperation="destination-out"
                listening={false}
              />
            )}

            {!isGlobalLight && asFiniteNumber(light.brightRadiusPx, 0) > 0 && (
              <Circle
                data-testid="lighting-light-bright-cutout"
                x={light.origin.x}
                y={light.origin.y}
                radius={Math.min(radius, asFiniteNumber(light.brightRadiusPx, 0))}
                fillRadialGradientStartPoint={{ x: 0, y: 0 }}
                fillRadialGradientStartRadius={0}
                fillRadialGradientEndPoint={{ x: 0, y: 0 }}
                fillRadialGradientEndRadius={Math.min(radius, asFiniteNumber(light.brightRadiusPx, 0))}
                fillRadialGradientColorStops={[
                  0,
                  whiteWithAlpha(0.36),
                  0.82,
                  whiteWithAlpha(0.24),
                  1,
                  whiteWithAlpha(0),
                ]}
                globalCompositeOperation="destination-out"
                listening={false}
              />
            )}

            <Circle
              data-testid="lighting-light-dim-polygon"
              x={light.origin.x}
              y={light.origin.y}
              radius={radius}
              fillRadialGradientStartPoint={{ x: 0, y: 0 }}
              fillRadialGradientStartRadius={0}
              fillRadialGradientEndPoint={{ x: 0, y: 0 }}
              fillRadialGradientEndRadius={radius}
              fillRadialGradientColorStops={buildLightTintGradientStops(light, isGlobalLight)}
              listening={false}
            />

            {asFiniteNumber(light.brightRadiusPx, 0) > 0 && (
              <Circle
                data-testid="lighting-light-bright-polygon"
                x={light.origin.x}
                y={light.origin.y}
                radius={Math.min(radius, asFiniteNumber(light.brightRadiusPx, 0))}
                fillRadialGradientStartPoint={{ x: 0, y: 0 }}
                fillRadialGradientStartRadius={0}
                fillRadialGradientEndPoint={{ x: 0, y: 0 }}
                fillRadialGradientEndRadius={Math.min(radius, asFiniteNumber(light.brightRadiusPx, 0))}
                fillRadialGradientColorStops={[
                  0,
                  withAlpha(light.color, isGlobalLight ? GLOBAL_BRIGHT_LIGHT_TINT_OPACITY : BRIGHT_LIGHT_TINT_OPACITY),
                  1,
                  withAlpha(light.color, 0),
                ]}
                listening={false}
              />
            )}
          </Group>
        );
      })}

      {darknessSources.map((darkness, index) => (
        <Circle
          key={`darkness-source-${index}-${darkness.x}-${darkness.y}`}
          data-testid="lighting-darkness-source-overlay"
          x={darkness.x}
          y={darkness.y}
          radius={darkness.radiusPx}
          fill={DARKNESS_SOURCE_FILL}
          opacity={darkness.intensity}
          listening={false}
        />
      ))}
    </>
  ) : null;

  if (!hasDarkness && !hasLightContribution && !hasDarknessSourceContribution) {
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
            data-tokenid={vision.tokenId || ''}
            points={polygonToPoints(vision.polygon)}
            closed
            fill="#ffffff"
            globalCompositeOperation="destination-out"
            listening={false}
          />
        )
      ))}

      {shouldClipLightContributions ? (
        lightContributionNodes && (
          <Group
            data-testid="lighting-light-clip-group"
            clipFunc={lightClipFunc}
            listening={false}
          >
            {lightContributionNodes}
          </Group>
        )
      ) : lightContributionNodes}
    </Group>
  );
}
