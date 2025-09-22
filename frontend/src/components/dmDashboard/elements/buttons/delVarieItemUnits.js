// frontend/src/components/dmDashboard/elements/buttons/delVarieItemUnits.js
// Overlay to delete a chosen number of units from a Varie aggregated inventory entry.
// Supports both repeated string entries and object entries with a qty property.
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { db } from '../../../firebaseConfig';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

/**
 * Props:
 *  - userId: string (Firestore user doc id)
 *  - varieItemId: string (id / name used in aggregated list)
 *  - displayName: string (shown to user)
 *  - totalQty: number (current aggregated quantity)
 *  - onClose: fn(success:boolean)
 */
export default function DelVarieItemUnitsOverlay({ userId, varieItemId, displayName, totalQty, onClose }) {
  const [userName, setUserName] = useState('');
  const [qtyToDelete, setQtyToDelete] = useState(1);
  const [useAll, setUseAll] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', userId));
        if (snap.exists()) {
          const d = snap.data();
          setUserName(d.characterId || d.email || userId);
        }
      } catch (e) {
        console.warn('Failed fetching user for delete varie overlay', e);
      }
    })();
  }, [userId]);

  const effectiveQty = useAll ? totalQty : qtyToDelete;

  const handleDelete = async () => {
    if (!userId || !varieItemId || qtyToDelete < 1) return;
    setBusy(true);
    try {
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      if (!snap.exists()) throw new Error('User not found');
      const data = snap.data() || {};
      const inventory = Array.isArray(data.inventory) ? [...data.inventory] : [];

      // Strategy: iterate inventory, collecting indices of matching varie entries.
      // A matching entry is either a string === varieItemId OR an object whose id|name|General.Nome === varieItemId with type varie.
      const matchPredicate = (it) => {
        if (!it) return false;
        if (typeof it === 'string') return it === varieItemId; // these are assumed Varie strings (aggregated previously)
        const id = it.id || it.name || it?.General?.Nome;
        const type = (it.type || '').toLowerCase();
        return id === varieItemId && type === 'varie';
      };

      // First pass: locate object entries with qty property representing multiple units.
      // If such an entry matches and holds enough qty, just decrement.
  let remainingToDelete = effectiveQty;
      for (let i = 0; i < inventory.length && remainingToDelete > 0; i += 1) {
        const entry = inventory[i];
        if (typeof entry === 'object' && !Array.isArray(entry) && entry?.qty && matchPredicate(entry)) {
          const currentQty = Number(entry.qty) || 1;
            if (currentQty > remainingToDelete) {
              entry.qty = currentQty - remainingToDelete;
              remainingToDelete = 0;
            } else if (currentQty === remainingToDelete) {
              // remove entire entry
              inventory.splice(i, 1);
              remainingToDelete = 0;
              break;
            } else { // currentQty < remainingToDelete
              // remove entry and continue
              inventory.splice(i, 1);
              remainingToDelete -= currentQty;
              i -= 1; // adjust index due to splice
            }
        }
      }

      // Second pass: remove repeated string entries until remainingToDelete exhausted
      if (remainingToDelete > 0) {
        for (let i = 0; i < inventory.length && remainingToDelete > 0; i += 1) {
          const entry = inventory[i];
          if (typeof entry === 'string' && entry === varieItemId) {
            inventory.splice(i, 1);
            remainingToDelete -= 1;
            i -= 1; // adjust
          }
        }
      }

      // Final pass: handle object entries without qty property (each counts as 1)
      if (remainingToDelete > 0) {
        for (let i = 0; i < inventory.length && remainingToDelete > 0; i += 1) {
          const entry = inventory[i];
          if (typeof entry === 'object' && !Array.isArray(entry) && !entry?.qty && matchPredicate(entry)) {
            inventory.splice(i, 1);
            remainingToDelete -= 1;
            i -= 1;
          }
        }
      }

      await updateDoc(userRef, { inventory });
      if (typeof onClose === 'function') onClose(true);
    } catch (err) {
      console.error('Failed deleting varie units', err);
      alert('Errore nella cancellazione delle unità Varie');
      if (typeof onClose === 'function') onClose(false);
    } finally {
      setBusy(false);
    }
  };

  const overlay = (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-xl text-white mb-2">Rimuovi Unità Varie</h2>
        <p className="text-gray-300 mb-2">Giocatore: <span className="font-semibold">{userName}</span></p>
        <p className="text-gray-300 mb-4">Oggetto: <span className="font-semibold">{displayName}</span> (Qty totale: {totalQty})</p>
        <label className="block text-sm text-gray-300 mb-1">Numero di unità da rimuovere</label>
        <div className="flex items-center mb-4 gap-3">
          <div className="flex items-center border border-gray-600 rounded overflow-hidden">
            <button
              type="button"
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-40"
              disabled={useAll || qtyToDelete <= 1}
              onClick={() => setQtyToDelete(q => Math.max(1, q - 1))}
            >-</button>
            <input
              type="number"
              min={1}
              max={totalQty}
              value={useAll ? totalQty : qtyToDelete}
              disabled={useAll}
              onChange={e => {
                const val = Number(e.target.value);
                if (!Number.isNaN(val)) setQtyToDelete(Math.min(totalQty, Math.max(1, val)));
              }}
              className="w-16 text-center bg-gray-800 text-white px-2 py-1 focus:outline-none"
            />
            <button
              type="button"
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-40"
              disabled={useAll || qtyToDelete >= totalQty}
              onClick={() => setQtyToDelete(q => Math.min(totalQty, q + 1))}
            >+</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={useAll}
              onChange={e => setUseAll(e.target.checked)}
            />
            Tutti ({totalQty})
          </label>
        </div>
        <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4">
          <p className="text-white">Per confermare digita <span className="font-mono font-bold">DELETE</span>.</p>
        </div>
        <input
          type="text"
          value={confirmInput}
          onChange={e => setConfirmInput(e.target.value)}
          placeholder="Scrivi DELETE"
          className="w-full px-3 py-2 mb-4 rounded bg-gray-700 text-white focus:outline-none"
        />
        <div className="flex justify-end space-x-2">
          <button
            onClick={() => !busy && onClose(false)}
            disabled={busy}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
          >Annulla</button>
          <button
            onClick={handleDelete}
            disabled={busy || confirmInput !== 'DELETE'}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center"
          >
            {busy && (
              <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/></svg>
            )}
            Rimuovi
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}
