import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaTimes } from 'react-icons/fa';
import { useAuth } from '../../../AuthContext';
import { computeValue } from '../../common/computeFormula';
import { db, storage } from '../../firebaseConfig';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { FiTrash2 } from 'react-icons/fi';
import ConfirmDeleteModal from './ConfirmDeleteModal';

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

// Note: Removed unused Section component to satisfy ESLint no-unused-vars

// Normalize and derive quick facts from an item document
const useItemFacts = (item) => {
  return useMemo(() => {
    if (!item) return null;
  const isVarie = ((item.type || item.item_type || '').toLowerCase() === 'varie');
    const name = get(item, 'General.Nome') || item.name || item.id;
  const type = isVarie ? 'varie' : (item.item_type || item.type || get(item, 'General.Slot') || 'oggetto');
    const slot = isVarie ? undefined : get(item, 'General.Slot');
  const img = isVarie ? (item.image_url || get(item, 'General.image_url')) : get(item, 'General.image_url');
    const price = isVarie ? undefined : get(item, 'General.prezzo');
    const effect = isVarie ? (item.description || '') : get(item, 'General.Effetto');
    const specific = isVarie ? {} : (item.Specific || {});
    const params = isVarie ? {} : (item.Parametri || {});
    const spells = isVarie ? {} : (get(item, 'General.spells') || {});
    return { name, type, slot, img, price, effect, specific, params, spells };
  }, [item]);
};

const LEVELS = ['1', '4', '7', '10'];

