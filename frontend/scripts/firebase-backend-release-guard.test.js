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

const productionEnvironment = {
  FND_FIREBASE_ENVIRONMENT: 'production',
  FND_FIREBASE_PROJECT_ID: 'fatins',
  FND_FIREBASE_HOSTING_SITE: 'fatins',
  FND_FIREBASE_STORAGE_BUCKET: 'fatins.firebasestorage.app',
  FND_GIT_BRANCH: 'main',
  GCLOUD_PROJECT: 'fatins',
};

test('every deployment plane accepts only the explicit production tuple on main', () => {
  for (const plane of DEPLOYMENT_PLANES) {
    assert.equal(guardBackendRelease({
      argv: [plane],
      environment: productionEnvironment,
    }), 0);

    const messages = [];
    assert.equal(guardBackendRelease({
      argv: [plane],
      environment: {
        ...productionEnvironment,
        FND_FIREBASE_PROJECT_ID: 'fatin-test',
        GCLOUD_PROJECT: 'fatin-test',
      },
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
      environment: productionEnvironment,
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

test('production hooks refuse an otherwise matching project without an explicit environment tuple', () => {
  const messages = [];
  assert.equal(guardBackendRelease({
    argv: ['hosting'],
    environment: {GCLOUD_PROJECT: PRODUCTION_PROJECT_ID},
    writeError: (message) => messages.push(message),
  }), 1);
  assert.match(messages.join('\n'), /explicit|environment|branch|site/i);
});

test('release hooks refuse an explicit target without Firebase CLI project context', () => {
  const messages = [];
  const {GCLOUD_PROJECT: _ignored, ...withoutCliProject} = productionEnvironment;
  assert.equal(guardBackendRelease({
    argv: ['hosting'],
    environment: withoutCliProject,
    writeError: (message) => messages.push(message),
  }), 1);
  assert.match(messages.join('\n'), /<unset>|project context|does not match/i);
});

test('staging hooks accept only devs and the fatin-test project/site/bucket tuple', () => {
  const stagingEnvironment = {
    FND_FIREBASE_ENVIRONMENT: 'staging',
    FND_FIREBASE_PROJECT_ID: 'fatin-test',
    FND_FIREBASE_HOSTING_SITE: 'fatin-test',
    FND_FIREBASE_STORAGE_BUCKET: 'fatin-test.firebasestorage.app',
    FND_GIT_BRANCH: 'devs',
    GCLOUD_PROJECT: 'fatin-test',
  };
  assert.equal(guardBackendRelease({
    argv: ['hosting'],
    environment: stagingEnvironment,
  }), 0);

  const messages = [];
  assert.equal(guardBackendRelease({
    argv: ['hosting'],
    environment: {...stagingEnvironment, FND_GIT_BRANCH: 'main'},
    writeError: (message) => messages.push(message),
  }), 1);
  assert.match(messages.join('\n'), /staging.*devs|devs.*staging/i);
});

test('Firebase and npm wiring use the neutral config plus explicit release tuples', () => {
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
    (command) => /verify-runtime-prerequisites\.js/.test(command)
  ));
  const firebaseRc = JSON.parse(fs.readFileSync(
    path.join(frontendRoot, '.firebaserc'),
    'utf8'
  ));
  assert.ok(firebaseConfig.hosting.predeploy.some(
    (command) => /verify-runtime-prerequisites\.js/.test(command)
  ));
  assert.equal(firebaseConfig.hosting.target, 'app');
  assert.equal(firebaseConfig.hosting.site, undefined);
  assert.deepEqual(firebaseRc.projects, {});
  assert.deepEqual(firebaseRc.targets, {
    fatins: {hosting: {app: ['fatins']}},
    'fatin-test': {hosting: {app: ['fatin-test']}},
    'demo-fnd-perf': {hosting: {app: ['demo-fnd-perf']}},
  });
  assert.ok(firebaseConfig.hosting.predeploy.some(
    (command) => /scripts[\\/]build-production\.js/.test(command)
  ));

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
    'fb:deploy:rules',
    'fb:deploy:functions',
    'fb:deploy:delete-user',
    'fb:deploy:all',
    'fb:deploy:hosting',
  ]) {
    assert.match(packageJson.scripts[scriptName], /firebase-deploy\.js/);
    assert.match(packageJson.scripts[scriptName], /--environment production/);
    assert.match(packageJson.scripts[scriptName], /--project fatins/);
    assert.match(packageJson.scripts[scriptName], /--site fatins/);
    assert.match(packageJson.scripts[scriptName], /--bucket fatins\.firebasestorage\.app/);
  }

  assert.match(packageJson.scripts['fb:init'], /firebase-init\.js/);
  assert.match(packageJson.scripts['fb:init'], /--environment production/);
  assert.match(packageJson.scripts['fb:init'], /--project fatins/);
  assert.match(packageJson.scripts['fb:init'], /--site fatins/);
  assert.match(packageJson.scripts['fb:init'], /--bucket fatins\.firebasestorage\.app/);
  assert.match(packageJson.scripts['fb:init:staging'], /--environment staging/);
  assert.match(packageJson.scripts['fb:init:staging'], /--project fatin-test/);

  assert.match(packageJson.scripts['fb:emulators'], /firebase-emulators\.js/);
  assert.match(packageJson.scripts['fb:emulators'], /--environment performance/);
  assert.match(packageJson.scripts['fb:emulators'], /--project demo-fnd-perf/);
  assert.match(packageJson.scripts['fb:emulators'], /--site demo-fnd-perf/);
  assert.match(packageJson.scripts['fb:emulators'], /--bucket demo-fnd-perf\.appspot\.com/);

  for (const scriptName of [
    'fb:deploy:staging:rules',
    'fb:deploy:staging:hosting',
    'fb:deploy:staging:functions',
    'fb:deploy:staging:delete-user',
    'fb:deploy:staging:all',
  ]) {
    assert.match(packageJson.scripts[scriptName], /firebase-deploy\.js/);
    assert.match(packageJson.scripts[scriptName], /--environment staging/);
    assert.match(packageJson.scripts[scriptName], /--project fatin-test/);
    assert.match(packageJson.scripts[scriptName], /--site fatin-test/);
    assert.match(packageJson.scripts[scriptName], /--bucket fatin-test\.firebasestorage\.app/);
  }

  assert.match(packageJson.scripts.build, /build-production\.js/);
  assert.match(packageJson.scripts.build, /--environment production/);
  assert.match(packageJson.scripts.build, /--project fatins/);
  assert.match(packageJson.scripts.build, /--site fatins/);
  assert.match(packageJson.scripts.build, /--bucket fatins\.firebasestorage\.app/);
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
  assert.match(packageJson.scripts['users:backfill-directory'], /--environment production/);
  assert.match(packageJson.scripts['users:backfill-directory'], /--project fatins/);
  assert.match(packageJson.scripts['users:backfill-directory'], /--site fatins/);
  assert.match(packageJson.scripts['users:backfill-directory'], /--bucket fatins\.firebasestorage\.app/);
});
