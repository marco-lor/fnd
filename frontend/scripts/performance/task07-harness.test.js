const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildRulesExecCommands,
  runRulesExec,
  task06RulesPath,
  task07CallablesPath,
  task07RulesPath,
} = require('./rules-exec');
const {
  buildFirebaseRulesInvocation,
  runRulesEmulators,
} = require('./rules-emulators');
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
const {
  isCrossfadeBattlemapObservation,
  summarizeCrossfadeBattlemapObservation,
  validateRenderSchedulerSnapshot,
} = require('./task07-render-scheduler');
const {
  createFivePeerFailureAttachment,
  summarizeFivePeerSuccessDiagnostics,
} = require('./task07-five-peer-evidence');

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
const scenariosPath = path.resolve(frontendRoot, 'performance', 'scenarios.json');
const routePerformancePath = path.resolve(
  frontendRoot,
  'performance',
  'tests',
  'browser',
  'routes.performance.js'
);
const mebibyte = 1024 * 1024;
const performanceArtifactPaths = [
  'frontend/performance-results/',
  'frontend/test-results/performance/',
  'frontend/playwright-report/performance/',
];

const extractFullBenchmarkSteps = (workflow) => {
  const job = /^  full-benchmark:\r?\n([\s\S]*?)(?=^  [\w-]+:\r?\n|(?![\s\S]))/m.exec(workflow);
  assert.ok(job, 'full-benchmark job is required');
  const steps = /^    steps:\r?\n/m.exec(job[1]);
  assert.ok(steps, 'full-benchmark steps are required');
  const content = job[1].slice(steps.index + steps[0].length);
  const starts = [...content.matchAll(/^      - (?=\S)/gm)].map((match) => match.index);
  assert.ok(starts.length > 0, 'full-benchmark must contain steps');
  return starts.map((start, index) => content.slice(start, starts[index + 1]));
};

const findSingleStep = (steps, label, predicate) => {
  const matches = steps
    .map((step, index) => ({ index, step }))
    .filter(({ step }) => predicate(step));
  assert.equal(matches.length, 1, `expected exactly one ${label} step, found ${matches.length}`);
  return matches[0];
};

