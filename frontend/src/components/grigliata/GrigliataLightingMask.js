import React, { memo, useMemo } from 'react';
import {
  Circle,
  Group,
  Line,
  Rect,
} from 'react-konva';
import { normalizeGridConfig } from './boardUtils';
import { normalizeRenderableFogPolygons } from './fogPolygonGeometry';
import { DEFAULT_TOKEN_VISION_RADIUS_SQUARES } from './lightingVisibility';
import { useLightFootprints, useTokenSightFootprints } from './useGrigliataLightingGeometry';

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
const GRADIENT_CENTER = { x: 0, y: 0 };
const EMPTY_POLYGONS = [];

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

const getBrightStop = (light, radius) => clamp(
  radius > 0 ? asFiniteNumber(light?.brightRadiusPx, 0) / radius : 0,
  0,
  1
);

const buildLightCutoutGradientStops = (light) => {
  const { radius } = light;
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

const buildLightTintGradientStops = (light, isDefaultBrightness) => {
  const { radius } = light;
  const brightStop = getBrightStop(light, radius);
  const dimOpacity = isDefaultBrightness ? GLOBAL_DIM_LIGHT_TINT_OPACITY : DIM_LIGHT_TINT_OPACITY;
  const brightOpacity = isDefaultBrightness ? GLOBAL_BRIGHT_LIGHT_TINT_OPACITY : BRIGHT_LIGHT_TINT_OPACITY;

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
  const { radius } = light;
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
      polygon.forEach((ring, ringIndex) => {
        if (!hasRenderablePolygon(ring)) return;

        // Normalized rings have the same winding. Reverse holes so the
        // nonzero rule cuts them out and keeps overlapping sight sources lit.
        const first = ringIndex === 0 ? 0 : ring.length - 1;
        const step = ringIndex === 0 ? 1 : -1;
        context.moveTo(ring[first].x, ring[first].y);
        for (let index = first + step; index >= 0 && index < ring.length; index += step) {
          context.lineTo(ring[index].x, ring[index].y);
        }
        context.closePath();
      });
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

const TokenSightCutout = memo(function TokenSightCutout({ vision }) {
  return (
    <Line
      data-testid="lighting-token-vision-cutout"
      data-tokenid={vision.tokenId || ''}
      points={polygonToPoints(vision.polygon)}
      closed
      fill="#ffffff"
      globalCompositeOperation="destination-out"
      listening={false}
    />
  );
});

const LightGradient = memo(function LightGradient({ light, isGlobalLightEnabled, isFogClip }) {
  const clipFunc = useMemo(() => buildPolygonClipFunc([[light.polygon]]), [light.polygon]);
  const { radius, brightRadiusPx, color, origin } = light;
  const shouldCutOut = isGlobalLightEnabled && !isFogClip;
  const brightTintOpacity = isFogClip
    ? FOG_BRIGHT_LIGHT_TINT_OPACITY * 0.5
    : (isGlobalLightEnabled ? BRIGHT_LIGHT_TINT_OPACITY : GLOBAL_BRIGHT_LIGHT_TINT_OPACITY);
  const gradientProps = {
    x: origin.x,
    y: origin.y,
    fillRadialGradientStartPoint: GRADIENT_CENTER,
    fillRadialGradientStartRadius: 0,
    fillRadialGradientEndPoint: GRADIENT_CENTER,
    listening: false,
  };

  return (
    <Group data-testid="lighting-light-gradient" clipFunc={clipFunc} listening={false}>
      {shouldCutOut && (
        <Circle
          {...gradientProps}
          data-testid="lighting-light-dim-cutout"
          radius={radius}
          fillRadialGradientEndRadius={radius}
          fillRadialGradientColorStops={buildLightCutoutGradientStops(light)}
          globalCompositeOperation="destination-out"
        />
      )}
      {shouldCutOut && brightRadiusPx > 0 && (
        <Circle
          {...gradientProps}
          data-testid="lighting-light-bright-cutout"
          radius={brightRadiusPx}
          fillRadialGradientEndRadius={brightRadiusPx}
          fillRadialGradientColorStops={[
            0, whiteWithAlpha(0.36), 0.82, whiteWithAlpha(0.24), 1, whiteWithAlpha(0),
          ]}
          globalCompositeOperation="destination-out"
        />
      )}
      <Circle
        {...gradientProps}
        data-testid="lighting-light-dim-polygon"
        radius={radius}
        fillRadialGradientEndRadius={radius}
        fillRadialGradientColorStops={isFogClip
          ? buildFogLightTintGradientStops(light)
          : buildLightTintGradientStops(light, !isGlobalLightEnabled)}
      />
      {brightRadiusPx > 0 && (
        <Circle
          {...gradientProps}
          data-testid="lighting-light-bright-polygon"
          radius={brightRadiusPx}
          fillRadialGradientEndRadius={brightRadiusPx}
          fillRadialGradientColorStops={[0, withAlpha(color, brightTintOpacity), 1, withAlpha(color, 0)]}
        />
      )}
    </Group>
  );
});

export default memo(function GrigliataLightingMask({
  bounds,
  grid,
  metadata,
  tokens = EMPTY_POLYGONS,
  visionSources = null,
  precomputedTokenVisionPolygons = null,
  precomputedLightFootprints = null,
  lightClipPolygons,
  rayCount,
}) {
  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);
  const resolvedVisionSources = Array.isArray(visionSources) ? visionSources : tokens;
  const isGlobalLightEnabled = metadata?.scene?.globalLight === true;
  const hasPrecomputedSight = Array.isArray(precomputedTokenVisionPolygons);
  const localSight = useTokenSightFootprints({
    backgroundId: metadata?.backgroundId,
    tokens: resolvedVisionSources,
    visionRadiusPx: normalizedGrid.cellSizePx * DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
    walls: metadata?.walls,
    rayCount,
    enabled: isGlobalLightEnabled && !hasPrecomputedSight,
  });
  const tokenVisionPolygons = hasPrecomputedSight
    ? precomputedTokenVisionPolygons
    : localSight || EMPTY_POLYGONS;
  const shouldClipLightContributions = Array.isArray(lightClipPolygons);
  const normalizedLightClipPolygons = useMemo(
    () => (shouldClipLightContributions
      ? normalizeRenderableFogPolygons(lightClipPolygons) || EMPTY_POLYGONS
      : EMPTY_POLYGONS),
    [lightClipPolygons, shouldClipLightContributions]
  );
  const canRenderLightContributions = !shouldClipLightContributions || normalizedLightClipPolygons.length > 0;
  const localLightFootprints = useLightFootprints({
    metadata,
    rayCount,
    enabled: !!metadata && !precomputedLightFootprints && canRenderLightContributions,
  });
  const lights = precomputedLightFootprints || localLightFootprints || EMPTY_POLYGONS;
  const darknessSources = useMemo(
    () => (Array.isArray(metadata?.darknessSources) ? metadata.darknessSources : [])
      .map((darkness) => {
        if (darkness?.enabled === false) return null;

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
  const darknessOpacity = clamp(asFiniteNumber(scene.darkness, 0), 0, 1);
  const hasDarkness = isGlobalLightEnabled && darknessOpacity > 0;
  const hasDarknessSourceContribution = darknessSources.length > 0;
  const lightContributionNodes = canRenderLightContributions ? (
    <>
      {lights.map((light) => (
        <LightGradient
          key={light.key}
          light={light}
          isGlobalLightEnabled={isGlobalLightEnabled}
          isFogClip={shouldClipLightContributions}
        />
      ))}

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

  if (!hasDarkness && !lights.length && !hasDarknessSourceContribution) {
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

      {isGlobalLightEnabled && tokenVisionPolygons.map((vision) => (
        hasRenderablePolygon(vision.polygon) && (
          <TokenSightCutout
            key={`token-vision-${vision.tokenId || `${vision.origin.x}-${vision.origin.y}`}`}
            vision={vision}
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
});
