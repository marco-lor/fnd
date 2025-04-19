// file ./frontend/src/AuthContext.js
import React, { createContext, useState, useEffect, useContext, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { onSnapshot, doc } from 'firebase/firestore';
import { auth, db } from './components/firebaseConfig';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const userSnapshotUnsubscribe = useRef(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      
      // Clean up any existing subscription when auth state changes
      if (userSnapshotUnsubscribe.current) {
        userSnapshotUnsubscribe.current();
        userSnapshotUnsubscribe.current = null;
      }

      if (currentUser) {
        // Set up real-time listener for user data
        const userRef = doc(db, "users", currentUser.uid);
        userSnapshotUnsubscribe.current = onSnapshot(
          userRef,
          (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              setUserData(data);
              // Cache user data for faster page loads
              localStorage.setItem('userData', JSON.stringify(data));
            } else {
              console.error("No user data found!");
              setUserData(null);
              localStorage.removeItem('userData');
            }
            setLoading(false);
          },
          (error) => {
            console.error("Error fetching user data:", error);
            setUserData(null);
            localStorage.removeItem('userData');
            setLoading(false);
          }
        );
      } else {
        // Clear user data when logged out
        setUserData(null);
        localStorage.removeItem('userData');
        setLoading(false);
      }
    });

    // Initialize with cached data for faster first render
    const cachedUserData = localStorage.getItem('userData');
    if (cachedUserData) {
      try {
        setUserData(JSON.parse(cachedUserData));
      } catch (e) {
        console.error("Error parsing cached user data");
        localStorage.removeItem('userData');
      }
    }

    return () => {
      unsubscribeAuth();
      if (userSnapshotUnsubscribe.current) {
        userSnapshotUnsubscribe.current();
      }
    };
  }, []);

  const value = {
    user,
    userData,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);