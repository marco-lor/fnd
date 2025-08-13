import React, { useMemo, useState } from 'react';

/* VisibilitySelector
 * Props:
 *  - visibility: 'all' | 'private' | 'custom'
 *  - allowedUsers: string[]
 *  - users: array of user objects (expects fields: id/uid/email, displayName/characterId)
 *  - onChange: (visibility, allowedUsers) => void
 *  - className: optional wrapper classes
 */
export default function VisibilitySelector({ visibility, allowedUsers, users = [], onChange, className = '' }) {
  const [query, setQuery] = useState('');

  const normalizedUsers = useMemo(() => users.map(u => ({
    id: u.id || u.uid || u.email,
    label: u.characterId || u.displayName || u.nome || u.email || u.id || 'Sconosciuto',
    email: u.email || ''
  })), [users]);

  const filtered = useMemo(() => {
    if (!query.trim()) return normalizedUsers;
    const q = query.toLowerCase();
    return normalizedUsers.filter(u => u.label.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [normalizedUsers, query]);

  const setVis = (v) => {
    if (v === 'all') onChange('all', []);
    else if (v === 'private') onChange('private', []);
    else onChange('custom', allowedUsers);
  };

  const toggleUser = (id) => {
    if (allowedUsers.includes(id)) onChange('custom', allowedUsers.filter(u => u !== id));
    else onChange('custom', [...allowedUsers, id]);
  };

  const removeUser = (id) => onChange('custom', allowedUsers.filter(u => u !== id));

  return (
    <div className={`bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 shadow-inner ${className}`}>
      <h3 className="text-white text-sm font-semibold mb-3 flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-pulse" /> Visibilità
      </h3>
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { key: 'all', label: 'Tutti' },
          { key: 'private', label: 'Solo Me' },
          { key: 'custom', label: 'Utenti Selezionati' }
        ].map(opt => (
          <button
            type="button"
            key={opt.key}
            onClick={() => setVis(opt.key)}
            className={`px-3 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors border tracking-wide
              ${visibility === opt.key
                ? 'bg-indigo-600/90 border-indigo-500 text-white shadow-md shadow-indigo-900/30'
                : 'bg-gray-700/70 border-gray-600 text-gray-300 hover:bg-gray-600/70 hover:text-white'}
            `}
          >{opt.label}</button>
        ))}
      </div>

      {visibility === 'custom' && (
        <div className="space-y-3">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Cerca utente..."
              className="w-full bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 text-sm"
              >✕</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 min-h-[1.5rem]">
            {allowedUsers.length === 0 && (
              <span className="text-xs text-gray-500">Nessun utente selezionato.</span>
            )}
            {allowedUsers.map(id => {
              const u = normalizedUsers.find(n => n.id === id);
              return (
                <span key={id} className="group flex items-center gap-1 bg-indigo-500/30 border border-indigo-500/50 text-indigo-100 px-2 py-1 rounded-full text-[10px] md:text-xs">
                  {u?.label || id}
                  <button type="button" onClick={() => removeUser(id)} className="opacity-70 group-hover:opacity-100 hover:text-white">×</button>
                </span>
              );
            })}
          </div>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-700 divide-y divide-gray-700 bg-gray-900/50 backdrop-blur-sm">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500">Nessun risultato</div>
            )}
            {filtered.map(u => {
              const active = allowedUsers.includes(u.id);
              return (
                <button
                  type="button"
                  key={u.id}
                  onClick={() => toggleUser(u.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left text-xs md:text-sm transition-colors ${active ? 'bg-indigo-600/40 text-white' : 'hover:bg-gray-700/70 text-gray-200'}`}
                >
                  <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold
                    ${active ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'}`}>{(u.label || '?').slice(0,2).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-tight truncate">{u.label}</div>
                    {u.email && <div className="text-[10px] uppercase tracking-wide text-gray-400 truncate">{u.email}</div>}
                  </div>
                  <div className={`text-[10px] ${active ? 'text-indigo-300' : 'text-gray-500'}`}>{active ? '✓' : 'Aggiungi'}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-4 text-[10px] md:text-xs text-gray-400 leading-relaxed space-y-0.5">
        <p><span className="text-gray-300 font-medium">Tutti</span>: visibile a chiunque può accedere al bazaar.</p>
        <p><span className="text-gray-300 font-medium">Solo Me</span>: solo tu puoi vederlo.</p>
        <p><span className="text-gray-300 font-medium">Utenti Selezionati</span>: mostra l'elemento solo agli utenti indicati.</p>
      </div>
    </div>
  );
}
