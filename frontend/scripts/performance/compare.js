#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  baselinePath,
  budgetsPath,
  readJson,
  resultsDir,
  writeJson,
} = require('./common');
const { collectCurrentReport } = require('./report');

const resolveValues = (metrics, scenario, metric) => {
  if (scenario === 'all') {
    return Object.entries(metrics)
      .filter(([key]) => key.endsWith(`:${metric}`))
      .map(([key, value]) => ({ key, value }));
  }
  const key = `${scenario}:${metric}`;
  return Object.prototype.hasOwnProperty.call(metrics, key) ? [{ key, value: metrics[key] }] : [];
};

const evaluateBudget = (budget, current, baseline) => {
  const currentValues = resolveValues(current.metrics || {}, budget.scenario, budget.metric);
  if (!currentValues.length) {
    return { ...budget, status: 'missing', actual: null, allowed: null };
  }

  const evaluations = currentValues.map(({ key, value }) => {
    let allowed = budget.maximum;
    if (budget.comparison === 'relative-to-baseline') {
      const baselineValue = baseline?.metrics?.[key];
      if (!Number.isFinite(baselineValue)) {
        return { key, actual: value, allowed: null, status: 'unbaselined' };
      }
      const percentAllowance = baselineValue * ((budget.tolerance?.percent || 0) / 100);
      const absoluteAllowance = budget.tolerance?.absoluteBytes || 0;
      allowed = baselineValue + Math.max(percentAllowance, absoluteAllowance);
    }
    const status = Number.isFinite(value) && Number.isFinite(allowed) && value <= allowed ? 'pass' : 'fail';
    return { key, actual: value, allowed, status };
  });

  const status = evaluations.some((item) => item.status === 'fail')
    ? 'fail'
    : evaluations.some((item) => item.status === 'unbaselined')
      ? 'unbaselined'
      : 'pass';
  return { ...budget, status, evaluations };
};

const worstBudgetEvaluation = (evaluations = []) => evaluations.reduce((worst, item) => {
  if (!worst) return item;
  const rank = { fail: 3, unbaselined: 2, pass: 1 };
  if ((rank[item.status] || 0) !== (rank[worst.status] || 0)) {
    return (rank[item.status] || 0) > (rank[worst.status] || 0) ? item : worst;
  }
  const score = (entry) => {
    if (!Number.isFinite(entry.actual) || !Number.isFinite(entry.allowed)) return -Infinity;
    if (entry.allowed === 0) return entry.actual === 0 ? 0 : Infinity;
    return entry.actual / entry.allowed;
  };
  return score(item) > score(worst) ? item : worst;
}, null);

