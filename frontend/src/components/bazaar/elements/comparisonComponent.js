// file: ./frontend/src/components/bazaar/elements/comparisonComponent.js
import React, { useContext, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { deleteDoc, doc, onSnapshot, getDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage"; // Firebase storage functions
import { db, storage } from "../../firebaseConfig";
import { computeValue } from '../../common/computeFormula';
import { AuthContext } from "../../../AuthContext";
import { AddWeaponOverlay } from './addWeapon'; // Import AddWeaponOverlay for editing
import { FaTrash, FaEdit } from "react-icons/fa"; // Import FaEdit icon

export default function ComparisonPanel({ item, showMessage }) { // Added showMessage prop
    const { user } = useContext(AuthContext);
    const [userData, setUserData] = useState(null);
    const [userParams, setUserParams] = useState({ Base: {}, Combattimento: {} });
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [showEditOverlay, setShowEditOverlay] = useState(false); // State for edit overlay
    const [imageError, setImageError] = useState(false);

    // Fetch user data and parameters
    useEffect(() => {
        if (user) {
            const userRef = doc(db, "users", user.uid);
            const unsubscribeUser = onSnapshot(
                userRef,
                (docSnap) => {
                    if (docSnap.exists()) {
                        setUserData(docSnap.data());
                        // Assume user params are stored similarly (Base, Combattimento)
                        setUserParams(docSnap.data().Parametri || { Base: {}, Combattimento: {} });
                    } else {
                        setUserData(null);
                        setUserParams({ Base: {}, Combattimento: {} });
                    }
                },
                (error) => {
                    console.error("Error fetching user data:", error);
                    setUserData(null);
                    setUserParams({ Base: {}, Combattimento: {} });
                }
            );
            return () => unsubscribeUser();
        } else {
            setUserData(null);
            setUserParams({ Base: {}, Combattimento: {} });
        }
    }, [user]);


    // Destructure data based on the NEW schema
    const general = item.General || {};
    const specific = item.Specific || {};
    const parametri = item.Parametri || {};
    const baseParams = parametri.Base || {};
    const combatParams = parametri.Combattimento || {};
    const specialParams = parametri.Special || {}; // Get Special params

    // Image URL is now in General
    const imageUrl = general.image_url;
    const itemName = general.Nome || 'Oggetto Sconosciuto'; // Name is in General

    // Proactively load the image and set error state if it fails
    useEffect(() => {
        setImageError(false);
        if (imageUrl) {
            const img = new Image();
            img.onload = () => setImageError(false);
            img.onerror = () => {
                console.warn(`Failed to load image: ${imageUrl}`);
                setImageError(true);
            }
            img.src = imageUrl;
        } else {
            setImageError(true); // No image URL provided
        }
    }, [imageUrl]); // Depend on imageUrl

    // Define the field groups based on the NEW schema structure
    // 'itemGroup' now corresponds to 'Parametri.Special'
    const specialGroup = [
        { key: "Danno", label: "Danno" },
        { key: "Bonus Danno", label: "Bonus Danno" },
        { key: "Danno Critico", label: "Danno Critico" },
        { key: "Bonus Danno Critico", label: "Bonus Danno Critico" },
        { key: "Penetrazione", label: "Penetrazione" },
        { key: "ridCostoSpell", label: "Rid. Costo Spell" },
        { key: "ridCostoTec", label: "Rid. Costo Tec" },
        // Add other fields from Parametri.Special if they exist in the schema
    ];

    // Base group remains the same structure (Parametri.Base)
    const baseGroup = [
        { key: "Forza", label: "Forza" },
        { key: "Destrezza", label: "Destrezza" },
        { key: "Costituzione", label: "Costituzione" },
        { key: "Intelligenza", label: "Intelligenza" },
        { key: "Saggezza", label: "Saggezza" },
        { key: "Fortuna", label: "Fortuna" }
    ];

    // Combat group remains the same structure (Parametri.Combattimento)
    const combatGroup = [
        { key: "Attacco", label: "Attacco" },
        { key: "Difesa", label: "Difesa" },
        { key: "Mira", label: "Mira" },
        { key: "Disciplina", label: "Disciplina" },
        { key: "Salute", label: "Salute" },
        { key: "Critico", label: "Critico" },
        { key: "RiduzioneDanni", label: "Riduz. Danni" },
    ];

     // Helper function to render table cells for columns "1", "4", "7", "10"
    // 'data' is expected to be the object for a specific parameter (e.g., { "1": val1, "4": val2, ... })
    // 'isComputable' indicates if the value should be passed to computeValue (for Base/Combat)
    const renderRow = (data, isComputable = false) => {
        return ["1", "4", "7", "10"].map(col => (
            <td key={col} className="border border-gray-700 px-2 py-1 text-center text-xs">
                {data && data[col] != null && data[col] !== '' ? ( // Check for null/undefined/empty string
                    <>
                        {data[col]}
                        {/* Show computed value only for Base/Combat params */}
                         {isComputable && userParams && (
                            <span className="ml-1 text-gray-400">({computeValue(data[col], userParams)})</span>
                         )}
                    </>
                ) : (
                    '-' // Display hyphen if no value
                )}
            </td>
        ));
    };

    // Helper function to check if a parameter row has any data to display
    // 'data' is the object for a specific parameter (e.g., { "1": val1, ... })
    const shouldShowRow = (data) => {
        if (!data) return false;
        const columns = ["1", "4", "7", "10"];
        // Check if any level has a non-empty, non-null, non-undefined value
        return columns.some(col => data[col] != null && String(data[col]).trim() !== '');
    };


    // Filter the groups based on whether their rows have data
    // Access data from the correct nested structure (specialParams, baseParams, combatParams)
    const filteredSpecialGroup = specialGroup.filter(field => shouldShowRow(specialParams[field.key]));
    const filteredBaseGroup = baseGroup.filter(field => shouldShowRow(baseParams[field.key]));
    const filteredCombatGroup = combatGroup.filter(field => shouldShowRow(combatParams[field.key]));


    // --- Delete Handlers ---
    const handleDeleteClick = () => {
        setShowDeleteConfirmation(true);
    };

    const handleConfirmDelete = async () => {
        setShowDeleteConfirmation(false);
        console.log(`Attempting to delete item: ${item.id} (${itemName})`);
        try {
            // --- Delete Associated Storage Files ---

            // 1. Delete Item Image (from General.image_url)
            if (imageUrl) {
                try {
                    const path = decodeURIComponent(imageUrl.split('/o/')[1].split('?')[0]);
                    await deleteObject(ref(storage, path));
                    console.log(`Deleted item image: ${path}`);
                } catch (e) {
                    console.warn(`Failed to delete item image for "${itemName}":`, e.code === 'storage/object-not-found' ? 'File not found.' : e.message);
                }
            }

            // 2. Delete Spell Images/Videos (from General.spells)
            const itemSpells = general.spells; // Access spells from General
            if (itemSpells && typeof itemSpells === "object") {
                for (const spellName in itemSpells) {
                    const spell = itemSpells[spellName];
                    // Skip if it's just a boolean (linked spell) or not an object
                    if (!spell || typeof spell !== "object") continue;

                    // Delete spell image
                    if (spell.image_url) {
                        try {
                            const path = decodeURIComponent(spell.image_url.split('/o/')[1].split('?')[0]);
                            await deleteObject(ref(storage, path));
                            console.log(`Deleted spell image for ${spellName}: ${path}`);
                        } catch (e) {
                            console.warn(`Failed to delete spell image for "${spellName}":`, e.code === 'storage/object-not-found' ? 'File not found.' : e.message);
                        }
                    }
                    // Delete spell video
                    if (spell.video_url) {
                        try {
                            const path = decodeURIComponent(spell.video_url.split('/o/')[1].split('?')[0]);
                            await deleteObject(ref(storage, path));
                            console.log(`Deleted spell video for ${spellName}: ${path}`);
                        } catch (e) {
                            console.warn(`Failed to delete spell video for "${spellName}":`, e.code === 'storage/object-not-found' ? 'File not found.' : e.message);
                        }
                    }
                }
            }

            // --- Delete Firestore Document ---
            await deleteDoc(doc(db, "items", item.id));
            console.log("Item document deleted successfully from Firestore.");

            if (showMessage) showMessage(`"${itemName}" eliminato con successo.`);

        } catch (error) {
            console.error("Error deleting item:", error);
            if (showMessage) showMessage(`Errore durante l'eliminazione di "${itemName}".`);
        }
    };

    const handleCancelDelete = () => {
        setShowDeleteConfirmation(false);
    };

    // --- Edit Handlers ---
    const handleEditClick = () => {
        // Pass the raw item data (which should have the new structure)
        console.log("Editing item with new schema:", item);
        setShowEditOverlay(true);
    };

    const handleCloseEditOverlay = (success) => {
        setShowEditOverlay(false);
        // Success message is handled within AddWeaponOverlay
    };

    // Check if user has admin roles
    const isAdmin = userData?.role === 'webmaster' || userData?.role === 'dm';

    return (
        <>
            <motion.div
                key={item.id} // Use item ID as key
                initial={{ x: 300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 300, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="p-0 overflow-y-auto z-50 rounded-l-lg overflow-hidden shadow-2xl border-l border-gray-700"
                style={{ width: '100%' }}
            >
                <div className="relative h-full bg-gray-900">
                    {/* Confirmation Dialog */}
                    {showDeleteConfirmation && (
                        <div className="absolute inset-0 flex items-center justify-center z-40 bg-black bg-opacity-80 p-4">
                            <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 text-center">
                                <p className="text-white mb-4">Sei sicuro di voler eliminare <br />"{itemName}"?</p>
                                <div className="flex justify-center space-x-3">
                                    <button onClick={handleCancelDelete} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors">Annulla</button>
                                    <button onClick={handleConfirmDelete} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors">Elimina</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Admin Buttons: Edit and Delete */}
                    {isAdmin && (
                        <div className="absolute top-2 right-2 z-30 flex space-x-2">
                            <button onClick={handleEditClick} title="Modifica Oggetto" className="p-1.5 bg-gray-700 bg-opacity-70 rounded-full hover:bg-blue-600 transition-colors">
                                <FaEdit className="w-4 h-4 text-blue-300 hover:text-white" />
                            </button>
                            <button onClick={handleDeleteClick} title="Elimina Oggetto" className="p-1.5 bg-gray-700 bg-opacity-70 rounded-full hover:bg-red-600 transition-colors">
                                <FaTrash className="w-4 h-4 text-red-400 hover:text-white" />
                            </button>
                        </div>
                    )}

                    {/* Background image container */}
                    <div className="h-40 w-full relative overflow-hidden">
                        {!imageError && imageUrl ? (
                            <img src={imageUrl} alt={itemName} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                                <div className="text-6xl text-gray-600 font-bold opacity-50 select-none">
                                    {itemName?.charAt(0)?.toUpperCase() || "?"}
                                </div>
                            </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/70 to-transparent"></div>
                    </div>


                    {/* Content Area */}
                    <div className="relative z-10 p-4 pt-0 -mt-8">
                        <h2 className="text-xl font-bold text-white mb-3">{itemName}</h2>
                        {/* Display general and specific info */}
                        <div className="mb-4 space-y-1 text-sm text-gray-300">
                            <p><span className="font-semibold text-gray-100">Tipo:</span> {specific.Tipo || '-'}</p>
                            <p><span className="font-semibold text-gray-100">Hands:</span> {specific.Hands != null ? specific.Hands : '-'}</p>
                            <p><span className="font-semibold text-gray-100">Slot:</span> {general.Slot || '-'}</p>
                            <p><span className="font-semibold text-gray-100">Effetto:</span> {general.Effetto || '-'}</p>
                            <p><span className="font-semibold text-gray-100">Requisiti:</span> {general.requisiti || '-'}</p>
                             {/* Ensure price is displayed correctly (should be number in DB) */}
                            <p><span className="font-semibold text-gray-100">Prezzo:</span> {general.prezzo != null ? general.prezzo : '-'}</p>
                        </div>

                        {/* Parameter Tables */}
                         {(filteredSpecialGroup.length > 0 || filteredBaseGroup.length > 0 || filteredCombatGroup.length > 0) && (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-xs text-white border-collapse border border-gray-700">
                                    <thead>
                                        <tr className="bg-gray-700/50">
                                            <th className="px-2 py-1 text-left font-semibold border-r border-gray-700">Parametro</th>
                                            <th className="border-r border-gray-700 px-2 py-1 font-semibold">Lvl 1</th>
                                            <th className="border-r border-gray-700 px-2 py-1 font-semibold">Lvl 4</th>
                                            <th className="border-r border-gray-700 px-2 py-1 font-semibold">Lvl 7</th>
                                            <th className="px-2 py-1 font-semibold">Lvl 10</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {/* Special Params (from Parametri.Special) */}
                                        {filteredSpecialGroup.length > 0 && (
                                            <>
                                                <tr className="bg-gray-800/30"><td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">Speciali</td></tr>
                                                {filteredSpecialGroup.map(field => (
                                                    <tr key={`special-${field.key}`} className="border-b border-gray-700 hover:bg-gray-700/30">
                                                        <td className="px-2 py-1 border-r border-gray-700">{field.label}</td>
                                                         {/* Render row using data from specialParams, not computable */}
                                                        {renderRow(specialParams[field.key], false)}
                                                    </tr>
                                                ))}
                                            </>
                                        )}
                                        {/* Base Params (from Parametri.Base) */}
                                        {filteredBaseGroup.length > 0 && (
                                            <>
                                                <tr className="bg-gray-800/30"><td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">Base</td></tr>
                                                {filteredBaseGroup.map(field => (
                                                    <tr key={`base-${field.key}`} className="border-b border-gray-700 hover:bg-gray-700/30">
                                                        <td className="px-2 py-1 border-r border-gray-700">{field.label}</td>
                                                        {/* Render row using data from baseParams, IS computable */}
                                                        {renderRow(baseParams[field.key], true)}
                                                    </tr>
                                                ))}
                                            </>
                                        )}
                                        {/* Combat Params (from Parametri.Combattimento) */}
                                        {filteredCombatGroup.length > 0 && (
                                            <>
                                                <tr className="bg-gray-800/30"><td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">Combattimento</td></tr>
                                                {filteredCombatGroup.map(field => (
                                                    <tr key={`combat-${field.key}`} className="border-b border-gray-700 hover:bg-gray-700/30">
                                                        <td className="px-2 py-1 border-r border-gray-700">{field.label}</td>
                                                        {/* Render row using data from combatParams, IS computable */}
                                                        {renderRow(combatParams[field.key], true)}
                                                    </tr>
                                                ))}
                                            </>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}

                         {/* Display Spells if they exist (from General.spells) */}
                        {general.spells && Object.keys(general.spells).length > 0 && (
                            <div className="mt-4">
                                <h3 className="text-md font-semibold text-white mb-2">Spells Conferiti</h3>
                                <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                                    {Object.entries(general.spells).map(([spellName, spellData]) => (
                                        <li key={spellName}>
                                            {spellName}
                                            {/* Show details only if spellData is a full object (custom spell) */}
                                            {typeof spellData === 'object' && spellData.Costo && (
                                                <span className="text-xs text-gray-400 ml-2">(Costo: {spellData.Costo})</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>

            {/* Edit Overlay - Rendered Conditionally */}
            {showEditOverlay && (
                <AddWeaponOverlay
                    onClose={handleCloseEditOverlay}
                    showMessage={showMessage || console.log} // Pass down showMessage
                    initialData={item} // Pass the full item data (with new structure)
                    editMode={true} // Indicate edit mode
                />
            )}
        </>
    );
}