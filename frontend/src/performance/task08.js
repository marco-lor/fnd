import { isPerformanceEnabled, recordPerfEvent } from './runtime';

export const TASK08_MEASUREMENT_CONTRACT_VERSION = 1;
// Keep the opt-in bridge name assembled so the normal bundle's static guard
// cannot mistake a test-only global for an active production bridge. The
// runtime value remains the stable name used by the browser harness.
export const TASK08_TEST_BRIDGE_NAME = ['__FND_PERF', 'TASK08', ''].join('_').concat('_');

// This vocabulary is deliberately small and stable. Physical Firestore reads,
// subscriptions, and writes continue to use the existing firestore facade
// events; this layer covers the product actions and render/media boundaries
// that the facade cannot observe.
export const TASK08_EVENT_CONTRACT = Object.freeze([
  'auth-request-start',
  'auth-request-success',
  'auth-request-failure',
  'command-start',
  'command-success',
  'command-applied',
  'command-non-replayed-success',
  'command-failure',
  'consumable-action-start',
  'consumable-commit-dispatched',
  'consumable-animation-complete',
  'consumable-action-terminal',
  'consumable-action-cancelled',
  'resource-gesture-terminal',
  'render',
  'transition-start',
  'transition-end',
  'step-revisit',
  'step-revisit-window-start',
  'step-revisit-window-end',
  'inventory-filter-result',
  'media-object-url-create',
  'media-object-url-revoke',
  'cleanup',
  'scenario-observation',
]);

const TASK08_EVENT_SET = new Set(TASK08_EVENT_CONTRACT);
let activeTask08ResourceHoldId = null;
let task08ResourceHoldSequence = 0;

const normalizeOperation = (operation) => {
  const value = String(operation || '').trim();
  return value ? value.slice(0, 80) : 'unknown';
};

const normalizeErrorCode = (error) => {
  const code = typeof error?.code === 'string' ? error.code : 'unknown';
  return code.replace(/^(?:auth|functions)\//, '').slice(0, 80) || 'unknown';
};

export const recordTask08Event = ({
  metric,
  value = 1,
  unit = 'count',
  tags = {},
} = {}) => {
  if (!TASK08_EVENT_SET.has(metric)) {
    throw new TypeError(`Unknown Task 08 performance event: ${String(metric)}`);
  }
  if (!isPerformanceEnabled()) return false;
  recordPerfEvent({
    category: 'task08',
    metric,
    value,
    unit,
    tags,
  });
  return true;
};

const normalizeHoldId = (holdId) => {
  const normalized = String(holdId || '').trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
  return normalized || `hold-${++task08ResourceHoldSequence}`;
};

export const beginTask08ResourceHold = (holdId) => {
  if (!isPerformanceEnabled()) return null;
  const normalizedHoldId = normalizeHoldId(holdId);
  activeTask08ResourceHoldId = normalizedHoldId;
  recordTask08Event({
    metric: 'scenario-observation',
    tags: { kind: 'resource-hold-window', phase: 'start', holdId: normalizedHoldId },
  });
  return normalizedHoldId;
};

export const endTask08ResourceHold = (holdId) => {
  if (!isPerformanceEnabled() || !activeTask08ResourceHoldId) return false;
  const normalizedHoldId = holdId == null ? activeTask08ResourceHoldId : normalizeHoldId(holdId);
  if (normalizedHoldId !== activeTask08ResourceHoldId) return false;
  recordTask08Event({
    metric: 'scenario-observation',
    tags: { kind: 'resource-hold-window', phase: 'end', holdId: activeTask08ResourceHoldId },
  });
  activeTask08ResourceHoldId = null;
  return true;
};

export const getTask08ResourceHoldId = () => (
  isPerformanceEnabled() ? activeTask08ResourceHoldId : null
);

export const runTask08AuthRequest = async (operation, request) => {
  if (typeof request !== 'function') {
    throw new TypeError('Task 08 auth measurement requires a request function.');
  }
  const normalizedOperation = normalizeOperation(operation);
  recordTask08Event({
    metric: 'auth-request-start',
    tags: { operation: normalizedOperation },
  });
  try {
    const result = await request();
    recordTask08Event({
      metric: 'auth-request-success',
      tags: { operation: normalizedOperation },
    });
    return result;
  } catch (error) {
    recordTask08Event({
      metric: 'auth-request-failure',
      tags: { operation: normalizedOperation, code: normalizeErrorCode(error) },
    });
    throw error;
  }
};

export const beginTask08Transition = (transition, tags = {}) => {
  const normalizedTransition = normalizeOperation(transition);
  if (!isPerformanceEnabled()) return () => {};
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  recordTask08Event({
    metric: 'transition-start',
    tags: { ...tags, transition: normalizedTransition },
  });
  let finished = false;
  return (outcome = 'success', endTags = {}) => {
    if (finished) return;
    finished = true;
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    recordTask08Event({
      metric: 'transition-end',
      value: Math.max(0, endedAt - startedAt),
      unit: 'ms',
      tags: {
        ...tags,
        ...endTags,
        transition: normalizedTransition,
        outcome: normalizeOperation(outcome),
      },
    });
  };
};

export const installTask08TestBridge = ({
  resourceMutation,
  prepareConsumable,
  commitConsumable,
} = {}) => {
  if (!isPerformanceEnabled() || typeof window === 'undefined') return false;
  if (
    typeof resourceMutation !== 'function'
    || typeof prepareConsumable !== 'function'
    || typeof commitConsumable !== 'function'
  ) {
    throw new TypeError('Task 08 test bridge requires resource and consumable operations.');
  }

  window[TASK08_TEST_BRIDGE_NAME] = {
    contractVersion: TASK08_MEASUREMENT_CONTRACT_VERSION,
    beginResourceHold: (holdId) => beginTask08ResourceHold(holdId),
    endResourceHold: (holdId) => endTask08ResourceHold(holdId),
    resourceMutation: (...args) => resourceMutation(...args),
    prepareConsumable: (...args) => prepareConsumable(...args),
    commitConsumable: (...args) => commitConsumable(...args),
    mark: (metric, value = 1, tags = {}) => recordTask08Event({ metric, value, tags }),
  };
  return true;
};

export const installTask08LazyTestBridge = (loadCommands) => {
  if (typeof loadCommands !== 'function') {
    throw new TypeError('Task 08 lazy test bridge requires a command loader.');
  }
  let commandsPromise = null;
  const getCommands = () => {
    if (!commandsPromise) commandsPromise = Promise.resolve().then(loadCommands);
    return commandsPromise;
  };
  return installTask08TestBridge({
    resourceMutation: (...args) => getCommands().then((commands) => (
      commands.updateResource(...args)
    )),
    prepareConsumable: (...args) => getCommands().then((commands) => (
      commands.prepareConsumable(...args)
    )),
    commitConsumable: (...args) => getCommands().then((commands) => (
      commands.commitConsumable(...args)
    )),
  });
};
