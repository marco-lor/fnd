/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect } from "react";
import { doc, updateDoc, onSnapshot, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../../AuthContext";

const functions = getFunctions();
const spendCharacterPoint = httpsCallable(functions, "spendCharacterPoint");

// ---------------------------------------------------------------------------
//  Reusable Button
// ---------------------------------------------------------------------------
const StatButton = ({ onClick, disabled, children, className = "" }) => (
  <button
    onClick={(e) => { onClick(e); e.currentTarget.blur(); }}
    disabled={disabled}
    className={`
      text-gray-300 hover:text-white disabled:opacity-50
      ${disabled ? 'cursor-not-allowed' : ''}
      ${className}
    `}
  >
    {children}
  </button>
);

// --------------------------------------------------
// Merged stats table combining Base and Combat stats
// --------------------------------------------------
export function MergedStatsTable() {
  const { user, userData } = useAuth();
  const [baseStats, setBaseStats] = useState(null);
  const [combStats, setCombStats] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  const [basePointsAvailable, setBasePointsAvailable] = useState(0);
  const [basePointsSpent, setBasePointsSpent] = useState(0);
  const [negativeBaseCount, setNegativeBaseCount] = useState(0);
  const [combatTokensAvailable, setCombatTokensAvailable] = useState(0);
  const [combatTokensSpent, setCombatTokensSpent] = useState(0);
  const [lockBase, setLockBase] = useState(false);
  const [lockCombat, setLockCombat] = useState(false);
  const [combatCosts, setCombatCosts] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  // load initial data
  useEffect(() => {
    if (!userData) return;
    const { Parametri, stats, settings } = userData;
    if (Parametri?.Base) setBaseStats(Parametri.Base);
    if (Parametri?.Combattimento) setCombStats(Parametri.Combattimento);
    if (stats) {
      setBasePointsAvailable(stats.basePointsAvailable || 0);
      setBasePointsSpent(stats.basePointsSpent || 0);
      setNegativeBaseCount(stats.negativeBaseStatCount || 0);
      setCombatTokensAvailable(stats.combatTokensAvailable || 0);
      setCombatTokensSpent(stats.combatTokensSpent || 0);
    }
    if (settings) {
      setLockBase(settings.lock_param_base || false);
      setLockCombat(settings.lock_param_combat || false);
    }
  }, [userData]);

  // load combat cost table
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "utils", "varie"));
        setCombatCosts(snap.exists() ? snap.data().cost_params_combat : {});
      } catch {
        setCombatCosts({});
      }
    })();
  }, []);

  // real-time updates
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.Parametri?.Base) setBaseStats(data.Parametri.Base);
      if (data.Parametri?.Combattimento) setCombStats(data.Parametri.Combattimento);
      if (data.stats) {
        setBasePointsAvailable(data.stats.basePointsAvailable || 0);
        setBasePointsSpent(data.stats.basePointsSpent || 0);
        setNegativeBaseCount(data.stats.negativeBaseStatCount || 0);
        setCombatTokensAvailable(data.stats.combatTokensAvailable || 0);
        setCombatTokensSpent(data.stats.combatTokensSpent || 0);
      }
    });
  }, [user]);

  const triggerCooldown = () => {
    setCooldown(true);
    setTimeout(() => setCooldown(false), 500);
  };

  // handlers (similar to individual components)
  const handlePointChange = async (stat, type, change) => {
    if (cooldown || (type === 'Base' && lockBase) || (type === 'Combat' && lockCombat)) return;
    triggerCooldown();
    try {
      await spendCharacterPoint({ statName: stat, statType: type, change });
    } catch (err) {
      console.error(err);
      const msg = err.message?.includes('Not enough ability points')
        ? 'Not enough ability points.'
        : 'Error updating stat.';
      setErrorMsg(msg);
      // clear after 3 seconds
      setTimeout(() => setErrorMsg(''), 3000);
    }
  };
  const handleModChange = async (stat, type, delta) => {
    if (cooldown) return;
    triggerCooldown();
    const key = type === 'Base' ? 'Parametri.Base' : 'Parametri.Combattimento';
    const cur = Number((type === 'Base' ? baseStats : combStats)[stat]?.Mod) || 0;
    await updateDoc(doc(db, "users", user.uid), { [`${key}.${stat}.Mod`]: cur + delta });
  };

  const renderTable = () => {
    if (!baseStats || !combStats || combatCosts === null) return <div className="text-center text-gray-400">Loading…</div>;
    const columns = ['Base','Anima','Equip','Mod','Tot'];
    const baseKeys = Object.keys(baseStats).sort();
    const combKeys = Object.keys(combStats).sort();

    return (
      <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
        <div className="px-4 py-2 bg-gray-700 text-sm text-gray-300 flex justify-between">
          <span>Base: {basePointsAvailable} spent {basePointsSpent}</span>
          <span>Combat: {combatTokensAvailable} spent {combatTokensSpent}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-auto w-auto mx-auto text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-700">
              <tr>
                <th className="px-3 py-2">Stat</th>
                {columns.map(c => (
                  <th
                    key={c}
                    className={`px-3 py-2 text-center ${c === 'Tot' ? 'bg-blue-900/50 text-white font-semibold' : ''}`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={columns.length+1} className="px-3 py-1 bg-gray-700 text-xs text-gray-400">Base Stats</td></tr>
              {baseKeys.map((name,i) => {
                const stat = baseStats[name]; const even = i%2===0;
                const val = Number(stat.Base)||0;
                return (
                  <tr key={name} className={even?"bg-gray-800":"bg-gray-900/50"}>
                    <td className="px-3 py-2 font-medium text-white">{name}</td>
                    {columns.map(col => {
                      // Highlight Tot column
                      const cellCls = `px-3 py-2 text-center ${col === 'Tot' ? 'bg-blue-900/50 font-semibold text-white' : ''}`;
                      if (col === 'Base') return <td key={col} className={cellCls}><div className="flex justify-center space-x-1"><StatButton onClick={()=>handlePointChange(name,'Base',-1)} disabled={val<=-1}>–</StatButton><span>{stat.Base}</span><StatButton onClick={()=>handlePointChange(name,'Base',1)} disabled={val>=0&&basePointsAvailable<=0}>+</StatButton></div></td>;
                      if (col === 'Mod') return <td key={col} className={cellCls}><div className="flex justify-center space-x-1"><StatButton onClick={()=>handleModChange(name,'Base',-1)}>-</StatButton><span>{stat.Mod}</span><StatButton onClick={()=>handleModChange(name,'Base',1)}>+</StatButton></div></td>;
                      return <td key={col} className={cellCls}>{stat[col]||0}</td>;
                    })}
                  </tr>
                );
              })}
              <tr><td colSpan={columns.length+1} className="px-3 py-1 bg-gray-700 text-xs text-gray-400">Combat Stats</td></tr>
              {combKeys.map((name,i) => {
                const stat = combStats[name]; const even=(i%2===0);
                const cost = combatCosts[name]||0; const afford=combatTokensAvailable>=cost;
                return (
                  <tr key={name} className={even?"bg-gray-800":"bg-gray-900/50"}>
                    <td className="px-3 py-2 font-medium text-white" title={`Cost: ${cost}`}>{name}</td>
                    {columns.map(col=>{
                      // Highlight Tot column
                      const cellCls = `px-3 py-2 text-center ${col === 'Tot' ? 'bg-blue-900/50 font-semibold text-white' : ''}`;
                      if(col==='Base') return <td key={col} className={cellCls}>{!lockCombat?<div className="flex justify-center space-x-1"><StatButton onClick={()=>handlePointChange(name,'Combat',-1)} disabled={Number(stat.Base)<=0}>–</StatButton><span>{stat.Base}</span><StatButton onClick={()=>handlePointChange(name,'Combat',1)} disabled={!afford}>+</StatButton></div>:<span>{stat.Base}</span>}</td>;
                      if(col==='Mod') return <td key={col} className={cellCls}><div className="flex justify-center space-x-1"><StatButton onClick={()=>handleModChange(name,'Combat',-1)}>-</StatButton><span>{stat.Mod}</span><StatButton onClick={()=>handleModChange(name,'Combat',1)}>+</StatButton></div></td>;
                      return <td key={col} className={cellCls}>{stat[col]||0}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
  <div className="p-4 bg-gray-900 rounded-xl shadow-md w-auto inline-block">
    <h2 className="mb-3 text-lg font-semibold text-white">Stats Overview</h2>
    {errorMsg && <div className="mb-2 text-red-400 text-sm">{errorMsg}</div>}
    <div className="w-auto inline-block">
      {renderTable()}
    </div>
  </div>
  );
}
