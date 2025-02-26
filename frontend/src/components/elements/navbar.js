// file: ./frontend/src/components/elements/navbar.js
import React, { useEffect, useState, useRef, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { AuthContext } from '../../AuthContext'; // Adjust the path as needed
import { FaRedo, FaPlus, FaMinus, FaPlusSquare, FaMinusSquare } from 'react-icons/fa';

const Navbar = ({ imageUrl: propImageUrl, userData: propUserData }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Use AuthContext to obtain the user.
  const { user } = useContext(AuthContext);

  const [userData, setUserData] = useState(propUserData || null);
  const [imageUrl, setImageUrl] = useState(propImageUrl || '');

  // Refs for long-press intervals.
  const hpIntervalRef = useRef(null);
  const manaIntervalRef = useRef(null);
  // Ref for the snapshot unsubscribe function.
  const unsubscribeSnapshotRef = useRef(null);

  useEffect(() => {
    // Only subscribe if user is available
    if (user) {
      const userRef = doc(db, "users", user.uid);
      unsubscribeSnapshotRef.current = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserData(data);
            if (data.imageUrl) {
              setImageUrl(data.imageUrl);
            }
          }
        },
        (error) => {
          console.error("Error in snapshot listener:", error);
          // Optionally, handle permission errors gracefully here.
        }
      );
    } else {
      // Redirect to login if not authenticated.
      navigate("/");
    }

    return () => {
      if (unsubscribeSnapshotRef.current) {
        unsubscribeSnapshotRef.current();
        unsubscribeSnapshotRef.current = null;
      }
    };
  }, [user, navigate]);

  const isActive = (path) => location.pathname === path;

  const handleLogout = async () => {
    try {
      if (unsubscribeSnapshotRef.current) {
        unsubscribeSnapshotRef.current();
        unsubscribeSnapshotRef.current = null;
      }
      await signOut(auth);
      navigate("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // Reset HP handler - sets hpCurrent to hpTotal
  const handleResetHP = async () => {
    if (user && userData?.stats) {
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          "stats.hpCurrent": userData.stats.hpTotal,
        });
      } catch (error) {
        console.error("Error resetting HP:", error);
      }
    }
  };

  // Reset Mana handler - sets manaCurrent to manaTotal
  const handleResetMana = async () => {
    if (user && userData?.stats) {
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          "stats.manaCurrent": userData.stats.manaTotal,
        });
      } catch (error) {
        console.error("Error resetting Mana:", error);
      }
    }
  };

  // HP adjustment functions
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

  // Custom HP adjustment functions using popup for delta values
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

  // Mana adjustment functions
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

  // Custom Mana adjustment functions using popup for delta values
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
    <header className="w-full bg-[rgba(40,40,60,0.8)] p-3 grid grid-cols-3 items-center">
      {/* Left Column: Profile Picture, Character Name, and Stats */}
      <div className="flex items-center">
        {imageUrl && (
          <div className="relative mr-3">
            <img
              src={imageUrl}
              alt="Character Avatar"
              className="w-20 h-20 rounded-full object-cover border-2 border-white"
            />
            {userData?.stats?.level && (
              <div className="absolute bottom-0 left-0 bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center border-2 border-white">
                {userData.stats.level}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-white">
            {userData?.characterId || (user && user.email)}
          </h1>
          {/* HP and Mana Bars */}
          <div className="mt-2 space-y-1">
            {/* HP Bar */}
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-red-700 w-16">HP:</span>
              {/* Reset button */}
              <button
                onClick={handleResetHP}
                className="bg-green-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-green-600"
                title="Reset HP"
              >
                <FaRedo className="w-3 h-3" />
              </button>
              {/* Decrement button */}
              <button
                onMouseDown={handleDecrementHPStart}
                onMouseUp={handleDecrementHPEnd}
                onMouseLeave={handleDecrementHPEnd}
                className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600"
                title="Decrease HP by 1"
              >
                <FaMinus className="w-3 h-3" />
              </button>
              {/* Custom decrement button */}
              <button
                onClick={handleCustomDecrementHP}
                className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600"
                title="Decrease HP by custom value"
              >
                <FaMinusSquare className="w-3 h-3" />
              </button>
              {/* HP Bar with possibility for extra (yellow) overflow */}
              <div className="w-40 h-4 bg-red-200 rounded flex overflow-visible">
                {userData?.stats?.hpTotal
                  ? (() => {
                      const hpCurrent = userData.stats.hpCurrent;
                      const hpTotal = userData.stats.hpTotal;
                      if (hpCurrent <= hpTotal) {
                        return (
                          <div
                            style={{ width: `${(hpCurrent / hpTotal) * 100}%` }}
                            className="h-full bg-red-500 rounded"
                          ></div>
                        );
                      } else {
                        const extraPercent = ((hpCurrent - hpTotal) / hpTotal) * 100;
                        return (
                          <>
                            <div
                              style={{ width: '100%' }}
                              className="h-full bg-red-500 rounded-l"
                            ></div>
                            <div
                              style={{ width: `${extraPercent}%` }}
                              className="h-full bg-yellow-500 rounded-r"
                            ></div>
                          </>
                        );
                      }
                    })()
                  : null}
              </div>
              {/* Custom increment button */}
              <button
                onClick={handleCustomIncrementHP}
                className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600"
                title="Increase HP by custom value"
              >
                <FaPlusSquare className="w-3 h-3" />
              </button>
              {/* Increment button */}
              <button
                onMouseDown={handleIncrementHPStart}
                onMouseUp={handleIncrementHPEnd}
                onMouseLeave={handleIncrementHPEnd}
                className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600"
                title="Increase HP by 1"
              >
                <FaPlus className="w-3 h-3" />
              </button>
              <span className="text-sm text-white">
                {userData?.stats?.hpCurrent}/{userData?.stats?.hpTotal}
              </span>
            </div>
            {/* Mana Bar */}
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-purple-700 w-16">Mana:</span>
              {/* Reset button */}
              <button
                onClick={handleResetMana}
                className="bg-green-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-green-600"
                title="Reset Mana"
              >
                <FaRedo className="w-3 h-3" />
              </button>
              {/* Decrement button */}
              <button
                onMouseDown={handleDecrementManaStart}
                onMouseUp={handleDecrementManaEnd}
                onMouseLeave={handleDecrementManaEnd}
                className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600"
                title="Decrease Mana by 1"
              >
                <FaMinus className="w-3 h-3" />
              </button>
              {/* Custom decrement button */}
              <button
                onClick={handleCustomDecrementMana}
                className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600"
                title="Decrease Mana by custom value"
              >
                <FaMinusSquare className="w-3 h-3" />
              </button>
              {/* Mana Bar with possibility for extra (yellow) overflow */}
              <div className="w-40 h-4 bg-purple-200 rounded flex overflow-visible">
                {userData?.stats?.manaTotal
                  ? (() => {
                      const manaCurrent = userData.stats.manaCurrent;
                      const manaTotal = userData.stats.manaTotal;
                      if (manaCurrent <= manaTotal) {
                        return (
                          <div
                            style={{ width: `${(manaCurrent / manaTotal) * 100}%` }}
                            className="h-full bg-purple-600 rounded"
                          ></div>
                        );
                      } else {
                        const extraPercent = ((manaCurrent - manaTotal) / manaTotal) * 100;
                        return (
                          <>
                            <div
                              style={{ width: '100%' }}
                              className="h-full bg-purple-600 rounded-l"
                            ></div>
                            <div
                              style={{ width: `${extraPercent}%` }}
                              className="h-full bg-yellow-500 rounded-r"
                            ></div>
                          </>
                        );
                      }
                    })()
                  : null}
              </div>
              {/* Custom increment button */}
              <button
                onClick={handleCustomIncrementMana}
                className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600"
                title="Increase Mana by custom value"
              >
                <FaPlusSquare className="w-3 h-3" />
              </button>
              {/* Increment button */}
              <button
                onMouseDown={handleIncrementManaStart}
                onMouseUp={handleIncrementManaEnd}
                onMouseLeave={handleIncrementManaEnd}
                className="bg-gray-500 text-white h-4 w-4 flex items-center justify-center rounded hover:bg-gray-600"
                title="Increase Mana by 1"
              >
                <FaPlus className="w-3 h-3" />
              </button>
              <span className="text-sm text-white">
                {userData?.stats?.manaCurrent}/{userData?.stats?.manaTotal}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Center Column: Navigation Buttons */}
      <div className="flex justify-center flex-wrap gap-6">
        <button
          onClick={() => navigate("/home")}
          className={`px-4 py-2 rounded-md transition-colors ${
            isActive("/home")
              ? "bg-[#FFA500] text-white"
              : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Home
        </button>
        <button
          onClick={() => navigate("/bazaar")}
          className={`px-4 py-2 rounded-md transition-colors ${
            isActive("/bazaar")
              ? "bg-[#FFA500] text-white"
              : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Bazaar
        </button>
      </div>

      {/* Right Column: Logout Button */}
      <div className="flex items-center justify-end gap-3">
        <button
          className="bg-[#8B0000] text-white px-4 py-2 rounded-[5px] cursor-pointer transition-colors duration-300 hover:bg-[#B22222]"
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>
    </header>
  );
};

export default Navbar;
