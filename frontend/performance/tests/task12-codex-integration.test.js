const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');
const F = require('firebase/firestore');
const req = require('node:module').createRequire(path.resolve(__dirname, '../../functions/package.json'));
const {initializeApp, deleteApp} = req('firebase-admin/app'), {getFirestore} = req('firebase-admin/firestore');
const {configureOwnedPerformanceEnvironment} = require('../../scripts/performance/common');
configureOwnedPerformanceEnvironment();
const C = require('../../functions/lib/codexCore');
const projectId = 'demo-fnd-perf', generation = 'test12';
let env, app, db;
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  env = await initializeTestEnvironment({projectId, firestore: {host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8')}});
  app = initializeApp({projectId}, 'task12-tests'); db = getFirestore(app);
});
after(async () => { await env?.cleanup(); if (app) await deleteApp(app); });
const client = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const small = () => ({Razze: {Elf: 'elf', Human: 'human'}, Lingue: {Common: 'common', Elvish: 'elvish'}, Conoscenze: {Lore: 'lore'}, Mestieri: {Smith: 'smith'}});
async function reset(source = small()) {
  await env.clearFirestore();
  await Promise.all([db.doc(C.LEGACY).set(source), ...['dm', 'webmaster', 'player', 'pending'].map(uid => db.doc('users/' + uid).set({role: uid === 'pending' ? 'dm' : uid, ...(uid === 'pending' ? {deletionState: 'pending'} : {})}))]);
}
async function action(name, gen = generation) { const state = await C.readState(db, gen), plan = C.makePlan(state, name, gen); return C.applyPlan(db, plan, plan.fingerprint); }
async function activate(source = small()) {
  await reset(source); await action('freeze');
  let result; do { result = await action('backfill'); } while (!result.complete);
  await action('verify'); await action('activate'); return current();
}
async function current() { const state = await C.readState(db, generation); return {state, control: state.control, ...C.targetRows(state, generation, state.control.collationLocale)}; }
const request = (state, action, fields) => ({action, epoch: state.control.epoch, generation, ...fields});
const edit = (s, group, value) => request(s, 'item-edit', {categoryId: group.category.id, categoryRevision: group.category.revision, itemId: group.items[0].id, itemRevision: group.items[0].revision, value});

test('real Firestore map encoding observation', async () => {
  await reset({Zed: {Zebra: 'z', Ant: 'a'}, Alpha: {B: 'b', A: 'a'}});
  const stored = (await db.doc(C.LEGACY).get()).data();
  console.log('Task12 persisted map order ' + JSON.stringify({categories: Object.keys(stored), items: Object.keys(stored.Zed)}));
  assert.deepEqual(stored, {Zed: {Zebra: 'z', Ant: 'a'}, Alpha: {B: 'b', A: 'a'}});
});
test('freeze captures immutable source; bounded backfill resumes, replays and rejects corrupt/extra/missing docs', async () => {
  await reset({A: Object.fromEntries(Array.from({length: 220}, (_, i) => ['item' + String(i).padStart(3, '0'), 'value' + i]))});
  await action('freeze');
  let state = await C.readState(db, generation), plan = C.makePlan(state, 'backfill', generation);
  const first = await C.applyPlan(db, plan, plan.fingerprint); assert.equal(first.offset, 200); assert.equal(first.complete, false);
  await assert.rejects(C.applyPlan(db, plan, plan.fingerprint), /stale/);
  // Simulate lost client checkpoint: the next fresh inspection resumes server offset.
  assert.equal((await action('backfill')).offset, 221);
  assert.equal((await action('backfill')).offset, 221);
  assert.equal((await action('verify')).verified, true);
  const itemPath = `codex_versions/${generation}/categories/c0000000000/items/i0000000000`;
  const saved = (await db.doc(itemPath).get()).data();
  await db.doc(itemPath).update({value: 'corrupt'}); await assert.rejects(action('activate'), /Corrupt/); await db.doc(itemPath).set(saved);
  await db.doc(itemPath).delete(); await assert.rejects(action('activate'), /Missing/); await db.doc(itemPath).set(saved);
  const orphan = db.doc(`codex_versions/${generation}/categories/orphan/items/item`);
  await orphan.set(saved); await assert.rejects(action('activate'), /Unexpected/); await orphan.delete();
  assert.equal((await action('activate')).mode, 'v2');
});
test('stale source, changed control, invalid source and premature activation fail closed', async () => {
  await reset(); const state = await C.readState(db, generation), plan = C.makePlan(state, 'freeze', generation);
  await db.doc(C.LEGACY).update({'Razze.Human': 'changed'}); await assert.rejects(C.applyPlan(db, plan, plan.fingerprint), /stale/);
  assert.equal((await db.doc(C.CONTROL).get()).exists, false);
  await action('freeze'); await assert.rejects(action('activate'), /Missing/);
  await db.doc(C.LEGACY).update({'Razze.Human': 'changed again'}); await assert.rejects(action('backfill'), /source/);
  await reset({A: 'not map'}); const invalid = C.makePlan(await C.readState(db, generation), 'freeze', generation);
  assert.equal(invalid.source.valid, false); assert.ok(invalid.source.invalid.length); await assert.rejects(C.applyPlan(db, invalid, invalid.fingerprint), /valid legacy/);
});
test('rules old/new freeze race and concurrent editor revocation serialize without lost edits', async () => {
  await reset();
  const plan = C.makePlan(await C.readState(db, generation), 'freeze', generation);
  const race = await Promise.allSettled([C.applyPlan(db, plan, plan.fingerprint),
    F.updateDoc(F.doc(client('webmaster'), C.LEGACY), {'Razze.Human': 'racing legacy edit'})]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  if (race[0].status === 'fulfilled') assert.equal((await db.doc(C.LEGACY).get()).get('Razze.Human'), 'human');
  else { assert.equal((await db.doc(C.LEGACY).get()).get('Razze.Human'), 'racing legacy edit'); assert.equal((await db.doc(C.CONTROL).get()).exists, false); }
  const s = await activate(), g = s.groups[0];
  const revoke = await Promise.allSettled([C.mutateCodex(db, 'dm', edit(s, g, 'role-racing edit')), db.doc('users/dm').update({role: 'player'})]);
  assert.equal(revoke[1].status, 'fulfilled');
  if (revoke[0].status === 'fulfilled') {
    const item = await db.doc(`codex_versions/${generation}/categories/${g.category.id}/items/${g.items[0].id}`).get(), actor = await db.doc('users/dm').get();
    assert.ok(item.updateTime.toMillis() <= actor.updateTime.toMillis());
  } else assert.equal(revoke[0].reason.code, 'permission-denied');
});
test('rules fence every direct writer and stale legacy reader; ordered bounded active-generation paging preserves full options', async () => {
  await reset({A: Object.fromEntries(Array.from({length: 60}, (_, i) => ['Name' + String(i).padStart(2, '0'), 'Body' + i]))});
  for (const uid of ['dm', 'webmaster']) await assertSucceeds(F.updateDoc(F.doc(client(uid), C.LEGACY), {'A.Name00': 'legacy-edit'}));
  await assertFails(F.setDoc(F.doc(client('webmaster'), C.CONTROL), {mode: 'legacy'}));
  await assertSucceeds(F.setDoc(F.doc(client('webmaster'), 'utils/other'), {ok: true}));
  await action('freeze');
  for (const uid of ['dm', 'webmaster']) await assertFails(F.updateDoc(F.doc(client(uid), C.LEGACY), {'A.Name00': 'bypass'}));
  await assertSucceeds(F.getDoc(F.doc(client('player'), C.LEGACY)));
  await action('backfill'); await action('verify'); await action('activate');
  const s = await current(), group = s.groups[0], categoryPath = `codex_versions/${generation}/categories/${group.category.id}`;
  await assertFails(F.getDoc(F.doc(client('player'), C.LEGACY)));
  for (const uid of ['player', 'dm', 'webmaster']) {
    await assertSucceeds(F.getDoc(F.doc(client(uid), C.CONTROL)));
    await assertFails(F.setDoc(F.doc(client(uid), categoryPath), group.category));
    await assertFails(F.setDoc(F.doc(client(uid), categoryPath + '/items/forged'), group.items[0]));
    await assertFails(F.setDoc(F.doc(client(uid), `codex_versions/${generation}/deleted_categories/forged`), {}));
  }
  const player = client('player'), items = F.collection(player, categoryPath + '/items');
  for (const rank of ['sourceRank', 'displayRank']) assert.equal((await assertSucceeds(F.getDocs(F.query(F.collection(player, `codex_versions/${generation}/categories`), F.orderBy(rank), F.orderBy(F.documentId()), F.limit(26))))).size, 1);
  await assertFails(F.getDocs(items));
  await assertFails(F.getDocs(F.query(items, F.orderBy('sourceRank'), F.orderBy(F.documentId()), F.limit(52))));
  await assertFails(F.getDocs(F.query(items, F.orderBy('legacyKey'), F.orderBy(F.documentId()), F.limit(26))));
  await assertFails(F.getDocs(F.query(items, F.orderBy('sourceRank', 'desc'), F.orderBy(F.documentId(), 'desc'), F.limit(26))));
  for (const order of ['sourceRank', 'displayRank']) {
    const result = []; let cursor = null;
    do {
      const constraints = [F.orderBy(order), F.orderBy(F.documentId()), ...(cursor ? [F.startAfter(cursor[order], cursor.id)] : []), F.limit(26)];
      const page = await assertSucceeds(F.getDocs(F.query(items, ...constraints)));
      const data = page.docs.map(d => d.data()); result.push(...data.slice(0, 25)); cursor = data.length > 25 ? data[24] : null;
    } while (cursor);
    assert.equal(result.length, 60); assert.deepEqual(result.map(i => i.legacyKey), [...group.items].sort((a, b) => a[order] - b[order]).map(i => i.legacyKey));
    assert.deepEqual(Object.fromEntries(result.map(i => [i.legacyKey, i.value])), s.state.source.A);
  }
  await assertFails(F.getDoc(F.doc(client(null), categoryPath)));
  await assertFails(F.getDoc(F.doc(player, `codex_versions/old/categories/${group.category.id}`)));
  const indexes = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firestore.indexes.json')));
  assert.ok(!indexes.fieldOverrides.some(x => ['items', 'categories'].includes(x.collectionGroup) && ['sourceRank', 'displayRank'].includes(x.fieldPath) && !x.indexes.length));
  await action('rollback-freeze'); await assertSucceeds(F.getDoc(F.doc(player, categoryPath)));
});
test('writer exact two-document edits, same/different category contention and stale duplicates', async () => {
  let s = await activate(); const a = s.groups.find(g => g.category.legacyKey === 'Razze'), b = s.groups.find(g => g.category.legacyKey === 'Lingue');
  const before = await Promise.all(s.state.documents.map(async d => [d.path, (await db.doc(d.path).get()).updateTime.toMillis()]));
  const p = edit(s, a, 'edited'); await C.mutateCodex(db, 'dm', p);
  const changed = [];
  for (const [p, time] of before) if ((await db.doc(p).get()).updateTime.toMillis() !== time) changed.push(p);
  assert.deepEqual(changed.sort(), [`codex_versions/${generation}/categories/${a.category.id}`, `codex_versions/${generation}/categories/${a.category.id}/items/${a.items[0].id}`].sort());
  assert.deepEqual((await db.doc(C.CONTROL).get()).data(), s.control);
  await assert.rejects(C.mutateCodex(db, 'dm', p), e => e.code === 'aborted');
  s = await current(); const a2 = s.groups.find(g => g.category.id === a.category.id), b2 = s.groups.find(g => g.category.id === b.category.id);
  const conflicts = await Promise.allSettled([C.mutateCodex(db, 'dm', edit(s, a2, 'one')), C.mutateCodex(db, 'webmaster', edit(s, a2, 'two'))]);
  assert.equal(conflicts.filter(r => r.status === 'fulfilled').length, 1); assert.equal(conflicts.find(r => r.status === 'rejected').reason.code, 'aborted');
  s = await current(); const a3 = s.groups.find(g => g.category.id === a.category.id);
  const independent = await Promise.allSettled([C.mutateCodex(db, 'dm', edit(s, a3, 'independent A')), C.mutateCodex(db, 'dm', edit(s, b2, 'independent B'))]);
  assert.equal(independent.filter(r => r.status === 'fulfilled').length, 2);
  for (const uid of ['player', 'pending', 'missing']) await assert.rejects(C.mutateCodex(db, uid, edit(s, a3, 'denied')), e => e.code === 'permission-denied');
  await db.doc('user_deletion_jobs/dm').set({status: 'done'});
  await assert.rejects(C.mutateCodex(db, 'dm', edit(s, a3, 'denied')), e => e.code === 'permission-denied');
  await db.doc('user_deletion_jobs/dm').delete(); await action('rollback-freeze');
  await assert.rejects(C.mutateCodex(db, 'dm', edit(s, a3, 'denied')), /frozen/);
});
test('numeric category/item additions preserve map enumeration, display pages and exact persisted rollback', async () => {
  let s = await activate({Named: {Word: 'word'}}), g = s.groups[0];
  const originalCategory = g.category, originalItem = g.items[0], expected = {Named: {Word: 'word'}};
  for (const key of ['12', '2', '30', '02']) {
    const result = await C.mutateCodex(db, 'dm', request(s, 'item-add', {categoryId: g.category.id, categoryRevision: g.category.revision, legacyKey: key, value: 'value ' + key}));
    g = {...g, category: result.category}; expected.Named[key] = 'value ' + key;
  }
  for (const key of ['12', '2', '30', '02']) {
    await C.mutateCodex(db, 'dm', request(s, 'category-add', {legacyKey: key, metadataRevision: s.control.metadataRevision}));
    s = {...s, control: {...s.control, metadataRevision: s.control.metadataRevision + 1}}; expected[key] = {};
  }
  s = await current(); g = s.groups.find(group => group.category.legacyKey === 'Named');
  assert.equal(g.category.id, originalCategory.id);
  assert.deepEqual(g.items.find(i => i.id === originalItem.id), originalItem);
  assert.deepEqual([...g.items].sort((a, b) => a.sourceRank - b.sourceRank).map(i => i.legacyKey), ['Word', '12', '2', '30', '02']);
  const reconstructed = C.M.restoreLegacyCodex(s.groups);
  assert.deepEqual(reconstructed, expected);
  assert.deepEqual(Object.keys(reconstructed), ['2', '12', '30', 'Named', '02']);
  assert.deepEqual(Object.keys(reconstructed.Named), ['2', '12', '30', 'Word', '02']);
  const player = client('player');
  for (const [collectionPath, names] of [[`codex_versions/${generation}/categories`, Object.keys(expected)],
    [`codex_versions/${generation}/categories/${g.category.id}/items`, Object.keys(expected.Named)]]) {
    const display = (await assertSucceeds(F.getDocs(F.query(F.collection(player, collectionPath), F.orderBy('displayRank'), F.orderBy(F.documentId()), F.limit(26))))).docs.map(d => d.get('legacyKey'));
    assert.deepEqual(display, [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en-US')));
  }
  await action('rollback-freeze'); const result = await action('rollback');
  const stored = (await db.doc(C.LEGACY).get()).data();
  assert.deepEqual(stored, expected); assert.equal(C.sourceHash(stored), result.digest);
  assert.deepEqual(Object.keys(stored), Object.keys(expected)); assert.deepEqual(Object.keys(stored.Named), Object.keys(expected.Named));
});
test('category case collisions reject off-page and concurrent variants; migrated variants and item case remain intact', async () => {
  const source = {...Object.fromEntries(Array.from({length: 60}, (_, i) => ['Category' + String(i).padStart(2, '0'), {}])), Mixed: {Foo: 'upper original'}, mixed: {existing: 'lower original'}};
  let s = await activate(source);
  const player = client('player'), page = await F.getDocs(F.query(F.collection(player, `codex_versions/${generation}/categories`), F.orderBy('displayRank'), F.orderBy(F.documentId()), F.limit(26)));
  assert.equal(page.docs.some(d => d.get('legacyKey') === 'Category59'), false);
  const addCategory = name => request(s, 'category-add', {legacyKey: name, metadataRevision: s.control.metadataRevision});
  for (const key of ['cATEGORY59', 'MIXED']) await assert.rejects(C.mutateCodex(db, 'dm', addCategory(key)), e => e.code === 'already-exists');
  assert.equal(C.hash((await current()).state), C.hash(s.state));
  const staleRevision = s.control.metadataRevision;
  const results = await Promise.allSettled([C.mutateCodex(db, 'dm', addCategory('Nova')), C.mutateCodex(db, 'webmaster', addCategory('nOvA'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'already-exists');
  const next = await current();
  assert.equal(next.groups.filter(g => g.category.legacyKey.toLowerCase() === 'nova').length, 1);
  for (const original of s.groups) assert.deepEqual(next.groups.find(g => g.category.id === original.category.id), original);
  s = next;
  await assert.rejects(C.mutateCodex(db, 'dm', request(s, 'category-add', {legacyKey: 'Unrelated', metadataRevision: staleRevision})), e => e.code === 'aborted');
  let g = s.groups.find(g => g.category.legacyKey === 'Mixed');
  for (const key of ['foo', 'FOO']) {
    const result = await C.mutateCodex(db, 'dm', request(s, 'item-add', {categoryId: g.category.id, categoryRevision: g.category.revision, legacyKey: key, value: key}));
    g = {...g, category: result.category};
  }
  await assert.rejects(C.mutateCodex(db, 'dm', request(s, 'item-add', {categoryId: g.category.id, categoryRevision: g.category.revision, legacyKey: 'foo', value: 'duplicate'})), e => e.code === 'already-exists');
  s = await current(); const expected = C.M.restoreLegacyCodex(s.groups);
  assert.deepEqual(expected.Mixed, {Foo: 'upper original', foo: 'foo', FOO: 'FOO'}); assert.deepEqual(expected.mixed, source.mixed);
  await action('rollback-freeze'); const result = await action('rollback');
  const stored = (await db.doc(C.LEGACY).get()).data(); assert.deepEqual(stored, expected); assert.equal(C.sourceHash(stored), result.digest);
});
test('real 20-category 5000-item indexed paging keeps initial bodies bounded and every option reachable', async () => {
  const source = require('../../scripts/performance/fixtures').buildDocuments().find(d => d.path === C.LEGACY).data;
  await reset(source);
  const groups = C.M.projectLegacyCodex(source), control = {schemaVersion: 2, mode: 'v2', generation, epoch: 2, metadataRevision: 0, collationLocale: 'en-US'};
  const docs = groups.flatMap(g => [{path: `codex_versions/${generation}/categories/${g.category.id}`, data: g.category}, ...g.items.map(i => ({path: `codex_versions/${generation}/categories/${g.category.id}/items/${i.id}`, data: i}))]);
  for (let start = 0; start < docs.length; start += 400) { const batch = db.batch(); for (const d of docs.slice(start, start + 400)) batch.set(db.doc(d.path), d.data); await batch.commit(); }
  await db.doc(C.CONTROL).set(control);
  const player = client('player'), metadata = (await F.getDocs(F.query(F.collection(player, `codex_versions/${generation}/categories`), F.orderBy('sourceRank'), F.orderBy(F.documentId()), F.limit(26)))).docs.map(d => d.data());
  assert.equal(metadata.length, 20);
  const first = (await F.getDocs(F.query(F.collection(player, `codex_versions/${generation}/categories/${metadata[0].id}/items`), F.orderBy('displayRank'), F.orderBy(F.documentId()), F.limit(26)))).docs.map(d => d.data());
  assert.equal(first.length, 26);
  const bytes = Buffer.byteLength(JSON.stringify({control, metadata, items: first})); assert.ok(bytes < 250941 * 0.1);
  let reachable = 0;
  for (const category of metadata) {
    const collected = []; let cursor = null;
    do {
      const page = (await F.getDocs(F.query(F.collection(player, `codex_versions/${generation}/categories/${category.id}/items`), F.orderBy('sourceRank'), F.orderBy(F.documentId()), ...(cursor ? [F.startAfter(cursor.sourceRank, cursor.id)] : []), F.limit(51)))).docs.map(d => d.data());
      collected.push(...page.slice(0, 50)); cursor = page.length > 50 ? page[49] : null;
    } while (cursor);
    assert.deepEqual(Object.entries(Object.fromEntries(collected.map(i => [i.legacyKey, i.value]))), Object.entries(source[category.legacyKey])); reachable += collected.length;
  }
  assert.equal(reachable, 5000); console.log('Task12 real indexed fixture ' + JSON.stringify({categories: metadata.length, initialBodies: first.length, serializedBytes: bytes, reachable}));
});
test('large category atomic deletion, add/delete race and re-add never resurrect retained bodies', async () => {
  let s = await activate({Large: Object.fromEntries(Array.from({length: 510}, (_, i) => ['item' + String(i).padStart(3, '0'), 'v']))});
  let g = s.groups[0];
  const add = request(s, 'item-add', {categoryId: g.category.id, categoryRevision: g.category.revision, legacyKey: 'New', value: 'new'});
  const del = request(s, 'category-delete', {categoryId: g.category.id, categoryRevision: g.category.revision, metadataRevision: s.control.metadataRevision});
  const results = await Promise.allSettled([C.mutateCodex(db, 'dm', add), C.mutateCodex(db, 'dm', del)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  s = await current(); if (s.groups.length) { g = s.groups[0]; await C.mutateCodex(db, 'dm', request(s, 'category-delete', {categoryId: g.category.id, categoryRevision: g.category.revision, metadataRevision: s.control.metadataRevision})); }
  s = await current(); assert.equal(s.groups.length, 0); assert.equal(s.deleted.length, 1); assert.ok(s.deleted[0].items.length >= 510);
  const oldPath = `codex_versions/${generation}/categories/${g.category.id}/items/${g.items[0].id}`;
  assert.equal((await db.doc(oldPath).get()).exists, true); await assertFails(F.getDoc(F.doc(client('dm'), oldPath)));
  const added = await C.mutateCodex(db, 'dm', request(s, 'category-add', {legacyKey: 'Large', metadataRevision: s.control.metadataRevision}));
  assert.notEqual(added.category.id, g.category.id); assert.ok(added.category.sourceRank > g.category.sourceRank); assert.equal(added.category.itemCount, 0);
  await action('rollback-freeze'); await action('rollback'); assert.deepEqual((await db.doc(C.LEGACY).get()).data(), {Large: {}});
});
test('rollback every phase, post-cutover edits/add/delete preserved, overflow blocked then resumes v2', async () => {
  await reset(); assert.equal((await action('rollback')).mode, 'legacy');
  for (const stage of ['frozen', 'partial', 'verified']) {
    await reset(); await action('freeze');
    if (stage !== 'frozen') await action('backfill'); if (stage === 'verified') await action('verify');
    await action('rollback'); assert.deepEqual((await db.doc(C.LEGACY).get()).data(), small());
    assert.equal((await action('rollback')).replayed, true);
  }
  let s = await activate(), g = s.groups.find(g => g.category.legacyKey === 'Razze');
  await C.mutateCodex(db, 'dm', edit(s, g, 'post-cutover edit'));
  s = await current(); g = s.groups.find(g => g.category.legacyKey === 'Razze');
  await C.mutateCodex(db, 'dm', request(s, 'item-add', {categoryId: g.category.id, categoryRevision: g.category.revision, legacyKey: 'Dwarf', value: 'new dwarf'}));
  s = await current(); g = s.groups.find(g => g.category.legacyKey === 'Razze'); const item = g.items.find(i => i.legacyKey === 'Human');
  await C.mutateCodex(db, 'dm', request(s, 'item-delete', {categoryId: g.category.id, categoryRevision: g.category.revision, itemId: item.id, itemRevision: item.revision}));
  s = await current(); const expected = C.M.restoreLegacyCodex(s.groups);
  await action('rollback-freeze'); const result = await action('rollback');
  const restored = (await db.doc(C.LEGACY).get()).data(); assert.deepEqual(restored, expected);
  console.log('Task12 rollback persisted ordering ' + JSON.stringify({before: Object.keys(expected.Razze), after: Object.keys(restored.Razze), digestMatches: C.sourceHash(restored) === result.digest}));
  s = await activate({A: {a: 'a'}, B: {b: 'b'}});
  await Promise.all(s.groups.map(g => C.mutateCodex(db, 'dm', edit(s, g, 'x'.repeat(550000)))));
  await action('rollback-freeze'); await assert.rejects(action('rollback'), e => e.code === 'resource-exhausted');
  assert.deepEqual((await db.doc(C.LEGACY).get()).data(), {A: {a: 'a'}, B: {b: 'b'}});
  assert.equal((await db.doc(C.CONTROL).get()).get('mode'), 'rollback-frozen');
  assert.equal((await action('resume-v2')).mode, 'v2');
});
