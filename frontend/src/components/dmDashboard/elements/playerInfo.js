// frontend/src/components/dmDashboard/elements/playerInfo.js
import React, { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEdit, faTrash } from "@fortawesome/free-solid-svg-icons";
import { library } from "@fortawesome/fontawesome-svg-core";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebaseConfig";

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

library.add(faEdit, faTrash);

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

  const refreshUserData = async () => {
    try {
      const snapshot = await getDocs(collection(db, "users"));
      const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUsers(usersData);
    } catch (err) {
      console.error("Error refreshing users:", err);
    }
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

  // Helpers to normalize inventory entries
  const deriveId = (e, i) => {
    if (!e) return `item-${i}`;
    if (typeof e === "string") return e;
    return e.id || e.name || e?.General?.Nome || `item-${i}`;
  };
  const toDisplayName = (e, i) => {
    if (!e) return `item-${i}`;
    if (typeof e === "string") return catalog[e] || e;
    return catalog[e.id] || e?.General?.Nome || e.name || deriveId(e, i);
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
  const handleEditInventoryItem = (userId, itemId) => {
    const u = users.find(x => x.id === userId);
    // Prefer the user's inventory copy if present (object entry), else fallback to global catalog doc
    let invData = null;
    const invArr = Array.isArray(u?.inventory) ? u.inventory : [];
    for (const entry of invArr) {
      if (!entry || typeof entry !== "object") continue;
      const eid = entry.id || entry.name || entry?.General?.Nome;
      if (eid === itemId) { invData = entry; break; }
    }
    const baseDoc = itemsDocs[itemId];
    const initial = invData || baseDoc;
    if (!initial) {
      console.warn("No data found for inventory item id:", itemId);
      return;
    }
    setSelectedUserId(userId);
    setSelectedEditItemId(itemId);
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

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-white text-xl">Player Info</h2>
      <div className="rounded-lg shadow-lg">
        <table className="min-w-full border-collapse text-white bg-gray-800">
          <thead className="bg-gray-700">
            <tr>
              <th className="border border-gray-600 px-4 py-2 text-left">Category</th>
              {users.map(u => (
                <th key={u.id} className="border border-gray-600 px-4 py-2 text-center">
                  {u.characterId || u.email}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Actions */}
            <tr className="bg-gray-800 hover:bg-gray-700">
              <td className="border border-gray-600 px-4 py-2 font-medium">Actions</td>
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
              <td className="border border-gray-600 px-4 py-2 font-medium">Tecniche</td>
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
              <td className="border border-gray-600 px-4 py-2 font-medium">Spells</td>
              {users.map(u => (
                <td key={u.id+"-sp"} className="border border-gray-600 px-4 py-2">
                  {u.spells && Object.keys(u.spells).length
                    ? <ul className="space-y-1">
                        {Object.keys(u.spells).map(name => (
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
              <td className="border border-gray-600 px-4 py-2 font-medium">Conoscenze</td>
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
              <td className="border border-gray-600 px-4 py-2 font-medium">Professioni</td>
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
              <td className="border border-gray-600 px-4 py-2 font-medium">Lingue</td>
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
              <td className="border border-gray-600 px-4 py-2 font-medium">Inventario</td>
              {users.map((u) => {
                const inv = Array.isArray(u?.inventory) ? u.inventory : [];
                // Normalize and collapse by id
                const normalized = inv
                  .map((entry, i) => {
                    if (!entry) return null;
                    if (typeof entry === "string") {
                      const id = entry;
                      return { id, name: catalog[id] || id, qty: 1 };
                    }
                    const id = deriveId(entry, i);
                    const name = toDisplayName(entry, i);
                    const qty = typeof entry.qty === "number" ? entry.qty : 1;
                    return { id, name, qty };
                  })
                  .filter(Boolean);
                const collapsed = {};
                for (const it of normalized) {
                  if (!collapsed[it.id]) collapsed[it.id] = { ...it };
                  else collapsed[it.id].qty += it.qty || 1;
                }
                const list = Object.values(collapsed).sort((a, b) => a.name.localeCompare(b.name));
                const gold = typeof u?.stats?.gold === "number" ? u.stats.gold : parseInt(u?.stats?.gold, 10) || 0;

                return (
                  <td key={u.id+"-inv"} className="border border-gray-600 px-4 py-2 align-top">
                    <div className="mb-2 text-xs text-amber-300">Gold: {gold}</div>
                    {list.length ? (
                      <ul className="space-y-1 pr-1">
                        {list.map((it) => (
                          <li key={it.id} className="flex items-center justify-between text-sm">
                            <span className="truncate mr-2">{it.name}</span>
                            <div className="flex items-center space-x-2">
                              {itemsDocs?.[it.id]?.item_type && (
                                <button
                                  className={iconEdit}
                                  title="Modifica oggetto"
                                  onClick={() => handleEditInventoryItem(u.id, it.id)}
                                >
                                  <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <span className="text-amber-300 text-xs">x{it.qty}</span>
                            </div>
                          </li>
                        ))}
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
    {editItemData?.item_type === 'armatura' ? (
            <AddArmaturaOverlay
              onClose={(ok) => {
                setShowEditItemOverlay(false);
                setEditItemData(null);
                setSelectedUserId(null);
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
            />
          ) : editItemData?.item_type === 'accessorio' ? (
            <AddAccessorioOverlay
              onClose={(ok) => {
                setShowEditItemOverlay(false);
                setEditItemData(null);
                setSelectedUserId(null);
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
            />
          ) : editItemData?.item_type === 'consumabile' ? (
            <AddConsumabileOverlay
              onClose={(ok) => {
                setShowEditItemOverlay(false);
                setEditItemData(null);
                setSelectedUserId(null);
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
            />
          ) : (
            <AddWeaponOverlay
              onClose={(ok) => {
                setShowEditItemOverlay(false);
                setEditItemData(null);
                setSelectedUserId(null);
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
            />
          )}
        </>
      )}
    </div>
  );
};

export default PlayerInfo;
