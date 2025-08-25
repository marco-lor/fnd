import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAuth } from "../../AuthContext";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import TecnicheSide from "./elements/tecniche_side";
import SpellSide from "./elements/spell_side";

// Cache for storing fetched data
const dataCache = {
  commonTecniche: null,
  lastFetchTimestamp: 0,
  // Cache expiration time in milliseconds (60 minutes)
  expirationTime: 60 * 60 * 1000
};

function TecnicheSpell() {
  const { user, userData: authUserData } = useAuth();
  const [userData, setUserData] = useState(null);
  const [personalTecniche, setPersonalTecniche] = useState({});
  const [commonTecniche, setCommonTecniche] = useState({});
  const [personalSpells, setPersonalSpells] = useState({});
  const [isReady, setIsReady] = useState(false);
  const unsubscribeRef = useRef(null);

  // States for filtering
  const [searchTerm, setSearchTerm] = useState('');
  const [maxCosto, setMaxCosto] = useState('');
  const [selectedAzione, setSelectedAzione] = useState(['All']);

  // Fetch and cache common tecniche data
  const fetchCommonTecniche = async () => {
    try {
      const now = Date.now();
      // Check if we have valid cached data
      if (
        dataCache.commonTecniche && 
        now - dataCache.lastFetchTimestamp < dataCache.expirationTime
      ) {
        setCommonTecniche(dataCache.commonTecniche);
        return;
      }

      // Fetch from database if cache is invalid
      const commonTecnicheRef = doc(db, "utils", "tecniche_common");
      const commonTecnicheSnap = await getDoc(commonTecnicheRef);

      if (commonTecnicheSnap.exists()) {
        const data = commonTecnicheSnap.data() || {};
        // Update cache
        dataCache.commonTecniche = data;
        dataCache.lastFetchTimestamp = now;
        setCommonTecniche(data);
      } else {
        console.log("No common tecniche document found");
        setCommonTecniche({});
      }
    } catch (error) {
      console.error("Error fetching common tecniche:", error);
    }
  };

  useEffect(() => {
    async function fetchData() {
      if (user) {
        // Initialize with data from AuthContext if available
        if (authUserData) {
          setUserData({ ...authUserData, uid: user.uid });
          setPersonalTecniche(authUserData.tecniche || {});
          setPersonalSpells(authUserData.spells || {});
          
          // Start fetching common tecniche in parallel
          fetchCommonTecniche();
          
          // Set ready state even before completing all fetches to prevent flashing
          setIsReady(true);
        }
        
        // Set up the listener for real-time updates to specific data
        const userRef = doc(db, "users", user.uid);
        unsubscribeRef.current = onSnapshot(
          userRef,
          (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              setUserData({ ...data, uid: user.uid });
              setPersonalTecniche(data.tecniche || {});
              setPersonalSpells(data.spells || {});
              
              // Ensure ready state is set once we have basic user data
              if (!isReady) setIsReady(true);
            }
          },
          (error) => {
            console.error("Error fetching user data:", error);
            // Still set ready to avoid indefinite loading state
            if (!isReady) setIsReady(true);
          }
        );

        // If we didn't have authUserData, we need to fetch common tecniche here
        if (!authUserData) {
          await fetchCommonTecniche();
          setIsReady(true);
        }
      }
    }

    fetchData();

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [user, authUserData, isReady]);

  // Extract unique filter values for Action - using useMemo to optimize
  const azioneValues = useMemo(() => {
    return ['All', ...new Set([
      ...Object.values(personalTecniche).map(t => t.Azione),
      ...Object.values(commonTecniche).map(t => t.Azione)
    ].filter(Boolean))];
  }, [personalTecniche, commonTecniche]);

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

  // Helper function to extract numeric value from cost string - wrapped in useCallback
  const getCostoNumeric = useCallback((costoStr) => {
    if (!costoStr) return Infinity;
    // Extract numeric part from the cost string (assuming format like "5 PM" or just "5")
    const match = costoStr.toString().match(/\d+/);
    return match ? parseInt(match[0], 10) : Infinity;
  }, []);

  // Function to filter tecniche based on search term, max cost and action
  const filterTecniche = useCallback((tecnicheObj) => {
    return Object.entries(tecnicheObj).reduce((filtered, [key, tecnica]) => {
      const matchesSearch = searchTerm === '' ||
        (tecnica.Nome && tecnica.Nome.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (tecnica.Effetto && tecnica.Effetto.toLowerCase().includes(searchTerm.toLowerCase()));

      const tecnicaCosto = getCostoNumeric(tecnica.Costo);
      const matchesCosto = maxCosto === '' || tecnicaCosto <= parseInt(maxCosto, 10);

      const matchesAzione = selectedAzione.includes('All') || selectedAzione.includes(tecnica.Azione);

      if (matchesSearch && matchesCosto && matchesAzione) {
        filtered[key] = tecnica;
      }
      return filtered;
    }, {});
  }, [searchTerm, maxCosto, selectedAzione, getCostoNumeric]);

  // Function to filter spells based on search term and max cost
  const filterSpells = useCallback((spellsObj) => {
    return Object.entries(spellsObj).reduce((filtered, [key, spell]) => {
      const matchesSearch = searchTerm === '' ||
        (spell.Nome && spell.Nome.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (spell["Effetti Positivi"] && spell["Effetti Positivi"].toLowerCase().includes(searchTerm.toLowerCase())) ||
        (spell["Effetti Negativi"] && spell["Effetti Negativi"].toLowerCase().includes(searchTerm.toLowerCase()));

      const spellCosto = getCostoNumeric(spell.Costo);
      const matchesCosto = maxCosto === '' || spellCosto <= parseInt(maxCosto, 10);

      if (matchesSearch && matchesCosto) {
        filtered[key] = spell;
      }
      return filtered;
    }, {});
  }, [searchTerm, maxCosto, getCostoNumeric]);

  // Filter tecniche with useMemo to optimize performance
  const filteredPersonalTecniche = useMemo(() => {
    return filterTecniche(personalTecniche);
  }, [personalTecniche, filterTecniche]);

  const filteredCommonTecniche = useMemo(() => {
    return filterTecniche(commonTecniche);
  }, [commonTecniche, filterTecniche]);

  const filteredPersonalSpells = useMemo(() => {
    return filterSpells(personalSpells);
  }, [personalSpells, filterSpells]);

  // Render the component only when isReady, prevents flickering
  return (
  <div className="w-full min-h-full relative">
      <div className="relative z-10 w-full min-h-full">
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

        {/* Main content - only render components when data is ready */}
        <main className="flex flex-col items-center p-5 w-full">
          <div className="flex flex-col md:flex-row w-full max-w-[1600px] gap-6 justify-center">
            <TecnicheSide
              personalTecniche={filteredPersonalTecniche}
              commonTecniche={filteredCommonTecniche}
              userData={userData}
            />

            <SpellSide
              personalSpells={filteredPersonalSpells}
              userData={userData}
            />
          </div>
          {/* Spacer for overlays to extend into */}
          <div className="w-full h-20 mt-6"></div>
        </main>
      </div>
    </div>
  );
}

export default TecnicheSpell;
