const assert = require('node:assert/strict');
const test = require('node:test');

const target = require('./production-target');

const requireResolver = (name) => {
  assert.equal(typeof target[name], 'function', `production-target must export ${name}()`);
  return target[name];
};

test('production is selectable only from main with the fatins project and site', () => {
  const resolveEnvironmentSelection = requireResolver('resolveEnvironmentSelection');

  const selection = resolveEnvironmentSelection({
    branchName: 'main',
    environmentName: 'production',
    hostingSite: 'fatins',
    projectId: 'fatins',
    storageBucket: 'fatins.firebasestorage.app',
  });

  assert.equal(selection.name, 'production');
  assert.equal(selection.projectId, 'fatins');
  assert.equal(selection.hostingSite, 'fatins');
  assert.throws(
    () => resolveEnvironmentSelection({
      branchName: 'devs',
      environmentName: 'production',
      hostingSite: 'fatins',
      projectId: 'fatins',
      storageBucket: 'fatins.firebasestorage.app',
    }),
    /production.*main|main.*production/i
  );
});

test('staging is selectable only from devs with the fatin-test project and site', () => {
  const resolveEnvironmentSelection = requireResolver('resolveEnvironmentSelection');

  const selection = resolveEnvironmentSelection({
    branchName: 'devs',
    environmentName: 'staging',
    hostingSite: 'fatin-test',
    projectId: 'fatin-test',
    storageBucket: 'fatin-test.firebasestorage.app',
  });

  assert.equal(selection.name, 'staging');
  assert.equal(selection.projectId, 'fatin-test');
  assert.equal(selection.hostingSite, 'fatin-test');
  assert.throws(
    () => resolveEnvironmentSelection({
      branchName: 'main',
      environmentName: 'staging',
      hostingSite: 'fatin-test',
      projectId: 'fatin-test',
      storageBucket: 'fatin-test.firebasestorage.app',
    }),
    /staging.*devs|devs.*staging/i
  );
});

test('mismatched project and Hosting site pairs are rejected', () => {
  const resolveEnvironmentSelection = requireResolver('resolveEnvironmentSelection');

  assert.throws(
    () => resolveEnvironmentSelection({
      branchName: 'main',
      environmentName: 'production',
      hostingSite: 'fatin-test',
      projectId: 'fatins',
      storageBucket: 'fatins.firebasestorage.app',
    }),
    /project.*site|site.*project|fatin-test|fatins/i
  );
  assert.throws(
    () => resolveEnvironmentSelection({
      branchName: 'devs',
      environmentName: 'staging',
      hostingSite: 'fatins',
      projectId: 'fatin-test',
      storageBucket: 'fatin-test.firebasestorage.app',
    }),
    /project.*site|site.*project|fatins|fatin-test/i
  );
});

test('performance remains isolated and requires the demo project/site explicitly', () => {
  const resolveEnvironmentSelection = requireResolver('resolveEnvironmentSelection');

  const branchlessSelection = resolveEnvironmentSelection({
    branchName: '',
    environmentName: 'performance',
    hostingSite: 'demo-fnd-perf',
    projectId: 'demo-fnd-perf',
    storageBucket: 'demo-fnd-perf.appspot.com',
  });

  assert.equal(branchlessSelection.name, 'performance');
  const selection = resolveEnvironmentSelection({
    branchName: 'devs',
    environmentName: 'performance',
    hostingSite: 'demo-fnd-perf',
    projectId: 'demo-fnd-perf',
    storageBucket: 'demo-fnd-perf.appspot.com',
  });

  assert.equal(selection.name, 'performance');
  assert.equal(selection.projectId, 'demo-fnd-perf');
  assert.equal(selection.hostingSite, 'demo-fnd-perf');
  assert.throws(
    () => resolveEnvironmentSelection({
      branchName: 'devs',
      environmentName: 'performance',
      hostingSite: 'fatins',
      projectId: 'fatins',
      storageBucket: 'fatins.firebasestorage.app',
    }),
    /performance|demo-fnd-perf|project.*site|site.*project/i
  );
});

test('environment selection refuses an implicit project or Hosting site', () => {
  const resolveEnvironmentSelection = requireResolver('resolveEnvironmentSelection');

  assert.throws(
    () => resolveEnvironmentSelection({
      branchName: 'main',
      environmentName: 'production',
      projectId: 'fatins',
      storageBucket: 'fatins.firebasestorage.app',
    }),
    /explicit.*site|Hosting site/i
  );
  assert.throws(
    () => resolveEnvironmentSelection({
      branchName: 'main',
      environmentName: 'production',
      hostingSite: 'fatins',
      storageBucket: 'fatins.firebasestorage.app',
    }),
    /explicit.*project|project/i
  );
});
