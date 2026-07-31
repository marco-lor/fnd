import React from 'react';

const FIELDS = ['hpTotal', 'manaTotal', 'initiative', 'level'];

const StatsEditor = ({ value = {}, onChange }) => {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {FIELDS.map((key) => (
        <label key={key} className="block">
          <div className="text-[11px] text-slate-300 mb-1">{key}</div>
          <input
            type="number"
            className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            value={Number(value?.[key] ?? 0)}
            onChange={(e) => set(key, Number(e.target.value || 0))}
          />
        </label>
      ))}
    </div>
  );
};

export default StatsEditor;
