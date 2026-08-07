// file: ./frontend/src/components/dmDashboard/elements/buttons/editSpell.js
import React, { useEffect, useState } from "react";
import { SpellOverlay } from "../../../common/SpellOverlay";
import { saveSpellForUser } from "../../../common/userOwnedMedia";
import { getSchema } from '../../../../data/configRepository';
import useTask07MediaOperationOwner from '../../../../data/media/useTask07MediaOperationOwner';

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
export function EditSpellOverlay({
  userId,
  userLabel,
  spellName,
  spellData,
  onClose,
}) {
  const task07MediaOperationOwner = useTask07MediaOperationOwner();
  const [schema,   setSchema]   = useState(null);

  /* fetch schema + user once */
  useEffect(() => {
    (async () => {
      try {
        const schemaData = await getSchema('schema_spell');
        if (schemaData) setSchema(schemaData);
      } catch (err) { console.error("Fetch error:", err); }
    })();
  }, []);

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

      await task07MediaOperationOwner.run((signal) => saveSpellForUser({
        userId,
        originalName: spellName,
        originalEntity: spellData,
        entryData: newData,
        imageFile,
        videoFile,
        removeImage,
        removeVideo,
        signal,
      }));
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
        userName={userLabel || 'Unknown User'}
        initialData={spellData}
        onClose={handleOverlayClose}
      />
    )
  );
}
