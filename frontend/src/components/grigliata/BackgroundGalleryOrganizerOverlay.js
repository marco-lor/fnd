import React, { useMemo } from 'react';
import { isVideoBackground } from './boardUtils';
import MediaFolderOrganizerOverlay from './MediaFolderOrganizerOverlay';
import {
  buildGalleryFolderOptions,
  getResolvedGalleryFolderId,
  getWritableGalleryFolderId,
  UNFILED_GALLERY_FOLDER_ID,
} from './galleryFolders';

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
      getItemId={(background) => background?.id || ''}
      renderItem={({ item: background, itemId, moving, dragProps }) => {
        const isVideo = isVideoBackground(background);
        const resolvedFolderId = getResolvedGalleryFolderId(background, folders);
        const selectValue = getWritableGalleryFolderId(resolvedFolderId);

        return (
          <article
            key={itemId}
            data-testid={`gallery-organizer-map-${itemId}`}
            {...dragProps}
            className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-2"
          >
            <div className="h-16 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
              {background.imageUrl && (
                isVideo ? (
                  <video
                    src={background.imageUrl}
                    aria-label={background.name || 'Video map'}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={background.imageUrl}
                    alt={background.name || 'Map'}
                    className="h-full w-full object-cover"
                  />
                )
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">{background.name || 'Untitled Map'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {background.imageWidth || '?'} x {background.imageHeight || '?'} px{isVideo ? ' | Video' : ''}
              </p>
              <select
                aria-label={`Move ${background.name || 'Untitled Map'} to folder`}
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
