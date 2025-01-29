// file: ./frontend/src/components/Login.js
// file: ./frontend/src/components/Login.js
import React, { useState } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "./firebaseConfig";
import { useNavigate } from "react-router-dom";
import { setDoc, doc } from "firebase/firestore";
import "./Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.includes("@") || password.length < 6) {
      setError("Invalid email or password too short (min 6 characters).");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/home"); // Redirect to home after login
    } catch (err) {
      setError("Login failed. Check credentials and try again.");
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Create user profile in Firestore
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        characterId: email.split("@")[0], // Default character ID
        imageUrl: "https://example.com/default-avatar.png", // Default avatar
        stats: { level: 1, hp: 100, xp: 0 },
        inventory: [{ name: "Basic Sword", type: "Weapon" }],
      });

      navigate("/home"); // Redirect to home after signup
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Enter Etherium</h1>
        <form onSubmit={handleLogin}>
          <input type="email" placeholder="Enter your email" className="login-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Enter your password" className="login-input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit" className="login-button">Login</button>
        </form>

        {/* Signup Button */}
        <button onClick={handleSignup} className="signup-button">Sign Up</button>

        {error && <p className="error-message">{error}</p>}
      </div>
    </div>
  );
}

export default Login;
