import React, { useEffect, useState, useContext } from 'react';
import { AuthContext } from '../../../AuthContext';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { FaTimes } from 'react-icons/fa';
import { GiChestArmor, GiBroadsword, GiShield, GiRing, GiCrackedHelm, GiBlackBelt, GiSteeltoeBoots, GiScabbard } from 'react-icons/gi';
import ItemDetailsModal from './ItemDetailsModal';

// Slot metadata (icon + label) retained; layout will be Diablo-like around a silhouette
const SLOT_DEFS = [
  { key: 'headArmor', label: 'Testa', icon: GiCrackedHelm },
  { key: 'chestArmor', label: 'Corpo', icon: GiChestArmor },
  { key: 'cintura', label: 'Cintura', icon: GiBlackBelt },
  { key: 'stivali', label: 'Stivali', icon: GiSteeltoeBoots },
  { key: 'weaponMain', label: 'Mano Principale', icon: GiBroadsword },
  { key: 'weaponOff', label: 'Mano Secondaria', icon: GiShield },
  { key: 'foderoArma', label: 'Fodero Arma', icon: GiScabbard },
  { key: 'accessorio', label: 'Accessorio', icon: GiRing },
];

const SLOT_MAP = SLOT_DEFS.reduce((acc, s) => { acc[s.key] = s; return acc; }, {});

// Layout rows: [leftSlot, bodyPart, rightSlot]
// Middle column labels removed; we retain placeholders for layout symmetry
const LAYOUT_ROWS = [
  ['headArmor', 'slotA', 'accessorio'],
  ['chestArmor', 'slotB', 'weaponMain'],
  ['cintura', 'slotC', 'weaponOff'],
  ['stivali', 'slotD', 'foderoArma'],
];

// Fallback placeholder when slot is empty
const Silhouette = () => (
  <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-1 text-slate-600/50 select-none text-[8px] tracking-wider">
    vuoto
  </div>
);

// Modal wrapper
const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
    <div className="w-full max-w-md bg-slate-900/90 border border-slate-700/70 rounded-2xl shadow-xl overflow-hidden animate-[fadeIn_.25s_ease]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/60">
        <h3 className="text-sm font-medium text-slate-200 tracking-wide">{title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
          <FaTimes />
        </button>
      </div>
      <div className="p-4 max-h[60vh] overflow-y-auto">
        {children}
      </div>
    </div>
  </div>
);

