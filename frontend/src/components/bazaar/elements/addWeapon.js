// file: ./frontend/src/components/bazaar/elements/addWeapon.js
import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { db, storage } from '../../firebaseConfig';
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { AuthContext } from '../../../AuthContext';
import { computeValue } from '../../common/computeFormula';
import { AddSpellButton } from '../../dmDashboard/elements/buttons/addSpell';
import { SpellOverlay } from '../../common/SpellOverlay';
import { WeaponOverlay } from '../../common/WeaponOverlay';
import { FaTrash, FaEdit } from "react-icons/fa";

export function AddWeaponOverlay({ onClose, showMessage, initialData = null, editMode = false }) {
    const [schema, setSchema] = useState(null);
    const [weaponFormData, setWeaponFormData] = useState({
        General: {},
        Specific: {},
        Parametri: { Base: {}, Combattimento: {}, Special: {} }
    });
    const [imageFile, setImageFile] = useState(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSchemaLoading, setIsSchemaLoading] = useState(true);

    const { user } = useContext(AuthContext);
    const [userParams, setUserParams] = useState({ Base: {}, Combattimento: {} });
    const [userName, setUserName] = useState("");
    const [spellSchema, setSpellSchema] = useState(null);

    const [tecnicheList, setTecnicheList] = useState([]);
    const [ridTecnicheList, setRidTecnicheList] = useState([]);
    const [spellsList, setSpellsList] = useState([]);
    const [ridSpellList, setRidSpellList] = useState([]);
    const [weaponSpellsList, setWeaponSpellsList] = useState([]);

    const [showSpellOverlay, setShowSpellOverlay] = useState(false);
    const [customSpells, setCustomSpells] = useState([]);
    const [editingSpellIndex, setEditingSpellIndex] = useState(null);

    // Refs to manage initialization logic
    const prevInitialDataIdRef = useRef(null);
    const formInitializedForCurrentItem = useRef(false);


    const addTecnica = useCallback(() => setRidTecnicheList(prev => [...prev, { selectedTec: '', ridValue: '' }]), []);
    const removeTecnica = useCallback(index => setRidTecnicheList(prev => prev.filter((_, i) => i !== index)), []);
    const addSpell = useCallback(() => setRidSpellList(prev => [...prev, { selectedSpell: '', ridValue: '' }]), []);
    const removeSpell = useCallback(index => setRidSpellList(prev => prev.filter((_, i) => i !== index)), []);
    const addWeaponSpellLink = useCallback(() => setWeaponSpellsList(prev => [...prev, '']), []);
    const removeWeaponSpellLink = useCallback(index => setWeaponSpellsList(prev => prev.filter((_, i) => i !== index)), []);

    const initializeFormData = useCallback((schemaData, currentItemData) => {
        console.log("Attempting to initialize FormData. Edit Mode:", editMode, "Current Item Data:", currentItemData);
        let initialFormState = {
            General: {},
            Specific: {},
            Parametri: { Base: {}, Combattimento: {}, Special: {} }
        };

        const getValue = (category, field, defaultValue = '') => {
            return currentItemData?.[category]?.[field] ?? defaultValue;
        };

        const getParamValue = (paramCategory, paramField, level, defaultValue = '') => {
            return currentItemData?.Parametri?.[paramCategory]?.[paramField]?.[level] ?? defaultValue;
        };

        for (const field of Object.keys(schemaData.General || {})) {
            let defaultValue = schemaData.General[field];
            if (field === "Slot" && Array.isArray(defaultValue)) defaultValue = defaultValue[0] || '';
            else if (typeof defaultValue === 'object' && !Array.isArray(defaultValue) && defaultValue !== null) defaultValue = {};
            else if (field === "prezzo") defaultValue = '0';
            else if (typeof defaultValue !== 'string') defaultValue = '';
            initialFormState.General[field] = getValue("General", field, defaultValue);
            if (field === 'prezzo' && typeof initialFormState.General[field] === 'number') {
                initialFormState.General[field] = String(initialFormState.General[field]);
            }
        }

        for (const field of Object.keys(schemaData.Specific || {})) {
            let defaultValue = schemaData.Specific[field];
            if (Array.isArray(defaultValue)) defaultValue = defaultValue[0] ?? '';
            else defaultValue = '';
            initialFormState.Specific[field] = getValue("Specific", field, defaultValue);
            if (field === 'Hands' && initialFormState.Specific[field] !== undefined) {
                initialFormState.Specific[field] = String(initialFormState.Specific[field]);
            }
        }

        const levels = ["1", "4", "7", "10"];
        for (const paramCategory of Object.keys(schemaData.Parametri || {})) {
            initialFormState.Parametri[paramCategory] = {};
            for (const paramField of Object.keys(schemaData.Parametri[paramCategory] || {})) {
                initialFormState.Parametri[paramCategory][paramField] = {};
                for (const level of levels) {
                    let schemaVal = schemaData.Parametri[paramCategory][paramField]?.[level];
                    const defaultValue = (schemaVal === 0) ? '' : (schemaVal ?? '');
                    initialFormState.Parametri[paramCategory][paramField][level] = getParamValue(paramCategory, paramField, level, defaultValue);
                }
            }
        }

        setWeaponFormData(initialFormState); // Set the main form data

        // Populate dynamic lists and image based on currentItemData
        if (currentItemData) {
            setRidTecnicheList(currentItemData.General?.ridCostoTecSingola ?
                Object.entries(currentItemData.General.ridCostoTecSingola).map(([tec, val]) => ({ selectedTec: tec, ridValue: String(val) })) : []
            );
            setRidSpellList(currentItemData.General?.ridCostoSpellSingola ?
                Object.entries(currentItemData.General.ridCostoSpellSingola).map(([spell, val]) => ({ selectedSpell: spell, ridValue: String(val) })) : []
            );

            // *** MODIFIED SPELL INITIALIZATION LOGIC ***
            // Only set customSpells and weaponSpellsList from currentItemData if the item ID has changed
            // or if formInitializedForCurrentItem.current was false (meaning it's the first init for this item).
            // This check is now primarily handled by the calling useEffect.
            // Here, we assume if currentItemData is provided, we are setting based on it,
            // but the calling useEffect prevents this from overwriting local changes.
            const initialLinkedSpells = [];
            const initialCustomSpellsFromData = [];
            if (currentItemData.General?.spells && typeof currentItemData.General.spells === 'object') {
                Object.entries(currentItemData.General.spells).forEach(([name, data]) => {
                    if (data === true) {
                        initialLinkedSpells.push(name);
                    } else if (typeof data === 'object') {
                        initialCustomSpellsFromData.push({ spellData: data, imageFile: null, videoFile: null });
                    }
                });
            }
            setWeaponSpellsList(initialLinkedSpells);
            setCustomSpells(initialCustomSpellsFromData);


            if (currentItemData.General?.image_url) {
                setImagePreviewUrl(currentItemData.General.image_url);
            } else {
                setImagePreviewUrl(null);
            }
            setImageFile(null);
        } else { // New item
            setRidTecnicheList([]);
            setRidSpellList([]);
            setWeaponSpellsList([]);
            setCustomSpells([]);
            setImagePreviewUrl(null);
            setImageFile(null);
        }

        initialFormState.General = initialFormState.General || {};
        initialFormState.Specific = initialFormState.Specific || {};
        initialFormState.Parametri = initialFormState.Parametri || { Base: {}, Combattimento: {}, Special: {} };
        initialFormState.General.spells = initialFormState.General.spells || {};

        console.log("Initialized FormData:", initialFormState);

    }, [editMode]); // Removed customSpells.length, parent useEffect controls re-init

    useEffect(() => {
        setIsSchemaLoading(true);
        const fetchWeaponSchema = async () => {
            try {
                const schemaDocRef = doc(db, "utils", "schema_weapon");
                const docSnap = await getDoc(schemaDocRef);
                if (docSnap.exists()) {
                    setSchema(docSnap.data());
                } else {
                    console.error("Weapon schema (schema_weapon) not found!");
                    if (showMessage) showMessage("Errore: Schema arma non trovato.", "error");
                }
            } catch (error) {
                console.error("Error fetching weapon schema:", error);
                if (showMessage) showMessage("Errore nel caricamento dello schema.", "error");
            } finally {
                setIsSchemaLoading(false);
            }
        };
        fetchWeaponSchema();
    }, [showMessage]);

    // *** REVISED useEffect FOR INITIALIZATION ***
    useEffect(() => {
        if (schema) {
            if (editMode && initialData) {
                // If the item ID changes, or if form hasn't been initialized for the current item ID
                if (initialData.id !== prevInitialDataIdRef.current || !formInitializedForCurrentItem.current) {
                    console.log("Initializing FormData for item (edit mode):", initialData.General?.Nome, "ID:", initialData.id);
                    initializeFormData(schema, initialData);
                    prevInitialDataIdRef.current = initialData.id;
                    formInitializedForCurrentItem.current = true;
                } else {
                    console.log("Skipping re-initialization for already loaded item:", initialData.General?.Nome);
                }
            } else if (!editMode) { // Creating a new item
                if (!formInitializedForCurrentItem.current) {
                    console.log("Initializing FormData for NEW weapon.");
                    initializeFormData(schema, null); // Pass null for new item
                    prevInitialDataIdRef.current = null; // No ID for new item yet
                    formInitializedForCurrentItem.current = true;
                }
            }
        }
    }, [schema, initialData, editMode, initializeFormData]);

    // Reset initialization flag if component instance changes (e.g. overlay is closed and reopened)
    // This effect runs on mount and when editMode changes.
    useEffect(() => {
        formInitializedForCurrentItem.current = false;
        // When the overlay is shown (component mounts) or mode changes,
        // we want to allow initialization.
    }, [editMode]); // Also implicitly runs on mount

    useEffect(() => {
        if (!user) return;
        const fetchData = async () => {
            try {
                const userDocRef = doc(db, 'users', user.uid);
                const userSnap = await getDoc(userDocRef);
                if (userSnap.exists()) {
                    const uData = userSnap.data();
                    setUserParams(uData.Parametri || { Base: {}, Combattimento: {} });
                    setUserName(uData.characterId || uData.email || "Unknown User");
                }

                const spellSchemaRef = doc(db, "utils", "schema_spell");
                const spellSchemaSnap = await getDoc(spellSchemaRef);
                if (spellSchemaSnap.exists()) setSpellSchema(spellSchemaSnap.data());
                else console.error("Spell schema not found!");

                const commonSpellsRef = doc(db, 'utils', 'spells_common');
                const commonSpellsSnap = await getDoc(commonSpellsRef);
                const commonSpells = commonSpellsSnap.exists() ? commonSpellsSnap.data() : {};
                const userSpells = userSnap.exists() ? userSnap.data().spells || {} : {};

                const initialSpellNamesFromData = initialData?.General?.spells ? Object.keys(initialData.General.spells) : [];
                const currentCustomSpellNames = customSpells.map(cs => cs.spellData.Nome.trim());
                setSpellsList([...new Set([...Object.keys(commonSpells), ...Object.keys(userSpells), ...initialSpellNamesFromData, ...currentCustomSpellNames])].sort());

                let commonTecniche = {};
                const utilsDocRef = doc(db, 'utils', 'utils');
                const utilsDocSnap = await getDoc(utilsDocRef);
                if (utilsDocSnap.exists() && utilsDocSnap.data().tecniche_common) {
                    commonTecniche = utilsDocSnap.data().tecniche_common;
                } else {
                    const commonTecnicheRef = doc(db, 'utils', 'tecniche_common');
                    const commonTecnicheSnap = await getDoc(commonTecnicheRef);
                    commonTecniche = commonTecnicheSnap.exists() ? commonTecnicheSnap.data() : {};
                }
                const userTecniche = userSnap.exists() ? userSnap.data().tecniche || {} : {};
                const initialTecNamesFromData = initialData?.General?.ridCostoTecSingola ? Object.keys(initialData.General.ridCostoTecSingola) : [];
                setTecnicheList([...new Set([...Object.keys(commonTecniche), ...Object.keys(userTecniche), ...initialTecNamesFromData])].sort());

            } catch (error) {
                console.error('Error fetching initial data for overlay:', error);
            }
        };
        fetchData();
    }, [user, initialData?.id, customSpells, showMessage]); // Use initialData.id for stability

    const handleSpellCreate = useCallback((result) => {
        console.log("Spell Create/Edit Result:", result);
        if (result?.spellData?.Nome) {
            const spellName = result.spellData.Nome.trim();
            if (editingSpellIndex !== null) {
                console.log(`Updating custom spell at index ${editingSpellIndex}:`, spellName);
                setCustomSpells(prev => {
                    const updated = [...prev];
                    const otherSpells = updated.filter((_, i) => i !== editingSpellIndex);
                    if (otherSpells.some(s => s.spellData.Nome.trim() === spellName)) {
                        if (showMessage) showMessage(`Uno spell custom con nome "${spellName}" esiste già. Scegli un nome diverso.`, "warning");
                        return prev;
                    }
                    updated[editingSpellIndex] = result;
                    if (showMessage) showMessage(`Spell "${spellName}" modificato localmente.`, "info");
                    return updated;
                });
            } else {
                console.log("Adding new custom spell:", spellName);
                if (customSpells.some(s => s.spellData.Nome.trim() === spellName)) {
                    if (showMessage) showMessage(`Uno spell custom con nome "${spellName}" esiste già.`, "warning");
                } else {
                    setCustomSpells(prev => [...prev, result]);
                    if (showMessage) showMessage(`Spell "${spellName}" creato localmente. Salva l'arma per caricarlo.`, "info");
                }
            }
        } else {
            console.log("Spell creation/edit cancelled or no result.");
        }
        setShowSpellOverlay(false);
        setEditingSpellIndex(null);
    }, [customSpells, editingSpellIndex, showMessage]);

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setImageFile(file);
            const previewURL = URL.createObjectURL(file);
            setImagePreviewUrl(previewURL);
            setWeaponFormData(prev => ({ ...prev, General: { ...prev.General, image_url: previewURL } }));
        }
    };

    const handleAddSpellClick = useCallback(() => {
        setEditingSpellIndex(null);
        setShowSpellOverlay(true);
    }, []);

    const handleEditSpellClick = useCallback((index) => {
        console.log("Editing custom spell index:", index, "Data:", customSpells[index]);
        setEditingSpellIndex(index);
        setShowSpellOverlay(true);
    }, [customSpells]);

    const handleRemoveCustomSpell = useCallback((index) => {
        setCustomSpells(prev => prev.filter((_, i) => i !== index));
    }, []);

    const handleNestedChange = (path, value) => {
        setWeaponFormData(prev => {
            const keys = path.split('.');
            let current = prev;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {}; // Ensure path exists
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = value;
            return { ...prev };
        });
    };

    const handleParamChange = (paramCategory, paramField, level, value) => {
        setWeaponFormData(prev => {
            const newState = JSON.parse(JSON.stringify(prev));
            if (!newState.Parametri) newState.Parametri = { Base: {}, Combattimento: {}, Special: {} };
            if (!newState.Parametri[paramCategory]) newState.Parametri[paramCategory] = {};
            if (!newState.Parametri[paramCategory][paramField]) newState.Parametri[paramCategory][paramField] = {};
            newState.Parametri[paramCategory][paramField][level] = value;
            return newState;
        });
    };

    const handleSaveWeapon = async () => {
        setIsLoading(true);
        const weaponName = weaponFormData.General?.Nome ? weaponFormData.General.Nome.trim() : "";
        if (!weaponName) {
            if (showMessage) showMessage("Il Nome dell'arma è obbligatorio.", "error");
            setIsLoading(false);
            return;
        }

        const docId = editMode && initialData?.id ? initialData.id : weaponName.replace(/\s+/g, "_");
        if (!docId) {
            if (showMessage) showMessage("Errore: Impossibile determinare l'ID del documento.", "error");
            setIsLoading(false);
            return;
        }
        const weaponDocRef = doc(db, "items", docId);

        try {
            if (!editMode) {
                const existingDocSnap = await getDoc(weaponDocRef);
                if (existingDocSnap.exists()) {
                    if (showMessage) showMessage(`Un'arma con nome "${weaponName}" (ID: ${docId}) esiste già.`, "error");
                    setIsLoading(false);
                    return;
                }
            }

            let finalWeaponData = {
                item_type: "weapon",
                General: { ...(weaponFormData.General || {}) },
                Specific: { ...(weaponFormData.Specific || {}) },
                Parametri: JSON.parse(JSON.stringify(weaponFormData.Parametri || { Base: {}, Combattimento: {}, Special: {} }))
            };

            let newImageUrl = editMode ? (initialData?.General?.image_url ?? null) : null;
            if (imageFile) {
                const weaponImgFileName = `weapon_${docId}_${Date.now()}_${imageFile.name}`;
                const weaponImgRef = ref(storage, 'items/' + weaponImgFileName);
                await uploadBytes(weaponImgRef, imageFile);
                newImageUrl = await getDownloadURL(weaponImgRef);
                if (editMode && initialData?.General?.image_url && initialData.General.image_url !== newImageUrl) {
                    try {
                        const oldPath = decodeURIComponent(initialData.General.image_url.split('/o/')[1].split('?')[0]);
                        await deleteObject(ref(storage, oldPath));
                    } catch (e) { console.warn("Failed to delete old image:", e.code === 'storage/object-not-found' ? 'Old file not found.' : e.message); }
                }
            } else if (editMode && !imagePreviewUrl && initialData?.General?.image_url) {
                newImageUrl = null;
                try {
                    const oldPath = decodeURIComponent(initialData.General.image_url.split('/o/')[1].split('?')[0]);
                    await deleteObject(ref(storage, oldPath));
                } catch (e) { console.warn("Failed to delete removed image:", e.code === 'storage/object-not-found' ? 'File not found.' : e.message); }
            }
            finalWeaponData.General.image_url = newImageUrl;

            const finalSpells = {};
            for (const spellObj of customSpells) {
                const createdSpellData = { ...spellObj.spellData };
                const spellNameKey = createdSpellData.Nome.trim();
                const initialSpellFromData = (editMode && initialData?.General?.spells?.[spellNameKey] && typeof initialData.General.spells[spellNameKey] === 'object')
                    ? initialData.General.spells[spellNameKey]
                    : {};
                const safeBase = `spell_${docId}_${spellNameKey.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;

                let spellImageUrlToSave = createdSpellData.image_url || initialSpellFromData.image_url || null;
                let spellVideoUrlToSave = createdSpellData.video_url || initialSpellFromData.video_url || null;

                if (spellObj.imageFile) {
                    const spellImgRef = ref(storage, `spells/${safeBase}_image`);
                    await uploadBytes(spellImgRef, spellObj.imageFile);
                    spellImageUrlToSave = await getDownloadURL(spellImgRef);
                    if (initialSpellFromData.image_url && initialSpellFromData.image_url !== spellImageUrlToSave) {
                        try { await deleteObject(ref(storage, decodeURIComponent(initialSpellFromData.image_url.split('/o/')[1].split('?')[0]))); } catch (e) { console.warn("Failed to delete old spell image for", spellNameKey, e); }
                    }
                }
                if (spellObj.videoFile) {
                    const spellVidRef = ref(storage, `spells/videos/${safeBase}_video`);
                    await uploadBytes(spellVidRef, spellObj.videoFile);
                    spellVideoUrlToSave = await getDownloadURL(spellVidRef);
                    if (initialSpellFromData.video_url && initialSpellFromData.video_url !== spellVideoUrlToSave) {
                        try { await deleteObject(ref(storage, decodeURIComponent(initialSpellFromData.video_url.split('/o/')[1].split('?')[0]))); } catch (e) { console.warn("Failed to delete old spell video for", spellNameKey, e); }
                    }
                }
                createdSpellData.image_url = spellImageUrlToSave;
                createdSpellData.video_url = spellVideoUrlToSave;
                finalSpells[spellNameKey] = createdSpellData;
            }

            weaponSpellsList.forEach(spellNameKey => {
                if (spellNameKey && !finalSpells[spellNameKey]) {
                    finalSpells[spellNameKey] = true;
                }
            });

            if (editMode && initialData?.General?.spells) {
                for (const initialSpellName in initialData.General.spells) {
                    if (!finalSpells[initialSpellName]) {
                        const initialSpellDetails = initialData.General.spells[initialSpellName];
                        if (typeof initialSpellDetails === 'object') {
                            if (initialSpellDetails.image_url) try { await deleteObject(ref(storage, decodeURIComponent(initialSpellDetails.image_url.split('/o/')[1].split('?')[0]))); } catch (e) { console.warn("Failed to delete removed spell image for", initialSpellName, e); }
                            if (initialSpellDetails.video_url) try { await deleteObject(ref(storage, decodeURIComponent(initialSpellDetails.video_url.split('/o/')[1].split('?')[0]))); } catch (e) { console.warn("Failed to delete removed spell video for", initialSpellName, e); }
                        }
                    }
                }
            }
            finalWeaponData.General.spells = finalSpells;

            finalWeaponData.General.ridCostoTecSingola = ridTecnicheList.reduce((acc, { selectedTec, ridValue }) => {
                if (selectedTec && ridValue.trim() !== '') acc[selectedTec] = Number(ridValue);
                return acc;
            }, {});
            finalWeaponData.General.ridCostoSpellSingola = ridSpellList.reduce((acc, { selectedSpell, ridValue }) => {
                if (selectedSpell && ridValue.trim() !== '') acc[selectedSpell] = Number(ridValue);
                return acc;
            }, {});

            let prezzoValue = 0;
            if (typeof finalWeaponData.General.prezzo === 'string' && finalWeaponData.General.prezzo.trim() !== '') {
                const parsed = parseInt(finalWeaponData.General.prezzo.trim(), 10);
                prezzoValue = isNaN(parsed) ? 0 : parsed;
            } else if (typeof finalWeaponData.General.prezzo === 'number') {
                prezzoValue = finalWeaponData.General.prezzo;
            }
            finalWeaponData.General.prezzo = prezzoValue;

            if (finalWeaponData.Specific?.Hands !== undefined) {
                finalWeaponData.Specific.Hands = Number(finalWeaponData.Specific.Hands);
            }

            // Clean up temporary/old schema fields from root
            ['tempSpellData', 'showSpellOverlay', 'Nome', 'Slot', 'Effetto', 'requisiti', 'prezzo', 'image_url', 'Hands', 'Tipo', 'ridCostoTecSingola', 'ridCostoSpellSingola', 'spells'].forEach(key => delete finalWeaponData[key]);
            if (finalWeaponData.Parametri && !finalWeaponData.Parametri.Base) { // Ensure root Parametri is not the one from old schema
                 delete finalWeaponData.Parametri;
            }


            if (editMode) {
                console.log("Updating document:", docId, finalWeaponData);
                await updateDoc(weaponDocRef, finalWeaponData);
                if (showMessage) showMessage(`Arma "${weaponName}" aggiornata!`, "success");
            } else {
                console.log("Creating document:", docId, finalWeaponData);
                await setDoc(weaponDocRef, finalWeaponData);
                if (showMessage) showMessage(`Arma "${weaponName}" creata!`, "success");
            }
            onClose(true);

        } catch (error) {
            console.error("Error saving weapon:", error);
            if (showMessage) showMessage(`Errore nel salvataggio: ${error.message}`, "error");
        } finally {
            setIsLoading(false);
        }
    };

    const renderBasicFields = () => {
        if (isSchemaLoading) return <div className="text-white p-4 text-center">Caricamento schema...</div>;
        if (!schema) return <div className="text-white p-4 text-center text-red-500">Errore: Schema non caricato.</div>;
        if (!schema.General || !schema.Specific) return <div className="text-white p-4 text-center text-red-500">Errore: Struttura schema non valida.</div>;

        return (
            <div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="md:col-span-1">
                        <label className="block text-white mb-1">Nome <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={weaponFormData.General?.Nome || ''}
                            onChange={(e) => handleNestedChange('General.Nome', e.target.value)}
                            className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="Nome Arma (Obbligatorio)"
                            required
                            disabled={editMode}
                            title={editMode ? "Il nome non può essere modificato." : ""}
                        />
                        {editMode && <p className="text-xs text-gray-400 mt-1">Il nome non è modificabile.</p>}
                    </div>

                    <div className="md:col-span-1">
                        {schema.General.Slot !== undefined && Array.isArray(schema.General.Slot) && (
                            <>
                                <label className="block text-white mb-1">Slot</label>
                                <select
                                    value={weaponFormData.General?.Slot || (schema.General.Slot[0] || '')}
                                    onChange={(e) => handleNestedChange('General.Slot', e.target.value)}
                                    className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    {schema.General.Slot.map(option => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
                            </>
                        )}
                    </div>

                    <div className="md:col-span-1 md:row-span-2">
                        <label className="block text-white mb-1">Immagine</label>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="w-full text-sm text-gray-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 cursor-pointer mb-2"
                        />
                        {(imagePreviewUrl) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setImagePreviewUrl(null);
                                    setImageFile(null);
                                    handleNestedChange('General.image_url', null);
                                }}
                                className="text-xs text-red-400 hover:text-red-300 mb-1"
                            >
                                Rimuovi Immagine
                            </button>
                        )}
                        <div className="w-24 h-24 rounded border border-dashed border-gray-600 flex items-center justify-center bg-gray-700/50 overflow-hidden">
                            {(imagePreviewUrl) ? (
                                <img src={imagePreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-gray-500 text-xs text-center">Nessuna Immagine</span>
                            )}
                        </div>
                    </div>

                    <div className="md:col-span-1">
                        {schema.Specific.Tipo !== undefined && Array.isArray(schema.Specific.Tipo) && (
                            <>
                                <label className="block text-white mb-1">Tipo</label>
                                <select
                                    value={weaponFormData.Specific?.Tipo || (schema.Specific.Tipo[0] || '')}
                                    onChange={(e) => handleNestedChange('Specific.Tipo', e.target.value)}
                                    className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    {schema.Specific.Tipo.map(option => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
                            </>
                        )}
                    </div>

                    <div className="md:col-span-1">
                        {schema.Specific.Hands !== undefined && Array.isArray(schema.Specific.Hands) && (
                            <>
                                <label className="block text-white mb-1">Hands</label>
                                <select
                                    value={weaponFormData.Specific?.Hands !== undefined ? String(weaponFormData.Specific.Hands) : (schema.Specific.Hands[0] !== undefined ? String(schema.Specific.Hands[0]) : '')}
                                    onChange={(e) => handleNestedChange('Specific.Hands', e.target.value)}
                                    className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    {schema.Specific.Hands.map(option => (
                                        <option key={option} value={String(option)}>{option}</option>
                                    ))}
                                </select>
                            </>
                        )}
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-white mb-1">Effetto</label>
                    <textarea
                        value={weaponFormData.General?.Effetto || ''}
                        onChange={(e) => handleNestedChange('General.Effetto', e.target.value)}
                        className="w-full p-2 rounded bg-gray-700 text-white h-20 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="Descrizione effetto..."
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-white mb-1">Requisiti</label>
                        <input
                            type="text"
                            value={weaponFormData.General?.requisiti || ''}
                            onChange={(e) => handleNestedChange('General.requisiti', e.target.value)}
                            className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="Es: STR 10"
                        />
                    </div>
                    <div>
                        <label className="block text-white mb-1">Prezzo</label>
                        <input
                            type="text"
                            value={weaponFormData.General?.prezzo || ''}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (/^\d*$/.test(value)) {
                                    handleNestedChange('General.prezzo', value);
                                }
                            }}
                            className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="Es: 100"
                        />
                    </div>
                </div>
            </div>
        );
    };

    const renderTablesSection = () => {
        if (isSchemaLoading) return null;
        if (!schema || !schema.Parametri || !schema.Parametri.Base || !schema.Parametri.Combattimento || !schema.Parametri.Special) {
            console.warn("Parametri structure missing or incomplete in schema:", schema?.Parametri);
            return <div className="text-orange-400 p-4 text-center">Struttura parametri nello schema incompleta.</div>;
        }

        const levels = ["1", "4", "7", "10"];
        const specialFields = Object.keys(schema.Parametri.Special || {});
        const baseParamFields = Object.keys(schema.Parametri.Base || {});
        const combatParamFields = Object.keys(schema.Parametri.Combattimento || {});

        const renderTable = (title, fields, paramCategory) => {
            const schemaCategory = schema.Parametri?.[paramCategory];
            if (!schemaCategory || fields.length === 0) return null;

            return (
                <div className="w-full bg-gray-800/70 p-4 rounded-xl shadow-lg backdrop-blur-sm border border-gray-700/50">
                    <h3 className="text-white mb-3 font-medium">{title}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[300px] text-white text-sm">
                            <thead>
                                <tr>
                                    <th className="bg-gray-700/50 px-2 py-2 rounded-tl-lg text-left font-semibold">Param</th>
                                    {levels.map((lvl, i) => (
                                        <th key={lvl} className={`bg-gray-700/50 px-2 py-2 ${i === levels.length - 1 ? 'rounded-tr-lg' : ''} text-center font-semibold`}>
                                            Lvl {lvl}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {fields.map((field, i) => {
                                    const isLastRow = i === fields.length - 1;
                                    const rowData = weaponFormData.Parametri?.[paramCategory]?.[field];
                                    return (
                                        <tr key={`${paramCategory}-${field}`}>
                                            <td className={`bg-gray-700/30 px-2 py-1.5 ${isLastRow ? 'rounded-bl-lg' : ''} text-left`}>{field}</td>
                                            {levels.map((lvl, j) => {
                                                const value = (rowData && rowData[lvl] !== undefined) ? rowData[lvl] : '';
                                                const isComputableParam = (paramCategory === 'Base' || paramCategory === 'Combattimento');
                                                const computed = isComputableParam && value && userParams ? computeValue(value, userParams) : null;
                                                return (
                                                    <td key={lvl} className={`bg-gray-700/30 px-1 py-1 ${isLastRow && j === levels.length - 1 ? 'rounded-br-lg' : ''}`}>
                                                        <div className="flex items-center justify-center">
                                                            <input
                                                                type="text"
                                                                value={value}
                                                                onChange={(e) => handleParamChange(paramCategory, field, lvl, e.target.value)}
                                                                className="w-16 p-1 rounded-md bg-gray-600/70 text-white text-center focus:outline-none focus:ring-1 focus:ring-blue-500/50 border border-gray-500/50"
                                                                placeholder="-"
                                                            />
                                                            {computed !== null && !isNaN(computed) && (
                                                                <span className="ml-1 text-gray-400 text-xs">({computed})</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                )
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        };

        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                {renderTable("Parametri Speciali", specialFields, "Special")}
                {renderTable("Parametri Base", baseParamFields, "Base")}
                {renderTable("Parametri Combattimento", combatParamFields, "Combattimento")}
            </div>
        );
    };

    const renderReductionsAndSpells = () => {
        if (isSchemaLoading) return null;

        return (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4 bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                    <div>
                        <label className="block text-white mb-2 font-medium">Riduzioni Costo Tecniche Singole</label>
                        {ridTecnicheList.map((item, idx) => (
                            <div key={`tec-red-${idx}`} className="flex items-center gap-2 mb-2 p-2 bg-gray-700/50 rounded">
                                <select
                                    value={item.selectedTec}
                                    onChange={e => {
                                        const newList = [...ridTecnicheList]; newList[idx].selectedTec = e.target.value; setRidTecnicheList(newList);
                                    }}
                                    className="flex-grow p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                >
                                    <option value="" disabled>Seleziona tecnica...</option>
                                    {tecnicheList.map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                                <input
                                    type="number" value={item.ridValue}
                                    onChange={e => {
                                        const newList = [...ridTecnicheList]; newList[idx].ridValue = e.target.value; setRidTecnicheList(newList);
                                    }}
                                    placeholder="Valore"
                                    className="w-24 p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                />
                                <button type="button" onClick={() => removeTecnica(idx)} className="text-red-500 hover:text-red-400 p-1"><FaTrash /></button>
                            </div>
                        ))}
                        <button type="button" onClick={addTecnica} className="mt-1 text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed" disabled={tecnicheList.length === 0}>
                            + Aggiungi Riduzione Tecnica
                        </button>
                        {tecnicheList.length === 0 && <p className="text-xs text-gray-400 mt-1">Nessuna tecnica disponibile.</p>}
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-700/50">
                        <label className="block text-white mb-2 font-medium">Riduzioni Costo Spell Singole</label>
                        {ridSpellList.map((item, idx) => (
                            <div key={`spell-red-${idx}`} className="flex items-center gap-2 mb-2 p-2 bg-gray-700/50 rounded">
                                <select
                                    value={item.selectedSpell}
                                    onChange={e => {
                                        const newList = [...ridSpellList]; newList[idx].selectedSpell = e.target.value; setRidSpellList(newList);
                                    }}
                                    className="flex-grow p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                >
                                    <option value="" disabled>Seleziona spell...</option>
                                    {spellsList.map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                                <input
                                    type="number" value={item.ridValue}
                                    onChange={e => {
                                        const newList = [...ridSpellList]; newList[idx].ridValue = e.target.value; setRidSpellList(newList);
                                    }}
                                    placeholder="Valore"
                                    className="w-24 p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                />
                                <button type="button" onClick={() => removeSpell(idx)} className="text-red-500 hover:text-red-400 p-1"><FaTrash /></button>
                            </div>
                        ))}
                        <button type="button" onClick={addSpell} className="mt-1 text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed" disabled={spellsList.length === 0}>
                            + Aggiungi Riduzione Spell
                        </button>
                        {spellsList.length === 0 && <p className="text-xs text-gray-400 mt-1">Nessuno spell disponibile.</p>}
                    </div>
                </div>

                <div className="space-y-4 bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                    <label className="block text-white mb-2 font-medium">Spells Conferiti dall'Arma</label>
                    <p className="text-xs text-gray-400 mb-2">Crea/Modifica spells specifici per l'arma o collega spells esistenti.</p>
                    <div className="mb-3">
                        <AddSpellButton onClick={handleAddSpellClick} />
                        {Array.isArray(customSpells) && customSpells.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-700/30">
                                <p className="text-sm text-gray-300 mb-1">Spells custom (da salvare con l'arma):</p>
                                <ul className="text-xs text-white list-none ml-0 space-y-1">
                                    {customSpells.map((s, idx) => (
                                        <li key={s?.spellData?.Nome || `custom-spell-${idx}`} className="flex items-center gap-2 bg-gray-700/40 p-1.5 rounded">
                                            <button type="button" className="text-red-400 hover:text-red-300 p-1 flex-shrink-0" onClick={() => handleRemoveCustomSpell(idx)} title="Rimuovi spell custom">
                                                <FaTrash size="0.8em" />
                                            </button>
                                            <button type="button" className="text-blue-400 hover:text-blue-300 p-1 flex-shrink-0" onClick={() => handleEditSpellClick(idx)} title="Modifica spell custom">
                                                <FaEdit size="0.8em" />
                                            </button>
                                            <span className="flex-grow truncate" title={s?.spellData?.Nome}>{s?.spellData?.Nome || "Nome Mancante"}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-700/50">
                        <label className="block text-white text-sm mb-1">Collega Spells Esistenti:</label>
                        {weaponSpellsList.map((selectedSpellName, idx) => (
                            <div key={`linked-spell-${idx}`} className="flex items-center gap-2 mb-2 p-2 bg-gray-700/50 rounded">
                                <select
                                    value={selectedSpellName}
                                    onChange={e => {
                                        const newName = e.target.value;
                                        setWeaponSpellsList(prev => {
                                            const newList = [...prev]; newList[idx] = newName; return [...new Set(newList.filter(Boolean))];
                                        });
                                    }}
                                    className="flex-grow p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                >
                                    <option value="" disabled>Seleziona spell esistente...</option>
                                    {spellsList
                                        .filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name))
                                        .filter(name => name === selectedSpellName || !weaponSpellsList.includes(name))
                                        .map(name => (<option key={name} value={name}>{name}</option>))}
                                </select>
                                <button type="button" onClick={() => removeWeaponSpellLink(idx)} className="text-red-500 hover:text-red-400 p-1"><FaTrash /></button>
                            </div>
                        ))}
                        <button
                            type="button" onClick={addWeaponSpellLink}
                            className="mt-1 text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                            disabled={spellsList.length === 0 || spellsList.filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name) && !weaponSpellsList.includes(name)).length === 0}
                        >
                            + Collega Spell Esistente
                        </button>
                        {spellsList.length === 0 && <p className="text-xs text-gray-400 mt-1">Nessuno spell disponibile.</p>}
                        {spellsList.length > 0 && spellsList.filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name) && !weaponSpellsList.includes(name)).length === 0 && (
                            <p className="text-xs text-gray-400 mt-1">Tutti gli spells disponibili sono già collegati o creati.</p>
                          )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <WeaponOverlay
                title={editMode ? `Modifica Arma: ${initialData?.General?.Nome || weaponFormData.General?.Nome || ''}` : "Aggiungi Nuova Arma"}
                onClose={() => onClose(false)}
                onSave={handleSaveWeapon}
                saveButtonText={editMode ? "Salva Modifiche" : "Crea Arma"}
                isLoading={isLoading || isSchemaLoading}
            >
                {isSchemaLoading ? (
                    <div className="text-white p-4 text-center">Caricamento Dati...</div>
                ) : !schema ? (
                    <div className="text-white p-4 text-center text-red-500">Errore: Impossibile caricare lo schema.</div>
                ) : !schema.General || !schema.Specific || !schema.Parametri ? (
                    <div className="text-white p-4 text-center text-red-500">Errore: Struttura schema arma non valida.</div>
                ) : (
                    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
                        {renderBasicFields()}
                        {renderTablesSection()}
                        {renderReductionsAndSpells()}
                    </form>
                )}
            </WeaponOverlay>

            {showSpellOverlay && spellSchema && userName && (
                <SpellOverlay
                    mode={editingSpellIndex !== null ? "edit" : "add"}
                    schema={spellSchema}
                    userName={userName}
                    onClose={handleSpellCreate}
                    saveButtonText={editingSpellIndex !== null ? "Salva Modifiche Spell" : "Crea Spell Custom"}
                    initialData={editingSpellIndex !== null && customSpells[editingSpellIndex] ? customSpells[editingSpellIndex].spellData : undefined}
                    imageFile={editingSpellIndex !== null && customSpells[editingSpellIndex] ? customSpells[editingSpellIndex].imageFile : undefined}
                    videoFile={editingSpellIndex !== null && customSpells[editingSpellIndex] ? customSpells[editingSpellIndex].videoFile : undefined}
                    zIndex={10000}
                />
            )}
            {showSpellOverlay && (!spellSchema || !userName) && (
                <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-70 z-[10001]">
                    <div className="bg-gray-800 p-6 rounded-lg shadow-lg text-white border border-gray-600">
                        Caricamento editor spell...
                    </div>
                </div>
            )}
        </>
    );
}