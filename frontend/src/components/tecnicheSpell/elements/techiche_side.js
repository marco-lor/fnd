import React, { useState, useRef, useEffect } from "react";

const TecnicaCard = ({ tecnicaName, tecnica }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  const hasImage = tecnica.image_url && tecnica.image_url.trim() !== "";

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

  return (
    <div
      className="relative rounded-md aspect-square transition-all duration-300"
      style={{ height: "200px" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      ref={cardRef}
    >
      {/* Base card with image or icon */}
      <div className="relative h-full w-full overflow-hidden rounded-md">
        {hasImage ? (
          <img
            src={tecnica.image_url}
            alt={tecnica.Nome || tecnicaName}
            className="w-full h-full object-cover"
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
        {/* Video background if available */}
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
              <p className="text-gray-200">{tecnica.Costo}</p>
            </div>
            <div className="bg-black/50 p-2 rounded">
              <p className="text-purple-300 font-bold text-sm">Azione</p>
              <p className="text-gray-200">{tecnica.Azione}</p>
            </div>
          </div>
          <div className="flex-grow bg-black/50 p-2 rounded">
            <p className="text-purple-300 font-bold text-sm mb-1">Effetto</p>
            <p className="text-gray-200 text-sm">{tecnica.Effetto}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const TecnicheSide = ({ personalTecniche = {}, commonTecniche = {} }) => {
  return (
    <div className="md:w-3/5 bg-[rgba(40,40,60,0.8)] p-5 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
      <h1 className="text-2xl text-white font-bold mb-4">Tecniche</h1>

      {/* Personal Tecniche Section */}
      <div className="mb-8">
        <h2 className="text-xl text-white font-semibold mb-4 border-b border-gray-600 pb-2">
          Tecniche Personali
        </h2>
        {Object.keys(personalTecniche).length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(personalTecniche)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([tecnicaName, tecnica]) => (
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(commonTecniche)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([tecnicaName, tecnica]) => (
                <TecnicaCard key={tecnicaName} tecnicaName={tecnicaName} tecnica={tecnica} />
              ))}
          </div>
        ) : (
          <p className="text-gray-400">Nessuna tecnica comune disponibile.</p>
        )}
      </div>
    </div>
  );
};

export default TecnicheSide;
