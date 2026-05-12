import {
  applyFogBrushEdit,
  applyFogBrushPolygonEdit,
  buildFogBrushCellKeys,
  buildFogBrushPolygon,
  DEFAULT_FOG_BRUSH_RADIUS_SQUARES,
  MAX_FOG_BRUSH_RADIUS_SQUARES,
  MIN_FOG_BRUSH_RADIUS_SQUARES,
  normalizeFogBrushMode,
  normalizeFogBrushRadiusSquares,
  normalizeFogBrushSettings,
} from './fogBrushEditing';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

describe('fogBrushEditing', () => {
  test('normalizes brush radius and mode', () => {
    expect(MIN_FOG_BRUSH_RADIUS_SQUARES).toBe(1);
    expect(MAX_FOG_BRUSH_RADIUS_SQUARES).toBe(20);
    expect(DEFAULT_FOG_BRUSH_RADIUS_SQUARES).toBe(2);

    expect(normalizeFogBrushMode('hide')).toBe('hide');
    expect(normalizeFogBrushMode('reveal')).toBe('reveal');
    expect(normalizeFogBrushMode('erase')).toBe('reveal');

    expect(normalizeFogBrushRadiusSquares(3.6)).toBe(4);
    expect(normalizeFogBrushRadiusSquares(0)).toBe(1);
    expect(normalizeFogBrushRadiusSquares(100)).toBe(20);
    expect(normalizeFogBrushRadiusSquares('bad')).toBe(2);

    expect(normalizeFogBrushSettings({
      mode: 'hide',
      radiusSquares: 8,
    })).toEqual({
      mode: 'hide',
      radiusSquares: 8,
    });
  });

  test('converts a circular brush center and radius to fog cells', () => {
    expect(buildFogBrushCellKeys({
      point: { x: 35, y: 35 },
      radiusSquares: 1,
      grid,
    })).toEqual([
      '0:-1',
      '-1:0',
      '0:0',
      '1:0',
      '0:1',
    ]);
  });

  test('converts a circular brush center and radius to precision polygon geometry', () => {
    const polygons = buildFogBrushPolygon({
      point: { x: 35, y: 35 },
      radiusSquares: 1,
      grid,
      segments: 8,
    });

    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(1);
    expect(polygons[0][0]).toHaveLength(8);
    expect(polygons[0][0]).toEqual(expect.arrayContaining([
      { x: -35, y: 35 },
      { x: 35, y: -35 },
      { x: 105, y: 35 },
      { x: 35, y: 105 },
    ]));

    expect(buildFogBrushPolygon({
      point: { x: 35, y: 35 },
      radiusSquares: 1,
      grid,
    })[0][0].length).toBeGreaterThan(32);
  });

  test('respects grid offsets while building brush cells', () => {
    expect(buildFogBrushCellKeys({
      point: { x: 45, y: 55 },
      radiusSquares: 1,
      grid: {
        cellSizePx: 70,
        offsetXPx: 10,
        offsetYPx: 20,
      },
    })).toEqual([
      '0:-1',
      '-1:0',
      '0:0',
      '1:0',
      '0:1',
    ]);
  });

  test('reveal adds cells without duplicating', () => {
    expect(applyFogBrushEdit({
      existingCells: ['1:0', '0:0'],
      brushCells: ['1:0', '2:0'],
      mode: 'reveal',
    })).toEqual(['0:0', '1:0', '2:0']);
  });

  test('reveal preserves existing cells before capping new brush cells', () => {
    expect(applyFogBrushEdit({
      existingCells: ['0:0', '1:0'],
      brushCells: ['2:0', '3:0', '4:0'],
      mode: 'reveal',
      cellLimit: 4,
    })).toEqual(['0:0', '1:0', '2:0', '3:0']);
  });

  test('reveal trims oversized existing cells before writing', () => {
    const existingCells = Array.from({ length: 5002 }, (_, index) => `${index}:10`);
    const result = applyFogBrushEdit({
      existingCells,
      brushCells: ['0:0'],
      mode: 'reveal',
      cellLimit: 5000,
    });

    expect(result).toHaveLength(5000);
    expect(result).toContain('0:10');
    expect(result).not.toContain('0:0');
    expect(result).not.toContain('5000:10');
  });

  test('hide removes cells', () => {
    expect(applyFogBrushEdit({
      existingCells: ['0:0', '1:0', '2:0'],
      brushCells: ['1:0', '2:0'],
      mode: 'hide',
    })).toEqual(['0:0']);
  });

  test('reveal and hide update precision polygons while keeping cell fallback behavior intact', () => {
    const existingPolygons = [[[
      { x: 0, y: 0 },
      { x: 70, y: 0 },
      { x: 70, y: 70 },
      { x: 0, y: 70 },
    ]]];
    const brushPolygons = buildFogBrushPolygon({
      point: { x: 35, y: 35 },
      radiusSquares: 1,
      grid,
      segments: 8,
    });

    expect(applyFogBrushPolygonEdit({
      existingPolygons,
      brushPolygons,
      mode: 'reveal',
    })).toEqual(expect.any(Array));
    expect(applyFogBrushPolygonEdit({
      existingPolygons,
      brushPolygons,
      mode: 'hide',
    })).toEqual([]);
    expect(applyFogBrushEdit({
      existingCells: ['0:0', '5:5'],
      brushCells: ['0:0'],
      mode: 'hide',
    })).toEqual(['5:5']);
  });

  test('hide trims oversized existing cells after removing brush cells', () => {
    const existingCells = Array.from({ length: 5002 }, (_, index) => `${index}:10`);
    const result = applyFogBrushEdit({
      existingCells,
      brushCells: ['0:10', '1:10', '2:10'],
      mode: 'hide',
      cellLimit: 5000,
    });

    expect(result).toHaveLength(4999);
    expect(result).not.toContain('0:10');
    expect(result).not.toContain('1:10');
    expect(result).not.toContain('2:10');
  });

  test('clamps radius and ignores invalid points', () => {
    expect(buildFogBrushCellKeys({
      point: { x: 35, y: 35 },
      radiusSquares: 0,
      grid,
    })).toEqual([
      '0:-1',
      '-1:0',
      '0:0',
      '1:0',
      '0:1',
    ]);

    expect(buildFogBrushCellKeys({
      point: { x: Number.NaN, y: 35 },
      radiusSquares: 1,
      grid,
    })).toEqual([]);
  });
});
