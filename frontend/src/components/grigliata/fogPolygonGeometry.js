export const FOG_POLYGON_MAX_POLYGONS = 8;
export const FOG_POLYGON_MAX_RINGS_PER_POLYGON = 4;
export const FOG_POLYGON_MAX_RING_POINTS = 32;
export const FOG_POLYGON_RENDER_MAX_RING_POINTS = 384;
export const FOG_POLYGON_MEMORY_MAX_RING_POINTS = 384;
export const FOG_POLYGON_MAX_TOTAL_POINTS = 512;
export const FOG_POLYGON_MEMORY_MAX_TOTAL_POINTS = 3072;
export const FOG_POLYGON_DEFAULT_CIRCLE_SEGMENTS = 32;
export const FOG_POLYGON_COORDINATE_LIMIT = 1000000;

const GEOMETRY_EPSILON = 1e-6;
const COORDINATE_PRECISION = 1000;
const INVALID_COMPLEXITY = Symbol('invalid-fog-polygon-complexity');

const roundCoordinate = (value) => (
  Math.round(Number(value) * COORDINATE_PRECISION) / COORDINATE_PRECISION
);

const asFiniteNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    && Math.abs(numericValue) <= FOG_POLYGON_COORDINATE_LIMIT
    ? numericValue
    : null;
};

const normalizePointLimit = (value, fallback = FOG_POLYGON_MAX_RING_POINTS) => {
  const numericValue = asFiniteNumber(value);
  return Math.max(3, Math.round(numericValue === null ? fallback : numericValue));
};

const asPoint = (point) => {
  const x = Array.isArray(point) ? point[0] : point?.x;
  const y = Array.isArray(point) ? point[1] : point?.y;
  const numericX = asFiniteNumber(x);
  const numericY = asFiniteNumber(y);

  return numericX === null || numericY === null
    ? null
    : {
      x: roundCoordinate(numericX),
      y: roundCoordinate(numericY),
    };
};

const unwrapRing = (ring) => (
  Array.isArray(ring)
    ? ring
    : (Array.isArray(ring?.points) ? ring.points : null)
);

const unwrapPolygon = (polygon) => (
  Array.isArray(polygon)
    ? polygon
    : (Array.isArray(polygon?.rings) ? polygon.rings : null)
);

const pointsAreEqual = (left, right) => (
  !!left
  && !!right
  && Math.abs(left.x - right.x) <= GEOMETRY_EPSILON
  && Math.abs(left.y - right.y) <= GEOMETRY_EPSILON
);

const getRingSignedArea = (ring = []) => {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += (current.x * next.y) - (next.x * current.y);
  }
  return area / 2;
};

const comparePoints = (left, right) => {
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  return left.y - right.y;
};

const rotateRingToStableStart = (ring = []) => {
  if (ring.length < 2) {
    return ring;
  }

  let startIndex = 0;
  for (let index = 1; index < ring.length; index += 1) {
    if (comparePoints(ring[index], ring[startIndex]) < 0) {
      startIndex = index;
    }
  }

  return [
    ...ring.slice(startIndex),
    ...ring.slice(0, startIndex),
  ];
};

const getTriangleArea = (previousPoint, currentPoint, nextPoint) => Math.abs((
  (previousPoint.x * (currentPoint.y - nextPoint.y))
  + (currentPoint.x * (nextPoint.y - previousPoint.y))
  + (nextPoint.x * (previousPoint.y - currentPoint.y))
) / 2);

const normalizePointRing = (ring) => {
  const rawRing = unwrapRing(ring);
  if (!Array.isArray(rawRing)) {
    return null;
  }

  const points = [];
  for (const rawPoint of rawRing) {
    const point = asPoint(rawPoint);
    if (!point) {
      return null;
    }
    if (!pointsAreEqual(points[points.length - 1], point)) {
      points.push(point);
    }
  }

  if (points.length > 1 && pointsAreEqual(points[0], points[points.length - 1])) {
    points.pop();
  }

  return points;
};

