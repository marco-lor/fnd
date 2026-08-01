import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { runWithDurableOperationIntent } from '../functions/backendOperationIntentStore';
import {
  FOE_TOKEN_SPAWN_OPERATION_KIND,
  isDefinitiveFoeTokenSpawnError,
  spawnGrigliataFoeToken,
} from './foeTokenSpawn';

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: jest.fn((key) => values.get(key) ?? null),
    setItem: jest.fn((key, value) => values.set(key, value)),
  };
};

const request = {
  actorUid: 'dm-user',
  foeId: 'foe-source',
  backgroundId: 'arena-one',
  col: 5,
  row: 6,
};

const originalTextEncoder = global.TextEncoder;

beforeAll(() => {
  global.TextEncoder = TextEncoder;
});

afterAll(() => {
  global.TextEncoder = originalTextEncoder;
});

test('invokes the registered spawn callable with the durable operation ID', async () => {
  const invokeCallable = jest.fn().mockResolvedValue({
    data: {tokenId: 'foe-token'},
  });
  const runIntent = jest.fn(async (options) => {
    expect(options.kind).toBe(FOE_TOKEN_SPAWN_OPERATION_KIND);
    expect(options.intent).toEqual({
      foeId: request.foeId,
      backgroundId: request.backgroundId,
      col: request.col,
      row: request.row,
    });
    return options.invoke('spawn-foe-operation-0001');
  });

  await expect(spawnGrigliataFoeToken(request, {
    invokeCallable,
    runIntent,
  })).resolves.toEqual({tokenId: 'foe-token'});
  expect(invokeCallable).toHaveBeenCalledWith({
    foeId: request.foeId,
    backgroundId: request.backgroundId,
    col: request.col,
    row: request.row,
    operationId: 'spawn-foe-operation-0001',
  });
});

test('retains and reuses the operation ID after an ambiguous callable error', async () => {
  const storage = createMemoryStorage();
  const createOperationId = jest.fn(() => 'spawn-foe-operation-0001');
  const unavailable = Object.assign(new Error('offline'), {
    code: 'functions/unavailable',
  });
  const invokeCallable = jest.fn()
    .mockRejectedValueOnce(unavailable)
    .mockResolvedValueOnce({data: {replayed: true}});
  const runIntent = (options) => runWithDurableOperationIntent({
    ...options,
    storage,
    cryptoImpl: webcrypto,
    now: () => 1_750_000_000_000,
    createOperationId,
  });

  await expect(spawnGrigliataFoeToken(request, {
    invokeCallable,
    runIntent,
  })).rejects.toBe(unavailable);
  await expect(spawnGrigliataFoeToken(request, {
    invokeCallable,
    runIntent,
  })).resolves.toEqual({replayed: true});

  expect(createOperationId).toHaveBeenCalledTimes(1);
  expect(invokeCallable.mock.calls.map(([payload]) => payload.operationId))
    .toEqual([
      'spawn-foe-operation-0001',
      'spawn-foe-operation-0001',
    ]);
});

test.each([
  'functions/already-exists',
  'functions/failed-precondition',
  'functions/invalid-argument',
  'functions/not-found',
  'functions/permission-denied',
  'functions/unauthenticated',
])('classifies %s as a definitive spawn failure', (code) => {
  expect(isDefinitiveFoeTokenSpawnError({code})).toBe(true);
});

test.each([
  'functions/aborted',
  'functions/cancelled',
  'functions/deadline-exceeded',
  'functions/internal',
  'functions/resource-exhausted',
  'functions/unavailable',
  'functions/unknown',
])('retains identity for ambiguous %s', (code) => {
  expect(isDefinitiveFoeTokenSpawnError({code})).toBe(false);
});

test('rejects malformed immutable intent before acquiring an operation ID', async () => {
  const runIntent = jest.fn();
  await expect(spawnGrigliataFoeToken({...request, col: 1.5}, {runIntent}))
    .rejects.toThrow('col must be an integer');
  expect(runIntent).not.toHaveBeenCalled();
});
