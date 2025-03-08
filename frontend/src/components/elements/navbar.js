// file: ./frontend/src/components/elements/navbar.js
import React, { useEffect, useState, useRef, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { AuthContext } from '../../AuthContext';

const Navbar = ({ imageUrl: propImageUrl, userData: propUserData }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Use AuthContext to obtain the user.
  const { user } = useContext(AuthContext);

  const [userData, setUserData] = useState(propUserData || null);
  const [imageUrl, setImageUrl] = useState(propImageUrl || '');

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

  return (
    <header className="w-full bg-[rgba(40,40,60,0.8)] p-3 grid grid-cols-3 items-center">
      {/* Left Column: Profile Picture and Character Name */}
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