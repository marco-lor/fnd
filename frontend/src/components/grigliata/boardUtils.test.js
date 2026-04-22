import {
  buildPlacementDocId,
  getHiddenTokenIdsForBackground,
  isCurrentUserTokenHiddenForViewer,
  normalizeGridConfig,
  normalizeHiddenTokenIdsByBackground,
} from './boardUtils';

describe('buildPlacementDocId', () => {
  test('serializes the background and token ids with the shared placement format', () => {
    expect(buildPlacementDocId('map-1', 'token-7')).toBe('map-1__token-7');
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