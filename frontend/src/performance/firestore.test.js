const mockUnderlying = {
  onSnapshot: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  getCountFromServer: jest.fn(),
  addDoc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  writeBatch: jest.fn(),
  runTransaction: jest.fn(),
};
const mockRuntime = {
  beginRouteAsyncWork: jest.fn(() => jest.fn()),
  isPerformanceEnabled: jest.fn(() => true),
  recordPerfEvent: jest.fn(),
  registerActiveListener: jest.fn(() => jest.fn()),
  withAsyncResourceOwner: jest.fn((_owner, callback) => callback()),
};

jest.mock('firebase/firestore', () => mockUnderlying);
jest.mock('./runtime', () => mockRuntime);

const facade = require('./firestore');

beforeEach(() => {
  jest.clearAllMocks();
  mockRuntime.beginRouteAsyncWork.mockImplementation(() => jest.fn());
  mockRuntime.isPerformanceEnabled.mockReturnValue(true);
  mockRuntime.registerActiveListener.mockImplementation(() => jest.fn());
  mockRuntime.withAsyncResourceOwner.mockImplementation((_owner, callback) => callback());
});

test('listener snapshot delivery and repeated unsubscribe are accounted once', () => {
  const unsubscribeCalls = [];
  const firebaseUnsubscribe = () => unsubscribeCalls.push('closed');
  mockUnderlying.onSnapshot.mockImplementation((_target, callback) => {
    callback({ size: 2, docChanges: () => [{}, {}] });
    callback({ size: 2, docChanges: () => [{}] });
    return firebaseUnsubscribe;
  });
  const callback = jest.fn();
  const unsubscribe = facade.onSnapshot({ path: 'items' }, callback);
  unsubscribe();
  unsubscribe();
  expect(callback).toHaveBeenCalledTimes(2);
  expect(unsubscribeCalls).toHaveLength(1);
  expect(mockRuntime.registerActiveListener.mock.results[0].value).toHaveBeenCalledTimes(1);
  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({ metric: 'initial-documents-delivered', value: 2 }));
  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({ metric: 'changed-documents-delivered', value: 1 }));
  expect(mockRuntime.registerActiveListener).toHaveBeenCalledWith('legacy.items.subscribe.v1', 'route');
  expect(mockRuntime.withAsyncResourceOwner).toHaveBeenCalledWith(
    'firestore-transport',
    expect.any(Function)
  );
});

test('payload estimator handles serializable and circular values safely', () => {
  expect(facade.estimatePayloadBytes({ value: 'hello' })).toBeGreaterThan(0);
  const circular = {};
  circular.self = circular;
  expect(facade.estimatePayloadBytes(circular)).toBe(0);
});

test('direct writes report attempts, successes, and permission failures without payload contents', async () => {
  mockUnderlying.setDoc.mockResolvedValueOnce('saved');
  await expect(facade.setDoc({ path: 'users/private-user-id' }, {
    email: 'private@example.test',
    token: 'secret-token-value',
  })).resolves.toBe('saved');

  const permissionError = Object.assign(new Error('denied'), { code: 'permission-denied' });
  mockUnderlying.updateDoc.mockRejectedValueOnce(permissionError);
  await expect(facade.updateDoc({ path: 'users/private-user-id' }, { role: 'dm' }))
    .rejects.toBe(permissionError);

  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({
    metric: 'write-success',
    tags: expect.objectContaining({ operation: 'set', target: 'legacy.users.document.set.v1' }),
  }));
  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({
    metric: 'write-failure',
    tags: expect.objectContaining({ operation: 'update', code: 'permission-denied' }),
  }));
  expect(JSON.stringify(mockRuntime.recordPerfEvent.mock.calls)).not.toContain('private@example.test');
  expect(JSON.stringify(mockRuntime.recordPerfEvent.mock.calls)).not.toContain('secret-token-value');
  expect(mockRuntime.withAsyncResourceOwner.mock.calls).toHaveLength(2);
  expect(mockRuntime.withAsyncResourceOwner.mock.calls.every(([owner]) => (
    owner === 'firestore-transport'
  ))).toBe(true);
});

