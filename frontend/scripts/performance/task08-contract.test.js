const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TASK08_BASELINE_METRICS,
  TASK08_COMPACT_USER_DATA_TARGETS,
  TASK08_FUTURE_ACCEPTANCE_TARGETS,
  TASK08_MEASUREMENT_CONTRACT_VERSION,
  TASK08_SCENARIO_IDS,
  deriveTask08Metrics,
  settleTask08ResourceHold,
} = require('./task08-contract');

const event = (category, metric, value = 1, tags = {}) => ({
  category,
  metric,
  value,
  tags,
});

const committedRender = (component, tags = {}) => event('task08', 'render', 1, {
  component,
  committed: true,
  authoritative: true,
  source: 'committed-probe',
  ...tags,
});

test('Task 08 contract names the four deterministic scenarios and physical targets', () => {
  assert.equal(TASK08_MEASUREMENT_CONTRACT_VERSION, 1);
  assert.deepEqual(TASK08_SCENARIO_IDS, [
    'task08-login',
    'task08-character-creation',
    'task08-home',
    'task08-two-client',
  ]);
  assert.deepEqual(TASK08_COMPACT_USER_DATA_TARGETS, [
    'users.progression.subscribe.v2',
    'users.resources.subscribe.v2',
    'users.settings.subscribe.v2',
    'users.equipment.subscribe.v2',
    'users.profilecontent.subscribe.v2',
    'users.inventory.subscribe.v2',
  ]);
  assert.ok(TASK08_BASELINE_METRICS.login.includes('login.auth.signInRequestCount'));
  assert.ok(TASK08_BASELINE_METRICS.login.includes('login.firestore.configReads'));
  assert.ok(TASK08_BASELINE_METRICS.login.includes('login.renderIsolation.decorativeBackgroundCount'));
  assert.ok(TASK08_BASELINE_METRICS.login.includes('login.renderIsolation.createButtonCount'));
  assert.ok(TASK08_BASELINE_METRICS.characterCreation.includes('characterCreation.media.objectUrlRevokeCount'));
  assert.ok(TASK08_BASELINE_METRICS.home.includes('home.inventory.filteredItemCount'));
  assert.ok(TASK08_BASELINE_METRICS.home.includes('home.inventory.initialMountedItemCount'));
  assert.ok(TASK08_BASELINE_METRICS.home.includes('home.consumable.actionStartCount'));
  assert.ok(TASK08_BASELINE_METRICS.home.includes('home.consumable.appliedCount'));
  assert.ok(TASK08_BASELINE_METRICS.home.includes('home.consumable.cancelledCount'));
  assert.ok(TASK08_BASELINE_METRICS.home.includes('home.inventory.resetMountedItemCount'));
  assert.ok(TASK08_BASELINE_METRICS.home.includes('home.renderIsolation.resourceUpdate.Inventory'));
  assert.ok(TASK08_BASELINE_METRICS.twoClient.includes('twoClient.consumable.atomicOutcome'));
  assert.equal(TASK08_FUTURE_ACCEPTANCE_TARGETS.login.profileDuplicateReads, 0);
  assert.equal(TASK08_FUTURE_ACCEPTANCE_TARGETS.home.resourceMutationsPerHold, 1);
});

