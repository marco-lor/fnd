import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { db, storage } from '../../firebaseConfig';
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export function AddSpellOverlay({ userId, onClose }) {
  const [schema, setSchema] = useState(null);
  const [spellFormData, setSpellFormData] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch schema
        const schemaDocRef = doc(db, "utils", "schema_spell");
        const schemaDocSnap = await getDoc(schemaDocRef);

        if (schemaDocSnap.exists()) {
          const schemaData = schemaDocSnap.data();
          setSchema(schemaData);

          // Initialize form with empty values
          let initialData = {
            Nome: "",
            Costo: 0,
            "Effetti Positivi": "",
            "Effetti Negativi": "",
            Esperienza: schemaData.Esperienza && Array.isArray(schemaData.Esperienza) ? schemaData.Esperienza[0] : "",
            "Mod Params": {
              Base: {
                Costituzione: 0,
                Destrezza: 0,
                Fortuna: 0,
                Forza: 0,
                Intelligenza: 0,
                Saggezza: 0
              },
              Combattimento: {
                Attacco: 0,
                Critico: 0,
                Difesa: 0,
                Disciplina: 0,
                RiduzioneDanni: 0,
                Salute: 0
              }
            },
            TPC: {
              Param1: schemaData.TPC?.Param1 && Array.isArray(schemaData.TPC.Param1) ? schemaData.TPC.Param1[0] : "",
              Param2: schemaData.TPC?.Param2 && Array.isArray(schemaData.TPC.Param2) ? schemaData.TPC.Param2[0] : "",
              ParamTarget: schemaData.TPC?.ParamTarget && Array.isArray(schemaData.TPC.ParamTarget) ? schemaData.TPC.ParamTarget[0] : ""
            },
            "TPC Fisico": {
              Param1: schemaData["TPC Fisico"]?.Param1 && Array.isArray(schemaData["TPC Fisico"].Param1) ? schemaData["TPC Fisico"].Param1[0] : "",
              Param2: schemaData["TPC Fisico"]?.Param2 && Array.isArray(schemaData["TPC Fisico"].Param2) ? schemaData["TPC Fisico"].Param2[0] : "",
              ParamTarget: schemaData["TPC Fisico"]?.ParamTarget && Array.isArray(schemaData["TPC Fisico"].ParamTarget) ? schemaData["TPC Fisico"].ParamTarget[0] : ""
            },
            "TPC Mentale": {
              Param1: schemaData["TPC Mentale"]?.Param1 && Array.isArray(schemaData["TPC Mentale"].Param1) ? schemaData["TPC Mentale"].Param1[0] : "",
              Param2: schemaData["TPC Mentale"]?.Param2 && Array.isArray(schemaData["TPC Mentale"].Param2) ? schemaData["TPC Mentale"].Param2[0] : "",
              ParamTarget: schemaData["TPC Mentale"]?.ParamTarget && Array.isArray(schemaData["TPC Mentale"].ParamTarget) ? schemaData["TPC Mentale"].ParamTarget[0] : ""
            },
            "Tipo Base": schemaData["Tipo Base"] && Array.isArray(schemaData["Tipo Base"]) ? schemaData["Tipo Base"][0] : ""
          };

          setSpellFormData(initialData);
        } else {
          console.error("Schema not found at /utils/schema_spell");
        }

        // Fetch user data to display the name
        const userDocRef = doc(db, "users", userId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          setUserName(userData.characterId || userData.email || "Unknown User");
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }, [userId]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleVideoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoFile(file);
      setVideoPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleNestedChange = (category, subcategory, field, value) => {
    setSpellFormData(prevData => {
      const newData = { ...prevData };
      if (!newData[category]) newData[category] = {};
      if (!newData[category][subcategory]) newData[category][subcategory] = {};
      newData[category][subcategory][field] = value;
      return newData;
    });
  };

  const handleSaveSpell = async () => {
    try {
      const spellName = spellFormData.Nome ? spellFormData.Nome.trim() : "";
      if (!spellName) {
        alert("Nome is required");
        return;
      }

      // Create a clean spell data object
      let spellData = {
        Nome: spellFormData.Nome || "",
        Costo: parseInt(spellFormData.Costo) || 0,
        "Effetti Positivi": spellFormData["Effetti Positivi"] || "",
        "Effetti Negativi": spellFormData["Effetti Negativi"] || "",
        Esperienza: spellFormData.Esperienza || "",
        "Mod Params": spellFormData["Mod Params"] || {
          Base: {
            Costituzione: parseInt(spellFormData["Mod Params"]?.Base?.Costituzione) || 0,
            Destrezza: parseInt(spellFormData["Mod Params"]?.Base?.Destrezza) || 0,
            Fortuna: parseInt(spellFormData["Mod Params"]?.Base?.Fortuna) || 0,
            Forza: parseInt(spellFormData["Mod Params"]?.Base?.Forza) || 0,
            Intelligenza: parseInt(spellFormData["Mod Params"]?.Base?.Intelligenza) || 0,
            Saggezza: parseInt(spellFormData["Mod Params"]?.Base?.Saggezza) || 0
          },
          Combattimento: {
            Attacco: parseInt(spellFormData["Mod Params"]?.Combattimento?.Attacco) || 0,
            Critico: parseInt(spellFormData["Mod Params"]?.Combattimento?.Critico) || 0,
            Difesa: parseInt(spellFormData["Mod Params"]?.Combattimento?.Difesa) || 0,
            Disciplina: parseInt(spellFormData["Mod Params"]?.Combattimento?.Disciplina) || 0,
            RiduzioneDanni: parseInt(spellFormData["Mod Params"]?.Combattimento?.RiduzioneDanni) || 0,
            Salute: parseInt(spellFormData["Mod Params"]?.Combattimento?.Salute) || 0
          }
        },
        TPC: spellFormData.TPC || {
          Param1: spellFormData.TPC?.Param1 || "",
          Param2: spellFormData.TPC?.Param2 || "",
          ParamTarget: spellFormData.TPC?.ParamTarget || ""
        },
        "TPC Fisico": spellFormData["TPC Fisico"] || {
          Param1: spellFormData["TPC Fisico"]?.Param1 || "",
          Param2: spellFormData["TPC Fisico"]?.Param2 || "",
          ParamTarget: spellFormData["TPC Fisico"]?.ParamTarget || ""
        },
        "TPC Mentale": spellFormData["TPC Mentale"] || {
          Param1: spellFormData["TPC Mentale"]?.Param1 || "",
          Param2: spellFormData["TPC Mentale"]?.Param2 || "",
          ParamTarget: spellFormData["TPC Mentale"]?.ParamTarget || ""
        },
        "Tipo Base": spellFormData["Tipo Base"] || ""
      };

      // Upload media if present
      const safeFileName = `spell_${userId}_${spellName.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;

      if (imageFile) {
        try {
          const imageRef = ref(storage, 'spells/' + safeFileName + '_image');
          await uploadBytes(imageRef, imageFile);
          const downloadURL = await getDownloadURL(imageRef);
          spellData.image_url = downloadURL;
        } catch (imageError) {
          console.error("Error uploading image:", imageError);
        }
      }

      if (videoFile) {
        try {
          const videoRef = ref(storage, 'spells/videos/' + safeFileName + '_video');
          await uploadBytes(videoRef, videoFile);
          const downloadURL = await getDownloadURL(videoRef);
          spellData.video_url = downloadURL;
        } catch (videoError) {
          console.error("Error uploading video:", videoError);
        }
      }

      // Update the user's spells field
      const userRef = doc(db, "users", userId);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const userData = userDoc.data();
        const updatedSpells = { ...(userData.spells || {}) };

        // Add or replace the spell
        updatedSpells[spellName] = spellData;

        // Check document size (Firestore limit is 1MB)
        if (JSON.stringify(updatedSpells).length > 900000) {
          alert("Data too large. Try using a smaller image or video.");
          return;
        }

        await updateDoc(userRef, { spells: updatedSpells });
        onClose(true);
      } else {
        alert("User not found");
      }
    } catch (error) {
      console.error("Error saving spell:", error);
      if (error.code) {
        console.error("Firebase error code:", error.code);
      }
      alert("Error saving spell. Check console for details.");
    }
  };

  const renderDropdown = (options, value, onChange) => {
    if (!Array.isArray(options) || options.length === 0) return <input type="text" value={value || ''} onChange={onChange} className="w-full p-2 rounded bg-gray-700 text-white" />;
    
    return (
      <select value={value || ''} onChange={onChange} className="w-full p-2 rounded bg-gray-700 text-white">
        {options.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  };

  const overlayContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-4/5 max-w-3xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl text-white mb-1">Aggiungi Spell</h2>
        <p className="text-gray-300 mb-4">Per il giocatore: {userName}</p>
        <form onSubmit={(e) => { e.preventDefault(); handleSaveSpell(); }}>
          {schema ? (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-white mb-1">Nome</label>
                  <input
                    type="text"
                    value={spellFormData.Nome || ''}
                    onChange={(e) => setSpellFormData({ ...spellFormData, Nome: e.target.value })}
                    className="w-full p-2 rounded bg-gray-700 text-white"
                    placeholder="Inserisci nome dello spell"
                  />
                </div>

                <div>
                  <label className="block text-white mb-1">Costo</label>
                  <input
                    type="number"
                    value={spellFormData.Costo || ''}
                    onChange={(e) => setSpellFormData({ ...spellFormData, Costo: e.target.value })}
                    className="w-full p-2 rounded bg-gray-700 text-white"
                    placeholder="Inserisci costo"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-white mb-1">Effetti Positivi</label>
                <textarea
                  value={spellFormData["Effetti Positivi"] || ''}
                  onChange={(e) => setSpellFormData({ ...spellFormData, "Effetti Positivi": e.target.value })}
                  className="w-full p-2 rounded bg-gray-700 text-white h-20"
                  placeholder="Descrivi gli effetti positivi dello spell"
                />
              </div>

              <div className="mb-4">
                <label className="block text-white mb-1">Effetti Negativi</label>
                <textarea
                  value={spellFormData["Effetti Negativi"] || ''}
                  onChange={(e) => setSpellFormData({ ...spellFormData, "Effetti Negativi": e.target.value })}
                  className="w-full p-2 rounded bg-gray-700 text-white h-20"
                  placeholder="Descrivi gli effetti negativi dello spell"
                />
              </div>

              <div className="mb-4">
                <label className="block text-white mb-1">Esperienza</label>
                {renderDropdown(
                  schema.Esperienza,
                  spellFormData.Esperienza,
                  (e) => setSpellFormData({ ...spellFormData, Esperienza: e.target.value })
                )}
              </div>

              <div className="mb-4">
                <label className="block text-white mb-1">Tipo Base</label>
                {renderDropdown(
                  schema["Tipo Base"],
                  spellFormData["Tipo Base"],
                  (e) => setSpellFormData({ ...spellFormData, "Tipo Base": e.target.value })
                )}
              </div>

              <div className="mb-4">
                <h3 className="text-white text-lg mb-2">Mod Params</h3>
                
                <div className="bg-gray-700 p-3 rounded mb-3">
                  <h4 className="text-white font-medium mb-2">Base</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {["Costituzione", "Destrezza", "Fortuna", "Forza", "Intelligenza", "Saggezza"].map(param => (
                      <div key={param}>
                        <label className="block text-white text-sm mb-1">{param}</label>
                        <input
                          type="number"
                          value={spellFormData["Mod Params"]?.Base?.[param] || 0}
                          onChange={(e) => handleNestedChange("Mod Params", "Base", param, parseInt(e.target.value) || 0)}
                          className="w-full p-2 rounded bg-gray-600 text-white"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="bg-gray-700 p-3 rounded">
                  <h4 className="text-white font-medium mb-2">Combattimento</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {["Attacco", "Critico", "Difesa", "Disciplina", "RiduzioneDanni", "Salute"].map(param => (
                      <div key={param}>
                        <label className="block text-white text-sm mb-1">{param}</label>
                        <input
                          type="number"
                          value={spellFormData["Mod Params"]?.Combattimento?.[param] || 0}
                          onChange={(e) => handleNestedChange("Mod Params", "Combattimento", param, parseInt(e.target.value) || 0)}
                          className="w-full p-2 rounded bg-gray-600 text-white"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {["TPC", "TPC Fisico", "TPC Mentale"].map(tpcType => (
                <div key={tpcType} className="mb-4">
                  <h3 className="text-white text-lg mb-2">{tpcType}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {["Param1", "Param2", "ParamTarget"].map(param => (
                      <div key={`${tpcType}-${param}`}>
                        <label className="block text-white text-sm mb-1">{param}</label>
                        {renderDropdown(
                          schema[tpcType]?.[param],
                          spellFormData[tpcType]?.[param],
                          (e) => {
                            setSpellFormData(prev => {
                              const updated = { ...prev };
                              if (!updated[tpcType]) updated[tpcType] = {};
                              updated[tpcType][param] = e.target.value;
                              return updated;
                            });
                          }
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="mb-4">
                <div>
                  <label className="block text-white mb-1">Immagine</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="w-full text-white"
                  />
                  {imagePreviewUrl && (
                    <img src={imagePreviewUrl} alt="Preview" className="mt-2 w-24 h-auto rounded" />
                  )}
                </div>

                <div className="mt-4">
                  <label className="block text-white mb-1">Video</label>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleVideoChange}
                    className="w-full text-white"
                  />
                  {videoPreviewUrl && (
                    <video
                      src={videoPreviewUrl}
                      controls
                      className="mt-2 w-full max-h-48 rounded"
                    />
                  )}
                  <p className="text-gray-400 text-sm mt-1">
                    Consigliato: video breve (max 30s) di dimensioni ridotte
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-white">Loading schema...</div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={() => onClose(false)}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md shadow-md transition-all duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-md shadow-md transition-all duration-200"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlayContent, document.body);
}
