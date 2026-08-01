import React, { useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  createUserOperationId,
  isDefinitiveUserDataCommandError,
  mutateInventory,
} from '../../../../data/userData/userDataCommands';
import { stableInventoryId } from '../../../../data/media/privateInventoryMediaWriter';

export default function DelVarieItemUnitsOverlay({ userId, varieItemId, displayName, totalQty, onClose }) {
  const [qtyToDelete, setQtyToDelete] = useState(1);
  const [useAll, setUseAll] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [busy, setBusy] = useState(false);
  const retryKeyRef = useRef(null);
  const safeTotalQty = Math.max(1, Number(totalQty) || 1);
  const effectiveQty = useAll ? safeTotalQty : qtyToDelete;

  const handleDelete = async () => {
    const stableId = stableInventoryId(varieItemId);
    if (!userId || !stableId || effectiveQty < 1) return;
    retryKeyRef.current ||= `${userId}:${stableId}:${effectiveQty}:${createUserOperationId('dm-varie-remove')}`;
    setBusy(true);
    try {
      const removeAll = effectiveQty >= safeTotalQty;
      await mutateInventory(removeAll ? {
        userId,
        action: 'remove',
        inventoryId: stableId,
        retryKey: retryKeyRef.current,
      } : {
        userId,
        action: 'setQuantity',
        inventoryId: stableId,
        quantity: safeTotalQty - effectiveQty,
        retryKey: retryKeyRef.current,
      });
      retryKeyRef.current = null;
      if (typeof onClose === 'function') onClose(true);
    } catch (error) {
      console.error('Failed deleting varie units', error);
      if (isDefinitiveUserDataCommandError(error)) retryKeyRef.current = null;
      alert(error?.message || 'Errore nella cancellazione delle unita Varie');
      if (typeof onClose === 'function') onClose(false);
    } finally {
      setBusy(false);
    }
  };

  return ReactDOM.createPortal((
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-xl text-white mb-2">Rimuovi Unita Varie</h2>
        <p className="text-gray-300 mb-2">Giocatore: <span className="font-semibold">{userId}</span></p>
        <p className="text-gray-300 mb-4">Oggetto: <span className="font-semibold">{displayName}</span> (Qty totale: {safeTotalQty})</p>
        <label className="block text-sm text-gray-300 mb-1">Numero di unita da rimuovere</label>
        <div className="flex items-center mb-4 gap-3">
          <div className="flex items-center border border-gray-600 rounded overflow-hidden">
            <button type="button" className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-40" disabled={useAll || qtyToDelete <= 1} onClick={() => { retryKeyRef.current = null; setQtyToDelete((value) => Math.max(1, value - 1)); }}>-</button>
            <input type="number" min={1} max={safeTotalQty} value={useAll ? safeTotalQty : qtyToDelete} disabled={useAll} onChange={(event) => { retryKeyRef.current = null; const value = Number(event.target.value); if (!Number.isNaN(value)) setQtyToDelete(Math.min(safeTotalQty, Math.max(1, value))); }} className="w-16 text-center bg-gray-800 text-white px-2 py-1 focus:outline-none" />
            <button type="button" className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-40" disabled={useAll || qtyToDelete >= safeTotalQty} onClick={() => { retryKeyRef.current = null; setQtyToDelete((value) => Math.min(safeTotalQty, value + 1)); }}>+</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300 select-none"><input type="checkbox" className="h-4 w-4" checked={useAll} onChange={(event) => { retryKeyRef.current = null; setUseAll(event.target.checked); }} />Tutti ({safeTotalQty})</label>
        </div>
        <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4"><p className="text-white">Per confermare digita <span className="font-mono font-bold">DELETE</span>.</p></div>
        <input type="text" value={confirmInput} onChange={(event) => setConfirmInput(event.target.value)} placeholder="Scrivi DELETE" className="w-full px-3 py-2 mb-4 rounded bg-gray-700 text-white focus:outline-none" />
        <div className="flex justify-end space-x-2">
          <button onClick={() => !busy && onClose(false)} disabled={busy} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50">Annulla</button>
          <button onClick={handleDelete} disabled={busy || confirmInput !== 'DELETE'} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center">
            {busy && <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/></svg>}
            Rimuovi
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