const EquippedInventory = () => {
  const { user } = useContext(AuthContext);
  const [equipped, setEquipped] = useState({});
  const [inventory, setInventory] = useState([]); // simple array of item objects or strings
  const [activeSlot, setActiveSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  // Full item specifics now come from user's inventory/equipped entries directly
  const [previewItem, setPreviewItem] = useState(null); // item object to show in details modal

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      setEquipped(data.equipped || {});
      setInventory(data.inventory || []);
    });
    return () => unsub();
  }, [user]);

  // No subscription to global items; specifics are already in user's data

  const handleUnequip = async (slotKey) => {
    if (!user) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { [`equipped.${slotKey}`]: null });
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const openEquipModal = (slotKey) => {
    setActiveSlot(slotKey);
  };

  const handleEquip = async (item) => {
    if (!user || !activeSlot) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { [`equipped.${activeSlot}`]: item });
    } catch (e) { console.error(e); }
    setLoading(false);
    setActiveSlot(null);
  };

  // Items not already equipped (simple identity by name or id)
  // Collect equipped counts per item id (allow duplicates across different slots)
  const equippedCounts = {};
  Object.values(equipped || {}).forEach(val => {
    if (!val) return;
    const id = typeof val === 'string' ? val : val.id || val.name || val?.General?.Nome;
    if (!id) return;
    equippedCounts[id] = (equippedCounts[id] || 0) + 1;
  });

  // Normalize inventory entries: allow primitives, objects {id, qty}, or full item objects
  const normalizedInventory = inventory.map(entry => {
    if (!entry) return null;
    if (typeof entry === 'string') return { id: entry, qty: 1, name: entry };
    if (typeof entry === 'object') {
      if (entry.id) return { id: entry.id, qty: entry.qty || 1, name: entry?.General?.Nome || entry.name || entry.id, ...entry };
      if (entry.name) return { id: entry.name, qty: entry.qty || 1, name: entry?.General?.Nome || entry.name, ...entry };
    }
    return null;
  }).filter(Boolean);

  // Collapse duplicates (safeguard) and compute remaining quantity (owned - equipped)
  const collapsed = {};
  for (const it of normalizedInventory) {
    if (!collapsed[it.id]) collapsed[it.id] = { ...it };
    else collapsed[it.id].qty += it.qty || 1;
  }
  const availableItems = Object.values(collapsed)
    .map(it => ({ ...it, remaining: Math.max(0, (it.qty || 0) - (equippedCounts[it.id] || 0)) }))
    .filter(it => it.remaining > 0);

  // Resolve inventory/equipped entry to full item doc if possible
  const resolveItemDoc = (entry) => {
    if (!entry) return null;
    // Entries already contain full specifics; if it's a string, we can't resolve further
    return typeof entry === 'object' ? entry : null;
  };

  // Render a single slot cell (side used for beam direction)
  const renderSlot = (slotKey, side) => {
    if (!slotKey) return <div />;
    const def = SLOT_MAP[slotKey];
    if (!def) return <div />;
    const { label, icon: Icon } = def;
    const item = equipped?.[slotKey];
    const itemDoc = resolveItemDoc(item);
    const imgUrl = itemDoc?.General?.image_url || item?.General?.image_url;
    return (
      <div key={slotKey} className="group relative">
        <div
          className={`relative h-24 w-full rounded-xl border transition-all flex flex-col items-center justify-center text-center cursor-pointer select-none
            ${item ? 'border-indigo-500/60 bg-indigo-500/10 hover:border-indigo-300/80' : 'border-slate-600/60 bg-slate-800/40 hover:border-slate-400/70'}
          `}
          onClick={() => item ? handleUnequip(slotKey) : openEquipModal(slotKey)}
          title={item ? `Click to unequip ${item.name || item}` : `Equip ${label}`}
        >
          {item && imgUrl ? (
            <div className="h-10 w-10 mb-1 rounded-lg overflow-hidden border border-indigo-400/40 bg-slate-900/40 shadow-inner">
              <img src={imgUrl} alt={typeof item === 'string' ? (item) : (item.name || item?.General?.Nome || item.id)} className="h-full w-full object-contain" />
            </div>
          ) : (
            <Icon className={`w-6 h-6 mb-1 ${item ? 'text-indigo-300 drop-shadow' : 'text-slate-500 group-hover:text-slate-300'}`} />
          )}
          <span className="text-[10px] uppercase tracking-wide text-slate-300 leading-tight px-1 text-center whitespace-normal">{label}</span>
          {!item && <Silhouette />}
      {item && (
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
        <span className="text-[9px] text-emerald-300 font-medium max-w-full truncate px-1">{(typeof item === 'string' ? (item) : (item.name || item?.General?.Nome || item.id))}</span>
            </div>
          )}
          {item && itemDoc && (
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewItem(itemDoc); }}
              className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-900/70 border border-slate-600/60 text-slate-300 hover:border-slate-400/60"
              title="Dettagli"
            >
              i
            </button>
          )}
          {item && side === 'left' && (
            <div className="pointer-events-none absolute top-1/2 left-full -translate-y-1/2 h-px w-[86px] bg-gradient-to-r from-indigo-400/0 via-indigo-400/70 to-fuchsia-400/0 drop-shadow-[0_0_4px_rgba(129,140,248,0.6)]" />
          )}
          {item && side === 'right' && (
            <div className="pointer-events-none absolute top-1/2 right-full -translate-y-1/2 h-px w-[86px] bg-gradient-to-l from-indigo-400/0 via-fuchsia-400/70 to-indigo-400/0 drop-shadow-[0_0_4px_rgba(217,70,239,0.6)]" />
          )}
        </div>
      </div>
    );
  };

  // Decorative middle column element replacing textual body part labels
  const CharSilhouette = () => (
    <div className="flex items-center justify-center">
  <div className="relative h-24 w-32 flex items-center justify-center">
        {/* Vertical energy pillar */}
        <div className="absolute inset-x-[48%] top-2 bottom-2 bg-gradient-to-b from-indigo-400/40 via-fuchsia-400/20 to-transparent rounded-full blur-[2px]" />
        <div className="absolute inset-x-[47%] top-4 bottom-4 bg-gradient-to-b from-transparent via-indigo-500/30 to-fuchsia-500/30 rounded-full blur-[6px] opacity-70 animate-pulse" />
        {/* Soft concentric glow */}
        <div className="absolute w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30 blur-xl opacity-50" />
        <div className="absolute w-6 h-6 rounded-full bg-gradient-to-br from-fuchsia-400/40 to-transparent blur-md opacity-70 animate-ping" />
        {/* Subtle dotted spine */}
        <div className="absolute inset-y-3 flex flex-col justify-between">
          {[...Array(5)].map((_, i) => (
            <span key={i} className="block w-1 h-1 rounded-full bg-slate-400/30" />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative h-full flex flex-col backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg overflow-hidden">
      <div className="absolute -left-16 -top-16 w-52 h-52 bg-indigo-500/10 rounded-full blur-3xl" />
      <div className="absolute -right-10 -bottom-24 w-64 h-64 bg-fuchsia-500/10 rounded-full blur-3xl" />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-center justify-center relative">
          <h2 className="text-base font-semibold tracking-wide text-slate-200">Oggetti Equipaggiati</h2>
          {loading && <span className="absolute right-0 text-[10px] text-slate-400 animate-pulse">salvataggio…</span>}
        </div>
  <div className="mx-auto">
          <div className="grid gap-4" style={{ gridTemplateColumns: '90px 140px 90px' }}>
            {LAYOUT_ROWS.map(([left, part, right], i) => (
              <React.Fragment key={i}>
                {renderSlot(left, 'left')}
                <CharSilhouette part={part} />
                {renderSlot(right, 'right')}
              </React.Fragment>
            ))}
          </div>
  </div>
      </div>

      {activeSlot && (
        <Modal title={`Equip ${SLOT_MAP[activeSlot]?.label || ''}`} onClose={() => setActiveSlot(null)}>
          {availableItems.length ? (
            <ul className="space-y-2">
              {availableItems.map((it, idx) => {
                const name = it.name || it.id || `Item ${idx + 1}`;
                const rarity = it?.rarity;
                const qty = it?.qty || 1;
                const remaining = it.remaining != null ? it.remaining : qty; // fallback
                const docObj = resolveItemDoc(it);
                const imgUrl = docObj?.General?.image_url || it?.General?.image_url;
                return (
                  <li key={it.id + idx}>
                    <div className="w-full px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-600/50 flex items-center justify-between gap-2">
                      {imgUrl && (
                        <div className="h-8 w-8 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50 mr-2">
                          <img src={imgUrl} alt={name} className="h-full w-full object-contain" />
                        </div>
                      )}
                      <button
                        onClick={() => handleEquip(it)}
                        className="flex-1 text-left hover:bg-slate-700/60 rounded-md px-2 py-1 transition"
                      >
                        <span className="text-sm text-slate-200 truncate">{name}{qty > 1 && <span className="ml-2 text-[10px] text-amber-300">x{qty}</span>}{remaining !== qty && <span className="ml-2 text-[10px] text-emerald-300">(resta {remaining})</span>}</span>
                        <div className="flex items-center gap-2 mt-1">
                          {rarity && <span className="text-[10px] uppercase tracking-wide text-fuchsia-300">{rarity}</span>}
                        </div>
                      </button>
                      <button
                        onClick={() => setPreviewItem(docObj)}
                        className="shrink-0 text-[11px] px-2 py-1 rounded-md bg-slate-900/60 border border-slate-600/60 text-slate-300 hover:border-slate-400/60"
                        title="Dettagli"
                      >
                        Dettagli
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-xs text-slate-400">No available items in inventory.</div>
          )}
        </Modal>
      )}

      {previewItem && (
        <ItemDetailsModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
    </div>
  );
};

export default EquippedInventory;
