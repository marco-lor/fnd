import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { HiMagnifyingGlassPlus } from 'react-icons/hi2';
import { db, storage } from '../firebaseConfig';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  updateDoc
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

const MAX_NPC_IMAGE_BYTES = 5 * 1024 * 1024;
const HOVER_CARD_WIDTH = 344;
const HOVER_CARD_MIN_HEIGHT = 236;
const HOVER_GAP = 12;
const HOVER_VIEWPORT_PADDING = 8;
const HOVER_CLOSE_DELAY_MS = 120;
const SIDEBAR_BOTTOM_GAP = 8;
const SIDEBAR_FADE_HEIGHT = 56;

const normalizeNome = (value) => (typeof value === 'string' ? value.trim() : '');
const getNpcNome = (npc) => normalizeNome(npc?.nome) || 'NPC';

const parseStoragePathFromUrl = (url) => {
  if (!url || typeof url !== 'string') return '';
  try {
    const encoded = url.split('/o/')[1]?.split('?')[0];
    return encoded ? decodeURIComponent(encoded) : '';
  } catch {
    return '';
  }
};

const getNpcStoragePath = (npc) => npc?.imagePath || parseStoragePathFromUrl(npc?.imageUrl || '');

const computeHoverPosition = (anchorRect) => {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1366;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768;

  let direction = 'right';
  let left = anchorRect.right + HOVER_GAP;
  if (left + HOVER_CARD_WIDTH > viewportWidth - HOVER_VIEWPORT_PADDING) {
    direction = 'left';
    left = anchorRect.left - HOVER_GAP - HOVER_CARD_WIDTH;
  }

  left = Math.max(
    HOVER_VIEWPORT_PADDING,
    Math.min(left, viewportWidth - HOVER_CARD_WIDTH - HOVER_VIEWPORT_PADDING)
  );

  const preferredTop = anchorRect.top + (anchorRect.height / 2) - (HOVER_CARD_MIN_HEIGHT / 2);
  const top = Math.max(
    HOVER_VIEWPORT_PADDING,
    Math.min(preferredTop, viewportHeight - HOVER_CARD_MIN_HEIGHT - HOVER_VIEWPORT_PADDING)
  );

  return { left, top, direction };
};

