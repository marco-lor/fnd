import React, { useState, useMemo, useEffect } from 'react';
import { FiSearch, FiSliders, FiX } from 'react-icons/fi';

/**
 * buildFilterPredicate
 * Creates a pure predicate function using provided filter criteria. The resulting predicate
 * can be applied to either a Tecnica or a Spell object transparently. Missing fields are ignored.
 *
 * Numeric fields are parsed defensively; if parsing fails cost is treated as Infinity so that it
 * will be excluded when a maxCost is specified. Advanced ranges (turniRange, esperienzaRange)
 * are only enforced when showAdvanced was active at construction (caller passes null otherwise).
 */
export function buildFilterPredicate({
  searchTerm,
  maxCost,
  selectedActions,
  selectedTipoBase,
  turniRange,
  esperienzaRange
}) {
  const lowerSearch = searchTerm.trim().toLowerCase();
  const maxCostNum = maxCost === '' ? Infinity : parseInt(maxCost, 10);
  return (item) => {
    if (!item) return false;
    const nome = (item.Nome || '').toString();
    const effetto = [item.Effetto, item['Effetti Positivi'], item['Effetti Negativi']]
      .filter(Boolean)
      .join(' ') || '';
    const searchable = (nome + ' ' + effetto).toLowerCase();
    if (lowerSearch && !searchable.includes(lowerSearch)) return false;

    // Cost extraction
    const costStr = item.Costo?.toString() || '';
    const match = costStr.match(/(\d+)/);
    const numericCost = match ? parseInt(match[1], 10) : Infinity;
    if (numericCost > maxCostNum) return false;

    // Action filter (apply only if specific actions selected)
    if (!selectedActions.includes('All')) {
      const az = item.Azione || item.azione || '';
      if (!selectedActions.includes(az)) return false;
    }

    // Tipo Base filter (optional)
    if (selectedTipoBase.length && !selectedTipoBase.includes('All')) {
      const tipoBase = item['Tipo Base'] || item.TipoBase || '';
      if (!selectedTipoBase.includes(tipoBase)) return false;
    }

    // Advanced filters for spells (Turni, Esperienza)
    if (turniRange) {
      const turniVal = parseInt(item.Turni, 10);
      if (!isNaN(turniVal)) {
        if (turniVal < turniRange[0] || turniVal > turniRange[1]) return false;
      }
    }
    if (esperienzaRange) {
      const espVal = parseInt(item.Esperienza, 10);
      if (!isNaN(espVal)) {
        if (espVal < esperienzaRange[0] || espVal > esperienzaRange[1]) return false;
      }
    }
    return true;
  };
}

/**
 * FilterPanel component - manages unified filters for Tecniche & Spells.
 * Props:
 * - personalTecniche, commonTecniche, personalSpells: objects of items
 * - onPredicateChange: callback receiving predicate function whenever filters change
 */
