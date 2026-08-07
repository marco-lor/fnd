// ./buttons/addProfessionePersonale.js
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { getCodex } from '../../../../data/codexRepository';
import { persistProfileContentMap } from '../../../../data/userData/managerProfileContent';
import SavingButtonContent from './SavingButtonContent';

// --- Style definition ---
const sleekButtonStyle = "w-36 px-2 py-1 bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-700 hover:to-indigo-800 text-white text-xs font-medium rounded-md transition-all duration-150 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 shadow-sm";

// --- Button Component ---
const AddProfessionePersonale = ({ onClick }) => {
  return (
    <button
      className={sleekButtonStyle}
      onClick={onClick}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
      </svg>
      <span>Add Professione</span>
    </button>
  );
};

// --- New Overlay Component ---
export function AddProfessionePersonaleOverlay({
  userId,
  userLabel,
  currentMap,
  onClose,
}) {
  const [codexProfessioni, setCodexProfessioni] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProfessione, setSelectedProfessione] = useState(null);
  const [livello, setLivello] = useState("Base");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch codex data (professioni)
        const codexData = await getCodex();

        if (codexData) {
          if (codexData.professioni) {
            setCodexProfessioni(codexData.professioni);
          } else {
            setError("Nessuna professione trovata nel Codex");
          }
        } else {
          setError("Documento Codex non trovato");
        }

        setIsLoading(false);
      } catch (error) {
        console.error("Error fetching data:", error);
        setError("Errore durante il recupero dei dati");
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSaveProfessione = async () => {
    if (!selectedProfessione || saveInFlightRef.current) {
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);

    try {
      // Get the professione description and include livello
      const descrizione = codexProfessioni[selectedProfessione];
      const professionePayload = { descrizione, livello };
      
      await persistProfileContentMap({
        userId,
        field: 'professioni',
        currentMap,
        action: 'upsert',
        name: selectedProfessione,
        value: professionePayload,
      });
      onClose(true);
    } catch (error) {
      console.error("Error saving professione:", error);
      alert("Error saving professione");
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  // Filter professioni based on search term
  const filteredProfessioni = Object.entries(codexProfessioni)
    .filter(([nome]) => nome.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  const overlayContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-4/5 max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <h2 className="text-xl text-white mb-1">Aggiungi Professione</h2>
        <p className="text-gray-300 mb-4">Per il giocatore: {userLabel || 'Unknown User'}</p>
        
        {isLoading ? (
          <div className="text-center py-8 text-white">Caricamento professioni dal Codex...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-400">{error}</div>
        ) : (
          <>
            {/* Search input */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Cerca una professione..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full p-2 rounded bg-gray-700 text-white"
              />
            </div>
            
            {/* List container with scrolling */}
            <div className="flex-1 overflow-y-auto mb-4 pr-2">
              {filteredProfessioni.length > 0 ? (
                <ul className="space-y-2">
                  {filteredProfessioni.map(([nome, descrizione]) => (
                    <li key={nome}>
                      <button
                        className={`w-full text-left p-3 rounded-md flex flex-col border ${
                          selectedProfessione === nome
                            ? 'bg-blue-700 border-blue-500 text-white'
                            : 'bg-gray-700 hover:bg-gray-600 border-transparent'
                        }`}
                        onClick={() => setSelectedProfessione(nome)}
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
                  {searchTerm ? "Nessuna professione trovata con questo termine di ricerca" : "Nessuna professione disponibile nel Codex"}
                </div>
              )}
            </div>
            {/* Livello selector */}
            <div className="mb-4">
              <label className="block text-white mb-1">Livello</label>
              <select
                value={livello}
                onChange={(e) => setLivello(e.target.value)}
                className="w-full p-2 rounded bg-gray-700 text-white"
              >
                <option value="Base">Base</option>
                <option value="Avanzato">Avanzato</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-gray-700">
              <button
                type="button"
                onClick={() => {
                  if (!saveInFlightRef.current) onClose(false);
                }}
                disabled={isSaving}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleSaveProfessione}
                aria-busy={isSaving}
                disabled={isSaving || !selectedProfessione}
                className={`px-4 py-2 rounded inline-flex items-center justify-center disabled:cursor-not-allowed ${
                  selectedProfessione
                    ? 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60'
                    : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isSaving ? <SavingButtonContent /> : 'Aggiungi'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlayContent, document.body);
}

export default AddProfessionePersonale;
