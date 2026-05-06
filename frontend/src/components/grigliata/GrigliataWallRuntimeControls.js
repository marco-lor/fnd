import React, { useMemo } from 'react';
import {
  Circle,
  Group,
  Line,
} from 'react-konva';

import { isInteractiveWallSegment } from './wallRuntimeState';

const CLOSED_STROKE = 'rgba(251, 191, 36, 0.96)';
const OPEN_STROKE = 'rgba(34, 197, 94, 0.92)';
const HIT_FILL = 'rgba(15, 23, 42, 0.72)';

const normalizeViewportScale = (viewportScale = 1) => (
  Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1
);

const scaleScreenPxToWorld = (screenPx, viewportScale = 1) => (
  screenPx / normalizeViewportScale(viewportScale)
);

const getWallMidpoint = (wall) => ({
  x: (Number(wall.x1) + Number(wall.x2)) / 2,
  y: (Number(wall.y1) + Number(wall.y2)) / 2,
});

const getToggleState = (wall) => (wall?.isOpen === true ? 'open' : 'closed');

const stopBoardEvent = (event) => {
  if (event) {
    event.cancelBubble = true;
    event.evt?.stopPropagation?.();
  }
};

export default function GrigliataWallRuntimeControls({
  walls = [],
  viewportScale = 1,
  onToggleWallRuntimeSegment = null,
}) {
  const interactiveWalls = useMemo(
    () => (Array.isArray(walls) ? walls : []).filter((wall) => (
      wall?.id && isInteractiveWallSegment(wall)
    )),
    [walls]
  );

  if (!onToggleWallRuntimeSegment || !interactiveWalls.length) {
    return null;
  }

  const metrics = {
    strokeWidth: scaleScreenPxToWorld(4, viewportScale),
    hitStrokeWidth: scaleScreenPxToWorld(14, viewportScale),
    handleRadius: scaleScreenPxToWorld(7, viewportScale),
    handleStrokeWidth: scaleScreenPxToWorld(2, viewportScale),
  };

  return (
    <Group data-testid="wall-runtime-controls">
      {interactiveWalls.map((wall) => {
        const midpoint = getWallMidpoint(wall);
        const state = getToggleState(wall);
        const stroke = state === 'open' ? OPEN_STROKE : CLOSED_STROKE;
        const handleToggle = (event) => {
          stopBoardEvent(event);
          onToggleWallRuntimeSegment(wall);
        };

        return (
          <Group key={wall.id} data-testid="wall-runtime-control" data-segmentid={wall.id}>
            <Line
              data-testid="wall-runtime-segment"
              data-segmentid={wall.id}
              data-state={state}
              points={[wall.x1, wall.y1, wall.x2, wall.y2]}
              stroke={stroke}
              strokeWidth={metrics.strokeWidth}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
            <Line
              data-testid="wall-runtime-hit-target-line"
              data-segmentid={wall.id}
              points={[wall.x1, wall.y1, wall.x2, wall.y2]}
              stroke="rgba(0, 0, 0, 0.01)"
              strokeWidth={metrics.hitStrokeWidth}
              lineCap="round"
              lineJoin="round"
              onClick={handleToggle}
              onTap={handleToggle}
            />
            <Circle
              data-testid="wall-runtime-toggle"
              data-segmentid={wall.id}
              data-state={state}
              data-walltype={wall.wallType}
              x={midpoint.x}
              y={midpoint.y}
              radius={metrics.handleRadius}
              fill={HIT_FILL}
              stroke={stroke}
              strokeWidth={metrics.handleStrokeWidth}
              onClick={handleToggle}
              onTap={handleToggle}
            />
          </Group>
        );
      })}
    </Group>
  );
}
