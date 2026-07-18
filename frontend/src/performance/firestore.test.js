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
};

jest.mock('firebase/firestore', () => mockUnderlying);
jest.mock('./runtime', () => mockRuntime);

const facade = require('./firestore');

beforeEach(() => {
  jest.clearAllMocks();
  mockRuntime.beginRouteAsyncWork.mockImplementation(() => jest.fn());
  mockRuntime.isPerformanceEnabled.mockReturnValue(true);
  mockRuntime.registerActiveListener.mockImplementation(() => jest.fn());
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
    tags: expect.objectContaining({ operation: 'set', target: 'users/:id' }),
  }));
  expect(mockRuntime.recordPerfEvent).toHaveBeenCalledWith(expect.objectContaining({
    metric: 'write-failure',
    tags: expect.objectContaining({ operation: 'update', code: 'permission-denied' }),
  }));
  expect(JSON.stringify(mockRuntime.recordPerfEvent.mock.calls)).not.toContain('private@example.test');
  expect(JSON.stringify(mockRuntime.recordPerfEvent.mock.calls)).not.toContain('secret-token-value');
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
