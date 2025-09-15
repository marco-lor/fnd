// frontend/src/components/dmDashboard/elements/playerInfo.js
import React, { useState, useEffect, useCallback } from "react";
import { library } from "@fortawesome/fontawesome-svg-core";
import { faEdit, faTrash, faPlus, faMinus, faCoins } from "@fortawesome/free-solid-svg-icons";
import { collection, getDocs, doc, getDoc, updateDoc } from "firebase/firestore";

import { db } from "../../firebaseConfig";

import { AddTecnicaPersonaleOverlay } from "./buttons/addTecnicaPersonale";
import { EditTecnicaPersonale } from "./buttons/editTecnicaPersonale";
import { DelTecnicaPersonale } from "./buttons/delTecnicaPersonale";
import { AddSpellOverlay } from "./buttons/addSpell";
import { EditSpellOverlay } from "./buttons/editSpell";
import { DelSpellOverlay } from "./buttons/delSpell";
import { AddLinguaPersonaleOverlay } from "./buttons/addLinguaPersonale";
import { DelLinguaPersonaleOverlay } from "./buttons/delLinguaPersonale";
import { AddConoscenzaPersonaleOverlay } from "./buttons/addConoscenzaPersonale";
import { DelConoscenzaPersonaleOverlay } from "./buttons/delConoscenzaPersonale";
import { EditConoscenzaPersonaleOverlay } from "./buttons/editConoscenzaPersonale";
import { AddProfessionePersonaleOverlay } from "./buttons/addProfessionePersonale";
import { DelProfessionePersonaleOverlay } from "./buttons/delProfessionePersonale";
import { EditProfessionePersonaleOverlay } from "./buttons/editProfessionePersonale";
import { AddWeaponOverlay } from "../../bazaar/elements/addWeapon";
import { AddArmaturaOverlay } from "../../bazaar/elements/addArmatura";
import { AddAccessorioOverlay } from "../../bazaar/elements/addAccessorio";
import { AddConsumabileOverlay } from "../../bazaar/elements/addConsumabile";

import PlayerInfoActionsRow from "./playerInfo/sections/PlayerInfoActionsRow";
import PlayerInfoTecnicheRow from "./playerInfo/sections/PlayerInfoTecnicheRow";
import PlayerInfoSpellsRow from "./playerInfo/sections/PlayerInfoSpellsRow";
import PlayerInfoConoscenzeRow from "./playerInfo/sections/PlayerInfoConoscenzeRow";
import PlayerInfoProfessioniRow from "./playerInfo/sections/PlayerInfoProfessioniRow";
import PlayerInfoLingueRow from "./playerInfo/sections/PlayerInfoLingueRow";
import PlayerInfoInventoryRow from "./playerInfo/sections/PlayerInfoInventoryRow";
import GoldAdjustmentOverlay from "./playerInfo/overlays/GoldAdjustmentOverlay";
import EditVarieItemOverlay from "./playerInfo/overlays/EditVarieItemOverlay";
import AddVarieItemOverlay from "./playerInfo/overlays/AddVarieItemOverlay";

library.add(faEdit, faTrash, faPlus, faMinus, faCoins);

