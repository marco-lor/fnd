// DM Foes Hub: create, list, expand, edit, delete foes in Firestore "foes" collection
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../firebaseConfig';
import { storage } from '../firebaseStorage';
import { functions } from '../firebaseFunctions';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from '../../performance/firestore';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { FiPlus, FiChevronDown, FiChevronRight, FiEdit2, FiTrash2, FiX, FiCopy } from 'react-icons/fi';
import { computeParamTotals, deepClone, Pill, SectionTitle } from './elements/utils';
import RadarChart from './elements/RadarChart';
import { FoeFormModal } from './elements/lazyFoeEditors';
import { uploadCacheableImage } from '../common/imageStorage';

// Allow only persisted HTTP(S) image URLs when reading/saving.
// This prevents storing temporary blob:/data: URLs in Firestore.
const isSafeImageUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const normalizeImageUrl = (u) => (isSafeImageUrl(u) ? u : '');


const FoeRow = ({ foe, onEdit, onDelete, onDuplicate }) => {
  const [open, setOpen] = useState(false);
  const params = useMemo(() => computeParamTotals(foe?.Parametri || {}), [foe?.Parametri]);
  const hpTxt = `${Number(foe?.stats?.hpCurrent ?? foe?.stats?.hpTotal ?? 0)}/${Number(foe?.stats?.hpTotal ?? 0)}`;
  const manaTxt = `${Number(foe?.stats?.manaCurrent ?? foe?.stats?.manaTotal ?? 0)}/${Number(foe?.stats?.manaTotal ?? 0)}`;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        role="button"
        aria-expanded={open}
        tabIndex={0}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            className="text-slate-300 hover:text-white"
            aria-label={open ? 'collapse' : 'expand'}
          >
            {open ? <FiChevronDown /> : <FiChevronRight />}
          </button>
          <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-700/60 bg-slate-800/60 flex items-center justify-center shrink-0">
            {isSafeImageUrl(foe?.imageUrl) ? (
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
          <button onClick={(e) => { e.stopPropagation(); onEdit(foe); }} className="inline-flex items-center gap-1 rounded-lg border border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/10 px-2 py-1 text-[12px]">
            <FiEdit2 /> Edit
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDuplicate(foe); }} className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 text-amber-200 hover:bg-amber-500/10 px-2 py-1 text-[12px]">
            <FiCopy /> Duplicate
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(foe); }} className="inline-flex items-center gap-1 rounded-lg border border-red-400/40 text-red-200 hover:bg-red-500/10 px-2 py-1 text-[12px]">
            <FiTrash2 /> Delete
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pt-3 pb-4">
          {/* General extra info */}
          {foe?.dadoAnima && (
            <div className="mb-3 text-[12px] text-indigo-200"><span className="text-indigo-300/80">Dado Anima:</span> {foe.dadoAnima}</div>
          )}
          {/* Radar charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <RadarChart
                title="Parametri Base"
                labels={Object.keys(params?.Base || {}).sort()}
                values={Object.keys(params?.Base || {}).sort().map((k) => Number(params?.Base?.[k]?.Tot || 0))}
                color="sky"
                size={300}
              />
              <RadarChart
                title="Parametri Combattimento"
                labels={Object.keys(params?.Combattimento || {}).sort()}
                values={Object.keys(params?.Combattimento || {}).sort().map((k) => Number(params?.Combattimento?.[k]?.Tot || 0))}
                color="fuchsia"
                size={300}
              />
            </div>
          
          {/* Notes */}
          {foe?.notes && (
            <div className="mt-3 text-[12px] text-slate-300">{foe.notes}</div>
          )}
          {/* Tecniche */}
          {Array.isArray(foe?.tecniche) && foe.tecniche.length > 0 && (
            <div className="mt-4 rounded-xl border border-fuchsia-700/40 bg-fuchsia-900/10 p-3">
              <SectionTitle>Tecniche</SectionTitle>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                {foe.tecniche.map((t, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
                    <div className="w-14 h-14 rounded-md overflow-hidden border border-slate-700/60 bg-slate-800/60 shrink-0 flex items-center justify-center">
                      {isSafeImageUrl(t?.imageUrl) ? (
                        <img src={t.imageUrl} alt={t?.name || `tecnica-${i}`} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-slate-400 text-xs">No Img</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{t?.name || '—'}</div>
                      {t?.danni && (
                        <div className="text-[12px] text-rose-300 whitespace-pre-wrap break-words"><span className="text-rose-200/80">Danni:</span> {t.danni}</div>
                      )}
                      {t?.effetti && (
                        <div className="text-[12px] text-fuchsia-200 whitespace-pre-wrap break-words"><span className="text-fuchsia-300/80">Effetti:</span> {t.effetti}</div>
                      )}
                      {t?.description && (
                        <div className="text-[12px] text-slate-300 whitespace-pre-wrap break-words">{t.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Spells */}
          {Array.isArray(foe?.spells) && foe.spells.length > 0 && (
            <div className="mt-4 rounded-xl border border-sky-700/40 bg-sky-900/10 p-3">
              <SectionTitle>Spells</SectionTitle>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                {foe.spells.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
                    <div className="w-14 h-14 rounded-md overflow-hidden border border-slate-700/60 bg-slate-800/60 shrink-0 flex items-center justify-center">
                      {isSafeImageUrl(s?.imageUrl) ? (
                        <img src={s.imageUrl} alt={s?.name || `spell-${i}`} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-slate-400 text-xs">No Img</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{s?.name || '—'}</div>
                      {s?.danni && (
                        <div className="text-[12px] text-rose-300 whitespace-pre-wrap break-words"><span className="text-rose-200/80">Danni:</span> {s.danni}</div>
                      )}
                      {s?.effetti && (
                        <div className="text-[12px] text-sky-200 whitespace-pre-wrap break-words"><span className="text-sky-300/80">Effetti:</span> {s.effetti}</div>
                      )}
                      {s?.description && (
                        <div className="text-[12px] text-slate-300 whitespace-pre-wrap break-words">{s.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
  // Duplicate modal state
  const [dupOpen, setDupOpen] = useState(false);
  const [dupTarget, setDupTarget] = useState(null);
  const [dupName, setDupName] = useState('');
  const [dupBusy, setDupBusy] = useState(false);
  const [dupError, setDupError] = useState('');

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
  dadoAnima: '',
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

  const handleDuplicateOpen = (foe) => {
    setDupTarget(foe);
    const base = foe?.name?.toString()?.trim() || 'Foe';
    setDupName(`${base} (copy)`);
    setDupError('');
    setDupOpen(true);
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
      // Keep File references for nested items; we'll replace arrays after upload
      const basePayload = { ...foeData };
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
        ({ downloadUrl: imageUrl } = await uploadCacheableImage(fileRef, imageFile));
        imagePath = path;
      }

      // Remove image explicit request
      if (removeImage) {
        imageUrl = null;
        imagePath = null;
      }

      // Upload tecniche/spells entry images
      const uploadEntryImage = async (folder, entry) => {
        let eUrl = entry.imageUrl || '';
        let ePath = entry.imagePath || '';
        if (entry.imageFile) {
          const safe = (entry.name || folder).toString().trim().replace(/\s+/g, '_').slice(0, 40) || folder;
          const fname = `${safe}_${Date.now()}`;
          const path = `foes/${folder}/${fname}`;
          const ref = storageRef(storage, path);
          ({ downloadUrl: eUrl } = await uploadCacheableImage(ref, entry.imageFile));
          ePath = path;
        } else if (entry.removeImage) {
          eUrl = '';
          ePath = '';
        } else {
          // Preserve only safe persisted URLs
          eUrl = normalizeImageUrl(eUrl);
        }
        // Persist only relevant fields
        return { name: entry.name || '', description: entry.description || '', danni: entry.danni || '', effetti: entry.effetti || '', imageUrl: eUrl, imagePath: ePath };
      };

      const withTec = Array.isArray(basePayload.tecniche) ? await Promise.all(basePayload.tecniche.map((t) => uploadEntryImage('tecniche', t))) : [];
      const withSp = Array.isArray(basePayload.spells) ? await Promise.all(basePayload.spells.map((s) => uploadEntryImage('spells', s))) : [];
      basePayload.tecniche = withTec;
      basePayload.spells = withSp;

      const payload = { ...basePayload, imageUrl: normalizeImageUrl(imageUrl) || '', imagePath: imagePath || '', updated_at: serverTimestamp() };

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

  // Duplicate logic (copies firestore doc and re-uploads images to new paths)
  const handleDuplicateConfirm = async () => {
    if (!dupTarget || !dupName.trim()) return;
    try {
      setDupBusy(true);
      setDupError('');
      const callable = httpsCallable(functions, 'duplicateFoeWithAssets');
  await callable({ sourceFoeId: dupTarget.id, newFoeName: dupName.trim() });
      // Optional: we could resolve URLs for previews here using getDownloadURL on returned paths
      // but no need to mutate state; the Firestore onSnapshot will include the new doc
      setDupOpen(false);
      setDupTarget(null);
      setDupName('');
    } catch (e) {
      console.error('duplicate foe failed', e);
      setDupError('Duplicazione fallita.');
    } finally {
      setDupBusy(false);
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
                <FoeRow key={f.id} foe={f} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicateOpen} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal */}
  {modalOpen ? (
    <FoeFormModal
      open
      initial={initialForModal}
      onCancel={() => { setModalOpen(false); setEditing(null); }}
      onSave={handleSave}
      schema={schema}
    />
  ) : null}
      {dupOpen && createPortal(
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-slate-700/60 bg-slate-900/95 p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="text-white font-semibold">Duplicate foe</div>
              <button className="text-slate-300 hover:text-white" onClick={() => setDupOpen(false)} aria-label="close"><FiX /></button>
            </div>
            {dupError && <div className="mb-2 text-sm text-red-300">{dupError}</div>}
            <label className="block mb-3">
              <div className="text-[11px] text-slate-300 mb-1">New name</div>
              <input disabled={dupBusy} className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" value={dupName} onChange={(e) => setDupName(e.target.value)} />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button disabled={dupBusy} onClick={() => setDupOpen(false)} className="px-3 py-1 rounded-md border border-slate-400/40 text-slate-200 hover:bg-slate-500/10 text-[12px]">Cancel</button>
              <button disabled={dupBusy || !dupName.trim()} onClick={handleDuplicateConfirm} className="inline-flex items-center gap-2 rounded-lg bg-amber-600/80 hover:bg-amber-600 text-white px-3 py-1 border border-amber-400/40 text-[12px]">
                <FiCopy /> {dupBusy ? 'Duplicating…' : 'Duplicate'}
              </button>
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
};

export default FoesHub;