const NpcTile = ({
  npc,
  isActive,
  isDimmed,
  onHoverStart,
  onHoverEnd,
  onTileEnter,
  canDragToMap,
  onNpcDragStart,
  onNpcDragEnd
}) => {
  const nome = getNpcNome(npc);
  const shortDescription = (npc?.description || '').trim().split('\n')[0] || 'NPC';
  const emphasisClasses = isActive
    ? 'opacity-100 -translate-y-0.5 border-amber-300/80 bg-slate-800/85 shadow-lg shadow-amber-400/20'
    : isDimmed
      ? 'opacity-60 border-slate-700/70 bg-slate-900/60'
      : 'opacity-100 border-slate-700/70 bg-slate-900/60 hover:border-slate-500/70';

  const handleDragStart = (event) => {
    if (!canDragToMap) return;

    const payload = {
      dragType: 'npc',
      scope: 'public',
      iconType: 'npc',
      npcId: npc.id,
      npcNome: nome
    };

    event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'copy';
    onNpcDragStart?.(payload);
  };

  const handleDragEnd = () => {
    onNpcDragEnd?.();
  };

  return (
    <div
      className={`rounded-lg border transform-gpu transition-all duration-300 ease-out motion-reduce:transition-none ${emphasisClasses}`}
    >
      <button
        type="button"
        draggable={canDragToMap}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onMouseEnter={(e) => {
          onTileEnter(npc.id);
          onHoverStart(npc, e.currentTarget);
        }}
        onMouseLeave={onHoverEnd}
        onFocus={(e) => {
          onTileEnter(npc.id);
          onHoverStart(npc, e.currentTarget);
        }}
        onBlur={onHoverEnd}
        className={`w-full px-2 py-2 flex items-center gap-2 text-left transition-opacity duration-300 ease-out motion-reduce:transition-none ${
          canDragToMap ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        <div className="w-14 h-14 rounded-lg overflow-hidden border border-amber-500/40 bg-slate-900/70 shadow-md shrink-0">
          {npc?.imageUrl ? (
            <img src={npc.imageUrl} alt={nome} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">No Img</div>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-200 truncate">{nome}</p>
          <p className="text-[11px] text-slate-400 truncate">{shortDescription}</p>
        </div>
      </button>
    </div>
  );
};

const NpcHoverPortal = ({
  open,
  npc,
  position,
  direction,
  canEditNpc,
  canDeleteNpc,
  isDeleting,
  onEdit,
  onDelete,
  onOpenImageZoom,
  onMouseEnter,
  onMouseLeave
}) => {
  const prefersReducedMotion = useReducedMotion();
  if (typeof document === 'undefined') return null;

  const hoverOffsetX = direction === 'left' ? 10 : -10;

  return createPortal(
    <AnimatePresence>
      {open && npc && position && (
        <motion.div
          key={`${npc.id}-${direction}`}
          className="fixed z-[140]"
          style={{ left: `${position.left}px`, top: `${position.top}px`, width: `${HOVER_CARD_WIDTH}px` }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          initial={prefersReducedMotion ? { opacity: 1, x: 0, y: 0, scale: 1 } : { opacity: 0, x: hoverOffsetX, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: hoverOffsetX * -0.5, y: 4, scale: 0.985 }}
          transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="rounded-xl border border-amber-400/50 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl p-4 max-h-[72vh] overflow-y-auto">
            <div className="flex items-start gap-3">
              <div className="group/portrait relative w-16 h-16 rounded-md overflow-hidden border border-slate-600/60 bg-slate-800/60 shrink-0">
                {npc?.imageUrl ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenImageZoom(npc)}
                      className="w-full h-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900"
                      aria-label={`Zoom image for ${getNpcNome(npc)}`}
                    >
                      <img src={npc.imageUrl} alt={`${getNpcNome(npc)} portrait`} className="w-full h-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenImageZoom(npc);
                      }}
                      className="absolute bottom-1 right-1 inline-flex items-center justify-center w-7 h-7 rounded-full border border-amber-300/60 bg-slate-900/80 text-amber-200 opacity-0 group-hover/portrait:opacity-100 group-focus-within/portrait:opacity-100 transition-opacity duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80"
                      aria-label="Zoom NPC image"
                    >
                      <HiMagnifyingGlassPlus className="text-sm" />
                    </button>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">No Img</div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[16px] text-amber-300 font-bold leading-tight break-words">{getNpcNome(npc)}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">
                  NPC | {direction === 'left' ? 'left' : 'right'}
                </p>
              </div>
            </div>

            <div className="mt-3 pt-2 border-t border-slate-700/60">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Description</p>
              <p className="text-[12px] text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                {(npc?.description || '').trim() || '-'}
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-slate-700/60">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Notes</p>
              <p className="text-[12px] text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                {(npc?.notes || '').trim() || '-'}
              </p>
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              {canEditNpc && (
                <button
                  type="button"
                  onClick={() => onEdit(npc)}
                  className="px-2 py-1 rounded-md border border-sky-400/50 text-sky-200 text-[11px] hover:bg-sky-500/10 transition-colors"
                >
                  Edit
                </button>
              )}
              {canDeleteNpc && (
                <button
                  type="button"
                  onClick={() => onDelete(npc)}
                  disabled={isDeleting}
                  className="px-2 py-1 rounded-md border border-red-400/50 text-red-200 text-[11px] hover:bg-red-500/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

const NpcImageZoomModal = ({ imageData, onClose }) => {
  const prefersReducedMotion = useReducedMotion();
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {imageData?.url && (
        <motion.div
          className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={imageData.nome ? `Zoomed image for ${imageData.nome}` : 'Zoomed NPC image'}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.2 }}
        >
          <motion.div
            className="relative max-w-[92vw] max-h-[88vh] rounded-xl border border-slate-500/60 bg-slate-950/95 shadow-2xl p-2"
            initial={prefersReducedMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={prefersReducedMotion ? { duration: 0.01 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute top-2 right-2 z-10 inline-flex items-center justify-center w-8 h-8 rounded-full border border-slate-300/50 bg-black/60 text-white text-lg leading-none hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              aria-label="Close zoomed NPC image"
            >
              X
            </button>
            <img
              src={imageData.url}
              alt={imageData.nome ? `${imageData.nome} portrait zoomed` : 'NPC portrait zoomed'}
              className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

const NpcCreateModal = ({
  open,
  onClose,
  onSubmit,
  createNome,
  setCreateNome,
  createDescription,
  setCreateDescription,
  createNotes,
  setCreateNotes,
  onImageChange,
  imagePreviewUrl,
  imageFileName,
  error,
  busy
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[110] p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-600 bg-slate-900 shadow-2xl p-5">
        <h3 className="text-xl font-semibold text-amber-300 mb-4">Add NPC</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-200 mb-1">Nome (required)</label>
            <input
              type="text"
              value={createNome}
              onChange={(e) => setCreateNome(e.target.value)}
              className="w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:border-amber-400"
              placeholder="Nome NPC..."
            />
          </div>

          <div>
            <label className="block text-sm text-slate-200 mb-1">Profile Picture (required)</label>
            <input
              type="file"
              accept="image/*"
              onChange={onImageChange}
              className="w-full text-sm text-slate-200"
            />
            {imageFileName && (
              <p className="text-[11px] text-slate-400 mt-1 truncate">{imageFileName}</p>
            )}
            {imagePreviewUrl && (
              <div className="mt-2 w-20 h-20 rounded-md overflow-hidden border border-slate-700/60 bg-slate-800/60">
                <img src={imagePreviewUrl} alt="NPC preview" className="w-full h-full object-cover" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-slate-200 mb-1">Description (required)</label>
            <textarea
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              className="w-full h-24 rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-white resize-none focus:outline-none focus:border-amber-400"
              placeholder="NPC description..."
            />
          </div>

          <div>
            <label className="block text-sm text-slate-200 mb-1">Notes (required)</label>
            <textarea
              value={createNotes}
              onChange={(e) => setCreateNotes(e.target.value)}
              className="w-full h-24 rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-white resize-none focus:outline-none focus:border-amber-400"
              placeholder="NPC notes..."
            />
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-900/20 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-slate-700 text-slate-100 hover:bg-slate-600 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-amber-500 text-black font-semibold hover:bg-amber-400 transition-colors disabled:opacity-60"
          >
            {busy ? 'Saving...' : 'Create NPC'}
          </button>
        </div>
      </div>
    </div>
  );
};

const NpcEditModal = ({
  open,
  onClose,
  onSubmit,
  canEditNpcImage,
  editNome,
  setEditNome,
  editDescription,
  setEditDescription,
  editNotes,
  setEditNotes,
  editImagePreviewUrl,
  editImageFileName,
  onEditImageChange,
  error,
  busy
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[110] p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-600 bg-slate-900 shadow-2xl p-5">
        <h3 className="text-xl font-semibold text-sky-300 mb-4">Edit NPC</h3>

        <div className="space-y-3">
          {canEditNpcImage && (
            <div>
              <label className="block text-sm text-slate-200 mb-1">Replace Profile Picture (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={onEditImageChange}
                className="w-full text-sm text-slate-200"
              />
              {editImageFileName && (
                <p className="text-[11px] text-slate-400 mt-1 truncate">{editImageFileName}</p>
              )}
              {editImagePreviewUrl && (
                <div className="mt-2 w-20 h-20 rounded-md overflow-hidden border border-slate-700/60 bg-slate-800/60">
                  <img src={editImagePreviewUrl} alt="NPC edit preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-200 mb-1">Nome (required)</label>
            <input
              type="text"
              value={editNome}
              onChange={(e) => setEditNome(e.target.value)}
              className="w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:border-sky-400"
              placeholder="Nome NPC..."
            />
          </div>

          <div>
            <label className="block text-sm text-slate-200 mb-1">Description (required)</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full h-24 rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-white resize-none focus:outline-none focus:border-sky-400"
              placeholder="NPC description..."
            />
          </div>

          <div>
            <label className="block text-sm text-slate-200 mb-1">Notes (required)</label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="w-full h-24 rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-white resize-none focus:outline-none focus:border-sky-400"
              placeholder="NPC notes..."
            />
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-900/20 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-slate-700 text-slate-100 hover:bg-slate-600 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-sky-500 text-black font-semibold hover:bg-sky-400 transition-colors disabled:opacity-60"
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default function NpcSidebar({
  user,
  userData,
  stickyOffset,
  onHoverStateChange,
  canDragToMap = false,
  onNpcDragStart,
  onNpcDragEnd
}) {
  const [npcs, setNpcs] = useState([]);
  const [npcLoading, setNpcLoading] = useState(true);
  const [npcError, setNpcError] = useState('');
  const [deletingNpcId, setDeletingNpcId] = useState('');

  const [showCreateNpcModal, setShowCreateNpcModal] = useState(false);
  const [showEditNpcModal, setShowEditNpcModal] = useState(false);
  const [editingNpc, setEditingNpc] = useState(null);

  const [createNome, setCreateNome] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [createImageFile, setCreateImageFile] = useState(null);
  const [createImagePreviewUrl, setCreateImagePreviewUrl] = useState('');
  const [createFormError, setCreateFormError] = useState('');
  const [isCreatingNpc, setIsCreatingNpc] = useState(false);

  const [editNome, setEditNome] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreviewUrl, setEditImagePreviewUrl] = useState('');
  const [editFormError, setEditFormError] = useState('');
  const [isSavingEditNpc, setIsSavingEditNpc] = useState(false);

  const [npcHover, setNpcHover] = useState(null);
  const [hoveredNpcId, setHoveredNpcId] = useState('');
  const [isListHovered, setIsListHovered] = useState(false);
  const [zoomedNpcImage, setZoomedNpcImage] = useState(null);
  const hoverCloseTimerRef = useRef(null);

  useEffect(() => {
    if (!user) {
      setNpcs([]);
      setNpcLoading(false);
      return () => {};
    }

    const npcQuery = query(collection(db, 'echi_npcs'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      npcQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }));
        setNpcs(rows);
        setNpcLoading(false);
      },
      (error) => {
        console.error('NPC snapshot error:', error);
        setNpcError('Unable to load NPC list.');
        setNpcLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    return () => {
      if (createImagePreviewUrl) {
        URL.revokeObjectURL(createImagePreviewUrl);
      }
    };
  }, [createImagePreviewUrl]);

  useEffect(() => {
    return () => {
      if (editImagePreviewUrl) {
        URL.revokeObjectURL(editImagePreviewUrl);
      }
    };
  }, [editImagePreviewUrl]);

  useEffect(() => {
    setNpcHover((prev) => {
      if (!prev?.npc?.id) return prev;
      const updatedNpc = npcs.find((n) => n.id === prev.npc.id);
      if (!updatedNpc) return null;
      return { ...prev, npc: updatedNpc };
    });
  }, [npcs]);

  useEffect(() => {
    return () => {
      if (hoverCloseTimerRef.current) {
        clearTimeout(hoverCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => () => onHoverStateChange?.(false), [onHoverStateChange]);

  useEffect(() => {
    if (!zoomedNpcImage) return undefined;
    const handleEscClose = (event) => {
      if (event.key === 'Escape') {
        setZoomedNpcImage(null);
      }
    };

    window.addEventListener('keydown', handleEscClose);
    return () => window.removeEventListener('keydown', handleEscClose);
  }, [zoomedNpcImage]);

  useEffect(() => {
    if (!npcHover?.anchorEl) return undefined;

    const updateHoverPosition = () => {
      const rect = npcHover.anchorEl.getBoundingClientRect();
      const { left, top, direction } = computeHoverPosition(rect);
      setNpcHover((prev) => {
        if (!prev) return prev;
        if (prev.anchorEl !== npcHover.anchorEl) return prev;
        return {
          ...prev,
          position: { left, top },
          direction
        };
      });
    };

    updateHoverPosition();
    window.addEventListener('resize', updateHoverPosition);
    window.addEventListener('scroll', updateHoverPosition, true);

    return () => {
      window.removeEventListener('resize', updateHoverPosition);
      window.removeEventListener('scroll', updateHoverPosition, true);
    };
  }, [npcHover?.anchorEl]);

  const role = (userData?.role || '').toLowerCase();

  const isDmOrWebmaster = role === 'dm' || role === 'webmaster';
  const canCreateNpc = isDmOrWebmaster;
  const canDeleteNpc = isDmOrWebmaster;
  const canEditNpc = !!user;
  const canEditNpcImage = isDmOrWebmaster;

  const sidebarTop = stickyOffset || 0;
  const sidebarOffset = `${sidebarTop + SIDEBAR_BOTTOM_GAP}px`;

  const setListHoverState = (nextState) => {
    setIsListHovered((prevState) => {
      if (prevState === nextState) return prevState;
      onHoverStateChange?.(nextState);
      return nextState;
    });
  };

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const closeNpcHover = () => {
    clearHoverCloseTimer();
    setNpcHover(null);
    setHoveredNpcId('');
  };

  const scheduleNpcHoverClose = () => {
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = setTimeout(() => {
      setNpcHover(null);
      setHoveredNpcId('');
      hoverCloseTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  };

  const openNpcHover = (npc, anchorEl) => {
    if (!npc || !anchorEl) return;

    clearHoverCloseTimer();
    setHoveredNpcId(npc.id);
    const anchorRect = anchorEl.getBoundingClientRect();
    const { left, top, direction } = computeHoverPosition(anchorRect);
    setNpcHover({
      npc,
      anchorEl,
      position: { left, top },
      direction
    });
  };

  const handleNpcListMouseEnter = () => {
    setListHoverState(true);
  };

  const handleNpcListMouseLeave = () => {
    setListHoverState(false);
    scheduleNpcHoverClose();
  };

  const handleNpcListFocusCapture = () => {
    setListHoverState(true);
  };

  const handleNpcListBlurCapture = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setListHoverState(false);
    scheduleNpcHoverClose();
  };

  const openNpcImageZoom = (npc) => {
    if (!npc?.imageUrl) return;
    setZoomedNpcImage({
      url: npc.imageUrl,
      nome: getNpcNome(npc)
    });
  };

  const closeNpcImageZoom = () => {
    setZoomedNpcImage(null);
  };

  const resetCreateNpcForm = () => {
    setCreateNome('');
    setCreateDescription('');
    setCreateNotes('');
    setCreateImageFile(null);
    setCreateFormError('');
    if (createImagePreviewUrl) {
      URL.revokeObjectURL(createImagePreviewUrl);
    }
    setCreateImagePreviewUrl('');
  };

  const closeCreateNpcModal = () => {
    if (isCreatingNpc) return;
    setShowCreateNpcModal(false);
    resetCreateNpcForm();
  };

  const closeEditNpcModal = () => {
    if (isSavingEditNpc) return;
    setShowEditNpcModal(false);
    setEditingNpc(null);
    setEditNome('');
    setEditDescription('');
    setEditNotes('');
    setEditImageFile(null);
    if (editImagePreviewUrl) {
      URL.revokeObjectURL(editImagePreviewUrl);
    }
    setEditImagePreviewUrl('');
    setEditFormError('');
  };

  const handleCreateImageChange = (e) => {
    const file = e.target.files?.[0] || null;
    setCreateImageFile(file);
    setCreateFormError('');

    if (createImagePreviewUrl) {
      URL.revokeObjectURL(createImagePreviewUrl);
    }
    setCreateImagePreviewUrl(file ? URL.createObjectURL(file) : '');
  };

  const handleEditImageChange = (e) => {
    const file = e.target.files?.[0] || null;
    setEditImageFile(file);
    setEditFormError('');

    if (editImagePreviewUrl) {
      URL.revokeObjectURL(editImagePreviewUrl);
    }
    setEditImagePreviewUrl(file ? URL.createObjectURL(file) : '');
  };

  const handleCreateNpc = async () => {
    if (!canCreateNpc || !user) return;
    setCreateFormError('');
    setNpcError('');

    const nome = normalizeNome(createNome);
    const description = (createDescription || '').trim();
    const notes = (createNotes || '').trim();

    if (!nome) {
      setCreateFormError('Nome is required.');
      return;
    }
    if (!createImageFile) {
      setCreateFormError('Profile picture is required.');
      return;
    }
    if (!createImageFile.type?.startsWith('image/')) {
      setCreateFormError('Selected file must be an image.');
      return;
    }
    if (createImageFile.size > MAX_NPC_IMAGE_BYTES) {
      setCreateFormError('Image must be 5 MB or smaller.');
      return;
    }
    if (!description) {
      setCreateFormError('Description is required.');
      return;
    }
    if (!notes) {
      setCreateFormError('Notes are required.');
      return;
    }

    const fileExt = createImageFile.name?.includes('.') ? createImageFile.name.split('.').pop() : '';
    const safeExt = fileExt ? `.${fileExt.replace(/[^a-zA-Z0-9]/g, '')}` : '';
    const safeNome = nome.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'npc';
    const path = `echi_npcs/${user.uid}/${safeNome}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
    const imageRef = storageRef(storage, path);
    let uploaded = false;

    setIsCreatingNpc(true);
    try {
      await uploadBytes(imageRef, createImageFile);
      uploaded = true;
      const imageUrl = await getDownloadURL(imageRef);

      await addDoc(collection(db, 'echi_npcs'), {
        nome,
        imageUrl,
        imagePath: path,
        description,
        notes,
        createdBy: user.uid,
        createdByRole: role || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setShowCreateNpcModal(false);
      resetCreateNpcForm();
    } catch (error) {
      console.error('Create NPC failed:', error);
      setCreateFormError('Failed to create NPC.');

      if (uploaded) {
        try {
          await deleteObject(imageRef);
        } catch (cleanupError) {
          console.warn('Create rollback image deletion failed:', cleanupError);
        }
      }
    } finally {
      setIsCreatingNpc(false);
    }
  };

  const handleOpenNpcEdit = (npc) => {
    if (!canEditNpc || !npc) return;
    closeNpcHover();
    setEditingNpc(npc);
    setEditNome(getNpcNome(npc));
    setEditDescription(npc.description || '');
    setEditNotes(npc.notes || '');
    setEditImageFile(null);
    if (editImagePreviewUrl) {
      URL.revokeObjectURL(editImagePreviewUrl);
    }
    setEditImagePreviewUrl('');
    setEditFormError('');
    setShowEditNpcModal(true);
  };

  const handleSaveNpcEdit = async () => {
    if (!editingNpc?.id || !canEditNpc) return;
    setEditFormError('');
    setNpcError('');

    const nome = normalizeNome(editNome);
    const description = (editDescription || '').trim();
    const notes = (editNotes || '').trim();

    if (!nome) {
      setEditFormError('Nome is required.');
      return;
    }
    if (!description) {
      setEditFormError('Description is required.');
      return;
    }
    if (!notes) {
      setEditFormError('Notes are required.');
      return;
    }

    const isReplacingImage = canEditNpcImage && !!editImageFile;
    if (isReplacingImage) {
      if (!editImageFile.type?.startsWith('image/')) {
        setEditFormError('Selected file must be an image.');
        return;
      }
      if (editImageFile.size > MAX_NPC_IMAGE_BYTES) {
        setEditFormError('Image must be 5 MB or smaller.');
        return;
      }
    }

    setIsSavingEditNpc(true);
    let uploadedNewPath = '';
    try {
      const payload = {
        nome,
        description,
        notes,
        updatedAt: serverTimestamp()
      };

      if (isReplacingImage) {
        const fileExt = editImageFile.name?.includes('.') ? editImageFile.name.split('.').pop() : '';
        const safeExt = fileExt ? `.${fileExt.replace(/[^a-zA-Z0-9]/g, '')}` : '';
        const safeNome = nome.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'npc';
        uploadedNewPath = `echi_npcs/${user?.uid || 'unknown'}/${safeNome}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
        const imageRef = storageRef(storage, uploadedNewPath);
        await uploadBytes(imageRef, editImageFile);
        const imageUrl = await getDownloadURL(imageRef);
        payload.imageUrl = imageUrl;
        payload.imagePath = uploadedNewPath;
      }

      await updateDoc(doc(db, 'echi_npcs', editingNpc.id), payload);

      if (isReplacingImage) {
        const oldPath = getNpcStoragePath(editingNpc);
        if (oldPath && oldPath !== uploadedNewPath) {
          try {
            await deleteObject(storageRef(storage, oldPath));
          } catch (cleanupError) {
            console.warn('Old NPC image deletion failed after replacement:', cleanupError);
            setNpcError('NPC image updated, but old image cleanup failed.');
          }
        }
      }

      closeEditNpcModal();
    } catch (error) {
      console.error('Edit NPC failed:', error);
      if (uploadedNewPath) {
        try {
          await deleteObject(storageRef(storage, uploadedNewPath));
        } catch (rollbackError) {
          console.warn('Rollback deletion failed for newly uploaded NPC image:', rollbackError);
        }
      }
      setEditFormError('Failed to save NPC changes.');
    } finally {
      setIsSavingEditNpc(false);
    }
  };

  const handleDeleteNpc = async (npc) => {
    if (!canDeleteNpc || !npc?.id) return;
    setNpcError('');

    const confirmed = window.confirm(`Delete NPC "${getNpcNome(npc)}" and its image permanently?`);
    if (!confirmed) return;
    closeNpcHover();

    const path = getNpcStoragePath(npc);
    if (!path) {
      setNpcError('Cannot delete NPC image: missing storage path.');
      return;
    }

    setDeletingNpcId(npc.id);
    try {
      await deleteObject(storageRef(storage, path));
    } catch (error) {
      console.error('Delete NPC image failed:', error);
      setNpcError('Image deletion failed. NPC document was not deleted.');
      setDeletingNpcId('');
      return;
    }

    try {
      const linkedMarkersQuery = query(
        collection(db, 'map_markers'),
        where('npcId', '==', npc.id)
      );
      const linkedMarkersSnapshot = await getDocs(linkedMarkersQuery);

      if (!linkedMarkersSnapshot.empty) {
        const batch = writeBatch(db);
        linkedMarkersSnapshot.forEach((markerDoc) => {
          batch.delete(markerDoc.ref);
        });
        await batch.commit();
      }
    } catch (error) {
      console.error('Delete linked NPC markers failed after image deletion:', error);
      setNpcError('NPC image deleted, but linked map marker cleanup failed. NPC document was not deleted.');
      setDeletingNpcId('');
      return;
    }

    try {
      await deleteDoc(doc(db, 'echi_npcs', npc.id));
    } catch (error) {
      console.error('Delete NPC document failed after image deletion:', error);
      setNpcError('Image and linked map markers deleted, but NPC document deletion failed.');
    } finally {
      setDeletingNpcId('');
    }
  };

  return (
    <div className="self-stretch">
      <aside
        className="z-40 h-auto lg:sticky lg:h-[calc(100vh-var(--npc-offset))]"
        style={{ top: sidebarTop, '--npc-offset': sidebarOffset }}
      >
        <div className="bg-slate-900/85 border border-slate-700 rounded-2xl shadow-2xl backdrop-blur-sm flex flex-col overflow-hidden h-full">
          <div className="px-4 py-3 border-b border-slate-700/70 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-wide text-amber-300 uppercase">NPC</h2>
            {canCreateNpc && (
              <button
                type="button"
                onClick={() => {
                  setCreateFormError('');
                  setNpcError('');
                  setShowCreateNpcModal(true);
                }}
                className="px-2 py-1 rounded-md border border-amber-400/50 text-amber-200 text-xs hover:bg-amber-500/10 transition-colors"
              >
                + Add NPC
              </button>
            )}
          </div>

          {npcError && (
            <div className="mx-3 mt-3 text-xs text-red-300 bg-red-900/20 border border-red-500/30 rounded-md px-2 py-2">
              {npcError}
            </div>
          )}

          <div className="relative p-3 flex-1 min-h-0">
            <div
              className={`h-full overflow-y-auto overflow-x-hidden pr-2 pb-10 transition-opacity duration-300 ease-out motion-reduce:transition-none ${
                isListHovered ? 'opacity-100' : 'opacity-95'
              }`}
              onMouseEnter={handleNpcListMouseEnter}
              onMouseLeave={handleNpcListMouseLeave}
              onFocusCapture={handleNpcListFocusCapture}
              onBlurCapture={handleNpcListBlurCapture}
            >
              {npcLoading ? (
                <p className="text-sm text-slate-300">Loading NPCs...</p>
              ) : npcs.length === 0 ? (
                <p className="text-sm text-slate-400">No NPCs yet.</p>
              ) : (
                <div className="space-y-2">
                  {npcs.map((npc) => (
                    <NpcTile
                      key={npc.id}
                      npc={npc}
                      isActive={hoveredNpcId === npc.id}
                      isDimmed={!!hoveredNpcId && hoveredNpcId !== npc.id}
                      onHoverStart={openNpcHover}
                      onHoverEnd={scheduleNpcHoverClose}
                      onTileEnter={setHoveredNpcId}
                      canDragToMap={canDragToMap}
                      onNpcDragStart={onNpcDragStart}
                      onNpcDragEnd={onNpcDragEnd}
                    />
                  ))}
                </div>
              )}
            </div>
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-slate-900/95 via-slate-900/55 to-transparent"
              style={{ height: `${SIDEBAR_FADE_HEIGHT}px` }}
            ></div>
          </div>
        </div>
      </aside>

      <NpcCreateModal
        open={showCreateNpcModal}
        onClose={closeCreateNpcModal}
        onSubmit={handleCreateNpc}
        createNome={createNome}
        setCreateNome={setCreateNome}
        createDescription={createDescription}
        setCreateDescription={setCreateDescription}
        createNotes={createNotes}
        setCreateNotes={setCreateNotes}
        onImageChange={handleCreateImageChange}
        imagePreviewUrl={createImagePreviewUrl}
        imageFileName={createImageFile?.name || ''}
        error={createFormError}
        busy={isCreatingNpc}
      />

      <NpcEditModal
        open={showEditNpcModal}
        onClose={closeEditNpcModal}
        onSubmit={handleSaveNpcEdit}
        canEditNpcImage={canEditNpcImage}
        editNome={editNome}
        setEditNome={setEditNome}
        editDescription={editDescription}
        setEditDescription={setEditDescription}
        editNotes={editNotes}
        setEditNotes={setEditNotes}
        editImagePreviewUrl={editImagePreviewUrl}
        editImageFileName={editImageFile?.name || ''}
        onEditImageChange={handleEditImageChange}
        error={editFormError}
        busy={isSavingEditNpc}
      />

      <NpcHoverPortal
        open={!!npcHover}
        npc={npcHover?.npc || null}
        position={npcHover?.position || null}
        direction={npcHover?.direction || 'right'}
        canEditNpc={canEditNpc}
        canDeleteNpc={canDeleteNpc}
        isDeleting={deletingNpcId === npcHover?.npc?.id}
        onEdit={handleOpenNpcEdit}
        onDelete={handleDeleteNpc}
        onOpenImageZoom={openNpcImageZoom}
        onMouseEnter={clearHoverCloseTimer}
        onMouseLeave={scheduleNpcHoverClose}
      />

      <NpcImageZoomModal imageData={zoomedNpcImage} onClose={closeNpcImageZoom} />
    </div>
  );
}
