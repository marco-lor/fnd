const assert = require('node:assert/strict');
const test = require('node:test');

const {buildFirebaseInvocation} = require('./firebase-deploy');

test('Firebase init passes feature names positionally and retains explicit project/config flags', () => {
  const invocation = buildFirebaseInvocation({
    branchName: 'main',
    commandPrefixArgs: ['firestore:rules,storage:rules'],
    commandArgs: ['--force'],
    firebaseCommand: 'init',
    firebaseCli: 'C:\\firebase.js',
    fsImpl: {existsSync: () => true},
    options: {
      environmentName: 'production',
      projectId: 'fatins',
      hostingSite: 'fatins',
      storageBucket: 'fatins.firebasestorage.app',
      only: ['firestore:rules', 'storage:rules'],
    },
  });

  assert.deepEqual(invocation.args, [
    'C:\\firebase.js',
    'init',
    'firestore:rules,storage:rules',
    '--config',
    invocation.configPath,
    '--project',
    'fatins',
    '--force',
  ]);
});
