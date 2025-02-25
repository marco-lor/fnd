// file: ./frontend/src/components/Bazaar.js
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from './elements/navbar';
import InteractiveBackground from './backgrounds/InteractiveBackground';
import { collection, getDocs } from "firebase/firestore";
import { db } from './firebaseConfig';
import { AddItemOverlay } from './elements/addItem';

function ComparisonPanel({ item }) {
  return (
    <motion.div
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed right-0 bg-gray-900 bg-opacity-90 p-4 overflow-y-auto z-50"
      style={{
        top: '14rem',
        width: '25vw',
        height: 'calc(100% - 4rem)'
      }}
    >
      <h2 className="text-2xl font-bold text-white mb-4">{item.Nome}</h2>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(item).map(([key, value]) => (
          <React.Fragment key={key}>
            <span className="font-semibold text-white">{key}</span>
            <span className="text-gray-300">
              {typeof value === 'object' && value !== null
                ? JSON.stringify(value)
                : value || '-'}
            </span>
          </React.Fragment>
        ))}
      </div>
    </motion.div>
  );
}

function ItemCard({ item, onPurchase, onHoverItem, onLockToggle, isLocked }) {
  const imageUrl = item.Image
    ? item.Image
    : `https://via.placeholder.com/150x150?text=${encodeURIComponent(item.Nome)}`;
  const title = item.Nome;

  return (
    <motion.div
      className={`flex items-center p-2 bg-gray-800 bg-opacity-80 shadow rounded-lg hover:bg-gray-700 transition-colors cursor-pointer ${isLocked ? 'border-2 border-blue-500' : ''}`}
      whileHover={{ scale: 1.02 }}
      onMouseEnter={() => onHoverItem(item)}
      onMouseLeave={() => onHoverItem(null)}
      onClick={onLockToggle}
    >
      <img src={imageUrl} alt={title} className="w-16 h-16 object-cover rounded-lg mr-4" />
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

  // Fetch items from the "items" collection in Firestore
  useEffect(() => {
    const fetchItems = async () => {
      try {
        const itemsCollection = collection(db, "items");
        const querySnapshot = await getDocs(itemsCollection);
        const fetchedItems = [];
        querySnapshot.forEach((doc) => {
          // Exclude the schema document
          if (doc.id !== "schema_arma") {
            fetchedItems.push({ id: doc.id, ...doc.data() });
          }
        });
        setItems(fetchedItems);
      } catch (error) {
        console.error("Error fetching items: ", error);
      }
    };

    fetchItems();
  }, []);

  // Compute filter options dynamically from fetched items
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

  // Filter items based on search term and selected filters
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      (item.Nome && item.Nome.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Image && item.Image.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Tipo && item.Tipo.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesSlot = selectedSlot.includes('All') || selectedSlot.includes(item.Slot);
    const matchesHands = selectedHands.includes('All') || selectedHands.includes(item.Hands);
    const matchesTipo = selectedTipo.includes('All') || selectedTipo.includes(item.Tipo);

    return matchesSearch && matchesSlot && matchesHands && matchesTipo;
  });

  const handlePurchase = (item) => {
    alert(`Purchasing item: ${item.Nome}`);
  };

  const handleAddItemClick = () => {
    setShowOverlay(true);
  };

  const panelItem = lockedItem || hoveredItem;

  return (
    <div className="min-h-screen relative" style={{ fontFamily: 'Papyrus, fantasy', backgroundColor: 'transparent' }}>
      <div className="fixed top-0 left-0 w-full z-50">
        <Navbar />
      </div>

      <InteractiveBackground />

      <div
        className="fixed left-0 bg-gray-800 bg-opacity-90 p-4 overflow-y-auto z-40"
        style={{
          top: '14rem',
          width: '15vw',
          height: 'calc(100% - 4rem)'
        }}
      >
        <div className="mb-6">
          <p className="text-white font-bold mb-2">Filter by Slot:</p>
          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <button
                key={slot}
                onClick={() => handleToggleSlot(slot)}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  selectedSlot.includes(slot)
                    ? 'bg-[rgba(25,50,128,0.4)] text-white'
                    : 'bg-white text-[rgba(25,50,128,0.4)]'
                }`}
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
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  selectedHands.includes(hand)
                    ? 'bg-[rgba(25,50,128,0.4)] text-white'
                    : 'bg-white text-[rgba(25,50,128,0.4)]'
                }`}
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
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  selectedTipo.includes(tipo)
                    ? 'bg-[rgba(25,50,128,0.4)] text-white'
                    : 'bg-white text-[rgba(25,50,128,0.4)]'
                }`}
              >
                {tipo}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className="relative p-6"
        style={{
          marginLeft: '15vw',
          marginRight: '25vw',
          marginTop: '9rem'
        }}
      >
        <div className="mb-4">
          <button
            onClick={handleAddItemClick}
            className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Aggiungi Oggetto
          </button>
        </div>
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
        {panelItem && <ComparisonPanel item={panelItem} key="comparisonPanel" />}
      </AnimatePresence>

      {showOverlay && <AddItemOverlay onClose={() => setShowOverlay(false)} />}
    </div>
  );
}
