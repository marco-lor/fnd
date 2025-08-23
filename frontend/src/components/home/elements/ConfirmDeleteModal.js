import React, { useState } from 'react';

const ConfirmDeleteModal = ({ itemName, onConfirm, onCancel, title = 'Conferma eliminazione', enableDeleteAll = false, onConfirmAll }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const required = all ? 'DELETEALL' : 'DELETE';
  const ok = text === required;

  const handleConfirm = async () => {
    if (!ok || !onConfirm) return;
    try {
      setBusy(true);
      if (all && enableDeleteAll && typeof onConfirmAll === 'function') {
        await onConfirmAll();
      } else {
        await onConfirm();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/95 shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-700/60">
          <div className="text-base font-semibold text-slate-100">{title}</div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-slate-300">
            {enableDeleteAll ? (
              <>
                {all ? (
                  <>Per rimuovere tutte le unità{itemName ? ` di "${itemName}"` : ''}, scrivi <span className="font-mono text-rose-300">DELETEALL</span> nel campo qui sotto.</>
                ) : (
                  <>Per rimuovere definitivamente 1 unità{itemName ? ` di "${itemName}"` : ''} dall'inventario, scrivi <span className="font-mono text-rose-300">DELETE</span> nel campo qui sotto.</>
                )}
              </>
            ) : (
              <>Per rimuovere definitivamente 1 unità{itemName ? ` di "${itemName}"` : ''} dall'inventario, scrivi <span className="font-mono text-rose-300">DELETE</span> nel campo qui sotto.</>
            )}
          </p>
          {enableDeleteAll && (
            <label className="flex items-center gap-2 text-[13px] text-slate-300">
              <input type="checkbox" className="h-4 w-4" checked={all} onChange={(e) => { setAll(e.target.checked); setText(''); }} disabled={busy} />
              Elimina tutte le unità di questo oggetto
            </label>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={enableDeleteAll ? (all ? 'Scrivi DELETEALL' : 'Scrivi DELETE') : 'Scrivi DELETE'}
            className="w-full px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-600/60 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-400"
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              className="rounded-lg border border-slate-600/60 px-3 py-2 text-sm text-slate-300 hover:border-slate-400/60"
              onClick={onCancel}
              disabled={busy}
            >
              Annulla
            </button>
            <button
              className={`rounded-lg border px-3 py-2 text-sm ${ok ? 'border-red-400/60 text-red-200 hover:bg-red-500/10' : 'border-slate-700/60 text-slate-500 cursor-not-allowed'} ${busy ? 'opacity-60' : ''}`}
              onClick={handleConfirm}
              disabled={!ok || busy}
            >
              {all ? 'Conferma (Tutte)' : 'Conferma'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
