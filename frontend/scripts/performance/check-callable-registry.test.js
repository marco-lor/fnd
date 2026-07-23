'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkCallableRegistry } = require('./check-callable-registry');

test('callable manifest covers Functions exports and frontend acquisition boundaries', () => {
  assert.deepEqual(checkCallableRegistry(), {
    callableCount: 30,
    regions: ['europe-west8', 'europe-west1', 'us-central1'],
  });
});
