import React from "react";

export const Chip = ({ children, onRemove, muted }) => (
    <span
        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-xl border text-xs mr-1 mb-1 ${
            muted
                ? "bg-slate-800/60 border-slate-700/60 text-slate-200"
                : "bg-indigo-900/30 border-indigo-700/60 text-indigo-200"
        }`}
    >
        {children}
        {onRemove && (
            <button
                onClick={onRemove}
                aria-label="Remove"
                title="Remove"
                className="ml-1 text-slate-300 hover:text-white"
            >
                ×
            </button>
        )}
    </span>
);

export const Section = ({ title, children, actions }) => (
    <section className="group relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-lg font-semibold text-slate-100">{title}</h2>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">{actions}</div>
        </div>
        <div className="mt-3 text-slate-200">{children}</div>
    </section>
);

export const TextInput = ({ label, value, onChange, placeholder }) => (
    <label className="block mb-3">
        <div className="text-xs text-slate-300 mb-1.5">{label}</div>
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        />
    </label>
);

export const TextArea = ({ label, value, onChange, placeholder, rows = 3 }) => (
    <label className="block mb-3">
        <div className="text-xs text-slate-300 mb-1.5">{label}</div>
        <textarea
            rows={rows}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y"
        />
    </label>
);

export const Button = ({ children, onClick, kind = "primary", disabled, title, size = "md" }) => {
    const sizeCls =
        size === "lg"
            ? "px-4 py-2.5 rounded-2xl text-sm"
            : size === "sm"
            ? "px-2.5 py-1.5 rounded-lg text-xs"
            : "px-3 py-2 rounded-xl text-sm";
    const base = `${sizeCls} transition focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed`;
    const variants = {
        primary:
            "group relative overflow-hidden bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow hover:shadow-indigo-900/30 focus:ring-2 focus:ring-indigo-400/60",
        secondary:
            "bg-slate-800/80 text-slate-100 border border-slate-600/60 hover:bg-slate-800/60",
        danger:
            "bg-red-900/40 text-red-200 border border-red-800/60 hover:bg-red-900/60",
    };
    return (
        <button onClick={onClick} disabled={disabled} title={title} className={`${base} ${variants[kind]}`}>
            <span className="relative z-10">{children}</span>
            {kind === "primary" && (
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.2),transparent_70%)]" />
            )}
        </button>
    );
};

export default {
    Chip,
    Section,
    TextInput,
    TextArea,
    Button,
};
