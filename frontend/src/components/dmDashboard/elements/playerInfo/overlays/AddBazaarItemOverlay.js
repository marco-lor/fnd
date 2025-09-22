import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db } from '../../../../firebaseConfig';

/*
 Overlay allowing the DM to grant (add) an existing bazaar item to a user's inventory
 WITHOUT subtracting gold. Mirrors the acquisition logic of acquireItem (bazaar)
 but skips price checks and gold deduction.

 Contract:
  props: {
    userId: string,
    bazaarItems: array of item documents OR null (if not provided we fetch from 'items' collection?)
    onClose: function(ok:boolean)
  }

 Implementation details:
  - We expect the parent DM dashboard already has `itemsDocs` / catalog of items.
    We'll derive a flat list of items with id + General.Nome + General.prezzo
  - Quantity: number >=1. We will push N distinct snapshot entries (non stacking) to mirror `acquireItem`.
  - Each snapshot gets _instance metadata with source 'dm-grant'.
*/

const AddBazaarItemOverlay = ({ userId, itemsDocs, onClose }) => {
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const closeAll = (ok) => {
    if (busy) return;
    if (typeof onClose === 'function') onClose(ok);
  };

  const allItems = useMemo(() => {
    if (!itemsDocs || typeof itemsDocs !== 'object') return [];
    return Object.keys(itemsDocs).map((id) => ({ id, ...itemsDocs[id] }))
      .filter(it => it && (it.General?.Nome || it.name))
      .sort((a,b) => (a.General?.Nome || a.name || '').localeCompare(b.General?.Nome || b.name || ''));
  }, [itemsDocs]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return allItems;
    return allItems.filter(it => (it.General?.Nome || it.name || '').toLowerCase().includes(f));
  }, [allItems, filter]);

  const selectedItem = useMemo(() => allItems.find(i => i.id === selectedId) || null, [allItems, selectedId]);

  const grantItems = async () => {
    if (!userId || !selectedItem) return;
    const qtyNum = Math.max(1, parseInt(quantity, 10) || 1);
    setBusy(true); setError(null); setSuccessMsg(null);
    const userRef = doc(db, 'users', userId);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists()) throw new Error('User non trovato');
        const data = snap.data() || {};
        const inventory = Array.isArray(data.inventory) ? [...data.inventory] : [];
        for (let i = 0; i < qtyNum; i += 1) {
          const instanceId = `inv_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
          const snapshot = JSON.parse(JSON.stringify(selectedItem));
          snapshot.id = selectedItem.id; // ensure id
          snapshot._instance = { instanceId, acquiredAt: new Date(), pricePaid: 0, source: 'dm-grant' };
          inventory.push(snapshot);
        }
        tx.update(userRef, { inventory });
      });
      setSuccessMsg('Oggetto aggiunto.');
      // allow a brief user feedback then close
      setTimeout(() => closeAll(true), 600);
    } catch (e) {
      console.error('Grant item failed', e);
      setError(e.message || 'Errore sconosciuto');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && closeAll(false)} />
      <div className="relative z-10 w-[50rem] max-w-[95vw] max-h-[90vh] overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/95 shadow-2xl flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-slate-700/40 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Aggiungi Oggetto Bazaar</h3>
          <button onClick={() => closeAll(false)} className="text-slate-400 hover:text-slate-200 text-xs" disabled={busy}>Chiudi</button>
        </div>
        <div className="p-4 flex flex-col gap-4 overflow-auto">
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[14rem]">
              <label className="block text-xs text-slate-300 mb-1">Filtro</label>
              <input value={filter} onChange={(e)=>setFilter(e.target.value)} className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 text-sm" placeholder="Cerca nome..." />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Quantità</label>
              <input type="number" min="1" value={quantity} onChange={(e)=>setQuantity(e.target.value)} className="w-24 rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 text-sm" />
            </div>
            <div className="self-start mt-4">
              <button disabled={!selectedItem || busy} onClick={grantItems} className="inline-flex items-center gap-2 rounded-md bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs font-medium px-4 py-2 disabled:opacity-50">
                {busy ? '...' : 'Conferma'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-slate-700/50 rounded-md overflow-hidden">
              <div className="max-h-[50vh] overflow-auto divide-y divide-slate-700/40">
                {filtered.map(it => {
                  const nome = it.General?.Nome || it.name || it.id;
                  const prezzo = it.General?.prezzo ?? it.General?.Prezzo ?? 0;
                  const sel = selectedId === it.id;
                  return (
                    <button key={it.id} onClick={()=>setSelectedId(it.id)} className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-700/40 ${sel ? 'bg-slate-700/60' : ''}`}>
                      <span className="truncate pr-2 text-slate-200">{nome}</span>
                      <span className="text-[10px] text-amber-300">{prezzo}g</span>
                    </button>
                  );
                })}
                {!filtered.length && (
                  <div className="px-3 py-4 text-xs text-slate-400">Nessun oggetto</div>
                )}
              </div>
            </div>
            <div className="border border-slate-700/50 rounded-md p-3 text-xs text-slate-200 bg-slate-800/40 min-h-[12rem]">
              {selectedItem ? (
                <div className="space-y-2">
                  <div className="font-semibold text-slate-100 text-sm">{selectedItem.General?.Nome || selectedItem.name || selectedItem.id}</div>
                  {selectedItem.General?.Tipo && <div><span className="text-slate-400">Tipo:</span> {selectedItem.General.Tipo}</div>}
                  {(selectedItem.General?.Descrizione || selectedItem.description) && (
                    <div className="whitespace-pre-wrap leading-snug text-slate-300">
                      {selectedItem.General?.Descrizione || selectedItem.description}
                    </div>
                  )}
                  <div className="text-amber-300">Prezzo listino: {selectedItem.General?.prezzo ?? selectedItem.General?.Prezzo ?? 0} gold</div>
                  <div className="text-[11px] text-slate-400">Verrà aggiunto senza costo (source: dm-grant)</div>
                </div>
              ) : <div className="text-slate-400">Seleziona un oggetto a sinistra.</div>}
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          {successMsg && <div className="text-xs text-emerald-400">{successMsg}</div>}
        </div>
      </div>
    </div>
  );
};

export default AddBazaarItemOverlay;
