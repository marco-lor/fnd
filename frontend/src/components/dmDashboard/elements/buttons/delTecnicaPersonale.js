// frontend/src/components/dmDashboard/elements/buttons/delTecnicaPersonale.js
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { db, storage } from '../../../firebaseConfig';
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";

export function DelTecnicaPersonale({ userId, tecnicaName, tecnicaData, onClose }) {
  const [userName, setUserName] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "users", userId));
      if (snap.exists()) {
        const d = snap.data();
        setUserName(d.characterId || d.email);
      }
    })();
  }, [userId]);

  const handleDelete = async () => {
    setIsDeleting(true);
    if (tecnicaData.image_url) {
      try {
        const p = decodeURIComponent(tecnicaData.image_url.split('/o/')[1].split('?')[0]);
        await deleteObject(ref(storage, p));
      } catch {}
    }
    if (tecnicaData.video_url) {
      try {
        const p = decodeURIComponent(tecnicaData.video_url.split('/o/')[1].split('?')[0]);
        await deleteObject(ref(storage, p));
      } catch {}
    }
    const userRef = doc(db, "users", userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = { ...(snap.data().tecniche || {}) };
      delete data[tecnicaName];
      await updateDoc(userRef, { tecniche: data });
      onClose(true);
    } else {
      alert("Utente non trovato");
      onClose(false);
    }
  };

  const overlay = (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-xl text-white mb-2">Elimina Tecnica</h2>
        <p className="text-gray-300 mb-4">Giocatore: <span className="font-semibold">{userName}</span></p>
        <div className="bg-red-900 bg-opacity-25 border border-red-700 rounded p-4 mb-4">
          <p className="text-white">Per eliminare <span className="font-semibold">{tecnicaName}</span>, digita il nome esatto qui sotto:</p>
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
            disabled={isDeleting || confirmInput !== tecnicaName}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center"
          >
            {isDeleting
              ? <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"/></svg>
              : null
            }
            Elimina
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}
