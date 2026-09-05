const TASK08_MEASUREMENT_CONTRACT_VERSION = 1;

const TASK08_SCENARIO_IDS = Object.freeze([
  'task08-login',
  'task08-character-creation',
  'task08-home',
  'task08-two-client',
]);

const TASK08_COMPACT_USER_DATA_TARGETS = Object.freeze([
  'users.progression.subscribe.v2',
  'users.resources.subscribe.v2',
  'users.settings.subscribe.v2',
  'users.equipment.subscribe.v2',
  'users.profilecontent.subscribe.v2',
  'users.inventory.subscribe.v2',
]);

// These are report keys, not gates. Step 1 records the unoptimized product;
// future acceptance targets are kept in a separate object below so a current
// baseline cannot fail merely because a later task is not implemented yet.
const TASK08_BASELINE_METRICS = Object.freeze({
  login: Object.freeze([
    'login.auth.signInRequestCount',
    'login.auth.accountCreationPreflightCount',
    'login.auth.accountCreationRequestCount',
    'login.firestore.profileReads',
    'login.firestore.configReads',
    'login.navigationLatencyMs',
    'login.renderCount',
    'login.renderIsolation.decorativeBackgroundCount',
    'login.renderIsolation.decorativeOrbsCount',
    'login.renderIsolation.cardBorderCount',
    'login.renderIsolation.headerCount',
    'login.renderIsolation.submitButtonCount',
    'login.renderIsolation.createButtonCount',
  ]),
  characterCreation: Object.freeze([
    'characterCreation.firestore.codexReads',
    'characterCreation.firestore.configSchemaReads',
    'characterCreation.firestore.configVarieReads',
    'characterCreation.navigation.stepRevisitCount',
    'characterCreation.firestore.stepRevisitReads',
    'characterCreation.firestore.profileSubscriptionCount',
    'characterCreation.command.authoritativeActionCount',
    'characterCreation.command.writeCount',
    'characterCreation.transition.duplicateCount',
    'characterCreation.media.objectUrlCreateCount',
    'characterCreation.media.objectUrlRevokeCount',
    'characterCreation.media.cleanupCount',
  ]),
  home: Object.freeze([
    'home.firestore.compactSubscriptionTargetCount',
    'home.firestore.compactSubscriptionOpenCount',
    'home.render.Navbar',
    'home.render.StatsBars',
    'home.render.Inventory',
    'home.render.EquippedInventory',
    'home.render.Extra',
    'home.render.ParamTables',
    'home.renderIsolation.resourceUpdate.Navbar',
    'home.renderIsolation.resourceUpdate.StatsBars',
    'home.renderIsolation.resourceUpdate.Inventory',
    'home.renderIsolation.resourceUpdate.EquippedInventory',
    'home.renderIsolation.resourceUpdate.Extra',
    'home.renderIsolation.resourceUpdate.ParamTables',
    'home.command.resourceMutationCount',
    'home.command.requestedMutationDelta',
    'home.command.resourceMutationDelta',
    'home.command.resourceAppliedCount',
    'home.inventory.initialItemCount',
    'home.inventory.filterResultItemCount',
    'home.inventory.filteredItemCount',
    'home.inventory.initialMountedItemCount',
    'home.inventory.resetMountedItemCount',
    'home.inventory.expandedMountedItemCount',
    'home.inventory.initialWindowLimit',
    'home.inventory.mediaRequestCount',
    'home.consumable.prepareCount',
    'home.consumable.commitCount',
    'home.consumable.actionStartCount',
    'home.consumable.animationCompleteCount',
    'home.consumable.commitDispatchedCount',
    'home.consumable.terminalCount',
    'home.consumable.appliedCount',
    'home.consumable.replayedCount',
    'home.consumable.definitiveFailureCount',
    'home.consumable.ambiguousCount',
    'home.consumable.cancelledCount',
    'home.consumable.atomicOutcome',
  ]),
  twoClient: Object.freeze([
    'twoClient.resource.commandCount',
    'twoClient.resource.finalValue',
    'twoClient.resource.visibleOnClientA',
    'twoClient.resource.visibleOnClientB',
    'twoClient.consumable.prepareCount',
    'twoClient.consumable.commitCount',
    'twoClient.consumable.visibleOnClientA',
    'twoClient.consumable.visibleOnClientB',
    'twoClient.consumable.atomicOutcome',
  ]),
});

