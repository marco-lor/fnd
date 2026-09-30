import React, { useState } from 'react';

// The 100-card fixture mounted 100 cards and committed 200 times on config load.
// One chunk is eight desktop rows; lists up to this size keep their full rendering.
export const CARD_CHUNK_SIZE = 24;

export default function IncrementalCardGrid({ entries, label, filterKey, renderCard }) {
  const [window, setWindow] = useState({ filterKey, count: CARD_CHUNK_SIZE });
  const count = window.filterKey === filterKey ? window.count : CARD_CHUNK_SIZE;
  const visibleCount = Math.min(count, entries.length);
  const complete = visibleCount === entries.length;
  return <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {entries.slice(0, visibleCount).map(renderCard)}
    </div>
    {entries.length > CARD_CHUNK_SIZE && <div className="mt-4 flex items-center gap-3">
      <button type="button" aria-label={`Mostra altri: ${label}`} aria-disabled={complete}
        className="px-3 py-2 rounded bg-indigo-800 text-white focus-visible:ring-2 focus-visible:ring-indigo-300"
        onClick={() => { if (!complete) setWindow({ filterKey, count: count + CARD_CHUNK_SIZE }); }}>
        {complete ? 'Tutti i risultati visibili' : 'Mostra altri'}
      </button>
      <span role="status" className="text-sm text-gray-300">{visibleCount} / {entries.length}</span>
    </div>}
  </>;
}
