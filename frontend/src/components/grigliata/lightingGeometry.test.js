import {
  buildTokenVisionPolygons,
  buildLightFootprints,
  createVisibilitySourceCache,
  castRayToNearestSegment,
  computeVisibilityPolygon,
  intersectRayWithSegment,
  normalizeLightingWallSegments,
  normalizeRenderableLight,
} from './lightingGeometry';
import { buildEffectiveLightingRenderInput } from './wallRuntimeState';

const verticalWall = {
  id: 'barrier',
  x1: 10,
  y1: -100,
  x2: 10,
  y2: 100,
  blocksSight: true,
};

test.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])('uses independent sight (%s) and light (%s) blockers', (blocksVision, blocksLight) => {
  const walls = [{ ...verticalWall, blocksVision, blocksLight }];
  const cast = (segments) => computeVisibilityPolygon({
    origin: { x: 0, y: 0 },
    radius: 20,
    segments,
    rayCount: 16,
  })[0].x;

  expect(cast(normalizeLightingWallSegments(walls, 'vision'))).toBe(blocksVision ? 10 : 20);
  expect(cast(normalizeLightingWallSegments(walls, 'light'))).toBe(blocksLight ? 10 : 20);
  expect(cast(normalizeLightingWallSegments([verticalWall], 'light'))).toBe(10);
});

test.each(['door', 'window'])('uses an open %s override for both blocker sets', (wallType) => {
  const lightingRenderInput = { backgroundId: 'scene', walls: [{ ...verticalWall, wallType }] };
  const effective = (isOpen) => buildEffectiveLightingRenderInput({
    lightingRenderInput,
    wallRuntimeState: { backgroundId: 'scene', segments: { barrier: { isOpen } } },
  }).walls;

  for (const blocker of ['vision', 'light']) {
    expect(normalizeLightingWallSegments(effective(false), blocker)).toHaveLength(1);
    expect(normalizeLightingWallSegments(effective(true), blocker)).toHaveLength(0);
  }
});

test('reuses each active token cast across other movements and unrelated wall updates', () => {
  const cache = createVisibilitySourceCache();
  const first = { tokenId: 'first', renderPosition: { x: -1, y: -1, size: 2 } };
  const second = { tokenId: 'second', renderPosition: { x: 499, y: -1, size: 2 } };
  const moved = { ...first, renderPosition: { ...first.renderPosition, x: -2 } };
  const cast = (tokens, wall = verticalWall, rayCount = 16, endpointAngleOffset) => buildTokenVisionPolygons({
    tokens,
    visionRadiusPx: 20,
    segments: normalizeLightingWallSegments([wall]),
    cache,
    rayCount,
    endpointAngleOffset,
  });

  const initial = cast([first, second]);
  expect(cast([{ ...first, name: 'Renamed' }, { ...second }], { ...verticalWall })).toBe(initial);
  const afterMove = cast([moved, second]);
  expect(afterMove[0].polygon).not.toBe(initial[0].polygon);
  expect(afterMove[1]).toBe(initial[1]);
  const afterWall = cast([moved, second], { ...verticalWall, x1: 11, x2: 11 });
  expect(afterWall[0].polygon[0].x).toBe(11);
  expect(afterWall[1]).toBe(initial[1]);
  const differentAngles = cast([moved, second], verticalWall, 16, 0.001);
  expect(differentAngles[0].polygon.some(({ angle }) => (
    Math.abs(angle - (Math.atan2(100, 11) - 0.001)) < 1e-10
  ))).toBe(true);
  expect(cast([moved, second], verticalWall, 24)[1].polygon).toHaveLength(24);
  cast([first]);
  expect(cast([first, second])[1].polygon).not.toBe(initial[1].polygon);
});

test('keeps lamp casts across palette changes and updates only the moved lamp', () => {
  const cache = createVisibilitySourceCache();
  const first = { x: 0, y: 0, brightRadiusPx: 20, dimRadiusPx: 10 };
  const second = { x: 500, y: 0, dimRadiusPx: 20 };
  const cast = (lights) => buildLightFootprints({
    lights,
    segments: normalizeLightingWallSegments([verticalWall], 'light'),
    cache,
    rayCount: 16,
  });
  const initial = cast([first, second]);
  expect(Math.max(...initial[0].polygon.map(({ y }) => y))).toBe(20);
  expect(initial[0].polygon[0].x).toBe(10);
  expect(cast([{ ...first, color: '#ff0000' }, second])[0].polygon).toBe(initial[0].polygon);
  const moved = cast([{ ...first, x: -2 }, second]);
  expect(moved[0].polygon).not.toBe(initial[0].polygon);
  expect(moved[1]).toBe(initial[1]);
  expect(cast([second])[0]).toBe(initial[1]);
  cast([first, { ...second, enabled: false }]);
  expect(cast([first, second])[1]).not.toBe(initial[1]);
});

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

  test('ignores blocker endpoint angles outside the vision radius bounds', () => {
    const polygon = computeVisibilityPolygon({
      origin: { x: 0, y: 0 },
      radius: 20,
      rayCount: 16,
      segments: normalizeLightingWallSegments([{
        id: 'far-wall',
        x1: 1000,
        y1: -100,
        x2: 1000,
        y2: 100,
        blocksSight: true,
      }]),
    });

    expect(polygon).toHaveLength(16);
    expect(polygon.some((point) => point.blocked)).toBe(false);
  });

  test('normalizes gradient inputs and ignores lights without a drawable radius', () => {
    expect(normalizeRenderableLight({
      id: 'light-1',
      x: '100',
      y: 120,
      brightRadiusPx: '30',
      dimRadiusPx: 60,
    })).toEqual({
      id: 'light-1',
      origin: { x: 100, y: 120 },
      brightRadiusPx: 30,
      dimRadiusPx: 60,
      color: '#ffffff',
    });
    expect(normalizeRenderableLight({ x: 0, y: 0, dimRadiusPx: -1 })).toBeNull();
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

  test('uses a per-token vision radius when one is supplied', () => {
    const [firstVision, secondVision] = buildTokenVisionPolygons({
      tokens: [{
        tokenId: 'token-1',
        renderPosition: {
          x: 70,
          y: 140,
          size: 70,
        },
        visionRadiusPx: 210,
      }, {
        tokenId: 'token-2',
        renderPosition: {
          x: 210,
          y: 140,
          size: 70,
        },
      }],
      visionRadiusPx: 140,
      rayCount: 16,
      segments: [],
    });

    expect(maxDistanceFrom(firstVision.origin, firstVision.polygon)).toBeCloseTo(210, 3);
    expect(maxDistanceFrom(secondVision.origin, secondVision.polygon)).toBeCloseTo(140, 3);
  });
});
