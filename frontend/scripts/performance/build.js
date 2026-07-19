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
const requiredChunks = JSON.parse(fs.readFileSync(
  path.join(frontendRoot, 'performance', 'required-chunks.json'),
  'utf8'
));

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

const logicalChunkName = (relativePath) => {
  if (!relativePath.endsWith('.js')) return null;
  const name = path.basename(relativePath).split('.')[0];
  if (name === 'main') return 'main';
  if (name.startsWith('runtime-')) return name;
  return name || null;
};

const chunkKind = (logicalName, classification) => {
  if (classification === 'entry' || classification === 'runtime') return classification;
  if (logicalName?.startsWith('route-')) return 'route';
  if (logicalName?.startsWith('feature-')) return 'feature';
  return 'shared';
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

const statsBuild = childProcess.spawnSync(
  process.execPath,
  [path.join(frontendRoot, 'scripts', 'performance', 'webpack-stats.js')],
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
if (statsBuild.status !== 0) process.exit(statsBuild.status || 1);

const webpackStats = JSON.parse(fs.readFileSync(path.join(resultsDir, 'webpack-stats.json'), 'utf8'));
const loginGroupNames = new Set(['main', 'app-shell', 'route-login']);
const namedChunkGroups = Array.isArray(webpackStats.namedChunkGroups)
  ? webpackStats.namedChunkGroups
  : Object.entries(webpackStats.namedChunkGroups || {}).map(([name, group]) => ({ name, ...group }));
const loginChunkIds = new Set(namedChunkGroups
  .filter((group) => loginGroupNames.has(group.name))
  .flatMap((group) => group.chunks || []));
const flattenModules = (modules = []) => modules.flatMap((module) => [
  module,
  ...flattenModules(module.modules || []),
]);
const loginModules = flattenModules(webpackStats.modules || [])
  .filter((module) => (module.chunks || []).some((chunkId) => loginChunkIds.has(chunkId)))
  .map((module) => module.name || module.identifier || '')
  .filter(Boolean);
const loginForbiddenPatterns = [
  /components[\\/]grigliata[\\/]/i,
  /components[\\/]echiDiViaggio[\\/]/i,
  /components[\\/]dmDashboard[\\/]/i,
  /components[\\/]foesHub[\\/]/i,
  /components[\\/]admin[\\/]/i,
  /components[\\/]bazaar[\\/]elements[\\/]add/i,
  /node_modules[\\/]firebase[\\/]storage/i,
  /node_modules[\\/]firebase[\\/]functions/i,
  /node_modules[\\/](?:react-)?konva[\\/]/i,
];
const loginModuleViolations = loginModules.filter((moduleName) => (
  loginForbiddenPatterns.some((pattern) => pattern.test(moduleName))
));

const assets = walk(buildDir)
  .filter((filePath) => !filePath.endsWith('.map'))
  .map((filePath) => {
    const bytes = fs.readFileSync(filePath);
    const relativePath = path.relative(buildDir, filePath).replace(/\\/g, '/');
    const classification = classify(relativePath);
    const logicalName = logicalChunkName(relativePath);
    return {
      path: relativePath,
      category: category(relativePath),
      classification,
      logicalName,
      chunkKind: chunkKind(logicalName, classification),
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
  chunkInventory: assets
    .filter((asset) => asset.category === 'javascript' && asset.logicalName)
    .map(({ path: assetPath, logicalName, chunkKind: kind, rawBytes, gzipBytes, brotliBytes }) => ({
      path: assetPath,
      logicalName,
      chunkKind: kind,
      rawBytes,
      gzipBytes,
      brotliBytes,
    })),
  requiredChunks,
  webpackModuleEvidence: {
    statsFile: 'webpack-stats.json',
    chunkCount: (webpackStats.chunks || []).length,
    moduleCount: flattenModules(webpackStats.modules || []).length,
    loginChunkIds: [...loginChunkIds],
    loginModuleCount: loginModules.length,
    loginModuleViolations,
  },
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
