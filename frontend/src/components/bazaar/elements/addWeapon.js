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

// Accept initialData and editMode props
export function AddWeaponOverlay({ onClose, showMessage, initialData = null, editMode = false }) {
    const [schema, setSchema] = useState(null);
    const [weaponFormData, setWeaponFormData] = useState({});
    const [imageFile, setImageFile] = useState(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSchemaLoading, setIsSchemaLoading] = useState(true);

    const { user } = useContext(AuthContext);
    const [userParams, setUserParams] = useState({ Base: {}, Combattimento: {} });
    const [userName, setUserName] = useState("");
    const [spellSchema, setSpellSchema] = useState(null);

    // State for dynamic lists
    const [tecnicheList, setTecnicheList] = useState([]);
    const [ridTecnicheList, setRidTecnicheList] = useState([]);
    const [spellsList, setSpellsList] = useState([]); // Available spells for dropdowns
    const [ridSpellList, setRidSpellList] = useState([]);
    const [weaponSpellsList, setWeaponSpellsList] = useState([]); // Linked existing spell names

    // State for custom spells
    const [showSpellOverlay, setShowSpellOverlay] = useState(false);
    const [customSpells, setCustomSpells] = useState([]); // Stores { spellData, imageFile?, videoFile? }
    const [editingSpellIndex, setEditingSpellIndex] = useState(null);

    // Ref to track if initialization has run
    const didInitialize = useRef(false);

    // --- Dynamic List Handlers ---
    const addTecnica = useCallback(() => setRidTecnicheList(prev => [...prev, { selectedTec: '', ridValue: '' }]), []);
    const removeTecnica = useCallback(index => setRidTecnicheList(prev => prev.filter((_, i) => i !== index)), []);
    const addSpell = useCallback(() => setRidSpellList(prev => [...prev, { selectedSpell: '', ridValue: '' }]), []);
    const removeSpell = useCallback(index => setRidSpellList(prev => prev.filter((_, i) => i !== index)), []);
    const addWeaponSpellLink = useCallback(() => setWeaponSpellsList(prev => [...prev, '']), []);
    const removeWeaponSpellLink = useCallback(index => setWeaponSpellsList(prev => prev.filter((_, i) => i !== index)), []);

    // --- Initialize Form Data ---
    const initializeFormData = useCallback((schemaData, initialItemData) => {
        console.log("Attempting to initialize FormData. Edit Mode:", editMode, "Initial Data:", initialItemData);
        let initialFormState = {};

        const getValue = (field, category = null, subField = null) => {
            if (initialItemData) {
                if (subField && category) return initialItemData.Parametri?.[category]?.[subField]?.[field] ?? '';
                if (category) return initialItemData.Parametri?.[category]?.[field] ?? '';
                return initialItemData[field] ?? '';
            }
            if (field === "Parametri") {
                 const params = {};
                Object.keys(schemaData[field] || {}).forEach(cat => {
                    params[cat] = {};
                    Object.keys(schemaData[field][cat] || {}).forEach(subF => {
                        params[cat][subF] = { "1": "", "4": "", "7": "", "10": "" };
                    });
                });
                return params;
            }
            if (["Penetrazione", "Danno", "Danno Critico", "Bonus Danno Critico", "Bonus Danno", "ridCostoSpell", "ridCostoTec"].includes(field)) {
                return { "1": "", "4": "", "7": "", "10": "" };
            }
             if (["Slot", "Hands", "Tipo"].includes(field) && Array.isArray(schemaData[field])) {
                return schemaData[field][0] || "";
            }
            if (typeof schemaData[field] === 'object' && !Array.isArray(schemaData[field]) && schemaData[field] !== null) {
                 return '';
             }
            return '';
        };

        Object.keys(schemaData || {}).forEach(field => {
            if (field === "Parametri") {
                initialFormState[field] = {};
                 Object.keys(schemaData[field] || {}).forEach(category => {
                    initialFormState[field][category] = {};
                    Object.keys(schemaData[field][category] || {}).forEach(subField => {
                        initialFormState[field][category][subField] = {
                            "1": initialItemData?.Parametri?.[category]?.[subField]?.["1"] ?? '',
                            "4": initialItemData?.Parametri?.[category]?.[subField]?.["4"] ?? '',
                            "7": initialItemData?.Parametri?.[category]?.[subField]?.["7"] ?? '',
                            "10": initialItemData?.Parametri?.[category]?.[subField]?.["10"] ?? '',
                        };
                    });
                });
            } else if (["Penetrazione", "Danno", "Danno Critico", "Bonus Danno Critico", "Bonus Danno", "ridCostoSpell", "ridCostoTec"].includes(field)) {
                initialFormState[field] = {
                    "1": initialItemData?.[field]?.["1"] ?? '',
                    "4": initialItemData?.[field]?.["4"] ?? '',
                    "7": initialItemData?.[field]?.["7"] ?? '',
                    "10": initialItemData?.[field]?.["10"] ?? '',
                };
            } else {
                initialFormState[field] = initialItemData?.[field] ?? getValue(field);
                if (field === 'prezzo' && typeof initialFormState[field] === 'number') {
                    initialFormState[field] = String(initialFormState[field]);
                }
            }
        });

        if (initialItemData) {
            setRidTecnicheList(initialItemData.ridCostoTecSingola ?
                Object.entries(initialItemData.ridCostoTecSingola).map(([tec, val]) => ({ selectedTec: tec, ridValue: String(val) })) : []
            );
            setRidSpellList(initialItemData.ridCostoSpellSingola ?
                Object.entries(initialItemData.ridCostoSpellSingola).map(([spell, val]) => ({ selectedSpell: spell, ridValue: String(val) })) : []
            );

            const initialLinkedSpells = [];
            const initialCustomSpells = [];
            if (initialItemData.spells && typeof initialItemData.spells === 'object') {
                Object.entries(initialItemData.spells).forEach(([name, data]) => {
                    if (data === true) {
                        initialLinkedSpells.push(name);
                    } else if (typeof data === 'object') {
                        initialCustomSpells.push({ spellData: data, imageFile: null, videoFile: null });
                    }
                });
            }
            setWeaponSpellsList(initialLinkedSpells);
            setCustomSpells(initialCustomSpells);

            if (initialItemData.image_url) {
                setImagePreviewUrl(initialItemData.image_url);
            } else {
                 setImagePreviewUrl(null);
            }
            setImageFile(null);

        } else {
            setRidTecnicheList([]);
            setRidSpellList([]);
            setWeaponSpellsList([]);
            setCustomSpells([]);
            setImagePreviewUrl(null);
            setImageFile(null);
        }

        initialFormState.Parametri = initialFormState.Parametri || { Base: {}, Combattimento: {} };
        initialFormState.spells = initialFormState.spells || {};

        console.log("Initialized FormData:", initialFormState);
        setWeaponFormData(initialFormState);
        didInitialize.current = true;

    }, [editMode]);

    // Fetch weapon schema
    useEffect(() => {
        setIsSchemaLoading(true);
        const fetchWeaponSchema = async () => {
            try {
                const schemaDocRef = doc(db, "utils", "schema_arma");
                const docSnap = await getDoc(schemaDocRef);
                if (docSnap.exists()) {
                    setSchema(docSnap.data());
                } else {
                    console.error("Weapon schema not found!");
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

    // Initialize form data based on schema and initialData
    useEffect(() => {
        if (schema && (editMode || !didInitialize.current)) {
             initializeFormData(schema, initialData);
        }
         if (schema && editMode && initialData) {
             console.log("Re-initializing due to initialData change in edit mode.");
             initializeFormData(schema, initialData);
         }
    }, [schema, initialData, editMode, initializeFormData]);

    // Fetch user data, spell schema, existing spells, and techniques
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
                if (spellSchemaSnap.exists()) {
                    setSpellSchema(spellSchemaSnap.data());
                } else {
                    console.error("Spell schema not found!");
                }

                const commonSpellsRef = doc(db, 'utils', 'spells_common');
                const commonSpellsSnap = await getDoc(commonSpellsRef);
                const commonSpells = commonSpellsSnap.exists() ? commonSpellsSnap.data() : {};
                const userSpells = userSnap.exists() ? userSnap.data().spells || {} : {};
                const initialSpellNames = initialData?.spells ? Object.keys(initialData.spells) : [];
                const currentCustomSpellNames = customSpells.map(cs => cs.spellData.Nome.trim());
                setSpellsList([...new Set([...Object.keys(commonSpells), ...Object.keys(userSpells), ...initialSpellNames, ...currentCustomSpellNames])].sort());

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
                const initialTecNames = initialData?.ridCostoTecSingola ? Object.keys(initialData.ridCostoTecSingola) : [];
                setTecnicheList([...new Set([...Object.keys(commonTecniche), ...Object.keys(userTecniche), ...initialTecNames])].sort());

            } catch (error) {
                console.error('Error fetching initial data:', error);
            }
        };
        fetchData();
    }, [user, initialData, customSpells]);

    // Handler for SpellOverlay close
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
            setImagePreviewUrl(URL.createObjectURL(file));
        }
    };

    // --- Spell Button Handlers (defined at top level) ---
    const handleAddSpellClick = useCallback(() => {
        setEditingSpellIndex(null);
        setShowSpellOverlay(true);
    }, []); // No dependencies needed

    const handleEditSpellClick = useCallback((index) => {
        console.log("Editing custom spell index:", index, "Data:", customSpells[index]);
        setEditingSpellIndex(index);
        setShowSpellOverlay(true);
    }, [customSpells]); // Depends on customSpells to get the correct data

    const handleRemoveCustomSpell = useCallback((index) => {
        setCustomSpells(prev => prev.filter((_, i) => i !== index));
    }, []); // No dependencies needed

    // --- Main Save Handler ---
    const handleSaveWeapon = async () => {
        // ... (keep existing save logic)
        setIsLoading(true);
        const weaponName = weaponFormData.Nome ? weaponFormData.Nome.trim() : "";
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

            let finalWeaponData = { ...weaponFormData };
            finalWeaponData.item_type = "weapon";
            delete finalWeaponData.ownerId;

            // Image Handling
            let newImageUrl = editMode ? (initialData?.image_url ?? null) : null;
            if (imageFile) {
                const weaponImgFileName = `weapon_${docId}_${Date.now()}_${imageFile.name}`;
                const weaponImgRef = ref(storage, 'items/' + weaponImgFileName);
                await uploadBytes(weaponImgRef, imageFile);
                newImageUrl = await getDownloadURL(weaponImgRef);

                if (editMode && initialData?.image_url && initialData.image_url !== newImageUrl) {
                    try {
                        const oldPath = decodeURIComponent(initialData.image_url.split('/o/')[1].split('?')[0]);
                        await deleteObject(ref(storage, oldPath));
                    } catch (e) { console.warn("Failed to delete old image:", e.code === 'storage/object-not-found' ? 'Old file not found.' : e.message); }
                }
            } else if (editMode && !weaponFormData.image_url && initialData?.image_url) {
                 // Handle case where image was removed during edit
                 newImageUrl = null;
                 try {
                     const oldPath = decodeURIComponent(initialData.image_url.split('/o/')[1].split('?')[0]);
                     await deleteObject(ref(storage, oldPath));
                     console.log("Deleted image that was removed during edit.");
                 } catch (e) { console.warn("Failed to delete removed image:", e.code === 'storage/object-not-found' ? 'File not found.' : e.message); }
            }
            finalWeaponData.image_url = newImageUrl;

            // Spell Handling
            const finalSpells = {};
            for (const spellObj of customSpells) {
                const createdSpellData = { ...spellObj.spellData };
                const spellName = createdSpellData.Nome.trim();
                const initialSpell = (editMode && initialData?.spells?.[spellName] && typeof initialData.spells[spellName] === 'object') ? initialData.spells[spellName] : {};
                const safeBase = `spell_${docId}_${spellName.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;

                let spellImageUrl = spellObj.spellData.image_url || initialSpell.image_url || null;
                let spellVideoUrl = spellObj.spellData.video_url || initialSpell.video_url || null;

                if (spellObj.imageFile) {
                    const spellImgRef = ref(storage, `spells/${safeBase}_image`);
                    await uploadBytes(spellImgRef, spellObj.imageFile);
                    spellImageUrl = await getDownloadURL(spellImgRef);
                    if (initialSpell.image_url && initialSpell.image_url !== spellImageUrl) {
                         try { await deleteObject(ref(storage, decodeURIComponent(initialSpell.image_url.split('/o/')[1].split('?')[0]))); } catch(e) { console.warn("Failed to delete old spell image"); }
                    }
                }
                if (spellObj.videoFile) {
                    const spellVidRef = ref(storage, `spells/videos/${safeBase}_video`);
                    await uploadBytes(spellVidRef, spellObj.videoFile);
                    spellVideoUrl = await getDownloadURL(spellVidRef);
                    if (initialSpell.video_url && initialSpell.video_url !== spellVideoUrl) {
                         try { await deleteObject(ref(storage, decodeURIComponent(initialSpell.video_url.split('/o/')[1].split('?')[0]))); } catch(e) { console.warn("Failed to delete old spell video"); }
                    }
                }
                createdSpellData.image_url = spellImageUrl;
                createdSpellData.video_url = spellVideoUrl;
                finalSpells[spellName] = createdSpellData;
            }

            weaponSpellsList.forEach(spellName => {
                if (spellName && !finalSpells[spellName]) {
                    finalSpells[spellName] = true;
                }
            });

            if (editMode && initialData?.spells) {
                for (const initialSpellName in initialData.spells) {
                    if (!finalSpells[initialSpellName]) {
                        const initialSpellData = initialData.spells[initialSpellName];
                        if (typeof initialSpellData === 'object') {
                            if (initialSpellData.image_url) try { await deleteObject(ref(storage, decodeURIComponent(initialSpellData.image_url.split('/o/')[1].split('?')[0]))); } catch(e) { console.warn("Failed to delete removed spell image"); }
                            if (initialSpellData.video_url) try { await deleteObject(ref(storage, decodeURIComponent(initialSpellData.video_url.split('/o/')[1].split('?')[0]))); } catch(e) { console.warn("Failed to delete removed spell video"); }
                        }
                    }
                }
            }
            finalWeaponData.spells = finalSpells;

            // Reductions Handling
            finalWeaponData.ridCostoTecSingola = ridTecnicheList.reduce((acc, { selectedTec, ridValue }) => {
                if (selectedTec && ridValue.trim() !== '') acc[selectedTec] = Number(ridValue);
                return acc;
            }, {});
            finalWeaponData.ridCostoSpellSingola = ridSpellList.reduce((acc, { selectedSpell, ridValue }) => {
                if (selectedSpell && ridValue.trim() !== '') acc[selectedSpell] = Number(ridValue);
                return acc;
            }, {});

            // Finalize Data
            let prezzoValue = 0;
            if (typeof finalWeaponData.prezzo === 'string' && finalWeaponData.prezzo.trim() !== '') {
                const parsed = parseInt(finalWeaponData.prezzo.trim(), 10);
                prezzoValue = isNaN(parsed) ? 0 : parsed;
            }
            finalWeaponData.prezzo = prezzoValue;
            delete finalWeaponData.tempSpellData;
            delete finalWeaponData.showSpellOverlay;

            // Save to Firestore
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

    // --- Rendering Functions ---

    const renderBasicFields = () => {
        // ... (keep existing basic fields rendering logic)
        if (isSchemaLoading) return <div className="text-white p-4 text-center">Caricamento schema...</div>;
        if (!schema) return <div className="text-white p-4 text-center text-red-500">Errore: Schema non caricato.</div>;

        return (
            <div>
                {/* Row 1: Name, Slot, Image Placeholder */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    {/* Name */}
                    <div className="md:col-span-1">
                        <label className="block text-white mb-1">Nome <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={weaponFormData.Nome || ''}
                            onChange={(e) => setWeaponFormData({ ...weaponFormData, Nome: e.target.value })}
                            className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="Nome Arma (Obbligatorio)"
                            required
                            disabled={editMode}
                            title={editMode ? "Il nome non può essere modificato." : ""}
                        />
                         {editMode && <p className="text-xs text-gray-400 mt-1">Il nome non è modificabile.</p>}
                    </div>

                    {/* Slot */}
                    <div className="md:col-span-1">
                        {schema.Slot !== undefined && Array.isArray(schema.Slot) && (
                            <>
                                <label className="block text-white mb-1">Slot</label>
                                <select
                                    value={weaponFormData.Slot || (schema.Slot[0] || '')}
                                    onChange={(e) => setWeaponFormData({ ...weaponFormData, Slot: e.target.value })}
                                    className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    {schema.Slot.map(option => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
                            </>
                        )}
                    </div>

                    {/* Image Upload */}
                    <div className="md:col-span-1 md:row-span-2">
                        <label className="block text-white mb-1">Immagine</label>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="w-full text-sm text-gray-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 cursor-pointer mb-2"
                        />
                         {/* Button to remove image */}
                         {(imagePreviewUrl || (editMode && weaponFormData.image_url)) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setImagePreviewUrl(null);
                                    setImageFile(null);
                                    // Signal removal for save logic
                                    setWeaponFormData({...weaponFormData, image_url: null });
                                }}
                                className="text-xs text-red-400 hover:text-red-300 mb-1"
                            >
                                Rimuovi Immagine
                            </button>
                        )}
                        <div className="w-24 h-24 rounded border border-dashed border-gray-600 flex items-center justify-center bg-gray-700/50 overflow-hidden">
                             {(imagePreviewUrl || weaponFormData.image_url) ? (
                                <img src={imagePreviewUrl || weaponFormData.image_url} alt="Preview" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-gray-500 text-xs text-center">Nessuna Immagine</span>
                            )}
                        </div>
                    </div>

                    {/* Row 2: Tipo, Hands */}
                    <div className="md:col-span-1">
                        {schema.Tipo !== undefined && Array.isArray(schema.Tipo) && (
                            <>
                                <label className="block text-white mb-1">Tipo</label>
                                <select
                                    value={weaponFormData.Tipo || (schema.Tipo[0] || '')}
                                    onChange={(e) => setWeaponFormData({ ...weaponFormData, Tipo: e.target.value })}
                                     className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    {schema.Tipo.map(option => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
                            </>
                        )}
                    </div>

                    <div className="md:col-span-1">
                        {schema.Hands !== undefined && Array.isArray(schema.Hands) && (
                            <>
                                <label className="block text-white mb-1">Hands</label>
                                <select
                                     value={weaponFormData.Hands !== undefined ? String(weaponFormData.Hands) : (schema.Hands[0] !== undefined ? String(schema.Hands[0]) : '')}
                                     onChange={(e) => setWeaponFormData({ ...weaponFormData, Hands: e.target.value })}
                                     className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    {schema.Hands.map(option => (
                                         <option key={option} value={String(option)}>{option}</option>
                                    ))}
                                </select>
                            </>
                        )}
                    </div>
                </div>

                {/* Row 3: Effect */}
                <div className="mb-4">
                     <label className="block text-white mb-1">Effetto</label>
                     <textarea
                        value={weaponFormData.Effetto || ''}
                        onChange={(e) => setWeaponFormData({ ...weaponFormData, Effetto: e.target.value })}
                         className="w-full p-2 rounded bg-gray-700 text-white h-20 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        placeholder="Descrizione effetto..."
                    />
                </div>

                {/* Row 4: Requirements, Price */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="block text-white mb-1">Requisiti</label>
                        <input
                            type="text"
                            value={weaponFormData.requisiti || ''}
                            onChange={(e) => setWeaponFormData({ ...weaponFormData, requisiti: e.target.value })}
                             className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="Es: STR 10"
                        />
                    </div>
                    <div>
                        <label className="block text-white mb-1">Prezzo</label>
                        <input
                            type="text"
                            value={weaponFormData.prezzo || ''}
                             onChange={(e) => {
                                const value = e.target.value;
                                if (/^\d*$/.test(value)) {
                                     setWeaponFormData({ ...weaponFormData, prezzo: value });
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
        // ... (keep existing tables rendering logic)
        if (isSchemaLoading || !schema || !schema.Parametri) return null;

        const levels = ["1", "4", "7", "10"];
        const specialFields = schema.Penetrazione !== undefined ? ["Penetrazione", "Danno", "Bonus Danno", "Danno Critico", "Bonus Danno Critico", "ridCostoSpell", "ridCostoTec"] : [];
        const baseParamFields = schema.Parametri.Base ? Object.keys(schema.Parametri.Base) : [];
        const combatParamFields = schema.Parametri.Combattimento ? Object.keys(schema.Parametri.Combattimento) : [];

        const renderTable = (title, fields, category = null) => {
            const schemaHasFields = fields.some(field =>
                category
                    ? schema.Parametri?.[category]?.[field] !== undefined
                    : schema[field] !== undefined
            );
            if (!schemaHasFields) return null;

            const relevantFields = fields.filter(f => category ? schema.Parametri?.[category]?.[f] !== undefined : schema[f] !== undefined);
            if (relevantFields.length === 0) return null;

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
                                {relevantFields.map((field, i) => {
                                    const isLastRow = i === relevantFields.length - 1;
                                    const rowData = category
                                        ? weaponFormData.Parametri?.[category]?.[field]
                                        : weaponFormData[field];

                                    return (
                                        <tr key={field}>
                                            <td className={`bg-gray-700/30 px-2 py-1.5 ${isLastRow ? 'rounded-bl-lg' : ''} text-left`}>
                                                {field}
                                            </td>
                                            {levels.map((lvl, j) => {
                                                const value = (rowData && rowData[lvl]) || '';
                                                const isParamCategory = category === 'Base' || category === 'Combattimento';
                                                const computed = isParamCategory && value && userParams ? computeValue(value, userParams) : null;

                                                return (
                                                    <td key={lvl} className={`bg-gray-700/30 px-1 py-1 ${isLastRow && j === levels.length - 1 ? 'rounded-br-lg' : ''}`}>
                                                        <div className="flex items-center justify-center">
                                                            <input
                                                                type="text"
                                                                value={value}
                                                                onChange={(e) => {
                                                                    const newValue = e.target.value;
                                                                    setWeaponFormData(prev => {
                                                                        const newData = JSON.parse(JSON.stringify(prev));
                                                                        if (category) {
                                                                            if (!newData.Parametri) newData.Parametri = { Base: {}, Combattimento: {} };
                                                                            if (!newData.Parametri[category]) newData.Parametri[category] = {};
                                                                            if (!newData.Parametri[category][field]) newData.Parametri[category][field] = {};
                                                                            newData.Parametri[category][field][lvl] = newValue;
                                                                        } else {
                                                                            if (!newData[field]) newData[field] = {};
                                                                            newData[field][lvl] = newValue;
                                                                        }
                                                                        return newData;
                                                                    });
                                                                }}
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
                 {renderTable("Parametri Speciali", specialFields)}
                 {renderTable("Parametri Base", baseParamFields, "Base")}
                 {renderTable("Parametri Combattimento", combatParamFields, "Combattimento")}
            </div>
        );
    };

    const renderReductionsAndSpells = () => {
         if (isSchemaLoading) return null;

        return (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Column 1: Reductions */}
                <div className="space-y-4 bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                    {/* --- Single Technique Reductions --- */}
                    <div>
                        <label className="block text-white mb-2 font-medium">Riduzioni Costo Tecniche Singole</label>
                        {ridTecnicheList.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 mb-2 p-2 bg-gray-700/50 rounded">
                                <select
                                    value={item.selectedTec}
                                    onChange={e => {
                                        const newList = [...ridTecnicheList];
                                        newList[idx].selectedTec = e.target.value;
                                        setRidTecnicheList(newList);
                                    }}
                                    className="flex-grow p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                >
                                    <option value="" disabled>Seleziona tecnica...</option>
                                    {tecnicheList.map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                                <input
                                    type="number"
                                    value={item.ridValue}
                                    onChange={e => {
                                        const newList = [...ridTecnicheList];
                                        newList[idx].ridValue = e.target.value;
                                        setRidTecnicheList(newList);
                                    }}
                                    placeholder="Valore"
                                    className="w-24 p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                />
                                {/* Use stable removeTecnica handler */}
                                <button type="button" onClick={() => removeTecnica(idx)} className="text-red-500 hover:text-red-400 p-1"><FaTrash /></button>
                            </div>
                        ))}
                        {/* Use stable addTecnica handler */}
                        <button
                            type="button"
                            onClick={addTecnica}
                            className="mt-1 text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                            disabled={tecnicheList.length === 0}
                        >
                            + Aggiungi Riduzione Tecnica
                        </button>
                        {tecnicheList.length === 0 && <p className="text-xs text-gray-400 mt-1">Nessuna tecnica disponibile.</p>}
                    </div>

                    {/* --- Single Spell Reductions --- */}
                    <div className="mt-4 pt-4 border-t border-gray-700/50">
                        <label className="block text-white mb-2 font-medium">Riduzioni Costo Spell Singole</label>
                        {ridSpellList.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 mb-2 p-2 bg-gray-700/50 rounded">
                                <select
                                    value={item.selectedSpell}
                                    onChange={e => {
                                        const newList = [...ridSpellList];
                                        newList[idx].selectedSpell = e.target.value;
                                        setRidSpellList(newList);
                                    }}
                                    className="flex-grow p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                >
                                    <option value="" disabled>Seleziona spell...</option>
                                    {spellsList.map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                                <input
                                    type="number"
                                    value={item.ridValue}
                                    onChange={e => {
                                        const newList = [...ridSpellList];
                                        newList[idx].ridValue = e.target.value;
                                        setRidSpellList(newList);
                                    }}
                                    placeholder="Valore"
                                    className="w-24 p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                />
                                {/* Use stable removeSpell handler */}
                                <button type="button" onClick={() => removeSpell(idx)} className="text-red-500 hover:text-red-400 p-1"><FaTrash /></button>
                            </div>
                        ))}
                        {/* Use stable addSpell handler */}
                        <button
                            type="button"
                            onClick={addSpell}
                            className="mt-1 text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                            disabled={spellsList.length === 0}
                        >
                            + Aggiungi Riduzione Spell
                        </button>
                         {spellsList.length === 0 && <p className="text-xs text-gray-400 mt-1">Nessuno spell disponibile.</p>}
                    </div>
                </div>

                {/* Column 2: Weapon Spells */}
                 <div className="space-y-4 bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                    <label className="block text-white mb-2 font-medium">Spells Conferiti dall'Arma</label>
                    <p className="text-xs text-gray-400 mb-2">Crea/Modifica spells specifici per l'arma o collega spells esistenti.</p>

                    {/* Button to open Spell Creation Overlay */}
                    <div className="mb-3">
                         {/* Use stable handleAddSpellClick handler */}
                        <AddSpellButton onClick={handleAddSpellClick} />

                        {/* Display Custom Spells */}
                        {Array.isArray(customSpells) && customSpells.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-700/30">
                                <p className="text-sm text-gray-300 mb-1">Spells custom (da salvare con l'arma):</p>
                                <ul className="text-xs text-white list-none ml-0 space-y-1">
                                    {customSpells.map((s, idx) => (
                                        <li key={s?.spellData?.Nome || idx} className="flex items-center gap-2 bg-gray-700/40 p-1.5 rounded">
                                            {/* Delete Button - Use stable handleRemoveCustomSpell */}
                                            <button
                                                type="button"
                                                className="text-red-400 hover:text-red-300 p-1 flex-shrink-0"
                                                onClick={() => handleRemoveCustomSpell(idx)}
                                                aria-label="Rimuovi spell custom"
                                                title="Rimuovi spell custom (modifica locale)"
                                            >
                                                <FaTrash size="0.8em"/>
                                            </button>
                                            {/* Edit Button - Use stable handleEditSpellClick */}
                                            <button
                                                type="button"
                                                className="text-blue-400 hover:text-blue-300 p-1 flex-shrink-0"
                                                onClick={() => handleEditSpellClick(idx)}
                                                aria-label="Modifica spell custom"
                                                title="Modifica spell custom"
                                            >
                                                <FaEdit size="0.8em"/>
                                            </button>
                                            {/* Spell Name */}
                                            <span className="flex-grow truncate" title={s?.spellData?.Nome}>
                                                {s?.spellData?.Nome || "Nome Mancante"}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>

                    {/* List to select EXISTING spells to link */}
                    <div className="mt-4 pt-4 border-t border-gray-700/50">
                        <label className="block text-white text-sm mb-1">Collega Spells Esistenti:</label>
                         {weaponSpellsList.map((selectedSpellName, idx) => (
                            <div key={idx} className="flex items-center gap-2 mb-2 p-2 bg-gray-700/50 rounded">
                                <select
                                    value={selectedSpellName}
                                    onChange={e => {
                                        const newName = e.target.value;
                                        setWeaponSpellsList(prev => {
                                            const newList = [...prev];
                                            newList[idx] = newName;
                                            return [...new Set(newList.filter(Boolean))];
                                         });
                                    }}
                                     className="flex-grow p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                >
                                    <option value="" disabled>Seleziona spell esistente...</option>
                                    {spellsList
                                        .filter(name =>
                                            !customSpells.some(s => s.spellData.Nome.trim() === name) &&
                                            (name === selectedSpellName || !weaponSpellsList.includes(name))
                                        )
                                        .map(name => (
                                            <option key={name} value={name}>
                                                {name}
                                            </option>
                                        ))}
                                </select>
                                {/* Use stable removeWeaponSpellLink handler */}
                                <button type="button" onClick={() => removeWeaponSpellLink(idx)} className="text-red-500 hover:text-red-400 p-1"><FaTrash /></button>
                            </div>
                        ))}
                        {/* Use stable addWeaponSpellLink handler */}
                        <button
                            type="button"
                            onClick={addWeaponSpellLink}
                            className="mt-1 text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                            disabled={spellsList.length === 0 || spellsList.filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name) && !weaponSpellsList.includes(name)).length === 0}
                        >
                            + Collega Spell Esistente
                        </button>
                         {spellsList.length === 0 && <p className="text-xs text-gray-400 mt-1">Nessuno spell disponibile per il collegamento.</p>}
                    </div>
                </div>
            </div>
        );
    };


    // --- Main Component Render ---
    return (
        <>
            <WeaponOverlay
                title={editMode ? `Modifica Arma: ${initialData?.Nome || ''}` : "Aggiungi Nuova Arma"}
                onClose={onClose}
                onSave={handleSaveWeapon}
                saveButtonText={editMode ? "Salva Modifiche" : "Crea Arma"}
                isLoading={isLoading || isSchemaLoading}
            >
                {isSchemaLoading ? (
                     <div className="text-white p-4 text-center">Caricamento Dati...</div>
                ) : !schema ? (
                     <div className="text-white p-4 text-center text-red-500">Errore: Impossibile caricare lo schema. Riprova o contatta l'assistenza.</div>
                ) : (
                    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
                        {renderBasicFields()}
                        {renderTablesSection()}
                        {renderReductionsAndSpells()}
                    </form>
                )}
            </WeaponOverlay>

            {/* Spell Creation/Editing Overlay */}
            {showSpellOverlay && spellSchema && userName && (
                <SpellOverlay
                    mode={editingSpellIndex !== null ? "edit" : "add"}
                    schema={spellSchema}
                    userName={userName}
                    onClose={handleSpellCreate} // Already wrapped in useCallback
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
