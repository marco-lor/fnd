import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiCheck, FiChevronDown, FiFolder, FiZap } from 'react-icons/fi';
import { isVideoBackground } from './boardUtils';
import BackgroundGalleryOrganizerOverlay from './BackgroundGalleryOrganizerOverlay';
import {
  buildGalleryFolderOptions,
  getGalleryFolderDisplayName,
  getResolvedGalleryFolderId,
  getWritableGalleryFolderId,
} from './galleryFolders';

const ALL_GALLERY_FOLDER_FILTER_ID = '__all__';

export default function BackgroundGalleryPanel({
  backgrounds,
  galleryFolders = [],
  activeBackgroundId,
  presentationBackgroundId,
  selectedBackgroundId,
  uploadName,
  selectedFileName,
  uploadError,
  isUploading,
  activatingBackgroundId,
  narrationActionBackgroundId,
  isNarrationActionPending,
  isNarrationClosePending,
  deletingBackgroundId,
  clearingTokensBackgroundId,
  folderMutationId = '',
  movingBackgroundFolderId = '',
  isUseBackgroundDisabled,
  destructiveActionLockedBackgroundIds = [],
  onUploadNameChange,
  onUploadFileChange,
  onUploadBackground,
  onSelectBackground,
  onUseBackground,
  onNarrateBackground,
  onCloseNarration,
  onClearTokensForBackground,
  onDeleteBackground,
  onCalibrateBackground,
  onCreateGalleryFolder,
  onRenameGalleryFolder,
  onDeleteGalleryFolder,
  onMoveBackgroundToFolder,
}) {
  const destructiveActionLockedBackgroundIdSet = new Set(destructiveActionLockedBackgroundIds);
  const [isOrganizerOpen, setIsOrganizerOpen] = useState(false);
  const [folderMenuBackgroundId, setFolderMenuBackgroundId] = useState('');
  const [selectedFolderFilterId, setSelectedFolderFilterId] = useState(ALL_GALLERY_FOLDER_FILTER_ID);
  const [isFolderFilterOpen, setIsFolderFilterOpen] = useState(false);
  const folderFilterRef = useRef(null);
  const folderOptions = useMemo(() => (
    buildGalleryFolderOptions(galleryFolders)
  ), [galleryFolders]);
  const filterOptions = useMemo(() => ([
    {
      id: ALL_GALLERY_FOLDER_FILTER_ID,
      name: 'All folders',
    },
    ...folderOptions,
  ]), [folderOptions]);
  const validFilterIds = useMemo(() => (
    new Set(filterOptions.map((folder) => folder.id))
  ), [filterOptions]);
  const selectedFolderFilter = useMemo(() => (
    filterOptions.find((folder) => folder.id === selectedFolderFilterId) || filterOptions[0]
  ), [filterOptions, selectedFolderFilterId]);
  const filteredBackgrounds = useMemo(() => {
    if (selectedFolderFilterId === ALL_GALLERY_FOLDER_FILTER_ID || !validFilterIds.has(selectedFolderFilterId)) {
      return backgrounds;
    }

    return backgrounds.filter((background) => (
      getResolvedGalleryFolderId(background, galleryFolders) === selectedFolderFilterId
    ));
  }, [backgrounds, galleryFolders, selectedFolderFilterId, validFilterIds]);

  useEffect(() => {
    if (!validFilterIds.has(selectedFolderFilterId)) {
      setSelectedFolderFilterId(ALL_GALLERY_FOLDER_FILTER_ID);
    }
  }, [selectedFolderFilterId, validFilterIds]);

  useEffect(() => {
    if (!isFolderFilterOpen) {
      return undefined;
    }

    const handleDocumentMouseDown = (event) => {
      if (!folderFilterRef.current || folderFilterRef.current.contains(event.target)) {
        return;
      }

      setIsFolderFilterOpen(false);
    };

    const handleDocumentKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsFolderFilterOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    document.addEventListener('keydown', handleDocumentKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isFolderFilterOpen]);

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-950/75 backdrop-blur-sm shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">DM Gallery</h2>
      </div>

      <div className="p-4 space-y-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Upload Background</p>
          <div className="mt-3 space-y-3">
            <input
              type="text"
              value={uploadName}
              onChange={(event) => onUploadNameChange(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
              placeholder="Display name for this map"
            />

            <input
              type="file"
              accept="image/*,video/mp4"
              onChange={onUploadFileChange}
              className="block w-full text-sm text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-200 hover:file:bg-slate-700"
            />

            {selectedFileName && (
              <p className="text-xs text-slate-400 truncate">{selectedFileName}</p>
            )}

            {uploadError && (
              <div className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">
                {uploadError}
              </div>
            )}

            <button
              type="button"
              onClick={onUploadBackground}
              disabled={isUploading}
              className="w-full rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? 'Uploading...' : 'Add To Gallery'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70">
          <div className="space-y-3 px-3 py-3 border-b border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Available Maps</p>
              <button
                type="button"
                aria-label="Organize DM Gallery"
                onClick={() => setIsOrganizerOpen(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-sky-500/40 px-2.5 py-1.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/10"
              >
                <FiFolder className="h-3.5 w-3.5" aria-hidden="true" />
                Organize
              </button>
            </div>

            <div ref={folderFilterRef} className="relative">
              <button
                type="button"
                aria-label="Filter DM Gallery by folder"
                aria-haspopup="listbox"
                aria-expanded={isFolderFilterOpen}
                aria-controls="dm-gallery-folder-filter-options"
                onClick={() => {
                  setIsFolderFilterOpen((currentValue) => !currentValue);
                  setFolderMenuBackgroundId('');
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  isFolderFilterOpen
                    ? 'border-sky-400/70 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.22)]'
                    : 'border-slate-700 bg-slate-950/70 hover:border-sky-500/50 hover:bg-slate-900/80'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FiFolder className="h-4 w-4 shrink-0 text-sky-200" aria-hidden="true" />
                  <span className="truncate text-xs font-semibold text-slate-100">
                    {selectedFolderFilter?.name || 'All folders'}
                  </span>
                </span>
                <FiChevronDown
                  className={`h-4 w-4 shrink-0 text-slate-300 transition-transform ${
                    isFolderFilterOpen ? 'rotate-180 text-sky-200' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>

              {isFolderFilterOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-sky-500/35 bg-slate-950 shadow-2xl shadow-black/60">
                  <div
                    id="dm-gallery-folder-filter-options"
                    role="listbox"
                    aria-label="Filter DM Gallery by folder options"
                    className="max-h-52 overflow-y-auto custom-scroll bg-slate-950 p-1"
                  >
                    {filterOptions.map((folder) => {
                      const isSelectedFilter = selectedFolderFilterId === folder.id;

                      return (
                        <button
                          key={folder.id}
                          type="button"
                          role="option"
                          aria-selected={isSelectedFilter}
                          onClick={() => {
                            setSelectedFolderFilterId(folder.id);
                            setFolderMenuBackgroundId('');
                            setIsFolderFilterOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                            isSelectedFilter
                              ? 'bg-sky-500/20 text-sky-100'
                              : 'text-slate-200 hover:bg-slate-800/85 hover:text-white'
                          }`}
                        >
                          <FiFolder className="h-3.5 w-3.5 shrink-0 text-sky-200/80" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                          {isSelectedFilter && (
                            <FiCheck className="h-3.5 w-3.5 shrink-0 text-sky-200" aria-hidden="true" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="max-h-[26rem] overflow-y-auto custom-scroll divide-y divide-slate-800">
            {backgrounds.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-400">
                No backgrounds uploaded yet.
              </div>
            ) : filteredBackgrounds.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-400">
                No maps in this folder.
              </div>
            ) : (
              filteredBackgrounds.map((background) => {
                const isActive = background.id === activeBackgroundId;
                const isNarrated = background.id === presentationBackgroundId;
                const isSelected = background.id === selectedBackgroundId;
                const isVideo = isVideoBackground(background);
                const isUsePending = activatingBackgroundId === background.id;
                const isNarrationPending = narrationActionBackgroundId === background.id;
                const isDestructiveActionLocked = destructiveActionLockedBackgroundIdSet.has(background.id);
                const isBusy = isUsePending || isNarrationPending || deletingBackgroundId === background.id || clearingTokensBackgroundId === background.id;
                const hasLightingMetadata = !!background.lightingSummary;

                return (
                  <div
                    key={background.id}
                    data-testid={`background-gallery-row-${background.id}`}
                    className={`px-3 py-3 transition-colors ${
                      isSelected ? 'bg-slate-800/70' : 'bg-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectBackground(background.id)}
                      className="w-full text-left"
                    >
                      <div className="flex gap-3">
                        <div className="w-20 h-14 rounded-lg overflow-hidden border border-slate-700 bg-slate-950 shrink-0">
                          {background.imageUrl ? (
                            isVideo ? (
                              <video
                                src={background.imageUrl}
                                aria-label={background.name || 'Video map'}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                              />
                            ) : (
                              <img src={background.imageUrl} alt={background.name} className="w-full h-full object-cover" />
                            )
                          ) : null}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-100 truncate">{background.name || 'Untitled Map'}</p>
                            {isActive && (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                                Active
                              </span>
                            )}
                            {isNarrated && (
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                                Narration
                              </span>
                            )}
                            {hasLightingMetadata && (
                              <span
                                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-300/50 bg-cyan-500/15 text-cyan-200"
                                title="Lighting metadata imported"
                                aria-label="Lighting metadata imported"
                              >
                                <FiZap aria-hidden="true" className="h-3 w-3" />
                              </span>
                            )}
                          </div>

                          <p className="mt-1 text-xs text-slate-400">
                            {background.imageWidth || '?'} x {background.imageHeight || '?'} px{isVideo ? ' | Video' : ''}
                          </p>
                          <p className="mt-1 text-[11px] font-medium text-sky-200/80">
                            Folder: {getGalleryFolderDisplayName(background, galleryFolders)}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Grid {background.grid?.cellSizePx || 70}px | offset {background.grid?.offsetXPx || 0}, {background.grid?.offsetYPx || 0}
                          </p>
                        </div>
                      </div>
                    </button>

                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          aria-label={`Move ${background.name || 'Untitled Map'} to folder`}
                          onClick={() => setFolderMenuBackgroundId((currentId) => (
                            currentId === background.id ? '' : background.id
                          ))}
                          disabled={movingBackgroundFolderId === background.id}
                          className="inline-flex items-center gap-2 rounded-md border border-sky-500/40 px-3 py-1.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <FiFolder className="h-3.5 w-3.5" aria-hidden="true" />
                          Folder
                        </button>


                        <button
                          type="button"
                          onClick={() => onUseBackground(background)}
                          disabled={isBusy || isNarrationActionPending || isUseBackgroundDisabled || isActive}
                          className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isUsePending ? 'Using...' : 'Use'}
                        </button>

                        {(!isActive || isNarrated) && (
                          <button
                            type="button"
                            onClick={() => (
                              isNarrated
                                ? onCloseNarration?.(background)
                                : onNarrateBackground?.(background)
                            )}
                            disabled={isBusy || isNarrationActionPending}
                            className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isNarrationPending
                              ? (isNarrated && isNarrationClosePending ? 'Closing...' : 'Narrating...')
                              : (isNarrated ? 'Close narration' : 'Narrate')}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            onSelectBackground(background.id);
                            onCalibrateBackground?.(background.id);
                          }}
                          className="rounded-md border border-sky-500/40 px-3 py-1.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/10"
                        >
                          Calibrate
                        </button>

                        <button
                          type="button"
                          onClick={() => onClearTokensForBackground(background)}
                          disabled={clearingTokensBackgroundId === background.id || deletingBackgroundId === background.id || isNarrationActionPending || isDestructiveActionLocked}
                          className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {clearingTokensBackgroundId === background.id ? 'Clearing...' : 'Clear Tokens'}
                        </button>

                        <button
                          type="button"
                          onClick={() => onDeleteBackground(background)}
                          disabled={deletingBackgroundId === background.id || clearingTokensBackgroundId === background.id || isNarrationActionPending || isDestructiveActionLocked}
                          className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingBackgroundId === background.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>

                      {folderMenuBackgroundId === background.id && (
                        <div className="rounded-lg border border-slate-700 bg-slate-950/90 p-1.5 shadow-inner shadow-black/30">
                          <div className="grid grid-cols-1 gap-1">
                            {folderOptions.map((folder) => {
                              const targetFolderId = getWritableGalleryFolderId(folder.id);
                              const isCurrentFolder = getResolvedGalleryFolderId(background, galleryFolders) === folder.id;

                              return (
                                <button
                                  key={folder.id}
                                  type="button"
                                  onClick={() => {
                                    onMoveBackgroundToFolder?.(background.id, targetFolderId);
                                    setFolderMenuBackgroundId('');
                                  }}
                                  disabled={isCurrentFolder || movingBackgroundFolderId === background.id}
                                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
                                >
                                  <span className="truncate">Move to {folder.name}</span>
                                  {isCurrentFolder && (
                                    <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-sky-300">Current</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <BackgroundGalleryOrganizerOverlay
        isOpen={isOrganizerOpen}
        backgrounds={backgrounds}
        folders={galleryFolders}
        folderMutationId={folderMutationId}
        movingBackgroundFolderId={movingBackgroundFolderId}
        onClose={() => setIsOrganizerOpen(false)}
        onCreateFolder={onCreateGalleryFolder}
        onRenameFolder={onRenameGalleryFolder}
        onDeleteFolder={onDeleteGalleryFolder}
        onMoveBackgroundToFolder={onMoveBackgroundToFolder}
      />
    </section>
  );
}
