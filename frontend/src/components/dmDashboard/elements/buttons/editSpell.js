// file: ./frontend/src/components/dmDashboard/elements/buttons/editSpell.js
import React, { useEffect, useState } from "react";
import { SpellOverlay } from "../../../common/SpellOverlay";
import { db, storage } from "../../../firebaseConfig";
import {
  doc, getDoc, updateDoc,
} from "firebase/firestore";
import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from "firebase/storage";

/**
 * EditSpellOverlay – API unchanged for callers.
 *
 * Props:
 *  • userId            owner of the spell (string)
 *  • spellName         original name (string)
 *  • spellData         original data (object)
 *  • onClose(bool)     true  ⇒ updated
 *                      false ⇒ cancelled / error
 */
export function EditSpellOverlay({ userId, spellName, spellData, onClose }) {
  const [schema,   setSchema]   = useState(null);
  const [userName, setUserName] = useState("");

  /* fetch schema + user once */
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

  /* ↑ when loaded, we can show overlay */
  const handleOverlayClose = async (result) => {
    if (!result) { onClose(false); return; }     // cancel

    try {
      const { spellData: newData, imageFile, videoFile } = result;
      // Normalize key casing for Azione
      if (!('Azione' in newData) && ('azione' in newData)) {
        newData.Azione = newData.azione;
        try { delete newData.azione; } catch {}
      }
      const newName  = newData.Nome.trim();
      const safeBase = `spell_${userId}_${newName.replace(/[^a-zA-Z0-9]/g,"_")}_${Date.now()}`;

      /* media =============================== */
      if (imageFile) {
        const imgRef = ref(storage, `spells/${safeBase}_image`);
        await uploadBytes(imgRef, imageFile);
        newData.image_url = await getDownloadURL(imgRef);
      } else if (spellData.image_url) {
        newData.image_url = spellData.image_url;
      }

      if (videoFile) {
        /* delete previous video if present */
        if (spellData.video_url) {
          try {
            const path = decodeURIComponent(
              spellData.video_url.split("/o/")[1].split("?")[0]
            );
            await deleteObject(ref(storage, path));
          } catch (e) { console.warn("Old video delete failed:", e); }
        }
        const vidRef = ref(storage, `spells/videos/${safeBase}_video`);
        await uploadBytes(vidRef, videoFile);
        newData.video_url = await getDownloadURL(vidRef);
      } else if (spellData.video_url) {
        newData.video_url = spellData.video_url;
      }

      /* write to Firestore ================== */
      const userRef = doc(db, "users", userId);
      const snap    = await getDoc(userRef);
      if (!snap.exists()) { alert("User not found"); onClose(false); return; }

      const spells = { ...(snap.data().spells || {}) };
      if (newName !== spellName) delete spells[spellName];
      spells[newName] = newData;

      if (JSON.stringify(spells).length > 900_000) {
        alert("Data too large – riduci immagine o video.");
        onClose(false); return;
      }

      await updateDoc(userRef, { spells });
      onClose(true);

    } catch (err) {
      console.error("Error updating spell:", err);
      alert("Errore durante l’aggiornamento – vedi console.");
      onClose(false);
    }
  };

  return (
    schema && (
      <SpellOverlay
        mode="edit"
        schema={schema}
        userName={userName}
        initialData={spellData}
        onClose={handleOverlayClose}
      />
    )
  );
}
