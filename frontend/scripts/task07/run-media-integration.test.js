const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MEDIA_RUN_TIMEOUT_MS,
  MAX_MEDIA_RUN_TIMEOUT_MS,
  getMediaRunTimeoutMs,
  runMediaIntegration,
} = require('./run-media-integration');

test('Task 07 integration has a finite default and rejects unbounded overrides', () => {
  assert.equal(getMediaRunTimeoutMs({}), DEFAULT_MEDIA_RUN_TIMEOUT_MS);
  assert.equal(getMediaRunTimeoutMs({ FND_TASK07_MEDIA_RUN_TIMEOUT_MS: '2500' }), 2500);
  assert.throws(
    () => getMediaRunTimeoutMs({
      FND_TASK07_MEDIA_RUN_TIMEOUT_MS: String(MAX_MEDIA_RUN_TIMEOUT_MS + 1),
    }),
    /must be an integer/
  );
});

test('Task 07 integration checks ports and carries its hard timeout to the child', async () => {
  const order = [];
  let invocation;
  const result = await runMediaIntegration({
    cwd: process.cwd(),
    environment: {},
    timeoutMs: 3210,
    assertPortsFree: async () => { order.push('preflight'); },
    waitForPorts: async () => { order.push('cleanup'); },
    runChild: async (options) => {
      order.push('child');
      invocation = options;
      return { status: 0, signal: null, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 0);
  assert.deepEqual(order, ['preflight', 'child', 'cleanup']);
  assert.equal(invocation.timeoutMs, 3210);
  assert.equal(invocation.captureOutput, false);
  assert.equal(invocation.environment.FND_TASK07_MEDIA_INTEGRATION, '1');
});
