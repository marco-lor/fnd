const assert = require('node:assert/strict');
const test = require('node:test');

const {buildFirebaseFunctionsInvocation, parseArguments} = require('./firebase-functions-command');

const target = (environmentName, projectId, hostingSite, storageBucket) => ({
  command: 'deploy',
  environmentName,
  projectId,
  hostingSite,
  storageBucket,
});

test('Functions commands always use the explicit local Firebase CLI and target', () => {
  const invocation = buildFirebaseFunctionsInvocation({
    branchName: 'devs',
    firebaseCli: 'C:\\firebase.js',
    fsImpl: {existsSync: () => true},
    options: target('staging', 'fatin-test', 'fatin-test', 'fatin-test.firebasestorage.app'),
  });

  assert.deepEqual(invocation.args, [
    'C:\\firebase.js',
    'deploy',
    '--config',
    invocation.configPath,
    '--project',
    'fatin-test',
    '--only',
    'functions',
  ]);
  assert.equal(invocation.environment.FND_FIREBASE_ENVIRONMENT, 'staging');
  assert.equal(invocation.environment.FND_FIREBASE_PROJECT_ID, 'fatin-test');
  assert.equal(invocation.environment.FND_FIREBASE_AUTH_DOMAIN, 'fatin-test.firebaseapp.com');
});

test('Functions emulator commands reject real environments and missing target fields', () => {
  assert.throws(
    () => buildFirebaseFunctionsInvocation({
      branchName: 'main',
      firebaseCli: 'C:\\firebase.js',
      fsImpl: {existsSync: () => true},
      options: {
        ...target('production', 'fatins', 'fatins', 'fatins.firebasestorage.app'),
        command: 'serve',
      },
    }),
    /emulator commands must use the performance environment/i
  );
  assert.throws(
    () => parseArguments(['--command', 'deploy', '--project', 'fatins', '--site', 'fatins', '--bucket', 'fatins.firebasestorage.app']),
    /explicit.*environment/i
  );
});
