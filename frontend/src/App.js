import React, { useEffect, useState } from 'react';
import axios from 'axios';
import logo from './logo.svg';
import './App.css';

function App() {
  // We'll store the fetched characters here
  const [characters, setCharacters] = useState([]);

  // Dynamically set our backend URL
  const isLocalhost = window.location.hostname === "localhost";
  const baseURL = isLocalhost
    ? "http://127.0.0.1:8000"   // Your local FastAPI endpoint
    : "https://fnd-64ts.onrender.com"; // Your Render URL

  // Fetch data from the backend when the component first mounts
  useEffect(() => {
    axios
      .get(`${baseURL}/characters`)
      .then((response) => {
        // Assuming the response is in the form { characters: [...] }
        setCharacters(response.data.characters);
      })
      .catch((error) => {
        console.error('Error fetching characters:', error);
      });
  }, [baseURL]);

  return (
    <div className="App">
      <header className="App-header">
        {/* Rotating React Logo */}
        <img src={logo} className="App-logo" alt="logo" />

        {/* Main Title */}
        <h1 className="main-title">Fatins &amp; Dragons</h1>

        {/* Starring List */}
        <h2>Starring:</h2>
        <ul className="starring-list">
          <li>Nyx</li>
          <li>Bro</li>
          <li>Scasso</li>
          <li>Ruhma</li>
          <li>Aarci</li>
        </ul>

        {/* Development Status */}
        <p className="dev-status">Sviluppo webapp F&amp;D in corso...</p>
      </header>

      {/* Displaying characters fetched from the API */}
      <main style={{ marginTop: '2rem' }}>
        <h2>Characters from the API:</h2>
        {characters.length > 0 ? (
          <ul>
            {characters.map((char, idx) => (
              /*
                 If your documents have a 'name' field or similar, use char.name
                 For safety, we'll just stringify the entire object
              */
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
