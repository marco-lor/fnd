// file: ./frontend/src/context/FirebaseContext.js

import React, { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "../components/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

// Create Context
const FirebaseContext = createContext();

// Provider Component
export const FirebaseProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          setUserData(userSnap.data());
        }
      } else {
        // If there's no current user, ensure userData is cleared
        setUserData(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Logout function
  const logout = async () => {
    try {
      await signOut(auth);
      // Optionally reset user states here if desired
      setUser(null);
      setUserData(null);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  return (
    <FirebaseContext.Provider value={{ user, userData, loading, logout }}>
      {children}
    </FirebaseContext.Provider>
  );
};

// Custom Hook to use Firebase Context
export const useFirebase = () => {
  return useContext(FirebaseContext);
};