export const simplifyFogRingToPointLimit = (
  ring,
  maxPoints = FOG_POLYGON_MAX_RING_POINTS
) => {
  const normalizedMaxPoints = normalizePointLimit(maxPoints);
  const points = normalizePointRing(ring);
  if (!points || points.length < 3) {
    return [];
  }

  const simplifiedPoints = points.map((point, index) => ({
    point,
    originalIndex: index,
  }));

  while (simplifiedPoints.length > normalizedMaxPoints) {
    let removalIndex = -1;
    let smallestArea = Number.POSITIVE_INFINITY;

    for (let index = 0; index < simplifiedPoints.length; index += 1) {
      const previous = simplifiedPoints[
        (index - 1 + simplifiedPoints.length) % simplifiedPoints.length
      ].point;
      const current = simplifiedPoints[index].point;
      const next = simplifiedPoints[(index + 1) % simplifiedPoints.length].point;
      const triangleArea = getTriangleArea(previous, current, next);

      if (
        triangleArea < smallestArea - GEOMETRY_EPSILON
        || (
          Math.abs(triangleArea - smallestArea) <= GEOMETRY_EPSILON
          && simplifiedPoints[index].originalIndex > simplifiedPoints[removalIndex]?.originalIndex
        )
      ) {
        smallestArea = triangleArea;
        removalIndex = index;
      }
    }

    if (removalIndex < 0) {
      break;
    }
    simplifiedPoints.splice(removalIndex, 1);
  }

  const normalizedRing = normalizeRing(
    simplifiedPoints.map((entry) => entry.point),
    { maxRingPoints: normalizedMaxPoints }
  );
  return Array.isArray(normalizedRing) ? normalizedRing : [];
};

const normalizeRing = (ring, { maxRingPoints = FOG_POLYGON_MAX_RING_POINTS } = {}) => {
  const points = normalizePointRing(ring);
  if (!points) {
    return null;
  }

  const normalizedMaxRingPoints = normalizePointLimit(maxRingPoints);

  if (points.length > normalizedMaxRingPoints) {
    return INVALID_COMPLEXITY;
  }

  if (points.length < 3) {
    return null;
  }

  const signedArea = getRingSignedArea(points);
  if (Math.abs(signedArea) <= GEOMETRY_EPSILON) {
    return null;
  }

  const orientedRing = signedArea < 0 ? [...points].reverse() : points;
  return rotateRingToStableStart(orientedRing);
};

const getRingSortKey = (ring = []) => ring
  .map((point) => `${point.x}:${point.y}`)
  .join('|');

const normalizePolygon = (polygon, options = {}) => {
  const rawPolygon = unwrapPolygon(polygon);
  if (!Array.isArray(rawPolygon)) {
    return null;
  }

  const normalizedRings = rawPolygon.map((ring) => normalizeRing(ring, options));
  if (normalizedRings.some((ring) => ring === INVALID_COMPLEXITY)) {
    return INVALID_COMPLEXITY;
  }

  const rings = normalizedRings
    .filter(Boolean)
    .sort((left, right) => {
      const areaDelta = Math.abs(getRingSignedArea(right)) - Math.abs(getRingSignedArea(left));
      return Math.abs(areaDelta) > GEOMETRY_EPSILON
        ? areaDelta
        : getRingSortKey(left).localeCompare(getRingSortKey(right));
    });

  if (rings.length < 1 || rings.length > FOG_POLYGON_MAX_RINGS_PER_POLYGON) {
    return null;
  }

  return rings;
};

const countFogPolygonPoints = (polygons = []) => polygons.reduce((total, polygon) => (
  total + polygon.reduce((polygonTotal, ring) => polygonTotal + ring.length, 0)
), 0);

const compareBounds = (leftBounds, rightBounds) => {
  if (!leftBounds && !rightBounds) return 0;
  if (!leftBounds) return 1;
  if (!rightBounds) return -1;

  return (
    leftBounds.minX - rightBounds.minX
    || leftBounds.minY - rightBounds.minY
    || leftBounds.maxX - rightBounds.maxX
    || leftBounds.maxY - rightBounds.maxY
  );
};

