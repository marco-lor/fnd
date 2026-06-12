import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiFilter, FiFolder, FiGrid, FiLayers, FiLoader, FiMaximize2, FiPlay, FiRadio, FiTrash2, FiUploadCloud, FiUserMinus, FiX, FiXCircle, FiZap } from 'react-icons/fi';
import { isVideoBackground } from './boardUtils';
import BackgroundGalleryOrganizerOverlay from './BackgroundGalleryOrganizerOverlay';
import MediaFolderFilterButton from './MediaFolderFilterButton';
import {
  buildGalleryFolderOptions,
  getGalleryFolderDisplayName,
  getResolvedGalleryFolderId,
  getWritableGalleryFolderId,
  UNFILED_GALLERY_FOLDER_ID,
} from './galleryFolders';

const GALLERY_ACTION_BASE_CLASS_NAME = 'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const GALLERY_ACTION_ICON_CLASS_NAME = 'h-4 w-4';

const getGalleryActionClassName = (toneClassName) => (
  `${GALLERY_ACTION_BASE_CLASS_NAME} ${toneClassName}`
);

export default function BackgroundGalleryPanel({
  backgrounds,
  galleryFolders = [],
  activeBackgroundId,
  presentationBackgroundId,
  presentationBackgroundIds = [],
  selectedBackgroundId,
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
  selectedFolderId = UNFILED_GALLERY_FOLDER_ID,
  isUseBackgroundDisabled,
  destructiveActionLockedBackgroundIds = [],
  onSelectedFolderIdChange,
  onUploadBackgroundFiles,
  onSelectBackground,
  onUseBackground,
  onNarrateBackground,
  onCloseNarration,
  onAddNarrationBackground,
  onRemoveNarrationBackground,
  onClearTokensForBackground,
  onDeleteBackground,
  onCalibrateBackground,
  onCreateGalleryFolder,
  onRenameGalleryFolder,
  onDeleteGalleryFolder,
  onMoveBackgroundToFolder,
  onDeleteBackgrounds,
}) {
  const destructiveActionLockedBackgroundIdSet = new Set(destructiveActionLockedBackgroundIds);
  const presentationBackgroundIdSet = useMemo(() => (
    new Set([
      ...(Array.isArray(presentationBackgroundIds) ? presentationBackgroundIds : []),
      ...(presentationBackgroundId ? [presentationBackgroundId] : []),
    ])
  ), [presentationBackgroundId, presentationBackgroundIds]);
  const isNarrationSceneActive = presentationBackgroundIdSet.size > 0;
  const [isOrganizerOpen, setIsOrganizerOpen] = useState(false);
  const [folderMenuBackgroundId, setFolderMenuBackgroundId] = useState('');
  const [previewBackground, setPreviewBackground] = useState(null);
  const uploadFileInputRef = useRef(null);
  const folderOptions = useMemo(() => (
    buildGalleryFolderOptions(galleryFolders)
  ), [galleryFolders]);
  const previewBackgroundName = previewBackground?.name || 'Untitled Map';
  const isPreviewVideo = previewBackground ? isVideoBackground(previewBackground) : false;
  const handleUploadFileInputChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      onUploadBackgroundFiles?.(files);
    }

    event.target.value = '';
  };
  const previewOverlay = previewBackground && typeof document !== 'undefined' ? createPortal(
    <div
      data-testid="background-gallery-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="background-gallery-preview-title"
      tabIndex={-1}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/78 p-3 text-slate-100 backdrop-blur-sm sm:p-5"
      onClick={() => setPreviewBackground(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setPreviewBackground(null);
        }
      }}
    >
      <div
        className="relative z-10 flex h-[min(54rem,calc(100vh-2rem))] w-[min(86rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-700/90 bg-slate-950/96 shadow-2xl shadow-black/60 ring-1 ring-sky-200/10 backdrop-blur-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <h3
            id="background-gallery-preview-title"
            className="min-w-0 truncate text-sm font-semibold uppercase tracking-[0.18em] text-sky-300"
          >
            Preview {previewBackgroundName}
          </h3>
          <button
            type="button"
            aria-label="Close preview"
            title="Close preview"
            onClick={() => setPreviewBackground(null)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-3">
          {isPreviewVideo ? (
            <video
              src={previewBackground.imageUrl}
              aria-label={`${previewBackgroundName} preview`}
              className="max-h-full max-w-full rounded-lg object-contain"
              controls
              muted
              playsInline
            />
          ) : (
            <img
              src={previewBackground.imageUrl}
              alt={`${previewBackgroundName} preview`}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-950/75 backdrop-blur-sm shadow-2xl overflow-hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">DM Gallery</h2>
      </div>

      <div className="p-3 space-y-3 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
            <input
              ref={uploadFileInputRef}
              type="file"
              accept="image/*,video/mp4"
              multiple
              onChange={handleUploadFileInputChange}
              className="hidden"
              tabIndex={-1}
            />

            <MediaFolderFilterButton
              folders={galleryFolders}
              selectedFolderId={selectedFolderId}
              onSelectedFolderIdChange={onSelectedFolderIdChange}
              buttonLabel="Filter DM Gallery by folder"
              listboxLabel="Filter DM Gallery by folder options"
              tone="sky"
              onBeforeOpen={() => setFolderMenuBackgroundId('')}
              LeadingIcon={FiFilter}
              size="compact"
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              aria-label={isUploading ? 'Uploading background files' : 'Upload background files'}
              aria-busy={isUploading ? 'true' : undefined}
              title={isUploading ? 'Uploading background files' : 'Upload background files'}
              onClick={() => uploadFileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sky-500 text-black transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? (
                <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <FiUploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              aria-label="Organize DM Gallery"
              title="Organize DM Gallery"
              onClick={() => setIsOrganizerOpen(true)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-sky-500/40 text-sky-200 transition-colors hover:bg-sky-500/10"
            >
              <FiFolder className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {uploadError && (
            <div className="border-b border-red-500/20 bg-red-900/15 px-3 py-2 text-xs text-red-200">
              {uploadError}
            </div>
          )}

          <div
            data-testid="background-gallery-scroll-list"
            className="max-h-[26rem] overflow-y-auto custom-scroll divide-y divide-slate-800 xl:max-h-none xl:min-h-0 xl:flex-1"
          >
            {backgrounds.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-400">
                No maps in this folder.
              </div>
            ) : (
              backgrounds.map((background) => {
                const isActive = background.id === activeBackgroundId;
                const isPrimaryNarration = background.id === presentationBackgroundId;
                const isIncludedInNarration = presentationBackgroundIdSet.has(background.id);
                const isSelected = background.id === selectedBackgroundId;
                const isVideo = isVideoBackground(background);
                const isUsePending = activatingBackgroundId === background.id;
                const isNarrationPending = narrationActionBackgroundId === background.id;
                const isDestructiveActionLocked = destructiveActionLockedBackgroundIdSet.has(background.id);
                const isBusy = isUsePending || isNarrationPending || deletingBackgroundId === background.id || clearingTokensBackgroundId === background.id;
                const hasLightingMetadata = !!background.lightingSummary;
                const backgroundName = background.name || 'Untitled Map';
                const narrationActionLabel = isPrimaryNarration
                  ? `Close narration for ${backgroundName}`
                  : (isIncludedInNarration ? `Remove ${backgroundName} from narration` : `Narrate ${backgroundName}`);
                const narrationPendingTitle = isPrimaryNarration && isNarrationClosePending
                  ? `Closing narration for ${backgroundName}`
                  : (isIncludedInNarration ? `Removing ${backgroundName} from narration` : `Narrating ${backgroundName}`);
                const multiNarrationActionLabel = `Add ${backgroundName} to multi narration`;
                const multiNarrationPendingTitle = `Adding ${backgroundName} to multi narration`;
                const shouldShowMultiNarrationAction = isNarrationSceneActive && !isIncludedInNarration && !isActive;
                const narrationBadgeLabel = isPrimaryNarration ? 'Narration' : 'Multi';
                const handleNarrationAction = () => {
                  if (isPrimaryNarration) {
                    onCloseNarration?.(background);
                    return;
                  }

                  if (isIncludedInNarration) {
                    onRemoveNarrationBackground?.(background);
                    return;
                  }

                  onNarrateBackground?.(background);
                };

                return (
                  <div
                    key={background.id}
                    data-testid={`background-gallery-row-${background.id}`}
                    className={`px-3 py-3 transition-colors ${
                      isSelected ? 'bg-slate-800/70' : 'bg-transparent'
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="group/thumbnail relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
                        <button
                          type="button"
                          aria-label={`Select ${backgroundName}`}
                          onClick={() => onSelectBackground(background.id)}
                          className="block h-full w-full"
                        >
                          {background.imageUrl ? (
                            isVideo ? (
                              <video
                                src={background.imageUrl}
                                aria-label={backgroundName}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                              />
                            ) : (
                              <img src={background.imageUrl} alt={backgroundName} className="w-full h-full object-cover" />
                            )
                          ) : null}
                        </button>
                        {background.imageUrl && (
                          <button
                            type="button"
                            aria-label={`Preview ${backgroundName}`}
                            title={`Preview ${backgroundName}`}
                            onClick={() => setPreviewBackground(background)}
                            className="absolute inset-0 flex items-center justify-center bg-slate-950/55 text-sky-100 opacity-0 transition-opacity pointer-events-none group-hover/thumbnail:pointer-events-auto group-hover/thumbnail:opacity-100 focus:pointer-events-auto focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80"
                          >
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-black/45 shadow-lg shadow-black/40">
                              <FiMaximize2 className="h-4 w-4" aria-hidden="true" />
                            </span>
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onSelectBackground(background.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-100 truncate">{backgroundName}</p>
                            {isActive && (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                                Active
                              </span>
                            )}
                            {isIncludedInNarration && (
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                                {narrationBadgeLabel}
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
                      </button>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          aria-label={`Move ${backgroundName} to folder`}
                          title={`Move ${backgroundName} to folder`}
                          onClick={() => setFolderMenuBackgroundId((currentId) => (
                            currentId === background.id ? '' : background.id
                          ))}
                          disabled={movingBackgroundFolderId === background.id}
                          className={getGalleryActionClassName('border-sky-500/40 text-sky-200 hover:bg-sky-500/10')}
                        >
                          <FiFolder className={GALLERY_ACTION_ICON_CLASS_NAME} aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          aria-label={`Use ${backgroundName}`}
                          title={isUsePending ? `Using ${backgroundName}` : `Use ${backgroundName}`}
                          aria-busy={isUsePending ? true : undefined}
                          onClick={() => onUseBackground(background)}
                          disabled={isBusy || isNarrationActionPending || isUseBackgroundDisabled || isActive}
                          className={getGalleryActionClassName('border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10')}
                        >
                          <FiPlay className={GALLERY_ACTION_ICON_CLASS_NAME} aria-hidden="true" />
                        </button>

                        {(!isActive || isIncludedInNarration) && (
                          <button
                            type="button"
                            aria-label={narrationActionLabel}
                            title={isNarrationPending ? narrationPendingTitle : narrationActionLabel}
                            aria-busy={isNarrationPending ? true : undefined}
                            onClick={handleNarrationAction}
                            disabled={isBusy || isNarrationActionPending}
                            className={getGalleryActionClassName('border-amber-500/40 text-amber-200 hover:bg-amber-500/10')}
                          >
                            {isPrimaryNarration || isIncludedInNarration ? (
                              <FiXCircle className={GALLERY_ACTION_ICON_CLASS_NAME} aria-hidden="true" />
                            ) : (
                              <FiRadio className={GALLERY_ACTION_ICON_CLASS_NAME} aria-hidden="true" />
                            )}
                          </button>
                        )}

                        {shouldShowMultiNarrationAction && (
                          <button
                            type="button"
                            aria-label={multiNarrationActionLabel}
                            title={isNarrationPending ? multiNarrationPendingTitle : multiNarrationActionLabel}
                            aria-busy={isNarrationPending ? true : undefined}
                            onClick={() => onAddNarrationBackground?.(background)}
                            disabled={isBusy || isNarrationActionPending}
                            className={getGalleryActionClassName('border-violet-500/40 text-violet-200 hover:bg-violet-500/10')}
                          >
                            <FiLayers className={GALLERY_ACTION_ICON_CLASS_NAME} aria-hidden="true" />
                          </button>
                        )}

                        <button
                          type="button"
                          aria-label={`Calibrate ${backgroundName} grid`}
                          title={`Calibrate ${backgroundName} grid`}
                          onClick={() => {
                            onSelectBackground(background.id);
                            onCalibrateBackground?.(background.id);
                          }}
                          className={getGalleryActionClassName('border-sky-500/40 text-sky-200 hover:bg-sky-500/10')}
                        >
                          <FiGrid className={GALLERY_ACTION_ICON_CLASS_NAME} aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          aria-label={`Clear tokens from ${backgroundName}`}
                          title={clearingTokensBackgroundId === background.id ? `Clearing tokens from ${backgroundName}` : `Clear tokens from ${backgroundName}`}
                          aria-busy={clearingTokensBackgroundId === background.id ? true : undefined}
                          onClick={() => onClearTokensForBackground(background)}
                          disabled={clearingTokensBackgroundId === background.id || deletingBackgroundId === background.id || isNarrationActionPending || isDestructiveActionLocked}
                          className={getGalleryActionClassName('border-amber-500/40 text-amber-200 hover:bg-amber-500/10')}
                        >
                          <FiUserMinus className={GALLERY_ACTION_ICON_CLASS_NAME} aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          aria-label={`Delete ${backgroundName}`}
                          title={deletingBackgroundId === background.id ? `Deleting ${backgroundName}` : `Delete ${backgroundName}`}
                          aria-busy={deletingBackgroundId === background.id ? true : undefined}
                          onClick={() => onDeleteBackground(background)}
                          disabled={deletingBackgroundId === background.id || clearingTokensBackgroundId === background.id || isNarrationActionPending || isDestructiveActionLocked}
                          className={getGalleryActionClassName('border-red-500/40 text-red-200 hover:bg-red-500/10')}
                        >
                          <FiTrash2 className={GALLERY_ACTION_ICON_CLASS_NAME} aria-hidden="true" />
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
        selectedFolderId={selectedFolderId}
        folderMutationId={folderMutationId}
        movingBackgroundFolderId={movingBackgroundFolderId}
        onClose={() => setIsOrganizerOpen(false)}
        onSelectedFolderIdChange={onSelectedFolderIdChange}
        onCreateFolder={onCreateGalleryFolder}
        onRenameFolder={onRenameGalleryFolder}
        onDeleteFolder={onDeleteGalleryFolder}
        onMoveBackgroundToFolder={onMoveBackgroundToFolder}
        onDeleteBackground={onDeleteBackground}
        onDeleteBackgrounds={onDeleteBackgrounds}
      />

      {previewOverlay}
    </section>
  );
}