test('derives observed metrics from stable task, Firestore, render, and scenario events', () => {
  const metrics = deriveTask08Metrics({
    scenarioId: 'task08-home',
    events: [
      event('task08', 'command-start', 1, {
        command: 'task05UpdateResource',
        resource: 'hp',
        mode: 'delta',
        value: -1,
      }),
      event('task08', 'command-applied', 1, {
        command: 'task05UpdateResource',
      }),
      event('task08', 'command-start', 1, {
        command: 'task05UpdateResource',
        resource: 'hp',
        mode: 'delta',
        value: -1,
      }),
      committedRender('StatsBars'),
      committedRender('StatsBars'),
      event('task08', 'inventory-filter-result', 1, { inputCount: 500, filteredCount: 500, queryLength: 0 }),
      event('task08', 'inventory-filter-result', 1, { inputCount: 500, filteredCount: 1, queryLength: 16 }),
      event('firestore', 'listener-open', 1, { target: 'users.resources.subscribe.v2' }),
      event('firestore', 'listener-open', 1, { target: 'users.inventory.subscribe.v2' }),
      event('task08', 'command-start', 1, { command: 'task05PrepareConsumable' }),
      event('task08', 'command-start', 1, { command: 'task05CommitConsumable' }),
      event('task08', 'consumable-action-start'),
      event('task08', 'consumable-animation-complete'),
      event('task08', 'consumable-commit-dispatched'),
      event('task08', 'consumable-action-terminal', 1, { outcome: 'applied' }),
    ],
    observations: {
      inventoryMediaRequestCount: null,
      inventoryInitialMountedItemCount: 60,
      inventoryResetMountedItemCount: 60,
      inventoryExpandedMountedItemCount: 120,
      inventoryInitialWindowLimit: 60,
      resourceRenderCounts: {
        Navbar: 0,
        StatsBars: 3,
        Inventory: 0,
        EquippedInventory: 0,
        Extra: 0,
        ParamTables: 0,
      },
      resourceResultingDelta: -1,
      consumableAtomicOutcome: 'committed',
    },
  });

  assert.equal(metrics['home.command.resourceMutationCount'], 2);
  assert.equal(metrics['home.command.requestedMutationDelta'], -2);
  assert.equal(metrics['home.command.resourceMutationDelta'], -1);
  assert.equal(metrics['home.command.resourceAppliedCount'], 1);
  assert.equal(metrics['home.render.StatsBars'], 2);
  assert.equal(metrics['home.firestore.compactSubscriptionTargetCount'], 2);
  assert.equal(metrics['home.firestore.compactSubscriptionOpenCount'], 2);
  assert.equal(metrics['home.inventory.initialItemCount'], 500);
  assert.equal(metrics['home.inventory.filteredItemCount'], 1);
  assert.equal(metrics['home.inventory.mediaRequestCount'], null);
  assert.equal(metrics['home.inventory.initialMountedItemCount'], 60);
  assert.equal(metrics['home.inventory.resetMountedItemCount'], 60);
  assert.equal(metrics['home.inventory.expandedMountedItemCount'], 120);
  assert.equal(metrics['home.renderIsolation.resourceUpdate.StatsBars'], 3);
  assert.equal(metrics['home.renderIsolation.resourceUpdate.Inventory'], 0);
  assert.equal(metrics['home.consumable.prepareCount'], 1);
  assert.equal(metrics['home.consumable.commitCount'], 1);
  assert.equal(metrics['home.consumable.actionStartCount'], 1);
  assert.equal(metrics['home.consumable.animationCompleteCount'], 1);
  assert.equal(metrics['home.consumable.commitDispatchedCount'], 1);
  assert.equal(metrics['home.consumable.terminalCount'], 1);
  assert.equal(metrics['home.consumable.appliedCount'], 1);
  assert.equal(metrics['home.consumable.replayedCount'], 0);
  assert.equal(metrics['home.consumable.definitiveFailureCount'], 0);
  assert.equal(metrics['home.consumable.ambiguousCount'], 0);
  assert.equal(metrics['home.consumable.cancelledCount'], 0);
  assert.equal(metrics['home.consumable.atomicOutcome'], 'committed');
});

test('distinguishes an intentional step revisit from a duplicate transition and read', () => {
  const metrics = deriveTask08Metrics({
    scenarioId: 'task08-character-creation',
    events: [
      event('task08', 'transition-start', 1, { transition: 'character-step', step: 1 }),
      event('task08', 'transition-start', 1, { transition: 'character-step', step: 2 }),
      event('task08', 'step-revisit-window-start', 1, { fromStep: 2, toStep: 1 }),
      event('task08', 'step-revisit', 1, { fromStep: 2, toStep: 1 }),
      event('firestore', 'one-shot-documents-delivered', 1, { target: 'config.varie.get.v1' }),
      event('task08', 'step-revisit-window-end', 1, { fromStep: 2, toStep: 1 }),
      event('firestore', 'one-shot-documents-delivered', 1, { target: 'config.schema.get.v1' }),
      event('task08', 'transition-start', 1, { transition: 'character-step', step: 2 }),
      event('task08', 'transition-start', 1, { transition: 'character-step', step: 2 }),
    ],
  });

  assert.equal(metrics['characterCreation.navigation.stepRevisitCount'], 1);
  assert.equal(metrics['characterCreation.firestore.stepRevisitReads'], 1);
  assert.equal(metrics['characterCreation.transition.duplicateCount'], 1);
});

