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
      <table className="w-full text-sm text-left text-gray-300 mb-6">
        <thead className="text-xs text-gray-400 uppercase bg-gray-700">
          <tr><th className="px-4 py-2">Stat</th>
            {['Base','Anima','Tot'].map(c => (
              <th key={c} className="px-4 py-2 text-center">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map(name => {
            const stat = stats[name];
            const base = Number(stat.Base) || 0;
            const anima = Number(stat.Anima) || 0;
            const tot = stat.Tot || base + anima;
            const cost = type === 'Combat' ? Number(costs[name]||0) : 1;
            const canPlus = available >= cost || (type==='Base' && base===-1 && negativeCredits>0);
            const canMinus = type==='Base' ? base> -1 : base>0;
            return (
              <tr key={name} className="border-b border-gray-700">
                <td className="px-4 py-2 font-medium text-white">{name}</td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => handleChange(name, -1, type)} disabled={!canMinus} className="px-1">-</button>
                  <span className="mx-2 font-mono">{base}</span>
                  <button onClick={() => handleChange(name, +1, type)} disabled={!canPlus} className="px-1">+</button>
                </td>
                <td className="px-4 py-2 text-center">{anima}</td>
                <td className="px-4 py-2 text-center font-semibold">{tot}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  // generic change router
  const handleChange = (stat, delta, type) => {
    if (type==='Base') return handleBaseChange(stat, delta);
    return handleCombChange(stat, delta);
  };

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold text-white">Points Distribution</h2>
      <div className="text-white mb-4">Base Points Available: {basePointsAvailable} | Spent: {basePointsSpent}</div>
      {renderTable(baseStats, {}, basePointsAvailable, basePointsSpent, 'Base')}
      <div className="text-white mb-4">Combat Tokens Available: {combatTokensAvailable} | Spent: {combatTokensSpent}</div>
      {renderTable(combStats, combatStatCosts||{}, combatTokensAvailable, combatTokensSpent, 'Combat')}
    </div>
  );
}
