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

            {/* Gem Login Button */}
            <div className="relative my-6 flex justify-center items-center h-40">
              <button
                type="submit"
                className="relative w-20 h-20 rounded-full overflow-visible cursor-pointer focus:outline-none"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{
                  background: "rgba(0,0,0,0.6)",
                  boxShadow: isHovered
                    ? "0 0 25px rgba(180,180,255,0.7), 0 0 40px rgba(80,120,255,0.5)"
                    : "0 0 15px rgba(100,100,255,0.3), inset 0 0 10px rgba(150,150,255,0.2)",
                  transition: "all 0.3s ease-in-out",
                }}
              >
                {/* Base gem container */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "rgba(20,25,40,0.5)",
                    backdropFilter: "blur(5px)",
                    transition: "all 0.3s ease-in-out",
                    border: "1px solid rgba(100,180,255,0.3)",
                  }}
                ></div>

                {/* Actively mixing colors - more evident before hover */}
                <div
                  className="absolute inset-0 rounded-full overflow-hidden"
                  style={{
                    opacity: isHovered ? 0 : 1,
                    transition: "opacity 0.3s ease-in-out",
                  }}
                >
                  {/* Red swirling component */}
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: "radial-gradient(circle at 65% 35%, rgba(255,80,120,0.7) 0%, rgba(255,80,120,0) 50%)",
                      mixBlendMode: "screen",
                      animation: "rotateRed 7s linear infinite",
                      transformOrigin: "center",
                    }}
                  ></div>

                  {/* Green swirling component */}
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: "radial-gradient(circle at 35% 65%, rgba(80,255,180,0.7) 0%, rgba(80,255,180,0) 50%)",
                      mixBlendMode: "screen",
                      animation: "rotateGreen 8s linear infinite",
                      transformOrigin: "center",
                    }}
                  ></div>

                  {/* Blue swirling component */}
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: "radial-gradient(circle at 35% 35%, rgba(80,180,255,0.7) 0%, rgba(80,180,255,0) 50%)",
                      mixBlendMode: "screen",
                      animation: "rotateBlue 6s linear infinite",
                      transformOrigin: "center",
                    }}
                  ></div>
                </div>

                {/* Red sphere (on hover) */}
                <div
                  className="absolute rounded-full"
                  style={{
                    width: isHovered ? "24px" : "0px",
                    height: isHovered ? "24px" : "0px",
                    top: "50%",
                    right: "0%",
                    transform: isHovered ? "translate(150%, -50%)" : "translate(0%, -50%)",
                    background: "rgba(255,80,120,0.7)",
                    boxShadow: "0 0 20px rgba(255,80,120,0.9), 0 0 35px rgba(255,80,120,0.6)",
                    opacity: isHovered ? 1 : 0,
                    transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                    border: "1px solid rgba(255,180,200,0.6)",
                    backdropFilter: "blur(3px)",
                  }}
                >
                  <div
                    className="absolute rounded-full"
                    style={{
                      width: "40%",
                      height: "40%",
                      top: "15%",
                      left: "15%",
                      background: "rgba(255,255,255,0.9)",
                      filter: "blur(1px)",
                    }}
                  ></div>
                </div>

                {/* Green sphere (on hover) */}
                <div
                  className="absolute rounded-full"
                  style={{
                    width: isHovered ? "24px" : "0px",
                    height: isHovered ? "24px" : "0px",
                    bottom: "0%",
                    left: "50%",
                    transform: isHovered ? "translate(-50%, 150%)" : "translate(-50%, 0%)",
                    background: "rgba(80,255,180,0.7)",
                    boxShadow: "0 0 20px rgba(80,255,180,0.9), 0 0 35px rgba(80,255,180,0.6)",
                    opacity: isHovered ? 1 : 0,
                    transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                    border: "1px solid rgba(180,255,220,0.6)",
                    backdropFilter: "blur(3px)",
                  }}
                >
                  <div
                    className="absolute rounded-full"
                    style={{
                      width: "40%",
                      height: "40%",
                      top: "15%",
                      left: "15%",
                      background: "rgba(255,255,255,0.9)",
                      filter: "blur(1px)",
                    }}
                  ></div>
                </div>

                {/* Blue sphere (on hover) */}
                <div
                  className="absolute rounded-full"
                  style={{
                    width: isHovered ? "24px" : "0px",
                    height: isHovered ? "24px" : "0px",
                    top: "50%",
                    left: "0%",
                    transform: isHovered ? "translate(-150%, -50%)" : "translate(0%, -50%)",
                    background: "rgba(80,180,255,0.7)",
                    boxShadow: "0 0 20px rgba(80,180,255,0.9), 0 0 35px rgba(80,180,255,0.6)",
                    opacity: isHovered ? 1 : 0,
                    transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                    border: "1px solid rgba(150,200,255,0.6)",
                    backdropFilter: "blur(3px)",
                  }}
                >
                  <div
                    className="absolute rounded-full"
                    style={{
                      width: "40%",
                      height: "40%",
                      top: "15%",
                      left: "15%",
                      background: "rgba(255,255,255,0.9)",
                      filter: "blur(1px)",
                    }}
                  ></div>
                </div>

                {/* Cyber connections between spheres and main gem (when hovered) */}
                {isHovered && (
                  <>
                    <div
                      className="absolute"
                      style={{
                        width: "40px",
                        height: "3px",
                        top: "50%",
                        right: "0",
                        transform: "translateY(-50%)",
                        background: "linear-gradient(to right, rgba(255,100,150,0.6), rgba(255,80,120,0))",
                        filter: "blur(2px)",
                        opacity: 0.8,
                        boxShadow: "0 0 8px rgba(255,100,150,0.8)",
                      }}
                    ></div>
                    <div
                      className="absolute"
                      style={{
                        width: "3px",
                        height: "40px",
                        bottom: "0",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "linear-gradient(to bottom, rgba(100,255,180,0.6), rgba(80,255,180,0))",
                        filter: "blur(2px)",
                        opacity: 0.8,
                        boxShadow: "0 0 8px rgba(100,255,180,0.8)",
                      }}
                    ></div>
                    <div
                      className="absolute"
                      style={{
                        width: "40px",
                        height: "3px",
                        top: "50%",
                        left: "0",
                        transform: "translateY(-50%)",
                        background: "linear-gradient(to left, rgba(100,180,255,0.6), rgba(80,180,255,0))",
                        filter: "blur(2px)",
                        opacity: 0.8,
                        boxShadow: "0 0 8px rgba(100,180,255,0.8)",
                      }}
                    ></div>
                  </>
                )}

                {/* Enter text (shown on hover) */}
                <div
                  className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg"
                  style={{
                    opacity: isHovered ? 1 : 0,
                    transform: isHovered ? "scale(1)" : "scale(0.8)",
                    transition: "all 0.3s ease-in-out",
                    textShadow: "0 0 8px rgba(150,200,255,0.9), 0 0 15px rgba(100,150,255,0.7)",
                  }}
                >
                  Enter
                </div>

                {/* Cyber shimmer effect */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,255,255,0.5) 0%, transparent 35%, transparent 65%, rgba(150,200,255,0.3) 100%)",
                    opacity: 0.6,
                    animation: "shimmer 3s ease-in-out infinite alternate",
                  }}
                ></div>
              </button>
            </div>
          </form>

          {/* Animated Signup Button */}
          <div className="relative my-6 flex justify-center items-center">
            <button
              type="button"
              onClick={handleSignup}
              className="relative w-16 h-16 rounded-full overflow-visible cursor-pointer focus:outline-none"
              onMouseEnter={() => setIsSignupHovered(true)}
              onMouseLeave={() => setIsSignupHovered(false)}
              style={{
                background: "rgba(0,0,0,0.6)",
                boxShadow: isSignupHovered
                  ? "0 0 25px rgba(180,180,255,0.7), 0 0 40px rgba(80,120,255,0.5)"
                  : "0 0 15px rgba(100,100,255,0.3), inset 0 0 10px rgba(150,150,255,0.2)",
                transition: "all 0.3s ease-in-out",
              }}
            >
              {/* Base gem container */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: "rgba(20,25,40,0.5)",
                  backdropFilter: "blur(5px)",
                  transition: "all 0.3s ease-in-out",
                  border: "1px solid rgba(100,180,255,0.3)",
                }}
              ></div>

              {/* Actively mixing colors - more evident before hover */}
              <div
                className="absolute inset-0 rounded-full overflow-hidden"
                style={{
                  opacity: isSignupHovered ? 0 : 1,
                  transition: "opacity 0.3s ease-in-out",
                }}
              >
                {/* Red swirling component */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "radial-gradient(circle at 65% 35%, rgba(255,80,120,0.7) 0%, rgba(255,80,120,0) 50%)",
                    mixBlendMode: "screen",
                    animation: "rotateRed 7s linear infinite",
                    transformOrigin: "center",
                  }}
                ></div>
                {/* Green swirling component */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "radial-gradient(circle at 35% 65%, rgba(80,255,180,0.7) 0%, rgba(80,255,180,0) 50%)",
                    mixBlendMode: "screen",
                    animation: "rotateGreen 8s linear infinite",
                    transformOrigin: "center",
                  }}
                ></div>
                {/* Blue swirling component */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "radial-gradient(circle at 35% 35%, rgba(80,180,255,0.7) 0%, rgba(80,180,255,0) 50%)",
                    mixBlendMode: "screen",
                    animation: "rotateBlue 6s linear infinite",
                    transformOrigin: "center",
                  }}
                ></div>
              </div>

              {/* Red sphere (on hover) */}
              <div
                className="absolute rounded-full"
                style={{
                  width: isSignupHovered ? "18px" : "0px",
                  height: isSignupHovered ? "18px" : "0px",
                  top: "50%",
                  right: "0%",
                  transform: isSignupHovered ? "translate(150%, -50%)" : "translate(0%, -50%)",
                  background: "rgba(255,80,120,0.7)",
                  boxShadow: "0 0 20px rgba(255,80,120,0.9), 0 0 35px rgba(255,80,120,0.6)",
                  opacity: isSignupHovered ? 1 : 0,
                  transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  border: "1px solid rgba(255,180,200,0.6)",
                  backdropFilter: "blur(3px)",
                }}
              >
                <div
                  className="absolute rounded-full"
                  style={{
                    width: "40%",
                    height: "40%",
                    top: "15%",
                    left: "15%",
                    background: "rgba(255,255,255,0.9)",
                    filter: "blur(1px)",
                  }}
                ></div>
              </div>

              {/* Green sphere (on hover) */}
              <div
                className="absolute rounded-full"
                style={{
                  width: isSignupHovered ? "18px" : "0px",
                  height: isSignupHovered ? "18px" : "0px",
                  bottom: "0%",
                  left: "50%",
                  transform: isSignupHovered ? "translate(-50%, 150%)" : "translate(-50%, 0%)",
                  background: "rgba(80,255,180,0.7)",
                  boxShadow: "0 0 20px rgba(80,255,180,0.9), 0 0 35px rgba(80,255,180,0.6)",
                  opacity: isSignupHovered ? 1 : 0,
                  transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  border: "1px solid rgba(180,255,220,0.6)",
                  backdropFilter: "blur(3px)",
                }}
              >
                <div
                  className="absolute rounded-full"
                  style={{
                    width: "40%",
                    height: "40%",
                    top: "15%",
                    left: "15%",
                    background: "rgba(255,255,255,0.9)",
                    filter: "blur(1px)",
                  }}
                ></div>
              </div>

              {/* Blue sphere (on hover) */}
              <div
                className="absolute rounded-full"
                style={{
                  width: isSignupHovered ? "18px" : "0px",
                  height: isSignupHovered ? "18px" : "0px",
                  top: "50%",
                  left: "0%",
                  transform: isSignupHovered ? "translate(-150%, -50%)" : "translate(0%, -50%)",
                  background: "rgba(80,180,255,0.7)",
                  boxShadow: "0 0 20px rgba(80,180,255,0.9), 0 0 35px rgba(80,180,255,0.6)",
                  opacity: isSignupHovered ? 1 : 0,
                  transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  border: "1px solid rgba(150,200,255,0.6)",
                  backdropFilter: "blur(3px)",
                }}
              >
                <div
                  className="absolute rounded-full"
                  style={{
                    width: "40%",
                    height: "40%",
                    top: "15%",
                    left: "15%",
                    background: "rgba(255,255,255,0.9)",
                    filter: "blur(1px)",
                  }}
                ></div>
              </div>

              {/* Cyber connections between spheres and main gem (when hovered) */}
              {isSignupHovered && (
                <>
                  <div
                    className="absolute"
                    style={{
                      width: "40px",
                      height: "3px",
                      top: "50%",
                      right: "0",
                      transform: "translateY(-50%)",
                      background: "linear-gradient(to right, rgba(255,100,150,0.6), rgba(255,80,120,0))",
                      filter: "blur(2px)",
                      opacity: 0.8,
                      boxShadow: "0 0 8px rgba(255,100,150,0.8)",
                    }}
                  ></div>
                  <div
                    className="absolute"
                    style={{
                      width: "3px",
                      height: "40px",
                      bottom: "0",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "linear-gradient(to bottom, rgba(100,255,180,0.6), rgba(80,255,180,0))",
                      filter: "blur(2px)",
                      opacity: 0.8,
                      boxShadow: "0 0 8px rgba(100,255,180,0.8)",
                    }}
                  ></div>
                  <div
                    className="absolute"
                    style={{
                      width: "40px",
                      height: "3px",
                      top: "50%",
                      left: "0",
                      transform: "translateY(-50%)",
                      background: "linear-gradient(to left, rgba(100,180,255,0.6), rgba(80,180,255,0))",
                      filter: "blur(2px)",
                      opacity: 0.8,
                      boxShadow: "0 0 8px rgba(100,180,255,0.8)",
                    }}
                  ></div>
                </>
              )}

              {/* Hover text */}
              <div
                className="absolute inset-0 flex items-center justify-center text-white font-bold text-base"
                style={{
                  opacity: isSignupHovered ? 1 : 0,
                  transform: isSignupHovered ? "scale(1)" : "scale(0.8)",
                  transition: "all 0.3s ease-in-out",
                  textShadow: "0 0 8px rgba(150,200,255,0.9), 0 0 15px rgba(100,150,255,0.7)",
                }}
              >
                SignUp
              </div>

              {/* Cyber shimmer effect */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: "linear-gradient(135deg, rgba(255,255,255,0.5) 0%, transparent 35%, transparent 65%, rgba(150,200,255,0.3) 100%)",
                  opacity: 0.6,
                  animation: "shimmer 3s ease-in-out infinite alternate",
                }}
              ></div>
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
      `}</style>
    </div>
  );
}

export default Login;
