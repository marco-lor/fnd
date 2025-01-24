// file ./frontend/src/components/Login.js
import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from './firebaseConfig';
import { useNavigate } from 'react-router-dom';
import './Login.css';  // New CSS file for better styling

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.includes("@") || password.length < 6) {
      setError("Invalid email format or password too short (min 6 characters).");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.location.reload();
    } catch (err) {
      setError("Login failed. Check credentials and try again.");
      console.error("Firebase Auth Error:", err.message);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Enter Etherium</h1>
        <form onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Enter your sacred email"
            className="login-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Forge your secret password"
            className="login-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="login-button">Enter</button>
        </form>
        <button onClick={handleSignup} className="signup-button">Join the Order</button>
        {error && <p className="error-message">{error}</p>}
      </div>
    </div>
  );
}

export default Login;
