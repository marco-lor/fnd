// file: ./frontend/src/components/codex/buttons/DeleteItemButton.js
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { db } from '../../firebaseConfig';
import { doc, updateDoc, FieldValue } from 'firebase/firestore'; // Import FieldValue
import { FaTrashAlt, FaSpinner, FaCheckCircle, FaTimesCircle, FaExclamationTriangle } from 'react-icons/fa';

// Need FieldValue to delete a map key
import { deleteField } from 'firebase/firestore'; // Correct import for v9+

function DeleteItemButton({ categoryKey, itemKey }) {
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' });

  const handleButtonClick = () => {
    // Reset state when opening
    setConfirmationInput('');
    setFeedback({ message: '', type: '' });
    setIsDeleting(false);
    setIsOverlayVisible(true);
  };

  const handleCloseOverlay = () => {
    if (isDeleting) return;
    setIsOverlayVisible(false);
  };

  const handleDelete = async (e) => {
    e.preventDefault();

    if (confirmationInput !== itemKey) {
      setFeedback({ message: 'Il nome inserito non corrisponde. Eliminazione annullata.', type: 'error' });
      return;
    }

    setIsDeleting(true);
    setFeedback({ message: '', type: '' });

    const codexDocRef = doc(db, 'utils', 'codex');
    // Use FieldValue.delete() to remove the specific key from the map
    const fieldPath = `${categoryKey}.${itemKey}`;
    const updateData = { [fieldPath]: deleteField() }; // Use deleteField()

    try {
      await updateDoc(codexDocRef, updateData);
      // No need for success feedback state as the component might unmount immediately
      // upon successful deletion when the parent re-renders.
      // Closing the overlay might be sufficient, or show feedback briefly before close.
      console.log(`Elemento "${itemKey}" eliminato con successo!`); // Log success

      // Close the overlay immediately on successful deletion
      handleCloseOverlay();
      // The parent component (Codex.js) listening to snapshots will handle the UI update.

    } catch (error) {
      console.error("Errore durante l'eliminazione dell'elemento:", error);
      setFeedback({ message: `Errore durante l'eliminazione: ${error.message}`, type: 'error' });
      setIsDeleting(false); // Only reset loading on error, keep overlay open
    }
    // No finally block needed to set isDeleting = false if we close overlay on success
  };

  // Check if confirmation matches to enable delete button
  const isConfirmationMatching = confirmationInput === itemKey;

  return (
    <>
      {/* --- The Delete Button --- */}
      <button
        onClick={handleButtonClick}
        className="p-1 text-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
        title={`Elimina ${itemKey}`}
        disabled={isDeleting || isOverlayVisible} // Disable if overlay is open or already deleting
        aria-label={`Elimina ${itemKey}`}
      >
        <FaTrashAlt />
      </button>

      {/* --- The Custom Overlay --- */}
      {isOverlayVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
          {/* Overlay Content Box */}
          <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md relative text-white">
            {/* Close Button */}
            <button
              onClick={handleCloseOverlay}
              className="absolute top-2 right-3 text-gray-400 hover:text-white text-2xl font-bold"
              disabled={isDeleting}
              aria-label="Close"
            >
              &times;
            </button>

            {/* Title */}
            <h2 className="text-xl font-semibold mb-4 text-red-400 flex items-center">
                <FaExclamationTriangle className="mr-2"/> Conferma Eliminazione
            </h2>

            {/* Confirmation Instructions */}
            <p className="mb-3 text-gray-300">
                Sei sicuro di voler eliminare permanentemente l'elemento: <strong className="font-bold text-yellow-400">{itemKey}</strong>?
            </p>
            <p className="mb-4 text-gray-300">
                Per confermare, digita il nome esatto dell'elemento qui sotto:
            </p>


            {/* Input Form */}
            <form onSubmit={handleDelete}>
              <div className="mb-4">
                <label htmlFor="confirmationName" className="sr-only"> {/* Screen reader only label */}
                  Digita {itemKey} per confermare
                </label>
                <input
                  type="text"
                  id="confirmationName"
                  value={confirmationInput}
                  onChange={(e) => setConfirmationInput(e.target.value)}
                  className={`w-full px-3 py-2 bg-gray-700 border ${
                    confirmationInput && !isConfirmationMatching ? 'border-red-500' : 'border-gray-600' // Highlight red if typed but incorrect
                  } rounded text-white focus:outline-none focus:ring-2 ${
                     confirmationInput && !isConfirmationMatching ? 'focus:ring-red-400' : 'focus:ring-blue-500'
                  } disabled:opacity-50`}
                  placeholder={itemKey} // Show expected name as placeholder
                  required
                  disabled={isDeleting}
                  autoComplete="off" // Prevent autocomplete
                />
              </div>

              {/* Feedback Area */}
              {feedback.message && (
                 <div
                  className={`flex items-center p-3 rounded mb-4 text-sm ${
                     feedback.type === 'error' ? 'bg-red-900 text-red-200': ''
                     // Add other types if needed
                  }`}
                >
                  {feedback.type === 'error' && <FaTimesCircle className="mr-2 flex-shrink-0" />}
                  <span>{feedback.message}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={handleCloseOverlay}
                  className="py-2 px-4 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
                  disabled={isDeleting}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded transition-colors flex items-center justify-center disabled:opacity-50 disabled:bg-red-800"
                  disabled={isDeleting || !isConfirmationMatching} // Disable if deleting or confirmation doesn't match
                >
                  {isDeleting ? (
                    <>
                      <FaSpinner className="animate-spin mr-2" />
                      Eliminando...
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

DeleteItemButton.propTypes = {
  categoryKey: PropTypes.string.isRequired, // e.g., 'lingue'
  itemKey: PropTypes.string.isRequired,     // e.g., 'Elfico Antico'
};

export default DeleteItemButton;