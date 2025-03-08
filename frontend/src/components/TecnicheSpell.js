// file: ./frontend/src/components/TecnicheSpell.js
import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../AuthContext";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebaseConfig";
import DnDBackground from "./backgrounds/DnDBackground";
import Navbar from "./elements/navbar";

function TecnicheSpell() {
  const { user } = useAuth();
  const [userData, setUserData] = useState(null);
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    if (user) {
      const userRef = doc(db, "users", user.uid);
      unsubscribeRef.current = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            setUserData(docSnap.data());
          }
        },
        (error) => {
          console.error("Error fetching user data:", error);
        }
      );
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [user]);

  if (!user) {
    return <p>Loading...</p>;
  }

  return (
    <div className="relative w-screen min-h-screen overflow-hidden">
      <DnDBackground />
      <div className="relative z-10 flex flex-col">
        <Navbar userData={userData} />
        <main className="flex flex-col items-center justify-center p-5">
          <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] w-full max-w-[1200px]">
            <h1 className="text-2xl text-white font-bold mb-4">Tecniche/Spell</h1>
            <p className="text-white">This is a placeholder for the Tecniche/Spell page. Content will be added soon.</p>
          </div>
        </main>
      </div>
    </div>
  );
}

export default TecnicheSpell;