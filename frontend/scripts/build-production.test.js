const assert = require('node:assert/strict');
const test = require('node:test');

const {parseArguments, resolveBuildSelection} = require('./build-production');

const productionArguments = [
  '--environment', 'production',
  '--project', 'fatins',
  '--site', 'fatins',
  '--bucket', 'fatins.firebasestorage.app',
];

test('production and staging builds require an explicit branch-aware target', () => {
  const production = resolveBuildSelection({
    branchName: 'main',
    options: parseArguments(productionArguments),
  });
  assert.equal(production.name, 'production');

  const staging = resolveBuildSelection({
    branchName: 'devs',
    options: parseArguments([
      '--environment', 'staging',
      '--project', 'fatin-test',
      '--site', 'fatin-test',
      '--bucket', 'fatin-test.firebasestorage.app',
    ]),
  });
  assert.equal(staging.name, 'staging');

  assert.throws(
    () => resolveBuildSelection({
      branchName: 'devs',
      options: parseArguments(productionArguments),
    }),
    /production.*main|main.*production/i
  );
  assert.throws(
    () => resolveBuildSelection({
      branchName: 'main',
      options: parseArguments([
        '--environment', 'staging',
        '--project', 'fatin-test',
        '--site', 'fatin-test',
        '--bucket', 'fatin-test.firebasestorage.app',
      ]),
    }),
    /staging.*devs|devs.*staging/i
  );
});

test('a direct build command cannot infer a Firebase target from ambient project state', () => {
  assert.throws(
    () => resolveBuildSelection({
      branchName: 'main',
      environment: {GCLOUD_PROJECT: 'fatins'},
      options: parseArguments([]),
    }),
    /explicit.*environment/i
  );
});
