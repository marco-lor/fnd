const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildRulesExecCommands,
  runRulesExec,
  task07CallablesPath,
  task07RulesPath,
} = require('./rules-exec');
const {
  TASK07_SOAK_DEFAULT_DURATION_MS,
  TASK07_SOAK_DESKTOP_LIMITS,
  TASK07_SOAK_SMOKE_DEFAULT_DURATION_MS,
  TASK07_SOAK_TIMEOUT_BUFFER_MS,
  evaluateTask07RegistryPlateau,
  resolveTask07SoakCycles,
  resolveTask07SoakDuration,
  resolveTask07SoakRuntime,
  resolveTask07SoakSmokeMode,
} = require('./task07-soak-contract');

const frontendRoot = path.resolve(__dirname, '..', '..');
const workflowPath = path.resolve(frontendRoot, '..', '.github', 'workflows', 'performance.yml');
const soakPath = path.resolve(
  frontendRoot,
  'performance',
  'tests',
  'browser',
  'task07-media-soak.performance.js'
);
const playwrightConfigPath = path.resolve(frontendRoot, 'performance', 'playwright.config.js');
const packageJsonPath = path.resolve(frontendRoot, 'package.json');
const budgetsPath = path.resolve(frontendRoot, 'performance', 'budgets.json');
const task07MediaRunnerPath = path.resolve(
  frontendRoot,
  'scripts',
  'task07',
  'run-media-integration.js'
);
const globalSetupPath = path.resolve(frontendRoot, 'performance', 'global-setup.js');
const mebibyte = 1024 * 1024;

const registrySample = (overrides = {}) => ({
  activeRequestCount: 0,
  decodedBytes: 160 * mebibyte,
  limits: {
    profile: 'desktop',
    ...TASK07_SOAK_DESKTOP_LIMITS,
  },
  pinnedRecordCount: 0,
  queuedRequestCount: 0,
  referencedRecordCount: 0,
  unpinnedDecodedBytes: 96 * mebibyte,
  unpinnedRecordCount: 72,
  ...overrides,
});

const settledCycle = (cycle, registryOverrides = {}) => ({
  backgroundsVisited: 50,
  cycle,
  registry: registrySample(registryOverrides),
  tokenNodeCount: 200,
});

test('owned emulator runner executes Task 07 rules and callables serially', () => {
  const commands = buildRulesExecCommands();
  const nodeTests = commands.filter(([first]) => first === '--test');
  assert.equal(commands.length, 7);
  assert.equal(nodeTests.length, 6);
  assert.equal(commands.some((args) => args.includes(task07RulesPath)), true);
  assert.equal(commands.some((args) => args.includes(task07CallablesPath)), true);
  assert.ok(
    commands.findIndex((args) => args.includes(task07CallablesPath))
      > commands.findIndex((args) => args.includes(task07RulesPath))
  );
  nodeTests.forEach((args) => {
    assert.equal(args.length, 3);
    assert.equal(args[0], '--test');
    assert.equal(args[1], '--test-concurrency=1');
  });

  assert.deepEqual(buildRulesExecCommands({ task07Only: true }), [
    [path.join(frontendRoot, 'scripts', 'performance', 'fixtures.js'), 'seed'],
    ['--test', '--test-concurrency=1', task07RulesPath],
    ['--test', '--test-concurrency=1', task07CallablesPath],
  ]);
});

test('perf:media owns exact Task 07 integration before one-worker browser checks', () => {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const runner = fs.readFileSync(task07MediaRunnerPath, 'utf8');
  const globalSetup = fs.readFileSync(globalSetupPath, 'utf8');

  assert.equal(
    packageJson.scripts['perf:media'],
    'node scripts/task07/run-media-integration.js'
  );
  assert.match(runner, /FND_TASK07_MEDIA_INTEGRATION:\s*'1'/);
  assert.match(runner, /'--project',\s*\n\s*'task07-chromium'/);
  assert.match(runner, /'--workers',\s*\n\s*'1'/);
  assert.match(globalSetup, /task07-media-callables\.test\.js/);
  assert.match(globalSetup, /task07-media-rules\.test\.js/);
  assert.match(globalSetup, /'--test-concurrency=1'/);
});

test('owned emulator runner stops after the first failure and rejects unknown modes', () => {
  const calls = [];
  const exitCode = runRulesExec({
    argv: ['--task07-only'],
    spawnSyncImpl: (executable, args, options) => {
      calls.push({ args, cwd: options.cwd, executable, shell: options.shell });
      return { status: calls.length === 1 ? 9 : 0 };
    },
  });
  assert.equal(exitCode, 9);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, process.execPath);
  assert.equal(calls[0].cwd, frontendRoot);
  assert.equal(calls[0].shell, false);
  assert.throws(
    () => runRulesExec({ argv: ['--parallel'], spawnSyncImpl: () => ({ status: 0 }) }),
    /Unknown rules runner argument/
  );
});

