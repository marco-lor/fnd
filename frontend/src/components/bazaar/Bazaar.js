// file: ./frontend/src/components/bazaar/Bazaar.js
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import InteractiveBackground from '../backgrounds/InteractiveBackground';
import { collection, onSnapshot } from "firebase/firestore";
import { db } from '../firebaseConfig';
import { useAuth } from '../../AuthContext';
import { AddWeaponOverlay } from './elements/addWeapon';
import ComparisonPanel from './elements/comparisonComponent';

function ItemCard({ item, onPurchase, onHoverItem, onLockToggle, isLocked }) {
  const [imageError, setImageError] = useState(false);
  const title = item.General?.Nome || 'Oggetto Sconosciuto';
  const imageUrl = item.General?.image_url;
  const slot = item.General?.Slot || '-';
  const tipo = item.Specific?.Tipo || '-';
  const hands = item.Specific?.Hands != null ? item.Specific.Hands : '-';

  useEffect(() => {
     setImageError(false);
     if (!imageUrl) {
        setImageError(true);
     }
  }, [imageUrl]);

  return (
    <motion.div
      className={`flex items-center p-2 bg-gray-800 bg-opacity-80 shadow rounded-lg hover:bg-gray-700 transition-colors cursor-pointer ${isLocked ? 'border-2 border-blue-500' : ''}`}
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
      <div className="flex-grow">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <p className="text-sm text-gray-300">
          Slot: {slot} | Tipo: {tipo} | Hands: {hands}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPurchase(item);
        }}
        className="px-3 py-1 rounded bg-[rgba(25,50,128,0.4)] text-white hover:bg-[rgba(35,60,148,0.6)] transition-colors"
      >
        Acquire
      </button>
    </motion.div>
  );
}


