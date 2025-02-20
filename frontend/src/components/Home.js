// file: ./frontend/src/components/Home.js
import React, { useEffect, useState } from "react";
import { auth, db, API_BASE_URL } from "./firebaseConfig";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import DnDBackground from "./DnDBackground";
import Navbar from "./navbar";

function Home() {
  const [user, setUser] = useState(null);
  const [editableBase, setEditableBase] = useState(null);
  const [editableComb, setEditableComb] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  const navigate = useNavigate();

  // Listen for authentication state changes.
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        navigate("/"); // Redirect to login if not authenticated
      }
    });
    return () => unsubscribeAuth();
  }, [navigate]);

  // Set up a real-time listener on the user's document.
  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, "users", user.uid);
    const unsubscribeSnapshot = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.Parametri) {
          if (data.Parametri.Base) {
            setEditableBase(data.Parametri.Base);
          }
          if (data.Parametri.Combattimento) {
            setEditableComb(data.Parametri.Combattimento);
          }
        }
      }
    });
    return () => unsubscribeSnapshot();
  }, [user]);

  // Helper function to trigger a 500ms cooldown.
  const triggerCooldown = () => {
    setCooldown(true);
    setTimeout(() => {
      setCooldown(false);
    }, 500);
  };

  // Test API Call handler
  const handleTestButtonClick = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/test-endpoint`);
      const data = await response.json();
      console.log("API Response:", data);
    } catch (error) {
      console.error("API request failed:", error);
    }
  };

  // --- Base Stats Handlers ---
  const handleIncrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !editableBase) return;
    const currentValue = Number(editableBase[statName].Base) || 0;
    const newValue = currentValue + 1;
    setEditableBase((prev) => ({
      ...prev,
      [statName]: { ...prev[statName], Base: newValue },
    }));
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Base.${statName}.Base`]: newValue,
      });
      console.log(`Increased ${statName} to ${newValue}`);
    } catch (error) {
      console.error("Error updating stat", error);
    }
  };

  const handleDecrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !editableBase) return;
    const currentValue = Number(editableBase[statName].Base) || 0;
    const newValue = currentValue - 1;
    setEditableBase((prev) => ({
      ...prev,
      [statName]: { ...prev[statName], Base: newValue },
    }));
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Base.${statName}.Base`]: newValue,
      });
      console.log(`Decreased ${statName} to ${newValue}`);
    } catch (error) {
      console.error("Error updating stat", error);
    }
  };

  // --- Combat Stats Handlers ---
  const handleCombIncrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !editableComb) return;
    const currentValue = Number(editableComb[statName].Base) || 0;
    const newValue = currentValue + 1;
    setEditableComb((prev) => ({
      ...prev,
      [statName]: { ...prev[statName], Base: newValue },
    }));
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Combattimento.${statName}.Base`]: newValue,
      });
      console.log(`Increased combat ${statName} to ${newValue}`);
    } catch (error) {
      console.error("Error updating combat stat", error);
    }
  };

  const handleCombDecrease = async (statName) => {
    if (cooldown) return;
    triggerCooldown();
    if (!user || !editableComb) return;
    const currentValue = Number(editableComb[statName].Base) || 0;
    const newValue = currentValue - 1;
    setEditableComb((prev) => ({
      ...prev,
      [statName]: { ...prev[statName], Base: newValue },
    }));
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`Parametri.Combattimento.${statName}.Base`]: newValue,
      });
      console.log(`Decreased combat ${statName} to ${newValue}`);
    } catch (error) {
      console.error("Error updating combat stat", error);
    }
  };

  // --- Rendering Functions ---
  const renderBaseTable = (baseObj) => {
    if (!baseObj) return null;
    const columns = ["Base", "Anima", "Equip", "Mod", "Tot"];
    const orderedStats = Object.keys(baseObj).sort();
    return (
      <div className="flex-grow flex flex-col">
        <table className="w-full flex-grow border-collapse text-white rounded-[8px] overflow-hidden">
          <thead>
            <tr>
              <th className="border border-[rgba(255,255,255,0.3)] p-2 text-left pl-[10px]">
                Stat
              </th>
              {columns.map((col) => {
                let thClasses =
                  "border border-[rgba(255,255,255,0.3)] p-2 text-center";
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
              const statValues = baseObj[statName];
              return (
                <tr key={statName} className="even:bg-[rgba(60,60,80,0.4)]">
                  <td className="border border-[rgba(255,255,255,0.3)] p-2 text-left pl-[10px]">
                    {statName}
                  </td>
                  {columns.map((col) => {
                    if (col === "Base") {
                      return (
                        <td
                          key={col}
                          className="border border-[rgba(255,255,255,0.3)] p-2 text-center"
                        >
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
                        </td>
                      );
                    } else {
                      let tdClasses =
                        "border border-[rgba(255,255,255,0.3)] p-2 text-center";
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

  const renderCombattimentoTable = (combObj) => {
    if (!combObj) return null;
    const columns = ["Base", "Equip", "Mod", "Tot"];
    const orderedStats = Object.keys(combObj).sort();
    return (
      <div className="flex-grow flex flex-col">
        <table className="w-full flex-grow border-collapse text-white rounded-[8px] overflow-hidden">
          <thead>
            <tr>
              <th className="border border-[rgba(255,255,255,0.3)] p-2 text-left pl-[10px]">
                Stat
              </th>
              {columns.map((col) => {
                let thClasses =
                  "border border-[rgba(255,255,255,0.3)] p-2 text-center";
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
              const statValues = combObj[statName];
              return (
                <tr key={statName} className="even:bg-[rgba(60,60,80,0.4)]">
                  <td className="border border-[rgba(255,255,255,0.3)] p-2 text-left pl-[10px]">
                    {statName}
                  </td>
                  {columns.map((col) => {
                    if (col === "Base") {
                      return (
                        <td
                          key={col}
                          className="border border-[rgba(255,255,255,0.3)] p-2 text-center"
                        >
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
                        </td>
                      );
                    } else {
                      let tdClasses =
                        "border border-[rgba(255,255,255,0.3)] p-2 text-center";
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

  if (!user) {
    return <p>Loading...</p>;
  }

  return (
    <div className="relative w-screen min-h-screen overflow-hidden">
      <DnDBackground />
      <div className="relative z-10 flex flex-col">
        <Navbar />
        <main className="flex flex-col items-center justify-center p-5">
          <div className="mb-5">
            <button
              className="bg-[#007BFF] text-white text-lg py-2 px-4 rounded-[8px] cursor-pointer transition-colors duration-300 hover:bg-[#0056b3]"
              onClick={handleTestButtonClick}
            >
              Test API Call
            </button>
          </div>
          <div className="flex flex-row gap-5 w-full max-w-[1200px]">
            {editableBase && (
              <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] flex flex-col flex-1">
                <h2 className="mb-3 text-white text-xl">Base Stats</h2>
                {renderBaseTable(editableBase)}
              </div>
            )}
            {editableComb && (
              <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] flex flex-col flex-1">
                <h2 className="mb-3 text-white text-xl">Combat Stats</h2>
                {renderCombattimentoTable(editableComb)}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default Home;
