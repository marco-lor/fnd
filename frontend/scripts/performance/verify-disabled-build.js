#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { frontendRoot, resultsDir, writeJson } = require('./common');

const buildDirectory = path.join(frontendRoot, 'build');
const forbiddenContentTokens = Object.freeze([
  '__FND_PERF__',
  '__FND_PERF_BENCHMARKS__',
  '__FND_PERF_BOOTSTRAP__',
  '__FND_FIRESTORE_PERSISTENCE_EXPERIMENT__',
  '__FND_FIRESTORE_PERSISTENCE_EXPERIMENT_CLEANUP__',
  '/__fnd_perf_firestore_persistence__',
  'perf-firestore-persistence-experiment',
]);
const forbiddenPathTokens = Object.freeze([
  'perf-firestore-persistence-experiment',
]);

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolute = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(absolute) : [absolute];
});

const findDisabledBuildViolations = ({
  files,
  root = buildDirectory,
  readFile = fs.readFileSync,
} = {}) => (files || walk(root)).flatMap((filePath) => {
  const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
  const violations = forbiddenPathTokens
    .filter((token) => relativePath.includes(token))
    .map((token) => ({ file: relativePath, kind: 'path', token }));
  if (!/\.(?:js|html|css|json)$/.test(filePath)) return violations;
  const contents = readFile(filePath, 'utf8');
  return violations.concat(forbiddenContentTokens
    .filter((token) => contents.includes(token))
    .map((token) => ({ file: relativePath, kind: 'content', token })));
});

const main = () => {
  if (!fs.existsSync(path.join(buildDirectory, 'index.html'))) {
    throw new Error('Normal production build is missing. Run npm run build:production first.');
  }
  const matches = findDisabledBuildViolations();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    buildMode: 'normal-production',
    instrumentationAbsent: matches.length === 0,
    persistenceExperimentAbsent: !matches.some(({ token }) => (
      token.includes('PERSISTENCE_EXPERIMENT')
      || token.includes('firestore_persistence')
      || token.includes('firestore-persistence')
    )),
    matches,
  };
  writeJson(path.join(resultsDir, 'normal-build-verification.json'), report);
  if (matches.length) {
    throw new Error(`Normal production build contains performance-only artifacts: ${JSON.stringify(matches)}`);
  }
  console.log('Normal production build contains no performance bridge, profiler, benchmark, or persistence-experiment artifacts.');
  return report;
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  findDisabledBuildViolations,
  forbiddenContentTokens,
  forbiddenPathTokens,
  main,
};