export const getFogPolygonBounds = (polygons = []) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const polygon of Array.isArray(polygons) ? polygons : []) {
    for (const ring of Array.isArray(polygon) ? polygon : []) {
      for (const rawPoint of Array.isArray(ring) ? ring : []) {
        const point = asPoint(rawPoint);
        if (point) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
  }

  return minX === Infinity ? null : { minX, minY, maxX, maxY };
};

const orderFogPolygons = (entries) => entries
  .sort((left, right) => (
    compareBounds(left.bounds, right.bounds)
    || JSON.stringify(left.polygon).localeCompare(JSON.stringify(right.polygon))
  ))
  .map(({ polygon }) => polygon);

// A cast produces an immutable ring. Unmoved sources can share the exact same
// render and exploration polygon, even when another source moves.
const liveEntryByCastRing = new WeakMap();
export const buildFogPolygonsFromLiveCasts = (casts) => {
  const entries = [];
  for (const cast of casts) {
    const ring = cast?.polygon;
    if (!Array.isArray(ring)) continue;
    if (!liveEntryByCastRing.has(ring)) {
      const simplified = simplifyFogRingToPointLimit(ring, FOG_POLYGON_RENDER_MAX_RING_POINTS);
      const polygon = normalizePolygon([simplified], { maxRingPoints: FOG_POLYGON_RENDER_MAX_RING_POINTS });
      liveEntryByCastRing.set(ring, polygon && polygon !== INVALID_COMPLEXITY
        ? { polygon, bounds: getFogPolygonBounds([polygon]) }
        : null);
    }
    const entry = liveEntryByCastRing.get(ring);
    if (entry) entries.push(entry);
  }
  return orderFogPolygons(entries);
};

const normalizeFogPolygonSet = (polygons, {
  rejectInvalid = false,
  maxRingPoints,
  maxPolygons = Infinity,
  maxTotalPoints = Infinity,
}) => {
  if (!Array.isArray(polygons)) {
    return null;
  }

  const mappedPolygons = polygons.map((polygon) => normalizePolygon(polygon, {
    maxRingPoints,
  }));
  if (mappedPolygons.some((polygon) => polygon === INVALID_COMPLEXITY)) {
    return null;
  }
  if (rejectInvalid && mappedPolygons.some((polygon) => !polygon)) {
    return null;
  }

  const normalizedPolygons = mappedPolygons.filter(Boolean);
  if (
    normalizedPolygons.length > maxPolygons
    || countFogPolygonPoints(normalizedPolygons) > maxTotalPoints
  ) {
    return null;
  }

  return orderFogPolygons(normalizedPolygons.map((polygon) => ({ polygon, bounds: getFogPolygonBounds([polygon]) })));
};

export const normalizeFogPolygons = (polygons, {
  rejectInvalid,
  maxRingPoints = FOG_POLYGON_MAX_RING_POINTS,
  maxTotalPoints = FOG_POLYGON_MAX_TOTAL_POINTS,
} = {}) => normalizeFogPolygonSet(
  polygons,
  {
    rejectInvalid,
    maxRingPoints,
    maxTotalPoints,
    maxPolygons: FOG_POLYGON_MAX_POLYGONS,
  }
);

// Each live source has a ring budget. Legacy document budgets apply only to stored polygons.
export const normalizeRenderableFogPolygons = (polygons, options = {}) => normalizeFogPolygonSet(
  polygons,
  {
    maxRingPoints: FOG_POLYGON_RENDER_MAX_RING_POINTS,
    ...options,
  }
);

export const normalizeFogMemoryPolygons = (polygons, options = {}) => normalizeFogPolygons(
  polygons,
  {
    maxRingPoints: FOG_POLYGON_MEMORY_MAX_RING_POINTS,
    maxTotalPoints: FOG_POLYGON_MEMORY_MAX_TOTAL_POINTS,
    ...options,
  }
);

export const encodeFogPolygonsForFirestore = (
  polygons = [],
  { normalizePolygons = normalizeFogPolygons } = {}
) => {
  const normalizedPolygons = normalizePolygons(polygons) || [];
  return normalizedPolygons.map((polygon) => ({
    rings: polygon.map((ring) => ({
      points: ring.map((point) => ({
        x: point.x,
        y: point.y,
      })),
    })),
  }));
};

export const encodeFogMemoryPolygonsForFirestore = (polygons = []) => encodeFogPolygonsForFirestore(
  polygons,
  { normalizePolygons: normalizeFogMemoryPolygons }
);

const normalizeCircleSegments = (
  segments = FOG_POLYGON_DEFAULT_CIRCLE_SEGMENTS,
  maxSegments = FOG_POLYGON_MAX_RING_POINTS
) => (
  Math.min(
    normalizePointLimit(maxSegments),
    Math.max(8, Math.round(asFiniteNumber(segments) || FOG_POLYGON_DEFAULT_CIRCLE_SEGMENTS))
  )
);

export const buildCircularFogPolygon = ({
  center = {},
  radiusPx = 0,
  segments = FOG_POLYGON_DEFAULT_CIRCLE_SEGMENTS,
  maxRingPoints = FOG_POLYGON_MAX_RING_POINTS,
  normalizePolygons = normalizeFogPolygons,
} = {}) => {
  const normalizedCenter = asPoint(center);
  const numericRadius = asFiniteNumber(radiusPx);
  if (!normalizedCenter || numericRadius === null || numericRadius <= 0) {
    return [];
  }

  const normalizedSegments = normalizeCircleSegments(segments, maxRingPoints);
  const ring = Array.from({ length: normalizedSegments }, (_, index) => {
    const angle = (Math.PI * 2 * index) / normalizedSegments;
    return {
      x: normalizedCenter.x + (Math.cos(angle) * numericRadius),
      y: normalizedCenter.y + (Math.sin(angle) * numericRadius),
    };
  });

  return normalizePolygons([[ring]]) || [];
};

export const buildCircularFogMemoryPolygon = (args = {}) => buildCircularFogPolygon({
  ...args,
  segments: args.segments || 96,
  maxRingPoints: FOG_POLYGON_MEMORY_MAX_RING_POINTS,
  normalizePolygons: normalizeFogMemoryPolygons,
});

const toClippingRing = (ring = []) => (
  [...ring.map((point) => [point.x, point.y]), [ring[0].x, ring[0].y]]
);

const toClippingMultiPolygon = (polygons = []) => polygons.map((polygon) => (
  polygon.map(toClippingRing)
));

const runBooleanOperation = (operation, operands, normalizePolygons) => {
  try {
    const result = operation(...operands.map(toClippingMultiPolygon));
    return normalizePolygons(result);
  } catch (error) {
    return null;
  }
};

export const applyFogPolygonReveal = ({
  existingPolygons = [],
  revealPolygons = [],
  normalizePolygons = normalizeFogPolygons,
} = {}) => {
  const normalizedExisting = normalizePolygons(existingPolygons) || [];
  const normalizedReveal = normalizePolygons(revealPolygons) || [];

  if (normalizedReveal.length < 1) {
    return normalizedExisting;
  }
  if (normalizedExisting.length < 1) {
    return normalizedReveal;
  }

  const polygonClipping = require('polygon-clipping');
  const booleanResult = runBooleanOperation(
    polygonClipping.union,
    [normalizedExisting, normalizedReveal],
    normalizePolygons
  );

  return booleanResult
    || normalizePolygons([...normalizedExisting, ...normalizedReveal])
    || normalizedExisting;
};

export const applyFogMemoryPolygonReveal = (args = {}) => applyFogPolygonReveal({
  ...args,
  normalizePolygons: normalizeFogMemoryPolygons,
});

export const applyFogPolygonHide = ({
  existingPolygons = [],
  hidePolygons = [],
  normalizePolygons = normalizeFogPolygons,
} = {}) => {
  const normalizedExisting = normalizePolygons(existingPolygons) || [];
  const normalizedHide = normalizePolygons(hidePolygons) || [];

  if (normalizedExisting.length < 1) {
    return [];
  }
  if (normalizedHide.length < 1) {
    return normalizedExisting;
  }

  const polygonClipping = require('polygon-clipping');
  return runBooleanOperation(
    polygonClipping.difference,
    [normalizedExisting, normalizedHide],
    normalizePolygons
  );
};

export const applyFogMemoryPolygonHide = (args = {}) => applyFogPolygonHide({
  ...args,
  normalizePolygons: normalizeFogMemoryPolygons,
});
