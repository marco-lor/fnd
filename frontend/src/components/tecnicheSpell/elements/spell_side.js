import React, { useState, useRef, useEffect } from "react";
import { GiSpellBook, GiMagicSwirl } from "react-icons/gi";
import { doc, updateDoc, getFirestore } from "firebase/firestore";

const SpellCard = ({ spellName, spell, userData }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  const hasImage = spell.image_url && spell.image_url.trim() !== "";
  const db = getFirestore();

  // --- Mana validation logic ---

  // Extract mana cost from spell.Costo (assuming format like "5 PM")
  const extractManaCost = () => {
    const costStr = spell.Costo?.toString() || "0";
    const match = costStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  // Get current mana from userData
  const getCurrentMana = () => {
    return userData?.stats?.manaCurrent || 0;
  };

  const manaCost = extractManaCost();
  const currentMana = getCurrentMana();
  const hasSufficientMana = currentMana >= manaCost;

  useEffect(() => {
    if (isHovered && cardRef.current && overlayRef.current) {
      // Get dimensions and position of the card and overlay
      const card = cardRef.current.getBoundingClientRect();
      const overlay = overlayRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newTop = 0;
      let newLeft = 0;

      // Position the overlay on the right side of the card
      if (card.right + overlay.width < viewportWidth) {
        newLeft = card.width + 10; // Place overlay completely to the right with a 10px gap
        newTop = -(overlay.height - card.height) / 2;
      }
      // Otherwise, try the left side
      else if (card.left - overlay.width > 0) {
        newLeft = -overlay.width - 10;
        newTop = -(overlay.height - card.height) / 2;
      }
      // Next, try positioning below the card
      else if (card.bottom + overlay.height < viewportHeight) {
        newTop = card.height + 10;
        newLeft = -(overlay.width - card.width) / 2;
      }
      // Otherwise, default to positioning above the card
      else {
        newTop = -overlay.height - 10;
        newLeft = -(overlay.width - card.width) / 2;
      }

      setPosition({ top: newTop, left: newLeft });
    }
  }, [isHovered]);

  // Auto-hide success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const handleUseSpell = (e) => {
    e.stopPropagation();
    setShowConfirmation(true);
  };

  // Confirm the use of spell with mana deduction
  const confirmUseSpell = async () => {
    if (!hasSufficientMana) return;

    try {
      // Update the database to subtract mana cost
      const userRef = doc(db, "users", userData.uid);
      const newManaValue = currentMana - manaCost;

      await updateDoc(userRef, {
        "stats.manaCurrent": newManaValue
      });

      // Show success message
      setSuccessMessage(`Incantesimo ${spell.Nome || spellName} lanciato! (-${manaCost} PM)`);
      setShowConfirmation(false);
      setIsHovered(false);
    } catch (error) {
      console.error("Error updating mana:", error);
      setSuccessMessage("Errore nel lancio dell'incantesimo. Riprova.");
      setShowConfirmation(false);
    }
  };

  const cancelUseSpell = () => {
    setShowConfirmation(false);
    setIsHovered(false);
  };

  return (
    <div
      className="relative rounded-md aspect-square transition-all duration-300"
      style={{ height: "200px" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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

      {/* Expanded overlay on hover - positioned outside the card */}
      <div
        ref={overlayRef}
        className={`absolute z-50 rounded-lg shadow-xl overflow-hidden transition-all duration-300 ease-out ${
          isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          width: "320px",
          height: "350px",
          background: "rgba(10,10,20,0.97)",
          backdropFilter: "blur(4px)",
          boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        }}
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
          <h3 className="text-lg text-white font-bold mb-3 text-center border-b border-gray-600 pb-2">
            {spell.Nome || spellName}
          </h3>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="bg-black/50 p-2 rounded">
              <p className="text-indigo-300 font-bold text-sm">Costo</p>
              <p className="text-gray-200">{spell.Costo}</p>
            </div>
            <div className="bg-black/50 p-2 rounded">
              <p className="text-indigo-300 font-bold text-sm">Tipo</p>
              <p className="text-gray-200">{spell["Tipo Base"]}</p>
            </div>
          </div>
          <div className="flex-grow overflow-y-auto">
            {spell["Effetti Positivi"] && (
              <div className="bg-black/50 p-2 rounded mb-2">
                <p className="text-green-300 font-bold text-sm mb-1">Effetti Positivi</p>
                <p className="text-gray-200 text-sm">{spell["Effetti Positivi"]}</p>
              </div>
            )}
            {spell["Effetti Negativi"] && (
              <div className="bg-black/50 p-2 rounded">
                <p className="text-red-300 font-bold text-sm mb-1">Effetti Negativi</p>
                <p className="text-gray-200 text-sm">{spell["Effetti Negativi"]}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Overlay */}
      {showConfirmation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
          <div className="bg-[rgba(40,40,60,0.95)] p-6 rounded-lg shadow-lg max-w-md w-full">
            <h3 className="text-xl text-white font-bold mb-4">Conferma</h3>
            <p className="text-gray-200 mb-2">
              Stai per lanciare l'incantesimo{" "}
              <span className="text-indigo-500 font-bold">
                {spell.Nome || spellName}
              </span>
              , costa{" "}
              <span className="text-indigo-500 font-bold">{spell.Costo}</span>{" "}
              mana
            </p>

            {/* Mana status information */}
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
            .sort((a, b) => a[0].localeCompare(b[0]))
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
