// file: ./frontend/src/components/home/elements/StatsBars.js
import React, { useEffect, useState, useRef, useContext } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { AuthContext } from '../../../AuthContext';
import { FaAngleRight, FaAngleLeft, FaAnglesRight, FaAnglesLeft } from 'react-icons/fa6';
import { FaRedo } from 'react-icons/fa';

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

  return (
    <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
      {/* Custom Input Modal */}
      {showCustomInput && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-80">
            <h2 className="text-white text-lg mb-4">{promptMessage}</h2>
            {!customFeedbackMessage ? (
              <>
                <input
                  type="number"
                  value={customInputValue}
                  onChange={(e) => setCustomInputValue(e.target.value)}
                  className="w-full p-2 rounded bg-gray-700 text-white mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex justify-end space-x-2">
                  <button onClick={closeCustomInput} className="px-4 py-1 bg-red-600 text-white rounded hover:bg-red-700">Annulla</button>
                  <button onClick={handleCustomSubmit} className="px-4 py-1 bg-green-600 text-white rounded hover:bg-green-700">OK</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-white mb-4">{customFeedbackMessage}</p>
                <div className="flex justify-end">
                  <button onClick={closeCustomInput} className="px-4 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Chiudi</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="mt-2 space-y-3 flex flex-col items-center">
        {/* HP Bar */}
        <div className="flex items-center w-full">
          <span className="text-base font-bold text-red-700 w-16 text-right mr-2">HP:</span>
          <div className="flex items-center space-x-2 flex-1">
            <button onClick={handleResetHP} className="bg-green-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-green-600" title="Reset HP">
              <FaRedo className="w-3 h-3" />
            </button>
            <button onMouseDown={handleDecrementHPStart} onMouseUp={handleDecrementHPEnd} onMouseLeave={handleDecrementHPEnd} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Decrease HP by 1">
              <FaAngleLeft className="w-3 h-3" />
            </button>
            <button onClick={() => openCustomInput('hp-decrement')} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Decrease HP by custom value">
              <FaAnglesLeft className="w-3 h-3" />
            </button>
            <div className="flex-1 h-5 bg-red-200 rounded flex overflow-visible">
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
            <button onClick={() => openCustomInput('hp-increment')} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Increase HP by custom value">
              <FaAnglesRight className="w-3 h-3" />
            </button>
            <button onMouseDown={handleIncrementHPStart} onMouseUp={handleIncrementHPEnd} onMouseLeave={handleIncrementHPEnd} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Increase HP by 1">
              <FaAngleRight className="w-3 h-3" />
            </button>
            <span className="text-base text-white w-16 text-right">
              {userData?.stats?.hpCurrent}/{userData?.stats?.hpTotal}
            </span>
          </div>
        </div>
        
        {/* Mana Bar */}
        <div className="flex items-center w-full">
          <span className="text-base font-bold text-purple-700 w-16 text-right mr-2">Mana:</span>
          <div className="flex items-center space-x-2 flex-1">
            <button onClick={handleResetMana} className="bg-green-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-green-600" title="Reset Mana">
              <FaRedo className="w-3 h-3" />
            </button>
            <button onMouseDown={handleDecrementManaStart} onMouseUp={handleDecrementManaEnd} onMouseLeave={handleDecrementManaEnd} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Decrease Mana by 1">
              <FaAngleLeft className="w-3 h-3" />
            </button>
            <button onClick={() => openCustomInput('mana-decrement')} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Decrease Mana by custom value">
              <FaAnglesLeft className="w-3 h-3" />
            </button>
            <div className="flex-1 h-5 bg-purple-200 rounded flex overflow-visible">
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
            <button onClick={() => openCustomInput('mana-increment')} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Increase Mana by custom value">
              <FaAnglesRight className="w-3 h-3" />
            </button>
            <button onMouseDown={handleIncrementManaStart} onMouseUp={handleIncrementManaEnd} onMouseLeave={handleIncrementManaEnd} className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600" title="Increase Mana by 1">
              <FaAngleRight className="w-3 h-3" />
            </button>
            <span className="text-base text-white w-16 text-right">
              {userData?.stats?.manaCurrent}/{userData?.stats?.manaTotal}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatsBars;
