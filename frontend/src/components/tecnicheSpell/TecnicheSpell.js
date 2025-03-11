import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../AuthContext";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import DnDBackground from "../backgrounds/DnDBackground";
import Navbar from "../common/navbar";
import TecnicheSide from "./elements/techiche_side";
import SpellSide from "./elements/spell_side";

function TecnicheSpell() {
  const { user } = useAuth();
  const [userData, setUserData] = useState(null);
  const [personalTecniche, setPersonalTecniche] = useState({});
  const [commonTecniche, setCommonTecniche] = useState({});
  const [personalSpells, setPersonalSpells] = useState({});
  const [commonSpells, setCommonSpells] = useState({});
  const [loading, setLoading] = useState(true);
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    async function fetchData() {
      if (user) {
        const userRef = doc(db, "users", user.uid);
        unsubscribeRef.current = onSnapshot(
          userRef,
          (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              setUserData(data);
              setPersonalTecniche(data.tecniche || {});
            }
          },
          (error) => {
            console.error("Error fetching user data:", error);
          }
        );

        try {
          const commonTecnicheRef = doc(db, "utils", "tecniche_common");
          const commonTecnicheSnap = await getDoc(commonTecnicheRef);

          if (commonTecnicheSnap.exists()) {
            setCommonTecniche(commonTecnicheSnap.data() || {});
          } else {
            console.log("No common tecniche document found");
            setCommonTecniche({});
          }
        } catch (error) {
          console.error("Error fetching common tecniche:", error);
        }

        setLoading(false);
      }
    }

    fetchData();

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [user]);

  if (loading) {
    return (
      <div className="w-full h-screen">
        <DnDBackground />
        <div className="absolute inset-0 z-10 flex justify-center items-center">
          <p className="text-white text-xl">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen overflow-hidden">
      <DnDBackground />
      <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div className="relative z-10 flex flex-col min-h-full">
          <Navbar userData={userData} />
          <main className="flex flex-col items-center justify-center p-5 w-full">
            <div className="flex flex-col md:flex-row w-full max-w-[1600px] gap-6 justify-center">
              {/* Left Section - Tecniche */}
              <TecnicheSide
                personalTecniche={personalTecniche}
                commonTecniche={commonTecniche}
              />

              {/* Right Section - Spellbook */}
              <SpellSide
                personalSpells={personalSpells}
                commonSpells={commonSpells}
              />
            </div>
            {/* Spacer for overlays to extend into */}
            <div className="w-full h-60 mt-6"></div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default TecnicheSpell;