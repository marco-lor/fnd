import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from "../../firebaseConfig";
import { useAuth } from '../../../AuthContext';

const functions = getFunctions();
const spendCharacterPoint = httpsCallable(functions, 'spendCharacterPoint');

export default function PointsDistribution() {
  const { user, userData } = useAuth();

  // Base stats state
  const [baseStats, setBaseStats] = useState(null);
  const [basePointsAvailable, setBasePointsAvailable] = useState(0);
  const [basePointsSpent, setBasePointsSpent] = useState(0);
  const [negativeBaseStatCount, setNegativeBaseStatCount] = useState(0);

  // Combat stats state
  const [combStats, setCombStats] = useState(null);
  const [combatTokensAvailable, setCombatTokensAvailable] = useState(0);
  const [combatTokensSpent, setCombatTokensSpent] = useState(0);
  const [combatStatCosts, setCombatStatCosts] = useState(null);

  // Load combat cost table
  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, 'utils', 'varie'));
      const data = snap.exists() ? snap.data() : {};
      setCombatStatCosts(data.cost_params_combat || {});
    })();
  }, []);

  // Sync initial from context
  useEffect(() => {
    if (!userData) return;
    const { Parametri, stats } = userData;
    setBaseStats(Parametri?.Base || null);
    setCombStats(Parametri?.Combattimento || null);
    setBasePointsAvailable(stats.basePointsAvailable || 0);
    setBasePointsSpent(stats.basePointsSpent || 0);
    setNegativeBaseStatCount(stats.negativeBaseStatCount || 0);
    setCombatTokensAvailable(stats.combatTokensAvailable || 0);
    setCombatTokensSpent(stats.combatTokensSpent || 0);
  }, [userData]);

  // Real-time updates
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'users', user.uid), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      setBasePointsAvailable(d.stats?.basePointsAvailable || 0);
      setBasePointsSpent(d.stats?.basePointsSpent || 0);
      setNegativeBaseStatCount(d.stats?.negativeBaseStatCount || 0);
      setCombatTokensAvailable(d.stats?.combatTokensAvailable || 0);
      setCombatTokensSpent(d.stats?.combatTokensSpent || 0);
      setBaseStats(d.Parametri?.Base || null);
      setCombStats(d.Parametri?.Combattimento || null);
    });
  }, [user]);

  const triggerCooldown = () => {
    // noop here if needed
  };

  // Base handlers
  const handleBaseChange = async (stat, delta) => {
    if (!user || !baseStats) return;
    await spendCharacterPoint({ statName: stat, statType: 'Base', change: delta });
  };

  // Combat handlers
  const handleCombChange = async (stat, delta) => {
    if (!user || !combStats) return;
    await spendCharacterPoint({ statName: stat, statType: 'Combat', change: delta });
  };

  // Helper free credits
  const negativeCredits = Math.floor(negativeBaseStatCount / 2);

  // Render table helper
  const renderTable = (stats, costs, available, spent, type) => {
    if (!stats) return null;
    const ordered = Object.keys(stats).sort();
    return (
      <div className="bg-[rgba(40,40,60,0.95)] rounded-lg overflow-hidden border border-[rgba(100,100,150,0.3)]">
        <table className="w-full text-sm text-left text-gray-300">
          <thead className="text-xs text-gray-400 uppercase bg-[rgba(60,60,80,0.95)]">
            <tr>
              <th className="px-4 py-3">Stat</th>
              {['Base','Anima','Tot'].map(c => (
                <th
                  key={c}
                  className={`px-4 py-3 text-center ${c === 'Tot' ? 'text-yellow-300' : ''}`}
                >
                  {c}
                </th>
              ))}
              {type === 'Combat' && (
                <th className="px-4 py-3 text-center">Cost</th>
              )}
            </tr>
          </thead>
          <tbody>
            {ordered.map(name => {
              const stat = stats[name];
              const base = Number(stat.Base) || 0;
              const anima = Number(stat.Anima) || 0;
              const tot = stat.Tot || base + anima;
              const cost = Number(costs[name] || 0);
              const canPlus = available >= (type === 'Combat' ? cost : 1) || (type === 'Base' && base === -1 && negativeCredits > 0);
              const canMinus = type === 'Base' ? base > -1 : base > 0;
              return (
                <tr key={name} className="border-b border-gray-700 hover:bg-[rgba(60,60,90,0.4)]">
                  <td className="px-4 py-3 font-medium text-white">{name}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center space-x-2">
                      <button onClick={() => handleChange(name, -1, type)} disabled={!canMinus} className={`text-gray-300 hover:text-white disabled:opacity-50 ${!canMinus ? 'cursor-not-allowed' : ''}`}>
                        -
                      </button>
                      <span className="mx-2 font-mono w-6 text-center">{base}</span>
                      <button onClick={() => handleChange(name, +1, type)} disabled={!canPlus} className={`text-gray-300 hover:text-white disabled:opacity-50 ${!canPlus ? 'cursor-not-allowed' : ''}`}>
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">{anima}</td>
                  <td className="px-4 py-3 text-center font-semibold text-yellow-300">{tot}</td>
                  {type === 'Combat' && (
                    <td className="px-4 py-3 text-center">{cost}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // generic change router
  const handleChange = (stat, delta, type) => {
    if (type==='Base') return handleBaseChange(stat, delta);
    return handleCombChange(stat, delta);
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-[#D4AF37] mb-4" style={{ textShadow: "0 0 8px rgba(255,215,0,0.4)" }}>Points Distribution</h2>
      
      <div className="flex flex-col md:flex-row md:gap-6">
        <div className="flex-1 mb-6 md:mb-0">
          <div className="bg-[rgba(40,40,60,0.8)] p-3 rounded-lg mb-3 text-center">
            <div className="text-white text-lg">
              <span className="text-[#D4AF37] font-semibold">Base Points</span>
              <div className="flex justify-center mt-1 text-sm space-x-4">
                <span>Available: <span className="font-bold">{basePointsAvailable}</span></span> 
                <span>|</span> 
                <span>Spent: <span className="font-bold">{basePointsSpent}</span></span>
              </div>
            </div>
          </div>
          {renderTable(baseStats, {}, basePointsAvailable, basePointsSpent, 'Base')}
        </div>
        
        <div className="flex-1">
          <div className="bg-[rgba(40,40,60,0.8)] p-3 rounded-lg mb-3 text-center">
            <div className="text-white text-lg">
              <span className="text-[#D4AF37] font-semibold">Combat Tokens</span>
              <div className="flex justify-center mt-1 text-sm space-x-4">
                <span>Available: <span className="font-bold">{combatTokensAvailable}</span></span> 
                <span>|</span> 
                <span>Spent: <span className="font-bold">{combatTokensSpent}</span></span>
              </div>
            </div>
          </div>
          {renderTable(combStats, combatStatCosts||{}, combatTokensAvailable, combatTokensSpent, 'Combat')}
        </div>
      </div>
    </div>
  );
}
