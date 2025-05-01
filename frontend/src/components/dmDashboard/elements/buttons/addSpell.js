// file: ./frontend/src/components/dmDashboard/elements/buttons/addSpell.js
import React, { useEffect, useState } from "react";
import { SpellOverlay } from "../overlays/SpellOverlay";
import { db, storage } from "../../../firebaseConfig";
import {
  doc, getDoc, updateDoc,
} from "firebase/firestore";
import {
  ref, uploadBytes, getDownloadURL,
} from "firebase/storage";

/* ------------------------------------------------------------------ */
/*  A. Pure button – API unchanged                                    */
/* ------------------------------------------------------------------ */
const sleek =
  "w-36 px-2 py-1 bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-700 hover:to-indigo-800 text-white text-xs font-medium rounded-md transition-all duration-150 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 shadow-sm";

export function AddSpellButton({ onClick }) {
  return (
    <button type="button" className={sleek} onClick={onClick}>
      <svg xmlns="http://www.w3.org/2000/svg"
           className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd"
              d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
              clipRule="evenodd"/>
      </svg>
      <span>Add Spell</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  B. Overlay wrapper (decoupled saving logic)                       */
/* ------------------------------------------------------------------ */
export function AddSpellOverlay({ userId, onClose, savePath = null }) {
  const [schema,   setSchema]   = useState(null);
  const [userName, setUserName] = useState("");

  /* fetch schema + user only once */
  useEffect(() => {
    (async () => {
      try {
        const schemaSnap = await getDoc(doc(db, "utils", "schema_spell"));
        if (schemaSnap.exists()) setSchema(schemaSnap.data());
        const userSnap   = await getDoc(doc(db, "users", userId));
        if (userSnap.exists())
          setUserName(userSnap.data().characterId || userSnap.data().email || "Unknown User");
      } catch (err) { console.error("Fetch error:", err); }
    })();
  }, [userId]);

  /* callback from SpellOverlay */
  const handleOverlayClose = async (result) => {
    if (!result) { onClose(false); return; }       // cancelled

    try {
      const { spellData, imageFile, videoFile } = result;
      const spellName = spellData.Nome.trim();
      const safeBase  = `spell_${(savePath?.id || userId)}_${spellName.replace(/[^a-zA-Z0-9]/g,"_")}_${Date.now()}`;

      /* ---------------------------------------------------- */
      /* 1. optional media upload                            */
      /* ---------------------------------------------------- */
      if (imageFile) {
        const imgRef  = ref(storage, `spells/${safeBase}_image`);
        await uploadBytes(imgRef, imageFile);
        spellData.image_url = await getDownloadURL(imgRef);
      }
      if (videoFile) {
        const vidRef  = ref(storage, `spells/videos/${safeBase}_video`);
        await uploadBytes(vidRef, videoFile);
        spellData.video_url = await getDownloadURL(vidRef);
      }

      /* ---------------------------------------------------- */
      /* 2. write (or merge) into Firestore                  */
      /* ---------------------------------------------------- */
      const [collection, docId] =
        savePath && savePath.type === "item"
          ? ["items", savePath.id]
          : ["users", userId];

      const docRef = doc(db, collection, docId);
      const snap   = await getDoc(docRef);
      if (!snap.exists()) {
        alert(collection === "items" ? "Item not found" : "User not found");
        onClose(false); return;
      }

      const prev   = snap.data().spells || {};
      const next   = { ...prev, [spellName]: spellData };

      if (JSON.stringify(next).length > 900_000) {
        alert("Data too large – usa un’immagine o video più piccoli.");
        onClose(false); return;
      }

      await updateDoc(docRef, { spells: next });
      onClose(true);

    } catch (err) {
      console.error("Error saving spell:", err);
      alert("Errore durante il salvataggio – vedi console.");
      onClose(false);
    }
  };

  /* render the generic overlay once everything is loaded */
  return (
    schema && (
      <SpellOverlay
        mode="add"
        schema={schema}
        userName={userName}
        onClose={handleOverlayClose}
      />
    )
  );
}
