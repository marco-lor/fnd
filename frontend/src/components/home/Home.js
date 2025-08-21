// file: ./frontend/src/components/home/Home.js
import React, { useState, useEffect } from "react";
import { useAuth } from "../../AuthContext";
import DnDBackground from "../backgrounds/DnDBackground";
import StatsBars from "./elements/StatsBars";
import EquippedInventory from "./elements/EquippedInventory";
import { MergedStatsTable } from "./elements/paramTables";
import { API_BASE_URL } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { FaDiceD20 } from "react-icons/fa";
import DiceRoller from "../common/DiceRoller";
import Extra from './elements/Extra';

function Home() {
  const { user, userData } = useAuth();
  // helper to show anima field value or empty
  const getAnimaField = (key) => {
    const val = userData?.AltriParametri?.[key];
    return (typeof val === 'string' && /[A-Za-z]+/.test(val)) ? val : '';
  };
  // helper for anima color classes
  const getAnimaColorClass = (value) => {
    if (value === 'Spirito') return 'text-blue-300';
    if (value === 'Astuzia') return 'text-green-300';
    if (value === 'Potenza') return 'text-red-300';
    return 'text-gray-300';
  };
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
      {/* Dynamic Background */}
      <DnDBackground />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_60%),radial-gradient(circle_at_80%_70%,rgba(255,255,255,0.04),transparent_65%)] mix-blend-overlay" />

      <div className="relative z-10 flex flex-col">
        <main className="flex flex-col p-6 w-full gap-6">
          {userData?.role === "webmaster" && (
            <div className="flex flex-wrap gap-3 justify-start">
              <button
                className="group relative overflow-hidden bg-gradient-to-br from-fuchsia-600 to-violet-600 text-white text-sm md:text-base py-2 px-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-fuchsia-400/50 transition-all shadow hover:shadow-fuchsia-500/30"
                onClick={handleUpdateAllUsersClick}
              >
                <span className="relative z-10">Update All Users</span>
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.3),transparent_70%)]" />
              </button>
              <button
                className="group relative overflow-hidden bg-gradient-to-br from-sky-600 to-blue-600 text-white text-sm md:text-base py-2 px-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-400/50 transition-all shadow hover:shadow-sky-500/30"
                onClick={handleTestButtonClick}
              >
                <span className="relative z-10">Test API</span>
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_70%_80%,rgba(255,255,255,0.25),transparent_70%)]" />
              </button>
              <button
                className="group relative overflow-hidden bg-gradient-to-br from-emerald-600 to-green-600 text-white text-sm md:text-base py-2 px-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400/50 transition-all shadow hover:shadow-emerald-500/30"
                onClick={handleListEverythingClick}
              >
                <span className="relative z-10">List Everything</span>
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.25),transparent_65%)]" />
              </button>
            </div>
          )}
          
          {dadiAnimaByLevel.length > 1 && userData?.stats?.level && (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {/* Dado Anima Card */}
              <div className="group relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 flex items-center justify-between shadow-lg">
                <div>
                  <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Dado Anima</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold text-indigo-300 drop-shadow">{dadiAnimaByLevel[userData.stats.level]}</span>
                    <button
                      onClick={handleRollDice}
                      className="relative inline-flex items-center justify-center h-11 w-11 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-900/40 hover:scale-105 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
                      title="Roll Dado Anima"
                    >
                      <FaDiceD20 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div className="absolute -right-8 -top-8 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl group-hover:opacity-70 opacity-40 transition-opacity" />
              </div>
              {/* Anima Livello Card */}
              <div className="relative overflow-hidden backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg flex flex-col gap-3 xl:col-span-2">
                <p className="text-slate-400 text-xs uppercase tracking-wider">Anima Livelli</p>
                <div className="flex flex-wrap gap-6">
                  {['1','4','7'].map(liv => (
                    <div key={liv} className="flex flex-col">
                      <span className="text-xs text-slate-400">Livello {liv}</span>
                      <span className={`text-lg font-semibold tracking-wide ${getAnimaColorClass(getAnimaField(`Anima_${liv}`))}`}>{getAnimaField(`Anima_${liv}`) || '—'}</span>
                    </div>
                  ))}
                </div>
                <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl" />
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-fuchsia-500/10 rounded-full blur-3xl" />
              </div>
            </div>
          )}

          {/* Core Content Grid */}
          <div className="grid gap-6 xl:grid-cols-12">
            <div className="xl:col-span-8 space-y-6">
              {/* Tables & Bars */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="relative">
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-transparent to-fuchsia-500/10 pointer-events-none" />
                  <MergedStatsTable />
                </div>
                <div className="relative flex flex-col gap-6">
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-transparent to-blue-500/10 pointer-events-none" />
                  <StatsBars />
                  <EquippedInventory />
                </div>
              </div>
            </div>
            <div className="xl:col-span-4">
              <Extra
                lingue={userData?.lingue}
                conoscenze={userData?.conoscenze}
                professioni={userData?.professioni}
              />
            </div>
          </div>
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

