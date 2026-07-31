const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEPLOYMENT_PLANES,
  TEST_PROJECT_ID,
  guardBackendRelease,
  usage,
} = require('./firebase-backend-release-guard');

test('every deployment plane accepts only the isolated test project', () => {
  for (const plane of DEPLOYMENT_PLANES) {
    assert.equal(guardBackendRelease({
      argv: [plane],
      environment: {GCLOUD_PROJECT: TEST_PROJECT_ID},
    }), 0);

    const messages = [];
    assert.equal(guardBackendRelease({
      argv: [plane],
      environment: {GCLOUD_PROJECT: 'fatins'},
      writeError: (message) => messages.push(message),
    }), 1);
    assert.match(messages.join('\n'), new RegExp(`BLOCKED: ${plane}`));
    assert.match(messages.join('\n'), /fatins is never an allowed target/);
  }
});

test('unknown and missing planes are rejected as operator errors', () => {
  for (const argv of [[], ['unknown'], ['functions', 'storage']]) {
    const messages = [];
    assert.equal(guardBackendRelease({
      argv,
      environment: {GCLOUD_PROJECT: TEST_PROJECT_ID},
      writeError: (message) => messages.push(message),
    }), 2);
    assert.deepEqual(messages, [usage]);
  }
});

test('missing project context fails closed', () => {
  const messages = [];
  assert.equal(guardBackendRelease({
    argv: ['hosting'],
    environment: {},
    writeError: (message) => messages.push(message),
  }), 1);
  assert.match(messages.join('\n'), /<unset>/);
});

test('Firebase and npm wiring hard-bind every deploy to fatin-test', () => {
  const frontendRoot = path.resolve(__dirname, '..');
  const firebaseConfig = JSON.parse(fs.readFileSync(
    path.join(frontendRoot, 'firebase.json'),
    'utf8'
  ));
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(frontendRoot, 'package.json'),
    'utf8'
  ));

  assert.match(firebaseConfig.firestore.predeploy[0], /firebase-backend-release-guard\.js"? firestore$/);
  assert.match(firebaseConfig.storage.predeploy[0], /firebase-backend-release-guard\.js"? storage$/);
  assert.match(firebaseConfig.functions[0].predeploy[0], /firebase-backend-release-guard\.js"? functions$/);
  assert.match(firebaseConfig.hosting.predeploy[0], /firebase-backend-release-guard\.js"? hosting$/);
  assert.equal(firebaseConfig.hosting.site, TEST_PROJECT_ID);

  for (const scriptName of [
    'fb:init',
    'fb:emulators',
    'fb:deploy:rules',
    'fb:deploy:functions',
    'fb:deploy:all',
    'fb:deploy:hosting',
  ]) {
    assert.match(packageJson.scripts[scriptName], /--project fatin-test/);
    assert.doesNotMatch(packageJson.scripts[scriptName], /--project fatins(?:\s|$)/);
  }

  assert.match(packageJson.scripts['grigliata:backfill-media-folders'], /--project fatin-test/);
  assert.match(packageJson.scripts['grigliata:backfill-media-folders'], /--auth firebase-cli/);
  assert.match(packageJson.scripts['images:backfill-cache'], /--project fatin-test/);
  assert.match(packageJson.scripts['images:backfill-cache'], /--bucket fatin-test\.firebasestorage\.app/);
  assert.match(packageJson.scripts['images:backfill-cache'], /--auth firebase-cli/);
});
