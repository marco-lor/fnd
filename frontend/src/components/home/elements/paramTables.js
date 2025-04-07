import React, { useState, useEffect } from "react";
import { doc, updateDoc, onSnapshot } from "firebase/firestore";
// Import Firebase Functions modules
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../../AuthContext";

// Initialize Firebase Functions
const functions = getFunctions();
// Get a reference to the callable function
const spendCharacterPoint = httpsCallable(functions, 'spendCharacterPoint');

// --- BaseStatsTable Component ---
export function BaseStatsTable() {
  const { user, userData } = useAuth();
  const [baseStats, setBaseStats] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  // Use the new state variable name from the updated structure
  const [basePointsAvailable, setBasePointsAvailable] = useState(0);
  const [lockParamBase, setLockParamBase] = useState(false);

  // Update useEffect to use the new field name 'basePointsAvailable'
  useEffect(() => {
    if (userData) {
      if (userData.Parametri && userData.Parametri.Base) {
        setBaseStats(userData.Parametri.Base);
      }
      // Use the new field name
      if (userData.stats && userData.stats.basePointsAvailable !== undefined) {
        setBasePointsAvailable(userData.stats.basePointsAvailable);
      }
      if (userData.settings) {
        setLockParamBase(userData.settings.lock_param_base || false);
      }
    }
  }, [userData]);

  // Update real-time listener to use the new field name 'basePointsAvailable'
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          // Use the new field name
          if (data.stats && data.stats.basePointsAvailable !== undefined) {
            setBasePointsAvailable(data.stats.basePointsAvailable);
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
    setTimeout(() => setCooldown(false), 500);
  };

  // --- Modified handleIncrease ---
  const handleIncrease = async (statName) => { // Removed type annotation
    // Keep existing checks
    if (cooldown || lockParamBase || !user || !baseStats) return;
    triggerCooldown();

    try {
      // Call the Cloud Function instead of updating Firestore directly
      await spendCharacterPoint({
        statName: statName,
        statType: 'Base',
        change: 1
      });
      // Success feedback (optional)
      // console.log(`Increased ${statName}`);
      // No manual state update needed; onSnapshot will reflect the change.
    } catch (error) { // Corrected catch block syntax
      console.error("Error spending base point:", error);
      // Provide user feedback based on the error type (optional)
      alert(`Failed to increase ${statName}: ${error.message}`);
    }
  };

  // --- Modified handleDecrease ---
  const handleDecrease = async (statName) => { // Removed type annotation
    // Keep existing checks
    if (cooldown || lockParamBase || !user || !baseStats) return;

    // Optional: Add client-side check for minimum, but backend enforces it
    const currentValue = Number(baseStats[statName]?.Base) || 0;
    const MINIMUM_STAT_BASE_VALUE = 0; // Match the minimum defined in your CF
    if (currentValue <= MINIMUM_STAT_BASE_VALUE) {
       console.log(`Cannot decrease ${statName} below ${MINIMUM_STAT_BASE_VALUE}`);
       // Optionally disable the button or show a message
       return;
    }

    triggerCooldown();

    try {
      // Call the Cloud Function instead of updating Firestore directly
      await spendCharacterPoint({
        statName: statName,
        statType: 'Base',
        change: -1
       });
      // Success feedback (optional)
      // console.log(`Decreased ${statName}`);
      // No manual state update needed; onSnapshot will reflect the change.
    } catch (error) { // Corrected catch block syntax
      console.error("Error refunding base point:", error);
      // Provide user feedback based on the error type (optional)
       alert(`Failed to decrease ${statName}: ${error.message}`);
    }
  };

  // Keep handleModIncrease and handleModDecrease as they modify the 'Mod' field directly
  const handleModIncrease = async (statName) => { // Removed type annotation
    if (cooldown || !user || !baseStats) return;
    triggerCooldown();
    const currentValue = Number(baseStats[statName].Mod) || 0;
    const newValue = currentValue + 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Base.${statName}.Mod`]: newValue,
      });
    } catch (error) { // Corrected catch block syntax
      console.error("Error updating stat mod", error);
    }
  };

  const handleModDecrease = async (statName) => { // Removed type annotation
    if (cooldown || !user || !baseStats) return;
    triggerCooldown();
    const currentValue = Number(baseStats[statName].Mod) || 0;
    const newValue = currentValue - 1;
    // Add check if you don't want negative Mods, e.g., if (newValue < 0) return;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Base.${statName}.Mod`]: newValue,
      });
    } catch (error) { // Corrected catch block syntax
      console.error("Error updating stat mod", error);
    }
  };


  const renderTable = () => {
    if (!baseStats) return null;
    const columns = ["Base", "Anima", "Equip", "Mod", "Tot"];
    const orderedStats = Object.keys(baseStats).sort();

    return (
      <div className="flex-grow flex flex-col">
        {/* Update displayed text and variable */}
        <div className="p-2 text-right text-white bg-[rgba(25,50,128,0.4)] border border-[rgba(255,255,255,0.3)]">
          Punti Base: {basePointsAvailable} {/* Use new state variable */}
        </div>
        {/* Rest of the table rendering logic remains the same */}
         <table className="w-full flex-grow border-collapse text-white rounded-[8px] overflow-hidden">
          <thead>
            <tr>
              <th className="border border-[rgba(255,255,255,0.3)] p-2 text-left pl-[10px]">
                Stat
              </th>
              {columns.map((col) => {
                let thClasses = "border border-[rgba(255,255,255,0.3)] p-2 text-center";
                if (col === "Tot") {
                  thClasses += " bg-[rgba(25,50,128,0.4)] font-bold";
                }
                return (
                  <th key={col} className={thClasses}>
                    {col}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {orderedStats.map((statName) => {
              const statValues = baseStats[statName];
              return (
                <tr key={statName} className="even:bg-[rgba(60,60,80,0.4)]">
                  <td className="border border-[rgba(255,255,255,0.3)] p-2 text-left pl-[10px]">
                    {statName}
                  </td>
                  {columns.map((col) => {
                    if (col === "Base") {
                      // Buttons now call modified handlers
                      return (
                        <td key={col} className="border border-[rgba(255,255,255,0.3)] p-2 text-center">
                          {!lockParamBase ? (
                            <div className="flex flex-row items-center justify-center">
                              <button
                                disabled={cooldown}
                                className="bg-transparent border-0 text-white cursor-pointer text-base px-[5px] transition-colors hover:text-[#ffd700]"
                                onClick={() => handleDecrease(statName)}
                              >
                                ◀
                              </button>
                              <span className="mx-[5px] min-w-[20px] text-center">
                                {statValues[col]}
                              </span>
                              <button
                                disabled={cooldown}
                                className="bg-transparent border-0 text-white cursor-pointer text-base px-[5px] transition-colors hover:text-[#ffd700]"
                                onClick={() => handleIncrease(statName)}
                              >
                                ▶
                              </button>
                            </div>
                          ) : (
                            <span className="mx-[5px] min-w-[20px] text-center">
                              {statValues[col]}
                            </span>
                          )}
                        </td>
                      );
                    } else if (col === "Mod") {
                      // Mod handlers remain unchanged
                      return (
                        <td key={col} className="border border-[rgba(255,255,255,0.3)] p-2 text-center">
                          <div className="flex flex-row items-center justify-center">
                            <button
                              disabled={cooldown}
                              className="bg-transparent border-0 text-white cursor-pointer text-base px-[5px] transition-colors hover:text-[#ffd700]"
                              onClick={() => handleModDecrease(statName)}
                            >
                              ◀
                            </button>
                            <span className="mx-[5px] min-w-[20px] text-center">
                              {statValues[col]}
                            </span>
                            <button
                              disabled={cooldown}
                              className="bg-transparent border-0 text-white cursor-pointer text-base px-[5px] transition-colors hover:text-[#ffd700]"
                              onClick={() => handleModIncrease(statName)}
                            >
                              ▶
                            </button>
                          </div>
                        </td>
                      );
                    } else {
                      let tdClasses = "border border-[rgba(255,255,255,0.3)] p-2 text-center";
                      if (col === "Tot") {
                        tdClasses += " bg-[rgba(25,50,128,0.4)] font-bold";
                      }
                      return (
                        <td key={col} className={tdClasses}>
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
    );
  };

  return (
    <div>
      <h2 className="mb-3 text-white text-xl">Base Stats</h2>
      {renderTable()}
    </div>
  );
}

// --- CombatStatsTable Component ---
export function CombatStatsTable() {
  const { user, userData } = useAuth();
  const [combStats, setCombStats] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  // Use the new state variable name
  const [combatTokensAvailable, setCombatTokensAvailable] = useState(0);
  const [lockParamCombat, setLockParamCombat] = useState(false);

  // Update useEffect to use the new field name 'combatTokensAvailable'
  useEffect(() => {
    if (userData) {
      if (userData.Parametri && userData.Parametri.Combattimento) {
        setCombStats(userData.Parametri.Combattimento);
      }
      // Use the new field name
      if (userData.stats && userData.stats.combatTokensAvailable !== undefined) {
        setCombatTokensAvailable(userData.stats.combatTokensAvailable);
      }
      if (userData.settings) {
        setLockParamCombat(userData.settings.lock_param_combat || false);
      }
    }
  }, [userData]);

  // Update real-time listener to use the new field name 'combatTokensAvailable'
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
           // Use the new field name
          if (data.stats && data.stats.combatTokensAvailable !== undefined) {
            setCombatTokensAvailable(data.stats.combatTokensAvailable);
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
    setTimeout(() => setCooldown(false), 500);
  };

  // --- Modified handleCombIncrease ---
  const handleCombIncrease = async (statName) => { // Removed type annotation
    // Keep existing checks
    if (cooldown || lockParamCombat || !user || !combStats) return;
    triggerCooldown();

    try {
      // Call the Cloud Function
      await spendCharacterPoint({
        statName: statName,
        statType: 'Combat',
        change: 1
      });
      // console.log(`Increased ${statName}`);
    } catch (error) { // Corrected catch block syntax
      console.error("Error spending combat token:", error);
      alert(`Failed to increase ${statName}: ${error.message}`);
    }
  };

  // --- Modified handleCombDecrease ---
  const handleCombDecrease = async (statName) => { // Removed type annotation
    // Keep existing checks
    if (cooldown || lockParamCombat || !user || !combStats) return;

     // Optional: Client-side minimum check
    const currentValue = Number(combStats[statName]?.Base) || 0;
    const MINIMUM_STAT_BASE_VALUE = 0; // Match the minimum defined in your CF
    if (currentValue <= MINIMUM_STAT_BASE_VALUE) {
       console.log(`Cannot decrease ${statName} below ${MINIMUM_STAT_BASE_VALUE}`);
       return;
    }

    triggerCooldown();

    try {
       // Call the Cloud Function
      await spendCharacterPoint({
        statName: statName,
        statType: 'Combat',
        change: -1
       });
       // console.log(`Decreased ${statName}`);
    } catch (error) { // Corrected catch block syntax
      console.error("Error refunding combat token:", error);
      alert(`Failed to decrease ${statName}: ${error.message}`);
    }
  };

  // Keep handleCombModIncrease and handleCombModDecrease as they modify 'Mod'
  const handleCombModIncrease = async (statName) => { // Removed type annotation
    if (cooldown || !user || !combStats) return;
    triggerCooldown();
    const currentValue = Number(combStats[statName].Mod) || 0;
    const newValue = currentValue + 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Combattimento.${statName}.Mod`]: newValue,
      });
    } catch (error) { // Corrected catch block syntax
      console.error("Error updating combat stat mod", error);
    }
  };

  const handleCombModDecrease = async (statName) => { // Removed type annotation
    if (cooldown || !user || !combStats) return;
    triggerCooldown();
    const currentValue = Number(combStats[statName].Mod) || 0;
    const newValue = currentValue - 1;
    // Add check if you don't want negative Mods, e.g., if (newValue < 0) return;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Combattimento.${statName}.Mod`]: newValue,
      });
    } catch (error) { // Corrected catch block syntax
      console.error("Error updating combat stat mod", error);
    }
  };

  const renderTable = () => {
    if (!combStats) return null;
    const columns = ["Base", "Equip", "Mod", "Tot"];
    const orderedStats = Object.keys(combStats).sort();

    return (
      <div className="flex-grow flex flex-col">
         {/* Update displayed text and variable */}
        <div className="p-2 text-right text-white bg-[rgba(25,50,128,0.4)] border border-[rgba(255,255,255,0.3)]">
          Token: {combatTokensAvailable} {/* Use new state variable */}
        </div>
         {/* Rest of the table rendering logic remains the same */}
         <table className="w-full flex-grow border-collapse text-white rounded-[8px] overflow-hidden">
          <thead>
            <tr>
              <th className="border border-[rgba(255,255,255,0.3)] p-2 text-left pl-[10px]">
                Stat
              </th>
              {columns.map((col) => {
                let thClasses = "border border-[rgba(255,255,255,0.3)] p-2 text-center";
                if (col === "Tot") {
                  thClasses += " bg-[rgba(25,50,128,0.4)] font-bold";
                }
                return (
                  <th key={col} className={thClasses}>
                    {col}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {orderedStats.map((statName) => {
              const statValues = combStats[statName];
              return (
                <tr key={statName} className="even:bg-[rgba(60,60,80,0.4)]">
                  <td className="border border-[rgba(255,255,255,0.3)] p-2 text-left pl-[10px]">
                    {statName}
                  </td>
                  {columns.map((col) => {
                    if (col === "Base") {
                      // Buttons now call modified handlers
                      return (
                        <td key={col} className="border border-[rgba(255,255,255,0.3)] p-2 text-center">
                          {!lockParamCombat ? (
                            <div className="flex flex-row items-center justify-center">
                              <button
                                disabled={cooldown}
                                className="bg-transparent border-0 text-white cursor-pointer text-base px-[5px] transition-colors hover:text-[#ffd700]"
                                onClick={() => handleCombDecrease(statName)}
                              >
                                ◀
                              </button>
                              <span className="mx-[5px] min-w-[20px] text-center">
                                {statValues[col]}
                              </span>
                              <button
                                disabled={cooldown}
                                className="bg-transparent border-0 text-white cursor-pointer text-base px-[5px] transition-colors hover:text-[#ffd700]"
                                onClick={() => handleCombIncrease(statName)}
                              >
                                ▶
                              </button>
                            </div>
                          ) : (
                            <span className="mx-[5px] min-w-[20px] text-center">
                              {statValues[col]}
                            </span>
                          )}
                        </td>
                      );
                    } else if (col === "Mod") {
                     // Mod handlers remain unchanged
                     return (
                        <td key={col} className="border border-[rgba(255,255,255,0.3)] p-2 text-center">
                          <div className="flex flex-row items-center justify-center">
                            <button
                              disabled={cooldown}
                              className="bg-transparent border-0 text-white cursor-pointer text-base px-[5px] transition-colors hover:text-[#ffd700]"
                              onClick={() => handleCombModDecrease(statName)}
                            >
                              ◀
                            </button>
                            <span className="mx-[5px] min-w-[20px] text-center">
                              {statValues[col]}
                            </span>
                            <button
                              disabled={cooldown}
                              className="bg-transparent border-0 text-white cursor-pointer text-base px-[5px] transition-colors hover:text-[#ffd700]"
                              onClick={() => handleCombModIncrease(statName)}
                            >
                              ▶
                            </button>
                          </div>
                        </td>
                      );
                    } else {
                      let tdClasses = "border border-[rgba(255,255,255,0.3)] p-2 text-center";
                      if (col === "Tot") {
                        tdClasses += " bg-[rgba(25,50,128,0.4)] font-bold";
                      }
                      return (
                        <td key={col} className={tdClasses}>
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
    );
  };

  return (
    <div>
      <h2 className="mb-3 text-white text-xl">Combat Stats</h2>
      {renderTable()}
    </div>
  );
}