// file: ./frontend/src/components/dmDashboard/DMDashboard.js
import React, { useState, useEffect } from "react";
import Navbar from "../common/navbar";
import { db } from "../firebaseConfig";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
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
                    {user.characterId || user.email || "Unknown User"}
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
        <Navbar />
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
        <Navbar />
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
      <Navbar />
      <div className="container mx-auto p-4">
        <h1 className="text-3xl font-bold mb-6">DM Dashboard</h1>
        <div className="bg-gray-800 rounded-lg p-6">
          <p>
            Welcome to the DM Dashboard. This area is only accessible to users with the DM role.
          </p>
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
