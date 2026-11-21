import { isInteractiveWallSegment } from './wallRuntimeState';

export const LIGHTING_GEOMETRY_EPSILON = 1e-6;
export const DEFAULT_LIGHTING_RAY_COUNT = 96;
export const DEFAULT_TOKEN_VISION_RAY_COUNT = 256;
export const DEFAULT_ENDPOINT_ANGLE_OFFSET = 0.0001;

const FULL_CIRCLE_RADIANS = Math.PI * 2;
const ANGLE_DEDUPLICATION_STEP = 1e-7;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const isFinitePoint = (point) => (
  Number.isFinite(Number(point?.x))
  && Number.isFinite(Number(point?.y))
);

const normalizeAngle = (angle) => {
  const numericAngle = asFiniteNumber(angle, 0);
  const normalizedAngle = numericAngle % FULL_CIRCLE_RADIANS;
  return normalizedAngle < 0
    ? normalizedAngle + FULL_CIRCLE_RADIANS
    : normalizedAngle;
};

const cross = (leftX, leftY, rightX, rightY) => (
  (leftX * rightY) - (leftY * rightX)
);

const normalizeRadius = (radius) => {
  const numericRadius = Number(radius);
  return Number.isFinite(numericRadius) && numericRadius > 0
    ? numericRadius
    : 0;
};

const normalizeRayCount = (rayCount = DEFAULT_LIGHTING_RAY_COUNT) => (
  Math.max(8, Math.round(asFiniteNumber(rayCount, DEFAULT_LIGHTING_RAY_COUNT)))
);

const segmentMayAffectCircle = ({ segment, origin, radius, tolerance = LIGHTING_GEOMETRY_EPSILON }) => {
  if (!segment || !isFinitePoint(origin)) {
    return false;
  }

  const minX = Math.min(segment.x1, segment.x2) - tolerance;
  const maxX = Math.max(segment.x1, segment.x2) + tolerance;
  const minY = Math.min(segment.y1, segment.y2) - tolerance;
  const maxY = Math.max(segment.y1, segment.y2) + tolerance;
  const circleMinX = origin.x - radius - tolerance;
  const circleMaxX = origin.x + radius + tolerance;
  const circleMinY = origin.y - radius - tolerance;
  const circleMaxY = origin.y + radius + tolerance;

  return !(
    maxX < circleMinX
    || minX > circleMaxX
    || maxY < circleMinY
    || minY > circleMaxY
  );
};

const filterSegmentsForVisibilityCircle = ({
  segments = [],
  origin,
  radius,
  tolerance = LIGHTING_GEOMETRY_EPSILON,
} = {}) => (
  (Array.isArray(segments) ? segments : []).filter((segment) => segmentMayAffectCircle({
    segment,
    origin,
    radius,
    tolerance,
  }))
);

export const wallBlocksVisibility = (wall, kind = 'vision') => {
  if (wall?.isOpen === true && isInteractiveWallSegment(wall)) {
    return false;
  }

  const blocks = kind === 'light' ? wall?.blocksLight : wall?.blocksVision;
  return typeof blocks === 'boolean' ? blocks : wall?.blocksSight === true;
};

const normalizeSegment = (wall, index, kind) => {
  if (!wallBlocksVisibility(wall, kind)) {
    return null;
  }

  const x1 = Number(wall.x1);
  const y1 = Number(wall.y1);
  const x2 = Number(wall.x2);
  const y2 = Number(wall.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }

  if (Math.hypot(x2 - x1, y2 - y1) <= LIGHTING_GEOMETRY_EPSILON) {
    return null;
  }

  return {
    id: typeof wall.id === 'string' && wall.id ? wall.id : `wall-${index + 1}`,
    x1,
    y1,
    x2,
    y2,
  };
};

export const normalizeLightingWallSegments = (walls = [], kind = 'vision') => (
  (Array.isArray(walls) ? walls : [])
    .map((wall, index) => normalizeSegment(wall, index, kind))
    .filter(Boolean)
);

export const intersectRayWithSegment = ({
  origin,
  angle,
  segment,
  tolerance = LIGHTING_GEOMETRY_EPSILON,
}) => {
  if (!isFinitePoint(origin) || !segment) {
    return null;
  }

  const x1 = Number(segment.x1);
  const y1 = Number(segment.y1);
  const x2 = Number(segment.x2);
  const y2 = Number(segment.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }

  const normalizedOrigin = {
    x: Number(origin.x),
    y: Number(origin.y),
  };
  const normalizedAngle = normalizeAngle(angle);
  const rayX = Math.cos(normalizedAngle);
  const rayY = Math.sin(normalizedAngle);
  const segmentX = x2 - x1;
  const segmentY = y2 - y1;
  const denominator = cross(rayX, rayY, segmentX, segmentY);

  if (Math.abs(denominator) <= tolerance) {
    return null;
  }

  const originToSegmentX = x1 - normalizedOrigin.x;
  const originToSegmentY = y1 - normalizedOrigin.y;
  const rayDistance = cross(originToSegmentX, originToSegmentY, segmentX, segmentY) / denominator;
  const segmentProgress = cross(originToSegmentX, originToSegmentY, rayX, rayY) / denominator;

  if (
    rayDistance <= tolerance
    || segmentProgress < -tolerance
    || segmentProgress > 1 + tolerance
  ) {
    return null;
  }

  return {
    x: normalizedOrigin.x + (rayX * rayDistance),
    y: normalizedOrigin.y + (rayY * rayDistance),
    distance: rayDistance,
    angle: normalizedAngle,
    segmentProgress: clamp(segmentProgress, 0, 1),
    segmentId: segment.id || '',
  };
};

