import {compareFoes, foeOrderSeconds, reconcileFoeRows, pageFoes} from './foePage';

test('order exactly preserves seconds fallback, including zero and missing timestamps, with id ties', () => {
  const rows = [{id: 'z'}, {id: 'b', updated_at: {seconds: 0}, created_at: {seconds: 7}},
    {id: 'a', updated_at: {seconds: 7, nanoseconds: 2}}, {id: 'c', created_at: {seconds: 2}}];
  expect(rows.slice().sort(compareFoes).map(row => row.id)).toEqual(['a', 'b', 'c', 'z']);
  expect(foeOrderSeconds(rows[0])).toBe(0);
});
test('500 foes traverse through bounded stable cursors without losing missing timestamps', () => {
  const rows = Array.from({length: 500}, (_, index) => ({id: `f${String(index).padStart(3, '0')}`,
    ...(index % 3 ? {updated_at: {seconds: index % 13}} : {})}));
  const ids = []; let cursor = null; let next;
  do {
    const page = pageFoes(rows, cursor); expect(page.rows.length).toBeLessThanOrEqual(25);
    ids.push(...page.rows.map(row => row.id)); next = page.hasNext; cursor = page.cursor;
  } while (next);
  expect(ids).toEqual(rows.sort(compareFoes).map(row => row.id));
  expect(new Set(ids).size).toBe(500);
});
test('snapshots preserve unchanged row and nested chart identities, including reordered fields', () => {
  const before = [{id: 'a', Parametri: {Base: {Forza: 3}}, name: 'a'}, {id: 'b', name: 'b'}];
  const after = reconcileFoeRows(before, [{name: 'changed', id: 'a', Parametri: {Base: {Forza: 3}}}, {name: 'b', id: 'b'}]);
  expect(after[1]).toBe(before[1]); expect(after[0]).not.toBe(before[0]);
  expect(after[0].Parametri).toBe(before[0].Parametri);
  expect(reconcileFoeRows(after, after.map(row => ({...row})))).toBe(after);
});

test('fallback document IDs follow Firestore code point ordering, including astral IDs', () => {
  const ids = ['😀', '\ue000', 'a😀', 'a', 'a\ue000'];
  expect(ids.map(id => ({id})).sort(compareFoes).map(row => row.id))
    .toEqual(['a', 'a\ue000', 'a😀', '\ue000', '😀']);
});