test('uses the committed non-empty inventory filter result before a later mutation clears it', () => {
  const metrics = deriveTask08Metrics({
    scenarioId: 'task08-home',
    events: [
      event('task08', 'inventory-filter-result', 1, {
        inputCount: 500,
        filteredCount: 1,
        queryLength: 16,
        query: 'Fixture item 315',
      }),
      event('task08', 'inventory-filter-result', 0, {
        inputCount: 499,
        filteredCount: 0,
        queryLength: 16,
        query: 'Fixture item 315',
      }),
    ],
  });

  assert.equal(metrics['home.inventory.filterResultItemCount'], 1);
  assert.equal(metrics['home.inventory.filteredItemCount'], 1);
});

test('non-replayed success is not reported as a physical application without replay=false', () => {
  const metrics = deriveTask08Metrics({
    scenarioId: 'task08-home',
    events: [
      event('task08', 'command-non-replayed-success', 1, {
        command: 'task05UpdateResource',
      }),
    ],
  });
  assert.equal(metrics['home.command.resourceAppliedCount'], 0);
});

test('login navigation latency ends at destination interactivity, not auth-gate completion', () => {
  const metrics = deriveTask08Metrics({
    scenarioId: 'task08-login',
    events: [
      event('task08', 'transition-start', 1, {
        transition: 'login-auth-gate',
        flow: 'sign-in',
      }),
      { ...event('task08', 'transition-end', 17, { transition: 'login-auth-gate' }), timestamp: 117 },
      { category: 'route', metric: 'start', timestamp: 118, routeId: '/home' },
      { category: 'route', metric: 'interactive', timestamp: 245, routeId: '/home' },
    ],
  });
  assert.equal(metrics['login.navigationLatencyMs'], null);

  const withStart = deriveTask08Metrics({
    scenarioId: 'task08-login',
    events: [
      { ...event('task08', 'transition-start', 1, { transition: 'login-auth-gate' }), timestamp: 100 },
      { ...event('task08', 'transition-end', 17, { transition: 'login-auth-gate' }), timestamp: 117 },
      { category: 'route', metric: 'interactive', timestamp: 245, routeId: '/home' },
    ],
  });
  assert.equal(withStart['login.navigationLatencyMs'], 145);
});

test('derives Login render-isolation counts for stable decorative and action subtrees', () => {
  const metrics = deriveTask08Metrics({
    scenarioId: 'task08-login',
    events: [
      committedRender('Login'),
      committedRender('Login'),
      committedRender('LoginDecorativeBackground'),
      committedRender('LoginDecorativeOrbs'),
      committedRender('LoginCardBorder'),
      committedRender('LoginHeader'),
      committedRender('LoginSubmitButton'),
      committedRender('LoginCreateButton'),
    ],
  });

  assert.equal(metrics['login.renderCount'], 2);
  assert.equal(metrics['login.renderIsolation.decorativeBackgroundCount'], 1);
  assert.equal(metrics['login.renderIsolation.decorativeOrbsCount'], 1);
  assert.equal(metrics['login.renderIsolation.cardBorderCount'], 1);
  assert.equal(metrics['login.renderIsolation.headerCount'], 1);
  assert.equal(metrics['login.renderIsolation.submitButtonCount'], 1);
  assert.equal(metrics['login.renderIsolation.createButtonCount'], 1);
});

