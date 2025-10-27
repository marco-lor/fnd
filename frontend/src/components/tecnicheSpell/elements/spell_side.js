import React, { useState, useRef, useEffect, useMemo } from "react";
import { GiSpellBook, GiMagicSwirl } from "react-icons/gi";
import { doc, updateDoc, getFirestore, getDoc } from "firebase/firestore";

// Cache for dadi anima data to prevent repeated fetches
const dadiAnimaCache = {
  data: null,
  lastFetchTimestamp: 0,
  // Cache expiration time in milliseconds (30 minutes)
  expirationTime: 30 * 60 * 1000
};

const SpellCard = ({ spellName, spell, userData }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);
  const [placementSide, setPlacementSide] = useState('right');
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [initialCardRect, setInitialCardRect] = useState(null);
  const [dadiAnima, setDadiAnima] = useState(null);
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  const dismissTimeoutRef = useRef(null);
  const hasImage = spell.image_url && spell.image_url.trim() !== "";
  const db = getFirestore();
  const azione = spell.Azione || spell.azione || "";

  // Fetch dadiAnimaByLevel data when component mounts - enhanced with caching
  useEffect(() => {
    const fetchDadiAnima = async () => {
      try {
        const now = Date.now();
        // Use cached data if available and not expired
        if (dadiAnimaCache.data && now - dadiAnimaCache.lastFetchTimestamp < dadiAnimaCache.expirationTime) {
          setDadiAnima(dadiAnimaCache.data);
          return;
        }

        // Fetch from database if cache is invalid
        const dadiRef = doc(db, "utils", "varie");
        const dadiDoc = await getDoc(dadiRef);
        if (dadiDoc.exists()) {
          const dadiData = dadiDoc.data().dadiAnimaByLevel || [];
          // Update cache
          dadiAnimaCache.data = dadiData;
          dadiAnimaCache.lastFetchTimestamp = now;
          setDadiAnima(dadiData);
        }
      } catch (error) {
        console.error("Error fetching dadi anima data:", error);
      }
    };
    fetchDadiAnima();
  }, [db]);

  // --- Mana validation logic with special reduction (ridCostoSpell) ---
  const extractOriginalCost = () => {
    const costStr = spell.Costo?.toString() || "0";
    const match = costStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  const getCurrentMana = () => userData?.stats?.manaCurrent || 0;

  const getSpecialReduction = (specialObj, desiredKey) => {
    if (!specialObj) return 0;
    const extractVal = (node) => {
      if (typeof node === 'number') return node;
      if (node && typeof node === 'object') {
        return Number(node.Tot ?? node.tot ?? node.value ?? 0) || 0;
      }
      return Number(node) || 0;
    };
    // exact
    if (specialObj[desiredKey] !== undefined) {
      const v = extractVal(specialObj[desiredKey]);
      if (!isNaN(v) && v) return v;
    }
    const norm = (s) => s.toLowerCase().replace(/\s|_/g, '');
    const desired = norm(desiredKey);
    // normalized equality
    for (const k of Object.keys(specialObj)) {
      if (norm(k) === desired) {
        const v = extractVal(specialObj[k]);
        if (!isNaN(v) && v) return v;
      }
    }
    // substring match
    for (const k of Object.keys(specialObj)) {
      if (norm(k).includes(desired)) {
        const v = extractVal(specialObj[k]);
        if (!isNaN(v) && v) return v;
      }
    }
    return 0;
  };

  const originalCost = extractOriginalCost();
  const costReduction = getSpecialReduction(userData?.Parametri?.Special, 'ridCostoSpell');
  const manaCost = originalCost > 0 ? Math.max(1, originalCost - costReduction) : 0;
  const currentMana = getCurrentMana();
  const hasSufficientMana = currentMana >= manaCost;

  // Save initial card position for animation
  useEffect(() => {
    if (isHovered && !initialCardRect && cardRef.current) {
      setInitialCardRect(cardRef.current.getBoundingClientRect());
    }
  }, [isHovered, initialCardRect]);

  // Calculate overlay position when hovered and not expanded with overflow protection.
  useEffect(() => {
    if (isHovered && !isExpanded && cardRef.current && !overlayDismissed) {
      const cardRect = cardRef.current.getBoundingClientRect();
      const overlayWidth = 320; // non-expanded width
      const overlayHeight = 350; // non-expanded height
      const gap = 10;
      let proposedLeft = cardRect.right + gap;
      let proposedTop = cardRect.top + (cardRect.height / 2) - (overlayHeight / 2);
      const margin = 10;
      if (proposedTop < margin) proposedTop = margin;
      const maxTop = window.innerHeight - overlayHeight - margin;
      if (proposedTop > maxTop) proposedTop = maxTop;

      let side = 'right';
      if (proposedLeft + overlayWidth > window.innerWidth - margin) {
        const leftPlacement = cardRect.left - overlayWidth - gap;
        if (leftPlacement >= margin) {
          proposedLeft = leftPlacement;
          side = 'left';
        } else {
          proposedLeft = Math.max(margin, window.innerWidth - overlayWidth - margin);
          side = (cardRect.left < window.innerWidth / 2) ? 'right' : 'left';
        }
      }
      setPlacementSide(side);
      setPosition({ top: proposedTop, left: proposedLeft });
      setIsPositioned(true);
    } else if ((!isHovered || overlayDismissed) && !isExpanded) {
      setIsPositioned(false);
    }
  }, [isHovered, isExpanded, overlayDismissed]);

  // Handle outside clicks when overlay is expanded.
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (
        isExpanded &&
        overlayRef.current &&
        !overlayRef.current.contains(e.target)
      ) {
        setIsExpanded(false);
        setIsHovered(false); // Also hide the "Use Spell" button
        // Schedule the overlay dismissal after the collapse transition.
        dismissTimeoutRef.current = setTimeout(() => {
          setOverlayDismissed(true);
          dismissTimeoutRef.current = null;
        }, 300);
      }
    };

    if (isExpanded) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isExpanded]);

  // When the card is clicked, clear any pending timeout and re-expand immediately.
  const handleCardClick = (e) => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
    if (!isExpanded && isHovered) {
      e.stopPropagation();
      // Reset overlayDismissed in case it was set by the timeout.
      setOverlayDismissed(false);
      setIsExpanded(true);
    }
  };

  const handleUseSpell = (e) => {
    e.stopPropagation();
    setIsExpanded(false);
    setOverlayDismissed(true);
    setIsHovered(false);
    setShowConfirmation(true);
  };

  // Auto-hide success message.
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const confirmUseSpell = async () => {
    if (!hasSufficientMana) return;
    try {
      const userRef = doc(db, "users", userData.uid);
      const newManaValue = currentMana - manaCost;
      await updateDoc(userRef, { "stats.manaCurrent": newManaValue });
      setSuccessMessage(
        `Incantesimo ${spell.Nome || spellName} lanciato! (-${manaCost} PM)`
      );
      setShowConfirmation(false);
    } catch (error) {
      console.error("Error updating mana:", error);
      setSuccessMessage("Errore nel lancio dell'incantesimo. Riprova.");
      setShowConfirmation(false);
    }
  };

  const cancelUseSpell = () => {
    setShowConfirmation(false);
  };

  const getOverlayClasses = () => {
    return `fixed rounded-lg shadow-xl overflow-hidden transition-all duration-300 ease-out z-50
      ${!isHovered && !isExpanded ? "opacity-0 pointer-events-none translate-x-[-20px]" : "opacity-100 translate-x-0"}
      ${isExpanded ? "z-[100]" : "z-50"}`;
  };

  const getOverlayStyle = () => {
    if (isExpanded) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "520px",  // Increased from 420px
        height: "560px", // Increased from 450px
        background: "rgba(10,10,20,0.97)",
        backdropFilter: "blur(4px)",
        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        transformOrigin: "center center"
      };
    }
    return {
      top: `${position.top}px`,
      left: `${position.left}px`,
      transform: "translate(0, 0)",
      width: "320px",
      height: "350px",
      background: "rgba(10,10,20,0.97)",
      backdropFilter: "blur(4px)",
      boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
      transformOrigin: placementSide === 'left' ? 'right center' : 'left center',
      transition: "all 0.3s ease-out"
    };
  };

  // Format and calculate TPC values - memoized for performance
  const formatTPC = useMemo(() => {
    const calculateTPC = (tpcData) => {
      if (!tpcData) return "---";
      
      const param1 = tpcData.Param1 || "---";
      const param2 = tpcData.Param2 || "---";
      const paramTarget = tpcData.ParamTarget || "---";
      
      // If all parameters are "---", return "---"
      if (param1 === "---" && param2 === "---" && paramTarget === "---") {
        return "---";
      }
      
      // Get player level and corresponding dadi value
      const playerLevel = userData?.stats?.level || 1;
      const dadiValue = dadiAnima && dadiAnima[playerLevel] ? dadiAnima[playerLevel] : "d10";
      
      // Get parameter values from user data - fixed to look in the correct location
      const getParamValue = (param) => {
        if (param === "---") return null;
        
        // Check in Parametri.Base (for stats like Forza, Costituzione, etc.)
        if (userData?.Parametri?.Base?.[param]) {
          return {name: param, value: userData.Parametri.Base[param].Tot};
        }
        // Check in Parametri.Combattimento (for stats like Attacco, Difesa, etc.)
        if (userData?.Parametri?.Combattimento?.[param]) {
          return {name: param, value: userData.Parametri.Combattimento[param].Tot};
        }
        return {name: param, value: "?"};
      };
      
      const param1Value = getParamValue(param1);
      const param2Value = getParamValue(param2);
      
      // If only one parameter is defined
      if ((param1 !== "---" && param2 === "---") || (param1 === "---" && param2 !== "---")) {
        const activeParam = param1 !== "---" ? param1Value : param2Value;
        if (!activeParam) return "---";
        
        // Format: "Parameter (value) + Anima (dX) VS ParamTarget + Anima"
        let result = `${activeParam.name} (${activeParam.value}) + Anima (${dadiValue})`;
        if (paramTarget !== "---") {
          result += ` VS ${paramTarget} + Anima`;
        }
        return result;
      }
      
      // If both parameters are defined, use the higher value
      if (param1 !== "---" && param2 !== "---" && param1Value && param2Value) {
        const highParam = param1Value.value > param2Value.value ? param1Value : param2Value;
        
        // Format with max value split in two lines
        return {
          line1: `MAX(${param1Value.name}, ${param2Value.name})`,
          line2: `${highParam.name} (${highParam.value}) + Anima (${dadiValue})${paramTarget !== "---" ? ` VS ${paramTarget} + Anima` : ''}`
        };
      }
      
      return "---";
    };
    
    return {
      main: calculateTPC(spell.TPC),
      fisico: calculateTPC(spell["TPC Fisico"]),
      mentale: calculateTPC(spell["TPC Mentale"])
    };
  }, [spell, userData, dadiAnima]);

  return (
    <div
      className="relative rounded-md aspect-square transition-all duration-300"
      style={{ height: "200px" }}
      onMouseEnter={() => {
        if (!isExpanded && !overlayDismissed) setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        setOverlayDismissed(false); // Reset dismissed state on mouse leave.
      }}
      onClick={handleCardClick}
      ref={cardRef}
    >
      {/* Success message notification */}
      {successMessage && (
        <div className="absolute top-0 left-0 right-0 z-[110] bg-green-600 text-white px-3 py-1 rounded-t-md text-sm text-center">
          {successMessage}
        </div>
      )}

      {/* Base card with image or icon */}
      <div className="relative h-full w-full overflow-hidden rounded-md">
        {hasImage ? (
          <img
            src={spell.image_url}
            alt={spell.Nome || spellName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-800">
            <GiSpellBook className="w-20 h-20 text-gray-400" />
          </div>
        )}

        {/* Name overlay (always visible) */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-2">
          <h3 className="text-white font-bold text-center">
            {spell.Nome || spellName}
          </h3>
        </div>

        {/* Hover overlay with icon at bottom */}
        <div
          className={`absolute inset-0 bg-black/40 flex items-end justify-center transition-opacity ${
            isHovered ? "opacity-100" : "opacity-0"
          }`}
        >
          <button
            onClick={handleUseSpell}
            className={`p-3 bg-indigo-700/80 hover:bg-indigo-600 rounded-full transition-all mb-4 ${
              isHovered ? "transform translate-y-0" : "transform translate-y-16"
            }`}
            style={{ transition: "transform 0.3s ease-out" }}
          >
            <GiMagicSwirl className="text-white text-2xl" />
          </button>
        </div>
      </div>

      {/* Render overlay only if either expanded or positioned and not dismissed */}
      {((isExpanded || isPositioned) && !overlayDismissed) && (
        <div
          ref={overlayRef}
          onClick={(e) => e.stopPropagation()}
          className={getOverlayClasses()}
          style={getOverlayStyle()}
        >
          {spell.video_url && (
            <div className="absolute inset-0 z-0">
              <video
                src={spell.video_url}
                autoPlay
                muted
                loop
                className="w-full h-full object-cover opacity-50"
              />
              <div className="absolute inset-0 bg-black/40"></div>
            </div>
          )}
          <div className="p-4 h-full flex flex-col relative z-10">
            <h3 className={`${isExpanded ? 'text-2xl' : 'text-lg'} text-white font-bold mb-3 text-center border-b border-gray-600 pb-2 relative`}>
              {spell.Nome || spellName}
              {/* Small Tipo Base at center top */}
              <span className={`absolute left-0 right-0 -top-3 ${isExpanded ? 'text-sm' : 'text-xs'} text-gray-300 text-center`}>
                {spell["Tipo Base"]}
              </span>
            </h3>
            {azione && (
              <div className={`flex justify-center ${isExpanded ? 'mt-2' : 'mt-1'} mb-1`}>
                <span className={`px-2 py-0.5 rounded-full bg-indigo-800/60 text-indigo-200 ${isExpanded ? 'text-xs' : 'text-[10px]'} font-semibold`}>
                  {azione}
                </span>
              </div>
            )}
            {/* Nuovo campo Turni posizionato sotto il nome dell'incantesimo e la linea */}
            <div className={`text-center ${azione ? '' : '-mt-3'} mb-2 ${isExpanded ? 'text-xs' : 'text-[10px]'} text-gray-400`}>
              Turni: {spell.Turni || "---"} | Gittata: {spell.Gittata || "---"}
            </div>
            
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-black/50 p-2 rounded">
                <p className={`text-indigo-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'}`}>Costo</p>
                <p className={`text-gray-200 ${isExpanded ? 'text-base' : 'text-sm'}`}>
                  {manaCost}
                  {originalCost > 0 && costReduction > 0 && (
                    <span className="text-[10px] text-gray-400 ml-1">(base {originalCost} -{costReduction})</span>
                  )}
                </p>
              </div>
              <div className="bg-black/50 p-2 rounded col-span-2">
                <p className={`text-indigo-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'}`}>Esperienza</p>
                <p className={`text-gray-200 ${isExpanded ? 'text-base' : 'text-sm'}`}>{spell.Esperienza || "---"}</p>
              </div>
            </div>
            {originalCost > 0 && costReduction > 0 && (
              <div className="mb-3 -mt-1 rounded-md border border-indigo-600/40 bg-indigo-900/20 p-2">
                <p className="text-[11px] text-indigo-200 font-semibold">Riduzione applicata</p>
                <p className={`text-xs text-indigo-100`}>
                  Base {originalCost} − Riduzione {costReduction}
                  <span className="ml-1">⇒</span>
                  <span className="ml-1 font-bold text-white">{manaCost}</span>
                  <span className="ml-1 text-indigo-300">(minimo 1)</span>
                </p>
              </div>
            )}
            <div className="flex-grow bg-black/50 p-2 rounded overflow-y-auto mb-2">
              {spell["Effetti Positivi"] && (
                <div className="mb-2">
                  <p className={`text-green-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'} mb-1`}>Effetti Positivi</p>
                  <p className={`text-gray-200 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{spell["Effetti Positivi"]}</p>
                </div>
              )}
              {spell["Effetti Negativi"] && (
                <div className="mb-2">
                  <p className={`text-red-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'} mb-1`}>Effetti Negativi</p>
                  <p className={`text-gray-200 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{spell["Effetti Negativi"]}</p>
                </div>
              )}
              
              {/* Mod Params section - only show non-zero values */}
              {spell["Mod Params"] && (
                <div className="mt-2">
                  <p className={`text-indigo-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'} mb-1`}>Modificatori</p>
                  <div className="grid grid-cols-2 gap-1">
                    {/* Base parameters */}
                    {spell["Mod Params"]?.Base && Object.entries(spell["Mod Params"].Base)
                      .filter(([_, value]) => value !== 0)
                      .map(([param, value]) => (
                        <div key={`base-${param}`} className="flex justify-between bg-black/30 p-1 rounded">
                          <span className={`text-gray-300 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{param}</span>
                          <span className={`${value > 0 ? "text-green-400" : "text-red-400"} ${isExpanded ? 'text-sm' : 'text-xs'}`}>
                            {value > 0 ? `+${value}` : value}
                          </span>
                        </div>
                      ))}
                    
                    {/* Combat parameters */}
                    {spell["Mod Params"]?.Combattimento && Object.entries(spell["Mod Params"].Combattimento)
                      .filter(([_, value]) => value !== 0)
                      .map(([param, value]) => (
                        <div key={`combat-${param}`} className="flex justify-between bg-black/30 p-1 rounded">
                          <span className={`text-gray-300 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{param}</span>
                          <span className={`${value > 0 ? "text-green-400" : "text-red-400"} ${isExpanded ? 'text-sm' : 'text-xs'}`}>
                            {value > 0 ? `+${value}` : value}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
              
              {/* TPC sections - using memoized formatted values */}
              <div className="mt-3">
                <div className="mb-1">
                  <p className={`text-yellow-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'}`}>TPC</p>
                  {typeof formatTPC.main === 'object' ? (
                    <>
                      <p className={`text-gray-400 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{formatTPC.main.line1}</p>
                      <p className={`text-gray-200 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{formatTPC.main.line2}</p>
                    </>
                  ) : (
                    <p className={`text-gray-200 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{formatTPC.main}</p>
                  )}
                </div>
                
                <div className="mb-1">
                  <p className={`text-yellow-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'}`}>TPC Fisico</p>
                  {typeof formatTPC.fisico === 'object' ? (
                    <>
                      <p className={`text-gray-400 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{formatTPC.fisico.line1}</p>
                      <p className={`text-gray-200 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{formatTPC.fisico.line2}</p>
                    </>
                  ) : (
                    <p className={`text-gray-200 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{formatTPC.fisico}</p>
                  )}
                </div>
                
                <div>
                  <p className={`text-yellow-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'}`}>TPC Mentale</p>
                  {typeof formatTPC.mentale === 'object' ? (
                    <>
                      <p className={`text-gray-400 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{formatTPC.mentale.line1}</p>
                      <p className={`text-gray-200 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{formatTPC.mentale.line2}</p>
                    </>
                  ) : (
                    <p className={`text-gray-200 ${isExpanded ? 'text-sm' : 'text-xs'}`}>{formatTPC.mentale}</p>
                  )}
                </div>
              </div>
            </div>
            
            {/* Add Cast Spell button in expanded view */}
            {isExpanded && (
              <button
                onClick={handleUseSpell}
                className="w-full py-3 bg-indigo-700 hover:bg-indigo-600 text-white rounded-md transition-colors flex items-center justify-center text-lg"
              >
                <GiMagicSwirl className="mr-2" /> Lancia Incantesimo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Backdrop when expanded */}
      {isExpanded && (
        <div className="fixed inset-0 bg-black/50 z-[90] transition-opacity duration-300 ease-in-out"></div>
      )}

      {/* Confirmation Overlay */}
      {showConfirmation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
          <div className="bg-[rgba(40,40,60,0.95)] p-6 rounded-lg shadow-lg max-w-md w-full">
            <h3 className="text-xl text-white font-bold mb-4">Conferma</h3>
            <p className="text-gray-200 mb-2">
              Stai per lanciare l'incantesimo{" "}
              <span className="text-indigo-500 font-bold">
                {spell.Nome || spellName}
              </span>, costo effettivo{" "}
              <span className="text-indigo-500 font-bold">{manaCost}</span> mana
            </p>
            {originalCost > 0 && costReduction > 0 && (
              <div className="mb-4 mt-1 rounded-md border border-indigo-600/40 bg-indigo-900/20 p-2">
                <p className="text-[11px] text-indigo-200 font-semibold">Riduzione applicata</p>
                <p className="text-xs text-indigo-100">
                  Base {originalCost} − Riduzione {costReduction}
                  <span className="ml-1">⇒</span>
                  <span className="ml-1 font-bold text-white">{manaCost}</span>
                  {originalCost > 0 ? <span className="ml-1 text-indigo-300">(minimo 1)</span> : null}
                </p>
              </div>
            )}
            <div className="mb-6 p-2 rounded bg-black/30">
              <p className="text-gray-200">
                Mana disponibile:{" "}
                <span
                  className={`font-bold ${
                    hasSufficientMana ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {currentMana}
                </span>
              </p>
              {!hasSufficientMana && (
                <p className="text-red-400 text-sm mt-1">
                  Mana insufficiente per lanciare questo incantesimo
                </p>
              )}
            </div>
            <div className="flex justify-end gap-4">
              <button
                onClick={cancelUseSpell}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={confirmUseSpell}
                className={`px-4 py-2 ${
                  hasSufficientMana
                    ? "bg-indigo-700 hover:bg-indigo-600"
                    : "bg-gray-500 cursor-not-allowed"
                } text-white rounded transition-colors`}
                disabled={!hasSufficientMana}
              >
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SpellSide = ({ personalSpells = {}, userData = {} }) => {
  return (
    <div className="md:w-3/5 bg-[rgba(40,40,60,0.8)] p-5 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
      <h1 className="text-2xl text-white font-bold mb-4">Spellbook</h1>
      
      {Object.keys(personalSpells).length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(personalSpells)
            .sort((a, b) => {
              const nameA = (a[1]?.Nome || a[0] || "").toString();
              const nameB = (b[1]?.Nome || b[0] || "").toString();
              return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
            })
            .map(([spellName, spell]) => (
              <SpellCard
                key={spellName}
                spellName={spellName}
                spell={spell}
                userData={userData}
              />
            ))}
        </div>
      ) : (
        <div className="h-48 flex justify-center items-center">
          <p className="text-gray-400">Il contenuto del tuo grimorio apparirà qui.</p>
        </div>
      )}
    </div>
  );
};

export default SpellSide;

