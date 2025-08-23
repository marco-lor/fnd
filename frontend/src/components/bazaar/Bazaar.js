// file: ./frontend/src/components/bazaar/Bazaar.js
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import InteractiveBackground from '../backgrounds/InteractiveBackground';
import { collection, onSnapshot, query, where, or, and } from "firebase/firestore";
import { db } from '../firebaseConfig';
import { useAuth } from '../../AuthContext';
import { AddWeaponOverlay } from './elements/addWeapon';
import { AddArmaturaOverlay } from './elements/addArmatura';
import { AddAccessorioOverlay } from './elements/addAccessorio';
import { AddConsumabileOverlay } from './elements/addConsumabile';
import ComparisonPanel from './elements/comparisonComponent';
import { acquireItem } from './elements/acquireItem';
import PurchaseConfirmModal from './elements/PurchaseConfirmModal';
import FiltersSection from './elements/FiltersSection';

function ItemCard({ item, onPurchase, onHoverItem, onLockToggle, isLocked, purchasing, userGold }) {
  const [imageError, setImageError] = useState(false);
  const title = item.General?.Nome || 'Oggetto Sconosciuto';
  const imageUrl = item.General?.image_url;
  const slot = item.General?.Slot || '-';
  const tipo = item.Specific?.Tipo || '-';
  const hands = item.Specific?.Hands != null ? item.Specific.Hands : '-';
  const rawPrice = item?.General?.prezzo ?? 0;
  const price = typeof rawPrice === 'number' ? rawPrice : parseInt(rawPrice, 10) || 0;
  const affordable = (userGold ?? 0) >= price;

  useEffect(() => {
     setImageError(false);
     if (!imageUrl) {
        setImageError(true);
     }
  }, [imageUrl]);

  return (
    <motion.div
      className={`flex items-center p-2 bg-gray-800 bg-opacity-80 shadow rounded-lg transition-colors cursor-pointer relative group
        ${isLocked ? 'border-2 border-blue-500' : 'border border-gray-700/60'}
        ${!affordable && price > 0 ? 'opacity-60 grayscale-[35%] hover:opacity-75' : 'hover:bg-gray-700'}
      `}
      whileHover={{ scale: 1.02 }}
      onMouseEnter={() => onHoverItem(item)}
      onMouseLeave={() => onHoverItem(null)}
      onClick={onLockToggle}
    >
      {imageUrl && !imageError ? (
        <img
          src={imageUrl}
          alt={title}
          className="w-16 h-16 object-cover rounded-lg mr-4"
          onError={() => {
               console.warn(`Failed to load image in ItemCard: ${imageUrl}`);
               setImageError(true);
          }}
        />
      ) : (
        <div className="w-16 h-16 bg-gray-600 rounded-lg mr-4 flex items-center justify-center text-white text-xs text-center font-bold">
          {title?.charAt(0)?.toUpperCase() || "?"}
        </div>
      )}
      <div className="flex-grow pr-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-white truncate" title={title}>{title}</h2>
          {price > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded-full border
              ${affordable ? 'bg-emerald-600/30 border-emerald-400/40 text-emerald-200' : 'bg-rose-700/30 border-rose-500/40 text-rose-200'}
            `} title={affordable ? 'Puoi permettertelo' : 'Oro insufficiente'}>
              {price}
            </span>
          )}
        </div>
        <p className="text-xs mt-0.5 text-gray-300">
          Slot: {slot} | Tipo: {tipo} | Hands: {hands}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!purchasing && affordable) onPurchase(item);
        }}
        disabled={purchasing || (!affordable && price > 0)}
        className={`px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap
          ${purchasing ? 'bg-gray-500 cursor-not-allowed opacity-60 text-white'
            : !affordable && price > 0 ? 'bg-gray-700/60 text-gray-300 cursor-not-allowed border border-gray-600'
            : 'bg-[rgba(25,50,128,0.55)] text-white hover:bg-[rgba(35,60,148,0.7)]'}
        `}
        title={purchasing ? 'Acquisto in corso...' : (!affordable && price > 0 ? 'Oro insufficiente' : 'Acquista')}
      >
        {purchasing ? '...' : (!affordable && price > 0 ? 'No Gold' : 'Acquire')}
      </button>
      {!affordable && price > 0 && (
        <div className="absolute inset-0 pointer-events-none rounded-lg border border-rose-600/20" />
      )}
    </motion.div>
  );
}


export default function Bazaar() {  const [items, setItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(['All']);
  const [selectedHands, setSelectedHands] = useState(['All']);
  const [selectedTipo, setSelectedTipo] = useState(['All']);
  const [selectedItemType, setSelectedItemType] = useState(['All']);  const [selectedCombatParams, setSelectedCombatParams] = useState(['All']);
  const [selectedBaseParams, setSelectedBaseParams] = useState(['All']);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [lockedItem, setLockedItem] = useState(null);
  const [onlyAffordable, setOnlyAffordable] = useState(false);

  const [showOverlay, setShowOverlay] = useState(false);
  const [showArmaturaOverlay, setShowArmaturaOverlay] = useState(false);
  const [showAccessorioOverlay, setShowAccessorioOverlay] = useState(false);
  const [showConsumabileOverlay, setShowConsumabileOverlay] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const { user, userData } = useAuth();
  const [purchasingItemId, setPurchasingItemId] = useState(null);
  const [pendingPurchaseItem, setPendingPurchaseItem] = useState(null);
  const isAdmin = userData?.role === 'webmaster' || userData?.role === 'dm';
  const isDM = userData?.role === 'dm'; // DMs can see all items regardless of custom visibility

  // Listen to items respecting visibility
  useEffect(() => {
    if (!user) return;

    const itemsRef = collection(db, 'items');

    // If the user is a DM they can see ALL items (except schema docs) without visibility filtering
    // Otherwise apply existing visibility rules: 'all' OR ('custom' AND allowed_users contains user)
    const buildUnsubscribe = () => {
      if (isDM) {
        return onSnapshot(
          itemsRef,
          (snapshot) => {
            const allItems = [];
            snapshot.forEach((doc) => {
              const data = doc.data();
              if (data.item_type && data.General && data.Specific && data.Parametri && !doc.id.startsWith('schema_')) {
                allItems.push({ id: doc.id, ...data });
              }
            });
            setItems(allItems);
          },
          (error) => {
            console.error('Error listening to items collection (DM view):', error);
          }
        );
      } else {
        const q = query(
          itemsRef,
            or(
              where('visibility', '==', 'all'),
              and(
                where('visibility', '==', 'custom'),
                where('allowed_users', 'array-contains', user.uid)
              )
            )
        );
        return onSnapshot(
          q,
          (snapshot) => {
            const filteredItems = [];
            snapshot.forEach((doc) => {
              const data = doc.data();
              if (data.item_type && data.General && data.Specific && data.Parametri && !doc.id.startsWith('schema_')) {
                filteredItems.push({ id: doc.id, ...data });
              }
            });
            setItems(filteredItems);
          },
          (error) => {
            console.error('Error listening to items collection:', error);
          }
        );
      }
    };

    const unsubscribe = buildUnsubscribe();
    return () => unsubscribe();
  }, [user, isDM]);

  useEffect(() => {
    const currentLockedItemId = lockedItem?.id;
    if (currentLockedItemId) {
      const newVersionOfLockedItem = items.find(item => item.id === currentLockedItemId);
      if (newVersionOfLockedItem) {
        if (JSON.stringify(newVersionOfLockedItem) !== JSON.stringify(lockedItem)) {
          setLockedItem(newVersionOfLockedItem);
        }
      } else {
        setLockedItem(null);
        if (hoveredItem && hoveredItem.id === currentLockedItemId) {
          setHoveredItem(null);
        }
      }
    }
  }, [items, lockedItem?.id, hoveredItem]);
  const slots = ['All', ...Array.from(new Set(items.map(item => item.General?.Slot).filter(Boolean)))];
  const hands = ['All', ...Array.from(new Set(items.map(item => item.Specific?.Hands).filter(h => h != null))).sort((a, b) => a - b).map(String)];
  const tipos = ['All', ...Array.from(new Set(items.map(item => item.Specific?.Tipo).filter(Boolean)))];
  const itemTypes = ['All', ...Array.from(new Set(items.map(item => item.item_type).filter(Boolean)))];  const combatParams = ['All', ...Array.from(new Set(items.flatMap(item => 
    item.Parametri?.Combattimento ? Object.keys(item.Parametri.Combattimento) : []
  )))];
  
  const baseParams = ['All', ...Array.from(new Set(items.flatMap(item => 
    item.Parametri?.Base ? Object.keys(item.Parametri.Base) : []
  )))];
    // Debug logging for combat params (remove after testing)
  useEffect(() => {
    if (selectedCombatParams.length > 0 && !selectedCombatParams.includes('All')) {
      console.log('Selected combat params:', selectedCombatParams);
      console.log('Available combat params:', combatParams);
      const sampleItem = items.find(item => item.Parametri?.Combattimento);
      if (sampleItem) {
        console.log('Sample item combat params:', sampleItem.Parametri.Combattimento);
      }
    }
    if (selectedBaseParams.length > 0 && !selectedBaseParams.includes('All')) {
      console.log('Selected base params:', selectedBaseParams);
      console.log('Available base params:', baseParams);
      const sampleItem = items.find(item => item.Parametri?.Base);
      if (sampleItem) {
        console.log('Sample item base params:', sampleItem.Parametri.Base);
      }
    }
  }, [selectedCombatParams, selectedBaseParams, combatParams, baseParams, items]);

  // Generic toggle utility and specific handlers (restored after refactor)
  const toggleFilter = (currentFilters, setFilters, value) => {
    if (value === 'All') {
      setFilters(['All']);
    } else {
      const filtersWithoutAll = currentFilters.filter(f => f !== 'All');
      if (filtersWithoutAll.includes(value)) {
        const newFilters = filtersWithoutAll.filter(v => v !== value);
        setFilters(newFilters.length === 0 ? ['All'] : newFilters);
      } else {
        setFilters([...filtersWithoutAll, value]);
      }
    }
  };

  const handleToggleSlot = (slot) => toggleFilter(selectedSlot, setSelectedSlot, slot);
  const handleToggleHands = (hand) => toggleFilter(selectedHands, setSelectedHands, hand);
  const handleToggleTipo = (tipo) => toggleFilter(selectedTipo, setSelectedTipo, tipo);
  const handleToggleItemType = (itemType) => toggleFilter(selectedItemType, setSelectedItemType, itemType);
  const handleToggleCombatParam = (param) => toggleFilter(selectedCombatParams, setSelectedCombatParams, param);
  const handleToggleBaseParam = (param) => toggleFilter(selectedBaseParams, setSelectedBaseParams, param);
  const handleSearchChange = (e) => setSearchTerm(e.target.value);

  const handleHoverItem = (item) => {
    if (!lockedItem) {
      setHoveredItem(item);
    }
  };

   const handleLockToggle = (itemToToggle) => {
       if (lockedItem && lockedItem.id === itemToToggle.id) {
           setLockedItem(null);
           setHoveredItem(itemToToggle);
       } else {
           setLockedItem(itemToToggle);
           setHoveredItem(null);
       }
   };   const filteredItems = items.filter((item) => {
    const matchesSearch = searchTerm.trim() === '' ||
      (item.General?.Nome && item.General.Nome.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesSlot = selectedSlot.includes('All') || selectedSlot.includes(item.General?.Slot);
    const matchesHands = selectedHands.includes('All') || selectedHands.includes(String(item.Specific?.Hands));
    const matchesTipo = selectedTipo.includes('All') || selectedTipo.includes(item.Specific?.Tipo);
    const matchesItemType = selectedItemType.includes('All') || selectedItemType.includes(item.item_type);    
    const userGold = userData?.stats?.gold ?? 0;
    const rawPrice = item?.General?.prezzo ?? 0;
    const price = typeof rawPrice === 'number' ? rawPrice : parseInt(rawPrice, 10) || 0;
    const matchesAffordable = !onlyAffordable || price <= userGold;
    return matchesSearch && matchesSlot && matchesHands && matchesTipo && matchesItemType && matchesAffordable;}).sort((a, b) => {
    // Debug: Log when sorting is triggered
    const shouldSortCombat = !selectedCombatParams.includes('All') && selectedCombatParams.length > 0;
    const shouldSortBase = !selectedBaseParams.includes('All') && selectedBaseParams.length > 0;
    const shouldSort = shouldSortCombat || shouldSortBase;
    
    if (shouldSort) {
      console.log('Attempting to sort by params - Combat:', selectedCombatParams, 'Base:', selectedBaseParams);
    }
    
    // If parameters are selected for sorting, sort by their contribution at level 1
    if (shouldSort) {
      let scoreA = 0;
      let scoreB = 0;
      
      // Add combat parameter scores
      if (shouldSortCombat) {
        selectedCombatParams.forEach(param => {
          let valueA = 0;
          let valueB = 0;
          
          if (a.Parametri?.Combattimento?.[param]) {
            const paramDataA = a.Parametri.Combattimento[param];
            valueA = paramDataA?.['1'] || paramDataA?.[1] || 0;
          }
          
          if (b.Parametri?.Combattimento?.[param]) {
            const paramDataB = b.Parametri.Combattimento[param];
            valueB = paramDataB?.['1'] || paramDataB?.[1] || 0;
          }
          
          valueA = typeof valueA === 'number' ? valueA : (parseFloat(valueA) || 0);
          valueB = typeof valueB === 'number' ? valueB : (parseFloat(valueB) || 0);
          
          scoreA += valueA;
          scoreB += valueB;
        });
      }
      
      // Add base parameter scores
      if (shouldSortBase) {
        selectedBaseParams.forEach(param => {
          let valueA = 0;
          let valueB = 0;
          
          if (a.Parametri?.Base?.[param]) {
            const paramDataA = a.Parametri.Base[param];
            valueA = paramDataA?.['1'] || paramDataA?.[1] || 0;
          }
          
          if (b.Parametri?.Base?.[param]) {
            const paramDataB = b.Parametri.Base[param];
            valueB = paramDataB?.['1'] || paramDataB?.[1] || 0;
          }
          
          valueA = typeof valueA === 'number' ? valueA : (parseFloat(valueA) || 0);
          valueB = typeof valueB === 'number' ? valueB : (parseFloat(valueB) || 0);
          
          scoreA += valueA;
          scoreB += valueB;
        });
      }
      
      // Debug logging (remove after testing)
      if (scoreA !== scoreB) {
        console.log(`Sorting: ${a.General?.Nome || 'Unknown'} (${scoreA}) vs ${b.General?.Nome || 'Unknown'} (${scoreB})`);
      }
      
      // Sort by highest score first (descending)
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
    }
    
    // Default sort by name if no combat params selected or scores are equal
    const nameA = (a.General?.Nome || 'Oggetto Sconosciuto').toLowerCase();
    const nameB = (b.General?.Nome || 'Oggetto Sconosciuto').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const displayConfirmation = useCallback((message, type = "success") => {
    setConfirmationMessage(message);
    setShowConfirmation(true);
    setTimeout(() => {
      setShowConfirmation(false);
    }, 2500);
  }, []);

  const startPurchaseFlow = (item) => {
    if (!user) {
      displayConfirmation('Devi essere loggato per acquistare.', 'error');
      return;
    }
  // Stacking allowed: no early return if already owned
    const gold = userData?.stats?.gold ?? 0;
    const rawPrice = item?.General?.prezzo;
    const price = typeof rawPrice === 'number' ? rawPrice : parseInt(rawPrice, 10) || 0;
    if (price > gold) {
      displayConfirmation(`Oro insufficiente: ${gold} / ${price}`, 'error');
      return;
    }
    setPendingPurchaseItem(item);
  };

  const confirmPurchase = async () => {
    const item = pendingPurchaseItem;
    if (!item || !user) { setPendingPurchaseItem(null); return; }
    if (!user) {
      displayConfirmation('Devi essere loggato per acquistare.', 'error');
      return;
    }
    const price = typeof item?.General?.prezzo === 'number' ? item.General.prezzo : parseInt(item?.General?.prezzo, 10) || 0;
    const name = item.General?.Nome || 'Oggetto';
  // Stacking allowed: skip already-owned guard
    const gold = userData?.stats?.gold ?? 0;
    if (price > gold) {
      displayConfirmation(`Oro insufficiente: ${gold} / ${price}`, 'error');
      return;
    }
    try {
      setPurchasingItemId(item.id);
      const res = await acquireItem(user.uid, item);
      if (res?.error) {
        displayConfirmation(`Errore: ${res.error}`, 'error');
      } else if (res?.insufficient) {
        displayConfirmation(`Oro insufficiente: ${res.gold} / ${res.price}`, 'error');
      } else if (res?.success) {
        if (res.newQty && res.newQty > 1) {
          displayConfirmation(`Acquisto completato: ora possiedi ${res.newQty}x "${name}". Oro rimanente: ${res.newGold}`);
        } else {
          displayConfirmation(`Acquisto completato: "${name}". Oro rimanente: ${res.newGold}`);
        }
      } else {
        displayConfirmation('Risposta inattesa dalla transazione.', 'error');
      }
    } catch (e) {
      displayConfirmation(`Errore durante l'acquisto: ${e.message}`, 'error');
    } finally {
      setPurchasingItemId(null);
    setPendingPurchaseItem(null);
    }
  };
  const handleAddWeaponClick = () => {
    setShowOverlay(true);
  };
  const handleAddArmaturaClick = () => {
    setShowArmaturaOverlay(true);
  };
  const handleAddAccessorioClick = () => {
    setShowAccessorioOverlay(true);
  };
  const handleAddConsumabileClick = () => {
    setShowConsumabileOverlay(true);
  };

  const panelItem = lockedItem || hoveredItem;

  // Define width for the comparison panel (used by the fixed motion.div)
  // const comparisonPanelWidth = "w-[80vw] max-w-[98vw] sm:w-[60vw] sm:max-w-[400px] md:w-[38vw] md:max-w-[550px]";
  const comparisonPanelWidth = "w-[95vw] max-w-[99vw] sm:w-[80vw] sm:max-w-[400px] md:w-[38vw] md:max-w-[550px] lg:w-[28vw] lg:max-w-[750px]";

  return (
    <div className="relative w-full min-h-screen flex0 flex-col overflow-hidden">
      <InteractiveBackground />

      {/* Main content area using CSS Grid */}
      {/* Grid columns: Filters (dynamic), Item List (700px), Comparison Panel Area (450px) */}
      <div className="relative z-10 grid grid-cols-[15%_55%_30%] flex-grow items-start">        {/* Filters Panel (Column 1) */}
        <FiltersSection
          slots={slots}
          hands={hands}
          tipos={tipos}
          itemTypes={itemTypes}
          combatParams={combatParams}
          baseParams={baseParams}
          selectedSlot={selectedSlot}
          selectedHands={selectedHands}
          selectedTipo={selectedTipo}
          selectedItemType={selectedItemType}
          selectedCombatParams={selectedCombatParams}
          selectedBaseParams={selectedBaseParams}
          onToggleSlot={handleToggleSlot}
          onToggleHands={handleToggleHands}
          onToggleTipo={handleToggleTipo}
          onToggleItemType={handleToggleItemType}
          onToggleCombatParam={handleToggleCombatParam}
          onToggleBaseParam={handleToggleBaseParam}
          onlyAffordable={onlyAffordable}
          setOnlyAffordable={setOnlyAffordable}
          onResetFilters={() => {
            setSelectedSlot(['All']);
            setSelectedHands(['All']);
            setSelectedTipo(['All']);
            setSelectedItemType(['All']);
            setSelectedCombatParams(['All']);
            setSelectedBaseParams(['All']);
            setSearchTerm('');
            setOnlyAffordable(false);
          }}
        />
        {/* Items List Panel (Column 2) */}
        {/* Width (700px) is controlled by grid-cols. Removed flex-grow, mr-*, and transition classes for width. */}
        <div className="p-6 overflow-y-auto h-screen scrollbar-hidden">
          {isAdmin && (
            <div className="mb-4">
              <div className="flex flex-wrap gap-2">                <button
                  onClick={handleAddWeaponClick}
                  className="px-3 py-1.5 text-sm bg-green-700 text-white rounded hover:bg-green-600 transition-colors"
                >
                  {lockedItem && lockedItem.item_type === "weapon" ? "Modifica Arma" : "+ Arma"}
                </button>
                <button 
                  onClick={handleAddArmaturaClick} 
                  className="px-3 py-1.5 text-sm bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
                > 
                  {lockedItem && lockedItem.item_type === "armatura" ? "Modifica Armatura" : "+ Armatura"}
                </button>
                <button 
                  onClick={handleAddAccessorioClick} 
                  className="px-3 py-1.5 text-sm bg-purple-700 text-white rounded hover:bg-purple-600 transition-colors"
                > 
                  {lockedItem && lockedItem.item_type === "accessorio" ? "Modifica Accessorio" : "+ Accessorio"}
                </button>
                <button
                  onClick={handleAddConsumabileClick}
                  className="px-3 py-1.5 text-sm bg-yellow-700 text-white rounded hover:bg-yellow-600 transition-colors"
                >
                  {lockedItem && lockedItem.item_type === "consumabile" ? "Modifica Consumabile" : "+ Consumabile"}
                </button>
                <button onClick={() => displayConfirmation("Funzionalità Munizione in arrivo!", "info")} className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"> + Munizione </button>
              </div>
            </div>
          )}

          <div className="mb-4">            <input
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Cerca per Nome..."
              className="w-full border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-800 text-white placeholder-gray-500"
            />
          </div>

          <div className="flex flex-col gap-3">
             {filteredItems.length > 0 ? (
                 filteredItems.map((item) => (
           <ItemCard
             key={item.id}
             item={item}
                         onPurchase={startPurchaseFlow}
             onHoverItem={handleHoverItem}
             onLockToggle={() => handleLockToggle(item)}
             isLocked={lockedItem && lockedItem.id === item.id}
             purchasing={purchasingItemId === item.id}
             userGold={userData?.stats?.gold ?? 0}
           />
                 ))
             ) : (
                 <p className="text-center text-gray-400 mt-8">Nessun oggetto trovato corrispondente ai filtri.</p>
             )}
          </div>
        </div>

        {/* Comparison Panel Container (Column 3) */}
        {/* This div occupies the 450px grid column. The ComparisonPanel is fixed-positioned within it. */}
        {/* It needs h-screen to ensure grid row height is consistent if other columns are h-screen. */}
        <div className="h-screen"> {/* Width (450px) is controlled by grid-cols */}
          <AnimatePresence>
            {panelItem && (
              <motion.div
                className={`fixed right-0 top-[16rem] bottom-0 ${comparisonPanelWidth} z-40`} // comparisonPanelWidth defines w-[28vw] max-w-[450px]
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                style={{
                  height: "calc(100vh - 6rem)", // Specific height for the panel
                  overflowY: "auto"
                }}
              >
                <ComparisonPanel
                  item={panelItem}
                  showMessage={displayConfirmation}
                  key={`comparisonPanel-${panelItem.id}`} // Ensure re-render on item change
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>


      {showOverlay && (
        <AddWeaponOverlay
          onClose={(success) => {
            setShowOverlay(false);
          }}
          showMessage={displayConfirmation}
          initialData={lockedItem || null}
          editMode={!!lockedItem}
        />
      )}      {showArmaturaOverlay && (
        <AddArmaturaOverlay
          onClose={(success) => {
            setShowArmaturaOverlay(false);
          }}
          showMessage={displayConfirmation}
          initialData={lockedItem && lockedItem.item_type === "armatura" ? lockedItem : null}
          editMode={!!(lockedItem && lockedItem.item_type === "armatura")}
        />
      )}

      {showAccessorioOverlay && (
        <AddAccessorioOverlay
          onClose={(success) => {
            setShowAccessorioOverlay(false);
          }}
          showMessage={displayConfirmation}
          initialData={lockedItem && lockedItem.item_type === "accessorio" ? lockedItem : null}
          editMode={!!(lockedItem && lockedItem.item_type === "accessorio")}
        />
      )}

      {showConsumabileOverlay && (
        <AddConsumabileOverlay
          onClose={(success) => {
            setShowConsumabileOverlay(false);
          }}
          showMessage={displayConfirmation}
          initialData={lockedItem && lockedItem.item_type === "consumabile" ? lockedItem : null}
          editMode={!!(lockedItem && lockedItem.item_type === "consumabile")}
        />
      )}

      <AnimatePresence>
        {showConfirmation && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50, transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[10000]"
          >
            <div className={`text-white px-6 py-3 rounded-lg shadow-xl text-center ${confirmationMessage.toLowerCase().includes("error") || confirmationMessage.toLowerCase().includes("errore") ? 'bg-gradient-to-r from-red-500 to-red-700' : 'bg-gradient-to-r from-green-500 to-green-700'}`}>
              {confirmationMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Purchase Confirmation Modal */}
      {pendingPurchaseItem && (
        <PurchaseConfirmModal
          item={pendingPurchaseItem}
            userGold={userData?.stats?.gold ?? 0}
          onConfirm={confirmPurchase}
          onClose={() => !purchasingItemId && setPendingPurchaseItem(null)}
          isProcessing={!!purchasingItemId}
        />
      )}
    </div>
  );
}