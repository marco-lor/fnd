import React, { useMemo } from 'react';
import { deepClone, SectionTitle } from './utils';

export const ParamTableEditable = ({ groupName, group, onChange }) => {
  const keys = useMemo(() => Object.keys(group || {}).sort(), [group]);
  const setTot = (name, val) => {
    const next = deepClone(group);
    next[name] = { Tot: Number(val || 0) };
    onChange(next);
  };
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm text-left text-slate-300 min-w-[320px]">
        <thead className="text-[11px] uppercase tracking-wider text-slate-400/80 bg-white/5">
          <tr>
            <th className="px-3 py-2 font-medium">Stat</th>
            <th className="px-3 py-2 text-center font-medium">Tot</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {keys.map((name) => {
            const s = group[name] || {};
            return (
              <tr key={name} className="odd:bg-transparent even:bg-white/[0.02]">
                <td className="px-3 py-2 font-medium text-white">{name}</td>
                <td className="px-3 py-2 text-center">
                  <input type="number" className="w-24 rounded bg-slate-900/60 px-2 py-1 text-white border border-slate-700/60" value={Number(s.Tot ?? 0)} onChange={(e) => setTot(name, e.target.value)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const SpecialTableEditable = ({ group, onChange }) => {
  const keys = useMemo(() => Object.keys(group || {}).sort(), [group]);
  const setTot = (name, val) => {
    const next = deepClone(group);
    next[name] = { Tot: Number(val || 0) };
    onChange(next);
  };
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm text-left text-slate-300 min-w-[320px]">
        <thead className="text-[11px] uppercase tracking-wider text-slate-400/80 bg-white/5">
          <tr>
            <th className="px-3 py-2 font-medium">Stat</th>
            <th className="px-3 py-2 text-center font-medium">Tot</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {keys.map((name) => {
            const s = group[name] || {};
            return (
              <tr key={name} className="odd:bg-transparent even:bg-white/[0.02]">
                <td className="px-3 py-2 font-medium text-white">{name}</td>
                <td className="px-3 py-2 text-center">
                  <input type="number" className="w-24 rounded bg-slate-900/60 px-2 py-1 text-white border border-slate-700/60" value={Number(s.Tot ?? 0)} onChange={(e) => setTot(name, e.target.value)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const ParamTotalsPreview = ({ params }) => {
  const baseKeys = useMemo(() => Object.keys(params?.Base || {}).sort(), [params]);
  const combKeys = useMemo(() => Object.keys(params?.Combattimento || {}).sort(), [params]);
  const specKeys = useMemo(() => Object.keys(params?.Special || {}).sort(), [params]);
  return (
    <div className="grid gap-3">
      <div>
        <div className="text-[11px] text-slate-400/90 mb-1">Base</div>
        <div className="flex flex-wrap gap-2">
          {baseKeys.map((k) => (
            <span key={k} className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border bg-sky-500/10 border-sky-400/30 text-sky-200">
              <span className="opacity-75 mr-1">{k}:</span>
              <span className="font-semibold">{Number(params.Base[k]?.Tot || 0)}</span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11px] text-slate-400/90 mb-1">Combattimento</div>
        <div className="flex flex-wrap gap-2">
          {combKeys.map((k) => (
            <span key={k} className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border bg-fuchsia-500/10 border-fuchsia-400/30 text-fuchsia-200">
              <span className="opacity-75 mr-1">{k}:</span>
              <span className="font-semibold">{Number(params.Combattimento[k]?.Tot || 0)}</span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11px] text-slate-400/90 mb-1">Special</div>
        <div className="flex flex-wrap gap-2">
          {specKeys.map((k) => (
            <span key={k} className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border bg-emerald-500/10 border-emerald-400/30 text-emerald-200">
              <span className="opacity-75 mr-1">{k}:</span>
              <span className="font-semibold">{Number(params.Special[k]?.Tot || 0)}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export const ParametersEditor = ({ value, onChange, specialKeys }) => {
  const allSpecialKeys = useMemo(() => Array.from(new Set([...(specialKeys || []), ...Object.keys(value?.Special || {})])).sort(), [specialKeys, value]);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40">
        <SectionTitle>Parametri Base</SectionTitle>
        <ParamTableEditable groupName="Base" group={value?.Base || {}} onChange={(g) => onChange({ ...value, Base: g })} />
      </div>
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40">
        <SectionTitle>Parametri Combattimento</SectionTitle>
        <ParamTableEditable groupName="Combattimento" group={value?.Combattimento || {}} onChange={(g) => onChange({ ...value, Combattimento: g })} />
      </div>
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40">
        <SectionTitle>Parametri Speciali</SectionTitle>
        <SpecialTableEditable
          group={allSpecialKeys.reduce((acc, k) => {
            acc[k] = value?.Special?.[k] || { Tot: 0 };
            return acc;
          }, {})}
          onChange={(g) => onChange({ ...value, Special: g })}
        />
      </div>
    </div>
  );
};
