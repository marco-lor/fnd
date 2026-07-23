import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../../../AuthContext';
import { FaTimes } from 'react-icons/fa';
import { GiChestArmor, GiBroadsword, GiShield, GiRing, GiCrackedHelm, GiBlackBelt, GiSteeltoeBoots, GiScabbard, GiPotionBall, GiDrinkMe } from 'react-icons/gi';
import {
  LazyConfirmUseConsumableModal as ConfirmUseConsumableModal,
  LazyItemDetailsModal as ItemDetailsModal,
} from './lazyHomeFeatures';
// Utility (not a React hook) renamed locally to avoid hook lint rule triggering.
import consumeConsumable from './useConsumable';
import {
  useEquipment,
  useInventory,
  useProgression,
  useResources,
} from '../../../data/userData/userDataHooks';
import { setEquipment } from '../../../data/userData/userDataCommands';
import { legacySetEquipment } from '../../../data/userData/legacyUserDataCommands';
import {
  isUserDataCommandStageResolved,
  runVersionedUserDataCommand,
} from '../../../data/userData/userDataCommandRouting';
import { increment } from '../../../performance/firestore';
import { computeValue } from '../../common/computeFormula';
import { stableUserDataJson } from '../../../data/userData/legacyInventoryProjection';
import { buildAvailableEquipmentInventory } from './equipmentInventoryProjection';

