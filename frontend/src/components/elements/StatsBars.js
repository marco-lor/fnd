// file: ./frontend/src/components/elements/StatsBars.js
import React, { useEffect, useState, useRef, useContext } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { AuthContext } from '../../AuthContext';
import { FaRedo, FaPlus, FaMinus, FaPlusSquare, FaMinusSquare } from 'react-icons/fa';

const StatsBars = () => {
  const { user } = useContext(AuthContext);
  const [userData, setUserData] = useState(null);

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

  const handleCustomDecrementHP = async () => {
    const input = window.prompt("Enter HP value to subtract:");
    const delta = parseInt(input, 10);
    if (!isNaN(delta) && user && userData?.stats) {
      const newHP = (userData.stats.hpCurrent || 0) - delta;
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.hpCurrent": newHP });
      } catch (error) {
        console.error("Error custom decrementing HP:", error);
      }
    }
  };

  const handleCustomIncrementHP = async () => {
    const input = window.prompt("Enter HP value to add:");
    const delta = parseInt(input, 10);
    if (!isNaN(delta) && user && userData?.stats) {
      const newHP = (userData.stats.hpCurrent || 0) + delta;
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.hpCurrent": newHP });
      } catch (error) {
        console.error("Error custom incrementing HP:", error);
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

  const handleCustomDecrementMana = async () => {
    const input = window.prompt("Enter Mana value to subtract:");
    const delta = parseInt(input, 10);
    if (!isNaN(delta) && user && userData?.stats) {
      const newMana = (userData.stats.manaCurrent || 0) - delta;
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.manaCurrent": newMana });
      } catch (error) {
        console.error("Error custom decrementing Mana:", error);
      }
    }
  };

  const handleCustomIncrementMana = async () => {
    const input = window.prompt("Enter Mana value to add:");
    const delta = parseInt(input, 10);
    if (!isNaN(delta) && user && userData?.stats) {
      const newMana = (userData.stats.manaCurrent || 0) + delta;
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { "stats.manaCurrent": newMana });
      } catch (error) {
        console.error("Error custom incrementing Mana:", error);
      }
    }
  };

  return (
    <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
      <div className="mt-2 space-y-3 flex flex-col items-center">
        {/* HP Bar */}
        <div className="flex items-center space-x-2 w-full justify-center">
          <span className="text-base font-bold text-red-700 w-16">HP:</span>
          <button onClick={handleResetHP} className="bg-green-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-green-600" title="Reset HP">
            <FaRedo className="w-3 h-3" />
          </button>
          <button onMouseDown={handleDecrementHPStart} onMouseUp={handleDecrementHPEnd} onMouseLeave={handleDecrementHPEnd} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Decrease HP by 1">
            <FaMinus className="w-3 h-3" />
          </button>
          <button onClick={handleCustomDecrementHP} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Decrease HP by custom value">
            <FaMinusSquare className="w-3 h-3" />
          </button>
          <div className="w-80 md:w-96 lg:w-1/2 h-5 bg-red-200 rounded flex overflow-visible">
            {userData?.stats?.hpTotal ? (() => {
              const hpCurrent = userData.stats.hpCurrent;
              const hpTotal = userData.stats.hpTotal;
              if (hpCurrent <= hpTotal) {
                return <div style={{ width: `${(hpCurrent / hpTotal) * 100}%` }} className="h-full bg-red-500 rounded"></div>;
              } else {
                const extraPercent = ((hpCurrent - hpTotal) / hpTotal) * 100;
                return (
                  <>
                    <div style={{ width: '100%' }} className="h-full bg-red-500 rounded-l"></div>
                    <div style={{ width: `${extraPercent}%` }} className="h-full bg-yellow-500 rounded-r"></div>
                  </>
                );
              }
            })() : null}
          </div>
          <button onClick={handleCustomIncrementHP} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Increase HP by custom value">
            <FaPlusSquare className="w-3 h-3" />
          </button>
          <button onMouseDown={handleIncrementHPStart} onMouseUp={handleIncrementHPEnd} onMouseLeave={handleIncrementHPEnd} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Increase HP by 1">
            <FaPlus className="w-3 h-3" />
          </button>
          <span className="text-base text-white">
            {userData?.stats?.hpCurrent}/{userData?.stats?.hpTotal}
          </span>
        </div>
        {/* Mana Bar */}
        <div className="flex items-center space-x-2 w-full justify-center">
          <span className="text-base font-bold text-purple-700 w-16">Mana:</span>
          <button onClick={handleResetMana} className="bg-green-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-green-600" title="Reset Mana">
            <FaRedo className="w-3 h-3" />
          </button>
          <button onMouseDown={handleDecrementManaStart} onMouseUp={handleDecrementManaEnd} onMouseLeave={handleDecrementManaEnd} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Decrease Mana by 1">
            <FaMinus className="w-3 h-3" />
          </button>
          <button onClick={handleCustomDecrementMana} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Decrease Mana by custom value">
            <FaMinusSquare className="w-3 h-3" />
          </button>
          <div className="w-80 md:w-96 lg:w-1/2 h-5 bg-purple-200 rounded flex overflow-visible">
            {userData?.stats?.manaTotal ? (() => {
              const manaCurrent = userData.stats.manaCurrent;
              const manaTotal = userData.stats.manaTotal;
              if (manaCurrent <= manaTotal) {
                return <div style={{ width: `${(manaCurrent / manaTotal) * 100}%` }} className="h-full bg-purple-600 rounded"></div>;
              } else {
                const extraPercent = ((manaCurrent - manaTotal) / manaTotal) * 100;
                return (
                  <>
                    <div style={{ width: '100%' }} className="h-full bg-purple-600 rounded-l"></div>
                    <div style={{ width: `${extraPercent}%` }} className="h-full bg-yellow-500 rounded-r"></div>
                  </>
                );
              }
            })() : null}
          </div>
          <button onClick={handleCustomIncrementMana} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Increase Mana by custom value">
            <FaPlusSquare className="w-3 h-3" />
          </button>
          <button onMouseDown={handleIncrementManaStart} onMouseUp={handleIncrementManaEnd} onMouseLeave={handleIncrementManaEnd} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Increase Mana by 1">
            <FaPlus className="w-3 h-3" />
          </button>
          <span className="text-base text-white">
            {userData?.stats?.manaCurrent}/{userData?.stats?.manaTotal}
          </span>
        </div>
      </div>
    </div>
  );
};

export default StatsBars;