const PlayerInfo = ({ users, loading, error, setUsers }) => {
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [showEditConoscenzaOverlay, setShowEditConoscenzaOverlay] = useState(false);
  const [showEditProfessioneOverlay, setShowEditProfessioneOverlay] = useState(false);
  const [catalog, setCatalog] = useState({});
  const [itemsDocs, setItemsDocs] = useState({});
  const [showEditItemOverlay, setShowEditItemOverlay] = useState(false);
  const [editItemData, setEditItemData] = useState(null);
  const [selectedEditItemId, setSelectedEditItemId] = useState(null);
  const [selectedEditItemIndex, setSelectedEditItemIndex] = useState(null);
  const [showAddVarieOverlay, setShowAddVarieOverlay] = useState(false);
  const [addVarieUserId, setAddVarieUserId] = useState(null);

  const [showConoscenzaOverlay, setShowConoscenzaOverlay] = useState(false);
  const [showDeleteConoscenzaOverlay, setShowDeleteConoscenzaOverlay] = useState(false);
  const [selectedConoscenza, setSelectedConoscenza] = useState(null);

  const [showProfessioneOverlay, setShowProfessioneOverlay] = useState(false);
  const [showDeleteProfessioneOverlay, setShowDeleteProfessioneOverlay] = useState(false);
  const [selectedProfessione, setSelectedProfessione] = useState(null);

  const [showTecnicaOverlay, setShowTecnicaOverlay] = useState(false);
  const [showEditTecnicaOverlay, setShowEditTecnicaOverlay] = useState(false);
  const [showDeleteTecnicaOverlay, setShowDeleteTecnicaOverlay] = useState(false);
  const [selectedTecnica, setSelectedTecnica] = useState(null);

  const [showSpellOverlay, setShowSpellOverlay] = useState(false);
  const [showEditSpellOverlay, setShowEditSpellOverlay] = useState(false);
  const [showDeleteSpellOverlay, setShowDeleteSpellOverlay] = useState(false);
  const [selectedSpell, setSelectedSpell] = useState(null);

  const [showLinguaOverlay, setShowLinguaOverlay] = useState(false);
  const [showDeleteLinguaOverlay, setShowDeleteLinguaOverlay] = useState(false);
  const [selectedLingua, setSelectedLingua] = useState(null);

  const [goldAdjustments, setGoldAdjustments] = useState({});
  const [goldUpdating, setGoldUpdating] = useState({});
  const [goldOverlay, setGoldOverlay] = useState(null);

  const refreshUserData = useCallback(async () => {
    try {
      const snapshot = await getDocs(collection(db, "users"));
      const usersData = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      setUsers(usersData);
    } catch (err) {
      console.error("Error refreshing users:", err);
    }
  }, [setUsers]);

  const fetchItemsCatalog = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "items"));
      const names = {};
      const docs = {};
      snap.forEach((snapshotDoc) => {
        const data = snapshotDoc.data();
        names[snapshotDoc.id] = data?.General?.Nome || data?.name || snapshotDoc.id;
        docs[snapshotDoc.id] = { id: snapshotDoc.id, ...data };
      });
      setCatalog(names);
      setItemsDocs(docs);
    } catch (error) {
      console.warn("Failed to load item catalog", error);
    }
  }, []);

  useEffect(() => {
    fetchItemsCatalog();
  }, [fetchItemsCatalog]);

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
      console.error("Failed to update gold", err);
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
  const handleEditConoscenzaClick = (userId, name) => {
    setSelectedUserId(userId);
    setSelectedConoscenza(name);
    setShowEditConoscenzaOverlay(true);
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
  const handleEditProfessioneClick = (userId, name) => {
    setSelectedUserId(userId);
    setSelectedProfessione(name);
    setShowEditProfessioneOverlay(true);
  };

  const handleEditInventoryItem = (userId, itemId, invIndex = null) => {
    const user = users.find((entry) => entry.id === userId);
    let inventoryData = null;
    const inventoryArray = Array.isArray(user?.inventory) ? user.inventory : [];
    if (Number.isInteger(invIndex) && invIndex >= 0 && invIndex < inventoryArray.length) {
      const entry = inventoryArray[invIndex];
      if (entry) inventoryData = entry;
    }
    if (!inventoryData) {
      for (const entry of inventoryArray) {
        if (!entry || typeof entry !== "object") continue;
        const entryId = entry.id || entry.name || entry?.General?.Nome;
        if (entryId === itemId) {
          inventoryData = entry;
          break;
        }
      }
    }
    const baseDoc = itemsDocs[itemId];
    const initial = inventoryData || baseDoc;
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

  const resetInventoryEditState = () => {
    setShowEditItemOverlay(false);
    setEditItemData(null);
    setSelectedUserId(null);
    setSelectedEditItemId(null);
    setSelectedEditItemIndex(null);
  };

  const handleAddVarieForUser = (userId) => {
    setAddVarieUserId(userId);
    setShowAddVarieOverlay(true);
  };

  const handleAddVarieClose = async (ok) => {
    setShowAddVarieOverlay(false);
    setAddVarieUserId(null);
    if (ok) await refreshUserData();
  };

  const handleInventoryOverlayClose = async (ok) => {
    resetInventoryEditState();
    if (ok) {
      await fetchItemsCatalog();
      await refreshUserData();
    }
  };

  if (loading) return <div className="text-white mt-4">Loading user data...</div>;
  if (error) return <div className="text-red-500 mt-4">{error}</div>;
  if (!users.length) return <div className="text-white mt-4">No users found.</div>;

  const iconEditClass = "text-blue-400 hover:text-blue-300 transition transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded";
  const iconDeleteClass = "text-red-500 hover:text-red-400 transition transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-red-600 rounded";
  const sleekButtonClass = "w-36 px-2 py-1 bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-700 hover:to-indigo-800 text-white text-xs font-medium rounded-md transition-all duration-150 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 shadow-sm";

  const activeGoldUser = goldOverlay ? users.find((user) => user.id === goldOverlay.userId) : null;
  const activeGoldValue = goldOverlay ? goldAdjustments[goldOverlay.userId] ?? "" : "";
  const activeGoldAmount = goldOverlay ? Math.abs(parseInt(activeGoldValue, 10)) || 0 : 0;
  const activeGoldBusy = goldOverlay ? !!goldUpdating[goldOverlay.userId] : false;
  const activeGoldLabel = activeGoldUser?.displayName || activeGoldUser?.name || activeGoldUser?.pgName || activeGoldUser?.email || "";

  const handleGoldOverlayValueChange = (value) => {
    if (!goldOverlay) return;
    handleGoldInputChange(goldOverlay.userId, value);
  };

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-slate-100 text-xl font-semibold tracking-tight">Player Info</h2>
      <div className="rounded-lg border border-slate-700/60 shadow-sm overflow-x-auto">
        <table className="min-w-max border-collapse text-white bg-gray-800 text-sm">
          <thead className="bg-gray-700/80 backdrop-blur supports-[backdrop-filter]:bg-gray-700/70">
            <tr className="text-slate-100">
              <th className="sticky left-0 z-20 border border-gray-600 px-4 py-2 text-left bg-gray-700/80">Category</th>
              {users.map((user) => (
                <th key={user.id} className="border border-gray-600 px-4 py-2 text-center min-w-[11rem]">
                  {user.characterId || user.email}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <PlayerInfoActionsRow
              users={users}
              onAddTecnica={handleAddTecnicaClick}
              onAddSpell={handleAddSpellClick}
              onAddLingua={handleAddLinguaClick}
              onAddConoscenza={handleAddConoscenzaClick}
              onAddProfessione={handleAddProfessioneClick}
              sleekBtnClass={sleekButtonClass}
            />
            <PlayerInfoTecnicheRow
              users={users}
              iconEditClass={iconEditClass}
              iconDeleteClass={iconDeleteClass}
              onEditTecnica={handleEditTecnicaClick}
              onDeleteTecnica={handleDeleteTecnicaClick}
            />
            <PlayerInfoSpellsRow
              users={users}
              iconEditClass={iconEditClass}
              iconDeleteClass={iconDeleteClass}
              onEditSpell={handleEditSpellClick}
              onDeleteSpell={handleDeleteSpellClick}
            />
            <PlayerInfoConoscenzeRow
              users={users}
              iconEditClass={iconEditClass}
              iconDeleteClass={iconDeleteClass}
              onEditConoscenza={handleEditConoscenzaClick}
              onDeleteConoscenza={handleDeleteConoscenzaClick}
            />
            <PlayerInfoProfessioniRow
              users={users}
              iconEditClass={iconEditClass}
              iconDeleteClass={iconDeleteClass}
              onEditProfessione={handleEditProfessioneClick}
              onDeleteProfessione={handleDeleteProfessioneClick}
            />
            <PlayerInfoLingueRow
              users={users}
              iconDeleteClass={iconDeleteClass}
              onDeleteLingua={handleDeleteLinguaClick}
            />
            <PlayerInfoInventoryRow
              users={users}
              catalog={catalog}
              itemsDocs={itemsDocs}
              iconEditClass={iconEditClass}
              onEditInventoryItem={handleEditInventoryItem}
              onOpenGoldOverlay={openGoldOverlay}
              goldUpdating={goldUpdating}
              onAddVarie={handleAddVarieForUser}
            />
          </tbody>
        </table>
      </div>

      <GoldAdjustmentOverlay
        visible={!!goldOverlay}
        direction={goldOverlay?.direction || 1}
        userLabel={activeGoldLabel}
        value={activeGoldValue}
        busy={activeGoldBusy}
        canConfirm={!!activeGoldAmount}
        onClose={closeGoldOverlay}
        onChange={handleGoldOverlayValueChange}
        onConfirm={confirmGoldOverlay}
      />

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

      {showEditItemOverlay && editItemData && (
        <>
          {(editItemData?.type || editItemData?.item_type || "").toLowerCase() === "varie" ? (
            <EditVarieItemOverlay
              userId={selectedUserId}
              initialData={editItemData}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
              onClose={handleInventoryOverlayClose}
            />
          ) : editItemData?.item_type === "armatura" ? (
            <AddArmaturaOverlay
              onClose={handleInventoryOverlayClose}
              showMessage={console.log}
              initialData={editItemData}
              editMode
              inventoryEditMode
              inventoryUserId={selectedUserId}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
            />
          ) : editItemData?.item_type === "accessorio" ? (
            <AddAccessorioOverlay
              onClose={handleInventoryOverlayClose}
              showMessage={console.log}
              initialData={editItemData}
              editMode
              inventoryEditMode
              inventoryUserId={selectedUserId}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
            />
          ) : editItemData?.item_type === "consumabile" ? (
            <AddConsumabileOverlay
              onClose={handleInventoryOverlayClose}
              showMessage={console.log}
              initialData={editItemData}
              editMode
              inventoryEditMode
              inventoryUserId={selectedUserId}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
            />
          ) : (
            <AddWeaponOverlay
              onClose={handleInventoryOverlayClose}
              showMessage={console.log}
              initialData={editItemData}
              editMode
              inventoryEditMode
              inventoryUserId={selectedUserId}
              inventoryItemId={selectedEditItemId}
              inventoryItemIndex={selectedEditItemIndex}
            />
          )}
        </>
      )}

      {showAddVarieOverlay && addVarieUserId && (
        <AddVarieItemOverlay
          userId={addVarieUserId}
            onClose={handleAddVarieClose}
        />
      )}
    </div>
  );
};

export default PlayerInfo;
