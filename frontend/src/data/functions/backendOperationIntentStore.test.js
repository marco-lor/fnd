import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import {
  BackendOperationIntentError,
  TASK06_OPERATION_INTENT_STORAGE_KEY,
  runWithDurableOperationIntent,
} from './backendOperationIntentStore';

const createMemoryStorage = () => {
  const values = new Map();
  const writes = [];
  return {
    getItem: jest.fn((key) => values.get(key) ?? null),
    setItem: jest.fn((key, value) => {
      writes.push({key, value});
      values.set(key, value);
    }),
    values,
    writes,
  };
};

const originalTextEncoder = global.TextEncoder;

beforeAll(() => {
  global.TextEncoder = TextEncoder;
});

afterAll(() => {
  global.TextEncoder = originalTextEncoder;
});

const storedEntries = (storage) => JSON.parse(
  storage.values.get(TASK06_OPERATION_INTENT_STORAGE_KEY)
).entries;

const runIntent = (overrides = {}) => runWithDurableOperationIntent({
  actorUid: 'actor-private-uid',
  kind: 'delete-npc',
  intent: {npcId: 'private-npc-id'},
  invoke: jest.fn().mockResolvedValue({status: 'completed'}),
  storage: createMemoryStorage(),
  cryptoImpl: webcrypto,
  now: () => 1_750_000_000_000,
  createOperationId: () => 'delete-npc-operation-0001',
  ...overrides,
});

describe('durable Task 06 operation intents', () => {
  test('persists the opaque operation ID before invoking and clears on success', async () => {
    const storage = createMemoryStorage();
    const invoke = jest.fn(async (operationId) => {
      expect(operationId).toBe('delete-npc-operation-0001');
      expect(storedEntries(storage)).toHaveLength(1);
      return {status: 'completed'};
    });

    await runIntent({storage, invoke});

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(storedEntries(storage)).toEqual([]);
  });

  test('retains an uncertain failure and reuses its ID after a remount-like retry', async () => {
    const storage = createMemoryStorage();
    const firstInvoke = jest.fn().mockRejectedValue(new Error('unavailable'));

    await expect(runIntent({storage, invoke: firstInvoke}))
      .rejects.toThrow('unavailable');
    expect(storedEntries(storage)[0].operationId)
      .toBe('delete-npc-operation-0001');

    const secondCreate = jest.fn(() => 'delete-npc-operation-0002');
    const secondInvoke = jest.fn().mockResolvedValue({replayed: true});
    await runIntent({
      storage,
      invoke: secondInvoke,
      createOperationId: secondCreate,
    });

    expect(secondCreate).not.toHaveBeenCalled();
    expect(secondInvoke).toHaveBeenCalledWith('delete-npc-operation-0001');
    expect(storedEntries(storage)).toEqual([]);
  });

  test('separates changed requests and actors without serializing either identity', async () => {
    const storage = createMemoryStorage();
    let sequence = 0;
    const createOperationId = () => (
      `operation-private-${String(++sequence).padStart(4, '0')}`
    );
    const reject = jest.fn().mockRejectedValue(new Error('offline'));

    await expect(runIntent({storage, invoke: reject, createOperationId}))
      .rejects.toThrow('offline');
    await expect(runIntent({
      storage,
      intent: {npcId: 'different-private-npc'},
      invoke: reject,
      createOperationId,
    })).rejects.toThrow('offline');
    await expect(runIntent({
      storage,
      actorUid: 'different-private-actor',
      invoke: reject,
      createOperationId,
    })).rejects.toThrow('offline');

    expect(storedEntries(storage).map(({operationId}) => operationId))
      .toEqual([
        'operation-private-0001',
        'operation-private-0002',
        'operation-private-0003',
      ]);
    const serialized = storage.values.get(
      TASK06_OPERATION_INTENT_STORAGE_KEY
    );
    [
      'actor-private-uid',
      'different-private-actor',
      'private-npc-id',
      'different-private-npc',
    ].forEach((privateValue) => {
      expect(serialized).not.toContain(privateValue);
    });
  });

  test('a later intentional identical action receives a fresh ID after success', async () => {
    const storage = createMemoryStorage();
    const ids = ['delete-npc-operation-0001', 'delete-npc-operation-0002'];
    const createOperationId = jest.fn(() => ids.shift());
    const firstInvoke = jest.fn().mockResolvedValue({status: 'completed'});
    const secondInvoke = jest.fn().mockResolvedValue({status: 'completed'});

    await runIntent({storage, invoke: firstInvoke, createOperationId});
    await runIntent({storage, invoke: secondInvoke, createOperationId});

    expect(firstInvoke).toHaveBeenCalledWith('delete-npc-operation-0001');
    expect(secondInvoke).toHaveBeenCalledWith('delete-npc-operation-0002');
  });

  test.each([
    'timeout',
    'abort',
    'unavailable',
    'paused',
    'cleanup-pending',
  ])('retains the receipt after %s', async (message) => {
    const storage = createMemoryStorage();
    await expect(runIntent({
      storage,
      invoke: jest.fn().mockRejectedValue(new Error(message)),
    })).rejects.toThrow(message);
    expect(storedEntries(storage)[0].operationId)
      .toBe('delete-npc-operation-0001');
  });

  test('deduplicates concurrent clicks for the same intent', async () => {
    const storage = createMemoryStorage();
    let resolveInvocation;
    const invocation = new Promise((resolve) => {
      resolveInvocation = resolve;
    });
    const invoke = jest.fn(() => invocation);

    const first = runIntent({storage, invoke});
    const second = runIntent({storage, invoke});
    await Promise.resolve();
    await Promise.resolve();
    resolveInvocation({status: 'completed'});

    await expect(Promise.all([first, second])).resolves.toEqual([
      {status: 'completed'},
      {status: 'completed'},
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('malformed or oversized state fails closed before invocation', async () => {
    for (const serialized of [
      '{invalid',
      'x'.repeat(64 * 1024 + 1),
    ]) {
      const storage = createMemoryStorage();
      storage.values.set(TASK06_OPERATION_INTENT_STORAGE_KEY, serialized);
      const invoke = jest.fn();

      await expect(runIntent({storage, invoke}))
        .rejects.toBeInstanceOf(BackendOperationIntentError);
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  test('a storage write failure prevents the network mutation', async () => {
    const storage = createMemoryStorage();
    storage.setItem.mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const invoke = jest.fn();

    await expect(runIntent({storage, invoke}))
      .rejects.toBeInstanceOf(BackendOperationIntentError);
    expect(invoke).not.toHaveBeenCalled();
  });
});
