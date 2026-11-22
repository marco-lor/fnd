import React, { useMemo } from 'react';
import {
  Circle,
  Group,
  Line,
} from 'react-konva';
import { normalizeRenderableFogPolygons } from './fogPolygonGeometry';
import { wallBlocksVisibility } from './lightingGeometry';
import { isInteractiveWallSegment } from './wallRuntimeState';

const WALL_SIGHT_STROKE = 'rgba(34, 211, 238, 0.95)';
const WALL_LIGHT_STROKE = 'rgba(251, 146, 60, 0.96)';
const WALL_BOTH_STROKE = 'rgba(196, 181, 253, 0.96)';
const WALL_CLEAR_STROKE = 'rgba(148, 163, 184, 0.88)';
const LIGHT_POINT_STROKE = 'rgba(255, 255, 255, 0.94)';
const VIEWER_SIGHT_STROKE = 'rgba(110, 231, 183, 0.95)';
const LAMP_FOOTPRINT_STROKE = 'rgba(253, 224, 71, 0.95)';
const EMPTY_CONTOURS = [];

const normalizeViewportScale = (viewportScale = 1) => (
  Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1
);

const scaleScreenPxToWorld = (screenPx, viewportScale = 1) => (
  screenPx / normalizeViewportScale(viewportScale)
);

const hexToRgb = (hexColor) => {
  const normalizedColor = typeof hexColor === 'string'
    ? hexColor.trim().replace('#', '')
    : '';

  if (!/^[\da-fA-F]{6}$/.test(normalizedColor)) {
    return [255, 255, 255];
  }

  return [0, 2, 4].map((startIndex) => Number.parseInt(normalizedColor.slice(startIndex, startIndex + 2), 16));
};