const extractPerformanceArtifactPathEntries = (step, label) => {
  const withMapping = /^        with:\r?$/m.exec(step);
  assert.ok(withMapping, `${label} must contain a with mapping`);
  const withContent = step.slice(withMapping.index + withMapping[0].length);
  const pathBlock = /^          path: \|\r?\n((?:^            [^\r\n]*(?:\r?\n|$))*)/m.exec(withContent);
  assert.ok(pathBlock, `${label} must contain an exact path block`);
  return pathBlock[1]
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const assertPerformanceArtifactPaths = (step, label) => {
  const entries = extractPerformanceArtifactPathEntries(step, label);
  for (const artifactPath of performanceArtifactPaths) {
    assert.ok(entries.includes(artifactPath), `${label} missing required path: ${artifactPath}`);
  }
};

const validateFullBenchmarkWorkflow = (workflow) => {
  const steps = extractFullBenchmarkSteps(workflow);
  const authoritative = findSingleStep(
    steps,
    'authoritative',
    (step) => /^      - id: authoritative\r?$/m.test(step)
  );
  assert.match(
    authoritative.step,
    /^        run: npm run perf:authoritative\r?$/m,
    'authoritative step must contain the exact command'
  );

  const failureArtifact = findSingleStep(
    steps,
    'authoritative failure artifact',
    (step) => /^      - uses: actions\/upload-artifact@v4\r?$/m.test(step)
      && /^        if: \$\{\{ failure\(\) && steps\.authoritative\.outcome == 'failure' \}\}\r?$/m.test(step)
      && /^          name: authoritative-failure-/m.test(step)
  );
  assert.ok(authoritative.index < failureArtifact.index, 'failure artifact must follow authoritative');
  assert.match(failureArtifact.step, /^          retention-days: 30\r?$/m);
  assert.match(failureArtifact.step, /^          if-no-files-found: error\r?$/m);
  assertPerformanceArtifactPaths(failureArtifact.step, 'authoritative failure artifact');

  const soak = findSingleStep(
    steps,
    'Task 07 soak',
    (step) => /^      - run: npm run perf:media:soak\r?$/m.test(step)
  );
  assert.ok(failureArtifact.index < soak.index, 'failure artifact must precede the Task 07 soak');

  const finalArtifact = findSingleStep(
    steps.slice(soak.index + 1),
    'final combined artifact after soak',
    (step) => /^      - uses: actions\/upload-artifact@v4\r?$/m.test(step)
      && /^        if: always\(\)\r?$/m.test(step)
      && /^          name: full-performance-benchmark\r?$/m.test(step)
  );
  assertPerformanceArtifactPaths(finalArtifact.step, 'final combined artifact');

  assert.match(workflow, /push:\r?\n\s+branches: \[main, devs\]/);
  assert.match(extractFullBenchmarkSteps(workflow).join(''), /node-version: 22/);
  assert.match(extractFullBenchmarkSteps(workflow).join(''), /distribution: temurin, java-version: 21/);
  assert.doesNotMatch(extractFullBenchmarkSteps(workflow).join(''), /firebase deploy|secrets\./);
};

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
  const fixtureSeed = [
    path.join(frontendRoot, 'scripts', 'performance', 'fixtures.js'),
    'seed',
  ];
  assert.equal(commands.length, 7);
  assert.equal(nodeTests.length, 6);
  assert.equal(commands.some((args) => args.includes(task07RulesPath)), true);
  assert.equal(commands.some((args) => args.includes(task07CallablesPath)), true);
  assert.ok(
    commands.findIndex((args) => args.includes(task07CallablesPath))
      > commands.findIndex((args) => args.includes(task07RulesPath))
  );
  assert.deepEqual(commands.filter((args) => (
    args[0] === fixtureSeed[0] && args[1] === fixtureSeed[1]
  )), [fixtureSeed]);
  assert.deepEqual(commands.at(-1), [
    '--test',
    '--test-concurrency=1',
    task06RulesPath,
  ]);
  nodeTests.forEach((args) => {
    assert.equal(args.length, 3);
    assert.equal(args[0], '--test');
    assert.equal(args[1], '--test-concurrency=1');
  });

  assert.deepEqual(buildRulesExecCommands({ task07Only: true }), [
    fixtureSeed,
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

test('rules emulator owner injects the demo Functions environment and propagates failures', async () => {
  const fakeFirebaseCli = 'firebase-cli.js';
  const fakeFs = {
    existsSync: () => true,
    mkdirSync: () => {},
  };
  const invocation = buildFirebaseRulesInvocation({
    argv: ['--task07-only'],
    firebaseCli: fakeFirebaseCli,
    fsImpl: fakeFs,
  });
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args.slice(0, 7), [
    fakeFirebaseCli,
    'emulators:exec',
    '--project',
    'demo-fnd-perf',
    '--only',
    'auth,firestore,storage,functions',
    '--config',
  ]);
  assert.equal(
    invocation.args.at(-1),
    'node scripts/performance/rules-exec.js --task07-only'
  );
  assert.throws(
    () => buildFirebaseRulesInvocation({
      firebaseCli: fakeFirebaseCli,
      fsImpl: fakeFs,
      projectId: 'fatins',
    }),
    /refuse non-demo Firebase project/
  );

  const calls = [];
  const commonOptions = {
    assertEmulatorPortsFreeImpl: async ({ports}) => calls.push(['ports:start', ports]),
    createFirebaseCliEnvironmentImpl: (env, overrides) => ({...env, ...overrides}),
    env: {PATH: 'test-path'},
    firebaseCli: fakeFirebaseCli,
    fsImpl: fakeFs,
    resolvePortableJavaHomeImpl: () => null,
    waitForEmulatorPortsFreeImpl: async ({ports}) => calls.push(['ports:end', ports]),
    withDemoFunctionsEnvironmentImpl: async (operation, options) => {
      calls.push(['demo-env', options.projectId]);
      return operation();
    },
    withEmulatorPortCleanupImpl: async (operation, options) => {
      try {
        return await operation();
      } finally {
        await options.waitForPorts();
      }
    },
  };
  await runRulesEmulators({
    ...commonOptions,
    argv: ['--task07-only'],
    spawnSyncImpl: (command, args, options) => {
      calls.push(['spawn', command, args.at(-1), options.shell]);
      return {status: 0};
    },
  });
  assert.deepEqual(calls.map(([name]) => name), [
    'ports:start',
    'demo-env',
    'spawn',
    'ports:end',
  ]);
  assert.equal(calls[0][1].includes(9299), true);
  assert.equal(calls[0][1].includes(9499), true);
  assert.deepEqual(calls[3], ['ports:end', calls[0][1]]);
  assert.deepEqual(calls[1], ['demo-env', 'demo-fnd-perf']);
  assert.deepEqual(calls[2], [
    'spawn',
    process.execPath,
    'node scripts/performance/rules-exec.js --task07-only',
    false,
  ]);

  const failureCallStart = calls.length;
  await assert.rejects(
    () => runRulesEmulators({
      ...commonOptions,
      spawnSyncImpl: () => ({status: 9}),
    }),
    (error) => error.exitCode === 9 && /exit code 9/.test(error.message)
  );
  assert.deepEqual(calls.slice(failureCallStart).map(([name]) => name), [
    'ports:start',
    'demo-env',
    'ports:end',
  ]);
  assert.equal(calls.at(-1)[1].includes(9299), true);
  assert.equal(calls.at(-1)[1].includes(9499), true);
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
  assert.match(soak, /waitForCrossfadeLayerAndRegistry\(page, \{ backgroundId: background\.id \}\)/);
  assert.match(soak, /performance\.now\(\) - lifecycleStartedAtMs < soakRuntime\.durationMs/);
  assert.match(playwrightConfig, /workers:\s*1/);
  assert.match(playwrightConfig, /name:\s*'task07-soak'[\s\S]*timeout:\s*task07SoakRuntime\.timeoutMs/);
});

test('Task 07 render-scheduler evidence accepts only a visible settled stage-free page', () => {
  const settled = {
    containerCount: 0,
    elapsedMs: 32,
    frameCount: 2,
    hasFocus: true,
    routeActiveResources: {},
    routeDiagnostics: [],
    stageCount: 0,
    state: 'settled',
    visibilityState: 'visible',
  };

  assert.doesNotThrow(() => validateRenderSchedulerSnapshot(settled, {
    cycle: 2,
    route: '/echi-di-viaggio',
  }));

  assert.throws(() => validateRenderSchedulerSnapshot({
    ...settled,
    hasFocus: false,
    visibilityState: 'hidden',
  }, {
    cycle: 2,
    route: '/echi-di-viaggio',
  }), (error) => {
    assert.match(error.message, /invalid foreground state/);
    assert.match(error.message, /echi-di-viaggio/);
    assert.match(error.message, /"cycle":2/);
    assert.match(error.message, /"visibilityState":"hidden"/);
    return true;
  });

  assert.throws(() => validateRenderSchedulerSnapshot({
    ...settled,
    containerCount: 1,
    stageCount: 1,
  }, {
    cycle: 3,
    route: '/grigliata',
  }), /retained a Konva stage or container/);

  assert.throws(() => validateRenderSchedulerSnapshot({
    ...settled,
    elapsedMs: 2001,
    frameCount: 1,
    routeActiveResources: { '/echi-di-viaggio::animation-frame': 1 },
    state: 'timeout',
  }, {
    cycle: 1,
    route: '/echi-di-viaggio',
  }), (error) => {
    assert.match(error.message, /did not settle/);
    assert.match(error.message, /"frameCount":1/);
    assert.match(error.message, /animation-frame/);
    return true;
  });

  assert.throws(() => validateRenderSchedulerSnapshot({
    ...settled,
    frameCount: 1,
  }, {
    cycle: 1,
    route: '/home',
  }), /did not settle/);
});

test('Task 07 crossfade requires active and outgoing layers in the same pinned observation', () => {
  const validLayer = { height: 720, opacity: 0.5, width: 1280 };
  const pinnedRegistry = {
    activeRequestCount: 0,
    namedPins: ['grigliata-active-board', 'grigliata-crossfade'],
    pinnedRecordCount: 2,
    queuedRequestCount: 0,
  };
  const pinsOnly = summarizeCrossfadeBattlemapObservation({
    active: [validLayer],
    outgoing: [],
    registry: pinnedRegistry,
  });
  const overlap = summarizeCrossfadeBattlemapObservation({
    active: [validLayer],
    outgoing: [validLayer],
    registry: pinnedRegistry,
  });

  assert.equal(isCrossfadeBattlemapObservation(pinsOnly), false);
  assert.equal(isCrossfadeBattlemapObservation(overlap), true);
  assert.deepEqual(overlap, {
    activeLayerCount: 1,
    activeRequestCount: 0,
    hasActiveBoardPin: true,
    hasCrossfadePin: true,
    outgoingLayerCount: 1,
    pinnedRecordCount: 2,
    queuedRequestCount: 0,
  });
  assert.equal(JSON.stringify(overlap).includes('grigliata-active-board'), false);
});

test('Task 07 five-peer success diagnostics omit failure arrays while failure attachments retain them', () => {
  const diagnostics = {
    assetSettlement: {
      network: { pendingCount: 0 },
      registry: { activeRequestCount: 0, queuedRequestCount: 0 },
    },
    explainedActiveWriteTurnoverCount: 1,
    explainedActiveWriteTurnovers: [{ classification: 'active-write-turnover' }],
    explainedCleanupTransportCancellationCount: 2,
    explainedCleanupTransportCancellations: [{ classification: 'cleanup-transport-cancellation' }],
    explainedRecaptchaCancellationCount: 3,
    explainedRecaptchaCancellations: [{ classification: 'recaptcha-cancellation' }],
    failedRequestCount: 4,
    failedRequests: [{ classification: 'unexpected' }],
    requestFailureDiagnosticErrorCount: 0,
    requestFailureDiagnosticErrors: [],
    visibilityState: 'visible',
  };
  const peers = [{ diagnostics, role: 'player' }];
  const success = summarizeFivePeerSuccessDiagnostics(peers, {
    explainedStartupWarningCount: 1,
  });
  const failure = createFivePeerFailureAttachment(peers);
  const successSerialized = JSON.stringify(success);
  const failureSerialized = JSON.stringify(failure);

  assert.equal(successSerialized.includes('failedRequests'), false);
  assert.equal(successSerialized.includes('explainedActiveWriteTurnovers'), false);
  assert.equal(successSerialized.includes('requestFailureDiagnosticErrors'), false);
  assert.match(failureSerialized, /"unexpected"/);
  assert.match(failureSerialized, /"active-write-turnover"/);
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

test('Task 07 one-shot benchmark records are registered but excluded from route iteration', () => {
  const manifest = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
  const byId = new Map(manifest.scenarios.map((scenario) => [scenario.id, scenario]));
  const routePerformance = fs.readFileSync(routePerformancePath, 'utf8');
  const expectedMetrics = {
    'task07-media-shell': [
      'task07.attachedImages',
      'task07.audioNodes',
      'task07.farOffscreenAttachedImages',
      'task07.managedImages',
      'task07.musicStreamListeners',
      'task07.reducedMotionMeteors',
      'task07.uniqueFixtureImageRequests',
    ],
    'task07-registry-compact': [
      'task07.registryRequestConcurrencyLimit',
      'task07.unpinnedRegistryRecords',
      'task07.unpinnedEstimatedDecodedBytes',
      'task07.totalEstimatedDecodedBytes',
      'task07.lowPriorityQueuedPreloads',
    ],
    'task07-registry-desktop': [
      'task07.registryRequestConcurrencyLimit',
      'task07.unpinnedRegistryRecords',
      'task07.unpinnedEstimatedDecodedBytes',
      'task07.totalEstimatedDecodedBytes',
      'task07.lowPriorityQueuedPreloads',
    ],
  };

  for (const [scenarioId, requiredMetrics] of Object.entries(expectedMetrics)) {
    assert.equal(byId.get(scenarioId)?.scheduledOnly, true);
    assert.deepEqual(byId.get(scenarioId)?.requiredMetrics, requiredMetrics);
  }
  assert.match(routePerformance, /scenario\.scheduledOnly !== true/);
  assert.match(routePerformance, /waitForStableLargestContentfulPaint\(page, scenario\.id\)/);
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

test('Task 07 Grigliata cleanup records the registry lifecycle cycle', () => {
  const soak = fs.readFileSync(soakPath, 'utf8');
  assert.match(
    soak,
    /await waitForRouteCleanup\(page, '\/grigliata', \{ cycle \}\);/
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
    'rules-emulators.js --task07-only',
  ];
  let previous = -1;
  for (const command of commands) {
    const index = gate.indexOf(command);
    assert.ok(index > previous, `${command} must appear once in serial gate order`);
    previous = index;
  }
  assert.doesNotMatch(gate, /firebase emulators:exec/);
  assert.doesNotMatch(gate, /strategy:\s*matrix|&\s*$/m);
  assert.doesNotMatch(gate, /npm --prefix functions test/);
  assert.match(
    gate,
    /rules-emulators\.js --task07-only\r?\n\s+timeout-minutes:\s*15/
  );
  assert.match(workflow, /full-benchmark:[\s\S]*npm run perf:authoritative[\s\S]*npm run perf:media:soak/);
  const rulesJobStart = workflow.indexOf('  emulator-rules:');
  const rulesJobEnd = workflow.indexOf('\n  hardened-build:', rulesJobStart);
  const rulesJob = workflow.slice(rulesJobStart, rulesJobEnd);
  assert.match(rulesJob, /timeout-minutes:\s*20/);
  assert.match(rulesJob, /node scripts\/performance\/rules-emulators\.js/);
  assert.doesNotMatch(rulesJob, /npx firebase|firebase emulators:exec/);
});

test('checked-in full benchmark captures authoritative failures before the Task 07 soak', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.doesNotThrow(() => validateFullBenchmarkWorkflow(workflow));

  const splitAuthoritative = workflow.replace(
    /      - id: authoritative\r?\n        run: npm run perf:authoritative/,
    '      - id: authoritative\n        run: npm run perf:other\n      - run: npm run perf:authoritative'
  );
  assert.throws(
    () => validateFullBenchmarkWorkflow(splitAuthoritative),
    /authoritative step must contain/
  );

  const finalArtifactStart = workflow.indexOf('          name: full-performance-benchmark');
  const finalArtifactMissingPlaywrightReport = `${workflow.slice(0, finalArtifactStart)}${workflow
    .slice(finalArtifactStart)
    .replace(/^            frontend\/playwright-report\/performance\/\r?\n/m, '')}`;
  assert.throws(
    () => validateFullBenchmarkWorkflow(finalArtifactMissingPlaywrightReport),
    /final combined artifact missing required path: frontend\/playwright-report\/performance\//
  );

  const failureArtifactWithPathsLabel = workflow.replace(
    /(          name: authoritative-failure-[\s\S]*?^          )path: \|/m,
    '$1paths: |'
  );
  assert.throws(
    () => validateFullBenchmarkWorkflow(failureArtifactWithPathsLabel),
    /authoritative failure artifact must contain an exact path block/
  );

  const finalArtifactWithPathsLabel = workflow.replace(
    /(          name: full-performance-benchmark[\s\S]*?^          )path: \|/m,
    '$1paths: |'
  );
  assert.throws(
    () => validateFullBenchmarkWorkflow(finalArtifactWithPathsLabel),
    /final combined artifact must contain an exact path block/
  );
});

test('checked-in workflow provisions every dependency used by frontend and browser jobs', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const frontendStart = workflow.indexOf('  frontend-unit:');
  const frontendEnd = workflow.indexOf('\n  functions-checks:', frontendStart);
  const frontendJob = workflow.slice(frontendStart, frontendEnd);
  assert.match(frontendJob, /frontend\/functions\/package-lock\.json/);
  assert.match(
    frontendJob,
    /npm --prefix functions ci[\s\S]*npm --prefix functions run build[\s\S]*npm run perf:test/
  );

  const functionsStart = workflow.indexOf('  functions-checks:');
  const functionsEnd = workflow.indexOf('\n  task07-pr-gate:', functionsStart);
  const functionsJob = workflow.slice(functionsStart, functionsEnd);
  assert.match(functionsJob, /frontend\/package-lock\.json/);
  assert.match(
    functionsJob,
    /npm --prefix \.\. ci[\s\S]*- run: npm ci[\s\S]*- run: npm run lint/
  );

  const crossBrowserStart = workflow.indexOf('  cross-browser-readiness:');
  const crossBrowserEnd = workflow.indexOf('\n  full-benchmark:', crossBrowserStart);
  const crossBrowserJob = workflow.slice(crossBrowserStart, crossBrowserEnd);
  assert.match(
    crossBrowserJob,
    /npx playwright install --with-deps chromium firefox webkit/
  );
});
