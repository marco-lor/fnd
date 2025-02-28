// file: ./frontend/src/components/Login.js # do not remove this line
import React, { useState } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "./firebaseConfig";
import { useNavigate } from "react-router-dom";
import { setDoc, doc } from "firebase/firestore";
import DnDBackground from "./backgrounds/DnDBackground";

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
      navigate("/home");
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

      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        characterId: email.split("@")[0],
        imageUrl: "https://example.com/default-avatar.png",
        stats: { level: 1, hp: 100, xp: 0 },
        inventory: [{ name: "Basic Sword", type: "Weapon" }],
      });

      navigate("/home");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <DnDBackground />
      <div className="relative z-10 flex justify-center items-center h-full">
        <div className="bg-[rgba(40,40,60,0.5)] p-8 rounded-[15px] text-center w-[350px] shadow-[0_4px_15px_rgba(100,100,200,0.2)] border border-[rgba(150,150,255,0.2)]">
          <h1
            className="text-2xl mb-4 text-[#D4AF37]"
            style={{ textShadow: "0 0 8px rgba(255,215,0,0.4)" }}
          >
            Enter Etherium
          </h1>
          <form onSubmit={handleLogin}>
            <input
              type="email"
              placeholder="Enter your email"
              className="w-full max-w-[300px] p-3 my-[10px] rounded-[5px] text-base bg-[rgba(255,255,255,0.15)] text-white placeholder-white/70 focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Enter your password"
              className="w-full max-w-[300px] p-3 my-[10px] rounded-[5px] text-base bg-[rgba(255,255,255,0.15)] text-white placeholder-white/70 focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              className="w-full max-w-[300px] p-3 my-[10px] rounded-[5px] text-base bg-gradient-to-r from-[#FFD700] to-[#FFDD44] text-black font-bold cursor-pointer"
            >
              Login
            </button>
          </form>
          <button
            onClick={handleSignup}
            className="w-full max-w-[300px] p-3 my-[10px] rounded-[5px] text-base bg-gradient-to-r from-[#8B0000] to-[#B22222] text-white font-bold cursor-pointer"
          >
            Sign Up
          </button>
          {error && <p className="text-[#FF4C4C] mt-[10px] font-bold">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export default Login;
