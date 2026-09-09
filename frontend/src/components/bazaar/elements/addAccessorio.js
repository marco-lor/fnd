import { catalogSetDoc, catalogUpdateDoc, catalogDeleteDoc } from '../../../data/bazaarCatalogRepository';
// addAccessorio.js
import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import VisibilitySelector from '../../common/VisibilitySelector';
import {
    getCommonSpells,
    getCommonTechniques,
    getSchema,
} from '../../../data/configRepository';
import { collection, doc, onSnapshot, getDoc } from "../../../performance/firestore";
import {
    createLegacyStorageCleanup,
    deleteLegacyStoragePath,
    uploadLegacyImage,
} from "../../common/legacyMediaStorage";
import useObjectUrl from "../../common/useObjectUrl";
import MediaImage from "../../common/MediaImage";
import useTask07MediaOperationOwner from "../../../data/media/useTask07MediaOperationOwner";
import { persistCanonicalInventoryItem } from "../../../data/media/privateInventoryMediaWriter";
import { createUserOperationId } from "../../../data/userData/userDataCommands";
import {
    isTask07CatalogItemWriterEnabled,
    prepareTask07CatalogEmbeddedSpells,
    retireTask07CatalogItemImage,
    runTask07CatalogItemWriter,
    runTask07CatalogEmbeddedMediaOperations,
    task07CatalogEmbeddedSpellEditorState,
    task07CatalogItemImageEditorState,
    withTask07CatalogLegacyImageField,
} from "../../../data/media/catalogItemMediaWriter";
import {
    resolveTask07CatalogCreateAttempt,
    task07EmbeddedFileFingerprint,
} from "../../../data/media/embeddedMediaRetry";
import {
    describeTask07ConsumerOutcome,
    task07ConsumerNeedsAttention,
} from "../../../data/media/mediaConsumerAdapter";
import { db } from '../../firebaseConfig';
import { AuthContext } from '../../../AuthContext';
import { WeaponOverlay } from '../../common/WeaponOverlay';
import { SpellOverlay } from '../../common/SpellOverlay';
import { AddSpellButton } from '../../dmDashboard/elements/buttons/addSpell';
import { FaTrash, FaEdit } from 'react-icons/fa';
import { computeValue } from '../../common/computeFormula';
import {
    usePersonalSpells,
    usePersonalTechniques,
    useProgression,
} from '../../../data/userData/userDataHooks';
import { getUserDirectoryPage } from '../../../data/userDirectoryRepository';

