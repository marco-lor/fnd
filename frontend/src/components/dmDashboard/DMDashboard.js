// file: ./frontend/src/components/dmDashboard/DMDashboard.js
import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../AuthContext";
import { useNavigate } from "react-router-dom";
import { library } from "@fortawesome/fontawesome-svg-core";
import { faLock, faLockOpen } from "@fortawesome/free-solid-svg-icons";
import PlayerInfo from "./elements/playerInfo";
import LockSettingsTable from "./elements/LockSettingsTable";
import ManagerActionDialog, { parseIntegerInput } from "./elements/ManagerActionDialog";
import { useShellLayout } from "../common/shellLayout";
import { getCallable } from "../../data/functions/callableRegistry";
import {
  callBackendOperationAndWait,
} from "../../data/functions/backendOperationClient";
import {
  runWithDurableOperationIntent,
} from "../../data/functions/backendOperationIntentStore";
import { updateProgression } from "../../data/userData/userDataCommands";
import { useManagerUserData } from "../../data/userData/managerUserData";
import { reconcileManagerUserSelection } from "./managerSelection";

// Add icons to library
library.add(faLock, faLockOpen);

const levelUpAll = getCallable("levelUpAll");
const levelUpUser = getCallable("levelUpUser");

const DMDashboard = () => {
  const { user, userData } = useAuth();
  const {
    users,
    loading,
    error: userDataError,
  } = useManagerUserData(userData?.role === "dm");
  const [actionError, setError] = useState(null);
  const error = actionError || userDataError?.message || null;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [actionDialog, setActionDialog] = useState(null);
  const [actionDialogValue, setActionDialogValue] = useState("1");
  const [actionDialogError, setActionDialogError] = useState(null);
  const knownUserIdsRef = useRef([]);
  const hasLoadedUsersRef = useRef(false);
  const { topInset } = useShellLayout();
  // Collapsible sections state
  const [sectionsOpen, setSectionsOpen] = useState({
    players: true,
    locks: true,
  });

  useEffect(() => {
    if (!userData) return; // Still loading user data

    if (userData.role !== "dm") {
      console.log("Access denied: User is not a DM");
      navigate("/home");
      return undefined;
    }
    return undefined;
  }, [userData, navigate]);

  // Ensure player selection state stays in sync with the current users list.
  // New users are auto-selected; removed users are cleaned out.
  useEffect(() => {
    if (!users.length) {
      setSelectedUserIds([]);
      knownUserIdsRef.current = [];
      hasLoadedUsersRef.current = false;
      return;
    }
    const currentUserIds = users.map((entry) => entry.id);
    const previousUserIds = knownUserIdsRef.current;
    const isInitialLoad = !hasLoadedUsersRef.current;
    setSelectedUserIds((selectedIds) => reconcileManagerUserSelection({
      selectedUserIds: selectedIds,
      currentUserIds,
      previousUserIds,
      isInitialLoad,
    }));
    knownUserIdsRef.current = currentUserIds;
    hasLoadedUsersRef.current = true;
  }, [users]);

  const toggleUserSelection = (userId) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Simple section header with show/hide control
  const SectionHeader = ({ title, sectionKey }) => (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-slate-100 text-xl font-semibold tracking-tight">{title}</h2>
      <button
        className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-200 hover:bg-slate-700/40"
        onClick={() => setSectionsOpen((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
      >
        {sectionsOpen[sectionKey] ? "Hide" : "Show"}
      </button>
    </div>
  );

  const executeLevelUpAll = async () => {
    if (userData.role !== "dm") {
      setError("Permission denied: Only DMs can level up players");
      return;
    }
    try {
      setBusy(true);
      setToast(null);
      setError(null);
      const operation = await runWithDurableOperationIntent({
        actorUid: user?.uid,
        kind: "level-up-all",
        intent: { scope: "all-users" },
        invoke: (operationId) => callBackendOperationAndWait(
          levelUpAll,
          {},
          { operationId }
        ),
      });
      const updatedCount = Number(operation?.progress?.succeeded) || 0;
      setToast(`Level up done. Updated ${updatedCount} players.`);
  // Realtime listener will update UI automatically
    } catch (e) {
      console.error("Level up all failed", e);
      setError("Level up failed. See console.");
    } finally {
      setBusy(false);
      setTimeout(()=>setToast(null), 4000);
    }
  };

  const executeLevelUpOne = async (targetUserId) => {
    if (userData.role !== "dm") {
      setError("Permission denied: Only DMs can level up players");
      return;
    }
    try {
      setBusy(true);
      setToast(null);
      setError(null);
      await runWithDurableOperationIntent({
        actorUid: user?.uid,
        kind: "level-up-user",
        intent: { userId: targetUserId },
        invoke: (operationId) => levelUpUser({
          userId: targetUserId,
          operationId,
        }),
      });
      setToast(`Level up done for user.`);
  // Realtime listener will update UI automatically
    } catch (e) {
      console.error("Level up user failed", e);
      setError("Level up failed. See console.");
    } finally {
      setBusy(false);
      setTimeout(()=>setToast(null), 3000);
    }
  };

  // Add combat tokens to a specific user
  const executeCombatTokenUpdate = async (targetUserId, amount) => {
    if (userData.role !== "dm") {
      setError("Permission denied: Only DMs can modify tokens");
      return;
    }
    try {
      setBusy(true);
      setToast(null);
      setError(null);
      const targetUser = users.find((entry) => entry.id === targetUserId);
      if (!targetUser) {
        throw new Error("The selected user is no longer available.");
      }
      const current = Number(targetUser?.stats?.combatTokensAvailable) || 0;
      const next = current + amount;
      await updateProgression({
        userId: targetUserId,
        patch: {
          stats: { combatTokensAvailable: next },
        },
        retryKey: [
          "dm-combat-tokens",
          targetUserId,
          current,
          amount,
          next,
        ].join(":"),
      });
      setToast(`${amount > 0 ? "Added" : "Removed"} ${Math.abs(amount)} combat token${Math.abs(amount) === 1 ? "" : "s"}.`);
  // Realtime listener will update UI automatically
    } catch (e) {
      console.error("Add tokens failed", e);
      setError("Failed to update tokens. See console.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const openActionDialog = (kind, targetUserId = null) => {
    setActionDialogError(null);
    setActionDialogValue("1");
    setActionDialog({ kind, targetUserId });
  };

  const closeActionDialog = () => {
    if (busy) return;
    setActionDialog(null);
    setActionDialogError(null);
  };

  const handleLevelUpAll = () => openActionDialog("level-up-all");
  const handleLevelUpOne = (targetUserId) => openActionDialog("level-up-one", targetUserId);
  const handleAddCombatTokens = (targetUserId) => openActionDialog("combat-tokens", targetUserId);

  const confirmActionDialog = async () => {
    if (!actionDialog || busy) return;
    const pendingAction = actionDialog;
    if (pendingAction.kind === "combat-tokens") {
      const amount = parseIntegerInput(actionDialogValue);
      if (amount === null) {
        setActionDialogError("Enter a valid whole number.");
        return;
      }
      if (amount === 0) {
        setActionDialogError("Enter a value other than zero.");
        return;
      }
      setActionDialog(null);
      await executeCombatTokenUpdate(pendingAction.targetUserId, amount);
      return;
    }

    setActionDialog(null);
    if (pendingAction.kind === "level-up-all") {
      await executeLevelUpAll();
    } else if (pendingAction.kind === "level-up-one") {
      await executeLevelUpOne(pendingAction.targetUserId);
    }
  };

  const actionTarget = actionDialog?.targetUserId
    ? users.find((entry) => entry.id === actionDialog.targetUserId)
    : null;
  const actionTargetLabel = actionTarget?.characterId
    || actionTarget?.label
    || actionTarget?.email
    || "this player";
  const actionDialogCopy = actionDialog?.kind === "level-up-all"
    ? {
        title: "Level up all players?",
        description: "This increases every player's level by 1.",
        confirmLabel: "Level Up All",
        confirmTone: "danger",
      }
    : actionDialog?.kind === "level-up-one"
      ? {
          title: `Level up ${actionTargetLabel}?`,
          description: "This increases this player's level by 1.",
          confirmLabel: "Level Up",
        }
      : {
          title: `Adjust tokens for ${actionTargetLabel}`,
          description: "Use a positive number to add combat tokens or a negative number to remove them.",
          inputLabel: "Combat token change",
          confirmLabel: "Apply",
        };

  // Note: lock toggles handled in LockSettingsTable to avoid whole-page re-renders

  

  // Render the lock settings table (delegates to child to avoid rerendering the whole page)
  const renderLockSettingsTable = () => {
    if (loading) {
      return <div className="text-white mt-4">Loading user data...</div>;
    }
    if (error) {
      return <div className="text-red-500 mt-4">{error}</div>;
    }
    if (users.length === 0) {
      return <div className="text-white mt-4">No users found.</div>;
    }

    return (
      <div className="mt-8">
        <SectionHeader title="User Lock Settings" sectionKey="locks" />
        {sectionsOpen.locks && (
          <LockSettingsTable users={users} canEdit={userData.role === 'dm'} />
        )}
      </div>
    );
  };

  if (!userData) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="w-full max-w-none mx-0 p-4">
          <div className="bg-gray-800 rounded-lg p-6">
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (userData.role !== "dm") {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="w-full max-w-none mx-0 p-4">
          <div className="bg-gray-800 rounded-lg p-6 text-red-500">
            <p>Access denied. This area is only accessible to DMs.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Full-width, left-aligned wrapper (no centered container)  */}
      <div className="w-full max-w-none mx-0 p-4">
        {/* Sticky top bar with global actions */}
        <div
          className="sticky z-20 -mx-4 mb-6 border-b border-slate-800/60 bg-gray-900/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-gray-900/60"
          style={{ top: `${topInset}px` }}
        >
          <div className="flex items-center justify-between">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-100 tracking-tight">DM Dashboard</h1>
            <button
              onClick={handleLevelUpAll}
              disabled={busy}
              className={`px-4 py-2 rounded-md text-white text-sm shadow ${busy ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-500'} `}
              title="Increase level by 1 for all players"
            >
              {busy ? 'Leveling…' : 'Level Up All'}
            </button>
          </div>
          {toast && <div className="mt-2 text-xs text-emerald-300">{toast}</div>}
        </div>

        {/* Welcome blurb */}
        <div className="bg-gray-800/90 border border-slate-700/60 rounded-lg p-4">
          <p className="text-slate-200 text-sm">
            Welcome to the DM Dashboard. This area is only accessible to users with the DM role.
          </p>
        </div>

        <div className="mt-8">
          <SectionHeader title="Players" sectionKey="players" />
          {sectionsOpen.players && (
            <>
              <div className="mb-4">
                <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-2">Seleziona giocatori da mostrare</div>
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    onClick={() => setSelectedUserIds(users.map((u) => u.id))}
                    className="rounded-full border border-emerald-400/70 bg-emerald-800/60 px-3 py-1 text-[11px] font-semibold text-emerald-50 transition hover:bg-emerald-700/70"
                  >
                    Seleziona tutti
                  </button>
                  <button
                    onClick={() => setSelectedUserIds([])}
                    className="rounded-full border border-rose-400/70 bg-rose-800/60 px-3 py-1 text-[11px] font-semibold text-rose-50 transition hover:bg-rose-700/70"
                  >
                    Deseleziona tutti
                  </button>
                  <span className="mx-2 h-5 w-px bg-slate-700/70" />
                  {users.map((user) => {
                    const isSelected = selectedUserIds.includes(user.id);
                    const label = user.characterId || user.label || user.email;
                    return (
                      <button
                        key={user.id}
                        onClick={() => toggleUserSelection(user.id)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          isSelected
                            ? "border-indigo-400 bg-indigo-700/80 text-white shadow"
                            : "border-slate-700/70 bg-slate-800/70 text-slate-200 hover:bg-slate-700/70"
                        }`}
                        title={isSelected ? "Nascondi tile" : "Mostra tile"}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {!users.length && <span className="text-sm text-slate-400">Nessun giocatore disponibile</span>}
                </div>
              </div>

              {selectedUserIds.length > 0 ? (
                <PlayerInfo 
                  users={users.filter((u) => selectedUserIds.includes(u.id))}
                  loading={loading}
                  error={error}
                  variant="card"
                  onLevelUpOne={handleLevelUpOne}
                  onAddTokens={handleAddCombatTokens}
                  busy={busy}
                  canEditVitals={userData.role === 'dm'}
                />
              ) : (
                <div className="rounded-lg border border-slate-700/60 bg-gray-800/60 p-4 text-sm text-slate-300">
                  Nessun giocatore selezionato. Scegli un nome sopra per mostrare il relativo tile.
                </div>
              )}
            </>
          )}
        </div>

        {renderLockSettingsTable()}
      </div>
      <ManagerActionDialog
        visible={!!actionDialog}
        title={actionDialogCopy.title}
        description={actionDialogCopy.description}
        inputLabel={actionDialogCopy.inputLabel}
        value={actionDialogValue}
        onChange={(value) => {
          setActionDialogValue(value);
          setActionDialogError(null);
        }}
        error={actionDialogError}
        busy={busy}
        confirmLabel={actionDialogCopy.confirmLabel}
        confirmTone={actionDialogCopy.confirmTone}
        onClose={closeActionDialog}
        onConfirm={confirmActionDialog}
      />
    </div>
  );
};

export default DMDashboard;

