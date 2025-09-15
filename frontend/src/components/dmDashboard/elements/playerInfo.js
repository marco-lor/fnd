// frontend/src/components/dmDashboard/elements/playerInfo.js
import React, { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEdit, faTrash, faPlus, faMinus, faCoins } from "@fortawesome/free-solid-svg-icons";
import { library } from "@fortawesome/fontawesome-svg-core";
import { collection, getDocs, doc, getDoc, updateDoc } from "firebase/firestore";
import { db, storage } from "../../firebaseConfig";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

// --- Import Add/Edit/Del Overlays & Buttons ---
import { AddTecnicaPersonaleOverlay, AddTecnicaButton } from "./buttons/addTecnicaPersonale";
import { EditTecnicaPersonale } from "./buttons/editTecnicaPersonale";
import { DelTecnicaPersonale } from "./buttons/delTecnicaPersonale";

import { AddSpellOverlay, AddSpellButton } from "./buttons/addSpell";
import { EditSpellOverlay } from "./buttons/editSpell";
import { DelSpellOverlay } from "./buttons/delSpell";

import AddLinguaPersonale, { AddLinguaPersonaleOverlay } from "./buttons/addLinguaPersonale";
import { DelLinguaPersonaleOverlay } from "./buttons/delLinguaPersonale";

import AddConoscenzaPersonale, { AddConoscenzaPersonaleOverlay } from "./buttons/addConoscenzaPersonale";
import { DelConoscenzaPersonaleOverlay } from "./buttons/delConoscenzaPersonale";
import { EditConoscenzaPersonaleOverlay } from "./buttons/editConoscenzaPersonale";

import AddProfessionePersonale, { AddProfessionePersonaleOverlay } from "./buttons/addProfessionePersonale";
import { DelProfessionePersonaleOverlay } from "./buttons/delProfessionePersonale";
import { EditProfessionePersonaleOverlay } from "./buttons/editProfessionePersonale";
// Bazaar item overlays (for editing inventory items by type)
import { AddWeaponOverlay } from "../../bazaar/elements/addWeapon";
import { AddArmaturaOverlay } from "../../bazaar/elements/addArmatura";
import { AddAccessorioOverlay } from "../../bazaar/elements/addAccessorio";
import { AddConsumabileOverlay } from "../../bazaar/elements/addConsumabile";
// --- End Imports ---

library.add(faEdit, faTrash, faPlus, faMinus, faCoins);