const TASK08_FUTURE_ACCEPTANCE_TARGETS = Object.freeze({
  login: Object.freeze({
    profileDuplicateReads: 0,
    accountCreationPreflightRequests: 0,
    renderIsolation: 'route-local',
  }),
  characterCreation: Object.freeze({
    cachedConfigReadsOnStepRevisit: 0,
    profileSubscriptionCount: 1,
    raceSelectionWritesPerAction: 1,
    transitionDuplicateCount: 0,
    objectUrlLeaks: 0,
  }),
  home: Object.freeze({
    resourceMutationsPerHold: 1,
    compactSubscriptionTargetCount: 6,
    unrelatedSectionRerenders: 0,
    inventoryFilteringMode: 'bounded-or-deferred',
    consumableMutationPair: 'prepare-commit-atomic',
  }),
  twoClient: Object.freeze({
    resourceLostUpdates: 0,
    consumablePartialOutcomes: 0,
    visibility: 'both-clients-converge',
  }),
});

// Step 1 keeps gameplay behavior explicit while later optimization work is
// allowed to change transport/render shape. The source markers are checked by
// a Node contract test; behavior-level suites remain the authority for each
// gameplay rule.
const TASK08_REGRESSION_CONTRACTS = Object.freeze({
  formulasAndCaps: Object.freeze({
    source: 'src/components/common/computeFormula.js',
    tests: ['src/performance/task08-regression.test.js'],
    markers: ['MAX', 'MIN'],
  }),
  raceResetRules: Object.freeze({
    source: 'functions/src/userDataCommands.ts',
    tests: ['performance/tests/task05-callables.test.js'],
    markers: ['action === "selectRace"', 'basePointsAvailable', 'negativeBaseStatCount'],
  }),
  negativeStatPointPolicy: Object.freeze({
    source: 'functions/src/spendCharacterPoint.ts',
    tests: ['performance/tests/task05-callables.test.js'],
    markers: ['newBase < MIN_BASE_VALUE', 'MAX_NEGATIVE_BASE_STATS', 'Combat stats cannot be negative'],
  }),
  inventoryHistory: Object.freeze({
    source: 'scripts/task05/user-data-model.js',
    tests: ['scripts/performance/task08-regression-contracts.test.js'],
    markers: ['acquisitionSnapshot', 'currentSnapshot', 'currentRevision'],
  }),
  diceSemantics: Object.freeze({
    source: 'src/components/home/elements/useConsumable.js',
    tests: ['src/components/home/elements/useConsumable.test.js', 'src/performance/task08-regression.test.js'],
    markers: ['prepareConsumable', 'commitConsumable', 'finalRolls'],
  }),
  multiClientVisibility: Object.freeze({
    source: 'performance/tests/browser/task08-baseline.performance.js',
    tests: ['performance/tests/browser/task08-baseline.performance.js'],
    markers: ['clientA', 'clientB', 'two-client-ui-hold-1'],
  }),
  directNavigation: Object.freeze({
    source: 'src/App.js',
    tests: ['src/components/Login.test.js'],
    markers: ['path="/home"', 'path="/character-creation"', 'Navigate'],
  }),
  errorRetry: Object.freeze({
    source: 'src/data/userData/userDataCommands.js',
    tests: ['src/data/userData/userDataCommands.test.js', 'src/components/home/elements/useConsumable.test.js'],
    markers: ['retryKey', 'isDefinitiveUserDataCommandError', 'retainedOperationIds'],
  }),
});

const asEvents = (events) => (Array.isArray(events) ? events : []);
const taskEvents = (events) => asEvents(events).filter((event) => event?.category === 'task08');
const firestoreEvents = (events) => asEvents(events).filter((event) => event?.category === 'firestore');

const count = (events, predicate) => events.reduce(
  (total, event) => total + (predicate(event) ? 1 : 0),
  0
);

const numericTag = (event, key) => {
  const value = Number(event?.tags?.[key]);
  return Number.isFinite(value) ? value : null;
};

const latest = (events, predicate) => [...events].reverse().find(predicate) || null;

