const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const C = require('../lib/codexCore');
// Firestore's production map encoding sorts UTF-8 keys. The emulator may
// preserve submitted protobuf order, so exercise actual applyPlan against this
// atomic store as well as the real emulator. Never model writes as JS identity.
const persistedMap = value => Array.isArray(value) ? value.map(persistedMap)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(key => [key, persistedMap(value[key])])) : value;
function sortedMapStore(entries) {
  const data = new Map(entries.map(([key, value]) => [key, persistedMap(value)]));
  const document = path => ({path, id: path.split('/').at(-1), listCollections: async () => {
    const names = new Set([...data.keys()].filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1).split('/')[0]));
    return [...names].map(name => ({listDocuments: async () => {
      const prefix = path + '/' + name + '/';
      return [...new Set([...data.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0]))].map(id => document(prefix + id));
    }}));
  }});
  const snapshot = ref => ({ref, exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path))});
  return {data, commits: [], doc: document, failNextCommit: false, async runTransaction(fn) {
    const pending = [];
    const result = await fn({getAll: async (...refs) => refs.map(snapshot),
      set: (ref, value) => pending.push([ref.path, value]),
      create: (ref, value) => { assert.equal(data.has(ref.path), false); pending.push([ref.path, value]); }});
    if (this.failNextCommit && pending.length) { this.failNextCommit = false; throw Error('Injected atomic commit failure'); }
    for (const [key, value] of pending) data.set(key, persistedMap(value));
    if (pending.length) this.commits.push(pending.map(([key]) => key));
    return result;
  }};
}
function rollbackStore(source, current = source) {
  const generation = 'sorted-test', root = `codex_versions/${generation}`;
  const entries = [[C.LEGACY, source], [C.CONTROL, {schemaVersion: 2, mode: 'rollback-frozen', generation, epoch: 4, metadataRevision: 1, collationLocale: 'en-US'}],
    [root, {schemaVersion: 2, generation, status: 'active', runtime: C.runtime()}]];
  for (const {category, items} of C.M.projectLegacyCodex(current)) {
    entries.push([`${root}/categories/${category.id}`, category]);
    for (const item of items) entries.push([`${root}/categories/${category.id}/items/${item.id}`, item]);
  }
  return sortedMapStore(entries);
}
async function rollbackStep(db, action = 'rollback') {
  const state = await C.readState(db, 'sorted-test'), plan = C.makePlan(state, action, 'sorted-test');
  return C.applyPlan(db, plan, plan.fingerprint);
}
test('sorted persistence rejects unsafe post-add rollback BEFORE enabling legacy or replacing its backup', async () => {
  const prior = {Razze: {Elf: 'elf', Human: 'human'}}, current = {Razze: {...prior.Razze, Dwarf: 'new dwarf'}};
  const db = rollbackStore(prior, current);
  await assert.rejects(rollbackStep(db), /order|represent/i);
  assert.equal(db.data.get(C.CONTROL).mode, 'rollback-frozen');
  assert.deepEqual(db.data.get(C.LEGACY), prior);
  assert.equal((await rollbackStep(db, 'resume-v2')).mode, 'v2');
});
test('rollback checkpoints prove candidate then persisted legacy; final activation never rewrites legacy', async () => {
  const prior = {Razze: {Elf: 'old elf', Human: 'deleted human'}}, desired = {Razze: {Elf: 'edited elf', Orc: 'new orc'}};
  const db = rollbackStore(prior, desired), candidatePath = C.rollbackCandidatePath('sorted-test');
  const start = await C.readState(db, 'sorted-test'), stale = C.makePlan(start, 'rollback', 'sorted-test');
  const prepared = await C.applyPlan(db, stale, stale.fingerprint);
  assert.deepEqual([prepared.stage, prepared.complete, prepared.nextAction], ['candidate-persisted', false, 'rollback']);
  assert.equal(db.data.get(C.CONTROL).mode, 'rollback-frozen'); assert.deepEqual(db.data.get(C.LEGACY), prior);
  assert.equal(C.sourceHash(db.data.get(candidatePath).source), C.sourceHash(desired));
  await assert.rejects(C.applyPlan(db, stale, stale.fingerprint), /stale/);
  const written = await rollbackStep(db);
  assert.deepEqual([written.stage, written.complete, written.nextAction], ['legacy-persisted', false, 'rollback']);
  assert.equal(db.data.get(C.CONTROL).mode, 'rollback-frozen'); assert.deepEqual(db.data.get(C.LEGACY), desired);
  const final = await rollbackStep(db);
  assert.deepEqual([final.stage, final.complete, final.nextAction], ['complete', true, null]);
  assert.equal(db.data.get(C.CONTROL).mode, 'legacy'); assert.equal(C.sourceHash(db.data.get(C.LEGACY)), final.digest);
  assert.deepEqual(db.commits.at(-1).sort(), [C.CONTROL, 'codex_versions/sorted-test'].sort());
  const commits = db.commits.length; assert.equal((await rollbackStep(db)).replayed, true); assert.equal(db.commits.length, commits);
});
test('rollback sorted-map prediction handles integer, Unicode and category keys conservatively', async () => {
  for (const desired of [{Zed: {}, Alpha: {}}, {A: {Word: 'v', '02': 'late ordinary key'}},
    {A: {'\u{10000}': 'astral', '\uE000': 'BMP'}}, {'\u{10000}': {}, '\uE000': {}}]) {
    const db = rollbackStore({Original: {}}, desired), old = db.data.get(C.LEGACY);
    const plan = C.makePlan(await C.readState(db, 'sorted-test'), 'rollback', 'sorted-test');
    assert.equal(plan.rollback.orderRepresentable, false); assert.equal(plan.rollback.safe, false);
    await assert.rejects(C.applyPlan(db, plan, plan.fingerprint), /order/);
    assert.deepEqual(db.data.get(C.LEGACY), old); assert.equal(db.commits.length, 0);
  }
  for (const desired of [{'12': {}, '2': {}, Named: {}}, {A: {'12': 'twelve', '2': 'two', Word: 'word'}},
    {'\uE000': {}, '\u{10000}': {}}, {A: {'\uE000': 'BMP', '\u{10000}': 'astral'}}]) {
    const db = rollbackStore({Original: {}}, desired);
    await rollbackStep(db); await rollbackStep(db); const done = await rollbackStep(db);
    assert.equal(done.complete, true); assert.equal(C.sourceHash(db.data.get(C.LEGACY)), C.sourceHash(desired));
  }
});
test('corrupt, foreign, missing or reordered persisted candidates cannot promote legacy and can be abandoned', async () => {
  const prior = {A: {B: 'old', C: 'old'}}, desired = {A: {B: 'new', C: 'new'}};
  const path = C.rollbackCandidatePath('sorted-test');
  for (const corrupt of [db => db.data.delete(path), db => { db.data.get(path).source.A.B = 'corrupt'; },
    db => { db.data.get(path).generation = 'foreign'; }, db => { db.data.get(path).extra = true; },
    db => { db.data.get(path).source.A = {C: 'new', B: 'new'}; },
    db => { db.data.get('codex_versions/sorted-test').rollback.runtime.icu = 'changed'; }]) {
    const db = rollbackStore(prior, desired); await rollbackStep(db); corrupt(db);
    await assert.rejects(rollbackStep(db), /candidate|checkpoint/);
    assert.deepEqual(db.data.get(C.LEGACY), prior); assert.equal(db.data.get(C.CONTROL).mode, 'rollback-frozen');
    assert.equal((await rollbackStep(db, 'resume-v2')).mode, 'v2');
    assert.equal(db.data.get('codex_versions/sorted-test').rollback.phase, 'abandoned');
    await rollbackStep(db, 'rollback-freeze');
    assert.equal((await rollbackStep(db)).stage, 'candidate-persisted');
  }
});
test('persisted legacy mismatch and checkpoint crashes remain frozen; fresh review can resume or recover', async () => {
  const prior = {A: {B: 'old', C: 'old'}}, desired = {A: {B: 'new', C: 'new'}};
  for (const stage of ['candidate', 'legacy']) {
    const db = rollbackStore(prior, desired);
    db.failNextCommit = true; await assert.rejects(rollbackStep(db), /commit failure/);
    assert.deepEqual(db.data.get(C.LEGACY), prior); assert.equal(db.data.get(C.CONTROL).mode, 'rollback-frozen');
    await rollbackStep(db);
    if (stage === 'legacy') await rollbackStep(db);
    const correct = structuredClone(db.data.get(C.LEGACY));
    db.data.set(C.LEGACY, {A: {C: correct.A.C, B: correct.A.B}});
    await assert.rejects(rollbackStep(db), /legacy|source/i);
    const inspected = C.makePlan(await C.readState(db, 'sorted-test'), 'rollback', 'sorted-test');
    assert.equal(inspected.rollback.safe, false); assert.equal(db.data.get(C.CONTROL).mode, 'rollback-frozen');
    db.data.set(C.LEGACY, correct); // operator repairs only the corrupted staging value
    if (stage === 'candidate') await rollbackStep(db);
    assert.equal((await rollbackStep(db)).complete, true);
  }
  const db = rollbackStore(prior, desired); await rollbackStep(db); await rollbackStep(db);
  db.data.get(C.LEGACY).A.B = 'corrupt'; await assert.rejects(rollbackStep(db), /legacy/);
  assert.equal((await rollbackStep(db, 'resume-v2')).mode, 'v2');
});
test('rollback checkpoint binds current v2, runtime, scope and plan; overflow never writes a candidate', async () => {
  const db = rollbackStore({A: {B: 'old'}}, {A: {B: 'new'}}); await rollbackStep(db);
  const item = [...db.data.entries()].find(([key]) => key.includes('/items/'));
  item[1].value = 'changed after candidate';
  await assert.rejects(rollbackStep(db), /checkpoint/);
  assert.equal((await rollbackStep(db, 'resume-v2')).mode, 'v2');
  const scoped = rollbackStore({A: {B: 'old'}}, {A: {B: 'new'}}); await rollbackStep(scoped);
  const state = await C.readState(scoped, 'sorted-test'), plan = C.makePlan(state, 'rollback', 'sorted-test', {target: 'other'});
  await assert.rejects(C.applyPlan(scoped, plan, plan.fingerprint, {target: 'other'}), /checkpoint/);
  const overflow = rollbackStore({A: {B: 'old'}}, {A: {B: 'x'.repeat(550000), C: 'x'.repeat(550000)}});
  await assert.rejects(rollbackStep(overflow), e => e.code === 'resource-exhausted');
  assert.equal(overflow.data.has(C.rollbackCandidatePath('sorted-test')), false); assert.equal(overflow.commits.length, 0);
  assert.equal((await rollbackStep(overflow, 'resume-v2')).mode, 'v2');
});
test('unused generation rejects an orphan private candidate and canonical orphan checks remain strict', async () => {
  const source = {A: {B: 'old'}}, db = sortedMapStore([[C.LEGACY, source], [C.rollbackCandidatePath('sorted-test'), {generation: 'foreign'}]]);
  const plan = C.makePlan(await C.readState(db, 'sorted-test'), 'freeze', 'sorted-test');
  await assert.rejects(C.applyPlan(db, plan, plan.fingerprint), /unused generation/);
  const active = rollbackStore(source); await rollbackStep(active);
  active.data.set('codex_versions/sorted-test/unknown/orphan', {value: 'unexpected'});
  await assert.rejects(rollbackStep(active, 'resume-v2'), /Unexpected/);
});
test('deployed schema/core byte parity and package-local dependencies', () => {
  assert.deepEqual(fs.readFileSync(path.resolve(__dirname, '../../src/data/codexModel.js')), fs.readFileSync(path.resolve(__dirname, '../lib/codexModel.js')));
  assert.deepEqual(fs.readFileSync(path.resolve(__dirname, '../src/codexCore.js')), fs.readFileSync(path.resolve(__dirname, '../lib/codexCore.js')));
  assert.equal(C.M.CODEX_PAGE_SIZE, 25);
});
test('invalid source reports every unsafe key and rejects non-lossless values', () => {
  assert.equal(C.inspectSource({'': {'__bad__': 'x'}, A: {B: undefined}}).valid, false);
  assert.equal(C.inspectSource({A: {B: [[1]]}}).valid, false);
  assert.equal(C.inspectSource({A: {B: {__bad__: 1}}}).valid, false);
  assert.equal(C.inspectSource({A: {B: {x: ['a', 1, null]}}}).valid, true);
  assert.equal(C.inspectSource({A: {B: 'x'.repeat(1000000)}}).valid, false);
  assert.equal(C.inspectSource({A: {B: '\ud800'}}).valid, false);
});
test('typed requests reject arbitrary fields, absent revisions and invalid keys', () => {
  const p = {action: 'item-edit', epoch: 1, generation: 'g', categoryId: 'c', itemId: 'i', categoryRevision: 1, itemRevision: 1, value: 'v'};
  assert.deepEqual(C.validateMutation(p), p);
  assert.throws(() => C.validateMutation({...p, role: 'dm'}));
  assert.throws(() => C.validateMutation({...p, itemRevision: 0}));
  assert.throws(() => C.validateMutation({...p, action: 'rename'}));
});
test('source ranks append for numeric keys; duplicate keys and rank exhaustion still reject', () => {
  const row = {legacyKey: 'B', sourceRank: 2, displayRank: 1024};
  assert.deepEqual(C.insertion([row], 'A', 'en-US'), {sourceRank: 3, displayRank: 512});
  assert.deepEqual(C.insertion([row], '1', 'en-US'), {sourceRank: 3, displayRank: 512});
  assert.throws(() => C.insertion([row], 'B', 'en-US'));
  assert.throws(() => C.insertion([{...row, legacyKey: 'A', displayRank: 1}, {...row, legacyKey: 'Z', displayRank: 1 + Number.EPSILON}], 'M', 'en-US'));
});
test('numeric category/item reconstruction follows JS map enumeration without changing IDs/ranks', () => {
  const groups = C.M.projectLegacyCodex({Named: {Word: 'word'}}), original = groups[0];
  for (const key of ['12', '2', '30', '02']) {
    const item = {...original.items[0], id: 'newItem' + key, legacyKey: key, normalizedName: key, value: key,
      ...C.insertion(original.items, key, 'en-US')};
    original.items.push(item); original.category = {...original.category, itemCount: original.items.length};
    groups.push({category: {...original.category, id: 'newCategory' + key, legacyKey: key, normalizedName: key, itemCount: 0,
      ...C.insertion(groups.map(g => g.category), key, 'en-US')}, items: []});
  }
  C.validateRows(groups.map(g => g.category), 'category', 'en-US');
  C.validateRows(original.items, 'item', 'en-US');
  const restored = C.M.restoreLegacyCodex(groups);
  assert.deepEqual(Object.keys(restored), ['2', '12', '30', 'Named', '02']);
  assert.deepEqual(Object.keys(restored.Named), ['2', '12', '30', 'Word', '02']);
  assert.deepEqual(original.items.map(i => i.sourceRank), [0, 1, 2, 3, 4]);
  assert.equal(original.items[0].id, 'i0000000000');
  const expected = Object.keys(restored.Named).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en-US'));
  assert.deepEqual([...original.items].sort((a, b) => a.displayRank - b.displayRank).map(i => i.legacyKey), expected);
  assert.throws(() => C.validateRows([...original.items, {...original.items[1], id: 'duplicateRank'}], 'item', 'en-US'), /Duplicate/);
});
test('verification rejects duplicate category keys/ranks and unexpected documents', () => {
  const source = {A: {a: 'one'}, B: {b: 'two'}}, groups = C.M.projectLegacyCodex(source);
  assert.throws(() => C.validateRows([groups[0].category, {...groups[1].category, legacyKey: 'A', normalizedName: 'a'}], 'category', 'en-US'));
  assert.throws(() => C.validateRows([groups[0].category, {...groups[1].category, sourceRank: 0}], 'category', 'en-US'));
  assert.throws(() => C.targetRows({documents: [{path: 'codex_versions/g/unknown/x', data: {}}]}, 'g', 'en-US'));
});
test('reviewed plans bind action, environment, runtime, source content/order and target', () => {
  const state = {source: {A: {a: 'v'}}, control: null, documents: []};
  const p = C.makePlan(state, 'freeze', 'g', {project: 'demo'});
  C.validatePlan(p, p.fingerprint, state, 'freeze', 'g', {project: 'demo'});
  for (const changed of [{...state, source: {A: {a: 'changed'}}}, {...state, documents: [{path: 'x', data: {}}]}]) assert.throws(() => C.validatePlan(p, p.fingerprint, changed, 'freeze', 'g', {project: 'demo'}));
  assert.throws(() => C.validatePlan(p, p.fingerprint, state, 'freeze', 'g', {project: 'other'}));
});
test('conservative encoded-size calculation exceeds simple JSON for many small fields', () => {
  const value = Object.fromEntries(Array.from({length: 4000}, (_, i) => ['k' + i, {n: i}]));
  assert.ok(C.encodedSize('utils/codex', value) > Buffer.byteLength(JSON.stringify(value)));
});
test('callable requires Firebase Auth and deployment enforces App Check', async () => {
  const callable = require('../lib/codex').task12MutateCodex;
  await assert.rejects(callable.run({data: {}}), e => e.code === 'unauthenticated');
  assert.equal(require('../lib/task07CallableOptions').TASK07_CALLABLE_OPTIONS.enforceAppCheck, true);
  assert.deepEqual(callable.__endpoint.region, ['europe-west8']);
});
test('dry-run exposes checkpoint/counts and current rollback integrity/size before approval', () => {
  const source = {Z: {z: 'z'}}, groups = C.M.projectLegacyCodex(source), root = 'codex_versions/g';
  const state = {source, control: {schemaVersion: 2, mode: 'rollback-frozen', generation: 'g', epoch: 2, metadataRevision: 0, collationLocale: 'en-US'},
    documents: [{path: root, data: {offset: 2}}, {path: root + '/categories/' + groups[0].category.id, data: groups[0].category},
      {path: root + '/categories/' + groups[0].category.id + '/items/' + groups[0].items[0].id, data: groups[0].items[0]}]};
  const plan = C.makePlan(state, 'rollback', 'g');
  assert.equal(plan.checkpoint.offset, 2); assert.equal(plan.target.items, 1);
  assert.equal(plan.rollback.valid, true); assert.equal(plan.rollback.fits, true); assert.equal(plan.rollback.digest, C.sourceHash(source));
  state.documents.pop(); assert.equal(C.makePlan(state, 'rollback', 'g').rollback.valid, false);
});
