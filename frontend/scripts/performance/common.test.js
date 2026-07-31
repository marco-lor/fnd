const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OWNED_PERFORMANCE_ENVIRONMENT,
  PERFORMANCE_ENVIRONMENT_MODE,
  PERFORMANCE_PROJECT_ID,
  assertDemoProject,
  assertPerformanceProject,
  assertSchemaVersion,
  configureOwnedPerformanceEnvironment,
  median,
  percentile,
  projectId,
} = require('./common');

test('demo-project safety guard rejects live-looking projects', () => {
  assert.equal(assertDemoProject('demo-fnd-perf'), 'demo-fnd-perf');
  assert.throws(() => assertDemoProject('fatins'), /refuse non-demo/i);
});

test('emulator lifecycle is pinned to the canonical performance project', () => {
  assert.equal(PERFORMANCE_PROJECT_ID, 'demo-fnd-perf');
  assert.equal(projectId, PERFORMANCE_PROJECT_ID);
  assert.equal(assertPerformanceProject('demo-fnd-perf'), 'demo-fnd-perf');
  assert.throws(
    () => assertPerformanceProject('demo-other'),
    /requires demo-fnd-perf; found demo-other/
  );
  assert.throws(
    () => assertPerformanceProject('production-project'),
    /refuse non-demo Firebase project/
  );
});

test('owned performance environment uses exact loopback Admin SDK endpoints', () => {
  assert.deepEqual(OWNED_PERFORMANCE_ENVIRONMENT, {
    FND_PERF_PROJECT_ID: 'demo-fnd-perf',
    GCLOUD_PROJECT: 'demo-fnd-perf',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  });
});

test('strict performance environment validation rejects every hostile value without partial mutation', () => {
  const inheritedEnvironment = {
    GCLOUD_PROJECT: 'production-project',
    FIRESTORE_EMULATOR_HOST: 'remote.example.test:8080',
    FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
    STORAGE_EMULATOR_HOST: 'https://storage.example.test',
    UNRELATED_VALUE: 'preserved',
  };
  const before = { ...inheritedEnvironment };

  assert.throws(
    () => configureOwnedPerformanceEnvironment({ env: inheritedEnvironment }),
    (error) => {
      assert.match(error.message, /GCLOUD_PROJECT=.*production-project/);
      assert.match(error.message, /FIRESTORE_EMULATOR_HOST=.*remote\.example\.test:8080/);
      assert.match(error.message, /FIREBASE_AUTH_EMULATOR_HOST=.*localhost:9099/);
      assert.match(error.message, /STORAGE_EMULATOR_HOST=.*storage\.example\.test/);
      return true;
    }
  );
  assert.deepEqual(inheritedEnvironment, before);
  assert.equal(inheritedEnvironment.FND_PERF_PROJECT_ID, undefined);
});

test('owned override mode replaces hostile inherited values and preserves unrelated values', () => {
  const inheritedEnvironment = {
    FND_PERF_PROJECT_ID: 'production-project',
    GCLOUD_PROJECT: 'production-project',
    FIRESTORE_EMULATOR_HOST: 'remote.example.test:8080',
    FIREBASE_AUTH_EMULATOR_HOST: 'remote.example.test:9099',
    STORAGE_EMULATOR_HOST: 'https://storage.example.test',
    UNRELATED_VALUE: 'preserved',
  };

  const configured = configureOwnedPerformanceEnvironment({
    env: inheritedEnvironment,
    mode: PERFORMANCE_ENVIRONMENT_MODE.OWNED_OVERRIDE,
  });

  assert.equal(configured, inheritedEnvironment);
  assert.deepEqual(inheritedEnvironment, {
    ...OWNED_PERFORMANCE_ENVIRONMENT,
    UNRELATED_VALUE: 'preserved',
  });
});

test('median and percentile use deterministic nearest-rank ordering', () => {
  assert.equal(median([7, 1, 3, 5]), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5);
  assert.equal(percentile([], 0.95), null);
});

test('versioned performance contracts reject unsupported schemas', () => {
  assert.equal(assertSchemaVersion({ schemaVersion: 1 }).schemaVersion, 1);
  assert.throws(() => assertSchemaVersion({ schemaVersion: 2 }, 'fixture'), /unsupported schemaVersion 2/i);
  assert.throws(() => assertSchemaVersion({}, 'fixture'), /schemaVersion missing/i);
});
