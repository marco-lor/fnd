import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { persistProfileContentMap } from '../../../../data/userData/managerProfileContent';

export function DelLinguaPersonaleOverlay({
  userId,
  userLabel,
  currentMap,
  linguaName,
  onClose,
}) {
  const [confirmInput, setConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await persistProfileContentMap({
        userId,
        field: 'lingue',
        currentMap,
        action: 'delete',
        name: linguaName,
      });
      onClose(true);
    } catch (error) {
      console.error('Error deleting lingua:', error);
      alert(error.message || 'Errore durante l eliminazione della lingua');
      onClose(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const overlay = (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-xl text-white mb-2">Elimina Lingua</h2>
        <p className="text-gray-300 mb-4">Giocatore: <span className="font-semibold">{userLabel || 'Unknown User'}</span></p>
        <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4">
          <p className="text-white">Per eliminare <span className="font-semibold">{linguaName}</span>, digita il nome esatto qui sotto:</p>
        </div>
        <input
          type="text"
          value={confirmInput}
          onChange={(event) => setConfirmInput(event.target.value)}
          placeholder="Conferma il nome"
          className="w-full px-3 py-2 mb-4 rounded bg-gray-700 text-white focus:outline-none"
        />
        <div className="flex justify-end space-x-2">
          <button
            onClick={() => onClose(false)}
            disabled={isDeleting}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting || confirmInput !== linguaName}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            Elimina
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}
