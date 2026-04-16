import { buildPlacementDocId, isCurrentUserTokenHiddenForViewer } from './boardUtils';

describe('buildPlacementDocId', () => {
  test('serializes the background and owner ids with the shared placement format', () => {
    expect(buildPlacementDocId('map-1', 'user-7')).toBe('map-1__user-7');
  });
});

describe('isCurrentUserTokenHiddenForViewer', () => {
  test('returns true for a player with a hidden token and no visible placement', () => {
    expect(isCurrentUserTokenHiddenForViewer({
      activeBackgroundId: 'map-1',
      currentUserHiddenBackgroundIds: ['map-1', 'map-2'],
      currentUserPlacement: null,
      isManager: false,
    })).toBe(true);
  });

  test('returns false when the current user has a visible placement', () => {
    expect(isCurrentUserTokenHiddenForViewer({
      activeBackgroundId: 'map-1',
      currentUserHiddenBackgroundIds: ['map-1'],
      currentUserPlacement: { ownerUid: 'user-1', col: 4, row: 7 },
      isManager: false,
    })).toBe(false);
  });

  test('returns false for managers even when the hidden list contains the active map', () => {
    expect(isCurrentUserTokenHiddenForViewer({
      activeBackgroundId: 'map-1',
      currentUserHiddenBackgroundIds: ['map-1'],
      currentUserPlacement: null,
      isManager: true,
    })).toBe(false);
  });
});