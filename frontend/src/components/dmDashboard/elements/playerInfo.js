// frontend/src/components/dmDashboard/elements/playerInfo.js
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { library } from "@fortawesome/fontawesome-svg-core";
import { faEdit, faTrash, faPlus, faMinus, faCoins } from "@fortawesome/free-solid-svg-icons";
import { MdKeyboardDoubleArrowDown, MdKeyboardDoubleArrowUp } from "react-icons/md";

import { useManagerUserDetail, MANAGER_MAX_EXPANDED } from "../../../data/userData/managerUserData";

import {
  AddConoscenzaPersonaleOverlay,
  AddLinguaPersonaleOverlay,
  AddProfessionePersonaleOverlay,
  AddSpellOverlay,
  AddTecnicaPersonaleOverlay,
  AddVarieItemOverlay,
  DelConoscenzaPersonaleOverlay,
  DelLinguaPersonaleOverlay,
  DelProfessionePersonaleOverlay,
  DelSpellOverlay,
  DelTecnicaPersonale,
  EditConoscenzaPersonaleOverlay,
  EditProfessionePersonaleOverlay,
  EditSpellOverlay,
  EditTecnicaPersonale,
  GoldAdjustmentOverlay,
} from './lazyPlayerInfoOverlays';
import InventoryItemEditor from './InventoryItemEditor';

import PlayerInfoActionsRow from "./playerInfo/sections/PlayerInfoActionsRow";
import PlayerInfoTecnicheRow from "./playerInfo/sections/PlayerInfoTecnicheRow";
import PlayerInfoSpellsRow from "./playerInfo/sections/PlayerInfoSpellsRow";
import PlayerInfoConoscenzeRow from "./playerInfo/sections/PlayerInfoConoscenzeRow";
import PlayerInfoProfessioniRow from "./playerInfo/sections/PlayerInfoProfessioniRow";
import PlayerInfoLingueRow from "./playerInfo/sections/PlayerInfoLingueRow";
import PlayerInfoInventoryRow from "./playerInfo/sections/PlayerInfoInventoryRow";
import PlayerInfoDiceRollsRow from "./playerInfo/sections/PlayerInfoDiceRollsRow";
import { adjustGold, updateResource, createUserOperationId } from "../../../data/userData/userDataCommands";
import { buildManagerResourceTotalOptions } from "../../../data/userData/managerResourceCommands";
import ManagerActionDialog, { parseIntegerInput } from "./ManagerActionDialog";

library.add(faEdit, faTrash, faPlus, faMinus, faCoins);

