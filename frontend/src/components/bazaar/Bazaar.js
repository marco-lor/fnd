// file: ./frontend/src/components/bazaar/Bazaar.js
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import InteractiveBackground from '../backgrounds/InteractiveBackground';
import { collection, onSnapshot } from "firebase/firestore";
import { db } from '../firebaseConfig';
import { useAuth } from '../../AuthContext';
import { AddWeaponOverlay } from './elements/addWeapon';
import { AddArmaturaOverlay } from './elements/addArmatura';
import { AddAccessorioOverlay } from './elements/addAccessorio';
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


export default function Bazaar() {  const [items, setItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(['All']);
  const [selectedHands, setSelectedHands] = useState(['All']);
  const [selectedTipo, setSelectedTipo] = useState(['All']);
  const [selectedItemType, setSelectedItemType] = useState(['All']);  const [selectedCombatParams, setSelectedCombatParams] = useState(['All']);
  const [selectedBaseParams, setSelectedBaseParams] = useState(['All']);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [lockedItem, setLockedItem] = useState(null);

  // Dropdown visibility states
  const [dropdownOpen, setDropdownOpen] = useState({
    itemType: false,
    slot: false,
    hands: false,
    tipo: false,
    combatParams: false,
    baseParams: false
  });const [showOverlay, setShowOverlay] = useState(false);
  const [showArmaturaOverlay, setShowArmaturaOverlay] = useState(false);
  const [showAccessorioOverlay, setShowAccessorioOverlay] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const { user, userData } = useAuth();
  useEffect(() => {
    // Listen to items collection (all items)
    const itemsRef = collection(db, "items");
    const unsubscribeItems = onSnapshot(
      itemsRef,
      (snapshot) => {
        const fetchedItems = [];
        snapshot.forEach((doc) => {
           const data = doc.data();
           // Include all items that have the required structure and item_type, excluding schema documents
           if (data.item_type && data.General && data.Specific && data.Parametri && !doc.id.startsWith('schema_')) {
              fetchedItems.push({ id: doc.id, ...data });
           }
        });
        setItems(fetchedItems);
        // console.log("Bazaar: Items fetched/updated from Firestore", fetchedItems.length);
      },
      (error) => {
        console.error("Error listening to items collection:", error);
      }
    );

    return () => {
      unsubscribeItems();
    };
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
      
      // Show sample item structure
      const sampleItem = items.find(item => item.Parametri?.Combattimento);
      if (sampleItem) {
        console.log('Sample item combat params:', sampleItem.Parametri.Combattimento);
      }
    }
    
    if (selectedBaseParams.length > 0 && !selectedBaseParams.includes('All')) {
      console.log('Selected base params:', selectedBaseParams);
      console.log('Available base params:', baseParams);
      
      // Show sample item structure
      const sampleItem = items.find(item => item.Parametri?.Base);
      if (sampleItem) {
        console.log('Sample item base params:', sampleItem.Parametri.Base);
      }
    }
  }, [selectedCombatParams, selectedBaseParams, combatParams, baseParams, items]);

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
  const handleToggleItemType = (itemType) => toggleFilter(selectedItemType, setSelectedItemType, itemType);  const handleToggleCombatParam = (param) => {
    console.log('Toggling combat param:', param);
    console.log('Current selected:', selectedCombatParams);
    toggleFilter(selectedCombatParams, setSelectedCombatParams, param);
  };
    const handleToggleBaseParam = (param) => {
    console.log('Toggling base param:', param);
    console.log('Current selected:', selectedBaseParams);
    toggleFilter(selectedBaseParams, setSelectedBaseParams, param);
  };

  // Dropdown management functions
  const toggleDropdown = (dropdownName) => {
    setDropdownOpen(prev => ({
      ...prev,
      [dropdownName]: !prev[dropdownName]
    }));
  };

  const closeAllDropdowns = () => {
    setDropdownOpen({
      itemType: false,
      slot: false,
      hands: false,
      tipo: false,
      combatParams: false,
      baseParams: false
    });
  };

  // Filter dropdown component
  const FilterDropdown = ({ 
    label, 
    options, 
    selectedOptions, 
    onToggle, 
    dropdownKey, 
    icon = null, 
    colorScheme = 'blue',
    isSmall = false 
  }) => {
    const selectedFilters = selectedOptions.filter(opt => opt !== 'All');
    const unselectedOptions = options.filter(opt => !selectedOptions.includes(opt) && opt !== 'All');
    const isOpen = dropdownOpen[dropdownKey];
    
    const colorClasses = {
      blue: {
        selected: 'bg-blue-600/80 border-blue-400 text-white shadow-lg shadow-blue-500/20',
        dropdown: 'bg-blue-600 border-blue-500 text-white hover:bg-blue-700',
        badge: 'bg-blue-500/20 text-blue-300'
      },
      orange: {
        selected: 'bg-orange-600/80 border-orange-400 text-white shadow-lg shadow-orange-500/20',
        dropdown: 'bg-orange-600 border-orange-500 text-white hover:bg-orange-700',
        badge: 'bg-orange-500/20 text-orange-300'
      },
      green: {
        selected: 'bg-green-600/80 border-green-400 text-white shadow-lg shadow-green-500/20',
        dropdown: 'bg-green-600 border-green-500 text-white hover:bg-green-700',
        badge: 'bg-green-500/20 text-green-300'
      }
    };

    const colors = colorClasses[colorScheme];
    const textSize = isSmall ? 'text-xs' : 'text-sm';
    const padding = isSmall ? 'px-2 py-1' : 'px-3 py-2';

    return (
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <label className={`text-white font-medium ${textSize} flex items-center gap-2`}>
            {icon && <span>{icon}</span>}
            {label}
          </label>
          {selectedFilters.length > 0 && (
            <span className={`text-xs ${colors.badge} px-2 py-1 rounded-full`}>
              {selectedFilters.length} attivi
            </span>
          )}
        </div>

        {/* Selected filters as chips */}
        {selectedFilters.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {selectedFilters.map((filter) => (
              <button
                key={`selected-${filter}`}
                onClick={() => onToggle(filter)}
                className={`${padding} ${textSize} rounded-md border transition-all duration-200 ${colors.selected} hover:opacity-80`}
              >
                {filter} ✕
              </button>
            ))}
          </div>
        )}

        {/* Dropdown for unselected options */}
        {unselectedOptions.length > 0 && (
          <div className="relative">
            <button
              onClick={() => toggleDropdown(dropdownKey)}
              className={`w-full ${padding} ${textSize} bg-gray-700/50 border border-gray-600/50 text-gray-300 hover:bg-gray-600/70 hover:text-white rounded-md transition-all duration-200 flex items-center justify-between`}
            >
              <span>Aggiungi filtro...</span>
              <span className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>

            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="absolute top-full left-0 right-0 z-50 mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-xl max-h-40 overflow-y-auto"
                >
                  {unselectedOptions.map((option) => (
                    <button
                      key={`dropdown-${option}`}
                      onClick={() => {
                        onToggle(option);
                        closeAllDropdowns();
                      }}
                      className={`w-full ${padding} ${textSize} text-left hover:bg-gray-700 text-gray-300 hover:text-white transition-colors border-b border-gray-700 last:border-b-0`}
                    >
                      {option}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* "All" option when no specific filters are selected */}
        {selectedFilters.length === 0 && (
          <button
            onClick={() => onToggle('All')}
            className={`w-full ${padding} ${textSize} rounded-md border transition-all duration-200 text-left bg-gray-600/80 border-gray-500 text-gray-200`}
          >
            Tutti ({label})
          </button>
        )}
      </div>
    );  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      closeAllDropdowns();
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

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
    const matchesItemType = selectedItemType.includes('All') || selectedItemType.includes(item.item_type);    return matchesSearch && matchesSlot && matchesHands && matchesTipo && matchesItemType;}).sort((a, b) => {
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
  const handleAddArmaturaClick = () => {
    setShowArmaturaOverlay(true);
  };
  const handleAddAccessorioClick = () => {
    setShowAccessorioOverlay(true);
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
      <div className="relative z-10 grid grid-cols-[15%_55%_30%] flex-grow items-start">        {/* Filters Panel (Column 1) */}
        <div 
          className="sticky top-0 p-3 overflow-y-auto h-screen bg-gradient-to-b from-gray-900/95 to-gray-800/95 backdrop-blur-sm border-r border-gray-700/50"
          onClick={(e) => e.stopPropagation()} // Prevent dropdown close when clicking inside
        >
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
              <span className="text-blue-400">⚙️</span>
              Filtri
            </h2>            <button
              onClick={() => {
                setSelectedSlot(['All']);
                setSelectedHands(['All']);
                setSelectedTipo(['All']);
                setSelectedItemType(['All']);
                setSelectedCombatParams(['All']);
                setSelectedBaseParams(['All']);
                setSearchTerm('');
                closeAllDropdowns();
              }}
              className="w-full px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-gray-300 hover:text-white rounded border border-gray-500 transition-colors"
            >
              Resetta Filtri
            </button>
          </div>

          {/* Basic Filters Section */}
          <div className="mb-6 bg-gray-800/50 rounded-lg p-4 border border-gray-600/30">
            <h3 className="text-lg font-semibold text-blue-300 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
              Filtri Base
            </h3>
            
            {/* Item Type Filter */}
            <div className="mb-4">
              <FilterDropdown
                label="Tipo Oggetto"
                options={itemTypes}
                selectedOptions={selectedItemType}
                onToggle={handleToggleItemType}
                dropdownKey="itemType"
                colorScheme="blue"
              />
            </div>

            {/* Slot Filter */}
            <div className="mb-4">
              <FilterDropdown
                label="Slot"
                options={slots}
                selectedOptions={selectedSlot}
                onToggle={handleToggleSlot}
                dropdownKey="slot"
                colorScheme="blue"
              />
            </div>

            {/* Hands and Tipo in a row */}
            <div className="grid grid-cols-2 gap-3">
              {/* Hands Filter */}
              <div>
                <FilterDropdown
                  label="Mani"
                  options={hands}
                  selectedOptions={selectedHands}
                  onToggle={handleToggleHands}
                  dropdownKey="hands"
                  colorScheme="blue"
                  isSmall={true}
                />
              </div>

              {/* Tipo Filter */}
              <div>
                <FilterDropdown
                  label="Tipo"
                  options={tipos}
                  selectedOptions={selectedTipo}
                  onToggle={handleToggleTipo}
                  dropdownKey="tipo"
                  colorScheme="blue"
                  isSmall={true}
                />
              </div>
            </div>
          </div>

          {/* Sorting Parameters Section */}
          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-600/30">
            <h3 className="text-lg font-semibold text-orange-300 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-orange-400 rounded-full"></span>
              Ordinamento Parametri
            </h3>
            
            {/* Combat Parameters */}
            <div className="mb-4">
              <FilterDropdown
                label="Combattimento"
                options={combatParams}
                selectedOptions={selectedCombatParams}
                onToggle={handleToggleCombatParam}
                dropdownKey="combatParams"
                icon="⚔️"
                colorScheme="orange"
              />
            </div>

            {/* Base Parameters */}
            <div>
              <FilterDropdown
                label="Base"
                options={baseParams}
                selectedOptions={selectedBaseParams}
                onToggle={handleToggleBaseParam}
                dropdownKey="baseParams"
                icon="📊"
                colorScheme="green"
              />
            </div>
          </div>
        </div>{/* Items List Panel (Column 2) */}
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
                <button onClick={() => displayConfirmation("Funzionalità Consumabile in arrivo!", "info")} className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors"> + Consumabile </button>
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