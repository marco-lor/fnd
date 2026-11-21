import { useMemo } from 'react';
import {
  buildLightFootprints,
  buildTokenVisionPolygons,
  createVisibilitySourceCache,
  DEFAULT_TOKEN_VISION_RAY_COUNT,
  normalizeLightingWallSegments,
} from './lightingGeometry';

export function useLightFootprints({ metadata, rayCount, enabled }) {
  const { backgroundId, lights, walls } = metadata || {};
  const cache = useMemo(createVisibilitySourceCache, [backgroundId]);
  const segments = useMemo(() => normalizeLightingWallSegments(walls, 'light'), [walls]);

  return useMemo(
    () => (enabled ? buildLightFootprints({ lights, segments, rayCount, cache }) : null),
    [cache, enabled, lights, rayCount, segments]
  );
}

export function useTokenSightFootprints({
  backgroundId,
  tokens,
  visionRadiusPx,
  walls,
  rayCount = DEFAULT_TOKEN_VISION_RAY_COUNT,
  enabled,
}) {
  const cache = useMemo(createVisibilitySourceCache, [backgroundId, enabled]);
  const segments = useMemo(() => normalizeLightingWallSegments(walls, 'vision'), [walls]);

  return useMemo(
    () => (enabled ? buildTokenVisionPolygons({ tokens, visionRadiusPx, segments, rayCount, cache }) : null),
    [cache, enabled, rayCount, segments, tokens, visionRadiusPx]
  );
}
