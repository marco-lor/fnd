import React from 'react';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminPage from './adminPage';

const mockPage = jest.fn();
const mockDelete = jest.fn();
const mockResume = jest.fn();
const mockStatus = jest.fn();
let mockAuth;
jest.mock('../../AuthContext', () => ({useAuth: () => mockAuth}));
jest.mock('../../data/configRepository', () => ({getPossibleLists: async () => ({})}));
jest.mock('../../data/userData/userDataCommands', () => ({getAdminUsersPage: (...args) => mockPage(...args)}));
jest.mock('../../data/functions/callableRegistry', () => ({getCallable: (name) => (...args) => ({deleteUser: mockDelete, resumeBackendOperation: mockResume, getBackendOperationStatus: mockStatus}[name])(...args)}));
const originalCrypto = global.crypto;
const originalEncoder = global.TextEncoder;
const completed = {status: 'completed', progress: {processed: 5, planned: 5}};
const emptyPage = {items: [], hasMore: false, cursor: null};
const deferred = () => { let resolve; const promise = new Promise((done) => {resolve = done;}); return {promise, resolve}; };
beforeAll(() => { Object.defineProperty(global, 'crypto', {configurable: true, value: webcrypto}); global.TextEncoder = TextEncoder; });
afterAll(() => { Object.defineProperty(global, 'crypto', {configurable: true, value: originalCrypto}); global.TextEncoder = originalEncoder; });
beforeEach(() => {
  jest.clearAllMocks(); sessionStorage.clear();
  mockAuth = {user: {uid: 'actor-a'}, userData: {role: 'webmaster'}};
  mockPage.mockResolvedValue(emptyPage).mockResolvedValueOnce({items: [{id: 'target', characterId: 'Target', role: 'player'}], hasMore: false, cursor: null});
  mockDelete.mockRejectedValue(new Error('Auth cleanup failed after directory removal'));
  mockResume.mockResolvedValue({data: {operation: completed}});
});

const startFailedDeletion = async () => {
  const view = render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', {name: 'Elimina', exact: true}));
  fireEvent.change(screen.getByLabelText('Conferma eliminazione'), {target: {value: 'ELIMINA'}});
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Elimina Utente'}));
  await screen.findByRole('button', {name: 'Riprova eliminazione'});
  const operationId = mockDelete.mock.calls[0][0].operationId;
  view.unmount();
  return operationId;
};

test('reload restores deletion recovery after the target root and directory are gone', async () => {
  const operationId = await startFailedDeletion();
  render(<AdminPage />);
  expect(await screen.findByText('Nessun utente trovato.')).toBeVisible();
  fireEvent.click(await screen.findByRole('button', {name: 'Riprendi eliminazione'}));
  await waitFor(() => expect(mockResume).toHaveBeenCalledWith({operationId}));
  await waitFor(() => expect(screen.queryByRole('button', {name: 'Riprendi eliminazione'})).not.toBeInTheDocument());
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(JSON.parse(sessionStorage.getItem('fnd.task06.operation-intents.v1')).entries).toEqual([]);
});

test('recovery stays actor scoped and an auth change aborts polling without clearing the receipt', async () => {
  const operationId = await startFailedDeletion();
  mockAuth = {user: {uid: 'actor-b'}, userData: {role: 'webmaster'}};
  const view = render(<AdminPage />);
  await screen.findByText('Nessun utente trovato.');
  expect(screen.queryByRole('button', {name: 'Riprendi eliminazione'})).not.toBeInTheDocument();
  mockAuth = {user: {uid: 'actor-a'}, userData: {role: 'webmaster'}};
  view.rerender(<AdminPage />);
  const pending = deferred(); mockResume.mockReturnValueOnce(pending.promise);
  fireEvent.click(await screen.findByRole('button', {name: 'Riprendi eliminazione'}));
  await waitFor(() => expect(mockResume).toHaveBeenCalledWith({operationId}));
  mockAuth = {user: {uid: 'actor-b'}, userData: {role: 'webmaster'}};
  view.rerender(<AdminPage />);
  await act(async () => pending.resolve({data: {operation: completed}}));
  expect(screen.queryByRole('button', {name: 'Riprendi eliminazione'})).not.toBeInTheDocument();
  expect(JSON.parse(sessionStorage.getItem('fnd.task06.operation-intents.v1')).entries).toHaveLength(1);
  mockAuth = {user: {uid: 'actor-a'}, userData: {role: 'webmaster'}};
  view.rerender(<AdminPage />);
  expect(await screen.findByRole('button', {name: 'Riprendi eliminazione'})).toBeVisible();
});
