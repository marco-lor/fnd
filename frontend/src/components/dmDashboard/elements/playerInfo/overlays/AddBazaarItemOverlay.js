import React, { useMemo, useRef, useState } from 'react';
import {
  createUserOperationId,
  isDefinitiveUserDataCommandError,
  mutateInventory,
} from '../../../../../data/userData/userDataCommands';

// DM-only grant of an existing catalog item. The catalog ID is only a source;
// Task 05 creates one or more distinct V2 inventory instances for the target.
const AddBazaarItemOverlay = ({ userId, itemsDocs, onClose }) => {
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const retryKeyRef = useRef(null);

  const closeAll = (ok) => {
    if (busy) return;
    if (typeof onClose === 'function') onClose(ok);
  };

  const allItems = useMemo(() => {
    if (!itemsDocs || typeof itemsDocs !== 'object') return [];
    return Object.keys(itemsDocs).map((id) => ({ id, ...itemsDocs[id] }))
      .filter((item) => item && (item.General?.Nome || item.name))
      .sort((a, b) => (
        a.General?.Nome || a.name || ''
      ).localeCompare(b.General?.Nome || b.name || ''));
  }, [itemsDocs]);

  const filtered = useMemo(() => {
    const value = filter.trim().toLowerCase();
    if (!value) return allItems;
    return allItems.filter((item) => (
      item.General?.Nome || item.name || ''
    ).toLowerCase().includes(value));
  }, [allItems, filter]);

  const selectedItem = useMemo(
    () => allItems.find((item) => item.id === selectedId) || null,
    [allItems, selectedId]
  );

  const grantItems = async () => {
    if (!userId || !selectedItem) return;
    const qtyNum = Math.max(1, Math.min(50, parseInt(quantity, 10) || 1));
    retryKeyRef.current ||= `${userId}:${selectedItem.id}:${createUserOperationId('dm-grant')}`;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await mutateInventory({
        userId,
        action: 'grant',
        itemId: selectedItem.id,
        quantity: qtyNum,
        retryKey: retryKeyRef.current,
      });
      retryKeyRef.current = null;
      setSuccessMsg('Oggetto aggiunto.');
      setTimeout(() => closeAll(true), 600);
    } catch (caught) {
      console.error('Grant item failed', caught);
      if (isDefinitiveUserDataCommandError(caught)) retryKeyRef.current = null;
      setError(caught.message || 'Errore sconosciuto');
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
              <input value={filter} onChange={(event) => setFilter(event.target.value)} className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 text-sm" placeholder="Cerca nome..." />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Quantita</label>
              <input type="number" min="1" max="50" value={quantity} onChange={(event) => { retryKeyRef.current = null; setQuantity(event.target.value); }} className="w-24 rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200 text-sm" />
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
                {filtered.map((item) => {
                  const nome = item.General?.Nome || item.name || item.id;
                  const prezzo = item.General?.prezzo ?? item.General?.Prezzo ?? 0;
                  const selected = selectedId === item.id;
                  return (
                    <button key={item.id} onClick={() => { retryKeyRef.current = null; setSelectedId(item.id); }} className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-700/40 ${selected ? 'bg-slate-700/60' : ''}`}>
                      <span className="truncate pr-2 text-slate-200">{nome}</span>
                      <span className="text-[10px] text-amber-300">{prezzo}g</span>
                    </button>
                  );
                })}
                {!filtered.length && <div className="px-3 py-4 text-xs text-slate-400">Nessun oggetto</div>}
              </div>
            </div>
            <div className="border border-slate-700/50 rounded-md p-3 text-xs text-slate-200 bg-slate-800/40 min-h-[12rem]">
              {selectedItem ? (
                <div className="space-y-2">
                  <div className="font-semibold text-slate-100 text-sm">{selectedItem.General?.Nome || selectedItem.name || selectedItem.id}</div>
                  {selectedItem.General?.Tipo && <div><span className="text-slate-400">Tipo:</span> {selectedItem.General.Tipo}</div>}
                  {(selectedItem.General?.Descrizione || selectedItem.description) && <div className="whitespace-pre-wrap leading-snug text-slate-300">{selectedItem.General?.Descrizione || selectedItem.description}</div>}
                  <div className="text-amber-300">Prezzo listino: {selectedItem.General?.prezzo ?? selectedItem.General?.Prezzo ?? 0} gold</div>
                  <div className="text-[11px] text-slate-400">Viene aggiunto senza costo come nuova istanza inventario.</div>
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
