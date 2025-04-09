import React, { useState, useEffect } from 'react';
import Navbar from '../common/navbar';
import { useAuth } from '../../AuthContext'; // Assuming this provides logged-in user info
import { db } from '../firebaseConfig'; // *** IMPORT YOUR FIRESTORE DB INSTANCE ***
// *** Import Firestore functions ***
import { collection, doc, getDocs, getDoc, updateDoc } from 'firebase/firestore';

const AdminPage = () => {
  const { userData } = useAuth(); // Get logged-in user data if needed
  const [users, setUsers] = useState({}); // Store users as an object { userId: userData, ... }
  const [roles, setRoles] = useState([]); // Store possible roles
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch users and possible roles from Firestore on component mount
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Firestore references
        const usersCollectionRef = collection(db, 'users');
        // Reference to the specific document holding the roles array
        // Adjust 'possible_lists' if your document ID is different (e.g., 'roles_list')
        const rolesDocRef = doc(db, 'utils', 'possible_lists');

        // Fetch data using Firestore functions
        const [usersSnapshot, rolesSnapshot] = await Promise.all([
          getDocs(usersCollectionRef), // Get all documents in the 'users' collection
          getDoc(rolesDocRef)        // Get the single document holding roles
        ]);

        // Process users data
        if (!usersSnapshot.empty) {
          const usersData = {};
          usersSnapshot.forEach((doc) => {
            // Use doc.id as the key (which is the userId)
            // and doc.data() as the value (the user object)
            usersData[doc.id] = doc.data();
          });
          setUsers(usersData);
        } else {
          console.log("No user data available in Firestore collection 'users'");
          setUsers({});
        }

        // Process roles data
        if (rolesSnapshot.exists()) {
          // Access the 'ruoli' field within the document's data
          const rolesData = rolesSnapshot.data();
          if (rolesData && rolesData.ruoli && Array.isArray(rolesData.ruoli)) {
             setRoles(rolesData.ruoli);
          } else {
             console.error("Firestore document 'utils/possible_lists' exists but does not contain a valid 'ruoli' array field!");
             setRoles([]);
          }
        } else {
          console.error("Firestore document 'utils/possible_lists' does not exist!");
          setRoles([]);
        }

      } catch (err) {
        console.error("Firestore fetch error:", err);
        setError("Failed to load data. Please check console for details.");
        setUsers({});
        setRoles([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

  }, []); // Empty dependency array ensures this runs only once on mount

  // Function to handle role change using Firestore
  const handleRoleChange = async (userId, newRole) => {
    // Create a reference to the specific user document in Firestore
    const userDocRef = doc(db, 'users', userId);
    try {
      // Update only the 'role' field in the user's document
      await updateDoc(userDocRef, { role: newRole });

      // Optimistically update local state for immediate UI feedback
      setUsers(prevUsers => ({
        ...prevUsers,
        [userId]: {
          ...prevUsers[userId],
          role: newRole
        }
      }));
      alert(`Ruolo per ${users[userId]?.username || userId} aggiornato a ${newRole}`);
    } catch (err) {
      console.error(`Failed to update role for user ${userId} in Firestore:`, err);
      setError(`Failed to update role for ${users[userId]?.username || userId}.`);
      // Optionally revert optimistic update here if needed
    }
  };

  // --- Render Logic (Mostly unchanged) ---

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <Navbar />
        <div className="container mx-auto px-4 py-8 text-center">Loading user data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <Navbar />
        <div className="container mx-auto px-4 py-8 text-center text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navbar />
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">Pannello di Amministrazione</h1>

        {/* User Management Section */}
        <div className="bg-gray-800 rounded-lg p-6 shadow-lg mb-8">
          <h2 className="text-2xl font-semibold mb-4">Gestione Utenti</h2>
          {Object.keys(users).length === 0 ? (
            <p>Nessun utente trovato.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full table-auto border-collapse border border-gray-700">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="border border-gray-600 px-4 py-2 text-left">Character ID</th>
                    <th className="border border-gray-600 px-4 py-2 text-left">Username</th>
                    <th className="border border-gray-600 px-4 py-2 text-left">Email</th>
                    <th className="border border-gray-600 px-4 py-2 text-left">Ruolo Attuale</th>
                    <th className="border border-gray-600 px-4 py-2 text-left">Cambia Ruolo</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(users).map(([userId, user]) => (
                    <tr key={userId} className="hover:bg-gray-750 transition-colors duration-150">
                      <td className="border border-gray-600 px-4 py-2">{user.characterId || 'N/A'}</td>
                      <td className="border border-gray-600 px-4 py-2">{user.username || 'N/A'}</td>
                      <td className="border border-gray-600 px-4 py-2">{user.email || 'N/A'}</td>
                      <td className="border border-gray-600 px-4 py-2">{user.role || 'N/A'}</td>
                      <td className="border border-gray-600 px-4 py-2">
                        <select
                          value={user.role || ''}
                          onChange={(e) => handleRoleChange(userId, e.target.value)}
                          className="bg-gray-600 border border-gray-500 rounded px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={roles.length === 0}
                        >
                           <option value="" disabled hidden>{user.role ? 'Seleziona...' : 'Nessun ruolo'}</option>
                          {roles.map(roleOption => (
                            <option key={roleOption} value={roleOption}>
                              {roleOption}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Other Admin Sections (Optional - Kept from original) */}
        <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
           <h2 className="text-2xl font-semibold mb-4">Altre Sezioni</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
                <div className="bg-gray-700 p-4 rounded-lg opacity-50 cursor-not-allowed">
                <h3 className="text-xl font-semibold mb-2">Impostazioni Sistema</h3>
                <p>Configura le impostazioni globali (non implementato)</p>
                </div>

                <div className="bg-gray-700 p-4 rounded-lg opacity-50 cursor-not-allowed">
                <h3 className="text-xl font-semibold mb-2">Logs di Sistema</h3>
                <p>Controlla i log (non implementato)</p>
                </div>
            </div>
        </div>

      </div>
    </div>
  );
};

export default AdminPage;