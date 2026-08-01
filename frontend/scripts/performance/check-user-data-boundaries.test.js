const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  BASELINE_SCHEMA_VERSION,
  compareWithBaseline,
  createBaseline,
  findDirectAccessesInSource,
  fingerprintAccessContexts,
  scanDirectUserAccesses,
  scanForbiddenLegacyCommandArtifacts,
  readBaseline,
} = require('./check-user-data-boundaries');

test('detects root user documents and collections while allowing nested user collections', () => {
  const root = findDirectAccessesInSource([
    "getDoc(doc(db, 'users', uid));",
    'onSnapshot(collection(db, "users"), observer);',
    'admin.firestore().doc(`users/${uid}`).get();',
  ].join('\n'));
  assert.equal(root.length, 3);
  assert.deepEqual(root.map(({kind}) => kind), [
    'modular-user-document',
    'modular-users-collection',
    'compat-user-document',
  ]);

  assert.equal(findDirectAccessesInSource(
    "collection(db, 'users', uid, 'diceRolls')"
  ).length, 0);
  assert.equal(findDirectAccessesInSource(
    "doc(db, 'users', uid, 'state', 'resources')"
  ).length, 0);
});

test('fingerprints the Firestore operation and mutation payload around a legacy reference', () => {
  const fingerprint = (source) => fingerprintAccessContexts(findDirectAccessesInSource(source));
  const original = [
    "const userRef = doc(db, 'users', uid);",
    "const payload = { inventory: nextInventory };",
    'await updateDoc(userRef, payload);',
  ].join('\n');
  const payloadChanged = original.replace('nextInventory', 'replacementInventory');
  const operationChanged = original.replace('updateDoc', 'setDoc');
  const inlineOriginal = "updateDoc(doc(db, 'users', uid), { inventory: nextInventory });";
  const inlineChanged = inlineOriginal.replace('nextInventory', 'replacementInventory');
  const stringWhitespaceOriginal = "updateDoc(doc(db, 'users', uid), { label: 'a  b' });";
  const stringWhitespaceChanged = stringWhitespaceOriginal.replace('a  b', 'a b');

  const [access] = findDirectAccessesInSource(original);
  assert.deepEqual(access.operations, [{
    kind: 'mutation',
    operation: 'updateDoc',
    target: 'userRef',
    payload: ['payload'],
    payloadBindings: ['const payload = { inventory: nextInventory };'],
  }]);
  assert.notEqual(fingerprint(original), fingerprint(payloadChanged));
  assert.notEqual(fingerprint(original), fingerprint(operationChanged));
  assert.notEqual(fingerprint(inlineOriginal), fingerprint(inlineChanged));
  assert.notEqual(fingerprint(stringWhitespaceOriginal), fingerprint(stringWhitespaceChanged));
});

test('keeps scanning operations after JSX self-closing tags', () => {
  const source = [
    'const content = <Widget label="profile" />;',
    "updateDoc(doc(db, 'users', uid), { imageUrl });",
  ].join('\n');
  const [access] = findDirectAccessesInSource(source);
  assert.equal(access.operations.length, 1);
  assert.equal(access.operations[0].operation, 'updateDoc');
});

test('scanner excludes tests and approved repository adapters', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-user-boundary-'));
  context.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'data', 'userData'), {recursive: true});
  fs.mkdirSync(path.join(root, 'components'), {recursive: true});
  fs.writeFileSync(path.join(root, 'data', 'userData', 'userDataRepository.js'), "doc(db, 'users', uid)\n");
  fs.writeFileSync(path.join(root, 'components', 'legacy.js'), "doc(db, 'users', uid)\n");
  fs.writeFileSync(path.join(root, 'components', 'legacy.test.js'), "doc(db, 'users', uid)\n");
  const accesses = scanDirectUserAccesses(root);
  assert.equal(accesses.length, 1);
  assert.equal(accesses[0].path, 'components/legacy.js');
});

test('forbids obsolete command-routing files and references', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-user-command-boundary-'));
  context.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'data', 'userData'), {recursive: true});
  fs.mkdirSync(path.join(root, 'components'), {recursive: true});
  fs.writeFileSync(
    path.join(root, 'data', 'userData', 'legacyUserDataCommands.js'),
    'export const obsolete = true;\n'
  );
  fs.writeFileSync(
    path.join(root, 'components', 'consumer.js'),
    "import { runVersionedUserDataCommand } from '../data/userData/userDataCommandRouting';\n"
  );
  fs.writeFileSync(
    path.join(root, 'components', 'safe.js'),
    "import { purchaseItem } from '../data/userData/userDataCommands';\n"
  );

  assert.deepEqual(scanForbiddenLegacyCommandArtifacts(root), [
    {
      path: 'components/consumer.js',
      reason: 'forbidden-legacy-command-reference',
      moduleName: 'userDataCommandRouting',
    },
    {
      path: 'data/userData/legacyUserDataCommands.js',
      reason: 'forbidden-legacy-command-file',
    },
  ]);
});

