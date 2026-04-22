// file: ./frontend/src/components/dmDashboard/elements/buttons/addTecnicaPersonale.js
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { db } from '../../../firebaseConfig';
import { doc, getDoc } from "firebase/firestore";
import { saveTecnicaForUser } from '../../../common/userOwnedMedia';

// --- Style definition moved here ---
const sleekButtonStyle = "w-36 px-2 py-1 bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-700 hover:to-indigo-800 text-white text-xs font-medium rounded-md transition-all duration-150 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 shadow-sm";

// --- New Exported Button Component ---
export function AddTecnicaButton({ onClick }) {
  return (
    <button
      className={sleekButtonStyle}
      onClick={onClick}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
      </svg>
      <span>Add Tecnica</span>
    </button>
  );
}
// --- End New Button Component ---


// --- Existing Overlay Component (unchanged logic) ---
export function AddTecnicaPersonaleOverlay({ userId, onClose }) {
  const [schema, setSchema] = useState(null);
  const [tecnicaFormData, setTecnicaFormData] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [userName, setUserName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch schema
        const schemaDocRef = doc(db, "utils", "schema_tecnica");
        const schemaDocSnap = await getDoc(schemaDocRef);

        if (schemaDocSnap.exists()) {
          const schemaData = schemaDocSnap.data();
          setSchema(schemaData);

          // Initialize form with empty values
          let initialData = {
            Nome: "",
            Costo: 0,
            Azione: schemaData.Azione && Array.isArray(schemaData.Azione) ? schemaData.Azione[0] : "",
            Effetto: ""
          };

          setTecnicaFormData(initialData);
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
  }, [userId]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
      if (videoPreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [imagePreviewUrl, videoPreviewUrl]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (imagePreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
      setImageFile(file);
      setImagePreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleVideoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (videoPreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
      setVideoFile(file);
      setVideoPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleSaveTecnica = async () => {
    try {
      setIsSaving(true);
      const tecnicaName = tecnicaFormData.Nome ? tecnicaFormData.Nome.trim() : "";
      if (!tecnicaName) {
        alert("Nome is required");
        return;
      }

      // Create a clean object with only the needed fields
      let tecnicaData = {
        Nome: tecnicaFormData.Nome || "",
        Costo: parseInt(tecnicaFormData.Costo) || 0,
        Azione: tecnicaFormData.Azione || "",
        Effetto: tecnicaFormData.Effetto || ""
      };

      await saveTecnicaForUser({
        userId,
        originalName: tecnicaName,
        entryData: tecnicaData,
        imageFile,
        videoFile,
      });

      onClose(true);
    } catch (error) {
      console.error("Error saving tecnica:", error);
      if (error.code) {
        console.error("Firebase error code:", error.code);
      }
      alert(error.message || "Error saving tecnica. Check console for details.");
    } finally {
      setIsSaving(false);
    }
  };

  const overlayContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-4/5 max-w-2xl">
        <h2 className="text-xl text-white mb-1">Add Tecnica Personale</h2>
        <p className="text-gray-300 mb-4">Per il giocatore: {userName}</p>
        <form onSubmit={(e) => { e.preventDefault(); handleSaveTecnica(); }}>
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
              disabled={isSaving}
              className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-md shadow-md transition-all duration-200"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlayContent, document.body);
}
// --- End Existing Overlay Component ---