const ManagerPlayerCard = React.memo(function ManagerPlayerCard({
  user: summary, expanded, onToggle, expansionDisabled,
  loading,
  error,
  variant = "table",
  onLevelUpOne,
  onAddTokens,
  busy = false,
  canEditVitals = false,
}) {
  const detail = useManagerUserDetail(summary, expanded);
  const users = useMemo(() => [detail.user], [detail.user]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [showEditConoscenzaOverlay, setShowEditConoscenzaOverlay] = useState(false);
  const [showEditProfessioneOverlay, setShowEditProfessioneOverlay] = useState(false);
  const catalog = {};
  const itemsDocs = {};
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
  const [mutationError, setMutationError] = useState(null);
  const [vitalDialog, setVitalDialog] = useState(null);
  const [vitalDialogError, setVitalDialogError] = useState(null);
  const [vitalDialogBusy, setVitalDialogBusy] = useState(false);
  const [failedVitalDeltas, setFailedVitalDeltas] = useState([]);
  const runningVitalDeltas = useRef(new Set());

  const refreshUserData = useCallback(() => Promise.resolve(), []);

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
      setMutationError(null);
      setGoldUpdating((prev) => ({ ...prev, [userId]: true }));
      const currentUser = users.find((entry) => entry.id === userId);
      if (!currentUser) throw new Error("The selected user is no longer available.");
      const delta = direction > 0 ? amount : -amount;
      await adjustGold({
        userId,
        delta,
        retryKey: `dm-gold:${userId}:${delta}`,
      });
      setGoldAdjustments((prev) => ({ ...prev, [userId]: "" }));
      setGoldOverlay(null);
      await refreshUserData();
    } catch (err) {
      console.error("Failed to update gold", err);
      setMutationError(err.message || "Failed to update gold. Try again.");
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
        const entryId = entry?._task05?.inventoryId || entry?._instance?.instanceId;
        if (entryId === itemId) {
          inventoryData = entry;
          break;
        }
      }
    }
    const initial = inventoryData;
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
      await refreshUserData();
    }
  };

  const vitalFieldMap = {
    hp: { current: "stats.hpCurrent", total: "stats.hpTotal", label: "HP" },
    mana: { current: "stats.manaCurrent", total: "stats.manaTotal", label: "Mana" },
    essenza: { current: "stats.essenzaCurrent", total: "stats.essenzaTotal", label: "Essenza" },
  };

  const runVitalDelta = async (command) => {
    if (!canEditVitals || runningVitalDeltas.current.has(command.operationId)) return;
    runningVitalDeltas.current.add(command.operationId);
    try {
      await updateResource(command);
      setFailedVitalDeltas((previous) => previous.filter((entry) => entry.operationId !== command.operationId));
    } catch (e) {
      setFailedVitalDeltas((previous) => previous.some((entry) => entry.operationId === command.operationId)
        ? previous : [...previous, command]);
    } finally {
      runningVitalDeltas.current.delete(command.operationId);
    }
  };

  const adjustVitalDelta = (userId, vital, delta) => {
    if (!canEditVitals || !users.some((entry) => entry.id === userId)) return;
    // Each click is a new adjustment, even before an earlier response arrives.
    // Only the explicit retry control reuses this immutable command identity.
    return runVitalDelta({userId, resource: vital, mode: "delta", floorAtZero: true,
      value: delta, operationId: createUserOperationId('dm-vital-delta')});
  };

  const resetVital = async (userId, vital) => {
    if (!canEditVitals) return;
    const u = users.find((x) => x.id === userId);
    if (!u) return;
    const tot = Number(u?.stats?.[`${vital}Total`]) || 0;
    try {
      await updateResource({
        userId,
        resource: vital,
        mode: "set",
        value: tot,
        retryKey: ["dm-vital-reset", userId, vital, tot].join(":"),
      });
    } catch (e) {
      console.error("resetVital failed", e);
    }
  };

  const openVitalDialog = (userId, vital, kind) => {
    if (!canEditVitals) return;
    const u = users.find((x) => x.id === userId);
    if (!u) return;
    const cur = Number(u?.stats?.[`${vital}Current`]) || 0;
    const total = Number(u?.stats?.[`${vital}Total`]) || 0;
    setVitalDialogError(null);
    setVitalDialog({
      actionId: createUserOperationId('dm-vital-dialog'),
      userId,
      vital,
      kind,
      value: String(kind === "total" ? total : kind === "delta" ? 0 : cur),
      clampCurrent: true,
    });
  };

  const closeVitalDialog = () => {
    if (vitalDialogBusy) return;
    setVitalDialog(null);
    setVitalDialogError(null);
  };

  const confirmVitalDialog = async () => {
    if (!vitalDialog || vitalDialogBusy) return;
    const n = parseIntegerInput(vitalDialog.value);
    if (n === null) {
      setVitalDialogError("Enter a valid whole number.");
      return;
    }
    if (vitalDialog.kind === "delta" && n === 0) {
      setVitalDialogError("Enter a value other than zero.");
      return;
    }
    const u = users.find((x) => x.id === vitalDialog.userId);
    if (!u) {
      setVitalDialogError("The selected user is no longer available.");
      return;
    }
    const cur = Number(u?.stats?.[`${vitalDialog.vital}Current`]) || 0;
    try {
      setVitalDialogBusy(true);
      setVitalDialogError(null);
      if (vitalDialog.kind === "current") {
        const nextCurrent = Math.max(0, n);
        await updateResource({
          userId: vitalDialog.userId,
          resource: vitalDialog.vital,
          mode: "set",
          value: nextCurrent,
          retryKey: ["dm-vital-current", vitalDialog.userId, vitalDialog.vital, cur, nextCurrent].join(":"),
        });
      } else if (vitalDialog.kind === "total") {
        const nextTotal = Math.max(0, n);
        const nextCurrent = cur > nextTotal && vitalDialog.clampCurrent ? nextTotal : cur;
        await updateResource({
          userId: vitalDialog.userId,
          resource: vitalDialog.vital,
          mode: "set",
          value: nextCurrent,
          totalValue: nextTotal,
          ...buildManagerResourceTotalOptions(u, vitalDialog.vital),
          retryKey: [
            "dm-vital-total",
            vitalDialog.userId,
            vitalDialog.vital,
            cur,
            nextCurrent,
            nextTotal,
          ].join(":"),
        });
      } else {
        await updateResource({
          userId: vitalDialog.userId,
          resource: vitalDialog.vital,
          mode: "delta",
          floorAtZero: true,
          value: n,
          retryKey: [vitalDialog.actionId, vitalDialog.vital, n].join(":"),
        });
      }
      setVitalDialog(null);
    } catch (e) {
      console.error("Vital update failed", e);
      setVitalDialogError("Failed to update this vital. See console.");
    } finally {
      setVitalDialogBusy(false);
    }
  };

  if (loading) return <div className="text-white mt-4">Loading user data...</div>;
  if (error) return <div className="text-red-500 mt-4">{error}</div>;
  if (!users.length) return <div className="text-white mt-4">No users found.</div>;

  const iconEditClass = "text-blue-400 hover:text-blue-300 transition transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded";
  const iconDeleteClass = "text-red-500 hover:text-red-400 transition transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-red-600 rounded";
  const selectedManagerUser = selectedUserId
    ? users.find((entry) => entry.id === selectedUserId)
    : null;
  const selectedUserLabel = selectedManagerUser?.displayName
    || selectedManagerUser?.characterId
    || selectedManagerUser?.label
    || selectedManagerUser?.email
    || "Unknown User";
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

  const VBar = ({ pct, track, fill }) => (
    <div className={`w-full h-2 ${track} rounded overflow-hidden border border-slate-700/50`}>
      <div className={`${fill} h-full`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );

  const renderVitals = (user) => {
    const stats = user?.stats || {};
    const vitalItems = [
      {
        key: "hp",
        cur: Number(stats.hpCurrent) || 0,
        tot: Number(stats.hpTotal) || 0,
        track: "bg-red-900/30",
        fill: "bg-gradient-to-r from-red-500 to-rose-500",
      },
      {
        key: "mana",
        cur: Number(stats.manaCurrent) || 0,
        tot: Number(stats.manaTotal) || 0,
        track: "bg-indigo-900/30",
        fill: "bg-gradient-to-r from-indigo-500 to-cyan-500",
      },
      {
        key: "essenza",
        cur: Number(stats.essenzaCurrent) || 0,
        tot: Number(stats.essenzaTotal) || 0,
        track: "bg-teal-900/30",
        fill: "bg-gradient-to-r from-teal-500 to-emerald-400",
      },
    ];

    return (
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Vitals</div>
        <div className="space-y-3">
          {vitalItems.map(({ key, cur, tot, track, fill }) => {
            const pct = tot > 0 ? (cur / tot) * 100 : 0;
            return (
              <div key={key} className="rounded border border-slate-700/60 bg-slate-900/50 p-3">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="font-semibold uppercase">{key}</span>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-slate-100">{cur}</span>
                    <button
                      onClick={() => openVitalDialog(user.id, key, "current")}
                      className="rounded bg-slate-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 hover:bg-slate-700"
                      title="Set current"
                    >
                      Set cur
                    </button>
                  </div>
                </div>
                <div className="mt-2">
                  <VBar pct={pct} track={track} fill={fill} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <div className="flex items-center gap-1">
                    <button onClick={() => adjustVitalDelta(user.id, key, -1)} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">-</button>
                    <button onClick={() => adjustVitalDelta(user.id, key, 1)} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">+</button>
                    <button onClick={() => openVitalDialog(user.id, key, "delta")} className="px-2 py-1 rounded bg-indigo-900/70 hover:bg-indigo-800">Δ</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-300">/</span>
                    <span className="tabular-nums text-slate-100">{tot}</span>
                    <button
                      onClick={() => openVitalDialog(user.id, key, "total")}
                      className="rounded bg-cyan-900/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-50 hover:bg-cyan-800"
                      title="Set total"
                    >
                      Set max
                    </button>
                    <button onClick={() => resetVital(user.id, key)} className="px-2 py-1 rounded bg-emerald-800/70 hover:bg-emerald-700 text-emerald-50">Reset</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCardLayout = () => (
    <div className="h-full">
      {users.map((user) => {
        const baseAvail = Number(user?.stats?.basePointsAvailable) || 0;
        const baseSpent = Number(user?.stats?.basePointsSpent) || 0;
        const combatAvail = Number(user?.stats?.combatTokensAvailable) || 0;
        const combatSpent = Number(user?.stats?.combatTokensSpent) || 0;
        const isExpanded = expanded;
        return (
          <div key={user.id} className="rounded-lg border border-slate-700/60 bg-gray-800/90 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-slate-50 tracking-tight">{user.characterId || user.label || user.email}</div>
                <div className="text-xs text-slate-400">Lv {user?.stats?.level || 1}</div>
              </div>
              <div className="flex gap-2">
                {onAddTokens && (
                  <button
                    className="px-2 py-1 text-xs rounded-md bg-amber-700 text-white hover:bg-amber-600 disabled:opacity-50"
                    onClick={() => onAddTokens(user.id)}
                    disabled={busy}
                    title="Add or remove combat tokens"
                  >
                    Tokens
                  </button>
                )}
                {onLevelUpOne && (
                  <button
                    className="px-2 py-1 text-xs rounded-md bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
                    onClick={() => onLevelUpOne(user.id)}
                    disabled={busy}
                    title="Level up this player"
                  >
                    Level Up
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
              <div className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 ring-1 ring-emerald-500/30" title="Base points available/spent">
                <span>Base</span>
                <span className="text-emerald-300">A {baseAvail}</span>
                <span className="text-slate-200">S {baseSpent}</span>
              </div>
              <div className="flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-1 ring-1 ring-indigo-500/30" title="Combat tokens available/spent">
                <span>Combat</span>
                <span className="text-indigo-300">A {combatAvail}</span>
                <span className="text-slate-200">S {combatSpent}</span>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {renderVitals(user)}
              {failedVitalDeltas.map((command) => <div key={command.operationId} role="alert" className="text-sm text-red-300">
                Adjustment not confirmed.{' '}
                <button onClick={() => runVitalDelta(command)} disabled={!canEditVitals} className="underline">
                  Retry {vitalFieldMap[command.resource].label} {command.value > 0 ? '+' : ''}{command.value}
                </button>
              </div>)}

              <button
                type="button"
                onClick={() => onToggle(user.id)}
                disabled={!expanded && expansionDisabled}
                aria-expanded={expanded}
                aria-label={expanded ? "Comprimi" : "Espandi"}
                className="inline-flex items-center gap-2 rounded-full bg-indigo-900/50 px-3 py-1 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-800"
              >
                {isExpanded ? (
                  <>
                    <MdKeyboardDoubleArrowUp className="h-4 w-4" />
                    <span>Comprimi</span>
                  </>
                ) : (
                  <>
                    <MdKeyboardDoubleArrowDown className="h-4 w-4" />
                    <span>Espandi</span>
                  </>
                )}
              </button>

              {isExpanded && detail.loading && <p role="status">Loading player details...</p>}
              {isExpanded && detail.error && <div role="alert">
                <p>{detail.error.message}</p>
                <button type="button" onClick={detail.retry}>Retry player details</button>
              </div>}
              {isExpanded && !detail.loading && !detail.error && (
                <div className="space-y-5">
                  <PlayerInfoActionsRow
                    variant="card"
                    users={[user]}
                    onAddTecnica={handleAddTecnicaClick}
                    onAddSpell={handleAddSpellClick}
                    onAddLingua={handleAddLinguaClick}
                    onAddConoscenza={handleAddConoscenzaClick}
                    onAddProfessione={handleAddProfessioneClick}
                    sleekBtnClass={sleekButtonClass}
                  />
                  <PlayerInfoTecnicheRow
                    variant="card"
                    users={[user]}
                    iconEditClass={iconEditClass}
                    iconDeleteClass={iconDeleteClass}
                    onEditTecnica={handleEditTecnicaClick}
                    onDeleteTecnica={handleDeleteTecnicaClick}
                  />
                  <PlayerInfoSpellsRow
                    variant="card"
                    users={[user]}
                    iconEditClass={iconEditClass}
                    iconDeleteClass={iconDeleteClass}
                    onEditSpell={handleEditSpellClick}
                    onDeleteSpell={handleDeleteSpellClick}
                  />
                  <PlayerInfoConoscenzeRow
                    variant="card"
                    users={[user]}
                    iconEditClass={iconEditClass}
                    iconDeleteClass={iconDeleteClass}
                    onEditConoscenza={handleEditConoscenzaClick}
                    onDeleteConoscenza={handleDeleteConoscenzaClick}
                  />
                  <PlayerInfoProfessioniRow
                    variant="card"
                    users={[user]}
                    iconEditClass={iconEditClass}
                    iconDeleteClass={iconDeleteClass}
                    onEditProfessione={handleEditProfessioneClick}
                    onDeleteProfessione={handleDeleteProfessioneClick}
                  />
                  <PlayerInfoLingueRow
                    variant="card"
                    users={[user]}
                    iconDeleteClass={iconDeleteClass}
                    onDeleteLingua={handleDeleteLinguaClick}
                  />
                  <PlayerInfoInventoryRow
                    variant="card"
                    users={[user]}
                    catalog={catalog}
                    itemsDocs={itemsDocs}
                    iconEditClass={iconEditClass}
                    onEditInventoryItem={handleEditInventoryItem}
                    onOpenGoldOverlay={openGoldOverlay}
                    goldUpdating={goldUpdating}
                    onAddVarie={handleAddVarieForUser}
                  />
                  <PlayerInfoDiceRollsRow variant="card" users={[user]} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const content = renderCardLayout();

  return (
    <div className={variant === "card" ? "mt-4" : "mt-8"}>
      {variant !== "card" && <h2 className="mb-3 text-slate-100 text-xl font-semibold tracking-tight">Player Info</h2>}
      {content}
      {mutationError && <p role="alert">{mutationError}</p>}

      {expanded && goldOverlay && <GoldAdjustmentOverlay
        visible={!!goldOverlay}
        direction={goldOverlay?.direction || 1}
        userLabel={activeGoldLabel}
        value={activeGoldValue}
        busy={activeGoldBusy}
        canConfirm={!!activeGoldAmount}
        onClose={closeGoldOverlay}
        onChange={handleGoldOverlayValueChange}
        onConfirm={confirmGoldOverlay}
      />}

      {vitalDialog && (() => {
        const activeUser = users.find((entry) => entry.id === vitalDialog.userId);
        const current = Number(activeUser?.stats?.[`${vitalDialog.vital}Current`]) || 0;
        const parsedValue = parseIntegerInput(vitalDialog.value);
        const nextTotal = parsedValue === null ? null : Math.max(0, parsedValue);
        const showClamp = vitalDialog.kind === "total" && nextTotal !== null && current > nextTotal;
        const vitalLabel = vitalFieldMap[vitalDialog.vital].label;
        const userLabel = activeUser?.characterId || activeUser?.label || activeUser?.email || "this player";
        const actionLabel = vitalDialog.kind === "current"
          ? "current value"
          : vitalDialog.kind === "total"
            ? "maximum"
            : "change";
        return (
          <ManagerActionDialog
            visible
            title={`Set ${vitalLabel} ${actionLabel}`}
            description={`${userLabel} · current ${current} / ${Number(activeUser?.stats?.[`${vitalDialog.vital}Total`]) || 0}`}
            inputLabel={`${vitalLabel} ${actionLabel}`}
            value={vitalDialog.value}
            onChange={(value) => {
              setVitalDialog((previous) => ({ ...previous, value }));
              setVitalDialogError(null);
            }}
            error={vitalDialogError}
            busy={vitalDialogBusy}
            confirmLabel="Apply"
            onClose={closeVitalDialog}
            onConfirm={confirmVitalDialog}
          >
            {showClamp && (
              <label className="mt-3 flex items-start gap-2 text-xs text-amber-200">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={vitalDialog.clampCurrent}
                  onChange={(event) => setVitalDialog((previous) => ({
                    ...previous,
                    clampCurrent: event.target.checked,
                  }))}
                  disabled={vitalDialogBusy}
                />
                Reduce the current value to the new maximum
              </label>
            )}
          </ManagerActionDialog>
        );
      })()}

      {expanded && showTecnicaOverlay && selectedUserId && (
        <AddTecnicaPersonaleOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          onClose={(ok) => {
            setShowTecnicaOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {expanded && showEditTecnicaOverlay && selectedUserId && selectedTecnica && (
        <EditTecnicaPersonale
          userId={selectedUserId}
          userLabel={selectedUserLabel}
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
      {expanded && showDeleteTecnicaOverlay && selectedUserId && selectedTecnica && (
        <DelTecnicaPersonale
          userId={selectedUserId}
          userLabel={selectedUserLabel}
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

      {expanded && showSpellOverlay && selectedUserId && (
        <AddSpellOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          onClose={(ok) => {
            setShowSpellOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {expanded && showEditSpellOverlay && selectedUserId && selectedSpell && (
        <EditSpellOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
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
      {expanded && showDeleteSpellOverlay && selectedUserId && selectedSpell && (
        <DelSpellOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
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

      {expanded && showLinguaOverlay && selectedUserId && (
        <AddLinguaPersonaleOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          currentMap={selectedManagerUser?.lingue}
          onClose={(ok) => {
            setShowLinguaOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {expanded && showDeleteLinguaOverlay && selectedUserId && selectedLingua && (
        <DelLinguaPersonaleOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          currentMap={selectedManagerUser?.lingue}
          linguaName={selectedLingua}
          onClose={(ok) => {
            setShowDeleteLinguaOverlay(false);
            setSelectedLingua(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}

      {expanded && showConoscenzaOverlay && selectedUserId && (
        <AddConoscenzaPersonaleOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          currentMap={selectedManagerUser?.conoscenze}
          onClose={(ok) => {
            setShowConoscenzaOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {expanded && showDeleteConoscenzaOverlay && selectedUserId && selectedConoscenza && (
        <DelConoscenzaPersonaleOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          currentMap={selectedManagerUser?.conoscenze}
          conoscenzaName={selectedConoscenza}
          onClose={(ok) => {
            setShowDeleteConoscenzaOverlay(false);
            setSelectedConoscenza(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {expanded && showEditConoscenzaOverlay && selectedUserId && selectedConoscenza && (
        <EditConoscenzaPersonaleOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          currentMap={selectedManagerUser?.conoscenze}
          conoscenzaName={selectedConoscenza}
          onClose={(ok) => {
            setShowEditConoscenzaOverlay(false);
            setSelectedConoscenza(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}

      {expanded && showProfessioneOverlay && selectedUserId && (
        <AddProfessionePersonaleOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          currentMap={selectedManagerUser?.professioni}
          onClose={(ok) => {
            setShowProfessioneOverlay(false);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {expanded && showDeleteProfessioneOverlay && selectedUserId && selectedProfessione && (
        <DelProfessionePersonaleOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          currentMap={selectedManagerUser?.professioni}
          professioneName={selectedProfessione}
          onClose={(ok) => {
            setShowDeleteProfessioneOverlay(false);
            setSelectedProfessione(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}
      {expanded && showEditProfessioneOverlay && selectedUserId && selectedProfessione && (
        <EditProfessionePersonaleOverlay
          userId={selectedUserId}
          userLabel={selectedUserLabel}
          currentMap={selectedManagerUser?.professioni}
          professioneName={selectedProfessione}
          onClose={(ok) => {
            setShowEditProfessioneOverlay(false);
            setSelectedProfessione(null);
            setSelectedUserId(null);
            if (ok) refreshUserData();
          }}
        />
      )}

      {expanded && showEditItemOverlay && editItemData && (
        <InventoryItemEditor
          key={selectedEditItemId}
          initialData={editItemData}
          inventoryUserId={selectedUserId}
          inventoryItemId={selectedEditItemId}
          inventoryItemIndex={selectedEditItemIndex}
          onClose={handleInventoryOverlayClose}
        />
      )}

      {expanded && showAddVarieOverlay && addVarieUserId && (
        <AddVarieItemOverlay
          userId={addVarieUserId}
            onClose={handleAddVarieClose}
        />
      )}
    </div>
  );
});

const PlayerInfo = ({ users, loading, error, ...props }) => {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const userIds = JSON.stringify(users.map((user) => user.id));
  useEffect(() => {
    const visible = new Set(JSON.parse(userIds));
    setExpandedIds((previous) => {
      const next = new Set([...previous].filter((uid) => visible.has(uid)));
      return next.size === previous.size ? previous : next;
    });
  }, [userIds]);
  const toggle = useCallback((uid) => setExpandedIds((previous) => {
    const next = new Set(previous);
    if (next.has(uid)) next.delete(uid);
    else if (next.size < MANAGER_MAX_EXPANDED) next.add(uid);
    return next;
  }), []);
  if (loading) return <p role="status">Loading user data...</p>;
  if (error) return <p role="alert">{error.message || error}</p>;
  if (!users.length) return <p>No users found.</p>;
  return <div>
    <p className="mt-2 text-xs text-slate-400">Espandi fino a {MANAGER_MAX_EXPANDED} giocatori contemporaneamente.</p>
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {users.map((user) => <ManagerPlayerCard key={user.id} user={user}
        {...props} variant="card" expanded={expandedIds.has(user.id)} onToggle={toggle}
        expansionDisabled={expandedIds.size >= MANAGER_MAX_EXPANDED} />)}
    </div>
  </div>;
};
export default PlayerInfo;
