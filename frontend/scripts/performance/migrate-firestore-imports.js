#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { frontendRoot } = require('./common');

const srcRoot = path.join(frontendRoot, 'src');
const checkOnly = process.argv.includes('--check');
const sourceFiles = [];

const walk = (directoryPath) => {
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) walk(absolutePath);
    else if (/\.[jt]sx?$/.test(entry.name)) sourceFiles.push(absolutePath);
  }
};

walk(srcRoot);
const directImportPattern = /(from\s+['"])firebase\/firestore(['"])/g;
const absoluteFacadePattern = /(['"])performance\/firestore\1/g;
const offenders = [];

const getFacadeSpecifier = (filePath) => {
  const facadePath = path.join(srcRoot, 'performance', 'firestore');
  const relativePath = path
    .relative(path.dirname(filePath), facadePath)
    .replace(/\\/g, '/');

  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
};

for (const filePath of sourceFiles) {
  if (path.normalize(filePath) === path.join(srcRoot, 'performance', 'firestore.js')) continue;
  const source = fs.readFileSync(filePath, 'utf8');
  const hasDirectImport = directImportPattern.test(source);
  directImportPattern.lastIndex = 0;
  const hasAbsoluteFacadeImport = absoluteFacadePattern.test(source);
  absoluteFacadePattern.lastIndex = 0;
  if (!hasDirectImport && !hasAbsoluteFacadeImport) continue;

  offenders.push(path.relative(frontendRoot, filePath));
  if (!checkOnly) {
    const facadeSpecifier = getFacadeSpecifier(filePath);
    fs.writeFileSync(
      filePath,
      source
        .replace(directImportPattern, `$1${facadeSpecifier}$2`)
        .replace(absoluteFacadePattern, (match, quote) => `${quote}${facadeSpecifier}${quote}`),
      'utf8'
    );
  }
}

if (checkOnly && offenders.length) {
  console.error('Firestore imports must use a relative path to the telemetry facade:');
  offenders.forEach((filePath) => console.error(` - ${filePath}`));
  process.exit(1);
}

console.log(checkOnly
  ? 'All Firestore imports use the telemetry facade.'
  : `Migrated ${offenders.length} files to the Firestore telemetry facade.`);
