const fs = require('node:fs');
const path = require('node:path');

const functionsRoot = path.resolve(__dirname, '..');
const libRoot = path.resolve(functionsRoot, 'lib');
const compiledIndexPath = path.join(libRoot, 'index.js');
const retiredModuleNames = new Set([
  'deleteGrigliataCustomTokenLegacy',
  'demoConsolidatedOwner',
  'expireBarriera',
  'legacyRootMutationGate',
  'levelUpAllLegacy',
  'levelUpUserLegacy',
  'spendCharacterPointLegacy',
  'syncUserDerivedState',
  'updateAnimaModifier',
  'updateHpTotal',
  'updateManaTotal',
  'updateTotParameters',
  'userDataBridge',
  'userDerivedState',
]);
const retiredExportNames = [
  'buildAnimaModifierFieldUpdate',
  'expireBarriera',
  'spendCharacterPointLegacy',
  'syncUserDerivedState',
  'updateAnimaModifier',
  'updateHpTotal',
  'updateManaTotal',
  'updateTotParameters',
  'userDataBridge',
];

if (!fs.existsSync(compiledIndexPath)) {
  throw new Error(`Functions build did not create ${compiledIndexPath}.`);
}

const compiledFiles = fs.readdirSync(libRoot, {recursive: true, withFileTypes: true})
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath || entry.path, entry.name));
const retiredArtifacts = compiledFiles.filter((filePath) => {
  const baseName = path.basename(filePath).replace(/\.(?:d\.ts|js|js\.map)$/, '');
  return retiredModuleNames.has(baseName);
});
if (retiredArtifacts.length) {
  throw new Error(
    `Retired runtime artifacts survived the Functions build:\n${retiredArtifacts.join('\n')}`
  );
}

const compiledIndex = fs.readFileSync(compiledIndexPath, 'utf8');
const retiredExports = retiredExportNames.filter((name) => compiledIndex.includes(name));
if (retiredExports.length) {
  throw new Error(`Retired runtime exports survived the Functions build: ${retiredExports.join(', ')}`);
}

console.log(`Verified clean Functions output (${compiledFiles.length} files; no retired Task 05 runtime artifacts).`);
