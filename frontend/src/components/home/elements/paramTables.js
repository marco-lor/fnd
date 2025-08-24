/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef } from "react";
import { doc, updateDoc, onSnapshot, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../../AuthContext";
import { FaDiceD20 } from 'react-icons/fa';
import DiceRoller from '../../common/DiceRoller';

const functions = getFunctions();
const spendCharacterPoint = httpsCallable(functions, "spendCharacterPoint");

const StatButton = ({ onClick, disabled, children, className = "" }) => (
  <button
    onClick={(e) => { onClick(e); e.currentTarget.blur(); }}
    disabled={disabled}
    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs text-slate-300 hover:text-white transition ring-1 ring-inset ring-white/10 hover:ring-white/20 hover:bg-white/10 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
  >
    {children}
  </button>
);

export function MergedStatsTable() {
  const { user, userData } = useAuth();
  const [dadiAnimaByLevel, setDadiAnimaByLevel] = useState([]);
  const [roller, setRoller] = useState({ visible: false, faces: 0, count: 1, modifier: 0, description: '' });
  const [baseStats, setBaseStats] = useState(null);
  const [combStats, setCombStats] = useState(null);
  const [specialStats, setSpecialStats] = useState(null);
  const [specialSchemaKeys, setSpecialSchemaKeys] = useState([]);
  const [cooldown, setCooldown] = useState(false);
  const [basePointsAvailable, setBasePointsAvailable] = useState(0);
  const [basePointsSpent, setBasePointsSpent] = useState(0);
  const [combatTokensAvailable, setCombatTokensAvailable] = useState(0);
  const [combatTokensSpent, setCombatTokensSpent] = useState(0);
  const [lockBase, setLockBase] = useState(false);
  const [lockCombat, setLockCombat] = useState(false);
  const [combatCosts, setCombatCosts] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  // UI: collapse/expand Parametri Speciali table
  const [showSpecial, setShowSpecial] = useState(true);
  const specialRef = useRef(null);
  const didMountRef = useRef(false);

  // Animate expand/collapse for Parametri Speciali
  useEffect(() => {
    const el = specialRef.current;
    if (!el) return;

    const onEnd = (e) => {
      if (e.propertyName !== 'max-height') return;
      // After expanding, remove max-height to allow natural growth
      if (showSpecial) {
        el.style.maxHeight = 'none';
      }
    };
    el.addEventListener('transitionend', onEnd);

    // Ensure will animate from current state
    const run = () => {
      el.style.overflow = 'hidden';
      el.style.willChange = 'max-height, opacity';
      el.style.transition = 'max-height 300ms ease, opacity 200ms ease';

      // First paint: set immediate styles without animation
      if (!didMountRef.current) {
        if (showSpecial) {
          el.style.maxHeight = 'none';
          el.style.opacity = '1';
          el.style.display = 'block';
        } else {
          el.style.maxHeight = '0px';
          el.style.opacity = '0';
          el.style.display = 'block';
        }
        didMountRef.current = true;
        return;
      }

      if (showSpecial) {
        // Start from 0 and expand to scrollHeight
        el.style.display = 'block';
        const target = el.scrollHeight;
        el.style.maxHeight = '0px';
        el.style.opacity = '0';
        // Force reflow then animate
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;
        el.style.maxHeight = `${target}px`;
        el.style.opacity = '1';
      } else {
        // Collapse from current height to 0
        const current = el.scrollHeight;
        el.style.maxHeight = `${current}px`;
        el.style.opacity = '1';
        // Force reflow then animate
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;
        el.style.maxHeight = '0px';
        el.style.opacity = '0';
      }
    };

    run();

    return () => {
      el.removeEventListener('transitionend', onEnd);
    };
  }, [showSpecial]);

  useEffect(() => {
    if (!userData) return;
    const { Parametri, stats, settings } = userData;
    if (Parametri?.Base) setBaseStats(Parametri.Base);
    if (Parametri?.Combattimento) setCombStats(Parametri.Combattimento);
    if (Parametri?.Special) setSpecialStats(Parametri.Special);
    if (stats) {
      setBasePointsAvailable(stats.basePointsAvailable || 0);
      setBasePointsSpent(stats.basePointsSpent || 0);
      setCombatTokensAvailable(stats.combatTokensAvailable || 0);
      setCombatTokensSpent(stats.combatTokensSpent || 0);
    }
    if (settings) {
      setLockBase(settings.lock_param_base || false);
      setLockCombat(settings.lock_param_combat || false);
    }
  }, [userData]);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'utils', 'varie'));
        if (snap.exists()) setDadiAnimaByLevel(snap.data().dadiAnimaByLevel || []);
      } catch {}
    })();
  }, []);

  // Load Special parameter keys from all item schemas so we can always show full list
  useEffect(() => {
    (async () => {
      try {
        const ids = ['schema_weapon','schema_armatura','schema_accessorio','schema_consumabile'];
        const docs = await Promise.all(ids.map(id => getDoc(doc(db, 'utils', id))));
        const allKeys = new Set();
        docs.forEach(snap => {
          if (!snap.exists()) return;
          const data = snap.data();
          const keys = Object.keys(data?.Parametri?.Special || {});
          keys.forEach(k => allKeys.add(k));
        });
        setSpecialSchemaKeys(Array.from(allKeys).sort());
      } catch (e) {
        console.warn('Unable to load Special schema keys:', e?.message || e);
        setSpecialSchemaKeys([]);
      }
    })();
  }, []);

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

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.Parametri?.Base) setBaseStats(data.Parametri.Base);
      if (data.Parametri?.Combattimento) setCombStats(data.Parametri.Combattimento);
      if (data.Parametri?.Special) setSpecialStats(data.Parametri.Special);
      if (data.stats) {
        setBasePointsAvailable(data.stats.basePointsAvailable || 0);
        setBasePointsSpent(data.stats.basePointsSpent || 0);
        setCombatTokensAvailable(data.stats.combatTokensAvailable || 0);
        setCombatTokensSpent(data.stats.combatTokensSpent || 0);
      }
    });
  }, [user]);

  const triggerCooldown = () => {
    setCooldown(true);
    setTimeout(() => setCooldown(false), 500);
  };

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
      setTimeout(() => setErrorMsg(''), 3000);
    }
  };

  const handleModChange = async (stat, type, delta) => {
    if (cooldown) return;
    triggerCooldown();
    const key = type === 'Base' ? 'Parametri.Base' : type === 'Combat' ? 'Parametri.Combattimento' : 'Parametri.Special';
    const curSource = type === 'Base' ? baseStats : type === 'Combat' ? combStats : specialStats;
    const cur = Number(curSource?.[stat]?.Mod) || 0;
    await updateDoc(doc(db, "users", user.uid), { [`${key}.${stat}.Mod`]: cur + delta });
  };

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
  const columnsSpecial = ['Equip','Mod','Tot'];
  const baseKeys = Object.keys(baseStats).sort();
  const combKeys = Object.keys(combStats).sort();
  const specialKeys = Array.from(new Set([...(specialSchemaKeys || []), ...Object.keys(specialStats || {})])).sort();

    return (
      <>
        <div className="rounded-2xl overflow-hidden bg-gradient-to-b from-slate-900/80 to-slate-800/60 backdrop-blur ring-1 ring-white/10">
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
          <div className="overflow-hidden">
            <table className="w-full text-sm text-left text-slate-300">
              <thead className="text-[11px] uppercase tracking-wider text-slate-400/80 bg-white/5">
                <tr>
                  <th className="px-4 py-2 font-medium">Stat</th>
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-center font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <tr>
                  <td colSpan={columns.length + 1} className="px-4 py-2 text-[11px] uppercase tracking-wider text-slate-400/70 bg-white/[0.03]">Parametri Base</td>
                </tr>
                {baseKeys.map((name) => {
                  const stat = baseStats[name];
                  const val = Number(stat.Base) || 0;
                  return (
                    <tr key={name} className="odd:bg-transparent even:bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                      <td className="px-4 py-2 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <FaDiceD20 className="cursor-pointer text-slate-400 hover:text-indigo-300 transition" title={`Roll ${name}`} onClick={() => handleRollParam(name, Number(stat.Tot) || 0)} />
                          <span>{name}</span>
                        </div>
                      </td>
                      {columns.map((col) => {
                        const baseCell = "px-3 py-2 text-center";
                        if (col === 'Base') {
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
                        }
                        if (col === 'Mod') {
                          return (
                            <td key={col} className={baseCell}>
                              <div className="flex items-center justify-center gap-1">
                                <StatButton onClick={() => handleModChange(name, 'Base', -1)}>-</StatButton>
                                <span className="tabular-nums w-6 text-center">{stat.Mod}</span>
                                <StatButton onClick={() => handleModChange(name, 'Base', 1)}>+</StatButton>
                              </div>
                            </td>
                          );
                        }
                        if (col === 'Tot') {
                          return (
                            <td key={col} className="px-3 py-2 text-center">
                              <span className="inline-flex min-w-[2.25rem] justify-center rounded-md bg-indigo-500/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 tabular-nums">{stat[col] || 0}</span>
                            </td>
                          );
                        }
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
                  <td colSpan={columns.length + 1} className="px-4 py-2 text-[11px] uppercase tracking-wider text-slate-400/70 bg-white/[0.03]">Parametri Combattimento</td>
                </tr>
                {combKeys.map((name) => {
                  const stat = combStats[name];
                  const cost = combatCosts[name] || 0;
                  const afford = combatTokensAvailable >= cost;
                  return (
                    <tr key={name} className="odd:bg-transparent even:bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                      <td className="px-4 py-2 font-medium text-white" title={`Cost: ${cost}`}>
                        <div className="flex items-center gap-2">
                          <FaDiceD20 className="cursor-pointer text-slate-400 hover:text-indigo-300 transition" title={`Roll ${name}`} onClick={() => handleRollParam(name, Number(stat.Tot) || 0)} />
                          <span>{name}</span>
                          <span className="ml-2 text-[10px] text-slate-400/70">Cost {cost}</span>
                        </div>
                      </td>
                      {columns.map((col) => {
                        const baseCell = "px-3 py-2 text-center";
                        if (col === 'Base') {
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
                        }
                        if (col === 'Mod') {
                          return (
                            <td key={col} className={baseCell}>
                              <div className="flex items-center justify-center gap-1">
                                <StatButton onClick={() => handleModChange(name, 'Combat', -1)}>-</StatButton>
                                <span className="tabular-nums w-6 text-center">{stat.Mod}</span>
                                <StatButton onClick={() => handleModChange(name, 'Combat', 1)}>+</StatButton>
                              </div>
                            </td>
                          );
                        }
                        if (col === 'Tot') {
                          return (
                            <td key={col} className="px-3 py-2 text-center">
                              <span className="inline-flex min-w-[2.25rem] justify-center rounded-md bg-indigo-500/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 tabular-nums">{stat[col] || 0}</span>
                            </td>
                          );
                        }
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

        <div className="mt-4 rounded-2xl overflow-hidden bg-gradient-to-b from-slate-900/80 to-slate-800/60 backdrop-blur ring-1 ring-white/10">
          <div className="px-4 py-3 text-sm text-slate-300 flex items-center justify-between">
            <span>Parametri Speciali</span>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs text-slate-300 hover:text-white transition ring-1 ring-inset ring-white/10 hover:ring-white/20 hover:bg-white/10 active:scale-95"
              aria-expanded={showSpecial}
              aria-label={showSpecial ? 'Collapse Parametri Speciali' : 'Expand Parametri Speciali'}
              onClick={() => setShowSpecial((v) => !v)}
            >
              {showSpecial ? '−' : '+'}
            </button>
          </div>
          <div
            ref={specialRef}
            className="overflow-hidden"
            aria-hidden={!showSpecial}
          >
            <table className="w-full text-sm text-left text-slate-300">
              <thead className="text-[11px] uppercase tracking-wider text-slate-400/80 bg-white/5">
                <tr>
                  <th className="px-4 py-2 font-medium">Stat</th>
                  {columnsSpecial.map((c) => (
                    <th key={c} className="px-3 py-2 text-center font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {specialKeys.map((name) => {
                  const stat = specialStats?.[name] || {};
                  return (
                    <tr key={name} className="odd:bg-transparent even:bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                      <td className="px-4 py-2 font-medium text-white">
                        <div className="flex items-center gap-2">
                          <span>{name}</span>
                        </div>
                      </td>
                      {columnsSpecial.map((col) => {
                        const baseCell = "px-3 py-2 text-center";
                        if (col === 'Mod') {
                          return (
                            <td key={col} className={baseCell}>
                              <div className="flex items-center justify-center gap-1">
                                <StatButton onClick={() => handleModChange(name, 'Special', -1)}>-</StatButton>
                                <span className="tabular-nums w-6 text-center">{stat.Mod || 0}</span>
                                <StatButton onClick={() => handleModChange(name, 'Special', 1)}>+</StatButton>
                              </div>
                            </td>
                          );
                        }
                        if (col === 'Tot') {
                          return (
                            <td key={col} className="px-3 py-2 text-center">
                              <span className="inline-flex min-w-[2.25rem] justify-center rounded-md bg-indigo-500/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 tabular-nums">{stat[col] || 0}</span>
                            </td>
                          );
                        }
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
      </>
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
