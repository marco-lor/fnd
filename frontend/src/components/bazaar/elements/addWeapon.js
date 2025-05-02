// file: ./frontend/src/components/bazaar/elements/addWeapon.js
import React, { useState, useEffect, useContext } from 'react';
import ReactDOM from 'react-dom';
import { db, storage } from '../../firebaseConfig';
import { doc, getDoc, setDoc } from "firebase/firestore"; // Removed updateDoc
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { AuthContext } from '../../../AuthContext';
import { computeValue } from '../../common/computeFormula';
import { AddSpellButton } from '../../dmDashboard/elements/buttons/addSpell'; // Keep button
import { SpellOverlay } from '../../common/SpellOverlay'; // Import SpellOverlay directly
import { FaTrash } from "react-icons/fa";

export function AddWeaponOverlay({ onClose, showMessage }) {
  const [schema, setSchema] = useState(null);
  const [weaponFormData, setWeaponFormData] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  const { user } = useContext(AuthContext);
  const [userParams, setUserParams] = useState({ Base: {}, Combattimento: {} });
  const [userName, setUserName] = useState(""); // Added for SpellOverlay userName prop
  const [spellSchema, setSpellSchema] = useState(null); // Added for SpellOverlay schema prop

  const [tecnicheList, setTecnicheList] = useState([]);
  const [ridTecnicheList, setRidTecnicheList] = useState([]);
  const [spellsList, setSpellsList] = useState([]); // List of existing spell names
  const [ridSpellList, setRidSpellList] = useState([]);
  const [weaponSpellsList, setWeaponSpellsList] = useState([]); // Existing spells to link

  // State for the spells being created within AddWeaponOverlay
  const [showSpellOverlay, setShowSpellOverlay] = useState(false);
  const [customSpells, setCustomSpells] = useState([]); // Array of { spellData, imageFile, videoFile }

  // handlers to add/remove tecnica reductions
  const addTecnica = () => setRidTecnicheList(prev => [...prev, { selectedTec: '', ridValue: '' }]);
  const removeTecnica = index => setRidTecnicheList(prev => prev.filter((_, i) => i !== index));
  const addSpell = () => setRidSpellList(prev => [...prev, { selectedSpell: '', ridValue: '' }]);
  const removeSpell = index => setRidSpellList(prev => prev.filter((_, i) => i !== index));
  const removeWeaponSpell = index => setWeaponSpellsList(prev => prev.filter((_, i) => i !== index));

  // Fetch weapon schema
  useEffect(() => {
    const fetchWeaponSchema = async () => {
      try {
        const schemaDocRef = doc(db, "utils", "schema_arma");
        const docSnap = await getDoc(schemaDocRef);
        if (docSnap.exists()) {
          const schemaData = docSnap.data();
          setSchema(schemaData);
          // Initialize weapon form data based on schema
          let initialData = {};
          Object.keys(schemaData).forEach(field => {
            if (["Slot", "Hands", "Tipo"].includes(field) && Array.isArray(schemaData[field])) {
              initialData[field] = schemaData[field][0] || "";
            } else if (typeof schemaData[field] === "string") {
              initialData[field] = "";
            } else if (field === "Parametri" && typeof schemaData[field] === "object") {
              initialData[field] = {};
              Object.keys(schemaData[field]).forEach(category => {
                initialData[field][category] = {};
                Object.keys(schemaData[field][category]).forEach(subField => {
                  initialData[field][category][subField] = { "1": "", "4": "", "7": "", "10": "" };
                });
              });
            } else if (
              ["Penetrazione", "Danno", "Danno Critico", "Bonus Danno Critico", "Bonus Danno", "ridCostoSpell", "ridCostoTec"].includes(field) && // Added cost reductions
              typeof schemaData[field] === "object"
            ) {
              initialData[field] = { "1": "", "4": "", "7": "", "10": "" };
            } else if (typeof schemaData[field] === "object" && !Array.isArray(schemaData[field])) {
              // Handle simple objects like ridCostoSpellSingola etc. if defined in schema, otherwise they are handled manually
              if (!["ridCostoSpellSingola", "ridCostoTecSingola", "spells"].includes(field)) {
                initialData[field] = {};
                Object.keys(schemaData[field]).forEach(subKey => {
                  initialData[field][subKey] = "";
                });
              }
            }
          });
          // Ensure nested structures exist even if not fully defined in schema yet
          initialData.Parametri = initialData.Parametri || { Base: {}, Combattimento: {} };
          initialData.spells = initialData.spells || {}; // Initialize spells map for the weapon
          setWeaponFormData(initialData);
        } else {
          console.error("Weapon schema not found at /utils/schema_arma");
        }
      } catch (error) {
        console.error("Error fetching weapon schema:", error);
      }
    };
    fetchWeaponSchema();
  }, []);

  // Fetch user data, spell schema, existing spells, and techniques
  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        // Fetch user details (params and name)
        const userDocRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          setUserParams(userData.Parametri || { Base: {}, Combattimento: {} });
          setUserName(userData.characterId || userData.email || "Unknown User"); // For SpellOverlay
        }

        // Fetch spell schema
        const spellSchemaRef = doc(db, "utils", "schema_spell");
        const spellSchemaSnap = await getDoc(spellSchemaRef);
        if (spellSchemaSnap.exists()) {
          setSpellSchema(spellSchemaSnap.data());
        } else {
          console.error("Spell schema not found at /utils/schema_spell");
        }

        // Fetch existing spell names (common + personal) for dropdowns
        const commonSpellsRef = doc(db, 'utils', 'spells_common');
        const commonSpellsSnap = await getDoc(commonSpellsRef);
        const commonSpells = commonSpellsSnap.exists() ? commonSpellsSnap.data() : {};
        const userSpells = userSnap.exists() ? userSnap.data().spells || {} : {};
        setSpellsList([...Object.keys(commonSpells), ...Object.keys(userSpells)]);

        // Fetch existing technique names (common + personal) for dropdowns
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
        setTecnicheList([...Object.keys(commonTecniche), ...Object.keys(userTecniche)]);

      } catch (error) {
        console.error('Error fetching initial data:', error);
      }
    };

    fetchData();
  }, [user]);

  // Handler for SpellOverlay close
  const handleSpellCreate = (result) => {
    if (result) {
      setCustomSpells(prev => {
        // Prevent duplicate spell names
        if (prev.some(s => s.spellData.Nome.trim() === result.spellData.Nome.trim())) return prev;
        return [...prev, result];
      });
      setSpellsList(prev => [...new Set([...prev, result.spellData.Nome.trim()])]);
      if (showMessage) showMessage(`Spell "${result.spellData.Nome.trim()}" creato localmente. Salva l'arma per caricarlo.`);
    }
    setShowSpellOverlay(false);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleSaveWeapon = async () => {
    try {
      const weaponName = weaponFormData.Nome ? weaponFormData.Nome.trim() : "";
      if (!weaponName) {
        if (showMessage) showMessage("Weapon Name is required");
        return;
      }
      const docId = weaponName.replace(/\s+/g, "_"); // Use name for ID
      const weaponDocRef = doc(db, "items", docId); // Save in 'items' collection

      // Check if weapon already exists *before* uploading anything
      const existingDocSnap = await getDoc(weaponDocRef);
      if (existingDocSnap.exists()) {
        if (showMessage) showMessage(`Weapon with name "${weaponName}" (ID: ${docId}) already exists. Please choose a different name.`);
        return;
      }

      let finalWeaponData = { ...weaponFormData };
      // Remove ownerId from upload (do not add)
      delete finalWeaponData.ownerId;

      // --- Start Uploads ---

      // 1. Upload Weapon Image (if provided)
      if (imageFile) {
        const weaponImgFileName = `weapon_${docId}_${Date.now()}_${imageFile.name}`;
        const weaponImgRef = ref(storage, 'items/' + weaponImgFileName);
        await uploadBytes(weaponImgRef, imageFile);
        finalWeaponData.image_url = await getDownloadURL(weaponImgRef);
      }

      // 2. Handle the Temporarily Created Spells (if any)
      if (customSpells.length > 0) {
        if (!finalWeaponData.spells) finalWeaponData.spells = {};
        for (const spellObj of customSpells) {
          const createdSpellData = { ...spellObj.spellData };
          const spellName = createdSpellData.Nome.trim();
          const safeBase = `spell_${docId}_${spellName.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
          if (spellObj.imageFile) {
            const spellImgRef = ref(storage, `spells/${safeBase}_image`);
            await uploadBytes(spellImgRef, spellObj.imageFile);
            createdSpellData.image_url = await getDownloadURL(spellImgRef);
          }
          if (spellObj.videoFile) {
            const spellVidRef = ref(storage, `spells/videos/${safeBase}_video`);
            await uploadBytes(spellVidRef, spellObj.videoFile);
            createdSpellData.video_url = await getDownloadURL(spellVidRef);
          }
          finalWeaponData.spells[spellName] = createdSpellData;
        }
      }

      // --- Prepare Final Data Structure ---

      // Consolidate technique cost reductions
      if (ridTecnicheList.length > 0) {
        finalWeaponData.ridCostoTecSingola = ridTecnicheList.reduce((acc, { selectedTec, ridValue }) => {
          if (selectedTec && ridValue.trim() !== '') acc[selectedTec] = Number(ridValue);
          return acc;
        }, {});
      } else {
        // Always upload as empty object if not filled
        finalWeaponData.ridCostoTecSingola = {};
      }

      // Consolidate spell cost reductions (for existing spells)
      if (ridSpellList.length > 0) {
        finalWeaponData.ridCostoSpellSingola = ridSpellList.reduce((acc, { selectedSpell, ridValue }) => {
          if (selectedSpell && ridValue.trim() !== '') acc[selectedSpell] = Number(ridValue);
          return acc;
        }, {});
      } else {
        // Always upload as empty object if not filled
        finalWeaponData.ridCostoSpellSingola = {};
      }

      // Consolidate linked *existing* spells (names only, value is just true)
      const linkedSpells = weaponSpellsList.reduce((acc, spellName) => {
        // Prevent overwriting custom spells
        if (spellName && !customSpells.some(s => s.spellData.Nome.trim() === spellName)) {
          acc[spellName] = true;
        }
        return acc;
      }, {});

      // Merge linked existing spells with the custom spells
      finalWeaponData.spells = { ...(finalWeaponData.spells || {}), ...linkedSpells };
      // Always upload as empty object if not filled
      if (!finalWeaponData.spells || Object.keys(finalWeaponData.spells).length === 0) {
        finalWeaponData.spells = {};
      }

      // prezzo: always upload as int, default 0
      let prezzoValue = 0;
      if (typeof finalWeaponData.prezzo === 'string' && finalWeaponData.prezzo.trim() !== '') {
        const parsed = parseInt(finalWeaponData.prezzo, 10);
        prezzoValue = isNaN(parsed) ? 0 : parsed;
      }
      finalWeaponData.prezzo = prezzoValue;

      // Remove temporary state holders if they exist at the top level
      delete finalWeaponData.tempSpellData;
      delete finalWeaponData.showSpellOverlay;

      // --- Save to Firestore ---
      await setDoc(weaponDocRef, finalWeaponData); // Use setDoc for creation

      if (showMessage) showMessage(`Weapon "${weaponName}" saved successfully!`);
      onClose(true); // Signal success to parent

    } catch (error) {
      console.error("Error saving weapon:", error);
      if (showMessage) showMessage(`Error saving weapon: ${error.message}`);
      onClose(false); // Signal failure
    }
  };

  // --- Rendering Functions ---

  const renderBasicFields = () => {
    if (!schema) return <div className="text-white">Loading weapon schema...</div>;
    return (
      <div>
        {/* Row 1: Name, Slot, Image Placeholder */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* Name */}
          <div className="md:col-span-1">
            {schema.Nome !== undefined && (
              <label className="block text-white mb-1">Nome <span className="text-red-500">*</span></label>
            )}
            {schema.Nome !== undefined && (
              <input
                type="text"
                value={weaponFormData.Nome || ''}
                onChange={(e) => setWeaponFormData({ ...weaponFormData, Nome: e.target.value })}
                className="w-full p-2 rounded bg-gray-700 text-white"
                placeholder="Weapon Name (Required)"
                required // HTML5 validation
              />
            )}
          </div>

          {/* Slot */}
          <div className="md:col-span-1">
            {schema.Slot !== undefined && Array.isArray(schema.Slot) && (
              <>
                <label className="block text-white mb-1">Slot</label>
                <select
                  value={weaponFormData.Slot || (schema.Slot.length > 0 ? schema.Slot[0] : '')} // Default to first option
                  onChange={(e) => setWeaponFormData({ ...weaponFormData, Slot: e.target.value })}
                  className="w-full p-2 rounded bg-gray-700 text-white"
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
            <label className="block text-white mb-1">Image</label>
            <input type="file" accept="image/*" onChange={handleImageChange} className="w-full text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
            {imagePreviewUrl && (
              <img src={imagePreviewUrl} alt="Preview" className="mt-2 w-24 h-auto rounded border border-gray-600" />
            )}
            {!imagePreviewUrl && <div className="mt-2 w-24 h-24 rounded border border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-sm">No Image</div>}
          </div>

          {/* Row 2: Tipo, Hands */}
          <div className="md:col-span-1">
            {schema.Tipo !== undefined && Array.isArray(schema.Tipo) && (
              <>
                <label className="block text-white mb-1">Tipo</label>
                <select
                  value={weaponFormData.Tipo || (schema.Tipo.length > 0 ? schema.Tipo[0] : '')}
                  onChange={(e) => setWeaponFormData({ ...weaponFormData, Tipo: e.target.value })}
                  className="w-full p-2 rounded bg-gray-700 text-white"
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
                  value={weaponFormData.Hands || (schema.Hands.length > 0 ? schema.Hands[0] : '')}
                  onChange={(e) => setWeaponFormData({ ...weaponFormData, Hands: e.target.value })}
                  className="w-full p-2 rounded bg-gray-700 text-white"
                >
                  {schema.Hands.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {/* Row 3: Effect */}
        <div className="mb-4">
          {schema.Effetto !== undefined && typeof schema.Effetto === "string" && (
            <>
              <label className="block text-white mb-1">Effetto</label>
              <textarea // Use textarea for potentially longer text
                value={weaponFormData.Effetto || ''}
                onChange={(e) => setWeaponFormData({ ...weaponFormData, Effetto: e.target.value })}
                className="w-full p-2 rounded bg-gray-700 text-white h-20" // Adjust height as needed
                placeholder="Describe the weapon's effect"
              />
            </>
          )}
        </div>

        {/* Row 4: Requirements, Price */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-white mb-1">Requisiti</label>
            <input
              type="text"
              value={weaponFormData.requisiti || ''}
              onChange={(e) => setWeaponFormData({ ...weaponFormData, requisiti: e.target.value })}
              className="w-full p-2 rounded bg-gray-700 text-white"
              placeholder="e.g., STR 10, DEX 8"
            />
          </div>
          <div>
            <label className="block text-white mb-1">Prezzo</label>
            <input
              type="text" // Keep as text to allow "N/A" or currency symbols
              value={weaponFormData.prezzo || ''}
              onChange={(e) => setWeaponFormData({ ...weaponFormData, prezzo: e.target.value })}
              className="w-full p-2 rounded bg-gray-700 text-white"
              placeholder="e.g., 100 Gold"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderTablesSection = () => {
    if (!schema || !schema.Parametri) return null; // Ensure schema and Parametri exist

    const levels = ["1", "4", "7", "10"]; // Consistent levels

    // Define which fields belong in which table
    const specialFields = ["Penetrazione", "Danno", "Bonus Danno", "Danno Critico", "Bonus Danno Critico", "ridCostoSpell", "ridCostoTec"];
    const baseParamFields = schema.Parametri.Base ? Object.keys(schema.Parametri.Base) : [];
    const combatParamFields = schema.Parametri.Combattimento ? Object.keys(schema.Parametri.Combattimento) : [];

    // Helper to render a single table
    const renderTable = (title, fields, category = null) => {
      // Check if *any* field in this table actually exists in the schema
      const schemaHasFields = fields.some(field =>
        category ? schema.Parametri?.[category]?.[field] !== undefined : schema[field] !== undefined
      );
      if (!schemaHasFields) return null; // Don't render table if no relevant fields exist in schema

      return (
        <div className="w-full bg-gray-800/70 p-4 rounded-xl shadow-lg backdrop-blur-sm">
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
                  // Check if this specific field exists in the schema before rendering row
                  const fieldExistsInSchema = category
                    ? schema.Parametri?.[category]?.[field] !== undefined
                    : schema[field] !== undefined;

                  if (!fieldExistsInSchema) return null; // Skip row if field not in schema

                  const isLastRow = i === fields.filter(f => category ? schema.Parametri?.[category]?.[f] !== undefined : schema[f] !== undefined).length - 1;
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
                        const computed = category && value ? computeValue(value, userParams) : null;

                        return (
                          <td key={lvl} className={`bg-gray-700/30 px-1 py-1 ${isLastRow && j === levels.length - 1 ? 'rounded-br-lg' : ''}`}>
                            <div className="flex items-center justify-center">
                              <input
                                type="text" // Use text to allow formulas like "FOR/2"
                                value={value}
                                onChange={(e) => {
                                  const newValue = e.target.value;
                                  setWeaponFormData(prev => {
                                    const newData = { ...prev };
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
                                className="w-16 p-1 rounded-md bg-gray-600/70 text-white text-center focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                placeholder="-"
                              />
                              {/* Show computed value only for Base/Combat params */}
                              {computed !== null && (
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6"> {/* Responsive grid for tables */}
        {renderTable("Parametri Speciali", specialFields)}
        {renderTable("Parametri Base", baseParamFields, "Base")}
        {renderTable("Parametri Combattimento", combatParamFields, "Combattimento")}
      </div>
    );
  };

  const renderReductionsAndSpells = () => {
    return (
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Column 1: Reductions */}
        <div className="space-y-4">
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
                  className="flex-grow p-2 rounded bg-gray-600 text-white text-sm"
                >
                  <option value="" disabled>Seleziona tecnica...</option>
                  {tecnicheList.sort().map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <input
                  type="number"
                  value={item.ridValue}
                  onChange={e => {
                    const newList = [...ridTecnicheList];
                    newList[idx].ridValue = e.target.value;
                    setRidTecnicheList(newList);
                  }}
                  placeholder="Valore Rid."
                  className="w-24 p-2 rounded bg-gray-600 text-white text-sm"
                />
                <button type="button" onClick={() => removeTecnica(idx)} className="text-red-500 hover:text-red-400 p-1">✕</button>
              </div>
            ))}
            <button
              type="button"
              onClick={addTecnica}
              className="mt-1 text-sm text-blue-400 hover:text-blue-300"
              disabled={tecnicheList.length === 0}
            >
              + Aggiungi Riduzione Tecnica
            </button>
            {tecnicheList.length === 0 && <p className="text-xs text-gray-400 mt-1">Caricamento tecniche...</p>}
          </div>

          {/* --- Single Spell Reductions --- */}
          <div>
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
                  className="flex-grow p-2 rounded bg-gray-600 text-white text-sm"
                >
                  <option value="" disabled>Seleziona spell...</option>
                  {spellsList.sort().map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <input
                  type="number"
                  value={item.ridValue}
                  onChange={e => {
                    const newList = [...ridSpellList];
                    newList[idx].ridValue = e.target.value;
                    setRidSpellList(newList);
                  }}
                  placeholder="Valore Rid."
                  className="w-24 p-2 rounded bg-gray-600 text-white text-sm"
                />
                <button type="button" onClick={() => removeSpell(idx)} className="text-red-500 hover:text-red-400 p-1">✕</button>
              </div>
            ))}
            <button
              type="button"
              onClick={addSpell}
              className="mt-1 text-sm text-blue-400 hover:text-blue-300"
              disabled={spellsList.length === 0}
            >
              + Aggiungi Riduzione Spell
            </button>
            {spellsList.length === 0 && <p className="text-xs text-gray-400 mt-1">Caricamento spells...</p>}
          </div>
        </div>

        {/* Column 2: Weapon Spells */}
        <div>
          <label className="block text-white mb-2 font-medium">Spells Conferiti dall'Arma</label>
          <p className="text-xs text-gray-400 mb-2">Aggiungi spells esistenti o creane uno nuovo specifico per quest'arma.</p>

          {/* Button to open Spell Creation Overlay */}
          <div className="mb-3">
            <AddSpellButton onClick={() => setShowSpellOverlay(true)} />
            {customSpells.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-green-400 italic mb-1">Spells creati localmente:</p>
                <ul className="text-xs text-white list-disc ml-4">
                  {customSpells.map((s, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-red-400 hover:text-red-600 flex items-center justify-center"
                        onClick={() => setCustomSpells(prev => prev.filter((_, i) => i !== idx))}
                        aria-label="Remove spell"
                        style={{ padding: 0, background: 'none', border: 'none' }}
                      >
                        <FaTrash />
                      </button>
                      <span>{s.spellData.Nome}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* List to select *EXISTING* spells to link */}
          <label className="block text-white text-sm mb-1">Collega Spells Esistenti:</label>
          {weaponSpellsList.map((spellName, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-2 p-2 bg-gray-700/50 rounded">
              <select
                value={spellName}
                onChange={e => {
                  const newList = [...weaponSpellsList];
                  newList[idx] = e.target.value;
                  setWeaponSpellsList(newList);
                }}
                className="flex-grow p-2 rounded bg-gray-600 text-white text-sm"
              >
                <option value="" disabled>Seleziona spell esistente...</option>
                {/* Filter out the temp spell name if it exists */}
                {spellsList
                  .filter(name => !customSpells.some(s => s.spellData.Nome.trim() === name))
                  .sort()
                  .map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
              </select>
              <button type="button" onClick={() => removeWeaponSpell(idx)} className="text-red-500 hover:text-red-400 p-1">✕</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setWeaponSpellsList(prev => [...prev, ''])} // Add an empty entry to show a new dropdown
            className="mt-1 text-sm text-blue-400 hover:text-blue-300"
            disabled={spellsList.length === 0}
          >
            + Collega Spell Esistente
          </button>
          {spellsList.length === 0 && <p className="text-xs text-gray-400 mt-1">Caricamento spells...</p>}
        </div>
      </div>
    );
  };

  // --- Main Overlay JSX ---
  const overlayContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-70 z-[9990] p-4"> {/* Use slightly lower z-index than spell overlay */}
      <div className="bg-gray-800 p-5 rounded-lg shadow-xl w-[80vw] h-[80vh] max-w-none max-h-none overflow-y-auto border border-gray-700">
        <h2 className="text-2xl text-white mb-4 font-semibold border-b border-gray-700 pb-2">Add New Weapon</h2>

        {/* Prevent form submission via Enter key press */}
        <form onSubmit={(e) => { e.preventDefault(); handleSaveWeapon(); }} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
          {renderBasicFields()}
          {renderTablesSection()}
          {renderReductionsAndSpells()}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={() => onClose(false)} // Use the original onClose for canceling the weapon creation
              className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md shadow-md transition-colors duration-150"
            >
              Cancel
            </button>
            <button
              type="submit" // This button triggers the handleSaveWeapon
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-md transition-colors duration-150"
            >
              Save Weapon
            </button>
          </div>
        </form>
      </div>

      {/* Spell Creation Overlay - Rendered conditionally on top */}
      {showSpellOverlay && spellSchema && userName && (
        <SpellOverlay
          mode="add"
          schema={spellSchema}
          userName={userName}
          onClose={handleSpellCreate}
          saveButtonText="Create Spell"
        />
      )}
      {showSpellOverlay && (!spellSchema || !userName) && (
        // Show loading/error state if spell overlay is toggled but dependencies aren't ready
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg text-white">Loading spell creation dependencies...</div>
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(overlayContent, document.body);
}