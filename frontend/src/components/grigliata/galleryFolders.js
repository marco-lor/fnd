import {
  buildMediaFolderBuckets,
  buildMediaFolderOptions,
  buildNormalizedMediaFolderName,
  getMediaFolderDisplayName,
  getResolvedMediaFolderId,
  getWritableMediaFolderId,
  hasDuplicateMediaFolderName,
  isReservedMediaFolderName,
  normalizeMediaFolderName,
  sortMediaFolders,
  UNFILED_MEDIA_FOLDER_ID,
  UNFILED_MEDIA_FOLDER_NAME,
} from './mediaFolders';

export const GRIGLIATA_GALLERY_FOLDERS_COLLECTION = 'grigliata_gallery_folders';
export const UNFILED_GALLERY_FOLDER_ID = UNFILED_MEDIA_FOLDER_ID;
export const UNFILED_GALLERY_FOLDER_NAME = UNFILED_MEDIA_FOLDER_NAME;

export const normalizeGalleryFolderName = normalizeMediaFolderName;
export const buildNormalizedGalleryFolderName = buildNormalizedMediaFolderName;
export const isReservedGalleryFolderName = isReservedMediaFolderName;
export const sortGalleryFolders = sortMediaFolders;
export const hasDuplicateGalleryFolderName = hasDuplicateMediaFolderName;
export const getWritableGalleryFolderId = getWritableMediaFolderId;
export const buildGalleryFolderOptions = buildMediaFolderOptions;

export const getResolvedGalleryFolderId = (background = {}, folders = []) => {
  return getResolvedMediaFolderId(background, folders, 'galleryFolderId');
};

export const getGalleryFolderDisplayName = (background = {}, folders = []) => {
  return getMediaFolderDisplayName(background, folders, 'galleryFolderId');
};

export const buildGalleryFolderBuckets = ({ backgrounds = [], folders = [] } = {}) => {
  return buildMediaFolderBuckets({
    items: backgrounds,
    folders,
    folderField: 'galleryFolderId',
    bucketItemsKey: 'backgrounds',
  });
};
