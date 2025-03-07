// file: ./frontend/src/components/dmElements/delTecnicaPersonale.js
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { db, storage } from '../firebaseConfig';
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";

export function DelTecnicaPersonale({ userId, tecnicaName, tecnicaData, onClose }) {
  const [userName, setUserName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  React.useEffect(() => {
    // Fetch user data to display the name
    const fetchUserName = async () => {
      try {
        const userDocRef = doc(db, "users", userId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          setUserName(userData.characterId || userData.email || "Unknown User");
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      }
    };

    fetchUserName();
  }, [userId]);

  const handleDeleteTecnica = async () => {
    try {
      setIsDeleting(true);

      // Delete the image from storage if it exists
      if (tecnicaData.image_url) {
        try {
          // Extract the file path from the URL
          const urlPath = decodeURIComponent(tecnicaData.image_url.split('/o/')[1].split('?')[0]);
          const imageRef = ref(storage, urlPath);
          await deleteObject(imageRef);
          console.log("Image deleted successfully from storage");
        } catch (imageError) {
          console.error("Error deleting image from storage:", imageError);
        }
      }

      // Remove the tecnica from the user's profile
      const userRef = doc(db, "users", userId);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const userData = userDoc.data();
        const updatedTecniche = { ...(userData.tecniche || {}) };

        // Delete the tecnica from the object
        delete updatedTecniche[tecnicaName];

        // Update the document
        await updateDoc(userRef, { tecniche: updatedTecniche });
        console.log(`Tecnica "${tecnicaName}" deleted successfully`);

        // Close the dialog and notify parent component
        onClose(true);
      } else {
        alert("User not found");
      }
    } catch (error) {
      console.error("Error deleting tecnica:", error);
      alert("Error deleting tecnica");
    } finally {
      setIsDeleting(false);
    }
  };

  const overlayContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-4/5 max-w-md">
        <h2 className="text-xl text-white mb-2">Elimina Tecnica Personale</h2>
        <p className="text-gray-300 mb-2">Giocatore: {userName}</p>

        <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4">
          <p className="text-white mb-2">
            Stai per eliminare la tecnica <span className="font-semibold">{tecnicaName}</span>.
          </p>
          <p className="text-red-300">
            Questa azione è permanente e non può essere annullata.
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={() => onClose(false)}
            disabled={isDeleting}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleDeleteTecnica}
            disabled={isDeleting}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center"
          >
            {isDeleting ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Eliminazione...
              </>
            ) : "Elimina"}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlayContent, document.body);
}