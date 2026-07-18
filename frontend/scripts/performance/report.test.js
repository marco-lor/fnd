const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMetricMap } = require('./report');

test('build and scenario reports flatten into stable budget keys', () => {
  const metrics = buildMetricMap({
    buildReport: { assets: [{ category: 'javascript', classification: 'entry', gzipBytes: 123 }] },
    browserReport: { scenarios: [{ id: 'login-cold', metrics: { 'runtime.consoleErrors': 0 } }] },
  });
  assert.deepEqual(metrics, {
    'build:javascript.entry.gzipBytes': 123,
    'login-cold:runtime.consoleErrors': 0,
  });
});
