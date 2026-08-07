import React, { useRef, useState } from "react";
import useObjectUrl from "../../../../common/useObjectUrl";
import useTask07MediaOperationOwner from "../../../../../data/media/useTask07MediaOperationOwner";
import { tryPersistTask07VarieMedia } from "../../../../../data/media/privateInventoryMediaWriter";
import {
  createUserOperationId,
  isDefinitiveUserDataCommandError,
  mutateInventory,
} from "../../../../../data/userData/userDataCommands";
import {
  describeTask07ConsumerOutcome,
  task07ConsumerNeedsAttention,
} from "../../../../../data/media/mediaConsumerAdapter";

const AddVarieItemOverlay = ({ userId, onClose }) => {
  const task07MediaOperationOwner = useTask07MediaOperationOwner();
  const retryKeyRef = useRef(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [imageFile, setImageFile] = useState(null);
  const previewUrl = useObjectUrl(imageFile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const closeAll = (ok) => {
    if (typeof onClose === "function") onClose(ok);
  };

  const addItem = async () => {
    if (!userId) return;
    const cleanName = (name || "").trim();
    if (!cleanName) return;
    const qtyNum = Math.max(1, Math.min(9999, Math.abs(parseInt(quantity, 10) || 1)));
    const snapshot = {
      name: cleanName,
      description: (description || "").trim(),
      type: "varie",
      item_type: "varie",
    };
    setBusy(true);
    setError(null);
    try {
      if (imageFile) {
        const task07Result = await task07MediaOperationOwner.run((signal) => (
          tryPersistTask07VarieMedia({
            userId,
            snapshot,
            quantity: qtyNum,
            file: imageFile,
            signal,
          })
        ));
        if (!task07Result) {
          const mediaError = new Error('Canonical media is unavailable. Nothing was saved.');
          mediaError.code = 'task07-canonical-required';
          throw mediaError;
        }
        if (task07ConsumerNeedsAttention(task07Result.outcome)) {
          alert(describeTask07ConsumerOutcome(task07Result.outcome, "Inventory image"));
        }
      } else {
        retryKeyRef.current ||= `${userId}:${createUserOperationId('dm-varie-create')}`;
        await mutateInventory({
          userId,
          action: 'createVarie',
          quantity: qtyNum,
          snapshot,
          retryKey: retryKeyRef.current,
        });
        retryKeyRef.current = null;
      }
      closeAll(true);
    } catch (caught) {
      console.error("Failed to add Varie item", caught);
      if (isDefinitiveUserDataCommandError(caught)) retryKeyRef.current = null;
      setError(caught?.message || 'Impossibile aggiungere l\'oggetto.');
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
          <div><label className="block text-xs text-slate-300 mb-1">Nome</label><input className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200" value={name} onChange={(event) => { retryKeyRef.current = null; setName(event.target.value); }} /></div>
          <div><label className="block text-xs text-slate-300 mb-1">Descrizione</label><textarea rows={3} className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200" value={description} onChange={(event) => { retryKeyRef.current = null; setDescription(event.target.value); }} /></div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Immagine</label>
            <div className="flex items-center gap-3">
              <input type="file" accept="image/*" className="text-xs text-slate-300" onChange={(event) => { retryKeyRef.current = null; setImageFile(event.target.files?.[0] || null); }} />
              {previewUrl && <div className="flex items-center gap-2"><div className="h-12 w-12 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50"><img src={previewUrl} alt="preview" className="h-full w-full object-cover" /></div><button type="button" onClick={() => setImageFile(null)} className="text-[11px] text-slate-300 border border-slate-600/60 rounded px-2 py-1 hover:bg-slate-700/40" disabled={busy}>Rimuovi</button></div>}
            </div>
          </div>
          <div><label className="block text-xs text-slate-300 mb-1">Quantita</label><input type="number" min="1" max="9999" className="w-28 rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200" value={quantity} onChange={(event) => { retryKeyRef.current = null; setQuantity(event.target.value); }} /></div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="inline-flex items-center justify-center rounded-md border border-slate-600/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/40" onClick={() => !busy && closeAll(false)} disabled={busy}>Annulla</button>
          <button className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white disabled:opacity-60" onClick={addItem} disabled={busy || !name.trim()}>Aggiungi</button>
        </div>
      </div>
    </div>
  );
};

export default AddVarieItemOverlay;
