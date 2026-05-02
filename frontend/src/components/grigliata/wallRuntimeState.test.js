import {
  buildEffectiveLightingRenderInput,
  classifyImportedWallSegment,
  GRIGLIATA_WALL_STATE_COLLECTION,
  normalizeGrigliataWallRuntimeState,
} from './wallRuntimeState';

const baseRenderInput = {
  backgroundId: 'map-1',
  scene: { darkness: 0.6, globalLight: false },
  lights: [],
  walls: [{
    id: 'wall-1',
    x1: 0,
    y1: 0,
    x2: 70,
    y2: 0,
    wallType: 'wall',
    blocksSight: true,
    blocksVision: true,
    blocksLight: true,
  }, {
    id: 'wall-2',
    x1: 70,
    y1: 0,
    x2: 140,
    y2: 0,
    wallType: 'door',
    blocksSight: true,
    blocksVision: true,
    blocksLight: true,
  }, {
    id: 'wall-3',
    x1: 140,
    y1: 0,
    x2: 210,
    y2: 0,
    wallType: 'window',
    blocksSight: true,
    blocksVision: true,
    blocksLight: true,
  }],
};

describe('wallRuntimeState', () => {
  test('exposes the focused runtime wall-state collection name', () => {
    expect(GRIGLIATA_WALL_STATE_COLLECTION).toBe('grigliata_wall_state');
  });

  test('normalizes valid runtime wall state and rejects malformed docs', () => {
    expect(normalizeGrigliataWallRuntimeState({
      backgroundId: 'map-1',
      segments: {
        'wall-2': {
          isOpen: true,
          updatedAt: 'then',
          updatedBy: 'dm-1',
          rawField: 'strip me',
        },
        'bad segment id': {
          isOpen: false,
        },
      },
      updatedAt: 'now',
      updatedBy: 'dm-1',
    })).toEqual({
      backgroundId: 'map-1',
      segments: {
        'wall-2': {
          isOpen: true,
          updatedAt: 'then',
          updatedBy: 'dm-1',
        },
      },
      updatedAt: 'now',
      updatedBy: 'dm-1',
    });

    expect(normalizeGrigliataWallRuntimeState({
      backgroundId: '',
      segments: {},
    })).toBeNull();
    expect(normalizeGrigliataWallRuntimeState({
      backgroundId: 'map-1',
      segments: {
        'wall-2': { isOpen: 'yes' },
      },
    })).toBeNull();
    expect(normalizeGrigliataWallRuntimeState(null)).toBeNull();
  });

  test('classifies imported walls conservatively from available metadata', () => {
    expect(classifyImportedWallSegment({ doorType: 1 })).toBe('door');
    expect(classifyImportedWallSegment({ wallType: 'window' })).toBe('window');
    expect(classifyImportedWallSegment({ doorType: 0, blocksMovement: true, blocksSight: true })).toBe('wall');
    expect(classifyImportedWallSegment({ doorType: 2 })).toBe('wall');
  });

  test('keeps closed doors and windows in blocking geometry by default', () => {
    const effectiveInput = buildEffectiveLightingRenderInput({
      lightingRenderInput: baseRenderInput,
      wallRuntimeState: null,
    });

    expect(effectiveInput.walls.map((wall) => ({
      id: wall.id,
      blocksSight: wall.blocksSight,
    }))).toEqual([
      { id: 'wall-1', blocksSight: true },
      { id: 'wall-2', blocksSight: true },
      { id: 'wall-3', blocksSight: true },
    ]);
  });

  test('removes open door and window segments from blocking geometry while normal walls ignore isOpen', () => {
    const effectiveInput = buildEffectiveLightingRenderInput({
      lightingRenderInput: baseRenderInput,
      wallRuntimeState: {
        backgroundId: 'map-1',
        segments: {
          'wall-1': { isOpen: true },
          'wall-2': { isOpen: true },
          'wall-3': { isOpen: true },
        },
      },
    });

    expect(effectiveInput.walls.map((wall) => ({
      id: wall.id,
      wallType: wall.wallType,
      blocksSight: wall.blocksSight,
      blocksVision: wall.blocksVision,
      blocksLight: wall.blocksLight,
    }))).toEqual([{
      id: 'wall-1',
      wallType: 'wall',
      blocksSight: true,
      blocksVision: true,
      blocksLight: true,
    }, {
      id: 'wall-2',
      wallType: 'door',
      blocksSight: false,
      blocksVision: false,
      blocksLight: false,
    }, {
      id: 'wall-3',
      wallType: 'window',
      blocksSight: false,
      blocksVision: false,
      blocksLight: false,
    }]);
  });

  test('ignores runtime state for another background', () => {
    const effectiveInput = buildEffectiveLightingRenderInput({
      lightingRenderInput: baseRenderInput,
      wallRuntimeState: {
        backgroundId: 'map-2',
        segments: {
          'wall-2': { isOpen: true },
        },
      },
    });

    expect(effectiveInput.walls.find((wall) => wall.id === 'wall-2').blocksSight).toBe(true);
  });
});
