import React, { useState, useEffect } from "react";
// Import necessary Firestore functions
import { doc, updateDoc, onSnapshot, getDoc } from "firebase/firestore";
// Import Firebase Functions modules
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../firebaseConfig"; // Ensure this path is correct
import { useAuth } from "../../../AuthContext"; // Ensure this path is correct

// Initialize Firebase Functions
const functions = getFunctions();
// Get a reference to the callable function
const spendCharacterPoint = httpsCallable(functions, 'spendCharacterPoint');

// --- Reusable Button Component (Optional but Recommended) ---
const StatButton = ({ onClick, disabled, children, className = "" }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`
      px-2 py-0.5 rounded text-sm font-medium transition-colors duration-150 ease-in-out
      bg-gray-600 hover:bg-gray-500 text-white
      disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-600
      focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500
      ${className}
    `}
  >
    {children}
  </button>
);


// --- CombatStatsTable Component ---
export function CombatStatsTable() {
  const { user, userData } = useAuth();
  const [combStats, setCombStats] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  const [combatTokensAvailable, setCombatTokensAvailable] = useState(0);
  const [combatTokensSpent, setCombatTokensSpent] = useState(0);
  const [lockParamCombat, setLockParamCombat] = useState(false);
  const [combatStatCosts, setCombatStatCosts] = useState(null); // State for costs

  // Fetch combat stat costs on component mount
  useEffect(() => {
    const fetchCosts = async () => {
      try {
        const costsDocRef = doc(db, "utils", "varie"); // Path to the cost data
        const docSnap = await getDoc(costsDocRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.cost_params_combat) {
            setCombatStatCosts(data.cost_params_combat);
          } else {
            console.warn("cost_params_combat not found in utils/varie");
            setCombatStatCosts({}); // Set to empty if not found
          }
        } else {
          console.error("utils/varie document does not exist!");
          setCombatStatCosts({}); // Set to empty if doc doesn't exist
        }
      } catch (error) {
        console.error("Error fetching combat stat costs:", error);
        setCombatStatCosts({}); // Set to empty on error
      }
    };

    fetchCosts();
  }, []); // Empty dependency array ensures this runs only once on mount

  // Effect to set initial data from userData
  useEffect(() => {
    if (userData) {
      if (userData.Parametri && userData.Parametri.Combattimento) {
        setCombStats(userData.Parametri.Combattimento);
      }
      if (userData.stats) {
        setCombatTokensAvailable(userData.stats.combatTokensAvailable ?? 0);
        setCombatTokensSpent(userData.stats.combatTokensSpent ?? 0);
      }
      if (userData.settings) {
        setLockParamCombat(userData.settings.lock_param_combat || false);
      }
    }
  }, [userData]);

  // Effect to listen for real-time updates on user data
  useEffect(() => {
    if (!user) return;
    const userDocRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          if (data.stats) {
            setCombatTokensAvailable(data.stats.combatTokensAvailable ?? 0);
            setCombatTokensSpent(data.stats.combatTokensSpent ?? 0);
          }
          if (data.settings) {
            setLockParamCombat(data.settings.lock_param_combat || false);
          }
          if (data.Parametri && data.Parametri.Combattimento) {
            setCombStats(data.Parametri.Combattimento);
          }
        }
      },
      (error) => {
        console.error("Error listening for user data changes:", error);
      }
    );
    return () => unsubscribe();
  }, [user]);

  const triggerCooldown = () => {
    setCooldown(true);
    setTimeout(() => setCooldown(false), 500); // 500ms cooldown
  };

  // Increase/Decrease/Mod handlers remain functionally the same
  const handleCombIncrease = async (statName) => {
    if (cooldown || lockParamCombat || !user || !combStats || combatTokensAvailable <= 0 || !combatStatCosts) return;

    // Optional: Check if cost is affordable (though cloud function should handle this)
    const cost = Number(combatStatCosts[statName]);
    if (isNaN(cost) || combatTokensAvailable < cost) {
        console.warn(`Not enough tokens to increase ${statName}. Cost: ${cost}, Available: ${combatTokensAvailable}`);
        // Maybe show a user-friendly message here
        return;
    }

    triggerCooldown();
    try {
      await spendCharacterPoint({ statName, statType: 'Combat', change: 1 });
    } catch (error) {
      console.error("Error spending combat token:", error);
      alert(`Failed to increase ${statName}: ${error.message}`);
    }
  };

  const handleCombDecrease = async (statName) => {
    if (cooldown || lockParamCombat || !user || !combStats) return;
    const currentValue = Number(combStats[statName]?.Base) || 0;
    // Using 0 as the general minimum base for combat stats, adjust if needed
    const MINIMUM_STAT_BASE_VALUE = 0;
    if (currentValue <= MINIMUM_STAT_BASE_VALUE || combatTokensSpent <= 0) {
      console.log(`Cannot decrease ${statName} below minimum (${MINIMUM_STAT_BASE_VALUE}) or no spent tokens.`);
      return;
    }
    triggerCooldown();
    try {
      await spendCharacterPoint({ statName, statType: 'Combat', change: -1 });
    } catch (error) {
      console.error("Error refunding combat token:", error);
      alert(`Failed to decrease ${statName}: ${error.message}`);
    }
  };

  const handleCombModIncrease = async (statName) => {
     if (cooldown || !user || !combStats) return;
     triggerCooldown();
     const currentValue = Number(combStats[statName]?.Mod) || 0;
     try {
       const userRef = doc(db, "users", user.uid);
       await updateDoc(userRef, { [`Parametri.Combattimento.${statName}.Mod`]: currentValue + 1 });
     } catch (error) {
       console.error("Error updating combat stat mod", error);
     }
  };

  const handleCombModDecrease = async (statName) => {
     if (cooldown || !user || !combStats) return;
     triggerCooldown();
     const currentValue = Number(combStats[statName]?.Mod) || 0;
     try {
       const userRef = doc(db, "users", user.uid);
       await updateDoc(userRef, { [`Parametri.Combattimento.${statName}.Mod`]: currentValue - 1 });
     } catch (error) {
       console.error("Error updating combat stat mod", error);
     }
  };

  // --- renderTable function with tooltips ---
  const renderTable = () => {
    if (!combStats || combatStatCosts === null) { // Also check if costs have loaded
        return <div className="text-center text-gray-400">Loading stats...</div>;
    }

    const columns = ["Base", "Equip", "Mod", "Tot"];
    const orderedStats = Object.keys(combStats).sort();

    return (
      <div className="bg-gray-800 shadow-lg rounded-lg overflow-hidden border border-gray-700">
        {/* Points Display Bar */}
        <div className="px-4 py-2 bg-gray-700 text-right text-sm text-gray-300 border-b border-gray-600">
          <span>Token Disponibili: <span className="font-semibold text-white">{combatTokensAvailable}</span></span>
          <span className="mx-2">|</span>
          <span>Token Spesi: <span className="font-semibold text-white">{combatTokensSpent}</span></span>
        </div>

        {/* Table Itself */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-700">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Stat
                </th>
                {columns.map((col) => (
                  <th key={col} scope="col" className={`px-4 py-3 text-center ${col === "Tot" ? "bg-blue-900/50 text-white font-semibold" : ""}`}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedStats.map((statName, index) => {
                const statValues = combStats[statName];
                const isEven = index % 2 === 0;
                // Get the cost for the current stat, provide fallback
                const cost = combatStatCosts[statName] ?? 'N/A';
                const tooltipText = `Costo: ${cost} Token`;

                return (
                  <tr key={statName} className={`${isEven ? 'bg-gray-800' : 'bg-gray-900/50'} border-b border-gray-700 last:border-b-0`}>
                    {/* Stat Name Cell with Tooltip */}
                    <td
                      className="px-4 py-2 font-medium text-white whitespace-nowrap"
                      title={tooltipText} // <<< TOOLTIP ADDED HERE
                    >
                      {statName}
                    </td>

                    {/* Data Cells */}
                    {columns.map((col) => {
                      let cellClasses = `px-4 py-2 text-center align-middle`;
                      if (col === "Tot") {
                        cellClasses += " bg-blue-900/50 text-white font-semibold";
                      }

                      // --- Base Column (Interactive) ---
                      if (col === "Base") {
                        const baseValue = Number(statValues.Base) || 0;
                        const MINIMUM_STAT_BASE_VALUE = 0; // Adjust if needed
                        const costValue = Number(combatStatCosts[statName]); // Get cost for disabling '+' button
                        const canAffordIncrease = !isNaN(costValue) && combatTokensAvailable >= costValue;

                        return (
                          <td key={col} className={cellClasses}>
                            {!lockParamCombat ? (
                              <div className="flex items-center justify-center space-x-2">
                                <StatButton
                                  onClick={() => handleCombDecrease(statName)}
                                  disabled={cooldown || baseValue <= MINIMUM_STAT_BASE_VALUE || combatTokensSpent <= 0}
                                >
                                  -
                                </StatButton>
                                <span className="font-mono min-w-[2ch] text-center text-white">
                                  {statValues[col]}
                                </span>
                                <StatButton
                                  onClick={() => handleCombIncrease(statName)}
                                  disabled={cooldown || combatTokensAvailable <= 0 || !canAffordIncrease} // Disable if cannot afford
                                  title={!canAffordIncrease && combatTokensAvailable > 0 ? `Costo: ${costValue} Token` : undefined} // Show cost tooltip on '+' if disabled due to cost
                                >
                                  +
                                </StatButton>
                              </div>
                            ) : (
                              <span className="font-mono text-white">{statValues[col]}</span>
                            )}
                          </td>
                        );
                      }
                      // --- Mod Column (Interactive) ---
                      else if (col === "Mod") {
                         return (
                          <td key={col} className={cellClasses}>
                            <div className="flex items-center justify-center space-x-2">
                              <StatButton
                                onClick={() => handleCombModDecrease(statName)}
                                disabled={cooldown}
                              >
                                -
                              </StatButton>
                              <span className="font-mono min-w-[2ch] text-center">
                                {statValues[col]}
                              </span>
                              <StatButton
                                onClick={() => handleCombModIncrease(statName)}
                                disabled={cooldown}
                              >
                                +
                              </StatButton>
                            </div>
                          </td>
                        );
                      }
                      // --- Other Columns (Display Only) ---
                      else {
                        return (
                          <td key={col} className={cellClasses}>
                            {statValues[col]}
                          </td>
                        );
                      }
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gray-900 p-4 rounded-xl shadow-md">
      <h2 className="mb-4 text-xl font-semibold text-white">Combat Stats</h2>
      {renderTable()}
    </div>
  );
}

// --- BaseStatsTable Component (Remains Unchanged) ---
export function BaseStatsTable() {
  const { user, userData } = useAuth();
  const [baseStats, setBaseStats] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  const [basePointsAvailable, setBasePointsAvailable] = useState(0);
  const [basePointsSpent, setBasePointsSpent] = useState(0);
  const [lockParamBase, setLockParamBase] = useState(false);

  // useEffect hooks adapted for Base stats and points
  useEffect(() => {
    if (userData) {
      if (userData.Parametri && userData.Parametri.Base) {
        setBaseStats(userData.Parametri.Base);
      }
      if (userData.stats) {
        setBasePointsAvailable(userData.stats.basePointsAvailable ?? 0);
        setBasePointsSpent(userData.stats.basePointsSpent ?? 0);
      }
       if (userData.settings) {
         setLockParamBase(userData.settings.lock_param_base || false);
       }
    }
  }, [userData]);

  useEffect(() => {
    if (!user) return;
    const userDocRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          if (data.stats) {
            setBasePointsAvailable(data.stats.basePointsAvailable ?? 0);
            setBasePointsSpent(data.stats.basePointsSpent ?? 0);
          }
           if (data.settings) {
             setLockParamBase(data.settings.lock_param_base || false);
           }
          if (data.Parametri && data.Parametri.Base) {
            setBaseStats(data.Parametri.Base);
          }
        }
      },
      (error) => {
        console.error("Error listening for user data changes:", error);
      }
    );
    return () => unsubscribe();
  }, [user]);


  const triggerCooldown = () => {
    setCooldown(true);
    setTimeout(() => setCooldown(false), 500); // 500ms cooldown
  };

  // Increase/Decrease/Mod handlers remain functionally the same, adapted for 'Base'
  const handleIncrease = async (statName) => {
    if (cooldown || lockParamBase || !user || !baseStats || basePointsAvailable <= 0) return;
    triggerCooldown();
    try {
      await spendCharacterPoint({ statName, statType: 'Base', change: 1 });
    } catch (error) {
      console.error("Error spending base point:", error);
      alert(`Failed to increase ${statName}: ${error.message}`);
    }
  };

  const handleDecrease = async (statName) => {
    if (cooldown || lockParamBase || !user || !baseStats) return;
    const currentValue = Number(baseStats[statName]?.Base) || 0;
    const MINIMUM_STAT_BASE_VALUE = 0; // Base stats usually start at 0
    if (currentValue <= MINIMUM_STAT_BASE_VALUE || basePointsSpent <= 0) {
       console.log(`Cannot decrease ${statName} below minimum or no points spent.`);
       return;
    }
    triggerCooldown();
    try {
      await spendCharacterPoint({ statName, statType: 'Base', change: -1 });
    } catch (error) {
      console.error("Error refunding base point:", error);
       alert(`Failed to decrease ${statName}: ${error.message}`);
    }
  };

  const handleModIncrease = async (statName) => {
    if (cooldown || !user || !baseStats) return;
    triggerCooldown();
    const currentValue = Number(baseStats[statName]?.Mod) || 0;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { [`Parametri.Base.${statName}.Mod`]: currentValue + 1 });
    } catch (error) {
      console.error("Error updating base stat mod", error);
    }
  };

  const handleModDecrease = async (statName) => {
    if (cooldown || !user || !baseStats) return;
    triggerCooldown();
    const currentValue = Number(baseStats[statName]?.Mod) || 0;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { [`Parametri.Base.${statName}.Mod`]: currentValue - 1 });
    } catch (error) {
      console.error("Error updating base stat mod", error);
    }
  };

  // --- renderTable function with improved styling for Base Stats ---
  const renderTable = () => {
    if (!baseStats) return <div className="text-center text-gray-400">Loading stats...</div>;

    const columns = ["Base", "Anima", "Equip", "Mod", "Tot"];
    const orderedStats = Object.keys(baseStats).sort();

    return (
      <div className="bg-gray-800 shadow-lg rounded-lg overflow-hidden border border-gray-700">
         {/* Points Display Bar */}
        <div className="px-4 py-2 bg-gray-700 text-right text-sm text-gray-300 border-b border-gray-600">
           <span>Punti Disponibili: <span className="font-semibold text-white">{basePointsAvailable}</span></span>
           <span className="mx-2">|</span>
           <span>Punti Spesi: <span className="font-semibold text-white">{basePointsSpent}</span></span>
         </div>

        {/* Table Itself */}
         <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-700">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Stat
                </th>
                {columns.map((col) => (
                  <th key={col} scope="col" className={`px-4 py-3 text-center ${col === "Tot" ? "bg-green-900/50 text-white font-semibold" : ""}`}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedStats.map((statName, index) => {
                const statValues = baseStats[statName];
                const isEven = index % 2 === 0;
                return (
                  <tr key={statName} className={`${isEven ? 'bg-gray-800' : 'bg-gray-900/50'} border-b border-gray-700 last:border-b-0`}>
                    {/* Stat Name Cell */}
                    <td className="px-4 py-2 font-medium text-white whitespace-nowrap">
                      {statName}
                    </td>

                    {/* Data Cells */}
                    {columns.map((col) => {
                      let cellClasses = `px-4 py-2 text-center align-middle`;
                      if (col === "Tot") {
                        cellClasses += " bg-green-900/50 text-white font-semibold";
                      }

                      // --- Base Column (Interactive) ---
                      if (col === "Base") {
                        const baseValue = Number(statValues.Base) || 0;
                        const MINIMUM_STAT_BASE_VALUE_FOR_BUTTON = 0;
                        return (
                          <td key={col} className={cellClasses}>
                            {!lockParamBase ? (
                              <div className="flex items-center justify-center space-x-2">
                                <StatButton
                                  onClick={() => handleDecrease(statName)}
                                  disabled={cooldown || baseValue <= MINIMUM_STAT_BASE_VALUE_FOR_BUTTON || basePointsSpent <= 0}
                                >
                                  -
                                </StatButton>
                                <span className="font-mono min-w-[2ch] text-center text-white">
                                  {statValues[col]}
                                </span>
                                <StatButton
                                  onClick={() => handleIncrease(statName)}
                                  disabled={cooldown || basePointsAvailable <= 0}
                                >
                                  +
                                </StatButton>
                              </div>
                            ) : (
                              <span className="font-mono text-white">{statValues[col]}</span>
                            )}
                          </td>
                        );
                      }
                       // --- Mod Column (Interactive) ---
                      else if (col === "Mod") {
                         return (
                          <td key={col} className={cellClasses}>
                             <div className="flex items-center justify-center space-x-2">
                              <StatButton
                                onClick={() => handleModDecrease(statName)}
                                disabled={cooldown}
                               >
                                -
                              </StatButton>
                              <span className="font-mono min-w-[2ch] text-center">
                                {statValues[col]}
                              </span>
                              <StatButton
                                onClick={() => handleModIncrease(statName)}
                                disabled={cooldown}
                               >
                                +
                              </StatButton>
                            </div>
                          </td>
                        );
                      }
                       // --- Other Columns (Display Only - Anima, Equip, Tot) ---
                      else {
                        return (
                          <td key={col} className={cellClasses}>
                            {statValues[col]}
                          </td>
                        );
                      }
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
     <div className="bg-gray-900 p-4 rounded-xl shadow-md mt-6">
      <h2 className="mb-4 text-xl font-semibold text-white">Base Stats</h2>
      {renderTable()}
    </div>
  );
}