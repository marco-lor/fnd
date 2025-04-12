// file: ./frontend/src/components/codex/buttons/AggiungiButton.js
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { db } from '../../firebaseConfig';
import { doc, updateDoc } from 'firebase/firestore';
import { FaCheckCircle, FaTimesCircle, FaSpinner, FaExclamationTriangle } from 'react-icons/fa';

// Helper to determine 'Nuovo' or 'Nuova' based on category name ending
const getNewAdjective = (name) => {
    if (typeof name !== 'string' || name.length === 0) return 'Nuovo'; // Default
    return name.toLowerCase().endsWith('a') ? 'Nuova' : 'Nuovo';
};

function AggiungiButton({ categoryKey, categoryData, categoryDisplayNameSingular }) {
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' }); // type: 'success' or 'error'
  const [itemExists, setItemExists] = useState(false);
  const [existenceWarning, setExistenceWarning] = useState('');

  // --- Derived values for display ---
  const displayNameLower = categoryDisplayNameSingular.toLowerCase();
  const newAdjective = getNewAdjective(categoryDisplayNameSingular); // 'Nuovo' or 'Nuova'

  // --- Functions ---

  // Function to check existence and update state
  const checkItemExistence = (name) => {
    const nameTrimmed = name.trim();
    // Check only if the name is not empty and the categoryData map is available
    if (nameTrimmed && categoryData && categoryData.hasOwnProperty(nameTrimmed)) {
      setItemExists(true);
      setExistenceWarning(`Attenzione: ${categoryDisplayNameSingular} "${nameTrimmed}" esiste già.`);
      setFeedback({ message: '', type: '' }); // Clear general feedback
    } else {
      setItemExists(false);
      setExistenceWarning('');
    }
  };

  // Handle changes in the item name input
  const handleNameChange = (e) => {
    const name = e.target.value;
    setNewItemName(name);
    checkItemExistence(name); // Check existence on every change
  };

  const handleButtonClick = () => {
    setIsOverlayVisible(true);
    setNewItemName('');
    setNewItemDescription('');
    setFeedback({ message: '', type: '' });
    setItemExists(false);
    setExistenceWarning('');
  };

  const handleCloseOverlay = () => {
    if (isUpdating) return;
    setIsOverlayVisible(false);
    // Reset states (optional, but good practice)
    setNewItemName('');
    setNewItemDescription('');
    setFeedback({ message: '', type: '' });
    setItemExists(false);
    setExistenceWarning('');
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    const trimmedName = newItemName.trim();
    const trimmedDesc = newItemDescription.trim();

    if (itemExists) {
        setFeedback({ message: `${categoryDisplayNameSingular} "${trimmedName}" esiste già. Impossibile aggiungerl${displayNameLower.endsWith('a') ? 'a' : 'o'} di nuovo.`, type: 'error' });
        return;
    }

    if (!trimmedName) {
      setFeedback({ message: `Il nome ${displayNameLower === 'lingua' ? 'della' : 'del'} ${displayNameLower} non può essere vuoto.`, type: 'error' });
      return;
    }
    // Allow empty descriptions? Let's require it for consistency.
    if (!trimmedDesc) {
      setFeedback({ message: `La descrizione ${displayNameLower === 'lingua' ? 'della' : 'del'} ${displayNameLower} non può essere vuota.`, type: 'error' });
      return;
    }

    setIsUpdating(true);
    setFeedback({ message: '', type: '' });
    setExistenceWarning(''); // Clear warning before update

    const codexDocRef = doc(db, 'utils', 'codex');
    // Dynamically create the field path using the categoryKey prop
    const fieldPath = `${categoryKey}.${trimmedName}`;
    const updateData = { [fieldPath]: trimmedDesc };

    try {
      await updateDoc(codexDocRef, updateData);
      setFeedback({ message: `${categoryDisplayNameSingular} "${trimmedName}" aggiunt${displayNameLower.endsWith('a') ? 'a' : 'o'} con successo!`, type: 'success' });
      setIsOverlayVisible(false); // Close on success
      // Reset fields (already handled by handleCloseOverlay/handleButtonClick)
      setNewItemName('');
      setNewItemDescription('');
      setItemExists(false);

    } catch (error) {
      console.error(`Errore durante l'aggiunta ${displayNameLower === 'lingua' ? 'della' : 'del'} ${displayNameLower}:`, error);
      setFeedback({ message: `Errore durante l'aggiunta: ${error.message}`, type: 'error' });
      // Keep overlay open on error
    } finally {
      setIsUpdating(false);
    }
  };

  // Effect to re-check existence if `categoryData` changes while overlay is open
  useEffect(() => {
      if (isOverlayVisible && !isUpdating) {
          checkItemExistence(newItemName);
      }
  // Check when data changes, overlay state changes, or the name being typed changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryData, isOverlayVisible, newItemName]);

  return (
    <>
      {/* --- The Button --- */}
      <button
        onClick={handleButtonClick}
        className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition-colors mb-4 shadow-md"
        disabled={isUpdating}
      >
        Aggiungi {categoryDisplayNameSingular}
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
            <h2 className="text-xl font-semibold mb-4">Aggiungi {newAdjective} {categoryDisplayNameSingular}</h2>

            {/* Input Form */}
            <form onSubmit={handleAddItem}>
              {/* Name Input */}
              <div className="mb-4">
                <label htmlFor="itemName" className="block text-sm font-medium text-gray-300 mb-1">
                  Nome {categoryDisplayNameSingular}
                </label>
                <input
                  type="text"
                  id="itemName" // Generic ID
                  value={newItemName}
                  onChange={handleNameChange}
                  className={`w-full px-3 py-2 bg-gray-700 border ${
                    itemExists && !isUpdating ? 'border-yellow-500' : 'border-gray-600'
                  } rounded text-white focus:outline-none focus:ring-2 ${
                      itemExists && !isUpdating ? 'focus:ring-yellow-400' : 'focus:ring-blue-500'
                  } disabled:opacity-50`}
                  placeholder={`Es: Nome ${categoryDisplayNameSingular}`}
                  required
                  disabled={isUpdating}
                />
                {existenceWarning && !isUpdating && (
                  <div className="flex items-center mt-2 p-2 rounded bg-yellow-900 text-yellow-200">
                    <FaExclamationTriangle className="mr-2 flex-shrink-0" />
                    <span className="text-sm">{existenceWarning}</span>
                  </div>
                )}
              </div>

              {/* Description Input */}
              <div className="mb-4">
                <label htmlFor="itemDescription" className="block text-sm font-medium text-gray-300 mb-1">
                  Descrizione
                </label>
                <textarea
                  id="itemDescription" // Generic ID
                  value={newItemDescription}
                  onChange={(e) => setNewItemDescription(e.target.value)}
                  rows="3"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder={`Descrizione ${displayNameLower === 'lingua' ? 'della' : 'del'} ${displayNameLower}...`}
                  required
                  disabled={isUpdating}
                ></textarea>
              </div>

              {/* General Feedback Area (Success/Error) */}
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
                  disabled={isUpdating}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center justify-center disabled:opacity-50 disabled:bg-blue-800"
                  disabled={isUpdating || (itemExists && !isUpdating)}
                >
                  {isUpdating ? (
                    <>
                      <FaSpinner className="animate-spin mr-2" />
                      Aggiungendo...
                    </>
                  ) : (
                    `Aggiungi ${categoryDisplayNameSingular}`
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

// Define PropTypes for the required props
AggiungiButton.propTypes = {
  categoryKey: PropTypes.string.isRequired, // Firestore key (e.g., 'lingue')
  categoryData: PropTypes.object.isRequired, // Map of existing items for validation (e.g., { 'Elfico': 'descr'})
  categoryDisplayNameSingular: PropTypes.string.isRequired, // User-friendly singular name (e.g., 'Lingua')
};

export default AggiungiButton;