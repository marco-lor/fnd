import React, { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../components/firebaseConfig"; // Update path if needed

function AnimaShardSelection({ user, onAnimaSelect, selectedAnima }) {
  // Local state for anima shards
  const [animaShards, setAnimaShards] = useState({});
  const [levelUpBonuses, setLevelUpBonuses] = useState({});
  const [loadingAnima, setLoadingAnima] = useState(true);
  const [error, setError] = useState("");

  // Fetch anima shards data from Firestore
  useEffect(() => {
    const fetchAnimaData = async () => {
      setLoadingAnima(true);
      setError("");
      const varieDocRef = doc(db, "utils", "varie");

      try {
        const docSnap = await getDoc(varieDocRef);
        if (docSnap.exists()) {
          const varieData = docSnap.data();
          
          // Get initial anima bonuses
          if (varieData && varieData.modAnima) {
            setAnimaShards(varieData.modAnima);
            console.log("Anima shards loaded successfully:", varieData.modAnima);
          } else {
            console.log("'modAnima' field is missing or not an object.");
            setAnimaShards({});
            setError("Anima shard data format is incorrect in the database.");
          }
          
          // Get level up anima bonuses
          if (varieData && varieData.levelUpAnimaBonus) {
            setLevelUpBonuses(varieData.levelUpAnimaBonus);
            console.log("Level up bonuses loaded successfully:", varieData.levelUpAnimaBonus);
          } else {
            console.log("'levelUpAnimaBonus' field is missing or not an object.");
            setLevelUpBonuses({});
          }
          
        } else {
          console.log("Varie document ('/utils/varie') not found in Firestore.");
          setAnimaShards({});
          setLevelUpBonuses({});
          setError("Could not find the Anima Shard configuration in the database.");
        }
      } catch (error) {
        console.error("Error fetching anima shards:", error);
        setError(`Failed to fetch anima shard data: ${error.message}`);
        setAnimaShards({});
        setLevelUpBonuses({});
      } finally {
        setLoadingAnima(false);
      }
    };

    if (user) {
      fetchAnimaData();
    } else {
      setLoadingAnima(false);
    }
  }, [user]);

  // Function to handle anima shard selection
  const handleAnimaSelect = (animaName, bonuses) => {
    const levelUpBonus = levelUpBonuses[animaName] || {};
    onAnimaSelect({ 
      name: animaName, 
      bonuses: bonuses,
      levelUpBonus: levelUpBonus 
    });
  };

  // Function to format parameter bonuses for display
  const formatBonuses = (bonuses) => {
    return Object.entries(bonuses).map(([param, value]) => (
      <span key={param} className="block">
        <span className="font-medium text-yellow-300">{param}:</span> +{value}
      </span>
    ));
  };

  // Function to render the anima shard selection area
  const renderAnimaSelection = () => {
    // Show loading state while fetching anima shards
    if (loadingAnima) {
      return (
        <div className="col-span-full text-center py-6 text-white/60">
          Loading anima shards...
        </div>
      );
    }
    
    // Show error or 'no anima shards' message if fetching failed or no shards found
    if (Object.keys(animaShards).length === 0) {
      return (
        <div className="col-span-full text-center py-6 text-red-400">
          {error || "No anima shards available. Please contact the game administrator."}
        </div>
      );
    }
    
    // Render the anima shard cards
    return Object.entries(animaShards).map(([animaName, bonuses]) => {
      const levelBonus = levelUpBonuses[animaName] || {};
      
      return (
        <div
          key={animaName}
          // Apply conditional styling based on selection state
          className={`p-4 rounded-lg cursor-pointer transition-all duration-300 text-left h-full flex flex-col ${
            selectedAnima?.name === animaName
              ? 'bg-blue-700/70 border-2 border-blue-400 shadow-[0_0_10px_rgba(100,150,255,0.7)] scale-105'
              : 'bg-[rgba(40,40,60,0.7)] border border-[rgba(150,150,255,0.2)] hover:bg-[rgba(60,60,80,0.7)] hover:scale-102'
          }`}
          onClick={() => handleAnimaSelect(animaName, bonuses)}
        >
          {/* Anima Shard Title */}
          <h3 className="text-lg font-semibold text-[#D4AF37] mb-2">{animaName}</h3>
          
          {/* Initial Bonuses */}
          <div className="text-white/80 text-sm mb-3">
            <p className="mb-1 font-medium text-blue-300">Initial Bonuses:</p>
            {formatBonuses(bonuses)}
          </div>
          
          {/* Level Up Bonuses */}
          <div className="text-white/80 text-sm mt-auto pt-2 border-t border-white/20">
            <p className="mb-1 font-medium text-green-300">Level Up Bonus:</p>
            {Object.keys(levelBonus).length > 0 ? (
              formatBonuses(levelBonus)
            ) : (
              <span className="text-white/50">No level bonus data available.</span>
            )}
            <p className="mt-2 text-xs text-white/50 italic">
              This bonus is applied each time you level up.
            </p>
          </div>
        </div>
      );
    });
  };

  return (
    <div className="w-full">
      <label className="block text-white text-left mb-3 text-sm font-medium">
        Select Your Anima Shard
      </label>
      <p className="text-white/70 text-sm mb-4 text-left">
        Each Anima Shard grants different parameter bonuses that will shape your character's abilities, 
        and provides additional bonuses each time you level up. Choose wisely based on your preferred playstyle.
      </p>
      {/* Grid for anima shard cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {renderAnimaSelection()}
      </div>
      
      {/* Error Display Area */}
      {error && !loadingAnima && Object.keys(animaShards).length === 0 && (
        <div className="w-full mt-4 p-3 bg-red-900/60 border border-red-700 rounded text-white text-sm shadow-md">
          {error}
        </div>
      )}
    </div>
  );
}

export default AnimaShardSelection;