const transitionKey = (event, transition) => {
  if (event?.tags?.transition !== transition) return null;
  const fromStep = event.tags?.fromStep;
  const toStep = event.tags?.toStep;
  if (fromStep !== undefined || toStep !== undefined) {
    return `${transition}:${String(fromStep ?? 'unknown')}>${String(toStep ?? 'unknown')}`;
  }
  return `${transition}:${String(event.tags?.step ?? 'unknown')}`;
};

const countCommandStarts = (events, command) => count(
  taskEvents(events),
  (event) => event.metric === 'command-start' && event.tags?.command === command
);

const countTargetEvents = (events, metric, target) => count(
  firestoreEvents(events),
  (event) => event.metric === metric && event.tags?.target === target
);

const sumResourceMutationDelta = (events) => taskEvents(events)
  .filter((event) => (
    event.metric === 'command-start'
    && event.tags?.command === 'task05UpdateResource'
    && event.tags?.mode === 'delta'
  ))
  .reduce((total, event) => total + (numericTag(event, 'value') || 0), 0);

const task08HoldEventMatches = (event, holdId) => (
  event?.category === 'task08'
  && event.tags?.holdId != null
  && String(event.tags.holdId) === String(holdId)
  && event.tags?.command === 'task05UpdateResource'
);

const task08TerminalMatches = (event, holdId) => (
  event?.category === 'task08'
  && event.metric === 'resource-gesture-terminal'
  && event.tags?.holdId != null
  && String(event.tags.holdId) === String(holdId)
);

const task08InvocationSequence = (event) => (
  event?.tags?.invocationSequence == null
    ? null
    : String(event.tags.invocationSequence)
);

const task08HoldCommandStarts = ({
  events,
  holdId,
  startEventIndex = 0,
  endEventIndex = events.length,
}) => {
  const firstIndex = Math.max(0, Number(startEventIndex) || 0);
  const lastIndex = Math.max(firstIndex, Number(endEventIndex) || events.length);
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event, index }) => (
      index >= firstIndex
      && index < lastIndex
      && task08HoldEventMatches(event, holdId)
      && event.metric === 'command-start'
    ))
    .map(({ event }) => ({
      event,
      sequence: task08InvocationSequence(event),
      requestedDelta: event.tags?.mode === 'delta' ? numericTag(event, 'value') : null,
    }));
};

