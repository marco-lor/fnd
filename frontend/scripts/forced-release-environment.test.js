const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HOSTING_RELEASE_ENVIRONMENT,
  withForcedEnvironment,
} = require('./forced-release-environment');

test('Hosting builds force the reviewed release profile', () => {
  const environment = withForcedEnvironment({
    PATH: 'preserved',
    REACT_APP_FND_PERF: '1',
  });

  assert.equal(environment.PATH, 'preserved');
  assert.deepEqual(
    Object.fromEntries(Object.keys(HOSTING_RELEASE_ENVIRONMENT).map(
      (key) => [key, environment[key]]
    )),
    HOSTING_RELEASE_ENVIRONMENT
  );
  assert.equal(environment.REACT_APP_FND_PERF, '0');
});

test('forced keys are normalized case-insensitively for Windows child processes', () => {
  const environment = withForcedEnvironment({
    react_app_fnd_perf: '1',
  });

  const normalizedKeys = Object.keys(environment).map((key) => key.toUpperCase());
  for (const key of Object.keys(HOSTING_RELEASE_ENVIRONMENT)) {
    assert.equal(normalizedKeys.filter((candidate) => candidate === key).length, 1);
  }
});
