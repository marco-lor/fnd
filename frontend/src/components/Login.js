// file: ./frontend/src/components/Login.js
import React, { useState, useEffect } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, fetchSignInMethodsForEmail } from "firebase/auth";
import { auth, db } from "./firebaseConfig";
import { useNavigate } from "react-router-dom";
import { setDoc, doc, getDoc } from "firebase/firestore";
import DnDBackground from "./backgrounds/DnDBackground";
import "./LoginAnimations.css"; // Added import

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isHovered, setIsHovered] = useState(false);
  const [isCreateHovered, setIsCreateHovered] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoggingIn(true);

    if (!email.includes("@") || password.length < 6) {
      setError("Invalid email or password too short (min 6 characters).");
      setIsLoggingIn(false);
      return;
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Check if user has completed character creation
      const userDocRef = doc(db, "users", user.uid);
      const userDocSnap = await getDoc(userDocRef);
      
      if (userDocSnap.exists()) {
        const userData = userDocSnap.data();
        // Check if flags.characterCreationDone is false or doesn't exist
        if (!userData.flags?.characterCreationDone) {
          // Redirect to character creation
          navigate("/character-creation");
        } else {
          // Normal login flow
          navigate("/home");
        }
      } else {
        // This is unlikely but handle the case where user exists in auth but not in Firestore
        const basicUserData = {
          email: user.email,
          role: "player",
          created_at: new Date().toISOString(),
          flags: {
            characterCreationDone: false
          }
        };
        await setDoc(doc(db, "users", user.uid), basicUserData);
        navigate("/character-creation");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Login failed. Check credentials and try again.");
      setIsLoggingIn(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    
    if (!email.includes("@") || password.length < 6) {
      setError("Invalid email or password too short (min 6 characters).");
      return;
    }

    try {
      // First check if the user already exists
      const methods = await fetchSignInMethodsForEmail(auth, email);
      
      if (methods && methods.length > 0) {
        // User already exists
        setError("This email is already registered. Please login instead.");
        return;
      }

      setIsCreatingAccount(true);
      
      // Create the user if they don't exist
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Set a basic user document in Firestore with flags.characterCreationDone = false
      const basicUserData = {
        email: user.email,
        role: "player",
        created_at: new Date().toISOString(),
        flags: {
          characterCreationDone: false
        }
      };
      
      // Save the initial basic user data to Firestore
      await setDoc(doc(db, "users", user.uid), basicUserData);
      
      setSuccessMessage("Account created successfully! Redirecting to character setup...");
      
      // Navigate to character creation page after a short delay
      setTimeout(() => {
        navigate("/character-creation", { 
          state: { email: user.email } 
        });
      }, 1500);
      
    } catch (err) {
      setError(err.message);
      setIsCreatingAccount(false);
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
              className="w-full max-w-[300px] p-3 my-[10px] rounded-[5px] text-base bg-[rgba(30,30,30,0.8)] text-white placeholder-white/70 focus:outline-none focus:border-[rgba(80,180,255,0.8)] focus:ring-2 focus:ring-[rgba(80,180,255,0.8)] transition-colors duration-300"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Enter your password"
              className="w-full max-w-[300px] p-3 my-[10px] rounded-[5px] text-base bg-[rgba(30,30,30,0.8)] text-white placeholder-white/70 focus:outline-none focus:border-[rgba(80,180,255,0.8)] focus:ring-2 focus:ring-[rgba(80,180,255,0.8)] transition-colors duration-300"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {/* Liquid Neon Metal Gem Login Button */}
            <div className="relative my-6 flex justify-center items-center h-40">
              <button
                type="submit"
                className="relative w-20 h-20 rounded-full overflow-visible cursor-pointer focus:outline-none disabled:opacity-70"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                disabled={isLoggingIn}
              >
                {/* Base liquid metal cloud */}
                <div
                  className="absolute inset-0"
                  style={{
                    borderRadius: "60% 40% 70% 30% / 50% 60% 40% 50%",
                    background: "linear-gradient(45deg, rgba(255,80,120,0.6), rgba(80,180,255,0.6), rgba(80,255,180,0.6))",
                    boxShadow: "0 0 15px rgba(150,200,255,0.7), inset 0 0 8px rgba(255,255,255,0.5)",
                    filter: "blur(0.5px)",
                    animation: "liquidBubble 8s ease-in-out infinite alternate",
                    transition: "all 0.4s ease-in-out",
                    transform: isHovered ? "scale(0.8)" : "scale(1)",
                  }}
                ></div>

                {/* Red liquid droplet (appears on hover) */}
                <div
                  className="absolute rounded-full"
                  style={{
                    width: isHovered ? "24px" : "0px",
                    height: isHovered ? "24px" : "0px",
                    top: "50%",
                    right: "0%",
                    transform: isHovered ? "translate(120%, -50%)" : "translate(0%, -50%)",
                    background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(255,80,120,0.8) 60%)",
                    boxShadow: "0 0 15px rgba(255,80,120,0.9)",
                    opacity: isHovered ? 1 : 0,
                    transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                    borderRadius: "60% 70% 40% 50% / 50% 60% 40% 50%",
                    animation: isHovered ? "liquidDroplet 3s ease-in-out infinite alternate" : "none",
                    filter: "blur(0.5px)",
                  }}
                ></div>

                {/* Green liquid droplet (appears on hover) */}
                <div
                  className="absolute"
                  style={{
                    width: isHovered ? "24px" : "0px",
                    height: isHovered ? "24px" : "0px",
                    bottom: "0%",
                    left: "50%",
                    transform: isHovered ? "translate(-50%, 120%)" : "translate(-50%, 0%)",
                    background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(80,255,180,0.8) 60%)",
                    boxShadow: "0 0 15px rgba(80,255,180,0.9)",
                    opacity: isHovered ? 1 : 0,
                    transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                    borderRadius: "50% 60% 70% 40% / 40% 50% 60% 70%",
                    animation: isHovered ? "liquidDroplet2 3s ease-in-out infinite alternate" : "none",
                    filter: "blur(0.5px)",
                  }}
                ></div>

                {/* Blue liquid droplet (appears on hover) */}
                <div
                  className="absolute"
                  style={{
                    width: isHovered ? "24px" : "0px",
                    height: isHovered ? "24px" : "0px",
                    top: "50%",
                    left: "0%",
                    transform: isHovered ? "translate(-120%, -50%)" : "translate(0%, -50%)",
                    background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(80,180,255,0.8) 60%)",
                    boxShadow: "0 0 15px rgba(80,180,255,0.9)",
                    opacity: isHovered ? 1 : 0,
                    transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                    borderRadius: "50% 40% 60% 70% / 60% 50% 70% 40%",
                    animation: isHovered ? "liquidDroplet3 3s ease-in-out infinite alternate" : "none",
                    filter: "blur(0.5px)",
                  }}
                ></div>

                {/* Liquid connections (appears on hover) */}
                {isHovered && (
                  <>
                    <div
                      className="absolute"
                      style={{
                        width: "35px",
                        height: "4px",
                        top: "50%",
                        right: "5%",
                        transform: "translateY(-50%)",
                        background: "linear-gradient(to right, rgba(255,100,150,0.6), rgba(255,80,120,0))",
                        filter: "blur(2px)",
                        opacity: 0.8,
                        boxShadow: "0 0 8px rgba(255,100,150,0.6)",
                        borderRadius: "40% 60% 60% 40% / 40% 60% 40% 60%",
                      }}
                    ></div>
                    <div
                      className="absolute"
                      style={{
                        width: "4px",
                        height: "35px",
                        bottom: "5%",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "linear-gradient(to bottom, rgba(100,255,180,0.6), rgba(80,255,180,0))",
                        filter: "blur(2px)",
                        opacity: 0.8,
                        boxShadow: "0 0 8px rgba(100,255,180,0.6)",
                        borderRadius: "60% 40% 60% 40% / 40% 60% 40% 60%",
                      }}
                    ></div>
                    <div
                      className="absolute"
                      style={{
                        width: "35px",
                        height: "4px",
                        top: "50%",
                        left: "5%",
                        transform: "translateY(-50%)",
                        background: "linear-gradient(to left, rgba(100,180,255,0.6), rgba(80,180,255,0))",
                        filter: "blur(2px)",
                        opacity: 0.8,
                        boxShadow: "0 0 8px rgba(100,180,255,0.6)",
                        borderRadius: "60% 40% 60% 40% / 60% 40% 60% 40%",
                      }}
                    ></div>
                  </>
                )}

                {/* Text */}
                <div
                  className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg"
                  style={{
                    opacity: isHovered ? 1 : 0,
                    transform: isHovered ? "scale(1)" : "scale(0.8)",
                    transition: "all 0.3s ease-in-out",
                    textShadow: "0 0 8px rgba(150,200,255,0.9), 0 0 15px rgba(100,150,255,0.7)",
                    zIndex: 10,
                  }}
                >
                  {isLoggingIn ? (
                    <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
                  ) : "Enter"}
                </div>
              </button>
            </div>
          </form>

          {/* Animated Liquid Neon Metal Create Button */}
          <div className="relative my-6 flex justify-center items-center">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isCreatingAccount}
              className="relative w-16 h-16 rounded-full overflow-visible cursor-pointer focus:outline-none disabled:opacity-70"
              onMouseEnter={() => setIsCreateHovered(true)}
              onMouseLeave={() => setIsCreateHovered(false)}
            >
              {/* Base liquid metal cloud */}
              <div
                className="absolute inset-0"
                style={{
                  borderRadius: "50% 70% 40% 60% / 60% 40% 70% 50%",
                  background: "linear-gradient(45deg, rgba(255,80,120,0.6), rgba(80,180,255,0.6), rgba(80,255,180,0.6))",
                  boxShadow: "0 0 15px rgba(150,200,255,0.7), inset 0 0 8px rgba(255,255,255,0.5)",
                  filter: "blur(0.5px)",
                  animation: "liquidBubble2 7s ease-in-out infinite alternate",
                  transition: "all 0.4s ease-in-out",
                  transform: isCreateHovered ? "scale(0.8)" : "scale(1)",
                }}
              ></div>

              {/* Red liquid droplet (appears on hover) */}
              <div
                className="absolute rounded-full"
                style={{
                  width: isCreateHovered ? "18px" : "0px",
                  height: isCreateHovered ? "18px" : "0px",
                  top: "50%",
                  right: "0%",
                  transform: isCreateHovered ? "translate(120%, -50%)" : "translate(0%, -50%)",
                  background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(255,80,120,0.8) 60%)",
                  boxShadow: "0 0 15px rgba(255,80,120,0.9)",
                  opacity: isCreateHovered ? 1 : 0,
                  transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  borderRadius: "55% 65% 35% 45% / 55% 65% 35% 45%",
                  animation: isCreateHovered ? "liquidDroplet 3.5s ease-in-out infinite alternate" : "none",
                  filter: "blur(0.5px)",
                }}
              ></div>

              {/* Green liquid droplet (appears on hover) */}
              <div
                className="absolute"
                style={{
                  width: isCreateHovered ? "18px" : "0px",
                  height: isCreateHovered ? "18px" : "0px",
                  bottom: "0%",
                  left: "50%",
                  transform: isCreateHovered ? "translate(-50%, 120%)" : "translate(-50%, 0%)",
                  background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(80,255,180,0.8) 60%)",
                  boxShadow: "0 0 15px rgba(80,255,180,0.9)",
                  opacity: isCreateHovered ? 1 : 0,
                  transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  borderRadius: "45% 55% 65% 35% / 35% 45% 55% 65%",
                  animation: isCreateHovered ? "liquidDroplet2 3.5s ease-in-out infinite alternate" : "none",
                  filter: "blur(0.5px)",
                }}
              ></div>

              {/* Blue liquid droplet (appears on hover) */}
              <div
                className="absolute"
                style={{
                  width: isCreateHovered ? "18px" : "0px",
                  height: isCreateHovered ? "18px" : "0px",
                  top: "50%",
                  left: "0%",
                  transform: isCreateHovered ? "translate(-120%, -50%)" : "translate(0%, -50%)",
                  background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(80,180,255,0.8) 60%)",
                  boxShadow: "0 0 15px rgba(80,180,255,0.9)",
                  opacity: isCreateHovered ? 1 : 0,
                  transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  borderRadius: "45% 35% 55% 65% / 55% 45% 65% 35%",
                  animation: isCreateHovered ? "liquidDroplet3 3.5s ease-in-out infinite alternate" : "none",
                  filter: "blur(0.5px)",
                }}
              ></div>

              {/* Liquid connections (appears on hover) */}
              {isCreateHovered && (
                <>
                  <div
                    className="absolute"
                    style={{
                      width: "30px",
                      height: "3px",
                      top: "50%",
                      right: "5%",
                      transform: "translateY(-50%)",
                      background: "linear-gradient(to right, rgba(255,100,150,0.6), rgba(255,80,120,0))",
                      filter: "blur(2px)",
                      opacity: 0.8,
                      boxShadow: "0 0 8px rgba(255,100,150,0.6)",
                      borderRadius: "30% 70% 70% 30% / 30% 70% 30% 70%",
                    }}
                  ></div>
                  <div
                    className="absolute"
                    style={{
                      width: "3px",
                      height: "30px",
                      bottom: "5%",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "linear-gradient(to bottom, rgba(100,255,180,0.6), rgba(80,255,180,0))",
                      filter: "blur(2px)",
                      opacity: 0.8,
                      boxShadow: "0 0 8px rgba(100,255,180,0.6)",
                      borderRadius: "70% 30% 70% 30% / 30% 70% 30% 70%",
                    }}
                  ></div>
                  <div
                    className="absolute"
                    style={{
                      width: "30px",
                      height: "3px",
                      top: "50%",
                      left: "5%",
                      transform: "translateY(-50%)",
                      background: "linear-gradient(to left, rgba(100,180,255,0.6), rgba(80,180,255,0))",
                      filter: "blur(2px)",
                      opacity: 0.8,
                      boxShadow: "0 0 8px rgba(100,180,255,0.6)",
                      borderRadius: "70% 30% 70% 30% / 70% 30% 70% 30%",
                    }}
                  ></div>
                </>
              )}

              {/* Text - Changed to "Create" */}
              <div
                className="absolute inset-0 flex items-center justify-center text-white font-bold text-base"
                style={{
                  opacity: isCreateHovered ? 1 : 0,
                  transform: isCreateHovered ? "scale(1)" : "scale(0.8)",
                  transition: "all 0.3s ease-in-out",
                  textShadow: "0 0 8px rgba(150,200,255,0.9), 0 0 15px rgba(100,150,255,0.7)",
                  zIndex: 10,
                }}
              >
                {isCreatingAccount ? (
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                ) : "Create"}
              </div>
            </button>
          </div>
          {successMessage && <p className="text-green-400 mt-[10px] font-bold">{successMessage}</p>}
          {error && <p className="text-[#FF4C4C] mt-[10px] font-bold">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export default Login;
