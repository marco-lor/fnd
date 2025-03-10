// file: ./frontend/src/components/common/navbar.js
import React, { useEffect, useState, useRef, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { AuthContext } from '../../AuthContext';

const Navbar = ({ imageUrl: propImageUrl, userData: propUserData }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useContext(AuthContext);

  // Use state with localStorage for persistence between navigations
  const [userData, setUserData] = useState(() => {
    const cached = localStorage.getItem('userData');
    return propUserData || (cached ? JSON.parse(cached) : null);
  });

  const [imageUrl, setImageUrl] = useState(() => {
    return propImageUrl || localStorage.getItem('userImageUrl') || '';
  });

  // Add a loading state that is true if userData isn't already loaded
  const [isLoading, setIsLoading] = useState(!userData);
  const unsubscribeSnapshotRef = useRef(null);

  useEffect(() => {
    if (user) {
      setIsLoading(true);
      const userRef = doc(db, "users", user.uid);
      unsubscribeSnapshotRef.current = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserData(data);
            localStorage.setItem('userData', JSON.stringify(data));

            if (data.imageUrl) {
              setImageUrl(data.imageUrl);
              localStorage.setItem('userImageUrl', data.imageUrl);
            }
          }
          setIsLoading(false);
        },
        (error) => {
          console.error("Error in snapshot listener:", error);
          setIsLoading(false);
        }
      );
    } else {
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

  return (
    <header className="w-full bg-[rgba(40,40,60,0.8)] p-3 grid grid-cols-3 items-center">
      {/* Left Column: Profile Picture and Character Name */}
      <div className="flex items-center">
        {isLoading ? (
          <div className="w-20 h-20 rounded-full bg-gray-600 animate-pulse mr-3"></div>
        ) : (
          imageUrl && (
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
          )
        )}
        <div className="flex flex-col">
          {isLoading ? (
            <div className="h-6 w-32 bg-gray-600 animate-pulse rounded"></div>
          ) : (
            <h1 className="text-2xl font-bold text-white">
              {userData?.characterId || (user && user.email)}
            </h1>
          )}
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
        <button
          onClick={() => navigate("/tecniche-spell")}
          className={`px-4 py-2 rounded-md transition-colors ${
            isActive("/tecniche-spell")
              ? "bg-[#FFA500] text-white"
              : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Tecniche/Spell
        </button>
        {userData?.role === "dm" && (
          <button
            onClick={() => navigate("/dm-dashboard")}
            className={`px-4 py-2 rounded-md transition-colors ${
              isActive("/dm-dashboard")
                ? "bg-[#FFA500] text-white"
                : "bg-transparent text-white hover:bg-[#e69500]"
            }`}
          >
            DM Dashboard
          </button>
        )}
      </div>

      {/* Right Column: Logout Button */}
      <div className="flex items-center justify-end gap-3 mr-4">
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
