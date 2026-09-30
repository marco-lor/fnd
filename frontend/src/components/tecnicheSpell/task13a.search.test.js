import { buildFilterPredicate } from './FilterPanel';
import { buildSearchEntries, filterSearchEntries, sortEntries } from './searchEntries';
import { getManaState } from './elements/manaState';

const criteria = { searchTerm: '', maxCost: '', selectedActions: ['All'], selectedTipoBase: ['All'], turniRange: null, esperienzaRange: null };
// Independent pre-Task13 predicate oracle, including missing/nonnumeric field behavior.
function legacy(item, c) {
  if (!item) return false;
  const text = ((item.Nome || '').toString() + ' ' + [item.Effetto, item['Effetti Positivi'], item['Effetti Negativi']].filter(Boolean).join(' ')).toLowerCase();
  if (c.searchTerm.trim() && !text.includes(c.searchTerm.trim().toLowerCase())) return false;
  const match = (item.Costo?.toString() || '').match(/(\d+)/);
  if ((match ? parseInt(match[1], 10) : Infinity) > (c.maxCost === '' ? Infinity : parseInt(c.maxCost, 10))) return false;
  if (!c.selectedActions.includes('All') && !c.selectedActions.includes(item.Azione || item.azione || '')) return false;
  if (c.selectedTipoBase.length && !c.selectedTipoBase.includes('All') && !c.selectedTipoBase.includes(item['Tipo Base'] || item.TipoBase || '')) return false;
  for (const [field, range] of [['Turni', c.turniRange], ['Esperienza', c.esperienzaRange]]) {
    const value = parseInt(item[field], 10);
    if (range && !isNaN(value) && (value < range[0] || value > range[1])) return false;
  }
  return true;
}

test('normalized search matches original filters and stable locale ordering including ties/fallbacks', () => {
  const data = {
    z: { Nome: 'Álfa', Costo: '5 PM', Effetto: 'FUOCO', Azione: 'Standard', 'Tipo Base': 'Fuoco', Turni: '2', Esperienza: '12' },
    a: { Nome: 'alfa', Costo: 0, 'Effetti Negativi': 'Freddo', azione: 'Rapida', TipoBase: 'Acqua' },
    fallback: { Costo: '---', Turni: 'n/a' },
    '2': { Nome: 12, Costo: '-4 PM', 'Effetti Positivi': 'luce', Turni: 30, Esperienza: 99 },
    null: null,
  };
  const entries = buildSearchEntries(data);
  expect(Object.values(data).filter(buildFilterPredicate({ ...criteria, searchTerm: 'fuoco' }))).toEqual([data.z]);
  const ordered = Object.entries(data).sort((a, b) => (a[1]?.Nome || a[0] || '').toString().localeCompare((b[1]?.Nome || b[0] || '').toString(), undefined, { sensitivity: 'base' }));
  expect(sortEntries(data)).toEqual(ordered);
  for (const searchTerm of ['', ' fuoco ', 'ALFA', 'freddo', 'luce', 'fallback']) {
    for (const maxCost of ['', '0', '4', 'bad']) {
      for (const extra of [{}, { selectedActions: ['Rapida'] }, { selectedTipoBase: ['Fuoco'] }, { turniRange: [1, 4], esperienzaRange: [0, 20] }]) {
        const c = { ...criteria, searchTerm, maxCost, ...extra };
        expect(filterSearchEntries(entries, buildFilterPredicate(c))).toEqual(ordered.filter(([, item]) => legacy(item, c)));
      }
    }
  }
});

test('typing reuses normalized fields: 100 initial reads, zero additional effect reads for six queries', () => {
  let reads = 0;
  const items = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i, { Nome: `Spell ${i}`, get Effetto() { reads++; return 'Luce'; } }]));
  const entries = buildSearchEntries(items);
  expect(reads).toBe(100);
  for (const searchTerm of ['s', 'sp', 'spe', 'spel', 'spell', 'spell 9']) filterSearchEntries(entries, buildFilterPredicate({ ...criteria, searchTerm }));
  expect(reads).toBe(100);
});

test.each(['ridCostoTec', 'ridCostoSpell'])('matching mana parsing keeps reduction/minimum/zero/missing semantics for %s', reductionKey => {
  const user = { stats: { manaCurrent: 2 }, Parametri: { Special: { [`Bonus ${reductionKey}`]: { value: '4' } } } };
  expect(getManaState('5 PM', user, reductionKey)).toMatchObject({ originalCost: 5, costReduction: 4, manaCost: 1, hasSufficientMana: true });
  expect(getManaState(0, user, reductionKey).manaCost).toBe(0);
  expect(getManaState('---', user, reductionKey).manaCost).toBe(0);
  expect(getManaState(8, user, reductionKey).hasSufficientMana).toBe(false);
  expect(getManaState(1, { Parametri: { Special: { [reductionKey]: NaN } } }, reductionKey).manaCost).toBe(1);
});
