import {
  __resetUserDataCommandsForTests,
  createUserOperationId,
  purchaseItem,
  updateResource,
} from './userDataCommands';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';

const mockCallable = jest.fn((payload) => Promise.resolve({
  data: { success: true, replayed: false, payload },
}));

jest.mock('../../components/firebaseConfig', () => ({ app: {} }));

jest.mock('firebase/functions', () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(() => ({ region: 'europe-west8' })),
  httpsCallable: jest.fn(() => mockCallable),
}));

describe('Task 05 user commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFunctions.mockImplementation((_app, region) => ({ region }));
    httpsCallable.mockImplementation(() => mockCallable);
    mockCallable.mockImplementation((payload) => Promise.resolve({
      data: { success: true, replayed: false, payload },
    }));
    __resetUserDataCommandsForTests();
  });

  test('acquires the europe-west8 client only when a command is invoked', async () => {
    expect(getFunctions).not.toHaveBeenCalled();

    await purchaseItem({ itemId: 'sword-1', operationId: 'purchase-fixed' });

    expect(getFunctions).toHaveBeenCalledWith({}, 'europe-west8');
    expect(connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  test('sends only the catalog item ID and idempotency key for purchases', async () => {
    await purchaseItem({ itemId: 'sword-1', operationId: 'purchase-fixed' });

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'task05PurchaseItem');
    expect(mockCallable).toHaveBeenCalledWith({
      itemId: 'sword-1',
      operationId: 'purchase-fixed',
    });
  });

  test('keeps resource semantics explicit in the command payload', async () => {
    await updateResource({
      resource: 'hp',
      mode: 'delta',
      value: -3,
      operationId: 'resource-fixed',
    });

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'task05UpdateResource');
    expect(mockCallable).toHaveBeenCalledWith({
      operationId: 'resource-fixed',
      resource: 'hp',
      mode: 'delta',
      value: -3,
    });
  });

  test('forwards the atomic barrier total and turn metadata', async () => {
    await updateResource({
      resource: 'barriera',
      mode: 'set',
      value: 12,
      totalValue: 12,
      totalTurns: 3,
      remainingTurns: 3,
      operationId: 'barrier-fixed',
    });

    expect(mockCallable).toHaveBeenCalledWith({
      operationId: 'barrier-fixed',
      resource: 'barriera',
      mode: 'set',
      value: 12,
      totalValue: 12,
      totalTurns: 3,
      remainingTurns: 3,
    });
  });

  test('generates IDs accepted by the shared server contract', () => {
    expect(createUserOperationId('purchase')).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/);
  });

  test('reuses an operation ID only when the same logical-action retry key is supplied', async () => {
    const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
    mockCallable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ data: { success: true } });

    await expect(purchaseItem({ itemId: 'sword-1', retryKey: 'user-1:purchase-flow-1' })).rejects.toBe(unavailable);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;
    await expect(purchaseItem({ itemId: 'sword-1', retryKey: 'user-1:purchase-flow-1' })).resolves.toEqual({ success: true });
    expect(mockCallable.mock.calls[1][0].operationId).toBe(firstOperationId);
  });

  test('releases a logical-action operation ID after a definitive callable failure', async () => {
    const invalid = Object.assign(new Error('invalid'), { code: 'functions/invalid-argument' });
    mockCallable
      .mockRejectedValueOnce(invalid)
      .mockResolvedValueOnce({ data: { success: true } });

    await expect(purchaseItem({ itemId: 'sword-1', retryKey: 'user-1:purchase-flow-2' })).rejects.toBe(invalid);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;
    await purchaseItem({ itemId: 'sword-1', retryKey: 'user-1:purchase-flow-2' });
    expect(mockCallable.mock.calls[1][0].operationId).not.toBe(firstOperationId);
  });

  test('does not collapse concurrent identical resource deltas into one operation', async () => {
    await Promise.all([
      updateResource({ userId: 'user-1', resource: 'hp', mode: 'delta', value: -1 }),
      updateResource({ userId: 'user-1', resource: 'hp', mode: 'delta', value: -1 }),
    ]);

    expect(mockCallable).toHaveBeenCalledTimes(2);
    const [firstPayload, secondPayload] = mockCallable.mock.calls.map(([payload]) => payload);
    expect(secondPayload).toMatchObject({ userId: 'user-1', resource: 'hp', mode: 'delta', value: -1 });
    expect(secondPayload.operationId).not.toBe(firstPayload.operationId);
  });
});
