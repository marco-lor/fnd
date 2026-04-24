// file: ./frontend/src/components/echiDiViaggio/EchiDiViaggio.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../AuthContext';
import mappaArt from '../../assets/images/maps/mappa_art.png';
import mappaPrecisa from '../../assets/images/maps/mappa_precisa.png';
import { useMapEditing, MapEditorControls, MapMarkerModal, renderMarkerIcon } from './MapEditor';
import NpcSidebar from './NpcSidebar';
import { db } from '../firebaseConfig';
import { useShellLayout } from '../common/shellLayout';

const getNormalizedText = (value, fallback) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
};

const NPC_HOVER_CLOSE_DELAY_MS = 180;
const NPC_MOVE_NOOP_DELTA = 0.1;
const MAP_LABEL_BY_ID = {
  art: 'Mappa Artistica',
  precisa: 'Mappa Dettagliata'
};

const clampPercentage = (value) => Math.max(0, Math.min(100, value));

const NpcMoveConfirmModal = ({
  open,
  busy,
  error,
  npcName,
  mapLabel,
  onCancel,
  onConfirm
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[120] p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 shadow-2xl p-5">
        <h3 className="text-xl font-semibold text-amber-300 mb-3">Conferma Spostamento NPC</h3>
        <p className="text-sm text-slate-200 leading-relaxed">
          Vuoi spostare{' '}
          <span className="font-semibold text-amber-200">{npcName || 'NPC'}</span>
          {' '}nella{' '}
          <span className="font-semibold text-sky-300">{mapLabel}</span>
          {' '}in questa nuova posizione?
        </p>

        {error && (
          <div className="mt-4 text-sm text-red-300 bg-red-900/20 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-slate-700 text-slate-100 hover:bg-slate-600 transition-colors disabled:opacity-60"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-amber-500 text-black font-semibold hover:bg-amber-400 transition-colors disabled:opacity-60"
          >
            {busy ? 'Salvataggio...' : 'Conferma'}
          </button>
        </div>
      </div>
    </div>
  );
};

const MapMarkerItem = ({
  marker,
  editMode,
  canEdit,
  onDelete,
  scopeLabel,
  markerColor,
  npcData,
  onNpcMoveDragStart,
  onNpcMoveDragEnd
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isNpcImageBroken, setIsNpcImageBroken] = useState(false);
  const [isNpcHoverOpen, setIsNpcHoverOpen] = useState(false);
  const hoverCloseTimerRef = useRef(null);

  const isNpcMarker = marker?.markerType === 'npc' || marker?.iconType === 'npc';
  const hasNpcInfo = isNpcMarker && !!npcData;
  const npcImageUrl = getNormalizedText(npcData?.imageUrl, '');
  const npcNome = getNormalizedText(npcData?.nome, marker?.npcNome || marker?.text || 'NPC');
  const npcDescription = getNormalizedText(npcData?.description, '-');
  const npcNotes = getNormalizedText(npcData?.notes, '-');

  const hasNpcImage = !!(
    hasNpcInfo
    && npcImageUrl
    && !isNpcImageBroken
  );
  const isNpcMovable = isNpcMarker && editMode && canEdit && !isDeleting;

  useEffect(() => {
    setIsNpcImageBroken(false);
  }, [npcImageUrl, marker?.id]);

  const clearNpcHoverClose = () => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const openNpcHoverCard = () => {
    if (!hasNpcInfo || isDeleting) return;
    clearNpcHoverClose();
    setIsNpcHoverOpen(true);
  };

  const scheduleNpcHoverClose = () => {
    if (!hasNpcInfo) return;
    clearNpcHoverClose();
    hoverCloseTimerRef.current = setTimeout(() => {
      setIsNpcHoverOpen(false);
      hoverCloseTimerRef.current = null;
    }, NPC_HOVER_CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (isDeleting || !hasNpcInfo) {
      clearNpcHoverClose();
      setIsNpcHoverOpen(false);
    }
  }, [isDeleting, hasNpcInfo]);

  useEffect(() => () => clearNpcHoverClose(), []);

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

  const handleNpcMarkerDragStart = (e) => {
    if (!isNpcMovable) {
      e.preventDefault();
      return;
    }

    clearNpcHoverClose();
    setIsNpcHoverOpen(false);

    const payload = {
      dragType: 'npc-marker-move',
      markerId: marker?.id || '',
      npcId: marker?.npcId || '',
      npcNome,
      scope: scopeLabel,
      originMapId: marker?.mapId || ''
    };
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    onNpcMoveDragStart?.(payload);
  };

  const handleNpcMarkerDragEnd = () => {
    onNpcMoveDragEnd?.();
  };

  return (
    <div
      className={`absolute z-20 group/marker ${hasNpcImage ? 'w-10 h-10 -ml-5 -mt-5' : 'w-8 h-8 -ml-4 -mt-4'}`}
      style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
      onMouseEnter={openNpcHoverCard}
      onMouseLeave={scheduleNpcHoverClose}
      draggable={isNpcMovable}
      onDragStart={handleNpcMarkerDragStart}
      onDragEnd={handleNpcMarkerDragEnd}
    >
      <div className={`w-full h-full hover:scale-125 transition-transform duration-200 relative ${isNpcMovable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}>
        {hasNpcImage ? (
          <span className="relative block w-full h-full" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-black/70 shadow-xl shadow-black/70 scale-110"></span>
            <span className="absolute inset-0 rounded-full p-[2px] bg-gradient-to-b from-amber-100/90 via-sky-100/70 to-slate-300/80">
              <span className="block w-full h-full rounded-full overflow-hidden border border-black/30 bg-slate-900/70">
                <img
                  src={npcImageUrl}
                  alt={npcNome}
                  className="w-full h-full object-cover"
                  onError={() => setIsNpcImageBroken(true)}
                />
              </span>
            </span>
          </span>
        ) : (
          renderMarkerIcon(marker.iconType, markerColor)
        )}
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

      <div
        className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 transition-opacity duration-300 pointer-events-none z-30 ${
          hasNpcInfo ? 'w-72' : 'w-64'
        } ${
          isDeleting
            ? 'opacity-0'
            : hasNpcInfo
              ? (isNpcHoverOpen ? 'opacity-100' : 'opacity-0')
              : 'opacity-0 group-hover/marker:opacity-100'
        }`}
      >
        {hasNpcInfo ? (
          <div
            className="w-72 max-h-56 overflow-y-auto pointer-events-auto bg-slate-950/95 text-white p-3 rounded-lg border border-slate-600/70 shadow-xl text-xs leading-relaxed relative"
            style={{ borderColor: markerColor }}
            onMouseEnter={openNpcHoverCard}
            onMouseLeave={scheduleNpcHoverClose}
          >
            <div className="flex items-start gap-2 pb-2 border-b border-slate-700/70">
              <div className="w-10 h-10 rounded-full overflow-hidden border border-slate-500/70 bg-slate-800/80 shrink-0">
                {hasNpcImage ? (
                  <img src={npcImageUrl} alt={`${npcNome} portrait`} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[9px] text-slate-400">No Img</div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-200 break-words leading-tight">{npcNome}</p>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 mt-1">NPC</p>
              </div>
            </div>

            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Description</p>
              <p className="text-[12px] text-slate-200 whitespace-pre-wrap break-words">{npcDescription}</p>
            </div>

            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Notes</p>
              <p className="text-[12px] text-slate-300 whitespace-pre-wrap break-words">{npcNotes}</p>
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-950/95"></div>
          </div>
        ) : (
          <div
            className="bg-black/90 text-white p-3 rounded-lg border shadow-xl text-sm font-serif leading-relaxed relative"
            style={{ borderColor: markerColor }}
          >
            {marker.text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-black/90"></div>
          </div>
        )}
      </div>
    </div>
  );
};

function EchiDiViaggio() {
  const { user, userData, loading } = useAuth();
  const { topInset } = useShellLayout();
  const [isDragging, setIsDragging] = useState(false);
  const [isNpcListHovered, setIsNpcListHovered] = useState(false);
  const [npcById, setNpcById] = useState({});
  const [pendingNpcMove, setPendingNpcMove] = useState(null);
  const [npcMoveError, setNpcMoveError] = useState('');
  const [isSavingNpcMove, setIsSavingNpcMove] = useState(false);

  useEffect(() => {
    if (!user?.uid) {
      setNpcById({});
      return () => {};
    }

    const unsubscribe = onSnapshot(
      collection(db, 'echi_npcs'),
      (snapshot) => {
        const nextNpcById = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          nextNpcById[docSnap.id] = {
            nome: getNormalizedText(data?.nome, 'NPC'),
            imageUrl: getNormalizedText(data?.imageUrl, ''),
            description: getNormalizedText(data?.description, '-'),
            notes: getNormalizedText(data?.notes, '-')
          };
        });
        setNpcById(nextNpcById);
      },
      (error) => {
        console.error('NPC lookup snapshot error:', error);
        setNpcById({});
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [user?.uid]);

  // Check permissions
  const canEditPublic = ['webmaster', 'dm', 'players', 'player'].includes(userData?.role);
  const canEditPrivate = !!user;

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
    handleAddMarkerAtDrop: handlePublicAddMarkerAtDrop,
    handleSaveMarker: handlePublicSaveMarker,
    handleDeleteMarker: handlePublicDeleteMarker,
    handleMoveMarker: handlePublicMoveMarker
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
    handleDeleteMarker: handlePrivateDeleteMarker,
    handleMoveMarker: handlePrivateMoveMarker
  } = useMapEditing({ user, canEdit: canEditPrivate, collectionPath: privateCollectionPath });

  const stickyOffset = topInset + 8;

  const handlePinDragStart = () => setIsDragging(true);
  const handlePinDragEnd = () => setIsDragging(false);
  const handleNpcDragStart = () => setIsDragging(true);
  const handleNpcDragEnd = () => setIsDragging(false);
  const handleNpcMoveDragStart = () => {
    setIsDragging(true);
    setNpcMoveError('');
    setPendingNpcMove(null);
  };
  const handleNpcMoveDragEnd = () => setIsDragging(false);

  const getMapLabel = (mapId) => MAP_LABEL_BY_ID[mapId] || mapId;

  const handleMapDragOver = (e) => {
    e.preventDefault();
    let dropEffect = 'copy';
    const effectAllowed = (e.dataTransfer.effectAllowed || '').toLowerCase();

    if (effectAllowed === 'move') {
      dropEffect = 'move';
    }

    const rawPayload = e.dataTransfer.getData('text/plain');
    if (rawPayload) {
      try {
        const payload = JSON.parse(rawPayload);
        if (payload?.dragType === 'npc-marker-move') {
          dropEffect = 'move';
        }
      } catch {
        // ignore malformed drag payloads and keep fallback effect
      }
    }

    e.dataTransfer.dropEffect = dropEffect;
  };

  const handleMapDrop = async (e, mapId) => {
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

    const { dragType, iconType, scope } = payload || {};

    if (dragType === 'npc-marker-move') {
      const markerId = typeof payload.markerId === 'string' ? payload.markerId.trim() : '';
      const originMapId = typeof payload.originMapId === 'string' ? payload.originMapId.trim() : '';
      if (!markerId || !originMapId || originMapId !== mapId) return;

      const moveScope = scope === 'public' || scope === 'private' ? scope : '';
      if (!moveScope) return;
      if ((moveScope === 'public' && !canEditPublic) || (moveScope === 'private' && !canEditPrivate)) return;

      const scopeMarkers = moveScope === 'public' ? publicMarkers : privateMarkers;
      const marker = scopeMarkers.find((entry) => entry.id === markerId);
      if (!marker || marker.mapId !== mapId) return;

      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const nextXRaw = ((e.clientX - rect.left) / rect.width) * 100;
      const nextYRaw = ((e.clientY - rect.top) / rect.height) * 100;
      if (!Number.isFinite(nextXRaw) || !Number.isFinite(nextYRaw)) return;

      const nextX = clampPercentage(nextXRaw);
      const nextY = clampPercentage(nextYRaw);
      const currentX = Number(marker.x);
      const currentY = Number(marker.y);
      if (
        Number.isFinite(currentX)
        && Number.isFinite(currentY)
        && Math.abs(currentX - nextX) < NPC_MOVE_NOOP_DELTA
        && Math.abs(currentY - nextY) < NPC_MOVE_NOOP_DELTA
      ) {
        return;
      }

      const npcData = marker.npcId ? npcById[marker.npcId] : null;
      const npcNomeValue = getNormalizedText(
        payload.npcNome,
        getNormalizedText(npcData?.nome, marker.npcNome || marker.text || 'NPC')
      );

      setNpcMoveError('');
      setPendingNpcMove({
        markerId,
        npcId: typeof marker.npcId === 'string' ? marker.npcId : '',
        scope: moveScope,
        mapId,
        nextX,
        nextY,
        npcName: npcNomeValue
      });
      return;
    }

    if (!iconType || !scope) return;

    if (dragType === 'npc') {
      if (scope !== 'public' || iconType !== 'npc' || !canEditPublic) return;

      const npcId = typeof payload.npcId === 'string' ? payload.npcId.trim() : '';
      const npcNomeValue = typeof payload.npcNome === 'string' ? payload.npcNome.trim() : '';
      if (!npcId) return;

      const alreadyPlaced = publicMarkers.some(
        (marker) => marker.mapId === mapId && marker.npcId === npcId
      );
      if (alreadyPlaced) return;

      await handlePublicAddMarkerAtDrop(e, mapId, {
        iconType: 'npc',
        text: npcNomeValue || 'NPC',
        markerType: 'npc',
        npcId,
        npcNome: npcNomeValue || 'NPC'
      });
      return;
    }

    if (scope === 'private') {
      handlePrivateMapDrop(e, mapId, iconType);
      return;
    }

    if (scope === 'public') {
      handlePublicMapDrop(e, mapId, iconType);
    }
  };

  const handleCancelNpcMove = () => {
    if (isSavingNpcMove) return;
    setPendingNpcMove(null);
    setNpcMoveError('');
  };

  const handleConfirmNpcMove = async () => {
    if (!pendingNpcMove) return;

    const moveHandler = pendingNpcMove.scope === 'public'
      ? handlePublicMoveMarker
      : handlePrivateMoveMarker;
    if (typeof moveHandler !== 'function') return;

    setNpcMoveError('');
    setIsSavingNpcMove(true);
    try {
      const result = await moveHandler(pendingNpcMove.markerId, {
        x: pendingNpcMove.nextX,
        y: pendingNpcMove.nextY
      });
      if (result?.success) {
        setPendingNpcMove(null);
        return;
      }
      setNpcMoveError('Impossibile spostare questo NPC. Riprova.');
    } catch (error) {
      console.error('NPC move confirm failed:', error);
      setNpcMoveError('Impossibile spostare questo NPC. Riprova.');
    } finally {
      setIsSavingNpcMove(false);
    }
  };

  const renderMarkersForMap = (
    markersList,
    { mapId, editMode, canEdit, handleDelete, scopeLabel, markerColor, onNpcMoveDragStart, onNpcMoveDragEnd }
  ) =>
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
          npcData={marker.npcId ? npcById[marker.npcId] || null : null}
          onNpcMoveDragStart={onNpcMoveDragStart}
          onNpcMoveDragEnd={onNpcMoveDragEnd}
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
      <main className="relative z-10 p-2 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)] gap-4 items-start">
          <NpcSidebar
            user={user}
            userData={userData}
            stickyOffset={stickyOffset}
            onHoverStateChange={setIsNpcListHovered}
            canDragToMap={canEditPublic}
            onNpcDragStart={handleNpcDragStart}
            onNpcDragEnd={handleNpcDragEnd}
          />

          <div
            className={`space-y-12 w-full transition-opacity duration-300 ease-out motion-reduce:transition-none ${
              isNpcListHovered ? 'opacity-90' : 'opacity-100'
            }`}
          >
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
              <h2 className="text-2xl font-serif text-[#FFA500] mb-6 border-b border-gray-600 pb-2">
                Mappa Artistica
              </h2>
              <div
                className="relative rounded-xl overflow-hidden shadow-black/50 shadow-lg ring-1 ring-white/10 group"
                onDragOver={handleMapDragOver}
                onDrop={(e) => handleMapDrop(e, 'art')}
              >
                <img
                  src={mappaArt}
                  alt="Mappa Artistica"
                  className={`w-full h-auto object-cover transition-transform duration-500 ease-out ${
                    isDragging ? 'cursor-crosshair' : 'hover:scale-[1.01]'
                  }`}
                />
                {renderMarkersForMap(publicMarkers, {
                  mapId: 'art',
                  editMode: publicEditMode,
                  canEdit: canEditPublic,
                  handleDelete: handlePublicDeleteMarker,
                  scopeLabel: 'public',
                  markerColor: PUBLIC_COLOR,
                  onNpcMoveDragStart: handleNpcMoveDragStart,
                  onNpcMoveDragEnd: handleNpcMoveDragEnd
                })}
                {renderMarkersForMap(privateMarkers, {
                  mapId: 'art',
                  editMode: privateEditMode,
                  canEdit: canEditPrivate,
                  handleDelete: handlePrivateDeleteMarker,
                  scopeLabel: 'private',
                  markerColor: PRIVATE_COLOR,
                  onNpcMoveDragStart: handleNpcMoveDragStart,
                  onNpcMoveDragEnd: handleNpcMoveDragEnd
                })}
              </div>
            </div>

            <div className="bg-gray-800/80 p-2 rounded-2xl border border-gray-700 shadow-2xl backdrop-blur-sm">
              <h2 className="text-2xl font-serif text-[#FFA500] mb-6 border-b border-gray-600 pb-2">
                Mappa Dettagliata
              </h2>
              <div
                className="relative rounded-xl overflow-hidden shadow-black/50 shadow-lg ring-1 ring-white/10 group"
                onDragOver={handleMapDragOver}
                onDrop={(e) => handleMapDrop(e, 'precisa')}
              >
                <img
                  src={mappaPrecisa}
                  alt="Mappa Dettagliata"
                  className={`w-full h-auto object-cover transition-transform duration-500 ease-out ${
                    isDragging ? 'cursor-crosshair' : 'hover:scale-[1.01]'
                  }`}
                />
                {renderMarkersForMap(publicMarkers, {
                  mapId: 'precisa',
                  editMode: publicEditMode,
                  canEdit: canEditPublic,
                  handleDelete: handlePublicDeleteMarker,
                  scopeLabel: 'public',
                  markerColor: PUBLIC_COLOR,
                  onNpcMoveDragStart: handleNpcMoveDragStart,
                  onNpcMoveDragEnd: handleNpcMoveDragEnd
                })}
                {renderMarkersForMap(privateMarkers, {
                  mapId: 'precisa',
                  editMode: privateEditMode,
                  canEdit: canEditPrivate,
                  handleDelete: handlePrivateDeleteMarker,
                  scopeLabel: 'private',
                  markerColor: PRIVATE_COLOR,
                  onNpcMoveDragStart: handleNpcMoveDragStart,
                  onNpcMoveDragEnd: handleNpcMoveDragEnd
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

        <NpcMoveConfirmModal
          open={!!pendingNpcMove}
          busy={isSavingNpcMove}
          error={npcMoveError}
          npcName={pendingNpcMove?.npcName || 'NPC'}
          mapLabel={getMapLabel(pendingNpcMove?.mapId || '')}
          onCancel={handleCancelNpcMove}
          onConfirm={handleConfirmNpcMove}
        />
      </main>
    </div>
  );
}

export default EchiDiViaggio;
