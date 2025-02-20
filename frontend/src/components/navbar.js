// file: ./frontend/src/components/navbar.js
import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';

const Navbar = ({ imageUrl: propImageUrl, userData: propUserData, user: propUser }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Use props if available; otherwise, load from Firebase.
  const [user, setUser] = useState(propUser || null);
  const [userData, setUserData] = useState(propUserData || null);
  const [imageUrl, setImageUrl] = useState(propImageUrl || '');

  useEffect(() => {
    if (!user) {
      const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          const userRef = doc(db, "users", currentUser.uid);
          const unsubscribeSnapshot = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              setUserData(data);
              if (data.imageUrl) {
                setImageUrl(data.imageUrl);
              }
            }
          });
          return () => unsubscribeSnapshot();
        } else {
          navigate("/"); // Redirect to login if not authenticated
        }
      });
      return () => unsubscribeAuth();
    }
  }, [user, navigate]);

  // Check the active route. (Note: using "/home" for the Home button.)
  const isActive = (path) => location.pathname === path;

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <header className="w-full bg-[rgba(40,40,60,0.8)] p-3 grid grid-cols-3 items-center">
      {/* Left Column: Profile Picture and Name */}
      <div className="flex items-center">
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Character Avatar"
            className="w-20 h-20 rounded-full object-cover mr-3"
          />
        )}
        <h1 className="text-2xl font-bold text-white">
          {userData?.characterId || (user && user.email)}
        </h1>
      </div>

      {/* Center Column: Navigation Buttons */}
      <div className="flex justify-center gap-4">
        <button
          onClick={() => navigate("/home")}
          className={`px-4 py-2 rounded-md transition-colors ${
            isActive("/home") ? "bg-[#FFA500] text-white" : "bg-transparent text-white hover:bg-[#e69500]"
          }`}
        >
          Home
        </button>
        <button
          onClick={() => navigate("/bazaar")}
          className={`px-4 py-2 rounded-md transition-colors ${
            isActive("/bazaar") ? "bg-[#FFA500] text-white" : "bg-transparent text-white hover:bg-[#e69500]"
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
