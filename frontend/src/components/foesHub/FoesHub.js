// DM Foes Hub: create, list, expand, edit, delete foes in Firestore "foes" collection
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { db, storage } from '../firebaseConfig';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { FiPlus, FiChevronDown, FiChevronRight, FiEdit2, FiTrash2, FiX } from 'react-icons/fi';
import { computeParamTotals, deepClone, Pill, SectionTitle } from './elements/utils';
import { ParametersEditor, ParamTotalsPreview } from './elements/ParamEditors';
import StatsEditor from './elements/StatsEditor';
import TecnicheEditor from './elements/TecnicheEditor';
import SpellsEditor from './elements/SpellsEditor';

// Overlay form (create/edit)
const FoeFormModal = ({ open, initial, onCancel, onSave, schema }) => {
  const [foe, setFoe] = useState(() => deepClone(initial));
  const [tab, setTab] = useState('general');
  const [jsonErr, setJsonErr] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [removeExisting, setRemoveExisting] = useState(false);

  useEffect(() => {
    if (open) {
      setFoe(deepClone(initial));
      setJsonErr('');
      setTab('general');
      setImageFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
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
    setFoe((prev) => {
      const next = deepClone(prev);
      const segs = path.split('.');
      let obj = next;
      for (let i = 0; i < segs.length - 1; i++) {
        obj[segs[i]] = obj[segs[i]] ?? {};
        obj = obj[segs[i]];
      }
      obj[segs[segs.length - 1]] = value;
      return next;
    });
  };

  if (!open) return null;

  const content = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-6xl max-h-[95vh] overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-2xl flex flex-col">
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
                <button onClick={() => onSave(foe, { imageFile, removeImage: removeExisting, originalImageUrl: initial?.imageUrl || null, originalImagePath: initial?.imagePath || null })} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white px-4 py-2 border border-indigo-400/40">
                  Save
                </button>
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
                          {(previewUrl || foe?.imageUrl) ? (
                            <img src={previewUrl || foe?.imageUrl} alt="preview" className="w-full h-full object-cover" />
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
                              if (previewUrl) URL.revokeObjectURL(previewUrl);
                              setPreviewUrl(f ? URL.createObjectURL(f) : null);
                              if (f) setRemoveExisting(false);
                            }}
                            className="block text-sm text-slate-200 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-600/80 file:text-white hover:file:bg-indigo-600"
                          />
                          {(previewUrl || foe?.imageUrl) && (
                            <button
                              type="button"
                              onClick={() => {
                                setImageFile(null);
                                if (previewUrl) URL.revokeObjectURL(previewUrl);
                                setPreviewUrl(null);
                                setRemoveExisting(true);
                                setField('imageUrl', '');
                                setField('imagePath', '');
                              }}
                              className="px-3 py-1 rounded-md border border-red-400/40 text-red-200 hover:bg-red-500/10 text-[12px] self-start"
                            >
                              Remove image
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
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
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

// removed inline editors and preview in favor of modular components

const FoeRow = ({ foe, onEdit, onDelete }) => {
  const [open, setOpen] = useState(false);
  const params = useMemo(() => computeParamTotals(foe?.Parametri || {}), [foe?.Parametri]);
  const hpTxt = `${Number(foe?.stats?.hpCurrent ?? foe?.stats?.hpTotal ?? 0)}/${Number(foe?.stats?.hpTotal ?? 0)}`;
  const manaTxt = `${Number(foe?.stats?.manaCurrent ?? foe?.stats?.manaTotal ?? 0)}/${Number(foe?.stats?.manaTotal ?? 0)}`;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => setOpen((v) => !v)} className="text-slate-300 hover:text-white" aria-label={open ? 'collapse' : 'expand'}>
            {open ? <FiChevronDown /> : <FiChevronRight />}
          </button>
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-700/60 bg-slate-800/60 flex items-center justify-center shrink-0">
            {foe?.imageUrl ? (
              <img src={foe.imageUrl} alt={foe?.name || 'foe'} className="w-full h-full object-cover" />
            ) : (
              <span className="text-slate-400 text-sm">
                {(foe?.name || '?').toString().charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-white font-semibold truncate">{foe?.name || '(no name)'}</div>
            <div className="text-[12px] text-slate-400 truncate">Lv {Number(foe?.stats?.level || 1)} • {foe?.category || '—'} • {foe?.rank || '—'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Pill color="emerald">HP {hpTxt}</Pill>
          <Pill color="sky">Mana {manaTxt}</Pill>
          <button onClick={() => onEdit(foe)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/10 px-2 py-1 text-[12px]">
            <FiEdit2 /> Edit
          </button>
          <button onClick={() => onDelete(foe)} className="inline-flex items-center gap-1 rounded-lg border border-red-400/40 text-red-200 hover:bg-red-500/10 px-2 py-1 text-[12px]">
            <FiTrash2 /> Delete
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4">
          {/* Totals preview */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
            <ParamTotalsPreview params={params} />
          </div>
          {/* Notes */}
          {foe?.notes && (
            <div className="mt-3 text-[12px] text-slate-300">{foe.notes}</div>
          )}
        </div>
      )}
    </div>
  );
};

const FoesHub = () => {
  const [foes, setFoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schema, setSchema] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // foe doc or null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Subscribe foes
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'foes'), (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      // sort by updated_at/created_at desc if present
      rows.sort((a, b) => (b.updated_at?.seconds || b.created_at?.seconds || 0) - (a.updated_at?.seconds || a.created_at?.seconds || 0));
      setFoes(rows);
      setLoading(false);
    }, (err) => {
      console.error('foes snapshot error', err);
      setLoading(false);
      setError('Impossibile caricare i foes.');
    });
    return () => unsub();
  }, []);

  // Load base schema to bootstrap a foe
  useEffect(() => {
    (async () => {
      try {
        const sref = doc(db, 'utils', 'schema_pg');
        const snap = await getDoc(sref);
        if (snap.exists()) setSchema(snap.data());
        else setSchema({});
      } catch (e) {
        console.warn('Unable to load schema_pg', e);
        setSchema({});
      }
    })();
  }, []);

  const newFoeFromSchema = () => {
    const p = deepClone(schema?.Parametri || {});
    const st = deepClone(schema?.stats || {});
    // Minimal defaults
    return {
      name: '',
      category: '',
      rank: '',
      imageUrl: '',
      notes: '',
      Parametri: p,
      stats: { level: 1, hpTotal: 0, hpCurrent: 0, manaTotal: 0, manaCurrent: 0, initiative: 0, ...st },
      tecniche: deepClone(schema?.tecniche || {}),
      spells: deepClone(schema?.spells || {}),
      inventory: [],
    };
  };

  const handleCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const handleEdit = (foe) => {
    setEditing(foe);
    setModalOpen(true);
  };

  const handleDelete = async (foe) => {
    if (!foe?.id) return;
    const ok = window.confirm(`Eliminare definitivamente "${foe.name || foe.id}"?`);
    if (!ok) return;
    try {
      setBusy(true);

      // Collect all storage paths to delete: main image + tecniche + spells images
      const getStoragePath = (item) => {
        if (!item) return null;
        return item.imagePath || (item.imageUrl ? decodeURIComponent(item.imageUrl.split('/o/')[1]?.split('?')[0]) : null);
      };
      const pathsSet = new Set();

      // Main foe image
      const mainPath = getStoragePath(foe);
      if (mainPath) pathsSet.add(mainPath);

      // Tecniche images
      if (Array.isArray(foe?.tecniche)) {
        foe.tecniche.forEach((t) => {
          const p = getStoragePath(t);
            if (p) pathsSet.add(p);
        });
      }
      // Spells images
      if (Array.isArray(foe?.spells)) {
        foe.spells.forEach((s) => {
          const p = getStoragePath(s);
            if (p) pathsSet.add(p);
        });
      }

      // Delete all gathered storage objects (ignore individual failures)
      try {
        await Promise.allSettled(Array.from(pathsSet).map((p) => deleteObject(storageRef(storage, p))));
      } catch (e) {
        console.warn('Some foe asset deletions failed', e);
      }

      await deleteDoc(doc(db, 'foes', foe.id));
    } catch (e) {
      console.error('delete foe failed', e);
      setError('Eliminazione fallita.');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (foeData, options = {}) => {
    try {
      setBusy(true);
      setError('');
      const { imageFile, removeImage, originalImageUrl, originalImagePath } = options;
      const basePayload = { ...deepClone(foeData) };
      // Ensure current hp/mana mirror totals at save time
      const hpTotal = Number(basePayload?.stats?.hpTotal || 0);
      const manaTotal = Number(basePayload?.stats?.manaTotal || 0);
      basePayload.stats = {
        ...(basePayload.stats || {}),
        hpCurrent: hpTotal,
        manaCurrent: manaTotal,
      };

      let imageUrl = basePayload.imageUrl || null;
      let imagePath = basePayload.imagePath || null;

      // If a new file selected, upload to foes/ and get URL
      if (imageFile) {
        const safeName = (basePayload?.name || 'foe').toString().trim().replace(/\s+/g, '_').slice(0, 40) || 'foe';
        const fileName = `${safeName}_${Date.now()}`;
        const path = `foes/${fileName}`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, imageFile);
        imageUrl = await getDownloadURL(fileRef);
        imagePath = path;
      }

      // Remove image explicit request
      if (removeImage) {
        imageUrl = null;
        imagePath = null;
      }

      // Upload tecniche images
      const uploadEntryImage = async (folder, entry) => {
        let eUrl = entry.imageUrl || '';
        let ePath = entry.imagePath || '';
        if (entry.imageFile) {
          const safe = (entry.name || folder).toString().trim().replace(/\s+/g, '_').slice(0, 40) || folder;
          const fname = `${safe}_${Date.now()}`;
          const path = `foes/${folder}/${fname}`;
          const ref = storageRef(storage, path);
          await uploadBytes(ref, entry.imageFile);
          eUrl = await getDownloadURL(ref);
          ePath = path;
        } else if (entry.removeImage) {
          eUrl = '';
          ePath = '';
        }
        return { ...entry, imageUrl: eUrl, imagePath: ePath };
      };

      const withTec = Array.isArray(basePayload.tecniche) ? await Promise.all(basePayload.tecniche.map((t) => uploadEntryImage('tecniche', t))) : [];
      const withSp = Array.isArray(basePayload.spells) ? await Promise.all(basePayload.spells.map((s) => uploadEntryImage('spells', s))) : [];
      basePayload.tecniche = withTec;
      basePayload.spells = withSp;

      const payload = { ...basePayload, imageUrl: imageUrl || '', imagePath: imagePath || '', updated_at: serverTimestamp() };

      let docId = editing?.id;
      if (docId) {
        await updateDoc(doc(db, 'foes', docId), payload);
      } else {
        const added = await addDoc(collection(db, 'foes'), { ...payload, created_at: serverTimestamp() });
        docId = added.id;
      }

      // If we uploaded/replaced or removed, delete the original image from storage
      try {
        const oldPath = originalImagePath || (originalImageUrl ? decodeURIComponent(originalImageUrl.split('/o/')[1]?.split('?')[0]) : null);
        const newPath = imagePath;
        if ((imageFile || removeImage) && oldPath && oldPath !== newPath) {
          await deleteObject(storageRef(storage, oldPath));
        }
        // cleanup tecniche/spells old images when replaced or removed
        const cleanupList = [];
        const prevTec = Array.isArray(foeData?.tecniche) ? foeData.tecniche : [];
        const nextTec = withTec;
        prevTec.forEach((prev, idx) => {
          const next = nextTec[idx];
          const prevPath = prev?.imagePath || (prev?.imageUrl ? decodeURIComponent(prev.imageUrl.split('/o/')[1]?.split('?')[0]) : null);
          const nextPath = next?.imagePath || '';
          if (prevPath && prevPath !== nextPath && (prev?.imageFile || prev?.removeImage)) cleanupList.push(prevPath);
        });
        const prevSp = Array.isArray(foeData?.spells) ? foeData.spells : [];
        const nextSp = withSp;
        prevSp.forEach((prev, idx) => {
          const next = nextSp[idx];
          const prevPath = prev?.imagePath || (prev?.imageUrl ? decodeURIComponent(prev.imageUrl.split('/o/')[1]?.split('?')[0]) : null);
          const nextPath = next?.imagePath || '';
          if (prevPath && prevPath !== nextPath && (prev?.imageFile || prev?.removeImage)) cleanupList.push(prevPath);
        });
        await Promise.allSettled(cleanupList.map((p) => deleteObject(storageRef(storage, p))));
      } catch (e) {
        console.warn('cleanup old foe image failed', e);
      }

      setModalOpen(false);
      setEditing(null);
    } catch (e) {
      console.error('save foe failed', e);
      setError('Salvataggio fallito.');
    } finally {
      setBusy(false);
    }
  };

  // Initial foe for modal
  const initialForModal = editing ? editing : newFoeFromSchema();

  return (
    <div className="p-4 md:p-6 lg:p-8 text-white">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold mb-1">Foes Hub</h1>
            <p className="text-gray-300">Crea e gestisci creature per gli incontri.</p>
          </div>
          <button onClick={handleCreate} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white px-4 py-2 border border-emerald-400/40 disabled:opacity-60" disabled={busy || !schema}>
            <FiPlus /> Nuovo foe
          </button>
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-300">{error}</div>
        )}

        {loading ? (
          <div className="text-slate-300">Caricamento…</div>
        ) : (
          <div className="space-y-3">
            {foes.length === 0 ? (
              <div className="text-slate-400">Nessun foe creato. Clicca "Nuovo foe" per iniziare.</div>
            ) : (
              foes.map((f) => (
                <FoeRow key={f.id} foe={f} onEdit={handleEdit} onDelete={handleDelete} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal */}
  <FoeFormModal open={modalOpen} initial={initialForModal} onCancel={() => { setModalOpen(false); setEditing(null); }} onSave={handleSave} schema={schema} />
    </div>
  );
};

export default FoesHub;
