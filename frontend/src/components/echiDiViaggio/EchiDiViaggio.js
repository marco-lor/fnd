// file: ./frontend/src/components/echiDiViaggio/EchiDiViaggio.js
import React, { useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import mappaArt from '../../assets/images/maps/mappa_art.png';
import mappaPrecisa from '../../assets/images/maps/mappa_precisa.png';
import GlobalAuroraBackground from '../backgrounds/GlobalAuroraBackground';
import { useMapEditing, MapEditorControls, MapMarkerModal, renderMarkerIcon } from './MapEditor';

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
                {/* Delete Button (X) - Slides right when deleting */}
                <button 
                  onClick={isDeleting ? handleCancelDelete : handleDeleteClick}
                  className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-700 z-30 shadow-md border border-white/20 transition-all duration-200 ${
                      isDeleting ? 'translate-x-6 opacity-100' : 'opacity-0 group-hover/marker:opacity-100'
                  }`}
                  title={isDeleting ? "Annulla" : "Elimina"}
                >
                  X
                </button>

                {/* Confirm Button (Check) - Appears when deleting */}
                <button 
                  onClick={handleConfirmDelete}
                  className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-green-600 z-30 shadow-md border border-white/20 transition-all duration-200 ${
                      isDeleting ? 'opacity-100 scale-100' : 'opacity-0 scale-0 pointer-events-none'
                  }`}
                  title="Conferma"
                >
                  ✓
                </button>
            </>
          )}

          <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 transition-opacity duration-300 pointer-events-none z-30 ${isDeleting ? 'opacity-0' : 'opacity-0 group-hover/marker:opacity-100'}`}>
            <div className={`bg-black/90 text-white p-3 rounded-lg border shadow-xl text-sm font-serif leading-relaxed relative`} style={{ borderColor: markerColor }}>
              {marker.text}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-black/90"></div>
            </div>
          </div>
        </div>
    );
};

function EchiDiViaggio() {
  const { user, userData, loading } = useAuth();
  
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
    setEditMode: setPublicEditMode,
    selectedIcon: publicSelectedIcon,
    setSelectedIcon: setPublicSelectedIcon,
    showModal: showPublicModal,
    setShowModal: setShowPublicModal,
    markerText: publicMarkerText,
    setMarkerText: setPublicMarkerText,
    setNewMarkerData: setPublicNewMarkerData,
    handleMapClick: handlePublicMapClick,
    handleSaveMarker: handlePublicSaveMarker,
    handleDeleteMarker: handlePublicDeleteMarker
  } = useMapEditing({ user, canEdit: canEditPublic, collectionPath: publicCollectionPath });

  const {
    markers: privateMarkers,
    editMode: privateEditMode,
    setEditMode: setPrivateEditMode,
    selectedIcon: privateSelectedIcon,
    setSelectedIcon: setPrivateSelectedIcon,
    showModal: showPrivateModal,
    setShowModal: setShowPrivateModal,
    markerText: privateMarkerText,
    setMarkerText: setPrivateMarkerText,
    setNewMarkerData: setPrivateNewMarkerData,
    handleMapClick: handlePrivateMapClick,
    handleSaveMarker: handlePrivateSaveMarker,
    handleDeleteMarker: handlePrivateDeleteMarker
  } = useMapEditing({ user, canEdit: canEditPrivate, collectionPath: privateCollectionPath });

  const handleSetPublicIcon = (icon) => {
      setPublicSelectedIcon(icon);
      if (icon) setPrivateSelectedIcon(null);
  };

  const handleSetPrivateIcon = (icon) => {
      setPrivateSelectedIcon(icon);
      if (icon) setPublicSelectedIcon(null);
  };

  const selectedIcon = publicSelectedIcon || privateSelectedIcon;

  const handleMapClick = (e, mapId) => {
    if (privateEditMode && privateSelectedIcon) {
      handlePrivateMapClick(e, mapId);
      return;
    }
    if (publicEditMode && publicSelectedIcon) {
      handlePublicMapClick(e, mapId);
    }
  };

  const renderMarkersForMap = (markersList, { mapId, editMode, canEdit, handleDelete, scopeLabel, markerColor }) =>
    markersList
      .filter(m => m.mapId === mapId)
      .map(marker => (
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

  // Optional: Show loading state or handle case where user is not logged in
  if (loading) {
    return <div className="text-center text-white pt-10">Loading...</div>;
  }
  if (!user) {
    return <div className="text-center text-white pt-10">Please log in to view this page.</div>;
  }

  return (
    <div className="echi-di-viaggio-page-container relative min-h-screen text-white overflow-hidden">
      <GlobalAuroraBackground />
      <main className="relative z-10 p-2 w-full">
        <div className="space-y-12 w-full">
            
            {/* Editors */}
            <div className="w-full flex flex-col gap-4 px-4">
                <MapEditorControls 
                    title="Public Editor"
                    canEdit={canEditPublic}
                    selectedIcon={publicSelectedIcon}
                    setSelectedIcon={handleSetPublicIcon}
                    markerColor={PUBLIC_COLOR}
                />
                <MapEditorControls 
                    title="Private Editor"
                    canEdit={canEditPrivate}
                    selectedIcon={privateSelectedIcon}
                    setSelectedIcon={handleSetPrivateIcon}
                    markerColor={PRIVATE_COLOR}
                />
            </div>

            {/* Map 1 Container */}
            <div className="bg-gray-800/80 p-2 rounded-2xl border border-gray-700 shadow-2xl backdrop-blur-sm">
                <h2 className="text-2xl font-serif text-[#FFA500] mb-6 border-b border-gray-600 pb-2">Mappa Artistica</h2>
                <div className="relative rounded-xl overflow-hidden shadow-black/50 shadow-lg ring-1 ring-white/10 group">
                    <img 
                        src={mappaArt} 
                        alt="Mappa Artistica" 
                        className={`w-full h-auto object-cover transition-transform duration-500 ease-out ${selectedIcon ? 'cursor-crosshair' : 'hover:scale-[1.01]'}`}
                        onClick={(e) => handleMapClick(e, 'art')}
                    />
                    {/* Markers Layer */}
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

            {/* Map 2 Container */}
            <div className="bg-gray-800/80 p-2 rounded-2xl border border-gray-700 shadow-2xl backdrop-blur-sm">
                <h2 className="text-2xl font-serif text-[#FFA500] mb-6 border-b border-gray-600 pb-2">Mappa Dettagliata</h2>
                <div className="relative rounded-xl overflow-hidden shadow-black/50 shadow-lg ring-1 ring-white/10 group">
                    <img 
                        src={mappaPrecisa} 
                        alt="Mappa Dettagliata" 
                        className={`w-full h-auto object-cover transition-transform duration-500 ease-out ${selectedIcon ? 'cursor-crosshair' : 'hover:scale-[1.01]'}`}
                        onClick={(e) => handleMapClick(e, 'precisa')}
                    />
                    {/* Markers Layer */}
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

        {/* Add Marker Modal */}
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
