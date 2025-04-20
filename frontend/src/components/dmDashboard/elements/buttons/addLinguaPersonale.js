// ./buttons/addLinguaPersonale.js
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { db } from '../../../firebaseConfig';
import { doc, getDoc, updateDoc } from "firebase/firestore";

// --- Style definition ---
const sleekButtonStyle = "w-36 px-2 py-1 bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-700 hover:to-indigo-800 text-white text-xs font-medium rounded-md transition-all duration-150 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 shadow-sm";

// --- Button Component ---
const AddLinguaPersonale = ({ onClick }) => {
  return (
    <button
      className={sleekButtonStyle}
      onClick={onClick}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
      </svg>
      <span>Add Lingua</span>
    </button>
  );
};

// --- New Overlay Component ---
export function AddLinguaPersonaleOverlay({ userId, onClose }) {
  const [codexLingue, setCodexLingue] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedLingua, setSelectedLingua] = useState(null);
  const [userName, setUserName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch codex data (lingue)
        const codexRef = doc(db, "utils", "codex");
        const codexSnap = await getDoc(codexRef);

        if (codexSnap.exists()) {
          const codexData = codexSnap.data();
          if (codexData.lingue) {
            setCodexLingue(codexData.lingue);
          } else {
            setError("Nessuna lingua trovata nel Codex");
          }
        } else {
          setError("Documento Codex non trovato");
        }

        // Fetch user data to display the name
        const userDocRef = doc(db, "users", userId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          setUserName(userData.characterId || userData.email || "Unknown User");
        }

        setIsLoading(false);
      } catch (error) {
        console.error("Error fetching data:", error);
        setError("Errore durante il recupero dei dati");
        setIsLoading(false);
      }
    };

    fetchData();
  }, [userId]);

  const handleSaveLingua = async () => {
    if (!selectedLingua) {
      return;
    }

    try {
      // Get the lingua details from codex
      const linguaData = codexLingue[selectedLingua];
      
      // Update the user's lingue field
      const userRef = doc(db, "users", userId);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const userData = userDoc.data();
        const updatedLingue = { ...(userData.lingue || {}) };

        // Add or update the selected lingua
        updatedLingue[selectedLingua] = linguaData;

        await updateDoc(userRef, { lingue: updatedLingue });
        onClose(true);
      } else {
        alert("User not found");
      }
    } catch (error) {
      console.error("Error saving lingua:", error);
      alert("Error saving lingua");
    }
  };

  // Filter lingue based on search term
  const filteredLingue = Object.entries(codexLingue)
    .filter(([nome]) => nome.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  const overlayContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-4/5 max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <h2 className="text-xl text-white mb-1">Aggiungi Lingua</h2>
        <p className="text-gray-300 mb-4">Per il giocatore: {userName}</p>
        
        {isLoading ? (
          <div className="text-center py-8 text-white">Caricamento lingue dal Codex...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-400">{error}</div>
        ) : (
          <>
            {/* Search input */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Cerca una lingua..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full p-2 rounded bg-gray-700 text-white"
              />
            </div>
            
            {/* List container with scrolling */}
            <div className="flex-1 overflow-y-auto mb-4 pr-2">
              {filteredLingue.length > 0 ? (
                <ul className="space-y-2">
                  {filteredLingue.map(([nome, descrizione]) => (
                    <li key={nome}>
                      <button
                        className={`w-full text-left p-3 rounded-md flex flex-col border ${
                          selectedLingua === nome
                            ? 'bg-blue-700 border-blue-500 text-white'
                            : 'bg-gray-700 hover:bg-gray-600 border-transparent'
                        }`}
                        onClick={() => setSelectedLingua(nome)}
                      >
                        <span className="font-medium text-lg">{nome}</span>
                        {typeof descrizione === 'string' && descrizione.trim() !== '' && (
                          <span className="text-sm text-gray-300 mt-1">{descrizione}</span>
                        )}
                        {typeof descrizione !== 'string' && descrizione !== null && (
                          <span className="text-xs text-gray-400 mt-1">
                            {JSON.stringify(descrizione)}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  {searchTerm ? "Nessuna lingua trovata con questo termine di ricerca" : "Nessuna lingua disponibile nel Codex"}
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-gray-700">
              <button
                type="button"
                onClick={() => onClose(false)}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleSaveLingua}
                disabled={!selectedLingua}
                className={`px-4 py-2 rounded ${
                  selectedLingua
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                }`}
              >
                Aggiungi
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlayContent, document.body);
}

export default AddLinguaPersonale;