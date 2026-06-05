import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FiCheck,
  FiEdit2,
  FiFolder,
  FiFolderPlus,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import { isVideoBackground } from './boardUtils';
import {
  buildGalleryFolderBuckets,
  buildGalleryFolderOptions,
  getResolvedGalleryFolderId,
  getWritableGalleryFolderId,
  normalizeGalleryFolderName,
  UNFILED_GALLERY_FOLDER_ID,
} from './galleryFolders';

const folderCountLabel = (count) => `${count} ${count === 1 ? 'map' : 'maps'}`;

export default function BackgroundGalleryOrganizerOverlay({
  isOpen = false,
  backgrounds = [],
  folders = [],
  folderMutationId = '',
  movingBackgroundFolderId = '',
  onClose,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveBackgroundToFolder,
}) {
  const [selectedFolderId, setSelectedFolderId] = useState(UNFILED_GALLERY_FOLDER_ID);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState('');
  const [renameDraft, setRenameDraft] = useState('');

  const buckets = useMemo(
    () => buildGalleryFolderBuckets({ backgrounds, folders }),
    [backgrounds, folders]
  );
  const folderOptions = useMemo(() => buildGalleryFolderOptions(folders), [folders]);
  const selectedBucket = buckets.find((bucket) => bucket.id === selectedFolderId) || buckets[0];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!buckets.some((bucket) => bucket.id === selectedFolderId)) {
      setSelectedFolderId(UNFILED_GALLERY_FOLDER_ID);
    }
  }, [buckets, isOpen, selectedFolderId]);

  if (!isOpen) {
    return null;
  }

  const handleCreateFolder = (event) => {
    event.preventDefault();
    const nextName = normalizeGalleryFolderName(newFolderName);
    if (!nextName) {
      return;
    }

    onCreateFolder?.(nextName);
    setNewFolderName('');
  };

  const handleStartRename = (folder) => {
    setEditingFolderId(folder.id);
    setRenameDraft(normalizeGalleryFolderName(folder.name));
  };

  const handleSaveRename = (folder) => {
    const nextName = normalizeGalleryFolderName(renameDraft);
    if (!nextName) {
      return;
    }

    onRenameFolder?.(folder.id, nextName);
    setEditingFolderId('');
    setRenameDraft('');
  };

  const handleDropBackground = (event, folderId) => {
    event.preventDefault();
    const backgroundId = event.dataTransfer?.getData('text/plain') || '';
    if (!backgroundId) {
      return;
    }

    onMoveBackgroundToFolder?.(backgroundId, getWritableGalleryFolderId(folderId));
  };

  const overlay = (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-3 text-slate-100 sm:p-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          data-testid="gallery-organizer-backdrop"
          className="absolute inset-0 bg-slate-950/78 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />

        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Organize DM Gallery"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose?.();
            }
          }}
          className="relative z-10 flex h-[min(46rem,calc(100vh-2rem))] w-[min(68rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-700/90 bg-slate-950/96 shadow-2xl shadow-black/60 ring-1 ring-sky-200/10 backdrop-blur-md"
          initial={{ opacity: 0, scale: 0.98, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 12 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
                Organize DM Gallery
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Move maps between shared folders without changing the uploaded files.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close organizer"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <FiX className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-[19rem_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b border-slate-800 bg-slate-950/70 md:border-b-0 md:border-r">
              <form onSubmit={handleCreateFolder} className="border-b border-slate-800 p-3">
                <label htmlFor="gallery-new-folder-name" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  New Folder
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="gallery-new-folder-name"
                    aria-label="New folder name"
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
                    placeholder="Folder name"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-500 px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-sky-400"
                  >
                    <FiFolderPlus className="h-4 w-4" aria-hidden="true" />
                    Create Folder
                  </button>
                </div>
              </form>

              <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scroll">
                {buckets.map((bucket) => {
                  const isSelected = bucket.id === selectedBucket?.id;
                  const isEditing = editingFolderId === bucket.id;
                  const isMutating = folderMutationId === bucket.id;

                  return (
                    <div
                      key={bucket.id}
                      data-testid={`gallery-folder-drop-${bucket.id}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => handleDropBackground(event, bucket.id)}
                      className={`mb-2 rounded-xl border p-2 transition-colors ${
                        isSelected
                          ? 'border-sky-400/50 bg-sky-500/10'
                          : 'border-slate-800 bg-slate-900/45 hover:border-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedFolderId(bucket.id)}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-sky-200">
                          <FiFolder className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-100">{bucket.name}</span>
                          <span className="block text-xs text-slate-500">{folderCountLabel(bucket.backgrounds.length)}</span>
                        </span>
                      </button>

                      {!bucket.isSystem && (
                        <div className="mt-2">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <input
                                aria-label={`Rename ${bucket.name}`}
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
                              />
                              <button
                                type="button"
                                aria-label={`Save ${bucket.name}`}
                                onClick={() => handleSaveRename(bucket)}
                                disabled={isMutating}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <FiCheck className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                aria-label={`Rename ${bucket.name}`}
                                onClick={() => handleStartRename(bucket)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                              >
                                <FiEdit2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${bucket.name}`}
                                onClick={() => onDeleteFolder?.(bucket)}
                                disabled={isMutating}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 text-red-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>

            <section className="flex min-h-0 flex-col">
              <div className="border-b border-slate-800 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {selectedBucket?.name || 'Unfiled'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {folderCountLabel(selectedBucket?.backgrounds.length || 0)}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scroll">
                {!selectedBucket?.backgrounds.length ? (
                  <div className="flex h-full min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/35 px-4 text-center text-sm text-slate-400">
                    Drop maps here or use a row folder control to move maps into this folder.
                  </div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {selectedBucket.backgrounds.map((background) => {
                      const isVideo = isVideoBackground(background);
                      const resolvedFolderId = getResolvedGalleryFolderId(background, folders);
                      const selectValue = getWritableGalleryFolderId(resolvedFolderId);
                      const isMoving = movingBackgroundFolderId === background.id;

                      return (
                        <article
                          key={background.id}
                          data-testid={`gallery-organizer-map-${background.id}`}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', background.id);
                          }}
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
                              onChange={(event) => onMoveBackgroundToFolder?.(background.id, event.target.value)}
                              disabled={isMoving}
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
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  if (typeof document === 'undefined') {
    return overlay;
  }

  return createPortal(overlay, document.body);
}