const summarizeTask08ResourceHold = ({
  events = [],
  holdId,
  startEventIndex = 0,
  endEventIndex = events.length,
} = {}) => {
  const allEvents = asEvents(events);
  const starts = task08HoldCommandStarts({
    events: allEvents,
    holdId,
    startEventIndex,
    endEventIndex,
  });
  const terminals = allEvents
    .map((event, index) => ({event, index}))
    .filter(({event, index}) => (
      index >= Math.max(0, Number(startEventIndex) || 0)
      && index < Math.max(0, Number(endEventIndex) || allEvents.length)
      && task08TerminalMatches(event, holdId)
    ))
    .map(({event}) => event);
  if (terminals.length !== 1) {
    throw new Error(`Task 08 resource hold must have exactly one terminal event; found ${terminals.length}.`);
  }
  if (starts.length !== 1) {
    throw new Error(`Task 08 resource hold must have exactly one physical command; found ${starts.length}.`);
  }
  const terminal = terminals[0];
  const effectiveDelta = numericTag(terminal, 'effectiveDelta');
  if (effectiveDelta === null || terminal.tags?.resource !== starts[0]?.event?.tags?.resource
    || effectiveDelta !== starts[0]?.requestedDelta
    || String(terminal.tags?.localSequence ?? '') !== String(starts[0]?.event?.tags?.localSequence ?? '')) {
    throw new Error('Task 08 resource hold terminal does not match its physical command.');
  }
  const missingSequences = starts
    .filter(({ sequence }) => sequence == null)
    .map(() => 'unknown');
  if (missingSequences.length) {
    throw new Error('Task 08 resource hold command starts must include a test-only invocation sequence.');
  }
  const sequences = starts.map(({ sequence }) => sequence);
  if (new Set(sequences).size !== sequences.length) {
    throw new Error('Task 08 resource hold command starts must have unique invocation sequences.');
  }

  const relatedEvents = allEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event, index }) => (
      index >= Math.max(0, Number(startEventIndex) || 0)
      && task08HoldEventMatches(event, holdId)
      && task08InvocationSequence(event) != null
    ));
  const terminalBySequence = new Map();
  const appliedBySequence = new Map();
  relatedEvents.forEach(({ event }) => {
    const sequence = task08InvocationSequence(event);
    if (!sequences.includes(sequence)) return;
    if (event.metric === 'command-success' || event.metric === 'command-failure') {
      const terminal = terminalBySequence.get(sequence) || [];
      terminal.push(event);
      terminalBySequence.set(sequence, terminal);
    }
    if (event.metric === 'command-applied') {
      const applied = appliedBySequence.get(sequence) || [];
      applied.push(event);
      appliedBySequence.set(sequence, applied);
    }
  });

  const duplicateTerminals = sequences.filter((sequence) => (
    (terminalBySequence.get(sequence) || []).length > 1
  ));
  if (duplicateTerminals.length) {
    throw new Error(
      `Task 08 resource hold invocation ${duplicateTerminals.join(', ')} has multiple terminal events.`
    );
  }
  const pendingSequences = sequences.filter((sequence) => (
    (terminalBySequence.get(sequence) || []).length === 0
  ));
  const failureSequences = sequences.filter((sequence) => (
    (terminalBySequence.get(sequence) || [])[0]?.metric === 'command-failure'
  ));
  const duplicateApplications = sequences.filter((sequence) => (
    (appliedBySequence.get(sequence) || []).length > 1
  ));
  if (duplicateApplications.length) {
    throw new Error(`Task 08 resource hold invocation ${duplicateApplications.join(', ')} has multiple application events.`);
  }
  const appliedSequences = sequences.filter((sequence) => (
    (appliedBySequence.get(sequence) || []).length === 1
  ));
  const requestedDelta = starts.reduce(
    (total, { requestedDelta }) => total + (requestedDelta || 0),
    0
  );
  const appliedDelta = appliedSequences.reduce((total, sequence) => {
    const applied = appliedBySequence.get(sequence)?.[0];
    const value = numericTag(applied, 'appliedDelta');
    if (value === null) {
      throw new Error(`Task 08 resource hold invocation ${sequence} lacks callable appliedDelta evidence.`);
    }
    return total + value;
  }, 0);

  return {
    holdId,
    terminalCount: terminals.length,
    effectiveDelta,
    starts,
    commandCount: starts.length,
    startSequences: sequences,
    pendingSequences,
    failureSequences,
    appliedSequences,
    appliedCount: appliedSequences.length,
    requestedDelta,
    appliedDelta,
    complete: starts.length > 0 && pendingSequences.length === 0,
  };
};

