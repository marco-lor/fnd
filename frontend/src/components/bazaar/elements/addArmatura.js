// file: ./frontend/src/components/bazaar/elements/addArmatura.js
import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { db, storage } from '../../firebaseConfig';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { AuthContext } from '../../../AuthContext';
import { computeValue } from '../../common/computeFormula';
import { AddSpellButton } from '../../dmDashboard/elements/buttons/addSpell';
import { SpellOverlay } from '../../common/SpellOverlay';
import { WeaponOverlay } from '../../common/WeaponOverlay';
import { FaTrash, FaEdit } from "react-icons/fa";
import VisibilitySelector from '../../common/VisibilitySelector';

export function AddArmaturaOverlay({ onClose, showMessage, initialData = null, editMode = false, inventoryEditMode = false, inventoryUserId = null, inventoryItemId = null, inventoryItemIndex = null }) {
    const [schema, setSchema] = useState(null);
    const [armaturaFormData, setArmaturaFormData] = useState({
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
    const [armaturaSpellsList, setArmaturaSpellsList] = useState([]);

    const [showSpellOverlay, setShowSpellOverlay] = useState(false);
    const [customSpells, setCustomSpells] = useState([]);
    const [editingSpellIndex, setEditingSpellIndex] = useState(null);

    const [users, setUsers] = useState([]);
    const [visibility, setVisibility] = useState('all');
    const [allowedUsers, setAllowedUsers] = useState([]);

    // Refs to manage initialization logic
    const prevInitialDataIdRef = useRef(null);
    const formInitializedForCurrentItem = useRef(false);

    const addTecnica = useCallback(() => setRidTecnicheList(prev => [...prev, { selectedTec: '', ridValue: '' }]), []);
    const removeTecnica = useCallback(index => setRidTecnicheList(prev => prev.filter((_, i) => i !== index)), []);
    const addSpell = useCallback(() => setRidSpellList(prev => [...prev, { selectedSpell: '', ridValue: '' }]), []);
    const removeSpell = useCallback(index => setRidSpellList(prev => prev.filter((_, i) => i !== index)), []);
    const addArmaturaSpellLink = useCallback(() => setArmaturaSpellsList(prev => [...prev, '']), []);
    const removeArmaturaSpellLink = useCallback(index => setArmaturaSpellsList(prev => prev.filter((_, i) => i !== index)), []);

    // New visibility handler
    const handleVisibilityChange = (newVisibility, newAllowed) => {
        setVisibility(newVisibility);
        setAllowedUsers(newAllowed);
    };

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const snap = await getDocs(collection(db, 'users'));
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                setUsers(list);
            } catch (err) {
                console.error('Error fetching users:', err);
            }
        };
        fetchUsers();
    }, []);

    useEffect(() => {
        if (initialData) {
            if (initialData.visibility === 'custom') {
                setVisibility('custom');
                setAllowedUsers(initialData.allowed_users || []);
            } else {
                setVisibility('all');
                setAllowedUsers([]);
            }
        } else {
            setVisibility('all');
            setAllowedUsers([]);
        }
    }, [initialData]);

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

        setArmaturaFormData(initialFormState); // Set the main form data

        // Populate dynamic lists and image based on currentItemData
        if (currentItemData) {
            setRidTecnicheList(currentItemData.General?.ridCostoTecSingola ?
                Object.entries(currentItemData.General.ridCostoTecSingola).map(([tec, val]) => ({ selectedTec: tec, ridValue: String(val) })) : []
            );
            setRidSpellList(currentItemData.General?.ridCostoSpellSingola ?
                Object.entries(currentItemData.General.ridCostoSpellSingola).map(([spell, val]) => ({ selectedSpell: spell, ridValue: String(val) })) : []
            );

            // Initialize spells from currentItemData
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
            setArmaturaSpellsList(initialLinkedSpells);
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
            setArmaturaSpellsList([]);
            setCustomSpells([]);
            setImagePreviewUrl(null);
            setImageFile(null);
        }

        initialFormState.General = initialFormState.General || {};
        initialFormState.Specific = initialFormState.Specific || {};
        initialFormState.Parametri = initialFormState.Parametri || { Base: {}, Combattimento: {}, Special: {} };
        initialFormState.General.spells = initialFormState.General.spells || {};

        console.log("Initialized FormData:", initialFormState);

    }, [editMode]);

    useEffect(() => {
        setIsSchemaLoading(true);
        const fetchArmaturaSchema = async () => {
            try {
                const schemaDocRef = doc(db, "utils", "schema_armatura");
                const docSnap = await getDoc(schemaDocRef);
                if (docSnap.exists()) {
                    setSchema(docSnap.data());
                } else {
                    console.error("Armor schema (schema_armatura) not found!");
                    if (showMessage) showMessage("Errore: Schema armatura non trovato.", "error");
                }
            } catch (error) {
                console.error("Error fetching armor schema:", error);
                if (showMessage) showMessage("Errore nel caricamento dello schema.", "error");
            } finally {
                setIsSchemaLoading(false);
            }
        };
        fetchArmaturaSchema();
    }, [showMessage]);

    // useEffect for initialization
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
                    console.log("Initializing FormData for NEW armor.");
                    initializeFormData(schema, null); // Pass null for new item
                    prevInitialDataIdRef.current = null; // No ID for new item yet
                    formInitializedForCurrentItem.current = true;
                }
            }
        }
    }, [schema, editMode, initialData, initializeFormData]);

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
                try {
                    const utilsDocRef = doc(db, 'utils', 'utils');
                    const utilsDocSnap = await getDoc(utilsDocRef);
                    if (utilsDocSnap.exists() && utilsDocSnap.data().tecniche_common) {
                        commonTecniche = utilsDocSnap.data().tecniche_common;
                    } else {
                        const commonTecnicheRef = doc(db, 'utils', 'tecniche_common');
                        const commonTecnicheSnap = await getDoc(commonTecnicheRef);
                        commonTecniche = commonTecnicheSnap.exists() ? commonTecnicheSnap.data() : {};
                    }
                } catch (error) {
                    console.error("Error fetching common tecniche:", error);
                }
                const userTecniche = userSnap.exists() ? userSnap.data().tecniche || {} : {};
                const initialTecNamesFromData = initialData?.General?.ridCostoTecSingola ? Object.keys(initialData.General.ridCostoTecSingola) : [];
                setTecnicheList([...new Set([...Object.keys(commonTecniche), ...Object.keys(userTecniche), ...initialTecNamesFromData])].sort());

            } catch (error) {
                console.error('Error fetching initial data for overlay:', error);
            }
        };
        fetchData();
    }, [user, initialData?.id, customSpells, showMessage]);

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
                    if (showMessage) showMessage(`Spell "${spellName}" creato localmente. Salva l'armatura per caricarlo.`, "info");
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
            setArmaturaFormData(prev => ({ ...prev, General: { ...prev.General, image_url: previewURL } }));
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
        setArmaturaFormData(prev => {
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
        setArmaturaFormData(prev => ({
            ...prev,
            Parametri: {
                ...prev.Parametri,
                [paramCategory]: {
                    ...prev.Parametri[paramCategory],
                    [paramField]: {
                        ...prev.Parametri[paramCategory][paramField],
                        [level]: value
                    }
                }
            }
        }));
    };    const handleSaveArmatura = async () => {
        setIsLoading(true);
        const armaturaName = armaturaFormData.General?.Nome ? armaturaFormData.General.Nome.trim() : "";
        if (!armaturaName) {
            if (showMessage) showMessage("Il nome dell'armatura è obbligatorio.", "error");
            setIsLoading(false);
            return;
        }

        const docId = editMode && initialData?.id ? initialData.id : armaturaName.replace(/\s+/g, "_");
        if (!docId) {
            if (showMessage) showMessage("Errore: Impossibile determinare l'ID del documento.", "error");
            setIsLoading(false);
            return;
        }
        const armaturaDocRef = doc(db, "items", docId);
        
        try {
            if (!editMode) {
                const existingDocSnap = await getDoc(armaturaDocRef);
                if (existingDocSnap.exists()) {
                    if (showMessage) showMessage(`Un'armatura con nome "${armaturaName}" (ID: ${docId}) esiste già.`, "error");
                    setIsLoading(false);
                    return;
                }
            }
            let finalArmaturaData = JSON.parse(JSON.stringify(armaturaFormData));

            // Handle image upload
            let newImageUrl = editMode ? (initialData?.General?.image_url ?? null) : null;
            if (imageFile) {
                const armaturaImgFileName = `armatura_${docId}_${Date.now()}_${imageFile.name}`;
                const armaturaImgRef = ref(storage, 'items/' + armaturaImgFileName);
                await uploadBytes(armaturaImgRef, imageFile);
                newImageUrl = await getDownloadURL(armaturaImgRef);
                if (!inventoryEditMode && editMode && initialData?.General?.image_url && initialData.General.image_url !== newImageUrl) {
                    try {
                        const oldPath = decodeURIComponent(initialData.General.image_url.split('/o/')[1].split('?')[0]);
                        await deleteObject(ref(storage, oldPath));
                    } catch (e) { console.warn("Failed to delete old image:", e.code === 'storage/object-not-found' ? 'Old file not found.' : e.message); }
                }
            } else if (!inventoryEditMode && editMode && !imagePreviewUrl && initialData?.General?.image_url) {
                newImageUrl = null;
                try {
                    const oldPath = decodeURIComponent(initialData.General.image_url.split('/o/')[1].split('?')[0]);
                    await deleteObject(ref(storage, oldPath));
                } catch (e) { console.warn("Failed to delete removed image:", e.code === 'storage/object-not-found' ? 'File not found.' : e.message); }
            }
            finalArmaturaData.General.image_url = newImageUrl;

            // Handle custom spells
            let finalSpells = {};
            for (const customSpell of customSpells) {
                const spellNameKey = customSpell.spellData.Nome.trim();
                let createdSpellData = { ...customSpell.spellData };
                
                let spellImageUrlToSave = createdSpellData.image_url || '';
                let spellVideoUrlToSave = createdSpellData.video_url || '';
                
                if (customSpell.imageFile) {
                    const spellImageRef = ref(storage, `spell_images/${Date.now()}_${customSpell.imageFile.name}`);
                    const spellImageSnapshot = await uploadBytes(spellImageRef, customSpell.imageFile);
                    spellImageUrlToSave = await getDownloadURL(spellImageSnapshot.ref);
                }
                
                if (customSpell.videoFile) {
                    const spellVideoRef = ref(storage, `spell_videos/${Date.now()}_${customSpell.videoFile.name}`);
                    const spellVideoSnapshot = await uploadBytes(spellVideoRef, customSpell.videoFile);
                    spellVideoUrlToSave = await getDownloadURL(spellVideoSnapshot.ref);
                }
                
                // Delete old files if editing
                if (editMode && initialData?.General?.spells?.[spellNameKey] && typeof initialData.General.spells[spellNameKey] === 'object') {
                    const initialSpellFromData = initialData.General.spells[spellNameKey];
                    if (!inventoryEditMode && customSpell.imageFile && initialSpellFromData.image_url) {
                        try { await deleteObject(ref(storage, decodeURIComponent(initialSpellFromData.image_url.split('/o/')[1].split('?')[0]))); } catch (e) { console.warn("Failed to delete old spell image for", spellNameKey, e); }
                    }
                        if (!inventoryEditMode && customSpell.videoFile && initialSpellFromData.video_url) {
                        try { await deleteObject(ref(storage, decodeURIComponent(initialSpellFromData.video_url.split('/o/')[1].split('?')[0]))); } catch (e) { console.warn("Failed to delete old spell video for", spellNameKey, e); }
                    }
                }
                createdSpellData.image_url = spellImageUrlToSave;
                createdSpellData.video_url = spellVideoUrlToSave;
                finalSpells[spellNameKey] = createdSpellData;
            }

            armaturaSpellsList.forEach(spellNameKey => {
                if (spellNameKey && !finalSpells[spellNameKey]) {
                    finalSpells[spellNameKey] = true;
                }
            });

            if (!inventoryEditMode && editMode && initialData?.General?.spells) {
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
            finalArmaturaData.General.spells = finalSpells;

            finalArmaturaData.visibility = visibility;
            finalArmaturaData.allowed_users = visibility === 'custom' ? allowedUsers : [];

            finalArmaturaData.General.ridCostoTecSingola = ridTecnicheList.reduce((acc, { selectedTec, ridValue }) => {
                if (selectedTec && ridValue.trim() !== '') acc[selectedTec] = Number(ridValue);
                return acc;
            }, {});
            finalArmaturaData.General.ridCostoSpellSingola = ridSpellList.reduce((acc, { selectedSpell, ridValue }) => {
                if (selectedSpell && ridValue.trim() !== '') acc[selectedSpell] = Number(ridValue);
                return acc;
            }, {});

            let prezzoValue = 0;
            if (typeof finalArmaturaData.General.prezzo === 'string' && finalArmaturaData.General.prezzo.trim() !== '') {
                const parsed = parseInt(finalArmaturaData.General.prezzo.trim(), 10);
                prezzoValue = isNaN(parsed) ? 0 : parsed;
            } else if (typeof finalArmaturaData.General.prezzo === 'number') {
                prezzoValue = finalArmaturaData.General.prezzo;
            }
            finalArmaturaData.General.prezzo = prezzoValue;

            if (finalArmaturaData.Specific?.Hands !== undefined) {
                finalArmaturaData.Specific.Hands = Number(finalArmaturaData.Specific.Hands);
            }

            // Clean up temporary/old schema fields from root
            ['tempSpellData', 'showSpellOverlay', 'Nome', 'Slot', 'Effetto', 'requisiti', 'prezzo', 'image_url', 'Hands', 'Tipo', 'ridCostoTecSingola', 'ridCostoSpellSingola', 'spells'].forEach(key => delete finalArmaturaData[key]);
            if (finalArmaturaData.Parametri && !finalArmaturaData.Parametri.Base) { // Ensure root Parametri is not the one from old schema
                 delete finalArmaturaData.Parametri;            }            // Set item type to "armatura"
            finalArmaturaData.item_type = "armatura";

            if (inventoryEditMode && inventoryUserId && (inventoryItemId || initialData?.id)) {
                try {
                    const targetUserRef = doc(db, 'users', inventoryUserId);
                    const userSnap = await getDoc(targetUserRef);
                    const currentData = userSnap.exists() ? userSnap.data() : {};
                    const invArr = Array.isArray(currentData.inventory) ? currentData.inventory : [];
                    const targetId = inventoryItemId || docId;
                    let userImageDeleted = false;
                    const nextInv = invArr.map((entry, idx) => {
                        if (Number.isInteger(inventoryItemIndex)) {
                            if (idx !== inventoryItemIndex) return entry;
                            const current = entry;
                            const qty = typeof current?.qty === 'number' ? current.qty : 1;
                            if (current?.user_image_custom && current?.user_image_url) {
                                if (imageFile || (!imagePreviewUrl && initialData?.General?.image_url)) {
                                    userImageDeleted = current.user_image_url;
                                }
                            }
                            const baseUpdated = { id: targetId, qty, ...finalArmaturaData };
                            if (imageFile) return { ...baseUpdated, user_image_custom: true, user_image_url: newImageUrl };
                            if (!imagePreviewUrl) { const { user_image_custom, user_image_url, ...rest } = baseUpdated; return rest; }
                            return { ...baseUpdated, ...(current?.user_image_custom ? { user_image_custom: true, user_image_url: current.user_image_url } : {}) };
                        }
                        if (!entry) return entry;
                        if (typeof entry === 'string') {
                            if (entry === targetId) return { id: targetId, qty: 1, ...finalArmaturaData, ...(imageFile ? { user_image_custom: true, user_image_url: newImageUrl } : {}) };
                            return entry;
                        }
                        const entryId = entry.id || entry.name || entry?.General?.Nome;
                        if (entryId === targetId) {
                            const qty = typeof entry.qty === 'number' ? entry.qty : 1;
                            if (entry.user_image_custom && entry.user_image_url) {
                                if (imageFile || (!imagePreviewUrl && initialData?.General?.image_url)) {
                                    userImageDeleted = entry.user_image_url;
                                }
                            }
                            const baseUpdated = { id: targetId, qty, ...finalArmaturaData };
                            if (imageFile) return { ...baseUpdated, user_image_custom: true, user_image_url: newImageUrl };
                            else if (!imagePreviewUrl) { const { user_image_custom, user_image_url, ...rest } = baseUpdated; return rest; }
                            return { ...baseUpdated, ...(entry.user_image_custom ? { user_image_custom: true, user_image_url: entry.user_image_url } : {}) };
                        }
                        return entry;
                    });
                    await updateDoc(targetUserRef, { inventory: nextInv });
                    if (userImageDeleted) {
                        try { const oldPath = decodeURIComponent(userImageDeleted.split('/o/')[1].split('?')[0]); await deleteObject(ref(storage, oldPath)); } catch (e) { console.warn('Failed to delete previous user custom image:', e); }
                    }
                    if (showMessage) showMessage(`Armatura aggiornata nell'inventario utente.`, 'success');
                } catch (e) {
                    console.error('Failed updating user inventory:', e);
                    if (showMessage) showMessage(`Errore aggiornando inventario utente: ${e.message}`, 'error');
                    setIsLoading(false);
                    return;
                }
                onClose(true);
            } else {
                if (editMode) {
                    console.log("Updating document:", docId, finalArmaturaData);
                    await updateDoc(armaturaDocRef, finalArmaturaData);
                    if (showMessage) showMessage(`Armatura "${armaturaName}" aggiornata!`, "success");
                } else {
                    console.log("Creating new document:", docId, finalArmaturaData);
                    await setDoc(armaturaDocRef, finalArmaturaData);
                    if (showMessage) showMessage(`Armatura "${armaturaName}" creata!`, "success");
                }
                onClose(true);
            }

        } catch (error) {
            console.error("Error saving armor:", error);
            if (showMessage) showMessage("Errore nel salvataggio dell'armatura.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const renderSpecificFields = () => {
        if (isSchemaLoading) return null;
        if (!schema?.Specific || Object.keys(schema.Specific).length === 0) return null;

        const specificFields = Object.keys(schema.Specific);
        
        return (
            <div className="mb-6">
                <h3 className="text-white text-lg font-medium mb-4 border-b border-gray-600 pb-2">Campi Specifici</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {specificFields.map((fieldKey) => {
                        const schemaValue = schema.Specific[fieldKey];
                        const currentValue = armaturaFormData.Specific?.[fieldKey];
                        
                        // Handle array fields (select options)
                        if (Array.isArray(schemaValue)) {
                            let displayValue;
                            if (fieldKey === 'Hands') {
                                displayValue = currentValue !== undefined ? String(currentValue) : (schemaValue[0] !== undefined ? String(schemaValue[0]) : '');
                            } else {
                                displayValue = currentValue || (schemaValue[0] || '');
                            }
                            
                            return (
                                <div key={fieldKey}>
                                    <label className="block text-white mb-1 capitalize">{fieldKey}</label>
                                    <select
                                        value={displayValue}
                                        onChange={(e) => {
                                            const value = fieldKey === 'Hands' ? e.target.value : e.target.value;
                                            handleNestedChange(`Specific.${fieldKey}`, value);
                                        }}
                                        className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    >
                                        {schemaValue.map(option => (
                                            <option key={option} value={String(option)}>{option}</option>
                                        ))}
                                    </select>
                                </div>
                            );
                        }
                        
                        // Handle string/text fields
                        if (typeof schemaValue === 'string') {
                            return (
                                <div key={fieldKey}>
                                    <label className="block text-white mb-1 capitalize">{fieldKey}</label>
                                    <input
                                        type="text"
                                        value={currentValue || ''}
                                        onChange={(e) => handleNestedChange(`Specific.${fieldKey}`, e.target.value)}
                                        className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        placeholder={`Inserisci ${fieldKey.toLowerCase()}`}
                                    />
                                </div>
                            );
                        }
                        
                        // Handle number fields
                        if (typeof schemaValue === 'number') {
                            return (
                                <div key={fieldKey}>
                                    <label className="block text-white mb-1 capitalize">{fieldKey}</label>
                                    <input
                                        type="number"
                                        value={currentValue !== undefined ? currentValue : schemaValue}
                                        onChange={(e) => {
                                            const value = e.target.value === '' ? '' : Number(e.target.value);
                                            handleNestedChange(`Specific.${fieldKey}`, value);
                                        }}
                                        className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        placeholder={`Inserisci ${fieldKey.toLowerCase()}`}
                                    />
                                </div>
                            );
                        }
                        
                        return null;
                    })}
                </div>
            </div>
        );
    };

    const renderBasicFields = () => {
        if (isSchemaLoading) return null;

        return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <div className="lg:col-span-2 space-y-4">
                    <VisibilitySelector
                        visibility={visibility}
                        allowedUsers={allowedUsers}
                        users={users}
                        onChange={handleVisibilityChange}
                        className="mb-2"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-white mb-1">Nome*</label>
                            <input
                                type="text"
                                value={armaturaFormData.General?.Nome || ''}
                                onChange={(e) => handleNestedChange('General.Nome', e.target.value)}
                                className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                placeholder="Es: Armatura di Piastre"
                                required
                                disabled={editMode}
                                title={editMode ? "Il nome non può essere modificato." : ""}
                            />
                            {editMode && <p className="text-xs text-gray-400 mt-1">Il nome non è modificabile.</p>}
                        </div>

                        <div className="md:col-span-1">
                            {schema.General.Slot && Array.isArray(schema.General.Slot) && (
                                <>
                                    <label className="block text-white mb-1">Slot</label>
                                    <select
                                        value={armaturaFormData.General?.Slot || (schema.General.Slot[0] || '')}
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

                        <div className="md:col-span-1">
                            <label className="block text-white mb-1">Requisiti</label>
                            <input
                                type="text"
                                value={armaturaFormData.General?.requisiti || ''}
                                onChange={(e) => handleNestedChange('General.requisiti', e.target.value)}
                                className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                placeholder="Es: Forza 15"
                            />
                        </div>                    </div>

                    <div className="mb-4">
                        <label className="block text-white mb-1">Effetto</label>
                        <textarea
                            value={armaturaFormData.General?.Effetto || ''}
                            onChange={(e) => handleNestedChange('General.Effetto', e.target.value)}
                            className="w-full p-2 rounded bg-gray-700 text-white h-20 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="Descrivi l'effetto dell'armatura..."
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-white mb-1">Prezzo</label>
                        <input
                            type="text"
                            value={armaturaFormData.General?.prezzo || ''}
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
                </div>                    <div className="md:col-span-1 md:row-span-2">
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
            </div>
        );
    };    const renderTablesSection = () => {
        if (isSchemaLoading) return null;
        if (!schema || !schema.Parametri || !schema.Parametri.Base || !schema.Parametri.Combattimento || !schema.Parametri.Special) {
            console.warn("Parametri structure missing or incomplete in schema:", schema?.Parametri);
            return <div className="text-orange-400 p-4 text-center">Struttura parametri nello schema incompleta.</div>;
        }        const levels = ["1", "4", "7", "10"];
        const specialFields = Object.keys(schema.Parametri.Special || {}).sort();
        const baseParamFields = Object.keys(schema.Parametri.Base || {}).sort();
        const combatParamFields = Object.keys(schema.Parametri.Combattimento || {}).sort();

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
                                    const rowData = armaturaFormData.Parametri?.[paramCategory]?.[field];
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
                    <label className="block text-white mb-2 font-medium">Spells Conferiti dall'Armatura</label>
                    <p className="text-xs text-gray-400 mb-2">Crea/Modifica spells specifici per l'armatura o collega spells esistenti.</p>
                    <div className="mb-3">
                        <AddSpellButton onClick={handleAddSpellClick} />
                        {Array.isArray(customSpells) && customSpells.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-700/30">
                                <p className="text-sm text-gray-300 mb-1">Spells custom (da salvare con l'armatura):</p>
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
                        {armaturaSpellsList.map((selectedSpellName, idx) => (
                            <div key={`linked-spell-${idx}`} className="flex items-center gap-2 mb-2 p-2 bg-gray-700/50 rounded">
                                <select
                                    value={selectedSpellName}
                                    onChange={e => {
                                        const newName = e.target.value;
                                        setArmaturaSpellsList(prev => {
                                            const newList = [...prev]; newList[idx] = newName; return [...new Set(newList.filter(Boolean))];
                                        });
                                    }}
                                    className="flex-grow p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                >
                                    <option value="" disabled>Seleziona spell esistente...</option>
                                    {spellsList
                                        .filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name))
                                        .filter(name => name === selectedSpellName || !armaturaSpellsList.includes(name))
                                        .map(name => (<option key={name} value={name}>{name}</option>))}
                                </select>
                                <button type="button" onClick={() => removeArmaturaSpellLink(idx)} className="text-red-500 hover:text-red-400 p-1"><FaTrash /></button>
                            </div>
                        ))}
                        <button
                            type="button" onClick={addArmaturaSpellLink}
                            className="mt-1 text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                            disabled={spellsList.length === 0 || spellsList.filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name) && !armaturaSpellsList.includes(name)).length === 0}
                        >
                            + Collega Spell Esistente
                        </button>
                        {spellsList.length === 0 && <p className="text-xs text-gray-400 mt-1">Nessuno spell disponibile.</p>}
                        {spellsList.length > 0 && spellsList.filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name) && !armaturaSpellsList.includes(name)).length === 0 && (
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
                title={editMode ? `Modifica Armatura: ${initialData?.General?.Nome || armaturaFormData.General?.Nome || ''}` : "Aggiungi Nuova Armatura"}
                onClose={() => onClose(false)}
                onSave={handleSaveArmatura}
                saveButtonText={editMode ? "Salva Modifiche" : "Crea Armatura"}
                isLoading={isLoading || isSchemaLoading}
            >
                {isSchemaLoading ? (
                    <div className="text-white p-4 text-center">Caricamento Dati...</div>
                ) : !schema ? (
                    <div className="text-white p-4 text-center text-red-500">Errore: Impossibile caricare lo schema.</div>
                ) : !schema.General || !schema.Specific || !schema.Parametri ? (
                    <div className="text-white p-4 text-center text-red-500">Errore: Struttura schema armatura non valida.</div>
                ) : (
                    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
                        {renderBasicFields()}
                        {renderSpecificFields()}
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
                        <p className="mb-4">Caricamento schema spell...</p>
                        <button
                            onClick={() => setShowSpellOverlay(false)}
                            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded transition-colors"
                        >
                            Chiudi
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