const ParametriGrid = ({ params, level, userParams }) => {
  if (!params) return null;
  const cats = ['Combattimento', 'Special', 'Base'];
  const isDice = (s) => typeof s === 'string' && /\b\d+d\d+\b/i.test(s);
  const looksLikeFormula = (s) => {
    if (typeof s !== 'string') return false;
    if (isDice(s)) return false; // keep dice text (e.g., 9d6)
    // Heuristic: contains math ops or MAX/MIN or a known param name-like token
    return /[+\-*/()]|\bMAX\b|\bMIN\b|[A-Za-z]/i.test(s);
  };
  return (
    <div className="space-y-2">
      {cats.map((cat) => {
        const group = params[cat];
        if (!group) return null;
        // Filter only non-empty values for selected level
        const entries = Object.entries(group)
          .map(([k, v]) => [k, (v && (v[level] ?? '')) || ''])
          .filter(([_, v]) => (typeof v === 'number' ? v !== 0 : (v ?? '').toString().trim() !== ''))
          .map(([k, rawVal]) => {
            let computed = null;
            if (looksLikeFormula(rawVal) && userParams) {
              computed = computeValue(String(rawVal), userParams);
            }
            return [k, rawVal, computed];
          });
        if (!entries.length) return null;
        return (
          <div key={cat} className="rounded-xl border border-slate-700/50 bg-slate-800/40">
            <div className="px-3 py-2 text-[11px] tracking-wide text-slate-300 border-b border-slate-700/50">{cat}</div>
            <div className="p-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {entries.map(([k, rawVal, computed]) => {
                const showComputed = computed !== null && !Number.isNaN(computed);
                return (
                  <div key={k} className="rounded-lg bg-slate-900/30 px-2 py-2 border border-slate-700/40">
                    <div className="text-[11px] text-slate-300 mb-1 break-words" title={k}>{k}</div>
                    <div className="text-[12px] text-emerald-300 font-medium whitespace-pre-wrap break-words leading-snug">
                      {showComputed ? String(computed) : String(rawVal)}
                    </div>
                    {showComputed && (
                      <div className="mt-0.5 text-[10px] text-slate-400 whitespace-pre-wrap break-words" title={String(rawVal)}>
                        {String(rawVal)}
                      </div>
                    )}
                  </div>
                );
              })}
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
  const { user, userData } = useAuth();
  const facts = useItemFacts(item);
  // Ensure we only portal on client
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Determine default level based on user level and thresholds 1,4,7,10 (floor to nearest)
  const defaultLevel = useMemo(() => {
    const thresholds = [1, 4, 7, 10];
    const userLevel = Number(userData?.stats?.level || 1);
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (userLevel >= thresholds[i]) return String(thresholds[i]);
    }
    return '1';
  }, [userData?.stats?.level]);
  const [level, setLevel] = useState(defaultLevel);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [equippedCount, setEquippedCount] = useState(0);
  useEffect(() => {
    setLevel(defaultLevel);
  }, [defaultLevel]);
  // Compute if this item is equipped based on userData.equipped (unconditional hook)
  useEffect(() => {
    try {
      const eq = userData?.equipped || {};
      const targetId = item ? (item.id || item.name || item?.General?.Nome) : undefined;
      let cnt = 0;
      Object.values(eq).forEach((val) => {
        if (!val) return;
        const id = typeof val === 'string' ? val : (val.id || val.name || val?.General?.Nome);
        if (id && targetId && id === targetId) cnt += 1;
      });
      setEquippedCount(cnt);
    } catch {}
  }, [userData?.equipped, item]);

  if (!facts) return null;
  const { name, type, slot, img, price, effect, specific, params, spells } = facts;

  const removeOne = async () => {
    try {
      // The user document id matches the authenticated user's uid.
      const userId = user?.uid;
      if (!userId) return;
      setBusy(true);
      const ref = doc(db, 'users', userId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const inv = Array.isArray(data.inventory) ? [...data.inventory] : [];
  const targetId = item?.id || item?.name || name;
  const targetIndex = typeof item?.__invIndex === 'number' ? item.__invIndex : undefined;
      let removed = false;
      let deletedImageUrl = null;
      const deriveId = (e, i) => {
        if (!e) return `item-${i}`;
        if (typeof e === 'string') return e;
        return e.id || e.name || e?.General?.Nome || `item-${i}`;
      };
      const next = [];
      for (let i = 0; i < inv.length; i++) {
        const entry = inv[i];
        if (removed) { next.push(entry); continue; }
        // If a specific instance index is known, match on that first
        if (typeof targetIndex === 'number') {
          if (i !== targetIndex) { next.push(entry); continue; }
        } else {
          const id = deriveId(entry, i);
          if (id !== targetId) { next.push(entry); continue; }
        }
        if (typeof entry === 'object' && entry && typeof entry.qty === 'number') {
          const newQty = Math.max(0, (entry.qty || 0) - 1);
          if (newQty > 0) {
            next.push({ ...entry, qty: newQty });
          } else {
            if ((entry.type || '').toLowerCase() === 'varie' && entry.image_url) {
              deletedImageUrl = entry.image_url;
            }
            // fully removed; do not push
          }
        } else {
          // string or object without qty -> remove single occurrence
          if (typeof entry === 'object' && (entry.type || '').toLowerCase() === 'varie' && entry.image_url) {
            deletedImageUrl = entry.image_url;
          }
        }
        removed = true;
      }
      if (!removed) return;
      await updateDoc(ref, { inventory: next });
      // If we deleted the last Varie with an image, clean up storage
      if (deletedImageUrl) {
        try {
          const path = decodeURIComponent(deletedImageUrl.split('/o/')[1].split('?')[0]);
          await deleteObject(storageRef(storage, path));
        } catch (e) {
          console.warn('Failed to delete varie image from storage (modal)', e);
        }
      }
      onClose && onClose();
    } catch (e) {
      console.error('Failed to remove item', e);
    } finally {
      setBusy(false);
    }
  };
  const handleBackdropMouseDown = (e) => {
    // Close only when clicking the backdrop itself (not children),
    // and avoid closing while the confirmation dialog is open
    if (e.target === e.currentTarget && !confirmOpen) {
      onClose && onClose();
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      aria-modal="true"
    >
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
                {effect && <div className="mt-2 text-sm text-slate-300 whitespace-pre-wrap break-words" title={effect}>{effect}</div>}
              </div>
              {/* Level selector */}
              <div className="flex items-start gap-2">
                {/* Delete one */}
                <button
                  className={`self-start mt-0 rounded-lg border p-2 inline-flex items-center justify-center ${(busy || equippedCount>0) ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-500/10'} border-red-400/40 text-red-300`}
                  onClick={() => equippedCount===0 && setConfirmOpen(true)}
                  disabled={busy || equippedCount>0}
                  aria-label="Rimuovi 1"
                  title={equippedCount>0 ? "Prima rimuovi l'oggetto" : "Rimuovi 1 dall'inventario"}
                >
                  <FiTrash2 className="h-3 w-3" />
                </button>
                <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-2">
                  <div className="text-[10px] text-slate-400 mb-1 text-center">Livello</div>
                  <div className="grid grid-cols-2 gap-1">
                    {LEVELS.map((lv) => {
                      const isSelected = level === lv;
                      const isDefault = defaultLevel === lv;
                      return (
                        <button
                          key={lv}
                          onClick={() => setLevel(lv)}
                          className={`px-2 py-1 rounded-lg text-[11px] border transition ${
                            isSelected
                              ? 'bg-indigo-600/40 text-white border-indigo-400/50'
                              : 'bg-slate-800/60 text-slate-300 border-slate-600/60 hover:border-slate-400/60'
                          } ${isDefault ? 'ring-2 ring-amber-400/70' : ''}`}
                          title={isDefault ? 'Default dal livello giocatore' : undefined}
                        >
                          <span className="flex items-center gap-1">
                            {lv}
                            {isDefault && (
                              <span className="text-amber-300 text-[10px]" aria-label="default">★</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <SpecificBlock type={type} specific={specific} />
          <ParametriGrid params={params} level={level} userParams={userData?.Parametri} />
          <SpellsList spells={spells} />
        </div>
      </div>
      {confirmOpen && (
        <ConfirmDeleteModal
          itemName={name}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => {
            await removeOne();
            setConfirmOpen(false);
          }}
        />
      )}
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
};

export default ItemDetailsModal;
