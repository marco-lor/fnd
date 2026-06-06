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

export const GRIGLIATA_MUSIC_FOLDERS_COLLECTION = 'grigliata_music_folders';
export const UNFILED_MUSIC_FOLDER_ID = UNFILED_MEDIA_FOLDER_ID;
export const UNFILED_MUSIC_FOLDER_NAME = UNFILED_MEDIA_FOLDER_NAME;

export const normalizeMusicFolderName = normalizeMediaFolderName;
export const buildNormalizedMusicFolderName = buildNormalizedMediaFolderName;
export const isReservedMusicFolderName = isReservedMediaFolderName;
export const sortMusicFolders = sortMediaFolders;
export const hasDuplicateMusicFolderName = hasDuplicateMediaFolderName;
export const getWritableMusicFolderId = getWritableMediaFolderId;
export const buildMusicFolderOptions = buildMediaFolderOptions;

export const getResolvedMusicFolderId = (track = {}, folders = []) => (
  getResolvedMediaFolderId(track, folders, 'musicFolderId')
);

export const getMusicFolderDisplayName = (track = {}, folders = []) => (
  getMediaFolderDisplayName(track, folders, 'musicFolderId')
);

export const buildMusicFolderBuckets = ({ tracks = [], folders = [] } = {}) => (
  buildMediaFolderBuckets({
    items: tracks,
    folders,
    folderField: 'musicFolderId',
    bucketItemsKey: 'tracks',
  })
);
