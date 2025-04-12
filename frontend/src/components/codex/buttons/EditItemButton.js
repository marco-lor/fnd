// file: ./frontend/src/components/codex/buttons/EditItemButton.js
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { db } from '../../firebaseConfig';
import { doc, updateDoc } from 'firebase/firestore';
import { FaEdit, FaSpinner, FaCheckCircle, FaTimesCircle } from 'react-icons/fa';

function EditItemButton({ categoryKey, itemKey, currentValue }) {
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  // Initialize with current value, handle non-string values gracefully
  const initialDescription = typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue, null, 2) ?? '';
  const [newDescription, setNewDescription] = useState(initialDescription);
  const [isUpdating, setIsUpdating] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' });

  // Ensure state updates if currentValue prop changes while overlay is closed
  useEffect(() => {
    if (!isOverlayVisible) {
        const updatedDescription = typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue, null, 2) ?? '';
        setNewDescription(updatedDescription);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentValue]); // Rerun if the currentValue prop changes


  const handleButtonClick = () => {
    // Reset state when opening
    const currentDesc = typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue, null, 2) ?? '';
    setNewDescription(currentDesc);
    setFeedback({ message: '', type: '' });
    setIsUpdating(false);
    setIsOverlayVisible(true);
  };

  const handleCloseOverlay = () => {
    if (isUpdating) return;
    setIsOverlayVisible(false);
  };

  const handleSaveChanges = async (e) => {
    e.preventDefault();
    const trimmedDesc = newDescription.trim();

    // Optional: Add validation if description shouldn't be empty
    if (!trimmedDesc) {
        setFeedback({ message: 'La descrizione non può essere vuota.', type: 'error' });
        return;
    }

    // Prevent saving if description hasn't changed? Optional.
    if (trimmedDesc === initialDescription) {
        setFeedback({ message: 'Nessuna modifica rilevata.', type: 'info' }); // Use 'info' or just close
        handleCloseOverlay();
        return;
    }


    setIsUpdating(true);
    setFeedback({ message: '', type: '' });

    const codexDocRef = doc(db, 'utils', 'codex');
    const fieldPath = `${categoryKey}.${itemKey}`; // e.g., lingue.Elfico Antico
    const updateData = { [fieldPath]: trimmedDesc };

    try {
      await updateDoc(codexDocRef, updateData);
      setFeedback({ message: `Descrizione di "${itemKey}" aggiornata con successo!`, type: 'success' });
      // Optional: Close overlay automatically after a short delay
      setTimeout(() => {
          if (isOverlayVisible) { // Check if still visible in case user closed it manually
             handleCloseOverlay();
          }
      }, 1500); // Close after 1.5 seconds
      //setIsUpdating(false); // Set in finally block

    } catch (error) {
      console.error("Errore durante l'aggiornamento dell'elemento:", error);
      setFeedback({ message: `Errore durante l'aggiornamento: ${error.message}`, type: 'error' });
      // Keep overlay open on error
      //setIsUpdating(false); // Set in finally block
    } finally {
        setIsUpdating(false); // Ensure loading state is reset
    }
  };

  return (
    <>
      {/* --- The Edit Button --- */}
      <button
        onClick={handleButtonClick}
        className="p-1 text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
        title={`Modifica ${itemKey}`}
        disabled={isUpdating || isOverlayVisible} // Disable if overlay is open or already updating
        aria-label={`Modifica ${itemKey}`}
      >
        <FaEdit />
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
              disabled={isUpdating}
              aria-label="Close"
            >
              &times;
            </button>

            {/* Title */}
            <h2 className="text-xl font-semibold mb-4">Modifica Descrizione: {itemKey}</h2>

            {/* Input Form */}
            <form onSubmit={handleSaveChanges}>
              <div className="mb-4">
                <label htmlFor="itemDescriptionEdit" className="block text-sm font-medium text-gray-300 mb-1">
                  Nuova Descrizione
                </label>
                <textarea
                  id="itemDescriptionEdit"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows="5" // Make textarea a bit larger for editing
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="Inserisci la nuova descrizione..."
                  required
                  disabled={isUpdating}
                ></textarea>
              </div>

              {/* Feedback Area */}
              {feedback.message && (
                <div
                  className={`flex items-center p-3 rounded mb-4 text-sm ${
                    feedback.type === 'success' ? 'bg-green-900 text-green-200' : ''
                  } ${
                    feedback.type === 'error' ? 'bg-red-900 text-red-200': ''
                  } ${
                      feedback.type === 'info' ? 'bg-blue-900 text-blue-200': '' // Optional info style
                  }`}
                >
                   {feedback.type === 'success' && <FaCheckCircle className="mr-2 flex-shrink-0" />}
                   {feedback.type === 'error' && <FaTimesCircle className="mr-2 flex-shrink-0" />}
                  {/* Add icon for info if needed */}
                  <span>{feedback.message}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={handleCloseOverlay}
                  className="py-2 px-4 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
                  disabled={isUpdating}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center justify-center disabled:opacity-50 disabled:bg-blue-800"
                  disabled={isUpdating || newDescription.trim() === initialDescription} // Disable if updating or no changes made
                >
                  {isUpdating ? (
                    <>
                      <FaSpinner className="animate-spin mr-2" />
                      Salvando...
                    </>
                  ) : (
                    'Salva Modifiche'
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

EditItemButton.propTypes = {
  categoryKey: PropTypes.string.isRequired, // e.g., 'lingue'
  itemKey: PropTypes.string.isRequired,     // e.g., 'Elfico Antico'
  currentValue: PropTypes.any.isRequired,   // The current description or value
};

export default EditItemButton;