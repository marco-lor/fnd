// frontend/src/components/dmDashboard/elements/buttons/delConoscenzaPersonale.js
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { db } from '../../../firebaseConfig';
import { doc, getDoc, updateDoc } from "firebase/firestore";

export function DelConoscenzaPersonaleOverlay({ userId, conoscenzaName, onClose }) {
  const [userName, setUserName] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "users", userId));
      if (snap.exists()) setUserName(snap.data().characterId || snap.data().email);
    })();
  }, [userId]);

  const handleDelete = async () => {
    setIsDeleting(true);
    const userRef = doc(db, "users", userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = { ...(snap.data().conoscenze || {}) };
      delete data[conoscenzaName];
      await updateDoc(userRef, { conoscenze: data });
      onClose(true);
    } else {
      alert("Utente non trovato");
      onClose(false);
    }
  };

  const overlay = (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-xl text-white mb-2">Elimina Conoscenza</h2>
        <p className="text-gray-300 mb-4">Giocatore: <span className="font-semibold">{userName}</span></p>
        <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4">
          <p className="text-white">Per eliminare <span className="font-semibold">{conoscenzaName}</span>, digita il nome esatto qui sotto:</p>
        </div>
        <input
          type="text"
          value={confirmInput}
          onChange={e => setConfirmInput(e.target.value)}
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
            disabled={isDeleting || confirmInput !== conoscenzaName}
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
