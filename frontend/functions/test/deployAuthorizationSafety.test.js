const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {assertActiveCaller} = require('../lib/callerAuthorization');
const {planLevelUpAllLegacy} = require('../lib/levelUpAllLegacy');

const source = (name) => fs.readFileSync(
  path.join(__dirname, '..', 'src', name),
  'utf8'
).replace(/\r\n?/g, '\n');

const callerSnapshot = (data, exists = true) => ({
  exists,
  get: (field) => data?.[field],
});

test('active-caller guard rejects missing and tombstoned profiles', () => {
  assert.throws(
    () => assertActiveCaller(callerSnapshot({}, false)),
    (error) => error.code === 'permission-denied' &&
      /missing/i.test(error.message)
  );
  assert.throws(
    () => assertActiveCaller(callerSnapshot({deletionState: 'pending'})),
    (error) => error.code === 'permission-denied' &&
      /pending deletion/i.test(error.message)
  );
  assert.doesNotThrow(() => assertActiveCaller(callerSnapshot({role: 'dm'})));
});

test('privileged mutation entry points apply the active-caller guard', () => {
  for (const name of [
    'userDataCommands.ts',
    'deleteUser.ts',
    'levelUpAllLegacy.ts',
  ]) {
    const contents = source(name);
    assert.match(
      contents,
      /import \{assertActiveCaller\} from "\.\/callerAuthorization";/,
      name
    );
    assert.match(contents, /assertActiveCaller\(/, name);
  }
});

test('legacy Level Up All preserves result and token behavior', () => {
  const plan = planLevelUpAllLegacy([
    {userId: 'dm', data: {role: 'dm', stats: {level: 4}}},
    {userId: 'max', data: {role: 'player', stats: {level: 10}}},
    {userId: 'new', data: {role: 'player'}},
    {userId: 'veteran', data: {role: 'player', stats: {level: 7}}},
  ]);

  assert.deepEqual(plan.updates, [
    {userId: 'new', fromLevel: 1, toLevel: 2, tokensGranted: 4},
    {userId: 'veteran', fromLevel: 7, toLevel: 8, tokensGranted: 8},
  ]);
  assert.equal(plan.results[0].skipped, 'DM account');
  assert.equal(plan.results[1].skipped, 'Already at max level');
  assert.equal(plan.results[2].toLevel, 2);
  assert.equal(plan.results[3].toLevel, 8);
});

test('legacy Level Up All keeps the users query outside its transaction', () => {
  const contents = source('levelUpAllLegacy.ts');
  const usersRead = contents.indexOf(
    'const users = await db.collection("users").get()'
  );
  const transaction = contents.indexOf(
    'await db.runTransaction(async (transaction)'
  );
  assert.ok(usersRead >= 0);
  assert.ok(transaction > usersRead);
  assert.doesNotMatch(
    contents,
    /transaction\.get\(db\.collection\("users"\)\)/
  );
  assert.match(contents, /transaction\.getAll\(\s*callerRef,\s*rolloutRef/);
  assert.match(contents, /assertDmCaller\(caller\)/);
  assert.match(contents, /transaction\.update\(userRef/);
  assert.match(contents, /assertLegacyRootMutationAllowed\(/);
  assert.match(contents, /updates\.length \* 2 > 500/);
});