test('baseline permits only exact legacy expressions and rejects new, changed, and stale entries', () => {
  const current = [{
    path: 'components/legacy.js',
    count: 1,
    operationCount: 1,
    contextFingerprint: 'abc',
    matches: [],
  }];
  const exact = createBaseline(current);
  assert.equal(exact.schemaVersion, BASELINE_SCHEMA_VERSION);
  assert.deepEqual(compareWithBaseline(current, exact), []);
  assert.deepEqual(compareWithBaseline([
    ...current,
    {
      path: 'components/new.js',
      count: 1,
      operationCount: 1,
      contextFingerprint: 'new',
      matches: [],
    },
  ], exact), [{path: 'components/new.js', reason: 'new-direct-access', count: 1}]);
  assert.deepEqual(compareWithBaseline([
    {...current[0], contextFingerprint: 'changed'},
  ], exact), [{
    path: 'components/legacy.js',
    reason: 'legacy-access-changed',
    expectedCount: 1,
    actualCount: 1,
    expectedOperationCount: 1,
    actualOperationCount: 1,
  }]);
  assert.deepEqual(compareWithBaseline([], exact), [{
    path: 'components/legacy.js',
    reason: 'stale-baseline-entry',
  }]);
});

test('rejects the reference-only v1 baseline schema', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-user-boundary-baseline-'));
  context.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const baselinePath = path.join(root, 'baseline.json');
  fs.writeFileSync(baselinePath, JSON.stringify({schemaVersion: 1, entries: []}));
  assert.throws(
    () => readBaseline(baselinePath),
    /unsupported schema/
  );
});

test('required Home and Bazaar acceptance routes use V2 user data boundaries', () => {
  const frontendRoot = path.resolve(__dirname, '..', '..');
  const read = (relativePath) => fs.readFileSync(
    path.join(frontendRoot, relativePath),
    'utf8'
  );
  const paramTables = read('src/components/home/elements/paramTables.js');
  const comparison = read('src/components/bazaar/elements/comparisonComponent.js');
  const addWeapon = read('src/components/bazaar/elements/addWeapon.js');

  assert.equal(findDirectAccessesInSource(paramTables).length, 0);
  assert.match(paramTables, /useProgression\(user\?\.uid\)/);
  assert.match(paramTables, /useUserSettings\(user\?\.uid\)/);
  assert.match(paramTables, /updateProgression\(\{/);

  assert.equal(findDirectAccessesInSource(comparison).length, 0);
  assert.match(comparison, /useProgression\(user\?\.uid\)/);
  assert.match(comparison, /authUserData\?\.role/);
  assert.match(comparison, /getUserDirectoryPage\(\)/);

  const addWeaponAccesses = findDirectAccessesInSource(addWeapon);
  assert.equal(addWeaponAccesses.length, 0);
  assert.match(addWeapon, /const role = authUserData\?\.role/);
  assert.match(addWeapon, /persistCanonicalInventoryItem\(\{/);
  assert.match(addWeapon, /useProgression\(user\?\.uid\)/);
  assert.match(addWeapon, /usePersonalSpells\(user\?\.uid\)/);
  assert.match(addWeapon, /usePersonalTechniques\(user\?\.uid\)/);
  assert.match(addWeapon, /getUserDirectoryPage\(\)/);
});

test('normal UI command flows depend only on canonical Task 05 commands', () => {
  const frontendRoot = path.resolve(__dirname, '..', '..');
  const commandFlows = [
    'src/components/bazaar/Bazaar.js',
    'src/components/bazaar/elements/acquireItem.js',
    'src/components/home/Home.js',
    'src/components/home/elements/Inventory.js',
    'src/components/home/elements/EquippedInventory.js',
    'src/components/home/elements/StatsBars.js',
    'src/components/home/elements/useConsumable.js',
    'src/components/home/elements/paramTables.js',
    'src/data/userData/index.js',
  ];
  for (const relativePath of commandFlows) {
    const source = fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /legacyUserDataCommands|userDataCommandRouting/, relativePath);
  }
  assert.equal(
    fs.existsSync(path.join(frontendRoot, 'src/data/userData/legacyUserDataCommands.js')),
    false
  );
  assert.equal(
    fs.existsSync(path.join(frontendRoot, 'src/data/userData/userDataCommandRouting.js')),
    false
  );
});

test('required auth, character, combat, and item flows use V2 user data boundaries', () => {
  const frontendRoot = path.resolve(__dirname, '..', '..');
  const read = (relativePath) => fs.readFileSync(
    path.join(frontendRoot, relativePath),
    'utf8'
  );
  const migratedFlows = [
    ['src/components/admin/adminPage.js', [/getAdminUsersPage/]],
    ['src/components/Login.js', [/updateCharacterCreation/]],
    ['src/components/characterCreation/CharacterCreation.js', [/updateCharacterCreation/]],
    ['src/components/characterCreation/elements/PointsDistribution.js', [
      /useProgression\(user\?\.uid\)/,
      /spendCharacterPoint/,
      /data\/userData\/userDataCommands/,
    ]],
    ['src/components/combatTool/elements/buttons/advanceTurn.js', [/consumeTurnEffects/]],
    ['src/components/combatTool/elements/EncounterCreator.js', [/subscribeUserDirectoryFirstPage/]],
    ['src/components/combatTool/elements/EncounterDetails.js', [
      /useProgression\(user\?\.uid\)/,
      /subscribeUserResources/,
    ]],
    ['src/components/home/elements/ItemDetailsModal.js', [/useEquipment/, /mutateInventory/]],
    ['src/components/tecnicheSpell/elements/spell_side.js', [/updateResource/]],
    ['src/components/tecnicheSpell/elements/tecniche_side.js', [/updateResource/]],
  ];

  for (const [relativePath, markers] of migratedFlows) {
    const source = read(relativePath);
    assert.equal(findDirectAccessesInSource(source).length, 0, relativePath);
    for (const marker of markers) assert.match(source, marker, relativePath);
  }
});
