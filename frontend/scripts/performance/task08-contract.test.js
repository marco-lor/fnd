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
  assert.ok(TASK08_BASELINE_METRICS.characterCreation.includes('characterCreation.media.objectUrlRevokeCount'));
  assert.ok(TASK08_BASELINE_METRICS.home.includes('home.inventory.filteredItemCount'));
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
      event('task08', 'render', 1, { component: 'StatsBars' }),
      event('task08', 'render', 1, { component: 'StatsBars' }),
      event('task08', 'inventory-filter-result', 1, { inputCount: 500, filteredCount: 500, queryLength: 0 }),
      event('task08', 'inventory-filter-result', 1, { inputCount: 500, filteredCount: 1, queryLength: 16 }),
      event('firestore', 'listener-open', 1, { target: 'users.resources.subscribe.v2' }),
      event('firestore', 'listener-open', 1, { target: 'users.inventory.subscribe.v2' }),
      event('task08', 'command-start', 1, { command: 'task05PrepareConsumable' }),
      event('task08', 'command-start', 1, { command: 'task05CommitConsumable' }),
    ],
    observations: {
      inventoryMediaRequestCount: null,
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
  assert.equal(metrics['home.consumable.prepareCount'], 1);
  assert.equal(metrics['home.consumable.commitCount'], 1);
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

const resourceStart = (sequence, value = -1) => event('task08', 'command-start', 1, {
  command: 'task05UpdateResource',
  holdId: 'hold-1',
  invocationSequence: sequence,
  resource: 'hp',
  mode: 'delta',
  value,
});

const resourceApplied = (sequence) => event('task08', 'command-applied', 1, {
  command: 'task05UpdateResource',
  holdId: 'hold-1',
  invocationSequence: sequence,
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
    resourceStart(1),
    resourceStart(2),
  ];
  const snapshots = [
    { events: starts },
    { events: starts },
    { events: [...starts, resourceSuccess(1), resourceApplied(1)] },
    { events: [...starts, resourceSuccess(1), resourceApplied(1), resourceSuccess(2), resourceApplied(2)] },
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
      if (snapshot.events.some((candidate) => candidate.metric === 'command-success' && candidate.tags?.invocationSequence === 2)) {
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

  assert.equal(result.commandCount, 2);
  assert.equal(result.appliedDelta, -2);
  assert.equal(result.expectedAuthoritativeValue, 43);
  assert.equal(result.authoritativeValue, 43);
  assert.equal(snapshotIndex, 4);
  assert.equal(valueIndex, 3);
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
  const starts = [resourceStart(1), resourceStart(2)];
  const settledWithFailure = [
    ...starts,
    resourceSuccess(1),
    resourceApplied(1),
    resourceFailure(2),
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
