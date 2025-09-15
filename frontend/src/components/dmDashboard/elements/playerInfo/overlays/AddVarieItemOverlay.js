import React, { useState } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import { db, storage } from "../../../../firebaseConfig";

// Overlay to add a new custom Varie item to a user's inventory (DM side)
// Mirrors the fields used by player Inventory add-varie overlay for consistency.
const AddVarieItemOverlay = ({ userId, onClose }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  const closeAll = (ok) => {
    if (typeof onClose === "function") onClose(ok);
  };

  const addItem = async () => {
    if (!userId) return;
    const cleanName = (name || "").trim();
    if (!cleanName) return;
    const qtyNum = Math.max(1, Math.abs(parseInt(quantity, 10) || 1));
    try {
      setBusy(true);
      const userDocRef = doc(db, "users", userId);
      const userSnap = await getDoc(userDocRef);
      if (!userSnap.exists()) throw new Error("User not found");
      const data = userSnap.data() || {};
      const inventory = Array.isArray(data.inventory) ? [...data.inventory] : [];
      let image_url = null;
      if (imageFile) {
        try {
          const safe = cleanName.replace(/[^a-zA-Z0-9]/g, "_");
          const fileName = `varie_${userId}_${safe}_${Date.now()}_${imageFile.name}`;
          const imgRef = storageRef(storage, `items/${fileName}`);
          await uploadBytes(imgRef, imageFile);
          image_url = await getDownloadURL(imgRef);
        } catch (e) {
          console.warn("Failed uploading varie image", e);
        }
      }
      const id = `varie_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      const entry = { id, name: cleanName, description: (description||"").trim(), type: "varie", qty: qtyNum };
      if (image_url) entry.image_url = image_url;
      inventory.push(entry);
      await updateDoc(userDocRef, { inventory });
      closeAll(true);
    } catch (err) {
      console.error("Failed to add Varie item", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && closeAll(false)} />
      <div className="relative z-10 w-[30rem] max-w-[92vw] rounded-xl border border-slate-700/60 bg-slate-900/90 p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-slate-200">Aggiungi Varie</h3>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs text-slate-300 mb-1">Nome</label>
            <input
              className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Descrizione</label>
            <textarea
              rows={3}
              className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Immagine</label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                className="text-xs text-slate-300"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                  setImageFile(f);
                  setPreviewUrl(f ? URL.createObjectURL(f) : null);
                }}
              />
              {previewUrl && (
                <div className="flex items-center gap-2">
                  <div className="h-12 w-12 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50">
                    <img src={previewUrl} alt="preview" className="h-full w-full object-cover" />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setImageFile(null); setPreviewUrl(null); }}
                    className="text-[11px] text-slate-300 border border-slate-600/60 rounded px-2 py-1 hover:bg-slate-700/40"
                    disabled={busy}
                  >Rimuovi</button>
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
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="inline-flex items-center justify-center rounded-md border border-slate-600/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/40"
            onClick={() => !busy && closeAll(false)}
            disabled={busy}
          >Annulla</button>
          <button
            className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white disabled:opacity-60"
            onClick={addItem}
            disabled={busy || !name.trim()}
          >Aggiungi</button>
        </div>
      </div>
    </div>
  );
};

export default AddVarieItemOverlay;