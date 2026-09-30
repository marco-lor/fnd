export const FOE_PAGE_SIZE = 25;
export const foeOrderSeconds = foe => foe.updated_at?.seconds || foe.created_at?.seconds || 0;
// Firestore's default collection order is document ID ascending. Preserve that
// tie order, including all old records with no snake_case timestamp.
const compareDocumentIds = (left, right) => {
  const a = Array.from(left, value => value.codePointAt(0));
  const b = Array.from(right, value => value.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
};
export const compareFoes = (a, b) => foeOrderSeconds(b) - foeOrderSeconds(a)
  || compareDocumentIds(a.id, b.id);
export const foeCursor = row => row ? {seconds: foeOrderSeconds(row), id: row.id} : null;
export const pageFoes = (rows, cursor = null) => {
  const ordered = rows.slice().sort(compareFoes).filter(row => !cursor
    || compareFoes(row, {id: cursor.id, updated_at: {seconds: cursor.seconds}}) > 0);
  const page = ordered.slice(0, FOE_PAGE_SIZE);
  return {rows: page, hasNext: ordered.length > FOE_PAGE_SIZE, cursor: foeCursor(page.at(-1))};
};
const equal = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (typeof a.isEqual === 'function') return a.isEqual(b);
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key]));
};
// Retain nested references too: changing a name must not rebuild both radars.
export const reconcileFoeRows = (previous, rows) => {
  const byId = new Map(previous.map(row => [row.id, row]));
  const next = rows.map(row => {
    const prior = byId.get(row.id);
    if (!prior) return row;
    if (equal(prior, row)) return prior;
    return Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, equal(prior[key], value) ? prior[key] : value]));
  });
  return previous.length === next.length && next.every((row, i) => previous[i] === row)
    ? previous : next;
};
