export const LIGHTING_GEOMETRY_EPSILON = 1e-6;
export const DEFAULT_LIGHTING_RAY_COUNT = 96;
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

const normalizeSegment = (wall, index) => {
  if (wall?.blocksSight !== true) {
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

export const normalizeLightingWallSegments = (walls = []) => (
  (Array.isArray(walls) ? walls : [])
    .map(normalizeSegment)
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
  const angles = collectVisibilityAngles({
    origin: normalizedOrigin,
    segments,
    rayCount,
    endpointAngleOffset,
  });

  return angles.map((angle) => castRayToNearestSegment({
    origin: normalizedOrigin,
    angle,
    radius: normalizedRadius,
    segments,
    tolerance,
  }));
};

export const buildLightVisibilityPolygons = ({
  light,
  segments = [],
  rayCount = DEFAULT_LIGHTING_RAY_COUNT,
}) => {
  if (!isFinitePoint(light)) {
    return null;
  }

  const origin = {
    x: Number(light.x),
    y: Number(light.y),
  };
  const brightRadiusPx = normalizeRadius(light?.brightRadiusPx);
  const dimRadiusPx = normalizeRadius(light?.dimRadiusPx);

  return {
    id: light?.id || `light-${origin.x}-${origin.y}`,
    color: typeof light?.color === 'string' && light.color ? light.color : '#ffffff',
    origin,
    brightRadiusPx,
    dimRadiusPx,
    brightPolygon: brightRadiusPx > 0
      ? computeVisibilityPolygon({
        origin,
        radius: brightRadiusPx,
        segments,
        rayCount,
      })
      : [],
    dimPolygon: dimRadiusPx > 0
      ? computeVisibilityPolygon({
        origin,
        radius: dimRadiusPx,
        segments,
        rayCount,
      })
      : [],
  };
};

export const buildTokenVisionPolygon = ({
  token,
  visionRadiusPx,
  segments = [],
  rayCount = DEFAULT_LIGHTING_RAY_COUNT,
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

  return {
    tokenId: token?.tokenId || token?.id || token?.ownerUid || '',
    origin,
    radius,
    polygon: computeVisibilityPolygon({
      origin,
      radius,
      segments,
      rayCount,
    }),
  };
};

export const buildTokenVisionPolygons = ({
  tokens = [],
  visionRadiusPx,
  segments = [],
  rayCount = DEFAULT_LIGHTING_RAY_COUNT,
}) => (
  (Array.isArray(tokens) ? tokens : [])
    .map((token) => buildTokenVisionPolygon({
      token,
      visionRadiusPx,
      segments,
      rayCount,
    }))
    .filter(Boolean)
);
