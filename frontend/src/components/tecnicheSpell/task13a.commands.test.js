import { updateResource, __resetUserDataCommandsForTests } from '../../data/userData/userDataCommands';
import { getFunctions, httpsCallable } from 'firebase/functions';
const mockCallable = jest.fn();
jest.mock('../../components/firebaseConfig', () => ({ app: {} }));
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn(), connectFunctionsEmulator: jest.fn() }));
beforeEach(() => {
  __resetUserDataCommandsForTests();
  getFunctions.mockReturnValue({}); httpsCallable.mockReturnValue(mockCallable);
  mockCallable.mockResolvedValue({ data: { success: true } });
});
const cast = key => updateResource({ resource: 'mana', mode: 'delta', value: -4, retryKey: key });
test('different spell/technique intents remain separate concurrent deltas', async () => {
  await Promise.all([cast('spell-use:hero:Uno'), cast('tecnica-use:hero:Uno')]);
  const payloads = mockCallable.mock.calls.map(([payload]) => payload);
  expect(payloads).toHaveLength(2);
  expect(new Set(payloads.map(payload => payload.operationId)).size).toBe(2);
  payloads.forEach(payload => {
    expect(payload).toMatchObject({ resource: 'mana', mode: 'delta', value: -4 });
    expect(payload).not.toHaveProperty('floorAtZero');
  });
});
test('ambiguous cast retry reuses the exact operation ID; successful later cast is a new intent', async () => {
  const unavailable = Object.assign(new Error('disconnect'), { code: 'functions/unavailable' });
  mockCallable.mockRejectedValueOnce(unavailable);
  await expect(cast('spell-use:hero:Uno')).rejects.toBe(unavailable);
  await cast('spell-use:hero:Uno');
  expect(mockCallable.mock.calls[1][0].operationId).toBe(mockCallable.mock.calls[0][0].operationId);
  await cast('spell-use:hero:Uno');
  expect(mockCallable.mock.calls[2][0].operationId).not.toBe(mockCallable.mock.calls[0][0].operationId);
});