export default function Bazaar() {
  const [items, setItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(['All']);
  const [selectedHands, setSelectedHands] = useState(['All']);
  const [selectedTipo, setSelectedTipo] = useState(['All']);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [lockedItem, setLockedItem] = useState(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState("");

  const { user, userData } = useAuth();

  useEffect(() => {
    const itemsRef = collection(db, "items");
    const unsubscribe = onSnapshot(
      itemsRef,
      (snapshot) => {
        const fetchedItems = [];
        snapshot.forEach((doc) => {
           const data = doc.data();
           if (data.item_type === 'weapon' && data.General && data.Specific && data.Parametri) {
              fetchedItems.push({ id: doc.id, ...data });
           } else if (data.item_type !== 'weapon' && !doc.id.startsWith('schema_')) {
               // console.log(`Item ${doc.id} skipped (not a weapon or invalid structure).`);
           }
        });
        setItems(fetchedItems);
        // console.log("Bazaar: Items fetched/updated from Firestore", fetchedItems.length);
      },
      (error) => {
        console.error("Error listening to items collection:", error);
      }
    );
    return () => unsubscribe();
  }, []);

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

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };

  const toggleFilter = (currentFilters, setFilters, value) => {
    if (value === 'All') {
      setFilters(['All']);
    } else {
      const filtersWithoutAll = currentFilters.filter(f => f !== 'All');
      if (filtersWithoutAll.includes(value)) {
        const newFilters = filtersWithoutAll.filter((v) => v !== value);
        setFilters(newFilters.length === 0 ? ['All'] : newFilters);
      } else {
        setFilters([...filtersWithoutAll, value]);
      }
    }
  };

  const handleToggleSlot = (slot) => toggleFilter(selectedSlot, setSelectedSlot, slot);
  const handleToggleHands = (hand) => toggleFilter(selectedHands, setSelectedHands, hand);
  const handleToggleTipo = (tipo) => toggleFilter(selectedTipo, setSelectedTipo, tipo);

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
   };

  const filteredItems = items.filter((item) => {
    const matchesSearch = searchTerm.trim() === '' ||
      (item.General?.Nome && item.General.Nome.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Specific?.Tipo && item.Specific.Tipo.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesSlot = selectedSlot.includes('All') || selectedSlot.includes(item.General?.Slot);
    const matchesHands = selectedHands.includes('All') || selectedHands.includes(String(item.Specific?.Hands));
    const matchesTipo = selectedTipo.includes('All') || selectedTipo.includes(item.Specific?.Tipo);

    return matchesSearch && matchesSlot && matchesHands && matchesTipo;
  });

  const displayConfirmation = (message, type = "success") => {
    setConfirmationMessage(message);
    setShowConfirmation(true);
    setTimeout(() => {
      setShowConfirmation(false);
    }, 2500);
  };

  const handlePurchase = (item) => {
    displayConfirmation(`"${item.General?.Nome || 'Oggetto'}" Acquistato!`);
  };

  const handleAddWeaponClick = () => {
    setShowOverlay(true);
  };

  const panelItem = lockedItem || hoveredItem;
  const isAdmin = userData?.role === 'webmaster' || userData?.role === 'dm';

  // Define width for the comparison panel (used by the fixed motion.div)
  // const comparisonPanelWidth = "w-[80vw] max-w-[98vw] sm:w-[60vw] sm:max-w-[400px] md:w-[38vw] md:max-w-[550px]";
  const comparisonPanelWidth = "w-[95vw] max-w-[99vw] sm:w-[80vw] sm:max-w-[400px] md:w-[38vw] md:max-w-[550px] lg:w-[28vw] lg:max-w-[750px]";

  return (
    <div className="relative w-full min-h-screen flex0 flex-col overflow-hidden">
      <InteractiveBackground />

      {/* Main content area using CSS Grid */}
      {/* Grid columns: Filters (dynamic), Item List (700px), Comparison Panel Area (450px) */}
      <div className="relative z-10 grid grid-cols-[10%_60%_30%] flex-grow items-start">

        {/* Filters Panel (Column 1) */}
        {/* Width is controlled by grid-cols definition */}
        <div className="sticky top-0 p-4 overflow-y-auto h-screen">
          <div className="mb-6">
            <p className="text-white font-bold mb-2">Slot:</p>
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => (
                <button
                  key={`slot-${slot}`}
                  onClick={() => handleToggleSlot(slot)}
                   className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${selectedSlot.includes(slot) ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white'}`}
                >
                  {slot || 'N/A'}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-6">
            <p className="text-white font-bold mb-2">Hands:</p>
            <div className="flex flex-wrap gap-2">
              {hands.map((hand) => (
                <button
                  key={`hand-${hand}`}
                  onClick={() => handleToggleHands(hand)}
                   className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${selectedHands.includes(hand) ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white'}`}
                >
                  {hand}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-white font-bold mb-2">Tipo:</p>
            <div className="flex flex-wrap gap-2">
              {tipos.map((tipo) => (
                <button
                  key={`tipo-${tipo}`}
                  onClick={() => handleToggleTipo(tipo)}
                   className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${selectedTipo.includes(tipo) ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white'}`}
                >
                  {tipo}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Items List Panel (Column 2) */}
        {/* Width (700px) is controlled by grid-cols. Removed flex-grow, mr-*, and transition classes for width. */}
        <div className="p-6 overflow-y-auto h-screen">
          {isAdmin && (
            <div className="mb-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleAddWeaponClick}
                  className="px-3 py-1.5 text-sm bg-green-700 text-white rounded hover:bg-green-600 transition-colors"
                >
                  {lockedItem && lockedItem.item_type === "weapon" ? "Modifica Arma" : "+ Arma"}
                </button>
                <button onClick={() => displayConfirmation("Funzionalità Armatura in arrivo!", "info")} className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"> + Armatura </button>
                <button onClick={() => displayConfirmation("Funzionalità Accessorio in arrivo!", "info")} className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"> + Accessorio </button>
                <button onClick={() => displayConfirmation("Funzionalità Consumabile in arrivo!", "info")} className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"> + Consumabile </button>
                <button onClick={() => displayConfirmation("Funzionalità Munizione in arrivo!", "info")} className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"> + Munizione </button>
              </div>
            </div>
          )}

          <div className="mb-4">
            <input
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Cerca per Nome o Tipo..."
              className="w-full border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-800 text-white placeholder-gray-500"
            />
          </div>

          <div className="flex flex-col gap-3">
             {filteredItems.length > 0 ? (
                 filteredItems.map((item) => (
                     <ItemCard
                         key={item.id}
                         item={item}
                         onPurchase={handlePurchase}
                         onHoverItem={handleHoverItem}
                         onLockToggle={() => handleLockToggle(item)}
                         isLocked={lockedItem && lockedItem.id === item.id}
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
    </div>
  );
}