const withAlpha = (hexColor, alpha) => {
  const [red, green, blue] = hexToRgb(hexColor);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const getWallStyle = (wall, metrics) => {
  const isInteractive = isInteractiveWallSegment(wall);
  const strokeWidth = isInteractive ? metrics.doorStrokeWidth : metrics.wallStrokeWidth;
  const blocksVision = wallBlocksVisibility(wall, 'vision');
  const blocksLight = wallBlocksVisibility(wall, 'light');
  if (blocksVision && blocksLight) {
    return { stroke: WALL_BOTH_STROKE, strokeWidth, dash: isInteractive ? metrics.longDash : undefined };
  }
  if (blocksVision) {
    return { stroke: WALL_SIGHT_STROKE, strokeWidth, dash: metrics.softDash };
  }
  if (blocksLight) {
    return { stroke: WALL_LIGHT_STROKE, strokeWidth, dash: metrics.longDash };
  }
  return { stroke: WALL_CLEAR_STROKE, strokeWidth, dash: metrics.clearDash };
};

const toCoordinateRing = (ring) => ring.map(({ x, y }) => [x, y]);

const getClippedLampContours = (lamp, viewerClip) => {
  if (!lamp) return EMPTY_CONTOURS;

  const footprint = [toCoordinateRing(lamp.polygon)];
  if (!viewerClip) return footprint;
  if (!viewerClip.length) return EMPTY_CONTOURS;

  // Only the debug outline needs explicit intersection geometry. The mask
  // intersects these same footprints with nested canvas clips.
  const polygonClipping = require('polygon-clipping');
  return polygonClipping.intersection(
    footprint,
    viewerClip.map((polygon) => polygon.map(toCoordinateRing))
  ).flat();
};

export default function GrigliataLightingDebugOverlay({
  metadata,
  effectiveWalls,
  tokenSight,
  selectedTokenIds,
  selectedLight,
  lightFootprints,
  lightClipPolygons,
  viewportScale = 1,
}) {
  const authoredWalls = Array.isArray(metadata?.walls) ? metadata.walls : null;
  const walls = useMemo(() => {
    if (!authoredWalls?.length) return effectiveWalls || [];

    const effectiveById = new Map(effectiveWalls?.filter((wall) => wall.id).map((wall) => [wall.id, wall]));
    return authoredWalls.map((wall) => effectiveById.get(wall.id) || wall);
  }, [authoredWalls, effectiveWalls]);
  const lights = Array.isArray(metadata?.lights) ? metadata.lights : [];
  const viewerClip = useMemo(
    () => (Array.isArray(lightClipPolygons)
      ? normalizeRenderableFogPolygons(lightClipPolygons) || EMPTY_CONTOURS
      : null),
    [lightClipPolygons]
  );
  const sightContours = viewerClip
    ? viewerClip.flat().map((polygon, index) => ({ key: index, polygon }))
    : (tokenSight || EMPTY_CONTOURS)
      .filter((vision) => !selectedTokenIds?.size || selectedTokenIds.has(vision.tokenId))
      .map((vision) => ({ ...vision, key: vision.tokenId }));
  const lampContours = useMemo(() => {
    if (!selectedLight || selectedLight.enabled === false || !lightFootprints?.length) {
      return EMPTY_CONTOURS;
    }

    // The player projection omits authored IDs. Its normalized source
    // position and radii still identify the selected lamp's physical shape.
    const lamp = lightFootprints.find((footprint) => footprint.id === selectedLight.id)
      || lightFootprints.find((footprint) => (
        footprint.origin.x === Number(selectedLight.x)
        && footprint.origin.y === Number(selectedLight.y)
        && footprint.brightRadiusPx === Number(selectedLight.brightRadiusPx || 0)
        && footprint.dimRadiusPx === Number(selectedLight.dimRadiusPx || 0)
      ));
    return getClippedLampContours(lamp, viewerClip);
  }, [lightFootprints, selectedLight, viewerClip]);

  if (!walls.length && !lights.length && !sightContours.length && !lampContours.length) {
    return null;
  }

  const metrics = {
    wallStrokeWidth: scaleScreenPxToWorld(2.5, viewportScale),
    doorStrokeWidth: scaleScreenPxToWorld(4, viewportScale),
    lightStrokeWidth: scaleScreenPxToWorld(1.8, viewportScale),
    lightPointRadius: scaleScreenPxToWorld(5, viewportScale),
    longDash: [scaleScreenPxToWorld(14, viewportScale), scaleScreenPxToWorld(8, viewportScale)],
    softDash: [scaleScreenPxToWorld(8, viewportScale), scaleScreenPxToWorld(7, viewportScale)],
    clearDash: [scaleScreenPxToWorld(2, viewportScale), scaleScreenPxToWorld(7, viewportScale)],
  };

  return (
    <Group data-testid="lighting-debug-overlay" listening={false}>
      {lights.map((light) => {
        const color = light.color || '#ffffff';

        return (
          <Group key={light.id || `light-${light.x}-${light.y}`} listening={false}>
            {light.dimRadiusPx > 0 && (
              <Circle
                data-testid="lighting-debug-light-dim"
                x={light.x}
                y={light.y}
                radius={light.dimRadiusPx}
                stroke={withAlpha(color, 0.4)}
                strokeWidth={metrics.lightStrokeWidth}
                dash={[scaleScreenPxToWorld(9, viewportScale), scaleScreenPxToWorld(7, viewportScale)]}
                listening={false}
              />
            )}
            {light.brightRadiusPx > 0 && (
              <Circle
                data-testid="lighting-debug-light-bright"
                x={light.x}
                y={light.y}
                radius={light.brightRadiusPx}
                stroke={withAlpha(color, 0.72)}
                strokeWidth={metrics.lightStrokeWidth}
                listening={false}
              />
            )}
            <Circle
              data-testid="lighting-debug-light-point"
              x={light.x}
              y={light.y}
              radius={metrics.lightPointRadius}
              fill={withAlpha(color, 0.82)}
              stroke={LIGHT_POINT_STROKE}
              strokeWidth={metrics.lightStrokeWidth}
              listening={false}
            />
          </Group>
        );
      })}

      {walls.map((wall) => (
        <Line
          key={wall.id || `wall-${wall.x1}-${wall.y1}-${wall.x2}-${wall.y2}`}
          data-testid="lighting-debug-wall"
          points={[wall.x1, wall.y1, wall.x2, wall.y2]}
          {...getWallStyle(wall, metrics)}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ))}

      {sightContours.map(({ key, tokenId, polygon }) => (
        <Line
          key={key}
          data-testid="lighting-debug-viewer-sight"
          data-tokenid={tokenId}
          points={polygon.flatMap(({ x, y }) => [x, y])}
          closed
          stroke={VIEWER_SIGHT_STROKE}
          strokeWidth={metrics.lightStrokeWidth}
          dash={metrics.softDash}
          listening={false}
        />
      ))}

      {lampContours.map((ring, index) => (
        <Line
          key={index}
          data-testid="lighting-debug-lamp-footprint"
          points={ring.flat()}
          closed
          stroke={LAMP_FOOTPRINT_STROKE}
          strokeWidth={metrics.wallStrokeWidth}
          listening={false}
        />
      ))}
    </Group>
  );
}

