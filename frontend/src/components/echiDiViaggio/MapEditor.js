import React, { useState, useEffect } from 'react';
import { db } from '../firebaseConfig';
import { collection, addDoc, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import {
    GiCastle,
    GiSkullCrossedBones,
    GiTreasureMap,
    GiCampfire,
    GiScrollUnfurled,
    GiWalk,
    GiSwordman,
    GiVillage,
    GiMountainCave
} from 'react-icons/gi';
import { FaMapMarkerAlt } from 'react-icons/fa';

// Icon configuration
export const MARKER_ICONS = {
    default: { icon: FaMapMarkerAlt, label: 'Default', color: '#FFA500' },
    castle: { icon: GiCastle, label: 'Citta/Castello', color: '#4ade80' },
    danger: { icon: GiSkullCrossedBones, label: 'Pericolo', color: '#ef4444' },
    treasure: { icon: GiTreasureMap, label: 'Tesoro/Quest', color: '#fbbf24' },
    camp: { icon: GiCampfire, label: 'Accampamento', color: '#f97316' },
    lore: { icon: GiScrollUnfurled, label: 'Lore', color: '#a855f7' },
    path: { icon: GiWalk, label: 'Percorso', color: '#38bdf8' },
    npc: { icon: GiSwordman, label: 'NPC', color: '#e879f9' },
    village: { icon: GiVillage, label: 'Villaggio', color: '#86efac' },
    cave: { icon: GiMountainCave, label: 'Caverna', color: '#94a3b8' }
};

// Helper to render marker icon
export const renderMarkerIcon = (type, colorOverride) => {
    const iconConfig = MARKER_ICONS[type] || MARKER_ICONS.default;
    const IconComponent = iconConfig.icon;
    return <IconComponent className="w-full h-full drop-shadow-md" style={{ color: colorOverride || iconConfig.color }} />;
};

export const useMapEditing = ({ user, canEdit, collectionPath }) => {
    const [markers, setMarkers] = useState([]);
    const [editMode, setEditMode] = useState(false);
    const [selectedIcon, setSelectedIcon] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [newMarkerData, setNewMarkerData] = useState(null);
    const [markerText, setMarkerText] = useState('');

    const collectionKey = collectionPath ? collectionPath.join('/') : null;

    // Fetch markers
    useEffect(() => {
        if (!collectionKey) {
            setMarkers([]);
            return () => {};
        }

        const unsubscribe = onSnapshot(collection(db, ...collectionPath), (snapshot) => {
            const loadedMarkers = snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                ...docSnap.data()
            }));
            setMarkers(loadedMarkers);
        });

        return () => unsubscribe();
    }, [collectionKey]);

    const handleMapClick = (e, mapId) => {
        if (!editMode || !canEdit || !selectedIcon) return;

        const rect = e.target.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        setNewMarkerData({ x, y, mapId, iconType: selectedIcon });
        setMarkerText('');
        setShowModal(true);
    };

    const handleSaveMarker = async () => {
        if (!markerText.trim() || !newMarkerData || !collectionKey) return;

        try {
            await addDoc(collection(db, ...collectionPath), {
                ...newMarkerData,
                text: markerText,
                createdBy: user?.uid || null,
                createdAt: new Date().toISOString()
            });
            setShowModal(false);
            setNewMarkerData(null);
            setMarkerText('');
        } catch (error) {
            console.error("Error adding marker: ", error);
            alert("Errore nel salvataggio del marker");
        }
    };

    const handleDeleteMarker = async (e, markerId) => {
        e.stopPropagation(); // Prevent map click
        if (!window.confirm("Eliminare questo punto di interesse?")) return;
        if (!collectionKey) return;

        try {
            await deleteDoc(doc(db, ...collectionPath, markerId));
        } catch (error) {
            console.error("Error deleting marker: ", error);
        }
    };

    return {
        markers,
        editMode,
        setEditMode,
        selectedIcon,
        setSelectedIcon,
        showModal,
        setShowModal,
        markerText,
        setMarkerText,
        newMarkerData,
        setNewMarkerData,
        handleMapClick,
        handleSaveMarker,
        handleDeleteMarker
    };
};

export const MapEditorControls = ({ title, canEdit, editMode, setEditMode, selectedIcon, setSelectedIcon }) => {
    if (!canEdit) return null;

    return (
        <div className="bg-gray-900/70 p-3 rounded-xl border border-gray-700 shadow-xl backdrop-blur-md w-72">
            <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-sm font-semibold text-gray-200">{title}</p>
                <button
                    onClick={() => {
                        setEditMode(!editMode);
                        setSelectedIcon(null);
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-bold shadow-lg transition-all ${
                        editMode
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                >
                    {editMode ? 'Chiudi' : 'Modifica'}
                </button>
            </div>
            
            {editMode && (
                <div>
                    <p className="text-xs text-gray-300 mb-3 text-center border-b border-gray-600 pb-2">
                        Seleziona un'icona e clicca sulla mappa
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                        {Object.entries(MARKER_ICONS).map(([key, config]) => (
                            <button
                                key={key}
                                onClick={() => setSelectedIcon(selectedIcon === key ? null : key)}
                                className={`p-2 rounded-lg flex items-center justify-center transition-all ${
                                    selectedIcon === key 
                                    ? 'bg-white/20 ring-2 ring-[#FFA500] scale-110' 
                                    : 'hover:bg-white/10 hover:scale-105'
                                }`}
                                title={config.label}
                            >
                                <config.icon 
                                    className="text-2xl" 
                                    style={{ color: config.color }} 
                                />
                            </button>
                        ))}
                    </div>
                    {selectedIcon && (
                        <div className="mt-3 text-center text-xs text-[#FFA500] animate-pulse">
                            Modalita inserimento attiva: {MARKER_ICONS[selectedIcon].label}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export const MapMarkerModal = ({ showModal, setShowModal, markerText, setMarkerText, handleSaveMarker, setNewMarkerData, title }) => {
    if (!showModal) return null;

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]">
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-600 shadow-2xl w-full max-w-md">
                <h3 className="text-xl font-bold text-[#FFA500] mb-4">
                    {title || "Aggiungi Nota alla Mappa"}
                </h3>
                <textarea
                    value={markerText}
                    onChange={(e) => setMarkerText(e.target.value)}
                    className="w-full h-32 bg-gray-700 text-white p-3 rounded border border-gray-600 focus:border-[#FFA500] focus:outline-none resize-none mb-4"
                    placeholder="Inserisci il testo che apparira al passaggio del mouse..."
                    autoFocus
                />
                <div className="flex justify-end space-x-3">
                    <button 
                        onClick={() => { setShowModal(false); setNewMarkerData(null); }}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-white transition-colors"
                    >
                        Annulla
                    </button>
                    <button 
                        onClick={handleSaveMarker}
                        className="px-4 py-2 bg-[#FFA500] hover:bg-[#FF8C00] text-black font-bold rounded transition-colors"
                    >
                        Salva
                    </button>
                </div>
            </div>
        </div>
    );
};
