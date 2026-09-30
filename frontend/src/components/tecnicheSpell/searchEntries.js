// Keep the previous locale-aware, stable name ordering (including equal-name ties).
export const sortEntries = (items) => Object.entries(items).sort((a, b) =>
  (a[1]?.Nome || a[0] || '').toString().localeCompare(
    (b[1]?.Nome || b[0] || '').toString(), undefined, { sensitivity: 'base' }
  ));

export function normalizeSearchItem(item) {
  if (!item) return null;
  const effect = [item.Effetto, item['Effetti Positivi'], item['Effetti Negativi']].filter(Boolean).join(' ');
  const match = (item.Costo?.toString() || '').match(/(\d+)/);
  return {
    searchable: `${(item.Nome || '').toString()} ${effect}`.toLowerCase(),
    numericCost: match ? parseInt(match[1], 10) : Infinity,
  };
}

export const buildSearchEntries = (items) => sortEntries(items).map(([key, item]) => ({
  key, item, normalized: normalizeSearchItem(item),
}));
export const filterSearchEntries = (entries, predicate) => entries
  .filter(entry => predicate(entry.item, entry.normalized))
  .map(entry => [entry.key, entry.item]);
