#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const {
  assertPerformanceProject,
  authoritativeResultsDir,
  frontendRoot,
  projectId,
  repoRoot,
} = require('./common');
const { waitForEmulatorPortsFree, withEmulatorPortCleanup } = require('./emulators');

const assertCleanWorktree = ({
  label = 'authoritative measurement',
  spawnSync = childProcess.spawnSync,
} = {}) => {
  const safeRepoRoot = repoRoot.replace(/\\/g, '/');
  const result = spawnSync('git', [
    '-c',
    `safe.directory=${safeRepoRoot}`,
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error || result.status !== 0) {
    const diagnostic = result.error?.message || String(result.stderr || '').trim()
      || `git status exited with ${result.status}`;
    throw new Error(`Unable to verify the Git worktree before ${label}: ${diagnostic}`);
  }
  const changes = String(result.stdout || '').trim();
  if (!changes) return;
  const entries = changes.split(/\r?\n/).filter(Boolean);
  const preview = entries.slice(0, 20).join('\n');
  const omitted = entries.length > 20 ? `\n... ${entries.length - 20} more entries` : '';
  const error = new Error(
    `Refusing ${label}: authoritative measurements require a clean Git worktree.\n${preview}${omitted}`
  );
  error.code = 'FND_PERF_DIRTY_WORKTREE';
  throw error;
};

const run = (command, args, environment = {}) => {
  const result = childProcess.spawnSync(command, args, {
    cwd: frontendRoot,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    const error = new Error(`Performance command failed: ${command} ${args.join(' ')}`);
    error.exitCode = result.status || 1;
    throw error;
  }
};

const main = async ({
  assertClean = assertCleanWorktree,
  execute = run,
  cleanup = withEmulatorPortCleanup,
  waitForPorts = waitForEmulatorPortsFree,
  environment = process.env,
  now = () => new Date(),
} = {}) => {
  assertPerformanceProject(projectId);
  assertClean({ label: 'authoritative entry' });
  const runBase = environment.FND_PERF_RUN_ID
    || now().toISOString().replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '');
  const commonEnvironment = {
    FND_PERF_AUTHORITATIVE: '1',
    FND_PERF_ITERATIONS: '3',
  };

  execute(process.execPath, [path.join(__dirname, 'preflight.js')]);
  execute(process.execPath, [path.join(frontendRoot, 'scripts', 'build-production.js')]);
  execute(process.execPath, [path.join(__dirname, 'verify-disabled-build.js')]);

  const snapshots = [];
  for (const suffix of ['a', 'b']) {
    const runId = `${runBase}-${suffix}`;
    const environment = { ...commonEnvironment, FND_PERF_RUN_ID: runId };
    assertClean({ label: `authoritative run ${runId} build` });
    execute(process.execPath, [path.join(__dirname, 'build.js')], environment);
    await cleanup(() => {
      execute(process.execPath, [
        require.resolve('@playwright/test/cli'),
        'test',
        '--config',
        'performance/playwright.config.js',
        '--project',
        'chromium',
      ], environment);
    }, {
      label: `Authoritative run ${runId}`,
      waitForPorts: async () => {
        console.log(`Waiting for owned ${runId} emulator ports to become stably free...`);
        await waitForPorts();
      },
    });
    assertClean({ label: `authoritative run ${runId} snapshot` });
    execute(process.execPath, [path.join(__dirname, 'snapshot-authoritative.js'), '--run-id', runId], environment);
    snapshots.push(path.join(authoritativeResultsDir, `${runId}.json`));
  }

  execute(process.execPath, [
    path.join(__dirname, 'repeatability.js'),
    '--run-a', snapshots[0],
    '--run-b', snapshots[1],
  ]);
  execute(process.execPath, [path.join(__dirname, 'compare.js')]);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = { assertCleanWorktree, main, run };