export function AddAccessorioOverlay({ onClose, showMessage, initialData = null, editMode = false, inventoryEditMode = false, inventoryUserId = null, inventoryItemId = null, inventoryItemIndex = null }) {
    const [accessorioFormData, setAccessorioFormData] = useState({});
    const [schema, setSchema] = useState(null);
    const [isSchemaLoading, setIsSchemaLoading] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [imageFile, setImageFile] = useState(null);
    const [imageRemoved, setImageRemoved] = useState(false);
    const imageObjectUrl = useObjectUrl(imageFile);
    const imageEditor = task07CatalogItemImageEditorState(
        initialData || accessorioFormData,
        { objectUrl: imageObjectUrl, removed: imageRemoved }
    );
    const imagePreviewUrl = imageEditor.src;
    const [ridTecnicheList, setRidTecnicheList] = useState([]);
    const [ridSpellList, setRidSpellList] = useState([]);
    const [customSpells, setCustomSpells] = useState([]);
    const [accessorioSpellsList, setAccessorioSpellsList] = useState([]);
    const [tecnicheList, setTecnicheList] = useState([]);
    const [spellsList, setSpellsList] = useState([]);    const [showSpellOverlay, setShowSpellOverlay] = useState(false);
    const [editingSpellIndex, setEditingSpellIndex] = useState(null);

    const [users, setUsers] = useState([]);
    const [visibility, setVisibility] = useState('all');
    const [allowedUsers, setAllowedUsers] = useState([]);

    const { user, userData } = useContext(AuthContext);
    const role = userData?.role;
    const { data: progression } = useProgression(user?.uid);
    const { data: personalSpells } = usePersonalSpells(user?.uid);
    const { data: personalTechniques } = usePersonalTechniques(user?.uid);
    const task07MediaOperationOwner = useTask07MediaOperationOwner();
    const [userParams, setUserParams] = useState({ Base: {}, Combattimento: {} });
    const [userName, setUserName] = useState("");
    const [spellSchema, setSpellSchema] = useState(null);

    const prevInitialDataIdRef = useRef(null);
    const formInitializedForCurrentItem = useRef(false);
    const pendingCatalogCreateRef = useRef(null);
    const completedEmbeddedOperationsRef = useRef(new Set());
    const completedRootUploadRef = useRef(null);

    // Nested change handler
    const handleNestedChange = useCallback((path, value) => {
        const keys = path.split('.');
        setAccessorioFormData(prev => {
            const newData = JSON.parse(JSON.stringify(prev));
            let current = newData;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {};
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = value;
            return newData;
        });
    }, []);

    // Image handling
    const handleImageChange = useCallback((e) => {
        const file = e.target.files[0];
        if (file) {
            setImageFile(file);
            setImageRemoved(false);
        }
    }, []);

    // List management functions
    const addTecnica = useCallback(() => setRidTecnicheList(prev => [...prev, { selectedTec: '', ridValue: '' }]), []);
    const removeTecnica = useCallback(index => setRidTecnicheList(prev => prev.filter((_, i) => i !== index)), []);
    const addSpell = useCallback(() => setRidSpellList(prev => [...prev, { selectedSpell: '', ridValue: '' }]), []);
    const removeSpell = useCallback(index => setRidSpellList(prev => prev.filter((_, i) => i !== index)), []);
    const addAccessorioSpellLink = useCallback(() => setAccessorioSpellsList(prev => [...prev, '']), []);
    const removeAccessorioSpellLink = useCallback(index => setAccessorioSpellsList(prev => prev.filter((_, i) => i !== index)), []);

    // New visibility handler
    const handleVisibilityChange = (newVisibility, newAllowed) => {
        setVisibility(newVisibility);
        setAllowedUsers(newAllowed);
    };

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const page = await getUserDirectoryPage();
                const list = (page?.items || []).map((entry) => ({
                    id: entry.id,
                    characterId: entry.label,
                    role: entry.role,
                }));
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

        // Initialize General fields from schema
        if (schemaData.General) {
            Object.keys(schemaData.General).forEach(key => {
                if (Array.isArray(schemaData.General[key]) && schemaData.General[key].length > 0) {
                    initialFormState.General[key] = schemaData.General[key][0];
                } else if (typeof schemaData.General[key] === 'string') {
                    initialFormState.General[key] = schemaData.General[key];
                } else if (typeof schemaData.General[key] === 'number') {
                    initialFormState.General[key] = schemaData.General[key];
                }
            });
        }

        // Initialize Specific fields from schema
        if (schemaData.Specific) {
            Object.keys(schemaData.Specific).forEach(key => {
                if (Array.isArray(schemaData.Specific[key]) && schemaData.Specific[key].length > 0) {
                    initialFormState.Specific[key] = schemaData.Specific[key][0];
                } else if (typeof schemaData.Specific[key] === 'string') {
                    initialFormState.Specific[key] = schemaData.Specific[key];
                } else if (typeof schemaData.Specific[key] === 'number') {
                    initialFormState.Specific[key] = schemaData.Specific[key];
                }
            });
        }

        // Initialize parameter tables
        if (schemaData.Parametri) {
            ['Base', 'Combattimento', 'Special'].forEach(category => {
                if (schemaData.Parametri[category]) {
                    Object.keys(schemaData.Parametri[category]).forEach(param => {
                        if (!initialFormState.Parametri[category][param]) {
                            initialFormState.Parametri[category][param] = {};
                        }
                        ['1', '4', '7', '10'].forEach(level => {
                            initialFormState.Parametri[category][param][level] = '';
                        });
                    });
                }
            });
        }

        // Override with actual data if in edit mode
        if (editMode && currentItemData) {
            if (currentItemData.General) {
                initialFormState.General = { ...initialFormState.General, ...currentItemData.General };
            }
            if (currentItemData.Specific) {
                initialFormState.Specific = { ...initialFormState.Specific, ...currentItemData.Specific };
            }
            if (currentItemData.Parametri) {
                initialFormState.Parametri = {
                    Base: { ...initialFormState.Parametri.Base, ...(currentItemData.Parametri.Base || {}) },
                    Combattimento: { ...initialFormState.Parametri.Combattimento, ...(currentItemData.Parametri.Combattimento || {}) },
                    Special: { ...initialFormState.Parametri.Special, ...(currentItemData.Parametri.Special || {}) }
                };
            }

            // Handle reduction lists
            if (currentItemData.ridCostoTecSingola) {
                const tecList = Object.entries(currentItemData.ridCostoTecSingola).map(([tec, val]) => ({
                    selectedTec: tec, ridValue: String(val)
                }));
                setRidTecnicheList(tecList);
            }

            if (currentItemData.ridCostoSpellSingola) {
                const spellList = Object.entries(currentItemData.ridCostoSpellSingola).map(([spell, val]) => ({
                    selectedSpell: spell, ridValue: String(val)
                }));
                setRidSpellList(spellList);
            }            // Handle custom spells and linked spells
            const embeddedEditorState = task07CatalogEmbeddedSpellEditorState(
                currentItemData
            );
            setAccessorioSpellsList(embeddedEditorState.linkedSpells);
            setCustomSpells(embeddedEditorState.customSpells);

        }

        setAccessorioFormData(initialFormState);
        setImageFile(null);
        setImageRemoved(false);
        console.log("FormData initialized:", initialFormState);
    }, [editMode]);    // Schema fetching
    useEffect(() => {
        setIsSchemaLoading(true);
        const fetchAccessorioSchema = async () => {
            try {
                const schemaData = await getSchema('schema_accessorio');
                if (schemaData) {
                    setSchema(schemaData);
                } else {
                    console.error("Accessorio schema (schema_accessorio) not found!");
                    if (showMessage) showMessage("Errore: Schema accessorio non trovato.", "error");
                }
            } catch (error) {
                console.error("Error fetching accessorio schema:", error);
                if (showMessage) showMessage("Errore nel caricamento dello schema.", "error");
            } finally {
                setIsSchemaLoading(false);
            }
        };
        fetchAccessorioSchema();
    }, [showMessage]);

    // Initialize form data when schema loads
    useEffect(() => {
        if (schema) {
            if (editMode && initialData) {
                if (initialData.id !== prevInitialDataIdRef.current || !formInitializedForCurrentItem.current) {
                    console.log("Initializing FormData for item (edit mode):", initialData.General?.Nome, "ID:", initialData.id);
                    initializeFormData(schema, initialData);
                    prevInitialDataIdRef.current = initialData.id;
                    formInitializedForCurrentItem.current = true;
                } else {
                    console.log("Skipping re-initialization for already loaded item:", initialData.General?.Nome);
                }
            } else {
                console.log("Initializing FormData (add mode)");
                initializeFormData(schema, null);
                formInitializedForCurrentItem.current = true;
            }
        }    }, [schema, editMode, initialData, initializeFormData]);

    // Fetch spell schema and user data
    useEffect(() => {
        if (!user) return;
        const fetchData = async () => {
            try {
                setUserParams(progression?.Parametri || { Base: {}, Combattimento: {} });
                setUserName(userData?.characterId || user.email || "Unknown User");

                const spellSchemaData = await getSchema('schema_spell');
                if (spellSchemaData) setSpellSchema(spellSchemaData);
                else console.error("Spell schema not found!");

                const commonSpells = await getCommonSpells() || {};
                const userSpellNames = Object.entries(personalSpells || {}).map(([key, value]) => (
                    value?.name || value?.Nome || key
                ));

                const initialSpellNamesFromData = initialData?.General?.spells ? Object.keys(initialData.General.spells) : [];
                const currentCustomSpellNames = customSpells.map(cs => cs.spellData.Nome.trim());
                setSpellsList([...new Set([...Object.keys(commonSpells), ...userSpellNames, ...initialSpellNamesFromData, ...currentCustomSpellNames])].sort());

                let commonTecniche = {};
                try {
                    commonTecniche = await getCommonTechniques({ legacyFirst: true }) || {};
                } catch (error) {
                    console.error("Error fetching tecniche:", error);
                }

                const userTechniqueNames = Object.entries(personalTechniques || {}).map(([key, value]) => (
                    value?.name || value?.Nome || key
                ));
                const initialTecnicheNamesFromData = initialData?.ridTecniche ? Object.keys(initialData.ridTecniche) : [];
                setTecnicheList([...new Set([...Object.keys(commonTecniche), ...userTechniqueNames, ...initialTecnicheNamesFromData])].sort());

            } catch (error) {
                console.error("Error fetching data:", error);
                if (showMessage) showMessage("Errore nel caricamento dei dati utente.", "error");
            }
        };        fetchData();
    }, [customSpells, initialData?.General?.spells, initialData?.ridTecniche, personalSpells, personalTechniques, progression, showMessage, user, userData?.characterId]);

    // This effect runs on mount and when editMode changes.
    useEffect(() => {
        formInitializedForCurrentItem.current = false;
        // When the overlay is shown (component mounts) or mode changes,
        // we want to allow initialization.
    }, [editMode]); // Also implicitly runs on mount

    // Load tecniche and spells lists
    useEffect(() => {
        const unsubscribeTecniche = onSnapshot(collection(db, 'tecniche'), snapshot => {
            const tecniche = snapshot.docs.map(doc => doc.id);
            setTecnicheList(tecniche);
        });

        const unsubscribeSpells = onSnapshot(collection(db, 'spells'), snapshot => {
            const spells = snapshot.docs.map(doc => doc.id);
            setSpellsList(spells);
        });

        return () => {
            unsubscribeTecniche();
            unsubscribeSpells();
        };
    }, []);

    // Parameter change handler
    const handleParameterChange = useCallback((paramCategory, paramField, level, value) => {
        setAccessorioFormData(prev => ({
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
    }, []);    const handleSaveAccessorio = async () => {
        setIsLoading(true);
        const accessorioName = accessorioFormData.General?.Nome ? accessorioFormData.General.Nome.trim() : "";
        if (!accessorioName) {
            if (showMessage) showMessage("Il nome dell'accessorio è obbligatorio.", "error");
            setIsLoading(false);
            return;
        }

        const docId = editMode && initialData?.id ? initialData.id : accessorioName.replace(/\s+/g, "_");
        if (!docId) {
            if (showMessage) showMessage("Errore: Impossibile determinare l'ID del documento.", "error");
            setIsLoading(false);
            return;
        }
        const accessorioDocRef = doc(db, "items", docId);
        const deferredStorageCleanup = createLegacyStorageCleanup({
            onError: ({ path, error }) => {
                console.warn("Post-commit accessorio media cleanup failed:", path, error);
            },
        });
        let uploadedLegacyImagePath = '';
        let catalogWriteCommitted = false;
        
        try {
            let catalogBefore = null;
            let resumeCreate = false;
            if (!editMode) {
                const existingDocSnap = await getDoc(accessorioDocRef);
                const createAttempt = resolveTask07CatalogCreateAttempt({
                    documentExists: existingDocSnap.exists(),
                    documentId: docId,
                    pendingDocumentId: pendingCatalogCreateRef.current,
                });
                if (createAttempt.blocked) {
                    if (showMessage) showMessage(`Un accessorio con nome "${accessorioName}" (ID: ${docId}) esiste già.`, "error");
                    setIsLoading(false);
                    return;
                }
                resumeCreate = createAttempt.resume;
                catalogBefore = resumeCreate ? existingDocSnap.data() : null;
            } else if (!inventoryEditMode) {
                catalogBefore = (await getDoc(accessorioDocRef)).data() || null;
            }
            const catalogIsExisting = editMode || resumeCreate;
            const rootUploadKey = imageFile
                ? task07EmbeddedFileFingerprint(imageFile)
                : null;
            const rootMediaAlreadyCommitted = Boolean(
                rootUploadKey
                && completedRootUploadRef.current === rootUploadKey
                && (catalogBefore?.media?.assetId || catalogBefore?.General?.media?.assetId)
            );
            const task07V1Write = await isTask07CatalogItemWriterEnabled({
                actorUid: user?.uid,
                role,
                file: imageFile,
                inventoryEditMode,
            });
            if (inventoryEditMode && customSpells.some((entry) => entry?.imageFile || entry?.videoFile)) {
                throw new Error("Embedded spell media can only be changed on the catalog item.");
            }

            const embeddedSpellPlan = inventoryEditMode
                ? { operations: [], spells: Object.fromEntries(customSpells.map((entry) => [entry.spellData.Nome.trim(), {...entry.spellData}])) }
                : await prepareTask07CatalogEmbeddedSpells({
                    actorUid: user?.uid,
                    role,
                    itemId: accessorioDocRef.id,
                    currentItem: catalogBefore || initialData || {},
                    customSpells,
                });

            let finalAccessorioData = JSON.parse(JSON.stringify(accessorioFormData));
            if (!inventoryEditMode && catalogBefore?.task07EmbeddedMedia) {
                finalAccessorioData.task07EmbeddedMedia = catalogBefore.task07EmbeddedMedia;
            }

            // Handle image upload
            let newImageUrl = catalogIsExisting
                ? (catalogBefore?.General?.image_url ?? initialData?.General?.image_url ?? null)
                : null;
            if (imageFile && !task07V1Write && !inventoryEditMode) {
                const accessorioImgFileName = `accessorio_${docId}_${Date.now()}_${imageFile.name}`;
                uploadedLegacyImagePath = 'items/' + accessorioImgFileName;
                newImageUrl = (await uploadLegacyImage(uploadedLegacyImagePath, imageFile)).downloadUrl;
                if (!inventoryEditMode && editMode && initialData?.General?.image_url && initialData.General.image_url !== newImageUrl) {
                    deferredStorageCleanup.addUrl(initialData.General.image_url);
                }
            } else if (!inventoryEditMode && editMode && !imagePreviewUrl && initialData?.General?.image_url) {
                newImageUrl = null;
                deferredStorageCleanup.addUrl(initialData.General.image_url);
            }
            finalAccessorioData = withTask07CatalogLegacyImageField(finalAccessorioData, {
                editMode: catalogIsExisting,
                imageUrl: newImageUrl,
                task07V1Write,
            });

            // Handle custom spells
            let finalSpells = {...embeddedSpellPlan.spells};
            for (const customSpell of customSpells) {
                const spellNameKey = customSpell.spellData.Nome.trim();
                // Queue old files for cleanup only after the catalog document commits.
                if (!inventoryEditMode && editMode && initialData?.General?.spells?.[spellNameKey] && typeof initialData.General.spells[spellNameKey] === 'object') {
                    const initialSpellFromData = initialData.General.spells[spellNameKey];
                    if (!embeddedSpellPlan.enabled && customSpell.imageFile && initialSpellFromData.image_url) {
                        deferredStorageCleanup.addUrl(initialSpellFromData.image_url);
                    }
                    if (!embeddedSpellPlan.enabled && customSpell.videoFile && initialSpellFromData.video_url) {
                        deferredStorageCleanup.addUrl(initialSpellFromData.video_url);
                    }
                }
            }

            accessorioSpellsList.forEach(spellNameKey => {
                if (spellNameKey && !finalSpells[spellNameKey]) {
                    finalSpells[spellNameKey] = true;
                }
            });

            // Removed embedded spell media is retired by the item document
            // trigger, which rejects personal spell paths not owned by this item.
            finalAccessorioData.General.spells = finalSpells;

            finalAccessorioData.visibility = visibility;
            finalAccessorioData.allowed_users = visibility === 'custom' ? allowedUsers : [];

            finalAccessorioData.General.ridCostoTecSingola = ridTecnicheList.reduce((acc, { selectedTec, ridValue }) => {
                if (selectedTec && ridValue.trim() !== '') acc[selectedTec] = Number(ridValue);
                return acc;
            }, {});
            finalAccessorioData.General.ridCostoSpellSingola = ridSpellList.reduce((acc, { selectedSpell, ridValue }) => {
                if (selectedSpell && ridValue.trim() !== '') acc[selectedSpell] = Number(ridValue);
                return acc;
            }, {});

            let prezzoValue = 0;
            if (typeof finalAccessorioData.General.prezzo === 'string' && finalAccessorioData.General.prezzo.trim() !== '') {
                const parsed = parseInt(finalAccessorioData.General.prezzo.trim(), 10);
                prezzoValue = isNaN(parsed) ? 0 : parsed;
            } else if (typeof finalAccessorioData.General.prezzo === 'number') {
                prezzoValue = finalAccessorioData.General.prezzo;
            }
            finalAccessorioData.General.prezzo = prezzoValue;

            if (finalAccessorioData.Specific?.Hands !== undefined) {
                finalAccessorioData.Specific.Hands = Number(finalAccessorioData.Specific.Hands);
            }

            // Clean up temporary/old schema fields from root
            ['tempSpellData', 'showSpellOverlay', 'Nome', 'Slot', 'Effetto', 'requisiti', 'prezzo', 'image_url', 'Hands', 'Tipo', 'ridCostoTecSingola', 'ridCostoSpellSingola', 'spells'].forEach(key => delete finalAccessorioData[key]);
            if (finalAccessorioData.Parametri && !finalAccessorioData.Parametri.Base) { // Ensure root Parametri is not the one from old schema
                 delete finalAccessorioData.Parametri;            }            // Set item type to "accessorio"
            finalAccessorioData.item_type = "accessorio";

            if (inventoryEditMode) {
                const targetId = inventoryItemId
                    || initialData?._task05?.inventoryId
                    || initialData?._instance?.instanceId;
                if (!inventoryUserId || !targetId) {
                    throw new Error("Inventory edit requires a stable Task 05 inventory ID.");
                }
                const removeCanonicalImage = Boolean(
                    !imageFile
                    && imageRemoved
                    && initialData?.media?.assetId
                );
                const inventorySnapshot = { ...finalAccessorioData };
                if (imageFile || removeCanonicalImage) {
                    inventorySnapshot.General = {
                        ...inventorySnapshot.General,
                        image_url: null,
                    };
                    inventorySnapshot.user_image_custom = false;
                    inventorySnapshot.user_image_url = null;
                }
                const inventoryResult = await task07MediaOperationOwner.run((signal) => (
                    persistCanonicalInventoryItem({
                        userId: inventoryUserId,
                        inventoryItemId: targetId,
                        snapshot: inventorySnapshot,
                        file: imageFile,
                        removeImage: removeCanonicalImage,
                        retryKey: [inventoryUserId, targetId, createUserOperationId('inventory-editor')].join(':'),
                        signal,
                    })
                ));
                if (!inventoryResult) {
                    throw new Error("Canonical media is unavailable. The inventory item was not changed.");
                }
                if (task07ConsumerNeedsAttention(inventoryResult.outcome)) {
                    if (showMessage) showMessage(
                        describeTask07ConsumerOutcome(inventoryResult.outcome, "Accessorio inventory image"),
                        "warning"
                    );
                } else if (showMessage) {
                    showMessage("Accessorio aggiornato nell'inventario utente.", "success");
                }
                onClose(true);
            } else {
                if (imageRemoved) {
                    await task07MediaOperationOwner.run(() => (
                        retireTask07CatalogItemImage(catalogBefore)
                    ));
                }
                const persistCatalogParent = async () => {
                    if (catalogIsExisting) await catalogUpdateDoc(accessorioDocRef, finalAccessorioData);
                    else await catalogSetDoc(accessorioDocRef, finalAccessorioData);
                    catalogWriteCommitted = true;
                    if (!editMode) pendingCatalogCreateRef.current = docId;
                };
                if (task07V1Write && !rootMediaAlreadyCommitted) {
                    const outcome = await task07MediaOperationOwner.run((signal) => (
                        runTask07CatalogItemWriter({
                            actorUid: user.uid,
                            role,
                            itemId: accessorioDocRef.id,
                            file: imageFile,
                            currentItem: catalogBefore || initialData || {},
                            prepareEntity: persistCatalogParent,
                            rollbackPreparedEntity: async () => {
                                if (catalogBefore) await catalogSetDoc(accessorioDocRef, catalogBefore);
                                else {
                                    await catalogDeleteDoc(accessorioDocRef);
                                    pendingCatalogCreateRef.current = null;
                                    catalogWriteCommitted = false;
                                }
                            },
                            signal,
                        })
                    ));
                    if (!task07ConsumerNeedsAttention(outcome)) {
                        completedRootUploadRef.current = rootUploadKey;
                    }
                    if (task07ConsumerNeedsAttention(outcome)) {
                        if (showMessage) showMessage(
                            describeTask07ConsumerOutcome(outcome, "Accessorio image"),
                            "warning"
                        );
                    } else if (showMessage) {
                        showMessage(`Accessorio "${accessorioName}" salvato!`, "success");
                    }
                } else if (catalogIsExisting) {
                    console.log("Updating document:", docId, finalAccessorioData);
                    await persistCatalogParent();
                    if (showMessage) showMessage(`Accessorio "${accessorioName}" aggiornato!`, "success");
                } else {
                    console.log("Creating new document:", docId, finalAccessorioData);
                    await persistCatalogParent();
                    if (showMessage) showMessage(`Accessorio "${accessorioName}" creato!`, "success");
                }
                if (embeddedSpellPlan.operations.length > 0) {
                    await task07MediaOperationOwner.run((signal) => (
                        runTask07CatalogEmbeddedMediaOperations({
                            actorUid: user.uid,
                            role,
                            itemId: accessorioDocRef.id,
                            currentItem: catalogBefore || initialData || {},
                            completedOperationKeys: completedEmbeddedOperationsRef.current,
                            operations: embeddedSpellPlan.operations,
                            signal,
                        })
                    ));
                }
                await deferredStorageCleanup.flush();
                pendingCatalogCreateRef.current = null;
                completedEmbeddedOperationsRef.current.clear();
                completedRootUploadRef.current = null;
                onClose(true);
            }

        } catch (error) {
            console.error("Error saving accessorio:", error);
            if (uploadedLegacyImagePath && !catalogWriteCommitted) {
                try {
                    await deleteLegacyStoragePath(uploadedLegacyImagePath);
                } catch (cleanupError) {
                    console.warn("Accessorio upload rollback cleanup failed:", cleanupError);
                }
            }
            if (showMessage) showMessage(error?.message || "Errore nel salvataggio dell'accessorio.", "error");
        } finally {
            setIsLoading(false);
        }
    };    // Spell management functions
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
    }, []);    const handleSpellCreate = useCallback((result) => {
        console.log("Spell Create/Edit Result:", result);
        if (result?.spellData?.Nome) {
            if (editingSpellIndex !== null) {
                // Edit existing spell
                setCustomSpells(prev => prev.map((spell, index) => 
                    index === editingSpellIndex ? result : spell
                ));
                showMessage("Spell modificata con successo!", "success");
            } else {
                // Add new spell
                setCustomSpells(prev => [...prev, result]);
                showMessage("Nuova spell creata con successo!", "success");
            }
        } else {
            console.warn("Invalid spell result received:", result);
        }
        setShowSpellOverlay(false);
        setEditingSpellIndex(null);
    }, [editingSpellIndex, showMessage]);

    // Render functions
    const renderSpecificFields = () => {
        if (isSchemaLoading || !schema?.Specific) return null;

        const specificFields = Object.keys(schema.Specific).sort();
        if (specificFields.length === 0) return null;

        return (
            <div className="mt-6">
                <h3 className="text-white text-lg font-medium mb-4 border-b border-gray-600 pb-2">Campi Specifici</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {specificFields.map((fieldKey) => {
                        const schemaValue = schema.Specific[fieldKey];
                        const currentValue = accessorioFormData.Specific?.[fieldKey];
                        
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
                                value={accessorioFormData.General?.Nome || ''}
                                onChange={(e) => handleNestedChange('General.Nome', e.target.value)}
                                className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                placeholder="Es: Anello del Potere"
                                required
                                disabled={editMode}
                                title={editMode ? "Il nome non può essere modificato." : ""}
                            />
                            {editMode && <p className="text-xs text-gray-400 mt-1">Il nome non è modificabile.</p>}
                        </div>

                        <div className="md:col-span-1">
                            {schema?.General?.Slot && Array.isArray(schema.General.Slot) && (
                                <>
                                    <label className="block text-white mb-1">Slot</label>
                                    <select
                                        value={accessorioFormData.General?.Slot || (schema.General.Slot[0] || '')}
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
                                value={accessorioFormData.General?.requisiti || ''}
                                onChange={(e) => handleNestedChange('General.requisiti', e.target.value)}
                                className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                placeholder="Es: Forza 15"
                            />
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-white mb-1">Effetto</label>
                        <textarea
                            value={accessorioFormData.General?.Effetto || ''}
                            onChange={(e) => handleNestedChange('General.Effetto', e.target.value)}
                            className="w-full p-2 rounded bg-gray-700 text-white h-20 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="Descrivi l'effetto dell'accessorio..."
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-white mb-1">Prezzo</label>
                        <input
                            type="text"
                            value={accessorioFormData.General?.prezzo || ''}
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

                <div className="md:col-span-1 md:row-span-2">
                    <label className="block text-white mb-1">Immagine</label>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        className="w-full text-sm text-gray-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200 cursor-pointer mb-2"
                    />
                    {imageEditor.hasImage && (
                        <button
                            type="button"
                            onClick={() => {
                                setImageFile(null);
                                setImageRemoved(true);
                                handleNestedChange('General.image_url', null);
                            }}
                            className="text-xs text-red-400 hover:text-red-300 mb-1"
                        >
                            Rimuovi Immagine
                        </button>
                    )}
                    <div className="w-24 h-24 rounded border border-dashed border-gray-600 flex items-center justify-center bg-gray-700/50 overflow-hidden">
                        {imageEditor.hasImage ? (
                            <MediaImage
                                compatibilityMode={imageEditor.compatibilityMode}
                                media={imageEditor.media}
                                mediaPurpose={imageObjectUrl ? "" : "item"}
                                src={imagePreviewUrl}
                                variant="thumbnail"
                                loading="eager"
                                alt="Preview"
                                className="w-full h-full object-cover"
                            />
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
        }

        const levels = ["1", "4", "7", "10"];
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
                                    const rowData = accessorioFormData.Parametri?.[paramCategory]?.[field];
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
                                                                onChange={(e) => handleParameterChange(paramCategory, field, lvl, e.target.value)}
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
                                <button type="button" onClick={() => removeTecnica(idx)} className="text-red-500 hover:text-red-400 p-1">
                                    <FaTrash />
                                </button>
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
                                <button type="button" onClick={() => removeSpell(idx)} className="text-red-500 hover:text-red-400 p-1">
                                    <FaTrash />
                                </button>
                            </div>
                        ))}
                        <button type="button" onClick={addSpell} className="mt-1 text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed" disabled={spellsList.length === 0}>
                            + Aggiungi Riduzione Spell
                        </button>
                        {spellsList.length === 0 && <p className="text-xs text-gray-400 mt-1">Nessuno spell disponibile.</p>}
                    </div>
                </div>

                <div className="space-y-4 bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                    <label className="block text-white mb-2 font-medium">Spells Conferiti dall'Accessorio</label>
                    <p className="text-xs text-gray-400 mb-2">Crea/Modifica spells specifici per l'accessorio o collega spells esistenti.</p>
                    <div className="mb-3">
                        <AddSpellButton onClick={handleAddSpellClick} />
                        {Array.isArray(customSpells) && customSpells.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-700/30">
                                <p className="text-sm text-gray-300 mb-1">Spells custom (da salvare con l'accessorio):</p>
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
                        {accessorioSpellsList.map((selectedSpellName, idx) => (
                            <div key={`linked-spell-${idx}`} className="flex items-center gap-2 mb-2 p-2 bg-gray-700/50 rounded">
                                <select
                                    value={selectedSpellName}
                                    onChange={e => {
                                        const newName = e.target.value;
                                        setAccessorioSpellsList(prev => {
                                            const newList = [...prev]; 
                                            newList[idx] = newName; 
                                            return [...new Set(newList.filter(Boolean))];
                                        });
                                    }}
                                    className="flex-grow p-2 rounded bg-gray-600 text-white text-sm border border-gray-500/50"
                                >
                                    <option value="" disabled>Seleziona spell esistente...</option>
                                    {spellsList
                                        .filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name))
                                        .filter(name => name === selectedSpellName || !accessorioSpellsList.includes(name))
                                        .map(name => (<option key={name} value={name}>{name}</option>))}
                                </select>
                                <button type="button" onClick={() => removeAccessorioSpellLink(idx)} className="text-red-500 hover:text-red-400 p-1">
                                    <FaTrash />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button" 
                            onClick={addAccessorioSpellLink}
                            className="mt-1 text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                            disabled={spellsList.length === 0 || spellsList.filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name) && !accessorioSpellsList.includes(name)).length === 0}
                        >
                            + Collega Spell Esistente
                        </button>
                        {spellsList.length === 0 && <p className="text-xs text-gray-400 mt-1">Nessuno spell disponibile.</p>}
                        {spellsList.length > 0 && spellsList.filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name) && !accessorioSpellsList.includes(name)).length === 0 && (
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
                title={editMode ? `Modifica Accessorio: ${initialData?.General?.Nome || accessorioFormData.General?.Nome || ''}` : "Aggiungi Nuovo Accessorio"}
                onClose={() => onClose(false)}
                onSave={handleSaveAccessorio}
                saveButtonText={editMode ? "Salva Modifiche" : "Crea Accessorio"}
                isLoading={isLoading || isSchemaLoading}
            >                {isSchemaLoading ? (
                    <div className="text-white p-4 text-center">Caricamento Dati...</div>
                ) : !schema ? (
                    <div className="text-white p-4 text-center text-red-500">Errore: Impossibile caricare lo schema.</div>
                ) : !schema.General || !schema.Specific || !schema.Parametri ? (
                    <div className="text-white p-4 text-center text-red-500">Errore: Struttura schema accessorio non valida.</div>
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
