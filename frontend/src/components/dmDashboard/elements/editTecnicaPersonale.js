// file: frontend/src/components/dmDashboard/elements/addTecnicaPersonaleOverlay.js
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { db, storage } from '../../firebaseConfig';
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export function EditTecnicaPersonale({ userId, tecnicaName, tecnicaData, onClose }) {
  const [schema, setSchema] = useState(null);
  const [tecnicaFormData, setTecnicaFormData] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [userName, setUserName] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch schema
        const schemaDocRef = doc(db, "utils", "schema_tecnica");
        const schemaDocSnap = await getDoc(schemaDocRef);

        if (schemaDocSnap.exists()) {
          const schemaData = schemaDocSnap.data();
          setSchema(schemaData);

          // Initialize form with existing tecnica data with updated parsing for Costo
          setTecnicaFormData({
            Nome: tecnicaName,
            Costo: parseInt(tecnicaData.Costo) || 0,  // Parse as integer
            Azione: tecnicaData.Azione || (schemaData.Azione && Array.isArray(schemaData.Azione) ? schemaData.Azione[0] : ""),
            Effetto: tecnicaData.Effetto || ""
          });

          // Set image preview if it exists
          if (tecnicaData.image_url) {
            setImagePreviewUrl(tecnicaData.image_url);
          }
        } else {
          console.error("Schema not found at /utils/schema_tecnica");
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
  }, [userId, tecnicaName, tecnicaData]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleUpdateTecnica = async () => {
    try {
      const newTecnicaName = tecnicaFormData.Nome ? tecnicaFormData.Nome.trim() : "";
      if (!newTecnicaName) {
        alert("Nome is required");
        return;
      }

      // Convert Costo to an integer before saving
      let updatedTecnicaData = {
        ...tecnicaFormData,
        Costo: parseInt(tecnicaFormData.Costo) || 0  // Convert to integer
      };

      // Upload image if present
      if (imageFile) {
        const safeFileName = `tecnica_${userId}_${newTecnicaName.replace(/\s+/g, "_")}_${Date.now()}`;
        const imageRef = ref(storage, 'tecnicas/' + safeFileName);
        await uploadBytes(imageRef, imageFile);
        const downloadURL = await getDownloadURL(imageRef);
        updatedTecnicaData.image_url = downloadURL;
      } else if (tecnicaData.image_url) {
        // Keep the existing image URL if no new image selected
        updatedTecnicaData.image_url = tecnicaData.image_url;
      }

      // Update the user's tecniche field
      const userRef = doc(db, "users", userId);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const userData = userDoc.data();
        const updatedTecniche = { ...(userData.tecniche || {}) };

        // Remove old tecnica if name changed
        if (newTecnicaName !== tecnicaName) {
          delete updatedTecniche[tecnicaName];
        }

        // Add or replace the tecnica
        updatedTecniche[newTecnicaName] = updatedTecnicaData;

        await updateDoc(userRef, { tecniche: updatedTecniche });
        onClose(true);
      } else {
        alert("User not found");
      }
    } catch (error) {
      console.error("Error updating tecnica:", error);
      alert("Error updating tecnica");
    }
  };

  const overlayContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-4/5 max-w-2xl">
        <h2 className="text-xl text-white mb-1">Modifica Tecnica Personale</h2>
        <p className="text-gray-300 mb-4">Per il giocatore: {userName}</p>

        {showConfirmation ? (
          <div className="text-white">
            <p className="mb-4">Sei sicuro di voler sovrascrivere questa tecnica?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirmation(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={handleUpdateTecnica}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
              >
                Conferma
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setShowConfirmation(true); }}>
            {schema ? (
              <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-white mb-1">Nome</label>
                    <input
                      type="text"
                      value={tecnicaFormData.Nome || ''}
                      onChange={(e) => setTecnicaFormData({ ...tecnicaFormData, Nome: e.target.value })}
                      className="w-full p-2 rounded bg-gray-700 text-white"
                      placeholder="Inserisci nome tecnica"
                    />
                  </div>

                  <div>
                    <label className="block text-white mb-1">Costo</label>
                    <input
                      type="number"
                      value={tecnicaFormData.Costo || ''}
                      onChange={(e) => setTecnicaFormData({ ...tecnicaFormData, Costo: e.target.value })}
                      className="w-full p-2 rounded bg-gray-700 text-white"
                      placeholder="Inserisci costo"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  {schema.Azione !== undefined && Array.isArray(schema.Azione) && (
                    <div>
                      <label className="block text-white mb-1">Azione</label>
                      <select
                        value={tecnicaFormData.Azione || ''}
                        onChange={(e) => setTecnicaFormData({ ...tecnicaFormData, Azione: e.target.value })}
                        className="w-full p-2 rounded bg-gray-700 text-white"
                      >
                        {schema.Azione.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <label className="block text-white mb-1">Effetto</label>
                  <textarea
                    value={tecnicaFormData.Effetto || ''}
                    onChange={(e) => setTecnicaFormData({ ...tecnicaFormData, Effetto: e.target.value })}
                    className="w-full p-2 rounded bg-gray-700 text-white h-24"
                    placeholder="Descrivi l'effetto della tecnica"
                  />
                </div>

                <div className="mb-4">
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
              </div>
            ) : (
              <div className="text-white">Loading schema...</div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => onClose(false)}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              >
                Save
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlayContent, document.body);
}
