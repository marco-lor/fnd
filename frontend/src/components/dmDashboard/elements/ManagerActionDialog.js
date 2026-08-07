import React from "react";

export const parseIntegerInput = (value) => {
  const normalized = String(value ?? "").trim();
  if (!/^[+-]?\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const ManagerActionDialog = ({
  visible,
  title,
  description,
  inputLabel,
  value,
  onChange,
  error,
  busy = false,
  confirmLabel = "Confirm",
  confirmTone = "indigo",
  onClose,
  onConfirm,
  children,
}) => {
  if (!visible) return null;

  const confirmClasses = confirmTone === "danger"
    ? "bg-rose-600 hover:bg-rose-500 focus:ring-rose-400"
    : "bg-indigo-600 hover:bg-indigo-500 focus:ring-indigo-400";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manager-action-dialog-title"
    >
      <div
        className="absolute inset-0 bg-black/70"
        onClick={() => !busy && onClose()}
        aria-hidden="true"
      />
      <form
        className="relative z-10 w-[24rem] max-w-full rounded-xl border border-slate-600/70 bg-slate-900 p-5 text-slate-100 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onConfirm();
        }}
      >
        <h3 id="manager-action-dialog-title" className="text-base font-semibold text-slate-50">
          {title}
        </h3>
        {description && <p className="mt-2 text-sm text-slate-300">{description}</p>}

        {inputLabel && (
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-300">
            {inputLabel}
            <input
              type="number"
              step="1"
              inputMode="numeric"
              aria-label={inputLabel}
              className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
        )}

        {children}
        {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            onClick={() => !busy && onClose()}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`rounded-md px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:ring-2 disabled:opacity-50 ${confirmClasses}`}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ManagerActionDialog;
