import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiX } from 'react-icons/fi';
import { computeParamTotals, deepClone, SectionTitle } from './utils';
import {
  ParametersEditor,
  ParamTotalsPreview,
  SpellsEditor,
  StatsEditor,
  TecnicheEditor,
} from './lazyFoeEditors';
import MediaImage, { hasMediaAsset } from '../../common/MediaImage';
import useObjectUrl from '../../common/useObjectUrl';

const isSafeImageUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

const FoeFormModal = ({ open, initial, onCancel, onSave, schema, busy = false, error = '' }) => {
  const [foe, setFoe] = useState(() => deepClone(initial));
  const [tab, setTab] = useState('general');
  // jsonErr removed (was unused)
  const [imageFile, setImageFile] = useState(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const previewUrl = useObjectUrl(imageFile);
  const hasExistingImage = hasMediaAsset(foe, { variant: 'card' });
  const showsImage = !removeExisting && Boolean(previewUrl || hasExistingImage);
  // A local selection must win over a persisted canonical manifest while the
  // user is reviewing a replacement.
  const previewMedia = previewUrl ? { imageUrl: previewUrl } : foe;
  const previewSrc = previewUrl || (isSafeImageUrl(foe?.imageUrl) ? foe.imageUrl : '');

  // Reset form when opening / switching initial foe
  useEffect(() => {
    if (open) {
      setFoe(deepClone(initial));
      setTab('general');
      setImageFile(null);
      setRemoveExisting(false);
    }
  }, [open, initial]);

  const params = useMemo(() => computeParamTotals(foe?.Parametri || {}), [foe?.Parametri]);
  const specialKeys = useMemo(() => {
    const fromSchema = Object.keys(schema?.Parametri?.Special || {});
    const fromValue = Object.keys(foe?.Parametri?.Special || {});
    return Array.from(new Set([...(fromSchema || []), ...(fromValue || [])])).sort();
  }, [schema, foe?.Parametri?.Special]);

  const setField = (path, value) => {
    // Shallow-immutable update to preserve non-serializable values (e.g., File)
    setFoe((prev) => {
      const segs = path.split('.');
      const next = { ...prev };
      let obj = next;
      for (let i = 0; i < segs.length - 1; i++) {
        const key = segs[i];
        const cur = obj[key];
        obj[key] = Array.isArray(cur) ? cur.slice() : { ...(cur || {}) };
        obj = obj[key];
      }
      obj[segs[segs.length - 1]] = value;
      return next;
    });
  };

  if (!open) return null;

  const content = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <fieldset
        disabled={busy}
        aria-busy={busy}
        className="w-full min-w-0 max-w-6xl max-h-[95vh] m-0 p-0 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-2xl flex flex-col"
      >
        <div className="relative shrink-0">
          <div className="h-24 w-full bg-gradient-to-r from-indigo-600/20 via-fuchsia-600/20 to-sky-600/20" />
          <button className="absolute right-3 top-3 text-slate-300 hover:text-white" onClick={onCancel} aria-label="close">
            <FiX />
          </button>
          <div className="px-5 -mt-12 pb-3">
            <div className="rounded-2xl border border-slate-700/60 bg-slate-800/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                  <label className="block">
                    <div className="text-[11px] text-slate-300 mb-1">Name</div>
                    <input className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={foe?.name || ''} onChange={(e) => setField('name', e.target.value)} placeholder="Goblin" />
                  </label>
                  <label className="block">
                    <div className="text-[11px] text-slate-300 mb-1">Category</div>
                    <input className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={foe?.category || ''} onChange={(e) => setField('category', e.target.value)} placeholder="Beast / Humanoid / Undead..." />
                  </label>
                  <label className="block">
                    <div className="text-[11px] text-slate-300 mb-1">Rank</div>
                    <input className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={foe?.rank || ''} onChange={(e) => setField('rank', e.target.value)} placeholder="Minion / Elite / Boss" />
                  </label>
                  <label className="block">
                    <div className="text-[11px] text-slate-300 mb-1">Level</div>
                    <input type="number" min={1} className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={Number(foe?.stats?.level || 1)} onChange={(e) => setField('stats.level', Number(e.target.value || 1))} />
                  </label>
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  {error && <div className="max-w-sm text-sm text-red-300" role="alert">{error}</div>}
                  <button onClick={() => onSave(foe, { imageFile, removeImage: removeExisting, originalImageUrl: initial?.imageUrl || null, originalImagePath: initial?.imagePath || null })} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white px-4 py-2 border border-indigo-400/40 disabled:cursor-wait disabled:opacity-60">
                    {busy ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="mt-4 flex items-center gap-2 text-[12px]">
                {[
                  ['general', 'General'],
                  ['params', 'Parametri'],
                  ['stats', 'Stats'],
                  ['tecniche', 'Tecniche'],
                  ['spells', 'Spells'],
                ].map(([key, label]) => (
                  <button key={key} onClick={() => setTab(key)} className={`px-3 py-1 rounded-md border ${tab === key ? 'bg-slate-700/70 text-white border-slate-500/60' : 'bg-slate-900/50 text-slate-300 border-slate-700/60 hover:border-slate-500/60'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Panels header area ends; actual content scrolls below */}
            </div>
          </div>
        </div>
        {/* Scrollable content */}
        <div className="px-5 pb-5 overflow-y-auto flex-1">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-800/60 p-4">
            {/* Panels */}
            <div className="mt-0">
                {tab === 'general' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="block">
                      <div className="text-[11px] text-slate-300 mb-1">Image</div>
                      <div className="flex items-center gap-3">
                        <div className="w-20 h-20 rounded-lg overflow-hidden border border-slate-700/60 bg-slate-900/60 flex items-center justify-center text-slate-400">
                          {showsImage ? (
                            <MediaImage
                              media={previewMedia}
                              src={previewSrc}
                              variant="card"
                              alt="preview"
                              width={80}
                              height={80}
                              loading="eager"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span>No Img</span>
                          )}
                        </div>
                        <div className="flex flex-col gap-2">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              setImageFile(f);
                              if (f) setRemoveExisting(false);
                            }}
                            className="block text-sm text-slate-200 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-600/80 file:text-white hover:file:bg-indigo-600"
                          />
                          {!removeExisting && (previewUrl || hasExistingImage) && (
                            <button
                              type="button"
                              onClick={() => {
                                setImageFile(null);
                                setRemoveExisting(true);
                              }}
                              className="px-3 py-1 rounded-md border border-red-400/40 text-red-200 hover:bg-red-500/10 text-[12px] self-start"
                            >
                              Remove image
                            </button>
                          )}
                          {removeExisting && (
                            <button
                              type="button"
                              onClick={() => setRemoveExisting(false)}
                              className="px-3 py-1 rounded-md border border-slate-400/40 text-slate-200 hover:bg-slate-500/10 text-[12px] self-start"
                            >
                              Undo remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <label className="block">
                      <div className="text-[11px] text-slate-300 mb-1">Dado Anima</div>
                      <input className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={foe?.dadoAnima || ''} onChange={(e) => setField('dadoAnima', e.target.value)} placeholder="es. d6, d8, d10…" />
                    </label>
                    <label className="block">
                      <div className="text-[11px] text-slate-300 mb-1">Notes</div>
                      <input className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={foe?.notes || ''} onChange={(e) => setField('notes', e.target.value)} placeholder="Optional notes" />
                    </label>
                  </div>
                )}

        {tab === 'params' && (
                  <div className="space-y-4">
          <ParametersEditor value={foe?.Parametri || {}} onChange={(p) => setField('Parametri', p)} specialKeys={specialKeys} />
                    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40">
                      <SectionTitle>Totals Preview</SectionTitle>
                      <ParamTotalsPreview params={params} />
                    </div>
                  </div>
                )}

                {tab === 'stats' && (
                  <StatsEditor value={foe?.stats || {}} onChange={(s) => setField('stats', s)} />
                )}

                {tab === 'tecniche' && (
                  <TecnicheEditor value={Array.isArray(foe?.tecniche) ? foe.tecniche : []} onChange={(v) => setField('tecniche', v)} />
                )}

                {tab === 'spells' && (
                  <SpellsEditor value={Array.isArray(foe?.spells) ? foe.spells : []} onChange={(v) => setField('spells', v)} />
                )}
            </div>
          </div>
        </div>
      </fieldset>
    </div>
  );

  return createPortal(content, document.body);
};


export default FoeFormModal;
