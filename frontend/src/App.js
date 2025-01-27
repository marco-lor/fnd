/* file .frontend/src/App.js */
import React, { useEffect, useState } from "react";
import { auth } from "./components/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./components/firebaseConfig";
import Login from "./components/Login";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [imageUrl, setImageUrl] = useState(null); // New state for user image

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
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setUserData(null);
      setImageUrl(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (!user) {
    return (
      <div className="full-screen">
        <Login />
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        {imageUrl && (
          <img src={imageUrl} alt="User Avatar" className="profile-image" />
        )}
        <h1>Welcome, {userData?.characterId || user.email}!</h1>
        <button className="logout-button" onClick={handleLogout}>
          Logout
        </button>
      </header>
    </div>
  );
}

export default App;
