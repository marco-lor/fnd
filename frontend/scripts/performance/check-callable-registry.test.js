'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkCallableRegistry } = require('./check-callable-registry');
const manifest = require('../../src/data/functions/callableManifest.json');

test('callable manifest covers Functions exports and frontend acquisition boundaries', () => {
  assert.deepEqual(checkCallableRegistry(), {
    callableCount: 47,
    regions: ['europe-west8', 'europe-west1'],
  });
  assert.deepEqual(manifest.callables.task12MutateCodex, {
    functionId: 'task12MutateCodex',
    region: 'europe-west8',
    owner: 'codex',
    compatibilityAliasOf: null,
  });
});
