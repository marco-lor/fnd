const {
  GITHUB_HOSTED_REFERENCE_MACHINE,
  PERFORMANCE_MAX_VARIANCE_PERCENT,
} = require('./common');

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

const BASELINE_REPEATABILITY_CONTRACT = Object.freeze({
  status: 'pass',
  evidenceStatus: 'pass',
  timingStatus: 'pass',
  gateMode: 'strict',
  gateStatus: 'pass',
});

const assertBaselineRepeatability = (repeatability, aggregate) => {
  for (const [field, expected] of Object.entries(BASELINE_REPEATABILITY_CONTRACT)) {
    if (repeatability?.[field] !== expected) {
      throw new Error(
        'Performance baselines require strict passing repeatability evidence.'
      );
    }
  }
  if (repeatability.maximumVariancePercent !== PERFORMANCE_MAX_VARIANCE_PERCENT) {
    throw new Error(
      `Performance baselines require the ${PERFORMANCE_MAX_VARIANCE_PERCENT}% timing variance contract.`
    );
  }
  for (const field of [
    ...Object.keys(BASELINE_REPEATABILITY_CONTRACT),
    'maximumVariancePercent',
  ]) {
    if (aggregate?.repeatability?.[field] !== repeatability[field]) {
      throw new Error(
        'The repeatability report disagrees with the authoritative aggregate.'
      );
    }
  }
  return repeatability;
};

module.exports = {
  assertBaselineReferenceMachine,
  assertBaselineRepeatability,
};
