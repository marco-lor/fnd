#!/usr/bin/env node

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  ensureDirectory,
  frontendRoot,
  projectId,
  resultsDir,
  writeJson,
} = require('./common');

const buildDir = path.join(frontendRoot, 'build');

const walk = (directoryPath) => {
  if (!fs.existsSync(directoryPath)) return [];
  return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directoryPath, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
};

const classify = (relativePath) => {
  if (/static[\\/]js[\\/]main\./.test(relativePath)) return 'entry';
  if (/static[\\/]js[\\/]runtime-/.test(relativePath)) return 'runtime';
  if (/static[\\/]js[\\/].+\.chunk\./.test(relativePath) || /static[\\/]js[\\/]\d+\./.test(relativePath)) return 'async';
  return 'asset';
};

const category = (relativePath) => {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.js') return 'javascript';
  if (extension === '.css') return 'css';
  if (extension === '.html') return 'html';
  if (/\.(woff2?|ttf|otf)$/.test(extension)) return 'font';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(extension)) return 'image';
  if (/\.(mp3|wav|ogg|mp4|webm)$/.test(extension)) return 'media';
  return 'other';
};

const build = childProcess.spawnSync(
  process.execPath,
  [require.resolve('react-scripts/scripts/build')],
  {
    cwd: frontendRoot,
    env: {
      ...process.env,
      GENERATE_SOURCEMAP: 'false',
      REACT_APP_FND_PERF: '1',
      REACT_APP_FND_PERF_PROJECT_ID: projectId,
    },
    stdio: 'inherit',
  }
);

if (build.status !== 0) process.exit(build.status || 1);

const assets = walk(buildDir)
  .filter((filePath) => !filePath.endsWith('.map'))
  .map((filePath) => {
    const bytes = fs.readFileSync(filePath);
    const relativePath = path.relative(buildDir, filePath).replace(/\\/g, '/');
    return {
      path: relativePath,
      category: category(relativePath),
      classification: classify(relativePath),
      rawBytes: bytes.length,
      gzipBytes: zlib.gzipSync(bytes, { level: 9 }).length,
      brotliBytes: zlib.brotliCompressSync(bytes).length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  })
  .sort((left, right) => right.rawBytes - left.rawBytes);

const totals = assets.reduce((result, asset) => {
  const key = asset.category;
  result[key] ||= { rawBytes: 0, gzipBytes: 0, brotliBytes: 0, files: 0 };
  result[key].rawBytes += asset.rawBytes;
  result[key].gzipBytes += asset.gzipBytes;
  result[key].brotliBytes += asset.brotliBytes;
  result[key].files += 1;
  return result;
}, {});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  buildMode: 'performance',
  projectId,
  sourceMapsPresent: walk(buildDir).some((filePath) => filePath.endsWith('.map')),
  instrumentationMarkerPresent: walk(buildDir)
    .filter((filePath) => filePath.endsWith('.js'))
    .some((filePath) => fs.readFileSync(filePath, 'utf8').includes('__FND_PERF__')),
  totals,
  assets,
};

ensureDirectory(resultsDir);
writeJson(path.join(resultsDir, 'build-report.json'), report);

for (const filePath of walk(buildDir)) {
  if (filePath.endsWith('.map') || path.basename(filePath) === 'asset-manifest.json') {
    fs.rmSync(filePath, { force: true });
  }
}

const verify = childProcess.spawnSync(
  process.execPath,
  [path.join(frontendRoot, 'scripts', 'build-production.js'), '--verify-only'],
  { cwd: frontendRoot, stdio: 'inherit' }
);
if (verify.status !== 0) process.exit(verify.status || 1);

console.log(`Performance build report written to ${path.relative(frontendRoot, path.join(resultsDir, 'build-report.json'))}.`);
