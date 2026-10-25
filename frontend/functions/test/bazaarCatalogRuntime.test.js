const {test} = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const {projectSummary, compareNames} = require('../lib/bazaarCatalogCore');

const item = name => ({item_type: 'weapon', General: {Nome: name, prezzo: 4}, Specific: {},
  Parametri: {Base: {Forza: {1: 3}}, Combattimento: {}, Special: {}}, visibility: 'all', catalogVersion: 1});
const field = (data, key) => key.split('.').reduce((value, part) => value?.[part], data);

// Only the Firestore boundary is simulated. Tests invoke the exported callable
// handlers and migration/media transactions used by the deployed Functions.
function fixture(t, {count = 3, historicalOrder = false, control = {}, role = 'dm'} = {}) {
  const records = new Map([
    ['users/actor', {role}],
    ['catalogControl/bazaar', {state: 'active', schemaVersion: 1, collation: 'en-US',
      icu: 'historical-icu', generation: 'generation-1', revision: 7, ...control}],
    ['catalogPrivate/bazaar', {cursorSecret: 'unit-test-secret'}],
  ]);
  for (let i = 0; i < count; i++) {
    const id = `item-${String(i).padStart(3, '0')}`;
    const name = `Item ${String(historicalOrder ? count - i : i).padStart(3, '0')}`;
    const source = item(name);
    records.set(`items/${id}`, source);
    records.set(`catalogSummaries/${id}`, {...projectSummary({...source, id}, 1, i * 1024), generation: 'generation-1'});
    records.set(`catalogMedia/${id}`, {id, media: null, task07MediaRevision: 0, mediaUpdatedAt: null});
  }
  const writes = [];
  const ref = path => ({path, id: path.split('/').at(-1), parent: {id: path.split('/').at(-2)}});
  const snap = path => ({...ref(path), ref: ref(path), exists: records.has(path),
    data: () => structuredClone(records.get(path)), get: key => field(records.get(path), key)});
  const matches = (data, filter) => {
    if (filter.filters) return filter.operator === 'OR'
      ? filter.filters.some(child => matches(data, child)) : filter.filters.every(child => matches(data, child));
    const value = field(data, filter.field);
    return filter.operator === 'array-contains' ? value?.includes(filter.value) : value === filter.value;
  };
  const query = (path, filters = [], order, start, max) => ({path, filters, order, start, max,
    where: (...args) => query(path, [...filters, args.length === 1 ? args[0] : {field: args[0], operator: args[1], value: args[2]}], order, start, max),
    orderBy: key => query(path, filters, typeof key === 'string' ? key : '__name__', start, max),
    startAfter: value => query(path, filters, order, value, max),
    limit: value => query(path, filters, order, start, value),
  });
  const db = {doc: ref, collection: path => query(path), runTransaction: async fn => {
    const pending = [];
    const tx = {
      getAll: async (...refs) => refs.map(r => snap(r.path)),
      get: async r => {
        if (!r.filters) return snap(r.path);
        let docs = [...records.keys()].filter(path => path.startsWith(`${r.path}/`) && path.split('/').length === 2)
          .filter(path => r.filters.every(filter => matches(records.get(path), filter))).map(snap);
        if (r.order) docs.sort((a, b) => r.order === '__name__' ? a.id.localeCompare(b.id) : a.get(r.order) - b.get(r.order));
        if (r.start !== undefined) docs = docs.filter(d => d.get(r.order) > r.start);
        if (r.max !== undefined) docs = docs.slice(0, r.max);
        return {docs, size: docs.length};
      },
      set: (r, data) => {writes.push({path: r.path, data}); pending.push(() => records.set(r.path, structuredClone(data)));},
      update: (r, patch) => {writes.push({path: r.path, data: patch}); pending.push(() => records.set(r.path, {...records.get(r.path), ...structuredClone(patch)}));},
      delete: r => {writes.push({path: r.path, deleted: true}); pending.push(() => records.delete(r.path));},
    };
    const result = await fn(tx);
    pending.forEach(commit => commit());
    return result;
  }};
  const descriptor = Object.getOwnPropertyDescriptor(admin, 'firestore');
  Object.defineProperty(admin, 'firestore', {configurable: true, value: () => db});
  const modulePath = require.resolve('../lib/bazaarCatalog');
  delete require.cache[modulePath];
  const api = require(modulePath);
  t.after(() => {
    if (descriptor) Object.defineProperty(admin, 'firestore', descriptor);
    else delete admin.firestore;
    delete require.cache[modulePath];
  });
  const call = (name, data, auth = {uid: 'actor'}) => api[name].run({auth, data});
  const write = (id, next, action = 'save', operationId = 'operation-1') => call('task09WriteCatalogItem', {itemId: id, item: next, action, operationId});
  return {api, records, writes, db, call, write};
}

