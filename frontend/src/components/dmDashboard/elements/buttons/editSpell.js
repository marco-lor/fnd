// file: ./frontend/src/components/dmDashboard/elements/buttons/editSpell.js
import React, { useEffect, useState } from "react";
import { SpellOverlay } from "../../../common/SpellOverlay";
import { db } from "../../../firebaseConfig";
import { saveSpellForUser } from "../../../common/userOwnedMedia";
import {
  doc, getDoc,
} from "firebase/firestore";

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
      const removeImage = Boolean(spellData.image_url) && !imageFile && !newData.image_url;
      const removeVideo = Boolean(spellData.video_url) && !videoFile && !newData.video_url;
      // Normalize key casing for Azione
      if (!('Azione' in newData) && ('azione' in newData)) {
        newData.Azione = newData.azione;
        try { delete newData.azione; } catch {}
      }

      await saveSpellForUser({
        userId,
        originalName: spellName,
        entryData: newData,
        imageFile,
        videoFile,
        removeImage,
        removeVideo,
      });
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
