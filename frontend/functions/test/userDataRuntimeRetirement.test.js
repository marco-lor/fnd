const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sourceRoot = path.resolve(__dirname, '..', 'src');
const functionsRoot = path.resolve(sourceRoot, '..');
const libRoot = path.join(functionsRoot, 'lib');
const frontendRoot = path.resolve(__dirname, '..', '..');
const source = (name) => fs.readFileSync(path.join(sourceRoot, name), 'utf8');

const retiredRuntimeFiles = [
  'userDataBridge.ts',
  'legacyRootMutationGate.ts',
  'levelUpAllLegacy.ts',
  'levelUpUserLegacy.ts',
  'spendCharacterPointLegacy.ts',
  'deleteGrigliataCustomTokenLegacy.ts',
  'updateHpTotal.ts',
  'updateManaTotal.ts',
  'updateTotParameters.ts',
  'updateAnimaModifier.ts',
  'expireBarriera.ts',
  'syncUserDerivedState.ts',
  'userDerivedState.ts',
  'demoConsolidatedOwner.ts',
];

test('retired V1 handlers, root triggers, and rollback bridge stay absent', () => {
  for (const name of retiredRuntimeFiles) {
    assert.equal(fs.existsSync(path.join(sourceRoot, name)), false, name);
  }
});

test('the Functions build cleans and rejects retired compiled artifacts', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(
    functionsRoot,
    'package.json'
  ), 'utf8'));
  assert.match(packageJson.scripts.build, /scripts\/clean-lib\.js/);
  assert.match(packageJson.scripts.build, /scripts\/verify-runtime-retirement\.js/);
  for (const name of retiredRuntimeFiles) {
    const stem = name.replace(/\.ts$/, '');
    for (const extension of ['.js', '.js.map']) {
      assert.equal(fs.existsSync(path.join(libRoot, `${stem}${extension}`)), false);
    }
  }
});

test('deployed exports contain only canonical User Data callables and directory sync', () => {
  const index = source('index.ts');
  for (const retiredExport of [
    'spendCharacterPoint,',
    'updateHpTotal',
    'updateManaTotal',
    'updateTotParameters',
    'updateAnimaModifier',
    'expireBarriera',
    'syncUserDerivedState',
  ]) {
    assert.doesNotMatch(index, new RegExp(retiredExport));
  }
  assert.match(index, /spendCharacterPointV2/);
  assert.match(index, /syncUserDirectory/);
});

test('canonical mutation paths do not read rollout state or write migrated root fields', () => {
  for (const name of [
    'userDataCommands.ts',
    'spendCharacterPoint.ts',
    'levelUpUser.ts',
    'backendOperations.ts',
    'deleteGrigliataCustomToken.ts',
    'deleteUser.ts',
  ]) {
    const contents = source(name);
    assert.doesNotMatch(contents, /app_config\/user_data_v2/, name);
    assert.doesNotMatch(contents, /writeLegacy|writesLegacyUserProjection/, name);
    assert.doesNotMatch(contents, /isUserDataLegacyDrainFrozen/, name);
  }
  assert.doesNotMatch(source('userDataCommands.ts'), /targetSnapshot\.get\("(?:stats|Parametri|AltriParametri|inventory|equipped|spells|tecniche|active_turn_effect)"\)/);
  assert.match(source('levelUpAll.ts'), /levelUpAllTask06Handler\(request\)/);
  assert.doesNotMatch(source('levelUpAll.ts'), /operationId\).*\?/s);
  assert.doesNotMatch(source('levelUpUser.ts'), /LegacyHandler|hasExplicitOperationId/);
  assert.doesNotMatch(source('deleteGrigliataCustomToken.ts'), /LegacyHandler/);
  assert.doesNotMatch(source('userDataV2.ts'), /buildAnimaModifierFieldUpdate/);
});

test('frontend repository and rules are permanently V2-only', () => {
  const repository = fs.readFileSync(path.join(
    frontendRoot,
    'src',
    'data',
    'userData',
    'userDataRepository.js'
  ), 'utf8');
  const rules = fs.readFileSync(path.join(frontendRoot, 'firestore.rules'), 'utf8');
  assert.doesNotMatch(repository, /ROLL_OUT|ROLLOUT|subscribeLegacy|shadow-domain|legacy-read/);
  assert.doesNotMatch(
    repository,
    /prepareCharacterCreationMediaTarget|rollbackCharacterCreationMediaTarget|finalizeCharacterCreationMediaTarget/
  );
  assert.doesNotMatch(rules, /isUserDataAggregateFrozen|isValidUserDataRolloutStage/);
  assert.match(rules, /changesMigratedUserDataFields/);
});

test('the retired us-central1 callable alias is absent from the client manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(
    frontendRoot,
    'src',
    'data',
    'functions',
    'callableManifest.json'
  ), 'utf8'));
  assert.deepEqual(manifest.supportedRegions, ['europe-west8', 'europe-west1']);
  assert.equal(manifest.callables.spendCharacterPoint, undefined);
  assert.equal(manifest.callables.spendCharacterPointV2.region, 'europe-west8');
});
