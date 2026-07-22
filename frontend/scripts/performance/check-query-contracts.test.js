const assert = require('node:assert/strict');
const test = require('node:test');
const {
  maskNonCode,
  normalizeIndexSignature,
  runCheck,
  validateActivatedIndexes,
  validateRegistry,
} = require('./check-query-contracts');

const signature = {
  id: 'directory-role-label',
  collectionGroup: 'user_directory',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'role', order: 'ASCENDING' },
    { fieldPath: 'normalizedLabel', order: 'ASCENDING' },
  ],
};

const registry = {
  schemaVersion: 1,
  contracts: [{
    id: 'directory-first-page',
    kind: 'collection',
    ownerTask: 'Task 04',
    currentScope: 'First 50 rows',
    targetOrdering: [
      { field: 'normalizedLabel', direction: 'ASCENDING' },
      { field: '__name__', direction: 'ASCENDING' },
    ],
    cursor: { version: 1, status: 'active', fields: ['normalizedLabel', '__name__'] },
    realtimePolicy: 'First page only',
    activation: 'active',
    sources: [{ file: 'data/userDirectoryRepository.js', occurrence: 1 }],
  }],
  repositoryQueries: [
    { id: 'directory-all', activation: 'active', indexMode: 'automatic' },
    { id: 'directory-role', activation: 'active', requiredIndexId: signature.id },
  ],
  activatedIndexSignatures: [signature],
};

test('masks listener examples in comments and string literals', () => {
  const masked = maskNonCode(`// onSnapshot(comment)\nconst value = 'onSnapshot(string)';\nonSnapshot(real);`);
  assert.equal((masked.match(/\bonSnapshot\s*\(/g) || []).length, 1);
});

test('requires every discovered listener exactly once with full metadata', () => {
  assert.deepEqual(validateRegistry(registry, [{
    file: 'data/userDirectoryRepository.js', occurrence: 1, line: 10,
  }]), []);
  const errors = validateRegistry(registry, [{
    file: 'unowned.js', occurrence: 1, line: 2,
  }]);
  assert.ok(errors.some((error) => error.includes('Unregistered onSnapshot')));
  assert.ok(errors.some((error) => error.includes('references missing onSnapshot')));
});

test('matches normalized checked-in index signatures and rejects speculation', () => {
  const indexesFile = { indexes: [{
    collectionGroup: signature.collectionGroup,
    queryScope: signature.queryScope,
    fields: signature.fields,
  }] };
  assert.equal(
    normalizeIndexSignature(signature),
    normalizeIndexSignature(indexesFile.indexes[0])
  );
  assert.deepEqual(validateActivatedIndexes(registry, indexesFile), []);
  const errors = validateActivatedIndexes(registry, {
    indexes: [...indexesFile.indexes, {
      collectionGroup: 'speculative',
      queryScope: 'COLLECTION',
      fields: [{ fieldPath: 'createdAt', order: 'DESCENDING' }],
    }],
  });
  assert.ok(errors.some((error) => error.includes('no activated query contract')));
});

test('runs the combined registry/listener/index assertion', () => {
  assert.deepEqual(runCheck({
    registry,
    indexesFile: {
      indexes: [{
        collectionGroup: signature.collectionGroup,
        queryScope: signature.queryScope,
        fields: signature.fields,
      }],
    },
    discoveredSources: [{
      file: 'data/userDirectoryRepository.js', occurrence: 1, line: 10,
    }],
  }), {
    listenerCount: 1,
    contractCount: 1,
    repositoryQueryCount: 2,
    activatedIndexCount: 1,
  });
});
