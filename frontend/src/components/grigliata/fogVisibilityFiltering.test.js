import {
  filterFogVisibleTokens,
  filterFogVisibleTurnOrderEntries,
  splitFogVisibleTokenRenderLayers,
} from './fogVisibilityFiltering';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

const buildToken = (overrides = {}) => ({
  tokenId: 'token-1',
  id: 'token-1',
  ownerUid: 'user-2',
  tokenType: 'character',
  placed: true,
  col: 0,
  row: 0,
  sizeSquares: 1,
  isVisibleToPlayers: true,
  isDead: false,
  statuses: [],
  ...overrides,
});

const fogOfWar = {
  exploredCells: ['8:8'],
  currentVisibleCells: ['0:0', '1:0'],
};

describe('fogVisibilityFiltering', () => {
  test('keeps the player main token visible while filtering other tokens by current visible cells', () => {
    const tokens = [
      buildToken({
        tokenId: 'user-1',
        id: 'user-1',
        ownerUid: 'user-1',
        col: 20,
        row: 20,
      }),
      buildToken({
        tokenId: 'user-2',
        id: 'user-2',
        ownerUid: 'user-2',
        col: 1,
        row: 0,
      }),
      buildToken({
        tokenId: 'foe-1',
        id: 'foe-1',
        ownerUid: 'dm-1',
        tokenType: 'foe',
        col: 8,
        row: 8,
      }),
      buildToken({
        tokenId: 'custom-1',
        id: 'custom-1',
        ownerUid: 'user-1',
        tokenType: 'custom',
        col: 9,
        row: 9,
      }),
    ];

    expect(filterFogVisibleTokens({
      tokens,
      currentUserId: 'user-1',
      isManager: false,
      grid,
      fogOfWar,
    }).map((token) => token.tokenId)).toEqual(['user-1', 'user-2']);
  });

  test('does not use explored-only memory cells for live token visibility', () => {
    expect(filterFogVisibleTokens({
      tokens: [buildToken({ tokenId: 'user-2', id: 'user-2', col: 8, row: 8 })],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      fogOfWar,
    })).toEqual([]);
  });

  test('fails closed for malformed or empty player fog input except for the main token', () => {
    const tokens = [
      buildToken({ tokenId: 'user-1', id: 'user-1', ownerUid: 'user-1', col: 5, row: 5 }),
      buildToken({ tokenId: 'user-2', id: 'user-2', col: 0, row: 0 }),
    ];

    expect(filterFogVisibleTokens({
      tokens,
      currentUserId: 'user-1',
      isManager: false,
      grid,
      fogOfWar: { currentVisibleCells: ['bad-cell'], exploredCells: ['0:0'] },
    }).map((token) => token.tokenId)).toEqual(['user-1']);

    expect(filterFogVisibleTokens({
      tokens,
      currentUserId: 'user-1',
      isManager: false,
      grid,
      fogOfWar: { currentVisibleCells: [], exploredCells: ['0:0'] },
    }).map((token) => token.tokenId)).toEqual(['user-1']);
  });

  test('returns token-derived inputs unfiltered for DMs', () => {
    const tokens = [buildToken({ tokenId: 'foe-1', id: 'foe-1', col: 8, row: 8 })];
    const entries = [{ tokenId: 'foe-1' }, { tokenId: 'hidden-foe' }];

    expect(filterFogVisibleTokens({
      tokens,
      currentUserId: 'dm-1',
      isManager: true,
      grid,
      fogOfWar,
    })).toBe(tokens);
    expect(filterFogVisibleTurnOrderEntries({
      entries,
      tokens,
      isManager: true,
      fogOfWar,
    })).toBe(entries);
  });

  test('filters turn order entries to fog-visible token ids for players', () => {
    const visibleTokens = filterFogVisibleTokens({
      tokens: [
        buildToken({ tokenId: 'user-1', id: 'user-1', ownerUid: 'user-1', col: 20, row: 20 }),
        buildToken({ tokenId: 'user-2', id: 'user-2', ownerUid: 'user-2', col: 1, row: 0 }),
        buildToken({ tokenId: 'foe-1', id: 'foe-1', ownerUid: 'dm-1', col: 8, row: 8 }),
      ],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      fogOfWar,
    });

    expect(filterFogVisibleTurnOrderEntries({
      entries: [{ tokenId: 'user-1' }, { tokenId: 'user-2' }, { tokenId: 'foe-1' }],
      tokens: visibleTokens,
      isManager: false,
      fogOfWar,
    })).toEqual([{ tokenId: 'user-1' }, { tokenId: 'user-2' }]);
  });

  test('separates retained main tokens above fog without adding current cutouts', () => {
    const hiddenMainLayers = splitFogVisibleTokenRenderLayers({
      tokens: [
        buildToken({
          tokenId: 'user-1',
          id: 'user-1',
          ownerUid: 'user-1',
          col: 8,
          row: 8,
        }),
        buildToken({ tokenId: 'user-2', id: 'user-2', col: 1, row: 0 }),
      ],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      fogOfWar,
    });
    expect(hiddenMainLayers.belowFogTokens.map((token) => token.tokenId)).toEqual(['user-2']);
    expect(hiddenMainLayers.aboveFogTokens.map((token) => token.tokenId)).toEqual(['user-1']);

    const visibleMainLayers = splitFogVisibleTokenRenderLayers({
      tokens: [buildToken({ tokenId: 'user-1', id: 'user-1', ownerUid: 'user-1', col: 0, row: 0 })],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      fogOfWar,
    });
    expect(visibleMainLayers.belowFogTokens.map((token) => token.tokenId)).toEqual(['user-1']);
    expect(visibleMainLayers.aboveFogTokens).toEqual([]);
  });

  test('retains owned custom token drag previews above fog', () => {
    const draggedCustomToken = buildToken({
      tokenId: 'custom-2',
      id: 'custom-2',
      ownerUid: 'user-1',
      tokenType: 'custom',
      col: 5,
      row: 5,
      isDragPreview: true,
      renderPosition: { x: 350, y: 350, size: 70 },
    });
    const hiddenIdleCustomToken = buildToken({
      tokenId: 'custom-3',
      id: 'custom-3',
      ownerUid: 'user-1',
      tokenType: 'custom',
      col: 5,
      row: 5,
    });

    const visibleTokens = filterFogVisibleTokens({
      tokens: [draggedCustomToken, hiddenIdleCustomToken],
      currentUserId: 'user-1',
      isManager: false,
      grid,
      fogOfWar,
    });
    const layers = splitFogVisibleTokenRenderLayers({
      tokens: visibleTokens,
      currentUserId: 'user-1',
      isManager: false,
      grid,
      fogOfWar,
    });

    expect(visibleTokens.map((token) => token.tokenId)).toEqual(['custom-2']);
    expect(layers.belowFogTokens).toEqual([]);
    expect(layers.aboveFogTokens.map((token) => token.tokenId)).toEqual(['custom-2']);
  });
});
