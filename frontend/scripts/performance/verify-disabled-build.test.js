const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const {
  findDisabledBuildViolations,
} = require('./verify-disabled-build');

test('accepts normal assets with no performance-only route, marker, or chunk', () => {
  const root = path.resolve('virtual-build');
  const files = [path.join(root, 'static/js/main.hash.js')];
  assert.deepEqual(findDisabledBuildViolations({
    files,
    root,
    readFile: () => 'console.log("normal application");',
  }), []);
});

test('rejects the persistence marker, route text, and emitted experiment chunk path', () => {
  const root = path.resolve('virtual-build');
  const files = [
    path.join(root, 'static/js/main.hash.js'),
    path.join(root, 'static/js/perf-firestore-persistence-experiment.hash.chunk.js'),
  ];
  const matches = findDisabledBuildViolations({
    files,
    root,
    readFile: (filePath) => filePath.includes('main.hash')
      ? '__FND_FIRESTORE_PERSISTENCE_EXPERIMENT__ __FND_FIRESTORE_PERSISTENCE_EXPERIMENT_CLEANUP__ /__fnd_perf_firestore_persistence__'
      : 'experiment payload',
  });
  assert.ok(matches.some(({ kind, token }) => kind === 'content' && token.includes('PERSISTENCE_EXPERIMENT')));
  assert.ok(matches.some(({ kind, token }) => kind === 'content' && token.includes('firestore_persistence')));
  assert.ok(matches.some(({ kind, token }) => kind === 'path' && token === 'perf-firestore-persistence-experiment'));
});
