// file: ./frontend/src/components/common/navbar.js
import React, { useEffect, useState, useRef, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig'; // Adjusted path assuming firebaseConfig is two levels up
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
      setIsLoading(true); // Set loading true when fetching starts
      const userRef = doc(db, "users", user.uid);
      unsubscribeSnapshotRef.current = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserData(data);
            localStorage.setItem('userData', JSON.stringify(data)); // Cache user data

            if (data.imageUrl) {
              setImageUrl(data.imageUrl);
              localStorage.setItem('userImageUrl', data.imageUrl); // Cache image URL
            } else {
              // If no imageUrl in DB, clear cached one if necessary
              setImageUrl(''); // Set to empty string or a default placeholder
              localStorage.removeItem('userImageUrl');
            }
          } else {
            console.log("No such document!"); // Handle case where user doc doesn't exist
            setUserData(null); // Clear local state
            setImageUrl('');
            localStorage.removeItem('userData'); // Clear cache
            localStorage.removeItem('userImageUrl');
          }
          setIsLoading(false); // Set loading false after fetch attempt
        },
        (error) => {
          console.error("Error in snapshot listener:", error);
          setIsLoading(false); // Ensure loading is false on error
        }
      );
    } else {
      // If no user, navigate to login page
      navigate("/");
    }

    // Cleanup function to unsubscribe from snapshot listener
    return () => {
      if (unsubscribeSnapshotRef.current) {
        // console.log("Unsubscribing from Firestore snapshot listener.");
        unsubscribeSnapshotRef.current();
        unsubscribeSnapshotRef.current = null; // Prevent memory leaks
      }
    };
  }, [user, navigate]); // Re-run effect if user or navigate changes

  const isActive = (path) => location.pathname === path;

  const handleLogout = async () => {
    try {
      if (unsubscribeSnapshotRef.current) {
        unsubscribeSnapshotRef.current(); // Unsubscribe before logging out
        unsubscribeSnapshotRef.current = null;
      }
      await signOut(auth);
      localStorage.removeItem('userData'); // Clear cached data on logout
      localStorage.removeItem('userImageUrl');
      navigate("/"); // Redirect to login page
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // Conditional rendering based on loading state
  const renderProfileInfo = () => {
    if (isLoading) {
      return (
        <>
          <div className="w-20 h-20 rounded-full bg-gray-600 animate-pulse mr-3"></div>
          <div className="flex flex-col">
            <div className="h-6 w-32 bg-gray-600 animate-pulse rounded mb-1"></div>
            {/* Optionally add a placeholder for level if needed */}
          </div>
        </>
      );
    }

    return (
      <>
        {imageUrl ? (
          <div className="relative mr-3">
            <img
              src={imageUrl}
              alt="Character Avatar"
              className="w-20 h-20 rounded-full object-cover border-2 border-white"
            />
            {userData?.stats?.level && (
              <div className="absolute bottom-0 left-0 bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm border-2 border-white">
                {userData.stats.level}
              </div>
            )}
          </div>
        ) : (
          <div className="w-20 h-20 rounded-full bg-gray-500 flex items-center justify-center text-white text-xs mr-3 border-2 border-white">
            No Img
          </div>
        )}
        <div className="flex flex-col">
          <h1 className="text-xl md:text-2xl font-bold text-white">
            {userData?.characterId || (user && user.email) || "User"}
          </h1>
          {/* Optional: Display other info like class */}
          {/* <p className="text-sm text-gray-300">{userData?.class || 'No Class'}</p> */}
        </div>
      </>
    );
  };

  return (
    <header className="w-full bg-[rgba(40,40,60,0.8)] p-3 grid grid-cols-1 md:grid-cols-3 items-center sticky top-0 z-50 backdrop-blur-sm">
      {/* Left Column: Profile Picture and Character Name */}
      <div className="flex items-center justify-center md:justify-start mb-4 md:mb-0">
        {renderProfileInfo()}
      </div>

      {/* Center Column: Navigation Buttons */}
      <nav className="flex justify-center flex-wrap gap-2 md:gap-4">
        <button
          onClick={() => navigate("/home")}
          className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
            isActive("/home")
              ? "bg-[#FFA500] text-white font-semibold shadow-md"
              : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Home
        </button>
        <button
          onClick={() => navigate("/bazaar")}
          className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
            isActive("/bazaar")
              ? "bg-[#FFA500] text-white font-semibold shadow-md"
              : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Bazaar
        </button>
        <button
          onClick={() => navigate("/combat")}
          className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
            isActive("/combat")
              ? "bg-[#FFA500] text-white font-semibold shadow-md"
              : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Combat
        </button>
        <button
          onClick={() => navigate("/tecniche-spell")}
          className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
            isActive("/tecniche-spell")
              ? "bg-[#FFA500] text-white font-semibold shadow-md"
              : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Tecniche | Spell
        </button>
        <button
          onClick={() => navigate("/codex")}
          className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
            isActive("/codex")
              ? "bg-[#FFA500] text-white font-semibold shadow-md"
              : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Codex
        </button>
        {/* New Echi di Viaggio Button */}
        <button
          onClick={() => navigate("/echi-di-viaggio")}
          className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
            isActive("/echi-di-viaggio")
              ? "bg-[#FFA500] text-white font-semibold shadow-md"
              : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Echi di Viaggio
        </button>
        {/* End New Echi di Viaggio Button */}
        {userData?.role === "dm" && (
          <button
            onClick={() => navigate("/dm-dashboard")}
            className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
              isActive("/dm-dashboard")
                ? "bg-[#FFA500] text-white font-semibold shadow-md"
                : "bg-transparent text-white hover:bg-[#e69500]"
            }`}
          >
            DM Dashboard
          </button>
        )}
        {userData?.role === "webmaster" && (
          <button
            onClick={() => navigate("/admin")}
            className={`px-3 py-1 md:px-4 md:py-2 rounded-md transition-colors text-sm md:text-base ${
              isActive("/admin")
                ? "bg-[#FFA500] text-white font-semibold shadow-md"
                : "bg-transparent text-white hover:bg-[#e69500]"
            }`}
          >
            Admin
          </button>
        )}
      </nav>

      {/* Right Column: Logout Button */}
      <div className="flex items-center justify-center md:justify-end gap-3 mt-4 md:mt-0 md:mr-4">
        <button
          className="bg-[#8B0000] text-white px-3 py-1 md:px-4 md:py-2 rounded-[5px] cursor-pointer transition-colors duration-300 hover:bg-[#B22222] text-sm md:text-base font-medium"
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>
    </header>
  );
};

export default Navbar;