const evaluateStructuralGates = (current) => {
  const expected = current.scenarioManifest.scenarios.map((scenario) => scenario.id);
  const actual = new Set((current.browser?.scenarios || []).map((scenario) => scenario.scenarioId || scenario.id));
  const missing = expected.filter((scenarioId) => !actual.has(scenarioId));
  const requiredMetrics = [
    'runtime.consoleErrors',
    'runtime.unhandledErrors',
    'runtime.failedRequests',
    'firestore.activeListenersAfterCleanup',
    'runtime.activeResourcesAfterCleanup',
    'runtime.activeTimeoutsAfterCleanup',
    'runtime.activeMediaAfterCleanup',
  ];
  const missingMetrics = expected.flatMap((scenarioId) => requiredMetrics
    .filter((metric) => !Number.isFinite(current.metrics?.[`${scenarioId}:${metric}`]))
    .map((metric) => `${scenarioId}:${metric}`));
  const fixtureCountsValid = Object.entries(current.fixtureManifest?.counts || {})
    .every(([collectionName, expected]) => current.fixture?.counts?.[collectionName] === expected);
  const fixtureValid = Boolean(current.fixture?.hash)
    && current.fixture?.projectId === 'demo-fnd-perf'
    && current.fixture?.hash === current.fixtureManifest?.canonicalHash
    && current.fixture?.documentCount === current.fixtureManifest?.documentCount
    && fixtureCountsValid;
  const buildValid = current.build?.sourceMapsPresent === false
    && current.build?.instrumentationMarkerPresent === true;
  const disabledBuildValid = current.normalBuildVerification?.instrumentationAbsent === true;
  const actualChunkNames = new Set((current.build?.chunkInventory || []).map((chunk) => chunk.logicalName));
  const requiredChunkNames = [
    ...(current.build?.requiredChunks?.routes || []),
    ...(current.build?.requiredChunks?.features || []),
  ];
  const missingChunks = requiredChunkNames.filter((chunkName) => !actualChunkNames.has(chunkName));
  const moduleEvidenceValid = Number(current.build?.webpackModuleEvidence?.moduleCount) > 0
    && Array.isArray(current.build?.webpackModuleEvidence?.loginModuleViolations)
    && current.build.webpackModuleEvidence.loginModuleViolations.length === 0;
  const fivePeerScenarios = (current.browser?.scenarios || []).filter((scenario) => (
    (scenario.scenarioId || scenario.id) === 'grigliata-five-peer'
  ));
  const explainedWarningMetricsComplete = fivePeerScenarios.length > 0
    && fivePeerScenarios.every((scenario) => Number.isFinite(
      scenario.metrics?.['runtime.explainedFirestoreEmulatorStartupWarnings']
    ));
  const explainedStartupWarnings = fivePeerScenarios.reduce((total, scenario) => (
    total + Number(scenario.metrics?.['runtime.explainedFirestoreEmulatorStartupWarnings'] || 0)
  ), 0);
  const authSetupDiagnostics = current.browser?.environment?.authSetupDiagnostics;
  const authMetrics = authSetupDiagnostics?.metrics;
  const authSetupValid = authSetupDiagnostics?.status === 'passed'
    && authSetupDiagnostics.completedAccountCount === authSetupDiagnostics.expectedAccountCount
    && ['consoleErrors', 'explainedFirestoreEmulatorStartupWarnings', 'unhandledErrors', 'failedRequests', 'cleanupErrors']
      .every((metric) => Number(authMetrics?.[metric]) === 0);
  return [
    {
      id: 'scenario-completeness', severity: 'blocking', status: missing.length ? 'fail' : 'pass',
      missing,
    },
    {
      id: 'metric-completeness', severity: 'blocking', status: missingMetrics.length ? 'fail' : 'pass',
      missing: missingMetrics,
    },
    {
      id: 'emulator-startup-warning-free', severity: 'blocking',
      status: explainedWarningMetricsComplete && explainedStartupWarnings === 0 ? 'pass' : 'fail',
      actual: explainedStartupWarnings,
      maximum: 0,
      complete: explainedWarningMetricsComplete,
    },
    {
      id: 'auth-setup-diagnostics', severity: 'blocking',
      status: authSetupValid ? 'pass' : 'fail',
      actual: authSetupDiagnostics || null,
    },
    {
      id: 'fixture-integrity', severity: 'blocking', status: fixtureValid ? 'pass' : 'fail',
      actual: current.fixture?.hash || null,
    },
    {
      id: 'instrumented-build-integrity', severity: 'blocking', status: buildValid ? 'pass' : 'fail',
    },
    {
      id: 'normal-build-instrumentation-absent', severity: 'blocking', status: disabledBuildValid ? 'pass' : 'fail',
    },
    {
      id: 'route-feature-chunk-inventory', severity: 'blocking', status: requiredChunkNames.length && !missingChunks.length ? 'pass' : 'fail',
      missing: missingChunks,
    },
    {
      id: 'login-module-isolation', severity: 'blocking', status: moduleEvidenceValid ? 'pass' : 'fail',
      violations: current.build?.webpackModuleEvidence?.loginModuleViolations || [],
    },
  ];
};

const runComparison = () => {
  const current = collectCurrentReport();
  const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath) : null;
  const configuration = readJson(budgetsPath);
  const evaluations = [
    ...evaluateStructuralGates(current),
    ...configuration.budgets.map((budget) => evaluateBudget(budget, current, baseline)),
  ];
  const comparison = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baselinePresent: Boolean(baseline),
    evaluations,
  };

  writeJson(path.join(resultsDir, 'comparison.json'), comparison);
  for (const evaluation of evaluations) {
    console.log(`${evaluation.status.toUpperCase()} ${evaluation.severity} ${evaluation.id}`);
  }
  const blockingFailure = evaluations.some((evaluation) => (
    evaluation.severity === 'blocking' && evaluation.status !== 'pass'
  ));
  if (blockingFailure) process.exitCode = 1;
  return comparison;
};

if (require.main === module) runComparison();

module.exports = {
  evaluateBudget,
  evaluateStructuralGates,
  resolveValues,
  runComparison,
  worstBudgetEvaluation,
};
