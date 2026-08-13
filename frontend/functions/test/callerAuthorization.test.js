const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {assertActiveCaller} = require('../lib/callerAuthorization');

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

test('privileged V2 mutation entry points apply the active-caller guard', () => {
  for (const name of ['userDataCommands.ts', 'deleteUser.ts']) {
    const contents = source(name);
    assert.match(
      contents,
      /import \{assertActiveCaller\} from "\.\/callerAuthorization";/,
      name
    );
    assert.match(contents, /assertActiveCaller\(/, name);
  }
});
