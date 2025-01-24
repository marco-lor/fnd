import React, { useEffect, useState } from 'react';
import axios from 'axios';
import logo from './logo.svg';
import './App.css';

// Firebase Auth
import { auth } from './components/firebaseConfig';
import { onAuthStateChanged, signOut } from 'firebase/auth';

// Our new Login component
import Login from './components/Login';

function App() {
  const [characters, setCharacters] = useState([]);
  const [user, setUser] = useState(null);

  const isLocalhost = window.location.hostname === "localhost";
  const baseURL = isLocalhost
    ? "http://127.0.0.1:8000"
    : "https://fnd-64ts.onrender.com";

  // Check Auth state on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // Fetch characters only if a user is logged in
  useEffect(() => {
    if (user) {
      axios
        .get(`${baseURL}/characters`)
        .then((response) => {
          setCharacters(response.data.characters);
        })
        .catch((error) => {
          console.error('Error fetching characters:', error);
        });
    }
  }, [baseURL, user]);

  // Logout Function
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
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
        <img src={logo} className="App-logo" alt="logo" />
        <h1 className="main-title">Fatins &amp; Dragons</h1>

        {/* Logout Button */}
        <button className="logout-button" onClick={handleLogout}>
          Logout
        </button>

        <h2>Starring:</h2>
        <ul className="starring-list">
          <li>Nyx</li>
          <li>Bro</li>
          <li>Scasso</li>
          <li>Ruhma</li>
          <li>Aarci</li>
        </ul>

        <p className="dev-status">Sviluppo webapp F&D in corso...</p>
      </header>

      <main style={{ marginTop: '2rem' }}>
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
