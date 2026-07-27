#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { frontendRoot } = require('./common');

const defaultSourceRoot = path.join(frontendRoot, 'src');
const defaultClientPolicyPath = path.join(
  defaultSourceRoot,
  'data',
  'media',
  'mediaPolicy.json'
);
const defaultFunctionsPolicyPath = path.join(
  frontendRoot,
  'functions',
  'src',
  'mediaPolicy.json'
);

const productionSourcePattern = /\.[jt]sx?$/;
const testSourcePattern = /(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[jt]sx?$/;

const reviewedObjectUrlAdapters = new Set([
  path.normalize('components/common/privateMediaAssets.js'),
  path.normalize('components/common/useObjectUrl.js'),
]);

const reviewedStorageAdapters = new Set([
  path.normalize('components/common/imageStorage.js'),
  path.normalize('components/common/legacyMediaStorage.js'),
  path.normalize('components/common/privateMediaAssets.js'),
  path.normalize('components/common/userOwnedMedia.js'),
  path.normalize('data/media/mediaUpload.js'),
]);

const reviewedMediaPathAdapters = new Set([
  path.normalize('components/common/legacyMediaStorage.js'),
  path.normalize('components/common/privateMediaAssets.js'),
  path.normalize('data/media/mediaPaths.js'),
  path.normalize('data/media/mediaUpload.js'),
]);

const listMediaConsumers = new Set([
  path.normalize('components/common/navbar.js'),
  path.normalize('components/bazaar/Bazaar.js'),
  path.normalize('components/bazaar/elements/PurchaseConfirmModal.js'),
  path.normalize('components/bazaar/elements/comparisonComponent.js'),
  path.normalize('components/echiDiViaggio/NpcSidebar.js'),
  path.normalize('components/foesHub/FoesHub.js'),
  path.normalize('components/grigliata/BackgroundGalleryPanel.js'),
  path.normalize('components/home/elements/Inventory.js'),
]);

const boundaryPatterns = Object.freeze({
  browserDerivative: /\bcreateImageBitmap\s*\(|\bnew\s+OffscreenCanvas\s*\(|\.toBlob\s*\(/g,
  listOriginalVariant: /\bvariant\s*=\s*(?:["']original["']|\{\s*["']original["']\s*\})/g,
  objectUrl: /\b(?:globalThis\.)?URL\.(?:createObjectURL|revokeObjectURL)\s*\(/g,
  storageOperation: /(?:\b|\.)\b(?:deleteObject|getDownloadURL|uploadBytes|uploadBytesResumable)\s*\(/g,
  mediaPath: /(?:media_assets\/v1|media_uploads|media\/v\d+)\//g,
  unsafePublicCache: /\bcacheControl\s*:\s*["'`]\s*public\b/gi,
});

const walk = (directoryPath) => fs.readdirSync(directoryPath, { withFileTypes: true })
  .flatMap((entry) => {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    return productionSourcePattern.test(entry.name) ? [absolutePath] : [];
  });

const lineNumberAt = (source, index) => (
  source.slice(0, index).split(/\r?\n/).length
);

const matchingLines = (source, pattern) => {
  pattern.lastIndex = 0;
  const matches = [];
  let match = pattern.exec(source);
  while (match) {
    matches.push({
      line: lineNumberAt(source, match.index),
      match: match[0],
    });
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    match = pattern.exec(source);
  }
  pattern.lastIndex = 0;
  return matches;
};

const firstPolicyDifference = (left, right, pointer = '$') => {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return `${pointer} has different value types`;
    }
    if (left.length !== right.length) {
      return `${pointer} has different array lengths (${left.length} !== ${right.length})`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstPolicyDifference(left[index], right[index], `${pointer}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (
    left
    && right
    && typeof left === 'object'
    && typeof right === 'object'
  ) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join('\0') !== rightKeys.join('\0')) {
      return `${pointer} has different keys`;
    }
    for (const key of leftKeys) {
      const difference = firstPolicyDifference(left[key], right[key], `${pointer}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return `${pointer} differs (${JSON.stringify(left)} !== ${JSON.stringify(right)})`;
};

const checkMediaPolicyParity = ({
  clientPolicyPath = defaultClientPolicyPath,
  functionsPolicyPath = defaultFunctionsPolicyPath,
} = {}) => {
  let clientPolicy;
  let functionsPolicy;
  try {
    clientPolicy = JSON.parse(fs.readFileSync(clientPolicyPath, 'utf8'));
  } catch (error) {
    return [`Client media policy is unreadable: ${error.message}`];
  }
  try {
    functionsPolicy = JSON.parse(fs.readFileSync(functionsPolicyPath, 'utf8'));
  } catch (error) {
    return [`Functions media policy is unreadable: ${error.message}`];
  }
  const difference = firstPolicyDifference(clientPolicy, functionsPolicy);
  return difference
    ? [`Client and Functions media policies are not exactly equal: ${difference}`]
    : [];
};

const findMediaBoundaryOffenders = (sourceRoot = defaultSourceRoot) => {
  const offenders = [];
  walk(sourceRoot)
    .filter((filePath) => !testSourcePattern.test(filePath))
    .forEach((filePath) => {
      const relativePath = path.normalize(path.relative(sourceRoot, filePath));
      const source = fs.readFileSync(filePath, 'utf8');
      const checks = [
        {
          allowlist: reviewedObjectUrlAdapters,
          kind: 'raw-object-url',
          pattern: boundaryPatterns.objectUrl,
        },
        {
          allowlist: reviewedStorageAdapters,
          kind: 'direct-storage-operation',
          pattern: boundaryPatterns.storageOperation,
        },
        {
          allowlist: new Set(),
          kind: 'unsafe-public-cache-control',
          pattern: boundaryPatterns.unsafePublicCache,
        },
        {
          allowlist: reviewedMediaPathAdapters,
          kind: 'generated-or-staging-path',
          pattern: boundaryPatterns.mediaPath,
        },
      ];
      if (listMediaConsumers.has(relativePath)) {
        checks.push({
          allowlist: new Set(),
          kind: 'original-source-in-list',
          pattern: boundaryPatterns.listOriginalVariant,
        });
      }
      if (relativePath.startsWith(`${path.normalize('data/media')}${path.sep}`)) {
        checks.push({
          allowlist: new Set(),
          kind: 'browser-derivative-generation',
          pattern: boundaryPatterns.browserDerivative,
        });
      }

      checks.forEach(({ allowlist, kind, pattern }) => {
        if (allowlist.has(relativePath)) return;
        matchingLines(source, pattern).forEach(({ line, match }) => {
          offenders.push({
            file: path.relative(frontendRoot, filePath),
            kind,
            line,
            match,
          });
        });
      });
    });
  return offenders.sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.kind.localeCompare(right.kind)
  ));
};

const checkMediaBoundaries = ({
  sourceRoot = defaultSourceRoot,
  clientPolicyPath = defaultClientPolicyPath,
  functionsPolicyPath = defaultFunctionsPolicyPath,
} = {}) => ({
  offenders: findMediaBoundaryOffenders(sourceRoot),
  policyFailures: checkMediaPolicyParity({
    clientPolicyPath,
    functionsPolicyPath,
  }),
});

const main = () => {
  const result = checkMediaBoundaries();
  result.policyFailures.forEach((failure) => console.error(`POLICY ${failure}`));
  result.offenders.forEach(({ file, kind, line, match }) => {
    console.error(`${kind} ${file}:${line} (${match.trim()})`);
  });
  if (result.policyFailures.length || result.offenders.length) {
    process.exitCode = 1;
    return;
  }
  console.log(
    'Task 07 media policies match and browser media boundaries are confined '
    + 'to reviewed adapters.'
  );
};

if (require.main === module) main();

module.exports = {
  boundaryPatterns,
  checkMediaBoundaries,
  checkMediaPolicyParity,
  findMediaBoundaryOffenders,
  firstPolicyDifference,
  main,
  matchingLines,
  reviewedMediaPathAdapters,
  listMediaConsumers,
  reviewedObjectUrlAdapters,
  reviewedStorageAdapters,
};