test('ignores auxiliary React Profiler events when deriving authoritative render counts', () => {
  const metrics = deriveTask08Metrics({
    scenarioId: 'task08-home',
    events: [
      committedRender('StatsBars'),
      event('task08', 'render', 1, {
        component: 'StatsBars',
        committed: true,
        authoritative: false,
        source: 'react-profiler',
      }),
      event('task08', 'render', 1, {
        component: 'StatsBars',
        committed: false,
        authoritative: false,
        source: 'react-profiler',
      }),
    ],
  });

  assert.equal(metrics['home.render.StatsBars'], 1);
});

const resourceStart = (sequence, value = -1) => event('task08', 'command-start', 1, {
  command: 'task05UpdateResource',
  holdId: 'hold-1',
  invocationSequence: sequence,
  localSequence: 1,
  resource: 'hp',
  mode: 'delta',
  value,
});

const resourceApplied = (sequence, appliedDelta = -1) => event('task08', 'command-applied', 1, {
  command: 'task05UpdateResource',
  holdId: 'hold-1',
  invocationSequence: sequence,
  appliedDelta,
  newValue: 44,
  newRevision: 3,
});

const resourceTerminal = (effectiveDelta = -1) => event('task08', 'resource-gesture-terminal', 1, {
  holdId: 'hold-1',
  localSequence: 1,
  resource: 'hp',
  effectiveDelta,
  terminal: 'pointerup',
});

const resourceSuccess = (sequence) => event('task08', 'command-success', 1, {
  command: 'task05UpdateResource',
  holdId: 'hold-1',
  invocationSequence: sequence,
});

const resourceFailure = (sequence) => event('task08', 'command-failure', 1, {
  command: 'task05UpdateResource',
  holdId: 'hold-1',
  invocationSequence: sequence,
});

test('resource hold settlement waits for late completions before reading authoritative state', async () => {
  assert.equal(typeof settleTask08ResourceHold, 'function');
  const starts = [
    event('task08', 'scenario-observation', 1, { phase: 'hold-start', holdId: 'hold-1' }),
    resourceTerminal(-2),
    resourceStart(1, -2),
  ];
  const snapshots = [
    { events: starts },
    { events: starts },
    { events: [...starts, resourceSuccess(1), resourceApplied(1, -2)] },
  ];
  let snapshotIndex = 0;
  let settlementComplete = false;
  const values = [45, 43, 43];
  let valueIndex = 0;

  const result = await settleTask08ResourceHold({
    holdId: 'hold-1',
    startEventIndex: 1,
    endEventIndex: 3,
    expectedBaseValue: 45,
    maxPolls: 8,
    readSnapshot: async () => {
      const snapshot = snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
      snapshotIndex += 1;
      if (snapshot.events.some((candidate) => candidate.metric === 'command-success' && candidate.tags?.invocationSequence === 1)) {
        settlementComplete = true;
      }
      return snapshot;
    },
    readAuthoritativeValue: async () => {
      assert.equal(settlementComplete, true);
      return values[Math.min(valueIndex++, values.length - 1)];
    },
    waitForNextPoll: async () => {},
  });

  assert.equal(result.commandCount, 1);
  assert.equal(result.appliedDelta, -2);
  assert.equal(result.expectedAuthoritativeValue, 43);
  assert.equal(result.authoritativeValue, 43);
  assert.equal(snapshotIndex, 3);
  assert.equal(valueIndex, 3);
});

test('resource hold settlement correlates one terminal with the physical command and actual callable delta', async () => {
  const events = [
    resourceTerminal(-2),
    resourceStart(1, -2),
    resourceSuccess(1),
    resourceApplied(1, -1),
  ];
  const result = await settleTask08ResourceHold({
    holdId: 'hold-1',
    startEventIndex: 0,
    endEventIndex: events.length,
    expectedBaseValue: 45,
    requireAppliedForEveryStart: true,
    maxPolls: 3,
    readSnapshot: async () => ({events}),
    readAuthoritativeValue: async () => 44,
    waitForNextPoll: async () => {},
  });

  assert.equal(result.terminalCount, 1);
  assert.equal(result.effectiveDelta, -2);
  assert.equal(result.appliedDelta, -1);
  assert.equal(result.expectedAuthoritativeValue, 44);
  assert.deepEqual(result.authoritativeValueSamples, [44, 44]);
});

