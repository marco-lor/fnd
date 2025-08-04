// file: ./frontend/src/components/bazaar/elements/comparisonComponent.js
import React, { useContext, useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';               // kept for possible outer animations
import { deleteDoc, doc, onSnapshot, getDoc } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from '../../firebaseConfig';
import { computeValue } from '../../common/computeFormula';
import { AuthContext } from '../../../AuthContext';
import { AddWeaponOverlay } from './addWeapon';
import { AddArmaturaOverlay } from './addArmatura';
import { AddAccessorioOverlay } from './addAccessorio';
import { AddConsumabileOverlay } from './addConsumabile';
import { FaTrash, FaEdit } from 'react-icons/fa';
import { GiSpellBook, GiMagicSwirl } from "react-icons/gi";

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
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [dadiAnima, setDadiAnima] = useState(null);
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  const dismissTimeoutRef = useRef(null);
  const hasImage = spell.image_url && spell.image_url.trim() !== "";

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
  }, []);
  // Calculate overlay position when hovered and not expanded.
  useEffect(() => {
    if (isHovered && !isExpanded && cardRef.current && !overlayDismissed) {
      const cardRect = cardRef.current.getBoundingClientRect();
      const top = cardRect.top - 75; // Adjust vertically to center
      const left = cardRect.left - 330; // Position to the left of the card with gap
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
        setIsHovered(false);
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
    } else {
      return {
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: "translate(0, 0)",
        width: "320px",
        height: "350px",
        background: "rgba(10,10,20,0.97)",
        backdropFilter: "blur(4px)",        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        transformOrigin: "right center",
        transition: "all 0.3s ease-out"
      };
    }
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
  }, [spell, userData, dadiAnima]);  return (
    <div
      className="relative rounded-md transition-all duration-300 cursor-pointer w-full"
      style={{ aspectRatio: "1", minHeight: "80px", maxHeight: "120px" }}
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
            <GiSpellBook className="w-8 h-8 text-gray-400" />
          </div>
        )}

        {/* Name overlay (always visible) */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-1">
          <h3 className="text-white font-bold text-center text-xs">
            {spell.Nome || spellName}
          </h3>
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
            {/* Nuovo campo Turni posizionato sotto il nome dell'incantesimo e la linea */}
            <div className={`text-center -mt-3 mb-2 ${isExpanded ? 'text-xs' : 'text-[10px]'} text-gray-400`}>
              Turni: {spell.Turni || "---"} | Gittata: {spell.Gittata || "---"}
            </div>
            
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-black/50 p-2 rounded">
                <p className={`text-indigo-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'}`}>Costo</p>
                <p className={`text-gray-200 ${isExpanded ? 'text-base' : 'text-sm'}`}>{spell.Costo}</p>
              </div>
              <div className="bg-black/50 p-2 rounded col-span-2">
                <p className={`text-indigo-300 font-bold ${isExpanded ? 'text-base' : 'text-sm'}`}>Esperienza</p>
                <p className={`text-gray-200 ${isExpanded ? 'text-base' : 'text-sm'}`}>{spell.Esperienza || "---"}</p>
              </div>
            </div>
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
          </div>
        </div>
      )}

      {/* Backdrop when expanded */}
      {isExpanded && (
        <div className="fixed inset-0 bg-black/50 z-[90] transition-opacity duration-300 ease-in-out"></div>
      )}
    </div>
  );
};

