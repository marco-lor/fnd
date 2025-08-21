/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect } from "react";
import { doc, updateDoc, onSnapshot, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../../AuthContext";
import { FaDiceD20 } from 'react-icons/fa';
import DiceRoller from '../../common/DiceRoller';

const functions = getFunctions();
const spendCharacterPoint = httpsCallable(functions, "spendCharacterPoint");

// ---------------------------------------------------------------------------
//  Reusable Button - minimal circular ghost button
// ---------------------------------------------------------------------------
const StatButton = ({ onClick, disabled, children, className = "" }) => (
  <button
    onClick={(e) => { onClick(e); e.currentTarget.blur(); }}
    disabled={disabled}
    className={`
      inline-flex h-6 w-6 items-center justify-center rounded-full text-xs
      text-slate-300 hover:text-white transition
      ring-1 ring-inset ring-white/10 hover:ring-white/20 hover:bg-white/10 active:scale-95
      disabled:opacity-40 disabled:cursor-not-allowed
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
  // Anima dice faces by character level
  const [dadiAnimaByLevel, setDadiAnimaByLevel] = useState([]);
  // Roller state
  const [roller, setRoller] = useState({ visible: false, faces: 0, count: 1, modifier: 0, description: '' });
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

  // fetch anima dice config
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'utils', 'varie'));
        if (snap.exists()) setDadiAnimaByLevel(snap.data().dadiAnimaByLevel || []);
      } catch {}
    })();
  }, []);

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

  // Handle parameter dice roll: roll anima dice + modifier equal to param total
  const handleRollParam = (statName, total) => {
    const level = userData?.stats?.level;
    if (!level) return;
    const diceTypeStr = dadiAnimaByLevel[level - 1];
    if (!diceTypeStr) return;
    const faces = parseInt(diceTypeStr.replace(/^d/, ''), 10);
    if (isNaN(faces)) return;
    setRoller({ visible: true, faces, count: 1, modifier: total, description: `${statName} Roll` });
  };

  const renderTable = () => {
    if (!baseStats || !combStats || combatCosts === null) return <div className="text-center text-gray-400">Loading…</div>;
    const columns = ['Base','Anima','Equip','Mod','Tot'];
    const baseKeys = Object.keys(baseStats).sort();
    const combKeys = Object.keys(combStats).sort();

    return (
      <div className="rounded-2xl overflow-hidden bg-gradient-to-b from-slate-900/80 to-slate-800/60 backdrop-blur ring-1 ring-white/10">
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-slate-300">
            <span className="mr-2">Base</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
              <span className="opacity-75">Avail</span>
              <strong className="font-semibold">{basePointsAvailable}</strong>
            </span>
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-400/10 px-2 py-0.5 text-slate-300 ring-1 ring-inset ring-white/10">
              <span className="opacity-70">Spent</span>
              <strong className="font-semibold">{basePointsSpent}</strong>
            </span>
          </div>
          <div className="text-sm text-slate-300">
            <span className="mr-2">Combat</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-400/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30">
              <span className="opacity-75">Avail</span>
              <strong className="font-semibold">{combatTokensAvailable}</strong>
            </span>
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-400/10 px-2 py-0.5 text-slate-300 ring-1 ring-inset ring-white/10">
              <span className="opacity-70">Spent</span>
              <strong className="font-semibold">{combatTokensSpent}</strong>
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden">
          <table className="w-full text-sm text-left text-slate-300">
            <thead className="text-[11px] uppercase tracking-wider text-slate-400/80 bg-white/5">
              <tr>
                <th className="px-4 py-2 font-medium">Stat</th>
                {columns.map((c) => (
                  <th key={c} className="px-3 py-2 text-center font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-2 text-[11px] uppercase tracking-wider text-slate-400/70 bg-white/[0.03]">
                  Parametri Base
                </td>
              </tr>
              {baseKeys.map((name, i) => {
                const stat = baseStats[name];
                const val = Number(stat.Base) || 0;
                return (
                  <tr key={name} className="odd:bg-transparent even:bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                    <td className="px-4 py-2 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <FaDiceD20
                          className="cursor-pointer text-slate-400 hover:text-indigo-300 transition"
                          title={`Roll ${name}`}
                          onClick={() => handleRollParam(name, Number(stat.Tot) || 0)}
                        />
                        <span>{name}</span>
                      </div>
                    </td>
                    {columns.map((col) => {
                      const baseCell = "px-3 py-2 text-center";
                      if (col === 'Base')
                        return (
                          <td key={col} className={baseCell}>
                            {!lockBase ? (
                              <div className="flex items-center justify-center gap-1">
                                <StatButton onClick={() => handlePointChange(name, 'Base', -1)} disabled={val <= -1}>-</StatButton>
                                <span className="tabular-nums w-6 text-center">{stat.Base}</span>
                                <StatButton onClick={() => handlePointChange(name, 'Base', 1)} disabled={val >= 0 && basePointsAvailable <= 0}>+</StatButton>
                              </div>
                            ) : (
                              <span className="tabular-nums">{stat.Base}</span>
                            )}
                          </td>
                        );
                      if (col === 'Mod')
                        return (
                          <td key={col} className={baseCell}>
                            <div className="flex items-center justify-center gap-1">
                              <StatButton onClick={() => handleModChange(name, 'Base', -1)}>-</StatButton>
                              <span className="tabular-nums w-6 text-center">{stat.Mod}</span>
                              <StatButton onClick={() => handleModChange(name, 'Base', 1)}>+</StatButton>
                            </div>
                          </td>
                        );
                      if (col === 'Tot')
                        return (
                          <td key={col} className="px-3 py-2 text-center">
                            <span className="inline-flex min-w-[2.25rem] justify-center rounded-md bg-indigo-500/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 tabular-nums">
                              {stat[col] || 0}
                            </span>
                          </td>
                        );
                      return (
                        <td key={col} className={baseCell}>
                          <span className="tabular-nums">{stat[col] || 0}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-2 text-[11px] uppercase tracking-wider text-slate-400/70 bg-white/[0.03]">
                  Parametri Combattimento
                </td>
              </tr>
              {combKeys.map((name) => {
                const stat = combStats[name];
                const cost = combatCosts[name] || 0;
                const afford = combatTokensAvailable >= cost;
                return (
                  <tr key={name} className="odd:bg-transparent even:bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                    <td className="px-4 py-2 font-medium text-white" title={`Cost: ${cost}`}>
                      <div className="flex items-center gap-2">
                        <FaDiceD20
                          className="cursor-pointer text-slate-400 hover:text-indigo-300 transition"
                          title={`Roll ${name}`}
                          onClick={() => handleRollParam(name, Number(stat.Tot) || 0)}
                        />
                        <span>{name}</span>
                        <span className="ml-2 text-[10px] text-slate-400/70">Cost {cost}</span>
                      </div>
                    </td>
                    {columns.map((col) => {
                      const baseCell = "px-3 py-2 text-center";
                      if (col === 'Base')
                        return (
                          <td key={col} className={baseCell}>
                            {!lockCombat ? (
                              <div className="flex items-center justify-center gap-1">
                                <StatButton onClick={() => handlePointChange(name, 'Combat', -1)} disabled={Number(stat.Base) <= 0}>-</StatButton>
                                <span className="tabular-nums w-6 text-center">{stat.Base}</span>
                                <StatButton onClick={() => handlePointChange(name, 'Combat', 1)} disabled={!afford}>+</StatButton>
                              </div>
                            ) : (
                              <span className="tabular-nums">{stat.Base}</span>
                            )}
                          </td>
                        );
                      if (col === 'Mod')
                        return (
                          <td key={col} className={baseCell}>
                            <div className="flex items-center justify-center gap-1">
                              <StatButton onClick={() => handleModChange(name, 'Combat', -1)}>-</StatButton>
                              <span className="tabular-nums w-6 text-center">{stat.Mod}</span>
                              <StatButton onClick={() => handleModChange(name, 'Combat', 1)}>+</StatButton>
                            </div>
                          </td>
                        );
                      if (col === 'Tot')
                        return (
                          <td key={col} className="px-3 py-2 text-center">
                            <span className="inline-flex min-w-[2.25rem] justify-center rounded-md bg-indigo-500/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 tabular-nums">
                              {stat[col] || 0}
                            </span>
                          </td>
                        );
                      return (
                        <td key={col} className={baseCell}>
                          <span className="tabular-nums">{stat[col] || 0}</span>
                        </td>
                      );
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
    <>   
  {errorMsg && <div className="mb-2 text-red-400 text-sm">{errorMsg}</div>}
  {renderTable()}
      {/* Dice Roller Overlay */}
      {roller.visible && (
        <DiceRoller
          faces={roller.faces}
          count={roller.count}
          modifier={roller.modifier}
          description={roller.description}
          onComplete={(total) => {
            console.log(`${roller.description}: ${total}`);
            setRoller({ ...roller, visible: false });
          }}
        />
      )}
    </>
  );
}