test('historic ICU catalog remains readable with complete signed rank pagination and unchanged data', async t => {
  const f = fixture(t, {count: 65, historicalOrder: true});
  const before = structuredClone([...f.records]);
  const first = await f.call('task09CatalogPage', {revision: 7});
  assert.equal(first.rows.length, 50);
  const second = await f.call('task09CatalogPage', {revision: 7, cursor: first.cursor});
  assert.equal(second.rows.length, 15);
  assert.equal(second.cursor, null);
  const ids = [...first.rows, ...second.rows].map(row => row.id);
  assert.deepEqual(ids, Array.from({length: 65}, (_, i) => `item-${String(i).padStart(3, '0')}`));
  const detail = await f.call('task09CatalogDetail', {itemId: 'item-000', revision: 7});
  assert.equal(detail.General.Nome, 'Item 065');
  assert.deepEqual([...f.records], before);
  assert.deepEqual(f.writes, []);
});

test('historic ICU search, facets and stat ties preserve the materialized order across pages', async t => {
  const f = fixture(t, {count: 65, historicalOrder: true});
  for (const input of [{filters: {searchTerm: 'Item'}}, {filters: {selectedBaseParams: ['Forza']}}, {facets: true}]) {
    const first = await f.call('task09CatalogPage', {revision: 7, ...input});
    const second = await f.call('task09CatalogPage', {revision: 7, ...input, cursor: first.cursor});
    assert.deepEqual([...first.rows, ...second.rows].map(row => row.rank), Array.from({length: 65}, (_, i) => i * 1024));
  }
  assert.deepEqual(f.writes, []);
});

test('historic ICU permits ordinary edits without moving rank or altering unrelated items', async t => {
  const f = fixture(t, {historicalOrder: true});
  const source = f.records.get('items/item-001');
  const prior = structuredClone(f.records.get('catalogSummaries/item-001'));
  const other = structuredClone(f.records.get('items/item-000'));
  await f.write('item-001', {...source, General: {...source.General, prezzo: 99}});
  const next = f.records.get('catalogSummaries/item-001');
  assert.equal(next.rank, prior.rank);
  assert.equal(next.price, 99);
  assert.equal(next.catalogVersion, 2);
  assert.equal(next.generation, prior.generation);
  assert.deepEqual(f.records.get('items/item-000'), other);
  assert.equal(f.records.get('catalogControl/bazaar').revision, 8);
  const replay = await f.write('item-001', {...source, General: {...source.General, prezzo: 99}});
  assert.equal(replay.catalogVersion, 2);
  assert.equal(f.records.get('catalogControl/bazaar').revision, 8);
});

test('historic ICU permits deletion and media synchronization without reordering', async t => {
  const f = fixture(t, {historicalOrder: true});
  const rank = f.records.get('catalogSummaries/item-000').rank;
  const media = {assetId: `m_${'a'.repeat(40)}`, variants: {card: {path: 'test-card'}}};
  await f.db.runTransaction(async tx => {
    const ref = f.db.doc('items/item-000');
    const source = (await tx.get(ref)).data();
    await f.api.synchronizeCatalogMedia(tx, f.db, ref, source, {media});
  });
  assert.equal(f.records.get('catalogSummaries/item-000').rank, rank);
  assert.equal(f.records.get('catalogSummaries/item-000').media.assetId, media.assetId);
  assert.equal(f.records.get('catalogMedia/item-000').media.assetId, media.assetId);
  await f.write('item-001', null, 'delete');
  for (const collection of ['items', 'catalogSummaries', 'catalogMedia']) assert.equal(f.records.has(`${collection}/item-001`), false);
});