test('explicit labels apply to one-shot reads and reject unsafe dynamic-looking keys', async () => {
  const snapshot = {
    exists: () => true,
    data: () => ({ dice: ['d6'] }),
  };
  mockUnderlying.getDoc.mockResolvedValue(snapshot);
  const target = facade.labelFirestoreTarget(
    { path: 'utils/varie' },
    'config.varie.get.v1'
  );

  await expect(facade.getDoc(target)).resolves.toBe(snapshot);
  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({
    metric: 'one-shot-documents-delivered',
    tags: expect.objectContaining({ target: 'config.varie.get.v1' }),
  }));
  expect(() => facade.labelFirestoreTarget(target, 'user@example.test'))
    .toThrow(/metric keys/i);
});

test('getDocs and listeners use operation-specific stable labels', async () => {
  const querySnapshot = {
    size: 1,
    docs: [{ data: () => ({ label: 'Hero' }) }],
    docChanges: () => [],
  };
  mockUnderlying.getDocs.mockResolvedValue(querySnapshot);
  mockUnderlying.onSnapshot.mockImplementation((_target, next) => {
    next(querySnapshot);
    return jest.fn();
  });

  const listTarget = facade.labelFirestoreTarget(
    { path: 'user_directory' },
    'directory.users.list.v1'
  );
  await facade.getDocs(listTarget);
  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({
    metric: 'one-shot-documents-delivered',
    tags: expect.objectContaining({ target: 'directory.users.list.v1' }),
  }));

  const listenerTarget = facade.labelFirestoreTarget(
    { path: 'user_directory' },
    'directory.users.subscribe.v1'
  );
  facade.onSnapshot(listenerTarget, jest.fn());
  expect(mockRuntime.registerActiveListener)
    .toHaveBeenCalledWith('directory.users.subscribe.v1', 'route');
});

test('legacy read keys canonicalize document IDs instead of logging them', async () => {
  mockUnderlying.getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({ characterId: 'Private Hero' }),
  });

  await facade.getDoc({ path: 'users/private-account-123' });
  const serializedEvents = JSON.stringify(mockRuntime.recordPerfEvent.mock.calls);
  expect(serializedEvents).toContain('legacy.users.document.get.v1');
  expect(serializedEvents).not.toContain('private-account-123');
  expect(serializedEvents).not.toContain('Private Hero');
});

test('batches account for operation count and payload bytes at commit', async () => {
  const rawBatch = {
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn(() => Promise.resolve('committed')),
  };
  mockUnderlying.writeBatch.mockReturnValue(rawBatch);

  const batch = facade.writeBatch({});
  batch
    .set({ path: 'items/item-1' }, { name: 'one' })
    .update({ path: 'items/item-2' }, { quantity: 2 })
    .delete({ path: 'items/item-3' });
  await expect(batch.commit()).resolves.toBe('committed');

  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({
    metric: 'write-attempt',
    value: expect.any(Number),
    tags: expect.objectContaining({ operation: 'batch', operations: 3 }),
  }));
  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({
    metric: 'write-success',
    tags: expect.objectContaining({ operation: 'batch', operations: 3 }),
  }));
});

test('transactions distinguish retry attempts from the final result', async () => {
  const rawTransaction = {
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    get: jest.fn(),
  };
  mockUnderlying.runTransaction.mockImplementation(async (_db, callback) => {
    await callback(rawTransaction);
    await callback(rawTransaction);
    return 'transaction-result';
  });

  await expect(facade.runTransaction({}, (transaction) => {
    transaction.update({ path: 'users/user-1' }, { score: 1 });
  })).resolves.toBe('transaction-result');

  const attemptEvents = mockRuntime.recordPerfEvent.mock.calls
    .map(([event]) => event)
    .filter((event) => event.metric === 'write-attempt' && event.tags.operation === 'transaction');
  expect(attemptEvents).toEqual([
    expect.objectContaining({ tags: expect.objectContaining({ attempt: 1, operations: 1 }) }),
    expect.objectContaining({ tags: expect.objectContaining({ attempt: 2, operations: 1 }) }),
  ]);
  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({
    metric: 'write-success',
    tags: expect.objectContaining({ operation: 'transaction', attempts: 2 }),
  }));
});

test('disabled instrumentation delegates without recording telemetry', async () => {
  mockRuntime.isPerformanceEnabled.mockReturnValue(false);
  mockUnderlying.setDoc.mockResolvedValueOnce('plain-result');

  await expect(facade.setDoc({ path: 'users/user-1' }, { score: 1 })).resolves.toBe('plain-result');
  expect(mockRuntime.recordPerfEvent).not.toHaveBeenCalled();
});
