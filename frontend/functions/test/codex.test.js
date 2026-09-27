const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const C = require('../lib/codexCore');
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
