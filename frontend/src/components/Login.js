// file: ./frontend/src/components/Login.js
import React, { useState, useEffect } from "react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, fetchSignInMethodsForEmail } from "firebase/auth";
import { auth, db } from "./firebaseConfig";
import { useNavigate } from "react-router-dom";
import { setDoc, doc, getDoc } from "firebase/firestore";
import AuroraBackground from "./backgrounds/AuroraBackground";
import "./LoginAnimations.css"; // Added import
import LoginCreateButton from "./LoginCreateButton";
import { FiMail, FiLock, FiEye, FiEyeOff, FiLogIn } from "react-icons/fi";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isHovered, setIsHovered] = useState(false);
  const [isCreateHovered, setIsCreateHovered] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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

      // Fetch initial schema for character defaults
      const schemaDocRef = doc(db, "utils", "schema_pg");
      const schemaSnap = await getDoc(schemaDocRef);
      let initialSchemaData = {};
      if (schemaSnap.exists()) {
        const schemaData = schemaSnap.data();
        const fieldsToPick = [
          "AltriParametri",
          "Parametri",
          "characterId",
          "conoscenze",
          "inventory",
          "lingue",
          "professioni",
          "settings",
          "spells",
          "stats",
          "tecniche",
          "imageUrl"
        ];
        fieldsToPick.forEach(field => {
          if (schemaData[field] !== undefined) {
            initialSchemaData[field] = JSON.parse(JSON.stringify(schemaData[field]));
          }
        });
      }

      // Prepare basic user data including schema defaults
      const basicUserData = {
        email: user.email,
        role: "player",
        created_at: new Date().toISOString(),
        flags: { characterCreationDone: false },
        ...initialSchemaData
      };

      // Save the initial user data to Firestore
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
  <div className="relative w-screen h-screen">
      <AuroraBackground />

      {/* Soft glow orbs behind the card */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
      </div>

      <div className="relative z-10 flex justify-center items-center h-full p-4">
        <div className="group relative w-full max-w-md rounded-2xl bg-white/5 backdrop-blur-xl ring-1 ring-white/10 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.6)]">
          {/* Animated gradient border */}
          <div className="pointer-events-none absolute -inset-[1px] rounded-2xl bg-[conic-gradient(from_90deg_at_50%_50%,#5eead4_0%,#60a5fa_40%,#f472b6_70%,#5eead4_100%)] opacity-30 blur-[6px] animate-slow-spin"></div>

          <div className="relative px-8 py-8">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-2 h-12 w-12 rounded-xl bg-gradient-to-br from-cyan-400/70 to-fuchsia-500/70 grid place-items-center shadow-[0_0_30px_rgba(99,102,241,0.3)]">
                <FiLogIn className="text-white/90" size={26} />
              </div>
              <h1 className="text-2xl font-semibold tracking-wide text-white drop-shadow-[0_2px_12px_rgba(59,130,246,0.45)]">
                Enter Etherium
              </h1>
              <p className="mt-1 text-sm text-white/70">Forge your legend and continue the journey.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              {/* Email */}
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50">
                  <FiMail size={18} />
                </span>
                <input
                  type="email"
                  placeholder="Email address"
                  className="w-full rounded-lg bg-white/5 py-3 pl-10 pr-3 text-white placeholder-white/50 outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-cyan-400/60"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {/* Password */}
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50">
                  <FiLock size={18} />
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  className="w-full rounded-lg bg-white/5 py-3 pl-10 pr-10 text-white placeholder-white/50 outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-fuchsia-400/60"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70 hover:text-white/90 transition"
                >
                  {showPassword ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                </button>
              </div>

              {/* Liquid Neon Login Button */}
              <div className="relative my-4 flex justify-center items-center h-36">
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
                      borderRadius: "50% 40% 60% 70% / 60% 40% 60% 40%",
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

            {/* Divider */}
            <div className="my-2 flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              <span className="text-xs uppercase tracking-wider text-white/50">or</span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>

            {/* Animated Liquid Neon Metal Create Button */}
            <LoginCreateButton
              handleCreate={handleCreate}
              isCreatingAccount={isCreatingAccount}
              isCreateHovered={isCreateHovered}
              setIsCreateHovered={setIsCreateHovered}
            />

            {successMessage && <p className="text-emerald-300 mt-2 font-medium text-center">{successMessage}</p>}
            {error && <p className="text-[#FF7A7A] mt-2 font-medium text-center">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
