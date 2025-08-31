import React from 'react';

const ensureArray = (v) => Array.isArray(v) ? v : [];

const SpellsEditor = ({ value = [], onChange }) => {
  const list = ensureArray(value);
  const setItem = (idx, patch) => {
    const next = list.map((it, i) => i === idx ? { ...it, ...patch } : it);
    onChange(next);
  };
  const addItem = () => onChange([...(list || []), { name: '', description: '', danni: '', effetti: '', imageUrl: '', imagePath: '' }]);
  const removeItem = (idx) => onChange(list.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      <button type="button" onClick={addItem} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white px-3 py-1 border border-emerald-400/40 text-sm">+ Add Spell</button>
      {(list || []).length === 0 ? (
        <div className="text-slate-400 text-sm">No spells added yet.</div>
      ) : (
        <div className="space-y-3">
          {list.map((it, idx) => (
            <div key={idx} className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
              <div className="flex items-start gap-3">
                <div className="w-20 h-20 rounded-lg overflow-hidden border border-slate-700/60 bg-slate-800/60 flex items-center justify-center shrink-0">
                  {(it.previewUrl || it.imageUrl) ? (
                    <img src={it.previewUrl || it.imageUrl} alt={it.name || 'spell'} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-slate-400 text-xs">No Img</span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                  <label className="block">
                    <div className="text-[11px] text-slate-300 mb-1">Name</div>
                    <input className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={it.name || ''} onChange={(e) => setItem(idx, { name: e.target.value })} />
                  </label>
                  <div className="block">
                    <div className="text-[11px] text-slate-300 mb-1">Image</div>
                    <div className="flex items-center gap-2">
                      <input type="file" accept="image/*" onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        const purl = f ? URL.createObjectURL(f) : null;
                        setItem(idx, { imageFile: f || null, previewUrl: purl, removeImage: !f && !it.imageUrl });
                      }} className="block text-sm text-slate-200 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-600/80 file:text-white hover:file:bg-indigo-600" />
                      {(it.previewUrl || it.imageUrl) && (
                        <button type="button" className="px-2 py-1 rounded-md border border-red-400/40 text-red-200 hover:bg-red-500/10 text-[12px]" onClick={() => setItem(idx, { imageFile: null, previewUrl: null, removeImage: true, imageUrl: '' })}>Remove</button>
                      )}
                    </div>
                  </div>
                  <label className="block">
                    <div className="text-[11px] text-slate-300 mb-1">Danni</div>
                    <input className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={it.danni || ''} onChange={(e) => setItem(idx, { danni: e.target.value })} />
                  </label>
                  <label className="block">
                    <div className="text-[11px] text-slate-300 mb-1">Effetti</div>
                    <input className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={it.effetti || ''} onChange={(e) => setItem(idx, { effetti: e.target.value })} />
                  </label>
                  <label className="block sm:col-span-2">
                    <div className="text-[11px] text-slate-300 mb-1">Description</div>
                    <textarea className="w-full h-20 rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={it.description || ''} onChange={(e) => setItem(idx, { description: e.target.value })} />
                  </label>
                </div>
                <div className="shrink-0">
                  <button type="button" className="px-2 py-1 rounded-md border border-slate-400/40 text-slate-200 hover:bg-slate-500/10 text-[12px]" onClick={() => removeItem(idx)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SpellsEditor;