const settleTask08ResourceHold = async ({
  readSnapshot,
  readAuthoritativeValue,
  holdId,
  startEventIndex = 0,
  endEventIndex,
  expectedBaseValue,
  stablePolls = 2,
  maxPolls = 100,
  requireAppliedForEveryStart = false,
  waitForNextPoll = async () => {},
} = {}) => {
  if (typeof readSnapshot !== 'function' || typeof readAuthoritativeValue !== 'function') {
    throw new TypeError('Task 08 resource hold settlement requires snapshot and state readers.');
  }
  if (!holdId) throw new TypeError('Task 08 resource hold settlement requires a hold ID.');
  if (!Number.isInteger(stablePolls) || stablePolls < 2) {
    throw new TypeError('Task 08 resource hold settlement requires at least two stable polls.');
  }
  if (!Number.isInteger(maxPolls) || maxPolls < stablePolls) {
    throw new TypeError('Task 08 resource hold settlement maxPolls is too small.');
  }
  const baseValue = Number(expectedBaseValue);
  if (!Number.isFinite(baseValue)) {
    throw new TypeError('Task 08 resource hold settlement requires a finite base value.');
  }

  let previousStartSignature = null;
  let stableStartPollCount = 0;
  let settled = null;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    const snapshot = await readSnapshot({ attempt, phase: 'commands' });
    const summary = summarizeTask08ResourceHold({
      events: snapshot?.events,
      holdId,
      startEventIndex,
      endEventIndex,
    });
    const startSignature = summary.startSequences.join(',');
    if (summary.commandCount > 0 && startSignature === previousStartSignature) {
      stableStartPollCount += 1;
    } else {
      stableStartPollCount = summary.commandCount > 0 ? 1 : 0;
    }
    previousStartSignature = startSignature;

    if (
      stableStartPollCount >= stablePolls
      && summary.complete
    ) {
      if (summary.failureSequences.length) {
        throw new Error(
          `Task 08 resource hold command failure(s): ${summary.failureSequences.join(', ')}.`
        );
      }
      if (requireAppliedForEveryStart && summary.appliedCount !== summary.commandCount) {
        throw new Error(
          'Task 08 resource hold has successful commands without a physical command-applied event.'
        );
      }
      settled = summary;
      break;
    }
    if (attempt < maxPolls) await waitForNextPoll({ attempt, phase: 'commands' });
  }
  if (!settled) {
    throw new Error('Task 08 resource hold did not receive exactly one terminal event for every command start.');
  }

  const expectedAuthoritativeValue = baseValue + settled.appliedDelta;
  let previousValue = null;
  let stableValuePollCount = 0;
  const valueSamples = [];
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    const candidate = Number(await readAuthoritativeValue({
      attempt,
      phase: 'authoritative-state',
      expectedValue: expectedAuthoritativeValue,
    }));
    valueSamples.push(candidate);
    if (candidate === expectedAuthoritativeValue) {
      stableValuePollCount = previousValue === candidate
        ? stableValuePollCount + 1
        : 1;
    } else {
      stableValuePollCount = 0;
    }
    previousValue = candidate;
    if (stableValuePollCount >= stablePolls) {
      return {
        ...settled,
        expectedBaseValue: baseValue,
        expectedAuthoritativeValue,
        authoritativeValue: candidate,
        authoritativeValueSamples: valueSamples.slice(-stablePolls),
      };
    }
    if (attempt < maxPolls) await waitForNextPoll({ attempt, phase: 'authoritative-state' });
  }
  throw new Error(
    `Task 08 resource hold authoritative state did not converge to ${expectedAuthoritativeValue}; `
    + `samples=${valueSamples.join(',')}.`
  );
};

const duplicateTransitionCount = (events, transition) => {
  let activeTransitionKey = null;
  let duplicates = 0;
  for (const event of taskEvents(events)) {
    if (event.metric === 'step-revisit-window-start' && transition === 'character-step') {
      // The explicit revisit window is a transition boundary. It prevents an
      // intentional back/forward journey from being conflated with two starts
      // of the same still-active forward transition.
      activeTransitionKey = null;
      continue;
    }
    if (event.metric === 'transition-end') {
      const endedKey = transitionKey(event, transition);
      if (endedKey && endedKey === activeTransitionKey) activeTransitionKey = null;
      continue;
    }
    if (event.metric !== 'transition-start') continue;
    const startedKey = transitionKey(event, transition);
    if (!startedKey || event.tags?.kind === 'revisit') continue;
    if (startedKey === activeTransitionKey) duplicates += 1;
    activeTransitionKey = startedKey;
  }
  return duplicates;
};

const isRevisitRead = (event) => (
  event?.category === 'firestore'
  && event.metric === 'one-shot-documents-delivered'
  && /^(?:config\.|codex\.)/.test(String(event.tags?.target || ''))
);

const stepRevisitReadCount = (events) => {
  const allEvents = asEvents(events);
  let reads = 0;
  allEvents.forEach((event, startIndex) => {
    if (event?.category !== 'task08' || event.metric !== 'step-revisit-window-start') return;
    const fromStep = String(event.tags?.fromStep ?? 'unknown');
    const toStep = String(event.tags?.toStep ?? 'unknown');
    const endIndex = allEvents.findIndex((candidate, candidateIndex) => (
      candidateIndex > startIndex
      && candidate?.category === 'task08'
      && candidate.metric === 'step-revisit-window-end'
      && String(candidate.tags?.fromStep ?? 'unknown') === fromStep
      && String(candidate.tags?.toStep ?? 'unknown') === toStep
    ));
    if (endIndex < 0) return;
    reads += allEvents.slice(startIndex + 1, endIndex).filter(isRevisitRead).length;
  });
  return reads;
};