test('Task 07 soak requires three to five cycles', () => {
  assert.equal(resolveTask07SoakCycles(), 3);
  assert.equal(resolveTask07SoakCycles('3'), 3);
  assert.equal(resolveTask07SoakCycles('5'), 5);
  for (const value of ['1', '2', '6', '3.5', 'many']) {
    assert.throws(() => resolveTask07SoakCycles(value), /integer from 3 to 5/);
  }
});

test('Task 07 soak defaults to a ten-minute lifecycle with explicit bounded smoke opt-in', () => {
  assert.equal(resolveTask07SoakSmokeMode(), false);
  assert.equal(resolveTask07SoakSmokeMode('0'), false);
  assert.equal(resolveTask07SoakSmokeMode('1'), true);
  assert.throws(() => resolveTask07SoakSmokeMode('true'), /must be 1/);

  assert.equal(resolveTask07SoakDuration(), TASK07_SOAK_DEFAULT_DURATION_MS);
  assert.equal(TASK07_SOAK_DEFAULT_DURATION_MS, 600_000);
  assert.equal(resolveTask07SoakDuration('600000'), 600_000);
  assert.throws(() => resolveTask07SoakDuration('599999'), /600000 to 3600000/);
  assert.throws(() => resolveTask07SoakDuration('600000.5'), /must be an integer/);

  assert.equal(
    resolveTask07SoakDuration(undefined, { smoke: true }),
    TASK07_SOAK_SMOKE_DEFAULT_DURATION_MS
  );
  assert.equal(resolveTask07SoakDuration('30000', { smoke: true }), 30_000);
  assert.throws(
    () => resolveTask07SoakDuration('29999', { smoke: true }),
    /while FND_TASK07_SOAK_SMOKE=1/
  );
});

test('Task 07 soak runtime keeps timeout headroom and never shortens production implicitly', () => {
  assert.deepEqual(resolveTask07SoakRuntime({}), {
    durationMs: TASK07_SOAK_DEFAULT_DURATION_MS,
    minimumCycles: 3,
    smoke: false,
    timeoutMs: TASK07_SOAK_DEFAULT_DURATION_MS + TASK07_SOAK_TIMEOUT_BUFFER_MS,
  });
  assert.deepEqual(resolveTask07SoakRuntime({
    FND_TASK07_SOAK_CYCLES: '5',
    FND_TASK07_SOAK_DURATION_MS: '45000',
    FND_TASK07_SOAK_SMOKE: '1',
  }), {
    durationMs: 45_000,
    minimumCycles: 5,
    smoke: true,
    timeoutMs: 45_000 + TASK07_SOAK_TIMEOUT_BUFFER_MS,
  });
});

test('Task 07 browser soak activates every fixture map and proves overlapping named leases', () => {
  const soak = fs.readFileSync(soakPath, 'utf8');
  const playwrightConfig = fs.readFileSync(playwrightConfigPath, 'utf8');
  assert.match(soak, /assertPerformanceProject\(projectId\)/);
  assert.match(soak, /new URL\(baseURL\)\.origin !== 'http:\/\/127\.0\.0\.1:5000'/);
  assert.match(soak, /activateGalleryBackground\(page, background\)/);
  assert.match(soak, /activatedBackgrounds\.size\)\.toBe\(TASK07_SOAK_BACKGROUND_COUNT\)/);
  assert.match(soak, /ACTIVE_BOARD_PIN,[\s\S]*CROSSFADE_PIN/);
  assert.match(soak, /performance\.now\(\) - lifecycleStartedAtMs < soakRuntime\.durationMs/);
  assert.match(playwrightConfig, /workers:\s*1/);
  assert.match(playwrightConfig, /name:\s*'task07-soak'[\s\S]*timeout:\s*task07SoakRuntime\.timeoutMs/);
});

test('Task 07 soak accepts a settled 50-background and 200-token registry plateau', () => {
  const result = evaluateTask07RegistryPlateau([
    settledCycle(1),
    settledCycle(2),
    settledCycle(3),
  ]);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.trends, {
    decodedBytes: 0,
    unpinnedDecodedBytes: 0,
    unpinnedRecordCount: 0,
  });
});

