import {
  buildGrigliataFogOfWarDocId,
  decodeFogCellKey,
  encodeFogCellKey,
  mergeFogCellKeys,
  normalizeFogCellKeys,
  normalizeGrigliataFogOfWarDoc,
  polygonToFogCellKeys,
} from './fogOfWar';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

describe('fogOfWar', () => {
  test('builds per-background owner fog doc ids', () => {
    expect(buildGrigliataFogOfWarDocId('map-1', 'user-1')).toBe('map-1__user-1');
    expect(buildGrigliataFogOfWarDocId('', 'user-1')).toBe('');
  });

  test('serializes and decodes compact fog cell keys', () => {
    expect(encodeFogCellKey({ col: -2, row: 7 })).toBe('-2:7');
    expect(decodeFogCellKey('-2:7')).toEqual({ col: -2, row: 7 });
    expect(decodeFogCellKey('bad:key')).toBeNull();
  });

  test('converts a visibility polygon to grid cells using cell centers', () => {
    const cells = polygonToFogCellKeys({
      polygon: [
        { x: 0, y: 0 },
        { x: 140, y: 0 },
        { x: 140, y: 140 },
        { x: 0, y: 140 },
      ],
      grid,
    });

    expect(cells).toEqual(['0:0', '1:0', '0:1', '1:1']);
  });

  test('merges explored cells uniquely and sorts row-major', () => {
    expect(mergeFogCellKeys(['1:1', '0:0'], ['1:0', '0:0'])).toEqual([
      '0:0',
      '1:0',
      '1:1',
    ]);
  });

  test('normalizes compact cell serialization and rejects malformed keys', () => {
    expect(normalizeFogCellKeys(['1:0', '0:0', '1:0'])).toEqual(['0:0', '1:0']);
    expect(normalizeFogCellKeys(['1:0', '1.2:0'])).toBeNull();
    expect(normalizeFogCellKeys('1:0')).toBeNull();
  });

  test('normalizes valid fog docs and rejects malformed fog data', () => {
    expect(normalizeGrigliataFogOfWarDoc({
      id: 'map-1__user-1',
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      cellSizePx: 70,
      exploredCells: ['1:0', '0:0', '1:0'],
      updatedAt: { seconds: 1 },
      updatedBy: 'user-1',
    })).toEqual(expect.objectContaining({
      id: 'map-1__user-1',
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      cellSizePx: 70,
      exploredCells: ['0:0', '1:0'],
      updatedBy: 'user-1',
    }));

    expect(normalizeGrigliataFogOfWarDoc({
      id: 'map-1__user-2',
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      cellSizePx: 70,
      exploredCells: ['0:0'],
    })).toBeNull();
    expect(normalizeGrigliataFogOfWarDoc({
      id: 'map-1__user-1',
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      cellSizePx: 0,
      exploredCells: ['0:0'],
    })).toBeNull();
    expect(normalizeGrigliataFogOfWarDoc({
      id: 'map-1__user-1',
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      cellSizePx: 70,
      exploredCells: ['oops'],
    })).toBeNull();
  });
});
