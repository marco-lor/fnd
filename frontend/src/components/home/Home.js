// file: ./frontend/src/components/home/Home.js
import React, { useState, useEffect } from "react";
import { useAuth } from "../../AuthContext";
import DnDBackground from "../backgrounds/DnDBackground";
import StatsBars from "./elements/StatsBars";
import { MergedStatsTable } from "./elements/paramTables";
import { API_BASE_URL } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { FaDiceD20 } from "react-icons/fa";
import DiceRoller from "../common/DiceRoller";
import Extra from './elements/Extra';

function Home() {
  const { user, userData } = useAuth();
  const [dadiAnimaByLevel, setDadiAnimaByLevel] = useState([]);
  // at start of Home, add rolling state
  const [rolling, setRolling] = useState(false);
  const [rollingFaces, setRollingFaces] = useState(0);
  const [rollingDescription, setRollingDescription] = useState("");

  useEffect(() => {
    const fetchDadiAnima = async () => {
      try {
        const snap = await getDoc(doc(db, "utils", "varie"));
        if (snap.exists()) {
          setDadiAnimaByLevel(snap.data().dadiAnimaByLevel || []);
        }
      } catch (e) {
        console.error("Error fetching dadiAnimaByLevel:", e);
      }
    };
    fetchDadiAnima();
  }, []);

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

  // List Everything API Call handler
  const handleListEverythingClick = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/all-data`);
      const data = await response.json();
      console.log("All Data Response:", data);
    } catch (error) {
      console.error("API request failed:", error);
    }
  };

  // Update All Users API Call handler
  const handleUpdateAllUsersClick = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/update-all-users`);
      const data = await response.json();
      console.log("Update All Users Response:", data);
    } catch (error) {
      console.error("API request failed:", error);
    }
  };

  // Roll Dado Anima handler
  const handleRollDice = () => {
    const level = userData?.stats?.level;
    if (!level) return;
    const diceTypeStr = dadiAnimaByLevel[level];
    if (!diceTypeStr) return;
    const faces = parseInt(diceTypeStr.replace(/^d/, ''), 10);
    if (isNaN(faces) || faces <= 0) return;
    // trigger animated overlay with description
    setRollingFaces(faces);
    setRollingDescription(`Dado Anima (${diceTypeStr})`);
    setRolling(true);
  };

  if (!user) {
    return <p>Loading...</p>;
  }

  return (
    <div className="relative w-full min-h-screen overflow-x-hidden">
      <DnDBackground />
      <div className="relative z-10 flex flex-col">
        <main className="flex flex-col items-start justify-start p-5 w-full">
          {/* Render Test API button only if user role is webmaster */}
          {userData?.role === "webmaster" && (
            <div className="mb-5 flex gap-3">
              <button
                className="bg-[#6610f2] text-white text-lg py-2 px-4 rounded-[8px] cursor-pointer transition-colors duration-300 hover:bg-[#520dc2]"
                onClick={handleUpdateAllUsersClick}
              >
                Update All Users
              </button>
              <button
                className="bg-[#007BFF] text-white text-lg py-2 px-4 rounded-[8px] cursor-pointer transition-colors duration-300 hover:bg-[#0056b3]"
                onClick={handleTestButtonClick}
              >
                Test API Call
              </button>
              <button
                className="bg-[#28a745] text-white text-lg py-2 px-4 rounded-[8px] cursor-pointer transition-colors duration-300 hover:bg-[#218838]"
                onClick={handleListEverythingClick}
              >
                List Everything
              </button>
            </div>
          )}
          {dadiAnimaByLevel.length > 1 && userData?.stats?.level && (
            <div className="mb-5 text-white text-lg flex items-center">
              <span>Dado Anima: {dadiAnimaByLevel[userData.stats.level]}</span>
              <button onClick={handleRollDice} className="ml-2 text-white hover:text-gray-300" title="Roll Dado Anima">
                <FaDiceD20 className="inline-block" />
              </button>
            </div>
          )}
          {/* Main content: tables on left, stats bars on right */}
          <div className="mb-5 w-full flex flex-row">
            <div className="flex flex-col gap-5 w-auto">
              <MergedStatsTable />
            </div>
            <div className="ml-5 flex-1">
              <StatsBars />
            </div>
          </div>  {/* end stats row */}
          <Extra userData={userData} />
        </main>
      </div>
      {rolling && (
        <DiceRoller
          faces={rollingFaces}
          count={1}
          modifier={0}
          description={rollingDescription}
          onComplete={(total) => {
            console.log(`${rollingDescription}: ${total}`);
            setRolling(false);
          }}
        />
      )}
    </div>
  );
}

export default Home;

