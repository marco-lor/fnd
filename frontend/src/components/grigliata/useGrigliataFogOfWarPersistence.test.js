import { buildViewerFogCurrentVisibleCells } from './useGrigliataFogOfWarPersistence';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

const token = {
  tokenId: 'user-1',
  ownerUid: 'user-1',
  tokenType: 'character',
  placed: true,
  col: 0,
  row: 0,
  isVisibleToPlayers: true,
  isDead: false,
  visionRadiusSquares: 3,
};

const closedDoorInput = {
  backgroundId: 'map-1',
  scene: { darkness: 0.6, globalLight: false },
  lights: [],
  walls: [{
    id: 'wall-2',
    x1: 70,
    y1: -70,
    x2: 70,
    y2: 140,
    wallType: 'door',
    blocksSight: true,
    blocksVision: true,
    blocksLight: true,
  }],
};

describe('useGrigliataFogOfWarPersistence visibility helpers', () => {
  test('current visible fog cells respect closed and opened runtime blockers', () => {
    const closedCells = buildViewerFogCurrentVisibleCells({
      tokens: [token],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      lightingRenderInput: closedDoorInput,
      rayCount: 64,
    });
    const openCells = buildViewerFogCurrentVisibleCells({
      tokens: [token],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      lightingRenderInput: {
        ...closedDoorInput,
        walls: [{
          ...closedDoorInput.walls[0],
          isOpen: true,
          blocksSight: false,
          blocksVision: false,
          blocksLight: false,
        }],
      },
      rayCount: 64,
    });

    expect(closedCells).not.toContain('1:0');
    expect(openCells).toContain('1:0');
    expect(openCells.length).toBeGreaterThan(closedCells.length);
  });
});
