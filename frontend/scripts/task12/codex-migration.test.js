const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parse, guard, codeIdentity} = require('./codex-migration');
const base = {environmentName: 'staging', projectId: 'fatin-test', hostingSite: 'fatin-test', storageBucket: 'fatin-test.firebasestorage.app', auth: 'firebase-cli', mode: 'inspect', action: 'freeze', generation: 'g'};
test('actual branch and all explicit identities must agree', () => {
  assert.equal(guard(base, {}, 'devs').projectId, 'fatin-test');
  assert.throws(() => guard(base, {FND_GIT_BRANCH: 'devs'}, 'main'));
  assert.throws(() => guard(base, {GCLOUD_PROJECT: 'fatins'}, 'devs'));
  assert.throws(() => guard(base, {FIRESTORE_EMULATOR_HOST: 'localhost:8080'}, 'devs'));
  for (const key of ['environmentName', 'projectId', 'hostingSite', 'storageBucket', 'auth']) assert.throws(() => guard({...base, [key]: undefined}, {}, 'devs'));
});
test('apply needs exact reviewed fingerprint and rollback marker', () => {
  assert.throws(() => guard({...base, mode: 'apply'}, {}, 'devs'));
  const apply = {...base, mode: 'apply', action: 'rollback', confirmTarget: 'fatin-test', plan: 'x', reviewedFingerprint: 'a'.repeat(64)};
  assert.throws(() => guard(apply, {}, 'devs'));
  assert.equal(guard({...apply, rollback: 'g'}, {}, 'devs').name, 'staging');
});
test('parser and packaged code identity are strict', () => {
  assert.throws(() => parse(['--action', 'freeze', '--action', 'activate']));
  assert.throws(() => parse(['--unknown', 'x']));
  assert.match(codeIdentity(), /^[a-f0-9]{64}$/);
});
const C = require('../../functions/lib/codexCore');
const {verifyRollbackResult} = require('./codex-migration');
function checkpointState(stage) {
  const generation = 'operator-test', root = `codex_versions/${generation}`;
  const source = {A: {B: 'original'}}, current = {A: {B: 'edited'}};
  const state = {source, control: {schemaVersion: 2, generation, mode: 'rollback-frozen', epoch: 4, metadataRevision: 0, collationLocale: 'en-US'}, documents: [
    {path: root, data: {schemaVersion: 2, generation, status: 'active', runtime: C.runtime()}},
    ...C.M.projectLegacyCodex(current).flatMap(g => [{path: `${root}/categories/${g.category.id}`, data: g.category}, ...g.items.map(i => ({path: `${root}/categories/${g.category.id}/items/${i.id}`, data: i}))])
  ]};
  const projected = C.rollbackProjection(state, generation, state.control, {});
  state.rollbackCandidate = projected.candidate;
  state.documents[0].data.rollback = {...projected.bindings, phase: stage, priorLegacyDigest: C.sourceHash(source)};
  if (stage === 'legacy-persisted') state.source = current;
  return {state, generation, result: {mode: 'rollback-frozen', stage, complete: false, nextAction: 'rollback', digest: projected.bindings.digest}};
}
test('operator reports both persisted checkpoints as in-progress and rejects corrupted results', () => {
  for (const stage of ['candidate-persisted', 'legacy-persisted']) {
    const {state, generation, result} = checkpointState(stage);
    assert.equal(verifyRollbackResult(state, result, generation, {}), 'in-progress');
    assert.throws(() => verifyRollbackResult(state, {...result, complete: true}, generation, {}));
    assert.throws(() => verifyRollbackResult(state, {...result, nextAction: null}, generation, {}));
    const corrupt = structuredClone(state); corrupt.rollbackCandidate.source.A.B = 'corrupt';
    assert.throws(() => verifyRollbackResult(corrupt, result, generation, {}));
    const changed = structuredClone(state); changed.source.A.B = 'changed';
    assert.throws(() => verifyRollbackResult(changed, result, generation, {}));
  }
});
test('operator completion requires legacy mode and exact persisted digest', () => {
  const {state, generation, result} = checkpointState('legacy-persisted');
  const completed = {...result, mode: 'legacy', stage: 'complete', complete: true, nextAction: null};
  assert.throws(() => verifyRollbackResult(state, completed, generation, {}));
  state.control.mode = 'legacy';
  assert.equal(verifyRollbackResult(state, completed, generation, {}), 'committed');
  state.source.A.B = 'corrupt';
  assert.throws(() => verifyRollbackResult(state, completed, generation, {}));
  assert.equal(verifyRollbackResult({control: null}, {mode: 'legacy', stage: 'complete', complete: true, nextAction: null}, generation, {}), 'committed');
});
