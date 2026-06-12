import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCheck, FiEdit2, FiFolder, FiFolderPlus, FiTrash2, FiX } from 'react-icons/fi';
import {
  buildMediaFolderOptions,
  getWritableMediaFolderId,
  normalizeMediaFolderName,
  UNFILED_MEDIA_FOLDER_ID,
} from './mediaFolders';

const TONE_CLASS_NAMES = {
  sky: {
    heading: 'text-sky-300',
    selectedFolder: 'border-sky-400/50 bg-sky-500/10',
    folderIcon: 'text-sky-200',
    createButton: 'border-sky-400/40 bg-sky-500 text-black hover:bg-sky-400',
    ring: 'ring-sky-200/10',
  },
  violet: {
    heading: 'text-violet-300',
    selectedFolder: 'border-violet-400/50 bg-violet-500/10',
    folderIcon: 'text-violet-200',
    createButton: 'border-violet-400/40 bg-violet-500 text-white hover:bg-violet-400',
    ring: 'ring-violet-200/10',
  },
};

export default function MediaFolderOrganizerOverlay({
  isOpen = false,
  title,
  subtitle,
  folders = [],
  items = [],
  selectedFolderId = UNFILED_MEDIA_FOLDER_ID,
  itemNounSingular = 'item',
  itemNounPlural = 'items',
  emptyMessage,
  folderMutationId = '',
  movingItemId = '',
  tone = 'sky',
  onClose,
  onSelectedFolderIdChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveItemToFolder,
  onDeleteSelectedItems,
  getItemId = (item) => item?.id || '',
  isItemSelectionEnabled = false,
  renderItem,
}) {
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [bulkMoveFolderId, setBulkMoveFolderId] = useState(getWritableMediaFolderId(selectedFolderId));
  const toneClassNames = TONE_CLASS_NAMES[tone] || TONE_CLASS_NAMES.sky;
  const folderOptions = useMemo(() => buildMediaFolderOptions(folders), [folders]);
  const selectedFolder = folderOptions.find((folder) => folder.id === selectedFolderId) || folderOptions[0];
  const itemEntries = useMemo(() => (
    items
      .map((item) => ({ item, itemId: getItemId(item) }))
      .filter(({ itemId }) => !!itemId)
  ), [getItemId, items]);
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const selectedItems = itemEntries
    .filter(({ itemId }) => selectedItemIdSet.has(itemId))
    .map(({ item }) => item);
  const isAllItemsSelected = itemEntries.length > 0 && itemEntries.every(({ itemId }) => selectedItemIdSet.has(itemId));
  const hasSelectedItems = selectedItemIds.length > 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!folderOptions.some((folder) => folder.id === selectedFolderId)) {
      onSelectedFolderIdChange?.(UNFILED_MEDIA_FOLDER_ID);
    }
  }, [folderOptions, isOpen, onSelectedFolderIdChange, selectedFolderId]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedItemIds([]);
      return;
    }

    const availableItemIds = new Set(itemEntries.map(({ itemId }) => itemId));
    setSelectedItemIds((currentIds) => currentIds.filter((itemId) => availableItemIds.has(itemId)));
  }, [isOpen, itemEntries]);

  useEffect(() => {
    setBulkMoveFolderId(getWritableMediaFolderId(selectedFolder?.id || selectedFolderId));
  }, [selectedFolder?.id, selectedFolderId]);

  if (!isOpen) {
    return null;
  }

  const handleCreateFolder = (event) => {
    event.preventDefault();
    const nextName = normalizeMediaFolderName(newFolderName);
    if (!nextName) {
      return;
    }

    onCreateFolder?.(nextName);
    setNewFolderName('');
  };

  const handleStartRename = (folder) => {
    setEditingFolderId(folder.id);
    setRenameDraft(normalizeMediaFolderName(folder.name));
  };

  const handleSaveRename = (folder) => {
    const nextName = normalizeMediaFolderName(renameDraft);
    if (!nextName) {
      return;
    }

    onRenameFolder?.(folder.id, nextName);
    setEditingFolderId('');
    setRenameDraft('');
  };

  const handleDropItem = (event, folderId) => {
    event.preventDefault();
    const itemId = event.dataTransfer?.getData('text/plain') || '';
    if (!itemId) {
      return;
    }

    onMoveItemToFolder?.(itemId, getWritableMediaFolderId(folderId));
  };

  const handleToggleSelectedItem = (itemId) => {
    setSelectedItemIds((currentIds) => (
      currentIds.includes(itemId)
        ? currentIds.filter((selectedItemId) => selectedItemId !== itemId)
        : [...currentIds, itemId]
    ));
  };

  const handleToggleAllItems = () => {
    setSelectedItemIds(isAllItemsSelected ? [] : itemEntries.map(({ itemId }) => itemId));
  };

  const handleMoveSelectedItems = () => {
    if (!hasSelectedItems) {
      return;
    }

    const targetFolderId = getWritableMediaFolderId(bulkMoveFolderId);
    selectedItemIds.forEach((itemId) => {
      onMoveItemToFolder?.(itemId, targetFolderId);
    });
    setSelectedItemIds([]);
  };

  const handleDeleteSelectedItems = () => {
    if (!hasSelectedItems) {
      return;
    }

    onDeleteSelectedItems?.(selectedItems);
    setSelectedItemIds([]);
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
          aria-label={title}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose?.();
            }
          }}
          className={`relative z-10 flex h-[min(46rem,calc(100vh-2rem))] w-[min(68rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-700/90 bg-slate-950/96 shadow-2xl shadow-black/60 ring-1 ${toneClassNames.ring} backdrop-blur-md`}
          initial={{ opacity: 0, scale: 0.98, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 12 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
            <div className="min-w-0">
              <h2 className={`text-sm font-semibold uppercase tracking-[0.18em] ${toneClassNames.heading}`}>
                {title}
              </h2>
              {subtitle && (
                <p className="mt-1 text-xs text-slate-400">
                  {subtitle}
                </p>
              )}
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
                <label htmlFor={`${title.replace(/\s+/g, '-').toLowerCase()}-new-folder-name`} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  New Folder
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id={`${title.replace(/\s+/g, '-').toLowerCase()}-new-folder-name`}
                    aria-label="New folder name"
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
                    placeholder="Folder name"
                  />
                  <button
                    type="submit"
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${toneClassNames.createButton}`}
                  >
                    <FiFolderPlus className="h-4 w-4" aria-hidden="true" />
                    Create Folder
                  </button>
                </div>
              </form>

              <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scroll">
                {folderOptions.map((folder) => {
                  const isSelected = folder.id === selectedFolder?.id;
                  const isEditing = editingFolderId === folder.id;
                  const isMutating = folderMutationId === folder.id;

                  return (
                    <div
                      key={folder.id}
                      data-testid={`gallery-folder-drop-${folder.id}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => handleDropItem(event, folder.id)}
                      className={`mb-2 rounded-xl border p-2 transition-colors ${
                        isSelected
                          ? toneClassNames.selectedFolder
                          : 'border-slate-800 bg-slate-900/45 hover:border-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        aria-label={`Open folder ${folder.name}`}
                        onClick={() => onSelectedFolderIdChange?.(folder.id)}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 ${toneClassNames.folderIcon}`}>
                          <FiFolder className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-100">{folder.name}</span>
                          <span className="block text-xs text-slate-500">Folder</span>
                        </span>
                      </button>

                      {!folder.isSystem && (
                        <div className="mt-2">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <input
                                aria-label={`Rename ${folder.name}`}
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
                              />
                              <button
                                type="button"
                                aria-label={`Save ${folder.name}`}
                                onClick={() => handleSaveRename(folder)}
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
                                aria-label={`Rename ${folder.name}`}
                                onClick={() => handleStartRename(folder)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                              >
                                <FiEdit2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${folder.name}`}
                                onClick={() => onDeleteFolder?.(folder)}
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
                  {selectedFolder?.name || 'Unfiled'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Showing the selected folder's loaded {itemNounPlural}.
                </p>
              </div>

              {isItemSelectionEnabled && !!items.length && (
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/70 px-4 py-3">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-2 text-xs font-semibold text-slate-200">
                    <input
                      type="checkbox"
                      aria-label={`Select all ${itemNounPlural}`}
                      checked={isAllItemsSelected}
                      onChange={handleToggleAllItems}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-sky-400"
                    />
                    Select all
                  </label>
                  <span className="text-xs text-slate-400">
                    {selectedItemIds.length} selected
                  </span>
                  <select
                    aria-label={`Move selected ${itemNounPlural} to folder`}
                    value={bulkMoveFolderId}
                    onChange={(event) => setBulkMoveFolderId(event.target.value)}
                    disabled={!hasSelectedItems}
                    className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-sky-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {folderOptions.map((folder) => (
                      <option
                        key={folder.id}
                        value={getWritableMediaFolderId(folder.id)}
                      >
                        {folder.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleMoveSelectedItems}
                    disabled={!hasSelectedItems}
                    className="rounded-lg border border-sky-400/40 bg-sky-500 px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Move selected {itemNounPlural}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedItems}
                    disabled={!hasSelectedItems || !onDeleteSelectedItems}
                    className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete selected {itemNounPlural}
                  </button>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scroll">
                {!items.length ? (
                  <div className="flex h-full min-h-[12rem] items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/35 px-4 text-center text-sm text-slate-400">
                    {emptyMessage}
                  </div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {itemEntries.map(({ item, itemId }) => {
                      return renderItem?.({
                        item,
                        itemId,
                        folderOptions,
                        moving: movingItemId === itemId,
                        isSelectionEnabled: isItemSelectionEnabled,
                        isSelected: selectedItemIdSet.has(itemId),
                        onSelectedChange: () => handleToggleSelectedItem(itemId),
                        itemNounSingular,
                        dragProps: {
                          draggable: true,
                          onDragStart: (event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', itemId);
                          },
                        },
                      });
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
