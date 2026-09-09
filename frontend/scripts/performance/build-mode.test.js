const test = require('node:test');
const assert = require('node:assert/strict');
const { performanceBuildMode, pinnedWebChannelContract } = require('./build-mode');

test('ordinary performance build remains non-profiling with original report names', () => {
  assert.deepEqual(performanceBuildMode([]), {
    profiling: false, buildMode: 'performance', craArguments: [],
    reportFile: 'build-report.json', statsFile: 'webpack-stats.json',
  });
});

test('explicit profile build selects CRA profiling and separate evidence paths', () => {
  assert.deepEqual(performanceBuildMode(['--profile']), {
    profiling: true, buildMode: 'performance-react-profile', craArguments: ['--profile'],
    reportFile: 'profile-build-report.json', statsFile: 'profile-webpack-stats.json',
  });
});

test('unknown or duplicate arguments cannot silently change the build mode', () => {
  assert.throws(() => performanceBuildMode(['--profil']), /Unknown/);
  assert.throws(() => performanceBuildMode(['--profile', '--profile']), /Duplicate/);
});

test('ordinary and profiling WebChannel pins remain explicit and distinct', () => {
  assert.deepEqual(pinnedWebChannelContract(false), { callbackSource: 'function(){e()}', executableCallsite: 'setTimeout((function(){e()}),', expectedCallbackOccurrences: 2 });
  assert.deepEqual(pinnedWebChannelContract(true), { callbackSource: 'function(){i()}', executableCallsite: 'setTimeout((function(){i()}),', expectedCallbackOccurrences: 3 });
});
