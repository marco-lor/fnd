#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { frontendRoot } = require('./common');

const srcRoot = path.join(frontendRoot, 'src');
const registryPath = path.join(srcRoot, 'data', 'query-contracts.json');
const indexesPath = path.join(frontendRoot, 'firestore.indexes.json');
const ignoredSourceFiles = new Set(['performance/firestore.js']);

const toPosix = (value) => value.replace(/\\/g, '/');

const walkJavaScript = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkJavaScript(absolutePath) : [absolutePath];
  })
  .filter((absolutePath) => absolutePath.endsWith('.js'))
  .filter((absolutePath) => !absolutePath.endsWith('.test.js'))
  .filter((absolutePath) => !absolutePath.endsWith('setupTests.js'));

// Preserve offsets while masking comments and literals so examples such as
// `onSnapshot(...)` in prose cannot satisfy or fail the source inventory.
const maskNonCode = (source) => {
  const chars = [...source];
  let state = 'code';
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index];
    const next = chars[index + 1];
    if (state === 'code') {
      if (current === '/' && next === '/') {
        chars[index] = chars[index + 1] = ' ';
        state = 'line-comment';
        index += 1;
      } else if (current === '/' && next === '*') {
        chars[index] = chars[index + 1] = ' ';
        state = 'block-comment';
        index += 1;
      } else if (current === "'") {
        chars[index] = ' ';
        state = 'single';
      } else if (current === '"') {
        chars[index] = ' ';
        state = 'double';
      } else if (current === '`') {
        chars[index] = ' ';
        state = 'template';
      }
      continue;
    }
    if (state === 'line-comment') {
      if (current === '\n' || current === '\r') state = 'code';
      else chars[index] = ' ';
      continue;
    }
    if (state === 'block-comment') {
      chars[index] = ' ';
      if (current === '*' && next === '/') {
        chars[index + 1] = ' ';
        state = 'code';
        index += 1;
      }
      continue;
    }
    chars[index] = ' ';
    if (current === '\\') {
      if (index + 1 < chars.length) chars[index + 1] = ' ';
      index += 1;
    } else if (
      (state === 'single' && current === "'")
      || (state === 'double' && current === '"')
      || (state === 'template' && current === '`')
    ) {
      state = 'code';
    }
  }
  return chars.join('');
};

const collectListenerSources = ({ root = srcRoot, readFile = fs.readFileSync } = {}) => {
  const sources = [];
  for (const absolutePath of walkJavaScript(root)) {
    const file = toPosix(path.relative(root, absolutePath));
    if (ignoredSourceFiles.has(file)) continue;
    const original = readFile(absolutePath, 'utf8');
    const masked = maskNonCode(original);
    const regex = /\bonSnapshot\s*\(/g;
    let match;
    let occurrence = 0;
    while ((match = regex.exec(masked))) {
      occurrence += 1;
      const line = original.slice(0, match.index).split(/\r?\n/).length;
      sources.push({ file, occurrence, line });
    }
  }
  return sources;
};

const sourceKey = ({ file, occurrence }) => `${file}#${occurrence}`;

const validateRegistry = (registry, discoveredSources) => {
  const errors = [];
  if (registry?.schemaVersion !== 1) errors.push('Registry schemaVersion must be 1.');
  if (!Array.isArray(registry?.contracts)) errors.push('Registry contracts must be an array.');
  if (!Array.isArray(registry?.repositoryQueries)) errors.push('Registry repositoryQueries must be an array.');
  if (!Array.isArray(registry?.activatedIndexSignatures)) errors.push('Registry activatedIndexSignatures must be an array.');
  if (errors.length) return errors;

  const contractIds = new Set();
  const registeredSources = new Map();
  const allowedActivations = new Set(['active', 'deferred', 'exception', 'experiment']);
  for (const contract of registry.contracts) {
    if (typeof contract.id !== 'string' || !contract.id) errors.push('Every query contract needs an ID.');
    else if (contractIds.has(contract.id)) errors.push(`Duplicate query contract ID: ${contract.id}`);
    else contractIds.add(contract.id);
    if (!['collection', 'document'].includes(contract.kind)) errors.push(`${contract.id}: invalid kind.`);
    if (typeof contract.ownerTask !== 'string' || !contract.ownerTask) errors.push(`${contract.id}: missing ownerTask.`);
    if (typeof contract.currentScope !== 'string' || !contract.currentScope) errors.push(`${contract.id}: missing currentScope.`);
    if (!Array.isArray(contract.targetOrdering)) errors.push(`${contract.id}: targetOrdering must be an array.`);
    if (!contract.cursor || typeof contract.cursor !== 'object') errors.push(`${contract.id}: missing cursor metadata.`);
    if (typeof contract.realtimePolicy !== 'string' || !contract.realtimePolicy) errors.push(`${contract.id}: missing realtimePolicy.`);
    if (!allowedActivations.has(contract.activation)) errors.push(`${contract.id}: invalid activation.`);
    if (!Array.isArray(contract.sources) || contract.sources.length === 0) errors.push(`${contract.id}: missing sources.`);
    for (const source of contract.sources || []) {
      const key = sourceKey(source);
      if (registeredSources.has(key)) {
        errors.push(`${key} is registered by both ${registeredSources.get(key)} and ${contract.id}.`);
      } else {
        registeredSources.set(key, contract.id);
      }
    }
  }

  const discoveredByKey = new Map(discoveredSources.map((source) => [sourceKey(source), source]));
  for (const [key, source] of discoveredByKey) {
    if (!registeredSources.has(key)) errors.push(`Unregistered onSnapshot call: ${key} (line ${source.line}).`);
  }
  for (const [key, contractId] of registeredSources) {
    if (!discoveredByKey.has(key)) errors.push(`${contractId} references missing onSnapshot call: ${key}.`);
  }
  return errors;
};

const normalizeIndexSignature = (index) => JSON.stringify({
  collectionGroup: index.collectionGroup,
  queryScope: index.queryScope || 'COLLECTION',
  fields: (index.fields || []).map((field) => ({
    fieldPath: field.fieldPath,
    ...(field.order ? { order: field.order } : {}),
    ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}),
  })),
});

