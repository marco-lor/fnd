import React, { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../components/firebaseConfig"; // Update path if needed

function RaceSelection({ user, onRaceSelect, selectedRace }) {
  // Local state for race selection component
  const [races, setRaces] = useState([]);
  const [loadingRaces, setLoadingRaces] = useState(true);
  const [error, setError] = useState("");

  // Always-available placeholder race with no creation bonuses
  const PLACEHOLDER_RACE = {
    id: "Evocazione Permanente",
    description:
      "Placeholder per evocazioni permanenti. Nessun bonus di creazione. Usa Anima e i costi di distribuzione punti standard.",
  };

  // --- Fetch races from Firestore (Map Structure) ---
  useEffect(() => {
    const fetchRaces = async () => {
      setLoadingRaces(true);
      setError("");
      const codexDocRef = doc(db, "utils", "codex");

      try {
        const docSnap = await getDoc(codexDocRef);
        if (docSnap.exists()) {
          const codexData = docSnap.data();
          // Check if the 'Razze' field exists and is an object (map)
          if (codexData && typeof codexData.Razze === 'object' && codexData.Razze !== null) {
            // Convert the Razze map (key: raceName, value: descriptionString) into an array of objects
            const racesArray = Object.entries(codexData.Razze).map(([raceName, descriptionString]) => {
              // Ensure the value is treated as a string
              const description = typeof descriptionString === 'string' ? descriptionString : "";

              return {
                id: raceName,         // e.g., "Fata" (this is the key from the map)
                description: description // e.g., "Le Fate sono note..." (this is the value from the map)
              };
            });
            // Ensure placeholder race is included once
            const hasPlaceholder = racesArray.some(r => r.id === PLACEHOLDER_RACE.id);
            const finalRaces = hasPlaceholder ? racesArray : [...racesArray, PLACEHOLDER_RACE];
            setRaces(finalRaces);
            console.log("Races loaded successfully (Map Structure):", racesArray);
          } else {
            console.log("Codex document found, but 'Razze' field is missing or not an object. Falling back to placeholder race.");
            setRaces([PLACEHOLDER_RACE]);
            setError("");
          }
        } else {
          console.log("Codex document ('/utils/codex') not found in Firestore. Falling back to placeholder race.");
          setRaces([PLACEHOLDER_RACE]);
          setError("");
        }
      } catch (error) {
        console.error("Error fetching codex document:", error);
        // On error, still allow character creation using the placeholder race
        setRaces([PLACEHOLDER_RACE]);
        setError("");
      } finally {
        setLoadingRaces(false);
      }
    };

    if (user) {
      fetchRaces();
    } else {
      setLoadingRaces(false);
    }
  }, [user]);

  // Function to handle race selection
  const handleRaceSelect = (race) => {
    onRaceSelect(race);
  };

  // Function to render the race selection area
  const renderRaceSelection = () => {
    // Show loading state while fetching races
    if (loadingRaces) {
      return (
        <div className="col-span-full text-center py-6 text-white/60">
          Loading races...
        </div>
      );
    }
    
    // Show error or 'no races' message if fetching failed or no races found
    if (races.length === 0) {
      return (
        <div className="col-span-full text-center py-6 text-red-400">
          {error || "No races available. Please contact the game administrator."}
        </div>
      );
    }
    
    // Render the race cards
    return races.map(race => (
      <div
        key={race.id}
        // Apply conditional styling based on selection state
        className={`p-4 rounded-lg cursor-pointer transition-all duration-300 text-left h-full flex flex-col ${
          selectedRace?.id === race.id
            ? 'bg-blue-700/70 border-2 border-blue-400 shadow-[0_0_10px_rgba(100,150,255,0.7)] scale-95'
            : 'bg-[rgba(40,40,60,0.7)] border border-[rgba(150,150,255,0.2)] hover:bg-[rgba(60,60,80,0.7)] hover:scale-102'
        }`}
        onClick={() => handleRaceSelect(race)}
      >
        {/* Race Title */}
        <h3 className="text-lg font-semibold text-[#D4AF37] mb-2">{race.id}</h3>
        {/* Race Description */}
        {race.description && (
          <p className="text-white/80 text-sm mb-2 whitespace-pre-line flex-grow">{race.description}</p>
        )}
      </div>
    ));
  };

  return (
    <div className="w-full">
      <label className="block text-white text-left mb-3 text-sm font-medium">
        Select Your Race
      </label>
      {/* Grid for race cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {renderRaceSelection()}
      </div>
      
      {/* Error Display Area (now handled within the component) */}
      {error && !loadingRaces && races.length === 0 && (
        <div className="w-full mt-4 p-3 bg-red-900/60 border border-red-700 rounded text-white text-sm shadow-md">
          {error}
        </div>
      )}
    </div>
  );
}

export default RaceSelection;