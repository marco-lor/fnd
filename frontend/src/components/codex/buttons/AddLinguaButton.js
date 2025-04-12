// file: ./frontend/src/components/codex/buttons/AddLinguaButton.js
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types'; // Import PropTypes
import { db } from '../../firebaseConfig';
import { doc, updateDoc } from 'firebase/firestore';
import { FaCheckCircle, FaTimesCircle, FaSpinner, FaExclamationTriangle } from 'react-icons/fa'; // Added FaExclamationTriangle

// Accept 'lingue' map as a prop
function AddLinguaButton({ lingue }) {
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [newLinguaNome, setNewLinguaNome] = useState('');
  const [newLinguaDescrizione, setNewLinguaDescrizione] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' }); // type: 'success' or 'error'
  const [linguaExists, setLinguaExists] = useState(false); // New state for existence check
  const [existenceWarning, setExistenceWarning] = useState(''); // New state for warning message

  // Function to check existence and update state
  const checkLinguaExistence = (name) => {
    const nameTrimmed = name.trim();
    // Check only if the name is not empty and the lingue map is available
    if (nameTrimmed && lingue && lingue.hasOwnProperty(nameTrimmed)) {
      setLinguaExists(true);
      setExistenceWarning(`Attenzione: La lingua "${nameTrimmed}" esiste già.`);
      // Clear general feedback if an existence warning pops up
      setFeedback({ message: '', type: '' });
    } else {
      setLinguaExists(false);
      setExistenceWarning('');
    }
  };

  // Handle changes in the language name input
  const handleNameChange = (e) => {
    const name = e.target.value;
    setNewLinguaNome(name);
    checkLinguaExistence(name); // Check existence on every change
  };

  const handleButtonClick = () => {
    setIsOverlayVisible(true);
    // Reset fields, feedback, and existence state when opening
    setNewLinguaNome('');
    setNewLinguaDescrizione('');
    setFeedback({ message: '', type: '' });
    setLinguaExists(false);
    setExistenceWarning('');
  };

  const handleCloseOverlay = () => {
    if (isUpdating) return; // Prevent closing while actively updating
    setIsOverlayVisible(false);
    // Reset states on close as well (optional, but good practice)
    setNewLinguaNome('');
    setNewLinguaDescrizione('');
    setFeedback({ message: '', type: '' });
    setLinguaExists(false);
    setExistenceWarning('');
  };

  const handleAddLingua = async (e) => {
    e.preventDefault();
    const trimmedName = newLinguaNome.trim();
    const trimmedDesc = newLinguaDescrizione.trim();

    // This check prevents proceeding if the name exists when submitted
    if (linguaExists) {
        setFeedback({ message: `La lingua "${trimmedName}" esiste già. Impossibile aggiungerla di nuovo.`, type: 'error' });
        return;
    }

    if (!trimmedName) {
      setFeedback({ message: 'Il nome della lingua non può essere vuoto.', type: 'error' });
      return;
    }
    if (!trimmedDesc) {
      setFeedback({ message: 'La descrizione della lingua non può essere vuota.', type: 'error' });
      return;
    }

    // ---- START UPDATE PROCESS ----
    setIsUpdating(true); // Set updating flag
    setFeedback({ message: '', type: '' }); // Clear previous general feedback
    setExistenceWarning(''); // Clear existence warning *before* starting the update

    const codexDocRef = doc(db, 'utils', 'codex');
    const fieldPath = `lingue.${trimmedName}`;
    const updateData = { [fieldPath]: trimmedDesc };

    try {
      await updateDoc(codexDocRef, updateData);
      setFeedback({ message: `Lingua "${trimmedName}" aggiunta con successo!`, type: 'success' });

      // Close the overlay immediately after setting success feedback
      // Note: isUpdating will be set to false in the finally block *after* this potentially starts the close animation
      setIsOverlayVisible(false);

      // Reset fields and states (redundant with handleCloseOverlay/handleButtonClick but safe)
      setNewLinguaNome('');
      setNewLinguaDescrizione('');
      setLinguaExists(false);
      // existenceWarning is already cleared above

    } catch (error) {
      console.error("Errore durante l'aggiunta della lingua:", error);
      setFeedback({ message: `Errore durante l'aggiunta: ${error.message}`, type: 'error' });
      // Keep overlay open on error
    } finally {
      // ---- END UPDATE PROCESS ----
      setIsUpdating(false); // Clear updating flag regardless of success/failure
    }
  };

  // Effect to re-check existence if the `lingue` prop changes while the overlay is open
  useEffect(() => {
      // Only run the check if the overlay is visible AND we are NOT in the middle of an update.
      // This prevents the check triggered by the prop update (from the successful add)
      // from setting the warning while isUpdating is still true (before the finally block runs).
      if (isOverlayVisible && !isUpdating) {
          checkLinguaExistence(newLinguaNome);
      }
  // We keep the original dependencies. The logic inside handles the condition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lingue, isOverlayVisible, newLinguaNome]); // Added newLinguaNome as check depends on it


  return (
    <>
      {/* --- The Button --- */}
      <button
        onClick={handleButtonClick}
        className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition-colors mb-4 shadow-md"
        disabled={isUpdating} // Keep button disabled if overlay is mid-update (though overlay usually blocks interaction)
      >
        Aggiungi Lingua
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
              disabled={isUpdating} // Prevent closing while submitting
              aria-label="Close"
            >
              &times;
            </button>

            {/* Title */}
            <h2 className="text-xl font-semibold mb-4">Aggiungi Nuova Lingua</h2>

            {/* Input Form */}
            <form onSubmit={handleAddLingua}>
              <div className="mb-4">
                <label htmlFor="linguaNome" className="block text-sm font-medium text-gray-300 mb-1">
                  Nome Lingua
                </label>
                <input
                  type="text"
                  id="linguaNome"
                  value={newLinguaNome}
                  onChange={handleNameChange}
                  className={`w-full px-3 py-2 bg-gray-700 border ${
                    linguaExists && !isUpdating ? 'border-yellow-500' : 'border-gray-600' // Only show yellow border if not updating
                  } rounded text-white focus:outline-none focus:ring-2 ${
                      linguaExists && !isUpdating ? 'focus:ring-yellow-400' : 'focus:ring-blue-500' // Adjust focus ring too
                  } disabled:opacity-50`}
                  placeholder="Es: Elfico Antico"
                  required
                  disabled={isUpdating} // Disable input while submitting
                />
                {/* *** MODIFIED HERE *** */}
                {/* Display the warning only if it exists AND we are not currently updating */}
                {existenceWarning && !isUpdating && (
                  <div className="flex items-center mt-2 p-2 rounded bg-yellow-900 text-yellow-200">
                    <FaExclamationTriangle className="mr-2 flex-shrink-0" />
                    <span className="text-sm">{existenceWarning}</span>
                  </div>
                )}
              </div>

              <div className="mb-4">
                <label htmlFor="linguaDescrizione" className="block text-sm font-medium text-gray-300 mb-1">
                  Descrizione
                </label>
                <textarea
                  id="linguaDescrizione"
                  value={newLinguaDescrizione}
                  onChange={(e) => setNewLinguaDescrizione(e.target.value)}
                  rows="3"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="Descrizione della lingua..."
                  required
                  disabled={isUpdating} // Disable textarea while submitting
                ></textarea>
              </div>

              {/* General Feedback Area (Success/Error) */}
              {/* Show feedback if message exists AND the existence warning isn't currently showing (or shouldn't be because we're updating) */}
              {feedback.message && !(existenceWarning && !isUpdating) && (
                <div
                  className={`flex items-center p-3 rounded mb-4 ${
                    feedback.type === 'success' ? 'bg-green-900 text-green-200' : ''
                  } ${
                      feedback.type === 'error' ? 'bg-red-900 text-red-200': ''
                  }`}
                >
                  {feedback.type === 'success' ? (
                    <FaCheckCircle className="mr-2 flex-shrink-0" />
                  ) : (
                     feedback.type === 'error' ? <FaTimesCircle className="mr-2 flex-shrink-0" /> : null
                  )}
                  <span className="text-sm">{feedback.message}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={handleCloseOverlay}
                  className="py-2 px-4 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
                  disabled={isUpdating} // Disable cancel while submitting
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center justify-center disabled:opacity-50 disabled:bg-blue-800"
                  // Button is disabled if updating OR if the name exists (and we're not mid-update)
                  disabled={isUpdating || (linguaExists && !isUpdating)}
                >
                  {isUpdating ? (
                    <>
                      <FaSpinner className="animate-spin mr-2" />
                      Aggiungendo...
                    </>
                  ) : (
                    'Aggiungi Lingua'
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

// Add PropTypes validation for the new 'lingue' prop
AddLinguaButton.propTypes = {
  lingue: PropTypes.object.isRequired, // Expect 'lingue' to be an object (the map) and is required
};

export default AddLinguaButton;