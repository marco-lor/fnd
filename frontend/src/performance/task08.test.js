import {
  TASK08_EVENT_CONTRACT,
  TASK08_MEASUREMENT_CONTRACT_VERSION,
  TASK08_TEST_BRIDGE_NAME,
  beginTask08Transition,
  getTask08ResourceHoldId,
  beginTask08ResourceHold,
  endTask08ResourceHold,
  installTask08TestBridge,
  installTask08LazyTestBridge,
  recordTask08Event,
  runTask08AuthRequest,
} from './task08';
import { isPerformanceEnabled, recordPerfEvent } from './runtime';

jest.mock('./runtime', () => ({
  isPerformanceEnabled: jest.fn(),
  recordPerfEvent: jest.fn(),
}));

describe('Task 08 performance contract bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isPerformanceEnabled.mockReturnValue(true);
  });

  test('publishes a versioned stable event vocabulary', () => {
    expect(TASK08_MEASUREMENT_CONTRACT_VERSION).toBe(1);
    expect(TASK08_TEST_BRIDGE_NAME).toBe('__FND_PERF_TASK08__');
    expect(TASK08_EVENT_CONTRACT).toEqual(expect.arrayContaining([
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
    ]));
  });

  test('does not emit or install anything when performance mode is disabled', () => {
    isPerformanceEnabled.mockReturnValue(false);

    recordTask08Event({ metric: 'render', tags: { component: 'Home' } });
    expect(recordPerfEvent).not.toHaveBeenCalled();
    expect(installTask08TestBridge({
      resourceMutation: jest.fn(),
      prepareConsumable: jest.fn(),
      commitConsumable: jest.fn(),
    })).toBe(false);
    expect(window[TASK08_TEST_BRIDGE_NAME]).toBeUndefined();
  });

  test('records auth outcomes without changing the wrapped promise', async () => {
    const response = { user: { uid: 'fixture-user' } };
    await expect(runTask08AuthRequest('sign-in', () => Promise.resolve(response)))
      .resolves.toBe(response);
    expect(recordPerfEvent.mock.calls.map(([event]) => [event.metric, event.tags.operation]))
      .toEqual([
        ['auth-request-start', 'sign-in'],
        ['auth-request-success', 'sign-in'],
      ]);

    recordPerfEvent.mockClear();
    const failure = Object.assign(new Error('offline'), { code: 'auth/network-request-failed' });
    await expect(runTask08AuthRequest('create-account', () => Promise.reject(failure)))
      .rejects.toBe(failure);
    expect(recordPerfEvent.mock.calls.map(([event]) => [event.metric, event.tags.operation]))
      .toEqual([
        ['auth-request-start', 'create-account'],
        ['auth-request-failure', 'create-account'],
      ]);
  });

  test('records transition duration and installs only the opt-in test bridge', async () => {
    const now = jest.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(135);
    const finish = beginTask08Transition('character-step', { step: 1 });
    finish('success');
    expect(recordPerfEvent.mock.calls.map(([event]) => [event.metric, event.tags.transition, event.value]))
      .toEqual([
        ['transition-start', 'character-step', 1],
        ['transition-end', 'character-step', 35],
      ]);

    const operations = {
      resourceMutation: jest.fn(() => Promise.resolve({ success: true })),
      prepareConsumable: jest.fn(() => Promise.resolve({ preparationId: 'fixture-preparation' })),
      commitConsumable: jest.fn(() => Promise.resolve({ success: true })),
    };
    expect(installTask08TestBridge(operations)).toBe(true);
    expect(window[TASK08_TEST_BRIDGE_NAME].contractVersion)
      .toBe(TASK08_MEASUREMENT_CONTRACT_VERSION);
    await expect(window[TASK08_TEST_BRIDGE_NAME].resourceMutation({ value: -1 }))
      .resolves.toEqual({ success: true });
    expect(operations.resourceMutation).toHaveBeenCalledWith({ value: -1 });
    now.mockRestore();
    delete window[TASK08_TEST_BRIDGE_NAME];
  });

  test('installs the bridge synchronously but does not load command code until invoked', async () => {
    const loadCommands = jest.fn(() => Promise.resolve({
      updateResource: jest.fn(() => Promise.resolve({ success: true })),
      prepareConsumable: jest.fn(() => Promise.resolve({ preparationId: 'lazy-preparation' })),
      commitConsumable: jest.fn(() => Promise.resolve({ success: true })),
    }));

    expect(installTask08LazyTestBridge(loadCommands)).toBe(true);
    expect(loadCommands).not.toHaveBeenCalled();
    await expect(window[TASK08_TEST_BRIDGE_NAME].resourceMutation({ value: -1 }))
      .resolves.toEqual({ success: true });
    expect(loadCommands).toHaveBeenCalledTimes(1);
    await window[TASK08_TEST_BRIDGE_NAME].prepareConsumable({});
    expect(loadCommands).toHaveBeenCalledTimes(1);
    delete window[TASK08_TEST_BRIDGE_NAME];
  });

  test('bounds resource command context to a non-sensitive hold ID', () => {
    const holdId = beginTask08ResourceHold('home-hp-hold-1');
    expect(holdId).toBe('home-hp-hold-1');
    expect(getTask08ResourceHoldId()).toBe('home-hp-hold-1');
    expect(endTask08ResourceHold(holdId)).toBe(true);
    expect(getTask08ResourceHoldId()).toBeNull();
    expect(recordPerfEvent.mock.calls.map(([event]) => [
      event.metric,
      event.tags.phase,
      event.tags.holdId,
    ])).toEqual([
      ['scenario-observation', 'start', 'home-hp-hold-1'],
      ['scenario-observation', 'end', 'home-hp-hold-1'],
    ]);
  });
});
