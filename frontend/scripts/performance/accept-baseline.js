#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  assertSchemaVersion,
  baselinePath,
  readJson,
  resultsDir,
  scorecardPath,
  sha256,
  writeJson,
} = require('./common');
const { evaluateBudget, evaluateStructuralGates, worstBudgetEvaluation } = require('./compare');

if (!process.argv.includes('--accept')) {
  console.error('Refusing to update the performance baseline without --accept.');
  process.exit(1);
}

const repeatabilityPath = path.join(resultsDir, 'repeatability-report.json');
const aggregatePath = path.join(resultsDir, 'authoritative-aggregate.json');
if (!fs.existsSync(repeatabilityPath) || !fs.existsSync(aggregatePath)) {
  console.error('Two compatible authoritative runs and a passing repeatability report are required.');
  process.exit(1);
}
const repeatability = assertSchemaVersion(readJson(repeatabilityPath), 'repeatability report');
const aggregateBytes = fs.readFileSync(aggregatePath);
if (repeatability.status !== 'pass' || repeatability.aggregateSha256 !== sha256(aggregateBytes)) {
  console.error('The authoritative aggregate is stale or its repeatability gate did not pass.');
  process.exit(1);
}
const report = JSON.parse(aggregateBytes.toString('utf8'));
assertSchemaVersion(report, 'authoritative aggregate');
if (!report.build || !report.fixture || !report.browser) {
  console.error('A complete build, fixture, and browser report is required before accepting a baseline.');
  process.exit(1);
}

const expectedScenarioIds = report.scenarioManifest.scenarios.map((scenario) => scenario.id);
const actualScenarioIds = new Set((report.browser.scenarios || []).map((scenario) => scenario.scenarioId || scenario.id));
const missingScenarios = expectedScenarioIds.filter((id) => !actualScenarioIds.has(id));
if (missingScenarios.length) {
  console.error(`Cannot accept an incomplete baseline. Missing scenarios: ${missingScenarios.join(', ')}`);
  process.exit(1);
}

const budgetResults = [
  ...evaluateStructuralGates(report),
  ...report.budgetConfiguration.budgets.map((budget) => evaluateBudget(budget, report, report)),
];
report.budgetResults = budgetResults;
writeJson(baselinePath, report);
const lines = [
  '# FND performance baseline v1',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  `Fixture hash: \`${report.fixture.hash}\``,
  '',
  '## Repeatability',
  '',
  `- Runs: ${repeatability.runIds.join(', ')}`,
  `- Maximum allowed timing variance: ${repeatability.maximumVariancePercent}%`,
  `- Maximum observed timing variance: ${repeatability.observedMaximumVariancePercent.toFixed(2)}%`,
  '',
  '## Scenario coverage',
  '',
  '| Scenario | Iterations | Metric count |',
  '|---|---:|---:|',
  ...expectedScenarioIds.map((scenarioId) => {
    const runs = (report.browser.scenarios || []).filter((scenario) => (scenario.scenarioId || scenario.id) === scenarioId);
    return `| ${scenarioId} | ${runs.length} | ${Object.keys(runs[0]?.metrics || {}).length} |`;
  }),
  '',
  '## Budgets and remediation targets',
  '',
  '| Status | Severity | Budget | Actual | Allowed | Owner |',
  '|---|---|---|---:|---:|---|',
  ...budgetResults.map((result) => {
    const worst = worstBudgetEvaluation(result.evaluations) || {};
    const owner = result.ownerTask || '01';
    const status = result.status === 'fail' ? '&#x1F534; FAIL' : String(result.status).toUpperCase();
    const scenario = worst.key?.split(':')[0];
    const actual = worst.actual ?? result.actual ?? '';
    const displayedActual = scenario ? `${actual} (${scenario})` : actual;
    return `| ${status} | ${result.severity} | ${result.id} | ${displayedActual} | ${worst.allowed ?? result.allowed ?? ''} | Task ${owner} |`;
  }),
  '',
  'This file is generated. Use `npm run perf:baseline -- --accept` to replace it.',
  '',
];
fs.mkdirSync(path.dirname(scorecardPath), { recursive: true });
fs.writeFileSync(scorecardPath, lines.join('\n'), 'utf8');
console.log(`Accepted baseline: ${baselinePath}`);
