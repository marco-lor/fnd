// frontend/src/components/dmDashboard/elements/buttons/delInventoryItem.js
// Overlay to delete a specific inventory item from a user (DM only)
// Supports both catalog-referenced string entries and embedded object entries (including Varie custom objects)
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { db } from '../../../firebaseConfig';
import { doc, getDoc, updateDoc } from '../../../../performance/firestore';
import { deleteLegacyStoragePath } from '../../../common/legacyMediaStorage';

/**
 * Props:
 *  - userId: Firestore user doc id
 *  - inventoryItemId: identifier used in PlayerInfoInventoryRow (string id or deriveInventoryId result)
 *  - userInventoryIndex: if provided, indicates the index in inventory array for direct removal (used for non-varie duplicates)
 *  - itemData: the resolved item object (if an object entry)
 *  - displayName: string shown to user for confirmation
 *  - onClose: function(success:boolean) called when closed
 */
export function DelInventoryItemOverlay({ userId, inventoryItemId, userInventoryIndex = null, itemData = null, displayName, onClose }) {
  const [userName, setUserName] = useState('');
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
        console.warn('Failed fetching user for delete overlay', e);
      }
    })();
  }, [userId]);

  const handleDelete = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      if (!snap.exists()) throw new Error('User not found');
      const data = snap.data() || {};
      const inventory = Array.isArray(data.inventory) ? [...data.inventory] : [];
      const cleanupPaths = [];

      // Determine removal strategy
      if (userInventoryIndex !== null && userInventoryIndex >= 0 && userInventoryIndex < inventory.length) {
        // Direct index removal (for specific instance)
        const entry = inventory[userInventoryIndex];
        // If entry had image/video (custom object), consider cleanup
        if (entry && typeof entry === 'object') {
          cleanupPaths.push(...collectAssetPaths(entry));
        }
        inventory.splice(userInventoryIndex, 1);
      } else {
        // Fallback: find by id or name match (for Varie or custom objects with unique id)
        const idx = inventory.findIndex(it => {
          if (!it) return false;
            if (typeof it === 'string') return it === inventoryItemId;
            const id = it.id || it.name || it?.General?.Nome;
            return id === inventoryItemId;
        });
        if (idx !== -1) {
          const entry = inventory[idx];
          if (entry && typeof entry === 'object') {
            cleanupPaths.push(...collectAssetPaths(entry));
          }
          inventory.splice(idx, 1);
        }
      }

      await updateDoc(userRef, { inventory });
      await Promise.allSettled(cleanupPaths.map(deleteLegacyStoragePath));
      if (typeof onClose === 'function') onClose(true);
    } catch (err) {
      console.error('Failed deleting inventory item', err);
      alert('Errore nella cancellazione oggetto inventario');
      if (typeof onClose === 'function') onClose(false);
    } finally {
      setBusy(false);
    }
  };

  const collectAssetPaths = (entry) => {
    // Delete any uploaded assets associated with this inventory entry.
    // Supports:
    //  - Varie custom objects (image_url / video_url)
    //  - Standard items that have user specific custom images (user_image_custom && user_image_url)
    //  - Any entry with generic image_url / video_url fields
    const paths = [];
    try {
      if (entry?.image_url) paths.push(entry.image_url);
      if (entry?.video_url) paths.push(entry.video_url);
      if (entry?.user_image_custom && entry?.user_image_url) paths.push(entry.user_image_url);

      return paths
        .filter((url) => url && typeof url === 'string')
        .map((url) => decodeURIComponent(url.split('/o/')[1].split('?')[0]));
    } catch (e) {
      console.warn('Asset cleanup failed', e);
      return [];
    }
  };

  const overlay = (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-xl text-white mb-2">Elimina Oggetto Inventario</h2>
        <p className="text-gray-300 mb-4">Giocatore: <span className="font-semibold">{userName}</span></p>
        <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4">
          <p className="text-white">Per eliminare <span className="font-semibold">{displayName}</span>, digita <span className="font-mono font-bold">DELETE</span> qui sotto:</p>
        </div>
        <input
          type="text"
          value={confirmInput}
          onChange={e => setConfirmInput(e.target.value)}
          placeholder="Scrivi DELETE per confermare"
          className="w-full px-3 py-2 mb-4 rounded bg-gray-700 text-white focus:outline-none"
        />
        <div className="flex justify-end space-x-2">
          <button
            onClick={() => !busy && onClose(false)}
            disabled={busy}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            onClick={handleDelete}
            disabled={busy || confirmInput !== 'DELETE'}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center"
          >
            {busy && (
              <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/></svg>
            )}
            Elimina
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

export default DelInventoryItemOverlay;
