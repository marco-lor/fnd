// file: ./frontend/src/components/echiDiViaggio/EchiDiViaggio.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../AuthContext';
import mappaArt from '../../assets/images/maps/mappa_art.png';
import mappaPrecisa from '../../assets/images/maps/mappa_precisa.png';
import GlobalAuroraBackground from '../backgrounds/GlobalAuroraBackground';
import { useMapEditing, MapEditorControls, MapMarkerModal, renderMarkerIcon } from './MapEditor';
import NpcSidebar from './NpcSidebar';
import { db } from '../firebaseConfig';

const getNormalizedText = (value, fallback) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
};

const NPC_HOVER_CLOSE_DELAY_MS = 180;

const MapMarkerItem = ({ marker, editMode, canEdit, onDelete, scopeLabel, markerColor, npcData }) => {
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

  return (
    <div
      className={`absolute z-20 group/marker ${hasNpcImage ? 'w-10 h-10 -ml-5 -mt-5' : 'w-8 h-8 -ml-4 -mt-4'}`}
      style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
      onMouseEnter={openNpcHoverCard}
      onMouseLeave={scheduleNpcHoverClose}
    >
      <div className="w-full h-full cursor-pointer hover:scale-125 transition-transform duration-200 relative">
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
  const [navbarOffset, setNavbarOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isNpcListHovered, setIsNpcListHovered] = useState(false);
  const [npcById, setNpcById] = useState({});

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

    return () => unsubscribe();
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

  const handlePinDragStart = () => setIsDragging(true);
  const handlePinDragEnd = () => setIsDragging(false);
  const handleNpcDragStart = () => setIsDragging(true);
  const handleNpcDragEnd = () => setIsDragging(false);

  const handleMapDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
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

  const renderMarkersForMap = (
    markersList,
    { mapId, editMode, canEdit, handleDelete, scopeLabel, markerColor }
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
      </main>
    </div>
  );
}

export default EchiDiViaggio;
