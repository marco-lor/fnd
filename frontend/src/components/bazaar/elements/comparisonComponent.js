// file: ./frontend/src/components/bazaar/elements/comparisonComponent.js
import React, { useContext, useState, useEffect } from 'react';
import { motion } from 'framer-motion'; // Keep motion for potential internal animations if needed later
import { deleteDoc, doc, onSnapshot, getDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { db, storage } from "../../firebaseConfig";
import { computeValue } from '../../common/computeFormula';
import { AuthContext } from "../../../AuthContext";
import { AddWeaponOverlay } from './addWeapon';
import { FaTrash, FaEdit } from "react-icons/fa";

export default function ComparisonPanel({ item, showMessage }) {
    const { user } = useContext(AuthContext);
    const [userData, setUserData] = useState(null);
    const [userParams, setUserParams] = useState({ Base: {}, Combattimento: {} });
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [showEditOverlay, setShowEditOverlay] = useState(false);
    const [imageError, setImageError] = useState(false);

    useEffect(() => {
        if (user) {
            const userRef = doc(db, "users", user.uid);
            const unsubscribeUser = onSnapshot(
                userRef,
                (docSnap) => {
                    if (docSnap.exists()) {
                        setUserData(docSnap.data());
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

    const general = item.General || {};
    const specific = item.Specific || {};
    const parametri = item.Parametri || {};
    const baseParams = parametri.Base || {};
    const combatParams = parametri.Combattimento || {};
    const specialParams = parametri.Special || {};

    const imageUrl = general.image_url;
    const itemName = general.Nome || 'Oggetto Sconosciuto';

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
            setImageError(true);
        }
    }, [imageUrl]);

    const specialGroup = [
        { key: "Danno", label: "Danno" },
        { key: "Bonus Danno", label: "Bonus Danno" },
        { key: "Danno Critico", label: "Danno Critico" },
        { key: "Bonus Danno Critico", label: "Bonus Danno Critico" },
        { key: "Penetrazione", label: "Penetrazione" },
        { key: "ridCostoSpell", label: "Rid. Costo Spell" },
        { key: "ridCostoTec", label: "Rid. Costo Tec" },
    ];

    const baseGroup = [
        { key: "Forza", label: "Forza" },
        { key: "Destrezza", label: "Destrezza" },
        { key: "Costituzione", label: "Costituzione" },
        { key: "Intelligenza", label: "Intelligenza" },
        { key: "Saggezza", label: "Saggezza" },
        { key: "Fortuna", label: "Fortuna" }
    ];

    const combatGroup = [
        { key: "Attacco", label: "Attacco" },
        { key: "Difesa", label: "Difesa" },
        { key: "Mira", label: "Mira" },
        { key: "Disciplina", label: "Disciplina" },
        { key: "Salute", label: "Salute" },
        { key: "Critico", label: "Critico" },
        { key: "RiduzioneDanni", label: "Riduz. Danni" },
    ];

    const renderRow = (data, isComputable = false) => {
        return ["1", "4", "7", "10"].map(col => (
            <td key={col} className="border border-gray-700 px-2 py-1 text-center text-xs">
                {data && data[col] != null && data[col] !== '' ? (
                    <>
                        {data[col]}
                         {isComputable && userParams && (
                            <span className="ml-1 text-gray-400">({computeValue(data[col], userParams)})</span>
                         )}
                    </>
                ) : (
                    '-'
                )}
            </td>
        ));
    };

    const shouldShowRow = (data) => {
        if (!data) return false;
        const columns = ["1", "4", "7", "10"];
        return columns.some(col => data[col] != null && String(data[col]).trim() !== '');
    };

    const filteredSpecialGroup = specialGroup.filter(field => shouldShowRow(specialParams[field.key]));
    const filteredBaseGroup = baseGroup.filter(field => shouldShowRow(baseParams[field.key]));
    const filteredCombatGroup = combatGroup.filter(field => shouldShowRow(combatParams[field.key]));

    const handleDeleteClick = () => {
        setShowDeleteConfirmation(true);
    };

    const handleConfirmDelete = async () => {
        setShowDeleteConfirmation(false);
        console.log(`Attempting to delete item: ${item.id} (${itemName})`);
        try {
            if (imageUrl) {
                try {
                    const path = decodeURIComponent(imageUrl.split('/o/')[1].split('?')[0]);
                    await deleteObject(ref(storage, path));
                    console.log(`Deleted item image: ${path}`);
                } catch (e) {
                    console.warn(`Failed to delete item image for "${itemName}":`, e.code === 'storage/object-not-found' ? 'File not found.' : e.message);
                }
            }

            const itemSpells = general.spells;
            if (itemSpells && typeof itemSpells === "object") {
                for (const spellName in itemSpells) {
                    const spell = itemSpells[spellName];
                    if (!spell || typeof spell !== "object") continue;

                    if (spell.image_url) {
                        try {
                            const path = decodeURIComponent(spell.image_url.split('/o/')[1].split('?')[0]);
                            await deleteObject(ref(storage, path));
                            console.log(`Deleted spell image for ${spellName}: ${path}`);
                        } catch (e) {
                            console.warn(`Failed to delete spell image for "${spellName}":`, e.code === 'storage/object-not-found' ? 'File not found.' : e.message);
                        }
                    }
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

    const handleEditClick = () => {
        console.log("Editing item with new schema:", item);
        setShowEditOverlay(true);
    };

    const handleCloseEditOverlay = (success) => {
        setShowEditOverlay(false);
    };

    const isAdmin = userData?.role === 'webmaster' || userData?.role === 'dm';

    return (
        <>
            {/* The main motion.div wrapper is now in Bazaar.js */}
            {/* This component now fills its parent container */}
            <div
                className="w-full h-full p-0 overflow-y-auto rounded-l-lg shadow-2xl border-l border-gray-700 bg-gray-900 flex flex-col" // Ensure it fills height and is a flex column
            >
                <div className="relative flex-shrink-0"> {/* Container for image and admin buttons */}
                    {/* Confirmation Dialog */}
                    {showDeleteConfirmation && (
                        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black bg-opacity-80 p-4"> {/* z-index increased */}
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
                        <div className="absolute top-3 right-3 z-40 flex space-x-2"> {/* z-index adjusted */}
                            <button onClick={handleEditClick} title="Modifica Oggetto" className="p-1.5 bg-gray-700 bg-opacity-70 rounded-full hover:bg-blue-600 transition-colors">
                                <FaEdit className="w-4 h-4 text-blue-300 hover:text-white" />
                            </button>
                            <button onClick={handleDeleteClick} title="Elimina Oggetto" className="p-1.5 bg-gray-700 bg-opacity-70 rounded-full hover:bg-red-600 transition-colors">
                                <FaTrash className="w-4 h-4 text-red-400 hover:text-white" />
                            </button>
                        </div>
                    )}

                    {/* Enhanced Background image container */}
                    <div className="h-48 w-full relative overflow-hidden group"> {/* Increased height, added group for zoom */}
                        {!imageError && imageUrl ? (
                            <>
                                <img
                                    src={imageUrl}
                                    alt={itemName}
                                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-in-out group-hover:scale-105" // Zoom effect
                                />
                                <div className="absolute inset-0 bg-black opacity-10 group-hover:opacity-5 transition-opacity duration-300"></div> {/* Very light opaque layer */}
                                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-gray-900 via-gray-900/80 to-transparent"></div> {/* Fade out at the bottom */}
                            </>
                        ) : (
                            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                                <div className="text-6xl text-gray-600 font-bold opacity-50 select-none">
                                    {itemName?.charAt(0)?.toUpperCase() || "?"}
                                </div>
                            </div>
                        )}
                         {/* Gradient overlay for text readability, placed above image but below title/buttons if any were on image */}
                        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent"></div>
                    </div>
                </div>


                {/* Content Area - Takes remaining space and scrolls */}
                <div className="relative z-10 p-4 pt-2 -mt-10 flex-grow overflow-y-auto"> {/* -mt-10 to pull content slightly over the image gradient */}
                    <h2 className="text-xl font-bold text-white mb-3 relative">{itemName}</h2> {/* Ensure title is above gradient */}
                    <div className="mb-4 space-y-1 text-sm text-gray-300">
                        <p><span className="font-semibold text-gray-100">Tipo:</span> {specific.Tipo || '-'}</p>
                        <p><span className="font-semibold text-gray-100">Hands:</span> {specific.Hands != null ? specific.Hands : '-'}</p>
                        <p><span className="font-semibold text-gray-100">Slot:</span> {general.Slot || '-'}</p>
                        <p><span className="font-semibold text-gray-100">Effetto:</span> {general.Effetto || '-'}</p>
                        <p><span className="font-semibold text-gray-100">Requisiti:</span> {general.requisiti || '-'}</p>
                        <p><span className="font-semibold text-gray-100">Prezzo:</span> {general.prezzo != null ? general.prezzo : '-'}</p>
                    </div>

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
                                    {filteredSpecialGroup.length > 0 && (
                                        <>
                                            <tr className="bg-gray-800/30"><td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">Speciali</td></tr>
                                            {filteredSpecialGroup.map(field => (
                                                <tr key={`special-${field.key}`} className="border-b border-gray-700 hover:bg-gray-700/30">
                                                    <td className="px-2 py-1 border-r border-gray-700">{field.label}</td>
                                                    {renderRow(specialParams[field.key], false)}
                                                </tr>
                                            ))}
                                        </>
                                    )}
                                    {filteredBaseGroup.length > 0 && (
                                        <>
                                            <tr className="bg-gray-800/30"><td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">Base</td></tr>
                                            {filteredBaseGroup.map(field => (
                                                <tr key={`base-${field.key}`} className="border-b border-gray-700 hover:bg-gray-700/30">
                                                    <td className="px-2 py-1 border-r border-gray-700">{field.label}</td>
                                                    {renderRow(baseParams[field.key], true)}
                                                </tr>
                                            ))}
                                        </>
                                    )}
                                    {filteredCombatGroup.length > 0 && (
                                        <>
                                            <tr className="bg-gray-800/30"><td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">Combattimento</td></tr>
                                            {filteredCombatGroup.map(field => (
                                                <tr key={`combat-${field.key}`} className="border-b border-gray-700 hover:bg-gray-700/30">
                                                    <td className="px-2 py-1 border-r border-gray-700">{field.label}</td>
                                                    {renderRow(combatParams[field.key], true)}
                                                </tr>
                                            ))}
                                        </>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {general.spells && Object.keys(general.spells).length > 0 && (
                        <div className="mt-4">
                            <h3 className="text-md font-semibold text-white mb-2">Spells Conferiti</h3>
                            <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                                {Object.entries(general.spells).map(([spellName, spellData]) => (
                                    <li key={spellName}>
                                        {spellName}
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

            {showEditOverlay && (
                <AddWeaponOverlay
                    onClose={handleCloseEditOverlay}
                    showMessage={showMessage || console.log}
                    initialData={item}
                    editMode={true}
                />
            )}
        </>
    );
}