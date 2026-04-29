import {
  buildPlacementDocId,
  getBackgroundAssetType,
  getFileExtensionFromContentType,
  getHiddenTokenIdsForBackground,
  getTokenPositionPx,
  isCurrentUserTokenHiddenForViewer,
  isVideoBackground,
  normalizeGridConfig,
  normalizeHiddenTokenIdsByBackground,
  normalizeTokenSizeSquares,
} from './boardUtils';

describe('buildPlacementDocId', () => {
  test('serializes the background and token ids with the shared placement format', () => {
    expect(buildPlacementDocId('map-1', 'token-7')).toBe('map-1__token-7');
  });
});

describe('background media helpers', () => {
  test('defaults existing backgrounds to image and recognizes video backgrounds', () => {
    expect(getBackgroundAssetType({})).toBe('image');
    expect(getBackgroundAssetType({ assetType: 'image' })).toBe('image');
    expect(getBackgroundAssetType({ assetType: 'video' })).toBe('video');
    expect(isVideoBackground({ assetType: 'video' })).toBe(true);
    expect(isVideoBackground({ imageUrl: 'https://example.com/map.png' })).toBe(false);
  });

  test('keeps audio and video mp4 extensions distinct', () => {
    expect(getFileExtensionFromContentType('audio/mp4')).toBe('.m4a');
    expect(getFileExtensionFromContentType('video/mp4')).toBe('.mp4');
  });
});

describe('normalizeGridConfig', () => {
  test('clamps the cell size at the new 12px floor and keeps nearby valid values', () => {
    expect(normalizeGridConfig({ cellSizePx: 1, offsetXPx: 0, offsetYPx: 0 })).toEqual({
      cellSizePx: 12,
      offsetXPx: 0,
      offsetYPx: 0,
    });

    expect(normalizeGridConfig({ cellSizePx: 12, offsetXPx: 0, offsetYPx: 0 })).toEqual({
      cellSizePx: 12,
      offsetXPx: 0,
      offsetYPx: 0,
    });

    expect(normalizeGridConfig({ cellSizePx: 13, offsetXPx: 0, offsetYPx: 0 })).toEqual({
      cellSizePx: 13,
      offsetXPx: 0,
      offsetYPx: 0,
    });
  });

  test('still clamps the cell size at the existing 240px ceiling', () => {
    expect(normalizeGridConfig({ cellSizePx: 999, offsetXPx: 0, offsetYPx: 0 })).toEqual({
      cellSizePx: 240,
      offsetXPx: 0,
      offsetYPx: 0,
    });
  });
});

describe('normalizeHiddenTokenIdsByBackground', () => {
  test('keeps only valid background and token ids', () => {
    expect(normalizeHiddenTokenIdsByBackground({
      'map-1': ['token-1', '', 'token-1', null],
      '': ['token-2'],
      'map-2': 'not-an-array',
    })).toEqual({
      'map-1': ['token-1'],
    });
  });
});

describe('normalizeTokenSizeSquares', () => {
  test('defaults invalid values to one square', () => {
    expect(normalizeTokenSizeSquares(undefined)).toBe(1);
    expect(normalizeTokenSizeSquares(null)).toBe(1);
    expect(normalizeTokenSizeSquares('')).toBe(1);
  });

  test('clamps values into the supported range', () => {
    expect(normalizeTokenSizeSquares(0)).toBe(1);
    expect(normalizeTokenSizeSquares(2)).toBe(2);
    expect(normalizeTokenSizeSquares(4)).toBe(4);
    expect(normalizeTokenSizeSquares(99)).toBe(9);
  });
});

describe('getTokenPositionPx', () => {
  test('uses one grid square when sizeSquares is missing', () => {
    expect(getTokenPositionPx({ col: 2, row: 3 }, { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 })).toEqual({
      x: 140,
      y: 210,
      size: 70,
    });
  });

  test('scales the rendered token size by the square footprint', () => {
    expect(getTokenPositionPx({ col: 2, row: 3, sizeSquares: 2 }, { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 })).toEqual({
      x: 140,
      y: 210,
      size: 140,
    });

    expect(getTokenPositionPx({ col: 1, row: 1, sizeSquares: 4 }, { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 })).toEqual({
      x: 70,
      y: 70,
      size: 280,
    });
  });
});

describe('getHiddenTokenIdsForBackground', () => {
  test('returns the token ids hidden on the active background', () => {
    expect(getHiddenTokenIdsForBackground({
      activeBackgroundId: 'map-1',
      hiddenTokenIdsByBackground: {
        'map-1': ['token-1', 'token-2'],
      },
    })).toEqual(['token-1', 'token-2']);
  });
});

describe('isCurrentUserTokenHiddenForViewer', () => {
  test('returns true for a player with a token hidden through the per-token map', () => {
    expect(isCurrentUserTokenHiddenForViewer({
      activeBackgroundId: 'map-1',
      currentUserHiddenBackgroundIds: ['map-1', 'map-2'],
      currentUserHiddenTokenIdsByBackground: {
        'map-1': ['token-1'],
      },
      currentUserPlacement: null,
      isManager: false,
      tokenId: 'token-1',
    })).toBe(true);
  });

  test('falls back to the legacy hidden background list for the main token when requested', () => {
    expect(isCurrentUserTokenHiddenForViewer({
      activeBackgroundId: 'map-1',
      currentUserHiddenBackgroundIds: ['map-1'],
      currentUserHiddenTokenIdsByBackground: {},
      currentUserPlacement: null,
      isManager: false,
      tokenId: 'user-1',
      includeLegacyBackgroundFallback: true,
    })).toBe(true);
  });

  test('returns false when the current user has a visible placement', () => {
    expect(isCurrentUserTokenHiddenForViewer({
      activeBackgroundId: 'map-1',
      currentUserHiddenBackgroundIds: ['map-1'],
      currentUserHiddenTokenIdsByBackground: {
        'map-1': ['token-1'],
      },
      currentUserPlacement: { ownerUid: 'user-1', col: 4, row: 7 },
      isManager: false,
      tokenId: 'token-1',
    })).toBe(false);
  });

  test('returns false for managers even when the hidden list contains the active map', () => {
    expect(isCurrentUserTokenHiddenForViewer({
      activeBackgroundId: 'map-1',
      currentUserHiddenBackgroundIds: ['map-1'],
      currentUserHiddenTokenIdsByBackground: {
        'map-1': ['token-1'],
      },
      currentUserPlacement: null,
      isManager: true,
      tokenId: 'token-1',
    })).toBe(false);
  });
});