export default function FilterPanel({
  personalTecniche = {},
  commonTecniche = {},
  personalSpells = {},
  onPredicateChange
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [maxCost, setMaxCost] = useState('');
  const [selectedActions, setSelectedActions] = useState(['All']);
  const [selectedTipoBase, setSelectedTipoBase] = useState(['All']);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [turniRange, setTurniRange] = useState([0, 20]);
  const [esperienzaRange, setEsperienzaRange] = useState([0, 100]);

  // Collect unique actions from both tecniche and spells
  const actionOptions = useMemo(() => {
    const allActions = [
      ...Object.values(personalTecniche).map(t => t.Azione),
      ...Object.values(commonTecniche).map(t => t.Azione),
      ...Object.values(personalSpells).map(s => s.Azione)
    ].filter(Boolean);
    return ['All', ...Array.from(new Set(allActions))];
  }, [personalTecniche, commonTecniche, personalSpells]);

  // Collect unique Tipo Base values (mostly for spells, future-proof for tecniche)
  const tipoBaseOptions = useMemo(() => {
    const allTipos = [
      ...Object.values(personalTecniche).map(t => t['Tipo Base'] || t.TipoBase),
      ...Object.values(commonTecniche).map(t => t['Tipo Base'] || t.TipoBase),
      ...Object.values(personalSpells).map(s => s['Tipo Base'] || s.TipoBase)
    ].filter(Boolean);
    if (!allTipos.length) return ['All'];
    return ['All', ...Array.from(new Set(allTipos))];
  }, [personalTecniche, commonTecniche, personalSpells]);

  // Update predicate when filters change
  const predicate = useMemo(() => buildFilterPredicate({
    searchTerm,
    maxCost,
    selectedActions,
    selectedTipoBase,
    turniRange: showAdvanced ? turniRange : null,
    esperienzaRange: showAdvanced ? esperienzaRange : null
  }), [searchTerm, maxCost, selectedActions, selectedTipoBase, turniRange, esperienzaRange, showAdvanced]);

  useEffect(() => {
    onPredicateChange && onPredicateChange(predicate);
  }, [predicate, onPredicateChange]);

  // Generic selection toggle (supports 'All' sentinel)
  const toggleSelection = (value, current, setFn) => {
    if (value === 'All') {
      setFn(['All']);
      return;
    }
    if (current.includes('All')) {
      setFn([value]);
      return;
    }
    if (current.includes(value)) {
      const next = current.filter(v => v !== value);
      setFn(next.length ? next : ['All']);
    } else {
      setFn([...current, value]);
    }
  };

  // Reset all filters to their initial values
  const clearAll = () => {
    setSearchTerm('');
    setMaxCost('');
    setSelectedActions(['All']);
    setSelectedTipoBase(['All']);
    setTurniRange([0, 20]);
    setEsperienzaRange([0, 100]);
  };

  return (
    <div className="px-5 pt-4 w-full">
      <div className="max-w-[1600px] mx-auto">
        <div className="rounded-xl bg-gradient-to-br from-[rgba(30,40,70,0.85)] via-[rgba(25,35,60,0.85)] to-[rgba(20,30,55,0.85)] backdrop-blur-md border border-indigo-700/40 shadow-lg p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-indigo-200 font-semibold flex items-center gap-2">
              <FiSliders className="text-indigo-400" /> Filtri Tecniche & Incantesimi
            </h2>
            <button
              onClick={clearAll}
              className="text-xs flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-800/40 hover:bg-indigo-700/50 text-indigo-200"
            >
              <FiX /> Reset
            </button>
          </div>
          {/* Search */}
          <div className="relative mb-4">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cerca per nome o effetto..."
              className="w-full pl-10 pr-3 py-2 rounded-md bg-[rgba(18,25,40,0.9)] border border-indigo-800/40 focus:border-indigo-500 focus:ring-0 text-gray-200 placeholder-gray-500 text-sm"
            />
          </div>
          {/* Primary filters grid */}
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            {/* Cost */}
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-indigo-300 mb-2">Costo massimo</p>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  value={maxCost === '' ? 50 : maxCost}
                  onChange={(e) => setMaxCost(e.target.value === '50' ? '' : e.target.value)}
                  className="w-full accent-indigo-500"
                />
                <span className="text-xs text-gray-300 w-10 text-right">{maxCost === '' ? '∞' : maxCost}</span>
              </div>
            </div>
            {/* Actions */}
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-indigo-300 mb-2">Azione</p>
              <div className="flex flex-wrap gap-2">
                {actionOptions.map(opt => (
                  <button
                    key={opt}
                    onClick={() => toggleSelection(opt, selectedActions, setSelectedActions)}
                    className={`px-2 py-1 rounded-full text-[11px] border transition-all shadow-sm ${
                      selectedActions.includes(opt)
                        ? 'bg-indigo-600/70 border-indigo-400 text-white'
                        : 'bg-indigo-900/40 border-indigo-700/40 text-indigo-300 hover:border-indigo-500'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            {/* Tipo Base */}
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-indigo-300 mb-2">Tipo Base</p>
              <div className="flex flex-wrap gap-2">
                {tipoBaseOptions.map(opt => (
                  <button
                    key={opt}
                    onClick={() => toggleSelection(opt, selectedTipoBase, setSelectedTipoBase)}
                    className={`px-2 py-1 rounded-full text-[11px] border transition-all shadow-sm ${
                      selectedTipoBase.includes(opt)
                        ? 'bg-purple-600/70 border-purple-400 text-white'
                        : 'bg-purple-900/40 border-purple-700/40 text-purple-300 hover:border-purple-500'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Advanced toggle */}
          <div>
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="text-xs px-3 py-1 rounded-md bg-[rgba(25,35,55,0.6)] hover:bg-[rgba(30,40,65,0.7)] border border-indigo-700/40 text-indigo-200"
            >
              {showAdvanced ? 'Nascondi Avanzati' : 'Mostra Avanzati'}
            </button>
          </div>
          {showAdvanced && (
            <div className="mt-4 grid md:grid-cols-2 gap-6">
              {/* Turni range */}
              <div>
                <p className="text-[11px] uppercase tracking-wider font-semibold text-indigo-300 mb-2">Turni (Spell)</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="w-20 bg-[rgba(18,25,40,0.9)] border border-indigo-800/40 rounded px-2 py-1 text-xs text-gray-200"
                    value={turniRange[0]}
                    onChange={(e)=> setTurniRange([parseInt(e.target.value||'0',10), turniRange[1]])}
                    min={0}
                  />
                  <span className="text-gray-400 text-xs">-</span>
                  <input
                    type="number"
                    className="w-20 bg-[rgba(18,25,40,0.9)] border border-indigo-800/40 rounded px-2 py-1 text-xs text-gray-200"
                    value={turniRange[1]}
                    onChange={(e)=> setTurniRange([turniRange[0], parseInt(e.target.value||'0',10)])}
                    min={turniRange[0]}
                  />
                </div>
              </div>
              {/* Esperienza range */}
              <div>
                <p className="text-[11px] uppercase tracking-wider font-semibold text-indigo-300 mb-2">Esperienza (Spell)</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="w-24 bg-[rgba(18,25,40,0.9)] border border-indigo-800/40 rounded px-2 py-1 text-xs text-gray-200"
                    value={esperienzaRange[0]}
                    onChange={(e)=> setEsperienzaRange([parseInt(e.target.value||'0',10), esperienzaRange[1]])}
                    min={0}
                  />
                  <span className="text-gray-400 text-xs">-</span>
                  <input
                    type="number"
                    className="w-24 bg-[rgba(18,25,40,0.9)] border border-indigo-800/40 rounded px-2 py-1 text-xs text-gray-200"
                    value={esperienzaRange[1]}
                    onChange={(e)=> setEsperienzaRange([esperienzaRange[0], parseInt(e.target.value||'0',10)])}
                    min={esperienzaRange[0]}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
