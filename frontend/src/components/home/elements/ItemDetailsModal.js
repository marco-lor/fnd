import React, { useMemo, useState } from 'react';
import { FaTimes } from 'react-icons/fa';

// Utility: safely get nested value by path
const get = (obj, path, dflt) => {
  try {
    return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj) ?? dflt;
  } catch {
    return dflt;
  }
};

// Compact pill
const Pill = ({ children, color = 'indigo' }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border bg-${color}-500/10 border-${color}-400/30 text-${color}-200 mr-2 mb-2`}>{children}</span>
);

const Section = ({ title, children }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2">{title}</div>
    <div>{children}</div>
  </div>
);

// Normalize and derive quick facts from an item document
const useItemFacts = (item) => {
  return useMemo(() => {
    if (!item) return null;
    const name = get(item, 'General.Nome') || item.name || item.id;
    const type = item.item_type || item.type || get(item, 'General.Slot') || 'oggetto';
    const slot = get(item, 'General.Slot');
    const img = get(item, 'General.image_url');
    const price = get(item, 'General.prezzo');
    const effect = get(item, 'General.Effetto');
    const specific = item.Specific || {};
    const params = item.Parametri || {};
    const spells = get(item, 'General.spells') || {};
    return { name, type, slot, img, price, effect, specific, params, spells };
  }, [item]);
};

const LEVELS = ['1', '4', '7', '10'];

const ParametriGrid = ({ params, level }) => {
  if (!params) return null;
  const cats = ['Combattimento', 'Special', 'Base'];
  return (
    <div className="space-y-2">
      {cats.map((cat) => {
        const group = params[cat];
        if (!group) return null;
        // Filter only non-empty values for selected level
        const entries = Object.entries(group)
          .map(([k, v]) => [k, (v && (v[level] ?? '')) || ''])
          .filter(([_, v]) => (typeof v === 'number' ? v !== 0 : (v ?? '').toString().trim() !== ''));
        if (!entries.length) return null;
        return (
          <div key={cat} className="rounded-xl border border-slate-700/50 bg-slate-800/40">
            <div className="px-3 py-2 text-[11px] tracking-wide text-slate-300 border-b border-slate-700/50">{cat}</div>
            <div className="p-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {entries.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-lg bg-slate-900/30 px-2 py-1 border border-slate-700/40">
                  <span className="text-[11px] text-slate-300 mr-2 truncate" title={k}>{k}</span>
                  <span className="text-[11px] text-emerald-300 font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SpecificBlock = ({ type, specific }) => {
  if (!specific || typeof specific !== 'object') return null;
  const entries = Object.entries(specific);
  if (!entries.length) return null;
  const color = type === 'weapon' ? 'fuchsia' : type === 'armatura' ? 'indigo' : type === 'consumabile' ? 'emerald' : 'sky';
  return (
    <div className={`rounded-xl border bg-slate-800/40 border-slate-700/50`}>
      <div className="px-3 py-2 text-[11px] tracking-wide text-slate-300 border-b border-slate-700/50">Specifiche</div>
      <div className="p-3 flex flex-wrap">
        {entries.map(([k, v]) => (
          <Pill key={k} color={color}>
            <span className="opacity-80 mr-1">{k}:</span>
            <span className="font-medium">{Array.isArray(v) ? v.join(', ') : (v === '' ? '—' : String(v))}</span>
          </Pill>
        ))}
      </div>
    </div>
  );
};

const SpellsList = ({ spells }) => {
  const keys = Object.keys(spells || {});
  if (!keys.length) return null;
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40">
      <div className="px-3 py-2 text-[11px] tracking-wide text-slate-300 border-b border-slate-700/50">Incantesimi</div>
      <ul className="divide-y divide-slate-700/50">
        {keys.map((k) => {
          const sp = spells[k] || {};
          return (
            <li key={k} className="px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-200">{sp.Nome || k}</div>
                {sp.Costo != null && <div className="text-[11px] text-amber-300">Costo: {sp.Costo}</div>}
              </div>
              {sp.Effetti_Positivi || sp['Effetti Positivi'] ? (
                <div className="text-[11px] text-slate-400 mt-1">
                  {(sp.Effetti_Positivi || sp['Effetti Positivi'])}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const ItemDetailsModal = ({ item, onClose }) => {
  const facts = useItemFacts(item);
  const [level, setLevel] = useState('1');
  if (!facts) return null;
  const { name, type, slot, img, price, effect, specific, params, spells } = facts;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/90 shadow-2xl">
        <div className="relative">
          {/* Header banner */}
          <div className="h-28 w-full bg-gradient-to-r from-indigo-600/20 via-fuchsia-600/20 to-sky-600/20" />
          {/* Close */}
          <button className="absolute right-3 top-3 text-slate-300 hover:text-white" onClick={onClose} aria-label="close"><FaTimes /></button>
          {/* Top card */}
          <div className="px-5 -mt-16">
            <div className="rounded-2xl border border-slate-700/60 bg-slate-800/60 p-4 flex gap-4">
              <div className="h-24 w-24 rounded-xl overflow-hidden border border-slate-700/60 bg-slate-900/60 flex items-center justify-center">
                {img ? (
                  <img src={img} alt={name} className="h-full w-full object-cover" />
                ) : (
                  <div className="text-[10px] text-slate-500">no image</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-slate-100 truncate">{name}</div>
                <div className="mt-1 flex flex-wrap gap-2 items-center">
                  {type && <Pill color="sky">{type}</Pill>}
                  {slot && <Pill color="indigo">Slot: {slot}</Pill>}
                  {price != null && <Pill color="amber">Prezzo: {price}</Pill>}
                </div>
                {effect && <div className="mt-2 text-sm text-slate-300 line-clamp-3" title={effect}>{effect}</div>}
              </div>
              {/* Level selector */}
              <div className="flex items-start">
                <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-2">
                  <div className="text-[10px] text-slate-400 mb-1 text-center">Livello</div>
                  <div className="grid grid-cols-2 gap-1">
                    {LEVELS.map((lv) => (
                      <button key={lv} onClick={() => setLevel(lv)} className={`px-2 py-1 rounded-lg text-[11px] border transition ${level === lv ? 'bg-indigo-600/40 text-white border-indigo-400/50' : 'bg-slate-800/60 text-slate-300 border-slate-600/60 hover:border-slate-400/60'}`}>{lv}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <SpecificBlock type={type} specific={specific} />
          <ParametriGrid params={params} level={level} />
          <SpellsList spells={spells} />
        </div>
      </div>
    </div>
  );
};

export default ItemDetailsModal;
