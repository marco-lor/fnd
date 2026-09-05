const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTask08Prerequisites,
} = require('./task08-preflight');

test('Task 08 preflight fails before Playwright when Functions dependencies are absent', () => {
  assert.throws(
    () => validateTask08Prerequisites({
      fsImpl: {
        existsSync: (filePath) => !String(filePath).includes('node_modules'),
      },
      resolveModule: () => {
        throw new Error('module not found');
      },
      sourceIdentity: { sourceTreeFingerprint: 'source-1' },
      functionsRoot: 'C:/repo/frontend/functions',
      performanceBuildRoot: 'C:/repo/frontend/build',
      buildReportPath: 'C:/repo/frontend/performance-results/build-report.json',
    }),
    /Functions dependencies|npm\.cmd ci/i
  );
});

test('Task 08 preflight fails when the performance build does not match the source tree', () => {
  const files = new Set([
    'C:/repo/frontend/functions/node_modules',
    'C:/repo/frontend/functions/node_modules/firebase-functions/v2/https.js',
    'C:/repo/frontend/functions/node_modules/firebase-admin/app.js',
    'C:/repo/frontend/functions/lib/index.js',
    'C:/repo/frontend/build/index.html',
    'C:/repo/frontend/performance-results/build-report.json',
  ]);
  const hasFile = (filePath) => files.has(String(filePath).replaceAll('\\', '/'));
  assert.throws(
    () => validateTask08Prerequisites({
      fsImpl: { existsSync: hasFile },
      resolveModule: () => 'module.js',
      sourceIdentity: { sourceTreeFingerprint: 'source-current' },
      buildReport: {
        buildMode: 'performance',
        projectId: 'demo-fnd-perf',
        instrumentationMarkerPresent: true,
        sourceTreeIdentity: { sourceTreeFingerprint: 'source-old' },
      },
      probeExportsImpl: () => ({ exportCount: 5 }),
      functionsRoot: 'C:/repo/frontend/functions',
      performanceBuildRoot: 'C:/repo/frontend/build',
      buildReportPath: 'C:/repo/frontend/performance-results/build-report.json',
    }),
    /source-tree|stale|rebuild/i
  );
});
