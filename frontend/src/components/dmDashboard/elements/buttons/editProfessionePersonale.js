import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { db } from '../../../firebaseConfig';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

export function EditProfessionePersonaleOverlay({ userId, professioneName, onClose }) {
  const [livello, setLivello] = useState('Base');
  const [userName, setUserName] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      // Fetch current livello and user name
      const userRef = doc(db, 'users', userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        setUserName(data.characterId || data.email || '');
        const current = data.professioni?.[professioneName]?.livello;
        if (current) setLivello(current);
      }
    };
    fetchData();
  }, [userId, professioneName]);

  const handleSave = async () => {
    const userRef = doc(db, 'users', userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      const updated = { ...(data.professioni || {}) };
      if (updated[professioneName]) {
        // update only livello
        updated[professioneName] = { ...updated[professioneName], livello };
      }
      await updateDoc(userRef, { professioni: updated });
      onClose(true);
    } else {
      alert('User not found');
      onClose(false);
    }
  };

  const overlay = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm">
        <h2 className="text-xl text-white mb-2">Modifica Livello Professione</h2>
        <p className="text-gray-300 mb-4">Giocatore: <span className="font-semibold">{userName}</span></p>
        <p className="text-white mb-2">Professione: <span className="font-semibold">{professioneName}</span></p>
        <div className="mb-4">
          <label className="block text-white mb-1">Livello</label>
          <select
            value={livello}
            onChange={(e) => setLivello(e.target.value)}
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
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}