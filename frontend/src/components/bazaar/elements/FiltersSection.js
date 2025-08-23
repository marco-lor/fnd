// file: ./frontend/src/components/bazaar/elements/FiltersSection.js
import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// Encapsulates all filter UI/logic (dropdown open state) separate from Bazaar core logic
export default function FiltersSection({
  slots,
  hands,
  tipos,
  itemTypes,
  combatParams,
  baseParams,
  selectedSlot,
  selectedHands,
  selectedTipo,
  selectedItemType,
  selectedCombatParams,
  selectedBaseParams,
  onToggleSlot,
  onToggleHands,
  onToggleTipo,
  onToggleItemType,
  onToggleCombatParam,
  onToggleBaseParam,
  onlyAffordable,
  setOnlyAffordable,
  onResetFilters,
}) {
  const [dropdownOpen, setDropdownOpen] = useState({
    itemType: false,
    slot: false,
    hands: false,
    tipo: false,
    combatParams: false,
    baseParams: false,
  });

  const toggleDropdown = (key) => setDropdownOpen(prev => ({ ...prev, [key]: !prev[key] }));
  const closeAllDropdowns = () => setDropdownOpen({ itemType: false, slot: false, hands: false, tipo: false, combatParams: false, baseParams: false });

  useEffect(() => {
    const handleClickOutside = () => {
      if (Object.values(dropdownOpen).some(v => v)) closeAllDropdowns();
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownOpen]);

  const FilterDropdown = ({ label, options, selectedOptions, onToggle, dropdownKey, icon = null, colorScheme = 'blue', isSmall = false }) => {
    const selectedFilters = selectedOptions.filter(opt => opt !== 'All');
    const unselectedOptions = options.filter(opt => !selectedOptions.includes(opt) && opt !== 'All');
    const isOpen = dropdownOpen[dropdownKey];

    const colorClasses = {
      blue: { selected: 'bg-blue-600/80 border-blue-400 text-white shadow-lg shadow-blue-500/20', badge: 'bg-blue-500/20 text-blue-300' },
      orange: { selected: 'bg-orange-600/80 border-orange-400 text-white shadow-lg shadow-orange-500/20', badge: 'bg-orange-500/20 text-orange-300' },
      green: { selected: 'bg-green-600/80 border-green-400 text-white shadow-lg shadow-green-500/20', badge: 'bg-green-500/20 text-green-300' },
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
        {selectedFilters.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {selectedFilters.map(filter => (
              <button
                key={filter}
                onClick={() => onToggle(filter)}
                className={`${padding} ${textSize} rounded-md border transition-all duration-200 ${colors.selected} hover:opacity-80`}
              >
                {filter} ✕
              </button>
            ))}
          </div>
        )}
        {unselectedOptions.length > 0 && (
          <div className="relative">
            <button
              onClick={() => toggleDropdown(dropdownKey)}
              className={`w-full ${padding} ${textSize} bg-gray-700/50 border border-gray-600/50 text-gray-300 hover:bg-gray-600/70 hover:text-white rounded-md transition-all duration-200 flex items-center justify-between`}
            >
              <span>Aggiungi filtro...</span>
              <span className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
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
                  {unselectedOptions.map(option => (
                    <button
                      key={option}
                      onClick={() => { onToggle(option); closeAllDropdowns(); }}
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
        {selectedFilters.length === 0 && (
          <button
            onClick={() => onToggle('All')}
            className={`w-full ${padding} ${textSize} rounded-md border transition-all duration-200 text-left bg-gray-600/80 border-gray-500 text-gray-200`}
          >
            Tutti ({label})
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="sticky top-0 p-3 overflow-y-auto h-screen bg-gradient-to-b from-gray-900/95 to-gray-800/95 backdrop-blur-sm border-r border-gray-700/50" onClick={(e) => e.stopPropagation()}>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <span className="text-blue-400">⚙️</span>
          Filtri
        </h2>
        <button
          onClick={() => { onResetFilters(); closeAllDropdowns(); }}
          className="w-full px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-gray-300 hover:text-white rounded border border-gray-500 transition-colors"
        >
          Resetta Filtri
        </button>
      </div>
      <div className="mb-6 bg-gray-800/50 rounded-lg p-4 border border-gray-600/30">
        <h3 className="text-lg font-semibold text-blue-300 mb-4 flex items-center gap-2">
          <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
          Filtri Base
        </h3>
        <div className="mb-4 flex items-center justify-between bg-gray-700/40 px-3 py-2 rounded-md border border-gray-600/40">
          <label htmlFor="onlyAffordable" className="text-xs font-medium text-gray-200 flex items-center gap-2 cursor-pointer select-none">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
            Solo acquistabili
          </label>
          <button
            id="onlyAffordable"
            type="button"
            onClick={() => setOnlyAffordable(v => !v)}
            className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 border ${onlyAffordable ? 'bg-emerald-600 border-emerald-400' : 'bg-gray-600 border-gray-500'}`}
            title={onlyAffordable ? 'Mostra tutti gli oggetti' : 'Mostra solo quelli acquistabili'}
          >
            <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white/90 shadow-md transform transition-transform duration-300 ${onlyAffordable ? 'translate-x-6' : ''}`}></span>
          </button>
        </div>
        <div className="mb-4">
          <FilterDropdown label="Tipo Oggetto" options={itemTypes} selectedOptions={selectedItemType} onToggle={onToggleItemType} dropdownKey="itemType" colorScheme="blue" />
        </div>
        <div className="mb-4">
          <FilterDropdown label="Slot" options={slots} selectedOptions={selectedSlot} onToggle={onToggleSlot} dropdownKey="slot" colorScheme="blue" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FilterDropdown label="Mani" options={hands} selectedOptions={selectedHands} onToggle={onToggleHands} dropdownKey="hands" colorScheme="blue" isSmall />
          </div>
            <div>
            <FilterDropdown label="Tipo" options={tipos} selectedOptions={selectedTipo} onToggle={onToggleTipo} dropdownKey="tipo" colorScheme="blue" isSmall />
          </div>
        </div>
      </div>
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-600/30">
        <h3 className="text-lg font-semibold text-orange-300 mb-4 flex items-center gap-2">
          <span className="w-2 h-2 bg-orange-400 rounded-full"></span>
          Ordinamento Parametri
        </h3>
        <div className="mb-4">
          <FilterDropdown label="Combattimento" options={combatParams} selectedOptions={selectedCombatParams} onToggle={onToggleCombatParam} dropdownKey="combatParams" icon="⚔️" colorScheme="orange" />
        </div>
        <div>
          <FilterDropdown label="Base" options={baseParams} selectedOptions={selectedBaseParams} onToggle={onToggleBaseParam} dropdownKey="baseParams" icon="📊" colorScheme="green" />
        </div>
      </div>
    </div>
  );
}