const loginNavigationLatencies = (events) => {
  const allEvents = asEvents(events);
  return allEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => (
      event?.category === 'task08'
      && event.metric === 'transition-start'
      && ['login-navigation', 'login-auth-gate'].includes(event.tags?.transition)
    ))
    .map(({ event: start, index }) => {
      const startTime = Number(start.timestamp);
      if (!Number.isFinite(startTime)) return null;
      const destination = allEvents.slice(index + 1).find((candidate) => (
        candidate?.category === 'route'
        && candidate.metric === 'interactive'
        && Number.isFinite(Number(candidate.timestamp))
      ));
      if (!destination) return null;
      return Math.max(0, Number(destination.timestamp) - startTime);
    })
    .filter(Number.isFinite);
};

const renderCount = (events, component) => count(
  taskEvents(events),
  (event) => (
    event.metric === 'render'
    && event.tags?.component === component
    && event.tags?.committed === true
    && event.tags?.authoritative === true
  )
);

const deriveTask08Metrics = ({
  scenarioId,
  events = [],
  observations = {},
} = {}) => {
  const task = taskEvents(events);
  const firestore = firestoreEvents(events);
  const metrics = {};
  const set = (key, value) => {
    metrics[key] = value;
  };

  if (scenarioId === 'task08-login') {
    set('login.auth.signInRequestCount', count(task, (event) => (
      event.metric === 'auth-request-start' && event.tags?.operation === 'sign-in'
    )));
    set('login.auth.accountCreationPreflightCount', count(task, (event) => (
      event.metric === 'auth-request-start' && event.tags?.operation === 'create-account-preflight'
    )));
    set('login.auth.accountCreationRequestCount', count(task, (event) => (
      event.metric === 'auth-request-start' && event.tags?.operation === 'create-account'
    )));
    set('login.firestore.profileReads', countTargetEvents(
      events,
      'initial-documents-delivered',
      'users.shell.subscribe.v2'
    ) + countTargetEvents(events, 'one-shot-documents-delivered', 'users.shell.get.v2'));
    set('login.firestore.configReads', count(
      firestore,
      (event) => event.metric === 'one-shot-documents-delivered'
        && String(event.tags?.target || '').startsWith('config.')
    ));
    const navigationLatencies = loginNavigationLatencies(events);
    set('login.navigationLatencyMs', navigationLatencies.length
      ? Math.max(...navigationLatencies)
      : null);
    set('login.renderCount', renderCount(events, 'Login'));
    set('login.renderIsolation.decorativeBackgroundCount', renderCount(events, 'LoginDecorativeBackground'));
    set('login.renderIsolation.decorativeOrbsCount', renderCount(events, 'LoginDecorativeOrbs'));
    set('login.renderIsolation.cardBorderCount', renderCount(events, 'LoginCardBorder'));
    set('login.renderIsolation.headerCount', renderCount(events, 'LoginHeader'));
    set('login.renderIsolation.submitButtonCount', renderCount(events, 'LoginSubmitButton'));
    set('login.renderIsolation.createButtonCount', renderCount(events, 'LoginCreateButton'));
  }

  if (scenarioId === 'task08-character-creation') {
    set('characterCreation.firestore.codexReads', countTargetEvents(
      events,
      'one-shot-documents-delivered',
      'codex.document.get.v1'
    ));
    set('characterCreation.firestore.configSchemaReads', count(
      firestore,
      (event) => event.metric === 'one-shot-documents-delivered'
        && String(event.tags?.target || '').startsWith('config.schema')
    ));
    set('characterCreation.firestore.configVarieReads', countTargetEvents(
      events,
      'one-shot-documents-delivered',
      'config.varie.get.v1'
    ));
    set('characterCreation.navigation.stepRevisitCount', count(task, (event) => (
      event.metric === 'step-revisit'
    )));
    set('characterCreation.firestore.stepRevisitReads', stepRevisitReadCount(events));
    set('characterCreation.firestore.profileSubscriptionCount', countTargetEvents(
      events,
      'listener-open',
      'users.shell.subscribe.v2'
    ));
    set('characterCreation.command.authoritativeActionCount', countCommandStarts(
      events,
      'task05CharacterCreation'
    ));
    set('characterCreation.command.writeCount', count(
      task,
      (event) => event.metric === 'command-applied'
        && event.tags?.command === 'task05CharacterCreation'
    ));
    set('characterCreation.command.nonReplayedSuccessCount', count(
      task,
      (event) => event.metric === 'command-non-replayed-success'
        && event.tags?.command === 'task05CharacterCreation'
    ));
    set('characterCreation.transition.duplicateCount', duplicateTransitionCount(
      events,
      'character-step'
    ));
    set('characterCreation.media.objectUrlCreateCount', count(task, (event) => (
      event.metric === 'media-object-url-create'
    )));
    set('characterCreation.media.objectUrlRevokeCount', count(task, (event) => (
      event.metric === 'media-object-url-revoke'
    )));
    set('characterCreation.media.cleanupCount', count(task, (event) => event.metric === 'cleanup'));
  }

  if (scenarioId === 'task08-home' || scenarioId === 'task08-two-client') {
    const compactTargets = new Set(
      firestore
        .filter((event) => event.metric === 'listener-open')
        .map((event) => event.tags?.target)
        .filter((target) => TASK08_COMPACT_USER_DATA_TARGETS.includes(target))
    );
    set('home.firestore.compactSubscriptionTargetCount', compactTargets.size);
    set('home.firestore.compactSubscriptionOpenCount', count(
      firestore,
      (event) => event.metric === 'listener-open'
        && TASK08_COMPACT_USER_DATA_TARGETS.includes(event.tags?.target)
    ));
    ['Navbar', 'StatsBars', 'Inventory', 'EquippedInventory', 'Extra', 'ParamTables']
      .forEach((component) => set(`home.render.${component}`, renderCount(events, component)));
    const resourceRenderCounts = observations.resourceRenderCounts || {};
    ['Navbar', 'StatsBars', 'Inventory', 'EquippedInventory', 'Extra', 'ParamTables']
      .forEach((component) => set(
        `home.renderIsolation.resourceUpdate.${component}`,
        Number(resourceRenderCounts[component] || 0)
      ));
    const resourceStarts = countCommandStarts(events, 'task05UpdateResource');
    set('home.command.resourceMutationCount', resourceStarts);
    set('home.command.resourceAppliedCount', count(
      task,
      (event) => event.metric === 'command-applied'
        && event.tags?.command === 'task05UpdateResource'
    ));
    set('home.command.resourceNonReplayedSuccessCount', count(
      task,
      (event) => event.metric === 'command-non-replayed-success'
        && event.tags?.command === 'task05UpdateResource'
    ));
    const requestedMutationDelta = sumResourceMutationDelta(events);
    set('home.command.requestedMutationDelta', requestedMutationDelta);
    set('home.command.resourceMutationDelta', observations.resourceResultingDelta ?? requestedMutationDelta);
    const filterEvents = task.filter((event) => event.metric === 'inventory-filter-result');
    // The measured query is committed before the consumable mutation. A later
    // committed result for the same query may legitimately be empty because
    // that mutation removed the matching item; using the last event would
    // report the post-mutation state as the 500-item filter baseline.
    const populatedQueryFilterEvent = filterEvents.find((event) => (
      (numericTag(event, 'queryLength') || 0) > 0
      && (numericTag(event, 'inputCount') || 0) > 0
    ));
    const filterEvent = populatedQueryFilterEvent || filterEvents[filterEvents.length - 1] || null;
    const initialFilterEvent = filterEvents[0] || null;
    const populatedInitialFilterEvent = filterEvents.find((event) => (
      numericTag(event, 'queryLength') === 0 && (numericTag(event, 'inputCount') || 0) > 0
    ));
    set('home.inventory.initialItemCount', populatedInitialFilterEvent
      ? (numericTag(populatedInitialFilterEvent, 'inputCount') ?? 0)
      : initialFilterEvent
        ? (numericTag(initialFilterEvent, 'inputCount') ?? numericTag(initialFilterEvent, 'filteredCount') ?? (Number(initialFilterEvent.value) || 0))
        : Number(observations.inventoryInitialItemCount || 0));
    set('home.inventory.filterResultItemCount', filterEvent
      ? (numericTag(filterEvent, 'filteredCount') ?? (Number(filterEvent.value) || 0))
      : Number(observations.inventoryFilteredItemCount || 0));
    set('home.inventory.filteredItemCount', filterEvent
      ? (numericTag(filterEvent, 'filteredCount') ?? (Number(filterEvent.value) || 0))
      : Number(observations.inventoryFilteredItemCount || 0));
    set('home.inventory.initialMountedItemCount', Number(
      observations.inventoryInitialMountedItemCount || 0
    ));
    set('home.inventory.resetMountedItemCount', Number(
      observations.inventoryResetMountedItemCount || 0
    ));
    set('home.inventory.expandedMountedItemCount', Number(
      observations.inventoryExpandedMountedItemCount || 0
    ));
    set('home.inventory.initialWindowLimit', Number(
      observations.inventoryInitialWindowLimit || 0
    ));
    const inventoryMediaObservation = Object.prototype.hasOwnProperty.call(
      observations,
      'inventoryMediaRequestCount'
    ) ? observations.inventoryMediaRequestCount : null;
    const numericInventoryMediaObservation = inventoryMediaObservation == null
      ? null
      : Number(inventoryMediaObservation);
    set('home.inventory.mediaRequestCount', Number.isFinite(numericInventoryMediaObservation)
      ? numericInventoryMediaObservation
      : null);
    set('home.consumable.prepareCount', countCommandStarts(events, 'task05PrepareConsumable'));
    set('home.consumable.commitCount', countCommandStarts(events, 'task05CommitConsumable'));
    const consumableTerminals = task.filter((event) => event.metric === 'consumable-action-terminal');
    set('home.consumable.actionStartCount', count(task, (event) => (
      event.metric === 'consumable-action-start'
    )));
    set('home.consumable.animationCompleteCount', count(task, (event) => (
      event.metric === 'consumable-animation-complete'
    )));
    set('home.consumable.commitDispatchedCount', count(task, (event) => (
      event.metric === 'consumable-commit-dispatched'
    )));
    set('home.consumable.terminalCount', consumableTerminals.length);
    ['applied', 'replayed', 'definitive-failure', 'ambiguous'].forEach((outcome) => set(
      `home.consumable.${outcome === 'definitive-failure' ? 'definitiveFailure' : outcome}Count`,
      consumableTerminals.filter((event) => event.tags?.outcome === outcome).length
    ));
    set('home.consumable.cancelledCount', count(task, (event) => (
      event.metric === 'consumable-action-cancelled'
    )));
    set('home.consumable.atomicOutcome', observations.consumableAtomicOutcome ?? 'not-observed');
  }

  if (scenarioId === 'task08-two-client') {
    set('twoClient.resource.commandCount', Number(
      observations.resourceCommandCount ?? countCommandStarts(events, 'task05UpdateResource')
    ));
    set('twoClient.resource.finalValue', observations.resourceFinalValue ?? null);
    set('twoClient.resource.visibleOnClientA', observations.resourceVisibleOnClientA ?? false);
    set('twoClient.resource.visibleOnClientB', observations.resourceVisibleOnClientB ?? false);
    set('twoClient.consumable.prepareCount', Number(
      observations.consumablePrepareCount ?? countCommandStarts(events, 'task05PrepareConsumable')
    ));
    set('twoClient.consumable.commitCount', Number(
      observations.consumableCommitCount ?? countCommandStarts(events, 'task05CommitConsumable')
    ));
    set('twoClient.consumable.visibleOnClientA', observations.consumableVisibleOnClientA ?? false);
    set('twoClient.consumable.visibleOnClientB', observations.consumableVisibleOnClientB ?? false);
    set('twoClient.consumable.atomicOutcome', observations.consumableAtomicOutcome ?? 'not-observed');
  }

  return metrics;
};

module.exports = {
  TASK08_BASELINE_METRICS,
  TASK08_COMPACT_USER_DATA_TARGETS,
  TASK08_FUTURE_ACCEPTANCE_TARGETS,
  TASK08_MEASUREMENT_CONTRACT_VERSION,
  TASK08_REGRESSION_CONTRACTS,
  TASK08_SCENARIO_IDS,
  deriveTask08Metrics,
  settleTask08ResourceHold,
  summarizeTask08ResourceHold,
};
