import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import {
  BackendOperationCommittedError,
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

  test('retires a definitive failure so the next explicit attempt gets a fresh ID', async () => {
    const storage = createMemoryStorage();
    const ids = ['delete-npc-operation-0001', 'delete-npc-operation-0002'];
    const createOperationId = jest.fn(() => ids.shift());
    const definitiveError = Object.assign(new Error('invalid request'), {
      code: 'functions/invalid-argument',
    });
    const isDefinitiveError = jest.fn((error) => (
      error?.code === 'functions/invalid-argument'
    ));

    await expect(runIntent({
      storage,
      createOperationId,
      isDefinitiveError,
      invoke: jest.fn().mockRejectedValue(definitiveError),
    })).rejects.toBe(definitiveError);

    expect(isDefinitiveError).toHaveBeenCalledWith(definitiveError);
    expect(storedEntries(storage)).toEqual([]);

    const retryInvoke = jest.fn().mockResolvedValue({status: 'completed'});
    await runIntent({
      storage,
      createOperationId,
      isDefinitiveError,
      invoke: retryInvoke,
    });

    expect(retryInvoke).toHaveBeenCalledWith('delete-npc-operation-0002');
    expect(createOperationId).toHaveBeenCalledTimes(2);
  });

  test.each([
    'functions/unavailable',
    'functions/aborted',
  ])('reuses its ID after classified non-definitive %s', async (code) => {
    const storage = createMemoryStorage();
    const firstError = Object.assign(new Error(code), {code});
    const isDefinitiveError = jest.fn(() => false);

    await expect(runIntent({
      storage,
      isDefinitiveError,
      invoke: jest.fn().mockRejectedValue(firstError),
    })).rejects.toBe(firstError);

    const retryCreate = jest.fn(() => 'delete-npc-operation-0002');
    const retryInvoke = jest.fn().mockResolvedValue({status: 'completed'});
    await runIntent({
      storage,
      createOperationId: retryCreate,
      isDefinitiveError,
      invoke: retryInvoke,
    });

    expect(retryCreate).not.toHaveBeenCalled();
    expect(retryInvoke).toHaveBeenCalledWith('delete-npc-operation-0001');
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

  test('deduplicates concurrent definitive failures and retires the ID once', async () => {
    const storage = createMemoryStorage();
    const terminalError = new Error('terminal');
    const invoke = jest.fn().mockRejectedValue(terminalError);
    const isDefinitiveError = jest.fn(() => true);

    const first = runIntent({storage, invoke, isDefinitiveError});
    const second = runIntent({storage, invoke, isDefinitiveError});
    const settled = Promise.allSettled([first, second]);

    await expect(settled).resolves.toEqual([
      {status: 'rejected', reason: terminalError},
      {status: 'rejected', reason: terminalError},
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(isDefinitiveError).toHaveBeenCalledTimes(1);
    expect(storedEntries(storage)).toEqual([]);
  });

  test('a definitive failure clears only its exact stored intent', async () => {
    const storage = createMemoryStorage();
    let sequence = 0;
    const createOperationId = () => (
      `delete-npc-operation-${String(++sequence).padStart(4, '0')}`
    );

    await expect(runIntent({
      storage,
      intent: {npcId: 'neighbor-private-npc'},
      createOperationId,
      invoke: jest.fn().mockRejectedValue(new Error('offline')),
    })).rejects.toThrow('offline');

    const terminalError = new Error('terminal');
    await expect(runIntent({
      storage,
      createOperationId,
      isDefinitiveError: () => true,
      invoke: jest.fn().mockRejectedValue(terminalError),
    })).rejects.toBe(terminalError);

    expect(storedEntries(storage).map(({operationId}) => operationId))
      .toEqual(['delete-npc-operation-0001']);
  });

  test.each([
    ['throws', () => { throw new Error('classifier failed'); }],
    ['returns a non-boolean', () => 'yes'],
  ])('fails closed when the definitive classifier %s', async (_, classifier) => {
    const storage = createMemoryStorage();
    const invocationError = new Error('terminal candidate');

    await expect(runIntent({
      storage,
      isDefinitiveError: classifier,
      invoke: jest.fn().mockRejectedValue(invocationError),
    })).rejects.toBeInstanceOf(BackendOperationIntentError);

    expect(storedEntries(storage)[0].operationId)
      .toBe('delete-npc-operation-0001');
  });

  test('fails closed when a definitive intent cannot be cleared', async () => {
    const storage = createMemoryStorage();
    storage.setItem.mockImplementation((key, value) => {
      if (JSON.parse(value).entries.length === 0) {
        throw new DOMException('blocked', 'SecurityError');
      }
      storage.values.set(key, value);
    });

    await expect(runIntent({
      storage,
      isDefinitiveError: () => true,
      invoke: jest.fn().mockRejectedValue(new Error('terminal')),
    })).rejects.toBeInstanceOf(BackendOperationIntentError);

    expect(storedEntries(storage)[0].operationId)
      .toBe('delete-npc-operation-0001');
  });

  test('preserves committed result data when success receipt removal fails', async () => {
    const storage = createMemoryStorage();
    storage.setItem.mockImplementation((key, value) => {
      const entries = JSON.parse(value).entries;
      if (entries.length === 0) {
        throw new DOMException('blocked', 'SecurityError');
      }
      storage.values.set(key, value);
    });
    const result = {status: 'completed', revision: 7};

    await expect(runIntent({
      storage,
      invoke: jest.fn().mockResolvedValue(result),
    })).rejects.toMatchObject({
      committed: true,
      result,
      operationId: 'delete-npc-operation-0001',
    });
    await expect(runIntent({
      storage: (() => {
        const next = createMemoryStorage();
        next.setItem.mockImplementation((key, value) => {
          if (JSON.parse(value).entries.length === 0) {
            throw new DOMException('blocked', 'SecurityError');
          }
          next.values.set(key, value);
        });
        return next;
      })(),
      invoke: jest.fn().mockResolvedValue(result),
    })).rejects.toBeInstanceOf(BackendOperationCommittedError);
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
