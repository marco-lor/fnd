const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  assertPerformanceProject,
  frontendRoot,
  projectId,
  readJson,
  resultsDir,
  repoRoot,
} = require('./common');
const {
  buildIdentityFromReport,
  sourceTreeIdentity,
} = require('./task08-report');

const REQUIRED_FUNCTION_EXPORTS = Object.freeze([
  'clientFirebaseConfig',
  'task05UpdateResource',
  'task05PrepareConsumable',
  'task05CommitConsumable',
  'task05CharacterCreation',
]);

const functionsRootDefault = path.join(frontendRoot, 'functions');
const performanceBuildRootDefault = path.join(frontendRoot, 'build');
const buildReportPathDefault = path.join(resultsDir, 'build-report.json');

const moduleResolver = (functionsRoot) => (moduleName) => require.resolve(moduleName, {
  paths: [functionsRoot],
});

const assertFunctionsPrerequisites = ({
  functionsRoot = functionsRootDefault,
  fsImpl = fs,
  resolveModule = moduleResolver(functionsRoot),
} = {}) => {
  const nodeModulesPath = path.join(functionsRoot, 'node_modules');
  if (!fsImpl.existsSync(nodeModulesPath)) {
    throw new Error(
      'Task 08 Functions dependencies are missing. Run from frontend/functions: '
      + 'npm.cmd ci (set NODE_OPTIONS=--use-system-ca only if the local certificate chain requires it), '
      + 'then npm.cmd run build.'
    );
  }
  for (const moduleName of ['firebase-functions/v2/https', 'firebase-admin/app']) {
    try {
      resolveModule(moduleName);
    } catch (error) {
      throw new Error(
        `Task 08 Functions dependency ${moduleName} is unavailable. `
        + 'Run npm.cmd ci from frontend/functions, then npm.cmd run build.',
        { cause: error }
      );
    }
  }
  const compiledEntry = path.join(functionsRoot, 'lib', 'index.js');
  if (!fsImpl.existsSync(compiledEntry)) {
    throw new Error(
      'Task 08 Functions build artifacts are missing (frontend/functions/lib/index.js). '
      + 'Run npm.cmd run build from frontend/functions before starting Playwright.'
    );
  }
  return compiledEntry;
};

const walkFiles = (directoryPath, fsImpl) => {
  if (!fsImpl.existsSync(directoryPath) || typeof fsImpl.readdirSync !== 'function') return [];
  return fsImpl.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath, fsImpl) : [entryPath];
  });
};

const assertFunctionsBuildFresh = ({
  functionsRoot = functionsRootDefault,
  compiledEntry,
  fsImpl = fs,
} = {}) => {
  if (typeof fsImpl.statSync !== 'function') return true;
  const sourceFiles = walkFiles(path.join(functionsRoot, 'src'), fsImpl)
    .filter((filePath) => /\.(?:ts|tsx|js|json)$/.test(filePath));
  if (!sourceFiles.length) return true;
  const newestSource = Math.max(...sourceFiles.map((filePath) => fsImpl.statSync(filePath).mtimeMs));
  const compiledAt = fsImpl.statSync(compiledEntry).mtimeMs;
  if (compiledAt + 1000 < newestSource) {
    throw new Error(
      'Task 08 Functions build artifacts are stale relative to frontend/functions/src. '
      + 'Run npm.cmd run build from frontend/functions before starting Playwright.'
    );
  }
  return true;
};