const PlayerInfo = ({ users, loading, error, setUsers }) => {
  // common state
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [showEditConoscenzaOverlay, setShowEditConoscenzaOverlay] = useState(false);
  const [showEditProfessioneOverlay, setShowEditProfessioneOverlay] = useState(false);
  // items catalog (id -> display name)
  const [catalog, setCatalog] = useState({});
  // items docs (id -> full doc incl. item_type)
  const [itemsDocs, setItemsDocs] = useState({});
  // inventory item edit overlay
  const [showEditItemOverlay, setShowEditItemOverlay] = useState(false);
  const [editItemData, setEditItemData] = useState(null);
  const [selectedEditItemId, setSelectedEditItemId] = useState(null);
  const [selectedEditItemIndex, setSelectedEditItemIndex] = useState(null);
  
  // Conoscenza
  const [showConoscenzaOverlay, setShowConoscenzaOverlay] = useState(false);
  const [showDeleteConoscenzaOverlay, setShowDeleteConoscenzaOverlay] = useState(false);
  const [selectedConoscenza, setSelectedConoscenza] = useState(null);
  // Professione
  const [showProfessioneOverlay, setShowProfessioneOverlay] = useState(false);
  const [showDeleteProfessioneOverlay, setShowDeleteProfessioneOverlay] = useState(false);
  const [selectedProfessione, setSelectedProfessione] = useState(null);
  // Tecnica
  const [showTecnicaOverlay, setShowTecnicaOverlay] = useState(false);
  const [showEditTecnicaOverlay, setShowEditTecnicaOverlay] = useState(false);
  const [showDeleteTecnicaOverlay, setShowDeleteTecnicaOverlay] = useState(false);
  const [selectedTecnica, setSelectedTecnica] = useState(null);
  // Spell
  const [showSpellOverlay, setShowSpellOverlay] = useState(false);
  const [showEditSpellOverlay, setShowEditSpellOverlay] = useState(false);
  const [showDeleteSpellOverlay, setShowDeleteSpellOverlay] = useState(false);
  const [selectedSpell, setSelectedSpell] = useState(null);
  // Lingua
  const [showLinguaOverlay, setShowLinguaOverlay] = useState(false);
  const [showDeleteLinguaOverlay, setShowDeleteLinguaOverlay] = useState(false);
  const [selectedLingua, setSelectedLingua] = useState(null);
  const [goldAdjustments, setGoldAdjustments] = useState({});
  const [goldUpdating, setGoldUpdating] = useState({});
  const [goldOverlay, setGoldOverlay] = useState(null);
  // new edit handlers
  const handleEditConoscenzaClick = (userId, name) => {
    setSelectedUserId(userId);
    setSelectedConoscenza(name);
    setShowEditConoscenzaOverlay(true);
  };
  const handleEditProfessioneClick = (userId, name) => {
    setSelectedUserId(userId);
    setSelectedProfessione(name);
    setShowEditProfessioneOverlay(true);
  };

  const openGoldOverlay = (userId, direction) => {
    if (!userId || goldUpdating[userId]) return;
    setGoldAdjustments((prev) => {
      if (Object.prototype.hasOwnProperty.call(prev, userId)) return prev;
      return { ...prev, [userId]: "" };
    });
    const sign = direction > 0 ? 1 : -1;
    setGoldOverlay({ userId, direction: sign });
  };

  const closeGoldOverlay = () => setGoldOverlay(null);

  const handleGoldInputChange = (userId, value) => {
    setGoldAdjustments((prev) => ({ ...prev, [userId]: value }));
  };

  const refreshUserData = async () => {
    try {
      const snapshot = await getDocs(collection(db, "users"));
      const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUsers(usersData);
    } catch (err) {
      console.error("Error refreshing users:", err);
    }
  };
  const adjustUserGold = async (userId, direction) => {
    const rawValue = (goldAdjustments[userId] ?? "").trim();
    const amount = Math.abs(parseInt(rawValue, 10));
    if (!userId || Number.isNaN(amount) || amount === 0) return;
    try {
      setGoldUpdating((prev) => ({ ...prev, [userId]: true }));
      const userDocRef = doc(db, "users", userId);
      const userDocSnap = await getDoc(userDocRef);
      let currentGold = 0;
      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        const existing = data?.stats?.gold;
        currentGold = typeof existing === "number" ? existing : parseInt(existing, 10) || 0;
      }
      const delta = direction > 0 ? amount : -amount;
      const nextGold = currentGold + delta;
      await updateDoc(userDocRef, { "stats.gold": nextGold });
      setGoldAdjustments((prev) => ({ ...prev, [userId]: "" }));
      setGoldOverlay(null);
      await refreshUserData();
    } catch (err) {
      console.error('Failed to update gold', err);
    } finally {
      setGoldUpdating((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  };

  const confirmGoldOverlay = () => {
    if (!goldOverlay) return;
    adjustUserGold(goldOverlay.userId, goldOverlay.direction);
  };

  // Load item catalog once (to resolve inventory string ids to names) and store full docs
  useEffect(() => {
    const loadItems = async () => {
      try {
        const snap = await getDocs(collection(db, "items"));
        const next = {};
        const docs = {};
        snap.forEach(d => {
          const data = d.data();
          next[d.id] = data?.General?.Nome || data?.name || d.id;
          docs[d.id] = { id: d.id, ...data };
        });
        setCatalog(next);
        setItemsDocs(docs);
      } catch (e) {
        console.warn("Failed to load item catalog", e);
      }
    };
    loadItems();
  }, []);

  // Helpers to normalize inventory entries (match client Inventory)
  const deriveId = (e, i) => {
    if (!e) return `item-${i}`;
    if (typeof e === "string") return e;
    return e.id || e.name || e?.General?.Nome || `item-${i}`;
  };
  const toDisplayName = (e, i) => {
    if (!e) return `item-${i}`;
    if (typeof e === "string") return catalog[e] || e;
    // Prefer user-stored name/General.Nome, fallback to catalog name
    return e?.General?.Nome || e.name || catalog[e.id] || deriveId(e, i);
  };

  // --- Handlers to open overlays ---
  const handleAddTecnicaClick = (userId) => {
    setSelectedUserId(userId);
    setShowTecnicaOverlay(true);
  };
  const handleEditTecnicaClick = (userId, name, data) => {
    setSelectedUserId(userId);
    setSelectedTecnica({ name, data });
    setShowEditTecnicaOverlay(true);
  };
  const handleDeleteTecnicaClick = (userId, name, data) => {
    setSelectedUserId(userId);
    setSelectedTecnica({ name, data });
    setShowDeleteTecnicaOverlay(true);
  };

  const handleAddSpellClick = (userId) => {
    setSelectedUserId(userId);
    setShowSpellOverlay(true);
  };
  const handleEditSpellClick = (userId, name, data) => {
    setSelectedUserId(userId);
    setSelectedSpell({ name, data });
    setShowEditSpellOverlay(true);
  };
  const handleDeleteSpellClick = (userId, name, data) => {
    setSelectedUserId(userId);
    setSelectedSpell({ name, data });
    setShowDeleteSpellOverlay(true);
  };

  const handleAddLinguaClick = (userId) => {
    setSelectedUserId(userId);
    setShowLinguaOverlay(true);
  };
  const handleDeleteLinguaClick = (userId, name) => {
    setSelectedUserId(userId);
    setSelectedLingua(name);
    setShowDeleteLinguaOverlay(true);
  };

  const handleAddConoscenzaClick = (userId) => {
    setSelectedUserId(userId);
    setShowConoscenzaOverlay(true);
  };
  const handleDeleteConoscenzaClick = (userId, name) => {
    setSelectedUserId(userId);
    setSelectedConoscenza(name);
    setShowDeleteConoscenzaOverlay(true);
  };

  const handleAddProfessioneClick = (userId) => {
    setSelectedUserId(userId);
    setShowProfessioneOverlay(true);
  };
  const handleDeleteProfessioneClick = (userId, name) => {
    setSelectedUserId(userId);
    setSelectedProfessione(name);
    setShowDeleteProfessioneOverlay(true);
  };
  // Edit inventory item (reuses bazaar overlays based on item_type)
  const handleEditInventoryItem = (userId, itemId, invIndex = null) => {
    const u = users.find(x => x.id === userId);
    // Prefer the user's inventory copy if present (object entry), else fallback to global catalog doc
    let invData = null;
    const invArr = Array.isArray(u?.inventory) ? u.inventory : [];
    if (Number.isInteger(invIndex) && invIndex >= 0 && invIndex < invArr.length) {
      const entry = invArr[invIndex];
      if (entry) invData = entry;
    }
    if (!invData) {
      for (const entry of invArr) {
        if (!entry || typeof entry !== "object") continue;
        const eid = entry.id || entry.name || entry?.General?.Nome;
        if (eid === itemId) { invData = entry; break; }
      }
    }
    const baseDoc = itemsDocs[itemId];
    const initial = invData || baseDoc;
    if (!initial) {
      console.warn("No data found for inventory item id:", itemId);
      return;
    }
    setSelectedUserId(userId);
    setSelectedEditItemId(itemId);
    setSelectedEditItemIndex(Number.isInteger(invIndex) ? invIndex : null);
    setEditItemData(initial);
    setShowEditItemOverlay(true);
  };
  // --- end handlers ---

  if (loading) return <div className="text-white mt-4">Loading user data...</div>;
  if (error)   return <div className="text-red-500 mt-4">{error}</div>;
  if (!users.length) return <div className="text-white mt-4">No users found.</div>;

  const iconEdit = "text-blue-400 hover:text-blue-300 transition transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded";
  const iconDel  = "text-red-500  hover:text-red-400 transition transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-red-600 rounded";
  const sleekBtn  = "w-36 px-2 py-1 bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-700 hover:to-indigo-800 text-white text-xs font-medium rounded-md transition-all duration-150 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 shadow-sm";

  const activeGoldUser = goldOverlay ? users.find((u) => u.id === goldOverlay.userId) : null;
  const activeGoldValue = goldOverlay ? goldAdjustments[goldOverlay.userId] ?? "" : "";
  const activeGoldAmount = goldOverlay ? Math.abs(parseInt(activeGoldValue, 10)) || 0 : 0;
  const activeGoldBusy = goldOverlay ? !!goldUpdating[goldOverlay.userId] : false;
  const activeGoldAction = goldOverlay?.direction > 0 ? "Aggiungi" : "Sottrai";
  const activeGoldConfirmClasses = goldOverlay?.direction > 0
    ? "bg-emerald-600/80 hover:bg-emerald-600"
    : "bg-rose-600/80 hover:bg-rose-600";

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-slate-100 text-xl font-semibold tracking-tight">Player Info</h2>
      {/* Horizontal scroll wrapper so very wide tables don't break layout */}
      <div className="rounded-lg border border-slate-700/60 shadow-sm overflow-x-auto">
        <table className="min-w-max border-collapse text-white bg-gray-800 text-sm">
          <thead className="bg-gray-700/80 backdrop-blur supports-[backdrop-filter]:bg-gray-700/70">
            <tr className="text-slate-100">
              <th className="sticky left-0 z-20 border border-gray-600 px-4 py-2 text-left bg-gray-700/80">Category</th>
              {users.map(u => (
                <th key={u.id} className="border border-gray-600 px-4 py-2 text-center min-w-[11rem]">
                  {u.characterId || u.email}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Actions */}
            <tr className="bg-gray-800 hover:bg-gray-700">
              <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Actions</td>
              {users.map(u => (
                <td key={u.id+"-actions"} className="border border-gray-600 px-4 py-2 text-center">
                  <div className="flex flex-col items-center space-y-1">
                    <AddTecnicaButton onClick={() => handleAddTecnicaClick(u.id)} />
                    <AddSpellButton   onClick={() => handleAddSpellClick(u.id)} />
                    <AddLinguaPersonale
                      className={sleekBtn}
                      onClick={() => handleAddLinguaClick(u.id)}
                    />
                    <AddConoscenzaPersonale
                      className={sleekBtn}
                      onClick={() => handleAddConoscenzaClick(u.id)}
                    />
                    <AddProfessionePersonale
                      className={sleekBtn}
                      onClick={() => handleAddProfessioneClick(u.id)}
                    />
                  </div>
                </td>
              ))}
            </tr>

            {/* Tecniche */}
            <tr className="bg-gray-800 hover:bg-gray-700">
              <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Tecniche</td>
              {users.map(u => (
                <td key={u.id+"-tec"} className="border border-gray-600 px-4 py-2">
                  {u.tecniche && Object.keys(u.tecniche).length
                    ? <ul className="space-y-1">
                        {Object.keys(u.tecniche).map(name => (
                          <li key={name} className="flex justify-between items-center group">
                            <span className="truncate mr-2">{name}</span>
                            <div className="opacity-50 group-hover:opacity-100 space-x-1 flex">
                              <button
                                className={iconEdit}
                                onClick={() => handleEditTecnicaClick(u.id, name, u.tecniche[name])}
                              >
                                <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5"/>
                              </button>
                              <button
                                className={iconDel}
                                onClick={() => handleDeleteTecnicaClick(u.id, name, u.tecniche[name])}
                              >
                                <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5"/>
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    : <span className="text-gray-400 italic text-sm">No tecniche</span>
                  }
                </td>
              ))}
            </tr>

            {/* Spells */}
            <tr className="bg-gray-800 hover:bg-gray-700">
              <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Spells</td>
              {users.map(u => (
                <td key={u.id+"-sp"} className="border border-gray-600 px-4 py-2">
                  {u.spells && Object.keys(u.spells).length
                    ? <ul className="space-y-1">
                        {Object.keys(u.spells).sort((a, b) => a.localeCompare(b)).map(name => (
                          <li key={name} className="flex justify-between items-center group">
                            <span className="truncate mr-2">{name}</span>
                            <div className="opacity-50 group-hover:opacity-100 space-x-1 flex">
                              <button
                                className={iconEdit}
                                onClick={() => handleEditSpellClick(u.id, name, u.spells[name])}
                              >
                                <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5"/>
                              </button>
                              <button
                                className={iconDel}
                                onClick={() => handleDeleteSpellClick(u.id, name, u.spells[name])}
                              >
                                <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5"/>
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    : <span className="text-gray-400 italic text-sm">No spells</span>
                  }
                </td>
              ))}
            </tr>

            {/* Conoscenze */}
            <tr className="bg-gray-800 hover:bg-gray-700">
              <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Conoscenze</td>
              {users.map(u => (
                <td key={u.id+"-co"} className="border border-gray-600 px-4 py-2">
                  {u.conoscenze && Object.keys(u.conoscenze).length
                    ? <ul className="space-y-1">
                        {Object.keys(u.conoscenze).map(name => (
                          <li key={name} className="flex justify-between items-center group">
                            <span className="truncate mr-2">{name} ({u.conoscenze[name].livello})</span>
                            <div className="opacity-50 group-hover:opacity-100 space-x-1 flex">
                              <button
                                className={iconEdit}
                                onClick={() => handleEditConoscenzaClick(u.id, name)}
                              >
                                <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5"/>
                              </button>
                              <button
                                className={iconDel}
                                onClick={() => handleDeleteConoscenzaClick(u.id, name)}
                              >
                                <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5"/>
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    : <span className="text-gray-400 italic text-sm">No conoscenze</span>
                  }
                </td>
              ))}
            </tr>

            {/* Professioni */}
            <tr className="bg-gray-800 hover:bg-gray-700">
              <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Professioni</td>
              {users.map(u => (
                <td key={u.id+"-pr"} className="border border-gray-600 px-4 py-2">
                  {u.professioni && Object.keys(u.professioni).length
                    ? <ul className="space-y-1">
                        {Object.keys(u.professioni).map(name => (
                          <li key={name} className="flex justify-between items-center group">
                            <span className="truncate mr-2">{name} ({u.professioni[name].livello})</span>
                            <div className="opacity-50 group-hover:opacity-100 space-x-1 flex">
                              <button
                                className={iconEdit}
                                onClick={() => handleEditProfessioneClick(u.id, name)}
                              >
                                <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5"/>
                              </button>
                              <button
                                className={iconDel}
                                onClick={() => handleDeleteProfessioneClick(u.id, name)}
                              >
                                <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5"/>
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    : <span className="text-gray-400 italic text-sm">No professioni</span>
                  }
                </td>
              ))}
            </tr>

            {/* Lingue */}
            <tr className="bg-gray-800 hover:bg-gray-700">
              <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Lingue</td>
              {users.map(u => (
                <td key={u.id+"-li"} className="border border-gray-600 px-4 py-2">
                  {u.lingue && Object.keys(u.lingue).length
                    ? <ul className="space-y-1">
                        {Object.keys(u.lingue).map(name => (
                          <li key={name} className="flex justify-between group">
                            <span className="truncate mr-2">{name}</span>
                            <button
                              className={iconDel}
                              onClick={() => handleDeleteLinguaClick(u.id, name)}
                            >
                              <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5"/>
                            </button>
                          </li>
                        ))}
                      </ul>
                    : <span className="text-gray-400 italic text-sm">No lingue</span>
                  }
                </td>
              ))}
            </tr>

            {/* Inventario */}
            <tr className="bg-gray-800 hover:bg-gray-700">
              <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Inventario</td>
              {users.map((u) => {
                const inv = Array.isArray(u?.inventory) ? u.inventory : [];
                // Build non-varie instances (unstacked) and stack only Varie
                const nonVarieInstances = [];
                const varieMap = {};
                for (let i = 0; i < inv.length; i++) {
                  const entry = inv[i];
                  if (!entry) continue;
                  if (typeof entry === 'string') {
                    const id = entry;
                    const name = catalog[id] || id;
                    const type = (itemsDocs[id]?.item_type || itemsDocs[id]?.type || '').toLowerCase();
                    if (type === 'varie') {
                      if (!varieMap[id]) varieMap[id] = { id, name, qty: 0, type: 'varie' };
                      varieMap[id].qty += 1;
                    } else {
                      nonVarieInstances.push({ id, name, type: type || 'oggetto', invIndex: i });
                    }
                    continue;
                  }
                  const id = deriveId(entry, i);
                  const name = toDisplayName(entry, i);
                  const type = (entry.type || itemsDocs[id]?.item_type || itemsDocs[id]?.type || '').toLowerCase();
                  const qty = typeof entry.qty === 'number' ? Math.max(1, entry.qty) : 1;
                  if (type === 'varie') {
                    if (!varieMap[id]) varieMap[id] = { id, name, qty: 0, type: 'varie' };
                    varieMap[id].qty += qty;
                  } else {
                    for (let q = 0; q < qty; q++) {
                      nonVarieInstances.push({ id, name, type: type || 'oggetto', invIndex: i });
                    }
                  }
                }
                // Number duplicates among non-varie by id
                const seen = {};
                const numbered = nonVarieInstances
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(it => {
                    const n = (seen[it.id] = (seen[it.id] || 0) + 1);
                    return { ...it, displayName: n > 1 ? `${it.name} (${n})` : it.name };
                  });
                // Compose final list: unstacked non-varie (implicit qty 1) + stacked varie
                const list = [
                  ...numbered,
                  ...Object.values(varieMap).sort((a, b) => a.name.localeCompare(b.name))
                ];
                const gold = typeof u?.stats?.gold === "number" ? u.stats.gold : parseInt(u?.stats?.gold, 10) || 0;
                const goldBusy = !!goldUpdating[u.id];

                return (
                  <td key={u.id+"-inv"} className="border border-gray-600 px-4 py-2 align-top">
                    <div className="mb-3">
                      <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/60 bg-slate-900/60 px-3 py-1">
                        <div className="flex items-center gap-1 text-sm text-amber-300">
                          <FontAwesomeIcon icon="coins" className="h-4 w-4" />
                          <span>{gold}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-500/70 text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                            onClick={() => openGoldOverlay(u.id, 1)}
                            disabled={goldBusy}
                            title="Aggiungi gold"
                          >
                            <FontAwesomeIcon icon="plus" className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-rose-500/70 text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
                            onClick={() => openGoldOverlay(u.id, -1)}
                            disabled={goldBusy}
                            title="Sottrai gold"
                          >
                            <FontAwesomeIcon icon="minus" className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {list.length ? (
                      <ul className="space-y-1 pr-1">
                        {list.map((it, idx) => {
                          const isVarie = (it.type || '').toLowerCase() === 'varie';
                          const disp = isVarie ? it.name : (it.displayName || it.name);
                          const key = `${it.id}-${isVarie ? 'v' : 'n'}-${idx}`;
                          return (
                            <li key={key} className="flex items-center justify-between text-sm">
                              <span className="truncate mr-2">{disp}{isVarie ? ' (Varie)' : ''}</span>
                              <div className="flex items-center space-x-2">
                                {/* Allow edit only for catalog-backed items or Varie */}
                                {(itemsDocs?.[it.id]?.item_type || isVarie) && (
                                  <button
                                    className={iconEdit}
                                    title="Modifica oggetto"
                                    onClick={() => handleEditInventoryItem(u.id, it.id, isVarie ? null : it.invIndex)}
                                  >
                                    <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {isVarie && (
                                  <span className="text-amber-300 text-xs">x{it.qty}</span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <span className="text-gray-400 italic text-sm">Inventario vuoto</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
  </table>
      </div>

      {goldOverlay && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => !activeGoldBusy && closeGoldOverlay()}
          />
          <div className="relative z-10 w-[18rem] max-w-[90vw] rounded-xl border border-amber-500/50 bg-slate-900/95 p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-amber-200">{activeGoldAction} gold</h3>
            <p className="mt-1 text-xs text-slate-300">{activeGoldUser?.displayName || activeGoldUser?.name || activeGoldUser?.pgName || activeGoldUser?.email || 'Giocatore'}</p>
            <div className="mt-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-amber-300/80">Importo</label>
              <input
                type="number"
                min="0"
                className="w-full rounded-md border border-amber-400/50 bg-slate-900/70 px-3 py-2 text-sm text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-60"
                value={activeGoldValue}
                onChange={(e) => handleGoldInputChange(goldOverlay.userId, e.target.value)}
                disabled={activeGoldBusy}
                autoFocus
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border border-slate-600/70 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/40 disabled:opacity-50"
                onClick={() => !activeGoldBusy && closeGoldOverlay()}
                disabled={activeGoldBusy}
              >
                Annulla
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-xs text-white disabled:opacity-60 ${activeGoldConfirmClasses}`}
                onClick={confirmGoldOverlay}
                disabled={activeGoldBusy || !activeGoldAmount}
              >
                {activeGoldAction}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlays */}
      {showTecnicaOverlay && selectedUserId && (
        <AddTecnicaPersonaleOverlay
          userId={selectedUserId}
          onClose={(ok) => {
            setShowTecnicaOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showEditTecnicaOverlay && selectedUserId && selectedTecnica && (
        <EditTecnicaPersonale
          userId={selectedUserId}
          tecnicaName={selectedTecnica.name}
          tecnicaData={selectedTecnica.data}
          onClose={(ok) => {
            setShowEditTecnicaOverlay(false);
            setSelectedTecnica(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showDeleteTecnicaOverlay && selectedUserId && selectedTecnica && (
        <DelTecnicaPersonale
          userId={selectedUserId}
          tecnicaName={selectedTecnica.name}
          tecnicaData={selectedTecnica.data}
          onClose={(ok) => {
            setShowDeleteTecnicaOverlay(false);
            setSelectedTecnica(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}

      {showSpellOverlay && selectedUserId && (
        <AddSpellOverlay
          userId={selectedUserId}
          onClose={(ok) => {
            setShowSpellOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showEditSpellOverlay && selectedUserId && selectedSpell && (
        <EditSpellOverlay
          userId={selectedUserId}
          spellName={selectedSpell.name}
          spellData={selectedSpell.data}
          onClose={(ok) => {
            setShowEditSpellOverlay(false);
            setSelectedSpell(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showDeleteSpellOverlay && selectedUserId && selectedSpell && (
        <DelSpellOverlay
          userId={selectedUserId}
          spellName={selectedSpell.name}
          spellData={selectedSpell.data}
          onClose={(ok) => {
            setShowDeleteSpellOverlay(false);
            setSelectedSpell(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}

      {showLinguaOverlay && selectedUserId && (
        <AddLinguaPersonaleOverlay
          userId={selectedUserId}
          onClose={(ok) => {
            setShowLinguaOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showDeleteLinguaOverlay && selectedUserId && selectedLingua && (
        <DelLinguaPersonaleOverlay
          userId={selectedUserId}
          linguaName={selectedLingua}
          onClose={(ok) => {
            setShowDeleteLinguaOverlay(false);
            setSelectedLingua(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}

      {showConoscenzaOverlay && selectedUserId && (
        <AddConoscenzaPersonaleOverlay
          userId={selectedUserId}
          onClose={(ok) => {
            setShowConoscenzaOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showDeleteConoscenzaOverlay && selectedUserId && selectedConoscenza && (
        <DelConoscenzaPersonaleOverlay
          userId={selectedUserId}
          conoscenzaName={selectedConoscenza}
          onClose={(ok) => {
            setShowDeleteConoscenzaOverlay(false);
            setSelectedConoscenza(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showEditConoscenzaOverlay && selectedUserId && selectedConoscenza && (
        <EditConoscenzaPersonaleOverlay
          userId={selectedUserId}
          conoscenzaName={selectedConoscenza}
          onClose={(ok) => {
            setShowEditConoscenzaOverlay(false);
            setSelectedConoscenza(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showProfessioneOverlay && selectedUserId && (
        <AddProfessionePersonaleOverlay
          userId={selectedUserId}
          onClose={(ok) => {
            setShowProfessioneOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showDeleteProfessioneOverlay && selectedUserId && selectedProfessione && (
        <DelProfessionePersonaleOverlay
          userId={selectedUserId}
          professioneName={selectedProfessione}
          onClose={(ok) => {
            setShowDeleteProfessioneOverlay(false);
            setSelectedProfessione(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {showEditProfessioneOverlay && selectedUserId && selectedProfessione && (
        <EditProfessionePersonaleOverlay
          userId={selectedUserId}
          professioneName={selectedProfessione}
          onClose={(ok) => {
            setShowEditProfessioneOverlay(false);
            setSelectedProfessione(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {/* Inventory item edit overlay (type-aware) */}
      {showEditItemOverlay && editItemData && (
        <>
    {((editItemData?.type || editItemData?.item_type || '').toLowerCase() === 'varie') ? (
            <EditVarieItemOverlay
              userId={selectedUserId}
              initialData={editItemData}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
              onClose={async (ok) => {
                setShowEditItemOverlay(false);
                setEditItemData(null);
                setSelectedUserId(null);
                setSelectedEditItemIndex(null);
                if (ok) await refreshUserData();
              }}
            />
          ) : editItemData?.item_type === 'armatura' ? (
            <AddArmaturaOverlay
              onClose={(ok) => {
                setShowEditItemOverlay(false);
                setEditItemData(null);
                setSelectedUserId(null);
                setSelectedEditItemIndex(null);
                if (ok) {
                  // reload items to refresh names/types
                  (async () => {
                    try {
                      const snap = await getDocs(collection(db, "items"));
                      const next = {};
                      const docs = {};
                      snap.forEach(d => {
                        const data = d.data();
                        next[d.id] = data?.General?.Nome || data?.name || d.id;
                        docs[d.id] = { id: d.id, ...data };
                      });
                      setCatalog(next);
                      setItemsDocs(docs);
          await refreshUserData();
                    } catch (e) { /* noop */ }
                  })();
                }
              }}
              showMessage={console.log}
              initialData={editItemData}
              editMode={true}
              inventoryEditMode={true}
              inventoryUserId={selectedUserId}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
            />
          ) : editItemData?.item_type === 'accessorio' ? (
            <AddAccessorioOverlay
              onClose={(ok) => {
                setShowEditItemOverlay(false);
                setEditItemData(null);
                setSelectedUserId(null);
                setSelectedEditItemIndex(null);
                if (ok) {
                  (async () => {
                    try {
                      const snap = await getDocs(collection(db, "items"));
                      const next = {};
                      const docs = {};
                      snap.forEach(d => {
                        const data = d.data();
                        next[d.id] = data?.General?.Nome || data?.name || d.id;
                        docs[d.id] = { id: d.id, ...data };
                      });
                      setCatalog(next);
                      setItemsDocs(docs);
          await refreshUserData();
                    } catch (e) { /* noop */ }
                  })();
                }
              }}
              showMessage={console.log}
              initialData={editItemData}
              editMode={true}
              inventoryEditMode={true}
              inventoryUserId={selectedUserId}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
            />
          ) : editItemData?.item_type === 'consumabile' ? (
            <AddConsumabileOverlay
              onClose={(ok) => {
                setShowEditItemOverlay(false);
                setEditItemData(null);
                setSelectedUserId(null);
                setSelectedEditItemIndex(null);
                if (ok) {
                  (async () => {
                    try {
                      const snap = await getDocs(collection(db, "items"));
                      const next = {};
                      const docs = {};
                      snap.forEach(d => {
                        const data = d.data();
                        next[d.id] = data?.General?.Nome || data?.name || d.id;
                        docs[d.id] = { id: d.id, ...data };
                      });
                      setCatalog(next);
                      setItemsDocs(docs);
          await refreshUserData();
                    } catch (e) { /* noop */ }
                  })();
                }
              }}
              showMessage={console.log}
              initialData={editItemData}
              editMode={true}
              inventoryEditMode={true}
              inventoryUserId={selectedUserId}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
            />
          ) : (
            <AddWeaponOverlay
              onClose={(ok) => {
                setShowEditItemOverlay(false);
                setEditItemData(null);
                setSelectedUserId(null);
                setSelectedEditItemIndex(null);
                if (ok) {
                  (async () => {
                    try {
                      const snap = await getDocs(collection(db, "items"));
                      const next = {};
                      const docs = {};
                      snap.forEach(d => {
                        const data = d.data();
                        next[d.id] = data?.General?.Nome || data?.name || d.id;
                        docs[d.id] = { id: d.id, ...data };
                      });
                      setCatalog(next);
                      setItemsDocs(docs);
          await refreshUserData();
                    } catch (e) { /* noop */ }
                  })();
                }
              }}
              showMessage={console.log}
              initialData={editItemData}
              editMode={true}
              inventoryEditMode={true}
              inventoryUserId={selectedUserId}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
            />
          )}
        </>
      )}
  </div>
  );
};

export default PlayerInfo;

// Lightweight overlay to edit Varie items in a user's inventory
export const EditVarieItemOverlay = ({ userId, initialData, inventoryItemId, onClose }) => {
  const [name, setName] = React.useState(initialData?.name || initialData?.General?.Nome || '');
  const [desc, setDesc] = React.useState(initialData?.description || '');
  const [qty, setQty] = React.useState(typeof initialData?.qty === 'number' ? String(initialData.qty) : '1');
  const [busy, setBusy] = React.useState(false);
  const [imageFile, setImageFile] = React.useState(null);
  const [previewUrl, setPreviewUrl] = React.useState(null);
  const [currentImageUrl, setCurrentImageUrl] = React.useState(initialData?.image_url || null);
  const originalUrlRef = React.useRef(initialData?.image_url || null);
  const [removeExisting, setRemoveExisting] = React.useState(false);

  const closeAll = (ok) => onClose && onClose(ok);

  const save = async () => {
    if (!userId) return;
    const cleanName = (name || '').trim();
    const qtyNum = Math.max(1, Math.abs(parseInt(qty, 10) || 1));
    if (!cleanName) return;
    try {
      setBusy(true);
      const userDocRef = doc(db, 'users', userId);
      const userDocSnap = await getDoc(userDocRef);
      if (!userDocSnap.exists()) throw new Error('User not found');
      const data = userDocSnap.data() || {};
      const inv = Array.isArray(data.inventory) ? [...data.inventory] : [];
      let newImageUrl = currentImageUrl;

      // If a new image is chosen, upload and replace
      if (imageFile) {
        const safe = cleanName.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `varie_${userId}_${safe}_${Date.now()}_${imageFile.name}`;
        const imgRef = storageRef(storage, 'items/' + fileName);
        await uploadBytes(imgRef, imageFile);
        newImageUrl = await getDownloadURL(imgRef);
        // schedule deleting old if there was one
        if (originalUrlRef.current && originalUrlRef.current !== newImageUrl) {
          setRemoveExisting(true);
        }
      }

      // Update the first matching entry by id
      let updated = false;
      for (let i = 0; i < inv.length; i++) {
        const e = inv[i];
        const eid = (e && (e.id || e.name || e?.General?.Nome)) || `item-${i}`;
        if (eid === inventoryItemId) {
          const nextEntry = {
            ...e,
            id: inventoryItemId,
            type: 'varie',
            name: cleanName,
            description: (desc || '').trim(),
            qty: qtyNum,
          };
          if (newImageUrl) nextEntry.image_url = newImageUrl; else delete nextEntry.image_url;
          inv[i] = nextEntry;
          updated = true;
          break;
        }
      }
      if (!updated) throw new Error('Item not found');

      await updateDoc(userDocRef, { inventory: inv });
      // After Firestore update, handle deletions
      if (removeExisting && originalUrlRef.current && originalUrlRef.current !== newImageUrl) {
        try {
          const path = decodeURIComponent(originalUrlRef.current.split('/o/')[1].split('?')[0]);
          await deleteObject(storageRef(storage, path));
        } catch {}
      }
      closeAll(true);
    } catch (e) {
      console.error('Failed to save Varie item', e);
    } finally {
      setBusy(false);
    }
  };

  const removeImage = () => {
    if (!currentImageUrl) return;
    setRemoveExisting(true);
    setCurrentImageUrl(null);
    setImageFile(null);
    setPreviewUrl(null);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && closeAll(false)} />
      <div className="relative z-10 w-[30rem] max-w-[92vw] rounded-xl border border-slate-700/60 bg-slate-900/90 p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-slate-200">Modifica Varie</h3>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs text-slate-300 mb-1">Nome</label>
            <input className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200" value={name} onChange={(e)=>setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Descrizione</label>
            <textarea rows={3} className="w-full rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200" value={desc} onChange={(e)=>setDesc(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Immagine</label>
            <div className="flex items-center gap-3">
              <input type="file" accept="image/*" className="text-xs text-slate-300" onChange={(e)=>{
                const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                setImageFile(f); setPreviewUrl(f ? URL.createObjectURL(f) : null);
              }} />
              {(previewUrl || currentImageUrl) && (
                <div className="flex items-center gap-2">
                  <div className="h-12 w-12 rounded-md overflow-hidden border border-slate-600/60 bg-slate-900/50">
                    <img src={previewUrl || currentImageUrl} alt="preview" className="h-full w-full object-cover" />
                  </div>
                  {currentImageUrl && (
                    <button type="button" onClick={removeImage} className="text-[11px] text-slate-300 border border-slate-600/60 rounded px-2 py-1 hover:bg-slate-700/40" disabled={busy}>Rimuovi immagine</button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Quantità</label>
            <input type="number" min="1" className="w-28 rounded-md bg-slate-900/60 border border-slate-600/60 px-3 py-2 text-slate-200" value={qty} onChange={(e)=>setQty(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="inline-flex items-center justify-center rounded-md border border-slate-600/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/40" onClick={()=>!busy && closeAll(false)} disabled={busy}>Annulla</button>
          <button className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white disabled:opacity-60" onClick={save} disabled={busy || !name.trim()}>Salva</button>
        </div>
      </div>
    </div>
  );
};
