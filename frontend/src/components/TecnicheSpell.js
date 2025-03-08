// file: ./frontend/src/components/TecnicheSpell.js  # do not remove this line
import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../AuthContext";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db } from "./firebaseConfig";
import DnDBackground from "./backgrounds/DnDBackground";
import Navbar from "./elements/navbar";

const TecnicaCard = ({ tecnicaName, tecnica }) => {
  const [isHovered, setIsHovered] = useState(false);
  const imageUrl = tecnica.image_url || 'https://via.placeholder.com/200?text=No+Image';

  return (
    <div
      className="relative rounded-md aspect-square transition-all duration-300"
      style={{ height: "200px" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Base card with image */}
      <div className="relative h-full w-full overflow-hidden rounded-md">
        <img
          src={imageUrl}
          alt={tecnica.Nome || tecnicaName}
          className="w-full h-full object-cover"
        />

        {/* Name overlay (always visible) */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-2">
          <h3 className="text-white font-bold text-center">
            {tecnica.Nome || tecnicaName}
          </h3>
        </div>
      </div>

      {/* Expanded fluid overlay on hover */}
      <div
        className={`absolute z-20 rounded-lg shadow-xl overflow-auto transition-all duration-300 ease-out ${isHovered ? 'opacity-100 scale-125' : 'opacity-0 scale-95 pointer-events-none'}`}
        style={{
          top: '-25%',
          left: '-25%',
          width: '150%',
          height: '150%',
          background: 'rgba(10,10,20,0.97)',
          backdropFilter: 'blur(4px)',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          transformOrigin: 'center'
        }}
      >
        <div className="p-4 h-full flex flex-col">
          <h3 className="text-lg text-white font-bold mb-3 text-center border-b border-gray-600 pb-2">
            {tecnica.Nome || tecnicaName}
          </h3>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="bg-black/30 p-2 rounded">
              <p className="text-amber-300 font-bold text-sm">Costo</p>
              <p className="text-gray-200">{tecnica.Costo}</p>
            </div>
            <div className="bg-black/30 p-2 rounded">
              <p className="text-amber-300 font-bold text-sm">Azione</p>
              <p className="text-gray-200">{tecnica.Azione}</p>
            </div>
          </div>

          <div className="flex-grow bg-black/30 p-2 rounded">
            <p className="text-amber-300 font-bold text-sm mb-1">Effetto</p>
            <p className="text-gray-200 text-sm">{tecnica.Effetto}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

function TecnicheSpell() {
  const { user } = useAuth();
  const [userData, setUserData] = useState(null);
  const [personalTecniche, setPersonalTecniche] = useState({});
  const [commonTecniche, setCommonTecniche] = useState({});
  const [loading, setLoading] = useState(true);
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    async function fetchData() {
      if (user) {
        // Fetch personal tecniche from user document
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

        // Fetch common tecniche from the utils/tecniche_common document
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
      <div className="relative w-screen min-h-screen overflow-hidden">
        <DnDBackground />
        <div className="relative z-10 flex justify-center items-center h-screen">
          <p className="text-white text-xl">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen min-h-screen overflow-hidden">
      <DnDBackground />
      <div className="relative z-10 flex flex-col">
        <Navbar userData={userData} />
        <main className="flex flex-col items-center justify-center p-5">
          <div className="bg-[rgba(40,40,60,0.8)] p-4 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] w-full max-w-[1200px]">
            <h1 className="text-2xl text-white font-bold mb-4">Tecniche</h1>

            {/* Personal Tecniche Section */}
            <div className="mb-8">
              <h2 className="text-xl text-white font-semibold mb-4 border-b border-gray-600 pb-2">
                Tecniche Personali
              </h2>
              {Object.keys(personalTecniche).length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {Object.entries(personalTecniche).map(([tecnicaName, tecnica]) => (
                    <TecnicaCard key={tecnicaName} tecnicaName={tecnicaName} tecnica={tecnica} />
                  ))}
                </div>
              ) : (
                <p className="text-gray-400">Nessuna tecnica personale disponibile.</p>
              )}
            </div>

            {/* Common Tecniche Section */}
            <div>
              <h2 className="text-xl text-white font-semibold mb-4 border-b border-gray-600 pb-2">
                Tecniche Comuni
              </h2>
              {Object.keys(commonTecniche).length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {Object.entries(commonTecniche).map(([tecnicaName, tecnica]) => (
                    <TecnicaCard key={tecnicaName} tecnicaName={tecnicaName} tecnica={tecnica} />
                  ))}
                </div>
              ) : (
                <p className="text-gray-400">Nessuna tecnica comune disponibile.</p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default TecnicheSpell;
