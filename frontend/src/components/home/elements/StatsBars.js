// file: ./frontend/src/components/home/elements/StatsBars.js
import React, { useEffect, useState, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { AuthContext } from '../../../AuthContext';
import { FaAngleRight, FaAngleLeft, FaAnglesRight, FaAnglesLeft } from 'react-icons/fa6';
import { FaRedo } from 'react-icons/fa';
import { GiHearts, GiMagicSwirl } from 'react-icons/gi';

const StatsBars = () => {
  const { user } = useContext(AuthContext);
  const [userData, setUserData] = useState(null);
  // State for custom input modal
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customInputValue, setCustomInputValue] = useState('');
  const [customAction, setCustomAction] = useState(null);
  const [customFeedbackMessage, setCustomFeedbackMessage] = useState('');

  // Refs for long-press intervals.
  const hpIntervalRef = useRef(null);
  const manaIntervalRef = useRef(null);

  useEffect(() => {
    let unsubscribeSnapshot = null;
    if (user) {
      const userRef = doc(db, "users", user.uid);
      unsubscribeSnapshot = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            setUserData(docSnap.data());
          }
        },
        (error) => {
          console.error("Error in snapshot listener:", error);
        }
      );
    }
    return () => {
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
      }
    };
  }, [user]);

  // --- HP adjustment functions ---
  const handleResetHP = async () => {
    if (user && userData?.stats) {
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.hpCurrent": userData.stats.hpTotal });
      } catch (error) {
        console.error("Error resetting HP:", error);
      }
    }
  };

  const handleDecrementHP = async () => {
    if (user && userData?.stats) {
      const newHP = (userData.stats.hpCurrent || 0) - 1;
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.hpCurrent": newHP });
      } catch (error) {
        console.error("Error decrementing HP:", error);
      }
    }
  };

  const handleIncrementHP = async () => {
    if (user && userData?.stats) {
      const newHP = (userData.stats.hpCurrent || 0) + 1;
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.hpCurrent": newHP });
      } catch (error) {
        console.error("Error incrementing HP:", error);
      }
    }
  };

  const handleDecrementHPStart = () => {
    handleDecrementHP();
    hpIntervalRef.current = setInterval(handleDecrementHP, 200);
  };

  const handleDecrementHPEnd = () => {
    if (hpIntervalRef.current) {
      clearInterval(hpIntervalRef.current);
      hpIntervalRef.current = null;
    }
  };

  const handleIncrementHPStart = () => {
    handleIncrementHP();
    hpIntervalRef.current = setInterval(handleIncrementHP, 200);
  };

  const handleIncrementHPEnd = () => {
    if (hpIntervalRef.current) {
      clearInterval(hpIntervalRef.current);
      hpIntervalRef.current = null;
    }
  };

  const openCustomInput = (action) => {
    setCustomAction(action);
    setCustomInputValue('');
    setCustomFeedbackMessage('');
    setShowCustomInput(true);
  };

  const closeCustomInput = () => {
    setShowCustomInput(false);
    setCustomAction(null);
  };

  // Determine Italian prompt message for custom input
  const promptMessage = customAction?.includes('decrement')
    ? 'Inserisci il valore da sottrarre'
    : 'Inserisci il valore da aggiungere';

  const handleCustomSubmit = async () => {
    const delta = parseInt(customInputValue, 10);
    if (!isNaN(delta) && user && userData?.stats) {
      const userRef = doc(db, "users", user.uid);
      let field, newValue, actualDelta = delta;
      if (customAction === 'hp-decrement') {
        field = 'stats.hpCurrent';
        const current = userData.stats.hpCurrent || 0;
        if (delta > current) {
          actualDelta = current;
          newValue = 0;
        } else {
          newValue = current - delta;
        }
      } else if (customAction === 'hp-increment') {
        field = 'stats.hpCurrent';
        newValue = (userData.stats.hpCurrent || 0) + delta;
      } else if (customAction === 'mana-decrement') {
        field = 'stats.manaCurrent';
        const current = userData.stats.manaCurrent || 0;
        if (delta > current) {
          actualDelta = current;
          newValue = 0;
        } else {
          newValue = current - delta;
        }
      } else if (customAction === 'mana-increment') {
        field = 'stats.manaCurrent';
        newValue = (userData.stats.manaCurrent || 0) + delta;
      }
      try {
        await updateDoc(userRef, { [field]: newValue });
        if ((customAction === 'hp-decrement' || customAction === 'mana-decrement') && actualDelta !== delta) {
          const msg = `Solo ${actualDelta} punti sono stati sottratti; ${delta} superavano il valore attuale. Valore portato a 0.`;
          setCustomFeedbackMessage(msg);
          return;
        }
        closeCustomInput();
      } catch (error) {
        console.error(`Error custom ${customAction}:`, error);
      }
    }
  };

  // --- Mana adjustment functions ---
  const handleResetMana = async () => {
    if (user && userData?.stats) {
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.manaCurrent": userData.stats.manaTotal });
      } catch (error) {
        console.error("Error resetting Mana:", error);
      }
    }
  };

  const handleDecrementMana = async () => {
    if (user && userData?.stats) {
      const newMana = (userData.stats.manaCurrent || 0) - 1;
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.manaCurrent": newMana });
      } catch (error) {
        console.error("Error decrementing Mana:", error);
      }
    }
  };

  const handleIncrementMana = async () => {
    if (user && userData?.stats) {
      const newMana = (userData.stats.manaCurrent || 0) + 1;
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.manaCurrent": newMana });
      } catch (error) {
        console.error("Error incrementing Mana:", error);
      }
    }
  };

  const handleDecrementManaStart = () => {
    handleDecrementMana();
    manaIntervalRef.current = setInterval(handleDecrementMana, 200);
  };

  const handleDecrementManaEnd = () => {
    if (manaIntervalRef.current) {
      clearInterval(manaIntervalRef.current);
      manaIntervalRef.current = null;
    }
  };

  const handleIncrementManaStart = () => {
    handleIncrementMana();
    manaIntervalRef.current = setInterval(handleIncrementMana, 200);
  };

  const handleIncrementManaEnd = () => {
    if (manaIntervalRef.current) {
      clearInterval(manaIntervalRef.current);
      manaIntervalRef.current = null;
    }
  };

  // Small reusable stat row
  const StatRow = ({
    label,
    icon: Icon,
    colorTrack,
    colorFill,
    current,
    total,
    onReset,
    onDecStart,
    onDecEnd,
    onIncStart,
    onIncEnd,
    onOpenDec,
    onOpenInc,
  }) => {
    const pct = total ? Math.max(0, (current / total) * 100) : 0;
    const overflowPct = total && current > total ? ((current - total) / total) * 100 : 0;
    return (
      <div className="flex items-center gap-2 w-full">
        <div className="flex items-center gap-2 w-28">
          <div className="relative inline-flex items-center justify-center h-8 w-8 rounded-xl border border-slate-600/60 bg-slate-800/50 text-slate-300">
            <Icon className="w-4 h-4" />
          </div>
          <span className="text-sm font-medium text-slate-200">{label}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-1">
          <button
            onClick={onReset}
            className="relative inline-flex items-center justify-center h-7 w-7 rounded-xl bg-gradient-to-br from-emerald-600 to-green-600 text-white shadow-sm hover:scale-105 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
            title={`Reset ${label}`}
          >
            <FaRedo className="w-3.5 h-3.5" />
          </button>
          <button
            onMouseDown={onDecStart}
            onMouseUp={onDecEnd}
            onMouseLeave={onDecEnd}
            onTouchStart={onDecStart}
            onTouchEnd={onDecEnd}
            className="inline-flex items-center justify-center h-7 w-7 rounded-xl border border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70 hover:text-white"
            title={`-1 ${label}`}
          >
            <FaAngleLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenDec}
            className="inline-flex items-center justify-center h-7 w-7 rounded-xl border border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70 hover:text-white"
            title={`Sottrai ${label} (valore custom)`}
          >
            <FaAnglesLeft className="w-3.5 h-3.5" />
          </button>
          <div className={`relative flex-1 h-5 rounded-lg ${colorTrack} overflow-visible border border-slate-600/50`}>
            {/* fill */}
            <div
              style={{ width: `${Math.min(100, pct)}%` }}
              className={`h-full rounded-md ${colorFill}`}
            />
            {/* overflow fill */}
            {overflowPct > 0 && (
              <div
                style={{ width: `${overflowPct}%` }}
                className="h-full bg-amber-400 rounded-r-md"
              />
            )}
            {/* subtle stripes */}
            <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_6px,transparent_6px,transparent_12px)] rounded-lg" />
          </div>
          <button
            onClick={onOpenInc}
            className="inline-flex items-center justify-center h-7 w-7 rounded-xl border border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70 hover:text-white"
            title={`Aggiungi ${label} (valore custom)`}
          >
            <FaAnglesRight className="w-3.5 h-3.5" />
          </button>
          <button
            onMouseDown={onIncStart}
            onMouseUp={onIncEnd}
            onMouseLeave={onIncEnd}
            onTouchStart={onIncStart}
            onTouchEnd={onIncEnd}
            className="inline-flex items-center justify-center h-7 w-7 rounded-xl border border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70 hover:text-white"
            title={`+1 ${label}`}
          >
            <FaAngleRight className="w-3.5 h-3.5" />
          </button>
          <span className="min-w-[72px] text-right text-sm text-slate-200">
            {current}/{total}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="relative backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg overflow-hidden">
      {/* Decorative glows to match EquippedInventory */}
      <div className="absolute -left-16 -top-16 w-52 h-52 bg-indigo-500/10 rounded-full blur-3xl" />
      <div className="absolute -right-10 -bottom-24 w-64 h-64 bg-fuchsia-500/10 rounded-full blur-3xl" />

      {/* Custom Input Modal (full-screen overlay retained via portal to avoid clipping) */}
      {showCustomInput && createPortal(
        (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-slate-900/90 border border-slate-700/70 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-700/60">
                <h2 className="text-sm font-medium text-slate-200 tracking-wide">{promptMessage}</h2>
              </div>
              <div className="p-4">
                {!customFeedbackMessage ? (
                  <>
                    <input
                      type="number"
                      value={customInputValue}
                      onChange={(e) => setCustomInputValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
                      className="w-full p-2 rounded-lg bg-slate-800/80 text-slate-100 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-slate-600/60"
                      placeholder="0"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={closeCustomInput} className="px-4 py-2 rounded-xl border border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70">Annulla</button>
                      <button onClick={handleCustomSubmit} className="px-4 py-2 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow hover:opacity-95">OK</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-slate-200 mb-4">{customFeedbackMessage}</p>
                    <div className="flex justify-end">
                      <button onClick={closeCustomInput} className="px-4 py-2 rounded-xl bg-gradient-to-br from-sky-600 to-blue-600 text-white shadow hover:opacity-95">Chiudi</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ),
        document.body
      )}

      <div className="relative flex flex-col gap-4">
        <div className="space-y-4">
          <StatRow
            label="HP"
            icon={GiHearts}
            colorTrack="bg-red-900/30"
            colorFill="bg-gradient-to-r from-red-500 to-rose-500"
            current={userData?.stats?.hpCurrent || 0}
            total={userData?.stats?.hpTotal || 0}
            onReset={handleResetHP}
            onDecStart={handleDecrementHPStart}
            onDecEnd={handleDecrementHPEnd}
            onIncStart={handleIncrementHPStart}
            onIncEnd={handleIncrementHPEnd}
            onOpenDec={() => openCustomInput('hp-decrement')}
            onOpenInc={() => openCustomInput('hp-increment')}
          />

          <StatRow
            label="Mana"
            icon={GiMagicSwirl}
            colorTrack="bg-indigo-900/30"
            colorFill="bg-gradient-to-r from-indigo-600 to-fuchsia-600"
            current={userData?.stats?.manaCurrent || 0}
            total={userData?.stats?.manaTotal || 0}
            onReset={handleResetMana}
            onDecStart={handleDecrementManaStart}
            onDecEnd={handleDecrementManaEnd}
            onIncStart={handleIncrementManaStart}
            onIncEnd={handleIncrementManaEnd}
            onOpenDec={() => openCustomInput('mana-decrement')}
            onOpenInc={() => openCustomInput('mana-increment')}
          />
        </div>
      </div>
    </div>
  );
};

export default StatsBars;
