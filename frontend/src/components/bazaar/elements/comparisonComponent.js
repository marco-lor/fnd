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
                        setUserParams(docSnap.data().Parametri || { Base: {}, Combattimento: {} }); // Also set params here
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

            // Cleanup listener
            return () => unsubscribeUser();
        } else {
            // Reset state if user logs out
            setUserData(null);
            setUserParams({ Base: {}, Combattimento: {} });
        }
    }, [user]);


    // Destructure nested parameters if present
    const parametri = item.Parametri || {};
    const baseParams = parametri.Base || {};
    const combatParams = parametri.Combattimento || {};

    // Proactively load the image and set error state if it fails
    useEffect(() => {
        setImageError(false); // Reset error state when item changes
        if (item.image_url) {
            const img = new Image();
            img.onload = () => setImageError(false);
            img.onerror = () => {
                console.warn(`Failed to load image: ${item.image_url}`);
                setImageError(true);
            }
            img.src = item.image_url;
        } else {
            setImageError(true);
        }
    }, [item.image_url]);

    // Define the field groups with their display order and labels
    const itemGroup = [
        { key: "Penetrazione", label: "Penetrazione" },
        { key: "Danno", label: "Danno" },
        { key: "Bonus Danno", label: "Bonus Danno" },
        { key: "Danno Critico", label: "Danno Critico" },
        { key: "Bonus Danno Critico", label: "Bonus Danno Critico" }
    ];

    const baseGroup = [
        { key: "Fortuna", label: "Fortuna" },
        { key: "Destrezza", label: "Destrezza" },
        { key: "Costituzione", label: "Costituzione" },
        { key: "Intelligenza", label: "Intelligenza" },
        { key: "Saggezza", label: "Saggezza" },
        { key: "Forza", label: "Forza" }
    ];

    const combatGroup = [
        { key: "Difesa", label: "Difesa" },
        { key: "Salute", label: "Salute" },
        { key: "Critico", label: "Critico" },
        { key: "Attacco", label: "Attacco" },
        { key: "RiduzioneDanni", label: "Riduz. Danni" },
        { key: "Disciplina", label: "Disciplina" },
        { key: "Mira", label: "Mira" }
    ];

    // Helper function to render table cells for columns "1", "4", "7", "10"
    const renderRow = (data, isParam = false) => { // Added isParam flag
        return ["1", "4", "7", "10"].map(col => (
            <td key={col} className="border border-gray-700 px-2 py-1 text-center text-xs"> {/* Adjusted styling */}
                {data && data[col] ? (
                    <>
                        {data[col]}
                        {/* Only show computed value for Base/Combat params */}
                        {isParam && <span className="ml-1 text-gray-400">({computeValue(data[col], userParams)})</span>}
                    </>
                ) : '-'
                }
            </td>
        ));
    };

    // Helper function to check if row should be displayed
    const shouldShowRow = (data) => {
        if (!data) return false;
        const columns = ["1", "4", "7", "10"];
        return columns.some(col => data[col] !== undefined && data[col] !== '-' && data[col] !== null && String(data[col]).trim() !== '');
    };

    // Filter the groups based on row values
    const filteredItemGroup = itemGroup.filter(field => shouldShowRow(item[field.key]));
    const filteredBaseGroup = baseGroup.filter(field => shouldShowRow(baseParams[field.key]));
    const filteredCombatGroup = combatGroup.filter(field => shouldShowRow(combatParams[field.key]));

    // --- Delete Handlers ---
    const handleDeleteClick = () => {
        setShowDeleteConfirmation(true);
    };

    const handleConfirmDelete = async () => {
        setShowDeleteConfirmation(false); // Close confirmation immediately
        console.log(`Attempting to delete item: ${item.id} (${item.Nome})`);
        try {
            // --- Delete Associated Storage Files ---

            // 1. Delete Item Image
            if (item.image_url) {
                try {
                    const path = decodeURIComponent(item.image_url.split('/o/')[1].split('?')[0]);
                    await deleteObject(ref(storage, path));
                    console.log(`Deleted item image: ${path}`);
                } catch (e) {
                    // Log error but continue, maybe file doesn't exist or permissions issue
                    console.warn(`Failed to delete item image for "${item.Nome}":`, e.code === 'storage/object-not-found' ? 'File not found.' : e.message);
                }
            }

            // 2. Delete Spell Images/Videos (only for spells defined within the item)
            if (item.spells && typeof item.spells === "object") {
                for (const spellName in item.spells) {
                    const spell = item.spells[spellName];
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

            // Optional: Show success message via prop if available
            if (showMessage) showMessage(`"${item.Nome}" eliminato con successo.`);

        } catch (error) {
            console.error("Error deleting item:", error);
            // Optional: Show error message
            if (showMessage) showMessage(`Errore durante l'eliminazione di "${item.Nome}".`);
        }
    };

    const handleCancelDelete = () => {
        setShowDeleteConfirmation(false);
    };

    // --- Edit Handlers ---
    const handleEditClick = () => {
        console.log("Editing item:", item); // Log item data being passed
        setShowEditOverlay(true);
    };

    const handleCloseEditOverlay = (success) => {
        setShowEditOverlay(false);
        if (success) {
            // The message is now handled within AddWeaponOverlay's save function
            // if (showMessage) showMessage(`"${item.Nome}" aggiornato con successo!`);
        }
    };

    // Check if user has admin roles
    const isAdmin = userData?.role === 'webmaster' || userData?.role === 'dm';

    return (
        <>
            <motion.div
                key={item.id} // Add key for proper animation updates when item changes
                initial={{ x: 300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 300, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="fixed right-0 p-0 overflow-y-auto z-50 rounded-l-lg overflow-hidden shadow-2xl border-l border-gray-700" // Added border and shadow
                style={{
                    top: '10rem', // Adjusted top position
                    width: '28vw', // Slightly wider
                    maxWidth: '450px', // Max width
                    height: 'calc(100vh - 12rem)', // Adjusted height
                    maxHeight: '700px' // Max height
                }}
            >
                <div className="relative h-full bg-gray-900"> {/* Base background */}
                    {/* Confirmation Dialog */}
                    {showDeleteConfirmation && (
                        <div className="absolute inset-0 flex items-center justify-center z-40 bg-black bg-opacity-80 p-4">
                            <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 text-center">
                                <p className="text-white mb-4">Sei sicuro di voler eliminare <br />"{item.Nome}"?</p>
                                <div className="flex justify-center space-x-3">
                                    <button
                                        onClick={handleCancelDelete}
                                        className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                                    >
                                        Annulla
                                    </button>
                                    <button
                                        onClick={handleConfirmDelete}
                                        className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                                    >
                                        Elimina
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Admin Buttons: Edit and Delete */}
                    {isAdmin && (
                        <div className="absolute top-2 right-2 z-30 flex space-x-2">
                            {/* Edit Button */}
                            <button
                                onClick={handleEditClick}
                                title="Modifica Oggetto" // Tooltip
                                className="p-1.5 bg-gray-700 bg-opacity-70 rounded-full hover:bg-blue-600 transition-colors"
                            >
                                <FaEdit className="w-4 h-4 text-blue-300 hover:text-white" />
                            </button>
                            {/* Delete Button */}
                            <button
                                onClick={handleDeleteClick}
                                title="Elimina Oggetto" // Tooltip
                                className="p-1.5 bg-gray-700 bg-opacity-70 rounded-full hover:bg-red-600 transition-colors"
                            >
                                <FaTrash className="w-4 h-4 text-red-400 hover:text-white" />
                            </button>
                        </div>
                    )}

                    {/* Background image container */}
                    <div className="h-40 w-full relative overflow-hidden"> {/* Fixed height for image area */}
                        {!imageError && item.image_url ? (
                            <img
                                src={item.image_url}
                                alt={item.Nome || 'Item Image'}
                                className="absolute inset-0 w-full h-full object-cover" // Use img tag for better control
                            />
                        ) : (
                            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                                <div className="text-6xl text-gray-600 font-bold opacity-50 select-none">
                                    {item.Nome?.charAt(0)?.toUpperCase() || "?"}
                                </div>
                            </div>
                        )}
                        {/* Gradient overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/70 to-transparent"></div>
                    </div>


                    {/* Content Area */}
                    <div className="relative z-10 p-4 pt-0 -mt-8"> {/* Adjust padding and margin */}
                        <h2 className="text-xl font-bold text-white mb-3">{item.Nome}</h2>
                        <div className="mb-4 space-y-1 text-sm text-gray-300"> {/* Adjusted text size */}
                            <p><span className="font-semibold text-gray-100">Tipo:</span> {item.Tipo || '-'}</p>
                            <p><span className="font-semibold text-gray-100">Hands:</span> {item.Hands || '-'}</p>
                            <p><span className="font-semibold text-gray-100">Slot:</span> {item.Slot || '-'}</p>
                            <p><span className="font-semibold text-gray-100">Effetto:</span> {item.Effetto || '-'}</p>
                            <p><span className="font-semibold text-gray-100">Requisiti:</span> {item.requisiti || '-'}</p>
                            <p><span className="font-semibold text-gray-100">Prezzo:</span> {item.prezzo != null ? item.prezzo : '-'}</p> {/* Handle price */}
                        </div>

                        {/* Tables */}
                        {(filteredItemGroup.length > 0 || filteredBaseGroup.length > 0 || filteredCombatGroup.length > 0) && (
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
                                        {/* Item Specific Params */}
                                        {filteredItemGroup.length > 0 && (
                                            <>
                                                <tr className="bg-gray-800/30"><td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">Speciali</td></tr>
                                                {filteredItemGroup.map(field => (
                                                    <tr key={field.key} className="border-b border-gray-700 hover:bg-gray-700/30">
                                                        <td className="px-2 py-1 border-r border-gray-700">{field.label}</td>
                                                        {renderRow(item[field.key], false)} {/* isParam = false */}
                                                    </tr>
                                                ))}
                                            </>
                                        )}
                                        {/* Base Params */}
                                        {filteredBaseGroup.length > 0 && (
                                            <>
                                                <tr className="bg-gray-800/30"><td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">Base</td></tr>
                                                {filteredBaseGroup.map(field => (
                                                    <tr key={field.key} className="border-b border-gray-700 hover:bg-gray-700/30">
                                                        <td className="px-2 py-1 border-r border-gray-700">{field.label}</td>
                                                        {renderRow(baseParams[field.key], true)} {/* isParam = true */}
                                                    </tr>
                                                ))}
                                            </>
                                        )}
                                        {/* Combat Params */}
                                        {filteredCombatGroup.length > 0 && (
                                            <>
                                                <tr className="bg-gray-800/30"><td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">Combattimento</td></tr>
                                                {filteredCombatGroup.map(field => (
                                                    <tr key={field.key} className="border-b border-gray-700 hover:bg-gray-700/30">
                                                        <td className="px-2 py-1 border-r border-gray-700">{field.label}</td>
                                                        {renderRow(combatParams[field.key], true)} {/* isParam = true */}
                                                    </tr>
                                                ))}
                                            </>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                          {/* Display Spells if they exist */}
                        {item.spells && Object.keys(item.spells).length > 0 && (
                            <div className="mt-4">
                                <h3 className="text-md font-semibold text-white mb-2">Spells Conferiti</h3>
                                <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                                    {Object.entries(item.spells).map(([spellName, spellData]) => (
                                        <li key={spellName}>
                                            {spellName}
                                            {/* Optionally show more spell details if spellData is an object */}
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
                    showMessage={showMessage || console.log} // Pass down showMessage or default to console.log
                    initialData={item} // Pass the current item data
                    editMode={true} // Indicate that it's in edit mode
                />
            )}
        </>
    );
}
