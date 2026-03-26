// file: frontend/src/components/dmDashboard/elements/editTecnicaPersonale.js
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { db } from '../../../firebaseConfig';
import { doc, getDoc } from "firebase/firestore";
import { saveTecnicaForUser } from '../../../common/userOwnedMedia';

export function EditTecnicaPersonale({ userId, tecnicaName, tecnicaData, onClose }) {
  const [schema, setSchema] = useState(null);
  const [tecnicaFormData, setTecnicaFormData] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [videoRemoved, setVideoRemoved] = useState(false);
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
          // Set video preview if it exists
          if (tecnicaData.video_url) {
            setVideoPreviewUrl(tecnicaData.video_url);
          }
          setImageRemoved(false);
          setVideoRemoved(false);
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
      setImageRemoved(false);
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
      setVideoRemoved(false);
    }
  };

  const clearImage = () => {
    if (imagePreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(null);
    setImagePreviewUrl(null);
    setImageRemoved(true);
  };

  const clearVideo = () => {
    if (videoPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setVideoRemoved(true);
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
        Nome: newTecnicaName,
        Costo: parseInt(tecnicaFormData.Costo) || 0
      };

      await saveTecnicaForUser({
        userId,
        originalName: tecnicaName,
        entryData: updatedTecnicaData,
        imageFile,
        videoFile,
        removeImage: imageRemoved,
        removeVideo: videoRemoved,
      });

      onClose(true);
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
                  <div>
                    <label className="block text-white mb-1">Immagine</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="w-full text-white"
                    />
                    {imagePreviewUrl && (
                      <div className="mt-2 relative w-24 h-24">
                        <img src={imagePreviewUrl} alt="Preview" className="w-full h-full object-cover rounded" />
                        <button
                          type="button"
                          onClick={clearImage}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                        >
                          &times;
                        </button>
                      </div>
                    )}
                    {!imagePreviewUrl && (
                      <div className="mt-2 w-24 h-24 rounded border border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-xs">
                        No Image
                      </div>
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
                      <div className="mt-2 relative">
                        <video
                          src={videoPreviewUrl}
                          controls
                          className="w-full max-h-48 rounded"
                        />
                        <button
                          type="button"
                          onClick={clearVideo}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                        >
                          &times;
                        </button>
                      </div>
                    )}
                    {!videoPreviewUrl && (
                      <div className="mt-2 h-24 rounded border border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-xs">
                        No Video
                      </div>
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