const probeCompiledFunctions = ({
  functionsRoot = functionsRootDefault,
  compiledEntry,
  env = process.env,
  spawnSyncImpl = childProcess.spawnSync,
} = {}) => {
  const probeSource = [
    `const runtime = require(${JSON.stringify('./lib/index.js')});`,
    `const required = ${JSON.stringify(REQUIRED_FUNCTION_EXPORTS)};`,
    'const missing = required.filter((name) => typeof runtime[name] !== "function");',
    'if (missing.length) { console.error(`missing exports: ${missing.join(", ")}`); process.exit(2); }',
    'process.stdout.write(JSON.stringify({ exportCount: Object.keys(runtime).length }));',
  ].join('\n');
  const result = spawnSyncImpl(process.execPath, ['-e', probeSource], {
    cwd: functionsRoot,
    env: {
      ...env,
      GCLOUD_PROJECT: projectId,
      FIREBASE_CONFIG: JSON.stringify({
        projectId,
        storageBucket: 'demo-fnd-perf.appspot.com',
      }),
    },
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || '').trim();
    throw new Error(
      'Task 08 Functions export probe failed before Playwright could start. '
      + `${detail || `exit code ${result.status ?? 'unknown'}`}. `
      + 'Run npm.cmd run build from frontend/functions and retry.'
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || '{}'));
  } catch (_error) {
    throw new Error('Task 08 Functions export probe returned invalid JSON; rebuild frontend/functions before retrying.');
  }
  return {
    compiledEntry: path.relative(functionsRoot, compiledEntry).replace(/\\/g, '/'),
    exportCount: parsed.exportCount,
    requiredExports: [...REQUIRED_FUNCTION_EXPORTS],
  };
};

const validatePerformanceBuild = ({
  performanceBuildRoot = performanceBuildRootDefault,
  buildReportPath = buildReportPathDefault,
  buildReport,
  sourceIdentity,
  fsImpl = fs,
} = {}) => {
  if (!fsImpl.existsSync(path.join(performanceBuildRoot, 'index.html'))) {
    throw new Error(
      'Task 08 performance build is missing. Run npm.cmd run perf:build from frontend before Playwright.'
    );
  }
  const report = buildReport || (
    fsImpl.existsSync(buildReportPath) ? readJson(buildReportPath) : null
  );
  if (!report) {
    throw new Error(
      `Task 08 performance build report is missing at ${buildReportPath}. `
      + 'Run npm.cmd run perf:build from frontend before Playwright.'
    );
  }
  if (
    report.buildMode !== 'performance'
    || report.projectId !== projectId
    || report.instrumentationMarkerPresent !== true
  ) {
    throw new Error(
      'Task 08 performance build report is not an opt-in demo-fnd-perf build. '
      + 'Run npm.cmd run perf:build from frontend before Playwright.'
    );
  }
  const builtFingerprint = report.sourceTreeIdentity?.sourceTreeFingerprint;
  if (!builtFingerprint || !sourceIdentity?.sourceTreeFingerprint) {
    throw new Error(
      'Task 08 performance build has no source-tree identity. '
      + 'Run npm.cmd run perf:build from the current worktree before Playwright.'
    );
  }
  if (builtFingerprint !== sourceIdentity.sourceTreeFingerprint) {
    throw new Error(
      'Task 08 performance build is stale for the current source tree. '
      + 'Run npm.cmd run perf:build from the current worktree before Playwright.'
    );
  }
  return {
    report,
    identity: buildIdentityFromReport(report),
  };
};

const validateTask08Prerequisites = ({
  functionsRoot = functionsRootDefault,
  performanceBuildRoot = performanceBuildRootDefault,
  buildReportPath = buildReportPathDefault,
  buildReport,
  sourceIdentity = sourceTreeIdentity({ repoRoot }),
  fsImpl = fs,
  resolveModule,
  env = process.env,
  spawnSyncImpl = childProcess.spawnSync,
  probeExportsImpl = probeCompiledFunctions,
} = {}) => {
  assertPerformanceProject(projectId);
  const compiledEntry = assertFunctionsPrerequisites({
    functionsRoot,
    fsImpl,
    resolveModule: resolveModule || moduleResolver(functionsRoot),
  });
  assertFunctionsBuildFresh({ functionsRoot, compiledEntry, fsImpl });
  const performance = validatePerformanceBuild({
    performanceBuildRoot,
    buildReportPath,
    buildReport,
    sourceIdentity,
    fsImpl,
  });
  const functions = probeExportsImpl === probeCompiledFunctions
    ? probeCompiledFunctions({
      functionsRoot,
      compiledEntry,
      env,
      spawnSyncImpl,
    })
    : probeExportsImpl({ functionsRoot, compiledEntry, env, spawnSyncImpl });
  return {
    sourceIdentity,
    functions,
    performance,
  };
};

module.exports = {
  REQUIRED_FUNCTION_EXPORTS,
  assertFunctionsBuildFresh,
  assertFunctionsPrerequisites,
  probeCompiledFunctions,
  validatePerformanceBuild,
  validateTask08Prerequisites,
};
