// file: ./frontend/src/components/codex/Codex.js
import React, { useState, useEffect } from 'react';
import Navbar from '../common/navbar'; // Import the Navbar
import { useAuth } from '../../AuthContext'; // Import useAuth
import { db } from '../firebaseConfig'; // Import the Firestore db instance
import { doc, getDoc } from 'firebase/firestore'; // Import Firestore functions

// Import the Button components
import AddLinguaButton from './elements/AddLinguaButton';
import AddConoscenzaButton from './elements/AddConoscenzaButton';
import AddProfessioneButton from './elements/AddProfessioneButton';

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

  useEffect(() => {
    const fetchCodexData = async () => {
      setIsLoading(true);
      setError(null);
      setActiveSection(null); // Reset active section on fetch
      try {
        const docRef = doc(db, 'utils', 'codex');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setCodexData(data || {});
          // Automatically select the first section if data exists
          const sections = Object.keys(data);
          if (sections.length > 0) {
            setActiveSection(sections[0]);
          }
        } else {
          console.log("No such document! Check Firestore path: utils/codex");
          setCodexData({}); // Ensure data is empty if doc doesn't exist
          setError("Could not load codex data.");
        }
      } catch (err) {
        console.error("Error fetching codex data:", err);
        setCodexData({});
        setError("Failed to fetch codex data. Please try again later.");
      } finally {
        setIsLoading(false);
      }
    };

    // Only fetch data if the user is logged in
    if (user && !authLoading) { // Make sure auth is resolved before fetching
      fetchCodexData();
    } else if (!user && !authLoading) {
      setIsLoading(false); // If no user and auth is resolved, stop loading
      setCodexData({}); // Clear data if user logs out
      setActiveSection(null);
    }
  }, [user, authLoading]); // Re-run effect if user or authLoading changes

  // --- Loading and Auth States ---
  if (authLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-900 text-white">
        <div>Loading User Data...</div>
      </div>
    );
  }

  if (!user) {
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
    if (error) {
      return <div className="text-center mt-8 text-red-500">{error}</div>;
    }

    const sections = Object.keys(codexData);

    if (sections.length === 0 && !isLoading) {
        return <div className="text-center mt-8 text-gray-400">No Codex categories found.</div>;
    }

    const CurrentAddButton = activeSection ? AddButtonComponents[activeSection] : null;
    const activeSectionData = activeSection ? codexData[activeSection] : null;
    const sectionEntries = activeSectionData ? Object.entries(activeSectionData) : [];

    return (
      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        {/* Left Menu (Sidebar) */}
        <aside className="w-full md:w-1/4 lg:w-1/5 bg-gray-800 p-4 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-4 border-b border-gray-700 pb-2">Categorie</h2>
          <nav>
            <ul className="space-y-2">
              {sections.map((sectionKey) => (
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
              {/* Render the corresponding Add Button */}
              {CurrentAddButton && <div className="mb-4"><CurrentAddButton /></div>}

              <h2 className="text-2xl font-semibold mb-4 border-b border-gray-700 pb-2">
                {capitalize(activeSection)}
              </h2>
              <div className="flex-grow overflow-y-auto"> {/* Allows scrolling if content overflows */}
                {sectionEntries.length > 0 ? (
                  <ul className="space-y-3">
                    {sectionEntries.map(([nome, descrizione]) => (
                      <li key={nome}>
                        <h3 className="font-bold text-lg">{nome}</h3>
                        {/* Render description only if it's a non-empty string */}
                        {typeof descrizione === 'string' && descrizione.trim() !== '' && (
                           <p className="text-sm text-gray-300">{descrizione}</p>
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
            <div className="flex justify-center items-center h-full">
                 <p className="text-gray-400">Seleziona una categoria dal menu.</p>
            </div>
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
        {renderCodexContent()}
      </main>
    </div>
  );
}

export default Codex;