#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { frontendRoot, resultsDir, writeJson } = require('./common');

const buildDirectory = path.join(frontendRoot, 'build');
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolute = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(absolute) : [absolute];
});

if (!fs.existsSync(path.join(buildDirectory, 'index.html'))) {
  throw new Error('Normal production build is missing. Run npm run build:production first.');
}
const markers = ['__FND_PERF__', '__FND_PERF_BENCHMARKS__', '__FND_PERF_BOOTSTRAP__'];
const matches = walk(buildDirectory)
  .filter((filePath) => filePath.endsWith('.js'))
  .flatMap((filePath) => {
    const contents = fs.readFileSync(filePath, 'utf8');
    return markers.filter((marker) => contents.includes(marker)).map((marker) => ({
      file: path.relative(buildDirectory, filePath).replace(/\\/g, '/'), marker,
    }));
  });

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  buildMode: 'normal-production',
  instrumentationAbsent: matches.length === 0,
  matches,
};
writeJson(path.join(resultsDir, 'normal-build-verification.json'), report);
if (matches.length) {
  console.error(`Normal production build contains performance-only markers: ${JSON.stringify(matches)}`);
  process.exit(1);
}
console.log('Normal production build contains no performance bridge, profiler, or benchmark markers.');
