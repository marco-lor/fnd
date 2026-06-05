import { timestampToMillis } from './boardUtils';

export const GRIGLIATA_GALLERY_FOLDERS_COLLECTION = 'grigliata_gallery_folders';
export const UNFILED_GALLERY_FOLDER_ID = '__unfiled__';
export const UNFILED_GALLERY_FOLDER_NAME = 'Unfiled';

export const normalizeGalleryFolderName = (value) => (
  (typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
);

export const buildNormalizedGalleryFolderName = (value) => (
  normalizeGalleryFolderName(value).toLocaleLowerCase()
);

export const isReservedGalleryFolderName = (value) => (
  buildNormalizedGalleryFolderName(value) === buildNormalizedGalleryFolderName(UNFILED_GALLERY_FOLDER_NAME)
);

export const sortGalleryFolders = (folders = []) => (
  [...folders]
    .filter((folder) => typeof folder?.id === 'string' && folder.id)
    .sort((left, right) => {
      const leftName = normalizeGalleryFolderName(left.name || left.normalizedName || '');
      const rightName = normalizeGalleryFolderName(right.name || right.normalizedName || '');
      const nameComparison = leftName.localeCompare(rightName, undefined, { sensitivity: 'base' });

      if (nameComparison !== 0) {
        return nameComparison;
      }

      const leftMillis = timestampToMillis(left.createdAt || left.updatedAt);
      const rightMillis = timestampToMillis(right.createdAt || right.updatedAt);
      if (leftMillis !== rightMillis) {
        return leftMillis - rightMillis;
      }

      return left.id.localeCompare(right.id);
    })
);

export const hasDuplicateGalleryFolderName = (folders = [], name = '', excludedFolderId = '') => {
  const normalizedName = buildNormalizedGalleryFolderName(name);
  if (!normalizedName) {
    return false;
  }

  return folders.some((folder) => (
    folder?.id !== excludedFolderId
    && buildNormalizedGalleryFolderName(folder?.name || folder?.normalizedName || '') === normalizedName
  ));
};

export const getResolvedGalleryFolderId = (background = {}, folders = []) => {
  const folderId = typeof background?.galleryFolderId === 'string'
    ? background.galleryFolderId.trim()
    : '';
  if (!folderId) {
    return UNFILED_GALLERY_FOLDER_ID;
  }

  const folderIds = new Set((folders || []).map((folder) => folder?.id).filter(Boolean));
  return folderIds.has(folderId) ? folderId : UNFILED_GALLERY_FOLDER_ID;
};

export const getWritableGalleryFolderId = (folderId = '') => (
  folderId && folderId !== UNFILED_GALLERY_FOLDER_ID ? folderId : ''
);

export const getGalleryFolderDisplayName = (background = {}, folders = []) => {
  const resolvedFolderId = getResolvedGalleryFolderId(background, folders);
  if (resolvedFolderId === UNFILED_GALLERY_FOLDER_ID) {
    return UNFILED_GALLERY_FOLDER_NAME;
  }

  const folder = folders.find((candidate) => candidate?.id === resolvedFolderId);
  return normalizeGalleryFolderName(folder?.name) || UNFILED_GALLERY_FOLDER_NAME;
};

export const buildGalleryFolderOptions = (folders = []) => ([
  {
    id: UNFILED_GALLERY_FOLDER_ID,
    name: UNFILED_GALLERY_FOLDER_NAME,
    isSystem: true,
  },
  ...sortGalleryFolders(folders).map((folder) => ({
    ...folder,
    name: normalizeGalleryFolderName(folder.name) || 'Untitled Folder',
    isSystem: false,
  })),
]);

export const buildGalleryFolderBuckets = ({ backgrounds = [], folders = [] } = {}) => {
  const options = buildGalleryFolderOptions(folders);
  const bucketsById = new Map(options.map((folder) => [
    folder.id,
    {
      ...folder,
      backgrounds: [],
    },
  ]));

  (backgrounds || []).forEach((background) => {
    const resolvedFolderId = getResolvedGalleryFolderId(background, folders);
    const bucket = bucketsById.get(resolvedFolderId) || bucketsById.get(UNFILED_GALLERY_FOLDER_ID);
    bucket.backgrounds.push(background);
  });

  return options.map((folder) => bucketsById.get(folder.id));
};
