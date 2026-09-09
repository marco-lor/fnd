import {
  BAZAAR_ADVANCED_QUERY_CONTRACT,
  BAZAAR_INITIAL_QUERY_CONTRACT,
  BAZAAR_PAGE_SIZE,
  BAZAAR_PRICE_CONTRACT,
  BAZAAR_SEARCH_DEBOUNCE_MS,
  applyBazaarCatalogSemantics,
  bazaarItemSortScore,
  compareBazaarItems,
  getBazaarDisplayedPrice,
  getBazaarLegacyCost,
  isBazaarItemVisibleToActor,
  isMeaningfulSpecialValue,
  matchesBazaarItem,
  normalizeFilterArray,
  projectBazaarSummary,
} from './bazaarCatalogContract';

const item = (overrides = {}) => ({
  id: 'item-1',
  item_type: 'weapon',
  visibility: 'all',
  allowed_users: [],
  normalizedName: 'alpha blade',
  imageUrl: 'https://example.test/alpha.png',
  General: {
    Nome: 'Alpha Blade',
    prezzo: 12,
    Slot: 'main-hand',
  },
  Specific: { Hands: 2, Tipo: 'steel' },
  Parametri: {
    Special: { critico: 0, empty: false },
    Combattimento: { Attacco: { 1: 4 }, Difesa: { '1': '2.5' } },
    Base: { Forza: { 1: 3 } },
  },
  spells: [{ id: 'spell-hidden' }],
  tecniche: [{ id: 'technique-hidden' }],
  ...overrides,
});

