const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyUpdateSettingsPatch,
} = require('../lib/userDataCommands');

test('classifies legacy settings lock keys as parameter locks', () => {
  assert.deepEqual(classifyUpdateSettingsPatch({
    settings: { lock_param_base: true },
  }), {
    hasLocks: true,
    hasPreferences: false,
  });
});

test('keeps ordinary and mixed settings patches owner-only', () => {
  assert.deepEqual(classifyUpdateSettingsPatch({
    settings: { theme: 'dark' },
  }), {
    hasLocks: false,
    hasPreferences: true,
  });
  assert.deepEqual(classifyUpdateSettingsPatch({
    settings: { lock_param_combat: false, theme: 'dark' },
  }), {
    hasLocks: true,
    hasPreferences: true,
  });
  assert.deepEqual(classifyUpdateSettingsPatch({ settings: {} }), {
    hasLocks: false,
    hasPreferences: true,
  });
});

test('classifies canonical lock maps independently from other domains', () => {
  assert.deepEqual(classifyUpdateSettingsPatch({
    parameterLocks: { strength: true },
  }), {
    hasLocks: true,
    hasPreferences: false,
  });
  assert.deepEqual(classifyUpdateSettingsPatch({
    paramLocks: { strength: true },
    grigliata: { drawColorKey: 'blue' },
  }), {
    hasLocks: true,
    hasPreferences: true,
  });
});