test('resource hold settlement rejects missing terminals instead of accepting a partial snapshot', async () => {
  assert.equal(typeof settleTask08ResourceHold, 'function');
  const starts = [resourceStart(1), resourceStart(2)];

  await assert.rejects(
    () => settleTask08ResourceHold({
      holdId: 'hold-1',
      startEventIndex: 0,
      endEventIndex: 2,
      expectedBaseValue: 45,
      maxPolls: 3,
      readSnapshot: async () => ({ events: starts }),
      readAuthoritativeValue: async () => 45,
      waitForNextPoll: async () => {},
    }),
    /terminal/i
  );
});

test('resource hold settlement rejects a failed command before accepting the document value', async () => {
  assert.equal(typeof settleTask08ResourceHold, 'function');
  const starts = [resourceTerminal(-1), resourceStart(1)];
  const settledWithFailure = [
    ...starts,
    resourceFailure(1),
  ];

  await assert.rejects(
    () => settleTask08ResourceHold({
      holdId: 'hold-1',
      startEventIndex: 0,
      endEventIndex: 2,
      expectedBaseValue: 45,
      maxPolls: 4,
      readSnapshot: async () => ({ events: settledWithFailure }),
      readAuthoritativeValue: async () => 44,
      waitForNextPoll: async () => {},
    }),
    /failure/i
  );
});

const settleFixture = (events, options = {}) => settleTask08ResourceHold({
  holdId: 'hold-1',
  startEventIndex: 0,
  endEventIndex: events.length,
  expectedBaseValue: 45,
  requireAppliedForEveryStart: true,
  maxPolls: 3,
  readSnapshot: async () => ({events}),
  readAuthoritativeValue: async () => 44,
  waitForNextPoll: async () => {},
  ...options,
});

test('resource hold settlement rejects duplicate gesture terminal records', async () => {
  const events = [resourceTerminal(), resourceTerminal(), resourceStart(1), resourceSuccess(1), resourceApplied(1)];
  await assert.rejects(() => settleFixture(events), /exactly one terminal event/i);
});

[
  ['resource', {...resourceTerminal(), tags: {...resourceTerminal().tags, resource: 'mana'}}],
  ['effective delta', resourceTerminal(-2)],
  ['local sequence', {...resourceTerminal(), tags: {...resourceTerminal().tags, localSequence: 2}}],
].forEach(([name, terminal]) => {
  test(`resource hold settlement rejects a terminal with mismatched ${name}`, async () => {
    const events = [terminal, resourceStart(1), resourceSuccess(1), resourceApplied(1)];
    await assert.rejects(() => settleFixture(events), /terminal does not match/i);
  });
});

test('resource hold settlement rejects zero and duplicate physical command starts', async () => {
  await assert.rejects(() => settleFixture([resourceTerminal()]), /exactly one physical command; found 0/i);
  await assert.rejects(
    () => settleFixture([resourceTerminal(), resourceStart(1), resourceStart(2), resourceSuccess(1), resourceApplied(1)]),
    /exactly one physical command; found 2/i
  );
});

test('resource hold settlement requires one actual application for its successful command', async () => {
  await assert.rejects(
    () => settleFixture([resourceTerminal(), resourceStart(1), resourceSuccess(1)]),
    /without a physical command-applied/i
  );
  await assert.rejects(
    () => settleFixture([resourceTerminal(), resourceStart(1), resourceSuccess(1), resourceApplied(1), resourceApplied(1)]),
    /multiple application events/i
  );
});

test('resource hold settlement rejects duplicate success or failure terminals for one invocation', async () => {
  await assert.rejects(
    () => settleFixture([resourceTerminal(), resourceStart(1), resourceSuccess(1), resourceFailure(1), resourceApplied(1)]),
    /multiple terminal events/i
  );
});
