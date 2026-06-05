import {
  buildGalleryFolderBuckets,
  getGalleryFolderDisplayName,
  hasDuplicateGalleryFolderName,
  normalizeGalleryFolderName,
  sortGalleryFolders,
  UNFILED_GALLERY_FOLDER_ID,
} from './galleryFolders';

describe('gallery folder helpers', () => {
  test('normalizes folder names for display and duplicate checks', () => {
    expect(normalizeGalleryFolderName('  Boss   Arenas  ')).toBe('Boss Arenas');
    expect(normalizeGalleryFolderName('\nCities\tand towns')).toBe('Cities and towns');
    expect(normalizeGalleryFolderName('')).toBe('');
  });

  test('detects duplicates while allowing the edited folder to keep its own name', () => {
    const folders = [
      { id: 'folder-a', name: 'Boss Arenas' },
      { id: 'folder-b', name: 'Cities' },
    ];

    expect(hasDuplicateGalleryFolderName(folders, ' boss arenas ')).toBe(true);
    expect(hasDuplicateGalleryFolderName(folders, 'Boss Arenas', 'folder-a')).toBe(false);
    expect(hasDuplicateGalleryFolderName(folders, 'Wilderness')).toBe(false);
  });

  test('sorts folders by normalized name without mutating the source list', () => {
    const folders = [
      { id: 'folder-b', name: 'Wilderness' },
      { id: 'folder-a', name: 'Boss Arenas' },
      { id: 'folder-c', name: 'cities' },
    ];

    expect(sortGalleryFolders(folders).map((folder) => folder.id)).toEqual(['folder-a', 'folder-c', 'folder-b']);
    expect(folders.map((folder) => folder.id)).toEqual(['folder-b', 'folder-a', 'folder-c']);
  });

  test('groups backgrounds into shared folders and falls invalid folders back to Unfiled', () => {
    const folders = [
      { id: 'folder-a', name: 'Boss Arenas' },
      { id: 'folder-b', name: 'Cities' },
    ];
    const backgrounds = [
      { id: 'map-1', name: 'Dragon Room', galleryFolderId: 'folder-a' },
      { id: 'map-2', name: 'Old Harbor', galleryFolderId: 'missing-folder' },
      { id: 'map-3', name: 'Roadside Camp' },
    ];

    const buckets = buildGalleryFolderBuckets({ backgrounds, folders });

    expect(buckets.map((bucket) => bucket.id)).toEqual([
      UNFILED_GALLERY_FOLDER_ID,
      'folder-a',
      'folder-b',
    ]);
    expect(buckets[0].name).toBe('Unfiled');
    expect(buckets[0].backgrounds.map((background) => background.id)).toEqual(['map-2', 'map-3']);
    expect(buckets[1].backgrounds.map((background) => background.id)).toEqual(['map-1']);
    expect(buckets[2].backgrounds).toEqual([]);
  });

  test('resolves display names from valid folders and uses Unfiled as the safe fallback', () => {
    const folders = [{ id: 'folder-a', name: 'Boss Arenas' }];

    expect(getGalleryFolderDisplayName({ galleryFolderId: 'folder-a' }, folders)).toBe('Boss Arenas');
    expect(getGalleryFolderDisplayName({ galleryFolderId: 'folder-missing' }, folders)).toBe('Unfiled');
    expect(getGalleryFolderDisplayName({}, folders)).toBe('Unfiled');
  });
});