test('historic ICU allows inserts and renames when ranks agree with the current comparator', async t => {
  const f = fixture(t);
  await f.write('new-item', item('Item 001a'));
  await f.write('item-000', item('Item 001b'), 'save', 'operation-2');
  const rows = [...f.records].filter(([path]) => path.startsWith('catalogSummaries/')).map(([, row]) => row);
  assert.deepEqual(rows.slice().sort((a, b) => a.rank - b.rank).map(r => r.id), rows.slice().sort(compareNames).map(r => r.id));
});

test('recreating a source with an orphan projection allocates a fresh valid rank', async t => {
  for (const rank of [NaN, 0]) {
    await t.test(String(rank), async child => {
      const f = fixture(child);
      const source = f.records.get('items/item-001');
      f.records.delete('items/item-001');
      f.records.get('catalogSummaries/item-001').rank = rank;
      await f.write('item-001', source);
      assert.equal(f.records.get('catalogSummaries/item-001').rank, 1024);
      assert.equal(f.records.get('items/item-001').catalogVersion, 1);
    });
  }
});

test('incompatible historical ordering rejects inserts and renames before any writes', async t => {
  for (const [id, next] of [['new-item', item('New item')], ['item-001', item('Renamed')]]) {
    await t.test(id, async child => {
      const f = fixture(child, {historicalOrder: true});
      await assert.rejects(f.write(id, next), error => error.code === 'failed-precondition' && /rebuild|required|ordering/i.test(error.message));
      assert.deepEqual(f.writes, []);
    });
  }
});

test('state, schema and collation fences remain mandatory for reads', async t => {
  for (const control of [{state: 'building'}, {state: 'inactive'}, {schemaVersion: 2}, {collation: 'it-IT'}]) {
    await t.test(JSON.stringify(control), async child => {
      const f = fixture(child, {control});
      for (const [name, data] of [['task09CatalogPage', {revision: 7}], ['task09CatalogDetail', {revision: 7, itemId: 'item-000'}]]) {
        await assert.rejects(f.call(name, data), {code: 'failed-precondition'});
      }
      assert.deepEqual(f.writes, []);
    });
  }
});

test('authentication, visibility, revision and signed cursor fences survive ICU drift', async t => {
  const f = fixture(t, {count: 65, role: 'player'});
  const source = f.records.get('items/item-000');
  source.visibility = 'custom'; source.allowed_users = ['other-user'];
  f.records.set('catalogSummaries/item-000', {...f.records.get('catalogSummaries/item-000'), visibility: 'custom', allowed_users: ['other-user']});
  await assert.rejects(f.call('task09CatalogPage', {revision: 7}, null), {code: 'unauthenticated'});
  const first = await f.call('task09CatalogPage', {revision: 7});
  assert.equal(first.rows.some(row => row.id === 'item-000'), false);
  await assert.rejects(f.call('task09CatalogDetail', {revision: 7, itemId: 'item-000'}), {code: 'permission-denied'});
  await assert.rejects(f.call('task09CatalogPage', {revision: 6}), {code: 'failed-precondition'});
  await assert.rejects(f.call('task09CatalogPage', {revision: 7, cursor: {...first.cursor, rank: first.cursor.rank + 1}}), {code: 'failed-precondition'});
  f.records.set('user_deletion_jobs/actor', {state: 'pending'});
  await assert.rejects(f.call('task09CatalogPage', {revision: 7}), {code: 'permission-denied'});
  assert.deepEqual(f.writes, []);
});

test('building migration cannot resume or activate with another ICU', async t => {
  for (const action of ['step', 'activate']) {
    await t.test(action, async child => {
      const f = fixture(child, {control: {state: 'building', offset: 0}});
      await assert.rejects(f.api.migrateCatalog(f.db, action), /ICU|runtime|incompatible/i);
      assert.deepEqual(f.writes, []);
    });
  }
});
