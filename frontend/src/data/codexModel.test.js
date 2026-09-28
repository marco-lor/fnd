const {
  projectLegacyCodex, restoreLegacyCodex, normalizeControl, normalizeCategory,
  normalizeItem, createPage, validatePageRequest, CODEX_PAGE_SIZE, allocateDisplayRank,
} = require('./codexModel');

const control = { schemaVersion: 2, mode: 'v2', epoch: 1, generation: 'g1', metadataRevision: 1, collationLocale: 'en-US' };
const fixture = Object.fromEntries([
  ['Razze', Object.fromEntries(['z', 'Élfico', 'elfico', 'Elfico', '_elfo', 'é', 'e\u0301', '😀', '2', '10'].map((key, i) => [key, i % 2 ? `  ${key}\n` : { bonus: [0, false, null] }]))],
  ['lingue', { Comune: 'Parlato' }], ['conoscenze', {}], ['professioni', { Fabbro: '' }],
]);

test('preserves exact keys, Unicode, values and source order independently of display order', () => {
  const projected = projectLegacyCodex(fixture, 'en-US');
  expect(restoreLegacyCodex(projected)).toEqual(fixture);
  expect(Object.keys(restoreLegacyCodex(projected).Razze)).toEqual(Object.keys(fixture.Razze));
  const race = projected.find(({ category }) => category.legacyKey === 'Razze');
  expect([...race.items].sort((a, b) => a.displayRank - b.displayRank).map(x => x.legacyKey))
    .toEqual(Object.keys(fixture.Razze).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en-US')));
  expect(projectLegacyCodex(fixture, 'en-US')).toEqual(projected);
  expect(race.items.every(x => x.id && x.visibility === 'authenticated' && x.ownerUid === null)).toBe(true);
});

test('missing control defaults to legacy; malformed and unknown control fails closed', () => {
  expect(normalizeControl(null)).toMatchObject({ mode: 'legacy', readOnly: false });
  expect(normalizeControl({ ...control, mode: 'frozen' })).toMatchObject({ source: 'legacy', readOnly: true });
  expect(normalizeControl({ ...control, mode: 'rollback-frozen' })).toMatchObject({ source: 'v2', readOnly: true });
  expect(() => normalizeControl({ ...control, schemaVersion: 3 })).toThrow();
  expect(() => normalizeControl({ ...control, generation: '../x' })).toThrow();
});

test('rejects corrupt source and projections explicitly without dropping categories/items', () => {
  for (const source of [{ bad: null }, { bad: [] }, { bad: { x: undefined } }, { bad: { x: Infinity } }]) {
    expect(() => projectLegacyCodex(source, 'en-US')).toThrow();
  }
  const [{ category, items }] = projectLegacyCodex(fixture, 'en-US');
  expect(() => normalizeCategory({ ...category, value: 'body leaked' })).toThrow();
  expect(() => normalizeItem({ ...items[0], sourceRank: -1 })).toThrow();
  const dangerous = JSON.parse('{"__proto__":{"constructor":"preserved"}}');
  expect(restoreLegacyCodex(projectLegacyCodex(dangerous, 'en-US'))).toEqual(dangerous);
});

test('bounded pages preserve lookahead and bind cursor to revision, generation and order', () => {
  const source = { big: Object.fromEntries(Array.from({ length: 52 }, (_, i) => [`item${i}`, String(i)])) };
  const [{ category, items }] = projectLegacyCodex(source, 'en-US');
  const request = { control, category, order: 'source', pageSize: CODEX_PAGE_SIZE };
  const first = createPage(items.slice(0, 26), request);
  expect(first.items).toHaveLength(25);
  expect(first.hasMore).toBe(true);
  expect(first.cursor.id).toBe(items[24].id);
  expect(() => validatePageRequest({ ...request, cursor: first.cursor })).not.toThrow();
  for (const change of [{ order: 'display' }, { pageSize: 26 }, { category: { ...category, revision: 2 } }, { control: { ...control, generation: 'g2' } }]) {
    expect(() => validatePageRequest({ ...request, cursor: first.cursor, ...change })).toThrow(/cursor/i);
  }
  expect(() => validatePageRequest({ ...request, pageSize: 51 })).toThrow();
  expect(createPage(items.slice(50), request)).toMatchObject({ hasMore: false, cursor: null });
});

test('inserts before/between/after without changing existing ranks and rejects precision exhaustion', () => {
  const [{ items }] = projectLegacyCodex({ Razze: { Beta: '', Delta: '' } }, 'en-US');
  const [beta, delta] = items;
  const added = [
    { legacyKey: 'Alpha', displayRank: allocateDisplayRank(null, beta.displayRank) },
    { legacyKey: 'Charlie', displayRank: allocateDisplayRank(beta.displayRank, delta.displayRank) },
    { legacyKey: 'Echo', displayRank: allocateDisplayRank(delta.displayRank, null) },
  ];
  expect([...items, ...added].sort((a, b) => a.displayRank - b.displayRank).map(x => x.legacyKey)).toEqual(['Alpha', 'Beta', 'Charlie', 'Delta', 'Echo']);
  expect(items.map(x => x.displayRank)).toEqual([1024, 2048]);
  expect(() => allocateDisplayRank(1, 1 + Number.EPSILON)).toThrow(/rebalance/);
});
