const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEPLOYMENT_PLANES,
  PRODUCTION_PROJECT_ID,
  guardBackendRelease,
  usage,
} = require('./firebase-backend-release-guard');

test('every deployment plane accepts only the production project', () => {
  for (const plane of DEPLOYMENT_PLANES) {
    assert.equal(guardBackendRelease({
      argv: [plane],
      environment: {GCLOUD_PROJECT: PRODUCTION_PROJECT_ID},
    }), 0);

    const messages = [];
    assert.equal(guardBackendRelease({
      argv: [plane],
      environment: {GCLOUD_PROJECT: 'fatin-test'},
      writeError: (message) => messages.push(message),
    }), 1);
    assert.match(messages.join('\n'), new RegExp(`BLOCKED: ${plane}`));
    assert.match(messages.join('\n'), /Every other Firebase project is refused/);
  }
});

test('unknown and missing planes are rejected as operator errors', () => {
  for (const argv of [[], ['unknown'], ['functions', 'storage']]) {
    const messages = [];
    assert.equal(guardBackendRelease({
      argv,
      environment: {GCLOUD_PROJECT: PRODUCTION_PROJECT_ID},
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

test('Firebase and npm wiring hard-bind every deploy to fatins', () => {
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
  assert.ok(firebaseConfig.functions[0].predeploy.some(
    (command) => /production:verify-runtime-prerequisites/.test(command)
  ));
  assert.ok(firebaseConfig.hosting.predeploy.some(
    (command) => /production:verify-runtime-prerequisites/.test(command)
  ));
  assert.equal(firebaseConfig.hosting.site, PRODUCTION_PROJECT_ID);

  const staticHeaders = firebaseConfig.hosting.headers.find(
    (entry) => entry.source === '/static/**'
  );
  const staticCacheControl = staticHeaders?.headers?.find(
    (header) => header.key.toLowerCase() === 'cache-control'
  )?.value;
  assert.equal(staticCacheControl, 'public, max-age=0, must-revalidate');
  assert.doesNotMatch(staticCacheControl, /immutable/i);

  const fallbackRewrite = firebaseConfig.hosting.rewrites.at(-1);
  assert.deepEqual(fallbackRewrite, {
    source: '!/@(static)/**',
    destination: '/index.html',
  });
  assert.equal(
    firebaseConfig.hosting.rewrites.some((rewrite) => rewrite.source === '**'),
    false
  );

  for (const scriptName of [
    'fb:init',
    'fb:deploy:rules',
    'fb:deploy:functions',
    'fb:deploy:all',
    'fb:deploy:hosting',
  ]) {
    assert.match(packageJson.scripts[scriptName], /--project fatins(?:\s|$)/);
    assert.doesNotMatch(packageJson.scripts[scriptName], /--project fatin-test/);
  }

  assert.match(packageJson.scripts['fb:emulators'], /--project demo-fnd-perf/);

  assert.match(packageJson.scripts['grigliata:backfill-media-folders'], /--project fatins/);
  assert.match(packageJson.scripts['grigliata:backfill-media-folders'], /--auth firebase-cli/);
  assert.match(packageJson.scripts['images:backfill-cache'], /--project fatins/);
  assert.match(packageJson.scripts['images:backfill-cache'], /--bucket fatins\.firebasestorage\.app/);
  assert.match(packageJson.scripts['images:backfill-cache'], /--auth firebase-cli/);
  assert.match(packageJson.scripts['appcheck:verify-production'], /--project fatins/);
  assert.match(packageJson.scripts['appcheck:verify-production'], /--auth firebase-cli/);
  assert.match(packageJson.scripts['users:verify-directory'], /--project fatins/);
  assert.match(packageJson.scripts['users:verify-directory'], /--verify/);
  assert.doesNotMatch(packageJson.scripts['users:verify-directory'], /--write/);
});
