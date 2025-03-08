// file: ./frontend/src/components/elements/paramTables.js
import React, { useState, useEffect } from "react";
import { doc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { useAuth } from "../../AuthContext";

// Component for the Base Stats Table
export function BaseStatsTable() {
  const { user, userData } = useAuth();
  const [baseStats, setBaseStats] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  const [abilityPoints, setAbilityPoints] = useState(0);
  const [lockParamBase, setLockParamBase] = useState(false);

  useEffect(() => {
    if (userData) {
      if (userData.Parametri && userData.Parametri.Base) {
        setBaseStats(userData.Parametri.Base);
      }
      if (userData.stats && userData.stats.ability_points !== undefined) {
        setAbilityPoints(userData.stats.ability_points);
      }
      if (userData.settings) {
        setLockParamBase(userData.settings.lock_param_base || false);
      }
    }
  }, [userData]);

  // Enhanced real-time listener for base stats, settings and ability points changes
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          if (data.stats && data.stats.ability_points !== undefined) {
            setAbilityPoints(data.stats.ability_points);
          }
          if (data.settings) {
            setLockParamBase(data.settings.lock_param_base || false);
          }
          // Listen for changes in Base parameters
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

  // Rest of the BaseStatsTable component code remains unchanged
  const triggerCooldown = () => {
    setCooldown(true);
    setTimeout(() => setCooldown(false), 500);
  };

  const handleIncrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !baseStats) return;
    const currentValue = Number(baseStats[statName].Base) || 0;
    const newValue = currentValue + 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Base.${statName}.Base`]: newValue,
      });
      // No need to manually update state since onSnapshot will handle it
    } catch (error) {
      console.error("Error updating stat", error);
    }
  };

  const handleDecrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !baseStats) return;
    const currentValue = Number(baseStats[statName].Base) || 0;
    const newValue = currentValue - 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Base.${statName}.Base`]: newValue,
      });
    } catch (error) {
      console.error("Error updating stat", error);
    }
  };

  const handleModIncrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !baseStats) return;
    const currentValue = Number(baseStats[statName].Mod) || 0;
    const newValue = currentValue + 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Base.${statName}.Mod`]: newValue,
      });
    } catch (error) {
      console.error("Error updating stat mod", error);
    }
  };

  const handleModDecrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !baseStats) return;
    const currentValue = Number(baseStats[statName].Mod) || 0;
    const newValue = currentValue - 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Base.${statName}.Mod`]: newValue,
      });
    } catch (error) {
      console.error("Error updating stat mod", error);
    }
  };

  const renderTable = () => {
    // Table rendering code remains unchanged
    if (!baseStats) return null;
    const columns = ["Base", "Anima", "Equip", "Mod", "Tot"];
    const orderedStats = Object.keys(baseStats).sort();

    return (
      <div className="flex-grow flex flex-col">
        <div className="p-2 text-right text-white bg-[rgba(25,50,128,0.4)] border border-[rgba(255,255,255,0.3)]">
          Punti Base: {abilityPoints}
        </div>
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

// Component for the Combat Stats Table
export function CombatStatsTable() {
  const { user, userData } = useAuth();
  const [combStats, setCombStats] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  const [tokenValue, setTokenValue] = useState(0);
  const [lockParamCombat, setLockParamCombat] = useState(false);

  useEffect(() => {
    if (userData) {
      if (userData.Parametri && userData.Parametri.Combattimento) {
        setCombStats(userData.Parametri.Combattimento);
      }
      if (userData.stats && userData.stats.token !== undefined) {
        setTokenValue(userData.stats.token);
      }
      if (userData.settings) {
        setLockParamCombat(userData.settings.lock_param_combat || false);
      }
    }
  }, [userData]);

  // Enhanced real-time listener for combat stats, settings and token value changes
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          if (data.stats && data.stats.token !== undefined) {
            setTokenValue(data.stats.token);
          }
          if (data.settings) {
            setLockParamCombat(data.settings.lock_param_combat || false);
          }
          // Listen for changes in Combat parameters
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

  const handleCombIncrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !combStats) return;
    const currentValue = Number(combStats[statName].Base) || 0;
    const newValue = currentValue + 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Combattimento.${statName}.Base`]: newValue,
      });
      // No need to manually update state since onSnapshot will handle it
    } catch (error) {
      console.error("Error updating combat stat", error);
    }
  };

  const handleCombDecrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !combStats) return;
    const currentValue = Number(combStats[statName].Base) || 0;
    const newValue = currentValue - 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Combattimento.${statName}.Base`]: newValue,
      });
    } catch (error) {
      console.error("Error updating combat stat", error);
    }
  };

  const handleCombModIncrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !combStats) return;
    const currentValue = Number(combStats[statName].Mod) || 0;
    const newValue = currentValue + 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Combattimento.${statName}.Mod`]: newValue,
      });
    } catch (error) {
      console.error("Error updating combat stat mod", error);
    }
  };

  const handleCombModDecrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !combStats) return;
    const currentValue = Number(combStats[statName].Mod) || 0;
    const newValue = currentValue - 1;
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Combattimento.${statName}.Mod`]: newValue,
      });
    } catch (error) {
      console.error("Error updating combat stat mod", error);
    }
  };

  const renderTable = () => {
    // Table rendering code remains unchanged
    if (!combStats) return null;
    const columns = ["Base", "Equip", "Mod", "Tot"];
    const orderedStats = Object.keys(combStats).sort();

    return (
      <div className="flex-grow flex flex-col">
        <div className="p-2 text-right text-white bg-[rgba(25,50,128,0.4)] border border-[rgba(255,255,255,0.3)]">
          Token: {tokenValue}
        </div>
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