export default function ComparisonPanel({ item, showMessage }) {
  const { user } = useContext(AuthContext);
  /* ----------------------------------------------------------------------- */
  /*  Local state                                                            */
  /* ----------------------------------------------------------------------- */
  const [userData, setUserData]      = useState(null);
  const [userParams, setUserParams]  = useState({ Base: {}, Combattimento: {} });
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [showEditOverlay, setShowEditOverlay] = useState(false);
  const [imageError, setImageError]  = useState(false);
  const [schema, setSchema] = useState(null);
  const [isSchemaLoading, setIsSchemaLoading] = useState(false);

  /* ----------------------------------------------------------------------- */
  /*  Fetch user & params                                                    */
  /* ----------------------------------------------------------------------- */
  useEffect(() => {
    if (!user) {
      setUserData(null);
      setUserParams({ Base: {}, Combattimento: {} });
      return;
    }

    const userRef = doc(db, 'users', user.uid);

    const unsubscribeUser = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          setUserData(snap.data());
          setUserParams(snap.data().Parametri || { Base: {}, Combattimento: {} });
        }
      },
      (err) => {
        console.error('Error fetching user data:', err);
        setUserData(null);
        setUserParams({ Base: {}, Combattimento: {} });
      }
    );

    // one-off fetch in case Params aren’t in the real-time payload yet
    (async () => {
      try {
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
          setUserParams(docSnap.data().Parametri || { Base: {}, Combattimento: {} });
        }
      } catch (e) {
        console.error('Error fetching user parameters', e);
      }
    })();    return () => unsubscribeUser();
  }, [user]);

  /* ----------------------------------------------------------------------- */
  /*  Fetch schema based on item type                                        */
  /* ----------------------------------------------------------------------- */
  useEffect(() => {
    const fetchSchema = async () => {
      if (!item?.item_type) {
        setSchema(null);
        return;
      }

      setIsSchemaLoading(true);
      try {
        const schemaDocRef = doc(db, "utils", `schema_${item.item_type}`);
        const docSnap = await getDoc(schemaDocRef);
        if (docSnap.exists()) {
          setSchema(docSnap.data());
        } else {
          console.warn(`Schema for item type "${item.item_type}" not found.`);
          setSchema(null);
        }
      } catch (error) {
        console.error(`Error fetching schema for item type "${item.item_type}":`, error);
        setSchema(null);
      } finally {
        setIsSchemaLoading(false);
      }
    };

    fetchSchema();
  }, [item?.item_type]);

  /* ----------------------------------------------------------------------- */
  /*  Helpers & derived data                                                 */
  /* ----------------------------------------------------------------------- */
  const general        = item.General   || {};
  const specific       = item.Specific  || {};
  const parametri      = item.Parametri || {};
  const baseParams     = parametri.Base         || {};
  const combatParams   = parametri.Combattimento|| {};
  const specialParams  = parametri.Special      || {};
  const ridCostoTecSingola = general.ridCostoTecSingola || {};
  const ridCostoSpellSingola = general.ridCostoSpellSingola || {};

  const imageUrl = general.image_url;
  const itemName = general.Nome || 'Oggetto Sconosciuto';

  // pre-load image to detect 404s
  useEffect(() => {
    setImageError(false);
    if (!imageUrl) { setImageError(true); return; }

    const img = new Image();
    img.onload  = () => setImageError(false);
    img.onerror = () => {
      console.warn(`Failed to load image: ${imageUrl}`);
      setImageError(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  /* ----------------------------------------------------------------------- */
  /*  Table rendering helpers                                                */
  /* ----------------------------------------------------------------------- */
  const renderRow = (data, computable = false) =>
    ['1', '4', '7', '10'].map((col) => (
      <td key={col} className="border border-gray-700 px-2 py-1 text-center text-xs">
        {data && data[col] != null && String(data[col]).trim() !== '' ? (
          <>
            {data[col]}
            {computable && userParams && (
              <span className="ml-1 text-gray-400">
                ({computeValue(data[col], userParams)})
              </span>
            )}
          </>
        ) : (
          '-'
        )}
      </td>
    ));

  const shouldShowRow = (data) =>
    !!data && ['1', '4', '7', '10'].some(
      (col) => data[col] != null && String(data[col]).trim() !== ''
    );
  // Generate special group dynamically from actual specialParams keys
  const specialGroup = Object.keys(specialParams).map(key => ({
    key,
    label: key === 'ridCostoSpell' ? 'Rid. Costo Spell' : 
           key === 'ridCostoTec' ? 'Rid. Costo Tec' : 
           key // Use the key as label for other fields
  }));

  const baseGroup = [
    { key: 'Forza', label: 'Forza' },
    { key: 'Destrezza', label: 'Destrezza' },
    { key: 'Costituzione', label: 'Costituzione' },
    { key: 'Intelligenza', label: 'Intelligenza' },
    { key: 'Saggezza', label: 'Saggezza' },
    { key: 'Fortuna', label: 'Fortuna' },
  ];
  const combatGroup = [
    { key: 'Attacco', label: 'Attacco' },
    { key: 'Difesa', label: 'Difesa' },
    { key: 'Mira', label: 'Mira' },
    { key: 'Disciplina', label: 'Disciplina' },
    { key: 'Salute', label: 'Salute' },
    { key: 'Critico', label: 'Critico' },
    { key: 'RiduzioneDanni', label: 'Riduz. Danni' },
  ];
  const filteredSpecialGroup  = specialGroup.filter((f) => shouldShowRow(specialParams[f.key]));
  const filteredBaseGroup     = baseGroup.filter((f) => shouldShowRow(baseParams[f.key]));
  const filteredCombatGroup   = combatGroup.filter((f) => shouldShowRow(combatParams[f.key]));

  /* ----------------------------------------------------------------------- */
  /*  Dynamic field rendering for Specific section                          */
  /* ----------------------------------------------------------------------- */
  const renderSpecificFields = () => {
    if (isSchemaLoading) {
      return (
        <p className="text-sm text-gray-400">Caricamento campi specifici...</p>
      );
    }

    if (!schema?.Specific) {
      // Fallback to hardcoded fields if no schema
      return (
        <>
          <p>
            <span className="font-semibold text-gray-100">Tipo:</span>{' '}
            {specific.Tipo || '-'}
          </p>
          <p>
            <span className="font-semibold text-gray-100">Hands:</span>{' '}
            {specific.Hands != null ? specific.Hands : '-'}
          </p>
        </>
      );
    }

    // Render fields dynamically based on schema
    return Object.keys(schema.Specific).map((fieldKey) => {
      const fieldValue = specific[fieldKey];
      const displayValue = fieldValue != null ? fieldValue : '-';
      
      return (
        <p key={fieldKey}>
          <span className="font-semibold text-gray-100">{fieldKey}:</span>{' '}
          {displayValue}
        </p>
      );
    });
  };

  /* ----------------------------------------------------------------------- */
  /*  Delete & edit handlers                                                 */
  /* ----------------------------------------------------------------------- */
  const handleDeleteClick   = () => setShowDeleteConfirmation(true);
  const handleCancelDelete  = () => setShowDeleteConfirmation(false);

  const handleConfirmDelete = async () => {
    setShowDeleteConfirmation(false);
    console.log(`Attempting to delete item: ${item.id} (${itemName})`);

    try {
      // delete item image
      if (imageUrl) {
        try {
          const path = decodeURIComponent(imageUrl.split('/o/')[1].split('?')[0]);
          await deleteObject(ref(storage, path));
          console.log(`Deleted item image: ${path}`);
        } catch (e) {
          console.warn(
            `Failed to delete item image for "${itemName}":`,
            e.code === 'storage/object-not-found' ? 'File not found.' : e.message
          );
        }
      }

      // delete spell assets if any
      const itemSpells = general.spells;
      if (itemSpells && typeof itemSpells === 'object') {
        for (const spellName in itemSpells) {
          const spell = itemSpells[spellName];
          if (!spell || typeof spell !== 'object') continue;

          const maybeDelete = async (url, desc) => {
            if (!url) return;
            try {
              const p = decodeURIComponent(url.split('/o/')[1].split('?')[0]);
              await deleteObject(ref(storage, p));
              console.log(`Deleted ${desc}: ${p}`);
            } catch (err) {
              console.warn(
                `Failed to delete ${desc} for "${spellName}":`,
                err.code === 'storage/object-not-found' ? 'File not found.' : err.message
              );
            }
          };

          await maybeDelete(spell.image_url, 'spell image');
          await maybeDelete(spell.video_url, 'spell video');
        }
      }

      // delete firestore doc
      await deleteDoc(doc(db, 'items', item.id));
      console.log('Item document deleted successfully from Firestore.');
      showMessage?.(`"${itemName}" eliminato con successo.`);
    } catch (err) {
      console.error('Error deleting item:', err);
      showMessage?.(`Errore durante l'eliminazione di "${itemName}".`);
    }
  };

  const handleEditClick       = () => setShowEditOverlay(true);
  const handleCloseEditOverlay = () => setShowEditOverlay(false);

  const isAdmin = userData?.role === 'webmaster' || userData?.role === 'dm';

  /* ----------------------------------------------------------------------- */
  /*  Render                                                                 */
  /* ----------------------------------------------------------------------- */
  return (
    <>
      {/* MAIN WRAPPER — now with the ​old​ full-panel image style */}
      <div
        className={`
          w-full h-full p-0 overflow-y-auto rounded-l-lg shadow-2xl border-l border-gray-700
          flex flex-col relative group bg-gray-900
        `}
      >
        {/* ----------------------------------------------------------------- */}
        {/*  FULL-PANEL BACKGROUND IMAGE (from old version)                   */}
        {/* ----------------------------------------------------------------- */}
        {!imageError && imageUrl ? (
          <div
            className="
              absolute inset-0 bg-cover bg-center
              transition-transform duration-300 ease-in-out
            "
            style={{ backgroundImage: `url(${imageUrl})` }}
          />
        ) : (
          <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
            <div className="text-6xl text-gray-600 font-bold opacity-50 select-none">
              {itemName?.charAt(0)?.toUpperCase() || '?'}
            </div>
          </div>
        )}

        {/* dark overlay & gradient (old style) */}
        <div className="absolute inset-0 bg-black opacity-70 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-gray-900 pointer-events-none" />

        {/* ----------------------------------------------------------------- */}
        {/*  ADMIN ACTION BUTTONS                                             */}
        {/* ----------------------------------------------------------------- */}
        {isAdmin && (
          <div className="absolute top-3 right-3 z-40 flex space-x-2">
            <button
              onClick={handleEditClick}
              title="Modifica Oggetto"
              className="p-1.5 bg-gray-700 bg-opacity-70 rounded-full hover:bg-blue-600 transition-colors"
            >
              <FaEdit className="w-4 h-4 text-blue-300 hover:text-white" />
            </button>
            <button
              onClick={handleDeleteClick}
              title="Elimina Oggetto"
              className="p-1.5 bg-gray-700 bg-opacity-70 rounded-full hover:bg-red-600 transition-colors"
            >
              <FaTrash className="w-4 h-4 text-red-400 hover:text-white" />
            </button>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/*  DELETE CONFIRMATION (on top of everything)                       */}
        {/* ----------------------------------------------------------------- */}
        {showDeleteConfirmation && (
          <div className="absolute inset-0 flex items-center justify-center z-50 bg-black bg-opacity-80 p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 text-center">
              <p className="text-white mb-4">
                Sei sicuro di voler eliminare <br />
                "{itemName}"?
              </p>
              <div className="flex justify-center space-x-3">
                <button
                  onClick={handleCancelDelete}
                  className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                >
                  Elimina
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/*  CONTENT AREA                                                     */}
        {/* ----------------------------------------------------------------- */}
        <div className="relative z-20 p-4 pt-2 flex-grow overflow-y-auto">
          <h2 className="text-xl font-bold text-white mb-3">{itemName}</h2>          {/* BASIC INFO ----------------------------------------------------- */}
          <div className="mb-4 space-y-1 text-sm text-gray-300">
            {/* Dynamic Specific fields */}
            {renderSpecificFields()}
            
            {/* General fields (consistent across item types) */}
            <p>
              <span className="font-semibold text-gray-100">Slot:</span>{' '}
              {general.Slot || '-'}
            </p>
            <p>
              <span className="font-semibold text-gray-100">Effetto:</span>{' '}
              {general.Effetto || '-'}
            </p>
            <p>
              <span className="font-semibold text-gray-100">Requisiti:</span>{' '}
              {general.requisiti || '-'}
            </p>
            <p>
              <span className="font-semibold text-gray-100">Prezzo:</span>{' '}
              {general.prezzo != null ? general.prezzo : '-'}
            </p>
          </div>

          {/* PARAMETERS TABLE ---------------------------------------------- */}
          {(filteredSpecialGroup.length ||
            filteredBaseGroup.length ||
            filteredCombatGroup.length) > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs text-white border-collapse border border-gray-700">
                <thead>
                  <tr className="bg-gray-700/50">
                    <th className="px-2 py-1 text-left font-semibold border-r border-gray-700">
                      Parametro
                    </th>
                    <th className="border-r border-gray-700 px-2 py-1 font-semibold">
                      Lvl&nbsp;1
                    </th>
                    <th className="border-r border-gray-700 px-2 py-1 font-semibold">
                      Lvl&nbsp;4
                    </th>
                    <th className="border-r border-gray-700 px-2 py-1 font-semibold">
                      Lvl&nbsp;7
                    </th>
                    <th className="px-2 py-1 font-semibold">Lvl&nbsp;10</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSpecialGroup.length > 0 && (
                    <>
                      <tr className="bg-gray-800/30">
                        <td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">
                          Speciali
                        </td>
                      </tr>
                      {filteredSpecialGroup.map((f) => (
                        <tr
                          key={`special-${f.key}`}
                          className="border-b border-gray-700 hover:bg-gray-700/30"
                        >
                          <td className="px-2 py-1 border-r border-gray-700">{f.label}</td>
                          {renderRow(specialParams[f.key], false)}
                        </tr>
                      ))}
                    </>
                  )}

                  {filteredBaseGroup.length > 0 && (
                    <>
                      <tr className="bg-gray-800/30">
                        <td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">
                          Base
                        </td>
                      </tr>
                      {filteredBaseGroup.map((f) => (
                        <tr
                          key={`base-${f.key}`}
                          className="border-b border-gray-700 hover:bg-gray-700/30"
                        >
                          <td className="px-2 py-1 border-r border-gray-700">{f.label}</td>
                          {renderRow(baseParams[f.key], true)}
                        </tr>
                      ))}
                    </>
                  )}

                  {filteredCombatGroup.length > 0 && (
                    <>
                      <tr className="bg-gray-800/30">
                        <td colSpan="5" className="px-2 py-0.5 font-medium text-gray-300">
                          Combattimento
                        </td>
                      </tr>
                      {filteredCombatGroup.map((f) => (
                        <tr
                          key={`combat-${f.key}`}
                          className="border-b border-gray-700 hover:bg-gray-700/30"
                        >
                          <td className="px-2 py-1 border-r border-gray-700">{f.label}</td>
                          {renderRow(combatParams[f.key], true)}
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* SPECIFIC COST REDUCTION FOR TECHNIQUES -------------------------- */}
          {Object.keys(ridCostoTecSingola).length > 0 && (
            <div className="mt-4">
              <h3 className="text-md font-semibold text-white mb-2">Riduzione Costo Tecniche</h3>
              <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                {Object.entries(ridCostoTecSingola).map(([tecName, costReduction]) => (
                  <li key={`tec-${tecName}`}>
                    {tecName}
                    <span className="text-xs text-gray-400 ml-2">
                      (Riduzione: {costReduction})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* SPECIFIC COST REDUCTION FOR SPELLS ----------------------------- */}
          {Object.keys(ridCostoSpellSingola).length > 0 && (
            <div className="mt-4">
              <h3 className="text-md font-semibold text-white mb-2">Riduzione Costo Spell</h3>
              <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                {Object.entries(ridCostoSpellSingola).map(([spellName, costReduction]) => (
                  <li key={`spell-${spellName}`}>
                    {spellName}
                    <span className="text-xs text-gray-400 ml-2">
                      (Riduzione: {costReduction})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}          {/* SPELLS --------------------------------------------------------- */}
          {general.spells && Object.keys(general.spells).length > 0 && (
            <div className="mt-4">
              <h3 className="text-md font-semibold text-white mb-2">Item Spells</h3>              {/* Spell Tiles Grid */}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 mb-3 auto-rows-fr">
                {Object.entries(general.spells)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([spellName, spellData]) => (
                  <SpellCard
                    key={spellName}
                    spellName={spellName}
                    spell={spellData}
                    userData={userData}
                  />                ))}
              </div>
            </div>
          )}
        </div>
      </div>      {/* EDIT OVERLAY ------------------------------------------------------- */}
      {showEditOverlay && (
        <>
          {item?.item_type === 'armatura' ? (
            <AddArmaturaOverlay
              onClose={handleCloseEditOverlay}
              showMessage={showMessage || console.log}
              initialData={item}
              editMode={true}
            />
          ) : item?.item_type === 'accessorio' ? (
            <AddAccessorioOverlay
              onClose={handleCloseEditOverlay}
              showMessage={showMessage || console.log}
              initialData={item}
              editMode={true}
            />
          ) : item?.item_type === 'consumabile' ? (
            <AddConsumabileOverlay
              onClose={handleCloseEditOverlay}
              showMessage={showMessage || console.log}
              initialData={item}
              editMode={true}
            />
          ) : (
            <AddWeaponOverlay
              onClose={handleCloseEditOverlay}
              showMessage={showMessage || console.log}
              initialData={item}
              editMode={true}
            />
          )}
        </>
      )}
    </>
  );
}
