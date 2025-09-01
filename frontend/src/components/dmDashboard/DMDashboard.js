// file: ./frontend/src/components/dmDashboard/DMDashboard.js
import React, { useState, useEffect } from "react";
import { db, app } from "../firebaseConfig";
import { collection, getDocs, doc, updateDoc, increment } from "firebase/firestore";
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
  // Collapsible sections state
  const [sectionsOpen, setSectionsOpen] = useState({
    overview: true,
    vitals: true,
    locks: true,
    playerInfo: true,
  });

  // Fetch users only once after confirming DM status
  useEffect(() => {
    if (!userData) {
      return; // Still loading user data
    }

    if (userData.role !== "dm") {
      console.log("Access denied: User is not a DM");
      navigate("/home");
      return;
    }

    const fetchUsers = async () => {
      try {
        setLoading(true);
        const usersRef = collection(db, "users");
        const snapshot = await getDocs(usersRef);
        const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setUsers(usersData);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching users:", err);
        setError("Failed to load users. Please try again.");
        setLoading(false);
      }
    };

    fetchUsers();
  }, [userData, navigate]);

  const refreshUsers = async () => {
    try {
      const usersRef = collection(db, "users");
      const snapshot = await getDocs(usersRef);
      const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUsers(usersData);
    } catch (e) {
      console.error("Refresh users failed", e);
    }
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
      await refreshUsers();
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
      await refreshUsers();
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
      await refreshUsers();
    } catch (e) {
      console.error("Add tokens failed", e);
      setError("Failed to update tokens. See console.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  // Note: lock toggles handled in LockSettingsTable to avoid whole-page re-renders

  // Player overview cards with quick actions
  const renderPlayerOverview = () => {
    if (loading) return null;
    if (!users.length) return null;

    return (
      <div className="mt-8">
        <SectionHeader title="Players Overview" sectionKey="overview" />
        {sectionsOpen.overview && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {users.map((user) => {
              const bAvail = Number(user?.stats?.basePointsAvailable) || 0;
              const bSpent = Number(user?.stats?.basePointsSpent) || 0;
              const bTot = bAvail + bSpent;
              const cAvail = Number(user?.stats?.combatTokensAvailable) || 0;
              const cSpent = Number(user?.stats?.combatTokensSpent) || 0;
              const cTot = cAvail + cSpent;
              return (
                <div key={user.id} className="rounded-lg border border-slate-700/60 bg-gray-800/90 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-slate-100">
                        {user.characterId || user.email || "Unknown User"}
                      </div>
                      <div className="text-xs text-gray-300">Lv {user?.stats?.level || 1}</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400/80">Base</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-300 ring-1 ring-inset ring-emerald-400/30" title="Base points available">A {bAvail}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-400/10 px-2 py-0.5 text-slate-300 ring-1 ring-inset ring-white/10" title="Base points spent">S {bSpent}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-slate-200 ring-1 ring-inset ring-white/10" title="Base points total">T {bTot}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400/80">Combat</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-400/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30" title="Combat tokens available">A {cAvail}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-400/10 px-2 py-0.5 text-slate-300 ring-1 ring-inset ring-white/10" title="Combat tokens spent">S {cSpent}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-slate-200 ring-1 ring-inset ring-white/10" title="Combat tokens total">T {cTot}</span>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleLevelUpOne(user.id)}
                      disabled={busy}
                      className={`px-2 py-1 rounded text-xs ${busy ? 'bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-500'} text-white shadow-sm`}
                      title="Increase level by 1 for this player"
                    >
                      Level Up
                    </button>
                    <button
                      onClick={() => handleAddCombatTokens(user.id)}
                      disabled={busy}
                      className={`px-2 py-1 rounded text-xs ${busy ? 'bg-amber-400' : 'bg-amber-600 hover:bg-amber-500'} text-white shadow-sm`}
                      title="Add combat tokens to this player"
                    >
                      Add Tokens
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };
  

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

  // Render player vitals (HP and Mana) for each user
  const renderVitalsTable = () => {
    if (loading) return null;
    if (!users.length) return null;

    const VBar = ({ pct, track, fill }) => (
      <div className={`w-28 h-2 ${track} rounded overflow-hidden border border-slate-700/50`}>
        <div className={`${fill} h-full`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    );

    return (
      <div className="mt-8">
        <SectionHeader title="Player Vitals" sectionKey="vitals" />
        {sectionsOpen.vitals && (
          <div className="overflow-x-auto rounded-lg border border-slate-700/60 shadow-sm">
            <table className="min-w-max border-collapse text-white bg-gray-800 text-sm">
              <thead className="bg-gray-700/80 backdrop-blur supports-[backdrop-filter]:bg-gray-700/70">
                <tr className="text-slate-100">
                  <th className="sticky left-0 z-20 border border-gray-600 px-4 py-2 text-left bg-gray-700/80">Stat</th>
                  {users.map((u) => (
                    <th key={u.id} className="border border-gray-600 px-3 py-2 text-center min-w-[10rem] align-top">
                      <div className="text-sm font-medium">{u.characterId || u.email || 'Unknown User'}</div>
                      <div className="text-xs text-gray-300">Lv {u?.stats?.level || 1}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* HP row */}
                <tr className="bg-gray-800 hover:bg-gray-700/60">
                  <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">HP</td>
                  {users.map((u) => {
                    const cur = Number(u?.stats?.hpCurrent) || 0;
                    const tot = Number(u?.stats?.hpTotal) || 0;
                    const pct = tot > 0 ? (cur / tot) * 100 : 0;
                    return (
                      <td key={`${u.id}-hp`} className="border border-gray-600 px-4 py-2 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <VBar pct={pct} track="bg-red-900/30" fill="bg-gradient-to-r from-red-500 to-rose-500" />
                          <div className="text-xs tabular-nums text-slate-300">{cur}/{tot}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
                {/* Mana row */}
                <tr className="bg-gray-800 hover:bg-gray-700/60">
                  <td className="sticky left-0 z-10 border border-gray-600 px-4 py-2 bg-gray-800 font-medium">Mana</td>
                  {users.map((u) => {
                    const cur = Number(u?.stats?.manaCurrent) || 0;
                    const tot = Number(u?.stats?.manaTotal) || 0;
                    const pct = tot > 0 ? (cur / tot) * 100 : 0;
                    return (
                      <td key={`${u.id}-mana`} className="border border-gray-600 px-4 py-2 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <VBar pct={pct} track="bg-indigo-900/30" fill="bg-gradient-to-r from-indigo-600 to-fuchsia-600" />
                          <div className="text-xs tabular-nums text-slate-300">{cur}/{tot}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
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

        {renderPlayerOverview()}
        {renderVitalsTable()}
        {renderLockSettingsTable()}

        {/* Player info table */}
        <div className="mt-8">
          <SectionHeader title="Player Info" sectionKey="playerInfo" />
          {sectionsOpen.playerInfo && (
            <div className="overflow-x-auto">
              <PlayerInfo 
                users={users}
                loading={loading}
                error={error}
                setUsers={setUsers}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DMDashboard;
