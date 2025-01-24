import React, { useEffect, useState } from "react";
import axios from "axios";
import { auth } from "./components/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "./components/firebaseConfig";
import Login from "./components/Login";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [imageUrl, setImageUrl] = useState(null); // New state for user image

  const isLocalhost = window.location.hostname === "localhost";
  const baseURL = isLocalhost
    ? "http://127.0.0.1:8000"
    : "https://fnd-64ts.onrender.com";

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const fetchUserData = async () => {
          const userRef = doc(db, "users", currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const data = userSnap.data();
            setUserData(data);
            if (data.imageUrl) {
              setImageUrl(data.imageUrl);
            } else {
              fetchUserImageFromBackend(currentUser.uid);
            }
          } else {
            fetchUserImageFromBackend(currentUser.uid);
          }
        };

        fetchUserData();
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch characters when the user logs in
  useEffect(() => {
    if (user) {
      axios
        .get(`${baseURL}/characters`)
        .then((response) => {
          setCharacters(response.data.characters);
        })
        .catch((error) => {
          console.error("Error fetching characters:", error);
        });
    }
  }, [baseURL, user]);

  // Fetch user image from FastAPI as fallback
  const fetchUserImageFromBackend = async (uid) => {
    try {
      const response = await axios.get(`${baseURL}/user-image/${uid}`);
      if (response.data.imageUrl) {
        setImageUrl(response.data.imageUrl);
      }
    } catch (error) {
      console.error("Error fetching user image from backend:", error);
    }
  };

  // Add item to Firestore inventory
  const addItemToInventory = async (item) => {
    if (!user) return;
    const userRef = doc(db, "users", user.uid);
    await updateDoc(userRef, {
      inventory: arrayUnion(item),
    });
  };

  // Logout function
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

      <main style={{ marginTop: "2rem" }}>
        <h2>Characters from the API:</h2>
        {characters.length > 0 ? (
          <ul>
            {characters.map((char, idx) => (
              <li key={idx}>{JSON.stringify(char)}</li>
            ))}
          </ul>
        ) : (
          <p>No characters to display or fetching in progress...</p>
        )}
      </main>
    </div>
  );
}

export default App;
