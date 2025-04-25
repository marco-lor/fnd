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
    onClick={onClick}
    disabled={disabled}
    className={`
      px-2 py-0.5 rounded text-sm font-medium transition-colors
      bg-gray-600 hover:bg-gray-500 text-white
      disabled:opacity-50 disabled:cursor-not-allowed
      focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500
      ${className}
    `}
  >
    {children}
  </button>
);

// ════════════════════════════════════════════════════════════════════════════
//  COMBAT  TABLE  – unchanged except small min/max tweaks
// ════════════════════════════════════════════════════════════════════════════
export function CombatStatsTable() {
  const { user, userData } = useAuth();
  const [combStats, setCombStats] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  const [combatTokensAvailable, setCombatTokensAvailable] = useState(0);
  const [combatTokensSpent, setCombatTokensSpent] = useState(0);
  const [lockParamCombat, setLockParamCombat] = useState(false);
  const [combatStatCosts, setCombatStatCosts] = useState(null);

  // -------------------------------------------------------------------------
  //  Load cost table once
  // -------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "utils", "varie"));
        const data = snap.exists() ? snap.data() : {};
        setCombatStatCosts(data?.cost_params_combat ?? {});
      } catch (err) {
        console.error("Error fetching combat costs", err);
        setCombatStatCosts({});
      }
    })();
  }, []);

  // -------------------------------------------------------------------------
  //  Initial data from AuthContext
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!userData) return;
    const { Parametri, stats, settings } = userData;
    if (Parametri?.Combattimento) setCombStats(Parametri.Combattimento);
    if (stats) {
      setCombatTokensAvailable(stats.combatTokensAvailable ?? 0);
      setCombatTokensSpent(stats.combatTokensSpent ?? 0);
    }
    if (settings) setLockParamCombat(settings.lock_param_combat || false);
  }, [userData]);

  // -------------------------------------------------------------------------
  //  Real-time listener
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.stats) {
        setCombatTokensAvailable(data.stats.combatTokensAvailable ?? 0);
        setCombatTokensSpent(data.stats.combatTokensSpent ?? 0);
      }
      if (data.settings)
        setLockParamCombat(data.settings.lock_param_combat || false);
      if (data.Parametri?.Combattimento)
        setCombStats(data.Parametri.Combattimento);
    });
  }, [user]);

  const triggerCooldown = () => {
    setCooldown(true);
    setTimeout(() => setCooldown(false), 500);
  };

  // -------------------------------------------------------------------------
  //  + / – handlers (unchanged)
  // -------------------------------------------------------------------------
  const handleCombIncrease = async (statName) => {
    if (
      cooldown ||
      lockParamCombat ||
      !user ||
      !combStats ||
      !combatStatCosts
    )
      return;

    const cost = Number(combatStatCosts[statName]);
    if (combatTokensAvailable < cost) return;

    triggerCooldown();
    try {
      await spendCharacterPoint({ statName, statType: "Combat", change: 1 });
    } catch (e) {
      console.error(e);
    }
  };

  const handleCombDecrease = async (statName) => {
    if (cooldown || lockParamCombat || !user || !combStats) return;
    const base = Number(combStats[statName]?.Base) || 0;
    if (base <= 0 || combatTokensSpent <= 0) return;

    triggerCooldown();
    try {
      await spendCharacterPoint({ statName, statType: "Combat", change: -1 });
    } catch (e) {
      console.error(e);
    }
  };

  const handleCombModChange = async (statName, delta) => {
    if (cooldown || !user || !combStats) return;
    triggerCooldown();
    const cur = Number(combStats[statName]?.Mod) || 0;
    try {
      await updateDoc(doc(db, "users", user.uid), {
        [`Parametri.Combattimento.${statName}.Mod`]: cur + delta,
      });
    } catch (e) {
      console.error(e);
    }
  };

  // -------------------------------------------------------------------------
  //  Render table (identical except minor extract for brevity)
  // -------------------------------------------------------------------------
  const renderTable = () => {
    if (!combStats || combatStatCosts === null)
      return <div className="text-center text-gray-400">Loading…</div>;

    const columns = ["Base", "Anima", "Equip", "Mod", "Tot"];
    const ordered = Object.keys(combStats).sort();

    return (
      <div className="bg-gray-800 shadow-lg rounded-lg overflow-hidden border border-gray-700">
        <div className="px-4 py-2 bg-gray-700 text-right text-sm text-gray-300 border-b border-gray-600">
          <span>
            Token Disponibili:{" "}
            <span className="font-semibold text-white">
              {combatTokensAvailable}
            </span>
          </span>
          <span className="mx-2">|</span>
          <span>
            Token Spesi:{" "}
            <span className="font-semibold text-white">
              {combatTokensSpent}
            </span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-700">
              <tr>
                <th className="px-4 py-3">Stat</th>
                {columns.map((c) => (
                  <th
                    key={c}
                    className={`px-4 py-3 text-center ${
                      c === "Tot"
                        ? "bg-blue-900/50 text-white font-semibold"
                        : ""
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map((name, i) => {
                const stat = combStats[name];
                const even = i % 2 === 0;
                const cost = combatStatCosts[name] ?? "N/A";
                const afford = combatTokensAvailable >= cost;
                const cellBase = Number(stat.Base) || 0;

                return (
                  <tr
                    key={name}
                    className={`${
                      even ? "bg-gray-800" : "bg-gray-900/50"
                    } border-b border-gray-700 last:border-b-0`}
                  >
                    <td
                      className="px-4 py-2 font-medium text-white"
                      title={`Costo: ${cost} Token`}
                    >
                      {name}
                    </td>

                    {columns.map((col) => {
                      const cellCls = `px-4 py-2 text-center ${
                        col === "Tot" ? "bg-blue-900/50 font-semibold" : ""
                      }`;

                      if (col === "Base") {
                        return (
                          <td key={col} className={cellCls}>
                            {!lockParamCombat ? (
                              <div className="flex items-center justify-center space-x-2">
                                <StatButton
                                  onClick={() => handleCombDecrease(name)}
                                  disabled={
                                    cooldown || cellBase <= 0 || combatTokensSpent <= 0
                                  }
                                >
                                  –
                                </StatButton>
                                <span className="font-mono min-w-[2ch] text-center">
                                  {stat.Base}
                                </span>
                                <StatButton
                                  onClick={() => handleCombIncrease(name)}
                                  disabled={
                                    cooldown || combatTokensAvailable <= 0 || !afford
                                  }
                                >
                                  +
                                </StatButton>
                              </div>
                            ) : (
                              <span className="font-mono">{stat.Base}</span>
                            )}
                          </td>
                        );
                      }

                      if (col === "Mod") {
                        return (
                          <td key={col} className={cellCls}>
                            <div className="flex items-center justify-center space-x-2">
                              <StatButton
                                onClick={() => handleCombModChange(name, -1)}
                                disabled={cooldown}
                              >
                                –
                              </StatButton>
                              <span className="font-mono min-w-[2ch] text-center">
                                {stat.Mod}
                              </span>
                              <StatButton
                                onClick={() => handleCombModChange(name, +1)}
                                disabled={cooldown}
                              >
                                +
                              </StatButton>
                            </div>
                          </td>
                        );
                      }

                      return <td key={col} className={cellCls}>{stat[col] || 0}</td>;
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
    <div className="bg-gray-900 p-4 rounded-xl shadow-md">
      <h2 className="mb-4 text-xl font-semibold text-white">Combat Stats</h2>
      {renderTable()}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  BASE  TABLE  – supports the “-1 / extra-points” rules
// ════════════════════════════════════════════════════════════════════════════
export function BaseStatsTable() {
  const { user, userData } = useAuth();
  const [baseStats, setBaseStats] = useState(null);
  const [cooldown, setCooldown] = useState(false);
  const [basePointsAvailable, setBasePointsAvailable] = useState(0);
  const [basePointsSpent, setBasePointsSpent] = useState(0);
  const [negativeBaseStatCount, setNegativeBaseStatCount] = useState(0);
  const [lockParamBase, setLockParamBase] = useState(false);

  // -------------------------------------------------------------------------
  //  Sync from AuthContext
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!userData) return;
    const { Parametri, stats, settings } = userData;
    if (Parametri?.Base) setBaseStats(Parametri.Base);
    if (stats) {
      setBasePointsAvailable(stats.basePointsAvailable ?? 0);
      setBasePointsSpent(stats.basePointsSpent ?? 0);
      setNegativeBaseStatCount(stats.negativeBaseStatCount ?? 0);
    }
    if (settings) setLockParamBase(settings.lock_param_base || false);
  }, [userData]);

  // -------------------------------------------------------------------------
  //  Real-time listener
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, "users", user.uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.Parametri?.Base) setBaseStats(data.Parametri.Base);
      if (data.stats) {
        setBasePointsAvailable(data.stats.basePointsAvailable ?? 0);
        setBasePointsSpent(data.stats.basePointsSpent ?? 0);
        setNegativeBaseStatCount(data.stats.negativeBaseStatCount ?? 0);
      }
      if (data.settings) setLockParamBase(data.settings.lock_param_base || false);
    });
  }, [user]);

  const triggerCooldown = () => {
    setCooldown(true);
    setTimeout(() => setCooldown(false), 500);
  };

  // -------------------------------------------------------------------------
  //  Helper: how many “free credits” the user currently has
  // -------------------------------------------------------------------------
  const negativeCredits = Math.floor(negativeBaseStatCount / 2);
  const MAX_NEGATIVE = 4;

  // -------------------------------------------------------------------------
  //  + / – handlers  (new logic)
  // -------------------------------------------------------------------------
  const handleIncrease = async (stat) => {
    if (cooldown || lockParamBase || !user || !baseStats) return;

    const cur = Number(baseStats[stat]?.Base) || 0;

    // IF the stat is currently -1 we can still increase *even if* available==0,
    // provided we still have at least one credit that will be consumed
    const needsToken =
      cur >= 0 || (cur === -1 && negativeCredits === 0 && basePointsAvailable <= 0);

    if (needsToken && basePointsAvailable <= 0) return;

    triggerCooldown();
    await spendCharacterPoint({ statName: stat, statType: "Base", change: 1 });
  };

  const handleDecrease = async (stat) => {
    if (cooldown || lockParamBase || !user || !baseStats) return;

    const cur = Number(baseStats[stat]?.Base) || 0;

    // Cannot go below -1
    if (cur <= -1) return;

    const creatingNewNegative = cur === 0;
    if (creatingNewNegative && negativeBaseStatCount >= MAX_NEGATIVE) return;

    // If we’re refunding a “normal” point (>0), we must actually have spent tokens
    if (cur > 0 && basePointsSpent <= 0) return;

    triggerCooldown();
    await spendCharacterPoint({ statName: stat, statType: "Base", change: -1 });
  };

  // -------------------------------------------------------------------------
  //  Mod column (unchanged)
  // -------------------------------------------------------------------------
  const handleModChange = async (stat, delta) => {
    if (cooldown || !user || !baseStats) return;
    triggerCooldown();
    const cur = Number(baseStats[stat]?.Mod) || 0;
    await updateDoc(doc(db, "users", user.uid), {
      [`Parametri.Base.${stat}.Mod`]: cur + delta,
    });
  };

  // -------------------------------------------------------------------------
  //  Render
  // -------------------------------------------------------------------------
  const renderTable = () => {
    if (!baseStats)
      return <div className="text-center text-gray-400">Loading…</div>;

    const columns = ["Base", "Anima", "Equip", "Mod", "Tot"];
    const ordered = Object.keys(baseStats).sort();

    return (
      <div className="bg-gray-800 shadow-lg rounded-lg overflow-hidden border border-gray-700">
        <div className="px-4 py-2 bg-gray-700 text-right text-sm text-gray-300 border-b border-gray-600">
          <span>
            Punti Disponibili: {" "}
            <span className="font-semibold text-white">
              {basePointsAvailable}
            </span>
          </span>
          <span className="mx-2">|</span>
          <span>
            Punti Spesi: {" "}
            <span className="font-semibold text-white">
              {basePointsSpent}
            </span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-700">
              <tr>
                <th className="px-4 py-3">Stat</th>
                {columns.map((c) => (
                  <th
                    key={c}
                    className={`px-4 py-3 text-center ${
                      c === "Tot"
                        ? "bg-green-900/50 text-white font-semibold"
                        : ""
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map((name, i) => {
                const stat = baseStats[name];
                const even = i % 2 === 0;
                const baseVal = Number(stat.Base) || 0;

                const cellCls = (col) =>
                  `px-4 py-2 text-center ${
                    col === "Tot" ? "bg-green-900/50 font-semibold" : ""
                  }`;

                return (
                  <tr
                    key={name}
                    className={`${
                      even ? "bg-gray-800" : "bg-gray-900/50"
                    } border-b border-gray-700 last:border-b-0`}
                  >
                    <td className="px-4 py-2 font-medium text-white">
                      {name}
                    </td>

                    {columns.map((col) => {
                      if (col === "Base") {
                        const disableMinus =
                          cooldown ||
                          baseVal <= -1 ||
                          (baseVal > 0 && basePointsSpent <= 0) ||
                          (baseVal === 0 &&
                            negativeBaseStatCount >= MAX_NEGATIVE);

                        const disablePlus =
                          cooldown ||
                          (baseVal === -1 &&
                            negativeCredits === 0 &&
                            basePointsAvailable <= 0) ||
                          (baseVal > -1 && basePointsAvailable <= 0);

                        return (
                          <td key={col} className={cellCls(col)}>
                            {!lockParamBase ? (
                              <div className="flex items-center justify-center space-x-2">
                                <StatButton
                                  onClick={() => handleDecrease(name)}
                                  disabled={disableMinus}
                                >
                                  –
                                </StatButton>
                                <span className="font-mono min-w-[2ch] text-center">
                                  {stat.Base}
                                </span>
                                <StatButton
                                  onClick={() => handleIncrease(name)}
                                  disabled={disablePlus}
                                >
                                  +
                                </StatButton>
                              </div>
                            ) : (
                              <span className="font-mono">{stat.Base}</span>
                            )}
                          </td>
                        );
                      }

                      if (col === "Mod") {
                        return (
                          <td key={col} className={cellCls(col)}>
                            <div className="flex items-center justify-center space-x-2">
                              <StatButton
                                onClick={() => handleModChange(name, -1)}
                                disabled={cooldown}
                              >
                                –
                              </StatButton>
                              <span className="font-mono min-w-[2ch] text-center">
                                {stat.Mod}
                              </span>
                              <StatButton
                                onClick={() => handleModChange(name, +1)}
                                disabled={cooldown}
                              >
                                +
                              </StatButton>
                            </div>
                          </td>
                        );
                      }

                      return (
                        <td key={col} className={cellCls(col)}>
                          {stat[col]}
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
    <div className="bg-gray-900 p-4 rounded-xl shadow-md mt-6">
      <h2 className="mb-4 text-xl font-semibold text-white">Base Stats</h2>
      {renderTable()}
    </div>
  );
}
