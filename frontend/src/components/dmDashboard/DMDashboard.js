// file: ./frontend/src/components/dmDashboard/DMDashboard.js
import React, { useState, useEffect } from "react";
import { db, app } from "../firebaseConfig";
import { collection, getDocs, doc, updateDoc, increment } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useAuth } from "../../AuthContext";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faLockOpen } from "@fortawesome/free-solid-svg-icons";
import { library } from "@fortawesome/fontawesome-svg-core";
import PlayerInfo from "./elements/playerInfo";

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

  // Handler to toggle a given lock field (either lock_param_base or lock_param_combat)
  const handleToggleLock = async (userId, field, currentValue) => {
    if (userData.role !== "dm") {
      setError("Permission denied: Only DMs can modify settings");
      return;
    }

    try {
      const userRef = doc(db, "users", userId);
      await updateDoc(userRef, {
        [`settings.${field}`]: !currentValue,
      });

      setUsers(users.map(u => {
        if (u.id === userId) {
          return {
            ...u,
            settings: {
              ...u.settings,
              [field]: !currentValue
            }
          };
        }
        return u;
      }));
    } catch (error) {
      console.error("Error updating lock setting:", error);
      setError("Failed to update setting. Please try again.");
    }
  };

  // Render the lock settings table
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
        <h2 className="mb-3 text-white text-xl">User Lock Settings</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-white">
            <thead>
              <tr>
                <th className="border px-4 py-2">Setting</th>
                {users.map((user) => (
                  <th key={user.id} className="border px-4 py-2">
                    <div className="flex flex-col items-center gap-1">
                      <div className="text-sm font-medium">
                        {user.characterId || user.email || "Unknown User"}
                      </div>
                      <div className="text-xs text-gray-300">Lv {user?.stats?.level || 1}</div>
                      <button
                        onClick={() => handleLevelUpOne(user.id)}
                        disabled={busy}
                        className={`mt-1 px-2 py-1 rounded text-xs ${busy ? 'bg-emerald-400' : 'bg-emerald-600 hover:bg-emerald-500'} text-white`}
                        title="Increase level by 1 for this player"
                      >
                        Level Up
                      </button>
                      <button
                        onClick={() => handleAddCombatTokens(user.id)}
                        disabled={busy}
                        className={`mt-1 px-2 py-1 rounded text-xs ${busy ? 'bg-amber-400' : 'bg-amber-600 hover:bg-amber-500'} text-white`}
                        title="Add combat tokens to this player"
                      >
                        Add Tokens
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border px-4 py-2">Lock Parametri Base</td>
                {users.map((user) => (
                  <td key={`${user.id}-base`} className="border px-4 py-2 text-center">
                    <button
                      onClick={() =>
                        handleToggleLock(user.id, "lock_param_base", user.settings?.lock_param_base || false)
                      }
                      className="focus:outline-none"
                    >
                      <FontAwesomeIcon
                        icon={user.settings?.lock_param_base ? faLock : faLockOpen}
                        className={user.settings?.lock_param_base ? "text-red-500" : "text-green-500"}
                      />
                    </button>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="border px-4 py-2">Lock Parametri Combattimento</td>
                {users.map((user) => (
                  <td key={`${user.id}-combat`} className="border px-4 py-2 text-center">
                    <button
                      onClick={() =>
                        handleToggleLock(user.id, "lock_param_combat", user.settings?.lock_param_combat || false)
                      }
                      className="focus:outline-none"
                    >
                      <FontAwesomeIcon
                        icon={user.settings?.lock_param_combat ? faLock : faLockOpen}
                        className={user.settings?.lock_param_combat ? "text-red-500" : "text-green-500"}
                      />
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  if (!userData) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="container mx-auto p-4">
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
        <div className="container mx-auto p-4">
          <div className="bg-gray-800 rounded-lg p-6 text-red-500">
            <p>Access denied. This area is only accessible to DMs.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto p-4">
        <h1 className="text-3xl font-bold mb-6">DM Dashboard</h1>
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <p>
              Welcome to the DM Dashboard. This area is only accessible to users with the DM role.
            </p>
            <button
              onClick={handleLevelUpAll}
              disabled={busy}
              className={`px-4 py-2 rounded-md text-white text-sm ${busy ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-500'} `}
              title="Increase level by 1 for all players"
            >
              {busy ? 'Leveling…' : 'Level Up All'}
            </button>
          </div>
          {toast && (
            <div className="mt-3 text-sm text-green-300">{toast}</div>
          )}
        </div>
        {renderLockSettingsTable()}
        <PlayerInfo 
          users={users}
          loading={loading}
          error={error}
          setUsers={setUsers}
        />
      </div>
    </div>
  );
};

export default DMDashboard;