// Slot metadata (icon + label) retained; layout will be Diablo-like around a silhouette
const SLOT_DEFS = [
  { key: 'headArmor', label: 'Testa', icon: GiCrackedHelm },
  { key: 'chestArmor', label: 'Corpo', icon: GiChestArmor },
  { key: 'cintura', label: 'Cintura', icon: GiBlackBelt },
  { key: 'stivali', label: 'Stivali', icon: GiSteeltoeBoots },
  { key: 'weaponMain', label: 'Mano Principale', icon: GiBroadsword },
  { key: 'weaponOff', label: 'Mano Secondaria', icon: GiShield },
  // IMPORTANT: label must match Firestore General.Slot exactly ("Fodero")
  { key: 'foderoArma', label: 'Fodero', icon: GiScabbard },
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
  const { user } = useAuthSession();
  const {
    data: equipment,
    stage: equipmentStage,
    status: equipmentStatus,
    uid: equipmentUid,
  } = useEquipment(user?.uid);
  const {
    data: inventoryData,
    status: inventoryStatus,
    uid: inventoryUid,
  } = useInventory(user?.uid);
  const {
    data: progression,
    status: progressionStatus,
    uid: progressionUid,
  } = useProgression(user?.uid);
  const {
    data: resources,
    status: resourcesStatus,
    uid: resourcesUid,
  } = useResources(user?.uid);
  const equipmentReady = equipmentStatus === 'fresh'
    && equipment !== null
    && equipmentUid === user?.uid
    && isUserDataCommandStageResolved(equipmentStage);
  const inventoryReady = inventoryStatus === 'fresh'
    && inventoryData !== null
    && inventoryUid === user?.uid;
  const progressionReady = progressionStatus === 'fresh'
    && progression !== null
    && progressionUid === user?.uid;
  const resourcesReady = resourcesStatus === 'fresh'
    && resources !== null
    && resourcesUid === user?.uid;
  const equipmentMutationsReady = equipmentReady && inventoryReady && progressionReady && resourcesReady;
  const inventory = useMemo(() => inventoryData || [], [inventoryData]);
  const inventoryById = useMemo(() => Object.fromEntries(inventory.map((entry) => [
    entry?._task05?.inventoryId || entry?._instance?.instanceId,
    entry,
  ]).filter(([id]) => id)), [inventory]);
  const equipped = useMemo(() => {
    const candidates = [...inventory];
    const usedIds = new Set();
    const comparableSnapshot = (entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const snapshot = { ...entry };
      delete snapshot._instance;
      delete snapshot._task05;
      delete snapshot.qty;
      delete snapshot.quantity;
      return snapshot;
    };
    const resolveEntry = (value) => {
      if (typeof value === 'string') return inventoryById[value] || value;
      if (!value || typeof value !== 'object') return value;
      const requestedId = value?._instance?.instanceId;
      if (requestedId && inventoryById[requestedId]) return inventoryById[requestedId];
      const serialized = stableUserDataJson(comparableSnapshot(value));
      let candidate = candidates.find((entry) => {
        const id = entry?._task05?.inventoryId || entry?._instance?.instanceId;
        return !usedIds.has(id) && stableUserDataJson(comparableSnapshot(entry)) === serialized;
      });
      if (!candidate) {
        const catalogId = value.id || value.itemId;
        candidate = candidates.find((entry) => {
          const id = entry?._task05?.inventoryId || entry?._instance?.instanceId;
          return !usedIds.has(id) && (entry.id === catalogId || entry.itemId === catalogId);
        });
      }
      const resolvedId = candidate?._task05?.inventoryId || candidate?._instance?.instanceId;
      if (resolvedId) usedIds.add(resolvedId);
      return candidate || value;
    };
    return Object.fromEntries(Object.entries(
      equipment?.slots || equipment?.equipped || {}
    ).map(([slot, value]) => [slot, resolveEntry(value)]));
  }, [equipment, inventory, inventoryById]);
  const userData = useMemo(() => ({
    ...(progression || {}),
    ...(resources || {}),
    stats: { ...(progression?.stats || {}), ...(resources?.stats || {}) },
  }), [progression, resources]);
  const [activeSlot, setActiveSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  // Full item specifics now come from user's inventory/equipped entries directly
  const [previewItem, setPreviewItem] = useState(null); // item object to show in details modal
  const [confirmUse, setConfirmUse] = useState(null); // { slotKey, itemDoc }
  const [usingConsumable, setUsingConsumable] = useState(false);
  const [equipError, setEquipError] = useState('');

  useEffect(() => {
    setActiveSlot(null);
    setConfirmUse(null);
    setPreviewItem(null);
  }, [user?.uid]);

  // Keep the legacy aggregate's equipment-derived Parametri behavior intact
  // until the authoritative equipment command is enabled for this user.
  const getDefaultLevelKey = () => {
    const thresholds = [1, 4, 7, 10];
    const userLevel = Number(userData?.stats?.level || 1);
    for (let i = thresholds.length - 1; i >= 0; i -= 1) {
      if (userLevel >= thresholds[i]) return String(thresholds[i]);
    }
    return '1';
  };
  const isDice = (value) => typeof value === 'string' && /\b\d+d\d+\b/i.test(value);
  const looksLikeFormula = (value) => {
    if (typeof value !== 'string' || isDice(value)) return false;
    return /[+\-*/()]|\bMAX\b|\bMIN\b|[A-Za-z]/i.test(value);
  };
  const asNumber = (value) => {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const buildEquipDeltaFromItem = (item, sign = 1) => {
    const updates = {};
    if (!item || typeof item !== 'object') return updates;
    const params = item.Parametri || {};
    const levelKey = getDefaultLevelKey();
    const userParams = userData?.Parametri;
    ['Base', 'Combattimento', 'Special'].forEach((groupName) => {
      const group = params[groupName];
      if (!group || typeof group !== 'object') return;
      Object.entries(group).forEach(([stat, levels]) => {
        const raw = levels?.[levelKey];
        if (raw == null || String(raw).trim() === '') return;
        let value = 0;
        if (looksLikeFormula(raw) && userParams) {
          const computed = computeValue(String(raw), userParams);
          value = Number.isFinite(computed) ? computed : 0;
        } else if (!isDice(raw)) {
          value = asNumber(raw);
        }
        if (value) updates[`Parametri.${groupName}.${stat}.Equip`] = increment(sign * value);
      });
    });
    return updates;
  };
  const executeEquipmentMutation = useCallback(({ slot, item, inventoryId, parameterUpdates }) => (
    runVersionedUserDataCommand({
      stage: equipmentMutationsReady ? equipmentStage : null,
      legacy: () => legacySetEquipment({ uid: user.uid, slot, item, parameterUpdates }),
      authoritative: () => setEquipment({ slot, inventoryId }),
    })
  ), [equipmentMutationsReady, equipmentStage, user]);

  // --- Belt (Cintura) helpers: dynamic consumable slots --------------------
  // Capacity comes from equipped belt item Specific.slotCintura
  // Any number >= 1 is rendered; 99 means unlimited but UI should not render anything.
  const getBeltInfo = () => {
    const beltEntry = equipped?.cintura;
    const beltObj = beltEntry && typeof beltEntry === 'object' ? beltEntry : null;
    const n = Number(beltObj?.Specific?.slotCintura);
    if (!Number.isFinite(n)) return { capacity: 0, unlimited: false };
    if (n === 99) return { capacity: 0, unlimited: true };
    const cap = Math.max(0, Math.floor(n));
    return { capacity: cap, unlimited: false };
  };
  const { capacity: beltCapacity, unlimited: beltUnlimited } = getBeltInfo();
  const getBeltSlotKeys = (cap) => Array.from({ length: cap }, (_, i) => `beltC${i + 1}`);
  const beltSlotKeys = getBeltSlotKeys(beltCapacity);

  // When capacity decreases, automatically clear extra equipped consumables beyond capacity
  useEffect(() => {
    if (!user || !equipmentMutationsReady) return;
    const cap = beltCapacity;
    if (!equipped) return;
    if (beltUnlimited) return; // sentinel 99: keep whatever is stored; UI just hides
    const updates = {};
    let needs = false;
    Object.keys(equipped).forEach((k) => {
      const m = /^beltC(\d+)$/.exec(k);
      if (!m) return;
      const idx = parseInt(m[1], 10);
      if (!Number.isFinite(idx)) return;
      if (cap === 0 || idx > cap) {
        if (equipped[k]) {
          updates[`equipped.${k}`] = null;
          needs = true;
        }
      }
    });
    if (needs) {
      Promise.all(Object.keys(updates).map((path) => executeEquipmentMutation({
        slot: path.replace(/^equipped\./, ''),
        item: null,
        inventoryId: null,
      }))).catch(console.error);
    }
  }, [beltCapacity, beltUnlimited, user, equipped, executeEquipmentMutation, equipmentMutationsReady]);

  const handleUnequip = async (slotKey) => {
    if (!user || !equipmentMutationsReady) return;
    setLoading(true);
    try {
      const previousItem = equipped?.[slotKey];
      const parameterUpdates = buildEquipDeltaFromItem(
        resolveItemDoc(previousItem) || previousItem,
        -1
      );
      await executeEquipmentMutation({
        slot: slotKey,
        item: null,
        inventoryId: null,
        parameterUpdates,
      });
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const openEquipModal = (slotKey) => {
  setEquipError('');
  setActiveSlot(slotKey);
  };

  const handleEquip = async (item) => {
    if (!user || !activeSlot || !equipmentMutationsReady) return;
    setLoading(true);
    try {
      // Validate item-slot compatibility before saving
      const toCheck = resolveItemDoc(item) || item;
      if (!isItemCompatibleWithSlot(toCheck, activeSlot)) {
        setEquipError('Oggetto non compatibile con questo slot');
  setLoading(false);
  return;
      }
      // Validate two-handed constraints
      if (!canEquipUnderTwoHConstraints(toCheck, activeSlot)) {
        setEquipError('Non è possibile: arma a due mani richiede entrambe le mani libere');
  setLoading(false);
  return;
      }
      const inventoryId = item?._task05?.inventoryId || item?._instance?.instanceId;
      if (!inventoryId) throw new Error('Inventory item is missing its stable instance ID.');
      const previousItem = equipped?.[activeSlot];
      const subtractPrevious = buildEquipDeltaFromItem(
        resolveItemDoc(previousItem) || previousItem,
        -1
      );
      const addNext = buildEquipDeltaFromItem(toCheck, 1);
      await executeEquipmentMutation({
        slot: activeSlot,
        item,
        inventoryId,
        parameterUpdates: { ...subtractPrevious, ...addNext },
      });
    } catch (e) { console.error(e); }
    setLoading(false);
    setActiveSlot(null);
  };

  // Build available inventory by exact instance identity. Catalog IDs remain a
  // compatibility fallback only for unresolved legacy equipment values.
  const expandedAvailable = buildAvailableEquipmentInventory({ inventory, equipped });

  // Inventory consumables (for unlimited belt case: slotCintura === 99)
  const inventoryConsumables = React.useMemo(() => {
    return (inventory || []).filter(entry => {
      if (!entry || typeof entry !== 'object') return false;
      const t = (entry.type || entry.item_type || '').toLowerCase();
      return t === 'consumabile';
    }).map(entry => {
      const id = entry.id || entry.name || entry?.General?.Nome;
      const name = entry?.General?.Nome || entry.name || id;
      const qty = typeof entry.qty === 'number' ? Math.max(1, entry.qty) : 1;
      const imgUrl = entry?.General?.image_url;
      return { ...entry, id, name, qty, imgUrl };
    });
  }, [inventory]);

  // Resolve inventory/equipped entry to full item doc if possible
  const resolveItemDoc = (entry) => {
    if (!entry) return null;
    // Entries already contain full specifics; if it's a string, we can't resolve further
    return typeof entry === 'object' ? entry : null;
  };

  // Slot helpers must precede hands helpers as they are used by two-handed logic

  // Helpers to enforce slot compatibility
  const getItemSlotValues = (entry) => {
    const obj = resolveItemDoc(entry) || entry;
    const s = obj?.General?.Slot;
    if (Array.isArray(s)) return s.filter(Boolean).map(String);
    if (typeof s === 'string') return [s];
    return [];
  };

  // Interpret special slot strings: "Doppia Mano" and "Mano Principale/Mano Secondaria"
  const normalizeSlotForWeapon = (slotStr) => {
    if (typeof slotStr !== 'string') return { allowed: [slotStr], twoHandedBySlot: false };
    const s = slotStr.trim();
    const sl = s.toLowerCase();
    const has = (needle) => sl.includes(needle);
    // Broader detection of interchangeable main/off-hand wording.
    // Previous logic required the exact substring "mano secondaria" or "principale/secondaria".
    // Items coming from the DB can have variants like:
    //   "Mano Principale o Secondaria"
    //   "Mano Principale - Secondaria"
    //   "Mano Principale/Secondaria"
    //   "Mano Principale oppure Secondaria"
    // or may omit the second "mano" word ("... o Secondaria").
    // We treat any string containing the phrase "mano principale" plus an occurrence of "secondaria"
    // (optionally separated by connectors o|oppure|/|-) as an interchangeable one-hand weapon.
    let bothHands = false;
    const containsMainPhrase = /mano\s+principale/.test(sl);
    const containsFullSecondaryPhrase = /mano\s+secondaria/.test(sl);
    const containsSecondaryWord = /\bsecondaria\b/.test(sl);
    const hasConnector = /\b(o|oppure)\b|[/|-]/.test(sl);
    if ((containsMainPhrase && containsFullSecondaryPhrase) ||
        (containsMainPhrase && containsSecondaryWord && hasConnector) ||
        has('principale/secondaria')) {
      bothHands = true;
    }
    const isDoppia = (has('doppia') && has('mano')) || (has('due') && (has('mani') || has('mano')));
    if (isDoppia) {
      return { allowed: ['Mano Principale', 'Mano Secondaria'], twoHandedBySlot: true };
    }
    if (bothHands) {
      return { allowed: ['Mano Principale', 'Mano Secondaria'], twoHandedBySlot: false };
    }
    // Default: return as-is
    return { allowed: [s], twoHandedBySlot: false };
  };

  // Extend slot label resolution for dynamic belt slots
  const slotLabelForDynamic = (slotKey) => {
    if (SLOT_MAP[slotKey]) return SLOT_MAP[slotKey].label;
    if (typeof slotKey === 'string' && slotKey.startsWith('beltC')) return 'Consumabile';
    return undefined;
  };

  const isItemCompatibleWithSlot = (entry, slotKey) => {
    const label = slotLabelForDynamic(slotKey);
    if (!label) return false;
    const slots = getItemSlotValues(entry);
    for (const raw of slots) {
      const { allowed } = normalizeSlotForWeapon(raw);
      if (allowed.includes(label)) return true;
    }
    return false;
  };

  // Hands helpers (2-handed weapons management)
  const getHands = (entry) => {
    const obj = resolveItemDoc(entry) || entry;
    const v = obj?.Specific?.Hands ?? obj?.hands ?? obj?.Hands;
    if (v == null) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  };
  const isTwoHanded = (entry) => {
    // Two-handed by explicit hands or by slot name semantics (Doppia Mano)
    const hands = getHands(entry);
    if (hands === 2) return true;
    const slots = getItemSlotValues(entry);
    return slots.some(s => normalizeSlotForWeapon(s).twoHandedBySlot);
  };
  const twoHandedInMain = isTwoHanded(equipped?.weaponMain);
  const twoHandedInOff = isTwoHanded(equipped?.weaponOff);
  const isDisabledByTwoH = (slotKey) => {
    if (slotKey === 'weaponMain') return !!twoHandedInOff;
    if (slotKey === 'weaponOff') return !!twoHandedInMain;
    return false;
  };

  // Can the given item be equipped in targetSlot wrt 2H constraints?
  const canEquipUnderTwoHConstraints = (item, targetSlot) => {
    if (targetSlot !== 'weaponMain' && targetSlot !== 'weaponOff') return true;
    const other = targetSlot === 'weaponMain' ? 'weaponOff' : 'weaponMain';
    const otherItem = equipped?.[other];
    const otherIsTwoH = isTwoHanded(otherItem);
    const hands = getHands(item);
    if (otherIsTwoH) return false; // other slot occupied by 2H -> blocked
    if (hands === 2) {
      // Equipping a 2H requires other hand to be free
      return !otherItem;
    }
    return true;
  };

  // Render a single slot cell (side used for beam direction)
  const renderSlot = (slotKey, side) => {
    if (!slotKey) return <div />;
    // Allow dynamic belt slots: default label/icon when not in SLOT_MAP
    const def = SLOT_MAP[slotKey];
    const label = def?.label ?? slotLabelForDynamic(slotKey);
  const Icon = def?.icon ?? GiPotionBall;
    if (!label) return <div />;
  const item = equipped?.[slotKey];
    const itemDoc = resolveItemDoc(item);
    const imgUrl = itemDoc?.General?.image_url || item?.General?.image_url;
    const blocked = (isDisabledByTwoH(slotKey) && !item) || !equipmentMutationsReady;
    return (
      <div key={slotKey} className="group relative">
        <div
          className={`relative h-24 w-full rounded-xl border transition-all flex flex-col items-center justify-center text-center cursor-pointer select-none
            ${item ? 'border-indigo-500/60 bg-indigo-500/10 hover:border-indigo-300/80' : 'border-slate-600/60 bg-slate-800/40 hover:border-slate-400/70'}
            ${blocked ? '!cursor-not-allowed opacity-60 hover:border-slate-600/60' : ''}
          `}
          onClick={() => {
            if (blocked) return;
            item ? handleUnequip(slotKey) : openEquipModal(slotKey)
          }}
          title={blocked ? 'Bloccato: arma a due mani equipaggiata nell\'altra mano' : (item ? `Click to unequip ${item.name || item}` : `Equip ${label}`)}
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
          {blocked && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-slate-900/80 backdrop-blur-sm border border-rose-400/30 text-center px-2">
              <span className="text-[10px] uppercase tracking-wide text-rose-200">Bloccato</span>
              <span className="text-xs font-semibold text-rose-300">2 Mani</span>
              <span className="mt-1 text-[9px] text-slate-300/80">Libera l'altra mano</span>
            </div>
          )}
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
          {/* Use consumable button (only for belt consumable slots) */}
          {item && itemDoc && /^beltC\d+$/.test(slotKey) && (itemDoc.type === 'consumabile' || (itemDoc.item_type || '').toLowerCase() === 'consumabile') && (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmUse({ slotKey, itemDoc }); }}
              disabled={usingConsumable || !equipmentMutationsReady}
              className={`absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 border transition
                ${usingConsumable ? 'border-emerald-800/40 bg-emerald-900/40 text-emerald-700 cursor-not-allowed' : 'border-emerald-400/50 bg-emerald-600/20 text-emerald-200 hover:border-emerald-300/70 hover:bg-emerald-600/30'}
              `}
              title={usingConsumable ? 'In uso…' : 'Usa consumabile'}
            >
              <GiDrinkMe className="w-3 h-3" />
              Usa
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

  {/* Belt (Cintura) consumable slots */}
  {beltCapacity > 0 && !beltUnlimited && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-slate-400">Cintura: Consumabili</p>
            <span className="text-[10px] text-slate-500">{beltCapacity} slot</span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${beltCapacity}, minmax(72px, 1fr))` }}>
            {beltSlotKeys.map((k) => (
              <div key={k}>{renderSlot(k)}</div>
            ))}
          </div>
        </div>
      )}

      {/* Unlimited belt: render direct inventory consumables with Use button */}
      {beltUnlimited && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-slate-400">Consumabili (Cintura Illimitata)</p>
            <span className="text-[10px] text-slate-500">{inventoryConsumables.length}</span>
          </div>
          {inventoryConsumables.length === 0 ? (
            <div className="text-[11px] text-slate-500">Nessun consumabile in inventario.</div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
              {inventoryConsumables.map((c) => (
                <div key={c.id} className="group relative h-28 rounded-xl border border-slate-600/50 bg-slate-800/40 p-2 flex flex-col items-center justify-between">
                  <div className="flex flex-col items-center gap-1 w-full">
                    {c.imgUrl ? (
                      <div className="h-10 w-10 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/40">
                        <img src={c.imgUrl} alt={c.name} className="h-full w-full object-contain" />
                      </div>
                    ) : (
                      <GiPotionBall className="w-6 h-6 text-slate-400" />
                    )}
                    <span className="text-[10px] text-slate-300 font-medium text-center px-1 truncate w-full" title={c.name}>{c.name}</span>
                    {c.qty > 1 && <span className="text-[9px] text-amber-300">x{c.qty}</span>}
                  </div>
                  <div className="flex items-center gap-2 w-full justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (equipmentMutationsReady) setConfirmUse({ slotKey: null, itemDoc: c });
                      }}
                      disabled={usingConsumable || !equipmentMutationsReady}
                      className={`text-[10px] px-2 py-0.5 rounded flex items-center gap-1 border transition
                        ${usingConsumable ? 'border-emerald-800/40 bg-emerald-900/40 text-emerald-700 cursor-not-allowed' : 'border-emerald-400/50 bg-emerald-600/20 text-emerald-200 hover:border-emerald-300/70 hover:bg-emerald-600/30'}`}
                      title={usingConsumable ? 'In uso…' : 'Usa consumabile'}
                    >
                      <GiDrinkMe className="w-3 h-3" /> Usa
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPreviewItem(c); }}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900/60 border border-slate-600/60 text-slate-300 hover:border-slate-400/60"
                      title="Dettagli"
                    >i</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSlot && (
        <Modal title={`Equip ${slotLabelForDynamic(activeSlot) || ''}`} onClose={() => setActiveSlot(null)}>
          {equipError && (
            <div className="mb-2 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded px-2 py-1">
              {equipError}
            </div>
          )}
          {(() => {
            const compatibleItems = expandedAvailable.filter(it => isItemCompatibleWithSlot(it, activeSlot) && canEquipUnderTwoHConstraints(it, activeSlot));
            return compatibleItems.length ? (
            <ul className="space-y-2">
              {compatibleItems.map((it, idx) => {
                const name = (it.isVarie ? (it.name || it.id) : (it.displayName || it.name || it.id || `Item ${idx + 1}`));
                const rarity = it?.rarity;
                const qty = it?.qty || 1;
                const remaining = it.remaining != null ? it.remaining : qty; // fallback
                const docObj = resolveItemDoc(it);
                const imgUrl = docObj?.General?.image_url || it?.General?.image_url;
                return (
                  <li key={`${it.id}-${idx}`}>
                    <div className="w-full px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-600/50 flex items-center justify-between gap-2">
                      {imgUrl && (
                        <div className="h-8 w-8 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50 mr-2">
                          <img src={imgUrl} alt={name} className="h-full w-full object-contain" />
                        </div>
                      )}
                      <button
                        onClick={() => handleEquip(it)}
                        disabled={!equipmentMutationsReady}
                        className="flex-1 text-left hover:bg-slate-700/60 rounded-md px-2 py-1 transition"
                      >
                        <span className="text-sm text-slate-200 truncate">{name}{(it.isVarie && qty > 1) && <span className="ml-2 text-[10px] text-amber-300">x{qty}</span>}{(it.isVarie && remaining !== qty) && <span className="ml-2 text-[10px] text-emerald-300">(resta {remaining})</span>}</span>
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
              <div className="text-xs text-slate-400">Nessun oggetto compatibile per questo slot.</div>
            );
          })()}
        </Modal>
      )}

      {previewItem && (
        <ItemDetailsModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
      {confirmUse && confirmUse.itemDoc && equipmentMutationsReady && (
        <ConfirmUseConsumableModal
          item={confirmUse.itemDoc}
          userData={userData}
          onCancel={() => setConfirmUse(null)}
          onConfirm={async (mode) => {
            // mode can be 'hp' or 'mana'
            if (!user || !equipmentMutationsReady) return;
            setUsingConsumable(true);
            try {
              await consumeConsumable({
                user,
                userData,
                item: confirmUse.itemDoc,
                slotKey: confirmUse.slotKey,
                mode, // regen target
                stage: equipmentStage,
              });
            } catch (e) {
              console.error('Errore uso consumabile', e);
            } finally {
              setUsingConsumable(false);
              setConfirmUse(null);
            }
          }}
        />
      )}
    </div>
  );
};

export default EquippedInventory;
