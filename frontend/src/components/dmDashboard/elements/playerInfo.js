import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEdit, faTrash } from "@fortawesome/free-solid-svg-icons";
import { library } from "@fortawesome/fontawesome-svg-core";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebaseConfig";
import { AddTecnicaPersonaleOverlay } from "./addTecnicaPersonale";
import { EditTecnicaPersonale } from "./editTecnicaPersonale";
import { DelTecnicaPersonale } from "./delTecnicaPersonale";
import { AddSpellOverlay } from "./addSpell";
import { EditSpellOverlay } from "./editSpell";
import { DelSpellOverlay } from "./delSpell";

// Add icons to library
library.add(faEdit, faTrash);

const PlayerInfo = ({ users, loading, error, setUsers }) => {
  // State variables for the technique overlays
  const [showTecnicaOverlay, setShowTecnicaOverlay] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [showEditTecnicaOverlay, setShowEditTecnicaOverlay] = useState(false);
  const [selectedTecnica, setSelectedTecnica] = useState(null);
  const [showDeleteTecnicaOverlay, setShowDeleteTecnicaOverlay] = useState(false);
  
  // State variables for the spell overlays
  const [showSpellOverlay, setShowSpellOverlay] = useState(false);
  const [showEditSpellOverlay, setShowEditSpellOverlay] = useState(false);
  const [showDeleteSpellOverlay, setShowDeleteSpellOverlay] = useState(false);
  const [selectedSpell, setSelectedSpell] = useState(null);

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
  
  // Handler function for opening the Spell overlay
  const handleAddSpellClick = (userId) => {
    setSelectedUserId(userId);
    setShowSpellOverlay(true);
  };
  
  // Handler function for opening the Edit Spell overlay
  const handleEditSpellClick = (userId, spellName, spellData) => {
    setSelectedUserId(userId);
    setSelectedSpell({
      name: spellName,
      data: spellData
    });
    setShowEditSpellOverlay(true);
  };
  
  // Handler function for opening the Delete Spell overlay
  const handleDeleteSpellClick = (userId, spellName, spellData) => {
    setSelectedUserId(userId);
    setSelectedSpell({
      name: spellName,
      data: spellData
    });
    setShowDeleteSpellOverlay(true);
  };

  // Function to refresh user data after changes
  const refreshUserData = async () => {
    try {
      const usersRef = collection(db, "users");
      const snapshot = await getDocs(usersRef);
      const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUsers(usersData);
    } catch (err) {
      console.error("Error refreshing users:", err);
    }
  };

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
                  <div className="flex flex-col items-center">
                    <button
                      className="w-48 px-3 py-1.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium rounded-md shadow-md transition-all duration-200 transform hover:scale-105 flex items-center justify-center space-x-1"
                      onClick={() => handleAddTecnicaClick(user.id)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                      <span>Aggiungi Tecnica</span>
                    </button>
                    
                    <button
                      className="w-48 mt-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-medium rounded-md shadow-md transition-all duration-200 transform hover:scale-105 flex items-center justify-center space-x-1"
                      onClick={() => handleAddSpellClick(user.id)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                      <span>Aggiungi Spell</span>
                    </button>
                  </div>
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
                              className="px-1.5 py-1 bg-yellow-600 hover:bg-yellow-700 rounded-full text-xs transition-transform hover:scale-110"
                              title="Modify Tecnica"
                              onClick={() => handleEditTecnicaClick(user.id, tecnicaName, user.tecniche[tecnicaName])}
                            >
                              <FontAwesomeIcon icon="edit" />
                            </button>
                            <button
                              className="px-1.5 py-1 bg-red-600 hover:bg-red-700 rounded-full text-xs transition-transform hover:scale-110"
                              title="Delete Tecnica"
                              onClick={() => handleDeleteTecnicaClick(user.id, tecnicaName, user.tecniche[tecnicaName])}
                            >
                              <FontAwesomeIcon icon="trash" />
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
            <tr>
              <td className="border px-4 py-2">Spells</td>
              {users.map((user) => (
                <td key={`${user.id}-spells`} className="border px-4 py-2">
                  {user.spells ? (
                    <ul className="list-disc list-inside">
                      {Object.keys(user.spells).map((spellName) => (
                        <li key={spellName} className="text-sm flex items-center justify-between">
                          <span>{spellName}</span>
                          <div className="ml-2 space-x-1">
                            <button
                              className="px-1.5 py-1 bg-yellow-600 hover:bg-yellow-700 rounded-full text-xs transition-transform hover:scale-110"
                              title="Modify Spell"
                              onClick={() => handleEditSpellClick(user.id, spellName, user.spells[spellName])}
                            >
                              <FontAwesomeIcon icon="edit" />
                            </button>
                            <button
                              className="px-1.5 py-1 bg-red-600 hover:bg-red-700 rounded-full text-xs transition-transform hover:scale-110"
                              title="Delete Spell"
                              onClick={() => handleDeleteSpellClick(user.id, spellName, user.spells[spellName])}
                            >
                              <FontAwesomeIcon icon="trash" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-400 text-sm">No spells found</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {showTecnicaOverlay && selectedUserId && (
        <AddTecnicaPersonaleOverlay
          userId={selectedUserId}
          onClose={(success) => {
            setShowTecnicaOverlay(false);
            setSelectedUserId(null);
            if (success) {
              refreshUserData();
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
              refreshUserData();
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
              refreshUserData();
            }
          }}
        />
      )}
      
      {showSpellOverlay && selectedUserId && (
        <AddSpellOverlay
          userId={selectedUserId}
          onClose={(success) => {
            setShowSpellOverlay(false);
            setSelectedUserId(null);
            if (success) {
              refreshUserData();
            }
          }}
        />
      )}
      
      {showEditSpellOverlay && selectedUserId && selectedSpell && (
        <EditSpellOverlay
          userId={selectedUserId}
          spellName={selectedSpell.name}
          spellData={selectedSpell.data}
          onClose={(success) => {
            setShowEditSpellOverlay(false);
            setSelectedUserId(null);
            setSelectedSpell(null);
            if (success) {
              refreshUserData();
            }
          }}
        />
      )}
      
      {showDeleteSpellOverlay && selectedUserId && selectedSpell && (
        <DelSpellOverlay
          userId={selectedUserId}
          spellName={selectedSpell.name}
          spellData={selectedSpell.data}
          onClose={(success) => {
            setShowDeleteSpellOverlay(false);
            setSelectedUserId(null);
            setSelectedSpell(null);
            if (success) {
              refreshUserData();
            }
          }}
        />
      )}
    </div>
  );
};

export default PlayerInfo;
