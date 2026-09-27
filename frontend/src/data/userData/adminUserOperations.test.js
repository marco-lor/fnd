import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { waitFor } from '@testing-library/react';
import { deleteAdminUser, listAdminUserDeletions, resumeAdminUserDeletion } from './adminUserOperations';
import { TASK06_OPERATION_INTENT_STORAGE_KEY } from '../functions/backendOperationIntentStore';
const mockDelete = jest.fn();
const mockStatus = jest.fn();
const mockResume = jest.fn();
jest.mock('../functions/callableRegistry', () => ({getCallable: (name) => (...args) => ({deleteUser: mockDelete, getBackendOperationStatus: mockStatus, resumeBackendOperation: mockResume}[name])(...args)}));
const originalCrypto = global.crypto;
const originalEncoder = global.TextEncoder;
const completed = {status: 'completed', progress: {processed: 5, planned: 5}};
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; };
beforeAll(() => { Object.defineProperty(global, 'crypto', {configurable: true, value: webcrypto}); global.TextEncoder = TextEncoder; });
afterAll(() => { Object.defineProperty(global, 'crypto', {configurable: true, value: originalCrypto}); global.TextEncoder = originalEncoder; });
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); mockStatus.mockResolvedValue({data: {status: 'running', progress: {processed: 2, planned: 5}}}); });

test('synchronous duplicates share durable identity, expose progress, and retry ambiguous failure', async () => {
  const pending = deferred(); mockDelete.mockReturnValueOnce(pending.promise);
  const onProgress = jest.fn();
  const first = deleteAdminUser({actorUid: 'actor', userId: 'target', onProgress});
  const duplicate = deleteAdminUser({actorUid: 'actor', userId: 'target'});
  // Register rejection handlers before settling either shared invocation.
  const outcomes = Promise.allSettled([first, duplicate]);
  await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
  const operationId = mockDelete.mock.calls[0][0].operationId;
  await waitFor(() => expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({status: 'running'})));
  pending.reject(new Error('connection lost'));
  expect((await outcomes).every(({status}) => status === 'rejected')).toBe(true);
  mockDelete.mockResolvedValueOnce({data: {operation: completed}});
  expect(await deleteAdminUser({actorUid: 'actor', userId: 'target'})).toEqual(completed);
  expect(mockDelete.mock.calls[1][0].operationId).toBe(operationId);
  const calls = mockStatus.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(mockStatus).toHaveBeenCalledTimes(calls);
});

test('abort suppresses late progress and retains recovery identity', async () => {
  const pending = deferred(); mockDelete.mockReturnValueOnce(pending.promise);
  const controller = new AbortController(); const onProgress = jest.fn();
  const run = deleteAdminUser({actorUid: 'actor', userId: 'target', signal: controller.signal, onProgress});
  const outcome = Promise.allSettled([run]);
  await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
  const operationId = mockDelete.mock.calls[0][0].operationId;
  controller.abort(); pending.resolve({data: {operation: completed}});
  expect((await outcome)[0].reason.name).toBe('AbortError');
  expect(onProgress).not.toHaveBeenCalled();
  mockDelete.mockResolvedValueOnce({data: {operation: completed}});
  await deleteAdminUser({actorUid: 'actor', userId: 'target'});
  expect(mockDelete.mock.calls[1][0].operationId).toBe(operationId);
});

test('self deletion makes no request; replay failure uses shared domain resume', async () => {
  await expect(deleteAdminUser({actorUid: 'actor', userId: 'actor'})).rejects.toThrow();
  expect(mockDelete).not.toHaveBeenCalled();
  mockDelete.mockResolvedValueOnce({data: {operation: {status: 'failed', replayed: true, retryable: true}}});
  mockResume.mockResolvedValueOnce({data: {operation: completed}});
  expect(await deleteAdminUser({actorUid: 'actor', userId: 'target'})).toEqual(completed);
  expect(mockResume).toHaveBeenCalledWith({operationId: mockDelete.mock.calls[0][0].operationId});
});

test('receipts saved before recovery discovery was added are scoped by server ownership', async () => {
  mockDelete.mockRejectedValue(new Error('connection lost'));
  await expect(deleteAdminUser({actorUid: 'actor', userId: 'target'})).rejects.toThrow();
  await expect(deleteAdminUser({actorUid: 'another-actor', userId: 'other-target'})).rejects.toThrow();
  const operationId = mockDelete.mock.calls[0][0].operationId;
  const oldStore = JSON.parse(sessionStorage.getItem(TASK06_OPERATION_INTENT_STORAGE_KEY));
  oldStore.entries.forEach((entry) => { delete entry.actorDigest; });
  sessionStorage.setItem(TASK06_OPERATION_INTENT_STORAGE_KEY, JSON.stringify(oldStore));
  mockStatus.mockImplementation(({operationId: requested}) => requested === operationId
    ? Promise.resolve({data: {kind: 'delete-user', status: 'failed', retryable: true}})
    : Promise.reject(Object.assign(new Error('not found'), {code: 'functions/not-found'})));
  expect(await listAdminUserDeletions('actor')).toEqual([{operationId, createdAt: oldStore.entries[0].createdAt}]);
  mockResume.mockResolvedValueOnce({data: {operation: completed}});
  await resumeAdminUserDeletion({actorUid: 'actor', operationId});
  expect(mockResume).toHaveBeenCalledWith({operationId});
  expect(JSON.parse(sessionStorage.getItem(TASK06_OPERATION_INTENT_STORAGE_KEY)).entries).toHaveLength(1);
});
