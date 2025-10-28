import React, { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "../../AuthContext";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import TecnicheSide from "./elements/tecniche_side";
import SpellSide from "./elements/spell_side";
import FilterPanel, { buildFilterPredicate } from './FilterPanel';

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

  // Unified filtering predicate (function(item) => boolean)
  const [predicate, setPredicate] = useState(() => () => true);

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

  // Apply unified predicate to datasets
  const filteredPersonalTecniche = useMemo(() => {
    return Object.entries(personalTecniche).reduce((acc, [k, v]) => {
      if (predicate(v)) acc[k] = v; return acc;
    }, {});
  }, [personalTecniche, predicate]);
  const filteredCommonTecniche = useMemo(() => {
    return Object.entries(commonTecniche).reduce((acc, [k, v]) => {
      if (predicate(v)) acc[k] = v; return acc;
    }, {});
  }, [commonTecniche, predicate]);
  const filteredPersonalSpells = useMemo(() => {
    return Object.entries(personalSpells).reduce((acc, [k, v]) => {
      if (predicate(v)) acc[k] = v; return acc;
    }, {});
  }, [personalSpells, predicate]);

  // Render the component only when isReady, prevents flickering
  return (
  <div className="w-full min-h-full relative">
      <div className="relative z-10 w-full min-h-full">
        {/* Unified Filter Panel */}
        <FilterPanel
          personalTecniche={personalTecniche}
          commonTecniche={commonTecniche}
          personalSpells={personalSpells}
          onPredicateChange={(p) => setPredicate(() => p)}
        />

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
