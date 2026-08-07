import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { persistProfileContentMap } from '../../../../data/userData/managerProfileContent';

export function EditProfessionePersonaleOverlay({
  userId,
  userLabel,
  currentMap,
  professioneName,
  onClose,
}) {
  const [livello, setLivello] = useState('Base');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const current = currentMap?.[professioneName];
    setLivello(current?.livello || 'Base');
  }, [currentMap, professioneName]);

  const handleSave = async () => {
    const current = currentMap?.[professioneName];
    if (!current || typeof current !== 'object') {
      alert('Professione non trovata o aggiornata altrove. Riapri il pannello.');
      onClose(false);
      return;
    }
    setIsSaving(true);
    try {
      await persistProfileContentMap({
        userId,
        field: 'professioni',
        currentMap,
        action: 'upsert',
        name: professioneName,
        value: { ...current, livello },
      });
      onClose(true);
    } catch (error) {
      console.error('Error updating professione:', error);
      alert(error.message || 'Errore durante la modifica della professione');
      onClose(false);
    } finally {
      setIsSaving(false);
    }
  };

  const overlay = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm">
        <h2 className="text-xl text-white mb-2">Modifica Livello Professione</h2>
        <p className="text-gray-300 mb-4">Giocatore: <span className="font-semibold">{userLabel || 'Unknown User'}</span></p>
        <p className="text-white mb-2">Professione: <span className="font-semibold">{professioneName}</span></p>
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
