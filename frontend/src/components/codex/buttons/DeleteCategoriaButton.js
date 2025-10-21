import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { db } from '../../firebaseConfig';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { FaTrashAlt, FaSpinner, FaTimesCircle, FaExclamationTriangle, FaCheckCircle } from 'react-icons/fa';

/*
  DeleteCategoriaButton
  - Elimina l'intera categoria (campo top-level) dal documento Firestore `utils/codex`.
  - Richiede conferma digitando il nome esatto della categoria (chiave) per evitare errori.
  Props:
    categoryKey: string (chiave Firestore, es: 'lingue')
    itemCount: number (numero elementi nella categoria, per info utente)
    onDeleted: function (callback invocata dopo eliminazione riuscita)
*/
function DeleteCategoriaButton({ categoryKey, itemCount, onDeleted }) {
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' }); // error | success

  const openOverlay = () => {
    setConfirmationInput('');
    setFeedback({ message: '', type: '' });
    setIsDeleting(false);
    setIsOverlayVisible(true);
  };

  const closeOverlay = () => {
    if (isDeleting) return;
    setIsOverlayVisible(false);
  };

  const handleDelete = async (e) => {
    e.preventDefault();
    if (confirmationInput !== categoryKey) {
      setFeedback({ message: 'La chiave inserita non corrisponde alla categoria.', type: 'error' });
      return;
    }
    setIsDeleting(true);
    setFeedback({ message: '', type: '' });
    try {
      const codexDocRef = doc(db, 'utils', 'codex');
      await updateDoc(codexDocRef, { [categoryKey]: deleteField() });
      setFeedback({ message: `Categoria "${categoryKey}" eliminata con successo!`, type: 'success' });
      // Breve delay per mostrare feedback
      setTimeout(() => {
        setIsOverlayVisible(false);
        setIsDeleting(false);
        if (onDeleted) onDeleted(categoryKey);
      }, 800);
    } catch (err) {
      console.error('Errore eliminazione categoria:', err);
      setFeedback({ message: `Errore eliminazione: ${err.message}`, type: 'error' });
      setIsDeleting(false);
    }
  };

  const confirmationMatches = confirmationInput === categoryKey;

  return (
    <>
      <button
        type="button"
        onClick={openOverlay}
        className="ml-2 px-2 py-1 text-red-500 hover:text-red-400 transition-colors text-sm rounded disabled:opacity-40"
        title={`Elimina categoria ${categoryKey}`}
        disabled={isDeleting || isOverlayVisible}
        aria-label={`Elimina categoria ${categoryKey}`}
      >
        <FaTrashAlt />
      </button>

      {isOverlayVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
          <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md relative text-white">
            <button
              onClick={closeOverlay}
              className="absolute top-2 right-3 text-gray-400 hover:text-white text-2xl font-bold"
              disabled={isDeleting}
              aria-label="Close"
            >
              &times;
            </button>
            <h2 className="text-xl font-semibold mb-4 text-red-400 flex items-center">
              <FaExclamationTriangle className="mr-2" /> Elimina Categoria
            </h2>
            <p className="text-gray-300 mb-2">
              Stai per eliminare la categoria: <span className="font-semibold text-yellow-300">{categoryKey}</span>
            </p>
            <p className="text-gray-400 mb-4 text-sm">
              Questa azione rimuoverà {itemCount} element{itemCount === 1 ? 'o' : 'i'} contenut{itemCount === 1 ? 'o' : 'i'} in questa categoria. Operazione irreversibile.
            </p>
            <form onSubmit={handleDelete}>
              <div className="mb-4">
                <label htmlFor="confirmCategoryDelete" className="block text-sm font-medium text-gray-300 mb-1">
                  Digita la chiave della categoria per confermare
                </label>
                <input
                  id="confirmCategoryDelete"
                  type="text"
                  value={confirmationInput}
                  onChange={(e) => setConfirmationInput(e.target.value)}
                  className={`w-full px-3 py-2 bg-gray-700 border ${confirmationInput && !confirmationMatches ? 'border-red-500' : 'border-gray-600'} rounded text-white focus:outline-none focus:ring-2 ${confirmationInput && !confirmationMatches ? 'focus:ring-red-400' : 'focus:ring-blue-500'} disabled:opacity-50`}
                  placeholder={categoryKey}
                  autoComplete="off"
                  disabled={isDeleting}
                />
              </div>

              {feedback.message && (
                <div className={`flex items-center p-3 rounded mb-4 text-sm ${feedback.type === 'error' ? 'bg-red-900 text-red-200' : ''} ${feedback.type === 'success' ? 'bg-green-900 text-green-200' : ''}`}>\n                  {feedback.type === 'error' && <FaTimesCircle className="mr-2 flex-shrink-0" />}\n                  {feedback.type === 'success' && <FaCheckCircle className="mr-2 flex-shrink-0" />}\n                  <span>{feedback.message}</span>\n                </div>
              )}

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={closeOverlay}
                  className="py-2 px-4 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
                  disabled={isDeleting}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded transition-colors flex items-center justify-center disabled:opacity-50 disabled:bg-red-800"
                  disabled={isDeleting || !confirmationMatches}
                >
                  {isDeleting ? (
                    <>
                      <FaSpinner className="animate-spin mr-2" /> Eliminando...
                    </>
                  ) : (
                    <>
                      <FaTrashAlt className="mr-2" /> Elimina Definitivamente
                    </>
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

DeleteCategoriaButton.propTypes = {
  categoryKey: PropTypes.string.isRequired,
  itemCount: PropTypes.number.isRequired,
  onDeleted: PropTypes.func,
};

export default DeleteCategoriaButton;
