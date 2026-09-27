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
