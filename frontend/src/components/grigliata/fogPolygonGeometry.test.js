import {
  FOG_POLYGON_MEMORY_MAX_RING_POINTS,
  FOG_POLYGON_MAX_RING_POINTS,
  FOG_POLYGON_RENDER_MAX_RING_POINTS,
  applyFogMemoryPolygonReveal,
  applyFogPolygonHide,
  applyFogPolygonReveal,
  buildCircularFogMemoryPolygon,
  buildCircularFogPolygon,
  encodeFogMemoryPolygonsForFirestore,
  encodeFogPolygonsForFirestore,
  getFogPolygonBounds,
  normalizeFogMemoryPolygons,
  normalizeFogPolygons,
  normalizeRenderableFogPolygons,
  simplifyFogRingToPointLimit,
} from './fogPolygonGeometry';

const square = (minX, minY, maxX, maxY) => [[[
  { x: minX, y: minY },
  { x: maxX, y: minY },
  { x: maxX, y: maxY },
  { x: minX, y: maxY },
]]];

const hasDirectNestedArray = (value) => {
  if (Array.isArray(value)) {
    return value.some((item) => Array.isArray(item) || hasDirectNestedArray(item));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasDirectNestedArray);
  }
  return false;
};

describe('fogPolygonGeometry', () => {
  test('normalizes polygon rings into stable multipolygon output', () => {
    expect(normalizeFogPolygons([[[
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]]])).toEqual([[[
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]]]);
  });

  test('encodes polygon data into a Firestore-safe map-wrapped shape', () => {
    const encoded = encodeFogPolygonsForFirestore(square(0, 0, 10, 10));

    expect(encoded).toEqual([{
      rings: [{
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      }],
    }]);
    expect(hasDirectNestedArray(encoded)).toBe(false);
    expect(normalizeFogPolygons(encoded)).toEqual(square(0, 0, 10, 10));
  });

  test('approximates circular brush polygons with deterministic points', () => {
    const polygons = buildCircularFogPolygon({
      center: { x: 70, y: 70 },
      radiusPx: 70,
      segments: 8,
    });

    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(1);
    expect(polygons[0][0]).toHaveLength(8);
    expect(getFogPolygonBounds(polygons)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 140,
      maxY: 140,
    });
  });

  test('unions reveal polygons into one precision area', () => {
    const result = applyFogPolygonReveal({
      existingPolygons: square(0, 0, 70, 70),
      revealPolygons: square(35, 35, 105, 105),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1);
    expect(getFogPolygonBounds(result)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 105,
      maxY: 105,
    });
    expect(result[0][0].length).toBeGreaterThan(4);
  });

  test('subtracts hide polygons while preserving holes', () => {
    const result = applyFogPolygonHide({
      existingPolygons: square(0, 0, 100, 100),
      hidePolygons: square(25, 25, 75, 75),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2);
    expect(getFogPolygonBounds(result)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });
  });

  test('ignores invalid polygons and points without corrupting valid geometry', () => {
    expect(normalizeFogPolygons([
      [[
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]],
      [[
        { x: Number.NaN, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ]],
    ])).toEqual(square(0, 0, 10, 10));

    expect(normalizeFogPolygons('unsafe')).toBeNull();
  });

  test('rejects coordinates outside the Firestore-safe fog polygon range in strict mode', () => {
    expect(normalizeFogPolygons([
      [[
        { x: 0, y: 0 },
        { x: 1000001, y: 0 },
        { x: 0, y: 40 },
      ]],
    ], { rejectInvalid: true })).toBeNull();
  });

  test('returns null when boolean output exceeds the configured complexity cap', () => {
    const oversizedRing = Array.from({ length: FOG_POLYGON_MAX_RING_POINTS + 1 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / (FOG_POLYGON_MAX_RING_POINTS + 1);
      return {
        x: Math.round(Math.cos(angle) * 1000),
        y: Math.round(Math.sin(angle) * 1000),
      };
    });

    expect(normalizeFogPolygons([[oversizedRing]])).toBeNull();
  });

  test('keeps render polygons high-detail while persisted polygons stay capped', () => {
    const renderRing = Array.from({ length: 96 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 96;
      return {
        x: Math.round(Math.cos(angle) * 1000),
        y: Math.round(Math.sin(angle) * 1000),
      };
    });

    expect(normalizeFogPolygons([[renderRing]])).toBeNull();
    expect(normalizeRenderableFogPolygons([[renderRing]])?.[0]?.[0]).toHaveLength(96);
    expect(normalizeFogMemoryPolygons([[renderRing]])?.[0]?.[0]).toHaveLength(96);
    expect(normalizeRenderableFogPolygons([[renderRing]])?.[0]?.[0].length).toBeLessThanOrEqual(
      FOG_POLYGON_RENDER_MAX_RING_POINTS
    );
    expect(normalizeFogMemoryPolygons([[renderRing]])?.[0]?.[0].length).toBeLessThanOrEqual(
      FOG_POLYGON_MEMORY_MAX_RING_POINTS
    );

    const simplifiedRing = simplifyFogRingToPointLimit(renderRing, FOG_POLYGON_MAX_RING_POINTS);
    expect(simplifiedRing).toHaveLength(FOG_POLYGON_MAX_RING_POINTS);
    expect(normalizeFogPolygons([[simplifiedRing]])?.[0]?.[0]).toHaveLength(
      FOG_POLYGON_MAX_RING_POINTS
    );
  });

  test('encodes high-detail memory polygons without direct nested arrays', () => {
    const memoryPolygon = buildCircularFogMemoryPolygon({
      center: { x: 100, y: 100 },
      radiusPx: 90,
    });
    const encoded = encodeFogMemoryPolygonsForFirestore(memoryPolygon);

    expect(memoryPolygon[0][0].length).toBeGreaterThan(FOG_POLYGON_MAX_RING_POINTS);
    expect(encoded[0].rings[0].points.length).toBeGreaterThan(FOG_POLYGON_MAX_RING_POINTS);
    expect(encoded[0].rings[0].points.length).toBeLessThanOrEqual(
      FOG_POLYGON_MEMORY_MAX_RING_POINTS
    );
    expect(hasDirectNestedArray(encoded)).toBe(false);
    expect(normalizeFogMemoryPolygons(encoded)).toEqual(memoryPolygon);
  });

  test('unions high-detail memory polygons without reducing them to the storage cap', () => {
    const first = buildCircularFogMemoryPolygon({
      center: { x: 70, y: 70 },
      radiusPx: 70,
    });
    const second = buildCircularFogMemoryPolygon({
      center: { x: 120, y: 70 },
      radiusPx: 70,
    });
    const result = applyFogMemoryPolygonReveal({
      existingPolygons: first,
      revealPolygons: second,
    });

    expect(result).toHaveLength(1);
    expect(result[0][0].length).toBeGreaterThan(FOG_POLYGON_MAX_RING_POINTS);
    expect(result[0][0].length).toBeLessThanOrEqual(FOG_POLYGON_MEMORY_MAX_RING_POINTS);
  });

  test('does not erase existing memory when reveal union exceeds polygon limits', () => {
    const existingPolygons = Array.from({ length: 8 }, (_, index) => (
      square(index * 20, 0, (index * 20) + 10, 10)[0]
    ));
    const revealPolygons = square(200, 0, 210, 10);

    const result = applyFogMemoryPolygonReveal({
      existingPolygons,
      revealPolygons,
    });

    expect(result).toEqual(normalizeFogMemoryPolygons(existingPolygons));
  });
});
