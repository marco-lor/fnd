// file: ./frontend/src/components/echiDiViaggio/EchiDiViaggio.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../AuthContext';
import mappaArt from '../../assets/images/maps/mappa_art.png';
import mappaPrecisa from '../../assets/images/maps/mappa_precisa.png';
import GlobalAuroraBackground from '../backgrounds/GlobalAuroraBackground';
import { db, storage } from '../firebaseConfig';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { useMapEditing, MapEditorControls, MapMarkerModal, renderMarkerIcon } from './MapEditor';

const MAX_NPC_IMAGE_BYTES = 5 * 1024 * 1024;
const HOVER_CARD_WIDTH = 320;
const HOVER_CARD_MIN_HEIGHT = 220;
const HOVER_GAP = 12;
const HOVER_VIEWPORT_PADDING = 8;
const HOVER_CLOSE_DELAY_MS = 120;
const SIDEBAR_BOTTOM_GAP = 8;

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

const MapMarkerItem = ({ marker, editMode, canEdit, onDelete, scopeLabel, markerColor }) => {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    setIsDeleting(true);
  };

  const handleCancelDelete = (e) => {
    e.stopPropagation();
    setIsDeleting(false);
  };

  const handleConfirmDelete = (e) => {
    e.stopPropagation();
    onDelete(e, marker.id);
  };

  return (
    <div
      className="absolute w-8 h-8 -ml-4 -mt-4 z-20 group/marker"
      style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
    >
      <div className="w-full h-full cursor-pointer hover:scale-125 transition-transform duration-200 relative">
        {renderMarkerIcon(marker.iconType, markerColor)}
        {scopeLabel === 'private' && (
          <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 rounded-full bg-purple-600 text-white font-semibold shadow whitespace-nowrap z-40">
            Privato
          </span>
        )}
      </div>

      {editMode && canEdit && (
        <>
          <button
            onClick={isDeleting ? handleCancelDelete : handleDeleteClick}
            className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-700 z-30 shadow-md border border-white/20 transition-all duration-200 ${
              isDeleting ? 'translate-x-6 opacity-100' : 'opacity-0 group-hover/marker:opacity-100'
            }`}
            title={isDeleting ? 'Annulla' : 'Elimina'}
          >
            X
          </button>

          <button
            onClick={handleConfirmDelete}
            className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-green-600 z-30 shadow-md border border-white/20 transition-all duration-200 ${
              isDeleting ? 'opacity-100 scale-100' : 'opacity-0 scale-0 pointer-events-none'
            }`}
            title="Conferma"
          >
            V
          </button>
        </>
      )}

      <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 transition-opacity duration-300 pointer-events-none z-30 ${isDeleting ? 'opacity-0' : 'opacity-0 group-hover/marker:opacity-100'}`}>
        <div className="bg-black/90 text-white p-3 rounded-lg border shadow-xl text-sm font-serif leading-relaxed relative" style={{ borderColor: markerColor }}>
          {marker.text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-black/90"></div>
        </div>
      </div>
    </div>
  );
};

const NpcTile = ({ npc, isActive, onHoverStart, onHoverEnd }) => {
  const nome = getNpcNome(npc);
  const shortDescription = (npc?.description || '').trim().split('\n')[0] || 'NPC';

  return (
    <div className={`rounded-lg border transition-colors ${isActive ? 'border-amber-300/70 bg-slate-800/80' : 'border-slate-700/70 bg-slate-900/60 hover:border-slate-500/70'}`}>
      <button
        type="button"
        onMouseEnter={(e) => onHoverStart(npc, e.currentTarget)}
        onMouseLeave={onHoverEnd}
        onFocus={(e) => onHoverStart(npc, e.currentTarget)}
        onBlur={onHoverEnd}
        className="w-full px-2 py-2 flex items-center gap-2 text-left"
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
  onMouseEnter,
  onMouseLeave
}) => {
  if (!open || !npc || !position) return null;

  const nome = getNpcNome(npc);
  const description = (npc?.description || '').trim();
  const notes = (npc?.notes || '').trim();
  const sideLabel = direction === 'left' ? 'left' : 'right';

  return createPortal(
    <div
      className="fixed z-[140]"
      style={{ left: `${position.left}px`, top: `${position.top}px`, width: `${HOVER_CARD_WIDTH}px` }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="rounded-xl border border-amber-400/50 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl p-3 max-h-[70vh] overflow-y-auto">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-md overflow-hidden border border-slate-600/60 bg-slate-800/60 shrink-0">
            {npc?.imageUrl ? (
              <img src={npc.imageUrl} alt={`${nome} portrait`} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">No Img</div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] text-amber-300 font-bold leading-tight break-words">{nome}</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">NPC | {sideLabel}</p>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-slate-700/60">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Description</p>
          <p className="text-[12px] text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
            {description || '-'}
          </p>
        </div>

        <div className="mt-3 pt-2 border-t border-slate-700/60">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Notes</p>
          <p className="text-[12px] text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
            {notes || '-'}
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
    </div>,
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
  editNome,
  setEditNome,
  editDescription,
  setEditDescription,
  editNotes,
  setEditNotes,
  error,
  busy
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[110] p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-600 bg-slate-900 shadow-2xl p-5">
        <h3 className="text-xl font-semibold text-sky-300 mb-4">Edit NPC</h3>

        <div className="space-y-3">
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

function EchiDiViaggio() {
  const { user, userData, loading } = useAuth();
  const [navbarOffset, setNavbarOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

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
  const [editFormError, setEditFormError] = useState('');
  const [isSavingEditNpc, setIsSavingEditNpc] = useState(false);

  const [npcHover, setNpcHover] = useState(null);
  const hoverCloseTimerRef = useRef(null);

  useEffect(() => {
    const navbar = document.querySelector('[data-navbar]');
    if (!navbar) return undefined;

    const updateOffset = () => {
      const { height } = navbar.getBoundingClientRect();
      setNavbarOffset(Math.ceil(height));
    };

    updateOffset();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateOffset);
      observer.observe(navbar);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateOffset);
    return () => window.removeEventListener('resize', updateOffset);
  }, []);

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

  // Check permissions
  const canEditPublic = ['webmaster', 'dm', 'players', 'player'].includes(userData?.role);
  const canEditPrivate = !!user;
  const isDmOrWebmaster = role === 'dm' || role === 'webmaster';
  const canCreateNpc = isDmOrWebmaster;
  const canDeleteNpc = isDmOrWebmaster;
  const canEditNpc = !!user;

  const PUBLIC_COLOR = '#00BFFF';
  const PRIVATE_COLOR = '#a855f7';

  const publicCollectionPath = useMemo(() => ['map_markers'], []);
  const privateCollectionPath = useMemo(
    () => (user ? ['users', user.uid, 'map_markers_private'] : null),
    [user]
  );

  // Use the custom hook for map editing logic
  const {
    markers: publicMarkers,
    editMode: publicEditMode,
    showModal: showPublicModal,
    setShowModal: setShowPublicModal,
    markerText: publicMarkerText,
    setMarkerText: setPublicMarkerText,
    setNewMarkerData: setPublicNewMarkerData,
    handleMapDrop: handlePublicMapDrop,
    handleSaveMarker: handlePublicSaveMarker,
    handleDeleteMarker: handlePublicDeleteMarker
  } = useMapEditing({ user, canEdit: canEditPublic, collectionPath: publicCollectionPath });

  const {
    markers: privateMarkers,
    editMode: privateEditMode,
    showModal: showPrivateModal,
    setShowModal: setShowPrivateModal,
    markerText: privateMarkerText,
    setMarkerText: setPrivateMarkerText,
    setNewMarkerData: setPrivateNewMarkerData,
    handleMapDrop: handlePrivateMapDrop,
    handleSaveMarker: handlePrivateSaveMarker,
    handleDeleteMarker: handlePrivateDeleteMarker
  } = useMapEditing({ user, canEdit: canEditPrivate, collectionPath: privateCollectionPath });

  const stickyOffset = navbarOffset ? navbarOffset + 8 : 0;
  const sidebarHeight = `calc(100vh - ${stickyOffset + SIDEBAR_BOTTOM_GAP}px)`;

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const closeNpcHover = () => {
    clearHoverCloseTimer();
    setNpcHover(null);
  };

  const scheduleNpcHoverClose = () => {
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = setTimeout(() => {
      setNpcHover(null);
      hoverCloseTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  };

  const openNpcHover = (npc, anchorEl) => {
    if (!npc || !anchorEl) return;

    clearHoverCloseTimer();
    const anchorRect = anchorEl.getBoundingClientRect();
    const { left, top, direction } = computeHoverPosition(anchorRect);
    setNpcHover({
      npc,
      anchorEl,
      position: { left, top },
      direction
    });
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

    setIsSavingEditNpc(true);
    try {
      await updateDoc(doc(db, 'echi_npcs', editingNpc.id), {
        nome,
        description,
        notes,
        updatedAt: serverTimestamp()
      });
      closeEditNpcModal();
    } catch (error) {
      console.error('Edit NPC failed:', error);
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
      // Strict policy: if image deletion fails, do not delete Firestore document.
      await deleteObject(storageRef(storage, path));
    } catch (error) {
      console.error('Delete NPC image failed:', error);
      setNpcError('Image deletion failed. NPC document was not deleted.');
      setDeletingNpcId('');
      return;
    }

    try {
      await deleteDoc(doc(db, 'echi_npcs', npc.id));
    } catch (error) {
      console.error('Delete NPC document failed after image deletion:', error);
      setNpcError('Image deleted, but NPC document deletion failed.');
    } finally {
      setDeletingNpcId('');
    }
  };

  const handlePinDragStart = () => setIsDragging(true);
  const handlePinDragEnd = () => setIsDragging(false);

  const handleMapDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleMapDrop = (e, mapId) => {
    e.preventDefault();
    setIsDragging(false);

    const rawPayload = e.dataTransfer.getData('text/plain');
    if (!rawPayload) return;

    let payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      return;
    }

    const { iconType, scope } = payload || {};
    if (!iconType || !scope) return;

    if (scope === 'private') {
      handlePrivateMapDrop(e, mapId, iconType);
      return;
    }

    if (scope === 'public') {
      handlePublicMapDrop(e, mapId, iconType);
    }
  };

  const renderMarkersForMap = (markersList, { mapId, editMode, canEdit, handleDelete, scopeLabel, markerColor }) =>
    markersList
      .filter((m) => m.mapId === mapId)
      .map((marker) => (
        <MapMarkerItem
          key={`${scopeLabel}-${marker.id}`}
          marker={marker}
          editMode={editMode}
          canEdit={canEdit}
          onDelete={handleDelete}
          scopeLabel={scopeLabel}
          markerColor={markerColor}
        />
      ));

  if (loading) {
    return <div className="text-center text-white pt-10">Loading...</div>;
  }
  if (!user) {
    return <div className="text-center text-white pt-10">Please log in to view this page.</div>;
  }

  return (
    <div className="echi-di-viaggio-page-container relative min-h-screen text-white">
      <GlobalAuroraBackground />
      <main className="relative z-10 p-2 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)] gap-4 items-start">
          <aside className="lg:sticky self-start z-40" style={{ top: stickyOffset, height: sidebarHeight }}>
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

              <div className="p-3 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-2">
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
                        isActive={npcHover?.npc?.id === npc.id}
                        onHoverStart={openNpcHover}
                        onHoverEnd={scheduleNpcHoverClose}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>

          <div className="space-y-12 w-full">
            <div className="sticky z-30" style={{ top: stickyOffset }}>
              <div className="w-full grid grid-cols-2 gap-4 px-4">
                <MapEditorControls
                  title="Private Pin"
                  canEdit={canEditPrivate}
                  markerColor={PRIVATE_COLOR}
                  dragScope="private"
                  onPinDragStart={handlePinDragStart}
                  onPinDragEnd={handlePinDragEnd}
                />
                <MapEditorControls
                  title="Public Pin"
                  canEdit={canEditPublic}
                  markerColor={PUBLIC_COLOR}
                  dragScope="public"
                  onPinDragStart={handlePinDragStart}
                  onPinDragEnd={handlePinDragEnd}
                />
              </div>
            </div>

            <div className="bg-gray-800/80 p-2 rounded-2xl border border-gray-700 shadow-2xl backdrop-blur-sm">
              <h2 className="text-2xl font-serif text-[#FFA500] mb-6 border-b border-gray-600 pb-2">Mappa Artistica</h2>
              <div
                className="relative rounded-xl overflow-hidden shadow-black/50 shadow-lg ring-1 ring-white/10 group"
                onDragOver={handleMapDragOver}
                onDrop={(e) => handleMapDrop(e, 'art')}
              >
                <img
                  src={mappaArt}
                  alt="Mappa Artistica"
                  className={`w-full h-auto object-cover transition-transform duration-500 ease-out ${isDragging ? 'cursor-crosshair' : 'hover:scale-[1.01]'}`}
                />
                {renderMarkersForMap(publicMarkers, {
                  mapId: 'art',
                  editMode: publicEditMode,
                  canEdit: canEditPublic,
                  handleDelete: handlePublicDeleteMarker,
                  scopeLabel: 'public',
                  markerColor: PUBLIC_COLOR
                })}
                {renderMarkersForMap(privateMarkers, {
                  mapId: 'art',
                  editMode: privateEditMode,
                  canEdit: canEditPrivate,
                  handleDelete: handlePrivateDeleteMarker,
                  scopeLabel: 'private',
                  markerColor: PRIVATE_COLOR
                })}
              </div>
            </div>

            <div className="bg-gray-800/80 p-2 rounded-2xl border border-gray-700 shadow-2xl backdrop-blur-sm">
              <h2 className="text-2xl font-serif text-[#FFA500] mb-6 border-b border-gray-600 pb-2">Mappa Dettagliata</h2>
              <div
                className="relative rounded-xl overflow-hidden shadow-black/50 shadow-lg ring-1 ring-white/10 group"
                onDragOver={handleMapDragOver}
                onDrop={(e) => handleMapDrop(e, 'precisa')}
              >
                <img
                  src={mappaPrecisa}
                  alt="Mappa Dettagliata"
                  className={`w-full h-auto object-cover transition-transform duration-500 ease-out ${isDragging ? 'cursor-crosshair' : 'hover:scale-[1.01]'}`}
                />
                {renderMarkersForMap(publicMarkers, {
                  mapId: 'precisa',
                  editMode: publicEditMode,
                  canEdit: canEditPublic,
                  handleDelete: handlePublicDeleteMarker,
                  scopeLabel: 'public',
                  markerColor: PUBLIC_COLOR
                })}
                {renderMarkersForMap(privateMarkers, {
                  mapId: 'precisa',
                  editMode: privateEditMode,
                  canEdit: canEditPrivate,
                  handleDelete: handlePrivateDeleteMarker,
                  scopeLabel: 'private',
                  markerColor: PRIVATE_COLOR
                })}
              </div>
            </div>
          </div>
        </div>

        <MapMarkerModal
          title="Aggiungi Nota Pubblica"
          showModal={showPublicModal}
          setShowModal={setShowPublicModal}
          markerText={publicMarkerText}
          setMarkerText={setPublicMarkerText}
          handleSaveMarker={handlePublicSaveMarker}
          setNewMarkerData={setPublicNewMarkerData}
        />

        <MapMarkerModal
          title="Aggiungi Nota Privata"
          showModal={showPrivateModal}
          setShowModal={setShowPrivateModal}
          markerText={privateMarkerText}
          setMarkerText={setPrivateMarkerText}
          handleSaveMarker={handlePrivateSaveMarker}
          setNewMarkerData={setPrivateNewMarkerData}
        />

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
          editNome={editNome}
          setEditNome={setEditNome}
          editDescription={editDescription}
          setEditDescription={setEditDescription}
          editNotes={editNotes}
          setEditNotes={setEditNotes}
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
          onMouseEnter={clearHoverCloseTimer}
          onMouseLeave={scheduleNpcHoverClose}
        />
      </main>
    </div>
  );
}

export default EchiDiViaggio;
