// file: ./frontend/src/components/Home.js
import React, { useEffect, useState } from "react";
import { auth, db, API_BASE_URL } from "./firebaseConfig";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import "./Home.css";

function Home() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  // Local state for editable Base and Combat stats
  const [editableBase, setEditableBase] = useState(null);
  const [editableComb, setEditableComb] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  // Global cooldown state: if true, no arrow click will be processed.
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
        setUserData(data);

        if (data.imageUrl) {
          setImageUrl(data.imageUrl);
        }

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

  // Logout handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
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
    // Check for cooldown to prevent rapid updates.
    if (cooldown) return;
    triggerCooldown();

    if (!user || !editableBase) return;
    const currentValue = Number(editableBase[statName].Base) || 0;
    const newValue = currentValue + 1;

    // Update local state
    setEditableBase((prev) => ({
      ...prev,
      [statName]: { ...prev[statName], Base: newValue },
    }));

    // Update Firestore
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

  // --- Combat Stats Handlers (for the Base column only) ---
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
      <div className="table-wrapper">
        <table className="stat-table">
          <thead>
            <tr>
              <th>Stat</th>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedStats.map((statName) => {
              const statValues = baseObj[statName];
              return (
                <tr key={statName}>
                  <td>{statName}</td>
                  {columns.map((col) => (
                    <td key={col}>
                      {col === "Base" ? (
                        <div className="arrow-container">
                          <button
                            disabled={cooldown}
                            className="arrow-button"
                            onClick={() => handleDecrease(statName)}
                          >
                            ◀
                          </button>
                          <span>{statValues[col]}</span>
                          <button
                            disabled={cooldown}
                            className="arrow-button"
                            onClick={() => handleIncrease(statName)}
                          >
                            ▶
                          </button>
                        </div>
                      ) : (
                        statValues[col]
                      )}
                    </td>
                  ))}
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
      <div className="table-wrapper">
        <table className="stat-table">
          <thead>
            <tr>
              <th>Stat</th>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedStats.map((statName) => {
              const statValues = combObj[statName];
              return (
                <tr key={statName}>
                  <td>{statName}</td>
                  {columns.map((col) => (
                    <td key={col}>
                      {col === "Base" ? (
                        <div className="arrow-container">
                          <button
                            disabled={cooldown}
                            className="arrow-button"
                            onClick={() => handleCombDecrease(statName)}
                          >
                            ◀
                          </button>
                          <span>{statValues[col]}</span>
                          <button
                            disabled={cooldown}
                            className="arrow-button"
                            onClick={() => handleCombIncrease(statName)}
                          >
                            ▶
                          </button>
                        </div>
                      ) : (
                        statValues[col]
                      )}
                    </td>
                  ))}
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

  // Use the real-time states for rendering.
  const baseParams = editableBase;
  const combParams = editableComb;

  return (
    <div className="home-container">
      <div className="central-container">
        <div className="top-section">
          {imageUrl && (
            <img
              src={imageUrl}
              alt="Character Avatar"
              className="profile-image"
            />
          )}
          <h1 className="welcome-text-top">
            Welcome, {userData?.characterId || user.email}!
          </h1>
          <button className="logout-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      <button className="placeholder-button" onClick={handleTestButtonClick}>
        Test API Call
      </button>

      <div className="tables-container">
        {baseParams && (
          <div className="table-container left-table">
            <h2>Base Stats</h2>
            {renderBaseTable(baseParams)}
          </div>
        )}

        {combParams && (
          <div className="table-container right-table">
            <h2>Combat Stats</h2>
            {renderCombattimentoTable(combParams)}
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;
