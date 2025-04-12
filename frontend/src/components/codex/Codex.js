// file: ./frontend/src/components/codex/Codex.js
import React, { useState, useEffect, useRef } from 'react';
import Navbar from '../common/navbar'; // Import the Navbar
import { useAuth } from '../../AuthContext'; // Import useAuth
import { db } from '../firebaseConfig'; // Import the Firestore db instance
import { doc, onSnapshot } from 'firebase/firestore'; // Import Firestore functions

// Import the Button components
import AddLinguaButton from './buttons/AddLinguaButton';
import AddConoscenzaButton from './buttons/AddConoscenzaButton';
import AddProfessioneButton from './buttons/AddProfessioneButton';

// Helper function to capitalize strings (for display titles)
const capitalize = (s) => {
  if (typeof s !== 'string' || !s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Mapping from section key (from Firestore) to the corresponding Add Button component
const AddButtonComponents = {
  lingue: AddLinguaButton,
  conoscenze: AddConoscenzaButton,
  professioni: AddProfessioneButton,
  // --- Add mappings for future sections here ---
  // exampleSection: AddExampleSectionButton,
};

function Codex() {
  const { user, loading: authLoading } = useAuth();
  const [codexData, setCodexData] = useState({}); // Unified state for all codex categories
  const [activeSection, setActiveSection] = useState(null); // Key of the currently displayed section
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const isInitialLoad = useRef(true); // Track initial load vs. updates

  useEffect(() => {
    let unsubscribe = () => {}; // Initialize an empty unsubscribe function

    if (user && !authLoading) {
      setIsLoading(true);
      isInitialLoad.current = true;
      setError(null);
      // Do not reset activeSection here to preserve selection across hot reloads if possible
      // setActiveSection(null);

      const docRef = doc(db, 'utils', 'codex');

      unsubscribe = onSnapshot(docRef,
        (docSnap) => { // Success callback
          console.log("Received Codex update from Firestore");
          if (docSnap.exists()) {
            const data = docSnap.data();
            const validData = data || {}; // Ensure it's an object
            setCodexData(validData);

            const sections = Object.keys(validData);
            const sortedSections = [...sections].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

            setActiveSection(prevActiveSection => {
              // Keep current section if it still exists and is valid
              if (prevActiveSection && sections.includes(prevActiveSection)) {
                return prevActiveSection;
              } else if (sortedSections.length > 0) {
                // Default to the first *alphabetically sorted* section if current is invalid or null
                return sortedSections[0];
              }
              // Otherwise, no section is active
              return null;
            });

          } else {
            console.log("Codex document does not exist!");
            setCodexData({});
            setActiveSection(null);
          }
          setError(null); // Clear any previous error on successful fetch
          // Only set loading to false on the very first successful data fetch
          if (isInitialLoad.current) {
              setIsLoading(false);
              isInitialLoad.current = false;
          }
        },
        (err) => { // Error callback
          console.error("Error listening to codex data:", err);
          // Avoid clearing data on listener error to keep potentially stale data visible
          // setCodexData({});
          // setActiveSection(null);
          setError("Failed to listen for codex updates. Data might be stale.");
          setIsLoading(false); // Stop loading indicator even on error
          isInitialLoad.current = false;
        }
      );

    } else if (!user && !authLoading) {
      // Clear data and state if user logs out or was never logged in
      setCodexData({});
      setActiveSection(null);
      setIsLoading(false);
      setError(null);
    }

    // --- Cleanup Function ---
    return () => {
      console.log("Unsubscribing from Codex listener");
      unsubscribe(); // Detach the listener when component unmounts or dependencies change
    };

  }, [user, authLoading]); // Dependencies: Re-run effect if user or authLoading status changes

  // --- Loading and Auth States ---
  if (authLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-900 text-white">
        <div>Loading User Data...</div>
      </div>
    );
  }

  // Separate check for user existence *after* auth loading is complete
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
    if (isLoading) {
      return <div className="text-center mt-8">Loading Codex Data...</div>;
    }
    if (error && Object.keys(codexData).length === 0) {
      // Show error prominently only if there's no data to display
      return <div className="text-center mt-8 text-red-500">{error}</div>;
    }

    const sections = Object.keys(codexData);
    const sortedSectionKeys = [...sections].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    if (sortedSectionKeys.length === 0 && !isLoading) {
        return <div className="text-center mt-8 text-gray-400">No Codex categories found or data is empty.</div>;
    }

    // Determine the Add Button component based on the active section
    const CurrentAddButton = activeSection ? AddButtonComponents[activeSection] : null;
    // Get the data specific to the active section
    const activeSectionData = activeSection ? codexData[activeSection] : null;
    // Prepare entries for display, handling cases where data might not be an object
    const sectionEntries = typeof activeSectionData === 'object' && activeSectionData !== null
                           ? Object.entries(activeSectionData)
                           : [];

    return (
      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        {/* Left Menu (Sidebar) */}
        <aside className="w-full md:w-1/4 lg:w-1/5 bg-gray-800 p-4 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">Categorie</h2>
          <nav>
            <ul className="space-y-2">
              {sortedSectionKeys.map((sectionKey) => (
                <li key={sectionKey}>
                  <button
                    onClick={() => setActiveSection(sectionKey)}
                    className={`w-full text-left px-3 py-2 rounded transition-colors duration-200 ${
                      activeSection === sectionKey
                        ? 'bg-blue-600 text-white font-medium'
                        : 'hover:bg-gray-700 text-gray-300'
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
              {/* *** MODIFICATION START *** */}
              {/* Render the Add Button and conditionally pass props */}
              {CurrentAddButton && (
                <div className="mb-4">
                  <CurrentAddButton
                    // Pass 'lingue' prop only if the active section is 'lingue'
                    {...(activeSection === 'lingue' && { lingue: codexData.lingue || {} })}
                    // Add similar conditional props for other buttons if they need data
                    // Example: {...(activeSection === 'conoscenze' && { conoscenze: codexData.conoscenze || {} })}
                    // Example: {...(activeSection === 'professioni' && { professioni: codexData.professioni || {} })}
                  />
                </div>
              )}
              {/* *** MODIFICATION END *** */}

              {/* Display error message if listener failed but data is still shown */}
              {error && <div className="mb-4 text-sm text-yellow-400 text-center">{error}</div>}

              <h2 className="text-2xl font-semibold mb-4 border-b border-gray-700 pb-2">
                {capitalize(activeSection)}
              </h2>
              <div className="flex-grow overflow-y-auto pr-2"> {/* Added padding-right for scrollbar */}
                {sectionEntries.length > 0 ? (
                  <ul className="space-y-3">
                    {/* Sort entries alphabetically by key (nome) */}
                    {sectionEntries
                        .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
                        .map(([nome, descrizione]) => (
                      <li key={nome} className="p-2 rounded hover:bg-gray-700 transition-colors">
                        <h3 className="font-bold text-lg">{nome}</h3>
                        {typeof descrizione === 'string' && descrizione.trim() !== '' && (
                           <p className="text-sm text-gray-300 ml-2">{descrizione}</p> // Indent description
                        )}
                         {/* Display non-string descriptions (like objects) formatted */}
                         {typeof descrizione !== 'string' && descrizione !== null && (
                            <pre className="text-xs text-gray-400 mt-1 ml-2 bg-gray-900 p-2 rounded overflow-x-auto">
                                {JSON.stringify(descrizione, null, 2)}
                            </pre>
                         )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-400">
                    Nessuna voce disponibile in {capitalize(activeSection)}.
                  </p>
                )}
              </div>
            </>
          ) : (
             // Only show "Select a category" if not loading and there ARE categories
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

  return (
    <div className="codex-page-container bg-gray-900 min-h-screen text-white">
      <Navbar />
      <main className="p-4 md:p-8">
        <h1 className="text-3xl font-bold text-center mb-8">Codex</h1>
        {/* Optionally display a global error if listener failed */}
        {/* {error && <div className="text-center mb-4 text-red-500">{error}</div>} */}
        {renderCodexContent()}
      </main>
    </div>
  );
}

export default Codex;