// Explicit opt-in: ordinary performance builds and their evidence keep the
// existing names. Profiling timings are a separate, incomparable build mode.
const performanceBuildMode = (args = []) => {
  if (args.some(arg => arg !== '--profile')) throw new Error('Unknown performance build argument. Use --profile or no arguments.');
  if (args.length > 1) throw new Error('Duplicate performance build argument.');
  const profiling = args.includes('--profile');
  return {
    profiling,
    buildMode: profiling ? 'performance-react-profile' : 'performance',
    craArguments: profiling ? ['--profile'] : [],
    reportFile: profiling ? 'profile-build-report.json' : 'build-report.json',
    statsFile: profiling ? 'profile-webpack-stats.json' : 'webpack-stats.json',
  };
};
const pinnedWebChannelContract = profiling => {
  const callbackSource = profiling ? 'function(){i()}' : 'function(){e()}';
  // Profiling also gives web-vitals' pointercancel listener the same spelling.
  // It is not a timer; the executable setTimeout pin remains exactly one.
  return { callbackSource, executableCallsite: `setTimeout((${callbackSource}),`, expectedCallbackOccurrences: profiling ? 3 : 2 };
};
module.exports = { performanceBuildMode, pinnedWebChannelContract };
