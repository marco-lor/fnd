const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const {
  FIREBASE_TOOLS_VERSION,
  PATCHED_RUNTIME_MARKERS,
  VULNERABLE_RUNTIME_MARKERS,
  assertFirebaseStorageRuntimePatched,
  classifyRuntimeSource,
} = require('../apply-firebase-tools-patch');
const {frontendRoot} = require('./common');

const createPendingRuntime = (ids) => {
  const runtimePath = path.join(
    frontendRoot,
    'node_modules',
    'firebase-tools',
    'lib',
    'emulator',
    'storage',
    'rules',
    'runtime.js'
  );
  const {StorageRulesRuntime} = require(runtimePath);
  const runtime = new StorageRulesRuntime();
  const received = [];
  runtime._requests = {};
  ids.forEach((id) => {
    runtime._requests[id] = {
      handler: (response) => received.push(response.id),
      request: {id},
    };
  });
  return {received, runtime};
};

test('Firebase Storage runtime source classifier fails closed', () => {
  assert.equal(
    classifyRuntimeSource(VULNERABLE_RUNTIME_MARKERS.join('\n')),
    'vulnerable'
  );
  assert.equal(
    classifyRuntimeSource(PATCHED_RUNTIME_MARKERS.join('\n')),
    'patched'
  );
  assert.equal(classifyRuntimeSource('unrecognized source'), 'unknown');
});

test('installed firebase-tools version has the required emulator patch', () => {
  const inspection = assertFirebaseStorageRuntimePatched({frontendRoot});
  assert.equal(inspection.version, FIREBASE_TOOLS_VERSION);
  assert.equal(inspection.state, 'patched');
});

test('Storage rules runtime dispatches batched stdout responses', () => {
  const {received, runtime} = createPendingRuntime([1, 2, 3]);
  const chunk = [1, 2, 3]
    .map((id) => JSON.stringify({id, status: 'ok'}))
    .join('\n') + '\n';

  runtime.handleRuntimeStdout(chunk);

  assert.deepEqual(received, [1, 2, 3]);
});

test('Storage rules runtime reassembles a response split across chunks', () => {
  const {received, runtime} = createPendingRuntime([7]);

  runtime.handleRuntimeStdout('{"id":7,"stat');
  assert.deepEqual(received, []);

  runtime.handleRuntimeStdout('us":"ok"}\n');
  assert.deepEqual(received, [7]);
});

test('Storage rules runtime ignores blanks and buffers a trailing record', () => {
  const {received, runtime} = createPendingRuntime([1, 2]);

  runtime.handleRuntimeStdout(
    '\n{"id":1,"status":"ok"}\n{"id":2,"stat'
  );
  assert.deepEqual(received, [1]);

  runtime.handleRuntimeStdout('us":"ok"}\n');
  assert.deepEqual(received, [1, 2]);
});

test('large startup-shaped rules response survives Windows-sized chunks', () => {
  const {received, runtime} = createPendingRuntime([0]);
  const warnings = Array.from({length: 160}, (_, index) => JSON.stringify({
    description_: `Synthetic warning ${index}`,
    sourcePosition_: {
      column_: 17,
      fileName_: 'C:\\long\\workspace\\frontend\\storage.rules',
      line_: index + 1,
    },
  }));
  const response = JSON.stringify({
    errors: [],
    id: 0,
    result: {rulesVersion: 2},
    status: 'ok',
    warnings,
  }) + '\n';
  assert.ok(response.length > 16 * 1024);

  runtime.handleRuntimeStdout(response.slice(0, 8 * 1024));
  runtime.handleRuntimeStdout(response.slice(8 * 1024, 16 * 1024));
  assert.deepEqual(received, []);

  runtime.handleRuntimeStdout(response.slice(16 * 1024));
  assert.deepEqual(received, [0]);
});
