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

    const iconColor = colorOverride || iconConfig.color;

    // Improve contrast on busy map backgrounds by drawing a subtle outline layer
    // behind the colored icon. This avoids relying on SVG stroke support.
    return (
        <span className="relative block w-full h-full">
            <IconComponent
                aria-hidden="true"
                className="absolute inset-0 w-full h-full text-black/90 drop-shadow-lg scale-110"
            />
            <IconComponent
                className="absolute inset-0 w-full h-full drop-shadow-md"
                style={{ color: iconColor }}
            />
        </span>
    );
};

export const useMapEditing = ({ user, canEdit, collectionPath }) => {
    const [markers, setMarkers] = useState([]);
    const [editMode, setEditMode] = useState(!!canEdit); // Default to true if can edit
    const [showModal, setShowModal] = useState(false);
    const [newMarkerData, setNewMarkerData] = useState(null);
    const [markerText, setMarkerText] = useState('');

    const collectionKey = collectionPath ? collectionPath.join('/') : null;

    // Update editMode if canEdit changes
    useEffect(() => {
        setEditMode(!!canEdit);
    }, [canEdit]);

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

    const handleMapDrop = (e, mapId, iconType) => {
        if (!editMode || !canEdit || !iconType) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        setNewMarkerData({ x, y, mapId, iconType });
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
        // Confirmation is handled by UI component now
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
        showModal,
        setShowModal,
        markerText,
        setMarkerText,
        newMarkerData,
        setNewMarkerData,
        handleMapDrop,
        handleSaveMarker,
        handleDeleteMarker
    };
};

export const MapEditorControls = ({ title, canEdit, markerColor, dragScope, onPinDragStart, onPinDragEnd }) => {
    if (!canEdit) return null;

    const handleDragStart = (event, iconType) => {
        if (!dragScope) return;
        event.dataTransfer.setData('text/plain', JSON.stringify({ iconType, scope: dragScope }));
        event.dataTransfer.effectAllowed = 'copy';
        if (onPinDragStart) {
            onPinDragStart({ iconType, scope: dragScope });
        }
    };

    const handleDragEnd = () => {
        if (onPinDragEnd) {
            onPinDragEnd();
        }
    };

    return (
        <div className="bg-gray-900/80 p-2 rounded-xl border border-gray-700 shadow-xl backdrop-blur-md flex flex-col gap-2">
            <div className="flex items-center justify-between px-2">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: markerColor || '#ccc' }}>{title}</p>
            </div>
            
            <div className="flex flex-row gap-2 overflow-x-auto pb-1 px-1 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
                {Object.entries(MARKER_ICONS).map(([key, config]) => (
                    <button
                        key={key}
                        type="button"
                        draggable
                        onDragStart={(event) => handleDragStart(event, key)}
                        onDragEnd={handleDragEnd}
                        className="p-2 rounded-lg flex items-center justify-center transition-all flex-shrink-0 hover:bg-white/10 hover:scale-105 cursor-grab"
                        title={`Trascina: ${config.label}`}
                    >
                        <config.icon 
                            className="text-2xl" 
                            style={{ color: markerColor || config.color }} 
                        />
                    </button>
                ))}
            </div>
            <div className="text-center text-[10px] font-bold uppercase tracking-wider" style={{ color: markerColor || '#FFA500' }}>
                Trascina sulla mappa
            </div>
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
