// file: ./frontend/src/components/Home.js
import React from "react";
import { useAuth } from "../AuthContext";
import DnDBackground from "./backgrounds/DnDBackground";
import Navbar from "./elements/navbar";
import { BaseStatsTable, CombatStatsTable } from "./paramTables";
import { API_BASE_URL } from "./firebaseConfig";

function Home() {
  const { user } = useAuth();

  // Test API Call handler
  const handleTestButtonClick = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/test-endpoint`);
      const data = await response.json();
      console.log("API Response:", data);
    } catch (error) {
      console.error("API request failed:", error);
    }
  };

  if (!user) {
    return <p>Loading...</p>;
  }

  return (
    <div className="relative w-screen min-h-screen overflow-hidden">
      <DnDBackground />
      <div className="relative z-10 flex flex-col">
        <Navbar />
        <main className="flex flex-col items-center justify-center p-5">
          <div className="mb-5">
            <button
              className="bg-[#007BFF] text-white text-lg py-2 px-4 rounded-[8px] cursor-pointer transition-colors duration-300 hover:bg-[#0056b3]"
              onClick={handleTestButtonClick}
            >
              Test API Call
            </button>
          </div>
          <div className="flex flex-row gap-5 w-full max-w-[1200px] h-full">
            <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] flex flex-col flex-1 min-h-0">
              <BaseStatsTable />
            </div>
            <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] flex flex-col flex-1 min-h-0">
              <CombatStatsTable />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default Home;
