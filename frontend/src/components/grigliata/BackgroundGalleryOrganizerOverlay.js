import React, { useMemo } from 'react';
import { FiTrash2 } from 'react-icons/fi';
import { isVideoBackground } from './boardUtils';
import MediaImage, { resolveMediaAsset } from '../common/MediaImage';
import MediaFolderOrganizerOverlay from './MediaFolderOrganizerOverlay';
import {
  buildGalleryFolderOptions,
  getResolvedGalleryFolderId,
  getWritableGalleryFolderId,
  UNFILED_GALLERY_FOLDER_ID,
} from './galleryFolders';

const isRecord = (value) => (
  value != null && typeof value === 'object' && !Array.isArray(value)
);

const getBackgroundMediaManifest = (background) => {
  if (isRecord(background?.media)) return background.media;
  if (isRecord(background?.General?.media)) return background.General.media;
  return {};
};

const isVideoGalleryBackground = (background, manifest) => (
  isVideoBackground(background)
  || manifest.kind === 'map-video'
  || manifest.original?.contentType === 'video/mp4'
);

const buildVideoPosterMedia = (manifest) => {
  const poster = isRecord(manifest.variants)
    ? manifest.variants.poster
    : null;
  return {
    media: {
      schemaVersion: manifest.schemaVersion,
      state: manifest.state,
      variants: poster ? { poster } : {},
    },
  };
};

const buildOrganizerThumbnail = (background) => {
  const manifest = getBackgroundMediaManifest(background);
  const isVideo = isVideoGalleryBackground(background, manifest);
  const media = isVideo ? buildVideoPosterMedia(manifest) : background;
  const src = isVideo ? '' : (background?.imageUrl || '');
  const variant = isVideo ? 'poster' : 'thumbnail';
  return {
    asset: resolveMediaAsset(media, { fallbackSrc: src, variant }),
    isVideo,
    media,
    src,
    variant,
  };
};

export default function BackgroundGalleryOrganizerOverlay({
  isOpen = false,
  backgrounds = [],
  folders = [],
  selectedFolderId = UNFILED_GALLERY_FOLDER_ID,
  folderMutationId = '',
  movingBackgroundFolderId = '',
  onClose,
  onSelectedFolderIdChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveBackgroundToFolder,
  onDeleteBackground,
  onDeleteBackgrounds,
}) {
  const folderOptions = useMemo(() => buildGalleryFolderOptions(folders), [folders]);

  return (
    <MediaFolderOrganizerOverlay
      isOpen={isOpen}
      title="Organize DM Gallery"
      subtitle="Move maps between shared folders without changing the uploaded files."
      folders={folders}
      items={backgrounds}
      selectedFolderId={selectedFolderId}
      itemNounSingular="map"
      itemNounPlural="maps"
      emptyMessage="Drop maps here or use a row folder control to move maps into this folder."
      folderMutationId={folderMutationId}
      movingItemId={movingBackgroundFolderId}
      tone="sky"
      onClose={onClose}
      onSelectedFolderIdChange={onSelectedFolderIdChange}
      onCreateFolder={onCreateFolder}
      onRenameFolder={onRenameFolder}
      onDeleteFolder={onDeleteFolder}
      onMoveItemToFolder={onMoveBackgroundToFolder}
      onDeleteSelectedItems={onDeleteBackgrounds}
      getItemId={(background) => background?.id || ''}
      isItemSelectionEnabled
      renderItem={({ item: background, itemId, moving, dragProps, isSelectionEnabled, isSelected, onSelectedChange }) => {
        const {
          asset: thumbnailAsset,
          isVideo,
          media: thumbnailMedia,
          src: thumbnailSrc,
          variant: thumbnailVariant,
        } = buildOrganizerThumbnail(background);
        const resolvedFolderId = getResolvedGalleryFolderId(background, folders);
        const selectValue = getWritableGalleryFolderId(resolvedFolderId);
        const backgroundName = background.name || 'Untitled Map';

        return (
          <article
            key={itemId}
            data-testid={`gallery-organizer-map-${itemId}`}
            {...dragProps}
            className={`grid grid-cols-[auto_5rem_minmax(0,1fr)] gap-3 rounded-xl border p-2 transition-colors ${
              isSelected
                ? 'border-sky-400/60 bg-sky-500/10'
                : 'border-slate-800 bg-slate-900/60'
            }`}
          >
            {isSelectionEnabled && (
              <label className="flex items-start pt-1">
                <input
                  type="checkbox"
                  aria-label={`Select ${backgroundName}`}
                  checked={isSelected}
                  onChange={onSelectedChange}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-sky-400"
                />
              </label>
            )}
            <div className="h-16 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
              {thumbnailAsset.candidates.length > 0 && (
                <MediaImage
                  media={thumbnailMedia}
                  src={thumbnailSrc}
                  variant={thumbnailVariant}
                  alt={backgroundName}
                  width={80}
                  height={64}
                  sizes="80px"
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold text-slate-100">{backgroundName}</p>
                <button
                  type="button"
                  aria-label={`Delete ${backgroundName} map`}
                  onClick={() => onDeleteBackground?.(background)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-500/40 text-red-200 transition-colors hover:bg-red-500/10"
                >
                  <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {background.imageWidth || '?'} x {background.imageHeight || '?'} px{isVideo ? ' | Video' : ''}
              </p>
              <select
                aria-label={`Move ${backgroundName} to folder`}
                value={selectValue}
                onChange={(event) => onMoveBackgroundToFolder?.(itemId, event.target.value)}
                disabled={moving}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {folderOptions.map((folder) => (
                  <option
                    key={folder.id}
                    value={getWritableGalleryFolderId(folder.id)}
                  >
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>
          </article>
        );
      }}
    />
  );
}