export const castRayToNearestSegment = ({
  origin,
  angle,
  radius,
  segments = [],
  tolerance = LIGHTING_GEOMETRY_EPSILON,
}) => {
  const normalizedOrigin = isFinitePoint(origin)
    ? { x: Number(origin.x), y: Number(origin.y) }
    : { x: 0, y: 0 };
  const normalizedAngle = normalizeAngle(angle);
  const normalizedRadius = normalizeRadius(radius);
  const rayX = Math.cos(normalizedAngle);
  const rayY = Math.sin(normalizedAngle);
  let nearestIntersection = null;

  (Array.isArray(segments) ? segments : []).forEach((segment) => {
    const intersection = intersectRayWithSegment({
      origin: normalizedOrigin,
      angle: normalizedAngle,
      segment,
      tolerance,
    });
    if (
      !intersection
      || intersection.distance > normalizedRadius + tolerance
      || (
        nearestIntersection
        && intersection.distance >= nearestIntersection.distance
      )
    ) {
      return;
    }

    nearestIntersection = intersection;
  });

  if (nearestIntersection) {
    return {
      ...nearestIntersection,
      blocked: true,
    };
  }

  return {
    x: normalizedOrigin.x + (rayX * normalizedRadius),
    y: normalizedOrigin.y + (rayY * normalizedRadius),
    distance: normalizedRadius,
    angle: normalizedAngle,
    segmentId: '',
    blocked: false,
  };
};

const collectVisibilityAngles = ({
  origin,
  segments,
  rayCount,
  endpointAngleOffset,
}) => {
  const anglesByKey = new Map();
  const addAngle = (angle) => {
    const normalizedAngle = normalizeAngle(angle);
    const key = Math.round(normalizedAngle / ANGLE_DEDUPLICATION_STEP);
    anglesByKey.set(key, normalizedAngle);
  };
  const normalizedRayCount = normalizeRayCount(rayCount);

  for (let index = 0; index < normalizedRayCount; index += 1) {
    addAngle((index / normalizedRayCount) * FULL_CIRCLE_RADIANS);
  }

  (Array.isArray(segments) ? segments : []).forEach((segment) => {
    [
      { x: segment.x1, y: segment.y1 },
      { x: segment.x2, y: segment.y2 },
    ].forEach((point) => {
      if (!isFinitePoint(point)) {
        return;
      }

      const angle = Math.atan2(point.y - origin.y, point.x - origin.x);
      addAngle(angle - endpointAngleOffset);
      addAngle(angle);
      addAngle(angle + endpointAngleOffset);
    });
  });

  return [...anglesByKey.values()].sort((left, right) => left - right);
};

const castVisibilityPolygon = ({
  origin,
  radius,
  segments,
  rayCount,
  endpointAngleOffset,
  tolerance,
}) => (
  collectVisibilityAngles({ origin, segments, rayCount, endpointAngleOffset })
    .map((angle) => castRayToNearestSegment({ origin, angle, radius, segments, tolerance }))
);

export const computeVisibilityPolygon = ({
  origin,
  radius,
  segments = [],
  rayCount = DEFAULT_LIGHTING_RAY_COUNT,
  endpointAngleOffset = DEFAULT_ENDPOINT_ANGLE_OFFSET,
  tolerance = LIGHTING_GEOMETRY_EPSILON,
}) => {
  if (!isFinitePoint(origin)) {
    return [];
  }

  const normalizedRadius = normalizeRadius(radius);
  if (normalizedRadius <= 0) {
    return [];
  }

  const normalizedOrigin = {
    x: Number(origin.x),
    y: Number(origin.y),
  };
  const relevantSegments = filterSegmentsForVisibilityCircle({
    segments,
    origin: normalizedOrigin,
    radius: normalizedRadius,
    tolerance,
  });
  return castVisibilityPolygon({
    origin: normalizedOrigin,
    radius: normalizedRadius,
    segments: relevantSegments,
    rayCount,
    endpointAngleOffset,
    tolerance,
  });
};

export const normalizeRenderableLight = (light) => {
  if (light?.enabled === false || !isFinitePoint(light)) {
    return null;
  }

  const origin = {
    x: Number(light.x),
    y: Number(light.y),
  };
  const brightRadiusPx = normalizeRadius(light?.brightRadiusPx);
  const dimRadiusPx = normalizeRadius(light?.dimRadiusPx);
  if (!brightRadiusPx && !dimRadiusPx) {
    return null;
  }

  return {
    id: light?.id || `light-${origin.x}-${origin.y}`,
    color: typeof light?.color === 'string' && light.color ? light.color : '#ffffff',
    origin,
    brightRadiusPx,
    dimRadiusPx,
  };
};

