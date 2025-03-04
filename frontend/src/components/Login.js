// file: ./frontend/src/components/Login.js
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
  const [isHovered, setIsHovered] = useState(false);
  const [isSignupHovered, setIsSignupHovered] = useState(false);
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
                className="relative w-20 h-20 rounded-full overflow-visible cursor-pointer focus:outline-none"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
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

                {/* Liquid overlay effect */}
                <div
                  className="absolute inset-0"
                  style={{
                    borderRadius: "40% 60% 30% 70% / 60% 30% 70% 40%",
                    background: "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, transparent 50%, rgba(80,180,255,0.3) 100%)",
                    opacity: 0.7,
                    animation: "liquidOverlay 6s ease-in-out infinite alternate",
                    filter: isHovered ? "blur(2px)" : "blur(1px)",
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
                  Enter
                </div>
              </button>
            </div>
          </form>

          {/* Animated Liquid Neon Metal Signup Button */}
          <div className="relative my-6 flex justify-center items-center">
            <button
              type="button"
              onClick={handleSignup}
              className="relative w-16 h-16 rounded-full overflow-visible cursor-pointer focus:outline-none"
              onMouseEnter={() => setIsSignupHovered(true)}
              onMouseLeave={() => setIsSignupHovered(false)}
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
                  transform: isSignupHovered ? "scale(0.8)" : "scale(1)",
                }}
              ></div>

              {/* Liquid overlay effect */}
              <div
                className="absolute inset-0"
                style={{
                  borderRadius: "70% 50% 60% 40% / 40% 60% 50% 70%",
                  background: "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, transparent 50%, rgba(80,180,255,0.3) 100%)",
                  opacity: 0.7,
                  animation: "liquidOverlay2 5s ease-in-out infinite alternate",
                  filter: isSignupHovered ? "blur(2px)" : "blur(1px)",
                }}
              ></div>

              {/* Red liquid droplet (appears on hover) */}
              <div
                className="absolute rounded-full"
                style={{
                  width: isSignupHovered ? "18px" : "0px",
                  height: isSignupHovered ? "18px" : "0px",
                  top: "50%",
                  right: "0%",
                  transform: isSignupHovered ? "translate(120%, -50%)" : "translate(0%, -50%)",
                  background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(255,80,120,0.8) 60%)",
                  boxShadow: "0 0 15px rgba(255,80,120,0.9)",
                  opacity: isSignupHovered ? 1 : 0,
                  transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  borderRadius: "55% 65% 35% 45% / 55% 65% 35% 45%",
                  animation: isSignupHovered ? "liquidDroplet 3.5s ease-in-out infinite alternate" : "none",
                  filter: "blur(0.5px)",
                }}
              ></div>

              {/* Green liquid droplet (appears on hover) */}
              <div
                className="absolute"
                style={{
                  width: isSignupHovered ? "18px" : "0px",
                  height: isSignupHovered ? "18px" : "0px",
                  bottom: "0%",
                  left: "50%",
                  transform: isSignupHovered ? "translate(-50%, 120%)" : "translate(-50%, 0%)",
                  background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(80,255,180,0.8) 60%)",
                  boxShadow: "0 0 15px rgba(80,255,180,0.9)",
                  opacity: isSignupHovered ? 1 : 0,
                  transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  borderRadius: "45% 55% 65% 35% / 35% 45% 55% 65%",
                  animation: isSignupHovered ? "liquidDroplet2 3.5s ease-in-out infinite alternate" : "none",
                  filter: "blur(0.5px)",
                }}
              ></div>

              {/* Blue liquid droplet (appears on hover) */}
              <div
                className="absolute"
                style={{
                  width: isSignupHovered ? "18px" : "0px",
                  height: isSignupHovered ? "18px" : "0px",
                  top: "50%",
                  left: "0%",
                  transform: isSignupHovered ? "translate(-120%, -50%)" : "translate(0%, -50%)",
                  background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(80,180,255,0.8) 60%)",
                  boxShadow: "0 0 15px rgba(80,180,255,0.9)",
                  opacity: isSignupHovered ? 1 : 0,
                  transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  borderRadius: "45% 35% 55% 65% / 55% 45% 65% 35%",
                  animation: isSignupHovered ? "liquidDroplet3 3.5s ease-in-out infinite alternate" : "none",
                  filter: "blur(0.5px)",
                }}
              ></div>

              {/* Liquid connections (appears on hover) */}
              {isSignupHovered && (
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

              {/* Text */}
              <div
                className="absolute inset-0 flex items-center justify-center text-white font-bold text-base"
                style={{
                  opacity: isSignupHovered ? 1 : 0,
                  transform: isSignupHovered ? "scale(1)" : "scale(0.8)",
                  transition: "all 0.3s ease-in-out",
                  textShadow: "0 0 8px rgba(150,200,255,0.9), 0 0 15px rgba(100,150,255,0.7)",
                  zIndex: 10,
                }}
              >
                SignUp
              </div>
            </button>
          </div>
          {error && <p className="text-[#FF4C4C] mt-[10px] font-bold">{error}</p>}
        </div>
      </div>
      <style jsx>{`
        @keyframes rotateRed {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes rotateGreen {
          from { transform: rotate(120deg); }
          to { transform: rotate(480deg); }
        }
        @keyframes rotateBlue {
          from { transform: rotate(240deg); }
          to { transform: rotate(600deg); }
        }
        @keyframes shimmer {
          0% { opacity: 0.3; transform: scale(1); }
          100% { opacity: 0.7; transform: scale(1.05); }
        }
        @keyframes liquidBubble {
          0% { border-radius: 60% 40% 70% 30% / 50% 60% 40% 50%; }
          25% { border-radius: 40% 60% 30% 70% / 60% 30% 50% 40%; }
          50% { border-radius: 70% 30% 50% 50% / 40% 40% 60% 60%; }
          75% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 50%; }
          100% { border-radius: 60% 40% 70% 30% / 50% 60% 40% 50%; }
        }
        @keyframes liquidBubble2 {
          0% { border-radius: 50% 70% 40% 60% / 60% 40% 70% 50%; }
          33% { border-radius: 70% 50% 60% 50% / 50% 60% 40% 70%; }
          66% { border-radius: 50% 60% 70% 40% / 70% 40% 50% 60%; }
          100% { border-radius: 50% 70% 40% 60% / 60% 40% 70% 50%; }
        }
        @keyframes liquidOverlay {
          0% { border-radius: 40% 60% 30% 70% / 60% 30% 70% 40%; opacity: 0.7; }
          50% { border-radius: 60% 40% 70% 30% / 30% 70% 40% 60%; opacity: 0.8; }
          100% { border-radius: 40% 60% 30% 70% / 60% 30% 70% 40%; opacity: 0.7; }
        }
        @keyframes liquidOverlay2 {
          0% { border-radius: 70% 50% 60% 40% / 40% 60% 50% 70%; opacity: 0.7; }
          50% { border-radius: 50% 70% 40% 60% / 60% 40% 70% 50%; opacity: 0.8; }
          100% { border-radius: 70% 50% 60% 40% / 40% 60% 50% 70%; opacity: 0.7; }
        }
        @keyframes liquidDroplet {
          0% { border-radius: 60% 70% 40% 50% / 50% 60% 40% 50%; transform: translate(120%, -50%) scale(1); }
          50% { border-radius: 50% 60% 50% 40% / 40% 50% 60% 50%; transform: translate(130%, -50%) scale(1.05); }
          100% { border-radius: 60% 70% 40% 50% / 50% 60% 40% 50%; transform: translate(120%, -50%) scale(1); }
        }
        @keyframes liquidDroplet2 {
          0% { border-radius: 50% 60% 70% 40% / 40% 50% 60% 70%; transform: translate(-50%, 120%) scale(1); }
          50% { border-radius: 40% 50% 60% 70% / 70% 40% 50% 60%; transform: translate(-50%, 130%) scale(1.05); }
          100% { border-radius: 50% 60% 70% 40% / 40% 50% 60% 70%; transform: translate(-50%, 120%) scale(1); }
        }
        @keyframes liquidDroplet3 {
          0% { border-radius: 50% 40% 60% 70% / 60% 50% 70% 40%; transform: translate(-120%, -50%) scale(1); }
          50% { border-radius: 60% 50% 70% 40% / 70% 60% 40% 50%; transform: translate(-130%, -50%) scale(1.05); }
          100% { border-radius: 50% 40% 60% 70% / 60% 50% 70% 40%; transform: translate(-120%, -50%) scale(1); }
        }
      `}</style>
    </div>
  );
}

export default Login;
