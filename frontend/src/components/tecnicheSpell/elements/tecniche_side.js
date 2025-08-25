import React, { useState, useRef, useEffect, useMemo } from "react";
import { GiCrossedSwords, GiMinotaur } from "react-icons/gi";
import { doc, updateDoc, getFirestore } from "firebase/firestore";

// Cache dismissal timeouts to prevent flickering
const timeoutCache = new Map();

const TecnicaCard = ({ tecnicaName, tecnica, isPersonal, userData }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isPositioned, setIsPositioned] = useState(false);
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [initialCardRect, setInitialCardRect] = useState(null);
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  const dismissTimeoutRef = useRef(null);
  const hasImage = tecnica.image_url && tecnica.image_url.trim() !== "";
  const db = getFirestore();

  // --- Mana validation logic with special reduction (ridCostoTec) ---
  const { manaCost, originalCost, costReduction, currentMana, hasSufficientMana } = useMemo(() => {
    const extractOriginalCost = () => {
      const costStr = tecnica.Costo?.toString() || "0";
      const match = costStr.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    const getCurrentMana = () => userData?.stats?.manaCurrent || 0;

    // Find a reduction value in Parametri.Special using robust key matching
    const getSpecialReduction = (specialObj, desiredKey) => {
      if (!specialObj) return 0;
      const extractVal = (node) => {
        if (typeof node === 'number') return node;
        if (node && typeof node === 'object') {
          return Number(node.Tot ?? node.tot ?? node.value ?? 0) || 0;
        }
        return Number(node) || 0;
      };
      // Try exact key first
      if (specialObj[desiredKey] !== undefined) {
        const v = extractVal(specialObj[desiredKey]);
        if (!isNaN(v) && v) return v;
      }
      const norm = (s) => s.toLowerCase().replace(/\s|_/g, '');
      const desired = norm(desiredKey);
      // Try normalized equality
      for (const k of Object.keys(specialObj)) {
        if (norm(k) === desired) {
          const v = extractVal(specialObj[k]);
          if (!isNaN(v) && v) return v;
        }
      }
      // Try substring match
      for (const k of Object.keys(specialObj)) {
        if (norm(k).includes(desired)) {
          const v = extractVal(specialObj[k]);
          if (!isNaN(v) && v) return v;
        }
      }
      return 0;
    };

    const orig = extractOriginalCost();
    const rid = getSpecialReduction(userData?.Parametri?.Special, 'ridCostoTec');
    // If original cost > 0, apply reduction with a minimum effective cost of 1
    const effective = orig > 0 ? Math.max(1, orig - rid) : 0;
    const mana = getCurrentMana();

    return {
      originalCost: orig,
      costReduction: rid,
      manaCost: effective,
      currentMana: mana,
      hasSufficientMana: mana >= effective
    };
  }, [tecnica.Costo, userData?.stats?.manaCurrent, userData?.Parametri?.Special]);

  // Save initial card position for animation
  useEffect(() => {
    if (isHovered && !initialCardRect && cardRef.current) {
      setInitialCardRect(cardRef.current.getBoundingClientRect());
    }
  }, [isHovered, initialCardRect]);

  // Calculate overlay position when hovered and not expanded.
  useEffect(() => {
    if (isHovered && !isExpanded && cardRef.current && !overlayDismissed) {
      const cardRect = cardRef.current.getBoundingClientRect();
      const top = cardRect.top - 75; // Adjust vertically to center
      const left = cardRect.right + 10; // Gap between card and overlay
      setPosition({ top, left });
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
        setIsHovered(false); // Also hide the "Use Tecnica" button
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

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
      
      // Also clean from the global cache
      if (timeoutCache.has(tecnicaName)) {
        clearTimeout(timeoutCache.get(tecnicaName));
        timeoutCache.delete(tecnicaName);
      }
    };
  }, [tecnicaName]);

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

  const handleUseTecnica = (e) => {
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

  const confirmUseTecnica = async () => {
    if (!hasSufficientMana) return;
    try {
      const userRef = doc(db, "users", userData.uid);
      const newManaValue = currentMana - manaCost;
      await updateDoc(userRef, { "stats.manaCurrent": newManaValue });
      setSuccessMessage(
        `Tecnica ${tecnica.Nome || tecnicaName} utilizzata! (-${manaCost} PM)`
      );
      setShowConfirmation(false);
    } catch (error) {
      console.error("Error updating mana:", error);
      setSuccessMessage("Errore nell'utilizzo della tecnica. Riprova.");
      setShowConfirmation(false);
    }
  };

  const cancelUseTecnica = () => {
    setShowConfirmation(false);
  };

  // Memoize overlay classes to avoid unnecessary rerenders
  const overlayClasses = useMemo(() => {
    return `fixed rounded-lg shadow-xl overflow-hidden transition-all duration-300 ease-out z-50
      ${!isHovered && !isExpanded ? "opacity-0 pointer-events-none translate-x-[-20px]" : "opacity-100 translate-x-0"}
      ${isExpanded ? "z-[100]" : "z-50"}`;
  }, [isHovered, isExpanded]);

  // Memoize overlay style to avoid unnecessary rerenders
  const overlayStyle = useMemo(() => {
    if (isExpanded) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "420px",
        height: "450px",
        background: "rgba(10,10,20,0.97)",
        backdropFilter: "blur(4px)",
        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        transformOrigin: "center center"
      };
    } else {
      return {
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: "translate(0, 0)",
        width: "320px",
        height: "350px",
        background: "rgba(10,10,20,0.97)",
        backdropFilter: "blur(4px)",
        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        transformOrigin: "left center",
        transition: "all 0.3s ease-out"
      };
    }
  }, [isExpanded, position.top, position.left]);

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
            src={tecnica.image_url}
            alt={tecnica.Nome || tecnicaName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-800">
            <svg
              className="w-20 h-20 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}

        {/* Name overlay (always visible) */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-2">
          <h3 className="text-white font-bold text-center">
            {tecnica.Nome || tecnicaName}
          </h3>
        </div>

        {/* Hover overlay with icon at bottom */}
        <div
          className={`absolute inset-0 bg-black/40 flex items-end justify-center transition-opacity ${
            isHovered ? "opacity-100" : "opacity-0"
          }`}
        >
          <button
            onClick={handleUseTecnica}
            className={`p-3 bg-purple-700/80 hover:bg-purple-600 rounded-full transition-all mb-4 ${
              isHovered ? "transform translate-y-0" : "transform translate-y-16"
            }`}
            style={{ transition: "transform 0.3s ease-out" }}
          >
            {isPersonal ? (
              <GiMinotaur className="text-white text-2xl" />
            ) : (
              <GiCrossedSwords className="text-white text-2xl" />
            )}
          </button>
        </div>
      </div>

      {/* Render overlay only if either expanded or positioned and not dismissed */}
      {((isExpanded || isPositioned) && !overlayDismissed) && (
        <div
          ref={overlayRef}
          onClick={(e) => e.stopPropagation()}
          className={overlayClasses}
          style={overlayStyle}
        >
          {tecnica.video_url && (
            <div className="absolute inset-0 z-0">
              <video
                src={tecnica.video_url}
                autoPlay
                muted
                loop
                className="w-full h-full object-cover opacity-50"
              />
              <div className="absolute inset-0 bg-black/40"></div>
            </div>
          )}
          <div className="p-4 h-full flex flex-col relative z-10">
            <h3 className="text-lg text-white font-bold mb-3 text-center border-b border-gray-600 pb-2">
              {tecnica.Nome || tecnicaName}
            </h3>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-black/50 p-2 rounded">
                <p className="text-purple-300 font-bold text-sm">Costo</p>
                <p className="text-gray-200">
                  {manaCost}
                  {originalCost > 0 && costReduction > 0 && (
                    <span className="text-[10px] text-gray-400 ml-1">(base {originalCost} -{costReduction})</span>
                  )}
                </p>
              </div>
              <div className="bg-black/50 p-2 rounded">
                <p className="text-purple-300 font-bold text-sm">Azione</p>
                <p className="text-gray-200">{tecnica.Azione}</p>
              </div>
            </div>
            {originalCost > 0 && costReduction > 0 && (
              <div className="mb-3 -mt-1 rounded-md border border-purple-600/40 bg-purple-900/20 p-2">
                <p className="text-[11px] text-purple-200 font-semibold">Riduzione applicata</p>
                <p className="text-xs text-purple-100">
                  Base {originalCost} − Riduzione {costReduction}
                  <span className="ml-1">⇒</span>
                  <span className="ml-1 font-bold text-white">{manaCost}</span>
                  <span className="ml-1 text-purple-300">(minimo 1)</span>
                </p>
              </div>
            )}
            <div className="flex-grow bg-black/50 p-2 rounded overflow-y-auto mb-4">
              <p className="text-purple-300 font-bold text-sm mb-1">Effetto</p>
              <p className="text-gray-200 text-sm">{tecnica.Effetto}</p>
            </div>
            
            {/* Add Use Tecnica button in expanded view */}
            {isExpanded && (
              <button
                onClick={handleUseTecnica}
                className="w-full py-3 bg-purple-700 hover:bg-purple-600 text-white rounded-md transition-colors flex items-center justify-center"
              >
                <GiCrossedSwords className="mr-2" /> Usa Tecnica
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
              Stai per utilizzare la tecnica{" "}
              <span className="text-purple-500 font-bold">
                {tecnica.Nome || tecnicaName}
              </span>, costo effettivo{" "}
              <span className="text-purple-500 font-bold">{manaCost}</span> mana
            </p>
                {originalCost > 0 && costReduction > 0 && (
                  <div className="mb-4 mt-1 rounded-md border border-purple-600/40 bg-purple-900/20 p-2">
                    <p className="text-[11px] text-purple-200 font-semibold">Riduzione applicata</p>
                    <p className="text-xs text-purple-100">
                      Base {originalCost} − Riduzione {costReduction}
                      <span className="ml-1">⇒</span>
                      <span className="ml-1 font-bold text-white">{manaCost}</span>
                      {originalCost > 0 ? <span className="ml-1 text-purple-300">(minimo 1)</span> : null}
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
                  Mana insufficiente per usare questa tecnica
                </p>
              )}
            </div>
            <div className="flex justify-end gap-4">
              <button
                onClick={cancelUseTecnica}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={confirmUseTecnica}
                className={`px-4 py-2 ${
                  hasSufficientMana
                    ? "bg-purple-700 hover:bg-purple-600"
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

// Memoized TecnicaCard for better performance
const MemoizedTecnicaCard = React.memo(TecnicaCard);

const TecnicheSide = ({ personalTecniche = {}, commonTecniche = {}, userData = {} }) => {
  return (
    <div className="md:w-3/5 bg-[rgba(40,40,60,0.8)] p-5 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
      <h1 className="text-2xl text-white font-bold mb-4">Tecniche</h1>
      {/* Tecniche Personali */}
      <div className="mb-8">
        <h2 className="text-xl text-white font-semibold mb-4 border-b border-gray-600 pb-2">
          Tecniche Personali
        </h2>
        {Object.keys(personalTecniche).length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(personalTecniche)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([tecnicaName, tecnica]) => (
                <MemoizedTecnicaCard
                  key={tecnicaName}
                  tecnicaName={tecnicaName}
                  tecnica={tecnica}
                  isPersonal={true}
                  userData={userData}
                />
              ))}
          </div>
        ) : (
          <p className="text-gray-400">Nessuna tecnica personale disponibile.</p>
        )}
      </div>
      {/* Tecniche Comuni */}
      <div>
        <h2 className="text-xl text-white font-semibold mb-4 border-b border-gray-600 pb-2">
          Tecniche Comuni
        </h2>
        {Object.keys(commonTecniche).length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(commonTecniche)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([tecnicaName, tecnica]) => (
                <MemoizedTecnicaCard
                  key={tecnicaName}
                  tecnicaName={tecnicaName}
                  tecnica={tecnica}
                  isPersonal={false}
                  userData={userData}
                />
              ))}
          </div>
        ) : (
          <p className="text-gray-400">Nessuna tecnica comune disponibile.</p>
        )}
      </div>
    </div>
  );
};

// Memoize the entire TecnicheSide component to prevent unnecessary rerenders
export default React.memo(TecnicheSide);