const normalizeTokenVisionSource = ({
  token,
  visionRadiusPx,
}) => {
  const position = token?.renderPosition || token?.position || null;
  const x = Number(position?.x);
  const y = Number(position?.y);
  const size = Number(position?.size);
  if (![x, y, size].every(Number.isFinite) || size <= 0) {
    return null;
  }

  const tokenVisionRadiusPx = token?.visionRadiusPx === undefined
    ? visionRadiusPx
    : token.visionRadiusPx;
  const radius = normalizeRadius(tokenVisionRadiusPx);
  if (radius <= 0) {
    return null;
  }

  const origin = {
    x: x + (size / 2),
    y: y + (size / 2),
  };
  if (!isFinitePoint(origin)) return null;

  return {
    tokenId: token?.tokenId || token?.id || token?.ownerUid || '',
    origin,
    radius,
  };
};

export const buildTokenVisionPolygon = ({
  token,
  visionRadiusPx,
  segments = [],
  rayCount,
}) => {
  const source = normalizeTokenVisionSource({ token, visionRadiusPx });
  return source && {
    ...source,
    polygon: computeVisibilityPolygon({ ...source, segments, rayCount }),
  };
};

export const createVisibilitySourceCache = () => ({
  entries: new Map(),
  footprints: [],
});

// Keep only the most recent cast of each active source. Wall snapshots may be
// recreated by edits outside this source's reach, or by updates to other fields.
const buildSourceFootprints = ({
  sources,
  segments,
  cache,
  rayCount,
  endpointAngleOffset = DEFAULT_ENDPOINT_ANGLE_OFFSET,
  includeKey = false,
}) => {
  const entries = new Map();
  const occurrences = new Map();
  const footprints = sources.map(({ key, source }) => {
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    const entryKey = JSON.stringify([key, occurrence]);
    const { origin, radius } = source;
    const geometryKey = JSON.stringify([origin.x, origin.y, radius, rayCount, endpointAngleOffset]);
    const sourceKey = JSON.stringify(source);
    const previous = cache?.entries.get(entryKey);
    const isSameGeometry = previous?.geometryKey === geometryKey;
    let wallKey = previous?.wallKey;
    let polygon = previous?.footprint.polygon;

    if (!isSameGeometry || previous.segments !== segments) {
      const relevantSegments = filterSegmentsForVisibilityCircle({ segments, origin, radius });
      wallKey = JSON.stringify(relevantSegments.map(({ id, x1, y1, x2, y2 }) => [id, x1, y1, x2, y2]));
      if (!isSameGeometry || previous.wallKey !== wallKey) {
        polygon = castVisibilityPolygon({
          origin,
          radius,
          segments: relevantSegments,
          rayCount,
          endpointAngleOffset,
          tolerance: LIGHTING_GEOMETRY_EPSILON,
        });
      }
    }

    const footprint = previous?.sourceKey === sourceKey && previous.footprint.polygon === polygon
      ? previous.footprint
      : { ...source, polygon, ...(includeKey ? { key: entryKey } : {}) };
    entries.set(entryKey, { geometryKey, sourceKey, segments, wallKey, footprint });
    return footprint;
  });

  if (!cache) return footprints;

  cache.entries = entries;
  if (cache.footprints.length !== footprints.length
    || footprints.some((footprint, index) => footprint !== cache.footprints[index])) {
    cache.footprints = footprints;
  }
  return cache.footprints;
};

export const buildTokenVisionPolygons = ({
  tokens = [],
  visionRadiusPx,
  segments = [],
  rayCount = DEFAULT_LIGHTING_RAY_COUNT,
  endpointAngleOffset,
  cache,
}) => buildSourceFootprints({
  sources: (Array.isArray(tokens) ? tokens : []).flatMap((token) => {
    const source = normalizeTokenVisionSource({ token, visionRadiusPx });
    return source ? [{ key: source.tokenId, source }] : [];
  }),
  segments,
  rayCount: normalizeRayCount(rayCount),
  endpointAngleOffset,
  cache,
});

export const buildLightFootprints = ({
  lights = [],
  segments = [],
  rayCount = DEFAULT_LIGHTING_RAY_COUNT,
  endpointAngleOffset,
  cache,
}) => buildSourceFootprints({
  sources: (Array.isArray(lights) ? lights : []).flatMap((light) => {
    const normalized = normalizeRenderableLight(light);
    if (!normalized) return [];

    const radius = Math.max(normalized.brightRadiusPx, normalized.dimRadiusPx);
    const key = light.id || `${normalized.id}-${radius}`;
    return [{ key, source: { ...normalized, radius } }];
  }),
  segments,
  rayCount: normalizeRayCount(rayCount),
  endpointAngleOffset,
  cache,
  includeKey: true,
});