describe('Task 09A Bazaar semantic contract', () => {
  test('declares a 50-row page, debounce, and explicit advanced/full semantics', () => {
    expect(BAZAAR_PAGE_SIZE).toBe(50);
    expect(BAZAAR_SEARCH_DEBOUNCE_MS).toBe(150);
    expect(BAZAAR_INITIAL_QUERY_CONTRACT).toMatchObject({
      pageSize: 50,
      realtime: 'first-page-only',
      clientTruncation: false,
      summaryOnly: true,
    });
    expect(BAZAAR_INITIAL_QUERY_CONTRACT.order).toEqual([
      { field: 'normalizedName', direction: 'asc' },
      { field: '__name__', direction: 'asc' },
    ]);
    expect(BAZAAR_ADVANCED_QUERY_CONTRACT).toMatchObject({
      completeness: 'actor-visible-full-catalog',
      arbitrarySubstringSearch: true,
      arbitraryCombinedFacets: true,
      summedSelectedLevel1Sort: true,
      clientTruncation: false,
      evaluation: 'server-authoritative-search-snapshot',
    });
  });

  test('normalizes filters without changing meaningful zero or order', () => {
    expect(normalizeFilterArray(undefined)).toEqual(['All']);
    expect(normalizeFilterArray([])).toEqual(['All']);
    expect(normalizeFilterArray([' All ', 'weapon', 'weapon'])).toEqual(['All']);
    expect(normalizeFilterArray([' weapon ', 'armor'])).toEqual(['weapon', 'armor']);
    expect(isMeaningfulSpecialValue(0)).toBe(true);
    expect(isMeaningfulSpecialValue(false)).toBe(false);
    expect(isMeaningfulSpecialValue({ nested: [null, '  ', { zero: 0 }] })).toBe(true);
    expect(isMeaningfulSpecialValue({ nested: [false, '  '] })).toBe(false);
  });

  test('keeps exact actor visibility semantics: dm is unrestricted, webmaster is not', () => {
    const custom = item({ visibility: 'custom', allowed_users: ['player-2'] });
    expect(isBazaarItemVisibleToActor(item(), { uid: 'dm-1', role: 'dm' })).toBe(true);
    expect(isBazaarItemVisibleToActor(item({ visibility: 'custom', allowed_users: [] }), { uid: 'dm-1', role: 'dm' })).toBe(true);
    expect(isBazaarItemVisibleToActor(custom, { uid: 'player-2', role: 'player' })).toBe(true);
    expect(isBazaarItemVisibleToActor(custom, { uid: 'player-3', role: 'player' })).toBe(false);
    expect(isBazaarItemVisibleToActor(custom, { uid: 'player-2', role: 'webmaster' })).toBe(true);
    expect(isBazaarItemVisibleToActor(item({ visibility: 'custom', allowed_users: [] }), { uid: 'webmaster', role: 'webmaster' })).toBe(false);
    expect(isBazaarItemVisibleToActor(item({ id: 'schema_weapon' }), { uid: 'dm-1', role: 'dm' })).toBe(false);
  });

  test('preserves whitespace-only search and untrimmed nonempty input', () => {
    expect(matchesBazaarItem(item(), { searchTerm: '   ' })).toBe(true);
    expect(matchesBazaarItem(item(), { searchTerm: 'Alpha' })).toBe(true);
    expect(matchesBazaarItem(item(), { searchTerm: ' Alpha' })).toBe(false);
    expect(matchesBazaarItem(item(), { searchTerm: 'Blade' })).toBe(true);
    expect(matchesBazaarItem(item(), { searchTerm: 'missing' })).toBe(false);
  });

  test('supports arbitrary combined multi-select facets and historical fields', () => {
    const legacyPrice = item({
      General: { Nome: 'Legacy item', Costo: '8', Slot: 'main-hand' },
      Specific: { Hands: 1, Tipo: 'wood' },
      Parametri: { Special: { critico: 'yes' } },
    });
    expect(getBazaarDisplayedPrice(legacyPrice)).toBe(0);
    expect(getBazaarLegacyCost(legacyPrice)).toBe(8);
    expect(matchesBazaarItem(legacyPrice, {
      selectedSlot: ['main-hand'],
      selectedHands: ['1'],
      selectedTipo: ['wood'],
      selectedItemType: ['weapon'],
      selectedSpecialParams: ['critico'],
      onlyAffordable: true,
      userGold: 8,
    })).toBe(true);
    expect(matchesBazaarItem(item(), {
      selectedSlot: ['main-hand'],
      selectedHands: ['2'],
      selectedTipo: ['steel'],
      selectedItemType: ['weapon'],
      selectedSpecialParams: ['critico'],
    })).toBe(true);
    expect(matchesBazaarItem(item(), { selectedHands: ['1', '3'] })).toBe(false);
  });

  test('sums selected combat and base level-one values and keeps equal-name order stable', () => {
    expect(bazaarItemSortScore(item(), {
      selectedCombatParams: ['Attacco', 'Difesa'],
      selectedBaseParams: ['Forza'],
    })).toBe(9.5);
    const lower = item({ id: 'first', General: { Nome: 'Same', prezzo: 1 } });
    const upper = item({ id: 'second', General: { Nome: 'Same', prezzo: 99 } });
    expect(compareBazaarItems(lower, upper)).toBe(0);
    expect(applyBazaarCatalogSemantics([upper, lower], {}, { uid: 'p', role: 'player' }).map(({ id }) => id))
      .toEqual(['second', 'first']);
    expect(applyBazaarCatalogSemantics([item({ id: 'low', Parametri: { Base: { Forza: { 1: 1 } } } }), item({ id: 'high', Parametri: { Base: { Forza: { 1: 9 } } } })], {
      selectedBaseParams: ['Forza'],
    }, { uid: 'p', role: 'player' }).map(({ id }) => id)).toEqual(['high', 'low']);
  });

  test('evaluates the complete input without hidden page truncation', () => {
    const items = Array.from({ length: 137 }, (_, index) => item({
      id: `item-${String(index).padStart(3, '0')}`,
      General: { Nome: `Alpha ${index}`, prezzo: index },
    }));
    const result = applyBazaarCatalogSemantics(items, { searchTerm: 'Alpha' }, { uid: 'p', role: 'player' });
    expect(result).toHaveLength(137);
    expect(new Set(result.map(({ id }) => id))).toEqual(new Set(items.map(({ id }) => id)));
  });

  test('summary excludes embedded detail payload while retaining card/filter fields', () => {
    const summary = projectBazaarSummary(item());
    expect(summary).toMatchObject({ id: 'item-1', name: 'Alpha Blade', price: 12, slot: 'main-hand', hands: 2, tipo: 'steel' });
    expect(summary).toHaveProperty('specialParams', ['critico']);
    expect(summary).not.toHaveProperty('spells');
    expect(summary).not.toHaveProperty('tecniche');
    expect(summary).not.toHaveProperty('Parametri');
  });

  test('makes stale displayed-price behavior explicit and never treats it as expected-price rejection', () => {
    expect(BAZAAR_PRICE_CONTRACT).toMatchObject({
      mode: 'server-authoritative-current-price',
      expectedPriceAccepted: false,
      versionRejection: false,
      serverReadsCatalogInTransaction: true,
      displayedPriceMayBeStale: true,
    });
    expect(BAZAAR_PRICE_CONTRACT.clientFacts).toEqual(['itemId', 'operationId']);
  });
});
