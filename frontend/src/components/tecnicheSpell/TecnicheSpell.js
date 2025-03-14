import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../AuthContext";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import DnDBackground from "../backgrounds/DnDBackground";
import Navbar from "../common/navbar";
import TecnicheSide from "./elements/techiche_side";
import SpellSide from "./elements/spell_side";

function TecnicheSpell() {
  const { user } = useAuth();
  const [userData, setUserData] = useState(null);
  const [personalTecniche, setPersonalTecniche] = useState({});
  const [commonTecniche, setCommonTecniche] = useState({});
  const [personalSpells, setPersonalSpells] = useState({});
  const [commonSpells, setCommonSpells] = useState({});
  const [loading, setLoading] = useState(true);
  const unsubscribeRef = useRef(null);

  // States for filtering
  const [searchTerm, setSearchTerm] = useState('');
  const [maxCosto, setMaxCosto] = useState(''); // Changed to a single value instead of array
  const [selectedAzione, setSelectedAzione] = useState(['All']);

  useEffect(() => {
    async function fetchData() {
      if (user) {
        const userRef = doc(db, "users", user.uid);
        unsubscribeRef.current = onSnapshot(
          userRef,
          (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              // Include the uid in the userData object
              setUserData({ ...data, uid: user.uid });
              setPersonalTecniche(data.tecniche || {});
              // Optionally, if personal spells are available in user data, set them here.
            }
          },
          (error) => {
            console.error("Error fetching user data:", error);
          }
        );

        try {
          const commonTecnicheRef = doc(db, "utils", "tecniche_common");
          const commonTecnicheSnap = await getDoc(commonTecnicheRef);

          if (commonTecnicheSnap.exists()) {
            setCommonTecniche(commonTecnicheSnap.data() || {});
          } else {
            console.log("No common tecniche document found");
            setCommonTecniche({});
          }
        } catch (error) {
          console.error("Error fetching common tecniche:", error);
        }

        setLoading(false);
      }
    }

    fetchData();

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [user]);

  if (loading) {
    return (
      <div className="w-full h-screen">
        <DnDBackground />
        <div className="absolute inset-0 z-10 flex justify-center items-center">
          <p className="text-white text-xl">Loading...</p>
        </div>
      </div>
    );
  }

  // Extract unique filter values for Action
  const azioneValues = ['All', ...new Set([
    ...Object.values(personalTecniche).map(t => t.Azione),
    ...Object.values(commonTecniche).map(t => t.Azione)
  ].filter(Boolean))];

  // Toggle filter helper function for action
  const toggleFilter = (currentFilters, setFilters, value) => {
    if (value === 'All') {
      setFilters(['All']);
    } else {
      if (currentFilters.includes('All')) {
        setFilters([value]);
      } else {
        if (currentFilters.includes(value)) {
          const newFilters = currentFilters.filter(v => v !== value);
          setFilters(newFilters.length ? newFilters : ['All']);
        } else {
          setFilters([...currentFilters, value]);
        }
      }
    }
  };

  // Helper function to extract numeric value from cost string
  const getCostoNumeric = (costoStr) => {
    if (!costoStr) return Infinity;
    // Extract numeric part from the cost string (assuming format like "5 PM" or just "5")
    const match = costoStr.toString().match(/\d+/);
    return match ? parseInt(match[0], 10) : Infinity;
  };

  // Function to filter tecniche based on search term, max cost and action
  const filterTecniche = (tecnicheObj) => {
    return Object.entries(tecnicheObj).reduce((filtered, [key, tecnica]) => {
      const matchesSearch = searchTerm === '' ||
        (tecnica.Nome && tecnica.Nome.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (tecnica.Effetto && tecnica.Effetto.toLowerCase().includes(searchTerm.toLowerCase()));

      // New cost filter logic using max cost
      const tecnicaCosto = getCostoNumeric(tecnica.Costo);
      const matchesCosto = maxCosto === '' || tecnicaCosto <= parseInt(maxCosto, 10);

      const matchesAzione = selectedAzione.includes('All') || selectedAzione.includes(tecnica.Azione);

      if (matchesSearch && matchesCosto && matchesAzione) {
        filtered[key] = tecnica;
      }
      return filtered;
    }, {});
  };

  return (
    <div className="w-full min-h-screen overflow-hidden">
      <DnDBackground />
      <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div className="relative z-10 flex flex-col min-h-full">
          <Navbar userData={userData} />

          {/* Filter Section */}
          <div className="px-5 pt-4">
            <div className="max-w-[1600px] mx-auto">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search tecniche and spells..."
                className="w-full mb-4 p-2 border border-gray-600 bg-gray-800 text-white rounded"
              />

              <div className="flex flex-wrap gap-4 mb-4">
                {/* Max Cost Input */}
                <div>
                  <p className="text-white font-bold mb-2">Maximum Cost:</p>
                  <input
                    type="number"
                    value={maxCosto}
                    onChange={(e) => setMaxCosto(e.target.value)}
                    placeholder="Enter max cost"
                    className="px-3 py-1 rounded-lg border bg-gray-800 text-white"
                    min="0"
                  />
                </div>

                {/* Action Filter */}
                <div>
                  <p className="text-white font-bold mb-2">Filter by Action:</p>
                  <div className="flex flex-wrap gap-2">
                    {azioneValues.map((azione) => (
                      <button
                        key={azione}
                        onClick={() => toggleFilter(selectedAzione, setSelectedAzione, azione)}
                        className={`px-3 py-1 rounded-lg border transition-colors ${
                          selectedAzione.includes(azione)
                            ? 'bg-[rgba(25,50,128,0.4)] text-white'
                            : 'bg-white text-[rgba(25,50,128,0.4)]'
                        }`}
                      >
                        {azione}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <main className="flex flex-col items-center justify-center p-5 w-full">
            <div className="flex flex-col md:flex-row w-full max-w-[1600px] gap-6 justify-center">
              <TecnicheSide
                personalTecniche={filterTecniche(personalTecniche)}
                commonTecniche={filterTecniche(commonTecniche)}
                userData={userData}
              />

              <SpellSide
                personalSpells={personalSpells}
                commonSpells={commonSpells}
              />
            </div>
            {/* Spacer for overlays to extend into */}
            <div className="w-full h-60 mt-6"></div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default TecnicheSpell;
