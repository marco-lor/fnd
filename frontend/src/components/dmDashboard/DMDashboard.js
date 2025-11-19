// file: ./frontend/src/components/dmDashboard/DMDashboard.js
import React, { useState, useEffect } from "react";
import { db, app } from "../firebaseConfig";
import { collection, doc, updateDoc, increment, onSnapshot } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useAuth } from "../../AuthContext";
import { useNavigate } from "react-router-dom";
import { library } from "@fortawesome/fontawesome-svg-core";
import { faLock, faLockOpen } from "@fortawesome/free-solid-svg-icons";
import PlayerInfo from "./elements/playerInfo";
import LockSettingsTable from "./elements/LockSettingsTable";

// Add icons to library
library.add(faLock, faLockOpen);

const DMDashboard = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { userData } = useAuth();
  const navigate = useNavigate();
  const functions = getFunctions(app, "europe-west8");
  const levelUpAll = httpsCallable(functions, "levelUpAll");
  const levelUpUser = httpsCallable(functions, "levelUpUser");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  // Collapsible sections state
  const [sectionsOpen, setSectionsOpen] = useState({
    players: true,
    locks: true,
  });

  // Realtime subscription to users collection once DM status is confirmed.
  // This removes the need for manual refreshes after operations (level ups, token changes, etc.).
  // If performance becomes an issue with many users, consider adding query constraints
  // or switching to individual doc listeners based on a selected subset.
  useEffect(() => {
    if (!userData) return; // Still loading user data

    if (userData.role !== "dm") {
      console.log("Access denied: User is not a DM");
      navigate("/home");
      return;
    }

    setLoading(true);
    const usersRef = collection(db, "users");
    const unsubscribe = onSnapshot(
      usersRef,
      (snapshot) => {
        const usersData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setUsers(usersData);
        setLoading(false);
      },
      (err) => {
        console.error("Realtime users listener error:", err);
        setError("Failed to subscribe to users updates.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userData, navigate]);

  // Ensure player selection state stays in sync with the current users list.
  // New users are auto-selected; removed users are cleaned out.
  useEffect(() => {
    if (!users.length) {
      setSelectedUserIds([]);
      return;
    }
    setSelectedUserIds((prev) => {
      const stillValid = prev.filter((id) => users.some((u) => u.id === id));
      const withNew = Array.from(new Set([...stillValid, ...users.map((u) => u.id)]));
      return withNew;
    });
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

  const handleLevelUpAll = async () => {
    if (userData.role !== "dm") {
      setError("Permission denied: Only DMs can level up players");
      return;
    }
    if (!window.confirm("Are you sure you want to increase the level of all players by 1?")) {
      return;
    }
    try {
      setBusy(true);
      setToast(null);
      const res = await levelUpAll({ idempotencyKey: `${Date.now()}` });
      const payload = res?.data;
      const updatedCount = Array.isArray(payload?.updated) ? payload.updated.filter((r)=>r.toLevel).length : 0;
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

  const handleLevelUpOne = async (targetUserId) => {
    if (userData.role !== "dm") {
      setError("Permission denied: Only DMs can level up players");
      return;
    }
    if (!window.confirm("Confirm level up for this player?")) {
      return;
    }
    try {
      setBusy(true);
      setToast(null);
      await levelUpUser({ userId: targetUserId });
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
  const handleAddCombatTokens = async (targetUserId) => {
    if (userData.role !== "dm") {
      setError("Permission denied: Only DMs can modify tokens");
      return;
    }
    const input = window.prompt("How many combat tokens to add? (use negative to remove)", "1");
    if (input === null) return; // cancelled
    const amount = parseInt(input, 10);
    if (Number.isNaN(amount) || !Number.isFinite(amount)) {
      setError("Invalid number.");
      return;
    }
    if (amount === 0) return;
    if (amount < 0 && !window.confirm(`Remove ${Math.abs(amount)} tokens from this player?`)) {
      return;
    }
    try {
      setBusy(true);
      setToast(null);
      const userRef = doc(db, "users", targetUserId);
      await updateDoc(userRef, {
        "stats.combatTokensAvailable": increment(amount),
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
      {/* Full-width, left-aligned wrapper (no centered container) */}
      <div className="w-full max-w-none mx-0 p-4">
        {/* Sticky top bar with global actions */}
        <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-slate-800/60 bg-gray-900/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-gray-900/60">
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
                    const label = user.characterId || user.email;
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
                  setUsers={setUsers}
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
    </div>
  );
};

export default DMDashboard;

