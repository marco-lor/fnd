import {
  createManualWallSegment,
  deleteWallSegment,
  duplicateWallSegment,
  moveWallEndpoint,
  moveWallSegment,
  normalizeEditableWallSegments,
  toggleWallSegmentBlocking,
  updateWallSegment,
} from './wallSources';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

describe('wall source editing helpers', () => {
  test('normalizes editable wall fields for DM authoring while stripping import-only fields', () => {
    expect(normalizeEditableWallSegments([{
      id: 'door-1',
      label: 'North Door',
      x1: '0',
      y1: 10,
      x2: 70,
      y2: 10,
      wallType: 'door',
      blocksSight: true,
      source: { raw: true },
      doorType: 1,
    }, {
      id: 'bad-wall',
      x1: 10,
      y1: 10,
      x2: 10,
      y2: 10,
      blocksSight: true,
    }])).toEqual([{
      id: 'door-1',
      label: 'North Door',
      x1: 0,
      y1: 10,
      x2: 70,
      y2: 10,
      wallType: 'door',
      blocksSight: true,
      blocksVision: true,
      blocksLight: true,
    }]);
  });

  test('classifies raw imported door and window fields for DM authoring', () => {
    expect(normalizeEditableWallSegments([{
      id: 'raw-door-type',
      x1: 0,
      y1: 0,
      x2: 70,
      y2: 0,
      doorType: 1,
      blocksSight: true,
    }, {
      id: 'raw-door-flag',
      x1: 70,
      y1: 0,
      x2: 140,
      y2: 0,
      door: 1,
      blocksSight: true,
    }, {
      id: 'raw-window',
      x1: 140,
      y1: 0,
      x2: 210,
      y2: 0,
      isWindow: true,
      blocksSight: true,
    }])).toEqual([
      expect.objectContaining({ id: 'raw-door-type', wallType: 'door' }),
      expect.objectContaining({ id: 'raw-door-flag', wallType: 'door' }),
      expect.objectContaining({ id: 'raw-window', wallType: 'window' }),
    ]);
  });

  test('creates a manual wall with stable ids and default blocking', () => {
    const wall = createManualWallSegment({
      existingWalls: [{ id: 'wall-1', label: 'Wall 1' }],
      startPoint: { x: 35, y: 35 },
      endPoint: { x: 175, y: 35 },
    });

    expect(wall).toEqual({
      id: 'manual-wall-2',
      label: 'Wall 2',
      x1: 35,
      y1: 35,
      x2: 175,
      y2: 35,
      wallType: 'wall',
      blocksSight: true,
      blocksVision: true,
      blocksLight: true,
    });
  });

  test('moves endpoints and whole segments immutably', () => {
    const walls = normalizeEditableWallSegments([{
      id: 'wall-1',
      label: 'Wall',
      x1: 0,
      y1: 0,
      x2: 70,
      y2: 0,
      blocksSight: true,
    }]);

    expect(moveWallEndpoint(walls, 'wall-1', 'start', { x: 10, y: 20 })[0]).toEqual(expect.objectContaining({
      x1: 10,
      y1: 20,
      x2: 70,
      y2: 0,
    }));
    expect(moveWallEndpoint(walls, 'wall-1', 'end', { x: 140, y: 40 })[0]).toEqual(expect.objectContaining({
      x1: 0,
      y1: 0,
      x2: 140,
      y2: 40,
    }));
    expect(moveWallSegment(walls, 'wall-1', { x: 5, y: 8 })[0]).toEqual(expect.objectContaining({
      x1: 5,
      y1: 8,
      x2: 75,
      y2: 8,
    }));
    expect(walls[0]).toEqual(expect.objectContaining({
      x1: 0,
      y1: 0,
      x2: 70,
      y2: 0,
    }));
  });

  test('updates, toggles, duplicates, and deletes wall sources immutably', () => {
    const walls = normalizeEditableWallSegments([{
      id: 'wall-1',
      label: 'North Wall',
      x1: 0,
      y1: 0,
      x2: 70,
      y2: 0,
      blocksSight: true,
    }]);

    expect(updateWallSegment(walls, 'wall-1', {
      label: 'Kitchen Window',
      wallType: 'window',
      blocksVision: false,
      blocksLight: true,
    })[0]).toEqual(expect.objectContaining({
      label: 'Kitchen Window',
      wallType: 'window',
      blocksSight: true,
      blocksVision: false,
      blocksLight: true,
    }));

    expect(toggleWallSegmentBlocking(walls, 'wall-1')[0]).toEqual(expect.objectContaining({
      blocksSight: false,
      blocksVision: false,
      blocksLight: false,
    }));

    const duplicatedWalls = duplicateWallSegment(walls, 'wall-1', { grid });
    expect(duplicatedWalls).toHaveLength(2);
    expect(duplicatedWalls[1]).toEqual(expect.objectContaining({
      id: 'manual-wall-2',
      label: 'North Wall Copy',
      x1: 70,
      y1: 70,
      x2: 140,
      y2: 70,
    }));

    expect(deleteWallSegment(duplicatedWalls, 'wall-1').map((wall) => wall.id)).toEqual(['manual-wall-2']);
    expect(walls).toHaveLength(1);
  });
});
