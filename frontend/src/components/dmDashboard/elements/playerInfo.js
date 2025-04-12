import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEdit, faTrash } from "@fortawesome/free-solid-svg-icons";
import { library } from "@fortawesome/fontawesome-svg-core";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebaseConfig"; // Assuming firebaseConfig is correctly set up
// --- Import the Overlay AND the new Button Component ---
import { AddTecnicaPersonaleOverlay, AddTecnicaButton } from "./buttons/addTecnicaPersonale";
import { EditTecnicaPersonale } from "./buttons/editTecnicaPersonale";
import { DelTecnicaPersonale } from "./buttons/delTecnicaPersonale";
// --- Import the Overlay AND the new Button Component ---
import { AddSpellOverlay, AddSpellButton } from "./buttons/addSpell";
import { EditSpellOverlay } from "./buttons/editSpell";
import { DelSpellOverlay } from "./buttons/delSpell";

// --- Import the other Button Components ---
import AddLinguaPersonale from "./buttons/addLinguaPersonale";
import AddConoscenzaPersonale from "./buttons/addConoscenzaPersonale";
import AddProfessionePersonale from "./buttons/addProfessionePersonale";
// --- End Import ---

// Add icons to library
library.add(faEdit, faTrash);

const PlayerInfo = ({ users, loading, error, setUsers }) => {
  // State variables
  const [showTecnicaOverlay, setShowTecnicaOverlay] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [showEditTecnicaOverlay, setShowEditTecnicaOverlay] = useState(false);
  const [selectedTecnica, setSelectedTecnica] = useState(null);
  const [showDeleteTecnicaOverlay, setShowDeleteTecnicaOverlay] = useState(false);

  const [showSpellOverlay, setShowSpellOverlay] = useState(false);
  const [showEditSpellOverlay, setShowEditSpellOverlay] = useState(false);
  const [showDeleteSpellOverlay, setShowDeleteSpellOverlay] = useState(false);
  const [selectedSpell, setSelectedSpell] = useState(null);

  // --- Placeholder State/Handlers for Lingua/Conoscenza/Professione (optional for now) ---
  const handleAddLinguaClick = (userId) => {
    console.log(`Placeholder: Add Lingua for user ${userId}`);
    // Later: setSelectedUserId(userId); setShowLinguaOverlay(true);
  };

  const handleAddConoscenzaClick = (userId) => {
    console.log(`Placeholder: Add Conoscenza for user ${userId}`);
    // Later: setSelectedUserId(userId); setShowConoscenzaOverlay(true);
  };

  const handleAddProfessioneClick = (userId) => {
    console.log(`Placeholder: Add Professione for user ${userId}`);
    // Later: setSelectedUserId(userId); setShowProfessioneOverlay(true);
  };
  // --- End Placeholder Handlers ---


  // Handlers for existing buttons
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

  // refreshUserData
  const refreshUserData = async () => {
    try {
      const usersRef = collection(db, "users");
      const snapshot = await getDocs(usersRef);
      const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setUsers(usersData);
    } catch (err) {
      console.error("Error refreshing users:", err);
      // Optionally set an error state here to display to the user
    }
  };

  // Loading/Error/No users checks
  if (loading) {
    return <div className="text-white mt-4">Loading user data...</div>;
  }
  if (error) {
    return <div className="text-red-500 mt-4">{error}</div>;
  }
  if (users.length === 0) {
    return <div className="text-white mt-4">No users found.</div>;
  }

  // Button Styles for Edit/Delete Icons
  const iconEditButtonStyle = "text-blue-400 hover:text-blue-300 transition-colors duration-200 transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded";
  const iconDeleteButtonStyle = "text-red-500 hover:text-red-400 transition-colors duration-200 transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-red-600 rounded";

  // --- Style for the OTHER action buttons (Lingua, Conoscenza, Professione) ---
  // This remains here as these buttons were not part of the refactoring request.
  const sleekButtonStyle = "w-36 px-2 py-1 bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-700 hover:to-indigo-800 text-white text-xs font-medium rounded-md transition-all duration-150 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 shadow-sm";
  // ---

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-white text-xl">Player Info</h2>
      <div className="rounded-lg shadow-lg">
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
            {/* --- FIX APPLIED: Removed potential whitespace between <td> and map, and between rows --- */}
            {/* Actions Row */}
            <tr className="bg-gray-800 hover:bg-gray-700 transition-colors duration-150">
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Actions</td>{
              users.map((user) => (
                <td key={`${user.id}-action`} className="border border-gray-600 px-4 py-2 text-center align-top">
                  {/* --- Updated flex container --- */}
                  <div className="flex flex-col items-center space-y-1"> {/* Reduced space-y */}

                    {/* --- Use the Imported Button Components --- */}
                    <AddTecnicaButton onClick={() => handleAddTecnicaClick(user.id)} />
                    <AddSpellButton onClick={() => handleAddSpellClick(user.id)} />
                    {/* --- End Imported Button Components --- */}


                    {/* --- Other Buttons (using style defined in this file) --- */}
                    {/* Assuming these components accept className prop */}
                    <AddLinguaPersonale
                        className={sleekButtonStyle} // Applied style defined locally
                        onClick={() => handleAddLinguaClick(user.id)}
                     />
                    <AddConoscenzaPersonale
                        className={sleekButtonStyle} // Applied style defined locally
                        onClick={() => handleAddConoscenzaClick(user.id)}
                    />
                    <AddProfessionePersonale
                        className={sleekButtonStyle} // Applied style defined locally
                        onClick={() => handleAddProfessioneClick(user.id)}
                    />
                    {/* --- End Other Buttons --- */}

                  </div>
                </td>
              ))}
            </tr>
            {/* Tecniche Row */}
            <tr className="bg-gray-800 hover:bg-gray-700 transition-colors duration-150">
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Tecniche</td>{
              users.map((user) => (
                <td key={`${user.id}-tecniche`} className="border border-gray-600 px-4 py-2 align-top">
                  {user.tecniche && Object.keys(user.tecniche).length > 0 ? (
                    <ul className="space-y-1">
                      {Object.keys(user.tecniche).map((tecnicaName) => (
                        <li key={tecnicaName} className="text-sm flex items-center justify-between group">
                          <span className="truncate mr-2">{tecnicaName}</span>
                          <div className="flex-shrink-0 ml-2 space-x-1.5 opacity-50 group-hover:opacity-100 transition-opacity duration-200">
                            <button
                              className={iconEditButtonStyle}
                              title="Modify Tecnica"
                              onClick={() => handleEditTecnicaClick(user.id, tecnicaName, user.tecniche[tecnicaName])}
                            >
                              <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5"/>
                            </button>
                            <button
                              className={iconDeleteButtonStyle}
                              title="Delete Tecnica"
                              onClick={() => handleDeleteTecnicaClick(user.id, tecnicaName, user.tecniche[tecnicaName])}
                            >
                              <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5"/>
                            </button>
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
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Spells</td>{
              users.map((user) => (
                <td key={`${user.id}-spells`} className="border border-gray-600 px-4 py-2 align-top">
                  {user.spells && Object.keys(user.spells).length > 0 ? (
                     <ul className="space-y-1">
                      {Object.keys(user.spells).map((spellName) => (
                        <li key={spellName} className="text-sm flex items-center justify-between group">
                          <span className="truncate mr-2">{spellName}</span>
                           <div className="flex-shrink-0 ml-2 space-x-1.5 opacity-50 group-hover:opacity-100 transition-opacity duration-200">
                            <button
                              className={iconEditButtonStyle}
                              title="Modify Spell"
                              onClick={() => handleEditSpellClick(user.id, spellName, user.spells[spellName])}
                            >
                              <FontAwesomeIcon icon="edit" className="w-3.5 h-3.5"/>
                            </button>
                            <button
                              className={iconDeleteButtonStyle}
                              title="Delete Spell"
                              onClick={() => handleDeleteSpellClick(user.id, spellName, user.spells[spellName])}
                            >
                              <FontAwesomeIcon icon="trash" className="w-3.5 h-3.5"/>
                            </button>
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
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Conoscenze</td>{
              users.map((user) => (
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
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Professioni</td>{
              users.map((user) => (
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
            {/* Lingue Row */}
            <tr className="bg-gray-800 hover:bg-gray-700 transition-colors duration-150">
              <td className="border border-gray-600 px-4 py-2 font-medium align-top">Lingue</td>{
              users.map((user) => (
                <td key={`${user.id}-lingue`} className="border border-gray-600 px-4 py-2 align-top">
                  {user.lingue && Object.keys(user.lingue).length > 0 ? (
                    <ul className="space-y-1">
                      {Object.keys(user.lingue).map((linguaName) => (
                         <li key={linguaName} className="text-sm group flex items-center justify-between">
                          <span className="truncate mr-2">{linguaName}</span>
                           <div className="flex-shrink-0 ml-2 space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                               {/* Placeholder for potential future buttons */}
                           </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-400 text-sm italic">No lingue</span>
                  )}
                </td>
              ))}
            </tr>
            {/* --- End FIX --- */}
          </tbody>
        </table>
      </div>

      {/* Overlays (Existing ones) */}
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

       {/* --- Placeholder for New Overlays (Add later) --- */}
       {/* ... (Overlays for Lingua, Conoscenza, Professione would go here) ... */}
       {/* --- End Placeholder --- */}

    </div>
  );
};

export default PlayerInfo;