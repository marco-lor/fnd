// file: ./frontend/src/components/codex/Codex.js
import React, { useState, useEffect, useRef } from 'react';
import Navbar from '../common/navbar';
import { useAuth } from '../../AuthContext';
import { db } from '../firebaseConfig'; // Assuming db is correctly exported from firebaseConfig
import { doc, onSnapshot } from 'firebase/firestore'; // Keep these imports

// Import the button components
import AggiungiButton from './buttons/AggiungiButton';
import EditItemButton from './buttons/EditItemButton';
import DeleteItemButton from './buttons/DeleteItemButton';

// Helper function to capitalize strings
const capitalize = (s) => {
  if (typeof s !== 'string' || !s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Helper function to derive a user-friendly singular name
const deriveSingularName = (key) => {
    if (typeof key !== 'string' || !key) return 'Elemento';
    const singularMap = {
        lingue: 'Lingua',
        conoscenze: 'Conoscenza',
        professioni: 'Professione',
        abilita: 'Abilità',
        incantesimi: 'Incantesimo',
    };
    if (singularMap[key]) return singularMap[key];
    if (key.endsWith('ioni')) return capitalize(key.slice(0, -4) + 'one');
    if (key.endsWith('enze')) return capitalize(key.slice(0, -3) + 'a');
    if (key.endsWith('gue')) return capitalize(key.slice(0, -2) + 'a');
    if (key.endsWith('i')) return capitalize(key.slice(0, -1) + 'o');
    return capitalize(key);
};

function Codex() {
  const { user, loading: authLoading } = useAuth();
  const [codexData, setCodexData] = useState({});
  const [activeSection, setActiveSection] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const isInitialLoad = useRef(true);
  const [userRole, setUserRole] = useState(null); // <-- Step 1: Add state for user role
  const [isRoleLoading, setIsRoleLoading] = useState(true); // <-- State to track role loading

  // --- Effect for fetching Codex data ---
  useEffect(() => {
    let unsubscribeCodex = () => {};

    if (user && !authLoading) {
      setIsLoading(true);
      isInitialLoad.current = true;
      setError(null);

      const docRef = doc(db, 'utils', 'codex');

      unsubscribeCodex = onSnapshot(docRef,
        (docSnap) => {
          console.log("Received Codex update from Firestore");
          if (docSnap.exists()) {
            const data = docSnap.data();
            const validData = data || {};
            setCodexData(validData);
            const sections = Object.keys(validData);
            const sortedSections = [...sections].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

            setActiveSection(prevActiveSection => {
              if (prevActiveSection && sections.includes(prevActiveSection)) {
                return prevActiveSection;
              } else if (sortedSections.length > 0) {
                return sortedSections[0];
              }
              return null;
            });
          } else {
            console.log("Codex document does not exist!");
            setCodexData({});
            setActiveSection(null);
          }
          setError(null);
          if (isInitialLoad.current) {
              setIsLoading(false);
              isInitialLoad.current = false;
          }
        },
        (err) => {
          console.error("Error listening to codex data:", err);
          setError("Failed to listen for codex updates. Data might be stale.");
          setIsLoading(false);
          isInitialLoad.current = false;
        }
      );
    } else if (!user && !authLoading) {
      setCodexData({});
      setActiveSection(null);
      setIsLoading(false);
      setError(null);
    }

    return () => {
      console.log("Unsubscribing from Codex listener");
      unsubscribeCodex();
    };
  }, [user, authLoading]); // Keep original dependencies

  // --- Step 2: Add useEffect for fetching User Role ---
  useEffect(() => {
    let unsubscribeUser = () => {};
    if (user && !authLoading) {
      setIsRoleLoading(true); // Start loading role
      const userDocRef = doc(db, 'users', user.uid); // Assuming 'users' collection and user.uid is correct
      console.log(`Setting up listener for user role: users/${user.uid}`);

      unsubscribeUser = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const fetchedRole = docSnap.data()?.role;
          setUserRole(fetchedRole);
          console.log("User role fetched:", fetchedRole);
        } else {
          setUserRole(null); // User document doesn't exist
          console.log("User document not found for role fetching.");
        }
        setIsRoleLoading(false); // Finish loading role
      }, (error) => {
        console.error("Error fetching user role:", error);
        setUserRole(null); // Set role to null on error
        setIsRoleLoading(false); // Finish loading role even on error
      });
    } else {
      setUserRole(null); // Reset role if user logs out or isn't available
      setIsRoleLoading(false); // Not loading if no user
    }

    // Cleanup function for the user role listener
    return () => {
      console.log("Unsubscribing from User role listener");
      unsubscribeUser();
    };
  }, [user, authLoading]); // Dependencies: run when user or authLoading changes

  // --- Loading and Auth States ---
  if (authLoading || (user && isRoleLoading)) { // Check auth loading OR role loading if user exists
    return (
        <div className="flex justify-center items-center min-h-screen bg-gray-900 text-white">
            <div>Loading User Data...</div>
        </div>
    );
  }
  if (!authLoading && !user) {
    return (
        <div className="codex-page-container bg-gray-900 min-h-screen text-white">
            <Navbar />
            <main className="p-4 md:p-8 text-center">
                <h1 className="text-3xl font-bold mb-6">Codex</h1>
                <p className="text-lg">Please log in to view the Codex.</p>
            </main>
        </div>
    );
  }

  // --- Main Content Rendering (Menu + Details) ---
  const renderCodexContent = () => {
    if (isLoading) { // Still loading codex data itself
      return <div className="text-center mt-8">Loading Codex Data...</div>;
    }
    if (error && Object.keys(codexData).length === 0 && !isLoading) {
      return <div className="text-center mt-8 text-red-500">{error}</div>;
    }

    const sections = Object.keys(codexData);
    const sortedSectionKeys = [...sections].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    if (sortedSectionKeys.length === 0 && !isLoading) {
        return <div className="text-center mt-8 text-gray-400">No Codex categories found or data is empty.</div>;
    }

    const activeSectionData = activeSection ? codexData[activeSection] : null;
    const sectionEntries = typeof activeSectionData === 'object' && activeSectionData !== null
                           ? Object.entries(activeSectionData)
                           : [];
    const activeSectionSingularName = activeSection ? deriveSingularName(activeSection) : '';

    // Determine if the current user is a DM
    const isDM = userRole === 'dm'; // <-- Check the fetched role

    return (
      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        {/* Left Menu (Sidebar) */}
        <aside className="w-full md:w-1/4 lg:w-1/5 bg-gray-800 p-4 rounded-lg shadow-lg self-start">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">Categorie</h2>
          <nav>
            <ul className="space-y-2">
              {sortedSectionKeys.map((sectionKey) => (
                <li key={sectionKey}>
                  <button
                    onClick={() => setActiveSection(sectionKey)}
                    className={`w-full text-left px-3 py-2 rounded transition-colors duration-200 ${
                      activeSection === sectionKey
                        ? 'bg-blue-600 text-white font-medium shadow-md'
                        : 'hover:bg-gray-700 text-gray-300 hover:text-white'
                    }`}
                  >
                    {capitalize(sectionKey)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Center Content Area */}
        <section className="w-full md:w-3/4 lg:w-4/5 bg-gray-800 p-4 rounded-lg shadow-lg flex flex-col">
          {activeSection ? (
            <>
              {/* --- Step 3: Conditionally Render Add Button --- */}
              {isDM && (
                  <div className="mb-4 pb-4 border-b border-gray-700">
                      <AggiungiButton
                          categoryKey={activeSection}
                          categoryData={codexData[activeSection] || {}}
                          categoryDisplayNameSingular={activeSectionSingularName}
                      />
                  </div>
              )}

              {/* Display listener error if present */}
              {error && <div className="mb-4 text-sm text-yellow-400 text-center">{error}</div>}

              {/* Scrollable list area */}
              <div className="flex-grow overflow-y-auto pr-2 -mr-2 custom-scrollbar">
                {sectionEntries.length > 0 ? (
                  <ul className="space-y-4">
                    {sectionEntries
                        .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
                        .map(([nome, descrizione]) => (
                      <li key={nome}
                          className="p-4 rounded-md bg-gray-700 hover:bg-gray-600/80 transition-all duration-200 flex justify-between items-start gap-4 shadow-sm border border-transparent hover:border-gray-500"
                      >
                         {/* Item Content */}
                         <div className="flex-grow min-w-0">
                            <h3 className="font-semibold text-lg text-blue-300 break-words">{nome}</h3>
                            {typeof descrizione === 'string' && descrizione.trim() !== '' && (
                               <p className="text-sm text-gray-300 mt-1 break-words">{descrizione}</p>
                            )}
                             {typeof descrizione !== 'string' && descrizione !== null && (
                                <pre className="text-xs text-gray-400 mt-2 bg-gray-800/50 p-2 rounded overflow-x-auto custom-scrollbar-xs">
                                    {JSON.stringify(descrizione, null, 2)}
                                </pre>
                             )}
                         </div>
                         {/* --- Step 3: Conditionally Render Action Buttons --- */}
                         {isDM && (
                             <div className="flex-shrink-0 flex items-center space-x-2 pt-1">
                                 <EditItemButton
                                     categoryKey={activeSection}
                                     itemKey={nome}
                                     currentValue={descrizione}
                                 />
                                 <DeleteItemButton
                                     categoryKey={activeSection}
                                     itemKey={nome}
                                 />
                             </div>
                         )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-400 text-center mt-4">
                    Nessun{activeSectionSingularName.toLowerCase().endsWith('a') ? 'a' : 'o'} {activeSectionSingularName.toLowerCase()} disponibile in {capitalize(activeSection)}.
                  </p>
                )}
              </div>
            </>
          ) : (
             !isLoading && sortedSectionKeys.length > 0 && (
                 <div className="flex justify-center items-center h-full">
                    <p className="text-gray-400">Seleziona una categoria dal menu.</p>
                 </div>
             )
          )}
        </section>
      </div>
    );
  };

  // Main component return
  return (
    <div className="codex-page-container bg-gray-900 min-h-screen text-white">
      <Navbar />
      <main className="p-4 md:p-8">
        <h1 className="text-3xl font-bold text-center mb-8">Codex</h1>
        {renderCodexContent()}
      </main>
    </div>
  );
}

export default Codex;