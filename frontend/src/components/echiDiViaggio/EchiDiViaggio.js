// file: ./frontend/src/components/echiDiViaggio/EchiDiViaggio.js
import React, { useMemo } from 'react';
import { useAuth } from '../../AuthContext';
import mappaArt from '../../assets/images/maps/mappa_art.png';
import mappaPrecisa from '../../assets/images/maps/mappa_precisa.png';
import GlobalAuroraBackground from '../backgrounds/GlobalAuroraBackground';
import { useMapEditing, MapEditorControls, MapMarkerModal, renderMarkerIcon } from './MapEditor';

function EchiDiViaggio() {
  const { user, userData, loading } = useAuth();
  
  // Check permissions
  const canEditPublic = ['webmaster', 'dm', 'players', 'player'].includes(userData?.role);
  const canEditPrivate = !!user;

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

  const renderMarkersForMap = (markersList, { mapId, editMode, canEdit, handleDelete, scopeLabel }) =>
    markersList
      .filter(m => m.mapId === mapId)
      .map(marker => (
        <div
          key={`${scopeLabel}-${marker.id}`}
          className="absolute w-8 h-8 -ml-4 -mt-4 z-20 group/marker"
          style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
        >
          <div className="w-full h-full cursor-pointer hover:scale-125 transition-transform duration-200 relative">
            {renderMarkerIcon(marker.iconType)}
            {scopeLabel === 'private' && (
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 rounded-full bg-blue-500 text-black font-semibold shadow">
                Privato
              </span>
            )}
          </div>
          
          {editMode && canEdit && (
            <button 
              onClick={(e) => handleDelete(e, marker.id)}
              className="absolute -top-4 -right-4 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-700 z-30 shadow-md border border-white/20"
              title="Elimina"
            >
              X
            </button>
          )}

          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 opacity-0 group-hover/marker:opacity-100 transition-opacity duration-300 pointer-events-none z-30">
            <div className={`bg-black/90 text-white p-3 rounded-lg border ${mapId === 'precisa' ? 'border-[#00BFFF]' : 'border-[#FFA500]'} shadow-xl text-sm font-serif leading-relaxed relative`}>
              {marker.text}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-black/90"></div>
            </div>
          </div>
        </div>
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
            <div className="w-full flex flex-wrap justify-end gap-4 px-4 items-start">
                <MapEditorControls 
                    title="Public Editor"
                    canEdit={canEditPublic}
                    editMode={publicEditMode}
                    setEditMode={setPublicEditMode}
                    selectedIcon={publicSelectedIcon}
                    setSelectedIcon={setPublicSelectedIcon}
                />
                <MapEditorControls 
                    title="Private Editor"
                    canEdit={canEditPrivate}
                    editMode={privateEditMode}
                    setEditMode={setPrivateEditMode}
                    selectedIcon={privateSelectedIcon}
                    setSelectedIcon={setPrivateSelectedIcon}
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
                        scopeLabel: 'public'
                    })}
                    {renderMarkersForMap(privateMarkers, {
                        mapId: 'art',
                        editMode: privateEditMode,
                        canEdit: canEditPrivate,
                        handleDelete: handlePrivateDeleteMarker,
                        scopeLabel: 'private'
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
                        scopeLabel: 'public'
                    })}
                    {renderMarkersForMap(privateMarkers, {
                        mapId: 'precisa',
                        editMode: privateEditMode,
                        canEdit: canEditPrivate,
                        handleDelete: handlePrivateDeleteMarker,
                        scopeLabel: 'private'
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
