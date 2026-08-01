const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HOSTING_COMPATIBILITY_ENVIRONMENT,
  withForcedEnvironment,
} = require('./forced-release-environment');

test('Hosting builds force the reviewed fixed-stage V2 test profile', () => {
  const environment = withForcedEnvironment({
    PATH: 'preserved',
    REACT_APP_FND_PERF: '1',
    REACT_APP_FND_USER_DATA_ROLLOUT_CONFIG: '1',
    REACT_APP_FND_USER_DATA_STAGE: 'new-only',
  });

  assert.equal(environment.PATH, 'preserved');
  assert.deepEqual(
    Object.fromEntries(Object.keys(HOSTING_COMPATIBILITY_ENVIRONMENT).map(
      (key) => [key, environment[key]]
    )),
    HOSTING_COMPATIBILITY_ENVIRONMENT
  );
  assert.equal(environment.REACT_APP_FND_PERF, '0');
  assert.equal(environment.REACT_APP_FND_USER_DATA_ROLLOUT_CONFIG, '0');
  assert.equal(environment.REACT_APP_FND_USER_DATA_STAGE, 'new-read-dual-write');
});

test('forced keys are normalized case-insensitively for Windows child processes', () => {
  const environment = withForcedEnvironment({
    react_app_fnd_perf: '1',
    React_App_Fnd_User_Data_Rollout_Config: '1',
    react_app_fnd_user_data_stage: 'new-only',
  });

  const normalizedKeys = Object.keys(environment).map((key) => key.toUpperCase());
  for (const key of Object.keys(HOSTING_COMPATIBILITY_ENVIRONMENT)) {
    assert.equal(normalizedKeys.filter((candidate) => candidate === key).length, 1);
  }
});
