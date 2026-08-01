import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { persistProfileContentMap } from '../../../../data/userData/managerProfileContent';

export function EditConoscenzaPersonaleOverlay({
  userId,
  userLabel,
  currentMap,
  conoscenzaName,
  onClose,
}) {
  const [livello, setLivello] = useState('Base');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const current = currentMap?.[conoscenzaName];
    setLivello(current?.livello || 'Base');
  }, [conoscenzaName, currentMap]);

  const handleSave = async () => {
    const current = currentMap?.[conoscenzaName];
    if (!current || typeof current !== 'object') {
      alert('Conoscenza non trovata o aggiornata altrove. Riapri il pannello.');
      onClose(false);
      return;
    }
    setIsSaving(true);
    try {
      await persistProfileContentMap({
        userId,
        field: 'conoscenze',
        currentMap,
        action: 'upsert',
        name: conoscenzaName,
        value: { ...current, livello },
      });
      onClose(true);
    } catch (error) {
      console.error('Error updating conoscenza:', error);
      alert(error.message || 'Errore durante la modifica della conoscenza');
      onClose(false);
    } finally {
      setIsSaving(false);
    }
  };

  const overlay = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm">
        <h2 className="text-xl text-white mb-2">Modifica Livello Conoscenza</h2>
        <p className="text-gray-300 mb-4">Giocatore: <span className="font-semibold">{userLabel || 'Unknown User'}</span></p>
        <p className="text-white mb-2">Conoscenza: <span className="font-semibold">{conoscenzaName}</span></p>
        <div className="mb-4">
          <label className="block text-white mb-1">Livello</label>
          <select
            value={livello}
            onChange={(event) => setLivello(event.target.value)}
            className="w-full p-2 rounded bg-gray-700 text-white"
          >
            <option value="Base">Base</option>
            <option value="Avanzato">Avanzato</option>
          </select>
        </div>
        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={() => onClose(false)}
            disabled={isSaving}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}
