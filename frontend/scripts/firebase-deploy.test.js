const assert = require('node:assert/strict');
const test = require('node:test');

const deployment = (() => {
  try {
    return require('./firebase-deploy');
  } catch (_error) {
    return {};
  }
})();

const requireDeployment = (name) => {
  assert.equal(typeof deployment[name], 'function', `firebase-deploy must export ${name}()`);
  return deployment[name];
};

const productionArguments = [
  '--environment', 'production',
  '--project', 'fatins',
  '--site', 'fatins',
  '--bucket', 'fatins.firebasestorage.app',
  '--only', 'hosting',
];

test('deployment arguments require an explicit semantic environment and target tuple', () => {
  const parseArguments = requireDeployment('parseArguments');

  assert.deepEqual(parseArguments(productionArguments), {
    environmentName: 'production',
    projectId: 'fatins',
    hostingSite: 'fatins',
    storageBucket: 'fatins.firebasestorage.app',
    only: ['hosting'],
    help: false,
  });
  for (const omitted of [
    '--environment',
    '--project',
    '--site',
    '--bucket',
    '--only',
  ]) {
    const args = productionArguments.filter((argument, index) => (
      argument !== omitted && productionArguments[index - 1] !== omitted
    ));
    assert.throws(() => parseArguments(args), new RegExp(`explicit.*${omitted.slice(2)}`, 'i'));
  }
});

test('deployment invocation is branch-aware and selects the explicit Hosting target', () => {
  const buildFirebaseInvocation = requireDeployment('buildFirebaseInvocation');

  const invocation = buildFirebaseInvocation({
    branchName: 'main',
    firebaseCli: 'C:\\firebase.js',
    fsImpl: {existsSync: () => true},
    options: {
      environmentName: 'production',
      projectId: 'fatins',
      hostingSite: 'fatins',
      storageBucket: 'fatins.firebasestorage.app',
      only: ['hosting', 'functions'],
    },
  });

  assert.deepEqual(invocation.args, [
    'C:\\firebase.js',
    'deploy',
    '--config',
    invocation.configPath,
    '--project',
    'fatins',
    '--only',
    'hosting:app,functions',
  ]);
  assert.equal(invocation.environment.FND_FIREBASE_ENVIRONMENT, 'production');
  assert.equal(invocation.environment.FND_FIREBASE_PROJECT_ID, 'fatins');
  assert.equal(invocation.environment.FND_FIREBASE_HOSTING_SITE, 'fatins');
  assert.equal(invocation.environment.FND_FIREBASE_STORAGE_BUCKET, 'fatins.firebasestorage.app');
  assert.equal(invocation.environment.FND_GIT_BRANCH, 'main');
});

test('production deployment cannot be built from devs and staging cannot be built from main', () => {
  const buildFirebaseInvocation = requireDeployment('buildFirebaseInvocation');
  const base = {
    firebaseCli: 'C:\\firebase.js',
    fsImpl: {existsSync: () => true},
  };

  assert.throws(
    () => buildFirebaseInvocation({
      ...base,
      branchName: 'devs',
      options: {
        environmentName: 'production',
        projectId: 'fatins',
        hostingSite: 'fatins',
        storageBucket: 'fatins.firebasestorage.app',
        only: ['hosting'],
      },
    }),
    /production.*main|main.*production/i
  );
  assert.throws(
    () => buildFirebaseInvocation({
      ...base,
      branchName: 'main',
      options: {
        environmentName: 'staging',
        projectId: 'fatin-test',
        hostingSite: 'fatin-test',
        storageBucket: 'fatin-test.firebasestorage.app',
        only: ['hosting'],
      },
    }),
    /staging.*devs|devs.*staging/i
  );
});

test('deployment rejects the performance environment and never falls back to Firebase default selection', () => {
  const parseArguments = requireDeployment('parseArguments');
  const buildFirebaseInvocation = requireDeployment('buildFirebaseInvocation');

  assert.throws(
    () => buildFirebaseInvocation({
      branchName: 'devs',
      firebaseCli: 'C:\\firebase.js',
      fsImpl: {existsSync: () => true},
      options: {
        environmentName: 'performance',
        projectId: 'demo-fnd-perf',
        hostingSite: 'demo-fnd-perf',
        storageBucket: 'demo-fnd-perf.appspot.com',
        only: ['hosting'],
      },
    }),
    /performance.*deploy|deploy.*performance/i
  );
  assert.throws(
    () => parseArguments(['--project', 'fatins', '--site', 'fatins', '--bucket', 'fatins.firebasestorage.app', '--only', 'hosting']),
    /explicit.*environment/i
  );
});

test('release wrapper exit handling fails closed for non-zero and signaled children', () => {
  const resolveChildExitCode = requireDeployment('resolveChildExitCode');

  assert.equal(resolveChildExitCode({status: 0}), 0);
  assert.equal(resolveChildExitCode({status: 2}), 1);
  assert.equal(resolveChildExitCode({status: null, signal: 'SIGTERM'}), 1);
  assert.throws(
    () => resolveChildExitCode({error: new Error('spawn failed')}),
    /spawn failed/
  );
});
