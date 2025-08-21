import React, { useEffect, useState, useContext } from 'react';
import { AuthContext } from '../../../AuthContext';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { FaTimes } from 'react-icons/fa';
import { GiChestArmor, GiBoots, GiGloves, GiBroadsword, GiShield, GiRing, GiEmeraldNecklace } from 'react-icons/gi';

// Slot metadata (icon + label) retained; layout will be Diablo-like around a silhouette
const SLOT_DEFS = [
  { key: 'headArmor', label: 'Head Armor', icon: GiEmeraldNecklace },
  { key: 'chestArmor', label: 'Chest Armor', icon: GiChestArmor },
  { key: 'cintura', label: 'Cintura', icon: GiEmeraldNecklace },
  { key: 'beltExtra', label: 'Belt', icon: GiRing },
  { key: 'stivali', label: 'Stivali', icon: GiBoots },
  { key: 'weaponMain', label: 'Main Hand', icon: GiBroadsword },
  { key: 'weaponOff', label: 'Off Hand', icon: GiShield },
  { key: 'foderoArma', label: 'Fodero Arma', icon: GiBroadsword },
  { key: 'accessorio', label: 'Accessorio', icon: GiRing },
];

const SLOT_MAP = SLOT_DEFS.reduce((acc, s) => { acc[s.key] = s; return acc; }, {});

// Layout rows: [leftSlot, bodyPart, rightSlot]
const LAYOUT_ROWS = [
  ['headArmor', 'head', 'accessorio'],
  ['chestArmor', 'torso', 'weaponMain'],
  ['cintura', 'waist', 'weaponOff'],
  ['beltExtra', 'legs', 'foderoArma'],
  ['stivali', 'feet', null],
];

// Fallback silhouette element
const Silhouette = () => (
  <div className="absolute inset-0 flex items-center justify-center text-slate-700/50 select-none text-[8px] tracking-wider">
    EMPTY
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
  const equippedSet = new Set(Object.values(equipped || {}).filter(Boolean).map(i => typeof i === 'string' ? i : i?.id || i?.name));
  const availableItems = inventory.filter(it => {
    const key = typeof it === 'string' ? it : it?.id || it?.name;
    return key && !equippedSet.has(key);
  });

  // Render a single slot cell
  const renderSlot = (slotKey) => {
    if (!slotKey) return <div />;
    const def = SLOT_MAP[slotKey];
    if (!def) return <div />;
    const { label, icon: Icon } = def;
    const item = equipped?.[slotKey];
    return (
      <div key={slotKey} className="group relative">
        <div
          className={`relative h-20 w-full rounded-xl border transition-all flex flex-col items-center justify-center text-center cursor-pointer select-none
            ${item ? 'border-indigo-500/60 bg-indigo-500/10 hover:border-indigo-300/80' : 'border-slate-600/60 bg-slate-800/40 hover:border-slate-400/70'}
          `}
          onClick={() => item ? handleUnequip(slotKey) : openEquipModal(slotKey)}
          title={item ? `Click to unequip ${item.name || item}` : `Equip ${label}`}
        >
          <Icon className={`w-6 h-6 mb-1 ${item ? 'text-indigo-300 drop-shadow' : 'text-slate-500 group-hover:text-slate-300'}`} />
          <span className="text-[10px] uppercase tracking-wide text-slate-300 leading-none line-clamp-1 px-1">{label}</span>
          {!item && <Silhouette />}
          {item && (
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
              <span className="text-[9px] text-emerald-300 font-medium max-w-full truncate px-1">{item.name || item}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const CharSilhouette = ({ part }) => (
    <div className="flex items-center justify-center">
      <div className="relative h-20 w-28 flex items-center justify-center">
        <div className="absolute inset-0 opacity-10 bg-gradient-to-b from-indigo-400/40 to-fuchsia-400/40 rounded-full blur-md" />
        <div className="text-[10px] tracking-wider text-slate-500 uppercase select-none">{part}</div>
      </div>
    </div>
  );

  return (
    <div className="relative backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg overflow-hidden">
      <div className="absolute -left-16 -top-16 w-52 h-52 bg-indigo-500/10 rounded-full blur-3xl" />
      <div className="absolute -right-10 -bottom-24 w-64 h-64 bg-fuchsia-500/10 rounded-full blur-3xl" />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">Equipped Items</h2>
          {loading && <span className="text-[10px] text-slate-400 animate-pulse">saving…</span>}
        </div>
        <div className="mx-auto">
          <div className="grid gap-4" style={{ gridTemplateColumns: '90px 140px 90px' }}>
            {LAYOUT_ROWS.map(([left, part, right], i) => (
              <React.Fragment key={i}>
                {renderSlot(left)}
                <CharSilhouette part={part} />
                {renderSlot(right)}
              </React.Fragment>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">Click empty slot to equip; click equipped slot to unequip.</p>
      </div>

      {activeSlot && (
        <Modal title={`Equip ${SLOT_MAP[activeSlot]?.label || ''}`} onClose={() => setActiveSlot(null)}>
          {availableItems.length ? (
            <ul className="space-y-2">
              {availableItems.map((it, idx) => {
                const name = typeof it === 'string' ? it : it?.name || `Item ${idx + 1}`;
                const rarity = typeof it === 'object' ? it?.rarity : null;
                return (
                  <li key={name + idx}>
                    <button
                      onClick={() => handleEquip(it)}
                      className="w-full text-left px-3 py-2 rounded-lg bg-slate-800/70 hover:bg-slate-700/70 border border-slate-600/50 hover:border-slate-400/50 transition flex items-center justify-between"
                    >
                      <span className="text-sm text-slate-200 truncate">{name}</span>
                      {rarity && <span className="text-[10px] uppercase tracking-wide text-fuchsia-300">{rarity}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-xs text-slate-400">No available items in inventory.</div>
          )}
        </Modal>
      )}
    </div>
  );
};

export default EquippedInventory;