test('Task 07 blocking budgets include desktop and compact registry caps', () => {
  const configuration = JSON.parse(fs.readFileSync(budgetsPath, 'utf8'));
  const byId = new Map(configuration.budgets.map((budget) => [budget.id, budget]));
  const expected = [
    ['task07-desktop-registry-request-concurrency', 'task07-registry-desktop', 'task07.registryRequestConcurrencyLimit', 4],
    ['task07-desktop-unpinned-registry-records', 'task07-registry-desktop', 'task07.unpinnedRegistryRecords', 96],
    ['task07-desktop-unpinned-decoded-bytes', 'task07-registry-desktop', 'task07.unpinnedEstimatedDecodedBytes', 128 * mebibyte],
    ['task07-desktop-total-decoded-bytes', 'task07-registry-desktop', 'task07.totalEstimatedDecodedBytes', 384 * mebibyte],
    ['task07-desktop-low-priority-preloads', 'task07-registry-desktop', 'task07.lowPriorityQueuedPreloads', 32],
    ['task07-compact-registry-request-concurrency', 'task07-registry-compact', 'task07.registryRequestConcurrencyLimit', 2],
    ['task07-compact-unpinned-registry-records', 'task07-registry-compact', 'task07.unpinnedRegistryRecords', 64],
    ['task07-compact-unpinned-decoded-bytes', 'task07-registry-compact', 'task07.unpinnedEstimatedDecodedBytes', 64 * mebibyte],
    ['task07-compact-total-decoded-bytes', 'task07-registry-compact', 'task07.totalEstimatedDecodedBytes', 320 * mebibyte],
    ['task07-compact-low-priority-preloads', 'task07-registry-compact', 'task07.lowPriorityQueuedPreloads', 16],
  ];
  expected.forEach(([id, scenario, metric, maximum]) => {
    assert.deepEqual(byId.get(id), {
      id,
      scenario,
      metric,
      severity: 'blocking',
      comparison: 'absolute',
      maximum,
      tolerance: null,
      ownerTask: '07',
    });
  });
});

test('Task 07 soak evaluates only the required final three settled cycles', () => {
  const result = evaluateTask07RegistryPlateau([
    { backgroundsVisited: 0, cycle: 1, registry: {}, tokenNodeCount: 0 },
    { backgroundsVisited: 0, cycle: 2, registry: {}, tokenNodeCount: 0 },
    settledCycle(3),
    settledCycle(4),
    settledCycle(5),
  ]);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.finalThree.map(({ cycle }) => cycle), [3, 4, 5]);
  assert.throws(
    () => evaluateTask07RegistryPlateau([settledCycle(1), settledCycle(2)]),
    /at least three settled cycles/
  );
});

test('Task 07 soak rejects cap drift, unsettled ownership, missing scale, and upward trend', () => {
  const result = evaluateTask07RegistryPlateau([
    settledCycle(1),
    settledCycle(2),
    {
      ...settledCycle(3, {
        activeRequestCount: 1,
        decodedBytes: 170 * mebibyte,
        limits: {
          profile: 'desktop',
          ...TASK07_SOAK_DESKTOP_LIMITS,
          maxRecords: 120,
        },
        referencedRecordCount: 1,
        unpinnedDecodedBytes: 140 * mebibyte,
        unpinnedRecordCount: 80,
      }),
      backgroundsVisited: 49,
      tokenNodeCount: 199,
    },
  ]);
  assert.equal(result.status, 'fail');
  assert.match(result.failures.join('\n'), /maxRecords is 120, expected 96/);
  assert.match(result.failures.join('\n'), /visited 49\/50 backgrounds/);
  assert.match(result.failures.join('\n'), /rendered 199\/200 token nodes/);
  assert.match(result.failures.join('\n'), /unpinnedDecodedBytes .* exceeds maxDecodedBytes/);
  assert.match(result.failures.join('\n'), /settled activeRequestCount is 1/);
  assert.match(result.failures.join('\n'), /settled referencedRecordCount is 1/);
  assert.match(result.failures.join('\n'), /rose by .*limit 5\.00%/);
});

test('checked-in Task 07 PR gate keeps heavy checks serial and schedules the bounded soak', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const start = workflow.indexOf('  task07-pr-gate:');
  const end = workflow.indexOf('\n  emulator-rules:', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const gate = workflow.slice(start, end);
  const commands = [
    'npm run test:task07',
    'npm --prefix functions run lint',
    'npm --prefix functions run build',
    'node --test --test-concurrency=1 functions/test/*.test.js',
    'npm run perf:check-media-boundaries',
    'rules-exec.js --task07-only',
  ];
  let previous = -1;
  for (const command of commands) {
    const index = gate.indexOf(command);
    assert.ok(index > previous, `${command} must appear once in serial gate order`);
    previous = index;
  }
  assert.match(gate, /--only auth,firestore,functions,storage/);
  assert.doesNotMatch(gate, /strategy:\s*matrix|&\s*$/m);
  assert.doesNotMatch(gate, /npm --prefix functions test/);
  assert.match(workflow, /full-benchmark:[\s\S]*npm run perf:authoritative[\s\S]*npm run perf:media:soak/);
});
