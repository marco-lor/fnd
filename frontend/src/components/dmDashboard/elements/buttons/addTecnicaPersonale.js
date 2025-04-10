// file: ./frontend/src/components/dmDashboard/elements/addTecnicaPersonale.js
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { db, storage } from '../../../firebaseConfig';
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export function AddTecnicaPersonaleOverlay({ userId, onClose }) {
  const [schema, setSchema] = useState(null);
  const [tecnicaFormData, setTecnicaFormData] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [userName, setUserName] = useState("");

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

  const handleSaveTecnica = async () => {
    try {
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

      // Upload media if present
      const safeFileName = `tecnica_${userId}_${tecnicaName.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;

      if (imageFile) {
        try {
          const imageRef = ref(storage, 'tecnicas/' + safeFileName + '_image');
          await uploadBytes(imageRef, imageFile);
          const downloadURL = await getDownloadURL(imageRef);
          tecnicaData.image_url = downloadURL;
        } catch (imageError) {
          console.error("Error uploading image:", imageError);
        }
      }

      if (videoFile) {
        try {
          const videoRef = ref(storage, 'tecnicas/videos/' + safeFileName + '_video');
          await uploadBytes(videoRef, videoFile);
          const downloadURL = await getDownloadURL(videoRef);
          tecnicaData.video_url = downloadURL;
        } catch (videoError) {
          console.error("Error uploading video:", videoError);
        }
      }

      // Update the user's tecniche field
      const userRef = doc(db, "users", userId);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const userData = userDoc.data();
        const updatedTecniche = { ...(userData.tecniche || {}) };

        // Add or replace the tecnica
        updatedTecniche[tecnicaName] = tecnicaData;

        // Check document size (Firestore limit is 1MB)
        if (JSON.stringify(updatedTecniche).length > 900000) {
          alert("Data too large. Try using a smaller image or video.");
          return;
        }

        await updateDoc(userRef, { tecniche: updatedTecniche });
        onClose(true);
      } else {
        alert("User not found");
      }
    } catch (error) {
      console.error("Error saving tecnica:", error);
      if (error.code) {
        console.error("Firebase error code:", error.code);
      }
      alert("Error saving tecnica. Check console for details.");
    }
  };

  const overlayContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-4/5 max-w-2xl">
        <h2 className="text-xl text-white mb-1">Aggiungi Tecnica Personale</h2>
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
              className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-md shadow-md transition-all duration-200"
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
