import React, { useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  createUserOperationId,
  isDefinitiveUserDataCommandError,
  mutateInventory,
} from '../../../../data/userData/userDataCommands';
import { stableInventoryId } from '../../../../data/media/privateInventoryMediaWriter';

export function DelInventoryItemOverlay({ userId, userLabel, inventoryItemId, displayName, onClose }) {
  const [confirmInput, setConfirmInput] = useState('');
  const [busy, setBusy] = useState(false);
  const retryKeyRef = useRef(null);

  const handleDelete = async () => {
    const stableId = stableInventoryId(inventoryItemId);
    if (!userId || !stableId) {
      alert('L\'oggetto non ha un ID inventario V2 stabile. Aggiorna la pagina e riprova.');
      return;
    }
    retryKeyRef.current ||= `${userId}:${stableId}:${createUserOperationId('dm-inventory-remove')}`;
    setBusy(true);
    try {
      await mutateInventory({
        userId,
        action: 'remove',
        inventoryId: stableId,
        retryKey: retryKeyRef.current,
      });
      retryKeyRef.current = null;
      if (typeof onClose === 'function') onClose(true);
    } catch (error) {
      console.error('Failed deleting inventory item', error);
      if (isDefinitiveUserDataCommandError(error)) retryKeyRef.current = null;
      alert(error?.message || 'Errore nella cancellazione oggetto inventario');
      if (typeof onClose === 'function') onClose(false);
    } finally {
      setBusy(false);
    }
  };

  return ReactDOM.createPortal((
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-xl text-white mb-2">Elimina Oggetto Inventario</h2>
        <p className="text-gray-300 mb-4">Giocatore: <span className="font-semibold">{userLabel || userId}</span></p>
        <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4"><p className="text-white">Per eliminare <span className="font-semibold">{displayName}</span>, digita <span className="font-mono font-bold">DELETE</span> qui sotto:</p></div>
        <input type="text" value={confirmInput} onChange={(event) => setConfirmInput(event.target.value)} placeholder="Scrivi DELETE per confermare" className="w-full px-3 py-2 mb-4 rounded bg-gray-700 text-white focus:outline-none" />
        <div className="flex justify-end space-x-2">
          <button onClick={() => !busy && onClose(false)} disabled={busy} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50">Annulla</button>
          <button onClick={handleDelete} disabled={busy || confirmInput !== 'DELETE'} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center">
            {busy && <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/></svg>}
            Elimina
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

export default DelInventoryItemOverlay;
