import React from "react";

function LoginCreateButton({ handleCreate, isCreatingAccount, isCreateHovered, setIsCreateHovered }) {
  return (
    <div className="relative my-6 flex justify-center items-center h-40">
      <button
        type="button"
        onClick={handleCreate}
        className="relative w-20 h-20 rounded-full overflow-visible cursor-pointer focus:outline-none disabled:opacity-70"
        onMouseEnter={() => setIsCreateHovered(true)}
        onMouseLeave={() => setIsCreateHovered(false)}
        disabled={isCreatingAccount}
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
            transform: isCreateHovered ? "scale(0.8)" : "scale(1)",
          }}
        ></div>

        {/* Droplets */}
        <div
          className="absolute rounded-full"
          style={{
            width: isCreateHovered ? "24px" : "0px",
            height: isCreateHovered ? "24px" : "0px",
            top: "50%",
            right: "0%",
            transform: isCreateHovered ? "translate(120%, -50%)" : "translate(0%, -50%)",
            background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(255,80,120,0.8) 60%)",
            boxShadow: "0 0 15px rgba(255,80,120,0.9)",
            opacity: isCreateHovered ? 1 : 0,
            transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
            borderRadius: "60% 70% 40% 50% / 50% 60% 40% 50%",
            animation: isCreateHovered ? "liquidDroplet 3s ease-in-out infinite alternate" : "none",
            filter: "blur(0.5px)",
          }}
        ></div>
        <div
          className="absolute"
          style={{
            width: isCreateHovered ? "24px" : "0px",
            height: isCreateHovered ? "24px" : "0px",
            bottom: "0%",
            left: "50%",
            transform: isCreateHovered ? "translate(-50%, 120%)" : "translate(-50%, 0%)",
            background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(80,255,180,0.8) 60%)",
            boxShadow: "0 0 15px rgba(80,255,180,0.9)",
            opacity: isCreateHovered ? 1 : 0,
            transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
            borderRadius: "50% 60% 70% 40% / 40% 50% 60% 70%",
            animation: isCreateHovered ? "liquidDroplet2 3s ease-in-out infinite alternate" : "none",
            filter: "blur(0.5px)",
          }}
        ></div>
        <div
          className="absolute"
          style={{
            width: isCreateHovered ? "24px" : "0px",
            height: isCreateHovered ? "24px" : "0px",
            top: "50%",
            left: "0%",
            transform: isCreateHovered ? "translate(-120%, -50%)" : "translate(0%, -50%)",
            background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(80,180,255,0.8) 60%)",
            boxShadow: "0 0 15px rgba(80,180,255,0.9)",
            opacity: isCreateHovered ? 1 : 0,
            transition: "all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
            borderRadius: "50% 40% 60% 70% / 60% 50% 70% 40%",
            animation: isCreateHovered ? "liquidDroplet3 3s ease-in-out infinite alternate" : "none",
            filter: "blur(0.5px)",
          }}
        ></div>

        {/* Connections */}
        {isCreateHovered && (
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
            opacity: isCreateHovered ? 1 : 0,
            transform: isCreateHovered ? "scale(1)" : "scale(0.8)",
            transition: "all 0.3s ease-in-out",
            textShadow: "0 0 8px rgba(150,200,255,0.9), 0 0 15px rgba(100,150,255,0.7)",
            zIndex: 10,
          }}
        >
          {isCreatingAccount ? (
            <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
          ) : (
            "Create"
          )}
        </div>
      </button>
    </div>
  );
}

export default LoginCreateButton;
