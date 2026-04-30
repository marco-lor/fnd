import React from 'react';
import {
  Circle,
  Group,
  Line,
} from 'react-konva';

const WALL_SIGHT_STROKE = 'rgba(34, 211, 238, 0.95)';
const WALL_NON_SIGHT_STROKE = 'rgba(148, 163, 184, 0.88)';
const WALL_DOOR_STROKE = 'rgba(251, 191, 36, 0.96)';
const LIGHT_POINT_STROKE = 'rgba(255, 255, 255, 0.94)';

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

const getWallStroke = (wall) => {
  if (wall?.doorType) {
    return WALL_DOOR_STROKE;
  }

  return wall?.blocksSight ? WALL_SIGHT_STROKE : WALL_NON_SIGHT_STROKE;
};

const getWallDash = (wall, metrics) => {
  if (wall?.doorType) {
    return [metrics.doorDashLength, metrics.doorDashGap];
  }

  return wall?.blocksSight ? undefined : [metrics.softDashLength, metrics.softDashGap];
};

export default function GrigliataLightingDebugOverlay({
  metadata,
  viewportScale = 1,
}) {
  const walls = Array.isArray(metadata?.walls) ? metadata.walls : [];
  const lights = Array.isArray(metadata?.lights) ? metadata.lights : [];

  if (!walls.length && !lights.length) {
    return null;
  }

  const metrics = {
    wallStrokeWidth: scaleScreenPxToWorld(2.5, viewportScale),
    doorStrokeWidth: scaleScreenPxToWorld(4, viewportScale),
    lightStrokeWidth: scaleScreenPxToWorld(1.8, viewportScale),
    lightPointRadius: scaleScreenPxToWorld(5, viewportScale),
    doorDashLength: scaleScreenPxToWorld(14, viewportScale),
    doorDashGap: scaleScreenPxToWorld(8, viewportScale),
    softDashLength: scaleScreenPxToWorld(8, viewportScale),
    softDashGap: scaleScreenPxToWorld(7, viewportScale),
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
          stroke={getWallStroke(wall)}
          strokeWidth={wall.doorType ? metrics.doorStrokeWidth : metrics.wallStrokeWidth}
          dash={getWallDash(wall, metrics)}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ))}
    </Group>
  );
}

