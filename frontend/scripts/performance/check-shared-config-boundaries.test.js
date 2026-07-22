const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  containsSharedConfigAccess,
  findSharedConfigBoundaryOffenders,
} = require('./check-shared-config-boundaries');

test('detects direct modular utils collection and document access', () => {
  assert.equal(containsSharedConfigAccess("getDoc(doc(db, 'utils', 'varie'))"), true);
  assert.equal(containsSharedConfigAccess('collection(db, "utils")'), true);
  assert.equal(containsSharedConfigAccess("getDoc(doc(db, 'utils/codex'))"), true);
  assert.equal(containsSharedConfigAccess("setDocData('utils/varie', {})"), false);
  assert.equal(containsSharedConfigAccess("doc(db, 'users', uid)"), false);
});

test('allows only config and Codex repository production access', (context) => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-config-boundary-'));
  context.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'components'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'data', 'configRepository.js'),
    "getDoc(doc(db, 'utils', documentId));\n"
  );
  fs.writeFileSync(
    path.join(sourceRoot, 'data', 'codexRepository.js'),
    "onSnapshot(doc(db, 'utils', 'codex'), observer);\n"
  );
  fs.writeFileSync(
    path.join(sourceRoot, 'components', 'offender.js'),
    "getDoc(doc(db, 'utils', 'varie'));\n"
  );
  fs.writeFileSync(
    path.join(sourceRoot, 'components', 'fixture.test.js'),
    "getDoc(doc(db, 'utils', 'varie'));\n"
  );

  const offenders = findSharedConfigBoundaryOffenders(sourceRoot);
  assert.equal(offenders.length, 1);
  assert.match(offenders[0], /components[\\/]offender\.js$/);
});

