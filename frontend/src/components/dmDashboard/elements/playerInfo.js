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
  // State variables (remain the same)
  const [showTecnicaOverlay, setShowTecnicaOverlay] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [showEditTecnicaOverlay, setShowEditTecnicaOverlay] = useState(false);
  const [selectedTecnica, setSelectedTecnica] = useState(null);
  const [showDeleteTecnicaOverlay, setShowDeleteTecnicaOverlay] = useState(false);

  const [showSpellOverlay, setShowSpellOverlay] = useState(false);
  const [showEditSpellOverlay, setShowEditSpellOverlay] = useState(false);
  const [showDeleteSpellOverlay, setShowDeleteSpellOverlay] = useState(false);
  const [selectedSpell, setSelectedSpell] = useState(null);

  // Handlers (remain the same)
  const handleAddTecnicaClick = (userId) => {
    setSelectedUserId(userId);
    setShowTecnicaOverlay(true);
  };

  const handleEditTecnicaClick = (userId, tecnicaName, tecnicaData) => {
    setSelectedUserId(userId);
    setSelectedTecnica({ name: tecnicaName, data: tecnicaData });
    setShowEditTecnicaOverlay(true);
  };

  const handleDeleteTecnicaClick = (userId, tecnicaName, tecnicaData) => {
    setSelectedUserId(userId);
    setSelectedTecnica({ name: tecnicaName, data: tecnicaData });
    setShowDeleteTecnicaOverlay(true);
  };

  const handleAddSpellClick = (userId) => {
    setSelectedUserId(userId);
    setShowSpellOverlay(true);
  };

  const handleEditSpellClick = (userId, spellName, spellData) => {
    setSelectedUserId(userId);
    setSelectedSpell({ name: spellName, data: spellData });
    setShowEditSpellOverlay(true);
  };

  const handleDeleteSpellClick = (userId, spellName, spellData) => {
    setSelectedUserId(userId);
    setSelectedSpell({ name: spellName, data: spellData });
    setShowDeleteSpellOverlay(true);
  };

  // refreshUserData (remains the same)
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

  // Loading/Error/No users checks (remain the same)
  if (loading) {
    return <div className="text-white mt-4">Loading user data...</div>;
  }
  if (error) {
    return <div className="text-red-500 mt-4">{error}</div>;
  }
  if (users.length === 0) {
    return <div className="text-white mt-4">No users found.</div>;
  }

  // --- MODIFICATION: Updated Button Styles ---
  // Style for the icon-only edit button
  const iconEditButtonStyle = "text-blue-400 hover:text-blue-300 transition-colors duration-200 transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded";
  // Style for the icon-only delete button
  const iconDeleteButtonStyle = "text-red-500 hover:text-red-400 transition-colors duration-200 transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-red-600 rounded";
  // --- END MODIFICATION ---

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-white text-xl">Player Info</h2>
      {/* --- MODIFICATION: Removed overflow-x-auto --- */}
      <div className="rounded-lg shadow-lg">
      {/* --- END MODIFICATION --- */}
        <table className="min-w-full border-collapse text-white bg-gray-800">
          <thead className="bg-gray-700">
            <tr>
              <th className="border border-gray-600 px-4 py-2 text-left">Category</th>
              {users.map((user) => (
                <th key={user.id} className="border border-gray-600 px-4 py-2 text-center">
                  {user.characterId || user.email || "Unknown User"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Actions Row */}
            <tr className="bg-gray-800 hover:bg-gray-700 transition-colors duration-150">
              <td className="border border-gray-600 px-4 py-2 font-medium">Actions</td>
              {users.map((user) => (
                <td key={`${user.id}-action`} className="border border-gray-600 px-4 py-2 text-center">
                  <div className="flex flex-col items-center space-y-2">
                    {/* Aggiungi Tecnica Button */}
                    <button
                      className="w-48 px-3 py-1.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium rounded-md shadow-md transition-all duration-200 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-opacity-75"
                      onClick={() => handleAddTecnicaClick(user.id)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                      <span>Aggiungi Tecnica</span>
                    </button>

                    {/* Aggiungi Spell Button */}
                    <button
                      className="w-48 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-medium rounded-md shadow-md transition-all duration-200 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-opacity-75"
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

            {/* Tecniche Row */}
            <tr className="bg-gray-800 hover:bg-gray-700 transition-colors duration-150">
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Tecniche</td>
              {users.map((user) => (
                <td key={`${user.id}-tecniche`} className="border border-gray-600 px-4 py-2 align-top">
                  {user.tecniche && Object.keys(user.tecniche).length > 0 ? (
                    <ul className="space-y-1">
                      {Object.keys(user.tecniche).map((tecnicaName) => (
                        <li key={tecnicaName} className="text-sm flex items-center justify-between group">
                          <span className="truncate mr-2">{tecnicaName}</span>
                          <div className="flex-shrink-0 ml-2 space-x-1.5 opacity-50 group-hover:opacity-100 transition-opacity duration-200"> {/* Increased space */}
                            {/* --- MODIFICATION: Apply new button style --- */}
                            <button
                              className={iconEditButtonStyle} // Use new style
                              title="Modify Tecnica"
                              onClick={() => handleEditTecnicaClick(user.id, tecnicaName, user.tecniche[tecnicaName])}
                            >
                              <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5"/> {/* Slightly larger icon */}
                            </button>
                            <button
                              className={iconDeleteButtonStyle} // Use new style
                              title="Delete Tecnica"
                              onClick={() => handleDeleteTecnicaClick(user.id, tecnicaName, user.tecniche[tecnicaName])}
                            >
                              <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5"/> {/* Slightly larger icon */}
                            </button>
                            {/* --- END MODIFICATION --- */}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-400 text-sm italic">No tecniche</span>
                  )}
                </td>
              ))}
            </tr>

            {/* Spells Row */}
            <tr className="bg-gray-800 hover:bg-gray-700 transition-colors duration-150">
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Spells</td>
              {users.map((user) => (
                <td key={`${user.id}-spells`} className="border border-gray-600 px-4 py-2 align-top">
                  {user.spells && Object.keys(user.spells).length > 0 ? (
                     <ul className="space-y-1">
                      {Object.keys(user.spells).map((spellName) => (
                        <li key={spellName} className="text-sm flex items-center justify-between group">
                          <span className="truncate mr-2">{spellName}</span>
                           <div className="flex-shrink-0 ml-2 space-x-1.5 opacity-50 group-hover:opacity-100 transition-opacity duration-200"> {/* Increased space */}
                             {/* --- MODIFICATION: Apply new button style --- */}
                            <button
                              className={iconEditButtonStyle} // Use new style
                              title="Modify Spell"
                              onClick={() => handleEditSpellClick(user.id, spellName, user.spells[spellName])}
                            >
                              <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5"/> {/* Slightly larger icon */}
                            </button>
                            <button
                              className={iconDeleteButtonStyle} // Use new style
                              title="Delete Spell"
                              onClick={() => handleDeleteSpellClick(user.id, spellName, user.spells[spellName])}
                            >
                              <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5"/> {/* Slightly larger icon */}
                            </button>
                             {/* --- END MODIFICATION --- */}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-400 text-sm italic">No spells</span>
                  )}
                </td>
              ))}
            </tr>

            {/* Conoscenze Row */}
            <tr className="bg-gray-800 hover:bg-gray-700 transition-colors duration-150">
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Conoscenze</td>
              {users.map((user) => (
                <td key={`${user.id}-conoscenze`} className="border border-gray-600 px-4 py-2 align-top">
                  {user.conoscenze && Object.keys(user.conoscenze).length > 0 ? (
                    <ul className="space-y-1">
                      {Object.keys(user.conoscenze).map((conoscenzaName) => (
                        <li key={conoscenzaName} className="text-sm group flex items-center justify-between">
                          <span className="truncate mr-2">{conoscenzaName}</span>
                           <div className="flex-shrink-0 ml-2 space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              {/* Placeholder for potential future buttons */}
                           </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-400 text-sm italic">No conoscenze</span>
                  )}
                </td>
              ))}
            </tr>

            {/* Professioni Row */}
            <tr className="bg-gray-800 hover:bg-gray-700 transition-colors duration-150">
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Professioni</td>
              {users.map((user) => (
                <td key={`${user.id}-professioni`} className="border border-gray-600 px-4 py-2 align-top">
                  {user.professioni && Object.keys(user.professioni).length > 0 ? (
                    <ul className="space-y-1">
                      {Object.keys(user.professioni).map((professioneName) => (
                         <li key={professioneName} className="text-sm group flex items-center justify-between">
                          <span className="truncate mr-2">{professioneName}</span>
                           <div className="flex-shrink-0 ml-2 space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                               {/* Placeholder for potential future buttons */}
                           </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-400 text-sm italic">No professioni</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Overlays (remain the same) */}
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