import React, { useState, useEffect } from 'react';
import { db } from '../../firebaseConfig';
import { doc, updateDoc } from 'firebase/firestore';
import { FaPlus, FaSpinner, FaCheckCircle, FaTimesCircle, FaExclamationTriangle } from 'react-icons/fa';
import PropTypes from 'prop-types';

/*
  Bottone per aggiungere una nuova CATEGORIA al documento Codex.
  - Crea un nuovo campo top-level nel documento Firestore `utils/codex`.
  - Normalizza il nome (spazi -> underscore, lowercase per la chiave) ma mantiene la versione capitalizzata per la UI.
  - Previene duplicati e nomi vuoti.
*/
function AggiungiCategoriaButton({ existingCategories, onCategoryCreated }) {
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [rawCategoryName, setRawCategoryName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' }); // success | error | warning
  const [alreadyExists, setAlreadyExists] = useState(false);

  // Normalizza il nome per la chiave Firestore
  // Genera la chiave da salvare su Firestore mantenendo gli spazi.
  // Rimuove solo i caratteri che creerebbero problemi nei percorsi (punto) o di controllo.
  // Non forza lowercase per preservare la forma inserita (utile per visualizzazione diretta).
  const normalizeKey = (name) => {
    const trimmed = name.trim();
    // Sostituisci punti con spazio per evitare conflitti col path dot notation.
    const noDots = trimmed.replace(/[.]/g, ' ');
    // Comprimi spazi multipli.
    const squashed = noDots.replace(/\s{2,}/g, ' ');
    // Rimuovi caratteri di controllo / non stampabili.
    return squashed.replace(/[\r\n\t]/g, '').trim();
  };

  const handleOpen = () => {
    setIsOverlayVisible(true);
    setRawCategoryName('');
    setFeedback({ message: '', type: '' });
    setAlreadyExists(false);
  };

  const handleClose = () => {
    if (isCreating) return;
    setIsOverlayVisible(false);
  };

  // Controlla se la categoria esiste già (sia come chiave normalizzata che come nome raw lowercase)
  useEffect(() => {
    if (!isOverlayVisible) return;
    const trimmed = rawCategoryName.trim();
    if (!trimmed) {
      setAlreadyExists(false);
      setFeedback({ message: '', type: '' });
      return;
    }
    const normalized = normalizeKey(trimmed);
    const lowerRaw = trimmed.toLowerCase();
    const collision = existingCategories.some((cat) => {
      // Confronto case-insensitive sia sulla forma normale che sulla forma normalizzata
      return cat.toLowerCase() === lowerRaw || cat.toLowerCase() === normalized.toLowerCase();
    });
    if (collision) {
      setAlreadyExists(true);
    } else {
      setAlreadyExists(false);
    }
  }, [rawCategoryName, existingCategories, isOverlayVisible]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const trimmed = rawCategoryName.trim();
    if (!trimmed) {
      setFeedback({ message: 'Il nome della categoria non può essere vuoto.', type: 'error' });
      return;
    }
    if (alreadyExists) {
      setFeedback({ message: 'Categoria già esistente.', type: 'error' });
      return;
    }

  const normalizedKey = normalizeKey(trimmed);
    if (!normalizedKey) {
      setFeedback({ message: 'Il nome inserito non produce una chiave valida.', type: 'error' });
      return;
    }

    // Validazioni aggiuntive: lunghezza minima / caratteri
    if (normalizedKey.length < 2) {
      setFeedback({ message: 'Il nome è troppo corto.', type: 'error' });
      return;
    }

    setIsCreating(true);
    setFeedback({ message: '', type: '' });

    try {
      const codexDocRef = doc(db, 'utils', 'codex');
      // Inizializza come oggetto vuoto; si potranno aggiungere elementi successivamente.
      await updateDoc(codexDocRef, { [normalizedKey]: {} });
      setFeedback({ message: `Categoria "${trimmed}" creata con successo!`, type: 'success' });
      // Chiudi overlay dopo breve delay e notifica il parent
      setTimeout(() => {
        setIsOverlayVisible(false);
        setIsCreating(false);
        if (onCategoryCreated) onCategoryCreated(normalizedKey);
      }, 900);
    } catch (err) {
      console.error('Errore creazione categoria:', err);
      setFeedback({ message: `Errore durante la creazione: ${err.message}`, type: 'error' });
      setIsCreating(false);
    }
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded transition-colors mb-4 shadow-md flex items-center justify-center"
        disabled={isCreating || isOverlayVisible}
      >
        <FaPlus className="mr-2" /> Nuova Categoria
      </button>

      {isOverlayVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
          <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md relative text-white">
            <button
              onClick={handleClose}
              className="absolute top-2 right-3 text-gray-400 hover:text-white text-2xl font-bold"
              disabled={isCreating}
              aria-label="Close"
            >
              &times;
            </button>
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <FaPlus className="mr-2" /> Crea Nuova Categoria
            </h2>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label htmlFor="newCategoryName" className="block text-sm font-medium text-gray-300 mb-1">
                  Nome Categoria
                </label>
                <input
                  id="newCategoryName"
                  type="text"
                  value={rawCategoryName}
                  onChange={(e) => setRawCategoryName(e.target.value)}
                  className={`w-full px-3 py-2 bg-gray-700 border ${alreadyExists ? 'border-yellow-500' : 'border-gray-600'} rounded text-white focus:outline-none focus:ring-2 ${alreadyExists ? 'focus:ring-yellow-400' : 'focus:ring-blue-500'} disabled:opacity-50`}
                  placeholder="Es: lingue antiche"
                  disabled={isCreating}
                  autoComplete="off"
                />
                {rawCategoryName.trim() && (
                  <p className="text-xs mt-2 text-gray-400">
                    Chiave generata: <code className="text-blue-300">{normalizeKey(rawCategoryName) || '—'}</code>
                  </p>
                )}
                {alreadyExists && (
                  <div className="flex items-center mt-2 p-2 rounded bg-yellow-900 text-yellow-200">
                    <FaExclamationTriangle className="mr-2 flex-shrink-0" />
                    <span className="text-sm">Esiste già una categoria con questo nome o chiave.</span>
                  </div>
                )}
              </div>

              {feedback.message && !alreadyExists && (
                <div className={`flex items-center p-3 rounded mb-4 text-sm ${
                  feedback.type === 'success' ? 'bg-green-900 text-green-200' : ''
                } ${feedback.type === 'error' ? 'bg-red-900 text-red-200' : ''}`}
                >
                  {feedback.type === 'success' && <FaCheckCircle className="mr-2 flex-shrink-0" />}
                  {feedback.type === 'error' && <FaTimesCircle className="mr-2 flex-shrink-0" />}
                  <span>{feedback.message}</span>
                </div>
              )}

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="py-2 px-4 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
                  disabled={isCreating}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded transition-colors flex items-center justify-center disabled:opacity-50 disabled:bg-green-800"
                  disabled={isCreating || alreadyExists || !rawCategoryName.trim()}
                >
                  {isCreating ? (
                    <>
                      <FaSpinner className="animate-spin mr-2" /> Creando...
                    </>
                  ) : (
                    'Crea Categoria'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

AggiungiCategoriaButton.propTypes = {
  existingCategories: PropTypes.arrayOf(PropTypes.string).isRequired,
  onCategoryCreated: PropTypes.func, // callback(categoryKey)
};

export default AggiungiCategoriaButton;