const validateActivatedIndexes = (registry, indexesFile) => {
  const errors = [];
  const declarations = new Map();
  for (const entry of registry.activatedIndexSignatures || []) {
    if (typeof entry.id !== 'string' || !entry.id) {
      errors.push('Every activated index signature needs an ID.');
      continue;
    }
    const signature = normalizeIndexSignature(entry);
    if (declarations.has(signature)) errors.push(`Duplicate activated index signature: ${entry.id}.`);
    declarations.set(signature, entry.id);
  }
  const checkedIn = new Map((indexesFile.indexes || []).map((entry) => [normalizeIndexSignature(entry), entry]));
  for (const [signature, id] of declarations) {
    if (!checkedIn.has(signature)) errors.push(`Activated query index is not checked in: ${id}.`);
  }
  for (const signature of checkedIn.keys()) {
    if (!declarations.has(signature)) errors.push(`Checked-in composite index has no activated query contract: ${signature}.`);
  }

  const indexIds = new Set((registry.activatedIndexSignatures || []).map(({ id }) => id));
  for (const queryContract of registry.repositoryQueries || []) {
    if (queryContract.activation !== 'active') continue;
    if (queryContract.indexMode === 'automatic') continue;
    if (!queryContract.requiredIndexId || !indexIds.has(queryContract.requiredIndexId)) {
      errors.push(`${queryContract.id}: active repository query lacks a checked-in index signature.`);
    }
  }
  return errors;
};

const runCheck = ({
  registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')),
  indexesFile = JSON.parse(fs.readFileSync(indexesPath, 'utf8')),
  discoveredSources = collectListenerSources(),
} = {}) => {
  const errors = [
    ...validateRegistry(registry, discoveredSources),
    ...validateActivatedIndexes(registry, indexesFile),
  ];
  if (errors.length) {
    const error = new Error(`Firestore query-contract check failed:\n- ${errors.join('\n- ')}`);
    error.validationErrors = errors;
    throw error;
  }
  return {
    listenerCount: discoveredSources.length,
    contractCount: registry.contracts.length,
    repositoryQueryCount: registry.repositoryQueries.length,
    activatedIndexCount: registry.activatedIndexSignatures.length,
  };
};

if (require.main === module) {
  try {
    const result = runCheck();
    console.log(
      `Query contracts verified: ${result.listenerCount} listeners, `
      + `${result.repositoryQueryCount} repository query shapes, `
      + `${result.activatedIndexCount} activated composite indexes.`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  collectListenerSources,
  maskNonCode,
  normalizeIndexSignature,
  runCheck,
  validateActivatedIndexes,
  validateRegistry,
};
