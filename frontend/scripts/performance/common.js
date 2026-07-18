const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const frontendRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(frontendRoot, '..');
const resultsDir = path.join(frontendRoot, 'performance-results');
const baselinePath = path.join(frontendRoot, 'performance', 'baselines', 'v1.json');
const scorecardPath = path.join(frontendRoot, 'performance', 'baselines', 'v1.md');
const budgetsPath = path.join(frontendRoot, 'performance', 'budgets.json');
const scenariosPath = path.join(frontendRoot, 'performance', 'scenarios.json');
const fixtureManifestPath = path.join(frontendRoot, 'performance', 'fixture-manifest.json');
const authoritativeResultsDir = path.join(resultsDir, 'authoritative');
const projectId = process.env.FND_PERF_PROJECT_ID || 'demo-fnd-perf';

const resolvePortableJavaHome = () => {
  const configured = process.env.FND_PERF_JAVA_HOME;
  const candidates = configured
    ? [configured]
    : fs.existsSync(path.join(frontendRoot, '.perf-tools'))
      ? fs.readdirSync(path.join(frontendRoot, '.perf-tools'))
        .filter((name) => name.startsWith('jdk-'))
        .sort()
        .reverse()
        .map((name) => path.join(frontendRoot, '.perf-tools', name))
      : [];
  return candidates.find((candidate) => fs.existsSync(path.join(
    candidate,
    'bin',
    process.platform === 'win32' ? 'java.exe' : 'java'
  ))) || null;
};

const ensureDirectory = (directoryPath) => {
  fs.mkdirSync(directoryPath, { recursive: true });
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const writeJson = (filePath, value) => {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const assertDemoProject = (candidate = projectId) => {
  if (!String(candidate).startsWith('demo-')) {
    throw new Error(`Performance commands refuse non-demo Firebase project: ${candidate}`);
  }
  return candidate;
};

const assertSchemaVersion = (value, label = 'performance document', supported = 1) => {
  if (value?.schemaVersion !== supported) {
    throw new Error(`${label} uses unsupported schemaVersion ${value?.schemaVersion ?? 'missing'}; expected ${supported}.`);
  }
  return value;
};

const percentile = (values, quantile) => {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.max(0, index)];
};

const median = (values) => percentile(values, 0.5);

module.exports = {
  assertDemoProject,
  assertSchemaVersion,
  authoritativeResultsDir,
  baselinePath,
  budgetsPath,
  ensureDirectory,
  frontendRoot,
  fixtureManifestPath,
  median,
  percentile,
  projectId,
  readJson,
  resolvePortableJavaHome,
  repoRoot,
  resultsDir,
  scenariosPath,
  scorecardPath,
  sha256,
  writeJson,
};
