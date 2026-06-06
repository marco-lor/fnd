import {
  buildGalleryFolderBuckets,
  buildGalleryFolderOptions,
  getGalleryFolderDisplayName,
  getWritableGalleryFolderId,
  hasDuplicateGalleryFolderName,
  normalizeGalleryFolderName,
  sortGalleryFolders,
  UNFILED_GALLERY_FOLDER_ID,
} from './galleryFolders';
import {
  buildMusicFolderOptions,
  getMusicFolderDisplayName,
  getWritableMusicFolderId,
  hasDuplicateMusicFolderName,
  normalizeMusicFolderName,
  sortMusicFolders,
  UNFILED_MUSIC_FOLDER_ID,
} from './musicFolders';

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

  test('exposes Unfiled as a UI folder while writing it as an empty Firestore field', () => {
    expect(buildGalleryFolderOptions([])).toEqual([{
      id: UNFILED_GALLERY_FOLDER_ID,
      name: 'Unfiled',
      isSystem: true,
    }]);
    expect(getWritableGalleryFolderId(UNFILED_GALLERY_FOLDER_ID)).toBe('');
    expect(getWritableGalleryFolderId('folder-a')).toBe('folder-a');
  });
});

describe('music folder helpers', () => {
  test('mirrors gallery folder normalization, sorting, duplicate detection, and writable ids', () => {
    const folders = [
      { id: 'music-b', name: 'Combat' },
      { id: 'music-a', name: '  Ambience  ' },
    ];

    expect(normalizeMusicFolderName('\nBoss   Themes\t')).toBe('Boss Themes');
    expect(sortMusicFolders(folders).map((folder) => folder.id)).toEqual(['music-a', 'music-b']);
    expect(hasDuplicateMusicFolderName(folders, 'ambience')).toBe(true);
    expect(hasDuplicateMusicFolderName(folders, 'ambience', 'music-a')).toBe(false);
    expect(buildMusicFolderOptions(folders).map((folder) => folder.id)).toEqual([
      UNFILED_MUSIC_FOLDER_ID,
      'music-a',
      'music-b',
    ]);
    expect(getWritableMusicFolderId(UNFILED_MUSIC_FOLDER_ID)).toBe('');
  });

  test('resolves track folder display names and falls invalid assignments back to Unfiled', () => {
    const folders = [{ id: 'music-a', name: 'Ambience' }];

    expect(getMusicFolderDisplayName({ musicFolderId: 'music-a' }, folders)).toBe('Ambience');
    expect(getMusicFolderDisplayName({ musicFolderId: 'missing-folder' }, folders)).toBe('Unfiled');
    expect(getMusicFolderDisplayName({}, folders)).toBe('Unfiled');
  });
});
