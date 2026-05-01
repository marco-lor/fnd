import {
  buildLightVisibilityPolygons,
  buildTokenVisionPolygons,
  castRayToNearestSegment,
  computeVisibilityPolygon,
  intersectRayWithSegment,
  normalizeLightingWallSegments,
} from './lightingGeometry';

const maxDistanceFrom = (origin, polygon) => (
  Math.max(
    ...polygon.map((point) => Math.hypot(point.x - origin.x, point.y - origin.y))
  )
);

describe('lightingGeometry', () => {
  test('intersects a ray with a wall segment', () => {
    const intersection = intersectRayWithSegment({
      origin: { x: 0, y: 0 },
      angle: 0,
      segment: {
        id: 'wall-1',
        x1: 10,
        y1: -5,
        x2: 10,
        y2: 5,
      },
    });

    expect(intersection).toEqual(expect.objectContaining({
      x: 10,
      y: 0,
      distance: 10,
      segmentId: 'wall-1',
    }));
  });

  test('casts to the nearest sight-blocking segment before the radius limit', () => {
    const hit = castRayToNearestSegment({
      origin: { x: 0, y: 0 },
      angle: 0,
      radius: 30,
      segments: [{
        id: 'far-wall',
        x1: 20,
        y1: -4,
        x2: 20,
        y2: 4,
      }, {
        id: 'near-wall',
        x1: 8,
        y1: -4,
        x2: 8,
        y2: 4,
      }],
    });

    expect(hit).toEqual(expect.objectContaining({
      x: 8,
      y: 0,
      distance: 8,
      segmentId: 'near-wall',
      blocked: true,
    }));
  });

  test('normalizes only finite sight-blocking walls for ray casting', () => {
    const segments = normalizeLightingWallSegments([{
      id: 'blocks',
      x1: 12,
      y1: -5,
      x2: 12,
      y2: 5,
      blocksSight: true,
    }, {
      id: 'does-not-block',
      x1: 5,
      y1: -5,
      x2: 5,
      y2: 5,
      blocksSight: false,
    }, {
      id: 'bad',
      x1: Number.NaN,
      y1: 0,
      x2: 0,
      y2: 0,
      blocksSight: true,
    }]);

    expect(segments.map((segment) => segment.id)).toEqual(['blocks']);

    const hit = castRayToNearestSegment({
      origin: { x: 0, y: 0 },
      angle: 0,
      radius: 30,
      segments,
    });

    expect(hit.segmentId).toBe('blocks');
    expect(hit.distance).toBe(12);
  });

  test('computes a radius-clipped visibility polygon around blocking walls', () => {
    const polygon = computeVisibilityPolygon({
      origin: { x: 0, y: 0 },
      radius: 20,
      rayCount: 32,
      segments: normalizeLightingWallSegments([{
        id: 'wall-1',
        x1: 10,
        y1: -10,
        x2: 10,
        y2: 10,
        blocksSight: true,
      }]),
    });

    expect(polygon.length).toBeGreaterThan(32);
    expect(maxDistanceFrom({ x: 0, y: 0 }, polygon)).toBeLessThanOrEqual(20.001);
    expect(polygon.some((point) => point.blocked && Math.abs(point.x - 10) < 0.001)).toBe(true);
  });

  test('builds bright and dim light polygons using normalized pixel radii', () => {
    const light = {
      id: 'light-1',
      x: 100,
      y: 120,
      brightRadiusPx: 30,
      dimRadiusPx: 60,
    };
    const polygons = buildLightVisibilityPolygons({
      light,
      rayCount: 24,
      segments: [],
    });

    expect(maxDistanceFrom(polygons.origin, polygons.brightPolygon)).toBeCloseTo(30, 3);
    expect(maxDistanceFrom(polygons.origin, polygons.dimPolygon)).toBeCloseTo(60, 3);
  });

  test('builds token vision polygons from token pixel centers', () => {
    const [vision] = buildTokenVisionPolygons({
      tokens: [{
        tokenId: 'token-1',
        renderPosition: {
          x: 70,
          y: 140,
          size: 70,
        },
      }],
      visionRadiusPx: 140,
      rayCount: 16,
      segments: [],
    });

    expect(vision.origin).toEqual({ x: 105, y: 175 });
    expect(maxDistanceFrom(vision.origin, vision.polygon)).toBeCloseTo(140, 3);
  });
});
