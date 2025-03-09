// file: ./frontend/src/components/DMDashboard.js
import React, { useState, useEffect } from "react";
import Navbar from "../common/navbar";
import { db } from "../firebaseConfig";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { useAuth } from "../../AuthContext";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faLockOpen, faEdit, faTrash } from "@fortawesome/free-solid-svg-icons";
import { library } from "@fortawesome/fontawesome-svg-core";
import { AddTecnicaPersonaleOverlay } from "../dmElements/addTecnicaPersonale";
import { EditTecnicaPersonale } from "../dmElements/editTecnicaPersonale";
import { DelTecnicaPersonale } from "../dmElements/delTecnicaPersonale";

// Add icons to library
library.add(faLock, faLockOpen, faEdit, faTrash);

const DMDashboard = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { userData } = useAuth();
  const navigate = useNavigate();

  // New state variables for the Tecnica overlay
  const [showTecnicaOverlay, setShowTecnicaOverlay] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);

  // New state variables for the Edit Tecnica overlay
  const [showEditTecnicaOverlay, setShowEditTecnicaOverlay] = useState(false);
  const [selectedTecnica, setSelectedTecnica] = useState(null);

  // New state variable for the Delete Tecnica overlay
  const [showDeleteTecnicaOverlay, setShowDeleteTecnicaOverlay] = useState(false);

  // Handler function for opening the Tecnica overlay
  const handleAddTecnicaClick = (userId) => {
    setSelectedUserId(userId);
    setShowTecnicaOverlay(true);
  };

  // Handler function for opening the Edit Tecnica overlay
  const handleEditTecnicaClick = (userId, tecnicaName, tecnicaData) => {
    setSelectedUserId(userId);
    setSelectedTecnica({
      name: tecnicaName,
      data: tecnicaData
    });
    setShowEditTecnicaOverlay(true);
  };

  // Handler function for opening the Delete Tecnica overlay
  const handleDeleteTecnicaClick = (userId, tecnicaName, tecnicaData) => {
    setSelectedUserId(userId);
    setSelectedTecnica({
      name: tecnicaName,
      data: tecnicaData
    });
    setShowDeleteTecnicaOverlay(true);
  };

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

  // New function to display player technique information
  const renderPlayerInfoTable = () => {
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
        <h2 className="mb-3 text-white text-xl">Player Info</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-white">
            <thead>
              <tr>
                <th className="border px-4 py-2">Tecniche</th>
                {users.map((user) => (
                  <th key={user.id} className="border px-4 py-2">
                    {user.characterId || user.email || "Unknown User"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border px-4 py-2">Actions</td>
                {users.map((user) => (
                  <td key={`${user.id}-action`} className="border px-4 py-2 text-center">
                    <button
                      className="px-3 py-1.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium rounded-md shadow-md transition-all duration-200 transform hover:scale-105 flex items-center justify-center space-x-1"
                      onClick={() => handleAddTecnicaClick(user.id)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                      <span>Aggiungi Tecnica</span>
                    </button>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="border px-4 py-2">Tecniche</td>
                {users.map((user) => (
                  <td key={`${user.id}-tecniche`} className="border px-4 py-2">
                    {user.tecniche ? (
                      <ul className="list-disc list-inside">
                        {Object.keys(user.tecniche).map((tecnicaName) => (
                          <li key={tecnicaName} className="text-sm flex items-center justify-between">
                            <span>{tecnicaName}</span>
                            <div className="ml-2 space-x-1">
                              <button
                                className="px-1 py-0.5 bg-yellow-600 hover:bg-yellow-700 rounded text-xs"
                                title="Modify Tecnica"
                                onClick={() => handleEditTecnicaClick(user.id, tecnicaName, user.tecniche[tecnicaName])}
                              >
                                <FontAwesomeIcon icon="edit" className="mr-1" />
                              </button>
                              <button
                                className="px-1 py-0.5 bg-red-600 hover:bg-red-700 rounded text-xs"
                                title="Delete Tecnica"
                                onClick={() => handleDeleteTecnicaClick(user.id, tecnicaName, user.tecniche[tecnicaName])}
                              >
                                <FontAwesomeIcon icon="trash" className="mr-1" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-gray-400 text-sm">No tecniche found</span>
                    )}
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
        {renderPlayerInfoTable()}
      </div>
      {showTecnicaOverlay && selectedUserId && (
        <AddTecnicaPersonaleOverlay
          userId={selectedUserId}
          onClose={(success) => {
            setShowTecnicaOverlay(false);
            setSelectedUserId(null);
            if (success) {
              const fetchUsers = async () => {
                try {
                  const usersRef = collection(db, "users");
                  const snapshot = await getDocs(usersRef);
                  const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                  setUsers(usersData);
                } catch (err) {
                  console.error("Error refreshing users:", err);
                }
              };
              fetchUsers();
            }
          }}
        />
      )}
      {showEditTecnicaOverlay && selectedUserId && selectedTecnica && (
        <EditTecnicaPersonale
          userId={selectedUserId}
          tecnicaName={selectedTecnica.name}
          tecnicaData={selectedTecnica.data}
          onClose={(success) => {
            setShowEditTecnicaOverlay(false);
            setSelectedUserId(null);
            setSelectedTecnica(null);
            if (success) {
              const fetchUsers = async () => {
                try {
                  const usersRef = collection(db, "users");
                  const snapshot = await getDocs(usersRef);
                  const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                  setUsers(usersData);
                } catch (err) {
                  console.error("Error refreshing users:", err);
                }
              };
              fetchUsers();
            }
          }}
        />
      )}
      {showDeleteTecnicaOverlay && selectedUserId && selectedTecnica && (
        <DelTecnicaPersonale
          userId={selectedUserId}
          tecnicaName={selectedTecnica.name}
          tecnicaData={selectedTecnica.data}
          onClose={(success) => {
            setShowDeleteTecnicaOverlay(false);
            setSelectedUserId(null);
            setSelectedTecnica(null);
            if (success) {
              const fetchUsers = async () => {
                try {
                  const usersRef = collection(db, "users");
                  const snapshot = await getDocs(usersRef);
                  const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                  setUsers(usersData);
                } catch (err) {
                  console.error("Error refreshing users:", err);
                }
              };
              fetchUsers();
            }
          }}
        />
      )}
    </div>
  );
};

export default DMDashboard;
