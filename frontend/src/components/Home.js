// file: ./frontend/src/components/Home.js
import React, { useEffect, useState } from "react";
import { auth, db } from "./firebaseConfig";
import { API_BASE_URL } from "./firebaseConfig"; // Import dynamic API URL
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import "./Home.css";

function Home() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setUserData(data);
          if (data.imageUrl) {
            setImageUrl(data.imageUrl);
          }
        }
      } else {
        navigate("/"); // Redirect to login if no user is found
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleTestButtonClick = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/test-endpoint`); // Use dynamic API URL
      const data = await response.json();
      console.log("API Response:", data);
    } catch (error) {
      console.error("API request failed:", error);
    }
  };

  // Helper to render the Base stats table
  const renderBaseTable = (baseObj) => {
    if (!baseObj) return null;
    const columns = ["Base", "Anima", "Equip", "Mod", "Tot"];
    return (
      <div className="table-wrapper"> {/* Added wrapper */}
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
            {Object.entries(baseObj).map(([statName, statValues]) => (
              <tr key={statName}>
                <td>{statName}</td>
                {columns.map((col) => (
                  <td key={col}>{statValues[col]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Helper to render the Combattimento stats table
  const renderCombattimentoTable = (combObj) => {
    if (!combObj) return null;
    const columns = ["Base", "Equip", "Mod", "Tot"];
    return (
      <div className="table-wrapper"> {/* Added wrapper */}
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
            {Object.entries(combObj).map(([statName, statValues]) => (
              <tr key={statName}>
                <td>{statName}</td>
                {columns.map((col) => (
                  <td key={col}>{statValues[col]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  if (!user) {
    return <p>Loading...</p>;
  }

  // Extract the stats if available
  const baseParams = userData?.Parametri?.Base;
  const combParams = userData?.Parametri?.Combattimento;

  return (
    <div className="home-container">
      {/* Central Profile Area */}
      <div className="central-container">
        <div className="top-section">
          {imageUrl && (
            <img src={imageUrl} alt="Character Avatar" className="profile-image" />
          )}
          <h1 className="welcome-text-top">
            Welcome, {userData?.characterId || user.email}!
          </h1>
          <button className="logout-button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      {/* Placeholder button with onClick handler */}
      <button className="placeholder-button" onClick={handleTestButtonClick}>
        Test API Call
      </button>

      {/* Tables Container */}
      <div className="tables-container">
        {/* Left Table */}
        {baseParams && (
          <div className="table-container left-table">
            <h2>Base Stats</h2>
            {renderBaseTable(baseParams)}
          </div>
        )}

        {/* Right Table */}
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