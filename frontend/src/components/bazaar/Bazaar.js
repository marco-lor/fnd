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
  const title = item.Nome;

  return (
    <motion.div
      className={`flex items-center p-2 bg-gray-800 bg-opacity-80 shadow rounded-lg hover:bg-gray-700 transition-colors cursor-pointer ${isLocked ? 'border-2 border-blue-500' : ''}`}
      whileHover={{ scale: 1.02 }}
      onMouseEnter={() => onHoverItem(item)}
      onMouseLeave={() => onHoverItem(null)}
      onClick={onLockToggle}
    >
      {item.image_url && !imageError ? (
        <img
          src={item.image_url}
          alt={title}
          className="w-16 h-16 object-cover rounded-lg mr-4"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="w-16 h-16 bg-gray-600 rounded-lg mr-4 flex items-center justify-center text-white text-xs text-center">
          {title?.charAt(0) || "?"}
        </div>
      )}
      <div className="flex-grow">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <p className="text-sm text-gray-300">
          Slot: {item.Slot} | Tipo: {item.Tipo} | Hands: {item.Hands}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPurchase(item);
        }}
        className="px-3 py-1 rounded bg-[rgba(25,50,128,0.4)] text-white"
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
          if (doc.id !== "schema_arma") {
            fetchedItems.push({ id: doc.id, ...doc.data() });
          }
        });
        setItems(fetchedItems);
      },
      (error) => {
        console.error("Error listening to items collection:", error);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (lockedItem && !items.find(item => item.id === lockedItem.id)) {
      setLockedItem(null);
    }
    if (hoveredItem && !items.find(item => item.id === hoveredItem.id)) {
      setHoveredItem(null);
    }
  }, [items, lockedItem, hoveredItem]);

  const slots = ['All', ...Array.from(new Set(items.map((item) => item.Slot)))];
  const hands = ['All', ...Array.from(new Set(items.map((item) => item.Hands)))];
  const tipos = ['All', ...Array.from(new Set(items.map((item) => item.Tipo)))];

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };

  const toggleFilter = (currentFilters, setFilters, value) => {
    if (value === 'All') {
      setFilters(['All']);
    } else {
      if (currentFilters.includes('All')) {
        setFilters([value]);
      } else {
        if (currentFilters.includes(value)) {
          setFilters(currentFilters.filter((v) => v !== value));
        } else {
          setFilters([...currentFilters, value]);
        }
      }
    }
  };

  const handleToggleSlot = (slot) => {
    toggleFilter(selectedSlot, setSelectedSlot, slot);
  };

  const handleToggleHands = (hand) => {
    toggleFilter(selectedHands, setSelectedHands, hand);
  };

  const handleToggleTipo = (tipo) => {
    toggleFilter(selectedTipo, setSelectedTipo, tipo);
  };

  const handleHoverItem = (item) => {
    if (!lockedItem) {
      setHoveredItem(item);
    }
  };

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      (item.Nome && item.Nome.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.image_url && item.image_url.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Tipo && item.Tipo.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesSlot = selectedSlot.includes('All') || selectedSlot.includes(item.Slot);
    const matchesHands = selectedHands.includes('All') || selectedHands.includes(item.Hands);
    const matchesTipo = selectedTipo.includes('All') || selectedTipo.includes(item.Tipo);
    return matchesSearch && matchesSlot && matchesHands && matchesTipo;
  });

  // Helper function to display confirmation messages
  const displayConfirmation = (message) => {
    setConfirmationMessage(message);
    setShowConfirmation(true);
    setTimeout(() => {
      setShowConfirmation(false);
    }, 1000);
  };

  // Updated purchase handler for the acquire button
  const handlePurchase = (item) => {
    displayConfirmation("Oggetto Acquistato");
  };

  const handleAddWeaponClick = () => {
    setShowOverlay(true);
  };

  const panelItem = lockedItem || hoveredItem;

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: 'transparent' }}>
      <InteractiveBackground />

      <div className="fixed left-0 p-4 overflow-y-auto z-40" style={{ top: '10rem', width: '15vw', height: 'calc(100% - 4rem)' }}>
        <div className="mb-6">
          <p className="text-white font-bold mb-2">Filter by Slot:</p>
          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <button
                key={slot}
                onClick={() => handleToggleSlot(slot)}
                className={`px-4 py-2 rounded-lg border transition-colors ${selectedSlot.includes(slot) ? 'bg-[rgba(25,50,128,0.4)] text-white' : 'bg-white text-[rgba(25,50,128,0.4)]'}`}
              >
                {slot || 'None'}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-6">
          <p className="text-white font-bold mb-2">Filter by Hands:</p>
          <div className="flex flex-wrap gap-2">
            {hands.map((hand) => (
              <button
                key={hand}
                onClick={() => handleToggleHands(hand)}
                className={`px-4 py-2 rounded-lg border transition-colors ${selectedHands.includes(hand) ? 'bg-[rgba(25,50,128,0.4)] text-white' : 'bg-white text-[rgba(25,50,128,0.4)]'}`}
              >
                {hand}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-white font-bold mb-2">Filter by Tipo:</p>
          <div className="flex flex-wrap gap-2">
            {tipos.map((tipo) => (
              <button
                key={tipo}
                onClick={() => handleToggleTipo(tipo)}
                className={`px-4 py-2 rounded-lg border transition-colors ${selectedTipo.includes(tipo) ? 'bg-[rgba(25,50,128,0.4)] text-white' : 'bg-white text-[rgba(25,50,128,0.4)]'}`}
              >
                {tipo}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative p-6" style={{ marginLeft: '15vw', marginRight: '25vw', marginTop: '9rem' }}>
        {(userData?.role === 'webmaster' || userData?.role === 'dm') && (
          <div className="mb-4">
            <div className="flex space-x-2">
              <button
                onClick={handleAddWeaponClick}
                className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                Aggiungi Arma
              </button>
              <button
                onClick={() => displayConfirmation("Funzionalità Armatura in arrivo!")}
                className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                Aggiungi Armatura
              </button>
              <button
                onClick={() => displayConfirmation("Funzionalità Accessorio in arrivo!")}
                className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                Aggiungi Accessorio
              </button>
              <button
                onClick={() => displayConfirmation("Funzionalità Consumabile in arrivo!")}
                className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                Aggiungi Consumabile
              </button>
              <button
                onClick={() => displayConfirmation("Funzionalità Munizione in arrivo!")}
                className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
              >
                Aggiungi Munizione
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-4 mb-4">
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search Arcane Wares..."
            className="border border-white rounded-lg px-4 py-2 focus:outline-none focus:border-gray-300 flex-1 bg-gray-800 text-white"
          />
        </div>
        <div className="flex flex-col gap-2">
          {filteredItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onPurchase={handlePurchase}
              onHoverItem={handleHoverItem}
              onLockToggle={() => {
                if (lockedItem && lockedItem.id === item.id) {
                  setLockedItem(null);
                } else {
                  setLockedItem(item);
                }
              }}
              isLocked={lockedItem && lockedItem.id === item.id}
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {panelItem && <ComparisonPanel item={panelItem} user={user} key="comparisonPanel" />}
      </AnimatePresence>

      {showOverlay && (
        <AddWeaponOverlay onClose={(success) => {
          setShowOverlay(false);
          if (success) {
            displayConfirmation("Oggetto Creato!");
          }
        }} />
      )}

      <AnimatePresence>
        {showConfirmation && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 flex items-center justify-center z-50"
          >
            <div className="bg-gradient-to-r from-green-400 to-green-600 text-white px-8 py-4 rounded-lg shadow-xl">
              {confirmationMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
