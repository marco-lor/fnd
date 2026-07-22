#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { frontendRoot } = require('./common');

const defaultSourceRoot = path.join(frontendRoot, 'src');
const allowedRelativePaths = new Set([
  path.normalize('data/configRepository.js'),
  path.normalize('data/codexRepository.js'),
]);

const productionSourcePattern = /\.[jt]sx?$/;
const testSourcePattern = /(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[jt]sx?$/;
const sharedConfigAccessPatterns = [
  /\b(?:doc|collection)\s*\(\s*[^,()]+\s*,\s*(['"])utils\1(?:\s*,|\s*\))/g,
  /\b(?:doc|collection)\s*\(\s*[^,()]+\s*,\s*(['"])utils\/[^'"]+\1/g,
];

const walk = (directoryPath) => fs.readdirSync(directoryPath, { withFileTypes: true })
  .flatMap((entry) => {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    return productionSourcePattern.test(entry.name) ? [absolutePath] : [];
  });

const containsSharedConfigAccess = (source) => sharedConfigAccessPatterns.some((pattern) => {
  pattern.lastIndex = 0;
  const matches = pattern.test(source);
  pattern.lastIndex = 0;
  return matches;
});

const findSharedConfigBoundaryOffenders = (sourceRoot = defaultSourceRoot) => walk(sourceRoot)
  .filter((filePath) => !testSourcePattern.test(filePath))
  .filter((filePath) => !allowedRelativePaths.has(path.normalize(path.relative(sourceRoot, filePath))))
  .filter((filePath) => containsSharedConfigAccess(fs.readFileSync(filePath, 'utf8')))
  .map((filePath) => path.relative(frontendRoot, filePath));

const main = () => {
  const offenders = findSharedConfigBoundaryOffenders();
  if (offenders.length) {
    console.error('Shared utils/* Firestore access must use the config or Codex repository:');
    offenders.forEach((filePath) => console.error(` - ${filePath}`));
    process.exitCode = 1;
    return;
  }
  console.log('Shared utils/* Firestore access is confined to the approved repositories.');
};

if (require.main === module) main();

module.exports = {
  containsSharedConfigAccess,
  findSharedConfigBoundaryOffenders,
  main,
};

