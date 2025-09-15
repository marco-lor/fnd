import React, { useRef, useState } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

import { db, storage } from "../../../../firebaseConfig";

const EditVarieItemOverlay = ({ userId, initialData, inventoryItemId, onClose }) => {
  const [name, setName] = useState(initialData?.name || initialData?.General?.Nome || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [quantity, setQuantity] = useState(
    typeof initialData?.qty === "number" ? String(initialData.qty) : "1",
  );
  const [busy, setBusy] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [currentImageUrl, setCurrentImageUrl] = useState(initialData?.image_url || null);
  const originalUrlRef = useRef(initialData?.image_url || null);
  const [removeExisting, setRemoveExisting] = useState(false);

  const closeAll = (ok) => {
    if (typeof onClose === "function") onClose(ok);
  };

  const save = async () => {
    if (!userId) return;
    const cleanName = (name || "").trim();
    const qtyNumber = Math.max(1, Math.abs(parseInt(quantity, 10) || 1));
    if (!cleanName) return;

    try {
      setBusy(true);
      const userDocRef = doc(db, "users", userId);
      const userDocSnap = await getDoc(userDocRef);
      if (!userDocSnap.exists()) throw new Error("User not found");

      const data = userDocSnap.data() || {};
      const inventory = Array.isArray(data.inventory) ? [...data.inventory] : [];
      let newImageUrl = currentImageUrl;

      if (imageFile) {
        const safe = cleanName.replace(/[^a-zA-Z0-9]/g, "_");
        const fileName = `varie_${userId}_${safe}_${Date.now()}_${imageFile.name}`;
        const imageRef = storageRef(storage, `items/${fileName}`);
        await uploadBytes(imageRef, imageFile);
        newImageUrl = await getDownloadURL(imageRef);
        if (originalUrlRef.current && originalUrlRef.current !== newImageUrl) {
          setRemoveExisting(true);
        }
      }

      let updated = false;
      for (let i = 0; i < inventory.length; i += 1) {
        const entry = inventory[i];
        const entryId = entry && (entry.id || entry.name || entry?.General?.Nome)
          ? (entry.id || entry.name || entry?.General?.Nome)
          : `item-${i}`;
        if (entryId === inventoryItemId) {
          const nextEntry = {
            ...entry,
            id: inventoryItemId,
            type: "varie",
            name: cleanName,
            description: (description || "").trim(),
            qty: qtyNumber,
          };
          if (newImageUrl) {
            nextEntry.image_url = newImageUrl;
          } else {
            delete nextEntry.image_url;
          }
          inventory[i] = nextEntry;
          updated = true;
          break;
        }
      }

      if (!updated) throw new Error("Item not found");

      await updateDoc(userDocRef, { inventory });

      if (removeExisting && originalUrlRef.current && originalUrlRef.current !== newImageUrl) {
        try {
          const path = decodeURIComponent(originalUrlRef.current.split("/o/")[1].split("?")[0]);
          await deleteObject(storageRef(storage, path));
        } catch (error) {
          console.warn("Failed to delete previous image", error);
        }
      }

      closeAll(true);
    } catch (error) {
      console.error("Failed to save Varie item", error);
    } finally {
      setBusy(false);
    }
  };

  const removeImage = () => {
    if (!currentImageUrl) return;
    setRemoveExisting(true);
    setCurrentImageUrl(null);
    setImageFile(null);
    setPreviewUrl(null);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && closeAll(false)} />
      <div className="relative z-10 w-[30rem] max-w-[92vw] rounded-xl border border-slate-700/60 bg-slate-900/90 p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-slate-200">Modifica Varie</h3>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs text-slate-300 mb-1">Nome</label>
            <input
              className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Descrizione</label>
            <textarea
              rows={3}
              className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Immagine</label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                className="text-xs text-slate-300"
                onChange={(event) => {
                  const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
                  setImageFile(file);
                  setPreviewUrl(file ? URL.createObjectURL(file) : null);
                }}
              />
              {(previewUrl || currentImageUrl) && (
                <div className="flex items-center gap-2">
                  <div className="h-12 w-12 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50">
                    <img src={previewUrl || currentImageUrl} alt="preview" className="h-full w-full object-cover" />
                  </div>
                  {currentImageUrl && (
                    <button
                      type="button"
                      onClick={removeImage}
                      className="text-[11px] text-slate-300 border border-slate-600/60 rounded px-2 py-1 hover:bg-slate-700/40"
                      disabled={busy}
                    >
                      Rimuovi immagine
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Quantita</label>
            <input
              type="number"
              min="1"
              className="w-28 rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="inline-flex items-center justify-center rounded-md border border-slate-600/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/40"
            onClick={() => !busy && closeAll(false)}
            disabled={busy}
          >
            Annulla
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white disabled:opacity-60"
            onClick={save}
            disabled={busy || !name.trim()}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditVarieItemOverlay;
