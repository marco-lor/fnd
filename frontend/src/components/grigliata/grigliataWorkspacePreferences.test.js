import {
  buildGrigliataWorkspaceStorageKey,
  normalizeGrigliataWorkspacePreferences,
  readGrigliataWorkspacePreferences,
  writeGrigliataWorkspacePreferences,
} from './grigliataWorkspacePreferences';

const buildMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: jest.fn((key) => values.get(key) ?? null),
    setItem: jest.fn((key, value) => values.set(key, value)),
    values,
  };
};

describe('grigliata workspace preferences', () => {
  test('keeps manager and player workspace state isolated for the same account', () => {
    expect(buildGrigliataWorkspaceStorageKey({
      currentUserId: 'dm-user',
      isManager: true,
    })).toBe('grigliata.workspace.v1.dm-user.manager');
    expect(buildGrigliataWorkspaceStorageKey({
      currentUserId: 'dm-user',
      isManager: false,
    })).toBe('grigliata.workspace.v1.dm-user.player');
  });

  test('migrates the removed lighting tab to the DM Gallery tab', () => {
    expect(normalizeGrigliataWorkspacePreferences({
      selectedGalleryFolderId: 'maps-folder',
      selectedMusicFolderId: 'music-folder',
      selectedBackgroundId: 'map-2',
      activeSidebarTab: 'lighting',
    }, { isManager: true })).toEqual(expect.objectContaining({
      selectedGalleryFolderId: 'maps-folder',
      selectedMusicFolderId: 'music-folder',
      selectedBackgroundId: 'map-2',
      activeSidebarTab: 'gallery',
      role: 'manager',
      version: 1,
    }));
  });

  test('persists IDs and safely falls back from malformed storage', () => {
    const storage = buildMemoryStorage();
    expect(writeGrigliataWorkspacePreferences({
      currentUserId: 'dm-user',
      isManager: true,
      storage,
      preferences: {
        selectedGalleryFolderId: 'maps-folder',
        selectedMusicFolderId: 'music-folder',
        selectedBackgroundId: 'map-2',
        activeSidebarTab: 'music',
      },
    })).toBe(true);

    expect(readGrigliataWorkspacePreferences({
      currentUserId: 'dm-user',
      isManager: true,
      storage,
    })).toEqual(expect.objectContaining({
      selectedGalleryFolderId: 'maps-folder',
      selectedMusicFolderId: 'music-folder',
      selectedBackgroundId: 'map-2',
      activeSidebarTab: 'music',
    }));

    storage.values.set('grigliata.workspace.v1.dm-user.manager', '{not-json');
    expect(readGrigliataWorkspacePreferences({
      currentUserId: 'dm-user',
      isManager: true,
      storage,
    })).toEqual(expect.objectContaining({
      selectedGalleryFolderId: '__unfiled__',
      selectedMusicFolderId: '__unfiled__',
      selectedBackgroundId: '',
      activeSidebarTab: 'tokens',
    }));
  });
});
