const { GITHUB_HOSTED_REFERENCE_MACHINE } = require('./common');

const DISALLOWED_REFERENCE_MACHINES = new Set([
  GITHUB_HOSTED_REFERENCE_MACHINE,
  'unknown',
]);

const assertBaselineReferenceMachine = (report) => {
  const referenceMachine = typeof report?.environment?.referenceMachine === 'string'
    ? report.environment.referenceMachine.trim()
    : '';
  if (!referenceMachine || DISALLOWED_REFERENCE_MACHINES.has(referenceMachine.toLowerCase())) {
    throw new Error(
      'Performance baselines require a named controlled reference machine; '
      + 'GitHub-hosted and unknown runners are informational only.'
    );
  }
  return referenceMachine;
};

module.exports = {
  assertBaselineReferenceMachine,
};
