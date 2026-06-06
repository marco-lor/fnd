import { timestampToMillis } from './boardUtils';

export const UNFILED_MEDIA_FOLDER_ID = '__unfiled__';
export const UNFILED_MEDIA_FOLDER_NAME = 'Unfiled';

export const normalizeMediaFolderName = (value) => (
  (typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
);

export const buildNormalizedMediaFolderName = (value) => (
  normalizeMediaFolderName(value).toLocaleLowerCase()
);

export const isReservedMediaFolderName = (value) => (
  buildNormalizedMediaFolderName(value) === buildNormalizedMediaFolderName(UNFILED_MEDIA_FOLDER_NAME)
);

export const sortMediaFolders = (folders = []) => (
  [...folders]
    .filter((folder) => typeof folder?.id === 'string' && folder.id)
    .sort((left, right) => {
      const leftName = normalizeMediaFolderName(left.name || left.normalizedName || '');
      const rightName = normalizeMediaFolderName(right.name || right.normalizedName || '');
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

export const hasDuplicateMediaFolderName = (folders = [], name = '', excludedFolderId = '') => {
  const normalizedName = buildNormalizedMediaFolderName(name);
  if (!normalizedName) {
    return false;
  }

  return folders.some((folder) => (
    folder?.id !== excludedFolderId
    && buildNormalizedMediaFolderName(folder?.name || folder?.normalizedName || '') === normalizedName
  ));
};

export const getResolvedMediaFolderId = (item = {}, folders = [], folderField = 'folderId') => {
  const folderId = typeof item?.[folderField] === 'string'
    ? item[folderField].trim()
    : '';
  if (!folderId) {
    return UNFILED_MEDIA_FOLDER_ID;
  }

  const folderIds = new Set((folders || []).map((folder) => folder?.id).filter(Boolean));
  return folderIds.has(folderId) ? folderId : UNFILED_MEDIA_FOLDER_ID;
};

export const getWritableMediaFolderId = (folderId = '') => (
  folderId && folderId !== UNFILED_MEDIA_FOLDER_ID ? folderId : ''
);

export const getMediaFolderDisplayName = (item = {}, folders = [], folderField = 'folderId') => {
  const resolvedFolderId = getResolvedMediaFolderId(item, folders, folderField);
  if (resolvedFolderId === UNFILED_MEDIA_FOLDER_ID) {
    return UNFILED_MEDIA_FOLDER_NAME;
  }

  const folder = folders.find((candidate) => candidate?.id === resolvedFolderId);
  return normalizeMediaFolderName(folder?.name) || UNFILED_MEDIA_FOLDER_NAME;
};

export const buildMediaFolderOptions = (folders = []) => ([
  {
    id: UNFILED_MEDIA_FOLDER_ID,
    name: UNFILED_MEDIA_FOLDER_NAME,
    isSystem: true,
  },
  ...sortMediaFolders(folders).map((folder) => ({
    ...folder,
    name: normalizeMediaFolderName(folder.name) || 'Untitled Folder',
    isSystem: false,
  })),
]);

export const buildMediaFolderBuckets = ({
  items = [],
  folders = [],
  folderField = 'folderId',
  bucketItemsKey = 'items',
} = {}) => {
  const options = buildMediaFolderOptions(folders);
  const bucketsById = new Map(options.map((folder) => [
    folder.id,
    {
      ...folder,
      [bucketItemsKey]: [],
    },
  ]));

  (items || []).forEach((item) => {
    const resolvedFolderId = getResolvedMediaFolderId(item, folders, folderField);
    const bucket = bucketsById.get(resolvedFolderId) || bucketsById.get(UNFILED_MEDIA_FOLDER_ID);
    bucket[bucketItemsKey].push(item);
  });

  return options.map((folder) => bucketsById.get(folder.id));
};
