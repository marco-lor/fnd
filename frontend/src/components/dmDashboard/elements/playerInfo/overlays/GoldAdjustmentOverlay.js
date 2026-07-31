import React from "react";

const GoldAdjustmentOverlay = ({
  visible,
  direction,
  userLabel,
  value,
  busy,
  canConfirm,
  onClose,
  onChange,
  onConfirm,
}) => {
  if (!visible) return null;

  const actionLabel = direction > 0 ? "Aggiungi" : "Sottrai";
  const confirmClasses = direction > 0
    ? "bg-emerald-600/80 hover:bg-emerald-600"
    : "bg-rose-600/80 hover:bg-rose-600";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} />
      <div className="relative z-10 w-[18rem] max-w-[90vw] rounded-xl border border-amber-500/50 bg-slate-900/95 p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-amber-200">{actionLabel} gold</h3>
        <p className="mt-1 text-xs text-slate-300">{userLabel || "Giocatore"}</p>
        <div className="mt-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-amber-300/80">Importo</label>
          <input
            type="number"
            min="0"
            className="w-full rounded-md border border-amber-400/50 bg-slate-900/70 px-3 py-2 text-sm text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-60"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-md border border-slate-600/70 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/40 disabled:opacity-50"
            onClick={() => !busy && onClose()}
            disabled={busy}
          >
            Annulla
          </button>
          <button
            className={`rounded-md px-3 py-1.5 text-xs text-white disabled:opacity-60 ${confirmClasses}`}
            onClick={onConfirm}
            disabled={busy || !canConfirm}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GoldAdjustmentOverlay;
