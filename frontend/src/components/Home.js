// file ./frontend/src/components/Home.js
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

  if (!user) {
    return <p>Loading...</p>;
  }

  return (
    <div className="home-container">
      <header className="home-header">
        <div className="top-section">
          {imageUrl && <img src={imageUrl} alt="Character Avatar" className="profile-image" />}
          <h1 className="welcome-text-top">Welcome, {userData?.characterId || user.email}!</h1>
          <button className="logout-button" onClick={handleLogout}>Logout</button>
        </div>

      <button className="test-button" onClick={handleTestButtonClick}>Test API Call</button>

      </header>
    </div>
  );
}

export default Home;
